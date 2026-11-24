// Persistent PoB worker pool + priority queue tests:
//   1. Queue, priority, cancellation, timeout, crash recovery, recycle, RSS limit,
//      one-shot fallback, calc-server /health and remote priority header (always run
//      using a tiny fake Node worker script).
//   2. Real PoB parity across every fixture in tests/fixtures/pob-builds/ and
//      cross-build isolation (A, B, A, B and B, A on 1 and 2 workers, including
//      Full DPS groups and companion/spectre builds). Skipped cleanly when PoB is
//      not installed locally.
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCalcServer } from "../scripts/pob-calc-server.mjs";
import { pobRuntime, readFixtures } from "../scripts/check-pob-parity.mjs";
import { plannerCalculationRequest } from "../scripts/lib/planner-node.mjs";
import { buildApp } from "../src/server/app.mjs";
import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { createPobPool } from "../src/server/pob-pool.mjs";
import { runPobLocal, runPobRemote } from "../src/server/pob-runner.mjs";

const TOKEN = "test-pool-token-0123456789abcdef";
const fakeWorkerPath = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-pob-worker.cjs");

const xmlTag = (attrs) => `<PathOfBuilding2><Build ${attrs}/></PathOfBuilding2>`;
const makeFakePool = (overrides = {}) => createPobPool({
  coreDir: process.cwd(),
  luajit: process.execPath,
  script: fakeWorkerPath,
  workers: 1,
  prewarm: false,
  maxJobs: 200,
  maxRssMb: 768,
  maxQueue: 32,
  maxQueueWaitMs: 5_000,
  timeoutMs: 5_000,
  ...overrides
});

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

// ── Unit tests for pool, queue, cancellation, recovery, recycle ────────────

test("pool queue runs main priority ahead of queued background jobs", async () => {
  const order = [];
  const pool = makeFakePool({ workers: 1, prewarm: true });
  try {
    await pool.prewarm();
    // Occupy the single worker first.
    const blocker = pool.run(xmlTag('tag="blocker" delay="180"'), { priority: "background" })
      .then((r) => { order.push(r.tag); return r; });
    const bg1 = pool.run(xmlTag('tag="bg1" delay="40"'), { priority: "background" })
      .then((r) => { order.push(r.tag); return r; });
    const bg2 = pool.run(xmlTag('tag="bg2" delay="40"'), { priority: "background" })
      .then((r) => { order.push(r.tag); return r; });
    const main1 = pool.run(xmlTag('tag="main1" delay="40"'), { priority: "main" })
      .then((r) => { order.push(r.tag); return r; });
    const main2 = pool.run(xmlTag('tag="main2" delay="40"'), { priority: "main" })
      .then((r) => { order.push(r.tag); return r; });

    await Promise.all([blocker, bg1, bg2, main1, main2]);
    assert.deepEqual(order, ["blocker", "main1", "main2", "bg1", "bg2"]);
  } finally {
    await pool.close();
  }
});

test("pool enforces maxQueue and maxQueueWaitMs with 503 errors", async () => {
  const pool = makeFakePool({ workers: 1, prewarm: true, maxQueue: 1, maxQueueWaitMs: 120 });
  try {
    await pool.prewarm();
    const first = pool.run(xmlTag('tag="slow" delay="350"'));
    // Second fills the single queue slot and times out waiting.
    const second = pool.run(xmlTag('tag="wait-timeout" delay="10"'));
    // Third overflows maxQueue immediately.
    await assert.rejects(
      pool.run(xmlTag('tag="overflow" delay="10"')),
      (err) => err.statusCode === 503 && /busy/i.test(err.message)
    );
    await assert.rejects(
      second,
      (err) => err.statusCode === 503 && /wait timed out/i.test(err.message)
    );
    const firstRes = await first;
    assert.equal(firstRes.tag, "slow");
  } finally {
    await pool.close();
  }
});

test("cancelled request is removed from the queue and never executed", async () => {
  const executed = [];
  const pool = makeFakePool({
    workers: 1,
    prewarm: true,
    logger: (_lvl, ev) => { if (ev.event === "pob_job") executed.push(ev); }
  });
  try {
    await pool.prewarm();
    const blocker = pool.run(xmlTag('tag="blocker" delay="220"'));
    const ac = new AbortController();
    const cancelled = pool.run(xmlTag('tag="never-run" delay="10"'), { signal: ac.signal });
    const after = pool.run(xmlTag('tag="after" delay="10"'));

    // Cancel while still queued behind blocker.
    assert.equal(pool.health().queued.total, 2);
    ac.abort();
    await assert.rejects(cancelled, (err) => err.name === "AbortError");
    assert.equal(pool.health().queued.total, 1, "cancelled job removed from queue immediately");

    const [r1, r2] = await Promise.all([blocker, after]);
    assert.equal(r1.tag, "blocker");
    assert.equal(r2.tag, "after");
    assert.equal(executed.length, 2, "cancelled job was never dispatched to worker");
    assert.equal(pool.health().stats.cancelled, 1);
  } finally {
    await pool.close();
  }
});

test("pool replaces a crashed worker and keeps serving subsequent requests", async () => {
  const pool = makeFakePool({ workers: 1, prewarm: true });
  try {
    await pool.prewarm();
    const before = await pool.run(xmlTag('tag="before"'));
    await assert.rejects(pool.run(xmlTag('tag="boom" crash="1"')), /crashed/i);
    const after = await pool.run(xmlTag('tag="after"'));
    assert.equal(after.tag, "after");
    assert.notEqual(after.pid, before.pid, "replacement worker has a new PID");
    assert.equal(pool.health().stats.crashes, 1);
  } finally {
    await pool.close();
  }
});

test("pool keeps worker alive on recoverable error, replaces on fatal error or timeout", async () => {
  const pool = makeFakePool({ workers: 1, prewarm: true, timeoutMs: 180 });
  try {
    await pool.prewarm();
    const r1 = await pool.run(xmlTag('tag="ok1"'));
    // Recoverable error: worker stays alive with same PID.
    await assert.rejects(pool.run(xmlTag('tag="bad" error="1"')), /Invalid XML/);
    const r2 = await pool.run(xmlTag('tag="ok2"'));
    assert.equal(r2.pid, r1.pid, "recoverable error does not kill worker");

    // Fatal error: worker exits and is replaced.
    await assert.rejects(pool.run(xmlTag('tag="fatal" fatal="1"')), /Internal Lua panic/);
    const r3 = await pool.run(xmlTag('tag="ok3"'));
    assert.notEqual(r3.pid, r1.pid, "fatal error replaces worker");

    // Timeout: worker is killed and replaced.
    await assert.rejects(pool.run(xmlTag('tag="hang" hang="1"')), /timed out/i);
    const r4 = await pool.run(xmlTag('tag="ok4"'));
    assert.notEqual(r4.pid, r3.pid, "timeout kills and replaces worker");
    assert.equal(pool.health().stats.timeouts, 1);
  } finally {
    await pool.close();
  }
});

test("pool recycles worker after maxJobs and when RSS exceeds maxRssMb", async () => {
  // Recycle after 3 jobs.
  const jobPool = makeFakePool({ workers: 1, prewarm: true, maxJobs: 3, maxRssMb: 0 });
  try {
    await jobPool.prewarm();
    const pids = [];
    for (let i = 0; i < 4; i++) {
      pids.push((await jobPool.run(xmlTag(`tag="j${i}"`))).pid);
    }
    assert.equal(pids[0], pids[1]);
    assert.equal(pids[1], pids[2]);
    assert.notEqual(pids[3], pids[2], "4th job ran on a recycled worker");
    assert.equal(jobPool.health().stats.recycles, 1);
  } finally {
    await jobPool.close();
  }

  // Recycle when RSS exceeds threshold.
  const rssPool = makeFakePool({ workers: 1, prewarm: true, maxJobs: 100, maxRssMb: 200 });
  try {
    await rssPool.prewarm();
    const r1 = await rssPool.run(xmlTag('tag="small" rssMb="150"'));
    const r2 = await rssPool.run(xmlTag('tag="big" rssMb="260"'));
    assert.equal(r2.pid, r1.pid, "2nd job still ran on first worker and triggered RSS recycle");
    const r3 = await rssPool.run(xmlTag('tag="after-recycle" rssMb="150"'));
    assert.notEqual(r3.pid, r1.pid, "3rd job ran on replacement worker after RSS exceeded maxRssMb");
    assert.equal(rssPool.health().stats.recycles, 1);
  } finally {
    await rssPool.close();
  }
});

test("pool falls back to one-shot runner when no worker can start", async () => {
  let fallbackCalls = 0;
  const pool = createPobPool({
    coreDir: tmpdir(),
    luajit: process.execPath,
    script: join(tmpdir(), "definitely-does-not-exist-worker.cjs"),
    workers: 1,
    prewarm: false,
    oneShotFallback: async (xml) => {
      fallbackCalls += 1;
      return { fromFallback: true, len: xml.length };
    }
  });
  try {
    const res = await pool.run(xmlTag('tag="fb"'));
    assert.equal(res.fromFallback, true);
    assert.equal(fallbackCalls, 1);
    assert.equal(pool.health().stats.fallbacks, 1);
  } finally {
    await pool.close();
  }
});

test("calc-server exposes pool /health, honors x-pob-priority, and cancels disconnected clients", async () => {
  const pool = makeFakePool({ workers: 1, prewarm: true, maxQueue: 4, maxQueueWaitMs: 5_000 });
  const server = createCalcServer({ token: TOKEN, luajit: "luajit" }, { pool });
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}`;
  try {
    await pool.prewarm();
    const health0 = await fetch(`${url}/health`).then((r) => r.json());
    assert.equal(health0.ok, true);
    assert.equal(health0.busy, 0);
    assert.equal(health0.queued.total, 0);
    assert.equal(health0.workers.length, 1);
    assert.ok(health0.workers[0].rssMb > 0, "health reports RSS per worker");

    // Priority through runPobRemote (header x-pob-priority).
    const done = [];
    const p1 = runPobRemote(xmlTag('tag="hold" delay="220"'), { url: `${url}/calculate`, token: TOKEN, priority: "background" })
      .then((d) => done.push(d.tag));
    // Queue a background job, a disconnected job, and a main job.
    await new Promise((r) => setTimeout(r, 30));
    const pBg = runPobRemote(xmlTag('tag="bg" delay="20"'), { url: `${url}/calculate`, token: TOKEN, priority: "background" })
      .then((d) => done.push(d.tag));

    // Start an HTTP request that aborts while queued.
    const dropAc = new AbortController();
    const pDrop = runPobRemote(xmlTag('tag="drop" delay="20"'), {
      url: `${url}/calculate`, token: TOKEN, priority: "background", signal: dropAc.signal
    }).then((d) => done.push(d.tag)).catch((e) => e);

    const pMain = runPobRemote(xmlTag('tag="main" delay="20"'), { url: `${url}/calculate`, token: TOKEN, priority: "main" })
      .then((d) => done.push(d.tag));

    // Wait briefly so all 3 are queued, then abort the middle one.
    await new Promise((r) => setTimeout(r, 40));
    const midHealth = await fetch(`${url}/health`).then((r) => r.json());
    assert.equal(midHealth.busy, 1);
    assert.equal(midHealth.queued.main, 1);
    assert.equal(midHealth.queued.background, 2);

    dropAc.abort();
    const dropErr = await pDrop;
    assert.equal(dropErr.name, "AbortError");

    await Promise.all([p1, pBg, pMain]);
    assert.deepEqual(done, ["hold", "main", "bg"], "main ran ahead of background and dropped request never ran");
  } finally {
    server.closeAllConnections();
    server.close();
    await pool.close();
  }
});

test("public routes classify main vs background priorities and pass them to the runner", async () => {
  const seen = [];
  const app = await buildApp({
    db: null,
    logger: false,
    sessionSecret: "test-session-secret",
    premiumSigner: null,
    pobRunner: {
      mode: "remote",
      run: async (_xml, opts = {}) => {
        seen.push(opts.priority);
        return { CombinedDPS: 100, Life: 1000, NodeDeltas: {} };
      }
    }
  });
  try {
    await app.inject({
      method: "POST",
      url: "/api/builds/calculate",
      payload: { className: "Witch", level: 90, skills: [], inventory_slots: [] }
    });
    await app.inject({
      method: "POST",
      url: "/api/builds/calculate",
      payload: { className: "Witch", level: 91, skills: [], inventory_slots: [], calc_priority: "compare" }
    });
    await app.inject({
      method: "POST",
      url: "/api/builds/node-deltas",
      payload: { className: "Witch", level: 92, passives: [1], skills: [], inventory_slots: [], node_ids: [2] }
    });
    assert.deepEqual(seen, ["main", "background", "background"]);
  } finally {
    await app.close();
  }
});

// ── Real Path of Building parity & isolation tests ─────────────────────────

const runtime = pobRuntime();
const fixtures = readFixtures();

test("warm worker matches one-shot exactly on every fixture in tests/fixtures/pob-builds/", {
  skip: runtime.available ? false : `PoB not installed locally (${runtime.coreDir}); run scripts/setup-pob-local.mjs`,
  timeout: 300_000
}, async () => {
  assert.ok(fixtures.length >= 3, "expected real PoB fixtures");
  const cases = await Promise.all(fixtures.map(async (fixture) => {
    const { body } = await plannerCalculationRequest(fixture.code);
    return { file: fixture.file, xml: buildPobXml(body) };
  }));

  // Compute one-shot baselines (up to 4 in parallel to keep test runtime short).
  const oneShots = new Array(cases.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, cases.length) }, async () => {
    while (cursor < cases.length) {
      const idx = cursor++;
      oneShots[idx] = await runPobLocal(cases[idx].xml, {
        coreDir: runtime.coreDir,
        luajit: runtime.luajit,
        script: runtime.script,
        timeoutMs: 60_000
      });
    }
  }));

  // Run every fixture sequentially on a single warm worker and verify exact deep-equality.
  const pool = createPobPool({
    coreDir: runtime.coreDir,
    luajit: runtime.luajit,
    script: runtime.script,
    workers: 1,
    prewarm: true,
    maxJobs: 200,
    maxRssMb: 0,
    timeoutMs: 60_000
  });
  try {
    await pool.prewarm();
    for (let i = 0; i < cases.length; i++) {
      const warm = await pool.run(cases[i].xml);
      assert.deepEqual(warm, oneShots[i], `warm worker diverged from one-shot on ${cases[i].file}`);
    }
  } finally {
    await pool.close();
  }
});

test("cross-build isolation: A, B, A, B and B, A on 1 and 2 workers (Full DPS + companion/spectre + empty + recoverable error)", {
  skip: runtime.available ? false : `PoB not installed locally (${runtime.coreDir}); run scripts/setup-pob-local.mjs`,
  timeout: 300_000
}, async () => {
  // Build A: Full DPS groups (mercenary-gemling-2 has multiple active/triggered groups).
  // Build B: Companion/spectre + minion build (lich-companions).
  // Build C: Empty character (catches leaked GlobalGemAssignments / GroupDPS / Minion / Totem).
  const [fxA] = readFixtures(["mercenary-gemling-2.json"]);
  const [fxB] = readFixtures(["lich-companions.json"]);
  assert.ok(fxA && fxB, "required fixtures mercenary-gemling-2.json and lich-companions.json");

  const xmlA = buildPobXml((await plannerCalculationRequest(fxA.code)).body);
  const xmlB = buildPobXml((await plannerCalculationRequest(fxB.code)).body);
  const xmlC = buildPobXml({ className: "Witch", level: 1, skills: [], inventory_slots: [] });

  const oneShotOpts = { coreDir: runtime.coreDir, luajit: runtime.luajit, script: runtime.script, timeoutMs: 60_000 };
  const [baseA, baseB, baseC] = await Promise.all([
    runPobLocal(xmlA, oneShotOpts),
    runPobLocal(xmlB, oneShotOpts),
    runPobLocal(xmlC, oneShotOpts)
  ]);

  // 1-worker isolation: A, B, A, B, C, invalid XML (recoverable), B, A.
  const pool1 = createPobPool({
    coreDir: runtime.coreDir,
    luajit: runtime.luajit,
    script: runtime.script,
    workers: 1,
    prewarm: true,
    maxJobs: 200,
    maxRssMb: 0,
    timeoutMs: 60_000
  });
  try {
    await pool1.prewarm();
    const initialPid = pool1.health().workers[0].pid;
    assert.deepEqual(await pool1.run(xmlA), baseA, "1w: A (1st)");
    assert.deepEqual(await pool1.run(xmlB), baseB, "1w: B (1st)");
    assert.deepEqual(await pool1.run(xmlA), baseA, "1w: A (2nd)");
    assert.deepEqual(await pool1.run(xmlB), baseB, "1w: B (2nd)");
    assert.deepEqual(await pool1.run(xmlC), baseC, "1w: empty after rich builds");

    // Malformed XML returns an error and leaves the worker healthy and reusable.
    await assert.rejects(pool1.run("<NotPoB/>"), /PathOfBuilding2|rejected|Error/i);
    assert.equal(pool1.health().workers[0].pid, initialPid, "worker survived bad XML without respawn");

    assert.deepEqual(await pool1.run(xmlB), baseB, "1w: B (after bad XML)");
    assert.deepEqual(await pool1.run(xmlA), baseA, "1w: A (after B)");
  } finally {
    await pool1.close();
  }

  // 2-worker isolation: concurrent A, B, A, B and B, A.
  const pool2 = createPobPool({
    coreDir: runtime.coreDir,
    luajit: runtime.luajit,
    script: runtime.script,
    workers: 2,
    prewarm: true,
    maxJobs: 200,
    maxRssMb: 0,
    timeoutMs: 60_000
  });
  try {
    await pool2.prewarm();
    const wave1 = await Promise.all([pool2.run(xmlA), pool2.run(xmlB)]);
    assert.deepEqual(wave1[0], baseA, "2w wave1: A");
    assert.deepEqual(wave1[1], baseB, "2w wave1: B");

    const wave2 = await Promise.all([pool2.run(xmlB), pool2.run(xmlA)]);
    assert.deepEqual(wave2[0], baseB, "2w wave2: B");
    assert.deepEqual(wave2[1], baseA, "2w wave2: A");

    const wave3 = await Promise.all([pool2.run(xmlA), pool2.run(xmlB), pool2.run(xmlC)]);
    assert.deepEqual(wave3[0], baseA, "2w wave3: A");
    assert.deepEqual(wave3[1], baseB, "2w wave3: B");
    assert.deepEqual(wave3[2], baseC, "2w wave3: C");
  } finally {
    await pool2.close();
  }
});

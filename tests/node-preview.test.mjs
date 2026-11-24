// Passive node preview: POST /api/builds/node-deltas prices a batch of passive nodes
// with one PoB run, and the planner's NodePreviewStore batches and caches the answers
// per build (src/spa/lib/nodePreview.ts).
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { buildApp } from "../src/server/app.mjs";
import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { nodeDeltasFromOutput, nodeDeltasXml, runNodeDeltas } from "../src/server/pob-node-deltas.mjs";
import { pobRuntime, readFixtures, runPob } from "../scripts/check-pob-parity.mjs";
import { loadSpaLib, plannerCalculationRequest, repoRoot } from "../scripts/lib/planner-node.mjs";
import { localCalculateScript } from "../scripts/setup-pob-local.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

const fakeApp = (run) => buildApp({ db: null, logger: false, sessionSecret: "test-session-secret", premiumSigner: null, pobRunner: { mode: "remote", run } });
const BUILD = { className: "Witch", level: 90, passives: [1, 2], skills: [], inventory_slots: [] };

test("node-deltas endpoint: one PoB run per batch, only the node part, cached", async () => {
  const calls = [];
  const app = await fakeApp(async (xml) => {
    calls.push(xml);
    return { CombinedDPS: 1000, Life: 500, SomethingElse: 3, Breakdown: {}, NodeDeltas: { 10: { allocated: false, node: { Life: 12 }, pathLength: 1 } } };
  });
  try {
    const post = (payload) => app.inject({ method: "POST", url: "/api/builds/node-deltas", payload });
    const answer = await post({ ...BUILD, node_ids: ["10", 10, 11, "x"], analysis: { breakdown: ["Life"] }, calc_priority: "main" });
    assert.equal(answer.statusCode, 200, answer.body);
    assert.deepEqual(answer.json(), { ok: true, data: { base: { CombinedDPS: 1000, Life: 500 }, nodes: { 10: { allocated: false, node: { Life: 12 }, pathLength: 1 } } } });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /<PlannerNodeDeltas nodes="10,11"\/>\n<\/PathOfBuilding2>/, "ids deduplicated");
    assert.doesNotMatch(calls[0], /PlannerRequest/, "the client cannot ask for breakdowns here");
    assert.match(calls[0], /<Spec[^>]*nodes="1,2"/, "the build itself is unchanged");

    const again = await post({ ...BUILD, node_ids: [10, 11] });
    assert.equal(again.statusCode, 200);
    assert.equal(calls.length, 1, "same build and nodes: answered from the cache");
    await post({ ...BUILD, passives: [1, 2, 3], node_ids: [10, 11] });
    assert.equal(calls.length, 2, "another build is another run");

    assert.equal((await post({ ...BUILD })).statusCode, 400, "node_ids required");
    assert.equal((await post({ ...BUILD, node_ids: ["a", -1] })).statusCode, 400);
    assert.equal((await post({ ...BUILD, node_ids: Array.from({ length: 61 }, (_, i) => i + 1) })).statusCode, 400, "capped at 60");
    assert.equal((await post({ ...BUILD, node_ids: Array.from({ length: 60 }, (_, i) => i + 1) })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/builds/node-deltas", payload: "nope", headers: { "content-type": "text/plain" } })).statusCode >= 400, true);
  } finally {
    await app.close();
  }
});

test("node-deltas waits behind the build's own calculation and keeps a slot free", async () => {
  const gates = [];
  const started = [];
  const app = await fakeApp((xml) => new Promise((resolve) => {
    started.push(xml.includes("PlannerNodeDeltas") ? "nodes" : "main");
    gates.push(() => resolve({ Life: 1, NodeDeltas: {} }));
  }));
  const waitFor = async (n) => {
    const deadline = Date.now() + 3000;
    while (started.length < n) {
      if (Date.now() > deadline) throw new Error(`only ${started.length} of ${n} started`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  };
  try {
    const first = app.inject({ method: "POST", url: "/api/builds/node-deltas", payload: { ...BUILD, node_ids: [5] } });
    const second = app.inject({ method: "POST", url: "/api/builds/node-deltas", payload: { ...BUILD, node_ids: [6] } });
    await waitFor(1);
    assert.deepEqual(started, ["nodes"], "previews are comparisons: one at a time");
    const main = app.inject({ method: "POST", url: "/api/builds/calculate", payload: BUILD });
    await waitFor(2);
    assert.deepEqual(started, ["nodes", "main"], "the build's own calculation takes the free slot");
    gates[0]();
    await waitFor(3);
    gates[1]();
    gates[2]();
    for (const answer of await Promise.all([first, second, main])) assert.equal(answer.statusCode, 200, answer.body);
  } finally {
    await app.close();
  }
});

test("nodeDeltasXml: one element before the end, ids cleaned and capped, no breakdown", () => {
  const plainXml = buildPobXml({ className: "Witch" });
  assert.equal(nodeDeltasXml({ className: "Witch" }, []), plainXml);
  const xml = nodeDeltasXml({ className: "Witch", analysis: { breakdown: ["Life"] } }, ["3", 3, "x", -2, 4]);
  assert.equal(xml, plainXml.replace("</PathOfBuilding2>", '\t<PlannerNodeDeltas nodes="3,4"/>\n</PathOfBuilding2>'));
  assert.match(nodeDeltasXml({}, Array.from({ length: 80 }, (_, i) => i + 1)), /nodes="1,[\d,]*,59,60"\//);
});

test("nodeDeltasXml never asks PoB for Full DPS (the preview prices the main skill)", async () => {
  const [fixture] = readFixtures(["sorceress-stormweaver.json"]);
  const { body } = await plannerCalculationRequest(fixture.code);
  assert.match(buildPobXml(body), /includeInFullDPS="true"/, "the build's own calculation keeps Full DPS");
  assert.doesNotMatch(nodeDeltasXml(body, [1]), /includeInFullDPS/);
  assert.equal(nodeDeltasXml(body, [1]), nodeDeltasXml({ ...body, full_dps: true }, [1]), "the client cannot turn it back on");
});

test("runNodeDeltas keeps the preview stats and the per-node answers", async () => {
  assert.deepEqual(nodeDeltasFromOutput(null), { base: {}, nodes: {} });
  assert.deepEqual(nodeDeltasFromOutput({ Life: 3, NodeDeltas: [] }), { base: { Life: 3 }, nodes: {} });
  const data = await runNodeDeltas({ run: async () => ({ CombinedDPS: 7, Str: 20, Foo: 1, NodeDeltas: { 4: { allocated: true, node: {} } } }) }, "<xml/>");
  assert.deepEqual(data, { base: { CombinedDPS: 7, Str: 20 }, nodes: { 4: { allocated: true, node: {} } } });
  // The misc calculator's own base wins (MinionDPS included); older calculate.lua
  // copies only have the main output.
  assert.deepEqual(nodeDeltasFromOutput({ CombinedDPS: 9, Minion: { CombinedDPS: 8 }, NodeDeltaBase: { CombinedDPS: 0, MinionDPS: 500, Life: 1 } }).base, { CombinedDPS: 0, MinionDPS: 500, Life: 1 });
  assert.deepEqual(nodeDeltasFromOutput({ CombinedDPS: 9, Minion: { CombinedDPS: 8 } }).base, { CombinedDPS: 9, MinionDPS: 8 });
  // dkjson writes an empty Lua table as [].
  assert.deepEqual(nodeDeltasFromOutput({ NodeDeltas: { 5: { allocated: false, node: [], path: [], pathLength: 2 } } }).nodes, { 5: { allocated: false, node: {}, path: {}, pathLength: 2 } });
});

const TREE = (() => {
  const types = { 1: "small", 2: "small", 3: "notable", 4: "small", 5: "keystone", 6: "mastery", 7: "jewel", 8: "small" };
  const nodeById = new Map(Object.entries(types).map(([id, type]) => [id, { id, type }]));
  const edges = [[1, 2], [2, 4], [2, 3], [1, 5], [1, 6], [2, 7], [4, 8]].map(([from, to]) => ({ from: String(from), to: String(to) }));
  return { nodeById, edges };
})();

test("preview candidates: next to the tree, keystones and notables first", async () => {
  const { nodePreviewCandidates } = await loadSpaLib("nodePreview");
  assert.deepEqual(plain(nodePreviewCandidates(TREE, ["1", "2"], { includeAllocated: false })), ["5", "3", "4"], "mastery and jewel socket left out, 8 is not adjacent");
  assert.deepEqual(plain(nodePreviewCandidates(TREE, ["1", "2", "3"])), ["5", "4", "3", "1", "2"], "allocated ones last, notables first among them");
});

test("preview text in Vietnamese: DPS and EHP as a share of the build, the rest as numbers", async () => {
  const { formatNodeDelta } = await loadSpaLib("nodePreview");
  const lines = formatNodeDelta(
    { CombinedDPS: 42, Life: 35.2, FireResist: 8, ChaosResist: -4, TotalEHP: 100, Str: 0.1, Mana: -12 },
    { CombinedDPS: 1000, TotalEHP: 5000 },
    "vi"
  );
  assert.deepEqual(plain(lines.map((line) => line.text)), ["+4.2% DPS", "+35 máu", "−12 mana", "+8% kháng lửa", "−4% kháng hỗn loạn", "+2% máu hiệu dụng (EHP)"]);
  assert.deepEqual(plain(lines.map((line) => line.positive)), [true, true, false, true, false, true]);
  assert.deepEqual(plain(formatNodeDelta({ CombinedDPS: 250 }, { CombinedDPS: 0 }, "en").map((line) => line.text)), ["+250 DPS"], "no base: raw DPS");
  assert.deepEqual(plain(formatNodeDelta({ MinionDPS: -3402 }, { CombinedDPS: 0, MinionDPS: 245447 }, "vi").map((line) => line.text)), ["−1.4% DPS minion"], "summoners: the minion's DPS");
});

test("preview store: batches, urgent first, one batch at a time, cache per build", async () => {
  const { NodePreviewStore } = await loadSpaLib("nodePreview");
  const sent = [];
  const store = new NodePreviewStore((body, ids) => {
    const job = deferred();
    sent.push({ build: body.passives.join(","), ids: [...ids], job });
    return job.promise;
  }, { batchSize: 3 });
  const answer = (index) => {
    const { ids, build } = sent[index];
    sent[index].job.resolve({ base: { Life: 100 }, nodes: Object.fromEntries(ids.filter((id) => id !== "404").map((id) => [id, { allocated: false, node: { Life: Number(id) }, build }])) });
  };
  const buildA = { passives: [1, 2] };
  const buildB = { passives: [1, 2, 3] };

  store.want(["1"]);
  assert.equal(sent.length, 0, "no build yet: nothing to ask");
  store.setBuild(buildA);
  store.want(["10", "11", "12", "13", "404"]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].ids, ["10", "11", "12"], "first batch goes at once");
  assert.equal(store.get("13").status, "pending");
  store.want(["99"], { urgent: true });
  store.want(["11"], { urgent: true });
  answer(0);
  await flush();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].ids, ["99", "13", "404"], "the hovered node jumps the line; known ones are not asked again");
  assert.equal(store.get("10").status, "done");
  assert.deepEqual(plain(store.get("10").delta.node), { Life: 10 });
  assert.deepEqual(plain(store.get("10").base), { Life: 100 });

  // The build changes while a batch is in flight.
  store.setBuild({ ...buildB });
  assert.equal(store.get("10"), undefined, "another build starts empty");
  store.want(["10", "20"]);
  assert.equal(sent.length, 2, "one batch at a time");
  answer(1);
  await flush();
  assert.equal(sent.length, 3);
  assert.equal(sent[2].build, "1,2,3");
  assert.deepEqual(sent[2].ids, ["10", "20"]);
  answer(2);
  await flush();
  assert.equal(store.get("20").status, "done");

  // Back to the first build (a new but equal body): its answers are still there.
  store.setBuild({ passives: [1, 2] });
  assert.equal(store.get("10").status, "done");
  assert.equal(store.get("99").status, "done", "the batch that finished after the switch was kept for its build");
  assert.equal(store.get("404").status, "error", "a node PoB did not answer for");
  store.want(["404"]);
  assert.equal(sent.length, 4, "errors are asked again");
  sent[3].job.reject(new Error("busy"));
  await flush();
  assert.equal(store.get("404").error, "busy");

  // Paused while the build's own numbers are calculated.
  store.setPaused(true);
  store.want(["30"]);
  assert.equal(sent.length, 4);
  store.setPaused(false);
  assert.equal(sent.length, 5);
  assert.equal(store.buildKey.length > 0, true);
  store.setBuild(null);
  assert.equal(store.get("30"), undefined);
});

test("calculation fields that do not change the numbers do not change the cache key", async () => {
  const { nodePreviewBuildKey } = await loadSpaLib("nodePreview");
  assert.equal(nodePreviewBuildKey({ a: 1, calc_priority: "compare", node_ids: [1] }), nodePreviewBuildKey({ a: 1 }));
  assert.notEqual(nodePreviewBuildKey({ a: 1 }), nodePreviewBuildKey({ a: 2 }));
});

// This checkout's calculate.lua, not the one installed in pob-core (which may be older).
const runtime = (() => {
  const installed = pobRuntime();
  if (!installed.available) return installed;
  const script = join(tmpdir(), `node_preview_calculate_${process.pid}.lua`);
  writeFileSync(script, localCalculateScript(readFileSync(join(repoRoot, "scripts/pob-calculate.lua"), "utf8")));
  after(() => rmSync(script, { force: true }));
  return { ...installed, script };
})();
const STATS = ["CombinedDPS", "Life", "EnergyShield", "Mana", "Spirit", "Armour", "Evasion", "FireResist", "ColdResist", "LightningResist", "ChaosResist", "TotalEHP"];

test("node deltas equal full PoB calculations with and without the node", {
  skip: runtime.available ? false : "PoB not installed locally",
  timeout: 300_000
}, async () => {
  const raw = readFileSync(join(repoRoot, "public/data/passive-tree-data.js"), "utf8");
  const edges = JSON.parse(raw.slice(raw.indexOf("=") + 1).replace(/;\s*$/, "")).path_edges;
  const [fixture] = readFixtures(["mercenary-gemling.json"]);
  const { body } = await plannerCalculationRequest(fixture.code);
  const allocated = new Set(body.passives.map(String));
  // 47374 and 11882 sit next to the main tree; 32155 only next to weapon set 2;
  // 7847 is an allocated leaf.
  const add = ["47374", "11882", "32155"];
  const remove = "7847";
  for (const id of add) assert.ok(!allocated.has(id) && edges.some((e) => (e.from === id && allocated.has(e.to)) || (e.to === id && allocated.has(e.from))), `${id} is next to the tree`);
  assert.equal(edges.filter((e) => (e.from === remove && allocated.has(e.to)) || (e.to === remove && allocated.has(e.from))).length, 1, `${remove} is a leaf`);

  const batch = nodeDeltasFromOutput(await runPob(nodeDeltasXml(body, [...add, remove, "14254"]), runtime));
  const before = await runPob(buildPobXml(body), runtime);
  const fulls = await Promise.all([
    runPob(buildPobXml({ ...body, passives: [...body.passives, 47374] }), runtime),
    runPob(buildPobXml({ ...body, passives: [...body.passives, 11882] }), runtime),
    // PoB allocates a node reached through weapon set 2 nodes in that set.
    runPob(buildPobXml({ ...body, passives: [...body.passives, 32155], weapon_set_passives: { ...body.weapon_set_passives, 2: [...body.weapon_set_passives["2"], "32155"] } }), runtime),
    runPob(buildPobXml({ ...body, passives: body.passives.filter((id) => String(id) !== remove) }), runtime)
  ]);
  [...add, remove].forEach((id, index) => {
    const delta = batch.nodes[id];
    assert.ok(delta, `node ${id} answered`);
    assert.equal(delta.allocated, id === remove);
    let changed = 0;
    for (const stat of STATS) {
      const expected = (fulls[index][stat] ?? 0) - (before[stat] ?? 0);
      const got = delta.node[stat] ?? 0;
      if (expected) changed += 1;
      assert.ok(Math.abs(expected - got) <= Math.max(0.01, Math.abs(expected) * 1e-6), `${id} ${stat}: batch ${got}, full ${expected}`);
    }
    assert.ok(changed > 0, `${id} changes something`);
  });
  assert.equal(batch.nodes["32155"].weaponSet, 2);
  // 14254 sits next to weapon set 1 nodes only, and set 2 is the active one: taking
  // it in set 1 changes nothing now (PoB's own tooltip would price it as a main-tree node).
  assert.equal(batch.nodes["14254"].weaponSet, 1);
  assert.deepEqual(plain(batch.nodes["14254"].node), {});
  const inSet1 = await runPob(buildPobXml({ ...body, passives: [...body.passives, 14254], weapon_set_passives: { ...body.weapon_set_passives, 1: [...body.weapon_set_passives["1"], "14254"] } }), runtime);
  for (const stat of STATS) assert.ok(Math.abs((inSet1[stat] ?? 0) - (before[stat] ?? 0)) < 0.01, `14254 in set 1: ${stat} unchanged in a full run too`);
  assert.equal(batch.nodes["47374"].weaponSet, undefined);
});

// Every kind of node the tooltip can show, on more builds: a path of several nodes,
// a removal that cuts nodes off, an ascendancy notable that keeps unconnected nodes
// (Entwined Realities), weapon-set nodes, and a summoner's minion DPS. Each answer
// is compared with full PoB runs with and without the nodes it covers (pathIds).
const EDGE_CASES = [
  { file: "druid-oracle.json", ids: { 32905: "Entwined Realities: removing it drops the nodes it kept", 535: "cut node", 8273: "2 steps away" } },
  { file: "sorceress-stormweaver.json", ids: { 722: "cut node", 3567: "weapon set 1 node", 1104: "weapon set 2 node", 14294: "3 steps away", 16466: "next to weapon set 2 only" } },
  { file: "lich-minions.json", ids: { 95: "minion DPS", 2995: "ascendancy node", 2254: "allocated notable" } }
];
const DELTA_STATS = ["CombinedDPS", "MinionDPS", ...STATS.slice(1), "Str", "Dex", "Int"];
const statOf = (output, stat) => (stat === "MinionDPS" ? output.Minion?.CombinedDPS : output[stat]) ?? 0;

for (const { file, ids } of EDGE_CASES) {
  test(`node deltas match full PoB runs on ${file}: paths, cut nodes, ascendancy and weapon sets`, {
    skip: runtime.available ? false : "PoB not installed locally",
    timeout: 300_000
  }, async () => {
    const [fixture] = readFixtures([file]);
    const { body } = await plannerCalculationRequest(fixture.code);
    const batch = nodeDeltasFromOutput(await runPob(nodeDeltasXml(body, Object.keys(ids)), runtime));
    const before = await runPob(buildPobXml(body), runtime);
    for (const stat of DELTA_STATS) {
      if (batch.base[stat] !== undefined) assert.ok(Math.abs(batch.base[stat] - statOf(before, stat)) < 0.01, `base ${stat}`);
    }
    const bodyFor = (delta, id) => {
      const covered = new Set((delta.pathLength > 1 ? delta.pathIds : [Number(id)]).map(String));
      const drop = (list = []) => list.filter((nodeId) => !covered.has(String(nodeId)));
      if (delta.allocated) {
        return { ...body, passives: drop(body.passives), weapon_set_passives: { 1: drop(body.weapon_set_passives?.["1"]), 2: drop(body.weapon_set_passives?.["2"]) } };
      }
      const next = { ...body, passives: [...body.passives, ...[...covered].map(Number)] };
      if (delta.weaponSet) next.weapon_set_passives = { ...body.weapon_set_passives, [delta.weaponSet]: [...(body.weapon_set_passives?.[String(delta.weaponSet)] || []), ...covered] };
      return next;
    };
    const entries = Object.entries(ids);
    for (const [id] of entries) assert.ok(batch.nodes[id], `node ${id} answered`);
    const fulls = await Promise.all(entries.map(([id]) => runPob(buildPobXml(bodyFor(batch.nodes[id], id)), runtime)));
    entries.forEach(([id, label], index) => {
      const delta = batch.nodes[id];
      const shown = delta.pathLength > 1 ? delta.path : delta.node;
      if (delta.pathLength > 1) assert.equal(delta.pathIds.length, delta.pathLength, `${id} lists its path`);
      for (const stat of DELTA_STATS) {
        const expected = statOf(fulls[index], stat) - statOf(before, stat);
        const got = shown[stat] ?? 0;
        assert.ok(Math.abs(expected - got) <= Math.max(0.01, Math.abs(expected) * 1e-6), `${id} (${label}) ${stat}: batch ${got}, full ${expected}`);
      }
    });
    if (file === "druid-oracle.json") assert.ok(batch.nodes["32905"].pathLength > 1, "Entwined Realities takes the nodes it kept with it");
    if (file === "lich-minions.json") assert.ok(batch.nodes["95"].node.MinionDPS < 0, "minion DPS is priced");
  });
}

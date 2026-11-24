// Measures the local (WebAssembly) PoB engine under Node and, for comparison, the two
// server paths on the same machine: one PoB process per build (runPob) and the warm
// worker pool (src/server/pob-pool.mjs).
//
//   node scripts/bench-pob-local.mjs [--runs 10] [--no-server] [--json]
//
// Needs the bundle (npm run build:pob-web) and, for the server columns, a local PoB
// (POB_CORE_DIR, see scripts/check-pob-parity.mjs).
//
// What is timed:
//   - start: unpack (gunzip + split the bundle), VM start, PoB load (HeadlessWrapper + our script).
//   - calculations: `runs` calls of engine.calculate(xml) after one untimed call (warm);
//     the median, minimum and maximum. Three builds: an empty one, mercenary-gemling without
//     Full DPS, and the same with every <Skill> includeInFullDPS="true" (what the page sends).
//   - memory: process.memoryUsage() of a process that does nothing else, the WebAssembly
//     linear memory (the VM's whole heap; it only ever grows) and Lua's own count, after
//     loading and after 20 calculations that cycle through all fixtures.
import { pobRuntime, readFixtures, runPob } from "./check-pob-parity.mjs";
import { plannerCalculationRequest } from "./lib/planner-node.mjs";
import { findLocalBundle, startLocalEngine } from "./lib/pob-local-node.mjs";
import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { createPobPool } from "../src/server/pob-pool.mjs";

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf("--runs") + 1]) > 0 && args.includes("--runs") ? Number(args[args.indexOf("--runs") + 1]) : 10;
const withServer = !args.includes("--no-server");
const asJson = args.includes("--json");

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const summary = (values) => ({ median: Math.round(median(values)), min: Math.round(Math.min(...values)), max: Math.round(Math.max(...values)) });
const mb = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

async function time(fn) {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

async function timed(fn) {
  await fn(); // warm
  const values = [];
  for (let index = 0; index < runs; index += 1) values.push(await time(fn));
  return summary(values);
}

function memory(engine) {
  globalThis.gc?.();
  const usage = process.memoryUsage();
  const lua = engine.getMemoryStats({ gc: true });
  return {
    rssMb: mb(usage.rss),
    heapUsedMb: mb(usage.heapUsed),
    externalMb: mb(usage.external),
    arrayBuffersMb: mb(usage.arrayBuffers),
    wasmMemoryMb: lua.wasmMemoryBytes == null ? null : mb(lua.wasmMemoryBytes),
    luaMb: mb(lua.luaMemoryKB * 1024)
  };
}

const bundle = findLocalBundle();
if (!bundle) {
  console.error("PoB web bundle not built: npm run build:pob-web");
  process.exit(1);
}

const fixtures = readFixtures();
const full = fixtures.find((row) => row.file === "mercenary-gemling.json") ?? fixtures[0];
const { body } = await plannerCalculationRequest(full.code);
const cases = [
  ["empty build", buildPobXml({ class_name: "Warrior", level: 1, passives: [], skills: [], inventory_slots: [] })],
  [`${full.file} (no Full DPS)`, buildPobXml({ ...body, full_dps: false })],
  [`${full.file} (every group in Full DPS)`, buildPobXml(body)]
];
const mixed = [];
for (const fixture of fixtures) mixed.push(buildPobXml((await plannerCalculationRequest(fixture.code)).body));

const report = { runs, node: process.version, bundle: bundle.manifest, local: {}, server: {} };

const baseline = process.memoryUsage();
const startMs = await time(async () => { report.engine = await startLocalEngine(bundle); });
const engine = report.engine;
delete report.engine;
report.local.start = {
  totalMs: Math.round(startMs),
  unpackMs: Math.round(engine.timings.unpackMs),
  vmInitMs: Math.round(engine.timings.vmInitMs),
  pobLoadMs: Math.round(engine.timings.pobLoadMs)
};
report.local.memoryBeforeMb = { rssMb: mb(baseline.rss), heapUsedMb: mb(baseline.heapUsed) };
report.local.memoryAfterLoad = memory(engine);
report.local.calc = {};
for (const [label, xml] of cases) report.local.calc[label] = await timed(() => engine.calculate(xml));
report.local.memoryAfterTimedRuns = memory(engine);
const mixedTimes = [];
for (let index = 0; index < 20; index += 1) mixedTimes.push(await time(() => engine.calculate(mixed[index % mixed.length])));
report.local.mixed20 = summary(mixedTimes);
report.local.memoryAfter20Mixed = memory(engine);
// Does it keep growing? 60 more.
for (let index = 0; index < 60; index += 1) engine.calculate(mixed[index % mixed.length]);
report.local.memoryAfter80Mixed = memory(engine);
engine.close();

if (withServer) {
  const runtime = pobRuntime();
  if (!runtime.available) {
    report.server.skipped = "PoB is not installed locally";
  } else {
    report.server.oneShot = {};
    for (const [label, xml] of cases) report.server.oneShot[label] = await timed(() => runPob(xml, runtime));
    const pool = createPobPool({ coreDir: runtime.coreDir, luajit: runtime.luajit, script: runtime.script, workers: 1 });
    try {
      report.server.poolStartMs = Math.round(await time(() => pool.run(cases[0][1])));
      report.server.pool = {};
      for (const [label, xml] of cases) report.server.pool[label] = await timed(() => pool.run(xml));
      const poolMixed = [];
      for (let index = 0; index < 20; index += 1) poolMixed.push(await time(() => pool.run(mixed[index % mixed.length])));
      report.server.poolMixed20 = summary(poolMixed);
      report.server.poolWorker = pool.health().workers.map((worker) => ({ rssMb: worker.rssMb, luaMemMb: worker.luaMemMb, jobs: worker.jobs }));
    } finally {
      await pool.close();
    }
  }
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const { manifest } = bundle;
  console.log(`Bundle ${manifest.version}: ${manifest.fileCount} files, raw ${mb(manifest.rawBytes)} MB, gzip ${mb(manifest.totalGzipDownloadBytes)} MB, brotli ${mb(manifest.totalBrotliDownloadBytes)} MB (data + wasm)`);
  console.log(`Local engine start: ${JSON.stringify(report.local.start)}`);
  console.log(`Memory after load:        ${JSON.stringify(report.local.memoryAfterLoad)}`);
  console.log(`Memory after timed runs:  ${JSON.stringify(report.local.memoryAfterTimedRuns)}`);
  console.log(`Memory after 20 mixed:    ${JSON.stringify(report.local.memoryAfter20Mixed)}`);
  console.log(`Memory after 80 mixed:    ${JSON.stringify(report.local.memoryAfter80Mixed)}`);
  console.log(`\nCalculation time, ms (median of ${runs}, warm; min-max):`);
  const cell = (row) => (row ? `${row.median} (${row.min}-${row.max})` : "-");
  for (const [label] of cases) {
    console.log(`  ${label}\n    local ${cell(report.local.calc[label])} | server one-shot ${cell(report.server.oneShot?.[label])} | server pool ${cell(report.server.pool?.[label])}`);
  }
  console.log(`  20 mixed fixtures\n    local ${cell(report.local.mixed20)} | server pool ${cell(report.server.poolMixed20)}`);
  if (report.server.poolWorker) console.log(`Server pool worker: first request (start + load) ${report.server.poolStartMs} ms, ${JSON.stringify(report.server.poolWorker)}`);
  if (report.server.skipped) console.log(`Server: ${report.server.skipped}`);
}

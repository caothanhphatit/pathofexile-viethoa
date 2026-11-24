// Local (in-browser) PoB engine ↔ server PoB parity.
//
// The engine the planner's Web Worker runs (src/shared/pob-local-engine.mjs: PoB on Lua 5.4
// in WebAssembly) is started here under Node from the same bundle the browser downloads
// (public/pob-web, `npm run build:pob-web`), and every fixture build is calculated both
// ways: by the server path (LuaJIT, one process per build: runPob) and by the local engine.
// The two JSON results must be equal: every stat, GroupDPS, GemOptions, breakdowns
// (see scripts/lib/pob-result-diff.mjs for the one float tolerance and its reason).
//
// Skipped when PoB or the bundle is not on this machine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { nodeDeltasXml } from "../src/server/pob-node-deltas.mjs";
import { pobRuntime, readFixtures, runPob } from "../scripts/check-pob-parity.mjs";
import { plannerCalculationRequest, repoRoot } from "../scripts/lib/planner-node.mjs";
import { findLocalBundle, startLocalEngine } from "../scripts/lib/pob-local-node.mjs";
import { compareResults } from "../scripts/lib/pob-result-diff.mjs";
import { buildPersistentCalculateScript } from "../src/shared/pob-local-engine.mjs";
import { unpackPobVfs } from "../src/shared/pob-local-vfs.mjs";

const fixtures = readFixtures();
const runtime = pobRuntime();
const bundle = findLocalBundle();
const skip = !runtime.available ? "PoB is not installed locally" : !bundle ? "PoB web bundle not built (npm run build:pob-web)" : false;

const EMPTY_BUILD = { class_name: "Warrior", level: 1, passives: [], skills: [], inventory_slots: [] };

let enginePromise;
const engine = () => (enginePromise ??= startLocalEngine(bundle));
test.after(async () => { if (enginePromise) (await enginePromise).close(); });

// One server run per distinct XML (a one-shot PoB process takes ~2.5 s).
const serverCache = new Map();
const server = (xml) => {
  if (!serverCache.has(xml)) serverCache.set(xml, runPob(xml, runtime));
  return serverCache.get(xml);
};

function assertSame(label, serverResult, localResult) {
  const diff = compareResults(serverResult, localResult);
  const shown = diff.mismatches.slice(0, 12).map((row) => `  ${row.path}: server=${JSON.stringify(row.a)} local=${JSON.stringify(row.b)}`).join("\n");
  assert.equal(diff.mismatches.length, 0, `${label}: ${diff.mismatches.length} of ${diff.compared} values differ (max relative difference ${diff.maxRel}):\n${shown}`);
  assert.ok(diff.compared > 100, `${label}: only ${diff.compared} values compared`);
  return diff;
}

test("the local runner is cut from the current scripts/pob-calculate.lua", () => {
  const source = readFileSync(join(repoRoot, "scripts", "pob-calculate.lua"), "utf8");
  const runner = buildPersistentCalculateScript(source);
  assert.match(runner, /local function calculateBuild\(xmlText\)/);
  assert.match(runner, /function pobCalculateXml\(xmlText\)/);
  // Neither the CLI tail nor the stdin worker loop may come along.
  assert.doesNotMatch(runner, /os\.exit\(/);
  assert.doesNotMatch(runner, /io\.stdin/);
  assert.equal(runner.includes('dofile("HeadlessWrapper.lua")'), false);
  assert.throws(() => buildPersistentCalculateScript("print('something else')"), /changed shape/);
});

test("the bundle carries the current calculate script and PoB's licence", { skip: !bundle && "PoB web bundle not built (npm run build:pob-web)" }, () => {
  const vfs = unpackPobVfs(gunzipSync(readFileSync(bundle.vfsPath)));
  assert.equal(
    vfs.get("__planner_calculate.lua"),
    readFileSync(join(repoRoot, "scripts", "pob-calculate.lua"), "utf8"),
    "public/pob-web is stale: run npm run build:pob-web"
  );
  assert.match(readFileSync(join(bundle.dir, "LICENSE.md"), "utf8"), /MIT/);
});

for (const fixture of fixtures) {
  test(`local engine equals the server result: ${fixture.name}`, { skip }, async (t) => {
    const { body, xml } = await plannerCalculationRequest(fixture.code);
    const local = await engine();
    // 1. what the page sends (every group in Full DPS, so GroupDPS is filled),
    // 2. the what-if variant (no Full DPS),
    // 3. the PoB code's own XML (item sets and configs the planner does not write).
    const cases = [
      ["planner XML", buildPobXml(body)],
      ["planner XML without Full DPS", buildPobXml({ ...body, full_dps: false })],
      ["PoB code XML", xml]
    ];
    const pending = cases.map(([, caseXml]) => server(caseXml));
    const notes = [];
    for (const [index, [label, caseXml]] of cases.entries()) {
      const serverResult = await pending[index];
      if (index === 0) {
        assert.ok(serverResult.GemOptions && Object.keys(serverResult.GemOptions).length, "GemOptions is part of the comparison");
        assert.ok(serverResult.GroupDPS && Object.keys(serverResult.GroupDPS).length, "GroupDPS is part of the comparison");
      }
      const diff = assertSame(`${fixture.file} ${label}`, serverResult, local.calculate(caseXml));
      notes.push(`${label}: ${diff.compared} values, max rel diff ${diff.maxRel}`);
    }
    t.diagnostic(`${fixture.file} | ${notes.join(" | ")}`);
  });
}

test("local engine equals the server for an empty build and for node previews", { skip }, async () => {
  const local = await engine();
  const emptyXml = buildPobXml(EMPTY_BUILD);
  assertSame("empty build", await server(emptyXml), local.calculate(emptyXml));

  // Price a few unallocated nodes (ids from another fixture's tree) and two allocated ones.
  const { body } = await plannerCalculationRequest(fixtures[0].code);
  const other = await plannerCalculationRequest(fixtures[fixtures.length - 1].code);
  const allocated = new Set((body.passives || []).map(String));
  const ids = [...(other.body.passives || []).map(String).filter((id) => !allocated.has(id)).slice(0, 6), ...[...allocated].slice(0, 2)];
  const deltasXml = nodeDeltasXml(body, ids);
  const serverResult = await server(deltasXml);
  assert.ok(serverResult.NodeDeltas && Object.keys(serverResult.NodeDeltas).length > 0, "the server priced the nodes");
  // Known difference: when several routes to a node are equally short, PoB takes the first
  // one its tree walk meets, and that order comes from Lua table iteration, which is not the
  // same in LuaJIT and Lua 5.4. The route (pathIds) may differ; its length and every priced
  // number (node and path deltas) must not.
  const localResult = local.calculate(deltasXml);
  const withoutRoutes = (result) => ({
    ...result,
    NodeDeltas: Object.fromEntries(Object.entries(result.NodeDeltas).map(([id, row]) => [id, { ...row, pathIds: (row.pathIds || []).length }]))
  });
  assertSame("node deltas", withoutRoutes(serverResult), withoutRoutes(localResult));
});

test("builds calculated one after the other in one engine do not leak into each other", { skip }, async () => {
  const local = await engine();
  const pick = ["mercenary-gemling.json", "lich-minions.json", "druid-oracle.json"].map((file) => fixtures.find((row) => row.file === file) ?? fixtures[0]);
  const xmls = [];
  for (const fixture of pick) xmls.push(buildPobXml((await plannerCalculationRequest(fixture.code)).body));
  const emptyXml = buildPobXml(EMPTY_BUILD);
  // A, B, empty, A, C, B: each must equal a fresh one-shot server run of the same XML.
  const order = [xmls[0], xmls[1], emptyXml, xmls[0], xmls[2], xmls[1]];
  for (const [index, xml] of order.entries()) {
    assertSame(`step ${index + 1}`, await server(xml), local.calculate(xml));
  }
  // Nothing of a finished build may stay alive: the heap after a full collection must not
  // grow from one build to the next. (Without the copyTableSafe shim of the engine it
  // doubled per build in about one VM out of five; see src/shared/pob-local-engine.mjs.)
  local.calculate(xmls[0]);
  const before = local.getMemoryStats({ gc: true }).luaMemoryKB;
  for (let round = 0; round < 4; round += 1) for (const xml of xmls) local.calculate(xml);
  local.calculate(xmls[0]);
  const after = local.getMemoryStats({ gc: true }).luaMemoryKB;
  assert.ok(after - before < 20 * 1024, `Lua heap grew by ${Math.round((after - before) / 1024)} MB over 13 builds`);

  // A build PoB rejects must not poison the engine either.
  assert.throws(() => local.calculate("<NotABuild/>"), (error) => error.fatal !== true);
  assertSame("after a rejected build", await server(xmls[1]), local.calculate(xmls[1]));
});

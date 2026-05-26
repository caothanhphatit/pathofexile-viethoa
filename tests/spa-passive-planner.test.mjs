import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function loadPlanner() {
  const source = await readFile(join(repoRoot, "src/spa/passive/planner.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  const sandbox = { module: { exports: {} }, exports: {} };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox);
  return sandbox.module.exports;
}

function fixtureTree() {
  const nodes = [
    { id: "A", classNames: ["Ranger"], ascendancyName: "", isClassStart: true, isAscendancyStart: false },
    { id: "B", classNames: [], ascendancyName: "", isClassStart: false, isAscendancyStart: false },
    { id: "C", classNames: [], ascendancyName: "", isClassStart: false, isAscendancyStart: false },
    { id: "D", classNames: [], ascendancyName: "", isClassStart: false, isAscendancyStart: false },
    { id: "S", classNames: [], ascendancyName: "Deadeye", isClassStart: false, isAscendancyStart: true },
    { id: "E", classNames: [], ascendancyName: "Deadeye", isClassStart: false, isAscendancyStart: false }
  ];
  return {
    nodes,
    edges: [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "B", to: "D" },
      { from: "S", to: "E" },
      { from: "A", to: "S" }
    ],
    nodeById: new Map(nodes.map((node) => [node.id, node]))
  };
}

const plain = (value) => JSON.parse(JSON.stringify([...value]));

test("React passive planner seeds class and ascendancy start nodes", async () => {
  const planner = await loadPlanner();
  const tree = fixtureTree();

  const starts = planner.selectedStartNodeIds(tree, "Ranger", "Deadeye");
  const allocated = planner.syncSelectedStartNodeIds(new Set(), starts, planner.allStartNodeIds(tree));

  assert.deepEqual(plain(starts), ["A", "S"]);
  assert.deepEqual(plain(allocated), ["A", "S"]);
});

test("React passive planner allocates shortest paths from selected gateways", async () => {
  const planner = await loadPlanner();
  const tree = fixtureTree();
  const graphByNodeId = planner.buildPassiveGraph(tree);
  const visibleNodeIds = new Set(["A", "B", "C", "D", "S", "E"]);
  const startNodeIds = new Set(["A", "S"]);

  let allocated = new Set(["A", "S"]);
  allocated = planner.allocatePathToNode({
    targetId: "C",
    allocatedIds: allocated,
    startNodeIds,
    graphByNodeId,
    visibleNodeIds
  });
  allocated = planner.allocatePathToNode({
    targetId: "D",
    allocatedIds: allocated,
    startNodeIds,
    graphByNodeId,
    visibleNodeIds
  });

  assert.deepEqual(plain(allocated), ["A", "S", "B", "C", "D"]);
});

test("React passive planner refunds a clicked branch while preserving gateways", async () => {
  const planner = await loadPlanner();
  const tree = fixtureTree();
  const graphByNodeId = planner.buildPassiveGraph(tree);

  const refunded = planner.refundAllocatedNodeIds({
    targetId: "B",
    allocatedIds: new Set(["A", "S", "B", "C", "D"]),
    startNodeIds: new Set(["A", "S"]),
    graphByNodeId,
    visibleNodeIds: new Set(["A", "B", "C", "D", "S", "E"])
  });

  assert.deepEqual(plain(refunded), ["A", "S"]);
});

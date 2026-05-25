import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../public/components/passive-tree-planner.js", import.meta.url), "utf8");

const loadPlanner = () => {
  const sandbox = {
    window: {},
    TextDecoder,
    TextEncoder,
    atob,
    btoa,
    URL,
    URLSearchParams
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.PoePassiveTreePlanner;
};

const plain = (value) => JSON.parse(JSON.stringify(value));

test("passive planner state encodes and decodes PoB-like build selections", () => {
  const planner = loadPlanner();
  const code = planner.encodePassiveBuildState({
    className: "Witch",
    ascendancyName: "Blood Mage",
    nodeIds: ["59822", "54447", "61001", "59822"],
    freeStartNodeIds: ["54447"],
    selectedNodeId: "61001",
    version: "0_4"
  });

  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(plain(planner.decodePassiveBuildState(code)), {
    className: "Witch",
    ascendancyName: "Blood Mage",
    nodeIds: ["59822", "61001"],
    selectedNodeId: "61001",
    version: "0_4"
  });
});

test("passive planner state filters allocated nodes down to portable build nodes", () => {
  const planner = loadPlanner();

  assert.deepEqual(
    plain(planner.allocatedBuildNodeIds(new Set(["9", "1", "2", "1"]), new Set(["2"]))),
    ["1", "9"]
  );
});

test("passive planner summary counts passive and ascendancy nodes with high impact picks first", () => {
  const planner = loadPlanner();
  const nodesById = new Map([
    ["1", { id: "1", type: "small", name: "Small", stats: ["5% increased Damage"] }],
    ["2", { id: "2", type: "notable", name: "Notable", stats: ["20% increased Damage"] }],
    ["3", { id: "3", type: "keystone", name: "Keystone", stats: ["You have no Energy Shield"] }],
    ["4", { id: "4", type: "ascendancy_notable", ascendancy_name: "Blood Mage", name: "Sanguimancy", stats: ["Grants Skill: Life Remnants"] }],
    ["5", { id: "5", type: "ascendancy", ascendancy_name: "Blood Mage", name: "Asc Start", stats: [] }]
  ]);

  const summary = planner.summarizeAllocatedNodes({
    nodeIds: ["1", "2", "3", "4", "5"],
    nodesById,
    freeStartNodeIds: ["5"],
    maxImportant: 3
  });

  assert.equal(summary.passivePoints, 3);
  assert.equal(summary.ascendancyPoints, 1);
  assert.equal(summary.typeCounts.small, 1);
  assert.deepEqual(plain(summary.importantNodes.map((node) => node.id)), ["3", "4", "2"]);
  assert.equal(summary.statGroups[0].label, "Damage");
  assert.deepEqual(plain(summary.statGroups[0].lines), ["5% increased Damage", "20% increased Damage"]);
});

test("passive planner refunds an allocated branch from the clicked path node", () => {
  const planner = loadPlanner();
  const graphByNodeId = new Map([
    ["A", ["B"]],
    ["B", ["A", "C", "E"]],
    ["C", ["B", "D"]],
    ["D", ["C"]],
    ["E", ["B"]]
  ]);

  assert.deepEqual(
    plain([...planner.refundAllocatedNodeIds({
      targetId: "C",
      allocatedNodeIds: ["A", "B", "C", "D", "E"],
      startNodeIds: ["A"],
      graphByNodeId,
      visibleNodeIds: ["A", "B", "C", "D", "E"]
    })]),
    ["A", "B", "E"]
  );

  assert.deepEqual(
    plain([...planner.refundAllocatedNodeIds({
      targetId: "B",
      allocatedNodeIds: ["A", "B", "C", "D", "E"],
      startNodeIds: ["A"],
      graphByNodeId,
      visibleNodeIds: ["A", "B", "C", "D", "E"]
    })]),
    ["A"]
  );
});

test("passive planner projects selected ascendancy nodes into the class center disc", () => {
  const planner = loadPlanner();
  const nodes = [
    { id: "54447", name: "WITCH", x: 0, y: -1490.58 },
    { id: "40721", name: "Stormweaver", ascendancy_name: "Stormweaver", x: 0, y: -16868.7651 },
    { id: "22147", name: "Chronomancer", ascendancy_name: "Chronomancer", x: 3230.2751, y: -16529.2495 }
  ];

  const projected = planner.projectAscendancyNodesToClassDisc({
    nodes,
    ascendancyName: "Stormweaver",
    ascendancyMeta: {
      classRow: { background: { x: 0, y: 0 } },
      ascendancy: { name: "Stormweaver", background: { x: 0, y: -15536.7651 } }
    }
  });

  assert.equal(projected[0], nodes[0]);
  assert.notEqual(projected[1], nodes[1]);
  assert.equal(projected[1].x, 0);
  assert.equal(projected[1].y, -1332);
  assert.equal(projected[2], nodes[2]);
});

test("passive planner projects selected ascendancy group centers with the same offset as nodes", () => {
  const planner = loadPlanner();
  const group = { id: "501", x: 0, y: -15546.7651 };
  const ascendancyMeta = {
    classRow: { background: { x: 0, y: 0 } },
    ascendancy: { name: "Stormweaver", background: { x: 0, y: -15536.7651 } }
  };

  const projected = planner.projectAscendancyMapPointToClassDisc({
    point: group,
    ascendancyName: "Stormweaver",
    pointAscendancyName: "Stormweaver",
    ascendancyMeta
  });

  assert.notEqual(projected, group);
  assert.equal(projected.x, 0);
  assert.equal(projected.y, -10);
  assert.equal(planner.projectAscendancyMapPointToClassDisc({
    point: group,
    ascendancyName: "Stormweaver",
    pointAscendancyName: "Chronomancer",
    ascendancyMeta
  }), group);
});

test("passive planner skips drawing connectors across ascendancy layers", () => {
  const planner = loadPlanner();
  const baseStart = { id: "54447", name: "WITCH", is_class_start: true, x: 0, y: -1490.58 };
  const basePassive = { id: "100", name: "Spell Damage", x: 280, y: -1490.58 };
  const stormStart = { id: "40721", name: "Stormweaver", ascendancy_name: "Stormweaver", x: 0, y: -1332 };
  const stormPassive = { id: "40722", name: "Tempest", ascendancy_name: "Stormweaver", x: 220, y: -1332 };
  const chronoPassive = { id: "22147", name: "Chronomancer", ascendancy_name: "Chronomancer", x: 3230.2751, y: -992.4844 };

  assert.equal(planner.shouldDrawTreeConnection(baseStart, basePassive, { maxDistance: 4200 }), true);
  assert.equal(planner.shouldDrawTreeConnection(stormStart, stormPassive), true);
  assert.equal(planner.shouldDrawTreeConnection(baseStart, stormStart), false);
  assert.equal(planner.shouldDrawTreeConnection(stormPassive, chronoPassive), false);
});

test("passive planner keeps the base tree visible in selected ascendancy views", () => {
  const planner = loadPlanner();
  const baseNode = { id: "1", type: "small", name: "Energy Shield" };
  const stormNode = { id: "2", type: "ascendancy_notable", ascendancy_name: "Stormweaver", name: "Shaper of Storms" };
  const chronoNode = { id: "3", type: "ascendancy_notable", ascendancy_name: "Chronomancer", name: "Apex of the Moment" };

  assert.equal(planner.shouldShowPassiveTreeNode(baseNode, { ascendancyName: "" }), true);
  assert.equal(planner.shouldShowPassiveTreeNode(stormNode, { ascendancyName: "" }), false);
  assert.equal(planner.shouldShowPassiveTreeNode(baseNode, { ascendancyName: "Stormweaver" }), true);
  assert.equal(planner.shouldShowPassiveTreeNode(stormNode, { ascendancyName: "Stormweaver" }), true);
  assert.equal(planner.shouldShowPassiveTreeNode(chronoNode, { ascendancyName: "Stormweaver" }), false);
});

test("passive planner hides class start nodes outside the selected class", () => {
  const planner = loadPlanner();
  const sorceressStart = { id: "54447", type: "small", is_class_start: true, classes_start: ["Witch", "Sorceress"] };
  const monkStart = { id: "44683", type: "small", is_class_start: true, classes_start: ["Shadow", "Monk"] };
  const baseNode = { id: "1", type: "small", name: "Energy Shield" };

  assert.equal(planner.shouldShowPassiveTreeNode(sorceressStart, { className: "Sorceress" }), true);
  assert.equal(planner.shouldShowPassiveTreeNode(monkStart, { className: "Sorceress" }), false);
  assert.equal(planner.shouldShowPassiveTreeNode(baseNode, { className: "Sorceress" }), true);
  assert.equal(planner.shouldShowPassiveTreeNode(monkStart, { className: "" }), true);
});

test("passive planner projects class start nodes onto the drawn class disc stroke", () => {
  const planner = loadPlanner();
  const background = { x: 0, y: 0, width: 1500, height: 1500, active: { width: 2000, height: 2000 } };
  const node = { id: "61525", x: -1245.18, y: -728.9, is_class_start: true, classes_start: ["Templar", "Druid"] };

  const projected = planner.projectClassStartNodeToClassDisc({ node, classBackground: background });
  const targetRadius = planner.passiveTreeClassDiscStrokeRadius(background);

  assert.notEqual(projected, node);
  assert.equal(Number(Math.hypot(projected.x, projected.y).toFixed(4)), targetRadius);
  assert.equal(planner.projectClassStartNodeToClassDisc({ node: { id: "1", x: 10, y: 20 }, classBackground: background }).x, 10);
});

test("passive planner keeps search separate from map visibility filters", () => {
  const planner = loadPlanner();
  const baseNode = { id: "1", type: "small", name: "Energy Shield" };

  assert.equal(planner.shouldShowPassiveTreeNode(baseNode, { query: "speed", queryMatches: false }), true);
  assert.equal(planner.shouldShowPassiveTreeNode(baseNode, { type: "notable", query: "shield", queryMatches: true }), false);
});

test("passive planner uses PoB orbit sign to place arc connector centers", () => {
  const planner = loadPlanner();
  const fromNode = { id: "a", x: 0, y: 0 };
  const toNode = { id: "b", x: 6, y: 0 };

  assert.deepEqual(plain(planner.passiveTreeConnectionArcCenter({
    fromNode,
    toNode,
    orbit: 1,
    orbitRadii: [0, 5]
  })), { x: 3, y: -4, radius: 5 });

  assert.deepEqual(plain(planner.passiveTreeConnectionArcCenter({
    fromNode,
    toNode,
    orbit: -1,
    orbitRadii: [0, 5]
  })), { x: 3, y: 4, radius: 5 });
});

test("passive planner builds PoB connector geometry for same-orbit and explicit-orbit arcs", () => {
  const planner = loadPlanner();
  const orbitRadii = [0, 82, 162];
  const left = { id: "left", x: -82, y: 0, group: "10", orbit: 1, arc: Math.PI * 1.5 };
  const top = { id: "top", x: 0, y: -82, group: "10", orbit: 1, arc: 0 };
  const right = { id: "right", x: 6, y: 0, group: "11", orbit: 0, arc: 0 };

  assert.deepEqual(plain(planner.passiveTreeConnectorGeometry({
    edge: { fromNode: left, toNode: top, orbit: 0 },
    groupCenter: { x: 0, y: 0 },
    orbitRadii
  })), {
    kind: "arc",
    center: { x: 0, y: 0 },
    radius: 82
  });

  assert.deepEqual(plain(planner.passiveTreeConnectorGeometry({
    edge: { fromNode: { id: "a", x: 0, y: 0 }, toNode: right, orbit: 1 },
    orbitRadii: [0, 5]
  })), {
    kind: "arc",
    center: { x: 3, y: -4 },
    radius: 5
  });
});

test("passive planner spatial index queries padded viewport candidates in draw order", () => {
  const planner = loadPlanner();
  const nodes = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 260, y: 0 },
    { id: "c", x: 130, y: 130 },
    { id: "d", x: -400, y: -400 }
  ];
  const index = planner.buildPassiveSpatialIndex(nodes, { cellSize: 128 });

  assert.deepEqual(
    plain(planner.queryPassiveSpatialIndex(index, { x: 0, y: 0, width: 140, height: 140 }).map((node) => node.id)),
    ["a", "c"]
  );
  assert.deepEqual(
    plain(planner.queryPassiveSpatialIndex(index, { x: 0, y: 0, width: 140, height: 140, padding: 130 }).map((node) => node.id)),
    ["a", "b", "c"]
  );
});

test("passive planner rect spatial index queries viewport edge candidates once", () => {
  const planner = loadPlanner();
  const edges = [
    { id: "near", bounds: { x: 0, y: 0, width: 80, height: 80 } },
    { id: "wide", bounds: { x: -220, y: 40, width: 520, height: 40 } },
    { id: "far", bounds: { x: 620, y: 0, width: 80, height: 80 } }
  ];
  const index = planner.buildPassiveRectSpatialIndex(edges, {
    cellSize: 128,
    getBounds: (edge) => edge.bounds
  });

  assert.deepEqual(
    plain(planner.queryPassiveRectSpatialIndex(index, { x: 0, y: 0, width: 160, height: 160 }).map((edge) => edge.id)),
    ["near", "wide"]
  );
  assert.deepEqual(
    plain(planner.queryPassiveRectSpatialIndex(index, { x: 500, y: 0, width: 40, height: 160, padding: 100 }).map((edge) => edge.id)),
    ["far"]
  );
});

test("passive planner clamps map view to soft content bounds", () => {
  const planner = loadPlanner();
  const bounds = { x: 0, y: 0, width: 1000, height: 500 };

  assert.deepEqual(plain(planner.clampPassiveMapView({
    x: -9999,
    y: -9999,
    width: 500,
    height: 250
  }, bounds, { overscrollRatio: 0.2 })), {
    x: -100,
    y: -50,
    width: 500,
    height: 250
  });

  assert.deepEqual(plain(planner.clampPassiveMapView({
    x: 9999,
    y: 9999,
    width: 500,
    height: 250
  }, bounds, { overscrollRatio: 0.2 })), {
    x: 600,
    y: 300,
    width: 500,
    height: 250
  });

  assert.deepEqual(plain(planner.clampPassiveMapView({
    x: -9999,
    y: -9999,
    width: 2200,
    height: 1100
  }, bounds, { overscrollRatio: 0.1, maxWidth: 1200 })), {
    x: -220,
    y: -110,
    width: 1200,
    height: 600
  });
});

test("passive planner treats tree background dimensions as PoB half extents", () => {
  const planner = loadPlanner();

  assert.equal(planner.passiveTreeBackgroundRadius({
    width: 1500,
    height: 1500,
    active: { width: 2000, height: 2000 },
    bg: { width: 2000, height: 2000 }
  }), 2000);

  assert.equal(planner.passiveTreeBackgroundRadius({
    width: 1500,
    height: 1500
  }), 1500);
});

test("passive planner share url preserves clean path and stores build code", () => {
  const planner = loadPlanner();
  const url = planner.buildPassiveShareUrl({
    location: "https://poeviethoa.net/passive-tree?q=life&type=notable",
    state: {
      className: "Witch",
      ascendancyName: "Blood Mage",
      nodeIds: ["61001"]
    }
  });

  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/passive-tree");
  assert.equal(parsed.searchParams.get("class"), "Witch");
  assert.equal(parsed.searchParams.get("ascendancy"), "Blood Mage");
  assert.ok(parsed.searchParams.get("build"));
  assert.equal(parsed.searchParams.has("q"), false);
  assert.equal(parsed.searchParams.has("type"), false);
});

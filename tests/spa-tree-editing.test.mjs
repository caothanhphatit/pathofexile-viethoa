// Passive tree editing in the Build Planner: weapon-set passives, attribute picks
// and jewels in tree sockets (src/spa/passive/planner.ts, src/spa/lib/*.ts).
import assert from "node:assert/strict";
import { readFile, readFile as read } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { loadPlannerLib, loadSpaLib, repoRoot } from "../scripts/lib/planner-node.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));

async function loadTs(file) {
  const source = await readFile(join(repoRoot, file), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const sandbox = { module: { exports: {} }, require: () => ({}) };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(js, sandbox);
  return sandbox.module.exports;
}

// A - B - C - D        (A: class start)
//     |   '- G
//     E (keystone)  B - F
const GRAPH = new Map(Object.entries({ A: ["B"], B: ["A", "C", "E", "F"], C: ["B", "D", "G"], D: ["C"], E: ["B"], F: ["B"], G: ["C"] }));
const VISIBLE = [...GRAPH.keys()];
const mainOnly = (id) => id === "E";
const base = { startNodeIds: ["A"], graphByNodeId: GRAPH, visibleNodeIds: VISIBLE, isMainTreeOnly: mainOnly };

test("weapon sets: new nodes join the selected set, keystones stay on the main tree", async () => {
  const planner = await loadTs("src/spa/passive/planner.ts");
  const set1 = planner.allocatePathInMode({ ...base, targetId: "D", allocatedIds: ["A"], mode: 1 });
  assert.deepEqual([...set1.allocated].sort(), ["A", "B", "C", "D"]);
  assert.deepEqual(plain(set1.weaponSets), { B: 1, C: 1, D: 1 });

  const blocked = planner.allocatePathInMode({ ...base, targetId: "E", allocatedIds: set1.allocated, weaponSets: set1.weaponSets, mode: 2 });
  assert.equal(blocked.blocked, "global", "a keystone cannot be taken while a set is selected");
  assert.equal(blocked.allocated.size, 4);

  // Set 2 cannot path through set 1's branch.
  const set2 = planner.allocatePathInMode({ ...base, targetId: "G", allocatedIds: set1.allocated, weaponSets: set1.weaponSets, mode: 2 });
  assert.equal(set2.allocated.has("G"), false, "no way to G for set 2 (C belongs to set 1)");
  const set2f = planner.allocatePathInMode({ ...base, targetId: "F", allocatedIds: ["A"], mode: 2 });
  assert.deepEqual(plain(set2f.weaponSets), { B: 2, F: 2 });

  // The main tree may run through a set's branch, which becomes main tree (PoB).
  const main = planner.allocatePathInMode({ ...base, targetId: "G", allocatedIds: set1.allocated, weaponSets: set1.weaponSets, mode: 0 });
  assert.deepEqual([...main.allocated].sort(), ["A", "B", "C", "D", "G"]);
  assert.deepEqual(plain(main.weaponSets), { D: 1 }, "B and C were promoted to the main tree");

  const keystone = planner.allocatePathInMode({ ...base, targetId: "E", allocatedIds: ["A"], mode: 0 });
  assert.deepEqual([...keystone.allocated].sort(), ["A", "B", "E"]);
  assert.deepEqual(plain(keystone.weaponSets), {});
});

test("weapon sets: refunds drop what only hung on the node, per set", async () => {
  const planner = await loadTs("src/spa/passive/planner.ts");
  // Main: A, B. Set 1: C, D. Set 2: F.
  const weaponSets = { C: 1, D: 1, F: 2 };
  const allocatedIds = ["A", "B", "C", "D", "F"];
  const refundC = planner.refundInMode({ ...base, targetId: "C", allocatedIds, weaponSets });
  assert.deepEqual([...refundC.allocated].sort(), ["A", "B", "F"]);
  assert.deepEqual(plain(refundC.weaponSets), { F: 2 });
  const refundB = planner.refundInMode({ ...base, targetId: "B", allocatedIds, weaponSets });
  assert.deepEqual([...refundB.allocated], ["A"]);
  assert.deepEqual(plain(refundB.weaponSets), {});
  // A set node never keeps a node of the other set alive.
  const crossed = planner.refundInMode({ ...base, targetId: "D", allocatedIds: ["A", "B", "C", "D"], weaponSets: { B: 1, C: 2, D: 2 } });
  assert.deepEqual([...crossed.allocated].sort(), ["A", "B"], "set 2 nodes hanging on a set 1 node are not connected");
});

test("tree edits: snapshot, calculation body and .build payload", async () => {
  const lib = await loadPlannerLib();
  const tree = lib.createTreeSnapshot({
    name: "t", className: "Witch", ascendancyName: "", allocatedIds: ["10", "20", "30"], startIds: [], treeVersion: "0.5",
    weaponSets: { 10: 1, 20: 2, 99: 1 },
    attributeChoices: { 30: "dex", 10: "int", 98: "str", 20: "bad" }
  });
  assert.deepEqual(plain(tree.weaponSets), { 10: 1, 20: 2 }, "nodes that are not allocated are dropped");
  assert.deepEqual(plain(tree.attributeChoices), { 10: "int", 30: "dex" });

  const payload = { className: "Witch", weapon_set_passives: { 1: ["5"] }, attribute_overrides: { strNodes: "7", dexNodes: "", intNodes: "" } };
  const common = { payload, passives: tree.allocatedIds, inventory: [], skills: [], activeWeaponSet: 1, mainSocketGroup: 1 };
  const fromTree = lib.calculationRequestBody({ ...common, weaponSets: tree.weaponSets, attributeChoices: tree.attributeChoices });
  assert.deepEqual(plain(fromTree.weapon_set_passives), { 1: [10], 2: [20] });
  assert.deepEqual(plain(fromTree.attribute_overrides), { dexNodes: "30", intNodes: "10", strNodes: "" });
  const fromPayload = lib.calculationRequestBody(common);
  assert.deepEqual(plain(fromPayload.weapon_set_passives), { 1: ["5"] }, "trees without edits keep the imported ones");
  assert.equal(fromPayload.attribute_overrides.strNodes, "7");
  const cleared = lib.calculationRequestBody({ ...common, weaponSets: {}, attributeChoices: {} });
  assert.equal(cleared.weapon_set_passives, undefined, "an emptied tree sends no weapon sets");
  assert.equal(cleared.attribute_overrides, undefined);

  // An old saved tree reads its edits from the payload; edited trees keep their own.
  const old = { ...tree, weaponSets: undefined, attributeChoices: undefined, allocatedIds: ["5", "7"] };
  const migrated = lib.withTreePicksFromPayload(old, payload);
  assert.deepEqual(plain(migrated.weaponSets), { 5: 1 });
  assert.deepEqual(plain(migrated.attributeChoices), { 7: "str" });
  assert.equal(lib.withTreePicksFromPayload(tree, payload), tree);

  const counts = lib.weaponSetPointCounts({ 1: 1, 2: 1, 3: 2, 4: 1 }, ["1", "2", "3"]);
  assert.deepEqual(plain(counts), { set1: 2, set2: 1, shared: 1 });

  const exported = lib.buildPlannerPayload({ snapshot: tree, name: "x", author: "", description: "", inventory: [], basePayload: payload });
  assert.deepEqual(plain(exported.weapon_set_passives), { 1: ["10"], 2: ["20"] });
  assert.deepEqual(plain(exported.attribute_overrides), { dexNodes: "30", intNodes: "10", strNodes: "" });
});

test("jewels: socket, swap, take out and socket rules", async () => {
  const inv = await loadSpaLib("buildInventory");
  const rare = (name, base) => `Rarity: Rare\n${name}\n${base}\n+10% increased Spell Damage`;
  const unique = "Rarity: Unique\nFrom Nothing\nDiamond\nPassives in Radius can be Allocated";
  const a = inv.stashItemFromText(rare("Gleam", "Sapphire"), "paste");
  const b = inv.stashItemFromText(rare("Glint", "Time-Lost Ruby"), "paste");
  const u = inv.stashItemFromText(unique, "paste");
  assert.equal(inv.isJewelText(a.rawText), true);
  assert.equal(inv.isJewelText("Rarity: Rare\nX\nGold Ring"), false);
  assert.equal(inv.isJewelText("Item Class: Jewels\nRarity: Magic\nY\nSomething"), true);
  assert.equal(inv.jewelSocketAccepts("normal", u), true);
  assert.equal(inv.jewelSocketAccepts("sinister", u), false, "sinister sockets take no unique");
  assert.equal(inv.jewelSocketAccepts("basic", b), false, "the Phylactery takes basic jewels only");
  assert.equal(inv.jewelSocketAccepts("basic", a), true);

  let state = { inventory: [], stash: [a, b, u] };
  state = inv.socketJewel(state, a.id, "61419");
  assert.deepEqual(plain(state.inventory.map((row) => row.inventoryId)), ["PassiveJewel:61419"]);
  assert.equal(state.stash.length, 2);
  state = inv.socketJewel(state, b.id, "61419");
  assert.match(state.inventory[0].rawText, /Glint/);
  assert.match(state.stash[0].rawText, /Gleam/, "the swapped-out jewel goes back to the inventory");
  state = inv.moveSocketedJewel(state, "61419", "2491");
  assert.deepEqual(plain(state.inventory.map((row) => row.inventoryId)), ["PassiveJewel:2491"]);
  state = inv.unsocketJewel(state, "2491");
  assert.equal(state.inventory.length, 0, "the socket row goes away");
  assert.equal(state.stash.length, 3);
  assert.equal(inv.jewelSocketNodeId("PassiveJewel:2491"), "2491");
  assert.equal(inv.jewelSocketNodeId("Ring1"), "");
});

test("passive tree data: attribute nodes and socket kinds", async () => {
  const treeLib = await loadTs("src/spa/passive/tree.ts");
  const context = { window: {} };
  vm.runInNewContext(await read(join(repoRoot, "public/data/passive-tree-data.js"), "utf8"), context);
  const tree = treeLib.parsePassiveTree(context.window.POE2_PASSIVE_TREE, "vi");
  const attributes = tree.nodes.filter((node) => node.isAttribute);
  assert.ok(attributes.length > 200, `attribute nodes: ${attributes.length}`);
  assert.ok(attributes.every((node) => node.name === "Attribute"));
  const kinds = (kind) => tree.nodes.filter((node) => node.jewelSocket === kind).length;
  assert.ok(kinds("normal") >= 10);
  assert.ok(kinds("sinister") >= 1);
  assert.equal(kinds("basic"), 1, "the Lich's Crystalline Phylactery");
});

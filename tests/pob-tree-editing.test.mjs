// Tree editing against Path of Building itself. Each case makes a change in the
// planner (attribute pick, weapon-set node, jewel out / moved, socket refunded)
// and makes the same change in the PoB code's own XML the way PoB saves it, then
// runs both through PoB: the planner must land on PoB's numbers. Save/reload and
// the PoB-code export must not move a number. Skipped when PoB is not installed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { compareStats, pobRuntime, readFixtures, runPob } from "../scripts/check-pob-parity.mjs";
import { loadPlannerLib, loadSpaLib, plannerCalculationRequest, repoRoot } from "../scripts/lib/planner-node.mjs";

const runtime = pobRuntime();
const options = { skip: runtime.available ? false : "PoB not installed locally", timeout: 600_000 };
const fixture = (file) => readFixtures([file])[0];
const plain = (value) => JSON.parse(JSON.stringify(value));
const STATS = ["CombinedDPS", "Life", "EnergyShield", "Mana", "Spirit", "Str", "Dex", "Int", "Armour", "Evasion", "FireResist", "ColdResist", "LightningResist", "ChaosResist", "TotalEHP"];

/** Planner run and PoB's own run of the same change land on the same numbers, and the change shows. */
async function assertSameAsPob(label, { plannerXml, pobXml, baseXml }) {
  const [planner, pob, base] = await Promise.all([runPob(plannerXml, runtime), runPob(pobXml, runtime), runPob(baseXml, runtime)]);
  const rows = compareStats({ code: {}, pob, planner });
  const off = rows.filter((row) => !row.plannerOk);
  assert.equal(off.length, 0, `${label}: planner vs PoB ${JSON.stringify(off.map(({ stat, pob: p, planner: q }) => ({ stat, pob: p, planner: q })))}`);
  assert.ok(STATS.some((stat) => base[stat] !== pob[stat]), `${label}: the change moves at least one number`);
  return { planner, pob, base };
}

const listAttr = (xml, key) => (xml.match(new RegExp(`<AttributeOverride[^>]*\\b${key}="([^"]*)"`))?.[1] || "").split(",").filter(Boolean);
const setAttr = (xml, key, ids) => xml.replace(new RegExp(`(<AttributeOverride[^>]*\\b${key}=")[^"]*(")`), `$1${ids.join(",")}$2`);
const listSet = (xml, set) => (xml.match(new RegExp(`<WeaponSet${set} nodes="([^"]*)"`))?.[1] || "").split(",").filter(Boolean);
const setSet = (xml, set, ids) => xml.replace(new RegExp(`(<WeaponSet${set} nodes=")[^"]*(")`), `$1${ids.join(",")}$2`);
const socketRe = (nodeId) => new RegExp(`<Socket\\b[^>]*\\bnodeId="${nodeId}"[^>]*/>`);
const allocatedSockets = (body, inventory) => inventory
  .map((row) => row.inventoryId.match(/^PassiveJewel:(\d+)$/)?.[1])
  .filter((id) => id && body.passives.includes(Number(id)));

test("attribute picks: planner = PoB, on three builds", options, async () => {
  for (const file of ["druid-oracle.json", "mercenary-gemling-2.json", "sorceress-stormweaver.json"]) {
    const { xml, tree, bodyFor } = await plannerCalculationRequest(fixture(file).code);
    // An Int node becomes Dex (or a Str node becomes Int when there is no Int pick).
    const from = listAttr(xml, "intNodes").length ? ["int", "intNodes"] : ["str", "strNodes"];
    const to = from[0] === "int" ? ["dex", "dexNodes"] : ["int", "intNodes"];
    const nodeId = listAttr(xml, from[1]).find((id) => tree.attributeChoices[id] === from[0]);
    assert.ok(nodeId, `${file}: an attribute node to switch`);
    const pobXml = setAttr(setAttr(xml, from[1], listAttr(xml, from[1]).filter((id) => id !== nodeId)), to[1], [...listAttr(xml, to[1]), nodeId]);
    const plannerXml = buildPobXml(bodyFor({ attributeChoices: { ...tree.attributeChoices, [nodeId]: to[0] } }));
    const { planner, base } = await assertSameAsPob(`${file} node ${nodeId} ${from[0]} -> ${to[0]}`, { plannerXml, pobXml, baseXml: xml });
    const key = { str: "Str", dex: "Dex", int: "Int" };
    assert.ok(planner[key[to[0]]] > base[key[to[0]]], `${file}: ${to[0]} goes up`);
  }
});

test("weapon-set nodes: planner = PoB, set 1 and set 2 active", options, async () => {
  for (const [file, activeWeaponSet] of [["mercenary-gemling.json", 1], ["mercenary-gemling.json", 2], ["sorceress-stormweaver.json", 1]]) {
    const { xml, tree, bodyFor } = await plannerCalculationRequest(fixture(file).code, { activeWeaponSet });
    // PoB's own XML with the same weapon set active as the planner.
    const pobBase = xml.replace(/useSecondWeaponSet="(true|false)"/g, `useSecondWeaponSet="${activeWeaponSet === 2}"`);
    // Every set-1 node goes to set 2: with set 1 active the build loses them, with set 2 it gains them.
    const set1 = listSet(xml, 1);
    assert.ok(set1.length > 0, `${file}: has set 1 nodes`);
    const pobXml = setSet(setSet(pobBase, 1, []), 2, [...listSet(xml, 2), ...set1]);
    const weaponSets = { ...tree.weaponSets };
    for (const id of set1) weaponSets[id] = 2;
    const plannerXml = buildPobXml(bodyFor({ weaponSets }));
    await assertSameAsPob(`${file} set 1 -> set 2 (set ${activeWeaponSet} active)`, { plannerXml, pobXml, baseXml: pobBase });
  }
});

test("jewel taken out (radius jewels too): planner = PoB", options, async () => {
  const inv = await loadSpaLib("buildInventory");
  // druid: rare Sapphire; gemling-3 / gemling: Time-Lost radius jewels; gemling-2: From Nothing.
  for (const [file, pick] of [["druid-oracle.json", "26196"], ["mercenary-gemling-3.json", "21984"], ["mercenary-gemling.json", "32763"], ["mercenary-gemling-2.json", "26196"]]) {
    const { xml, body, inventory, project, bodyFor } = await plannerCalculationRequest(fixture(file).code);
    assert.ok(allocatedSockets(body, inventory).includes(pick), `${file}: ${pick} holds a jewel`);
    const removed = inv.unsocketJewel({ inventory, stash: project.stash }, pick);
    await assertSameAsPob(`${file} jewel out of ${pick}`, {
      plannerXml: buildPobXml(bodyFor({ inventory: removed.inventory })),
      pobXml: xml.replace(socketRe(pick), ""),
      baseXml: xml
    });
  }
});

test("jewel moved between sockets (a radius jewel swapped): planner = PoB", options, async () => {
  const inv = await loadSpaLib("buildInventory");
  for (const [file, from, to] of [["mercenary-gemling-3.json", "21984", "7960"], ["mercenary-gemling.json", "32763", "61834"]]) {
    const { xml, inventory, project, bodyFor } = await plannerCalculationRequest(fixture(file).code);
    const moved = inv.moveSocketedJewel({ inventory, stash: project.stash }, from, to);
    const pobXml = xml
      .replace(socketRe(from), (row) => row.replace(`nodeId="${from}"`, 'nodeId="__TO__"'))
      .replace(socketRe(to), (row) => row.replace(`nodeId="${to}"`, `nodeId="${from}"`))
      .replace('nodeId="__TO__"', `nodeId="${to}"`);
    await assertSameAsPob(`${file} jewel ${from} <-> ${to}`, { plannerXml: buildPobXml(bodyFor({ inventory: moved.inventory })), pobXml, baseXml: xml });
  }
});

async function loadTs(file) {
  const js = ts.transpileModule(await readFile(join(repoRoot, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const sandbox = { module: { exports: {} }, require: () => ({}) };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(js, sandbox);
  return sandbox.module.exports;
}

test("refunding the node a socket hangs on: the jewel stays but does nothing, as in PoB", options, async () => {
  const treeLib = await loadTs("src/spa/passive/tree.ts");
  const planner = await loadTs("src/spa/passive/planner.ts");
  const inv = await loadSpaLib("buildInventory");
  const context = { window: {} };
  vm.runInNewContext(await readFile(join(repoRoot, "public/data/passive-tree-data.js"), "utf8"), context);
  const tree = treeLib.parsePassiveTree(context.window.POE2_PASSIVE_TREE, "en");
  const graph = planner.buildPassiveGraph(tree);
  for (const [file, socket] of [["mercenary-gemling-3.json", "21984"], ["druid-oracle.json", "61419"]]) {
    const { xml, inventory, project, tree: saved, bodyFor } = await plannerCalculationRequest(fixture(file).code);
    // Refund the node right before the socket on its path (as clicking it on the tree does).
    const starts = saved.allocatedIds.filter((id) => tree.nodeById.get(id)?.isClassStart || tree.nodeById.get(id)?.isAscendancyStart);
    const neighbour = (graph.get(socket) ?? []).find((id) => saved.allocatedIds.includes(id) && !starts.includes(id));
    const refund = planner.refundInMode({ targetId: neighbour, allocatedIds: saved.allocatedIds, startNodeIds: starts, graphByNodeId: graph, visibleNodeIds: tree.nodes.map((node) => node.id), weaponSets: saved.weaponSets });
    assert.equal(refund.allocated.has(socket), false, `${file}: socket ${socket} drops with node ${neighbour}`);
    const allocated = [...refund.allocated];
    const attributeChoices = Object.fromEntries(Object.entries(saved.attributeChoices).filter(([id]) => refund.allocated.has(id)));
    const refunded = { passives: allocated, weaponSets: plain(refund.weaponSets), attributeChoices };
    const withJewel = buildPobXml(bodyFor(refunded));
    const withoutJewel = buildPobXml(bodyFor({ ...refunded, inventory: inv.unsocketJewel({ inventory, stash: project.stash }, socket).inventory }));
    assert.match(withJewel, socketRe(socket), "the jewel stays in its socket");
    // PoB's own save of the same refund: nodes, overrides of dropped nodes gone, sockets kept.
    let pobXml = xml.replace(/(<Spec\b[^>]*\bnodes=")[^"]*(")/, `$1${allocated.join(",")}$2`);
    for (const key of ["strNodes", "dexNodes", "intNodes"]) pobXml = setAttr(pobXml, key, listAttr(xml, key).filter((id) => refund.allocated.has(id)));
    for (const set of [1, 2]) pobXml = setSet(pobXml, set, listSet(xml, set).filter((id) => refund.allocated.has(id)));
    const [a, b] = await Promise.all([runPob(withJewel, runtime), runPob(withoutJewel, runtime)]);
    for (const stat of STATS) assert.equal(a[stat], b[stat], `${file} ${stat}: a jewel in an unallocated socket changes nothing`);
    await assertSameAsPob(`${file} refund ${neighbour}`, { plannerXml: withJewel, pobXml, baseXml: xml });
  }
});

test("save/reload and the PoB-code export keep every number, after edits", options, async () => {
  const lib = await loadPlannerLib();
  const inv = await loadSpaLib("buildInventory");
  for (const [file, from, to] of [["mercenary-gemling.json", "32763", "61834"], ["sorceress-stormweaver.json", "", ""]]) {
    const { tree, inventory, project, bodyFor } = await plannerCalculationRequest(fixture(file).code);
    // Edits: one attribute switched, one set node moved, a jewel moved.
    const attrId = Object.keys(tree.attributeChoices)[0];
    const setId = Object.keys(tree.weaponSets).find((id) => tree.weaponSets[id] === 1);
    const edited = lib.createTreeSnapshot({ ...tree, attributeChoices: { ...tree.attributeChoices, [attrId]: tree.attributeChoices[attrId] === "dex" ? "int" : "dex" }, weaponSets: { ...tree.weaponSets, [setId]: 2 } });
    const editedInventory = from ? inv.moveSocketedJewel({ inventory, stash: project.stash }, from, to).inventory : inventory;
    const live = bodyFor({ attributeChoices: edited.attributeChoices, weaponSets: edited.weaponSets, inventory: editedInventory });

    // Save to the browser and open again.
    const saved = lib.normalizeBuildProject(plain(lib.createBuildProject({ ...project, treeSnapshot: edited, inventory: editedInventory, importedPayload: project.importedPayload })));
    const reopened = lib.withTreePicksFromPayload(saved.treeSnapshots[0], saved.importedPayload);
    const reloaded = bodyFor({ passives: reopened.allocatedIds, attributeChoices: reopened.attributeChoices, weaponSets: reopened.weaponSets, inventory: lib.inventoryForSlots(saved.inventory, inventory.filter((row) => !row.inventoryId.includes(":")).map((row) => row.inventoryId), (slotId) => ({ id: slotId, inventoryId: slotId, itemName: "", note: "", isUnique: false, levelStart: "", levelEnd: "" })) });

    // Export as a PoB code and import it again the way the page does.
    const code = await lib.encodePobXmlText(buildPobXml(reloaded));
    const reimported = (await plannerCalculationRequest(code)).body;

    const [a, b, c, pob] = await Promise.all([live, reloaded, reimported].map((body) => runPob(buildPobXml(body), runtime)).concat(runPob(await lib.decodePobXmlText(code), runtime)));
    for (const stat of STATS) {
      assert.equal(b[stat], a[stat], `${file} ${stat}: save + reload`);
      assert.equal(c[stat], a[stat], `${file} ${stat}: PoB code export + import`);
      assert.equal(pob[stat], a[stat], `${file} ${stat}: PoB on the exported code`);
    }
  }
});

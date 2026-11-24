// Build Planner, a build started from scratch: the class / ascendancy picker makes an
// empty tree for that class, and the character level goes with the build (save, .build
// file, PoB code) and into the calculation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { loadPlannerData, loadPlannerLib, repoRoot } from "../scripts/lib/planner-node.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));

async function loadTs(file) {
  const js = ts.transpileModule(await readFile(join(repoRoot, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const sandbox = { module: { exports: {} }, require: () => ({}) };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(js, sandbox);
  return sandbox.module.exports;
}

async function passiveTree() {
  const treeLib = await loadTs("src/spa/passive/tree.ts");
  const context = { window: {} };
  vm.runInNewContext(await readFile(join(repoRoot, "public/data/passive-tree-data.js"), "utf8"), context);
  return treeLib.parsePassiveTree(context.window.POE2_PASSIVE_TREE, "en");
}

const calcInput = (lib, payload, snapshot) => ({
  payload,
  passives: snapshot ? lib.selectedPassiveIds(snapshot) : [],
  inventory: [],
  skills: [],
  activeWeaponSet: 1,
  mainSocketGroup: 1
});

test("character level: clamped to 1-100, kept by a saved build, imported builds keep their own", async () => {
  const lib = await loadPlannerLib();
  assert.equal(lib.characterLevel(0), 1);
  assert.equal(lib.characterLevel(150), 100);
  assert.equal(lib.characterLevel("73"), 73);
  assert.equal(lib.characterLevel(""), undefined);
  assert.equal(lib.characterLevel("abc"), undefined);

  const project = lib.createBuildProject({ name: "Lv test", author: "", description: "", level: 73 });
  assert.equal(project.level, 73);
  // Save / reload goes through JSON in localStorage.
  const reloaded = lib.normalizeBuildProject(plain(project));
  assert.equal(reloaded.level, 73);
  assert.equal(lib.buildCharacterLevel(reloaded), 73);

  const older = lib.normalizeBuildProject(plain({ ...project, level: undefined }));
  assert.equal(older.level, undefined, "builds saved before the level box have none");
  assert.equal(lib.buildCharacterLevel(older), lib.DEFAULT_CHARACTER_LEVEL);
  const imported = lib.normalizeBuildProject(plain({ ...project, level: undefined, importedPayload: { name: "x", level: 55 } }));
  assert.equal(lib.buildCharacterLevel(imported), 55, "an imported build plays at its own level");
  assert.equal(lib.buildCharacterLevel({ ...imported, level: 80 }), 80, "until the planner changes it");
});

test("character level: .build export / import and PoB code round trip, and the calculation gets it", async () => {
  const lib = await loadPlannerLib();
  const tree = await passiveTree();
  const { selectedStartNodeIds } = await loadTs("src/spa/passive/planner.ts");
  const plannerData = loadPlannerData();
  const snapshot = lib.createClassTreeSnapshot({
    className: "Sorceress",
    ascendancyName: "Stormweaver",
    startIds: selectedStartNodeIds(tree, "Sorceress", "Stormweaver"),
    treeVersion: "0.5"
  });

  // .build file: export, then import the same text.
  const exported = lib.buildPlannerPayload({ snapshot, plannerData, name: "Level 42", author: "", description: "", inventory: [], skills: [], level: 42 });
  assert.equal(exported.level, 42);
  assert.equal(exported.className, "Sorceress");
  assert.equal(exported.ascendancy, "Sorceress1");
  const reimported = lib.parseBuildFileText(`${JSON.stringify(exported, null, 2)}\n`);
  assert.equal(reimported.level, 42);
  // An imported payload with a level changed in the planner exports the new level.
  assert.equal(lib.buildPlannerPayload({ basePayload: reimported, snapshot, plannerData, name: "", author: "", description: "", inventory: [], level: 64 }).level, 64);

  // Calculation body and the PoB XML it becomes.
  const body = lib.calculationRequestBody(calcInput(lib, { ...reimported, level: 42 }, snapshot));
  assert.equal(body.level, 42);
  assert.equal(lib.calculationRequestBody(calcInput(lib, { ...reimported, level: 250 }, snapshot)).level, 100, "clamped");
  const xml = buildPobXml(body);
  assert.match(xml, /<Build level="42"/);

  // PoB code: what "PoB code" copies, read back by "Import từ PoB".
  const code = await lib.encodePobXmlText(xml);
  const pob = await lib.parsePobExportCode(code);
  assert.equal(pob.build.level, 42);
  const payload = lib.buildPayloadFromPobImport(pob, { plannerData });
  assert.equal(payload.level, 42);
  const project = lib.createBuildProject({ name: "PoB", author: "", description: "", importedPayload: payload, level: lib.characterLevel(payload.level) });
  assert.equal(lib.buildCharacterLevel(lib.normalizeBuildProject(plain(project))), 42);
});

test("class picker: an empty tree for a class and ascendancy, calculated as that class", async () => {
  const lib = await loadPlannerLib();
  const tree = await passiveTree();
  const { selectedStartNodeIds } = await loadTs("src/spa/passive/planner.ts");
  const plannerData = loadPlannerData();
  assert.ok(tree.classes.includes("Mercenary"), "classes come from the passive tree data");
  const ascendancies = tree.classByName.get("Mercenary").ascendancies.map((row) => row.name);
  assert.ok(ascendancies.includes("Gemling Legionnaire"));

  const starts = [...selectedStartNodeIds(tree, "Mercenary", "Gemling Legionnaire")];
  const snapshot = lib.createClassTreeSnapshot({ className: "Mercenary", ascendancyName: "Gemling Legionnaire", startIds: starts, treeVersion: "0.5" });
  assert.equal(snapshot.className, "Mercenary");
  assert.equal(snapshot.ascendancyName, "Gemling Legionnaire");
  assert.equal(snapshot.name, "Mercenary Gemling Legionnaire");
  assert.equal(lib.passiveCount(snapshot), 0, "no point spent yet");
  const nodes = snapshot.startIds.map((id) => tree.nodeById.get(id));
  assert.ok(nodes.some((node) => node?.isClassStart && node.classNames.includes("Mercenary")), "the class start is allocated");
  assert.ok(nodes.some((node) => node?.isAscendancyStart && node.ascendancyName === "Gemling Legionnaire"), "the ascendancy start is allocated");
  assert.deepEqual([...snapshot.allocatedIds].sort(), [...snapshot.startIds].sort());
  assert.deepEqual(plain(snapshot.weaponSets), {});

  // Without an ascendancy: only the class start.
  const base = lib.createClassTreeSnapshot({ className: "Mercenary", ascendancyName: "", startIds: selectedStartNodeIds(tree, "Mercenary", ""), treeVersion: "0.5" });
  assert.ok(base.startIds.every((id) => !tree.nodeById.get(id)?.isAscendancyStart));

  // Points spent on it, then calculated: the class and ascendancy of the pick.
  const firstStep = [...tree.edges].find((edge) => snapshot.startIds.includes(edge.from) && !tree.nodeById.get(edge.to)?.isClassStart && !tree.nodeById.get(edge.to)?.ascendancyName);
  const allocated = { ...snapshot, allocatedIds: [...snapshot.allocatedIds, firstStep ? firstStep.to : ""].filter(Boolean) };
  const payload = lib.classBuildPayload(allocated, 68, plannerData);
  assert.deepEqual(plain(payload), { className: "Mercenary", ascendancy: "Mercenary3", level: 68 });
  const body = lib.calculationRequestBody(calcInput(lib, payload, allocated));
  assert.equal(body.className, "Mercenary");
  assert.equal(body.ascendancy, "Mercenary3");
  assert.equal(body.level, 68);
  const xml = buildPobXml(body);
  assert.match(xml, /className="Mercenary"/);
  assert.match(xml, /ascendClassName="Gemling Legionnaire"/);

  // Saved with the build and back.
  const project = lib.createBuildProject({ name: "New", author: "", description: "", treeSnapshot: allocated, level: 68 });
  const reloaded = lib.normalizeBuildProject(plain(project));
  assert.equal(reloaded.treeSnapshots[0].className, "Mercenary");
  assert.equal(reloaded.treeSnapshots[0].ascendancyName, "Gemling Legionnaire");
  assert.equal(reloaded.level, 68);
});

test("saved tree list: the same tree saved twice shows once", async () => {
  const lib = await loadPlannerLib();
  const tree = (id, name, allocatedIds, className = "Mercenary") => ({
    ...lib.createTreeSnapshot({ id, name, className, ascendancyName: "Gemling Legionnaire", allocatedIds, startIds: [], treeVersion: "0.5" })
  });
  const rows = [
    tree("a", "Gemling Legionnaire tree", ["1", "2", "3"]),
    tree("b", "Gemling Legionnaire tree", ["3", "2", "1"]),
    tree("c", "Gemling Legionnaire tree", ["1", "2"]),
    tree("d", "Gemling Legionnaire tree", ["1", "2", "3"], "Witch"),
    tree("e", "Other tree", ["1", "2", "3"])
  ];
  assert.deepEqual(lib.dedupeTreeSnapshots(rows).map((row) => row.id), ["a", "c", "d", "e"]);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { deflateSync } from "node:zlib";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readRepoFile = (filename) => readFile(join(repoRoot, filename), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

const loadBuildPlannerModule = async (contextOverrides = {}) => {
  const source = await readRepoFile("src/spa/lib/buildPlanner.ts");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require,
    console,
    Date,
    Math,
    Set,
    Map,
    JSON,
    Number,
    String,
    Array,
    Error,
    SyntaxError,
    ...contextOverrides
  });
  return module.exports;
};

const readItemsExport = async () => {
  const source = await readRepoFile("public/data/items-data.js");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.POE2_ITEMS?.items ?? [];
};

test("Build tab exports the official .build root payload shape", async () => {
  const planner = await readRepoFile("src/spa/lib/buildPlanner.ts");

  assert.match(planner, /export function buildPlannerPayload/);
  assert.match(planner, /export type BuildPayload = Record<string, unknown>/);
  assert.match(planner, /const build:\s*BuildPayload\s*=\s*isPlainObject\(input\.basePayload\)/);
  assert.match(planner, /build\.name\s*=\s*name/);
  assert.match(planner, /build\.ascendancy\s*=\s*ascendancy/);
  assert.match(planner, /build\.passives\s*=\s*passives/);
  assert.match(planner, /build\.inventory_slots\s*=\s*nextInventorySlots/);
  assert.match(planner, /return build;/);
  assert.doesNotMatch(planner, /Build\s*:/, "export must not wrap the root object in a Build key");
});

test("Build planner maps passive tree nodes and ascendancies to game ids", async () => {
  const [planner, dataFile] = await Promise.all([
    readRepoFile("src/spa/lib/buildPlanner.ts"),
    readRepoFile("public/data/build-planner-data.js")
  ]);

  assert.match(planner, /officialPassiveIds/);
  assert.match(planner, /plannerData\?\.passive_ids/);
  assert.match(planner, /officialAscendancyId/);
  assert.match(planner, /\$\{snapshot\.className\}\|\$\{snapshot\.ascendancyName\}/);
  assert.match(dataFile, /window\.POE2_BUILD_PLANNER_DATA/);
  assert.match(dataFile, /"passive_ids":/);
  assert.match(dataFile, /"ascendancies":/);
  assert.match(dataFile, /natwarth\.github\.io\/poe2-skilltree\/data\/data-0\.5\.json/);
});

test("Passive Tree saves current and named snapshots for the Build tab", async () => {
  const page = await readRepoFile("src/spa/pages/PassiveTreePage.tsx");

  assert.match(page, /createTreeSnapshot/);
  assert.match(page, /readCurrentTreeSnapshot/);
  assert.match(page, /writeCurrentTreeSnapshot\(currentBuildSnapshot\)/);
  assert.match(page, /saveTreeSnapshot\(saved\)/);
  assert.match(page, /poe-build-tree-saved/);
  assert.match(page, /passive-build-save/);
  assert.match(page, /className="passive-build-name"/);
});

test("Build planner page lets users choose saved trees and item hints", async () => {
  const page = await readRepoFile("src/spa/pages/BuildPlannerPage.tsx");

  assert.match(page, /readCurrentTreeSnapshot/);
  assert.match(page, /readSavedTreeSnapshots/);
  assert.match(page, /readSavedBuildProjects/);
  assert.match(page, /saveBuildProject/);
  assert.match(page, /deleteBuildProject/);
  assert.match(page, /createBuildProject/);
  assert.match(page, /loadBuildPlannerData/);
  assert.match(page, /loadItemsData/);
  assert.match(page, /BuildProject/);
  assert.match(page, /savedBuilds/);
  assert.match(page, /activeBuildId/);
  assert.match(page, /editorOpen/);
  assert.match(page, /buildTree/);
  assert.match(page, /treeChoicesOpen/);
  assert.match(page, /setTreeChoicesOpen\(true\)/);
  assert.match(page, /chooseTreeForBuild/);
  assert.match(page, /clearBuildTree/);
  assert.match(page, /selectedTree/);
  assert.doesNotMatch(page, /setActiveTreeId/);
  assert.match(page, /equipmentSlots/);
  assert.match(page, /build-equipment-frame/);
  assert.match(page, /build-equip-slot/);
  assert.match(page, /build-library/);
  assert.match(page, /build-library-grid/);
  assert.match(page, /build-library-card/);
  assert.match(page, /build-project-actions/);
  assert.doesNotMatch(page, /openBuildTreeView/);
  assert.doesNotMatch(page, /requestBuildTreeEdit/);
  assert.doesNotMatch(page, /writeCurrentTreeSnapshot/);
  assert.doesNotMatch(page, /className="build-project-list"/);
  assert.doesNotMatch(page, /className="build-import-box"/);
  assert.doesNotMatch(page, /localizedText\(copy\.useTreeSource/);
  assert.doesNotMatch(page, /localizedText\(copy\.description/);
  assert.match(page, /build-linked-trees/);
  assert.match(page, /build-tree-source/);
  assert.match(page, /build-tree-source--inline/);
  assert.match(page, /build-tree-mini/);
  assert.doesNotMatch(page, /build-tree-picker-backdrop/);
  assert.doesNotMatch(page, /className="build-tree-picker"/);
  assert.match(page, /PassiveTreeWorkspace/);
  assert.match(page, /onSnapshotChange=\{updateBuildTreeFromEditor\}/);
  assert.match(page, /onSaveSnapshot=\{saveBuildTreeFromEditor\}/);
  assert.match(page, /key=\{`\$\{buildTree\.id\}:\$\{buildTree\.className\}:\$\{buildTree\.ascendancyName\}`\}/);
  assert.doesNotMatch(page, /buildTree\.allocatedIds\.join/);
  assert.doesNotMatch(page, /className="build-tree-route"/);
  assert.doesNotMatch(page, /treeRouteOpen/);
  assert.doesNotMatch(page, /treeRouteEditable/);
  assert.doesNotMatch(page, /treeRoutePath/);
  assert.doesNotMatch(page, /readOnly=\{!treeRouteEditable\}/);
  assert.doesNotMatch(page, /className="build-tree-action build-tree-view"/);
  assert.doesNotMatch(page, /className="build-tree-action build-tree-edit"/);
  assert.match(page, /build-action-dialog/);
  assert.match(page, /build-item-picker/);
  assert.match(page, /build-editor-split/);
  assert.match(page, /downloadBuildFile/);
  assert.match(page, /parseBuildFileText/);
  assert.match(page, /parsePobExportCode/);
  assert.match(page, /buildPayloadFromPobImport/);
  assert.match(page, /pobImportOpen/);
  assert.match(page, /inventoryChoicesFromBuildPayload/);
  assert.match(page, /skillChoicesFromBuildPayload/);
  assert.match(page, /buildSkills/);
  assert.match(page, /supportSkills/);
  assert.match(page, /activeGemPicker/);
  assert.match(page, /gemPickerItems/);
  assert.match(page, /openSkillGemPicker/);
  assert.match(page, /openSupportGemPicker/);
  assert.match(page, /selectGem/);
  assert.match(page, /officialGemId/);
  assert.match(page, /build-gem-choice/);
  assert.match(page, /build-gem-picker/);
  assert.match(page, /build-gem-result/);
  assert.doesNotMatch(page, /className="build-skill-note"/);
  assert.doesNotMatch(page, /className="build-support-note"/);
  assert.match(page, /type="file"/);
  assert.match(page, /accept="\.build,\.json,application\/json"/);
  assert.match(page, /localizedText\(copy\.importPob/);
  assert.match(page, /disabled=\{!canExport\}/);
  assert.match(page, /localizedText\(copy\.noTree/);
  assert.match(page, /localizedText\(copy\.emptyTree/);
});

test("Build planner uses the shared skill gem SOT for active and support pickers", async () => {
  const [page, dataLoader] = await Promise.all([
    readRepoFile("src/spa/pages/BuildPlannerPage.tsx"),
    readRepoFile("src/spa/lib/data.ts")
  ]);

  assert.match(dataLoader, /skill-gems-data\.js/);
  assert.doesNotMatch(dataLoader, /support-gems-data\.js/);
  assert.match(page, /loadSkillGemsData/);
  assert.match(page, /Promise\.all\(\[loadItemsData\(\),\s*loadBuildPlannerData\(\),\s*loadSkillGemsData\(\)\]\)/);
  assert.match(page, /setGemsData\(Array\.isArray\(gemData\?\.gems\)\s*\?\s*gemData\.gems\s*:\s*\[\]\)/);
  assert.match(page, /skillGemOptions[\s\S]*item\.gem_type === "skill"/);
  assert.match(page, /supportGemOptions[\s\S]*item\.gem_type === "support"/);
  assert.match(page, /const rows = kind === "support" \? supportGemOptions : skillGemOptions/);
  assert.match(page, /official_id/);
  assert.match(page, /compactSupportGemSlug/);
  assert.match(page, /officialGemAliases/);
  assert.doesNotMatch(page, /menu_key === "skill-gems"/);
  assert.doesNotMatch(page, /menu_key === "support-gems"/);
});

test("SPA item and gem surfaces keep names in English while localizing descriptions", async () => {
  const [buildPage, dataPages, passiveTree] = await Promise.all([
    readRepoFile("src/spa/pages/BuildPlannerPage.tsx"),
    readRepoFile("src/spa/pages/DataListPages.tsx"),
    readRepoFile("src/spa/passive/tree.ts")
  ]);

  assert.match(buildPage, /function itemTitle\(item: ItemRecord, _locale/);
  assert.doesNotMatch(buildPage, /localizedText\(item\?\.i18n\?\.name/);
  assert.doesNotMatch(buildPage, /localizedText\(item\.i18n\?\.name/);
  assert.match(dataPages, /function rawName/);
  assert.match(dataPages, /const title = rawName\(gem/);
  assert.match(dataPages, /const title = rawName\(item/);
  assert.doesNotMatch(dataPages, /localizedText\(gem\.i18n\?\.name/);
  assert.doesNotMatch(dataPages, /localizedText\(item\.i18n\?\.name/);
  assert.match(passiveTree, /name: rawName\.toLowerCase\(\) === "marauder"/);
  assert.match(passiveTree, /stats: activeLocale === "en" \? rawStats : translatedStats/);
});

test("Build planner uses separate routes for library and detail screens", async () => {
  const [page, routes, styles] = await Promise.all([
    readRepoFile("src/spa/pages/BuildPlannerPage.tsx"),
    readRepoFile("src/spa/lib/routes.ts"),
    readRepoFile("src/spa/styles.css")
  ]);

  assert.match(page, /BuildRouteState/);
  assert.match(page, /buildRouteState\(buildPath\)/);
  assert.match(page, /const \[buildPath,\s*setBuildPath\] = useState/);
  assert.match(page, /const editorOpen = buildRoute\.screen !== "library"/);
  assert.match(page, /screen:\s*"library"\s*\|\s*"detail"/);
  assert.match(page, /!\s*editorOpen \? \(/);
  assert.match(page, /className="build-library"/);
  assert.match(page, /className="build-workbench"/);
  assert.match(page, /className="build-tree-mini"/);
  assert.match(page, /navigateTo\("\/build\/new"\)/);
  assert.match(page, /navigateTo\(`\/build\/\$\{encodeURIComponent\(project\.id\)\}`\)/);
  assert.match(page, /hasBuildChanges/);
  assert.match(page, /openBuildLibrary/);
  assert.match(page, /navigateTo\("\/build"\)/);
  assert.doesNotMatch(page, /setEditorOpen/);
  assert.doesNotMatch(page, /treeMode/);
  assert.doesNotMatch(page, /treeView/);
  assert.doesNotMatch(page, /treeEdit/);
  assert.doesNotMatch(page, /treeRouteOpen/);
  assert.doesNotMatch(page, /treeRoutePath/);
  assert.doesNotMatch(page, /localizedText\(copy\.unsavedBeforeTree/);
  assert.doesNotMatch(page, /\/tree\/(?:view|edit)/);
  assert.match(routes, /path\.startsWith\("\/build\/"\)/);
  assert.match(page, /editorOpen && activeSlot/);
  assert.match(page, /editorOpen && activeGemPicker/);
  assert.match(styles, /\.build-library-grid\s*\{[\s\S]*repeat\(auto-fill,\s*minmax\(280px,\s*1fr\)\)/);
  assert.match(styles, /\.build-library-card-actions/);
  assert.match(styles, /\.build-workbench\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)[\s\S]*max-width:\s*1120px[\s\S]*margin:\s*0 auto/);
  assert.match(styles, /\.build-source-panel\s*\{[\s\S]*position:\s*static[\s\S]*justify-self:\s*center[\s\S]*width:\s*min\(760px,\s*100%\)/);
  assert.match(styles, /\.build-linked-trees\s*\{[\s\S]*justify-self:\s*center[\s\S]*width:\s*min\(620px,\s*100%\)/);
  assert.match(styles, /\.build-editor-split\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*3fr\)\s+minmax\(320px,\s*2fr\)/);
  assert.match(styles, /\.build-tree-mini\s*\{[\s\S]*height:\s*clamp\(520px,\s*58vw,\s*720px\)/);
  assert.doesNotMatch(styles, /\.build-tree-route\s*\{/);
  assert.doesNotMatch(styles, /\.build-tree-editor\s*\{/);
  assert.doesNotMatch(styles, /\.build-tree-action\s*\{/);
  assert.match(styles, /\.build-action-dialog\s*\{/);
  assert.match(styles, /\.passive-route--embedded\s*\{[\s\S]*height:\s*100%/);
  assert.match(styles, /\.build-gem-picker\s*\{[\s\S]*width:\s*min\(620px,\s*calc\(100vw - 28px\)\)/);
  assert.match(styles, /\.build-gem-list\s*\{[\s\S]*repeat\(auto-fill,\s*minmax\(220px,\s*1fr\)\)/);
  assert.match(styles, /\.build-gem-copy strong\s*\{[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis[\s\S]*white-space:\s*nowrap/);
});

test("Build projects persist one build with one reusable tree snapshot", async () => {
  const store = new Map();
  const localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  const planner = await loadBuildPlannerModule({ window: { localStorage } });
  const treeA = {
    id: "tree-a",
    name: "Tree A",
    className: "Amazon",
    ascendancyName: "Base tree",
    allocatedIds: ["start", "node-a"],
    startIds: ["start"],
    treeVersion: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const treeB = { ...treeA, id: "tree-b", name: "Tree B", allocatedIds: ["start", "node-b"] };
  const project = planner.createBuildProject({
    id: "build-one",
    name: "Amazon build",
    author: "POE2 Viet Hoa",
    description: "single tree",
    treeSnapshots: [treeA, treeB],
    activeTreeId: "tree-b",
    inventory: [{ inventoryId: "Ring1", itemName: "Blackflame", note: "", isUnique: true, levelStart: "", levelEnd: "" }]
  });
  const secondProject = planner.createBuildProject({
    id: "build-two",
    name: "Amazon bossing",
    author: "POE2 Viet Hoa",
    description: "same tree reused",
    treeSnapshot: treeB,
    inventory: []
  });

  assert.equal(project.treeSnapshots.length, 1);
  assert.equal(project.treeSnapshots[0].id, "tree-b");
  assert.equal(project.activeTreeId, "tree-b");
  assert.equal(planner.saveBuildProject(project)[0].id, "build-one");
  planner.saveBuildProject(secondProject);
  const savedBuilds = planner.readSavedBuildProjects();
  assert.equal(savedBuilds.length, 2);
  assert.equal(savedBuilds.find((row) => row.id === "build-one").treeSnapshots.length, 1);
  assert.equal(savedBuilds.find((row) => row.id === "build-one").inventory[0].itemName, "Blackflame");
  assert.equal(savedBuilds.find((row) => row.id === "build-two").treeSnapshots[0].id, "tree-b");
  localStorage.setItem(planner.SAVED_BUILDS_KEY, JSON.stringify([{ ...plain(project), treeSnapshots: [treeA, treeB], activeTreeId: "tree-b" }]));
  assert.equal(JSON.stringify(planner.readSavedBuildProjects()[0].treeSnapshots.map((tree) => tree.id)), JSON.stringify(["tree-b"]));
  assert.equal(planner.deleteBuildProject("build-one").length, 0);
});

test("Build planner can import another .build file and export it again", async () => {
  const [planner, page, styles] = await Promise.all([
    readRepoFile("src/spa/lib/buildPlanner.ts"),
    readRepoFile("src/spa/pages/BuildPlannerPage.tsx"),
    readRepoFile("src/spa/styles.css")
  ]);

  assert.match(planner, /export function parseBuildFileText/);
  assert.match(planner, /normalizeImportedBuildPayload/);
  assert.match(planner, /payload\.Build/);
  assert.match(planner, /payload\.build/);
  assert.match(planner, /inventoryChoiceFromBuildSlot/);
  assert.match(planner, /skillChoicesFromBuildPayload/);
  assert.match(planner, /supportSkillChoiceFromBuildSupport/);
  assert.match(planner, /buildSupportSkill/);
  assert.match(planner, /support_skills/);
  assert.match(planner, /splitBuildAdditionalText/);
  assert.match(planner, /baseInventorySlots/);
  assert.match(planner, /\.\.\.baseInventorySlots,\s*\.\.\.inventorySlots/);
  assert.match(planner, /return .*filename.*\.build/);

  assert.match(page, /ImportedBuild/);
  assert.match(page, /createTreeSnapshot/);
  assert.match(page, /saveTreeSnapshot/);
  assert.match(page, /treeSnapshotFromImportedBuild/);
  assert.match(page, /payloadReferenceIds/);
  assert.match(page, /importedPassiveIds/);
  assert.match(page, /importBuildFile/);
  assert.match(page, /applyImportedBuild/);
  assert.match(page, /setBuildTree\(importedTree\)/);
  assert.match(page, /setSavedTrees\(saveTreeSnapshot\(importedTree\)\)/);
  assert.match(page, /setImportedBuild/);
  assert.match(page, /inventoryChoicesFromBuildPayload\(payload,\s*equipmentSlotIds\)/);
  assert.match(page, /setBuildSkills\(skillChoicesFromBuildPayload\(payload\)\)/);
  assert.match(page, /enrichInventoryChoices\(inventoryChoicesFromBuildPayload\(payload,\s*equipmentSlotIds\),\s*itemsData,\s*locale\)/);
  assert.match(page, /canExport = Boolean\(payload && \(importedBuild \|\|/);
  assert.match(page, /type="file"/);
  assert.match(page, /localizedText\(copy\.importBuild/);
  assert.doesNotMatch(page, /localizedText\(copy\.useTreeSource/);
  assert.doesNotMatch(page, /className="build-imported"/);
  assert.doesNotMatch(page, /className="build-import-box"/);
  assert.doesNotMatch(page, /Loaded build/);
  assert.doesNotMatch(page, /Clear imported file/);

  assert.match(styles, /\.build-import-button input\s*\{[\s\S]*opacity:\s*0/);
});

test("Build planner can import PoB export data into a .build draft", async () => {
  const [planner, page, styles] = await Promise.all([
    loadBuildPlannerModule(),
    readRepoFile("src/spa/pages/BuildPlannerPage.tsx"),
    readRepoFile("src/spa/styles.css")
  ]);
  const pobData = {
    build: { className: "Huntress", ascendClassName: "Amazon", level: 92, mainSkill: "Lightning Arrow" },
    treeSpec: {
      treeVersion: "0.5",
      classId: 0,
      ascendClassId: 0,
      url: "",
      nodes: "123 456",
      weaponSet1Nodes: "789",
      weaponSet2Nodes: ""
    },
    skillGroups: [
      {
        enabled: true,
        slot: "Weapon 1",
        gems: [
          { nameSpec: "Lightning Arrow", level: 20, quality: 0, enabled: true, skillEnabled: true, skillId: "" },
          { nameSpec: "Martial Tempo", level: 20, quality: 0, enabled: true, skillEnabled: true, skillId: "Metadata/Items/Gems/SupportGemMartialTempo" }
        ]
      }
    ],
    notes: "Imported from PoB",
    items: [
      { slot: "Ring", text: "Rarity: Unique\nBlackflame\nAmethyst Ring\n--------" },
      { slot: "Belt", text: "Rarity: Rare\nPain Buckle\nDouble Belt\n--------" }
    ]
  };

  const skills = planner.skillChoicesFromPobImport(pobData, {
    isSupportGem: (gem) => /SupportGem/i.test(gem.skillId),
    resolveSkillId: (gem) => gem.nameSpec === "Lightning Arrow" ? "Metadata/Items/Gems/SkillGemLightningArrow" : "",
    resolveSupportId: (gem) => gem.nameSpec === "Martial Tempo" ? "Metadata/Items/Gems/SupportGemMartialTempo" : ""
  });
  const inventory = planner.inventoryChoicesFromPobImport(pobData, ["Ring1", "Ring2", "Belt1"]);
  const payload = planner.buildPayloadFromPobImport(pobData, {
    plannerData: { ascendancies: { "Huntress|Amazon": "Huntress1" } },
    inventorySlotIds: ["Ring1", "Ring2", "Belt1"],
    isSupportGem: (gem) => /SupportGem/i.test(gem.skillId),
    resolveSkillId: (gem) => gem.nameSpec === "Lightning Arrow" ? "Metadata/Items/Gems/SkillGemLightningArrow" : "",
    resolveSupportId: (gem) => gem.nameSpec === "Martial Tempo" ? "Metadata/Items/Gems/SupportGemMartialTempo" : ""
  });

  assert.equal(planner.isPobExportCode("eN" + "a".repeat(60)), true);
  assert.equal(planner.isPobExportCode("abc"), false);
  assert.deepEqual(plain(planner.passiveIdsFromPobImport(pobData)), ["123", "456", "789"]);
  assert.deepEqual(plain(planner.pobBuildClassNames(pobData, { ascendancies: { "Huntress|Amazon": "Huntress1" } })), {
    className: "Huntress",
    ascendancyName: "Amazon"
  });
  assert.equal(skills[0].skillId, "Metadata/Items/Gems/SkillGemLightningArrow");
  assert.equal(skills[0].supportSkills[0].skillId, "Metadata/Items/Gems/SupportGemMartialTempo");
  assert.equal(inventory.find((row) => row.inventoryId === "Ring1").itemName, "Blackflame");
  assert.equal(inventory.find((row) => row.inventoryId === "Ring1").isUnique, true);
  assert.equal(inventory.find((row) => row.inventoryId === "Belt1").itemName, "Double Belt");
  assert.equal(inventory.find((row) => row.inventoryId === "Belt1").note, "Pain Buckle");
  assert.deepEqual(plain(payload.passives), ["123", "456", "789"]);
  assert.equal(payload.ascendancy, "Huntress1");
  assert.equal(payload.skills[0].id, "Metadata/Items/Gems/SkillGemLightningArrow");
  assert.equal(payload.skills[0].support_skills[0], "Metadata/Items/Gems/SupportGemMartialTempo");
  assert.match(page, /parsePobExportCode/);
  assert.match(page, /isPobExportCode\(pobCode\)/);
  assert.match(page, /treeSnapshotFromPobImport/);
  assert.match(page, /resolvePobSkillId/);
  assert.match(page, /resolvePobSupportId/);
  assert.match(page, /isPobSupportGem/);
  assert.match(styles, /\.build-pob-import\s*\{/);
  assert.match(styles, /\.build-pob-body textarea\s*\{/);
});

test("Build planner decodes PoB export strings with browser zlib XML support", async () => {
  const [plannerSource, planner] = await Promise.all([
    readRepoFile("src/spa/lib/buildPlanner.ts"),
    loadBuildPlannerModule({
      ArrayBuffer,
      atob,
      Blob,
      DecompressionStream,
      Response,
      TextDecoder,
      Uint8Array
    })
  ]);
  const xml = `<PathOfBuilding2><Build className="Huntress" ascendClassName="Amazon" level="92" mainSkill="Lightning Arrow" /><Tree activeSpec="1"><Spec treeVersion="0.5" nodes="123 456"><WeaponSet1 nodes="789" /></Spec></Tree>${"<Notes>large pob body</Notes>".repeat(256)}</PathOfBuilding2>`;
  const pobCode = deflateSync(xml, { level: 9 }).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  assert.match(plannerSource, /export async function decodePobXmlText/);
  assert.match(plannerSource, /DecompressionStream\("deflate"\)/);
  assert.match(plannerSource, /\.pipeThrough\(stream\)/);
  assert.match(plannerSource, /new Response\(readable\)\.arrayBuffer\(\)/);
  assert.doesNotMatch(plannerSource, /writable\.getWriter\(\)/);
  assert.match(plannerSource, /DOMParser\(\)\.parseFromString\(xml,\s*"application\/xml"\)/);
  assert.match(plannerSource, /PathOfBuilding2/);
  assert.match(plannerSource, /activeSpec/);
  assert.match(plannerSource, /WeaponSet1/);
  assert.match(plannerSource, /activeSkillSet/);
  assert.match(plannerSource, /activeItemSet/);
  assert.equal(await planner.decodePobXmlText(pobCode), xml);
});

test("Build planner import preserves existing passives skills and unknown slots", async () => {
  const planner = await loadBuildPlannerModule();
  const imported = planner.parseBuildFileText(JSON.stringify({
    name: "Imported",
    passives: ["passive-a"],
    skills: [{ gems: [] }],
    inventory_slots: [
      { inventory_id: "Belt1", additional_text: "<silver>{Fine Belt}\n\n<grey>{res life}" },
      { inventory_id: "ExtraSlot", additional_text: "<grey>{keep me}" }
    ]
  }));
  const inventory = planner.inventoryChoicesFromBuildPayload(imported, ["Belt1", "Charm1"]);
  const exported = planner.buildPlannerPayload({
    basePayload: imported,
    name: "Edited",
    author: "",
    description: "",
    inventory
  });

  assert.equal(exported.name, "Edited");
  assert.deepEqual(exported.passives, ["passive-a"]);
  assert.equal(exported.skills.length, 1);
  assert.deepEqual(plain(exported.inventory_slots), [
    { inventory_id: "ExtraSlot", additional_text: "<grey>{keep me}" },
    { inventory_id: "Belt1", additional_text: "<silver>{Fine Belt}\n\n<grey>{res life}" }
  ]);
});

test("Build planner imports and exports support skills", async () => {
  const planner = await loadBuildPlannerModule();
  const imported = planner.parseBuildFileText(JSON.stringify({
    name: "Supports",
    skills: [
      {
        id: "Metadata/Items/Gems/SkillGemEarthquake",
        additional_text: "Main slam",
        support_skills: [
          "Metadata/Items/Gems/SupportGemFastForward",
          {
            id: "Metadata/Items/Gems/SupportGemAftershock",
            level_interval: [10, 40],
            additional_text: "Boss swap"
          }
        ]
      }
    ]
  }));
  const skills = planner.skillChoicesFromBuildPayload(imported);
  const exported = planner.buildPlannerPayload({
    basePayload: imported,
    name: "Supports edited",
    author: "",
    description: "",
    inventory: [],
    skills
  });

  assert.equal(skills.length, 1);
  assert.equal(skills[0].supportSkills.length, 2);
  assert.deepEqual(plain(exported.skills), [
    {
      id: "Metadata/Items/Gems/SkillGemEarthquake",
      additional_text: "Main slam",
      support_skills: [
        "Metadata/Items/Gems/SupportGemFastForward",
        {
          id: "Metadata/Items/Gems/SupportGemAftershock",
          level_interval: [10, 40],
          additional_text: "Boss swap"
        }
      ]
    }
  ]);
});

test("Build inventory export ignores empty level fields", async () => {
  const planner = await loadBuildPlannerModule();

  assert.equal(planner.buildLevelInterval("", ""), undefined);
  assert.equal(planner.buildInventorySlot({
    inventoryId: "Charm1",
    itemName: "",
    note: "",
    isUnique: false,
    levelStart: "",
    levelEnd: ""
  }), null);
  assert.deepEqual(plain(planner.buildInventorySlot({
    inventoryId: "Belt1",
    itemName: "Fine Belt",
    note: "",
    isUnique: false,
    levelStart: "12",
    levelEnd: ""
  })), {
    inventory_id: "Belt1",
    level_interval: 12,
    additional_text: "<silver>{Fine Belt}"
  });
  assert.deepEqual(plain(planner.buildInventorySlot({
    inventoryId: "Weapon3",
    itemName: "Cultist Bow",
    note: "",
    isUnique: false,
    levelStart: "",
    levelEnd: ""
  })), {
    inventory_id: "Weapon3",
    additional_text: "<silver>{Cultist Bow}"
  });
});

test("Build equipment picker filters slots, unique items, icons, and base lines", async () => {
  const page = await readRepoFile("src/spa/pages/BuildPlannerPage.tsx");

  assert.match(page, /menu_key/);
  assert.match(page, /icon_url/);
  assert.match(page, /item_category/);
  assert.match(page, /build_slot_categories/);
  assert.match(page, /rarity/);
  assert.match(page, /properties/);
  assert.match(page, /requirements/);
  assert.match(page, /mods/);
  assert.match(page, /isUniqueItem/);
  assert.match(page, /uniqueItemIconPattern/);
  assert.match(page, /displayImageUrl/);
  assert.match(page, /pickerMode === "unique"/);
  assert.match(page, /itemSummaryLines/);
  assert.match(page, /itemBaseName/);
  assert.match(page, /unique \? "" : base/);
  assert.match(page, /choice\.isUnique !== itemUnique/);
  assert.match(page, /Weapon1/);
  assert.match(page, /Weapon2/);
  assert.match(page, /Weapon3/);
  assert.match(page, /Weapon4/);
  assert.match(page, /activeWeaponSet/);
  assert.match(page, /visibleEquipmentSlots/);
  assert.match(page, /build-weapon-set-switch/);
  assert.match(page, /BodyArmour1/);
  assert.match(page, /Helm1/);
  assert.match(page, /Amulet1/);
  assert.match(page, /Ring3/);
  assert.match(page, /LifeFlask1/);
  assert.match(page, /ManaFlask1/);
  assert.match(page, /Charm1/);
  assert.match(page, /Charm2/);
  assert.match(page, /Charm3/);
  assert.match(page, /slotCategories:\s*\["belt"\]/);
  assert.match(page, /slotCategories:\s*\["charm"\]/);
  assert.match(page, /slotCategories:\s*\["life-flask"\]/);
  assert.match(page, /slotCategories:\s*\["mana-flask"\]/);
  assert.match(page, /buildSlotCategories/);
  assert.match(page, /actualItemIconPattern/);
  assert.match(page, /weaponIconPattern/);
  assert.match(page, /flaskIconPattern/);
  assert.match(page, /charmIconPattern/);
  assert.match(page, /isBeltItem/);
  assert.match(page, /beltBaseIconPattern/);
  assert.match(page, /isLifeFlaskItem/);
  assert.match(page, /isManaFlaskItem/);
  assert.match(page, /itemFilter/);
  assert.match(page, /itemFitsSlot/);
  assert.match(page, /if \(!hasActualIcon\(item\)\) return false/);
  assert.doesNotMatch(page, /menuKeys:\s*\["life-flasks",\s*"flasks"\]/);
  assert.doesNotMatch(page, /menuKeys:\s*\["mana-flasks",\s*"flasks"\]/);
  assert.doesNotMatch(page, /Weapon1Swap/);
  assert.doesNotMatch(page, /Weapon2Swap/);
});

test("Item export normalizes dirty menu data into build slot categories", async () => {
  const items = await readItemsExport();
  const byName = (name) => items.find((item) => item.name === name);
  const categories = (item) => new Set(item?.build_slot_categories ?? []);

  assert.ok(items.length > 0, "items export should contain rows");
  assert.ok(items.every((item) => Array.isArray(item.build_slot_categories)), "all rows should expose build_slot_categories");

  assert.equal(byName("Charm Charges")?.item_category, "other");
  assert.equal(categories(byName("Charm Charges")).size, 0);
  assert.equal(categories(byName("Flasks")).size, 0);

  assert.ok(categories(byName("Double Belt")).has("belt"));
  assert.equal(categories(byName("Double Belt")).has("charm"), false);
  assert.ok(categories(byName("Birthright Buckle")).has("belt"));
  assert.equal(categories(byName("Birthright Buckle")).has("charm"), false);

  assert.ok(categories(byName("Amethyst Charm")).has("charm"));
  assert.equal(categories(byName("Amethyst Charm")).has("belt"), false);
  assert.ok(categories(byName("Lesser Life Flask")).has("life-flask"));
  assert.ok(categories(byName("Lesser Mana Flask")).has("mana-flask"));
  assert.equal(byName("Blackflame")?.rarity, "unique");
  assert.equal(byName("Amethyst Ring")?.rarity || "", "");
});

test("Build slot categories do not leak passive or wrong equipment records", async () => {
  const items = await readItemsExport();
  const categorized = items.filter((item) => item.build_slot_categories?.length);

  assert.ok(categorized.length > 0, "expected categorized equipment rows");
  for (const item of categorized) {
    const icon = item.icon_url || "";
    assert.match(icon, /\/2DItems\//, `${item.name} must be an actual item icon`);
    if (item.build_slot_categories.includes("belt")) assert.match(icon, /\/2DItems\/Belts\//, `${item.name} must use a belt icon`);
    if (item.build_slot_categories.includes("charm")) assert.match(icon, /\/2DItems\/Charms\//, `${item.name} must use a charm icon`);
    if (item.build_slot_categories.includes("life-flask")) assert.match(icon, /\/2DItems\/Flasks\//, `${item.name} must use a flask icon`);
    if (item.build_slot_categories.includes("mana-flask")) assert.match(icon, /\/2DItems\/Flasks\//, `${item.name} must use a flask icon`);
  }
});

test("Build equipment grid follows the poe.ninja character slot layout", async () => {
  const styles = await readRepoFile("src/spa/styles.css");

  assert.match(styles, /grid-template-columns:\s*repeat\(8,\s*var\(--build-slot-cell\)\)/);
  assert.match(styles, /setswitch\s+setswitch\s+\./);
  assert.match(styles, /\.build-weapon-set-switch/);
  assert.doesNotMatch(styles, /wtab\s+wtab/);
  assert.doesNotMatch(styles, /otab\s+otab/);
  assert.match(styles, /weapon\s+weapon\s+ring3\s+body\s+body\s+amulet\s+offhand\s+offhand/);
  assert.match(styles, /trinket\s+lifeflask\s+charm1\s+charm2\s+charm3\s+\.\s+manaflask/);
  assert.doesNotMatch(styles, /charms\s+charms\s+charms\s+charms/);
});

test("Build equipment slots and picker cards keep long item names contained", async () => {
  const [page, styles] = await Promise.all([
    readRepoFile("src/spa/pages/BuildPlannerPage.tsx"),
    readRepoFile("src/spa/styles.css")
  ]);

  assert.match(page, /shortLabel:\s*"HP"/);
  assert.match(page, /shortLabel:\s*"MP"/);
  assert.match(styles, /\.build-equip-slot\s*\{[\s\S]*height:\s*100%/);
  assert.match(styles, /\.build-equip-slot\s*\{[\s\S]*min-height:\s*0/);
  assert.match(styles, /\.build-picker-list\s*\{[\s\S]*grid-auto-rows:\s*max-content/);
  assert.match(styles, /\.build-picker-copy strong\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(styles, /\.build-equip-slot\.has-item\s*\{[\s\S]*grid-template-rows:\s*1fr/);
  assert.match(styles, /\.build-equip-slot\.has-item :where\(\.build-slot-label,\s*strong,\s*small\)\s*\{[\s\S]*display:\s*none/);
  assert.doesNotMatch(styles, /\.build-equip-slot\.has-item strong,\s*\n\.build-equip-slot\.has-item small\s*\{[\s\S]*position:\s*absolute/);
  assert.doesNotMatch(page, /<strong>\{choice\?\.itemName\}<\/strong>/);
  assert.doesNotMatch(page, /<small>\{choice\.baseName\}<\/small>/);
});

test("Build planner page explains how to import the exported file in-game", async () => {
  const page = await readRepoFile("src/spa/pages/BuildPlannerPage.tsx");

  assert.match(page, /howTitle/);
  assert.match(page, /Download the \.build file from this page/);
  assert.match(page, /Documents\\\\My Games\\\\Path of Exile 2\\\\BuildPlanner\\\\/);
  assert.match(page, /Open the in-game build tool and select your imported build/);
  assert.match(page, /BUILD_HELP_SEEN_KEY/);
  assert.match(page, /readBuildHelpSeen/);
  assert.match(page, /writeBuildHelpSeen/);
  assert.match(page, /className="build-help-button build-help-button--panel"/);
  assert.match(page, /className="build-help-dialog"/);
  assert.doesNotMatch(page, /className="build-how"/);
  assert.doesNotMatch(page, /Use the current passive tree or a saved snapshot/);
  assert.doesNotMatch(page, /The game watches Documents/);
  assert.doesNotMatch(page, /Path of Exile 2 Build Planner integrates/);
});

test("Item hint rows use official build planner inventory fields", async () => {
  const planner = await readRepoFile("src/spa/lib/buildPlanner.ts");

  assert.match(planner, /inventory_id/);
  assert.match(planner, /level_interval/);
  assert.match(planner, /unique_name/);
  assert.match(planner, /additional_text/);
  assert.match(planner, /<silver>\{/);
  assert.match(planner, /<grey>\{/);
});

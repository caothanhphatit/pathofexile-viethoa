// Build Planner calculation features: stat sheet / conditions definitions,
// gem details round trip, request body, and the page wiring.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { loadPlannerLib, plannerCalculationRequest, repoRoot } from "../scripts/lib/planner-node.mjs";
import { readFixtures } from "../scripts/check-pob-parity.mjs";

const require = createRequire(import.meta.url);
const plain = (value) => JSON.parse(JSON.stringify(value));

const loadStatsLib = async () => {
  const source = await readFile(join(repoRoot, "src/spa/lib/buildStats.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require, Math, Number, String, Array, Infinity });
  return module.exports;
};

test("conditions panel edits PoB config inputs and keeps the rest", async () => {
  const stats = await loadStatsLib();
  const boss = stats.CONFIG_OPTIONS.find((option) => option.name === "enemyIsBoss");
  const shocked = stats.CONFIG_OPTIONS.find((option) => option.name === "conditionEnemyShocked");
  const nearby = stats.CONFIG_OPTIONS.find((option) => option.name === "multiplierNearbyEnemies");
  const imported = [
    { name: "enemyIsBoss", kind: "string", value: "None" },
    { name: "conditionEnemyChilled", kind: "boolean", value: true },
    { name: "questAct 3Venom CryptsVenom Draught", kind: "string", value: "25% increased Mana Regeneration Rate" }
  ];
  assert.equal(stats.configInputValue(imported, boss), "None");
  assert.equal(stats.configInputValue(imported, shocked), false);
  assert.equal(stats.configInputValue([], boss), "Pinnacle", "PoB's default enemy is a pinnacle boss");

  let next = stats.setConfigInput(imported, shocked, true);
  assert.deepEqual(plain(next.find((row) => row.name === "conditionEnemyShocked")), { name: "conditionEnemyShocked", kind: "boolean", value: true });
  next = stats.setConfigInput(next, shocked, false);
  assert.equal(next.some((row) => row.name === "conditionEnemyShocked"), false, "unticking removes the input");
  next = stats.setConfigInput(next, boss, "Pinnacle");
  assert.equal(next.some((row) => row.name === "enemyIsBoss"), false, "back to PoB's default removes the input");
  assert.equal(stats.setConfigInput([], nearby, 1000).at(-1).value, 100, "numbers are clamped");
  assert.deepEqual(plain(stats.otherConfigInputs(imported).map((row) => row.name)), ["questAct 3Venom CryptsVenom Draught"]);

  for (const option of stats.CONFIG_OPTIONS) {
    assert.ok(option.vi && option.hint, `${option.name} needs a Vietnamese label and hint`);
  }
});

test("conditions and stats only use names Path of Building knows", { skip: !existsSync(join(repoRoot, "..", "pob-core", "src", "Modules", "ConfigOptions.lua")) && "PoB source not checked out next to the repo" }, async () => {
  const stats = await loadStatsLib();
  const pobSrc = join(repoRoot, "..", "pob-core", "src");
  const configSource = readFileSync(join(pobSrc, "Modules", "ConfigOptions.lua"), "utf8");
  for (const option of stats.CONFIG_OPTIONS) {
    assert.match(configSource, new RegExp(`var = "${option.name}"`), option.name);
  }
  const calcSource = ["CalcOffence.lua", "CalcDefence.lua", "CalcPerform.lua", "Calcs.lua"]
    .map((file) => readFileSync(join(pobSrc, "Modules", file), "utf8")).join("\n");
  for (const section of stats.STAT_SECTIONS) {
    for (const def of section.stats) {
      // Some keys are built as pool.."Unreserved" or damageType.."MaximumHitTaken".
      const prefixes = ["Life", "Mana", "Spirit", "EnergyShield", "Physical", "Fire", "Cold", "Lightning", "Chaos"];
      const known = calcSource.includes(def.stat)
        || prefixes.some((prefix) => def.stat.startsWith(prefix) && calcSource.includes(`"${def.stat.slice(prefix.length)}"`));
      assert.ok(known, `PoB never writes output.${def.stat}`);
      assert.ok(def.vi && def.hint, `${def.stat} needs a Vietnamese label and hint`);
    }
  }
});

test("stat sheet formats numbers and shows what changed", async () => {
  const stats = await loadStatsLib();
  assert.equal(stats.formatStat(326436.6, "short"), "326.4k");
  assert.equal(stats.formatStat(2_150_000, "short"), "2.15M");
  assert.equal(stats.formatStat(47.66, "pct1"), "47.7%");
  assert.equal(stats.formatStat(1.04, "modpct"), "+4%");
  assert.equal(stats.formatStat(undefined, "int"), "-");

  const dps = { higherIsBetter: true };
  const cost = { higherIsBetter: false };
  assert.equal(stats.statChange(dps, 100, 100), undefined);
  assert.deepEqual(plain(stats.statChange(dps, 150, 100)), { delta: 50, ratio: 0.5, better: true });
  assert.equal(stats.statChange(cost, 150, 100).better, false, "a higher cost is worse");
  assert.equal(stats.formatStatChange(stats.statChange(dps, 569_200, 326_400), "short"), "+242.8k (+74%)");
});

test("items picked on the site go to PoB with their mods", async () => {
  const stats = await loadStatsLib();
  assert.equal(
    stats.pobItemTextFromRecord({
      name: "Blackflame",
      rarity: "unique",
      baseName: "Amethyst Ring",
      mods: ["+(7—13)% to Chaos Resistance", "use unique blackflame ignite effect [1]"]
    }),
    "Rarity: Unique\nBlackflame\nAmethyst Ring\n+(7-13)% to Chaos Resistance"
  );
  assert.equal(stats.pobItemTextFromRecord({ name: "Vaal Cuirass", rarity: "normal" }), "Rarity: Normal\nVaal Cuirass");
  assert.equal(stats.pobItemTextFromRecord({ name: "" }), "");
});

test("planner keeps PoB gem details through saves, and drops them for a new gem", async () => {
  const lib = await loadPlannerLib();
  const skill = {
    id: "s1", skillId: "Metadata/Items/Gems/SkillGemArc", note: "", levelStart: "", levelEnd: "",
    gemLevel: 21, gemQuality: 20, pobGemId: "Metadata/Items/Gems/SkillGemArc", pobVariantId: "Arc",
    pobAttrs: { corruptLevel: "1" }, disabled: true, itemSlot: "Weapon 1", mainActiveSkill: 2,
    supportSkills: [{ id: "x", skillId: "Metadata/Items/Gems/SupportGemFoo", note: "", levelStart: "", levelEnd: "", gemLevel: 3, disabled: true, active: true }]
  };
  const back = lib.skillChoiceFromBuildSkill(plain(lib.buildSkill(skill)));
  for (const key of ["gemLevel", "gemQuality", "pobGemId", "pobVariantId", "disabled", "itemSlot", "mainActiveSkill"]) {
    assert.deepEqual(back[key], skill[key], key);
  }
  assert.deepEqual(plain(back.pobAttrs), { corruptLevel: "1" });
  assert.equal(back.supportSkills[0].gemLevel, 3);
  assert.equal(back.supportSkills[0].disabled, true);
  assert.equal(back.supportSkills[0].active, true);

  const saved = lib.normalizeBuildProject(plain(lib.createBuildProject({ name: "x", author: "", description: "", skills: [skill] })));
  assert.equal(saved.skills[0].gemLevel, 21);
  assert.deepEqual(plain(saved.skills[0].pobAttrs), { corruptLevel: "1" });

  const replaced = lib.withoutPobGemDetails(skill);
  assert.equal(replaced.pobGemId, undefined);
  assert.equal(replaced.pobAttrs, undefined);
  assert.equal(replaced.gemLevel, 21, "level and quality stay with the slot");
});

test("calculation request: picked items, edited conditions, extra slots, disabled gems", async () => {
  const lib = await loadPlannerLib();
  const empty = (slotId) => ({ id: slotId, inventoryId: slotId, itemName: "", note: "", isUnique: false, levelStart: "", levelEnd: "" });
  const rows = [
    { ...empty("Ring1"), itemName: "Blackflame", isUnique: true, itemSlug: "Blackflame" },
    { ...empty("PassiveJewel:61419"), itemName: "Sapphire", rawText: "Rarity: Rare\nX\nSapphire" },
    { ...empty("PobSlot:Arm 1"), itemName: "Augment", rawText: "Rarity: Magic\nAugment" }
  ];
  const inventory = lib.inventoryForSlots(rows, ["Ring1", "Ring2"], empty);
  assert.deepEqual(plain(inventory.map((row) => row.inventoryId)), ["Ring1", "Ring2", "PassiveJewel:61419", "PobSlot:Arm 1"]);

  const body = lib.calculationRequestBody({
    payload: { className: "Witch", ascendancy: "Witch2", level: 80, config_inputs: [{ name: "a", kind: "boolean", value: true }], weapon_set_passives: { 1: ["5"] } },
    passives: ["1", "x"],
    inventory,
    skills: [{
      id: "s", skillId: "Metadata/Items/Gems/SkillGemArc", note: "", levelStart: "", levelEnd: "", disabled: true,
      supportSkills: [{ id: "t", skillId: "SupportFoo", note: "", levelStart: "", levelEnd: "", disabled: true }]
    }],
    activeWeaponSet: 2,
    mainSocketGroup: 1,
    configInputs: [{ name: "b", kind: "number", value: 3 }],
    itemText: (choice) => (choice.itemSlug === "Blackflame" ? "Rarity: Unique\nBlackflame\nAmethyst Ring" : undefined)
  });
  assert.deepEqual(plain(body.passives), [1]);
  assert.equal(body.inventory_slots.length, 3, "empty Ring2 is not sent");
  assert.equal(body.inventory_slots[0].raw_text, "Rarity: Unique\nBlackflame\nAmethyst Ring");
  assert.deepEqual(plain(body.config_inputs), [{ name: "b", kind: "number", value: 3 }], "edited conditions replace the imported ones");
  assert.equal(body.config, undefined);
  assert.equal(body.skills[0].group_enabled, false);
  assert.equal(body.skills[0].support[0].enabled, false);
  assert.equal(body.skills[0].level, 20, "gems without a level calculate at 20");
  assert.equal(body.activeWeaponSet, 2);
});

test("planner page uses the shared calculation request and the new panels", async () => {
  const page = await readFile(join(repoRoot, "src/spa/pages/BuildPlannerPage.tsx"), "utf8");
  assert.match(page, /calculationRequestBody\(\{/);
  assert.match(page, /<BuildStatDetails /);
  assert.match(page, /<BuildConfigPanel/);
  assert.match(page, /inventoryForSlots\(rows, equipmentSlotIds/, "reopened builds keep jewels and extra slots");
  assert.match(page, /withoutPobGemDetails\(/, "picking a new gem drops the old gem's PoB ids");
  assert.match(page, /planner_config_inputs/, "edited conditions are saved with the build");
  assert.match(page, /pobItemTextFromRecord\(/);
  assert.doesNotMatch(page, /if \(!importedBuild\?\.payload\) return;\n\s+setIsCalculating/, "builds made from scratch are calculated too");
});

test("PoB code export opens in PoB as the same build the planner calculated", async () => {
  const lib = await loadPlannerLib();
  const [fixture] = readFixtures(["druid-oracle"]);
  const { body } = await plannerCalculationRequest(fixture.code);
  const xml = buildPobXml(body);
  const code = await lib.encodePobXmlText(xml);
  assert.equal(lib.isPobExportCode(code), true);
  assert.equal(await lib.decodePobXmlText(code), xml);
  // Importing the exported code again gives the same calculation.
  const again = await plannerCalculationRequest(code);
  assert.equal(buildPobXml(again.body), xml);
});

test("every skill group gets its own DPS from PoB's per-skill list", async () => {
  const stats = await loadStatsLib();
  const rows = [
    { name: "Living Bomb", dps: 1000 },
    { name: "Comet", dps: 300 },
    { name: "Arc", dps: 200 },
    { name: "Full Culling DPS", dps: 99 },
    { name: "Power Siphon", dps: 50, count: 2 },
    { name: "Power Siphon", dps: 10 }
  ];
  const groups = [["Cast on Elemental Ailment", "Living Bomb"], ["Power Siphon"], ["Purity of Fire"], ["Elemental Invocation", "Arc"], ["Power Siphon"], ["Cast on Critical", "Comet"]];
  assert.deepEqual(plain(stats.skillDpsByGroup(rows, groups)), [1000, 100, 0, 200, 10, 300]);
  assert.deepEqual(plain(stats.skillDpsByGroup(undefined, [["Arc"]])), [0]);
});

// Planner helpers added with the equipment rules: "cannot use this build yet" warnings,
// the weapon a skill needs, item numbers with local mods, the inventory search ranking,
// the tree point count and the tree-page PoB import.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { loadSpaLib, repoRoot } from "../scripts/lib/planner-node.mjs";
import * as rules from "../src/shared/equipment-rules.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));

/** A src/spa file whose imports are the shared rules and other src/spa/lib modules. */
async function loadSpaFile(relativePath) {
  const source = await readFile(join(repoRoot, relativePath), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const deps = new Map([["../../shared/equipment-rules.mjs", rules]]);
  for (const match of js.matchAll(/require\("\.\/([\w-]+)"\)/g)) deps.set(`./${match[1]}`, await loadSpaLib(match[1]));
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require: (id) => {
      if (!deps.has(id)) throw new Error(`unexpected import ${id} in ${relativePath}`);
      return deps.get(id);
    }
  });
  return module.exports;
}

// ── Warnings ───────────────────────────────────────────────────────────────

test("warnings: item level comes from the item text, else from the site's record", async () => {
  const { itemLevelRequirement } = await loadSpaFile("src/spa/lib/buildWarnings.ts");
  assert.equal(itemLevelRequirement("Rarity: RARE\nSoul Nock\nDualstring Bow\nLevelReq: 77\nImplicits: 0"), 77);
  assert.equal(itemLevelRequirement("Item Class: Rings\nRarity: Unique\nBlackflame\nAmethyst Ring\n--------\nRequires: Level 20\n--------\n+11% to Chaos Resistance"), 20);
  assert.equal(itemLevelRequirement("Rarity: Rare\nX\nY\n--------\nRequirements:\nLevel: 65\nStr: 59"), 65);
  assert.equal(itemLevelRequirement("Rarity: NORMAL\nDualstring Bow", ["Requires: Level 28, 52 Dex"]), 28);
  assert.equal(itemLevelRequirement("Rarity: NORMAL\nDualstring Bow"), undefined);
  assert.equal(itemLevelRequirement(undefined, []), undefined);
});

test("warnings: level 20 character with level 77 gear, level 20 gems and 157 passives", async () => {
  const { buildWarnings } = await loadSpaFile("src/spa/lib/buildWarnings.ts");
  const input = {
    level: 20,
    locale: "vi",
    items: [
      { slotId: "Weapon1", slotLabel: "Vũ khí I", name: "Soul Nock", levelReq: 77 },
      { slotId: "Helm1", slotLabel: "Mũ", name: "Viper Crest", levelReq: 80 },
      { slotId: "Ring1", slotLabel: "Nhẫn", name: "Gold Ring", levelReq: 12 }
    ],
    gems: [{ name: "Ice Shot", gemLevel: 20 }, { name: "Frost Bomb", gemLevel: 3 }],
    stats: { Str: 15, Dex: 60, Int: 300, ReqStr: 86, ReqDex: 157, ReqInt: 120, "DexRequirementsOnWeapon 1": 104, "StrRequirementsOnHelmet": 86, ExtraPoints: 0 },
    activeWeaponSet: 1,
    points: { passive: 147, ascendancy: 8, set1: 24, set2: 24 }
  };
  const warnings = plain(buildWarnings(input));
  assert.deepEqual(warnings.map((row) => row.kind), ["item-level", "gem-level", "attribute", "attribute", "passive-points"]);
  assert.match(warnings[0].text, /^2 món đồ cần cấp cao hơn cấp 20.*Viper Crest \(cấp 80\), Soul Nock \(cấp 77\)/);
  assert.match(warnings[1].text, /^1 gem kỹ năng.*Ice Shot Lv 20 \(cấp 90\)/);
  assert.match(warnings[2].text, /Thiếu Sức mạnh \(Str\): cần 86, nhân vật có 15\. Yêu cầu từ: Viper Crest \(86\)/);
  assert.match(warnings[3].text, /Thiếu Khéo léo \(Dex\): cần 157, nhân vật có 60\. Yêu cầu từ: gem kỹ năng \(157\), Soul Nock \(104\)/);
  assert.match(warnings[4].text, /dùng 123 điểm: cần khoảng cấp 100, nhân vật đang cấp 20/);

  // The same build at level 100 with its attributes met raises nothing.
  assert.deepEqual(plain(buildWarnings({ ...input, level: 100, stats: { ...input.stats, Str: 90, Dex: 160 } })), []);
  // English, and no calculation yet: only what needs no PoB output.
  const early = plain(buildWarnings({ ...input, locale: "en", stats: null }));
  assert.deepEqual(early.map((row) => row.kind), ["item-level", "gem-level", "passive-points"]);
  assert.match(early[0].text, /^2 item\(s\) need a higher level than 20/);
});

test("warnings: hard point limits use PoB's ExtraPoints and wait for a calculation", async () => {
  const { buildWarnings, freeAllocatedNames, pobRequirementSlot } = await loadSpaFile("src/spa/lib/buildWarnings.ts");
  const points = { passive: 125, ascendancy: 9, set1: 25, set2: 0 };
  assert.deepEqual(plain(buildWarnings({ level: 100, locale: "vi", points: { ...points, ascendancy: 8 }, stats: null })), [], "point limits are not judged before PoB answered");
  const strict = plain(buildWarnings({ level: 100, locale: "vi", points, stats: { ExtraPoints: 0 } }));
  assert.deepEqual(strict.map((row) => row.kind), ["passive-points", "ascendancy-points", "weapon-set-points"]);
  assert.match(strict[0].text, /dùng 125 điểm, nhiều hơn tối đa 123/);
  assert.match(strict[2].text, /Bộ vũ khí 1 dùng 25 điểm, tối đa là 24/);
  const withExtras = plain(buildWarnings({ level: 100, locale: "vi", points: { ...points, ascendancy: 8 }, stats: { ExtraPoints: 2, PassivePointsToWeaponSetPoints: 1 } }));
  assert.deepEqual(withExtras, [], "a ladder character with quest and item bonuses is within its limits");

  assert.deepEqual(plain(freeAllocatedNames(["Rarity: RARE\nX\nGold Amulet\n{enchant}Allocates Vulgar Methods\n+5 to Strength", undefined])), ["vulgar methods"]);
  assert.equal(pobRequirementSlot("Weapon3", 2), "Weapon 1", "the set in use is PoB's Weapon 1/2");
  assert.equal(pobRequirementSlot("Weapon2", 2), "Weapon 2 Swap");
  assert.equal(pobRequirementSlot("BodyArmour1", 1), "Body Armour");
  assert.equal(pobRequirementSlot("Charm1", 1), undefined);
});

test("warnings: PoB's passive point budget", () => {
  assert.equal(rules.MAX_PASSIVE_POINTS, 123, "99 from levels + 24 quest points");
  assert.equal(rules.WEAPON_SET_POINT_LIMIT, 24);
  assert.deepEqual(rules.passivePointUse({ pointsUsed: 147, set1: 24, set2: 24 }), { used: 123, max: 123, requiredLevel: 100 });
  assert.equal(rules.passivePointUse({ pointsUsed: 0 }).requiredLevel, 1);
  assert.ok(rules.passivePointUse({ pointsUsed: 60 }).requiredLevel > 40);
  assert.equal(rules.passivePointUse({ pointsUsed: 125, extra: 2 }).max, 125);
  assert.ok(rules.isChoiceOptionNode("664") && !rules.isChoiceOptionNode(1));
});

// ── The weapon a skill needs ───────────────────────────────────────────────

test("skill weapon: the gem's requirement against the active weapon set", async () => {
  const { skillWeaponNeed, skillWeaponMissing, skillWeaponHint } = await loadSpaFile("src/spa/lib/skillWeapon.ts");
  const item = (baseName) => ({ itemName: baseName, baseName, rawText: `Rarity: RARE\nName\n${baseName}` });
  const bows = skillWeaponNeed(["Requires: Level (1—90), (4—157) Dex", "Requires: Bows"]);
  assert.deepEqual(plain(bows), { label: "Bows", classes: ["Bow"], kind: "classes", allowUnarmed: false });
  assert.deepEqual(plain(skillWeaponNeed(["Requires: One Hand Maces, Two Hand Maces"]).classes), ["One Hand Mace", "Two Hand Mace"]);
  assert.equal(skillWeaponNeed(["Requires: Level (1—90), (4—157) Int"]), null, "a spell asks for no weapon");
  assert.equal(skillWeaponNeed(["Requires: Any Martial Weapon"]).kind, "martial");
  assert.equal(skillWeaponNeed(["Requires: Unarmed"]).kind, "unarmed");

  assert.equal(skillWeaponMissing(bows, { main: item("Aegis Quarterstaff") }), true);
  assert.equal(skillWeaponMissing(bows, { main: item("Dualstring Bow"), off: item("Blunt Quiver") }), false);
  assert.equal(skillWeaponMissing(bows, {}), true, "empty hands are not a bow");
  assert.equal(skillWeaponMissing(bows, { main: item("Some Future Base") }), false, "an unknown base is not judged");
  const maces = skillWeaponNeed(["Requires: One Hand Maces, Two Hand Maces"]);
  assert.equal(skillWeaponMissing(maces, { main: item("Aberrant Sledge") }), false);
  assert.equal(skillWeaponMissing(maces, { main: item("Golden Blade") }), true);
  const martial = skillWeaponNeed(["Requires: Any Martial Weapon"]);
  assert.equal(skillWeaponMissing(martial, { main: item("Acrid Wand") }), true, "a wand is not a martial weapon");
  assert.equal(skillWeaponMissing(martial, { main: item("Dualstring Bow") }), false);
  assert.equal(skillWeaponMissing(skillWeaponNeed(["Requires: Unarmed"]), {}), false);
  assert.equal(skillWeaponMissing(skillWeaponNeed(["Requires: Unarmed"]), { main: item("Dualstring Bow") }), true);
  assert.equal(skillWeaponMissing(skillWeaponNeed(["Requires: Any Shield"]), { main: item("Golden Blade"), off: item("Aged Tower Shield") }), false);
  assert.equal(skillWeaponMissing(skillWeaponNeed(["Requires: Any Shield"]), { main: item("Golden Blade") }), true);

  const sets = { 1: { main: item("Aegis Quarterstaff") }, 2: { main: item("Dualstring Bow") } };
  const hint = skillWeaponHint({ skillName: "Ice Shot", requirements: ["Requires: Bows"], activeSet: 1, sets, locale: "vi" });
  assert.match(hint, /^Ice Shot cần Bows, nhưng bộ vũ khí I đang cầm Aegis Quarterstaff nên không gây sát thương\. Bộ II dùng được/);
  assert.equal(skillWeaponHint({ skillName: "Ice Shot", requirements: ["Requires: Bows"], activeSet: 2, sets, locale: "vi" }), null);
  const noOther = skillWeaponHint({ skillName: "Siege Ballista", requirements: ["Requires: Crossbows"], activeSet: 1, sets: { 1: sets[1], 2: {} }, locale: "en" });
  assert.match(noOther, /^Siege Ballista needs Crossbows, but weapon set I holds Aegis Quarterstaff, so it deals no damage\.$/);
  assert.equal(skillWeaponHint({ skillName: "Arc", requirements: ["Requires: Level (1—90)"], activeSet: 1, sets, locale: "vi" }), null);
});

// ── Item numbers with local mods (PoB's formulas) ──────────────────────────

test("item numbers: weapon damage, speed and crit with local mods and quality", async () => {
  const { applyLocalMods } = await loadSpaLib("itemLocalStats");
  const bow = ["Physical Damage: 56-84", "Critical Hit Chance: 5%", "Attacks per Second: 1.2"];
  const lines = plain(applyLocalMods(bow, ["254% increased Physical Damage", "Adds 12 to 21 Physical Damage", "Adds 5 to 9 Fire Damage", "12% increased Attack Speed", "+2.5% to Critical Hit Chance", "+30 to Dexterity"], 20));
  // (56 + 12) * 3.54 * 1.2 = 288.86 -> 289; (84 + 21) * 3.54 * 1.2 = 446.04 -> 446
  assert.deepEqual(lines.map((row) => row.line), ["Physical Damage: 289-446", "Fire Damage: 5-9", "Critical Hit Chance: 7.5%", "Attacks per Second: 1.34"]);
  assert.deepEqual(lines.map((row) => row.changed), [true, true, true, true]);
  assert.deepEqual(lines.map((row) => row.index), [0, -1, 1, 2]);
  const untouched = plain(applyLocalMods(bow, ["+30 to Dexterity", "15% increased Elemental Damage with Attacks"], 0));
  assert.deepEqual(untouched.map((row) => [row.line, row.changed]), bow.map((line) => [line, false]));
});

test("item numbers: defences, block and Spirit", async () => {
  const { applyLocalMods } = await loadSpaLib("itemLocalStats");
  const shown = (base, mods, quality = 0) => plain(applyLocalMods(base, mods, quality)).map((row) => row.line);
  // round((83 + 58) * (1 + (100 + 64) / 100) * 1.26) = 469 (the boots of a ladder build, PoB shows 469)
  assert.deepEqual(shown(["Energy Shield: 83"], ["100% increased Energy Shield", "64% increased Armour, Evasion and Energy Shield", "+58 to maximum Energy Shield"], 26), ["Energy Shield: 469"]);
  assert.deepEqual(shown(["Armour: 100", "Evasion Rating: 80", "Base Movement Speed: -0.03"], ["50% increased Armour and Evasion", "+20 to Armour", "+10 to Evasion Rating"], 20), ["Armour: 216", "Evasion Rating: 162", "Base Movement Speed: -0.03"]);
  assert.deepEqual(shown(["Block chance: 26%", "Armour: 145"], ["20% increased Block chance"]), ["Block chance: 31%", "Armour: 145"]);
  assert.deepEqual(shown(["Spirit: 100"], ["65% increased Spirit"]), ["Spirit: 165"], "the sceptre the testers saw at 100");
  assert.deepEqual(shown(["Spirit: 100"], ["20% increased Spirit", "+10 to Spirit"]), ["Spirit: 132"]);
  // A ring has no Energy Shield of its own: the mod is global and no line appears.
  assert.deepEqual(shown([], ["+40 to maximum Energy Shield"]), []);
  assert.deepEqual(shown(["Throw Time: 0.80 Sec"], ["20% increased Attack Speed"]), ["Throw Time: 0.80 Sec"]);
});

// ── Inventory search ───────────────────────────────────────────────────────

test("item search: a whole word or the class beats a longer word that starts with the query", async () => {
  const { itemSearchRank, searchItems, countMatches } = await loadSpaLib("itemSearch");
  const items = [
    { title: "Wanderer Armour", itemClass: "Body Armours" },
    { title: "Acrid Wand", itemClass: "Wands" },
    { title: "Adonia's Ego", base: "Siphoning Wand", itemClass: "Wands" },
    { title: "Elbow Guards", itemClass: "Gloves" },
    { title: "Dualstring Bow", itemClass: "Bows" },
    { title: "Alloy Crossbow", itemClass: "Crossbows" },
    { title: "Aberrant Sledge", itemClass: "Two Hand Maces" }
  ];
  const names = (query) => plain(searchItems(items, query, (item) => item).map((item) => item.title));
  assert.deepEqual(names("wand"), ["Acrid Wand", "Adonia's Ego", "Wanderer Armour"]);
  assert.deepEqual(names("bow"), ["Dualstring Bow", "Elbow Guards", "Alloy Crossbow"], "the bow first; mere substrings keep their order");
  assert.deepEqual(names("two hand mace"), ["Aberrant Sledge"]);
  assert.deepEqual(names("maces"), ["Aberrant Sledge"], "plural class names work");
  assert.deepEqual(names("zzz"), []);
  assert.equal(itemSearchRank(items[1], "acrid wand"), 0);
  assert.equal(itemSearchRank(items[0], "wand"), 2);
  assert.equal(countMatches(items, "wand", (item) => item), 3);
  assert.equal(searchItems(items, "a", (item) => item, 2).length, 2);
});

// ── Tree points ────────────────────────────────────────────────────────────

test("tree points: one count for the header and the saved-tree list", async () => {
  const { treePointsSpent } = await loadSpaFile("src/spa/lib/treePoints.ts");
  const isStart = (id) => id === "1" || id === "2";
  const ids = ["1", "2", "10", "11", "12", "13", "14"];
  // An imported tree does not know its start nodes yet: the tree data tells.
  assert.equal(treePointsSpent({ allocatedIds: ids, startIds: [] }, isStart), 5);
  assert.equal(treePointsSpent({ allocatedIds: ids, startIds: ["1", "2"] }, isStart), 5, "the same tree once the page filled startIds in");
  assert.equal(treePointsSpent({ allocatedIds: ids, startIds: [] }), 7, "without tree data nothing more can be left out");
  // A node taken in both weapon sets is paid once.
  assert.equal(treePointsSpent({ allocatedIds: ids, startIds: [], weaponSets: { 10: 1, 11: 1, 12: 2 } }, isStart), 4);
  assert.equal(treePointsSpent(null), 0);
});

test("tree page import: weapon-set nodes and attribute picks of a PoB code are kept", async () => {
  const { treePicksFromSpec } = await loadSpaFile("src/spa/passive/pob.ts");
  const picks = plain(treePicksFromSpec({ nodes: "5,10,11,12,20", weaponSet1: "10,11", weaponSet2: "12,99", strNodes: "20", dexNodes: "", intNodes: "5,777" }));
  assert.deepEqual(picks.weaponSets, { 10: 1, 11: 1, 12: 2, 99: 2 });
  assert.deepEqual(picks.nodeIds, ["5", "10", "11", "12", "20", "99"], "a weapon-set node missing from the list is still allocated");
  assert.deepEqual(picks.attributeChoices, { 20: "str", 5: "int" }, "picks for nodes the build does not have are dropped");
  assert.deepEqual(plain(treePicksFromSpec({ nodes: "1,2" })), { nodeIds: ["1", "2"], weaponSets: {}, attributeChoices: {} });
});

test("tree page import: a fixture with weapon sets reads 24 / 24, not 0 / 0", async () => {
  const { treePicksFromSpec } = await loadSpaFile("src/spa/passive/pob.ts");
  const planner = await loadSpaLib("buildPlanner");
  const { readFileSync } = await import("node:fs");
  const code = JSON.parse(readFileSync(join(repoRoot, "tests/fixtures/pob-builds/mercenary-gemling.json"), "utf8")).code;
  const pob = await planner.parsePobExportCode(code);
  const picks = treePicksFromSpec({ nodes: pob.treeSpec.nodes, weaponSet1: pob.treeSpec.weaponSet1Nodes, weaponSet2: pob.treeSpec.weaponSet2Nodes });
  const counts = planner.weaponSetPointCounts(picks.weaponSets, picks.nodeIds);
  assert.deepEqual(plain(counts), { set1: 24, set2: 24, shared: 24 });
});

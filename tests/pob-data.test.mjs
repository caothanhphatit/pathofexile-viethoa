import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { classify, compareGems, compareUniques, matchRecords, normText } from "../scripts/pob-data/compare.mjs";
import { DEFAULT_POB_DIR, dumpPobData, findLuajit, sortKeys } from "../scripts/pob-data/dump.mjs";
import {
  buildGemRecord,
  describedLines,
  formatG,
  formatRange,
  gemAttributeRequirement,
  mergeLevelLines,
  qualityLine,
  rawStatLine,
  slugFromName,
  toSiteRanges
} from "../scripts/pob-data/generate-gems.mjs";
import {
  buildUniqueRecord,
  joinWrappedMods,
  menuKeyForBase,
  parseModLine,
  parseUniqueText,
  pickVariant,
  uniqueModText
} from "../scripts/pob-data/generate-uniques.mjs";
import { generateFromDump } from "../scripts/pob-data/generate.mjs";

// A cut-down copy of what scripts/pob-data/dump.lua writes for Arc (PoB bb52d6b).
const COSTS = [{ resource: "Mana", stat: "base_mana_cost", format: "{0} Mana", divisor: 1 }];
const ARC_GEM = {
  id: "Metadata/Items/Gems/SkillGemArc", name: "Arc", gameId: "Metadata/Items/Gems/SkillGemArc", variantId: "Arc",
  gemType: "Spell", tagString: "Projectile, Lightning, Chaining, Repeatable",
  tags: ["chaining", "grants_active_skill", "intelligence", "lightning", "projectile", "repeatable", "spell"],
  reqStr: 0, reqDex: 0, reqInt: 100, tier: 5, naturalMaxLevel: 20, skillKeys: ["ArcPlayer@20"],
  statRequirements: [{ gemLevel: 1, level: 0, str: 0, dex: 0, int: 0 }, { gemLevel: 20, level: 90, str: 0, dex: 0, int: 157 }]
};
const line = (stat, text) => ({ stat, text });
const ARC_SKILLS = {
  "ArcPlayer@20": {
    id: "ArcPlayer", name: "Arc", color: 3, support: false, hidden: false, castTime: 1.1,
    description: "An arc of Lightning stretches from the caster\nto a targeted enemy.",
    level1: { cost: { Mana: 8 }, critChance: 9, levelRequirement: 0 },
    levelMax: { cost: { Mana: 81 }, critChance: 9, levelRequirement: 90 },
    qualityStats: [
      { kind: "quality", id: "number_of_chains", statSetIndexes: [0], lines: [line("number_of_chains", "Chains +2 times")] },
      { kind: "altQuality", id: "x", statSetIndexes: [], lines: [line("x", "Projectiles deal 3% more Damage")] }
    ],
    statSets: [{
      label: "Arc", scope: "skill_stat_descriptions",
      lines: [line("spell_maximum_base_lightning_damage", "Deals (1-20) to (13-386) Lightning Damage"), line("number_of_chains", "Chains (5-9) times")],
      linesLevel1: [line("spell_maximum_base_lightning_damage", "Deals 1 to 13 Lightning Damage"), line("number_of_chains", "Chains 5 times")],
      linesLevelMax: [line("spell_maximum_base_lightning_damage", "Deals 20 to 386 Lightning Damage"), line("number_of_chains", "Chains 9 times")],
      stats: [
        { id: "base_is_projectile", min: 1, max: 1 },
        { id: "movement_speed_+%_final_while_performing_action", min: -70, max: -70 },
        { id: "number_of_chains", min: 5, max: 9, scope: "described" },
        { id: "cannot_break_armour", min: 1, max: 1, scope: "silent" },
        { id: "zero_stat", min: 0, max: 0 }
      ]
    }]
  }
};

test("number and range formatting follows the site's conventions", () => {
  assert.equal(toSiteRanges("Deals (1-20) to (13-386) Damage, non-Unique"), "Deals (1—20) to (13—386) Damage, non-Unique");
  assert.equal(toSiteRanges("(16.67-23)% of Overkill"), "(16.67—23)% of Overkill");
  assert.equal(formatG(0.30000000000000004), "0.3");
  assert.equal(formatRange(8, 81), "(8—81)");
  assert.equal(formatRange(30, 30), "30");
  assert.equal(slugFromName("Kaom's Heart"), "Kaoms_Heart");
  assert.equal(rawStatLine({ id: "movement_speed_+%_final", min: -70, max: -70 }), "movement speed +% final [-70]");
  assert.equal(rawStatLine({ id: "frost_wall_maximum_life", min: 27, max: 9536 }), "frost wall maximum life [27,9536]");
});

test("gem attribute requirements use the in-game formula without PoB's display clamp", () => {
  assert.equal(gemAttributeRequirement(0, 100), 4);
  assert.equal(gemAttributeRequirement(90, 100), 157);
  assert.equal(gemAttributeRequirement(90, 50), 86);
  assert.equal(gemAttributeRequirement(90, 0), 0);
});

test("two level renderings of one stat line merge into a range line", () => {
  assert.equal(mergeLevelLines("Deals 1 to 13 Lightning Damage", "Deals 20 to 386 Lightning Damage"), "Deals (1—20) to (13—386) Lightning Damage");
  assert.equal(mergeLevelLines("200% more damage", "200% more damage"), "200% more damage");
  // Ranges inside stat text run low to high even when the value falls with level.
  assert.equal(mergeLevelLines("12 second delay between Visages", "9.15 second delay between Visages"), "(9.15—12) second delay between Visages");
  assert.equal(mergeLevelLines("Chains +0 times", "Chains +2 times"), "Chains +(0—2) times");
  assert.equal(mergeLevelLines("-0.1 seconds", "0 seconds"), "(-0.1—0) seconds");
  // Another plural form keeps the higher level's wording; unrelated lines are not merged.
  assert.equal(mergeLevelLines("Limit 1 lodged Spear", "Limit 3 lodged Spears"), "Limit (1—3) lodged Spears");
  assert.equal(mergeLevelLines("Inflicts Withered on Hit", "Inflicts 3 Withered Debuffs on Hit"), null);
  assert.equal(mergeLevelLines("Knocks Back Enemies", "Cannot Knock Back at 5 metres"), null);
});

test("described lines join wrapped text and fall back to PoB's range line", () => {
  const set = {
    lines: [line("a", "Gains (1-3) Energy per Power of enemies you"), line("a", "Critically Hit"), line("b", "Inflicts Withered on Hit")],
    linesLevel1: [line("a", "Gains 1 Energy per Power of enemies you"), line("a", "Critically Hit"), line("b", "Inflicts Withered on Hit")],
    linesLevelMax: [line("a", "Gains 3 Energy per Power of enemies you"), line("a", "Critically Hit"), line("b", "Inflicts 3 Withered Debuffs on Hit"), line("c", "57% increased Energy gained")]
  };
  assert.deepEqual(describedLines(set), [
    "Gains (1—3) Energy per Power of enemies you Critically Hit",
    "Inflicts Withered on Hit",
    "(0—57)% increased Energy gained"
  ]);
  assert.equal(qualityLine("20% more Damage with Hits"), "(0—20)% more Damage with Hits");
  assert.equal(qualityLine("Chains +2 times"), "Chains +(0—2) times");
});

test("a PoB gem becomes a record with the site's shape", () => {
  const record = buildGemRecord(ARC_GEM, ARC_SKILLS, COSTS);
  assert.equal(record.slug, "Arc");
  assert.equal(record.gem_type, "skill");
  assert.equal(record.tier, 5);
  assert.equal(record.color, "blue");
  assert.equal(record.official_id, "Metadata/Items/Gems/SkillGemArc");
  assert.deepEqual(record.tags, ["Spell", "Projectile", "Lightning", "Chaining", "Repeatable"]);
  assert.equal(record.summary_en, "An arc of Lightning stretches from the caster to a targeted enemy.");
  assert.deepEqual(record.properties, [
    "Projectile, Lightning, Chaining, Repeatable", "Tier: 5", "Level: (1—20)", "Cost: (8—81) Mana", "Cast Time: 1.10 sec", "Critical Hit Chance: 9.00%"
  ]);
  assert.deepEqual(record.requirements, ["Requires: Level (1—90), (4—157) Int"]);
  assert.deepEqual(record.sections, [{
    title: "Stats",
    lines: [
      "Deals (1—20) to (13—386) Lightning Damage",
      "Chains (5—9) times",
      "base is projectile [1]",
      "cannot break armour [1]",
      "movement speed +% final while performing action [-70]",
      "Chains +(0—2) times"
    ]
  }]);
  assert.deepEqual(record.mods, record.sections[0].lines);
});

test("support gems keep their tier in properties and get no level line", () => {
  const gem = { ...ARC_GEM, name: "Brutality I", gemType: "Support", gemFamily: "Brutality", tagString: "Physical", tier: 1, naturalMaxLevel: 1, tags: ["physical", "support"], skillKeys: ["S@1"], weaponRequirements: undefined };
  const skills = { "S@1": { id: "S", name: "Brutality I", color: 1, support: true, hidden: false, level1: { manaMultiplier: 20 }, levelMax: { manaMultiplier: 20 }, qualityStats: [], statSets: [{ label: "Brutality I", stats: [], linesLevel1: [line("a", "Supported Skills deal 25% more Physical Damage")], linesLevelMax: [line("a", "Supported Skills deal 25% more Physical Damage")], lines: [] }] } };
  const record = buildGemRecord(gem, skills, COSTS);
  assert.equal(record.gem_type, "support");
  assert.equal(record.tier, null);
  assert.equal(record.color, "red");
  assert.deepEqual(record.properties, ["Physical", "Category: Brutality", "Tier: 1", "Cost Multiplier: 120%"]);
  assert.deepEqual(record.requirements, []);
  assert.deepEqual(record.mods, ["Supported Skills deal 25% more Physical Damage"]);
});

test("secondary effects carry their own cost and timing lines", () => {
  const gem = { ...ARC_GEM, name: "Blink", gemType: "Buff", tags: ["buff", "spell"], skillKeys: ["A@20", "B@20"] };
  const set = (label) => ({ label, stats: [], lines: [], linesLevel1: [], linesLevelMax: [] });
  const skills = {
    "A@20": { id: "A", name: "Blink", color: 3, support: false, hidden: false, castTime: 0, level1: { spiritReservationFlat: 60 }, levelMax: { spiritReservationFlat: 60 }, qualityStats: [], statSets: [set("Blink")] },
    "B@20": { id: "B", name: "Blink", color: 3, support: false, hidden: true, castTime: 0.7, level1: { cooldown: 4.5, cost: { Mana: 0 }, storedUses: 1 }, levelMax: { cooldown: 3.5, cost: { Mana: 0 }, storedUses: 1 }, qualityStats: [], statSets: [set("Blink")] }
  };
  const record = buildGemRecord(gem, skills, COSTS);
  assert.ok(record.properties.includes("Reservation: 60 Spirit"));
  assert.ok(!record.properties.some((text) => text.startsWith("Cast Time")));
  assert.deepEqual(record.sections[1].lines, ["Cost: 0 Mana", "Cooldown Time: (4.50—3.50) s", "Cast Time: 0.70 sec"]);
  assert.deepEqual(record.mods, []);
});

const KAOM = "Kaom's Heart\nConqueror Plate\nVariant: Pre 0.2.1\nVariant: Current\nImplicits: 1\n(30-40)% increased Stun Threshold\n{variant:1}+1000 to maximum Life\n{variant:2}+1500 to maximum Life\nYou have no Spirit\n";
const BASES = {
  "Conqueror Plate": { type: "Body Armour", subType: "Armour", req: { level: 68, str: 121 } },
  "Ironclad Vestments": { type: "Body Armour", req: { level: 40, str: 30, int: 30 } },
  "Plated Vestments": { type: "Body Armour", req: { level: 59, str: 52, int: 52 } },
  "Two-Stone Ring": { type: "Ring", req: {} }
};

test("unique item text is parsed into header, variants, implicits and mods", () => {
  assert.deepEqual(parseModLine("{variant:2,3}{tags:fire,cold}+(13-17)% to Chaos Resistance"), { text: "+(13-17)% to Chaos Resistance", variants: [2, 3], tags: ["fire", "cold"] });
  const item = parseUniqueText(KAOM);
  assert.equal(item.name, "Kaom's Heart");
  assert.equal(item.base, "Conqueror Plate");
  assert.deepEqual(item.variants, ["Pre 0.2.1", "Current"]);
  assert.deepEqual(item.implicits.map((mod) => mod.text), ["(30-40)% increased Stun Threshold"]);
  assert.deepEqual(item.explicits.map((mod) => mod.text), ["+1000 to maximum Life", "+1500 to maximum Life", "You have no Spirit"]);
  assert.deepEqual(pickVariant(item), { index: 2, kind: "versioned" });

  const ring = parseUniqueText("Berek's Grip\nTwo-Stone Ring\nLeague: Runes of Aldur\nSource: Drops from unique{X}\nRequires Level 42\nImplicits: 1\n{tags:cold}+(12-16)% to Cold Resistance\nGrants Skill: Level (1-20) Blink\n{tags:lightning}Wind Skills count\n{tags:lightning}as being boosted by Shocked Ground\n");
  assert.equal(ring.league, "Runes of Aldur");
  assert.equal(ring.source, "Drops from unique{X}");
  assert.equal(ring.level_requirement, 42);
  assert.deepEqual(ring.grants_skills, ["Level (1-20) Blink"]);
  assert.deepEqual(pickVariant(ring), { index: null, kind: "none" });
  assert.deepEqual(joinWrappedMods(ring.explicits.map((mod) => mod.text)), ["Grants Skill: Level (1-20) Blink", "Wind Skills count as being boosted by Shocked Ground"]);
  assert.equal(uniqueModText("-(40-30)% to Lightning Resistance"), "(-40—-30)% to Lightning Resistance");
});

test("the base type can follow the variants and differ per variant", () => {
  const raw = "Voll's Protector\n{variant:1}Ironclad Vestments\n{variant:2}Plated Vestments\nVariant: Pre 0.1.1\nVariant: Pre 0.4.0\nVariant: Current\n{variant:1}(100-150)% increased Armour\n25% reduced maximum Mana\n";
  const record = buildUniqueRecord({ group: "body", index: 1, raw }, BASES, new Map());
  // PoB lists no base for "Current" here; the newest listed base is used.
  assert.deepEqual(record.properties, ["Plated Vestments"]);
  assert.deepEqual(record.requirements, ["Requires: Level 59, 52 Str, 52 Int"]);
  assert.deepEqual(record.mods, ["25% reduced maximum Mana"]);
  assert.equal(record.pob.variant_mods[0].mods[0], "(100—150)% increased Armour");
});

test("a PoB unique becomes a record with the site's shape", () => {
  const flavour = new Map([["Kaom's Heart", { id: "FourUniqueBodyStr14", name: "Kaom's Heart", text: ["The warrior who fears will fall."] }]]);
  const record = buildUniqueRecord({ group: "body", index: 9, raw: KAOM }, BASES, flavour);
  assert.equal(record.slug, "Kaoms_Heart");
  assert.equal(record.menu_key, "body-armours");
  assert.equal(record.rarity, "unique");
  assert.deepEqual(record.properties, ["Conqueror Plate"]);
  assert.deepEqual(record.requirements, ["Requires: Level 68, 121 Str"]);
  assert.deepEqual(record.mods, ["(30—40)% increased Stun Threshold", "+1500 to maximum Life", "You have no Spirit"]);
  assert.equal(record.flavour_text, "The warrior who fears will fall.");
  assert.equal(record.pob.shown_variant, "Current");
  assert.deepEqual(record.pob.variant_mods[0].mods, ["(30—40)% increased Stun Threshold", "+1000 to maximum Life", "You have no Spirit"]);
  assert.equal(menuKeyForBase({ type: "Shield", subType: "Evasion" }), "bucklers");
  assert.equal(menuKeyForBase({ type: "Staff", subType: "Warstaff" }), "quarterstaves");
  assert.equal(menuKeyForBase(null), null);
});

test("field classification separates exact, normalised, differing and one-sided values", () => {
  assert.equal(normText("Requires: Level (1—90), 157 Int."), "requires: level (1-90), 157 int");
  assert.equal(classify("Arc", "Arc"), "exact");
  assert.equal(classify("(1—20) Mana", "(1-20) mana"), "normalised");
  assert.equal(classify(["b", "a"], ["a", "b"]), "normalised");
  assert.equal(classify(5, 4), "differ");
  assert.equal(classify(null, 4), "pob_only");
  assert.equal(classify(["x"], []), "site_only");
  assert.equal(classify("", null), "both_empty");
});

test("records are paired by name and id, leftovers stay on their side", () => {
  const site = [{ name: "Arc", id: "a" }, { name: "Arc", id: "b" }, { name: "Mórrigan", id: "m" }, { name: "Old Gem", id: "o" }];
  const pob = [{ name: "Arc", id: "b" }, { name: "Morrigan", id: "m" }, { name: "New Gem", id: "n" }];
  const { pairs, siteOnly, pobOnly } = matchRecords(site, pob, { siteId: (row) => row.id, pobId: (row) => row.id });
  assert.deepEqual(pairs.map((pair) => [pair.site.id, pair.pob.id, pair.how]), [["b", "b", "name+id"], ["m", "m", "id"]]);
  assert.deepEqual(siteOnly.map((row) => row.id), ["a", "o"]);
  assert.deepEqual(pobOnly.map((row) => row.name), ["New Gem"]);
});

test("gem and unique comparisons count per field and per stat line", () => {
  const pobGem = buildGemRecord(ARC_GEM, ARC_SKILLS, COSTS);
  const siteGem = { ...pobGem, tier: 1, sections: [{ title: "Stats", lines: [...pobGem.sections[0].lines, "Fires +1 Projectiles"] }] };
  const gems = compareGems([siteGem, { ...siteGem, name: "Gone", official_id: "x", slug: "Gone" }], [pobGem], [{ id: ARC_GEM.gameId, name: "Arc", tier: 5, gem_kind: "active", tags: [] }]);
  assert.deepEqual(gems.counts, { site: 2, pob: 1, matched: 1, site_only: 1, pob_only: 0 });
  assert.equal(gems.fields.name.exact, 1);
  assert.equal(gems.fields.tier.differ, 1);
  assert.deepEqual(gems.referee.tier, { both: 0, site: 0, pob: 1, neither: 0 });
  assert.equal(gems.text.site_described_lines, 4);
  assert.equal(gems.text.described_exact, 3);
  assert.equal(gems.text.described_missing, 1);
  assert.equal(gems.text.raw_exact, 3);
  assert.equal(gems.text.gems_all_described_exact, 0);

  const pobUnique = buildUniqueRecord({ group: "body", index: 9, raw: KAOM }, BASES, new Map());
  const siteUnique = { ...pobUnique, flavour_text: null, mods: ["(30—40)% increased Stun Threshold", "+1000 to maximum Life", "You have no Spirit"] };
  const uniques = compareUniques([siteUnique, { name: "Not unique", rarity: "", properties: [], mods: [] }], [pobUnique]);
  assert.deepEqual(uniques.counts, { site: 1, pob: 1, matched: 1, site_only: 0, pob_only: 0 });
  assert.equal(uniques.mods.site_matches_older_pob_variant, 1);
  assert.equal(uniques.variants.versioned, 1);
  assert.equal(uniques.fields.requirements.exact, 1);
});

test("dump keys are sorted so two dumps of one PoB commit are identical", () => {
  assert.equal(JSON.stringify(sortKeys({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 2 } })), '{"a":{"c":2,"d":[{"y":2,"z":1}]},"b":1}');
});

// Needs a local PoB checkout with the Lua host (node scripts/setup-pob-local.mjs); skipped elsewhere.
const pobReady = fs.existsSync(path.join(DEFAULT_POB_DIR, "src", "HeadlessWrapper.lua")) && Boolean(findLuajit(DEFAULT_POB_DIR));
test("PoB's own loader dumps gems, skills and uniques that generate site-shaped records", { skip: pobReady ? false : "no local PoB checkout" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pob-data-"));
  try {
    dumpPobData({ outDir: dir });
    const { gems, uniques } = generateFromDump(dir);
    assert.ok(gems.length > 900, `gems: ${gems.length}`);
    assert.ok(uniques.length > 400, `uniques: ${uniques.length}`);
    const arc = gems.find((gem) => gem.name === "Arc");
    assert.equal(arc.official_id, "Metadata/Items/Gems/SkillGemArc");
    assert.equal(arc.color, "blue");
    assert.match(arc.properties.join("|"), /Cost: \(\d+—\d+\) Mana/);
    assert.match(arc.sections[0].lines[0], /^Deals \(\d+—\d+\) to \(\d+—\d+\) Lightning Damage$/);
    const kaom = uniques.find((item) => item.name === "Kaom's Heart");
    assert.equal(kaom.menu_key, "body-armours");
    assert.ok(kaom.mods.includes("You have no Spirit"));
    assert.ok(uniques.every((item) => item.pob.base_known || item.properties[0]), "every unique has a base type line");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

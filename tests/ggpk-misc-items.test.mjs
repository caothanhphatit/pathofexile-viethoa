import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import { classifyWidth, measureTable } from "../scripts/ggpk/check-schema-widths.mjs";
import { compareRow, explainSiteOnly, gameModLines, iconKey, normalizeText, siteStackSize } from "../scripts/ggpk/compare-misc-items.mjs";
import { ddsPathFromIconUrl, decodeBc1, decodeDds, encodePng, iconFileName, isInside, parseDdsHeader } from "../scripts/ggpk/extract-icons.mjs";
import {
  ANCHORS,
  buildMiscItems,
  checkAnchors,
  checkForeignKeys,
  checkModsAnchor,
  checkRowWidths,
  decodeMarkup,
  isPlaceholderName,
  modStats,
  patchModsSchema,
  rejectReason,
  schemaWidth
} from "../scripts/ggpk/extract-misc-items.mjs";
import { columnLayout, parseTable } from "../scripts/ggpk/reader.mjs";
import { createStatRenderer, decodeCsd, parseStatDescriptions } from "../scripts/ggpk/stat-descriptions.mjs";

// ---- text markup -------------------------------------------------------------------------

test("decodeMarkup turns [A|B] / [A] keyword markup into display text", () => {
  assert.equal(decodeMarkup("Modifies an item unpredictably and [Corrupted|Corrupts] it"), "Modifies an item unpredictably and Corrupts it");
  assert.equal(decodeMarkup("Upgrades a [ItemRarity|Magic] item to a [ItemRarity|Rare] item"), "Upgrades a Magic item to a Rare item");
  assert.equal(decodeMarkup("[Jewellery] or Belt"), "Jewellery or Belt");
  assert.equal(decodeMarkup("Adds {0} to {1} [Fire|Fire] Damage"), "Adds {0} to {1} Fire Damage");
});

test("decodeMarkup drops font tags and glyph codes and normalises line breaks", () => {
  assert.equal(decodeMarkup("<size:28>{Whispered memory,}\r\nA shimmer"), "Whispered memory,\nA shimmer");
  assert.equal(decodeMarkup("<default>{plain} <<HBG01>>text"), "plain text");
  assert.equal(decodeMarkup("line one   \r\nline two"), "line one\nline two");
  assert.equal(decodeMarkup(null), "");
  assert.equal(decodeMarkup(undefined), "");
});

// ---- release filter ----------------------------------------------------------------------

test("isPlaceholderName spots developer placeholders only", () => {
  assert.ok(isPlaceholderName("[DNT] Not Shown To Players"));
  assert.ok(isPlaceholderName("[DNT-Unused] Rune of Wild Ferocity"));
  assert.ok(isPlaceholderName("[UNUSED] Golden Tome"));
  assert.ok(isPlaceholderName("[DNT] Incursion Gemcutter's Prism (not visible to players)"));
  assert.ok(!isPlaceholderName("Vaal Orb"));
  assert.ok(!isPlaceholderName("Unused Potential")); // a real-looking name must not be dropped by a loose match
});

test("rejectReason applies class, name and release-evidence rules in order", () => {
  const currency = { Id: "StackableCurrency", Name: "Stackable Currency" };
  const omen = { Id: "Omen", Name: "Omen" };
  assert.equal(rejectReason({ Name: "Vaal Orb" }, currency, ["CurrencyExchange"]), "");
  assert.equal(rejectReason({ Name: "Orb of Alteration" }, currency, []), "no-release-evidence");
  assert.equal(rejectReason({ Name: "" }, currency, ["CurrencyExchange"]), "no-name");
  assert.equal(rejectReason({ Name: "[DNT] Not Shown To Players" }, currency, ["CurrencyExchange"]), "placeholder-name");
  assert.equal(rejectReason({ Name: "Omen of Recombination" }, omen, []), "", "PoE2-only classes need no evidence");
  assert.equal(rejectReason({ Name: "Ancient Visor" }, { Id: "Helmet", Name: "Helmets" }, []), "class-out-of-scope");
  assert.equal(rejectReason({ Name: "Orphan" }, null, []), "class-out-of-scope");
});

// ---- layout guards -----------------------------------------------------------------------

/** One-row .datc64 buffer from little-endian i32 values. */
const datc = (values, rows = 1) => {
  const head = Buffer.alloc(4);
  head.writeUInt32LE(rows, 0);
  const body = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => body.writeInt32LE(value, i * 4));
  return Buffer.concat([head, body, Buffer.alloc(8, 0xbb)]);
};

test("a column inserted in the middle shifts values silently in reader.mjs; the width guard catches it", () => {
  const schema = { name: "T", columns: [{ name: "A", type: "i32" }, { name: "B", type: "i32" }, { name: "C", type: "i32" }] };
  // The game now stores A, NEW, B, C.
  const parsed = parseTable(datc([1, 999, 2, 3]), schema);
  assert.deepEqual(parsed.rows[0], { _index: 0, A: 1, B: 999, C: 2 }, "B and C are wrong and nothing was thrown");
  assert.equal(parsed.trailingBytes, 4, "the only trace is 4 unknown bytes, reported as if they were at the end");
  assert.throws(
    () => checkRowWidths([{ name: "T", rowCount: parsed.rowCount, rowWidth: parsed.rowWidth, expectedWidth: schemaWidth(schema) }]),
    /T: row is 4 bytes wider than the schema \(16 > 12\)/
  );
  assert.doesNotThrow(() => checkRowWidths([{ name: "T", rowCount: 1, rowWidth: 16, expectedWidth: 12 }], ["T"]), "explicit --allow-wider");
});

test("checkRowWidths accepts an exact fit and rejects narrower, empty and fractional tables", () => {
  assert.doesNotThrow(() => checkRowWidths([{ name: "T", rowCount: 5, rowWidth: 12, expectedWidth: 12 }]));
  assert.throws(() => checkRowWidths([{ name: "T", rowCount: 5, rowWidth: 8, expectedWidth: 12 }]), /4 bytes narrower/);
  assert.throws(() => checkRowWidths([{ name: "T", rowCount: 0, rowWidth: 0, expectedWidth: 12 }]), /T: table is empty/);
  assert.throws(() => checkRowWidths([{ name: "T", rowCount: 3, rowWidth: 10.5, expectedWidth: 12 }]), /not a whole number/);
});

test("patchModsSchema splits every Stat<N>Value into a (min, max) pair", () => {
  const schema = { name: "Mods", columns: [{ name: "Id", type: "i32" }, { name: "Stat1Value", type: "i32" }, { name: "Stat2Value", type: "i32" }, { name: "Level", type: "i32" }] };
  const patched = patchModsSchema(schema);
  assert.deepEqual(patched.columns.map((c) => c.name), ["Id", "Stat1Min", "Stat1Max", "Stat2Min", "Stat2Max", "Level"]);
  assert.equal(schemaWidth(patched) - schemaWidth(schema), 8);
  // Game row: Id=7, Stat1=(5,8), Stat2=(0,0), Level=33. The unpatched schema reads Level as 0.
  const buffer = datc([7, 5, 8, 0, 0, 33]);
  assert.equal(parseTable(buffer, schema).rows[0].Level, 0);
  assert.deepEqual(parseTable(buffer, patched).rows[0], { _index: 0, Id: 7, Stat1Min: 5, Stat1Max: 8, Stat2Min: 0, Stat2Max: 0, Level: 33 });
  assert.equal(parseTable(buffer, patched).trailingBytes, 0);
});

test("checkForeignKeys reports keys that point outside their table", () => {
  const layout = (columns) => columnLayout({ name: "X", columns });
  const good = {
    Items: { rowCount: 2, layout: layout([{ name: "Class", type: "foreignrow", references: { table: "Classes" } }, { name: "Tags", type: "foreignrow", array: true, references: { table: "Classes" } }]), rows: [{ Class: 1, Tags: [0, 1] }, { Class: null, Tags: [] }] },
    Classes: { rowCount: 2, layout: layout([{ name: "Id", type: "i32" }]), rows: [{ Id: 1 }, { Id: 2 }] }
  };
  assert.doesNotThrow(() => checkForeignKeys(good));
  const shifted = structuredClone(good);
  shifted.Items.rows[1].Class = 1434519076864; // what a shifted column looks like in practice
  assert.throws(() => checkForeignKeys(shifted), /Items\.Class -> Classes: 1 value\(s\) outside 0\.\.1 \(e\.g\. 1434519076864\)/);
  const badArray = structuredClone(good);
  badArray.Items.rows[0].Tags = [0, 2];
  assert.throws(() => checkForeignKeys(badArray), /Items\.Tags -> Classes/);
});

const anchorRecord = (overrides) => ({ name: "Vaal Orb", item_class: "Stackable Currency", category: "currency", stack_size: 20, description: "Modifies an item unpredictably and Corrupts it", directions: "Right click this item", icon_dds: "Art/2DItems/Currency/CurrencyVaal.dds", effect_lines: [], ...overrides });
const vaalAnchor = ANCHORS.filter((a) => a.name === "Vaal Orb");

test("checkAnchors passes on the real shape and fails loudly on a shifted or missing row", () => {
  assert.doesNotThrow(() => checkAnchors([anchorRecord()], vaalAnchor));
  assert.throws(() => checkAnchors([anchorRecord({ stack_size: 5000 })], vaalAnchor), /"Vaal Orb" decoded wrong: expected class Stackable Currency, stack size 20/);
  assert.throws(() => checkAnchors([anchorRecord({ description: "" })], vaalAnchor), /GGPK sanity anchors failed/);
  assert.throws(() => checkAnchors([], vaalAnchor), /"Vaal Orb" not found/);
  assert.ok(ANCHORS.length >= 5, "anchors cover currency, omens, augments, essences and tablets");
});

test("checkModsAnchor needs Strength1 to be one strength stat with min <= max", () => {
  const stats = [{ Id: "additional_strength" }];
  const row = { Id: "Strength1", Stat1: 0, Stat1Min: 5, Stat1Max: 8, Stat2: null, Stat5: null };
  assert.doesNotThrow(() => checkModsAnchor([row], stats));
  assert.throws(() => checkModsAnchor([{ ...row, Stat5: 1434519076864 }], stats), /patched Mods layout/);
  assert.throws(() => checkModsAnchor([{ ...row, Stat1Min: 9 }], stats), /Strength1/);
  assert.throws(() => checkModsAnchor([], stats), /Strength1/);
});

test("measureTable and classifyWidth describe a table file against its schema width", () => {
  assert.deepEqual(measureTable(datc([1, 2, 3, 4, 5, 6], 2)), { rowCount: 2, rowWidth: 12 });
  assert.equal(classifyWidth({ rowCount: 2, rowWidth: 12 }, 12), "equal");
  assert.equal(classifyWidth({ rowCount: 2, rowWidth: 16 }, 12), "wider");
  assert.equal(classifyWidth({ rowCount: 2, rowWidth: 8 }, 12), "narrower");
  assert.equal(classifyWidth({ rowCount: 0, rowWidth: 0 }, 12), "empty");
  assert.equal(classifyWidth({ rowCount: 3, rowWidth: 10.5 }, 12), "unreadable");
  assert.equal(classifyWidth(measureTable(Buffer.alloc(16)), 12), "unreadable", "no data marker");
});

// ---- stat descriptions -------------------------------------------------------------------

const CSD = [
  "no_description hidden_stat",
  "description",
  "\t2 local_minimum_added_fire_damage local_maximum_added_fire_damage",
  "\t1",
  "\t\t# # \"Adds {0} to {1} [Fire|Fire] Damage\"",
  "\tlang \"German\"",
  "\t1",
  "\t\t# # \"Fügt {0} bis {1} hinzu\"",
  "description",
  "\t1 base_maximum_life",
  "\t1",
  "\t\t# \"{0:+d} to maximum Life\"",
  "description",
  "\t1 attack_speed_+%",
  "\t2",
  "\t\t1|# \"{0}% increased [Attack] Speed\"",
  "\t\t#|-1 \"{0}% reduced [Attack] Speed\" negate 1",
  "description",
  "\t1 life_regeneration_rate_per_minute",
  "\t1",
  "\t\t# \"{0} Life Regeneration per second\" per_minute_to_per_second 1",
  "description",
  "\t1 two_lines",
  "\t1",
  "\t\t# \"First {0}\\nSecond\" mystery_handler 1",
  ""
].join("\r\n");

test("decodeCsd reads UTF-16LE with a BOM", () => {
  assert.equal(decodeCsd(Buffer.from("﻿description", "utf16le")), "description");
});

test("stat descriptions render English lines, ranges, signs and handlers", () => {
  const parsed = parseStatDescriptions(CSD);
  assert.equal(parsed.descriptions.length, 5);
  assert.ok(parsed.noDescription.has("hidden_stat"));
  const renderer = createStatRenderer([parsed]);
  assert.deepEqual(renderer.render(["local_minimum_added_fire_damage", "local_maximum_added_fire_damage"], [7, 11]).lines, ["Adds 7 to 11 [Fire|Fire] Damage"]);
  assert.deepEqual(renderer.render(["local_minimum_added_fire_damage", "local_maximum_added_fire_damage"], [[10, 15], [18, 26]]).lines, ["Adds (10—15) to (18—26) [Fire|Fire] Damage"]);
  assert.deepEqual(renderer.render(["base_maximum_life"], [[85, 99]]).lines, ["+(85—99) to maximum Life"]);
  assert.deepEqual(renderer.render(["base_maximum_life"], [-5]).lines, ["-5 to maximum Life"]);
  assert.deepEqual(renderer.render(["attack_speed_+%"], [12]).lines, ["12% increased [Attack] Speed"]);
  assert.deepEqual(renderer.render(["attack_speed_+%"], [-12]).lines, ["12% reduced [Attack] Speed"]);
  assert.deepEqual(renderer.render(["life_regeneration_rate_per_minute"], [90]).lines, ["1.5 Life Regeneration per second"]);
  assert.deepEqual(renderer.render(["base_maximum_life"], [0]).lines, [], "zero-valued stats print nothing");
});

test("stat renderer reports what it cannot resolve instead of guessing", () => {
  const renderer = createStatRenderer([parseStatDescriptions(CSD)]);
  const out = renderer.render(["unknown_stat", "hidden_stat", "two_lines"], [1, 1, 3]);
  assert.deepEqual(out.missing, ["unknown_stat"], "no_description stats are not reported as missing");
  assert.deepEqual(out.lines, ["First 3", "Second"]);
  assert.deepEqual([...renderer.unknownHandlers], ["mystery_handler"]);
});

// ---- records -----------------------------------------------------------------------------

const tables = () => ({
  ItemClasses: [{ _index: 0, Id: "StackableCurrency", Name: "Stackable Currency" }, { _index: 1, Id: "SoulCore", Name: "Augment" }, { _index: 2, Id: "Omen", Name: "Omen" }, { _index: 3, Id: "Helmet", Name: "Helmets" }, { _index: 4, Id: "TowerAugmentation", Name: "Tablet" }],
  Tags: [{ _index: 0, Id: "essence" }],
  Stats: [{ _index: 0, Id: "local_minimum_added_fire_damage" }, { _index: 1, Id: "local_maximum_added_fire_damage" }, { _index: 2, Id: "base_maximum_life" }],
  FlavourText: [{ _index: 0, Text: "A [Relic|relic]\r\nof old." }],
  ItemVisualIdentity: [{ _index: 0, DDSFile: "Art/2DItems/Currency/CurrencyVaal.dds" }],
  BaseItemTypes: [
    { _index: 0, Id: "Metadata/Items/Currency/CurrencyCorrupt", Name: "Vaal Orb", ItemClass: 0, DropLevel: 35, FlavourText: 0, Implicit_Mods: [], Tags: [], ItemVisualIdentity: 0 },
    { _index: 1, Id: "Metadata/Items/Currency/CurrencyRerollMagic", Name: "Orb of Alteration", ItemClass: 0, DropLevel: 1, FlavourText: null, Implicit_Mods: [], Tags: [], ItemVisualIdentity: 0 },
    { _index: 2, Id: "Metadata/Items/SoulCores/RuneFire", Name: "Desert Rune", ItemClass: 1, DropLevel: 31, FlavourText: null, Implicit_Mods: [], Tags: [], ItemVisualIdentity: null },
    { _index: 3, Id: "Metadata/Items/Currency/CurrencyEssenceLife", Name: "Essence of the Body", ItemClass: 0, DropLevel: 40, FlavourText: null, Implicit_Mods: [], Tags: [0], ItemVisualIdentity: null },
    { _index: 4, Id: "Metadata/Items/SoulCores/Rune27", Name: "[DNT-Unused] Rune of Chance", ItemClass: 1, DropLevel: 1, FlavourText: null, Implicit_Mods: [], Tags: [], ItemVisualIdentity: null },
    { _index: 5, Id: "Metadata/Items/Armours/Helmets/FourHelmet1", Name: "Ancient Visor", ItemClass: 3, DropLevel: 65, FlavourText: null, Implicit_Mods: [], Tags: [], ItemVisualIdentity: null },
    { _index: 6, Id: "Metadata/Items/Currency/Hidden", Name: "", ItemClass: 0, DropLevel: 1, FlavourText: null, Implicit_Mods: [], Tags: [], ItemVisualIdentity: null },
    { _index: 7, Id: "Metadata/Items/TowerAugment/LifeAugment", Name: "Life Tablet", ItemClass: 4, DropLevel: 65, FlavourText: null, Implicit_Mods: [0], Tags: [], ItemVisualIdentity: null }
  ],
  CurrencyItems: [
    { BaseItemType: 0, StackSize: 20, CurrencyTab_StackSize: 5000, Description: "Modifies an item unpredictably and [Corrupted|Corrupts] it", Directions: "Right click this item then left click an item to corrupt it.", IsGold: false },
    { BaseItemType: 1, StackSize: 20, CurrencyTab_StackSize: 5000, Description: "Reforges a magic item", Directions: "", IsGold: false },
    { BaseItemType: 2, StackSize: 10, CurrencyTab_StackSize: 5000, Description: "", Directions: "", IsGold: false },
    { BaseItemType: 3, StackSize: 10, CurrencyTab_StackSize: 5000, Description: "Upgrades a [ItemRarity|Magic] item", Directions: "", IsGold: false }
  ],
  CurrencyExchange: [{ Item: 0, Category: 0, SubCategory: 0, EnabledInChallengeLeague: true }],
  CurrencyExchangeCategories: [{ _index: 0, Name: "Currency" }],
  EssenceStashTabLayout: [{ StoredItem: 3 }],
  Essences: [{ _index: 0, BaseItemType: 3, Perfect: false, Tier: 0 }],
  EssenceMods: [{ Essence: 0, TargetItemCategory: 0, Mod: 0, DisplayMod: null, Text: "", OutcomeMods: [] }],
  EssenceTargetItemCategories: [{ _index: 0, Text: "Belt, Body Armour, Helmet or [Shield]" }],
  Mods: [{ _index: 0, Id: "EssenceLife1", Stat1: 2, Stat1Min: 85, Stat1Max: 99, Stat2: null, Stat3: null, Stat4: null, Stat5: null, Stat6: null }],
  SoulCores: [{ _index: 0, BaseItemType: 2, RequiredLevel: 15, Limit: null, Description: null, ExtraDescription: null, Type: 0, IsSocketBound: false }],
  SoulCoreTypes: [{ _index: 0, Name: "[Rune|Rune]" }],
  SoulCoreStatCategories: [{ _index: 0, Id: "Martial Weapon", Display: "[MartialWeapon|Martial Weapon]", TargetItemClasses: [] }, { _index: 1, Id: "Helmet", Display: "", TargetItemClasses: [3] }],
  SoulCoreStats: [
    { SoulCore: 0, StatCategory: 0, Stats: [0, 1], StatsValues: [7, 11], BondedStats: [2], BondedStatsValues: [20] },
    { SoulCore: 0, StatCategory: 1, Stats: [2], StatsValues: [30], BondedStats: [], BondedStatsValues: [] }
  ]
});

test("modStats lists the used stat slots with their (min, max) pairs", () => {
  const t = tables();
  assert.deepEqual(modStats(t.Mods[0], t.Stats), { ids: ["base_maximum_life"], values: [[85, 99]] });
});

test("buildMiscItems keeps released misc items and resolves text, effects and evidence", () => {
  const renderer = createStatRenderer([parseStatDescriptions(CSD)]);
  const { records, rejected, rejectedItems, unresolvedStats } = buildMiscItems(tables(), renderer);
  assert.deepEqual(records.map((r) => r.name), ["Desert Rune", "Vaal Orb", "Essence of the Body", "Life Tablet"]);
  assert.deepEqual(rejected, { "no-release-evidence": 1, "placeholder-name": 1, "class-out-of-scope": 1, "no-name": 1 });
  assert.deepEqual(rejectedItems.map((r) => `${r.name}:${r.reason}`), ["Orb of Alteration:no-release-evidence", "[DNT-Unused] Rune of Chance:placeholder-name", "Ancient Visor:class-out-of-scope"]);
  assert.deepEqual(unresolvedStats, []);

  const vaal = records.find((r) => r.name === "Vaal Orb");
  assert.equal(vaal.id, "Metadata/Items/Currency/CurrencyCorrupt");
  assert.equal(vaal.item_class, "Stackable Currency");
  assert.equal(vaal.category, "currency");
  assert.equal(vaal.stack_size, 20);
  assert.equal(vaal.description, "Modifies an item unpredictably and Corrupts it");
  assert.equal(vaal.flavour_text, "A relic\nof old.");
  assert.equal(vaal.drop_level, 35);
  assert.equal(vaal.icon_dds, "Art/2DItems/Currency/CurrencyVaal.dds");
  assert.deepEqual(vaal.release_evidence, ["CurrencyExchange"]);
  assert.deepEqual(vaal.exchange, { category: "Currency", subcategory: "Currency", challenge_league: true });

  const rune = records.find((r) => r.name === "Desert Rune");
  assert.equal(rune.category, "augment");
  assert.equal(rune.required_level, 15);
  assert.equal(rune.augment_type, "Rune");
  assert.deepEqual(rune.effect_lines, ["Martial Weapon: Adds 7 to 11 Fire Damage", "Martial Weapon (Bonded): +20 to maximum Life", "Helmets: +30 to maximum Life"]);

  const essence = records.find((r) => r.name === "Essence of the Body");
  assert.equal(essence.category, "essence");
  assert.deepEqual(essence.release_evidence, ["EssenceStashTabLayout"]);
  assert.deepEqual(essence.effect_lines, ["Belt, Body Armour, Helmet or Shield: +(85—99) to maximum Life"]);

  assert.deepEqual(records.find((r) => r.name === "Life Tablet").effect_lines, ["+(85—99) to maximum Life"]);
});

test("buildMiscItems without a renderer keeps stat ids and values", () => {
  const rune = buildMiscItems(tables()).records.find((r) => r.name === "Desert Rune");
  assert.equal(rune.effect_lines[0], "Martial Weapon: local_minimum_added_fire_damage = 7\nlocal_maximum_added_fire_damage = 11");
});

// ---- comparison with the site ------------------------------------------------------------

test("site helpers normalise stack size, text and icon paths", () => {
  assert.equal(siteStackSize({ stack_size: "1 / 20", properties: [] }), 20);
  assert.equal(siteStackSize({ properties: ["Stack Size: 1 / 10,000"] }), 10000);
  assert.equal(siteStackSize({ properties: ["Limited to: 1"] }), null);
  assert.equal(normalizeText("Adds (10—15)\n  to Life"), "Adds (10-15) to Life");
  assert.equal(iconKey("https://cdn.poe2db.tw/image/Art/2DItems/Currency/CurrencyVaal.webp"), "art/2ditems/currency/currencyvaal");
  assert.equal(iconKey("Art/2DItems/Currency/CurrencyVaal.dds"), "art/2ditems/currency/currencyvaal");
});

test("compareRow grades every site field against the game record", () => {
  const record = { stack_size: 20, description: "Modifies an item unpredictably\nand Corrupts it", effect_lines: [], icon_dds: "Art/2DItems/Currency/CurrencyVaal.dds", required_level: null };
  const row = { stack_size: "1 / 20", description_en: "Modifies an item unpredictably and Corrupts it", properties: ["Stack Size: 1 / 20"], mods: ["Modifies an item unpredictably and Corrupts it"], icon_url: "https://cdn.poe2db.tw/image/Art/2DItems/Currency/CurrencyVaal.webp" };
  assert.deepEqual(compareRow(row, record), { stack_size: "same", description: "same", mods: "same", icon: "same" });
  assert.equal(compareRow({ ...row, stack_size: "1 / 10", properties: [] }, record).stack_size, "differs");
  assert.equal(compareRow({ ...row, mods: [] }, record).mods, "site-empty");
  assert.equal(compareRow(row, { ...record, effect_lines: ["Extra line"] }).mods, "game-has-more");
  assert.equal(compareRow({ ...row, mods: [...row.mods, "Site extra"] }, record).mods, "site-has-more");
  assert.equal(compareRow({ ...row, mods: ["Something else"] }, record).mods, "differs");
  assert.equal(compareRow({ ...row, requirements: ["Requires: Level 15"] }, { ...record, required_level: 15 }).required_level, "same");
  assert.deepEqual(gameModLines({ description: "", effect_lines: ["A", "B"] }), ["A", "B"]);
});

test("explainSiteOnly names why a site row has no released game record", () => {
  const rejected = new Map([["Rogue's Marker", [{ reason: "no-release-evidence", item_class: "Stackable Currency" }]], ["Ancient Visor", [{ reason: "class-out-of-scope", item_class: "Helmets" }]]]);
  assert.equal(explainSiteOnly({ name: "Rogue's Marker" }, rejected), "in game, filtered: no-release-evidence");
  assert.equal(explainSiteOnly({ name: "Ancient Visor" }, rejected), "in game as another class (Helmets)");
  assert.equal(explainSiteOnly({ name: "Wraeclast Besieged", rarity: "unique" }, rejected), "unique item (not a base type)");
  assert.equal(explainSiteOnly({ name: "Arid Stability", icon_url: "https://cdn.poe2db.tw/image/Art/2DArt/SkillIcons/passives/AtlasTrees/DesertBiome.webp" }, rejected), "atlas passive node listed on the poe2db page");
  assert.equal(explainSiteOnly({ name: "Ancient Gateway" }, rejected), "not a BaseItemTypes name");
});

// ---- icons -------------------------------------------------------------------------------

/** DX10 DDS with one mip. `dxgi` 28 = RGBA8, 87 = BGRA8, 71 = BC1. */
const dds = (width, height, dxgi, pixels) => {
  const header = Buffer.alloc(148);
  header.write("DDS ", 0, "latin1");
  header.writeUInt32LE(124, 4);
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(width, 16);
  header.writeUInt32LE(1, 28);
  header.writeUInt32LE(32, 76);
  header.writeUInt32LE(0x4, 80);
  header.write("DX10", 84, "latin1");
  header.writeUInt32LE(dxgi, 128);
  return Buffer.concat([header, Buffer.from(pixels)]);
};

test("DDS reader decodes uncompressed RGBA and BGRA and rejects unknown formats", () => {
  const rgba = [255, 0, 0, 255, 0, 255, 0, 128];
  const file = dds(2, 1, 28, rgba);
  assert.deepEqual(parseDdsHeader(file), { width: 2, height: 1, mipCount: 1, format: "R8G8B8A8_UNORM", layout: "rgba", dataOffset: 148 });
  assert.deepEqual([...decodeDds(file).rgba], rgba);
  assert.deepEqual([...decodeDds(dds(2, 1, 87, [0, 0, 255, 255, 0, 255, 0, 128])).rgba], rgba, "BGRA is swapped to RGBA");
  assert.throws(() => decodeDds(dds(4, 4, 98, Buffer.alloc(16))), /unsupported DDS format BC7_UNORM/);
  assert.throws(() => decodeDds(dds(2, 2, 28, rgba)), /DDS truncated/);
  assert.throws(() => parseDdsHeader(Buffer.from("not a dds file".padEnd(200))), /not a DDS file/);
});

test("BC1 blocks decode to the four-colour and the transparent palettes", () => {
  const block = Buffer.alloc(8);
  block.writeUInt16LE(0xf800, 0); // red
  block.writeUInt16LE(0x001f, 2); // blue, c0 > c1 -> opaque 4-colour mode
  block.writeUInt32LE(0b01_00, 4); // pixel 0 -> c0, pixel 1 -> c1, rest c0
  const opaque = decodeBc1(block, 4, 4);
  assert.deepEqual([...opaque.subarray(0, 8)], [255, 0, 0, 255, 0, 0, 255, 255]);
  const punch = Buffer.alloc(8);
  punch.writeUInt16LE(0x001f, 0);
  punch.writeUInt16LE(0xf800, 2); // c0 <= c1 -> index 3 is transparent
  punch.writeUInt32LE(0b11, 4);
  assert.deepEqual([...decodeBc1(punch, 4, 4).subarray(0, 4)], [0, 0, 0, 0]);
  assert.equal(decodeDds(dds(4, 4, 71, block)).rgba.length, 64);
  assert.throws(() => decodeBc1(Buffer.alloc(4), 4, 4), /BC1 data truncated/);
});

test("encodePng writes a valid RGBA PNG that inflates back to the pixels", () => {
  const width = 3, height = 2;
  const rgba = Buffer.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const png = encodePng(rgba, width, height);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), width);
  assert.equal(png.readUInt32BE(20), height);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6);
  const idatLength = png.readUInt32BE(33);
  assert.equal(png.toString("latin1", 37, 41), "IDAT");
  const raw = zlib.inflateSync(png.subarray(41, 41 + idatLength));
  // undo the per-row filters (0 none, 1 sub, 2 up, 3 average, 4 paeth)
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? out[y * stride + x - 4] : 0;
      const up = y ? out[(y - 1) * stride + x] : 0;
      const upLeft = y && x >= 4 ? out[(y - 1) * stride + x - 4] : 0;
      const p = left + up - upLeft;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter];
      out[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predicted) & 0xff;
    }
  }
  assert.deepEqual([...out], [...rgba]);
  assert.equal(png.toString("latin1", png.length - 8, png.length - 4), "IEND");
});

test("icon path helpers map poe2db URLs to bundle paths and keep output out of public/", () => {
  assert.equal(ddsPathFromIconUrl("https://cdn.poe2db.tw/image/Art/2DItems/Currency/CurrencyVaal.webp"), "Art/2DItems/Currency/CurrencyVaal.dds");
  assert.equal(ddsPathFromIconUrl("https://cdn.poe2db.tw/image/Art/2DItems/Armours/The%20Auspex.webp"), "Art/2DItems/Armours/The Auspex.dds");
  assert.equal(ddsPathFromIconUrl(""), "");
  assert.equal(iconFileName("Art/2DItems/Currency/CurrencyVaal.dds"), "Art_2DItems_Currency_CurrencyVaal.png");
  assert.equal(iconFileName("Art/2DItems/Currency/CurrencyVaal.dds", "webp"), "Art_2DItems_Currency_CurrencyVaal.webp");
  const publicDir = path.resolve("public");
  assert.ok(isInside(publicDir, path.join(publicDir, "icons")));
  assert.ok(isInside(publicDir, publicDir));
  assert.ok(!isInside(publicDir, path.resolve("data", "icons")));
});

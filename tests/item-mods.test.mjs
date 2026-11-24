// Item editor: mod pool (from Path of Building), editable item round trip,
// validation rules (edited, built and pasted items), corruption, mod suggestions.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

import * as mods from "../src/shared/item-mods.mjs";
import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { buildApp } from "../src/server/app.mjs";
import { itemRowErrors, calculationRowItem } from "../src/server/item-validation.mjs";
import { inflateSync } from "node:zlib";
import { pobRuntime, readFixtures, runPob } from "../scripts/check-pob-parity.mjs";
import { loadModPool } from "../scripts/lib/mod-pool-node.mjs";
import { parseLuaValue, positional } from "../scripts/lib/pob-lua-data.mjs";
import { buildItemModData, spawnWeight } from "../scripts/build-item-mod-pool.mjs";
import { repoRoot } from "../scripts/lib/planner-node.mjs";

const dataDir = join(repoRoot, "public", "data");
const pool = loadModPool(dataDir);
const RING = [
  "Rarity: RARE",
  "Entropy Coil",
  "Unset Ring",
  "Item Level: 56",
  "Implicits: 1",
  "+8% to Chaos Resistance",
  "+115 to maximum Life",
  "+28% to Lightning Resistance",
  "+34% to Fire Resistance"
].join("\n");
const errorsOf = (item, original) => mods.validateEditableItem(item, pool, original).map((error) => error.message);
const pastedErrors = (text) => mods.validatePastedItemText(text, pool).map((error) => error.message);
const addMod = (item, query) => {
  const suggestion = mods.suggestMods(pool, item, query)[0];
  assert.ok(suggestion, `no mod for "${query}"`);
  return mods.addSuggestedMod(item, suggestion);
};
const built = (base, rarity = "RARE", level = 82) => mods.withBaseImplicits(mods.parseEditableItem(`Rarity: ${rarity}\n${rarity === "RARE" ? "New Item\n" : ""}${base}\nItem Level: ${level}`, pool), pool);
const spellLevelMods = (base) => mods.poolClassForBase(pool, base).cls.mods.filter((mod) => /^\+# to Level of all .*Spell Skills$/.test(mod.templates[0]));
const fixtureItems = () => {
  const unxml = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const rows = [];
  for (const fixture of readFixtures()) {
    const xml = inflateSync(Buffer.from(fixture.code.replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf8");
    for (const match of xml.matchAll(/<Item\b[^>]*>([\s\S]*?)<\/Item>/g)) rows.push({ file: fixture.file, text: unxml(match[1].replace(/<ModRange[^>]*\/>/g, "")).trim() });
  }
  return rows;
};

// ── Pool ────────────────────────────────────────────────────────────────────

test("pool: built from Path of Building data; one class per set of base tags; hybrid tiers are separate lines", () => {
  assert.equal(pool.source, "pob");
  assert.ok(pool.classes.size >= 50);
  assert.ok(pool.bases.size >= 1300, `${pool.bases.size} bases`);
  const ring = mods.poolClassForBase(pool, "Unset Ring");
  assert.equal(ring.cls.itemClass, "Ring");
  assert.ok(ring.cls.mods.some((mod) => mod.gen === "prefix") && ring.cls.mods.some((mod) => mod.gen === "suffix"));
  assert.deepEqual(mods.splitHybridText("(6—13)% increased Evasion Rating+(7—10) to maximum Life"), ["(6-13)% increased Evasion Rating", "+(7-10) to maximum Life"]);
  assert.deepEqual(mods.lineTemplate("Adds (3-5) to 9 Fire Damage"), { template: "Adds # to # Fire Damage", ranges: [[3, 5], [9, 9]] });
  const hybrid = mods.poolClassForBase(pool, "Leather Vest").cls.mods.find((mod) => mod.templates.length === 2);
  assert.ok(hybrid, "a hybrid mod keeps its two lines apart");
  // Tiers: T1 is the best, levels rise with the tier.
  const life = ring.cls.mods.find((mod) => mod.family === "IncreasedLife");
  assert.equal(life.tiers.at(-1).tier, 1);
  assert.ok(life.tiers.every((tier, index) => index === 0 || tier.ilvl >= life.tiers[index - 1].ilvl));
});

test("pool: spell level mods are separate groups and follow the base's tags (a physical staff only rolls Physical)", () => {
  const names = (base) => spellLevelMods(base).map((mod) => mod.templates[0].replace("+# to Level of all ", "").replace(" Skills", "")).sort();
  assert.deepEqual(names("Chiming Staff"), ["Chaos Spell", "Cold Spell", "Fire Spell", "Lightning Spell", "Physical Spell", "Spell"]);
  assert.deepEqual(names("Reaping Staff"), ["Physical Spell", "Spell"], "physical implicit skill: no other element");
  assert.deepEqual(names("Ashen Staff"), ["Fire Spell", "Spell"]);
  assert.deepEqual(names("Bone Wand"), ["Physical Spell", "Spell"]);
  assert.deepEqual(names("Withered Wand"), ["Chaos Spell", "Spell"]);
  const families = new Set(spellLevelMods("Chiming Staff").map((mod) => mod.family));
  assert.equal(families.size, 6, "one group per element, plus all spells");
  assert.ok(families.has("GlobalIncreaseSpellSkillGemLevelWeapon") && families.has("GlobalIncreasePhysicalSpellSkillGemLevelWeapon"));

  // "+all Spell Skills" and "+Physical Spell Skills" go together on a physical staff.
  let staff = built("Reaping Staff");
  staff = addMod(staff, "level of all spell skills");
  staff = addMod(staff, "physical spell skills");
  assert.deepEqual(errorsOf(staff), []);
  assert.equal(staff.mods.length, 2);
  // A fire mod cannot be put on it, in the editor or by the server.
  const fire = spellLevelMods("Chiming Staff").find((mod) => /Fire/.test(mod.templates[0]));
  assert.equal(mods.suggestMods(pool, staff, "fire spell skills").length, 0);
  const forced = { ...staff, mods: [...staff.mods, mods.newPoolModLine(fire, staff)] };
  assert.ok(errorsOf(forced).some((message) => /không xuất hiện trên Reaping Staff \(Staff\)/.test(message)));
  const text = `Rarity: RARE\nNew Item\nReaping Staff\nItem Level: 82\n+5 to Level of all Fire Spell Skills`;
  assert.ok(mods.validateItemText(text, pool, "").length > 0);
});

test("pool: mods no weight can reach are not offered, bases the game has not released are not offered", () => {
  const ring = built("Unset Ring");
  // "Recover #% of maximum Mana on Kill" only exists as a special mod on rings.
  assert.equal(mods.suggestMods(pool, ring, "mana on kill").length, 0);
  const cls = mods.poolClassForBase(pool, "Unset Ring").cls;
  assert.ok(cls.special.some((record) => record.lines.some((line) => line.template === "Recover #% of maximum Mana on Kill")) || pool.unbound.Item.some((record) => record.lines.some((line) => line.template === "Recover #% of maximum Mana on Kill")));
  // Claws and daggers are in PoB's files but have no uniques there: parsed, not offered.
  assert.equal(pool.bases.has("crude claw"), false);
  assert.equal(mods.findBase(pool, "Crude Claw").itemClass, "Claw");
  const offered = new Set([...pool.bases.values()].map((base) => base.itemClass));
  for (const type of ["Claw", "Dagger", "Fishing Rod"]) assert.equal(offered.has(type), false, type);
  for (const type of ["Ring", "Staff", "Wand", "Body Armour", "Bow", "Spear", "Jewel"]) assert.ok(offered.has(type), type);
});

test("generator: Lua tables parse; spawn weight takes the first matching tag; the data file matches PoB", (t) => {
  const [table] = parseLuaValue('{ type = "Suffix", "+(5-8) to Strength", "second", level = 1, weightKey = { "ring", "default", }, weightVal = { 1, 0 }, tradeHashes = { [4080418644] = { "x" }, } }');
  assert.equal(table.type, "Suffix");
  assert.deepEqual(positional(table), ["+(5-8) to Strength", "second"]);
  assert.deepEqual(table.weightKey, ["ring", "default"]);
  const fireMod = { weightKey: ["no_fire_spell_mods", "staff", "default"], weightVal: [0, 1, 0] };
  assert.equal(spawnWeight(fireMod, { staff: true, default: true }), 1);
  assert.equal(spawnWeight(fireMod, { staff: true, default: true, no_fire_spell_mods: true }), 0);
  assert.equal(spawnWeight({ weightKey: ["marksman", "default"], weightVal: [1, 0] }, { default: true }, new Set(["marksman"])), 1);

  const pobDir = process.env.POB_CORE_DIR ? resolve(process.env.POB_CORE_DIR, "..") : resolve(repoRoot, "..", "pob-core");
  if (!existsSync(join(pobDir, "src", "Data", "ModItem.lua"))) return t.skip("pob-core not checked out next to the repo");
  const context = { window: {} };
  vm.runInNewContext(readFileSync(join(dataDir, "item-mods-data.js"), "utf8"), context);
  const fresh = buildItemModData(pobDir);
  const committed = context.window.POE2_ITEM_MODS;
  if (fresh.source !== committed.source) return t.skip(`pob-core is at another commit (${fresh.source})`);
  assert.equal(JSON.stringify(fresh), JSON.stringify(committed), "run node scripts/build-item-mod-pool.mjs");
});

// ── Editor rules ────────────────────────────────────────────────────────────

test("editor round trip: PoB text -> editable item -> same text; recognised mods have tiers", () => {
  const item = mods.parseEditableItem(RING, pool);
  assert.equal(item.rarity, "rare");
  assert.equal(item.baseName, "Unset Ring");
  assert.equal(item.implicits.length, 1);
  const life = item.mods.find((line) => line.family === "IncreasedLife");
  assert.equal(life.gen, "prefix");
  assert.deepEqual(life.values, [115]);
  assert.match(mods.tierLabel(pool, item, life), /^T\d+ · 100–119$/);
  const text = mods.serializeEditableItem(item, pool);
  assert.equal(mods.serializeEditableItem(mods.parseEditableItem(text, pool), pool), text);
  assert.deepEqual(errorsOf(item, mods.parseEditableItem(RING, pool)), []);
});

test("parsing: a hybrid mod whose lines are apart is one mod", () => {
  const vest = mods.poolClassForBase(pool, "Leather Vest").cls;
  const hybrid = vest.mods.find((mod) => mod.templates.length === 2 && mod.templates[1] === "+# to maximum Life");
  // The lowest tier: its values are below what the single-line mods of the same texts roll.
  const tier = hybrid.tiers[0];
  const [first, second] = tier.lines.map((line) => mods.fillTemplate(line.template, line.ranges.map(([a]) => a)));
  const item = mods.parseEditableItem(`Rarity: RARE\nX\nLeather Vest\nItem Level: 82\n${first}\n+30% to Fire Resistance\n${second}`, pool);
  const line = item.mods.find((row) => row.kind === "pool" && row.modKey === hybrid.key);
  assert.ok(line, "the two lines are read as the hybrid mod");
  assert.equal(item.mods.length, 2);
});

test("rule: values stay inside the tier range", () => {
  const original = mods.parseEditableItem(RING, pool);
  const item = mods.parseEditableItem(RING, pool);
  item.mods.find((line) => line.family === "IncreasedLife").values = [150];
  assert.ok(errorsOf(item, original).some((message) => /vượt khoảng 100–119/.test(message)));
});

test("rule: affix limits by rarity (rare 3/3, magic 1/1, normal none); the message says when the count is over", () => {
  const original = mods.parseEditableItem(RING, pool);
  let item = mods.parseEditableItem(RING, pool);
  item = addMod(item, "mana"); // second prefix (life, mana)
  item = addMod(item, "accuracy"); // third prefix
  assert.deepEqual(errorsOf(item, original), []);
  const blocked = mods.suggestMods(pool, item, "rarity").find((row) => row.gen === "prefix");
  assert.equal(blocked.blocked, "Đã đủ 3 tiền tố.", "a fourth prefix is listed but blocked");
  assert.equal(mods.addSuggestedMod(item, blocked), item, "and cannot be added");
  const forced = { ...item, mods: [...item.mods, mods.newPoolModLine(blocked.mod, item)] };
  assert.ok(errorsOf(forced, original).includes("Quá số tiền tố: đang có 4, đồ hiếm chỉ có tối đa 3. Hãy xóa bớt 1 dòng."));

  const magic = { ...mods.parseEditableItem("Rarity: MAGIC\nUnset Ring\nItem Level: 80", pool) };
  const oneLife = addMod(magic, "maximum life");
  assert.deepEqual(errorsOf(oneLife), []);
  assert.equal(mods.suggestMods(pool, oneLife, "mana").find((row) => row.gen === "prefix").blocked, "Đã đủ 1 tiền tố.");
  // A rare turned magic with two prefixes: over the limit, and worded so.
  const rare = addMod(addMod(built("Unset Ring"), "maximum life"), "mana");
  const turnedMagic = { ...rare, rarity: "magic" };
  assert.ok(errorsOf(turnedMagic).includes("Quá số tiền tố: đang có 2, đồ ma thuật chỉ có tối đa 1. Hãy xóa bớt 1 dòng."));
  assert.equal(mods.suggestMods(pool, turnedMagic, "accuracy").find((row) => row.gen === "prefix").blocked, "Đang có 2 tiền tố, tối đa 1: hãy xóa bớt.");
  const normal = mods.parseEditableItem("Rarity: NORMAL\nUnset Ring", pool);
  assert.match(mods.suggestMods(pool, normal, "life")[0].blocked, /Đồ thường không có mod/);
});

test("rule: a rare or magic item with no mods is allowed (an item stripped of its mods keeps its rarity)", () => {
  assert.deepEqual(errorsOf(built("Unset Ring")), []);
  assert.deepEqual(errorsOf(built("Unset Ring", "MAGIC")), []);
  assert.deepEqual(mods.validateItemText(mods.serializeEditableItem(built("Unset Ring"), pool), pool, ""), []);
});

test("rule: an implicit such as \"-1 Prefix Modifier allowed\" lowers the limit", () => {
  const amulet = built("Lament Amulet");
  assert.deepEqual(mods.affixLimits(amulet), { prefix: 2, suffix: 3 });
  const freePrefix = (item) => mods.suggestMods(pool, item, "", { limit: 500 }).find((row) => row.gen === "prefix" && !row.blocked);
  const one = mods.addSuggestedMod(amulet, freePrefix(amulet));
  const two = mods.addSuggestedMod(one, freePrefix(one));
  assert.deepEqual(errorsOf(two), []);
  assert.equal(freePrefix(two), undefined, "no third prefix");
  const third = mods.suggestMods(pool, two, "", { limit: 500 }).find((row) => row.gen === "prefix" && !two.mods.some((line) => line.family === row.family));
  assert.equal(third.blocked, "Đã đủ 2 tiền tố.");
  assert.ok(errorsOf({ ...two, mods: [...two.mods, mods.newPoolModLine(third.mod, two)] }).some((message) => /Quá số tiền tố: đang có 3, đồ hiếm chỉ có tối đa 2/.test(message)));
});

test("rule: no two mods of the same group", () => {
  const item = mods.parseEditableItem(RING, pool);
  const life = mods.suggestMods(pool, item, "maximum life").find((row) => row.family === "IncreasedLife");
  assert.equal(life.blocked, "Đã có mod cùng nhóm.");
  const forced = { ...item, mods: [...item.mods, mods.newPoolModLine(life.mod, item)] };
  assert.ok(errorsOf(forced, mods.parseEditableItem(RING, pool)).includes("Đã có mod cùng nhóm này trên món đồ."));
});

test("rule: a mod the base cannot roll, and tiers above the item level", () => {
  const boots = mods.parseEditableItem("Rarity: RARE\nX\nAncient Leggings\nItem Level: 80", pool);
  const wandMod = mods.poolClassForBase(pool, "Acrid Wand").cls.mods.find((mod) => !mods.poolClassForBase(pool, "Ancient Leggings").cls.mods.some((row) => row.key === mod.key));
  const forced = { ...boots, mods: [mods.newPoolModLine(wandMod, boots)] };
  assert.ok(errorsOf(forced).some((message) => /không xuất hiện trên Ancient Leggings \(Boots\)/.test(message)), errorsOf(forced).join(" | "));

  const lowLevel = mods.parseEditableItem("Rarity: RARE\nX\nUnset Ring\nItem Level: 10", pool);
  const life = mods.poolClassForBase(pool, "Unset Ring").cls.mods.find((mod) => mod.family === "IncreasedLife");
  const best = life.tiers[life.tiers.length - 1];
  const tooHigh = { ...lowLevel, mods: [{ ...mods.newPoolModLine(life, lowLevel), tier: best.tier, values: [best.lines[0].ranges[0][0]] }] };
  assert.ok(errorsOf(tooHigh).some((message) => /T1 cần cấp vật phẩm 54 \(đang 10\)/.test(message)));
  assert.ok(mods.newPoolModLine(life, lowLevel).tier > best.tier, "new mods start at the best tier the item level allows (T1 is the top)");
  // The tier text the dropdown shows is the tier's own range (not another tier's).
  assert.equal(mods.tierText(best), "T1 · 100–119");
  assert.ok(!mods.availableTiers(life, lowLevel).includes(best), "T1 is not among the tiers item level 10 allows");
});

test("rule: uniques keep their mods, only rolls inside the unique's ranges change", () => {
  const record = [...pool.uniques.entries()].find(([, lines]) => lines.some((line) => line.ranges.some(([a, b]) => a !== b)));
  const [name, lines] = record;
  const line = lines.find((row) => row.ranges.some(([a, b]) => a !== b));
  const mid = line.ranges.map(([a, b]) => Math.round((a + b) / 2));
  const text = `Rarity: UNIQUE\n${name}\nSome Base\n${mods.fillTemplate(line.template, mid)}`;
  const original = mods.parseEditableItem(text, pool);
  assert.equal(original.mods[0].kind, "unique");
  const item = mods.parseEditableItem(text, pool);
  const [a, b] = item.mods[0].ranges.find(([x, y]) => x !== y);
  item.mods[0].values = item.mods[0].values.map(() => Math.max(a, b) + 1000);
  assert.ok(errorsOf(item, original).some((message) => /vượt khoảng/.test(message)));
  assert.match(mods.addModBlockedReason(mods.poolClassForBase(pool, "Unset Ring").cls.mods[0], item), /độc nhất/);
});

test("rule: a unique's lines cannot be removed or added (The Whispering Ice without its Icestorm skill)", () => {
  const text = [
    "Rarity: Unique",
    "The Whispering Ice",
    "Permafrost Staff",
    "Grants Skill: Heart of Ice",
    "Grants Skill: Level 17 Icestorm",
    "+(5-7) to Level of all Cold Spell Skills",
    "(10-20)% reduced Cast Speed",
    "(5-10)% increased Intelligence",
    "2% increased Spell Damage per 10 Intelligence",
    "Inflict Elemental Exposure on Hit, lowering Total Elemental Resistances by (50-60)%"
  ].join("\n");
  const original = mods.parseEditableItem(text, pool);
  const item = mods.parseEditableItem(text, pool);
  assert.deepEqual(errorsOf(item, original), [], "untouched, the unique is valid");
  assert.equal(item.mods.find((line) => line.kind === "unique" && /Cold Spell Skills/.test(line.template)).values[0], 7, "a line written as a range starts at its best roll");

  const removed = { ...item, mods: item.mods.filter((line) => !(line.kind === "fixed" && /Icestorm/.test(line.text))) };
  assert.ok(errorsOf(removed, original).some((message) => /không xóa được dòng nào.*Grants Skill: Level # Icestorm/.test(message)), errorsOf(removed, original).join(" | "));
  const added = { ...item, mods: [...item.mods, { id: "x", kind: "fixed", text: "+200 to maximum Life", flags: [] }] };
  assert.ok(errorsOf(added, original).some((message) => /không thêm được dòng nào/.test(message)));

  // The server sees the same, with or without the original text.
  const withoutIcestorm = text.replace("Grants Skill: Level 17 Icestorm\n", "");
  assert.ok(mods.validateItemText(withoutIcestorm, pool, text).some((error) => /không xóa được dòng nào/.test(error.message)));
  assert.ok(mods.validateItemText(withoutIcestorm, pool, "").some((error) => /không xóa được dòng nào/.test(error.message)), "a unique sent as built is held to the site's record");
  assert.ok(mods.validateItemText(`${text}\n+200 to maximum Life`, pool, "").some((error) => /không thêm được dòng nào/.test(error.message)));
  assert.deepEqual(mods.validateItemText(mods.serializeEditableItem(item, pool), pool, text), []);
  assert.ok(mods.validateItemText("Rarity: UNIQUE\nNo Such Unique\nUnset Ring\n+500 to maximum Life", pool, "").some((error) => /Không có dữ liệu cho đồ độc nhất/.test(error.message)));
});

test("rule: corrupted items cannot change mods, quality or sockets, nor lose corruption", () => {
  const original = mods.parseEditableItem(`${RING}\nCorrupted`, pool);
  const item = mods.parseEditableItem(`${RING}\nCorrupted`, pool);
  item.mods = item.mods.slice(1);
  assert.ok(errorsOf(item, original).includes("Đồ đã corrupt: không đổi được dòng mod nào."));
  const uncorrupt = { ...mods.parseEditableItem(`${RING}\nCorrupted`, pool), corrupted: false };
  assert.ok(errorsOf(uncorrupt, original).includes("Đồ đã corrupt không thể bỏ corrupt."));
  assert.equal(mods.addModBlockedReason(mods.poolClassForBase(pool, "Unset Ring").cls.mods[0], original), "Đồ đã corrupt.");
  const twice = mods.parseEditableItem(`${RING}\nTwice Corrupted`, pool);
  assert.equal(twice.corrupted, true, "Twice Corrupted locks the item too");
  assert.equal(twice.mods.some((line) => line.kind === "fixed" && /Corrupted/.test(line.text)), false);
  assert.match(mods.serializeEditableItem(twice, pool), /\nTwice Corrupted$/);
  assert.equal(mods.corruptionOptions(pool, item, original).locked, true);
  assert.equal(mods.setCorruption(pool, item, original, { kind: "none" }), item, "the outcome of an item that came corrupted cannot be changed");
});

test("corruption: one outcome of the Vaal Orb per item (nothing, one more socket, or one enchant of the item type)", () => {
  const vest = addMod(built("Vagabond Armour"), "maximum life");
  const options = mods.corruptionOptions(pool, vest);
  assert.equal(options.locked, false);
  assert.equal(options.socket, true);
  assert.ok(options.enchants.some((row) => row.text === "(15–25)% increased Armour and Evasion"), "the enchant of an armour/evasion body armour");
  assert.ok(!options.enchants.some((row) => /increased Energy Shield$/.test(row.text)), "not the energy shield one");
  assert.deepEqual(mods.corruptionState(pool, vest), { kind: "none" });
  assert.equal(mods.maxSockets(mods.findBase(pool, "Vagabond Armour")), 3);
  assert.equal(mods.maxSockets(mods.findBase(pool, "Vagabond Armour"), true), 4);

  const plain = mods.setCorruption(pool, vest, null, { kind: "plain" });
  assert.equal(plain.corrupted, true);
  assert.deepEqual(errorsOf(plain), []);
  assert.match(mods.serializeEditableItem(plain, pool), /\nCorrupted$/);

  const socket = mods.setCorruption(pool, { ...vest, sockets: 3 }, null, { kind: "socket" });
  assert.equal(socket.sockets, 4);
  assert.deepEqual(mods.corruptionState(pool, socket), { kind: "socket" });
  assert.deepEqual(errorsOf(socket), []);
  assert.ok(errorsOf({ ...vest, sockets: 4 }).some((message) => /tối đa 3 lỗ rune \(thêm 1 lỗ nếu corrupt ra lỗ\)/.test(message)), "the fourth socket needs corruption");

  const key = options.enchants.find((row) => /Armour and Evasion/.test(row.text)).key;
  const enchant = mods.setCorruption(pool, socket, null, { kind: "enchant", key, values: [20] });
  assert.equal(enchant.sockets, 3, "picking another outcome takes the extra socket back");
  assert.equal(enchant.implicits[0].text, "20% increased Armour and Evasion");
  assert.deepEqual(mods.corruptionState(pool, enchant), { kind: "enchant", key, values: [20] });
  assert.deepEqual(errorsOf(enchant), []);
  const text = mods.serializeEditableItem(enchant, pool);
  assert.match(text, /\{enchant\}20% increased Armour and Evasion/);
  assert.deepEqual(mods.validateItemText(text, pool, ""), [], "the server accepts it");
  assert.deepEqual(mods.setCorruption(pool, enchant, null, { kind: "none" }).implicits, vest.implicits, "uncorrupting removes the enchant");

  // What the server refuses.
  const both = { ...enchant, sockets: 4 };
  assert.ok(errorsOf(both).some((message) => /chỉ cho một kết quả/.test(message)));
  assert.ok(mods.validateItemText(text.replace("20% increased Armour and Evasion", "60% increased Armour and Evasion"), pool, "").some((error) => /không phải kết quả corrupt/.test(error.message)), "a roll outside the enchant's range");
  assert.ok(mods.validateItemText(text.replace("20% increased Armour and Evasion", "20% increased Energy Shield"), pool, "").some((error) => /không phải kết quả corrupt/.test(error.message)), "an enchant of another item type");
  assert.ok(mods.validateItemText(text.replace(/\nCorrupted$/, ""), pool, "").some((error) => /chỉ có trên đồ đã corrupt/.test(error.message)), "an enchant without corruption");
  const two = { ...enchant, implicits: [{ flags: ["enchant"], text: "+35 to maximum Life" }, ...enchant.implicits] };
  assert.ok(errorsOf(two).some((message) => /không phải kết quả corrupt/.test(message)), "two enchants");

  // A game item that is not corrupted yet can be corrupted in the editor; its own enchants stay.
  const ringOriginal = mods.parseEditableItem(RING, pool);
  const ringOptions = mods.corruptionOptions(pool, ringOriginal, ringOriginal);
  assert.equal(ringOptions.socket, false, "rings have no sockets");
  const ringEnchant = mods.setCorruption(pool, mods.parseEditableItem(RING, pool), ringOriginal, { kind: "enchant", key: ringOptions.enchants[0].key });
  assert.deepEqual(errorsOf(ringEnchant, ringOriginal), []);
  assert.deepEqual(mods.validateItemText(mods.serializeEditableItem(ringEnchant, pool), pool, RING), []);
});

test("rule: sockets, quality and lines that are not recognised", () => {
  const ring = mods.parseEditableItem(RING, pool);
  assert.ok(errorsOf({ ...ring, sockets: 1 }).some((message) => /không có lỗ rune/.test(message)));
  const body = mods.parseEditableItem("Rarity: RARE\nX\nLeather Vest\nItem Level: 80", pool);
  assert.deepEqual(errorsOf({ ...body, sockets: 3 }), []);
  assert.ok(errorsOf({ ...body, sockets: 4 }).some((message) => /tối đa 3 lỗ/.test(message)));
  const helmet = mods.parseEditableItem("Rarity: RARE\nX\nAncestral Tiara\nItem Level: 80", pool);
  assert.deepEqual(errorsOf({ ...helmet, sockets: 2 }), []);
  assert.ok(errorsOf({ ...helmet, sockets: 3 }).some((message) => /tối đa 2 lỗ/.test(message)));
  assert.ok(errorsOf({ ...body, quality: 25 }).includes("Chất lượng tối đa 20%."));
  // An unknown line from the game is kept; one that was not there before is rejected.
  const withUnknown = `${RING}\n30% increased Zeal of the Forgotten`;
  assert.deepEqual(mods.validateItemText(withUnknown, pool, withUnknown), []);
  assert.ok(mods.validateItemText(withUnknown, pool, RING).some((error) => /Không nhận diện được/.test(error.message)));
});

test("implicits: a new item gets its base's implicit; the server holds it to the base", () => {
  const ring = built("Amethyst Ring");
  assert.deepEqual(ring.implicits, [{ flags: [], text: "+13% to Chaos Resistance" }]);
  assert.deepEqual(errorsOf(ring), []);
  const text = mods.serializeEditableItem(addMod(ring, "maximum life"), pool);
  assert.match(text, /Implicits: 1\n\+13% to Chaos Resistance\n/);
  assert.deepEqual(mods.validateItemText(text, pool, ""), []);
  assert.ok(mods.validateItemText(text.replace("+13% to Chaos Resistance", "+40% to Chaos Resistance"), pool, "").some((error) => /Dòng ẩn \(implicit\) của Amethyst Ring phải là: \+\(7-13\)% to Chaos Resistance/.test(error.message)));
  assert.ok(mods.validateItemText(text.replace("+13% to Chaos Resistance", "+30 to maximum Mana"), pool, "").some((error) => /implicit/.test(error.message)));
  assert.deepEqual(mods.validateItemText(text.replace("+13% to Chaos Resistance", "+9% to Chaos Resistance"), pool, ""), [], "any roll inside the base's range");
  assert.deepEqual(built("Leather Vest").implicits, [], "a base without implicit gets none");
  // Bases whose implicit is one of several skills: one of them, chosen by index.
  const amulet = built("Absent Amulet");
  assert.deepEqual(amulet.implicits.map((line) => line.text).slice(0, 2), ["-1 Prefix Modifier allowed", "-1 Suffix Modifier allowed"]);
  assert.match(amulet.implicits[2].text, /^Grants Skill: Level 20 /);
  const other = mods.withBaseImplicits(amulet, pool, 2);
  assert.notEqual(other.implicits[2].text, amulet.implicits[2].text);
  assert.equal(mods.implicitVariantOf(other, mods.findBase(pool, "Absent Amulet")), 2);
  assert.deepEqual(errorsOf(other), []);
  assert.ok(errorsOf({ ...other, implicits: other.implicits.slice(0, 2) }).some((message) => /implicit/.test(message)));
});

test("level requirement follows the mods: the base's level, or 80% of the highest mod level (PoB's formula)", () => {
  const ring = built("Amethyst Ring");
  assert.equal(mods.requiredLevel(ring, pool), 20, "the base's own level");
  const life = mods.poolClassForBase(pool, "Amethyst Ring").cls.mods.find((mod) => mod.family === "IncreasedLife");
  const withLife = { ...ring, mods: [mods.newPoolModLine(life, ring)] };
  assert.equal(life.tiers.at(-1).ilvl, 54);
  assert.equal(mods.requiredLevel(withLife, pool), 43, "floor(54 x 0.8)");
  const res = mods.poolClassForBase(pool, "Amethyst Ring").cls.mods.find((mod) => mod.family === "FireResistance");
  const withBoth = { ...withLife, mods: [...withLife.mods, mods.newPoolModLine(res, ring)] };
  assert.equal(mods.requiredLevel(withBoth, pool), Math.floor(Math.max(54, res.tiers.at(-1).ilvl) * 0.8));
  assert.match(mods.serializeEditableItem(withBoth, pool), new RegExp(`\\nLevelReq: ${mods.requiredLevel(withBoth, pool)}\\n`));
  // Low tiers do not raise it above the base.
  const lowTier = { ...withLife, mods: [{ ...withLife.mods[0], tier: life.tiers[0].tier, values: [15] }] };
  assert.equal(mods.requiredLevel(lowTier, pool), 20);
  // A game item keeps at least the level the game gave it; an unknown line without one gives no number.
  const game = mods.parseEditableItem(RING.replace("Item Level: 56", "Item Level: 56\nLevelReq: 60"), pool);
  assert.equal(mods.requiredLevel(game, pool), 60);
  const unknown = mods.parseEditableItem(`${RING}\n30% increased Zeal of the Forgotten`, pool);
  assert.equal(mods.requiredLevel(unknown, pool), null);
  assert.doesNotMatch(mods.serializeEditableItem(unknown, pool), /LevelReq/);
});

// ── Mod search ──────────────────────────────────────────────────────────────

test("mod search: accent-insensitive Vietnamese, keywords anywhere, numbers in the query", () => {
  const ring = mods.parseEditableItem("Rarity: RARE\nX\nUnset Ring\nItem Level: 80", pool);
  const families = (query) => mods.suggestMods(pool, ring, query).map((row) => row.family);
  assert.equal(families("kháng lửa")[0], "FireResistance");
  assert.equal(families("khang lua")[0], "FireResistance");
  assert.equal(families("fire res")[0], "FireResistance");
  assert.ok(families("máu").includes("IncreasedLife"));
  assert.ok(families("+# to maximum Life").includes("IncreasedLife"));
  assert.deepEqual(mods.parseModQuery("54 máu"), { words: ["life"], numbers: [54] });
  const added = mods.addSuggestedMod(ring, mods.suggestMods(pool, ring, "54 maximum life")[0]);
  assert.deepEqual(added.mods.at(-1).values, [54], "54 picks the tier that holds it");
  const clamped = mods.addSuggestedMod(ring, mods.suggestMods(pool, ring, "999 maximum life")[0]);
  assert.ok(clamped.mods.at(-1).values[0] <= 149, "out-of-range numbers are clamped to the tier");
  const recent = mods.suggestMods(pool, ring, "resistance", { recent: ["suffix:ColdResistance:+#% to Cold Resistance"] });
  assert.equal(recent[0].family, "ColdResistance", "recently picked first");
});

test("mod search: \"tay sai\" finds minion mods; hybrid lines are separated in the list", () => {
  const ring = built("Unset Ring");
  for (const query of ["tay sai", "Tay sai", "đệ tử", "minion"]) {
    const rows = mods.suggestMods(pool, ring, query);
    assert.ok(rows.length >= 3, `"${query}" finds ${rows.length}`);
    assert.ok(rows.every((row) => /minion/i.test(row.display)), query);
  }
  assert.deepEqual(mods.parseModQuery("sát thương tay sai").words.sort(), ["damage", "minion"]);
  assert.deepEqual(mods.parseModQuery("hồi máu").words.sort(), ["life", "regeneration"], "the longer phrase wins over \"máu\"");
  assert.ok(mods.suggestMods(pool, built("Sceptre of no base"), "tay sai").length === 0);
  // No two lines glued together ("...Regeneration Rate15% increased Light Radius") anywhere in the pool.
  for (const cls of pool.classes.values()) {
    for (const mod of cls.mods) {
      for (const template of mod.templates) assert.doesNotMatch(template, /[a-z]#%? (increased|reduced)|[a-z]\+#/, `${cls.key} ${mod.key}`);
    }
  }
  const hybrid = mods.suggestMods(pool, built("Leather Vest"), "evasion life").find((row) => row.mod.templates.length === 2);
  assert.match(hybrid.display, / \/ /);
});

// ── Pasted items ────────────────────────────────────────────────────────────

test("pasted items: the tester's ring (item level 5, quality 50%, 9 mods, +200% physical damage) is rejected", () => {
  const cheat = [
    "Rarity: RARE", "Doom Loop", "Gold Ring", "Item Level: 5", "Quality: 50", "Implicits: 1", "15% increased Rarity of Items found",
    "Adds 20 to 35 Physical Damage to Attacks", "Adds 18 to 30 Physical Damage to Attacks", "200% increased Physical Damage",
    "+180 to maximum Life", "+45% to Fire Resistance", "+45% to Cold Resistance", "+45% to Lightning Resistance", "+35 to Strength", "+400 to Accuracy Rating"
  ].join("\n");
  const errors = pastedErrors(cheat);
  assert.ok(errors.some((message) => /Chất lượng 50% không có trong game/.test(message)));
  assert.ok(errors.some((message) => /"200% increased Physical Damage": giá trị 200 vượt xa mọi bậc/.test(message)));
  assert.ok(errors.some((message) => /cần cấp vật phẩm \d+ trở lên \(món đồ đang cấp 5\)/.test(message)));
  assert.ok(errors.some((message) => /quá nhiều mod: đồ hiếm chỉ có tối đa 3 tiền tố và 3 hậu tố/.test(message)));
});

test("pasted items: each rule on its own", () => {
  const ring = (...lines) => ["Rarity: RARE", "X", "Gold Ring", "Item Level: 82", "Implicits: 0", ...lines].join("\n");
  assert.deepEqual(pastedErrors(ring("+110 to maximum Life", "+40% to Fire Resistance")), []);
  // A mod no ring can carry (a weapon's local damage), and one the base's own tags rule out.
  assert.ok(pastedErrors(ring("Adds 10 to 20 Physical Damage")).some((message) => /không thể xuất hiện trên Gold Ring \(Ring\)/.test(message)));
  const staff = (base, ...lines) => ["Rarity: RARE", "X", base, "Item Level: 82", ...lines].join("\n");
  assert.ok(pastedErrors(staff("Reaping Staff", "+5 to Level of all Fire Spell Skills")).some((message) => /không thể xuất hiện trên Reaping Staff \(Staff\)/.test(message)), "a physical staff has no fire spell levels");
  assert.deepEqual(pastedErrors(staff("Reaping Staff", "+5 to Level of all Physical Spell Skills", "+4 to Level of all Spell Skills")), []);
  assert.deepEqual(pastedErrors(staff("Chiming Staff", "+5 to Level of all Fire Spell Skills")), []);
  assert.ok(pastedErrors(staff("Bone Wand", "+4 to Level of all Cold Spell Skills")).some((message) => /không thể xuất hiện trên Bone Wand/.test(message)));
  // A value far above every tier; a point above a tier is not.
  assert.ok(pastedErrors(ring("+900 to maximum Life")).some((message) => /giá trị 900 vượt xa mọi bậc/.test(message)));
  assert.deepEqual(pastedErrors(ring("+125 to maximum Life")), []);
  // A tier the item level cannot have.
  assert.ok(pastedErrors(ring("+35 to Strength").replace("Item Level: 82", "Item Level: 5")).some((message) => /cần cấp vật phẩm/.test(message)));
  // Three mods of one group, seven affixes, mods on a normal item.
  assert.deepEqual(pastedErrors(ring("+30% to Fire Resistance", "+31% to Fire Resistance")), [], "two lines of one stat exist on real items (one desecrated)");
  assert.ok(pastedErrors(ring("+30% to Fire Resistance", "+31% to Fire Resistance", "+32% to Fire Resistance")).some((message) => /quá nhiều mod cùng một nhóm/.test(message)));
  assert.ok(pastedErrors(ring("+30% to Fire Resistance", "+30% to Cold Resistance", "+30% to Lightning Resistance", "+20% to Chaos Resistance")).some((message) => /quá nhiều mod/.test(message)), "four suffixes");
  assert.ok(pastedErrors("Rarity: MAGIC\nGold Ring\nItem Level: 82\n+30% to Fire Resistance\n+30% to Cold Resistance").some((message) => /đồ ma thuật chỉ có tối đa 1 tiền tố và 1 hậu tố/.test(message)));
  assert.ok(pastedErrors("Rarity: NORMAL\nGold Ring\nItem Level: 82\n+30% to Fire Resistance").some((message) => /Đồ thường không có tiền tố hay hậu tố/.test(message)));
  // Sockets above the base's hard limit, more runes than sockets.
  assert.ok(pastedErrors(ring().replace("Implicits: 0", "Sockets: S\nImplicits: 0")).some((message) => /Ring không có lỗ rune/.test(message)));
  assert.ok(pastedErrors("Rarity: RARE\nX\nLeather Vest\nItem Level: 82\nSockets: S S S S S").some((message) => /Body Armour có tối đa 4 lỗ rune \(đang 5\)/.test(message)));
  assert.deepEqual(pastedErrors("Rarity: RARE\nX\nLeather Vest\nItem Level: 82\nQuality: 30\nSockets: S S S S"), [], "quality 30% and four sockets exist");
  // Lines the data does not know, unknown bases and uniques are left alone.
  assert.deepEqual(pastedErrors(ring("30% increased Zeal of the Forgotten")), []);
  assert.deepEqual(pastedErrors("Rarity: RARE\nX\nNo Such Base\nItem Level: 82\n+900 to maximum Life"), []);
  assert.deepEqual(pastedErrors("Rarity: UNIQUE\nWhatever\nGold Ring\n+900 to maximum Life"), []);
});

test("pasted items: no real item of the ladder fixtures is rejected, pasted or after a trip through the editor", () => {
  const rows = fixtureItems();
  for (const { file, text } of rows) {
    const label = `${file}: ${text.split("\n").slice(1, 3).join(" / ")}`;
    assert.deepEqual(pastedErrors(text), [], label);
    const saved = mods.serializeEditableItem(mods.parseEditableItem(text, pool), pool);
    assert.deepEqual(mods.validateItemText(saved, pool, text), [], label);
  }
  assert.ok(rows.length > 150 || rows.length === 0, `checked ${rows.length} items`);
  // The server's row check agrees (items as a PoB import sends them: not edited).
  const problems = itemRowErrors(rows.map((row, index) => ({ inventory_id: `i${index}`, raw_text: row.text })), calculationRowItem, pool);
  assert.deepEqual(problems, []);
});

// ── Server ──────────────────────────────────────────────────────────────────

test("server check: edited items the browser sends are validated against their original", () => {
  const edited = RING.replace("+115 to maximum Life", "+400 to maximum Life");
  assert.ok(mods.validateItemText(edited, pool, RING).some((error) => /vượt khoảng/.test(error.message)));
  const fakeLine = `${RING}\n+90% to all Elemental Resistances`;
  assert.ok(mods.validateItemText(fakeLine, pool, RING).length > 0, "a mod outside the pool is rejected");
  // An invalid pasted item does not become valid by editing something else on it.
  const cheat = `${RING}\n+900 to Accuracy Rating\n+90 to Strength`;
  const editedCheat = cheat.replace("+115 to maximum Life", "+110 to maximum Life");
  assert.ok(mods.validateItemText(editedCheat, pool, cheat).some((error) => /vượt xa mọi bậc/.test(error.message)));
});

const runtime = pobRuntime();
test("editing an item changes what PoB calculates", { skip: runtime.available ? false : "PoB not installed locally", timeout: 120_000 }, async () => {
  const item = mods.parseEditableItem(RING, pool);
  item.mods.find((line) => line.family === "IncreasedLife").values = [100];
  const lower = mods.serializeEditableItem(item, pool);
  assert.deepEqual(mods.validateItemText(lower, pool, RING), []);
  const body = (text) => buildPobXml({ className: "Witch", ascendancy: "None", level: 80, passives: [], inventory_slots: [{ inventory_id: "Ring1", raw_text: text }] });
  const [before, after] = await Promise.all([runPob(body(RING), runtime), runPob(body(lower), runtime)]);
  assert.equal(before.Life - after.Life, 15, "Life drops by the 15 points taken off the ring");
});

test("PoB reads a built item's implicit and a corruption enchant", { skip: runtime.available ? false : "PoB not installed locally", timeout: 120_000 }, async () => {
  const body = (slot, text) => buildPobXml({ className: "Witch", ascendancy: "None", level: 80, passives: [], inventory_slots: [{ inventory_id: slot, raw_text: text }] });
  const vest = built("Vagabond Armour");
  const key = mods.corruptionOptions(pool, vest).enchants.find((row) => /Armour and Evasion/.test(row.text)).key;
  const enchanted = mods.setCorruption(pool, vest, null, { kind: "enchant", key, values: [20] });
  const [ring, plain, corrupted] = await Promise.all([
    runPob(body("Ring1", mods.serializeEditableItem(built("Amethyst Ring"), pool)), runtime),
    runPob(body("BodyArmour1", mods.serializeEditableItem(vest, pool)), runtime),
    runPob(body("BodyArmour1", mods.serializeEditableItem(enchanted, pool)), runtime)
  ]);
  assert.equal(ring.ChaosResist, 13, "the Amethyst Ring's implicit counts");
  assert.equal(plain.Armour, 83, "the base's own armour");
  assert.equal(corrupted.Armour, 100, "20% increased Armour and Evasion from the enchant (83 x 1.2)");
});

test("server check: implicits and runes cannot be changed or added in the editor", () => {
  const moreImplicit = RING.replace("+8% to Chaos Resistance", "+30% to Chaos Resistance");
  assert.ok(mods.validateItemText(moreImplicit, pool, RING).some((error) => /implicit/.test(error.message)));
  const builtWithImplicit = "Rarity: RARE\nNew Item\nUnset Ring\nItem Level: 82\nImplicits: 1\n+50% to Chaos Resistance";
  assert.ok(mods.validateItemText(builtWithImplicit, pool, "").some((error) => /implicit/.test(error.message)));
  assert.ok(mods.validateItemText(`${RING}\nRune: Desert Rune`, pool, RING).some((error) => /rune/.test(error.message)));
  assert.ok(mods.validateItemText("Rarity: RARE\nNew Item\nLeather Vest\nItem Level: 82\nSockets: S\nRune: Desert Rune", pool, "").some((error) => /rune/.test(error.message)));
});

test("calculate route leaves out items that break the rules (edited or pasted) and says so", async () => {
  const calls = [];
  const app = await buildApp({
    db: null,
    logger: false,
    sessionSecret: "test-session-secret",
    premiumSigner: null,
    pobRunner: { mode: "remote", run: async (xml) => { calls.push(xml); return { Life: 1 }; } }
  });
  const body = (rawText, extra) => ({ className: "Witch", level: 80, skills: [], inventory_slots: [{ inventory_id: "Ring1", raw_text: rawText, ...extra }] });
  const post = (payload) => app.inject({ method: "POST", url: "/api/builds/calculate", payload });
  try {
    const bad = await post(body(RING.replace("+115", "+400"), { original_text: RING }));
    assert.equal(bad.statusCode, 200, "the rest of the build is still calculated");
    assert.match(bad.json().item_errors[0].messages[0], /vượt khoảng/);
    assert.equal(bad.json().item_errors[0].id, "Ring1");
    assert.doesNotMatch(calls.at(-1), /\+400 to maximum Life/, "the invalid ring is not sent to PoB");
    const builtItem = await post(body("Rarity: NORMAL\nUnset Ring\n+50 to maximum Life", { edited: true }));
    assert.equal(builtItem.json().item_errors?.[0]?.id, "Ring1", "a mod put on a normal ring is reported");
    assert.doesNotMatch(calls.at(-1), /\+50 to maximum Life/);
    const fine = await post(body(RING.replace("+115", "+101"), { original_text: RING }));
    assert.equal(fine.statusCode, 200, fine.body);
    assert.equal(fine.json().item_errors, undefined);
    const untouched = await post(body(RING));
    assert.equal(untouched.json().item_errors, undefined, "a real item pasted as it is passes");
    assert.match(calls.at(-1), /\+115 to maximum Life/);
    // Pasted text is checked too: the impossible ring is left out and reported.
    const pasted = await post(body(`${RING}\n+999 to Strength`));
    assert.equal(pasted.statusCode, 200);
    assert.match(pasted.json().item_errors[0].messages[0], /giá trị 999 vượt xa mọi bậc/);
    assert.doesNotMatch(calls.at(-1), /\+999 to Strength/);
  } finally {
    await app.close();
  }
});

test("saving a shared build refuses items that break the rules", async () => {
  const app = await buildApp({ db: null, logger: false, sessionSecret: "test-session-secret", premiumSigner: null, preloadModPool: false });
  const save = (rows) => app.inject({ method: "POST", url: "/api/builds", payload: { name: "x", inventory: rows } });
  try {
    const bad = await save([{ inventoryId: "Ring1", rawText: RING.replace("+115", "+400"), originalText: RING, edited: true }]);
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().error, /vượt khoảng/);
    const pasted = await save([{ inventoryId: "Ring1", rawText: `${RING}\n+999 to Strength` }]);
    assert.equal(pasted.statusCode, 400);
    assert.match(pasted.json().error, /Món đồ không hợp lệ \(Ring1\).*vượt xa mọi bậc/);
    // A valid build passes the checks (and then needs the database, which this test has none of).
    const real = await save([{ inventoryId: "Ring1", rawText: RING }]);
    assert.equal(real.statusCode, 503, real.body);
  } finally {
    await app.close();
  }
});

test("legacy pool: the poe2db files still build a pool when item-mods-data.js is not given", () => {
  const read = (file, name) => {
    const context = { window: {} };
    vm.runInNewContext(readFileSync(join(dataDir, file), "utf8"), context);
    return context.window[name];
  };
  const legacy = mods.buildModPool(read("craft-data.js", "POE2_CRAFT"), read("craft-index.js", "POE2_CRAFT_INDEX"), []);
  assert.equal(legacy.source, "poe2db");
  const item = mods.parseEditableItem(RING, legacy);
  assert.equal(item.mods.find((line) => line.family === "IncreasedLife").gen, "prefix");
  assert.deepEqual(mods.validateEditableItem(item, legacy, mods.parseEditableItem(RING, legacy)), []);
  assert.deepEqual(mods.validatePastedItem(item, legacy), [], "the pasted rules need PoB's data and stay quiet without it");
});

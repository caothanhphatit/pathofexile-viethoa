// Item editor: mod pool, editable item round trip, validation rules, mod suggestions.
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import * as mods from "../src/shared/item-mods.mjs";
import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { buildApp } from "../src/server/app.mjs";
import { pobRuntime, runPob } from "../scripts/check-pob-parity.mjs";
import { loadModPool } from "../scripts/lib/mod-pool-node.mjs";
import { repoRoot } from "../scripts/lib/planner-node.mjs";

const pool = loadModPool(join(repoRoot, "public", "data"));
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
const addMod = (item, query) => {
  const suggestion = mods.suggestMods(pool, item, query)[0];
  assert.ok(suggestion, `no mod for "${query}"`);
  return mods.addSuggestedMod(item, suggestion);
};

test("pool: every base has a class with prefixes and suffixes; hybrid tiers split into lines", () => {
  assert.ok(pool.classes.size >= 50);
  assert.ok(pool.bases.size >= 1500);
  const ring = mods.poolClassForBase(pool, "Unset Ring");
  assert.match(ring.cls.itemClass, /^Ring/);
  assert.deepEqual(mods.splitHybridText("(6—13)% increased Evasion Rating+(7—10) to maximum Life"), ["(6-13)% increased Evasion Rating", "+(7-10) to maximum Life"]);
  assert.deepEqual(mods.lineTemplate("Adds (3-5) to 9 Fire Damage"), { template: "Adds # to # Fire Damage", ranges: [[3, 5], [9, 9]] });
});

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

test("rule: values stay inside the tier range", () => {
  const original = mods.parseEditableItem(RING, pool);
  const item = mods.parseEditableItem(RING, pool);
  item.mods.find((line) => line.family === "IncreasedLife").values = [150];
  assert.ok(errorsOf(item, original).some((message) => /vượt khoảng 100–119/.test(message)));
});

test("rule: affix limits by rarity (rare 3/3, magic 1/1, normal none)", () => {
  const original = mods.parseEditableItem(RING, pool);
  let item = mods.parseEditableItem(RING, pool);
  item = addMod(item, "mana"); // second prefix (life, mana)
  item = addMod(item, "accuracy"); // third prefix
  assert.deepEqual(errorsOf(item, original), []);
  const blocked = mods.suggestMods(pool, item, "rarity").find((row) => row.gen === "prefix");
  assert.equal(blocked.blocked, "Đã đủ 3 tiền tố.", "a fourth prefix is listed but blocked");
  assert.equal(mods.addSuggestedMod(item, blocked), item, "and cannot be added");
  const forced = { ...item, mods: [...item.mods, mods.newPoolModLine(blocked.mod, item)] };
  assert.ok(errorsOf(forced, original).includes("Đã đủ 3 tiền tố (đồ hiếm)."));

  const magic = { ...mods.parseEditableItem("Rarity: MAGIC\nUnset Ring\nItem Level: 80", pool) };
  const oneLife = addMod(magic, "maximum life");
  assert.deepEqual(errorsOf(oneLife), []);
  assert.match(mods.suggestMods(pool, oneLife, "mana").find((row) => row.gen === "prefix").blocked, /Đã đủ 1 tiền tố/);
  const normal = mods.parseEditableItem("Rarity: NORMAL\nUnset Ring", pool);
  assert.match(mods.suggestMods(pool, normal, "life")[0].blocked, /Đồ thường không có mod/);
});

test("rule: no two mods of the same family", () => {
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
  assert.ok(errorsOf(forced).some((message) => /không xuất hiện trên Boots/.test(message)), errorsOf(forced).join(" | "));

  const lowLevel = mods.parseEditableItem("Rarity: RARE\nX\nUnset Ring\nItem Level: 10", pool);
  const life = mods.poolClassForBase(pool, "Unset Ring").cls.mods.find((mod) => mod.family === "IncreasedLife");
  const best = life.tiers[life.tiers.length - 1];
  const tooHigh = { ...lowLevel, mods: [{ ...mods.newPoolModLine(life, lowLevel), tier: best.tier, values: [best.lines[0].ranges[0][0]] }] };
  assert.ok(errorsOf(tooHigh).some((message) => /cần cấp vật phẩm/.test(message)));
  assert.ok(mods.newPoolModLine(life, lowLevel).tier > best.tier, "new mods start at the best tier the item level allows (T1 is the top)");
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
});

test("rule: sockets, quality and lines that are not recognised", () => {
  const ring = mods.parseEditableItem(RING, pool);
  assert.ok(errorsOf({ ...ring, sockets: 1 }).some((message) => /không có lỗ rune/.test(message)));
  const body = mods.parseEditableItem("Rarity: RARE\nX\nLeather Vest\nItem Level: 80", pool);
  assert.deepEqual(errorsOf({ ...body, sockets: 2 }), []);
  assert.ok(errorsOf({ ...body, sockets: 3 }).some((message) => /tối đa 2 lỗ/.test(message)));
  assert.ok(errorsOf({ ...body, quality: 25 }).includes("Chất lượng tối đa 20%."));
  // An unknown line from the game is kept; one that was not there before is rejected.
  const withUnknown = `${RING}\n30% increased Explicit Speed Modifier magnitudes`;
  assert.deepEqual(mods.validateItemText(withUnknown, pool, withUnknown), []);
  assert.ok(mods.validateItemText(withUnknown, pool, RING).includes
    ? mods.validateItemText(withUnknown, pool, RING).some((error) => /Không nhận diện được/.test(error.message))
    : false);
});

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

test("server check: edited items the browser sends are validated against their original", () => {
  const edited = RING.replace("+115 to maximum Life", "+400 to maximum Life");
  assert.ok(mods.validateItemText(edited, pool, RING).some((error) => /vượt khoảng/.test(error.message)));
  const fakeLine = `${RING}\n+90% to all Elemental Resistances`;
  assert.ok(mods.validateItemText(fakeLine, pool, RING).length > 0, "a mod outside the pool is rejected");
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

test("calculate route rejects edited items that break the rules, before running PoB", async () => {
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
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().error, /vượt khoảng/);
    assert.equal(bad.json().item_errors[0].id, "Ring1");
    const built = await post(body("Rarity: NORMAL\nUnset Ring\n+50 to maximum Life", { edited: true }));
    assert.equal(built.statusCode, 400, "a mod put on a normal ring is rejected");
    assert.equal(calls.length, 0, "PoB never ran for them");
    const fine = await post(body(RING.replace("+115", "+101"), { original_text: RING }));
    assert.equal(fine.statusCode, 200, fine.body);
    const untouched = await post(body(`${RING}\n+999 to Strength`));
    assert.equal(untouched.statusCode, 200, "items straight from the game or a PoB code are not judged");
  } finally {
    await app.close();
  }
});

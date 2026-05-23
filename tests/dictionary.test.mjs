import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { hasDirtyEnglishDescription } from "../scripts/glossary-lib.mjs";

const loadDictionary = async () => {
  const source = await readFile(new URL("../public/data/dictionary-data.js", import.meta.url), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.POE2_DICTIONARY_TERMS;
};

const loadSkillGems = async () => {
  const source = await readFile(new URL("../public/data/skill-gems-data.js", import.meta.url), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.POE2_SKILL_GEMS;
};

test("dictionary data exposes unique preserved POE terms", async () => {
  const dictionary = await loadDictionary();
  const terms = dictionary.terms || [];
  const names = terms.map((entry) => entry.term);

  assert.ok(terms.length >= 40);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("Attack"));
  assert.ok(names.includes("Distilled Emotion"));
  assert.ok(names.includes("Notable Passive Skill"));
});

test("dictionary entries have category, meaning, and keep rationale", async () => {
  const dictionary = await loadDictionary();
  const categories = dictionary.categories || {};

  for (const entry of dictionary.terms) {
    assert.ok(categories[entry.category], `${entry.term} has a known category`);
    assert.ok(entry.meaning.length > 12, `${entry.term} has meaning text`);
    assert.ok(entry.keep.length > 12, `${entry.term} explains why it stays untranslated`);
    assert.ok(Array.isArray(entry.examples), `${entry.term} has examples array`);
  }
});

test("dictionary keeps curated Vietnamese meanings and item rarity terms", async () => {
  const dictionary = await loadDictionary();
  const terms = dictionary.terms || [];
  const attack = terms.find((entry) => entry.term === "Attack");
  const itemRarity = terms.find((entry) => entry.term === "Item Rarity");
  const precursorTablets = terms.find((entry) => entry.term === "Precursor Tablets");
  const waystones = terms.find((entry) => entry.term === "Waystones");

  assert.match(attack.meaning, /Attack/);
  assert.doesNotMatch(attack.meaning, /^Attacks are skills/);
  assert.match(itemRarity.meaning, /Normal.*Magic.*Rare.*Unique/);
  assert.equal(precursorTablets.category, "endgame");
  assert.equal(waystones.category, "endgame");
  assert.doesNotMatch(precursorTablets.meaning, /can be used|are special/i);
  assert.doesNotMatch(waystones.meaning, /can be used|travel to Maps/i);
  assert.deepEqual(Array.from(itemRarity.variants), [
    "Magic",
    "Normal",
    "Rare",
    "Rarity of Items",
    "Unique",
    "Uniques"
  ]);
});

test("dictionary gives readable gameplay meanings for ailment core terms", async () => {
  const dictionary = await loadDictionary();
  const terms = dictionary.terms || [];
  const byTerm = new Map(terms.map((entry) => [entry.term, entry]));

  for (const term of ["Ailment", "Ailment Threshold", "Elemental Ailment Threshold", "Lightning Ailment"]) {
    assert.ok(byTerm.has(term), `${term} exists`);
    assert.doesNotMatch(byTerm.get(term).meaning, /keyword gốc|Keyword in-game/i, `${term} avoids placeholder meaning`);
  }

  assert.match(byTerm.get("Ailment").meaning, /trạng thái bất lợi|Bleeding|Poison|Ignite|Shock|Freeze/i);
  assert.match(byTerm.get("Ailment Threshold").meaning, /ngưỡng|khó gây|mạnh yếu/i);
  assert.match(byTerm.get("Elemental Ailment Threshold").meaning, /Elemental Ailment|Ignite|Shock|Freeze/i);
  assert.match(byTerm.get("Lightning Ailment").meaning, /Shock|Electrocution|Lightning/i);
});

test("dictionary replaces placeholder glossary copy with gameplay meanings", async () => {
  const dictionary = await loadDictionary();
  const terms = dictionary.terms || [];
  const byTerm = new Map(terms.map((entry) => [entry.term, entry]));
  const placeholder = /keyword gốc|tag gốc|trùng tooltip|Keyword in-game|Quy chuẩn/i;
  const bad = terms.filter((entry) => placeholder.test(entry.meaning) || placeholder.test(entry.keep || ""));

  assert.equal(bad.length, 0, bad.map((entry) => entry.term).join(", "));
  assert.match(byTerm.get("Weapon Set").meaning, /bộ trang bị vũ khí|hoán đổi|active ở cả hai Weapon Set/);
  assert.match(byTerm.get("Corrupted Blood").meaning, /Debuff cộng dồn|Physical Damage over Time|stack/);
  assert.match(byTerm.get("Barrageable").meaning, /bắn theo loạt|Barrage|Projectile/);
});

test("dictionary exposes every skill gem tag as an English lookup term", async () => {
  const [dictionary, skillGems] = await Promise.all([loadDictionary(), loadSkillGems()]);
  const lookupNames = new Set((dictionary.terms || []).map((entry) => entry.term));
  const skillTags = new Set((skillGems.gems || []).flatMap((gem) => gem.tags || []));
  const missing = [...skillTags].filter((tag) => !lookupNames.has(tag)).sort((a, b) => a.localeCompare(b, "en"));

  assert.deepEqual(missing, []);

  const persistent = dictionary.terms.find((entry) => entry.term === "Persistent");
  const staged = dictionary.terms.find((entry) => entry.term === "Staged");
  const chaos = dictionary.terms.find((entry) => entry.term === "Chaos");
  const ammunition = dictionary.terms.find((entry) => entry.term === "Ammunition");

  assert.match(persistent.meaning, /bật\/tắt trong Bảng kỹ năng|giữ Spirit/);
  assert.match(staged.meaning, /stage/i);
  assert.match(chaos.meaning, /Kháng Chaos|Chaos/);
  assert.match(ammunition.meaning, /tag cho skill|Crossbow/);
});

test("dictionary page renders compact lookup cards without keep-note panels", async () => {
  const html = await readFile(new URL("../public/dictionary.html", import.meta.url), "utf8");

  assert.match(html, /compactMeaning/);
  assert.doesNotMatch(html, /Keyword in-game/);
  assert.doesNotMatch(html, /Tag skill của Skill Gem in-game/);
  assert.match(html, /term-meaning/);
  assert.match(html, /id="modalOriginal"/);
  assert.doesNotMatch(html, /Nguyên bản PoE2DB English/);
  assert.doesNotMatch(html, /Quy chuẩn giữ từ gốc/);
  assert.doesNotMatch(html, /modalKeep/);
  assert.doesNotMatch(html, /escapeHtml\(term\.keep\)/);
  assert.doesNotMatch(html, />keep</);
  assert.doesNotMatch(html, /variantChips/);
  assert.doesNotMatch(html, />Tooltip</);
});

test("dictionary meanings do not expose mixed English/Vietnamese glue text", async () => {
  const dictionary = await loadDictionary();
  const dirty = (dictionary.terms || []).filter((entry) => hasDirtyEnglishDescription(entry.meaning));

  assert.equal(dirty.length, 0, dirty.map((entry) => entry.term).join(", "));
});

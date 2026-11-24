import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { POB_GEMS, isPobGemId, pobGemId, pobGemsByName, resolvePobGem } from "../src/server/pob-gem-ids.mjs";
import { applyPobGemIds, pobIdForGemRecord, readSkillGemsFile } from "../scripts/skill-gems/pob-gem-ids.mjs";
import { parseGemsLua } from "../scripts/refresh-pob-gem-ids.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gems = readSkillGemsFile(path.join(ROOT_DIR, "public", "data", "skill-gems-data.js")).gems;
const ID = (tail) => `Metadata/Items/Gems/${tail}`;

test("the PoB gem id list is loaded and has unique ids", () => {
  assert.ok(POB_GEMS.length > 500);
  assert.equal(new Set(POB_GEMS.map((gem) => gem.id)).size, POB_GEMS.length);
  assert.ok(isPobGemId(ID("SkillGemHeraldOfAsh")));
  assert.ok(!isPobGemId(ID("SkillGemHeraldofAsh")));
});

test("every gem record PoB knows carries PoB's own id", () => {
  const wrong = [];
  let mapped = 0;
  for (const gem of gems) {
    const support = gem.gem_type === "support";
    const pobHasIt = pobGemsByName(gem.name).some((candidate) => candidate.support === support);
    if (!pobHasIt && !pobIdForGemRecord(gem)) continue; // newer than the pob-core checkout
    if (isPobGemId(gem.official_id)) mapped += 1;
    else wrong.push(`${gem.name} [${gem.gem_type}] ${gem.official_id || "(none)"}`);
  }
  assert.deepEqual(wrong, [], "run: node scripts/refresh-pob-gem-ids.mjs");
  assert.ok(mapped > 900, `only ${mapped} gem records map to a PoB id`);
  // Applying again changes nothing: the shipped data is up to date.
  assert.deepEqual(applyPobGemIds(structuredClone(gems)).changed, []);
});

test("the gems the audit found dropped by PoB now map to PoB ids", () => {
  const idOf = (name, type = "skill") => gems.find((gem) => gem.name === name && gem.gem_type === type)?.official_id;
  assert.equal(idOf("Herald of Ash"), ID("SkillGemHeraldOfAsh"));
  assert.equal(idOf("Decompose"), ID("SkillGemCorpseCloud"));
  assert.equal(idOf("Pounce"), ID("SkillGemWolfPounce"));
  assert.equal(idOf("Cast on Critical"), ID("SkillGemCastOnCritical"));
  assert.equal(idOf("Hand of Chayula"), "Metadata/Items/Gem/SkillGemHandOfChayula");
  assert.equal(idOf("Mace Strike"), "Metadata/Items/Gem/SkillGemPlayerDefault1HMace");
  assert.equal(idOf("Spear Stab"), "Metadata/Items/Gem/SkillGemPlayerDefaultSpear");
  assert.equal(idOf("Lightning Bolt"), ID("SkillGemLightningBolt"));
  assert.equal(idOf("Unleash"), "Metadata/items/Gems/SkillGemStaffUnleash");
  assert.equal(idOf("Unleash", "support"), ID("SupportGemUnleash"));
});

test("pobIdForGemRecord keeps valid ids and picks by name and kind", () => {
  assert.equal(pobIdForGemRecord({ name: "Herald of Ash", gem_type: "skill", official_id: ID("SkillGemHeraldofAsh") }), ID("SkillGemHeraldOfAsh"));
  assert.equal(pobIdForGemRecord({ name: "Fire Attunement", gem_type: "support" }), ID("SupportGemFireInfusion"));
  assert.equal(pobIdForGemRecord({ name: "Mórrigan's Insight", gem_type: "support" }), pobGemsByName("Morrigan's Insight")[0].id);
  assert.equal(pobIdForGemRecord({ name: "Not A Gem", gem_type: "skill", official_id: "keep-me" }), "");
});

test("resolvePobGem fixes letter case, Gem/ vs Gems/ and falls back to the name", () => {
  assert.equal(pobGemId(ID("SkillGemHeraldofAsh")), ID("SkillGemHeraldOfAsh"));
  assert.equal(pobGemId("Metadata/Items/Gem/SkillGemHeraldOfAsh"), ID("SkillGemHeraldOfAsh"));
  assert.equal(pobGemId(ID("SkillGemDecompose")), ID("SkillGemCorpseCloud"));
  assert.equal(pobGemId(ID("SkillGemHeraldofAsh3")), ID("SkillGemHeraldOfAsh"));
  assert.equal(pobGemId(ID("SkillGemPounce"), "Pounce"), ID("SkillGemWolfPounce"));
  assert.equal(pobGemId(ID("SkillGemSomethingElse"), "Mace Strike"), "Metadata/Items/Gem/SkillGemPlayerDefault1HMace");
  assert.equal(pobGemId(ID("SupportGemRapidAttacksTwo")), ID("SupportGemMartialTempoTwo"));
  // A skill id never resolves to a support (and the other way round).
  assert.equal(resolvePobGem(ID("SupportGemStaffUnleash"), "Unleash")?.id, ID("SupportGemUnleash"));
  assert.equal(resolvePobGem(ID("SkillGemUnleash"))?.id, "Metadata/items/Gems/SkillGemStaffUnleash");
  // Unknown gems are left alone.
  assert.equal(resolvePobGem(ID("SkillGemAxeSlashForever")), null);
  assert.equal(pobGemId(ID("SkillGemAxeSlashForever")), ID("SkillGemAxeSlashForever"));
});

test("buildPobXml sends PoB's id for a guessed gem id instead of letting PoB drop it", () => {
  const xml = buildPobXml({
    className: "Witch",
    level: 90,
    skills: [{
      skill_id: ID("SkillGemHeraldofAsh"),
      level: 20,
      enabled: true,
      support: [
        { skill_id: ID("SupportGemRapidAttacksTwo"), level: 1, enabled: true },
        { skill_id: "Metadata/Items/Gems/SkillGemDecompose", name_spec: "Decompose", level: 20, enabled: true }
      ]
    }]
  });
  assert.match(xml, /<Gem gemId="Metadata\/Items\/Gems\/SkillGemHeraldOfAsh"/);
  assert.match(xml, /<Gem gemId="Metadata\/Items\/Gems\/SupportGemMartialTempoTwo"/);
  assert.match(xml, /<Gem gemId="Metadata\/Items\/Gems\/SkillGemCorpseCloud"/);
  assert.doesNotMatch(xml, /gemId="[^"]*(?:Heraldof|SkillGemDecompose|RapidAttacksTwo)/);
});

test("pob-gem-ids.json matches PoB's Gems.lua when a pob-core checkout is present", (t) => {
  const gemsLua = path.resolve(process.env.POB_CORE_DIR || path.join(ROOT_DIR, "..", "pob-core", "src"), "Data", "Gems.lua");
  if (!fs.existsSync(gemsLua)) return t.skip(`no ${gemsLua}`);
  const parsed = parseGemsLua(fs.readFileSync(gemsLua, "utf8"));
  const shipped = new Set(POB_GEMS.map((gem) => gem.id));
  const missing = parsed.filter(([id]) => !shipped.has(id)).map(([id]) => id);
  assert.deepEqual(missing, [], "run: node scripts/refresh-pob-gem-ids.mjs");
});

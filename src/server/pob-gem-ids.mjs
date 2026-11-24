// The gem ids Path of Building knows (src/server/data/pob-gem-ids.json, refreshed from
// PoB's Gems.lua by scripts/refresh-pob-gem-ids.mjs) and a resolver for ids PoB would
// not recognise. PoB looks <Gem gemId> up by exact game id and silently drops a gem it
// does not know, so a guessed id ("SkillGemHeraldofAsh" for PoB's "SkillGemHeraldOfAsh",
// "Gem/" for "Gems/", "SkillGemDecompose" for "SkillGemCorpseCloud") loses the skill.
// Shared by the server (pob-build-xml.mjs), the SPA and the gem data scripts.
import data from "./data/pob-gem-ids.json" with { type: "json" };

/** @typedef {{ id: string, name: string, support: boolean }} PobGem */

/** @type {PobGem[]} */
export const POB_GEMS = data.gems.map(([id, name, support]) => ({ id, name, support: Boolean(support) }));

const byId = new Map(POB_GEMS.map((gem) => [gem.id, gem]));
const idTail = (id) => String(id || "").split("/").pop().toLowerCase();
const byTail = new Map();
for (const gem of POB_GEMS) if (!byTail.has(idTail(gem.id))) byTail.set(idTail(gem.id), gem);

/** "Mórrigan's Insight" / "Rapid Attacks II" -> "morrigansinsight" / "rapidattacksii". */
export const gemNameKey = (name) => String(name || "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "");

const byName = new Map();
for (const gem of POB_GEMS) {
  const key = gemNameKey(gem.name);
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(gem);
}

const NUMERALS = { One: "", Two: "ii", Three: "iii", Four: "iv", Five: "v" };

/** "Metadata/Items/Gems/SupportGemRapidAttacksTwo" -> "rapidattacksii" (the name the id spells). */
const nameKeyFromId = (id) => {
  const tail = String(id || "").split("/").pop()
    .replace(/^(?:SkillGem|SupportGem|Support)/i, "")
    .replace(/(One|Two|Three|Four|Five)$/, (word) => NUMERALS[word]);
  return gemNameKey(tail);
};

const isSupportId = (id) => /^Support/i.test(String(id || "").split("/").pop());

/** True when PoB knows this exact gem id. */
export const isPobGemId = (id) => byId.has(String(id || ""));

/** The PoB gem with this id, ignoring letter case and Gem/ vs Gems/. */
export const pobGemByLooseId = (id) => byId.get(String(id || "")) || (id ? byTail.get(idTail(id)) : undefined) || null;

/** True when the id spells the gem's name ("SkillGemHeraldOfAsh" for "Herald of Ash"). */
export const idSpellsName = (id, name) => nameKeyFromId(id) === gemNameKey(name);

/**
 * PoB's gems named `name`, the wanted kind first (Unleash is both a skill and a support).
 * @returns {PobGem[]}
 */
export const pobGemsByName = (name, { support } = {}) => {
  const found = byName.get(gemNameKey(name)) || [];
  if (support === undefined) return found;
  return [...found.filter((gem) => gem.support === support), ...found.filter((gem) => gem.support !== support)];
};

/**
 * The PoB gem for a gem id PoB may not know: the exact id, then the same id ignoring
 * letter case and Gem/ vs Gems/, then by name (`name`, else the name the id spells).
 * @returns {PobGem | null}
 */
export const resolvePobGem = (id, name = "") => {
  const loose = pobGemByLooseId(id);
  if (loose) return loose;
  const support = id ? isSupportId(id) : undefined;
  // A support id only resolves to a support and a skill id only to a skill.
  const kind = (found) => found.filter((gem) => support === undefined || gem.support === support);
  // A guess from a duplicate slug ("Herald_of_Ash__3") ends in the copy number.
  const fromId = id ? [nameKeyFromId(id), nameKeyFromId(id).replace(/\d+$/, "")] : [];
  const byNames = [name, ...fromId].filter(Boolean).map((key) => kind(pobGemsByName(key)));
  return byNames.find((found) => found.length)?.[0] || null;
};

/** The id to send PoB: the resolved PoB id, else `id` unchanged. */
export const pobGemId = (id, name = "") => resolvePobGem(id, name)?.id || String(id || "");

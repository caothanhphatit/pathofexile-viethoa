// Monsters a Spectre or Companion gem can summon, from Path of Building's data
// (src/server/data/pob-monsters.json, written by scripts/refresh-pob-planner-data.mjs).
// See pob-monster-gems.mjs for how PoB stores the choice. The SPA loads this module on
// demand (the list is ~60 KB); the tests use it too.
import data from "./data/pob-monsters.json" with { type: "json" };
import { MONSTER_GEMS } from "./pob-monster-gems.mjs";

export { MONSTER_GEMS, monsterGemTitle, monsterLibraryOf } from "./pob-monster-gems.mjs";

/** @typedef {{ id: string, name: string, category: string, recommendedSpectre: boolean, recommendedBeast: boolean }} PobMonster */

/** @type {PobMonster[]} */
export const POB_MONSTERS = data.monsters.map(([id, name, category, flags = ""]) => ({
  id, name, category, recommendedSpectre: flags.includes("s"), recommendedBeast: flags.includes("b")
}));

const byId = new Map(POB_MONSTERS.map((monster) => [monster.id, monster]));

/** Whether PoB marks the monster as a recommended pick for that library. */
export const isRecommendedMonster = (monster, library) => (library === "beast" ? monster.recommendedBeast : monster.recommendedSpectre);

/**
 * The monsters PoB's library window offers: every monster for a Spectre, beasts only
 * for a Companion (Build.lua OpenSpectreLibrary). Recommended ones first, then by name.
 * @returns {PobMonster[]}
 */
export const monstersForLibrary = (library) => POB_MONSTERS
  .filter((monster) => library !== "beast" || monster.category === "Beast")
  .sort((a, b) => Number(isRecommendedMonster(b, library)) - Number(isRecommendedMonster(a, library))
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

export const monsterById = (id) => byId.get(String(id || "")) || null;

/**
 * The gem fields for a picked monster: PoB's gem for that library, named after the monster
 * ("Companion: Elephant Tortoise"). null for an unknown library or monster.
 */
export const monsterGemPatch = (library, monsterId) => {
  const gem = MONSTER_GEMS[library];
  const monster = monsterById(monsterId);
  if (!gem || !monster) return null;
  return { pobGemId: gem.gemId, pobSkillId: gem.skillId, pobVariantId: gem.variantId, nameSpec: `${gem.prefix}: ${monster.name}` };
};

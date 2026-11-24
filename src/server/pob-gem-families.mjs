// Support gem families, from Path of Building's data (src/server/data/pob-gem-families.json,
// written by scripts/refresh-pob-planner-data.mjs). In the game only one support of a
// family works on a skill (Elemental Armament II and III together: one of them does
// nothing). PoB applies the same rule when it calculates (CalcSetup addBestSupport: of two
// supports sharing a family, the one later in the group replaces the earlier), so the
// numbers are already right; this module lets the planner say so on the skill card.
// Shared by the SPA and the tests.
import data from "./data/pob-gem-families.json" with { type: "json" };
import { resolvePobGem } from "./pob-gem-ids.mjs";

/** PoB gem id -> the families of its granted effect ("ElementalArmament", ...). */
const familiesById = new Map(data.gems.map(([gemId, , families]) => [gemId, families]));

/** Families of a support gem given any id the planner knows it by (and its name). */
export const supportFamilies = (id, name = "") => {
  const gem = resolvePobGem(id, name);
  return (gem && gem.support && familiesById.get(gem.id)) || [];
};

/**
 * Supports of one skill that share a family. `gems` are the group's support gems in
 * order ({ id, name, disabled }); disabled and empty ones are ignored. Each conflict
 * lists the gems' positions; `kept` is the one PoB (and the game) lets work: the last.
 * @returns {Array<{ family: string, gems: number[], kept: number }>}
 */
export const supportFamilyConflicts = (gems) => {
  const byFamily = new Map();
  (Array.isArray(gems) ? gems : []).forEach((gem, index) => {
    if (!gem || gem.disabled || !(gem.id || gem.name)) return;
    for (const family of supportFamilies(gem.id, gem.name)) {
      if (!byFamily.has(family)) byFamily.set(family, []);
      byFamily.get(family).push(index);
    }
  });
  const conflicts = [];
  const seen = new Set();
  for (const [family, indexes] of byFamily) {
    if (indexes.length < 2) continue;
    // Gems that share two families (Alignment + AdditionalProjectiles) are one conflict.
    const key = indexes.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ family, gems: indexes, kept: indexes[indexes.length - 1] });
  }
  return conflicts;
};

/** Whether adding `candidate` to `gems` would put two supports of one family on the skill. */
export const supportFamilyClash = (gems, candidate) => {
  const mine = supportFamilies(candidate?.id, candidate?.name);
  if (!mine.length) return null;
  const index = (Array.isArray(gems) ? gems : []).findIndex((gem) => gem && !gem.disabled && (gem.id || gem.name)
    && supportFamilies(gem.id, gem.name).some((family) => mine.includes(family)));
  return index >= 0 ? { index, family: mine.find((family) => supportFamilies(gems[index].id, gems[index].name).includes(family)) } : null;
};

// Writes Path of Building's gem ids into the site's gem records (official_id), so the
// Build Planner never has to guess an id from the slug. Every script that rewrites
// public/data/skill-gems-data.js runs this before writing (export:skill-gems,
// merge-support-gems-data, fill-missing-from-poe2db); scripts/refresh-pob-gem-ids.mjs
// runs it on its own after pob-core is updated.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { idSpellsName, isPobGemId, pobGemByLooseId, pobGemsByName } from "../../src/server/pob-gem-ids.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SKILL_GEMS_PATH = path.join(ROOT_DIR, "public", "data", "skill-gems-data.js");

/**
 * The PoB id for one gem record, or "" when PoB does not have the gem (newer than the
 * pob-core checkout). A valid id is kept; otherwise the PoB gem of the same name and
 * kind, preferring the one whose id spells the name (Lightning Bolt, not the Breach
 * unique's), else the first in PoB's order (Mace Strike -> the one-handed mace id).
 */
export const pobIdForGemRecord = (gem) => {
  const current = String(gem.official_id || "");
  if (isPobGemId(current)) return current;
  const support = gem.gem_type === "support";
  const sameKind = pobGemsByName(gem.name).filter((candidate) => candidate.support === support);
  if (sameKind.length) {
    return (sameKind.find((candidate) => pobGemByLooseId(current)?.id === candidate.id)
      || sameKind.find((candidate) => idSpellsName(candidate.id, gem.name))
      || sameKind[0]).id;
  }
  // Named differently in PoB but the same id up to letter case / Gem vs Gems.
  return pobGemByLooseId(current)?.id || "";
};

/** Sets official_id to PoB's id on every gem PoB knows. Returns what changed and what PoB lacks. */
export const applyPobGemIds = (gems) => {
  const changed = [];
  const notInPob = [];
  for (const gem of gems) {
    const id = pobIdForGemRecord(gem);
    if (!id) {
      notInPob.push(gem.name);
      continue;
    }
    if (gem.official_id === id) continue;
    changed.push(`${gem.name}: ${gem.official_id || "-"} -> ${id}`);
    gem.official_id = id;
  }
  return { changed, notInPob: [...new Set(notInPob)].sort() };
};

export const readSkillGemsFile = (filePath = SKILL_GEMS_PATH) => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(filePath, "utf8"), sandbox);
  const data = sandbox.window.POE2_SKILL_GEMS;
  if (!data || !Array.isArray(data.gems)) throw new Error(`Could not read ${filePath}`);
  return data;
};

/** applyPobGemIds on public/data/skill-gems-data.js, rewriting it only when something changed. */
export const applyPobGemIdsToFile = (filePath = SKILL_GEMS_PATH) => {
  const data = readSkillGemsFile(filePath);
  const result = applyPobGemIds(data.gems);
  if (result.changed.length) fs.writeFileSync(filePath, `window.POE2_SKILL_GEMS = ${JSON.stringify(data, null, 2)};\n`, "utf8");
  return { file: path.relative(ROOT_DIR, filePath), ...result };
};

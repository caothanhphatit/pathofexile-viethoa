// Server side of the item rules (src/shared/item-mods.mjs): every item of a build is
// checked again before it is calculated or saved.
//
//   - Items the player edited or built in the planner get the editor's full rules,
//     against the text they started from (validateItemText).
//   - Every other item text (pasted from the game, imported from a PoB code) gets the
//     rules no real item breaks (validatePastedItemText): a mod its base can never
//     carry, a value far above every tier, a tier above the item level, too many
//     affixes, a third mod of one group, sockets above the base's limit. Real items
//     do break the editor's limits (desecrated and essence mods, alloys, quality above
//     20%), so those are not held against them; none of the ladder items in
//     tests/fixtures/pob-builds is rejected.
//
// This is not proof an item exists in the game: a pasted item inside those rules is
// taken as it is.
//
// Saving a shared build refuses invalid items. A calculation leaves them out and says
// so, so one bad item does not take the whole build's numbers.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateItemText, validatePastedItemText } from "../shared/item-mods.mjs";
import { loadModPool, modPoolFiles } from "../../scripts/lib/mod-pool-node.mjs";

const defaultDataDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");

let poolState;
/** The mod pool, or null when the data files are missing (then nothing is checked). */
export function serverModPool(dataDir = process.env.POE2_DATA_DIR || defaultDataDir) {
  if (poolState && poolState.dataDir === dataDir) return poolState.pool;
  poolState = { dataDir, pool: modPoolFiles(dataDir) ? loadModPool(dataDir) : null };
  return poolState.pool;
}

/** True when a row says it was changed in the planner. */
const isEdited = (text, original, edited) => Boolean(text) && (edited === true || (typeof original === "string" && original !== text));

/**
 * Errors per item row: [{ id, messages }]. `rows` are objects; `pick(row)` returns
 * { id, text, original, edited } for each (any shape: calculate body or saved project).
 */
export function itemRowErrors(rows, pick, pool = serverModPool()) {
  if (!pool || !Array.isArray(rows)) return [];
  const problems = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { id, text, original, edited } = pick(row);
    if (!text || typeof text !== "string") continue;
    const errors = isEdited(text, original, edited)
      ? validateItemText(text, pool, typeof original === "string" ? original : "")
      : validatePastedItemText(text, pool);
    if (errors.length) problems.push({ id, messages: [...new Set(errors.map((error) => error.message))] });
  }
  return problems;
}

/** The rows without the items that break the rules, and what was left out. */
export function dropInvalidItemRows(rows, pick, pool = serverModPool()) {
  const problems = itemRowErrors(rows, pick, pool);
  if (!problems.length) return { rows, problems };
  const bad = new Set(problems.map((problem) => problem.id));
  return { rows: rows.filter((row) => !(row && typeof row === "object" && bad.has(pick(row).id))), problems };
}

// The names the routes import (they predate the pasted-item rules).
export const editedItemErrors = itemRowErrors;
export const dropInvalidEditedRows = dropInvalidItemRows;

export const calculationRowItem = (row) => ({ id: row.inventory_id, text: row.raw_text, original: row.original_text, edited: row.edited });
export const projectRowItem = (row) => ({ id: row.inventoryId || row.id, text: row.rawText, original: row.originalText, edited: row.edited });

/** One Vietnamese sentence for an error response. */
export function itemErrorSummary(problems) {
  const first = problems[0];
  return `Món đồ không hợp lệ (${first.id}): ${first.messages[0]}${problems.length > 1 || first.messages.length > 1 ? " …" : ""}`;
}

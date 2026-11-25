// Shared item-row validation for both the server routes and the in-browser local
// calculation path (delegates to the rules in ./item-mods.mjs).
//
//   - Items edited or crafted in the planner get the editor's full rules against the
//     text they started from (validateItemText).
//   - All other item texts (pasted from the game, imported from a PoB code) get the
//     rules no real item breaks (validatePastedItemText).
import { validateItemText, validatePastedItemText } from "./item-mods.mjs";

/** True when a row says it was changed in the planner. */
const isEdited = (text, original, edited) => Boolean(text) && (edited === true || (typeof original === "string" && original !== text));

/**
 * Errors per item row: [{ id, messages }]. `rows` are objects; `pick(row)` returns
 * { id, text, original, edited } for each (any shape: calculate body or saved project).
 */
export function itemRowErrors(rows, pick, pool) {
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
export function dropInvalidItemRows(rows, pick, pool) {
  const problems = itemRowErrors(rows, pick, pool);
  if (!problems.length) return { rows, problems };
  const bad = new Set(problems.map((problem) => problem.id));
  return { rows: rows.filter((row) => !(row && typeof row === "object" && bad.has(pick(row).id))), problems };
}

export const calculationRowItem = (row) => ({ id: row.inventory_id, text: row.raw_text, original: row.original_text, edited: row.edited });
export const projectRowItem = (row) => ({ id: row.inventoryId || row.id, text: row.rawText, original: row.originalText, edited: row.edited });

/** One Vietnamese sentence for an error response. */
export function itemErrorSummary(problems) {
  const first = problems[0];
  return `Món đồ không hợp lệ (${first.id}): ${first.messages[0]}${problems.length > 1 || first.messages.length > 1 ? " …" : ""}`;
}

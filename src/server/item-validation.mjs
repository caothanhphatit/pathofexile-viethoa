// Server side of the item editor rules (src/shared/item-mods.mjs): items the
// player edited or built in the planner are checked again before they are
// calculated or saved, so the browser cannot skip the rules. Items straight from
// the game or a PoB code (no edit) are passed through as they are.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateItemText } from "../shared/item-mods.mjs";
import { loadModPool } from "../../scripts/lib/mod-pool-node.mjs";

const defaultDataDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");

let poolState;
/** The mod pool, or null when the data files are missing (then nothing is checked). */
export function serverModPool(dataDir = process.env.POE2_DATA_DIR || defaultDataDir) {
  if (poolState && poolState.dataDir === dataDir) return poolState.pool;
  const ready = ["craft-data.js", "craft-index.js", "items-data.js"].every((file) => existsSync(join(dataDir, file)));
  poolState = { dataDir, pool: ready ? loadModPool(dataDir) : null };
  return poolState.pool;
}

/** True when a row says it was changed in the planner. */
const isEdited = (text, original, edited) => Boolean(text) && (edited === true || (typeof original === "string" && original !== text));

/**
 * Errors per edited row: [{ id, messages }]. `rows` are objects; `pick(row)` returns
 * { id, text, original, edited } for each (any shape: calculate body or saved project).
 */
export function editedItemErrors(rows, pick, pool = serverModPool()) {
  if (!pool || !Array.isArray(rows)) return [];
  const problems = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { id, text, original, edited } = pick(row);
    if (!isEdited(text, original, edited)) continue;
    const errors = validateItemText(String(text), pool, typeof original === "string" ? original : "");
    if (errors.length) problems.push({ id, messages: [...new Set(errors.map((error) => error.message))] });
  }
  return problems;
}

export const calculationRowItem = (row) => ({ id: row.inventory_id, text: row.raw_text, original: row.original_text, edited: row.edited });
export const projectRowItem = (row) => ({ id: row.inventoryId || row.id, text: row.rawText, original: row.originalText, edited: row.edited });

/** One Vietnamese sentence for an error response. */
export function itemErrorSummary(problems) {
  const first = problems[0];
  return `Món đồ đã sửa không hợp lệ (${first.id}): ${first.messages[0]}${problems.length > 1 || first.messages.length > 1 ? " …" : ""}`;
}

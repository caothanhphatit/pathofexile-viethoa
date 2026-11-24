// Loads the item-editor mod pool from public/data under Node (server and tests):
// item-mods-data.js (Path of Building's mod data, scripts/build-item-mod-pool.mjs)
// and the unique items of items-data.js. Without item-mods-data.js it falls back to
// the older poe2db files craft-data.js + craft-index.js.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import { buildModPool } from "../../src/shared/item-mods.mjs";

const readGlobal = (dataDir, file, name) => {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(join(dataDir, file), "utf8"), context);
  return context.window[name];
};

/** The data files a pool can be built from, or null when they are missing. */
export function modPoolFiles(dataDir) {
  const has = (file) => existsSync(join(dataDir, file));
  if (!has("items-data.js")) return null;
  if (has("item-mods-data.js")) return ["item-mods-data.js", "items-data.js"];
  if (has("craft-data.js") && has("craft-index.js")) return ["craft-data.js", "craft-index.js", "items-data.js"];
  return null;
}

let cached = null;
/** The pool built from `<dataDir>` (cached per process). */
export function loadModPool(dataDir) {
  if (cached && cached.dataDir === dataDir) return cached.pool;
  const files = modPoolFiles(dataDir);
  if (!files) throw new Error(`No item mod data in ${dataDir}`);
  const uniques = (readGlobal(dataDir, "items-data.js", "POE2_ITEMS")?.items ?? []).filter((item) => item.rarity === "unique");
  const pool = files[0] === "item-mods-data.js"
    ? buildModPool(readGlobal(dataDir, "item-mods-data.js", "POE2_ITEM_MODS"), null, uniques)
    : buildModPool(readGlobal(dataDir, "craft-data.js", "POE2_CRAFT"), readGlobal(dataDir, "craft-index.js", "POE2_CRAFT_INDEX"), uniques);
  cached = { dataDir, pool };
  return pool;
}

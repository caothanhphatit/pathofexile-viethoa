// Loads the item-editor mod pool from public/data under Node (server and tests):
// craft-data.js, craft-index.js and the unique items of items-data.js.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import { buildModPool } from "../../src/shared/item-mods.mjs";

const readGlobal = (dataDir, file, name) => {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(join(dataDir, file), "utf8"), context);
  return context.window[name];
};

let cached = null;
/** The pool built from `<dataDir>/{craft-data,craft-index,items-data}.js` (cached per process). */
export function loadModPool(dataDir) {
  if (cached && cached.dataDir === dataDir) return cached.pool;
  const craftData = readGlobal(dataDir, "craft-data.js", "POE2_CRAFT");
  const craftIndex = readGlobal(dataDir, "craft-index.js", "POE2_CRAFT_INDEX");
  const items = readGlobal(dataDir, "items-data.js", "POE2_ITEMS");
  const pool = buildModPool(craftData, craftIndex, (items?.items ?? []).filter((item) => item.rarity === "unique"));
  cached = { dataDir, pool };
  return pool;
}

// Shared browser loader for the PoB item mod pool used by both the item editor
// and local calculation validation, built once per page session.
import { buildModPool, type ModPool } from "../../shared/item-mods.mjs";
import { loadItemModsData, loadItemsData } from "./data";

let cachedPool: ModPool | null = null;
let pendingPool: Promise<ModPool | null> | null = null;

/**
 * Loads `item-mods-data.js` and `items-data.js` once and builds the shared ModPool.
 * Returns null if the data scripts cannot be loaded (e.g. offline or non-browser tests).
 */
export function ensureBrowserModPool(): Promise<ModPool | null> {
  if (cachedPool) return Promise.resolve(cachedPool);
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(null);
  }
  if (!pendingPool) {
    pendingPool = Promise.all([loadItemModsData(), loadItemsData()])
      .then(([itemModsData, itemsPayload]) => {
        const items = Array.isArray(itemsPayload?.items) ? itemsPayload.items : [];
        const uniques = items
          .filter((item: { rarity?: string }) => String(item?.rarity).toLowerCase() === "unique")
          .map((item: { name?: string; rarity?: string; mods?: string[] }) => ({
            name: item.name,
            rarity: "unique",
            mods: item.mods
          }));
        cachedPool = buildModPool(itemModsData, null, uniques);
        return cachedPool;
      })
      .catch(() => {
        pendingPool = null;
        return null;
      });
  }
  return pendingPool;
}

/** Allows the item editor to register an already-built pool so it is not built twice. */
export function setBrowserModPool(pool: ModPool): void {
  cachedPool = pool;
  pendingPool = Promise.resolve(pool);
}

// Weapon-set rules for the planner's paper doll: which off-hand goes with which main
// hand, what moves back to the inventory when a new item conflicts, and the one-line
// reason shown to the player. The rule itself is Path of Building's and lives in
// src/shared/equipment-rules.mjs (the calculation API applies the same one).
import {
  describeEquipment,
  fitsMainHand,
  fitsOffHand,
  isMainHandSlot,
  isOffHandSlot,
  offHandConflict,
  pairedWeaponSlot,
  weaponFlagsForRows,
  weaponSetProblems,
  type OffHandConflict,
  type WeaponFlags
} from "../../shared/equipment-rules.mjs";
import { equipStashItem, unequipSlot, type InventoryState } from "./buildInventory";
import type { BuildInventoryChoice, BuildStashItem } from "./buildPlanner";

export type WeaponRuleReason = OffHandConflict | "off-hand-only";

export interface WeaponNotice {
  reason: WeaponRuleReason;
  /** The item the player was equipping (or the main-hand item, for a build that came in wrong). */
  itemName: string;
  /** The item that went back to the inventory; unset when the new item was refused instead. */
  movedName?: string;
  rejected?: boolean;
}

type Named = { itemName?: string; rareName?: string; rawText?: string };

const displayName = (item: Named | undefined): string => {
  if (!item) return "";
  if (item.rareName) return item.rareName;
  // A rare's own name is the first line after "Rarity:".
  const header = String(item.rawText ?? "").replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
  const start = header.findIndex((line) => /^Rarity:/i.test(line));
  return (start >= 0 && header[start + 1]) || item.itemName || "";
};

/** Giant's Blood / Instruments of Power / Lord of the Wilds for the build as it is. */
export function buildWeaponFlags(inventory: BuildInventoryChoice[], allocatedIds: Iterable<string>): WeaponFlags {
  return weaponFlagsForRows(inventory, allocatedIds);
}

/**
 * Slot categories ("weapon" = main hand, "offhand") of a weapon or off-hand item by
 * PoB's tags, or null for an item the weapon data does not know (rings, armour, or a
 * base newer than the data): the caller then keeps the site's own categories.
 */
export function weaponSlotCategories(item: Parameters<typeof describeEquipment>[0], flags: WeaponFlags): string[] | null {
  const info = describeEquipment(item)?.info;
  if (!info) return null;
  return [...(fitsMainHand(info) ? ["weapon"] : []), ...(fitsOffHand(info, flags) ? ["offhand"] : [])];
}

export interface WeaponEquipResult {
  state: InventoryState;
  notice?: WeaponNotice;
}

/**
 * Equips a stash item with the game's weapon-set rule: an item that cannot be held
 * together with the new one goes back to the inventory; an item that could not sit in
 * that slot even with the other hand empty is refused. Slots outside the weapon sets
 * behave like equipStashItem.
 */
export function equipWithWeaponRules(state: InventoryState, itemId: string, slotId: string, allocatedIds: Iterable<string> = []): WeaponEquipResult {
  const item = state.stash.find((row) => row.id === itemId);
  if (!item) return { state };
  const otherSlot = pairedWeaponSlot(slotId);
  if (!otherSlot) return { state: equipStashItem(state, itemId, slotId) };

  const passives = [...allocatedIds];
  const incoming = describeEquipment(item);
  const itemName = displayName(item);
  if (isMainHandSlot(slotId) && incoming?.info && !fitsMainHand(incoming.info)) {
    return { state, notice: { reason: "off-hand-only", itemName, rejected: true } };
  }

  const equipped = equipStashItem(state, itemId, slotId);
  // The new item may itself carry a flag line, so the flags are those of the result.
  const flags = weaponFlagsForRows(equipped.inventory, passives);
  const other = equipped.inventory.find((row) => row.inventoryId === otherSlot);
  const otherDescription = describeEquipment(other);
  const offHand = isOffHandSlot(slotId);
  const reason = offHand ? offHandConflict(otherDescription, incoming, flags) : offHandConflict(incoming, otherDescription, flags);
  if (!reason) return { state: equipped };

  if (offHand) {
    // Would it fit with the main hand empty? If not, the slot cannot take it at all.
    const alone = offHandConflict(null, incoming, flags);
    if (alone) return { state, notice: { reason: alone, itemName, rejected: true } };
  }
  return {
    state: unequipSlot(equipped, otherSlot),
    notice: { reason, itemName, movedName: displayName(other) }
  };
}

/**
 * Moves every off-hand item that cannot be held with its main hand back to the
 * inventory (imported builds, saved builds from before the rule, a keystone taken off
 * the tree). Returns the same state when both sets are fine.
 */
export function enforceWeaponSets(state: InventoryState, allocatedIds: Iterable<string> = []): { state: InventoryState; notices: WeaponNotice[] } {
  const passives = [...allocatedIds];
  let next = state;
  const notices: WeaponNotice[] = [];
  // Taking an item off can change the flags (an item granting one), so check again.
  for (let pass = 0; pass < 4; pass += 1) {
    const problems = weaponSetProblems(next.inventory, weaponFlagsForRows(next.inventory, passives));
    if (!problems.length) break;
    for (const problem of problems) {
      const moved = next.inventory.find((row) => row.inventoryId === problem.slot);
      const main = next.inventory.find((row) => row.inventoryId === problem.mainSlot);
      notices.push({ reason: problem.reason, itemName: displayName(main), movedName: displayName(moved) });
      next = unequipSlot(next, problem.slot);
    }
  }
  return { state: next, notices };
}

/** The inventory a calculation uses: impossible off-hands left out (a safety net; the page moves them to the stash). */
export function inventoryWithoutImpossibleOffHands(inventory: BuildInventoryChoice[], allocatedIds: Iterable<string> = []): BuildInventoryChoice[] {
  const problems = weaponSetProblems(inventory, weaponFlagsForRows(inventory, [...allocatedIds]));
  if (!problems.length) return inventory;
  const bad = new Set(problems.map((problem) => problem.slot));
  return inventory.filter((row) => !bad.has(row.inventoryId) || !(row.itemName || row.rawText));
}

const WHY: Record<WeaponRuleReason, { vi: string; en: string }> = {
  "main-is-two-handed": { vi: "Vũ khí hai tay chiếm cả hai tay, không cầm thêm đồ tay phụ", en: "A two-handed weapon leaves no off-hand" },
  "bow-needs-quiver": { vi: "Cung chỉ đi cùng ống tên (quiver)", en: "A bow only takes a quiver" },
  "quiver-needs-bow": { vi: "Ống tên (quiver) chỉ dùng khi tay chính cầm cung", en: "A quiver needs a bow in the main hand" },
  "talisman-needs-sceptre": { vi: "Với Lord of the Wilds, talisman chỉ đi cùng sceptre không phải unique", en: "With Lord of the Wilds a talisman only takes a non-unique sceptre" },
  "staff-needs-focus": { vi: "Với Instruments of Power, staff chỉ đi cùng focus", en: "With Instruments of Power a staff only takes a focus" },
  "spear-main-hand-only": { vi: "Spear chỉ cầm được ở tay chính", en: "A spear only goes in the main hand" },
  "no-dual-wield-with-caster": { vi: "Tay chính cầm wand hoặc sceptre thì tay phụ không cầm vũ khí", en: "No off-hand weapon next to a wand or sceptre" },
  "two-handed-item": { vi: "Vũ khí hai tay không đặt được vào tay phụ", en: "A two-handed weapon cannot go in the off-hand" },
  "main-hand-only": { vi: "Món này chỉ cầm được ở tay chính", en: "This item only goes in the main hand" },
  "off-hand-only": { vi: "Món này chỉ đặt được ở tay phụ", en: "This item only goes in the off-hand" }
};

/** One line for the player: the rule, and what happened to which item. */
export function weaponNoticeText(notice: WeaponNotice, locale: string): string {
  const vi = locale === "vi";
  const why = vi ? WHY[notice.reason].vi : WHY[notice.reason].en;
  if (notice.rejected) {
    return vi ? `${why}: không mặc ${notice.itemName || "món này"} vào ô này được.` : `${why}: ${notice.itemName || "this item"} cannot go there.`;
  }
  return vi
    ? `${why}: đã cất ${notice.movedName || "món còn lại"} vào kho.`
    : `${why}: ${notice.movedName || "the other item"} went back to the inventory.`;
}

export type { WeaponFlags };
export type StashLike = Pick<BuildStashItem, "rawText" | "itemName" | "baseName" | "isUnique">;

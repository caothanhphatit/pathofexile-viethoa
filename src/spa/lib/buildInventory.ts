// The build's personal inventory ("Kho đồ"): items the player has for this build
// but is not wearing — alternate items from the PoB code, items pasted from the
// game (Ctrl+C), items added from the site's item list, and whatever was taken
// off. Equipping moves an item from the inventory into a slot; the item it
// replaces goes back into the inventory. Pure functions; the page holds state.
import {
  parsePobItemDetails,
  type BuildInventoryChoice,
  type BuildStashItem,
  type PobImportData,
  type StashSource
} from "./buildPlanner";

export { normalizeStash, type BuildStashItem, type StashSource } from "./buildPlanner";

export interface InventoryState {
  inventory: BuildInventoryChoice[];
  stash: BuildStashItem[];
}

/** Equipment slot ids for each item category (the site's build_slot_categories vocabulary). */
export const SLOT_CATEGORY_SLOTS: Record<string, string[]> = {
  weapon: ["Weapon1", "Weapon3"],
  offhand: ["Weapon2", "Weapon4"],
  helmet: ["Helm1"],
  "body-armour": ["BodyArmour1"],
  gloves: ["Gloves1"],
  boots: ["Boots1"],
  amulet: ["Amulet1"],
  ring: ["Ring1", "Ring2", "Ring3"],
  belt: ["Belt1"],
  "life-flask": ["LifeFlask1"],
  "mana-flask": ["ManaFlask1"],
  charm: ["Charm1", "Charm2", "Charm3"],
  relic: ["Trinket1"]
};

const WEAPON_SET_SLOTS: Record<string, 1 | 2> = { Weapon1: 1, Weapon2: 1, Weapon3: 2, Weapon4: 2 };

let idCounter = 0;
export const stashId = () => `stash-${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Name, base and rarity of a stash item, from its text when it has one. */
export function stashItemSummary(item: BuildStashItem): { name: string; baseName: string; rarity: string } {
  if (item.rawText) {
    const details = parsePobItemDetails(item.rawText);
    if (details.name) return { name: details.name, baseName: details.baseName || details.name, rarity: details.rarity || "normal" };
  }
  return { name: item.itemName, baseName: item.baseName || item.itemName, rarity: item.isUnique ? "unique" : "normal" };
}

export function stashItemFromText(text: string, source: StashSource = "paste", extra: Partial<BuildStashItem> = {}): BuildStashItem | null {
  const rawText = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!/^(Item Class:.*\n)?\s*Rarity:/i.test(rawText) && !/\nRarity:/i.test(rawText)) return null;
  const details = parsePobItemDetails(rawText);
  if (!details.name) return null;
  const isUnique = details.rarity === "unique";
  return {
    id: stashId(),
    rawText,
    itemName: isUnique ? details.name : details.baseName || details.name,
    isUnique,
    baseName: details.baseName || details.name,
    source,
    ...extra
  };
}

/** Splits text holding several copied items (PoB / game separate blocks by blank lines or "Rarity:" headers). */
export function splitItemTexts(text: string): string[] {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const starts: number[] = [];
  const pattern = /^(?:Item Class:[^\n]*\n)?Rarity:/gim;
  for (let match = pattern.exec(normalized); match; match = pattern.exec(normalized)) starts.push(match.index);
  if (starts.length <= 1) return [normalized];
  return starts.map((start, index) => normalized.slice(start, starts[index + 1] ?? normalized.length).trim()).filter(Boolean);
}

export function stashItemFromChoice(choice: BuildInventoryChoice, source: StashSource = "unequipped"): BuildStashItem | null {
  if (!choice.itemName && !choice.rawText) return null;
  return {
    id: stashId(),
    rawText: choice.rawText || undefined,
    itemName: choice.itemName,
    isUnique: choice.isUnique,
    baseName: choice.baseName || undefined,
    itemSlug: choice.itemSlug || undefined,
    iconUrl: choice.iconUrl || undefined,
    source
  };
}

export function choiceFromStashItem(item: BuildStashItem, slotId: string): BuildInventoryChoice {
  const details = item.rawText ? parsePobItemDetails(item.rawText) : null;
  const isUnique = details ? details.rarity === "unique" : item.isUnique;
  const itemName = details?.name
    ? (isUnique ? details.name : details.baseName || details.name)
    : item.itemName;
  const rareName = details && !isUnique && details.name && details.baseName && details.name !== details.baseName ? details.name : undefined;
  return {
    id: `item-${slotId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    inventoryId: slotId,
    itemName,
    note: rareName ?? "",
    isUnique,
    levelStart: "",
    levelEnd: "",
    baseName: details?.baseName || item.baseName,
    itemSlug: item.itemSlug,
    iconUrl: item.iconUrl,
    itemLevel: details?.itemLevel,
    quality: details?.quality,
    corrupted: details ? details.corrupted : undefined,
    rareName,
    rawText: item.rawText
  };
}

const emptyChoice = (slotId: string): BuildInventoryChoice => ({
  id: `item-${slotId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  inventoryId: slotId,
  itemName: "",
  note: "",
  isUnique: false,
  levelStart: "",
  levelEnd: ""
});

const isFilled = (choice: BuildInventoryChoice | undefined) => Boolean(choice && (choice.itemName || choice.rawText));

/** Puts a stash item into a slot; the item already there goes back into the stash. */
export function equipStashItem(state: InventoryState, itemId: string, slotId: string): InventoryState {
  const item = state.stash.find((row) => row.id === itemId);
  if (!item) return state;
  const current = state.inventory.find((row) => row.inventoryId === slotId);
  const replaced = isFilled(current) ? stashItemFromChoice(current!) : null;
  const next = choiceFromStashItem(item, slotId);
  const inventory = current
    ? state.inventory.map((row) => (row.inventoryId === slotId ? next : row))
    : [...state.inventory, next];
  const stash = state.stash.filter((row) => row.id !== itemId);
  if (replaced) stash.unshift(replaced);
  return { inventory, stash };
}

/** Takes the item off a slot and keeps it in the stash. */
export function unequipSlot(state: InventoryState, slotId: string): InventoryState {
  const current = state.inventory.find((row) => row.inventoryId === slotId);
  if (!isFilled(current)) return state;
  const item = stashItemFromChoice(current!);
  return {
    inventory: state.inventory.map((row) => (row.inventoryId === slotId ? emptyChoice(slotId) : row)),
    stash: item ? [item, ...state.stash] : state.stash
  };
}

export function removeStashItem(state: InventoryState, itemId: string): InventoryState {
  return { ...state, stash: state.stash.filter((row) => row.id !== itemId) };
}

/** Item categories from the text alone: the game's "Item Class:" line, else the base name. */
export function itemCategoriesFromText(text: string, baseName = ""): string[] {
  const itemClass = String(text || "").match(/^Item Class:\s*(.+)$/im)?.[1]?.trim().toLowerCase() || "";
  const base = (baseName || (text ? parsePobItemDetails(text).baseName : "")).toLowerCase();
  const subject = `${itemClass} ${base}`;
  const rules: Array<[RegExp, string[]]> = [
    [/life flask/, ["life-flask"]],
    [/mana flask/, ["mana-flask"]],
    [/\bcharm/, ["charm"]],
    [/\bjewel|emerald|ruby|sapphire|diamond/, []],
    [/\b(ring)s?\b/, ["ring"]],
    [/\b(amulet|torc|choker|pendant)s?\b/, ["amulet"]],
    [/\b(belt|sash|stygian)s?\b/, ["belt"]],
    [/\b(helmet|helm|crown|mask|hood|circlet|cap|tiara|hat|bascinet|burgonet)s?\b/, ["helmet"]],
    [/\b(glove|gauntlet|mitt|bracer|wrap)s?\b/, ["gloves"]],
    [/\b(boot|greave|slipper|sandal|shoe|sabaton)s?\b/, ["boots"]],
    [/\b(body armour|body armor|armour|plate|vest|tunic|robe|garb|coat|jacket|mail|raiment|cuirass|hauberk|vestment|leathers?|brigandine|lamellar)s?\b/, ["body-armour"]],
    [/\b(shield|buckler|focus|foci|quiver)s?\b/, ["offhand"]],
    [/\b(claw|dagger|wand|sceptre|scepter|one hand|flail|spear|trap)s?\b/, ["weapon", "offhand"]],
    [/\b(bow|crossbow|staff|staves|quartersta|two hand|warstaff|talisman)/, ["weapon"]],
    [/\b(sword|axe|mace|hammer|club)s?\b/, ["weapon"]],
    [/\b(relic)s?\b/, ["relic"]]
  ];
  for (const [pattern, categories] of rules) {
    if (pattern.test(subject)) return categories;
  }
  return [];
}

export function slotIdsForCategories(categories: string[]): string[] {
  return [...new Set(categories.flatMap((category) => SLOT_CATEGORY_SLOTS[category] ?? []))];
}

/**
 * Slots a click should consider for an item: the selected slot when the item fits it,
 * else the fitting slots of the active weapon set. One result = equip right away;
 * several = ask, unless exactly one of them is empty.
 */
export function equipTargets(categories: string[], options: {
  activeWeaponSet: 1 | 2;
  selectedSlot?: string | null;
  inventory: BuildInventoryChoice[];
  availableSlots?: string[];
}): string[] {
  const available = options.availableSlots ? new Set(options.availableSlots) : null;
  const fitting = slotIdsForCategories(categories)
    .filter((slotId) => !available || available.has(slotId))
    .filter((slotId) => !WEAPON_SET_SLOTS[slotId] || WEAPON_SET_SLOTS[slotId] === options.activeWeaponSet);
  if (options.selectedSlot && fitting.includes(options.selectedSlot)) return [options.selectedSlot];
  if (fitting.length <= 1) return fitting;
  const filled = new Set(options.inventory.filter(isFilled).map((row) => row.inventoryId));
  const empty = fitting.filter((slotId) => !filled.has(slotId));
  if (empty.length === 1) return empty;
  // An off-hand-capable weapon goes to the main hand unless the player picks otherwise.
  return fitting;
}

/** Items of the PoB code that the active item set does not wear (PoB keeps them as alternatives). */
export function stashFromPobImport(data: PobImportData): BuildStashItem[] {
  const hasSlottedItems = data.items.some((item) => item.slot);
  if (!hasSlottedItems) return [];
  const seen = new Set<string>();
  const rows: BuildStashItem[] = [];
  for (const item of data.items) {
    if (item.slot) continue;
    const text = item.text.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    // Jewels belong in passive tree sockets, not on the paper doll.
    if (!itemCategoriesFromText(text).length && /\bjewel|emerald|ruby|sapphire|diamond\b/i.test(parsePobItemDetails(text).baseName)) continue;
    const row = stashItemFromText(text, "pob");
    if (row) rows.push(row);
  }
  return rows;
}

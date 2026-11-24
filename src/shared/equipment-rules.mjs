// Which main-hand / off-hand pairs a weapon set may hold, shared by the planner (SPA)
// and the calculation API so a calculation never includes an impossible pair.
//
// The rule is Path of Building's ItemsTab:IsItemValidForSlot (PoE2 checkout, commit
// bb52d6b), branch `slotName == "Weapon 2" or slotName == "Weapon 2 Swap"`:
//
//   main hand is a Bow                                  -> only a Quiver
//   main hand is a Talisman, with Lord of the Wilds     -> only a non-unique Sceptre
//   main hand is a Staff, with Instruments of Power     -> only a Focus
//   main hand is empty, one-handed, or (Giant's Blood)
//   a two-handed axe / mace / sword                     -> Shield, Focus, Sceptre;
//                                                          a one-hand weapon (tag one_hand_weapon,
//                                                          not a Spear, and the main hand is not a
//                                                          Wand or Sceptre); with Giant's Blood any
//                                                          axe / mace / sword
//   anything else in the main hand (two-handed)         -> nothing
//
// The main-hand slot takes any base tagged onehand or twohand. Types and tags come from
// PoB's Data/Bases (equipment-rules-data.mjs, generated). The three flags are PoB's
// GiantsBlood / InstrumentsOfPower / LordOfTheWilds mods (ModParser.lua): a passive node
// or an equipped item carrying the stat line sets them. PoB loads a build's XML without
// checking the pair, so the planner has to.
import { GEM_LEVEL_REQUIREMENTS, MULTIPLE_CHOICE_OPTION_NODES, PASSIVE_POINT_ACTS, TREE_VERSION, WEAPON_CLASSES, WEAPON_FLAG_LINES, WEAPON_FLAG_NODES } from "./equipment-rules-data.mjs";

export { TREE_VERSION };

/** The two weapon sets: [main-hand slot, off-hand slot] in the planner's slot ids. */
export const WEAPON_SET_SLOTS = [["Weapon1", "Weapon2"], ["Weapon3", "Weapon4"]];
const MAIN_SLOTS = new Set(WEAPON_SET_SLOTS.map((pair) => pair[0]));
const OFF_SLOTS = new Set(WEAPON_SET_SLOTS.map((pair) => pair[1]));
// PoB's slot names, in case a row uses them.
const SLOT_ALIASES = { "Weapon 1": "Weapon1", "Weapon 2": "Weapon2", "Weapon 1 Swap": "Weapon3", "Weapon 2 Swap": "Weapon4" };

export const NO_WEAPON_FLAGS = Object.freeze({ giantsBlood: false, instrumentsOfPower: false, lordOfTheWilds: false });

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const BASE_INDEX = new Map();
for (const [classKey, entry] of Object.entries(WEAPON_CLASSES)) {
  const info = Object.freeze({ classKey, type: entry.type, tags: Object.freeze([...entry.tags]) });
  for (const base of entry.bases) BASE_INDEX.set(normalize(base), info);
}
const BASE_NAMES_LONGEST_FIRST = [...BASE_INDEX.keys()].sort((a, b) => b.length - a.length);

const hasTag = (info, tag) => Boolean(info && info.tags.includes(tag));
const isBigMelee = (info) => hasTag(info, "axe") || hasTag(info, "mace") || hasTag(info, "sword");

/** PoB's type and tags of a weapon / off-hand base, or null for anything else. */
export function weaponInfoForBase(baseName) {
  return BASE_INDEX.get(normalize(baseName)) ?? null;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The base named inside a longer name ("Superior Dualstring Bow of the Fox"). */
function weaponInfoInName(name) {
  const text = normalize(name);
  if (!text) return null;
  const exact = BASE_INDEX.get(text);
  if (exact) return exact;
  for (const base of BASE_NAMES_LONGEST_FIRST) {
    if (text.length > base.length && new RegExp(`(?:^|[^a-z])${escapeRegExp(base)}(?:$|[^a-z])`).test(text)) return BASE_INDEX.get(base);
  }
  return null;
}

/** The name lines of an item text (PoB or game copy): what follows "Rarity:" up to the first separator or property. */
function headerLines(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => /^Rarity:/i.test(line));
  if (start < 0) return [];
  const header = [];
  for (const line of lines.slice(start + 1)) {
    if (!line || /^-{3,}$/.test(line) || /^[A-Za-z ]+:\s/.test(line) || header.length >= 2) break;
    header.push(line);
  }
  return header;
}

/**
 * What the rule needs to know about one item: its weapon info (null = not a known
 * weapon or off-hand base) and whether it is unique.
 * Accepts the planner's rows (rawText / baseName / itemName / isUnique) and the
 * calculation body's rows (raw_text / item_name / is_unique).
 */
export function describeEquipment(item) {
  if (!item) return null;
  const text = item.rawText ?? item.raw_text ?? "";
  const name = item.itemName ?? item.item_name ?? "";
  if (!text && !name && !item.baseName) return null;
  const rarity = String(text).match(/^\s*Rarity:\s*(\w+)/im)?.[1]?.toLowerCase() ?? "";
  const unique = rarity ? rarity === "unique" || rarity === "relic" : Boolean(item.isUnique ?? item.is_unique);
  const header = headerLines(text);
  // The base line is the last name line; a magic item carries it inside its only line.
  const candidates = [item.baseName, header[header.length - 1], header[0], name];
  let info = null;
  for (const candidate of candidates) {
    info = candidate ? weaponInfoInName(candidate) : null;
    if (info) break;
  }
  return { info, unique };
}

/** Whether a base may sit in a main-hand slot (PoB: tags onehand or twohand). */
export function fitsMainHand(info) {
  return hasTag(info, "onehand") || hasTag(info, "twohand");
}

/** Whether a base can ever sit in an off-hand slot with these flags (some main hand allows it). */
export function fitsOffHand(info, flags = NO_WEAPON_FLAGS) {
  if (!info) return false;
  if (info.type === "Shield" || info.type === "Focus" || info.type === "Sceptre" || info.type === "Quiver") return true;
  if (hasTag(info, "one_hand_weapon") && info.type !== "Spear") return true;
  return Boolean(flags.giantsBlood) && isBigMelee(info);
}

/**
 * Why `off` cannot be in the off-hand next to `main`, or null when the pair is fine.
 * `main` / `off`: describeEquipment() results; null or undefined = empty hand.
 * An item the data does not know (info null) is never judged.
 */
export function offHandConflict(main, off, flags = NO_WEAPON_FLAGS) {
  if (!off || !off.info) return null;
  if (main && !main.info) return null;
  const item = off.info;
  const hand = main ? main.info : null;
  const giantsBlood = Boolean(flags.giantsBlood);
  if (hand && hand.type === "Bow") return item.type === "Quiver" ? null : "bow-needs-quiver";
  if (hand && hand.type === "Talisman" && flags.lordOfTheWilds) return item.type === "Sceptre" && !off.unique ? null : "talisman-needs-sceptre";
  if (hand && hand.type === "Staff" && flags.instrumentsOfPower) return item.type === "Focus" ? null : "staff-needs-focus";
  if (!hand || hasTag(hand, "onehand") || (giantsBlood && isBigMelee(hand))) {
    if (item.type === "Shield" || item.type === "Focus" || item.type === "Sceptre") return null;
    const casterMain = Boolean(hand) && (hand.type === "Wand" || hand.type === "Sceptre");
    if (hasTag(item, "one_hand_weapon") && !casterMain && item.type !== "Spear") return null;
    if (giantsBlood && isBigMelee(item)) return null;
    if (item.type === "Quiver") return "quiver-needs-bow";
    if (item.type === "Spear") return "spear-main-hand-only";
    if (hasTag(item, "one_hand_weapon")) return "no-dual-wield-with-caster";
    if (hasTag(item, "twohand")) return "two-handed-item";
    return "main-hand-only";
  }
  return "main-is-two-handed";
}

/** The weapon flags of a build: allocated passive nodes and the text of its equipped items. */
export function weaponFlags({ passives = [], itemTexts = [] } = {}) {
  const allocated = new Set([...passives].map((id) => Number(id)));
  const texts = [...itemTexts].map((text) => String(text ?? "")).filter(Boolean);
  const flags = {};
  for (const [flag, line] of Object.entries(WEAPON_FLAG_LINES)) {
    flags[flag] = WEAPON_FLAG_NODES[flag].some((id) => allocated.has(id)) || texts.some((text) => text.includes(line));
  }
  return flags;
}

const rowSlot = (row) => {
  const id = String(row?.inventoryId ?? row?.inventory_id ?? "");
  return SLOT_ALIASES[id] ?? id;
};
const rowText = (row) => row?.rawText ?? row?.raw_text ?? "";
const rowFilled = (row) => Boolean(row && (row.itemName || row.item_name || rowText(row)));

/** Flags for a list of inventory rows plus the allocated passives. */
export function weaponFlagsForRows(rows, passives = []) {
  return weaponFlags({ passives, itemTexts: (Array.isArray(rows) ? rows : []).filter(rowFilled).map(rowText) });
}

/**
 * Every problem in the two weapon sets of a list of inventory rows:
 * { slot, reason } with the slot whose item cannot stay. A main-hand slot is only
 * named for an item that is no weapon at all; a bad pair always names the off-hand.
 */
export function weaponSetProblems(rows, flags = NO_WEAPON_FLAGS) {
  const bySlot = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (rowFilled(row)) bySlot.set(rowSlot(row), row);
  }
  const problems = [];
  for (const [mainSlot, offSlot] of WEAPON_SET_SLOTS) {
    const main = describeEquipment(bySlot.get(mainSlot));
    const off = describeEquipment(bySlot.get(offSlot));
    const reason = offHandConflict(main, off, flags);
    if (reason) problems.push({ slot: offSlot, reason, mainSlot });
  }
  return problems;
}

/**
 * The rows a calculation may use: off-hand items that cannot be held with their main
 * hand are left out. Returns the same array when nothing is wrong.
 */
export function dropImpossibleOffHands(rows, passives = []) {
  if (!Array.isArray(rows)) return { rows, dropped: [] };
  const problems = weaponSetProblems(rows, weaponFlagsForRows(rows, passives));
  if (!problems.length) return { rows, dropped: [] };
  const bad = new Map(problems.map((problem) => [problem.slot, problem]));
  const dropped = [];
  const kept = rows.filter((row) => {
    const problem = rowFilled(row) ? bad.get(rowSlot(row)) : undefined;
    if (!problem) return true;
    dropped.push({ slot: problem.slot, reason: problem.reason, item_name: row.itemName ?? row.item_name ?? "" });
    return false;
  });
  return { rows: kept, dropped };
}

export const isMainHandSlot = (slotId) => MAIN_SLOTS.has(SLOT_ALIASES[slotId] ?? slotId);
export const isOffHandSlot = (slotId) => OFF_SLOTS.has(SLOT_ALIASES[slotId] ?? slotId);
/** The other slot of the same weapon set, or "" for a slot outside the weapon sets. */
export function pairedWeaponSlot(slotId) {
  const id = SLOT_ALIASES[slotId] ?? slotId;
  const pair = WEAPON_SET_SLOTS.find((slots) => slots.includes(id));
  return pair ? pair[pair[0] === id ? 1 : 0] : "";
}

/**
 * Character level a gem of this level needs (PoB's levelRequirement). The table ends at
 * gem level 20; a higher level (corrupted gems) reports level 20's requirement, a lower bound.
 */
export function gemLevelRequirement(gemLevel) {
  const level = Math.floor(Number(gemLevel));
  if (!Number.isFinite(level) || level < 1) return undefined;
  return GEM_LEVEL_REQUIREMENTS[Math.min(level, GEM_LEVEL_REQUIREMENTS.length) - 1];
}

// ── Passive points (PoB Modules/Build.lua, buildMode:EstimatePlayerProgress) ──────────
// PoB counts the allocated non-ascendancy nodes (class starts and nodes an item
// allocates for free are not counted). A node taken in both weapon sets is paid once,
// so min(set 1, set 2) comes off. The limit is 99 points from levels plus the quest
// points of every act (which PoE2 0.5 hands out as weapon-set points) plus ExtraPoints.

const CHOICE_OPTIONS = new Set(MULTIPLE_CHOICE_OPTION_NODES);
/** An option of a multiple-choice ascendancy node: PoB does not count it as an ascendancy point. */
export const isChoiceOptionNode = (id) => CHOICE_OPTIONS.has(Number(id));

/** Ascendancy points a character can have (PoB: ascMax). */
export const MAX_ASCENDANCY_POINTS = 8;
/** Points each weapon set can hold (PoB: maxWeaponSets = the quest points of the last act). */
export const WEAPON_SET_POINT_LIMIT = PASSIVE_POINT_ACTS[PASSIVE_POINT_ACTS.length - 1].questPoints;
/** Passive points at level 100 without ExtraPoints (PoB: usedMax). */
export const MAX_PASSIVE_POINTS = 99 + WEAPON_SET_POINT_LIMIT;

/**
 * What a tree costs and the level PoB says it needs ("Required Level" under its point
 * counter). pointsUsed: allocated non-ascendancy nodes; set1 / set2: nodes of each weapon set.
 */
export function passivePointUse({ pointsUsed = 0, set1 = 0, set2 = 0, extra = 0 } = {}) {
  const shared = Math.min(set1, set2);
  const acts = PASSIVE_POINT_ACTS;
  let level = 1;
  for (let act = 0; act < acts.length; act += 1) {
    level = Math.min(Math.max(pointsUsed + 1 - acts[act].questPoints - extra - shared, acts[act].level), 100);
    if (act === acts.length - 1 || level <= acts[act + 1].level) break;
  }
  return { used: pointsUsed - shared, max: MAX_PASSIVE_POINTS + extra, requiredLevel: level };
}

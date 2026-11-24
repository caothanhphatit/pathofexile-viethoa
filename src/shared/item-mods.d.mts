// Types for item-mods.mjs (the item editor rules shared by the SPA and the server).

export interface LineTemplate { template: string; ranges: Array<[number, number]> }
export interface PoolTier { tier: number; name: string; ilvl: number; lines: LineTemplate[] }
export interface PoolMod { key: string; gen: "prefix" | "suffix"; family: string; tags: string[]; templates: string[]; tiers: PoolTier[] }
/** A mod outside the normal pool (essence, desecrated, corruption...). */
export interface ModRecord { id: string; gen: "prefix" | "suffix" | ""; group: string; level: number; lines: LineTemplate[]; tags: string[] }
export interface PoolClass {
  key: string;
  /** PoB item type: "Ring", "Body Armour", "Staff"... */
  itemClass: string;
  label: string;
  /** Affix table: "Item", "Jewel", "Flask" or "Charm". */
  table: string;
  /** Mods the base rolls normally: what the editor offers. */
  mods: PoolMod[];
  /** Mods only special crafting gives (never offered, recognised on pasted items). */
  special: ModRecord[];
  /** Mods a tag of the base itself gives weight 0 (no_fire_spell_mods on a physical staff). */
  excluded?: ModRecord[];
  /** Enchants a Vaal Orb can add (ModCorrupted.lua). */
  corruptions: ModRecord[];
}
export interface PoolBase {
  name: string;
  classKey: string;
  itemClass: string;
  subType?: string;
  reqLevel?: number;
  req?: { level: number; str: number; dex: number; int: number };
  /** Implicit lines as the data writes them ("+(7-13)% to Chaos Resistance"). */
  implicit: string[];
  /** Alternative implicit lines: the base carries exactly one of them (amulets that grant one skill of a list). */
  implicitVariants?: string[];
  /** Most rune sockets the base can ever have (the last one only by corruption); 0 = none. */
  socketLimit?: number;
  maxQuality?: number;
  /** Base defences (Armour, Evasion, EnergyShield, BlockChance, MovementPenalty). */
  armour?: Record<string, number>;
  /** Base weapon stats (PhysicalMin, PhysicalMax, CritChanceBase, AttackRateBase, Range...). */
  weapon?: Record<string, number>;
  spirit?: number;
}
export interface ModPool {
  /** "pob" (item-mods-data.js) or "poe2db" (craft-data.js + craft-index.js). */
  source: "pob" | "poe2db";
  classes: Map<string, PoolClass>;
  /** Bases the editor offers. */
  bases: Map<string, PoolBase>;
  /** Bases that only exist on items from the game (unique-only, unreleased types). */
  hiddenBases: Map<string, PoolBase>;
  unbound: Record<string, ModRecord[]>;
  known: Record<string, Set<string>>;
  uniques: Map<string, LineTemplate[]>;
}

export interface PlainLine { flags: string[]; text: string }
export type ModLine =
  | { id: string; kind: "pool"; modKey: string; gen: "prefix" | "suffix"; family: string; tier: number; values: number[]; flags: string[]; original?: string }
  | { id: string; kind: "unique"; template: string; ranges: Array<[number, number]>; values: number[]; flags: string[]; original?: string }
  | { id: string; kind: "fixed"; text: string; flags: string[]; original?: string };

export interface EditableItem {
  rarity: "normal" | "magic" | "rare" | "unique";
  name: string;
  baseName: string;
  itemLevel?: number;
  quality: number;
  sockets: number;
  runes: string[];
  corrupted: boolean;
  header: string[];
  implicits: PlainLine[];
  mods: ModLine[];
}

export interface ItemError { lineId?: string; field?: string; message: string }

export interface ModSuggestion {
  mod: PoolMod;
  tier: PoolTier;
  display: string;
  gen: "prefix" | "suffix";
  family: string;
  tierLabel: string;
  /** Why it cannot be added now; "" when it can. */
  blocked: string;
  useful: number;
  direct: number;
  recent: number;
  numbers: number[];
}

export interface CorruptionEnchant { key: string; text: string; ranges: Array<[number, number]> }
export interface CorruptionOptions { locked: boolean; socket: boolean; enchants: CorruptionEnchant[] }
export interface CorruptionChoice { kind: "none" | "plain" | "socket" | "enchant"; key?: string; values?: number[] }

export declare function normalizeText(value: unknown): string;
export declare function lineTemplate(line: string): LineTemplate;
export declare function lineNumbers(line: string): number[];
export declare function fillTemplate(template: string, values: number[]): string;
export declare function splitHybridText(text: string): string[];
export declare const ITEM_MODS_FORMAT: string;
/** `data` is window.POE2_ITEM_MODS (item-mods-data.js); the old (craft-data, craft-index) pair still works. */
export declare function buildModPool(data: unknown, craftIndex?: unknown, uniqueRecords?: Array<{ name?: string; rarity?: string; mods?: string[] }>): ModPool;
export declare function findBase(pool: ModPool, baseName: string): PoolBase | null;
export declare function poolClassForBase(pool: ModPool, baseName: string): { base: PoolBase; cls: PoolClass | undefined } | null;
export declare const AFFIX_LIMITS: Record<string, number>;
export declare function affixLimit(rarity: string): number;
/** The rarity limit changed by implicit lines such as "-1 Prefix Modifier allowed". */
export declare function affixLimits(item: EditableItem): { prefix: number; suffix: number };
export declare function maxSockets(baseOrClass: PoolBase | string, corrupted?: boolean): number;
export declare const MAX_QUALITY: number;
export declare const MAX_ITEM_LEVEL: number;
export declare const PASTED_MAX_QUALITY: number;
export declare const PASTED_VALUE_TOLERANCE: number;
export declare const PASTED_MAX_PER_GROUP: number;
export declare function tierForValues(mod: PoolMod, values: number[], itemLevel?: number): PoolTier;
export declare function parseEditableItem(rawText: string, pool: ModPool | null): EditableItem;
export declare function findPoolMod(pool: ModPool, item: EditableItem, modKey: string): PoolMod | null;
export declare function modLineText(pool: ModPool, item: EditableItem, line: ModLine): string[];
/** Level needed to equip (PoB's formula), or null when it cannot be known. */
export declare function requiredLevel(item: EditableItem, pool: ModPool): number | null;
export declare function serializeEditableItem(item: EditableItem, pool: ModPool): string;
export declare function baseImplicitLines(base: PoolBase | null | undefined, variant?: number): PlainLine[];
export declare function withBaseImplicits(item: EditableItem, pool: ModPool, variant?: number): EditableItem;
export declare function implicitVariantOf(item: EditableItem, base: PoolBase | null | undefined): number;
export declare function corruptionOptions(pool: ModPool, item: EditableItem, original?: EditableItem | null): CorruptionOptions;
export declare function corruptionState(pool: ModPool, item: EditableItem, original?: EditableItem | null): CorruptionChoice;
export declare function setCorruption(pool: ModPool, item: EditableItem, original: EditableItem | null, choice: CorruptionChoice): EditableItem;
export declare function newPoolModLine(mod: PoolMod, item: EditableItem, values?: number[]): ModLine;
export declare const clamp: (value: number, a: number, b: number) => number;
export declare function lineRanges(pool: ModPool, item: EditableItem, line: ModLine): Array<[number, number]>;
export declare function tierText(tier: PoolTier): string;
export declare function tierLabel(pool: ModPool, item: EditableItem, line: ModLine): string;
export declare function availableTiers(mod: PoolMod, item: EditableItem): PoolTier[];
export declare function validateEditableItem(item: EditableItem, pool: ModPool, original?: EditableItem | null): ItemError[];
/** The rules no real item breaks, for item text from outside the editor (pasted, imported). */
export declare function validatePastedItem(item: EditableItem, pool: ModPool, options?: { tolerance?: number }): ItemError[];
export declare function validatePastedItemText(rawText: string, pool: ModPool): ItemError[];
export declare function validateItemText(rawText: string, pool: ModPool, originalText?: string): ItemError[];
export declare function parseModQuery(query: string): { words: string[]; numbers: number[] };
export declare function addModBlockedReason(mod: PoolMod, item: EditableItem): string;
export declare function suggestMods(pool: ModPool, item: EditableItem, query: string, options?: { recent?: string[]; limit?: number }): ModSuggestion[];
export declare function addSuggestedMod(item: EditableItem, suggestion: ModSuggestion): EditableItem;

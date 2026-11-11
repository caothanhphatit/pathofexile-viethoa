// Types for item-mods.mjs (the item editor rules shared by the SPA and the server).

export interface LineTemplate { template: string; ranges: Array<[number, number]> }
export interface PoolTier { tier: number; name: string; ilvl: number; lines: LineTemplate[] }
export interface PoolMod { key: string; gen: "prefix" | "suffix"; family: string; tags: string[]; templates: string[]; tiers: PoolTier[] }
export interface PoolClass { key: string; itemClass: string; label: string; mods: PoolMod[] }
export interface PoolBase { name: string; classKey: string; itemClass: string; reqLevel?: number }
export interface ModPool {
  classes: Map<string, PoolClass>;
  bases: Map<string, PoolBase>;
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

export declare function normalizeText(value: unknown): string;
export declare function lineTemplate(line: string): LineTemplate;
export declare function lineNumbers(line: string): number[];
export declare function fillTemplate(template: string, values: number[]): string;
export declare function splitHybridText(text: string): string[];
export declare function buildModPool(craftData: unknown, craftIndex: unknown, uniqueRecords?: Array<{ name?: string; rarity?: string; mods?: string[] }>): ModPool;
export declare function poolClassForBase(pool: ModPool, baseName: string): { base: PoolBase; cls: PoolClass | undefined } | null;
export declare const AFFIX_LIMITS: Record<string, number>;
export declare function maxSockets(itemClass: string, corrupted?: boolean): number;
export declare const MAX_QUALITY: number;
export declare const MAX_ITEM_LEVEL: number;
export declare function tierForValues(mod: PoolMod, values: number[], itemLevel?: number): PoolTier;
export declare function parseEditableItem(rawText: string, pool: ModPool | null): EditableItem;
export declare function findPoolMod(pool: ModPool, item: EditableItem, modKey: string): PoolMod | null;
export declare function modLineText(pool: ModPool, item: EditableItem, line: ModLine): string[];
export declare function serializeEditableItem(item: EditableItem, pool: ModPool): string;
export declare function newPoolModLine(mod: PoolMod, item: EditableItem, values?: number[]): ModLine;
export declare const clamp: (value: number, a: number, b: number) => number;
export declare function lineRanges(pool: ModPool, item: EditableItem, line: ModLine): Array<[number, number]>;
export declare function tierLabel(pool: ModPool, item: EditableItem, line: ModLine): string;
export declare function availableTiers(mod: PoolMod, item: EditableItem): PoolTier[];
export declare function validateEditableItem(item: EditableItem, pool: ModPool, original?: EditableItem | null): ItemError[];
export declare function validateItemText(rawText: string, pool: ModPool, originalText?: string): ItemError[];
export declare function parseModQuery(query: string): { words: string[]; numbers: number[] };
export declare function addModBlockedReason(mod: PoolMod, item: EditableItem): string;
export declare function suggestMods(pool: ModPool, item: EditableItem, query: string, options?: { recent?: string[]; limit?: number }): ModSuggestion[];
export declare function addSuggestedMod(item: EditableItem, suggestion: ModSuggestion): EditableItem;

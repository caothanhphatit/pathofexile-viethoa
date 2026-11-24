// Types for equipment-rules.mjs (weapon-set rules shared by the SPA and the server).

export interface WeaponInfo { classKey: string; type: string; tags: readonly string[] }
export interface WeaponFlags { giantsBlood: boolean; instrumentsOfPower: boolean; lordOfTheWilds: boolean }
export interface EquipmentDescription { info: WeaponInfo | null; unique: boolean }
export type OffHandConflict =
  | "bow-needs-quiver"
  | "talisman-needs-sceptre"
  | "staff-needs-focus"
  | "quiver-needs-bow"
  | "spear-main-hand-only"
  | "no-dual-wield-with-caster"
  | "two-handed-item"
  | "main-hand-only"
  | "main-is-two-handed";
export interface EquipmentRow {
  inventoryId?: string;
  inventory_id?: string;
  itemName?: string;
  item_name?: string;
  baseName?: string;
  rawText?: string;
  raw_text?: string;
  isUnique?: boolean;
  is_unique?: boolean;
}
export interface WeaponSetProblem { slot: string; reason: OffHandConflict; mainSlot: string }

export declare const WEAPON_SET_SLOTS: Array<[string, string]>;
export declare const NO_WEAPON_FLAGS: Readonly<WeaponFlags>;
export declare function weaponInfoForBase(baseName: string): WeaponInfo | null;
export declare function describeEquipment(item: EquipmentRow | null | undefined): EquipmentDescription | null;
export declare function fitsMainHand(info: WeaponInfo | null): boolean;
export declare function fitsOffHand(info: WeaponInfo | null, flags?: WeaponFlags): boolean;
export declare function offHandConflict(main: EquipmentDescription | null | undefined, off: EquipmentDescription | null | undefined, flags?: WeaponFlags): OffHandConflict | null;
export declare function weaponFlags(input?: { passives?: Iterable<string | number>; itemTexts?: Iterable<string | undefined> }): WeaponFlags;
export declare function weaponFlagsForRows(rows: EquipmentRow[] | unknown, passives?: Iterable<string | number>): WeaponFlags;
export declare function weaponSetProblems(rows: EquipmentRow[] | unknown, flags?: WeaponFlags): WeaponSetProblem[];
export declare function dropImpossibleOffHands<T>(rows: T, passives?: Iterable<string | number>): { rows: T; dropped: Array<{ slot: string; reason: OffHandConflict; item_name: string }> };
export declare const isMainHandSlot: (slotId: string) => boolean;
export declare const isOffHandSlot: (slotId: string) => boolean;
export declare function pairedWeaponSlot(slotId: string): string;
export declare function gemLevelRequirement(gemLevel: number | undefined): number | undefined;
export declare const MAX_ASCENDANCY_POINTS: number;
export declare const WEAPON_SET_POINT_LIMIT: number;
export declare const MAX_PASSIVE_POINTS: number;
export declare function passivePointUse(input?: { pointsUsed?: number; set1?: number; set2?: number; extra?: number }): { used: number; max: number; requiredLevel: number };
export declare const isChoiceOptionNode: (id: string | number) => boolean;

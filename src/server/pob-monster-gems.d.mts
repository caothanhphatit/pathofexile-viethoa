// Types for pob-monster-gems.mjs (the SPA uses it to find the cards that pick a monster).
export type MonsterLibrary = "spectre" | "beast";
export interface MonsterGemRef {
  pobGemId?: string;
  skillId?: string;
  nameSpec?: string;
}
export declare const MONSTER_GEMS: Record<MonsterLibrary, { gemId: string; skillId: string; variantId: string; prefix: string }>;
export declare const monsterLibraryOf: (gem: MonsterGemRef | null | undefined) => MonsterLibrary | null;
export declare const monsterGemTitle: (gem: MonsterGemRef | null | undefined) => string;

// Types for pob-monsters.mjs, which the SPA loads on demand for the monster selector.
import type { MonsterLibrary } from "./pob-monster-gems.mjs";

export { MONSTER_GEMS, monsterGemTitle, monsterLibraryOf, type MonsterGemRef, type MonsterLibrary } from "./pob-monster-gems.mjs";

export interface PobMonster {
  id: string;
  name: string;
  category: string;
  recommendedSpectre: boolean;
  recommendedBeast: boolean;
}
export interface MonsterGemPatch {
  pobGemId: string;
  pobSkillId: string;
  pobVariantId: string;
  nameSpec: string;
}
export declare const POB_MONSTERS: PobMonster[];
export declare const isRecommendedMonster: (monster: PobMonster, library: MonsterLibrary) => boolean;
export declare const monstersForLibrary: (library: MonsterLibrary) => PobMonster[];
export declare const monsterById: (id: unknown) => PobMonster | null;
export declare const monsterGemPatch: (library: MonsterLibrary, monsterId: string) => MonsterGemPatch | null;

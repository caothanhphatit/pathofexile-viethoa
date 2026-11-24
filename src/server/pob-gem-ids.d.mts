// Types for pob-gem-ids.mjs, which the SPA also imports to map gem records to PoB ids.
export interface PobGem {
  id: string;
  name: string;
  support: boolean;
}
export declare const POB_GEMS: PobGem[];
export declare const gemNameKey: (name: unknown) => string;
export declare const isPobGemId: (id: unknown) => boolean;
export declare const pobGemByLooseId: (id: unknown) => PobGem | null;
export declare const idSpellsName: (id: string, name: string) => boolean;
export declare const pobGemsByName: (name: unknown, options?: { support?: boolean }) => PobGem[];
export declare const resolvePobGem: (id: unknown, name?: unknown) => PobGem | null;
export declare const pobGemId: (id: unknown, name?: unknown) => string;

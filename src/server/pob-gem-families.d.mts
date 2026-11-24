// Types for pob-gem-families.mjs, which the SPA imports for the support family warning.
export interface SupportGemRef {
  id?: string;
  name?: string;
  disabled?: boolean;
}
export interface SupportFamilyConflict {
  family: string;
  /** Positions in the list that was passed in. */
  gems: number[];
  /** The one that works (PoB keeps the last of a family). */
  kept: number;
}
export declare const supportFamilies: (id: unknown, name?: unknown) => string[];
export declare const supportFamilyConflicts: (gems: SupportGemRef[]) => SupportFamilyConflict[];
export declare const supportFamilyClash: (gems: SupportGemRef[], candidate: SupportGemRef) => { index: number; family: string } | null;

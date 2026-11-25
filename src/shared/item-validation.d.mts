import type { ModPool } from "./item-mods.mjs";

export interface ItemRowValidationInput {
  id?: string;
  text?: unknown;
  original?: unknown;
  edited?: unknown;
}

export interface ItemRowProblem {
  id?: string;
  messages: string[];
}

export declare function itemRowErrors<T>(
  rows: T[] | unknown,
  pick: (row: T) => ItemRowValidationInput,
  pool: ModPool | null | undefined
): ItemRowProblem[];

export declare function dropInvalidItemRows<T>(
  rows: T[] | unknown,
  pick: (row: T) => ItemRowValidationInput,
  pool: ModPool | null | undefined
): { rows: T[] | unknown; problems: ItemRowProblem[] };

export declare const calculationRowItem: (row: Record<string, unknown>) => ItemRowValidationInput;
export declare const projectRowItem: (row: Record<string, unknown>) => ItemRowValidationInput;
export declare function itemErrorSummary(problems: ItemRowProblem[]): string;

import type { ModPool } from "./item-mods.mjs";
import type { ItemRowProblem } from "./item-validation.mjs";

export type PreparedCalculateRequest =
  | { ok: false; statusCode: 400; error: string }
  | {
      ok: true;
      build: Record<string, unknown>;
      xml: string;
      itemErrors: ItemRowProblem[];
      equipmentDropped: unknown[];
    };

export interface BuildCalculationResponse {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  item_errors?: ItemRowProblem[];
  equipment_dropped?: unknown[];
}

export type PreparedNodeDeltasRequest =
  | { ok: false; statusCode: 400; error: string }
  | {
      ok: true;
      build: Record<string, unknown>;
      nodeIds: number[];
      xml: string;
    };

export interface NodeDeltasResponse {
  ok: boolean;
  data?: { base: Record<string, number>; nodes: Record<string, unknown> };
  error?: string;
}

export declare function prepareCalculateRequest(
  buildData: unknown,
  options?: { modPool?: ModPool | null }
): PreparedCalculateRequest;

export declare function formatCalculateResponse(
  stats: Record<string, unknown>,
  meta?: { itemErrors?: ItemRowProblem[]; equipmentDropped?: unknown[] }
): BuildCalculationResponse;

export declare function prepareNodeDeltasRequest(
  buildData: unknown,
  options?: { modPool?: ModPool | null }
): PreparedNodeDeltasRequest;

export declare function formatNodeDeltasResponse(output: Record<string, unknown>): NodeDeltasResponse;

export declare function runCalculateRequest(
  buildData: unknown,
  options: { runPob: (xml: string, prep: Extract<PreparedCalculateRequest, { ok: true }>) => Promise<Record<string, unknown>> | Record<string, unknown>; modPool?: ModPool | null }
): Promise<BuildCalculationResponse>;

export declare function runNodeDeltasRequest(
  buildData: unknown,
  options: { runPob: (xml: string, prep: Extract<PreparedNodeDeltasRequest, { ok: true }>) => Promise<Record<string, unknown>> | Record<string, unknown>; modPool?: ModPool | null }
): Promise<NodeDeltasResponse>;

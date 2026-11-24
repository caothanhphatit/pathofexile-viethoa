// Types for src/server/pob-node-deltas.mjs, shared with the browser local calculator.
import type { NodeDeltaBatch } from "../spa/lib/nodePreview";

export declare const NODE_DELTA_STATS: string[];
export declare const NODE_DELTAS_MAX_NODES: number;
export declare const nodeDeltaIds: (value: unknown) => number[];
export declare function nodeDeltasXml(build: Record<string, unknown>, ids: unknown): string;
export declare function nodeDeltasFromOutput(output: Record<string, unknown>): NodeDeltaBatch;

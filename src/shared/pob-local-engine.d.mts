// Types for src/shared/pob-local-engine.mjs.
export interface PobLocalEngineTimings {
  vmInitMs: number;
  pobLoadMs: number;
}

export interface PobLocalEngineMemory {
  luaMemoryKB: number;
  wasmMemoryBytes: number | null;
}

export interface PobLocalEngine {
  timings: PobLocalEngineTimings;
  calculate(xmlText: string): Record<string, unknown>;
  getMemoryStats(options?: { gc?: boolean }): PobLocalEngineMemory;
  close(): void;
}

export interface CreatePobLocalEngineOptions {
  vfs: Map<string, string>;
  calculateScript?: string;
  wasmUri?: string;
  inflate?: (data: string) => string;
  deflate?: (data: string) => string;
}

export declare function buildPersistentCalculateScript(calculateLuaSource: string): string;
export declare function normalizeVfsPath(relPath: string): string;
export declare function createPobLocalEngine(options: CreatePobLocalEngineOptions): Promise<PobLocalEngine>;

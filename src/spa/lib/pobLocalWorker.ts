// Dedicated Web Worker hosting wasmoon (Lua 5.4 WASM) + Path of Building PoE2.
// Loaded lazily only after the user enables local calculation.
import { createPobLocalEngine, type PobLocalEngine } from "../../shared/pob-local-engine.mjs";
import { unpackPobVfs } from "../../shared/pob-local-vfs.mjs";

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

const workerSelf = globalThis as unknown as WorkerScope;

type WorkerRequest =
  | { id: number; type: "init"; vfsGzip: ArrayBuffer; wasmBytes: ArrayBuffer }
  | { id: number; type: "calculate"; xml: string }
  | { id: number; type: "memory"; gc?: boolean }
  | { id: number; type: "dispose" };

type WorkerResponse =
  | { id: number; type: "phase"; phase: "decompressing" | "loading_pob" }
  | { id: number; ok: true; timings?: { vmInitMs: number; pobLoadMs: number; decompressMs: number }; memory?: { luaMemoryKB: number; wasmMemoryBytes: number | null }; data?: Record<string, unknown>; ms?: number }
  | { id: number; ok: false; error: string; fatal?: boolean };

let engine: PobLocalEngine | null = null;

async function decodeVfsBytes(vfsBytes: ArrayBuffer): Promise<Uint8Array> {
  const view = new Uint8Array(vfsBytes);
  // If already unpacked by HTTP Content-Encoding (POBV magic), skip manual gunzip.
  if (view.byteLength >= 4 && view[0] === 0x50 && view[1] === 0x4f && view[2] === 0x42 && view[3] === 0x56) {
    return view;
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Browser does not support DecompressionStream('gzip')");
  }
  try {
    const stream = new Blob([vfsBytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    throw new Error("the stored PoB data could not be unpacked");
  }
}

workerSelf.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg.id !== "number") return;

  try {
    if (msg.type === "init") {
      if (engine) {
        engine.close();
        engine = null;
      }
      workerSelf.postMessage({ id: msg.id, type: "phase", phase: "decompressing" });
      const tDec0 = performance.now();
      let rawBytes: Uint8Array | null = await decodeVfsBytes(msg.vfsGzip);
      // Release the transferred compressed buffer before unpacking into strings.
      msg.vfsGzip = new ArrayBuffer(0);
      const vfs = unpackPobVfs(rawBytes);
      // Release the ~30 MB unpacked binary buffer before starting the WASM Lua VM.
      rawBytes = null;
      const decompressMs = performance.now() - tDec0;

      workerSelf.postMessage({ id: msg.id, type: "phase", phase: "loading_pob" });
      const wasmUrl = URL.createObjectURL(new Blob([msg.wasmBytes], { type: "application/wasm" }));
      msg.wasmBytes = new ArrayBuffer(0);
      try {
        engine = await createPobLocalEngine({ vfs, wasmUri: wasmUrl });
      } finally {
        URL.revokeObjectURL(wasmUrl);
      }

      const memory = engine.getMemoryStats({ gc: true });
      workerSelf.postMessage({
        id: msg.id,
        ok: true,
        timings: { ...engine.timings, decompressMs },
        memory
      });
      return;
    }

    if (msg.type === "calculate") {
      if (!engine) throw new Error("Local PoB engine is not initialized");
      const t0 = performance.now();
      const data = engine.calculate(msg.xml);
      const ms = performance.now() - t0;
      workerSelf.postMessage({ id: msg.id, ok: true, data, ms });
      return;
    }

    if (msg.type === "memory") {
      if (!engine) throw new Error("Local PoB engine is not initialized");
      const memory = engine.getMemoryStats({ gc: Boolean(msg.gc) });
      workerSelf.postMessage({ id: msg.id, ok: true, memory });
      return;
    }

    if (msg.type === "dispose") {
      if (engine) {
        engine.close();
        engine = null;
      }
      workerSelf.postMessage({ id: msg.id, ok: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // fatal === false: PoB only rejected this build; the engine itself is still fine.
    const fatal = (error as { fatal?: boolean } | null)?.fatal;
    workerSelf.postMessage({ id: msg.id, ok: false, error: message, ...(typeof fatal === "boolean" ? { fatal } : {}) });
  }
};

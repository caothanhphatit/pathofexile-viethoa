// Starts the local (WebAssembly) PoB engine under Node from the bundle that
// `npm run build:pob-web` writes to public/pob-web/. Used by the parity tests and by
// scripts/bench-pob-local.mjs; the browser worker loads the very same engine module and bundle.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { createPobLocalEngine } from "../../src/shared/pob-local-engine.mjs";
import { unpackPobVfs } from "../../src/shared/pob-local-vfs.mjs";
import { repoRoot } from "./planner-node.mjs";

export const POB_WEB_DIR = join(repoRoot, "public", "pob-web");

/** The built bundle ({ manifest, vfsPath, wasmPath }) or null when it has not been built. */
export function findLocalBundle(baseDir = POB_WEB_DIR) {
  const manifestPath = join(baseDir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const dir = join(baseDir, manifest.version);
  const vfsPath = join(dir, manifest.files.vfs);
  const wasmPath = join(dir, manifest.files.wasm);
  if (!existsSync(vfsPath) || !existsSync(wasmPath)) return null;
  return { manifest, dir, vfsPath, wasmPath };
}

/** Unpacks the bundle and loads PoB once; `timings` gains unpackMs. */
export async function startLocalEngine(bundle = findLocalBundle()) {
  if (!bundle) throw new Error("PoB web bundle not built (npm run build:pob-web)");
  const t0 = performance.now();
  const vfs = unpackPobVfs(gunzipSync(readFileSync(bundle.vfsPath)));
  const unpackMs = performance.now() - t0;
  const engine = await createPobLocalEngine({ vfs, wasmUri: bundle.wasmPath });
  engine.timings.unpackMs = unpackMs;
  return engine;
}

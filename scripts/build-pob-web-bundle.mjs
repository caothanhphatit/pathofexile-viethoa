// Builds the minimal versioned Path of Building PoE2 bundle for browser local calculation.
//
// Usage:
//   node scripts/build-pob-web-bundle.mjs [path/to/pob-core]
//   npm run build:pob-web
//
// Reads PoB's Lua sources (read-only, never edits the PoB checkout), desugars PoB's ~20
// custom LuaJIT/Pluto lines into standard Lua 5.4, verifies every bundled Lua file compiles
// in wasmoon, packs them into a single gzipped binary VFS (`pob-vfs.bin.gz`), copies
// `wasmoon.wasm` and PoB's `LICENSE.md`, and writes versioned + top-level `manifest.json`
// into `public/pob-web/<commit>/`.
//
// Output is gitignored (see .gitignore); run this script whenever PoB is updated.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { createRequire } from "node:module";

import { LuaFactory } from "wasmoon";
import { desugarPobLua } from "./lib/pob-lua-desugar.mjs";
import { packPobVfs } from "../src/shared/pob-local-vfs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

/** Tree versions supported by the Build Planner (src/server/pob-build-xml.mjs + GameVersions.lua). */
export const SUPPORTED_TREE_VERSIONS = ["0_1", "0_2", "0_3", "0_4", "0_5"];

/** Resolves the git commit hash of a PoB checkout without spawning git. */
export function readGitCommit(pobDir) {
  const gitDir = path.join(pobDir, ".git");
  try {
    let head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (head.startsWith("ref:")) {
      const refPath = head.slice(4).trim();
      const refFile = path.join(gitDir, refPath);
      if (fs.existsSync(refFile)) {
        head = fs.readFileSync(refFile, "utf8").trim();
      } else {
        const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8");
        const line = packed.split(/\r?\n/).find((l) => l.endsWith(` ${refPath}`));
        if (line) head = line.split(" ")[0].trim();
      }
    }
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head;
  } catch { /* fall through */ }
  return "unknown";
}

function walkLuaFiles(dir, relRoot, prefix, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkLuaFiles(full, relRoot, prefix, out);
    } else if (entry.name.endsWith(".lua")) {
      const rel = prefix + path.relative(relRoot, full).replace(/\\/g, "/");
      out.push([rel, full]);
    }
  }
}

/**
 * Collects the exact set of PoB files needed for headless calculation of any build:
 * - Entry scripts: HeadlessWrapper.lua, _SimpleGraphic.def.lua, Launch.lua, GameVersions.lua
 * - All src/Modules/**\/*.lua and src/Classes/**\/*.lua
 * - All src/Data/**\/*.lua (Skills, Bases, Uniques, TimelessJewelData, ModCache, ModItem, etc.)
 *   except Data/StatDescriptions (UI-only tooltip formatter, ~5.7 MB, never opened headless)
 * - All runtime/lua/**\/*.lua (dkjson, xml, base64, sha1, sha2, socket, etc.)
 * - TreeData/<version>/tree.lua for every supported tree version
 * - manifest.xml (sets PoB version + devMode so update checks never trigger)
 * - Our scripts/pob-calculate.lua (stored as __planner_calculate.lua)
 * Zero UI art assets (.dds, .dds.zst, .png, .ttf) are included.
 */
export function collectPobBundleFiles(pobDir, { treeVersions = SUPPORTED_TREE_VERSIONS } = {}) {
  const srcDir = path.join(pobDir, "src");
  const runtimeLuaDir = path.join(pobDir, "runtime", "lua");
  if (!fs.existsSync(path.join(srcDir, "HeadlessWrapper.lua"))) {
    throw new Error(`Not a Path of Building checkout (missing src/HeadlessWrapper.lua): ${pobDir}`);
  }

  const files = [];
  for (const rootFile of ["HeadlessWrapper.lua", "_SimpleGraphic.def.lua", "Launch.lua", "GameVersions.lua"]) {
    const full = path.join(srcDir, rootFile);
    if (fs.existsSync(full)) files.push([rootFile, full]);
  }

  const manifestXml = path.join(pobDir, "manifest.xml");
  if (fs.existsSync(manifestXml)) files.push(["../manifest.xml", manifestXml]);

  walkLuaFiles(path.join(srcDir, "Modules"), srcDir, "", files);
  walkLuaFiles(path.join(srcDir, "Classes"), srcDir, "", files);

  const dataDir = path.join(srcDir, "Data");
  for (const entry of fs.readdirSync(dataDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dataDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "StatDescriptions") continue;
      walkLuaFiles(full, srcDir, "", files);
    } else if (entry.name.endsWith(".lua")) {
      files.push([`Data/${entry.name}`, full]);
    }
  }

  walkLuaFiles(runtimeLuaDir, runtimeLuaDir, "../runtime/lua/", files);

  const includedTreeVersions = [];
  for (const ver of treeVersions) {
    const treeLua = path.join(srcDir, "TreeData", ver, "tree.lua");
    if (fs.existsSync(treeLua)) {
      files.push([`TreeData/${ver}/tree.lua`, treeLua]);
      includedTreeVersions.push(ver);
    }
  }

  return { files, includedTreeVersions };
}

/** Extracts PoB version string from manifest.xml (e.g. "0.23.1"). */
function readPobVersion(pobDir) {
  try {
    const xml = fs.readFileSync(path.join(pobDir, "manifest.xml"), "utf8");
    return xml.match(/<Version\b[^>]*\bnumber="([^"]+)"/)?.[1] || "unknown";
  } catch {
    return "unknown";
  }
}

export async function buildPobWebBundle({
  pobDir = process.env.POB_DIR || path.resolve(REPO_ROOT, "..", "pob-core"),
  outBaseDir = path.join(REPO_ROOT, "public", "pob-web"),
  treeVersions = SUPPORTED_TREE_VERSIONS,
  verifyCompile = true
} = {}) {
  const fullCommit = readGitCommit(pobDir);
  const shortCommit = fullCommit.slice(0, 7);
  const pobVersion = readPobVersion(pobDir);

  const { files, includedTreeVersions } = collectPobBundleFiles(pobDir, { treeVersions });

  // Read & desugar all Lua files (in memory only — never mutates pobDir).
  const entries = [];
  let rawBytes = 0;
  let desugaredCount = 0;

  for (const [relPath, fullPath] of files) {
    const orig = fs.readFileSync(fullPath, "utf8");
    rawBytes += Buffer.byteLength(orig, "utf8");
    const content = relPath.endsWith(".lua") ? desugarPobLua(orig) : orig;
    if (content !== orig) desugaredCount += 1;
    entries.push([relPath, content]);
  }

  // Pack our headless calculation entry script into the VFS so worker & tests share one source.
  const calcScriptPath = path.join(REPO_ROOT, "scripts", "pob-calculate.lua");
  const calcScript = fs.readFileSync(calcScriptPath, "utf8");
  rawBytes += Buffer.byteLength(calcScript, "utf8");
  entries.push(["__planner_calculate.lua", calcScript]);

  // Verify every bundled Lua file compiles cleanly in Lua 5.4 (wasmoon).
  if (verifyCompile) {
    const factory = new LuaFactory();
    const lua = await factory.createEngine();
    try {
      const checkFn = await lua.doString(`return function(src, name)
        if src:sub(1, 1) == "#" then src = src:gsub("^[^\\n]*", "") end
        local fn, err = load(src, name)
        return err
      end`);
      const failures = [];
      for (const [relPath, content] of entries) {
        if (!relPath.endsWith(".lua")) continue;
        const err = checkFn(content, "@" + relPath);
        if (err) failures.push(String(err));
      }
      if (failures.length) {
        throw new Error(`Lua 5.4 compile check failed for ${failures.length} file(s):\n${failures.join("\n")}`);
      }
    } finally {
      lua.global.close();
    }
  }

  const packed = Buffer.from(packPobVfs(entries));
  const gzipped = zlib.gzipSync(packed, { level: 9 });
  const brotli = zlib.brotliCompressSync(packed, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });

  // Locate wasmoon's glue.wasm to copy alongside the versioned bundle.
  const wasmoonEntry = require.resolve("wasmoon");
  const wasmSrc = path.join(path.dirname(wasmoonEntry), "glue.wasm");
  if (!fs.existsSync(wasmSrc)) {
    throw new Error(`wasmoon glue.wasm not found at ${wasmSrc}`);
  }
  const wasmRaw = fs.readFileSync(wasmSrc);
  const wasmGzip = zlib.gzipSync(wasmRaw, { level: 9 });
  const wasmBrotli = zlib.brotliCompressSync(wasmRaw, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });

  const licenseSrc = path.join(pobDir, "LICENSE.md");
  if (!fs.existsSync(licenseSrc)) {
    throw new Error(`PoB LICENSE.md not found at ${licenseSrc}`);
  }

  const sha256 = createHash("sha256").update(gzipped).digest("hex");
  const outDir = path.join(outBaseDir, shortCommit);
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "pob-vfs.bin.gz"), gzipped);
  fs.writeFileSync(path.join(outDir, "wasmoon.wasm"), wasmRaw);
  fs.copyFileSync(licenseSrc, path.join(outDir, "LICENSE.md"));

  const manifest = {
    version: shortCommit,
    commit: fullCommit,
    pobVersion,
    builtAt: new Date().toISOString(),
    baseUrl: `/pob-web/${shortCommit}/`,
    treeVersions: includedTreeVersions,
    fileCount: entries.length,
    desugaredCount,
    rawBytes,
    packBytes: packed.length,
    gzipBytes: gzipped.length,
    brotliBytes: brotli.length,
    wasmBytes: wasmRaw.length,
    wasmGzipBytes: wasmGzip.length,
    wasmBrotliBytes: wasmBrotli.length,
    // Actual bytes fetched by the browser over HTTP (pob-vfs.bin.gz + raw wasmoon.wasm without HTTP gzip).
    totalDownloadBytes: gzipped.length + wasmRaw.length,
    totalGzipDownloadBytes: gzipped.length + wasmGzip.length,
    totalBrotliDownloadBytes: brotli.length + wasmBrotli.length,
    sha256,
    files: {
      vfs: "pob-vfs.bin.gz",
      wasm: "wasmoon.wasm",
      license: "LICENSE.md"
    }
  };

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outBaseDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  return { outDir, manifest };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pobDir = path.resolve(process.argv[2] || process.env.POB_DIR || path.join(REPO_ROOT, "..", "pob-core"));
  try {
    const { outDir, manifest } = await buildPobWebBundle({ pobDir });
    const mb = (n) => `${(n / (1024 * 1024)).toFixed(2)} MB`;
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    console.log(`Built PoB web bundle at ${outDir}`);
    console.log(`  PoB version : ${manifest.pobVersion} (commit ${manifest.version})`);
    console.log(`  Tree versions: ${manifest.treeVersions.join(", ")}`);
    console.log(`  Files       : ${manifest.fileCount} (${manifest.desugaredCount} desugared for Lua 5.4)`);
    console.log(`  VFS raw     : ${mb(manifest.rawBytes)} (${manifest.rawBytes.toLocaleString()} B)`);
    console.log(`  VFS gzip    : ${mb(manifest.gzipBytes)} (${manifest.gzipBytes.toLocaleString()} B)`);
    console.log(`  VFS brotli  : ${mb(manifest.brotliBytes)} (${manifest.brotliBytes.toLocaleString()} B)`);
    console.log(`  wasmoon.wasm: ${kb(manifest.wasmBytes)} raw / ${kb(manifest.wasmGzipBytes)} gzip / ${kb(manifest.wasmBrotliBytes)} brotli`);
    console.log(`  First download (vfs.gz + wasm): ${mb(manifest.totalDownloadBytes)} (${mb(manifest.totalGzipDownloadBytes)} if server gzips wasm)`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

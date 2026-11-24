// Export Path of Building PoE2 gem, skill and unique data to JSON under data/pob-extract/.
//
//   node scripts/pob-data/dump.mjs [--pob ../pob-core] [--out data/pob-extract]
//
// PoB's data files are Lua written for its own patched LuaJIT, so they are loaded by PoB
// itself (scripts/pob-data/dump.lua run on <pob-core>/runtime/pob-luajit-bin/pob-luajit.exe,
// see scripts/setup-pob-local.mjs) rather than parsed here. The PoB checkout is only read.
// The raw-*.json files are rewritten with sorted keys so two dumps of the same PoB commit
// are byte-identical.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..", "..");
/** POB_DIR, else the nearest `pob-core` folder beside the repo or one of its parents (git worktrees sit deeper). */
const findPobDir = () => {
  if (process.env.POB_DIR) return path.resolve(process.env.POB_DIR);
  for (let dir = ROOT_DIR; ; dir = path.dirname(dir)) {
    const candidate = path.join(path.dirname(dir), "pob-core");
    if (fs.existsSync(path.join(candidate, "src", "HeadlessWrapper.lua"))) return candidate;
    if (path.dirname(dir) === dir) return path.resolve(ROOT_DIR, "..", "pob-core");
  }
};
export const DEFAULT_POB_DIR = findPobDir();
export const DEFAULT_OUT_DIR = path.join(ROOT_DIR, "data", "pob-extract");
export const RAW_FILES = ["raw-gems.json", "raw-skills.json", "raw-uniques.json"];

/** Recursively sort object keys (arrays keep their order). */
export const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
};

export const findLuajit = (pobDir) => {
  const candidates = [
    process.env.POB_LUAJIT,
    path.join(pobDir, "runtime", "pob-luajit-bin", "pob-luajit.exe"),
    path.join(pobDir, "runtime", "pob-luajit.exe")
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) || null;
};

export const pobCommit = (pobDir) => {
  try {
    return execFileSync("git", ["-C", pobDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

export const dumpPobData = ({ pobDir = DEFAULT_POB_DIR, outDir = DEFAULT_OUT_DIR } = {}) => {
  const srcDir = path.join(pobDir, "src");
  const luajit = findLuajit(pobDir);
  if (!fs.existsSync(path.join(srcDir, "HeadlessWrapper.lua"))) throw new Error(`${pobDir} is not a PoB checkout`);
  if (!luajit) throw new Error("PoB Lua host not found; run node scripts/setup-pob-local.mjs or set POB_LUAJIT");
  fs.mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  const result = execFileSync(luajit, [path.join(__dirname, "dump.lua"), outDir.replace(/\\/g, "/")], {
    cwd: srcDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  for (const file of RAW_FILES) {
    const full = path.join(outDir, file);
    fs.writeFileSync(full, JSON.stringify(sortKeys(JSON.parse(fs.readFileSync(full, "utf8"))), null, 1));
  }
  const meta = { pob_dir: pobDir, pob_commit: pobCommit(pobDir), dumped_at: new Date().toISOString(), dump_ms: Date.now() - started };
  fs.writeFileSync(path.join(outDir, "raw-meta.json"), JSON.stringify(meta, null, 1));
  return { ...meta, stdout: result };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => (args.includes(name) ? path.resolve(args[args.indexOf(name) + 1]) : fallback);
  try {
    const meta = dumpPobData({ pobDir: option("--pob", DEFAULT_POB_DIR), outDir: option("--out", DEFAULT_OUT_DIR) });
    console.log(`PoB ${meta.pob_commit} dumped in ${meta.dump_ms} ms`);
  } catch (error) {
    console.error(error.stderr || error.message);
    process.exitCode = 1;
  }
}

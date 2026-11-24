// Generate site-shaped gem and unique records from the PoB dump.
//
//   node scripts/pob-data/generate.mjs [--dir data/pob-extract] [--dump]
//
// Reads  <dir>/raw-gems.json, raw-skills.json, raw-uniques.json (scripts/pob-data/dump.mjs; --dump runs it first)
// Writes <dir>/skill-gems.generated.json and <dir>/uniques.generated.json.
// Nothing under public/data/ is touched: this is the pilot described in docs/pob-data-pilot.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OUT_DIR, dumpPobData } from "./dump.mjs";
import { buildGemRecords } from "./generate-gems.mjs";
import { buildUniqueRecords } from "./generate-uniques.mjs";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export const generateFromDump = (dir = DEFAULT_OUT_DIR) => {
  const meta = fs.existsSync(path.join(dir, "raw-meta.json")) ? readJson(path.join(dir, "raw-meta.json")) : {};
  const gems = buildGemRecords(readJson(path.join(dir, "raw-gems.json")), readJson(path.join(dir, "raw-skills.json")));
  const uniques = buildUniqueRecords(readJson(path.join(dir, "raw-uniques.json")));
  const header = { source: "Path of Building PoE2", pob_commit: meta.pob_commit || null };
  fs.writeFileSync(path.join(dir, "skill-gems.generated.json"), JSON.stringify({ ...header, total: gems.length, gems }, null, 1));
  fs.writeFileSync(path.join(dir, "uniques.generated.json"), JSON.stringify({ ...header, total: uniques.length, items: uniques }, null, 1));
  return { gems, uniques };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const dir = args.includes("--dir") ? path.resolve(args[args.indexOf("--dir") + 1]) : DEFAULT_OUT_DIR;
  const started = Date.now();
  if (args.includes("--dump")) {
    const meta = dumpPobData({ outDir: dir });
    console.log(`PoB ${meta.pob_commit} dumped in ${meta.dump_ms} ms`);
  }
  const generateStarted = Date.now();
  const { gems, uniques } = generateFromDump(dir);
  console.log(`${gems.length} gems, ${uniques.length} uniques generated in ${Date.now() - generateStarted} ms (total ${Date.now() - started} ms)`);
}

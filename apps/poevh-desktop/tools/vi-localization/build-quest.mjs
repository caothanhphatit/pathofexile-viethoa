// Build Vietnamese quest tables from the game's own datc64 files.
//
//   node build-quest.mjs --game="D:\Grinding Gear Games\Path of Exile 2" [--apply]
//
// Steps: extract data/balance/quest.datc64 + queststates.datc64 from Content.ggpk
// via the GGPK helper, rewrite the string cells listed in translations/*.vi.json,
// verify every other cell is byte-identical, and (with --apply) write the result
// back with a backup in <game>/POEVH_Backups so the helper's --restore can undo it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema, tableSchema, parse, rewriteStrings } from "./datc64.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Map(process.argv.slice(2).map((a) => { const [k, ...r] = a.split("="); return [k.replace(/^--/, ""), r.join("=") || "true"]; }));
const gameDir = args.get("game");
if (!gameDir) throw new Error("--game=<PoE2 install dir> is required");
const ggpk = path.join(gameDir, "Content.ggpk");
const backupDir = path.join(gameDir, "POEVH_Backups");
const helper = path.join(here, "..", "poevh-ggpk-patcher", "publish", "PoevhGgpkPatcher.exe");
const schema = loadSchema(path.join(here, "schema", "schema.min.json"));
const vi = JSON.parse(fs.readFileSync(path.join(here, "translations", "quest-act1.vi.json"), "utf8"));

const work = fs.mkdtempSync(path.join(os.tmpdir(), "poevh-quest-"));
const run = (...a) => JSON.parse(execFileSync(helper, a, { encoding: "utf8" }));
const extracted = run("--extract", ggpk, "data/balance/quest.datc64,data/balance/queststates.datc64", work);
if (!extracted.ok) throw new Error(extracted.message);

const jobs = [
  { bundle: "data/balance/quest.datc64", table: "Quest", edits: Object.entries(vi.quests).map(([row, value]) => ({ row: +row, column: "Name", value })) },
  { bundle: "data/balance/queststates.datc64", table: "QuestStates", edits: Object.entries(vi.states).flatMap(([row, v]) => [
      { row: +row, column: "Text", value: v.text }, { row: +row, column: "Message", value: v.message }, { row: +row, column: "MapPinsText", value: v.pins } ]) },
];
const tokens = (s) => (String(s).match(/\{\d+\}|\[[A-Za-z]+\|/g) || []).sort().join(",");
const mapping = [];
for (const job of jobs) {
  const t = tableSchema(schema, job.table);
  const file = path.join(work, job.bundle.replace(/\//g, "_"));
  const original = fs.readFileSync(file);
  const before = parse(original, t);
  for (const e of job.edits) {
    const src = before.rows[e.row]?.[e.column];
    if (src === undefined) throw new Error(`${job.table} row ${e.row} missing; game data changed, re-map translations`);
    if (tokens(src) !== tokens(e.value)) throw new Error(`token mismatch ${job.table} ${e.row}/${e.column}`);
  }
  // Re-running on an already translated game must not append the same strings again.
  job.edits = job.edits.filter((e) => before.rows[e.row][e.column] !== e.value);
  const patched = rewriteStrings(original, t, job.edits);
  const after = parse(patched, t);
  const edited = new Map(job.edits.map((e) => [`${e.row}:${e.column}`, e.value]));
  for (let r = 0; r < before.rowCount; r++) for (const c of before.layout) {
    const key = `${r}:${c.name}`;
    const want = edited.has(key) ? edited.get(key) : before.rows[r][c.name];
    if (JSON.stringify(want) !== JSON.stringify(after.rows[r][c.name])) throw new Error(`verify failed ${job.table} ${key}`);
  }
  const out = file + ".vi";
  fs.writeFileSync(out, patched);
  mapping.push(`${job.bundle}=${out}`);
  console.log(`${job.table}: ${job.edits.length} cells rewritten, ${before.rowCount} rows verified`);
}
if (args.get("apply") === "true") {
  const result = run("--replace", ggpk, mapping.join(","), backupDir);
  console.log(result.message, result.changedAssets);
  if (!result.ok) process.exitCode = 1;
} else {
  console.log("dry run only; add --apply to write into Content.ggpk. Patched files:", work);
}

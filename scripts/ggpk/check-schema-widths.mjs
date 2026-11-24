// Version-tolerance check: how well does the community schema fit the installed game?
//
//   node scripts/ggpk/check-schema-widths.mjs [--game=<dir>] [--helper=<exe>] [--out=<json>] [--tables=A,B]
//
// A .datc64 file is "row count, fixed-width rows, 0xBB marker, variable data". The column
// layout is NOT in the file: it comes from schema.min.json. The only thing the file itself
// tells us is the row width, so this compares it with the schema's width for every PoE2
// table: equal / wider (the game has columns the schema does not know) / narrower (the
// schema has columns the game dropped, or a wrong type) / missing / empty.
// Read-only: the helper is only called with --extract.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_HELPER, columnLayout, loadSchema, resolveGameDir, tablePath } from "./reader.mjs";

const MARKER = Buffer.alloc(8, 0xbb);

/** Row count and row width as stored in a .datc64 buffer. */
export const measureTable = (buffer) => {
  const rowCount = buffer.readUInt32LE(0);
  const dataStart = buffer.indexOf(MARKER, 4);
  if (dataStart < 0) return { rowCount, rowWidth: NaN, markerMissing: true };
  return { rowCount, rowWidth: rowCount ? (dataStart - 4) / rowCount : 0 };
};

/** "equal" | "wider" | "narrower" | "empty" | "unreadable" for one table. */
export const classifyWidth = ({ rowCount, rowWidth, markerMissing }, expectedWidth) => {
  if (markerMissing || (rowCount && !Number.isInteger(rowWidth))) return "unreadable";
  if (!rowCount) return "empty";
  if (rowWidth === expectedWidth) return "equal";
  return rowWidth > expectedWidth ? "wider" : "narrower";
};

const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export const run = (args) => {
  const helper = args.get("helper") || DEFAULT_HELPER;
  const ggpk = path.join(resolveGameDir(args.get("game")), "Content.ggpk");
  const schema = loadSchema();
  const only = (args.get("tables") || "").split(",").filter(Boolean).map((name) => name.toLowerCase());
  const seen = new Set();
  const tables = schema.tables.filter((table) => {
    const key = table.name.toLowerCase();
    if (!(table.validFor & 2) || seen.has(key) || (only.length && !only.includes(key))) return false;
    seen.add(key); // same pick as reader.tableSchema: the first PoE2 entry of a name
    return true;
  });
  const result = { schema_version: schema.version, schema_created_at: new Date(schema.createdAt * 1000).toISOString(), tables_in_schema: tables.length, equal: 0, empty: 0, missing: [], wider: [], narrower: [], unreadable: [], unknown_type: [] };
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "poevh-ggpk-widths-"));
  const started = Date.now();
  try {
    for (let i = 0; i < tables.length; i += 200) {
      const batch = tables.slice(i, i + 200);
      const paths = batch.map((table) => tablePath(table.name));
      let response;
      try {
        response = JSON.parse(execFileSync(helper, ["--extract", ggpk, paths.join(","), workDir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
      } catch (error) {
        if (!error.stdout) throw error;
        response = JSON.parse(error.stdout); // non-zero exit when some tables are not in the game
      }
      const gone = new Set((response.alreadyPatchedAssets || []).map((p) => p.toLowerCase()));
      batch.forEach((table, index) => {
        if (gone.has(paths[index])) { result.missing.push(table.name); return; }
        const file = path.join(workDir, paths[index].replace(/\//g, "_"));
        const measured = measureTable(fs.readFileSync(file));
        fs.rmSync(file);
        let expected;
        try {
          expected = columnLayout(table).reduce((sum, column) => sum + column.width, 0);
        } catch (error) {
          result.unknown_type.push(`${table.name}: ${error.message}`);
          return;
        }
        const verdict = classifyWidth(measured, expected);
        const entry = { table: table.name, rows: measured.rowCount, game_width: measured.rowWidth, schema_width: expected, delta: measured.rowWidth - expected };
        if (verdict === "equal") result.equal += 1;
        else if (verdict === "empty") result.empty += 1;
        else result[verdict].push(entry);
      });
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  result.wider.sort((a, b) => b.delta - a.delta);
  result.narrower.sort((a, b) => a.delta - b.delta);
  result.elapsed_ms = Date.now() - started;

  console.log(`Schema v${result.schema_version} (${result.schema_created_at}) vs ${ggpk}`);
  console.log(`  ${result.tables_in_schema} PoE2 tables: ${result.equal} same width, ${result.wider.length} wider in the game, ${result.narrower.length} narrower in the game, ${result.empty} empty (cannot be checked), ${result.missing.length} not in the game, ${result.unreadable.length} unreadable, ${result.unknown_type.length} with a column type the reader does not know (${(result.elapsed_ms / 1000).toFixed(1)}s)`);
  const show = (label, list) => { if (list.length) console.log(`  ${label}: ${list.map((e) => `${e.table} ${e.delta > 0 ? "+" : ""}${e.delta}`).join(", ")}`); };
  show("wider (reader.mjs reads them and ignores the tail)", result.wider);
  show("narrower (reader.mjs throws)", result.narrower);
  if (result.unreadable.length) console.log(`  unreadable: ${result.unreadable.map((e) => e.table).join(", ")}`);
  if (args.get("out")) {
    fs.mkdirSync(path.dirname(path.resolve(args.get("out"))), { recursive: true });
    fs.writeFileSync(path.resolve(args.get("out")), JSON.stringify(result, null, 2));
    console.log(`\nWrote ${path.resolve(args.get("out"))}`);
  }
  return result;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    run(parseCliArgs());
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

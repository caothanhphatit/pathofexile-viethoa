// Shared reader for the installed game's Content.ggpk data tables.
//
//   import { openGame } from "./reader.mjs";
//   const game = await openGame({ tables: ["BaseItemTypes", "ItemClasses"] });
//   const bases = game.table("BaseItemTypes");      // rows with arrays resolved
//   bases.rows[0].ItemClass                          // foreign row index (or null)
//   game.ref("ItemClasses", bases.rows[0].ItemClass) // the referenced row
//   game.close();
//
// Files are pulled out of the GGPK with the .NET helper
// (apps/poevh-desktop/tools/poevh-ggpk-patcher, LibBundledGGPK3 + Oodle) and decoded
// with the poe-tool-dev dat-schema (validFor & 2 = PoE2). Every table is read from
// data/balance/<name>.datc64 (English); pass `lang` for data/balance/<lang>/.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const SCHEMA_PATH = path.join(ROOT_DIR, "apps", "poevh-desktop", "tools", "vi-localization", "schema", "schema.min.json");
export const DEFAULT_HELPER = path.join(ROOT_DIR, "apps", "poevh-desktop", "tools", "poevh-ggpk-patcher", "publish", "PoevhGgpkPatcher.exe");
export const DEFAULT_GAME_DIRS = [
  process.env.POE2_GAME_PATH,
  "D:\\Grinding Gear Games\\Path of Exile 2",
  "C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2"
].filter(Boolean);

const MARKER = Buffer.alloc(8, 0xbb);
const NULL_ROW = 0xfefefefefefefefen;
const SCALAR_SIZE = { bool: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, i64: 8, u64: 8, string: 8, row: 8, foreignrow: 16, enumrow: 4 };
const ARRAY_SIZE = 16;

export const resolveGameDir = (explicit) => {
  const candidates = explicit ? [explicit] : DEFAULT_GAME_DIRS;
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, "Content.ggpk"))) return dir;
  }
  throw new Error(`Content.ggpk not found. Pass the install dir or set POE2_GAME_PATH (tried: ${candidates.join(" | ")})`);
};

export const tablePath = (name, lang = "") => `data/balance/${lang ? `${lang}/` : ""}${String(name).toLowerCase()}.datc64`;

let cachedSchema = null;
export const loadSchema = () => {
  cachedSchema ||= JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  return cachedSchema;
};

/** Schema for a PoE2 table (validFor bit 2). */
export const tableSchema = (name, schema = loadSchema()) => {
  const table = schema.tables.find((t) => t.name.toLowerCase() === String(name).toLowerCase() && (t.validFor & 2));
  if (!table) throw new Error(`No PoE2 schema for table ${name}`);
  return table;
};

export const columnLayout = (table) => {
  let offset = 0;
  return table.columns.map((column, index) => {
    const width = column.array ? ARRAY_SIZE : SCALAR_SIZE[column.type];
    if (!width) throw new Error(`${table.name}: unknown column type ${column.type}`);
    const layout = {
      index,
      name: column.name || `_${index}`,
      type: column.type,
      array: Boolean(column.array),
      references: column.references?.table || "",
      offset,
      width
    };
    offset += width;
    return layout;
  });
};

const readString = (buf, dataStart, rel) => {
  const start = dataStart + Number(rel);
  if (start < dataStart || start >= buf.length) return "";
  let end = start;
  while (end + 3 < buf.length && !(buf[end] === 0 && buf[end + 1] === 0 && buf[end + 2] === 0 && buf[end + 3] === 0)) end += 2;
  return buf.subarray(start, end).toString("utf16le");
};

const readScalar = (buf, at, type, dataStart) => {
  switch (type) {
    case "bool": return buf[at] === 1;
    case "i16": return buf.readInt16LE(at);
    case "u16": return buf.readUInt16LE(at);
    case "i32": return buf.readInt32LE(at);
    case "u32": case "enumrow": return buf.readUInt32LE(at);
    case "f32": return buf.readFloatLE(at);
    case "i64": return Number(buf.readBigInt64LE(at));
    case "u64": return Number(buf.readBigUInt64LE(at));
    case "string": return readString(buf, dataStart, buf.readBigUInt64LE(at));
    case "row":
    case "foreignrow": {
      const value = buf.readBigUInt64LE(at);
      return value === NULL_ROW ? null : Number(value);
    }
    default: throw new Error(`unknown type ${type}`);
  }
};

/** Decode a .datc64 buffer into rows. Arrays are expanded; foreign keys stay row indexes. */
export const parseTable = (buf, table) => {
  const rowCount = buf.readUInt32LE(0);
  const dataStart = buf.indexOf(MARKER, 4);
  if (dataStart < 0) throw new Error(`${table.name}: data marker missing`);
  const rowWidth = rowCount ? (dataStart - 4) / rowCount : 0;
  const layout = columnLayout(table);
  const expected = layout.reduce((sum, column) => sum + column.width, 0);
  // A game patch often appends columns before the community schema catches up. Known
  // columns keep their offsets, so read them and ignore the unknown tail; callers can see
  // `trailingBytes` and should sanity-check what they use. A narrower row is a hard error.
  if (rowCount && rowWidth < expected) {
    throw new Error(`${table.name}: row width ${rowWidth} < schema ${expected} (schema does not match this game version)`);
  }
  const trailingBytes = rowCount ? rowWidth - expected : 0;
  const rows = new Array(rowCount);
  for (let r = 0; r < rowCount; r += 1) {
    const base = 4 + r * rowWidth;
    const row = { _index: r };
    for (const column of layout) {
      const at = base + column.offset;
      if (!column.array) {
        row[column.name] = readScalar(buf, at, column.type, dataStart);
        continue;
      }
      const count = Number(buf.readBigUInt64LE(at));
      const start = dataStart + Number(buf.readBigUInt64LE(at + 8));
      const size = SCALAR_SIZE[column.type];
      const values = [];
      if (count > 0 && count < 1_000_000 && size && start + count * size <= buf.length) {
        for (let i = 0; i < count; i += 1) values.push(readScalar(buf, start + i * size, column.type, dataStart));
      }
      row[column.name] = values;
    }
    rows[r] = row;
  }
  return { name: table.name, rowCount, rowWidth, trailingBytes, layout, rows };
};

/** Extract tables from the GGPK and return a handle to read them. */
export const openGame = async ({ gameDir, helper = DEFAULT_HELPER, tables = [], lang = "" } = {}) => {
  const dir = resolveGameDir(gameDir);
  const ggpk = path.join(dir, "Content.ggpk");
  if (!fs.existsSync(helper)) {
    throw new Error(`GGPK helper missing at ${helper}. Build it with: "%LOCALAPPDATA%\\Microsoft\\dotnet\\dotnet.exe" publish -c Release -o publish (in apps/poevh-desktop/tools/poevh-ggpk-patcher)`);
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "poevh-ggpk-"));
  const names = [...new Set(tables)];
  const paths = names.map((name) => tablePath(name, lang));
  const result = JSON.parse(execFileSync(helper, ["--extract", ggpk, paths.join(","), workDir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  if (!result.ok) throw new Error(result.error || result.message || "GGPK extract failed");

  const buffers = new Map(names.map((name, i) => [name.toLowerCase(), fs.readFileSync(path.join(workDir, paths[i].replace(/\//g, "_")))]));
  const parsed = new Map();
  const hash = crypto.createHash("sha256");
  for (const name of names) hash.update(buffers.get(name.toLowerCase()));

  const table = (name) => {
    const key = String(name).toLowerCase();
    if (!buffers.has(key)) throw new Error(`Table ${name} was not extracted; add it to openGame({ tables })`);
    if (!parsed.has(key)) parsed.set(key, parseTable(buffers.get(key), tableSchema(name)));
    return parsed.get(key);
  };

  return {
    gameDir: dir,
    ggpk,
    ggpkStat: fs.statSync(ggpk),
    fingerprint: hash.digest("hex").slice(0, 16),
    table,
    /** Row of `name` at `index`, or null. */
    ref: (name, index) => (index === null || index === undefined ? null : table(name).rows[index] ?? null),
    close: () => fs.rmSync(workDir, { recursive: true, force: true })
  };
};

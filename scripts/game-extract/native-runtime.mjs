import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { stableJson } from "./runtime.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_POB_PATH = path.join(ROOT_DIR, "scratch", "PathOfBuilding-PoE2");
export const DEFAULT_NATIVE_OUTPUT_DIR = path.join(ROOT_DIR, "data", "game-extract", "native");
export const RUST_CRATE_DIR = path.join(ROOT_DIR, "tools", "game-extractor-rs");

const marker = Buffer.alloc(8, 0xbb);

export const hashJson = (value) => crypto.createHash("sha256").update(stableJson(value)).digest("hex");

export const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const resolveRepoPath = (value) => path.resolve(ROOT_DIR, value || "");

const exists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const valueSize = (type) => ({
  Bool: 1,
  Int: 4,
  UInt16: 2,
  UInt: 4,
  Interval: 8,
  Float: 4,
  String: 8,
  Enum: 4,
  ShortKey: 8,
  Key: 16
})[type] || 4;

const columnWidth = (column) => column.list ? 16 : valueSize(column.type);

const normalizedSpec = (spec) => spec.map((column, index) => ({
  name: column.name || `Column${index + 1}`,
  type: column.type || "Int",
  list: Boolean(column.list),
  ref_to: column.ref_to || column.refTo || "",
  ordinal: column.ordinal || index + 1
}));

const writeUInt64LE = (buffer, value, offset) => {
  buffer.writeBigUInt64LE(BigInt(value), offset);
};

const readUInt64LE = (buffer, offset) => Number(buffer.readBigUInt64LE(offset));

const encodeUtf16String = (value) => Buffer.concat([
  Buffer.from(String(value), "utf16le"),
  Buffer.from([0, 0])
]);

const decodeUtf16String = (buffer, offset) => {
  let end = offset;
  while (end + 1 < buffer.length) {
    if (buffer[end] === 0 && buffer[end + 1] === 0) break;
    end += 2;
  }
  return buffer.slice(offset, end).toString("utf16le");
};

const pushData = (dataParts, bytes, markerIndex) => {
  const offset = marker.length + dataParts.reduce((sum, part) => sum + part.length, 0);
  dataParts.push(bytes);
  return offset;
};

const writeScalar = (rowBuffer, offset, column, value, dataParts, markerIndex) => {
  switch (column.type) {
    case "Bool":
      rowBuffer.writeUInt8(value ? 1 : 0, offset);
      break;
    case "Int":
      rowBuffer.writeInt32LE(Number(value || 0), offset);
      break;
    case "UInt16":
      rowBuffer.writeUInt16LE(Number(value || 0), offset);
      break;
    case "UInt":
    case "Enum":
      rowBuffer.writeUInt32LE(Number(value || 0), offset);
      break;
    case "Float":
      rowBuffer.writeFloatLE(Number(value || 0), offset);
      break;
    case "String": {
      const dataOffset = pushData(dataParts, encodeUtf16String(value || ""), markerIndex);
      writeUInt64LE(rowBuffer, dataOffset, offset);
      break;
    }
    case "ShortKey":
      writeUInt64LE(rowBuffer, Number(value || 0), offset);
      break;
    case "Key":
      writeUInt64LE(rowBuffer, Number(value || 0), offset);
      writeUInt64LE(rowBuffer, 0, offset + 8);
      break;
    default:
      rowBuffer.writeInt32LE(Number(value || 0), offset);
  }
};

export const buildNativeDat64FixtureBuffer = (rows, specInput) => {
  const spec = normalizedSpec(specInput);
  const rowSize = spec.reduce((sum, column) => sum + columnWidth(column), 0);
  const rowCount = rows.length;
  const markerIndex = 4 + rowSize * rowCount;
  const dataParts = [];
  const headerAndRows = Buffer.alloc(markerIndex);
  headerAndRows.writeUInt32LE(rowCount, 0);

  rows.forEach((row, rowIndex) => {
    const rowStart = 4 + rowIndex * rowSize;
    let columnOffset = 0;
    for (const column of spec) {
      const cellOffset = rowStart + columnOffset;
      if (column.list) {
        const values = Array.isArray(row[column.name]) ? row[column.name] : [];
        const listEntrySize = valueSize(column.type);
        const listBytes = Buffer.alloc(values.length * listEntrySize);
        values.forEach((value, index) => {
          writeScalar(listBytes, index * listEntrySize, { ...column, list: false }, value, dataParts, markerIndex);
        });
        const listDataOffset = pushData(dataParts, listBytes, markerIndex);
        writeUInt64LE(headerAndRows, values.length, cellOffset);
        writeUInt64LE(headerAndRows, listDataOffset, cellOffset + 8);
      } else {
        writeScalar(headerAndRows, cellOffset, column, row[column.name], dataParts, markerIndex);
      }
      columnOffset += columnWidth(column);
    }
  });

  return Buffer.concat([headerAndRows, marker, ...dataParts]);
};

const readScalar = (buffer, offset, column, markerIndex) => {
  switch (column.type) {
    case "Bool":
      return buffer.readUInt8(offset) === 1;
    case "Int":
      return buffer.readInt32LE(offset);
    case "UInt16":
      return buffer.readUInt16LE(offset);
    case "UInt":
    case "Enum":
      return buffer.readUInt32LE(offset);
    case "Float":
      return buffer.readFloatLE(offset);
    case "String": {
      const stringOffset = readUInt64LE(buffer, offset);
      return decodeUtf16String(buffer, markerIndex + stringOffset);
    }
    case "ShortKey":
      return readUInt64LE(buffer, offset);
    case "Key":
      return {
        lo: readUInt64LE(buffer, offset),
        hi: readUInt64LE(buffer, offset + 8)
      };
    default:
      return buffer.readInt32LE(offset);
  }
};

export const parseDat64Buffer = (bufferInput, specInput) => {
  const buffer = Buffer.from(bufferInput);
  const spec = normalizedSpec(specInput);
  const rowCount = buffer.readUInt32LE(0);
  const markerIndex = buffer.indexOf(marker, 4);
  if (markerIndex < 0) throw new Error("DAT64 marker not found");
  const rowSize = (markerIndex - 4) / rowCount;
  const expectedRowSize = spec.reduce((sum, column) => sum + columnWidth(column), 0);
  if (rowSize !== expectedRowSize) {
    throw new Error(`DAT64 row size mismatch: got ${rowSize}, expected ${expectedRowSize}`);
  }

  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowStart = 4 + rowIndex * rowSize;
    let columnOffset = 0;
    const row = {};
    for (const column of spec) {
      const cellOffset = rowStart + columnOffset;
      if (column.list) {
        const count = readUInt64LE(buffer, cellOffset);
        const listOffset = markerIndex + readUInt64LE(buffer, cellOffset + 8);
        const itemSize = valueSize(column.type);
        row[column.name] = Array.from({ length: count }, (_, index) =>
          readScalar(buffer, listOffset + index * itemSize, { ...column, list: false }, markerIndex));
      } else {
        row[column.name] = readScalar(buffer, cellOffset, column, markerIndex);
      }
      columnOffset += columnWidth(column);
    }
    rows.push(row);
  }
  return {
    row_count: rowCount,
    row_size: rowSize,
    marker_index: markerIndex,
    columns: spec,
    rows,
    rows_hash: hashJson(rows)
  };
};

const braceBlockAt = (text, openIndex) => {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, index + 1);
    }
  }
  return "";
};

const findTopLevelTables = (text) => {
  const tables = [];
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      continue;
    }
    if (depth === 1) {
      const slice = text.slice(index);
      const match = slice.match(/^\s*([A-Za-z0-9_]+)\s*=\s*\{/);
      if (match) {
        const name = match[1];
        const openIndex = index + match[0].lastIndexOf("{");
        const block = braceBlockAt(text, openIndex);
        tables.push({ name, block });
        index = openIndex + block.length - 1;
      }
    }
  }
  return tables;
};

const stringField = (block, field) => {
  const match = block.match(new RegExp(`\\b${field}\\s*=\\s*"((?:\\\\.|[^"])*)"`));
  return match ? match[1].replace(/\\"/g, "\"") : "";
};

const numberField = (block, field) => {
  const match = block.match(new RegExp(`\\b${field}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : 0;
};

const boolField = (block, field) => {
  const match = block.match(new RegExp(`\\b${field}\\s*=\\s*(true|false)`));
  return match ? match[1] === "true" : false;
};

const parseColumnBlocks = (tableBlock) => {
  const columns = [];
  const regex = /\[(\d+)\]\s*=\s*\{/g;
  let match;
  while ((match = regex.exec(tableBlock))) {
    const ordinal = Number(match[1]);
    const openIndex = match.index + match[0].lastIndexOf("{");
    const block = braceBlockAt(tableBlock, openIndex);
    columns.push({
      ordinal,
      name: stringField(block, "name"),
      type: stringField(block, "type"),
      list: boolField(block, "list"),
      ref_to: stringField(block, "refTo"),
      width: numberField(block, "width")
    });
    regex.lastIndex = openIndex + block.length;
  }
  return columns.sort((a, b) => a.ordinal - b.ordinal);
};

export const convertPobSpecLua = async ({
  pobPath = DEFAULT_POB_PATH,
  tableFilter = []
} = {}) => {
  const resolvedPobPath = path.isAbsolute(pobPath) ? pobPath : resolveRepoPath(pobPath);
  const specPath = path.join(resolvedPobPath, "src", "Export", "spec.lua");
  const text = await fs.readFile(specPath, "utf8");
  const wanted = new Set(tableFilter.map((name) => name.toLowerCase()).filter(Boolean));
  const allTables = findTopLevelTables(text)
    .map((table) => ({
      name: table.name.toLowerCase(),
      columns: parseColumnBlocks(table.block)
    }))
    .filter((table) => wanted.size === 0 || wanted.has(table.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const payload = {
    generated_at: new Date().toISOString(),
    source: {
      kind: "pob_spec_lua",
      path: specPath.replace(/\\/g, "/")
    },
    tables: allTables.map((table) => ({
      ...table,
      column_count: table.columns.length,
      row_size_hint: table.columns.reduce((sum, column) => sum + columnWidth(column), 0)
    }))
  };
  return {
    ...payload,
    spec_hash: hashJson(payload.tables)
  };
};

export const writeConvertedSpec = async (converted, {
  outputDir = DEFAULT_NATIVE_OUTPUT_DIR
} = {}) => {
  const resolvedOutput = path.resolve(outputDir);
  await fs.mkdir(resolvedOutput, { recursive: true });
  const specPath = path.join(resolvedOutput, "pob-spec.json");
  await fs.writeFile(specPath, `${JSON.stringify(converted, null, 2)}\n`, "utf8");
  return { outputDir: resolvedOutput, specPath };
};

const findCommandPath = async (command) => {
  try {
    const whereCommand = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(whereCommand, [command]);
    return stdout.split(/\r?\n/).find(Boolean) || command;
  } catch {
    return "";
  }
};

const resolveCargoPath = async () => {
  const fromPath = await findCommandPath("cargo");
  if (fromPath) return fromPath;

  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home) return "";

  const cargoFile = process.platform === "win32" ? "cargo.exe" : "cargo";
  const candidate = path.join(home, ".cargo", "bin", cargoFile);
  return await exists(candidate) ? candidate : "";
};

const quoteCommand = (command) => /\s/.test(command) ? `"${command}"` : command;

export const phase2NativeSummary = async ({
  pobPath = DEFAULT_POB_PATH,
  tableFilter = ["baseitemtypes", "skillgems", "mods"],
  outputDir = DEFAULT_NATIVE_OUTPUT_DIR
} = {}) => {
  const fixtureSpec = [
    { name: "Id", type: "String", list: false },
    { name: "Level", type: "Int", list: false },
    { name: "Enabled", type: "Bool", list: false },
    { name: "Tags", type: "String", list: true }
  ];
  const fixtureBuffer = buildNativeDat64FixtureBuffer([
    { Id: "SkillOne", Level: 12, Enabled: true, Tags: ["fire", "spell"] },
    { Id: "SkillTwo", Level: 20, Enabled: false, Tags: ["cold"] }
  ], fixtureSpec);
  const parsed = parseDat64Buffer(fixtureBuffer, fixtureSpec);
  const spec = await convertPobSpecLua({ pobPath, tableFilter });
  const output = await writeConvertedSpec(spec, { outputDir });
  const cargoPath = await resolveCargoPath();
  return {
    generated_at: new Date().toISOString(),
    native_fixture: {
      rows: parsed.row_count,
      row_size: parsed.row_size,
      hash: parsed.rows_hash,
      first_row: parsed.rows[0]
    },
    spec: {
      source: spec.source.path,
      tables: spec.tables.length,
      columns: spec.tables.reduce((sum, table) => sum + table.columns.length, 0),
      spec_hash: spec.spec_hash,
      selected_tables: spec.tables.map((table) => ({
        name: table.name,
        columns: table.column_count,
        row_size_hint: table.row_size_hint
      }))
    },
    rust_crate: {
      path: RUST_CRATE_DIR,
      manifest_exists: await exists(path.join(RUST_CRATE_DIR, "Cargo.toml")),
      lib_exists: await exists(path.join(RUST_CRATE_DIR, "src", "lib.rs")),
      main_exists: await exists(path.join(RUST_CRATE_DIR, "src", "main.rs"))
    },
    toolchain: {
      cargo_available: Boolean(cargoPath),
      cargo_path: cargoPath,
      cargo_test_command: `cd ${RUST_CRATE_DIR} && ${cargoPath ? quoteCommand(cargoPath) : "cargo"} test`
    },
    output: {
      spec: output.specPath
    }
  };
};

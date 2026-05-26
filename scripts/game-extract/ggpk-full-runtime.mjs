import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_GAME_PATH,
  DEFAULT_POB_PATH,
  hashJson,
  hashText
} from "./runtime.mjs";
import {
  convertPobSpecLua,
  parseDat64Buffer
} from "./native-runtime.mjs";
import {
  DEFAULT_OOZ_TOOLS_DIR,
  resolveGgpkSource,
  validateOozToolDir
} from "./ggpk-sweep-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_FULL_DATC64_OUTPUT_DIR = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "full-datc64");
export const DEFAULT_GGPK_FILE_LIST = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "pob-sweep", "ggpk-file-list.log");

const nowIso = () => new Date().toISOString();
const normalizeSlash = (value = "") => String(value).replace(/\\/g, "/");
const resolveRepoPath = (value) => path.isAbsolute(value || "") ? value : path.resolve(ROOT_DIR, value || "");
const sortText = (values) => [...values].sort((a, b) => a.localeCompare(b));
const marker = Buffer.alloc(8, 0xbb);

const LANG_PREFIXES = new Set([
  "french",
  "german",
  "japanese",
  "korean",
  "portuguese",
  "russian",
  "spanish",
  "thai",
  "traditional chinese",
  "simplified chinese"
]);

const ASSET_BUCKETS = {
  dat_tables: (file, ext) => ext === "datc64" || ext === "dat64",
  images: (file, ext) => ["dds", "png", "jpg", "jpeg", "webp", "tga"].includes(ext) && !file.endsWith(".header"),
  image_headers: (file) => file.endsWith(".dds.header") || file.endsWith(".png.header"),
  audio: (file, ext) => ["ogg", "wav", "bank"].includes(ext),
  videos: (file, ext) => ["bk2", "bik", "webm", "mp4", "mkv", "mov", "avi", "wmv", "usm"].includes(ext) || file.includes("/videos/") || file.includes("cinematic") || file.includes("cutscene"),
  stat_descriptions: (file, ext) => ext === "csd" || ext === "csl",
  metadata_templates: (file, ext) => ["it", "itc", "ot", "otc", "aoc", "ao", "pet", "mat", "env", "gt", "fmt", "tgt", "tgm", "sm", "smd"].includes(ext),
  ui_metadata: (file, ext) => ["ui", "json", "txt"].includes(ext) && (file.startsWith("metadata/ui/") || file.startsWith("art/")),
  shader_cache: (file) => file.startsWith("shadercache")
};

const exists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const readFileListInput = async (input) => {
  if (Array.isArray(input)) return input;
  const resolvedPath = resolveRepoPath(input || DEFAULT_GGPK_FILE_LIST);
  const text = await fs.readFile(resolvedPath, "utf8");
  return text.split(/\r?\n/);
};

const extensionOf = (file) => {
  const basename = path.posix.basename(file);
  const match = basename.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "<none>";
};

export const classifyDatc64TableDomain = (tableName = "") => {
  const normalized = normalizeSlash(tableName).toLowerCase();
  const parts = normalized.split("/");
  const table = parts.at(-1) || normalized;
  const isLocalized = parts.length > 1 && LANG_PREFIXES.has(parts[0]);

  if (isLocalized || /clientstrings|translation|textaudio|description|locali[sz]ation|language/.test(table)) return "localization";
  if (/passive|atlas|tree/.test(table)) return "passive_atlas";
  if (/waystone|map|endgame|worldarea|worldsarea|area|boss|league|encounter/.test(table)) return "maps_waystones";
  if (/baseitem|item|weapon|armour|armor|flask|charm|jewel|rune|socket|equipment|inventory/.test(table)) return "items";
  if (/skill|gem|granted|effect|buff|active|support/.test(table)) return "skills";
  if (/mod|stat|tag|spawnweight|affix|monsterrestriction/.test(table)) return "mods_stats";
  if (/monster|minion|npc|character|life.*scaling/.test(table)) return "monsters";
  if (/craft|currency|essence|vendor|recipe|salvage|transmute|alchemy/.test(table)) return "crafting_currency";
  if (/quest|act|mission|dialogue|hideout|town|world/.test(table)) return "quests_world";
  if (/visual|identity|icon|art|audio|effect|environment|renderer|animation|material/.test(table)) return "visuals_assets";
  return "misc";
};

export const buildGgpkFileInventoryFromFileList = async (fileListInput = DEFAULT_GGPK_FILE_LIST) => {
  const lines = await readFileListInput(fileListInput);
  const files = lines
    .map((line) => normalizeSlash(line).trim().toLowerCase())
    .filter(Boolean);
  const extensions = {};
  const roots = {};
  const assetBuckets = Object.fromEntries(Object.keys(ASSET_BUCKETS)
    .map((bucket) => [bucket, { count: 0, sample_paths: [], paths: [] }]));

  for (const file of files) {
    const ext = extensionOf(file);
    const root = file.split("/")[0] || "<root>";
    extensions[ext] = (extensions[ext] || 0) + 1;
    roots[root] = (roots[root] || 0) + 1;

    for (const [bucket, predicate] of Object.entries(ASSET_BUCKETS)) {
      if (!predicate(file, ext)) continue;
      const entry = assetBuckets[bucket];
      entry.count += 1;
      entry.paths.push(file);
      if (entry.sample_paths.length < 20) entry.sample_paths.push(file);
    }
  }

  return {
    generated_at: nowIso(),
    source: {
      kind: "ggpk_file_inventory",
      file_list: Array.isArray(fileListInput) ? "inline" : normalizeSlash(resolveRepoPath(fileListInput || DEFAULT_GGPK_FILE_LIST))
    },
    summary: {
      files: files.length,
      extensions: Object.keys(extensions).length,
      roots: Object.keys(roots).length
    },
    extensions: Object.fromEntries(Object.entries(extensions).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    roots: Object.fromEntries(Object.entries(roots).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    asset_buckets: assetBuckets,
    inventory_hash: hashText(files.join("\n"))
  };
};

export const writeGgpkFileInventory = async (inventory, {
  outputDir = DEFAULT_FULL_DATC64_OUTPUT_DIR
} = {}) => {
  const resolvedOutput = path.resolve(outputDir);
  const bucketsDir = path.join(resolvedOutput, "asset-buckets");
  await fs.mkdir(bucketsDir, { recursive: true });
  const inventoryPath = path.join(resolvedOutput, "ggpk-file-inventory.json");
  const publicBuckets = {};
  const bucketFiles = {};

  for (const [name, bucket] of Object.entries(inventory.asset_buckets || {})) {
    const bucketPath = path.join(bucketsDir, `${name}.txt`);
    publicBuckets[name] = {
      count: bucket.count,
      sample_paths: bucket.sample_paths
    };
    bucketFiles[name] = bucketPath;
    await fs.writeFile(bucketPath, `${(bucket.paths || []).join("\n")}\n`, "utf8");
  }

  const publicInventory = {
    ...inventory,
    asset_buckets: publicBuckets
  };
  await fs.writeFile(inventoryPath, `${JSON.stringify(publicInventory, null, 2)}\n`, "utf8");
  return {
    inventoryPath,
    bucketsDir,
    bucketFiles
  };
};

export const buildFullDatc64ManifestFromFileList = async (fileListInput = DEFAULT_GGPK_FILE_LIST) => {
  const lines = await readFileListInput(fileListInput);
  const datc64 = sortText([...new Set(lines
    .map((line) => normalizeSlash(line).trim().toLowerCase())
    .filter((line) => /^data\/balance\/.+\.datc64$/i.test(line)))]);
  const tableNames = datc64.map((file) => path.posix.basename(file, ".datc64"));
  const manifest = {
    generated_at: nowIso(),
    source: {
      kind: "ggpk_full_datc64",
      file_list: Array.isArray(fileListInput) ? "inline" : normalizeSlash(resolveRepoPath(fileListInput || DEFAULT_GGPK_FILE_LIST))
    },
    datc64: {
      extract_regex: "^data/balance/.*\\.datc64$",
      files: datc64,
      tables: tableNames
    },
    summary: {
      datc64_files: datc64.length,
      unique_tables: tableNames.length
    }
  };
  return {
    ...manifest,
    manifest_hash: hashJson({
      files: manifest.datc64.files,
      tables: manifest.datc64.tables
    })
  };
};

export const writeFullDatc64Manifest = async (manifest, {
  outputDir = DEFAULT_FULL_DATC64_OUTPUT_DIR
} = {}) => {
  const resolvedOutput = path.resolve(outputDir);
  await fs.mkdir(resolvedOutput, { recursive: true });
  const manifestPath = path.join(resolvedOutput, "full-datc64-manifest.json");
  const directListPath = path.join(resolvedOutput, "full-datc64-files.txt");
  const regexListPath = path.join(resolvedOutput, "full-datc64-regex.txt");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(directListPath, `${manifest.datc64.files.join("\n")}\n`, "utf8");
  await fs.writeFile(regexListPath, `${manifest.datc64.extract_regex}\n`, "utf8");
  return {
    outputDir: resolvedOutput,
    manifestPath,
    directListPath,
    regexListPath
  };
};

const runProcess = (command, args, {
  cwd,
  input = "",
  timeoutMs = 0
} = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let timeout = null;
  if (timeoutMs > 0) {
    timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);
  }
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.on("error", reject);
  child.on("close", (code) => {
    if (timeout) clearTimeout(timeout);
    const result = { code, stdout, stderr };
    if (code === 0) resolve(result);
    else {
      const error = new Error(`Command failed (${code}): ${command} ${args.join(" ")}`);
      error.result = result;
      reject(error);
    }
  });
  if (input) child.stdin.write(input);
  child.stdin.end();
});

const listFilesRecursive = async (dir, predicate = () => true) => {
  const files = [];
  const walk = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (predicate(fullPath)) files.push(fullPath);
    }
  };
  if (await exists(dir)) await walk(dir);
  return sortText(files);
};

const outputFileNameForTableKey = (tableKey) =>
  tableKey.replace(/[^a-z0-9]+/g, "__").replace(/^__|__$/g, "") || "table";

const readDatc64RawMetadata = (bufferInput, {
  table,
  specTable,
  sourceFile,
  semanticStatus,
  reason = ""
}) => {
  const buffer = Buffer.from(bufferInput);
  const rowCount = buffer.length >= 4 ? buffer.readUInt32LE(0) : 0;
  const markerIndex = buffer.indexOf(marker, 4);
  const rowBlock = markerIndex >= 4 ? buffer.subarray(4, markerIndex) : Buffer.alloc(0);
  const rowSize = rowCount > 0 && markerIndex >= 4 ? rowBlock.length / rowCount : 0;
  const normalizedRowSize = Number.isFinite(rowSize) ? rowSize : null;
  const sampleBytes = normalizedRowSize && Number.isInteger(normalizedRowSize)
    ? rowBlock.subarray(0, Math.min(normalizedRowSize, 64))
    : rowBlock.subarray(0, 64);

  return {
    generated_at: nowIso(),
    table,
    spec_table: specTable,
    source_file: sourceFile,
    semantic_status: semanticStatus,
    reason,
    byte_size: buffer.length,
    content_hash: hashText(buffer),
    row_count: rowCount,
    row_size: normalizedRowSize,
    row_block_bytes: rowBlock.length,
    row_block_hash: hashText(rowBlock),
    marker_index: markerIndex,
    data_section_bytes: markerIndex >= 0 ? Math.max(0, buffer.length - markerIndex - marker.length) : 0,
    sample_row_hex: sampleBytes.toString("hex")
  };
};

const writeRawIndex = async (rawDir, tableKey, metadata) => {
  const outputPath = path.join(rawDir, `${outputFileNameForTableKey(tableKey)}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return {
    table: metadata.table,
    spec_table: metadata.spec_table,
    file: metadata.source_file,
    path: outputPath,
    semantic_status: metadata.semantic_status,
    reason: metadata.reason,
    rows: metadata.row_count,
    row_size: metadata.row_size,
    hash: metadata.content_hash,
    row_block_hash: metadata.row_block_hash
  };
};

const relationshipEdgesForColumns = (tableKey, columns = []) => columns
  .filter((column) => column.ref_to || column.refTo)
  .map((column) => ({
    from_table: tableKey,
    from_column: column.name,
    to_table: String(column.ref_to || column.refTo).toLowerCase(),
    cardinality: column.list ? "many" : "one",
    value_type: column.type || "Int"
  }));

const categorizeFailure = (message = "") => {
  if (/expected 0\b/i.test(message)) return "empty_or_missing_schema";
  if (/row size mismatch/i.test(message)) return "row_size_mismatch";
  if (/marker not found/i.test(message)) return "missing_marker";
  return "parse_error";
};

const countBy = (items, keyFn) => items.reduce((acc, item) => {
  const key = keyFn(item);
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const buildDomainCoverage = ({ tableOutputs, rawOutputs, missingSpecs, failures }) => {
  const parsedTables = new Set(tableOutputs.map((table) => table.table));
  const missingTables = new Set(missingSpecs.map((table) => table.table));
  const failedTables = new Set(failures.map((table) => table.table));
  const rowsByTable = new Map(tableOutputs.map((table) => [table.table, table.rows]));
  const rawByTable = new Map(rawOutputs.map((table) => [table.table, table]));
  const allTables = sortText([...new Set([
    ...rawOutputs.map((table) => table.table),
    ...tableOutputs.map((table) => table.table),
    ...missingSpecs.map((table) => table.table),
    ...failures.map((table) => table.table)
  ])]);

  const domains = {};
  for (const table of allTables) {
    const domain = classifyDatc64TableDomain(table);
    domains[domain] ||= {
      total_tables: 0,
      parsed_tables: 0,
      raw_indexed_tables: 0,
      missing_spec_tables: 0,
      parse_failed_tables: 0,
      parsed_rows: 0,
      sample_tables: [],
      tables: []
    };
    const entry = domains[domain];
    const status = parsedTables.has(table)
      ? "parsed"
      : missingTables.has(table)
        ? "missing_spec"
        : failedTables.has(table)
          ? "parse_failed"
          : "raw_only";
    const raw = rawByTable.get(table);
    entry.total_tables += 1;
    entry.raw_indexed_tables += raw ? 1 : 0;
    entry.parsed_tables += parsedTables.has(table) ? 1 : 0;
    entry.missing_spec_tables += missingTables.has(table) ? 1 : 0;
    entry.parse_failed_tables += failedTables.has(table) ? 1 : 0;
    entry.parsed_rows += rowsByTable.get(table) || 0;
    if (entry.sample_tables.length < 20) entry.sample_tables.push(table);
    entry.tables.push({
      table,
      status,
      rows: rowsByTable.get(table) || raw?.rows || 0,
      row_size: raw?.row_size ?? null
    });
  }

  return {
    generated_at: nowIso(),
    summary: {
      domains: Object.keys(domains).length,
      total_tables: allTables.length,
      parsed_tables: tableOutputs.length,
      raw_indexed_tables: rawOutputs.length,
      missing_spec_tables: missingSpecs.length,
      parse_failed_tables: failures.length
    },
    domains: Object.fromEntries(Object.entries(domains).sort((a, b) => a[0].localeCompare(b[0])))
  };
};

const writeCatalogReports = async ({
  outputDir,
  tableOutputs,
  rawOutputs,
  missingSpecs,
  failures,
  relationships
}) => {
  const relationshipsPath = path.join(outputDir, "relationships.json");
  const domainCoveragePath = path.join(outputDir, "domain-coverage.json");
  const schemaGapsPath = path.join(outputDir, "schema-gaps.json");
  const domainCoverage = buildDomainCoverage({ tableOutputs, rawOutputs, missingSpecs, failures });
  const failuresByCategory = countBy(failures, (failure) => failure.category || categorizeFailure(failure.message));
  const schemaGaps = {
    generated_at: nowIso(),
    summary: {
      missing_specs: missingSpecs.length,
      parse_failures: failures.length,
      failure_categories: failuresByCategory,
      blocked_tables: missingSpecs.length + failures.length
    },
    missing_specs: missingSpecs,
    parse_failures: failures
  };
  const relationshipPayload = {
    generated_at: nowIso(),
    summary: {
      references: relationships.length,
      source_tables: new Set(relationships.map((edge) => edge.from_table)).size,
      target_tables: new Set(relationships.map((edge) => edge.to_table)).size
    },
    references: sortText(relationships.map((edge) => JSON.stringify(edge))).map((edge) => JSON.parse(edge))
  };

  await fs.writeFile(relationshipsPath, `${JSON.stringify(relationshipPayload, null, 2)}\n`, "utf8");
  await fs.writeFile(domainCoveragePath, `${JSON.stringify(domainCoverage, null, 2)}\n`, "utf8");
  await fs.writeFile(schemaGapsPath, `${JSON.stringify(schemaGaps, null, 2)}\n`, "utf8");

  return {
    relationshipsPath,
    domainCoveragePath,
    schemaGapsPath,
    domainCoverage,
    schemaGaps,
    relationships: relationshipPayload
  };
};

export const extractFullDatc64FromGgpk = async ({
  gamePath = DEFAULT_GAME_PATH,
  ggpkPath = "",
  toolsDir = DEFAULT_OOZ_TOOLS_DIR,
  outputDir = DEFAULT_FULL_DATC64_OUTPUT_DIR,
  timeoutMs = 0
} = {}) => {
  const tools = await validateOozToolDir(toolsDir);
  const sourcePath = resolveGgpkSource({ ggpkPath, gamePath });
  const extractDir = path.join(path.resolve(outputDir), "files");
  if (!tools.ready) throw new Error(`OOZ tools are missing in ${tools.dir}`);
  if (!await exists(sourcePath)) throw new Error(`GGPK source not found: ${sourcePath}`);
  await fs.mkdir(extractDir, { recursive: true });
  const result = await runProcess(tools.bun_extract_file.path, [
    "extract-files",
    "--regex",
    sourcePath,
    extractDir,
    "^data/balance/.*\\.datc64$"
  ], {
    cwd: tools.dir,
    timeoutMs
  });
  const files = await listFilesRecursive(extractDir, (file) => file.toLowerCase().endsWith(".datc64"));
  return {
    source: sourcePath,
    tools,
    extractDir,
    exit_code: result.code,
    files: files.length,
    sample_files: files.slice(0, 20).map((file) => normalizeSlash(path.relative(extractDir, file)))
  };
};

const loadSpecs = async (pobPath, specPath = "") => {
  if (specPath) {
    const resolvedSpecPath = path.isAbsolute(specPath) ? specPath : resolveRepoPath(specPath);
    const payload = JSON.parse(await fs.readFile(resolvedSpecPath, "utf8"));
    return new Map((payload.tables || []).map((table) => [table.name.toLowerCase(), {
      ...table,
      name: table.name.toLowerCase(),
      columns: table.columns || []
    }]));
  }
  const converted = await convertPobSpecLua({ pobPath, tableFilter: [] });
  return new Map(converted.tables.map((table) => [table.name.toLowerCase(), table]));
};

export const parseExtractedDatc64Catalog = async ({
  datDir,
  outputDir = path.join(DEFAULT_FULL_DATC64_OUTPUT_DIR, "catalog"),
  pobPath = DEFAULT_POB_PATH,
  specPath = "",
  specs = null,
  limit = 0
} = {}) => {
  const resolvedDatDir = path.resolve(datDir || path.join(DEFAULT_FULL_DATC64_OUTPUT_DIR, "files", "data", "balance"));
  const resolvedOutput = path.resolve(outputDir);
  const tablesDir = path.join(resolvedOutput, "tables");
  const rawDir = path.join(resolvedOutput, "raw-index");
  await fs.mkdir(tablesDir, { recursive: true });
  await fs.mkdir(rawDir, { recursive: true });

  const specMap = specs || await loadSpecs(pobPath, specPath);
  const files = (await listFilesRecursive(resolvedDatDir, (file) => file.toLowerCase().endsWith(".datc64")))
    .slice(0, limit > 0 ? limit : undefined);
  const tableOutputs = [];
  const rawOutputs = [];
  const failures = [];
  const missingSpecs = [];
  const relationships = [];

  for (const file of files) {
    const relativeFile = normalizeSlash(path.relative(resolvedDatDir, file));
    const tableName = path.basename(file, path.extname(file)).toLowerCase();
    const tableKey = relativeFile.replace(/\.datc64$/i, "").toLowerCase();
    const outputName = outputFileNameForTableKey(tableKey);
    const spec = specMap.get(tableName);
    const buffer = await fs.readFile(file);
    if (!spec) {
      missingSpecs.push({
        table: tableKey,
        spec_table: tableName,
        file: relativeFile
      });
      rawOutputs.push(await writeRawIndex(rawDir, tableKey, readDatc64RawMetadata(buffer, {
        table: tableKey,
        specTable: tableName,
        sourceFile: relativeFile,
        semanticStatus: "missing_spec",
        reason: "No PoB spec.lua entry for this table basename."
      })));
      continue;
    }
    try {
      const parsed = parseDat64Buffer(buffer, spec.columns);
      const payload = {
        generated_at: nowIso(),
        table: tableKey,
        spec_table: tableName,
        source_file: relativeFile,
        columns: spec.columns,
        row_count: parsed.row_count,
        row_size: parsed.row_size,
        rows_hash: parsed.rows_hash,
        rows: parsed.rows
      };
      const outputPath = path.join(tablesDir, `${outputName}.json`);
      await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
      tableOutputs.push({
        table: tableKey,
        spec_table: tableName,
        path: outputPath,
        rows: parsed.row_count,
        row_size: parsed.row_size,
        columns: spec.columns.length,
        hash: parsed.rows_hash
      });
      rawOutputs.push(await writeRawIndex(rawDir, tableKey, readDatc64RawMetadata(buffer, {
        table: tableKey,
        specTable: tableName,
        sourceFile: relativeFile,
        semanticStatus: "parsed"
      })));
      relationships.push(...relationshipEdgesForColumns(tableKey, spec.columns));
    } catch (error) {
      failures.push({
        table: tableKey,
        spec_table: tableName,
        file: relativeFile,
        message: error.message,
        category: categorizeFailure(error.message)
      });
      rawOutputs.push(await writeRawIndex(rawDir, tableKey, readDatc64RawMetadata(buffer, {
        table: tableKey,
        specTable: tableName,
        sourceFile: relativeFile,
        semanticStatus: "raw_only",
        reason: error.message
      })));
    }
  }

  const reports = await writeCatalogReports({
    outputDir: resolvedOutput,
    tableOutputs,
    rawOutputs,
    missingSpecs,
    failures,
    relationships
  });

  const summary = {
    datc64_files: files.length,
    parsed_tables: tableOutputs.length,
    raw_indexed_tables: rawOutputs.length,
    rows: tableOutputs.reduce((sum, table) => sum + table.rows, 0),
    missing_specs: missingSpecs.length,
    failures: failures.length,
    relationships: relationships.length,
    domains: reports.domainCoverage.summary.domains
  };
  const catalogHash = hashJson({
    tables: tableOutputs.map((table) => [table.table, table.hash]),
    raw: rawOutputs.map((table) => [table.table, table.hash, table.row_block_hash]),
    relationships,
    missingSpecs,
    failures
  });
  const manifest = {
    generated_at: nowIso(),
    dat_dir: normalizeSlash(resolvedDatDir),
    summary,
    catalog_hash: catalogHash,
    tables: tableOutputs.map((table) => ({
      table: table.table,
      spec_table: table.spec_table,
      file: normalizeSlash(path.relative(resolvedOutput, table.path)),
      rows: table.rows,
      row_size: table.row_size,
      columns: table.columns,
      hash: table.hash
    })),
    raw_index: rawOutputs.map((table) => ({
      table: table.table,
      spec_table: table.spec_table,
      file: normalizeSlash(path.relative(resolvedOutput, table.path)),
      source_file: table.file,
      semantic_status: table.semantic_status,
      rows: table.rows,
      row_size: table.row_size,
      hash: table.hash,
      row_block_hash: table.row_block_hash
    })),
    missing_specs: missingSpecs,
    failures,
    reports: {
      relationships: normalizeSlash(path.relative(resolvedOutput, reports.relationshipsPath)),
      domain_coverage: normalizeSlash(path.relative(resolvedOutput, reports.domainCoveragePath)),
      schema_gaps: normalizeSlash(path.relative(resolvedOutput, reports.schemaGapsPath))
    }
  };
  const manifestPath = path.join(resolvedOutput, "catalog-manifest.json");
  const failuresPath = path.join(resolvedOutput, "catalog-failures.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(failuresPath, `${JSON.stringify({ missing_specs: missingSpecs, failures }, null, 2)}\n`, "utf8");

  return {
    outputDir: resolvedOutput,
    manifestPath,
    failuresPath,
    relationshipsPath: reports.relationshipsPath,
    domainCoveragePath: reports.domainCoveragePath,
    schemaGapsPath: reports.schemaGapsPath,
    catalog_hash: catalogHash,
    summary,
    tableOutputs,
    rawOutputs,
    missingSpecs,
    failures,
    relationships
  };
};

export const runFullDatc64Pipeline = async ({
  fileList = DEFAULT_GGPK_FILE_LIST,
  gamePath = DEFAULT_GAME_PATH,
  ggpkPath = "",
  toolsDir = DEFAULT_OOZ_TOOLS_DIR,
  outputDir = DEFAULT_FULL_DATC64_OUTPUT_DIR,
  pobPath = DEFAULT_POB_PATH,
  specPath = "",
  dryRun = false,
  extract = false,
  parse = false,
  parseLimit = 0,
  timeoutMs = 0
} = {}) => {
  const manifest = await buildFullDatc64ManifestFromFileList(fileList);
  const output = await writeFullDatc64Manifest(manifest, { outputDir });
  const inventory = await buildGgpkFileInventoryFromFileList(fileList);
  const inventoryOutput = await writeGgpkFileInventory(inventory, { outputDir });
  const summary = {
    mode: dryRun ? "dry-run" : "run",
    manifest: {
      hash: manifest.manifest_hash,
      datc64_files: manifest.summary.datc64_files,
      unique_tables: manifest.summary.unique_tables
    },
    output: {
      dir: output.outputDir,
      manifest: output.manifestPath,
      direct_list: output.directListPath,
      regex_list: output.regexListPath,
      extract_dir: path.join(output.outputDir, "files"),
      catalog: path.join(output.outputDir, "catalog", "catalog-manifest.json"),
      inventory: inventoryOutput.inventoryPath,
      asset_buckets: inventoryOutput.bucketsDir
    },
    inventory: {
      hash: inventory.inventory_hash,
      files: inventory.summary.files,
      extensions: inventory.summary.extensions,
      buckets: Object.fromEntries(Object.entries(inventory.asset_buckets).map(([name, bucket]) => [name, bucket.count]))
    },
    extract: null,
    parse: null
  };
  if (dryRun) return summary;
  if (extract) {
    summary.extract = await extractFullDatc64FromGgpk({
      gamePath,
      ggpkPath,
      toolsDir,
      outputDir,
      timeoutMs
    });
  }
  if (parse) {
    const catalog = await parseExtractedDatc64Catalog({
      datDir: path.join(output.outputDir, "files", "data", "balance"),
      outputDir: path.join(output.outputDir, "catalog"),
      pobPath,
      specPath,
      limit: parseLimit
    });
    summary.parse = {
      hash: catalog.catalog_hash,
      datc64_files: catalog.summary.datc64_files,
      parsed_tables: catalog.summary.parsed_tables,
      rows: catalog.summary.rows,
      missing_specs: catalog.summary.missing_specs,
      failure_count: catalog.summary.failures,
      raw_indexed_tables: catalog.summary.raw_indexed_tables,
      relationships: catalog.summary.relationships,
      domains: catalog.summary.domains,
      manifest: catalog.manifestPath,
      failures: catalog.failuresPath,
      relationships_report: catalog.relationshipsPath,
      domain_coverage: catalog.domainCoveragePath,
      schema_gaps: catalog.schemaGapsPath
    };
  }
  return summary;
};

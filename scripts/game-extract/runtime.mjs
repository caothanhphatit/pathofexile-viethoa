import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closePool, createPool, withTransaction } from "../../src/db/pool.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_GAME_PATH = "C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2";
export const DEFAULT_POB_PATH = path.join(ROOT_DIR, "scratch", "PathOfBuilding-PoE2");
export const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, "data", "game-extract", "snapshots");

const nowIso = () => new Date().toISOString();
const asJsonParam = (value) => JSON.stringify(value ?? null);

export const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export const hashText = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const hashJson = (value) => hashText(stableJson(value));

const normalizeSlash = (value = "") => String(value).replace(/\\/g, "/");
const repoPath = (maybePath = "") => path.resolve(ROOT_DIR, maybePath);

const pathExists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const safeReadText = async (target) => fs.readFile(target, "utf8");
const readJsonFile = async (target) => JSON.parse(await safeReadText(target));

const ensureArray = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values.filter((value) => value != null && value !== ""))];

const sortByStableKey = (items, keyFn) => [...items].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));

const inferColumns = (rows = []) => unique(rows.flatMap((row) => Object.keys(row || {}))).sort();

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

const parseLuaEntries = (text, entryRegex) => {
  const rows = [];
  let match;
  const regex = new RegExp(entryRegex.source, "g");
  while ((match = regex.exec(text))) {
    const key = match[1];
    const openIndex = text.indexOf("{", regex.lastIndex - 1);
    if (openIndex === -1) continue;
    const block = braceBlockAt(text, openIndex);
    if (!block) continue;
    rows.push({ key, block });
    regex.lastIndex = openIndex + block.length;
  }
  return rows;
};

const unescapeLuaString = (value = "") => value.replace(/\\"/g, "\"").replace(/\\n/g, "\n");
const stringField = (block, field) => {
  const match = block.match(new RegExp(`\\b${field}\\s*=\\s*"((?:\\\\.|[^"])*)"`));
  return match ? unescapeLuaString(match[1]) : "";
};
const numberField = (block, field) => {
  const match = block.match(new RegExp(`\\b${field}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : undefined;
};
const tableBlockField = (block, field) => {
  const match = block.match(new RegExp(`\\b${field}\\s*=\\s*\\{`));
  if (!match) return "";
  const openIndex = match.index + match[0].lastIndexOf("{");
  return braceBlockAt(block, openIndex);
};
const booleanTableKeys = (block, field) => {
  const table = tableBlockField(block, field);
  if (!table) return [];
  return unique([...table.matchAll(/([A-Za-z0-9_]+)\s*=\s*true/g)].map((match) => match[1]));
};
const quotedTableValues = (block, field) => {
  const table = tableBlockField(block, field);
  if (!table) return [];
  return unique([...table.matchAll(/"((?:\\.|[^"])*)"/g)].map((match) => unescapeLuaString(match[1])));
};
const numericObject = (block, field) => {
  const table = tableBlockField(block, field);
  if (!table) return {};
  return Object.fromEntries([...table.matchAll(/([A-Za-z0-9_]+)\s*=\s*(-?\d+(?:\.\d+)?)/g)]
    .map((match) => [match[1], Number(match[2])]));
};

const parsePobGems = async (dataDir) => {
  const sourcePath = path.join(dataDir, "Gems.lua");
  const text = await safeReadText(sourcePath);
  const rows = parseLuaEntries(text, /\["((?:\\.|[^"])*)"\]\s*=\s*\{/).map(({ key, block }) => ({
    id: key,
    name: stringField(block, "name"),
    baseTypeName: stringField(block, "baseTypeName"),
    gameId: stringField(block, "gameId") || key,
    variantId: stringField(block, "variantId"),
    grantedEffectId: stringField(block, "grantedEffectId"),
    additionalStatSet1: stringField(block, "additionalStatSet1"),
    additionalStatSet2: stringField(block, "additionalStatSet2"),
    gemType: stringField(block, "gemType"),
    tagString: stringField(block, "tagString"),
    weaponRequirements: stringField(block, "weaponRequirements"),
    tags: booleanTableKeys(block, "tags"),
    reqStr: numberField(block, "reqStr") ?? 0,
    reqDex: numberField(block, "reqDex") ?? 0,
    reqInt: numberField(block, "reqInt") ?? 0,
    tier: numberField(block, "Tier") ?? 0,
    naturalMaxLevel: numberField(block, "naturalMaxLevel") ?? 0
  }));
  return {
    name: "pob_generated_gems",
    source_path: normalizeSlash(path.relative(dataDir, sourcePath)),
    columns: inferColumns(rows),
    rows
  };
};

const parsePobBases = async (dataDir) => {
  const basesDir = path.join(dataDir, "Bases");
  const files = (await fs.readdir(basesDir)).filter((file) => file.endsWith(".lua")).sort();
  const rows = [];
  for (const file of files) {
    const sourcePath = path.join(basesDir, file);
    const text = await safeReadText(sourcePath);
    for (const { key, block } of parseLuaEntries(text, /itemBases\["((?:\\.|[^"])*)"\]\s*=\s*\{/)) {
      const type = stringField(block, "type") || file.replace(/\.lua$/, "");
      rows.push({
        id: `item_base:${key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
        name: key,
        baseTypeName: key,
        type,
        sourceFile: file,
        tags: booleanTableKeys(block, "tags"),
        requirements: numericObject(block, "req"),
        properties: {
          quality: numberField(block, "quality") ?? 0,
          socketLimit: numberField(block, "socketLimit") ?? 0
        },
        weapon: numericObject(block, "weapon"),
        armour: numericObject(block, "armour"),
        implicit: stringField(block, "implicit")
      });
    }
  }
  return {
    name: "pob_generated_bases",
    source_path: "Data/Bases/*.lua",
    columns: inferColumns(rows),
    rows
  };
};

const parsePobMods = async (dataDir) => {
  const modFiles = [
    "ModItem.lua",
    "ModItemExclusive.lua",
    "ModFlask.lua",
    "ModMap.lua",
    "ModCharm.lua",
    "ModRunes.lua",
    "ModCorrupted.lua",
    "ModJewel.lua"
  ];
  const rows = [];
  for (const file of modFiles) {
    const sourcePath = path.join(dataDir, file);
    if (!await pathExists(sourcePath)) continue;
    const text = await safeReadText(sourcePath);
    for (const { key, block } of parseLuaEntries(text, /\["((?:\\.|[^"])*)"\]\s*=\s*\{/)) {
      const statLine = block.match(/affix\s*=\s*"((?:\\.|[^"])*)"\s*,\s*"((?:\\.|[^"])*)"/)?.[2] ||
        block.match(/\{\s*type\s*=\s*"[^"]+"\s*,\s*"((?:\\.|[^"])*)"/)?.[1] ||
        "";
      rows.push({
        id: key,
        sourceFile: file,
        type: stringField(block, "type"),
        affix: stringField(block, "affix"),
        text: unescapeLuaString(statLine),
        level: numberField(block, "level") ?? 0,
        group: stringField(block, "group"),
        modTags: quotedTableValues(block, "modTags"),
        weightKey: quotedTableValues(block, "weightKey"),
        weightVal: [...(tableBlockField(block, "weightVal").matchAll(/-?\d+(?:\.\d+)?/g) || [])].map((match) => Number(match[0]))
      });
    }
  }
  return {
    name: "pob_generated_mods",
    source_path: "Data/Mod*.lua",
    columns: inferColumns(rows),
    rows
  };
};

const latestTreeDir = async (pobPath) => {
  const treeRoot = path.join(pobPath, "src", "TreeData");
  const dirs = (await fs.readdir(treeRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+_\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return dirs.length ? path.join(treeRoot, dirs.at(-1)) : "";
};

const parsePassiveTreeJson = async (pobPath) => {
  const treeDir = await latestTreeDir(pobPath);
  if (!treeDir) {
    return {
      table: { name: "pob_passive_tree", source_path: "", columns: [], rows: [] },
      assets: []
    };
  }
  const treePath = path.join(treeDir, "tree.json");
  const raw = await readJsonFile(treePath);
  const nodesObject = raw.nodes || raw.skillSprites?.nodes || {};
  const nodes = Array.isArray(nodesObject) ? nodesObject : Object.values(nodesObject);
  const rows = nodes.map((node) => ({
    id: String(node.id ?? node.skill ?? node.dn ?? ""),
    name: node.name || node.dn || "",
    type: node.isKeystone ? "keystone" : node.isNotable ? "notable" : node.isJewelSocket ? "jewel" : "small",
    stats: node.stats || [],
    out: (node.out || node.connections || []).map((connection) => String(connection?.id ?? connection)),
    icon: node.icon || node.iconPath || "",
    group: node.g != null ? String(node.g) : node.group != null ? String(node.group) : "",
    orbit: node.o ?? node.orbit ?? 0,
    orbitIndex: node.oidx ?? node.orbitIndex ?? 0
  })).filter((row) => row.id);
  const assetFiles = (await fs.readdir(treeDir))
    .filter((file) => /\.(png|webp|jpg|jpeg|dds\.zst)$/i.test(file))
    .sort()
    .map((file) => ({
      id: `asset:tree:${file}`,
      kind: file.includes("background") ? "passive_tree_background" : "passive_tree_asset",
      logical_path: `TreeData/${path.basename(treeDir)}/${file}`,
      source_path: normalizeSlash(path.relative(pobPath, path.join(treeDir, file)))
    }));
  return {
    table: {
      name: "pob_passive_tree",
      source_path: normalizeSlash(path.relative(path.join(pobPath, "src"), treePath)),
      columns: inferColumns(rows),
      rows
    },
    assets: assetFiles,
    treeDir
  };
};

export const readFixtureSource = async ({ fixturePath }) => {
  const baseDir = repoPath(fixturePath);
  const fixture = await readJsonFile(path.join(baseDir, "fixture.json"));
  return {
    source: fixture.source || { kind: "fixture", version: path.basename(baseDir) },
    baseDir,
    tables: fixture.tables || [],
    assets: fixture.assets || []
  };
};

export const readPobUpstreamSource = async ({ pobPath = process.env.POB_REPO_PATH || DEFAULT_POB_PATH } = {}) => {
  const resolvedPobPath = path.resolve(pobPath);
  const dataDir = path.join(resolvedPobPath, "src", "Data");
  const [gems, bases, mods, passive] = await Promise.all([
    parsePobGems(dataDir),
    parsePobBases(dataDir),
    parsePobMods(dataDir),
    parsePassiveTreeJson(resolvedPobPath)
  ]);
  const version = passive.table.source_path.match(/TreeData\/([^/]+)\//)?.[1] || "pob-local";
  return {
    source: {
      kind: "pob_upstream",
      version,
      label: `PoB upstream ${version}`,
      pob_path: resolvedPobPath,
      pob_commit: await readGitHeadShort(resolvedPobPath)
    },
    baseDir: resolvedPobPath,
    tables: [gems, bases, mods, passive.table],
    assets: passive.assets
  };
};

const readGitHeadShort = async (repoDir) => {
  try {
    const head = (await safeReadText(path.join(repoDir, ".git", "HEAD"))).trim();
    if (head.startsWith("ref:")) {
      const ref = head.replace(/^ref:\s*/, "");
      return (await safeReadText(path.join(repoDir, ".git", ref))).trim().slice(0, 12);
    }
    return head.slice(0, 12);
  } catch {
    return "";
  }
};

const tableSourceKind = (tableName = "") => tableName.startsWith("pob_") ? "pob_generated" : "fixture";

const makeEntity = ({ type, key, displayName = "", sourceTable, sourceRowKey, raw, normalized = raw }) => ({
  type,
  key,
  display_name: displayName,
  source_table: sourceTable,
  source_row_key: sourceRowKey,
  raw_json: raw,
  normalized_json: normalized,
  source_hash: hashJson(normalized)
});

const makeRelation = ({ fromType, fromKey, relationType, toType, toKey, data = {} }) => {
  const relation = {
    from_entity_type: fromType,
    from_entity_key: fromKey,
    relation_type: relationType,
    to_entity_type: toType,
    to_entity_key: toKey,
    relation_json: data
  };
  return { ...relation, relation_hash: hashJson(relation) };
};

const normalizeRows = (tables = []) => {
  const entities = [];
  const relations = [];
  const entityAssets = [];

  for (const table of tables) {
    for (const row of table.rows || []) {
      const rowKey = String(row.id || row.gameId || row.name || "");
      if (!rowKey) continue;

      if (table.name === "pob_generated_gems") {
        const key = row.gameId || row.id;
        entities.push(makeEntity({
          type: "skill_gem",
          key,
          displayName: row.name || key,
          sourceTable: table.name,
          sourceRowKey: rowKey,
          raw: row,
          normalized: {
            id: key,
            name: row.name || "",
            base_type_name: row.baseTypeName || "",
            variant_id: row.variantId || "",
            granted_effect_id: row.grantedEffectId || "",
            gem_type: row.gemType || "",
            tags: ensureArray(row.tags),
            requirements: { str: row.reqStr || 0, dex: row.reqDex || 0, int: row.reqInt || 0 },
            tier: row.tier ?? row.Tier ?? 0,
            natural_max_level: row.naturalMaxLevel || 0
          }
        }));
        if (row.grantedEffectId) {
          relations.push(makeRelation({
            fromType: "skill_gem",
            fromKey: key,
            relationType: "grants_effect",
            toType: "granted_effect",
            toKey: row.grantedEffectId
          }));
        }
        for (const tag of ensureArray(row.tags)) {
          relations.push(makeRelation({
            fromType: "skill_gem",
            fromKey: key,
            relationType: "has_tag",
            toType: "tag",
            toKey: tag
          }));
        }
      }

      if (table.name === "pob_generated_bases") {
        const key = row.id || `item_base:${rowKey}`;
        entities.push(makeEntity({
          type: "item_base",
          key,
          displayName: row.name || row.baseTypeName || key,
          sourceTable: table.name,
          sourceRowKey: rowKey,
          raw: row,
          normalized: {
            id: key,
            name: row.name || "",
            base_type_name: row.baseTypeName || row.name || "",
            item_type: row.type || "",
            tags: ensureArray(row.tags),
            requirements: row.requirements || {},
            properties: row.properties || {},
            weapon: row.weapon || {},
            armour: row.armour || {},
            implicit: row.implicit || ""
          }
        }));
        for (const tag of ensureArray(row.tags)) {
          relations.push(makeRelation({
            fromType: "item_base",
            fromKey: key,
            relationType: "has_tag",
            toType: "tag",
            toKey: tag
          }));
        }
      }

      if (table.name === "pob_generated_mods") {
        const key = row.id;
        entities.push(makeEntity({
          type: "mod",
          key,
          displayName: row.affix || key,
          sourceTable: table.name,
          sourceRowKey: rowKey,
          raw: row,
          normalized: {
            id: key,
            mod_type: row.type || "",
            affix: row.affix || "",
            text: row.text || "",
            level: row.level || 0,
            group: row.group || "",
            tags: ensureArray(row.modTags),
            weight_keys: ensureArray(row.weightKey),
            weight_values: ensureArray(row.weightVal)
          }
        }));
        for (const tag of ensureArray(row.modTags)) {
          relations.push(makeRelation({
            fromType: "mod",
            fromKey: key,
            relationType: "has_tag",
            toType: "tag",
            toKey: tag
          }));
        }
        for (const weightKey of ensureArray(row.weightKey)) {
          relations.push(makeRelation({
            fromType: "mod",
            fromKey: key,
            relationType: "has_spawn_weight",
            toType: "spawn_weight_key",
            toKey: weightKey
          }));
        }
      }

      if (table.name === "pob_passive_tree") {
        const key = String(row.id);
        const out = ensureArray(row.out || row.connections).map((target) => String(target?.id ?? target));
        entities.push(makeEntity({
          type: "passive_node",
          key,
          displayName: row.name || key,
          sourceTable: table.name,
          sourceRowKey: rowKey,
          raw: row,
          normalized: {
            id: key,
            name: row.name || "",
            node_type: row.type || "",
            stats: ensureArray(row.stats),
            out,
            icon: row.icon || "",
            group: row.group != null ? String(row.group) : row.g != null ? String(row.g) : "",
            orbit: row.orbit ?? row.o ?? 0,
            orbit_index: row.orbitIndex ?? row.orbit_index ?? row.oidx ?? 0
          }
        }));
        for (const stat of ensureArray(row.stats)) {
          relations.push(makeRelation({
            fromType: "passive_node",
            fromKey: key,
            relationType: "has_stat_text",
            toType: "stat_text",
            toKey: stat
          }));
        }
        for (const target of out) {
          relations.push(makeRelation({
            fromType: "passive_node",
            fromKey: key,
            relationType: "connects_to",
            toType: "passive_node",
            toKey: target
          }));
        }
        if (row.icon) {
          entityAssets.push({
            entity_type: "passive_node",
            entity_key: key,
            asset_key: `asset:${row.icon}`,
            relation_type: "uses_icon",
            metadata_json: { icon: row.icon }
          });
        }
      }
    }
  }

  const dedupe = (items, keyFn) => {
    const byKey = new Map();
    for (const item of items) byKey.set(keyFn(item), item);
    return [...byKey.values()];
  };

  return {
    entities: sortByStableKey(dedupe(entities, (entity) => `${entity.type}:${entity.key}`), (entity) => `${entity.type}:${entity.key}`),
    relations: sortByStableKey(dedupe(relations, (relation) => [
      relation.from_entity_type,
      relation.from_entity_key,
      relation.relation_type,
      relation.to_entity_type,
      relation.to_entity_key
    ].join("|")), (relation) => [
      relation.from_entity_type,
      relation.from_entity_key,
      relation.relation_type,
      relation.to_entity_type,
      relation.to_entity_key
    ].join("|")),
    entityAssets: sortByStableKey(dedupe(entityAssets, (entry) => [
      entry.entity_type,
      entry.entity_key,
      entry.asset_key,
      entry.relation_type
    ].join("|")), (entry) => [
      entry.entity_type,
      entry.entity_key,
      entry.asset_key,
      entry.relation_type
    ].join("|"))
  };
};

const assetWithMetadata = async (asset, baseDir) => {
  const sourcePath = asset.source_path || asset.logical_path || "";
  const absoluteSourcePath = path.isAbsolute(sourcePath) ? sourcePath : path.join(baseDir || ROOT_DIR, sourcePath);
  const exists = await pathExists(absoluteSourcePath);
  const stat = exists ? await fs.stat(absoluteSourcePath) : null;
  const hash = exists ? hashText(await fs.readFile(absoluteSourcePath)) : "";
  return {
    asset_key: asset.id || `asset:${asset.logical_path || sourcePath}`,
    kind: asset.kind || "asset",
    logical_path: normalizeSlash(asset.logical_path || sourcePath),
    source_path: normalizeSlash(sourcePath),
    absolute_source_path: absoluteSourcePath,
    byte_size: stat?.size || 0,
    content_hash: hash,
    metadata_json: {
      entity_type: asset.entity_type || "",
      entity_id: asset.entity_id || "",
      exists
    },
    status: exists ? "active" : "missing"
  };
};

export const buildExtractSnapshot = async (sourceInput) => {
  const tables = (sourceInput.tables || []).map((table) => {
    const rows = table.rows || [];
    const columns = table.columns?.length ? table.columns : inferColumns(rows);
    const seenRowKeys = new Map();
    const rowHashes = rows.map((row, index) => {
      const baseKey = String(row.id || row.gameId || row.name || index);
      const seenCount = seenRowKeys.get(baseKey) || 0;
      seenRowKeys.set(baseKey, seenCount + 1);
      const rowKey = seenCount === 0 ? baseKey : `${baseKey}#${seenCount + 1}`;
      return {
        table_name: table.name,
        row_key: rowKey,
        row_index: index,
        source_path: table.source_path || "",
        raw_json: row,
        row_hash: hashJson(row)
      };
    });
    return {
      name: table.name,
      source_path: table.source_path || "",
      source_kind: tableSourceKind(table.name),
      columns,
      rows,
      rowHashes,
      table_hash: hashJson(rowHashes.map((row) => ({ key: row.row_key, hash: row.row_hash })))
    };
  });

  const rawTables = tables.map((table) => ({
    table_name: table.name,
    source_path: table.source_path,
    source_kind: table.source_kind,
    column_count: table.columns.length,
    row_count: table.rows.length,
    table_hash: table.table_hash,
    metadata_json: {}
  }));
  const rawColumns = tables.flatMap((table) => table.columns.map((column, index) => ({
    table_name: table.name,
    column_name: column,
    ordinal: index,
    type_hint: "",
    raw_json: {}
  })));
  const rawRows = tables.flatMap((table) => table.rowHashes);
  const normalized = normalizeRows(tables);
  const assets = await Promise.all((sourceInput.assets || []).map((asset) => assetWithMetadata(asset, sourceInput.baseDir)));

  const source = {
    kind: sourceInput.source?.kind || "unknown",
    version: sourceInput.source?.version || nowIso(),
    label: sourceInput.source?.label || "",
    game_path: sourceInput.source?.game_path || "",
    ggpk_path: sourceInput.source?.ggpk_path || "",
    pob_path: sourceInput.source?.pob_path || "",
    pob_commit: sourceInput.source?.pob_commit || ""
  };
  const versionKey = `${source.kind}:${source.version}:${hashJson({ tables: rawTables.map((table) => table.table_hash), assets: assets.map((asset) => asset.content_hash) }).slice(0, 12)}`;
  const summary = {
    tables: { total: rawTables.length },
    rows: { total: rawRows.length },
    columns: { total: rawColumns.length },
    entities: {
      total: normalized.entities.length,
      by_type: countBy(normalized.entities, (entity) => entity.type)
    },
    relations: { total: normalized.relations.length },
    assets: {
      total: assets.length,
      missing: assets.filter((asset) => asset.status === "missing").length
    },
    entity_assets: { total: normalized.entityAssets.length }
  };
  const extractHash = hashJson({
    rawRows: rawRows.map((row) => `${row.table_name}:${row.row_key}:${row.row_hash}`),
    entities: normalized.entities.map((entity) => `${entity.type}:${entity.key}:${entity.source_hash}`),
    relations: normalized.relations.map((relation) => relation.relation_hash),
    assets: assets.map((asset) => `${asset.asset_key}:${asset.content_hash}`)
  });

  return {
    generated_at: nowIso(),
    version_key: versionKey,
    source,
    source_hash: hashJson({ source, rawTables }),
    extract_hash: extractHash,
    raw: {
      tables: rawTables,
      columns: rawColumns,
      rows: rawRows
    },
    entities: normalized.entities,
    relations: normalized.relations,
    assets,
    entity_assets: normalized.entityAssets,
    failures: [],
    summary
  };
};

const countBy = (items, keyFn) => items.reduce((acc, item) => {
  const key = keyFn(item);
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const diffCollection = (beforeItems, afterItems, keyFn, hashFn, outputKeyFn = keyFn) => {
  const before = new Map(beforeItems.map((item) => [keyFn(item), item]));
  const after = new Map(afterItems.map((item) => [keyFn(item), item]));
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];
  for (const [key, item] of after) {
    const outputKey = outputKeyFn(item, key);
    if (!before.has(key)) added.push({ key: outputKey, next: item });
    else if (hashFn(before.get(key)) !== hashFn(item)) {
      changed.push({ key: outputKey, previous: before.get(key), next: item });
    } else {
      unchanged.push({ key: outputKey, next: item });
    }
  }
  for (const [key, item] of before) {
    if (!after.has(key)) removed.push({ key: outputKeyFn(item, key), previous: item });
  }
  return { added, removed, changed, unchanged };
};

export const diffSnapshots = (before, after) => {
  const rows = diffCollection(
    before.raw?.rows || [],
    after.raw?.rows || [],
    (row) => `${row.table_name}:${row.row_key}`,
    (row) => row.row_hash
  );
  const entities = diffCollection(
    before.entities || [],
    after.entities || [],
    (entity) => `${entity.type}:${entity.key}`,
    (entity) => entity.source_hash,
    (entity) => entity.key
  );
  const relations = diffCollection(
    before.relations || [],
    after.relations || [],
    (relation) => [
      relation.from_entity_type,
      relation.from_entity_key,
      relation.relation_type,
      relation.to_entity_type,
      relation.to_entity_key
    ].join("|"),
    (relation) => relation.relation_hash
  );
  const assets = diffCollection(
    before.assets || [],
    after.assets || [],
    (asset) => asset.asset_key,
    (asset) => asset.content_hash || asset.status
  );
  const summary = Object.fromEntries(Object.entries({ rows, entities, relations, assets })
    .map(([name, diff]) => [name, {
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      unchanged: diff.unchanged.length
    }]));
  const diffHash = hashJson({ from: before.extract_hash, to: after.extract_hash, summary });
  return { from: before.version_key, to: after.version_key, diff_hash: diffHash, rows, entities, relations, assets, summary };
};

const safeRelativeAssetPath = (logicalPath) => {
  const cleaned = normalizeSlash(logicalPath).replace(/^\/+/, "").replace(/\.\.+/g, "_");
  return cleaned || "asset";
};

export const writeSnapshotOutput = async (snapshot, {
  outputDir = DEFAULT_OUTPUT_DIR,
  copyAssets = false
} = {}) => {
  const resolvedOutput = path.resolve(outputDir);
  const assetsDir = path.join(resolvedOutput, "assets");
  await fs.mkdir(resolvedOutput, { recursive: true });
  if (copyAssets) await fs.mkdir(assetsDir, { recursive: true });

  const manifestAssets = [];
  for (const asset of snapshot.assets || []) {
    let copied = false;
    let localPath = "";
    if (copyAssets && asset.status === "active" && asset.absolute_source_path) {
      const relative = safeRelativeAssetPath(asset.logical_path);
      const target = path.join(assetsDir, relative);
      const resolvedTarget = path.resolve(target);
      if (!resolvedTarget.startsWith(path.resolve(assetsDir))) {
        throw new Error(`Unsafe asset target: ${asset.logical_path}`);
      }
      await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
      await fs.copyFile(asset.absolute_source_path, resolvedTarget);
      copied = true;
      localPath = normalizeSlash(path.relative(resolvedOutput, resolvedTarget));
    }
    manifestAssets.push({
      key: asset.asset_key,
      kind: asset.kind,
      logical_path: asset.logical_path,
      source_path: asset.source_path,
      local_path: localPath,
      byte_size: asset.byte_size,
      hash: asset.content_hash,
      status: asset.status,
      copied
    });
  }

  const snapshotPath = path.join(resolvedOutput, "latest.json");
  const versionedPath = path.join(resolvedOutput, `${snapshot.version_key.replace(/[^a-zA-Z0-9_.-]+/g, "_")}.json`);
  const assetManifestPath = path.join(resolvedOutput, "asset-manifest.json");
  const publicSnapshot = {
    ...snapshot,
    assets: snapshot.assets.map(({ absolute_source_path, ...asset }) => asset)
  };
  await fs.writeFile(snapshotPath, `${JSON.stringify(publicSnapshot, null, 2)}\n`, "utf8");
  await fs.writeFile(versionedPath, `${JSON.stringify(publicSnapshot, null, 2)}\n`, "utf8");
  await fs.writeFile(assetManifestPath, `${JSON.stringify({
    generated_at: nowIso(),
    extract_version: snapshot.version_key,
    assets: manifestAssets
  }, null, 2)}\n`, "utf8");
  return { outputDir: resolvedOutput, snapshotPath, versionedPath, assetManifestPath };
};

export const preflightGameInstall = async ({
  gamePath = process.env.POE2_GAME_PATH || DEFAULT_GAME_PATH,
  pobPath = process.env.POB_REPO_PATH || DEFAULT_POB_PATH
} = {}) => {
  const resolvedGamePath = path.resolve(gamePath);
  const resolvedPobPath = path.resolve(pobPath);
  const ggpkPath = path.join(resolvedGamePath, "Content.ggpk");
  const oodleDir = path.join(resolvedPobPath, "src", "Export", "ggpk");
  const toolPaths = [
    path.join(oodleDir, "bun_extract_file.exe"),
    path.join(oodleDir, "libbun.dll"),
    path.join(oodleDir, "libooz.dll")
  ];
  const tools = await Promise.all(toolPaths.map(async (toolPath) => ({
    path: toolPath,
    exists: await pathExists(toolPath)
  })));
  return {
    game_path: { path: resolvedGamePath, exists: await pathExists(resolvedGamePath) },
    ggpk: {
      path: ggpkPath,
      exists: await pathExists(ggpkPath),
      byte_size: await pathExists(ggpkPath) ? (await fs.stat(ggpkPath)).size : 0
    },
    pob_upstream: {
      path: resolvedPobPath,
      exists: await pathExists(resolvedPobPath),
      data_dir_exists: await pathExists(path.join(resolvedPobPath, "src", "Data"))
    },
    oodle_tools: {
      ready: tools.every((tool) => tool.exists),
      tools
    }
  };
};

export const importSnapshotPostgres = async (pool, snapshot) => withTransaction(pool, async (client) => {
  const version = await client.query(`
    insert into game_extract_versions
      (version_key, source_kind, source_label, game_path, ggpk_path, pob_path, pob_commit,
       source_hash, extract_hash, status, metadata_json, summary_json, finished_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10::jsonb, $11::jsonb, now())
    on conflict (version_key) do update
    set extract_hash = excluded.extract_hash,
        source_hash = excluded.source_hash,
        metadata_json = excluded.metadata_json,
        summary_json = excluded.summary_json,
        finished_at = now()
    returning id
  `, [
    snapshot.version_key,
    snapshot.source.kind,
    snapshot.source.label || "",
    snapshot.source.game_path || "",
    snapshot.source.ggpk_path || "",
    snapshot.source.pob_path || "",
    snapshot.source.pob_commit || "",
    snapshot.source_hash,
    snapshot.extract_hash,
    asJsonParam(snapshot.source),
    asJsonParam(snapshot.summary)
  ]);
  const versionId = version.rows[0].id;

  await client.query("delete from game_dat_tables where extract_version_id = $1", [versionId]);
  await client.query("delete from game_dat_columns where extract_version_id = $1", [versionId]);
  await client.query("delete from game_dat_rows where extract_version_id = $1", [versionId]);
  await client.query("delete from game_entities where extract_version_id = $1", [versionId]);
  await client.query("delete from game_entity_relations where extract_version_id = $1", [versionId]);
  await client.query("delete from game_assets where extract_version_id = $1", [versionId]);
  await client.query("delete from game_entity_assets where extract_version_id = $1", [versionId]);

  if (snapshot.raw.tables.length) {
    await client.query(`
      insert into game_dat_tables
        (extract_version_id, table_name, source_path, source_kind, column_count, row_count, table_hash, metadata_json)
      select $2, table_name, source_path, source_kind, column_count, row_count, table_hash, metadata_json
      from jsonb_to_recordset($1::jsonb) as payload(
        table_name text,
        source_path text,
        source_kind text,
        column_count integer,
        row_count integer,
        table_hash text,
        metadata_json jsonb
      )
    `, [asJsonParam(snapshot.raw.tables), versionId]);
  }
  if (snapshot.raw.columns.length) {
    await client.query(`
      insert into game_dat_columns
        (extract_version_id, table_name, column_name, ordinal, type_hint, raw_json)
      select $2, table_name, column_name, ordinal, type_hint, raw_json
      from jsonb_to_recordset($1::jsonb) as payload(
        table_name text,
        column_name text,
        ordinal integer,
        type_hint text,
        raw_json jsonb
      )
    `, [asJsonParam(snapshot.raw.columns), versionId]);
  }
  if (snapshot.raw.rows.length) {
    await client.query(`
      insert into game_dat_rows
        (extract_version_id, table_name, row_key, row_index, source_path, raw_json, row_hash)
      select $2, table_name, row_key, row_index, source_path, raw_json, row_hash
      from jsonb_to_recordset($1::jsonb) as payload(
        table_name text,
        row_key text,
        row_index integer,
        source_path text,
        raw_json jsonb,
        row_hash text
      )
    `, [asJsonParam(snapshot.raw.rows), versionId]);
  }
  if (snapshot.entities.length) {
    await client.query(`
      insert into game_entities
        (extract_version_id, entity_type, entity_key, display_name, source_table, source_row_key,
         raw_json, normalized_json, source_hash)
      select $2, type, key, display_name, source_table, source_row_key, raw_json, normalized_json, source_hash
      from jsonb_to_recordset($1::jsonb) as payload(
        type text,
        key text,
        display_name text,
        source_table text,
        source_row_key text,
        raw_json jsonb,
        normalized_json jsonb,
        source_hash text
      )
    `, [asJsonParam(snapshot.entities), versionId]);
  }
  if (snapshot.relations.length) {
    await client.query(`
      insert into game_entity_relations
        (extract_version_id, from_entity_type, from_entity_key, relation_type,
         to_entity_type, to_entity_key, relation_json, relation_hash)
      select $2, from_entity_type, from_entity_key, relation_type,
        to_entity_type, to_entity_key, relation_json, relation_hash
      from jsonb_to_recordset($1::jsonb) as payload(
        from_entity_type text,
        from_entity_key text,
        relation_type text,
        to_entity_type text,
        to_entity_key text,
        relation_json jsonb,
        relation_hash text
      )
    `, [asJsonParam(snapshot.relations), versionId]);
  }
  if (snapshot.assets.length) {
    await client.query(`
      insert into game_assets
        (extract_version_id, asset_key, kind, logical_path, source_path, byte_size,
         content_hash, metadata_json, status)
      select $2, asset_key, kind, logical_path, source_path, byte_size,
        content_hash, metadata_json, status
      from jsonb_to_recordset($1::jsonb) as payload(
        asset_key text,
        kind text,
        logical_path text,
        source_path text,
        byte_size bigint,
        content_hash text,
        metadata_json jsonb,
        status text
      )
    `, [asJsonParam(snapshot.assets.map(({ absolute_source_path, ...asset }) => asset)), versionId]);
  }
  if (snapshot.entity_assets.length) {
    await client.query(`
      insert into game_entity_assets
        (extract_version_id, entity_type, entity_key, asset_key, relation_type, metadata_json)
      select $2, entity_type, entity_key, asset_key, relation_type, metadata_json
      from jsonb_to_recordset($1::jsonb) as payload(
        entity_type text,
        entity_key text,
        asset_key text,
        relation_type text,
        metadata_json jsonb
      )
    `, [asJsonParam(snapshot.entity_assets), versionId]);
  }

  return { version_id: versionId, version_key: snapshot.version_key };
});

export const runWithPool = async (callback) => {
  const pool = createPool();
  try {
    return await callback(pool);
  } finally {
    await closePool(pool);
  }
};

export const loadSnapshotFile = async (snapshotPath) => readJsonFile(path.resolve(snapshotPath));

export const boolArg = (value, fallback = false) => {
  if (value == null) return fallback;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
};

export const outputSummary = ({ snapshot, output, database = "skipped", diff = null, preflight = null }) => ({
  database,
  source: snapshot.source,
  version_key: snapshot.version_key,
  extract_hash: snapshot.extract_hash,
  summary: snapshot.summary,
  output: {
    dir: output.outputDir,
    snapshot: output.snapshotPath,
    versioned: output.versionedPath,
    asset_manifest: output.assetManifestPath
  },
  diff: diff ? { summary: diff.summary, diff_hash: diff.diff_hash } : null,
  preflight
});

export const isMainModule = (moduleUrl = import.meta.url, argv = process.argv) => {
  if (!argv[1]) return false;
  return moduleUrl === new URL(`file://${path.resolve(argv[1]).replace(/\\/g, "/")}`).href;
};

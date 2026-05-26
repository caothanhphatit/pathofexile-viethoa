import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hashJson
} from "./runtime.mjs";
import {
  withTransaction
} from "../../src/db/pool.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_GGPK_FULL_CATALOG_DIR = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "full-datc64", "catalog");

const NULL_KEY_FLOOR = 1e15;
const nowIso = () => new Date().toISOString();
const normalizeSlash = (value = "") => String(value).replace(/\\/g, "/");
const cleanPath = (value = "") => normalizeSlash(value)
  .replace(/^\/+/, "")
  .split("/")
  .filter((part) => part && part !== "." && part !== "..")
  .join("/");
const cleanGameText = (value = "") => String(value || "")
  .replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2")
  .replace(/\[([^\]]+)\]/g, "$1")
  .replace(/\s+/g, " ")
  .trim();
const asJsonParam = (value) => JSON.stringify(value ?? null);
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

const exists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (target) => JSON.parse(await fs.readFile(target, "utf8"));

const tableOutputName = (tableKey) =>
  tableKey.replace(/[^a-z0-9]+/gi, "__").replace(/^__|__$/g, "").toLowerCase() || "table";

const resolveInventoryPath = async (catalogDir, inventoryPath = "") => {
  const candidates = [
    inventoryPath,
    path.join(catalogDir, "ggpk-file-inventory.json"),
    path.join(path.dirname(catalogDir), "ggpk-file-inventory.json")
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (await exists(resolved)) return resolved;
  }
  return "";
};

const loadTablePayload = async (catalogDir, manifest, tableName) => {
  const entry = (manifest.tables || []).find((table) => table.table === tableName);
  if (!entry) return null;
  const directPath = entry.file ? path.join(catalogDir, entry.file) : "";
  const fallbackPath = path.join(catalogDir, "tables", `${tableOutputName(tableName)}.json`);
  const tablePath = directPath && await exists(directPath) ? directPath : fallbackPath;
  if (!await exists(tablePath)) return null;
  return readJson(tablePath);
};

const keyIndex = (value) => {
  if (value == null) return null;
  if (typeof value === "number") return value >= NULL_KEY_FLOOR ? null : value;
  if (typeof value === "object" && "lo" in value) {
    const lo = Number(value.lo);
    if (!Number.isFinite(lo) || lo >= NULL_KEY_FLOOR) return null;
    return lo;
  }
  return null;
};

const tableIndex = (payload) => {
  const rows = payload?.rows || [];
  return {
    rows,
    byId: new Map(rows.map((row, index) => [String(row.Id ?? row.id ?? index), row])),
    byIndex: new Map(rows.map((row, index) => [index, row]))
  };
};

const rowKey = (row, index) => String(row?.Id ?? row?.id ?? row?.Name ?? row?.name ?? index);
const rowName = (row, fallback = "") => String(row?.Name || row?.DisplayName || row?.Id || row?.id || fallback);
const meaningfulText = (value = "") => {
  const cleaned = cleanGameText(value);
  if (!cleaned || cleaned === "???") return "";
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : "";
};
const humanizeIdentifier = (value = "") => String(value || "")
  .replace(/\.[a-z0-9]+$/i, "")
  .replace(/[_-]+/g, " ")
  .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
  .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
  .replace(/\s+/g, " ")
  .trim();
const readablePathLeaf = (value = "") => {
  const segments = cleanPath(value).split("/").filter(Boolean);
  return humanizeIdentifier(segments.at(-1) || value);
};
const monsterFallbackTitle = (key = "", objectType = "") => {
  const segments = cleanPath(key).split("/").filter(Boolean);
  const monsterSegments = segments[0] === "Metadata" && segments[1] === "Monsters" ? segments.slice(2) : segments;
  const leaf = humanizeIdentifier(monsterSegments.at(-1) || objectType || key);
  const parent = humanizeIdentifier(monsterSegments.at(-2) || "");
  if (parent && leaf && parent !== leaf) return `${parent} ${leaf}`;
  return leaf || readablePathLeaf(objectType || key);
};
const monsterDisplayName = (row, key) =>
  meaningfulText(row?.Name) || monsterFallbackTitle(key, row?.ObjectType || "") || String(key);

const resolveKey = (indexes, tableName, value) => {
  const idx = keyIndex(value);
  if (idx == null) return "";
  const row = indexes[tableName]?.byIndex.get(idx);
  return row ? rowKey(row, idx) : String(idx);
};

const resolveKeys = (indexes, tableName, values) =>
  (Array.isArray(values) ? values : []).map((value) => resolveKey(indexes, tableName, value)).filter(Boolean);

const resolveKeyList = (indexes, tableName, ...groups) => uniqueSorted(groups.flatMap((group) =>
  (Array.isArray(group) ? group : [group]).map((value) => resolveKey(indexes, tableName, value)).filter(Boolean)
));

const getVisual = (indexes, value) => {
  const idx = keyIndex(value);
  if (idx == null) return null;
  return indexes.itemvisualidentity?.byIndex.get(idx) || null;
};

const assetKind = (logicalPath = "") => {
  const normalized = logicalPath.toLowerCase();
  if (/\.(bk2|bik|webm|mp4|mkv|mov|avi|wmv|usm)$/.test(normalized) || normalized.includes("/videos/")) return "video";
  if (/\.(dds|png|jpg|jpeg|webp|tga)$/.test(normalized)) return "image";
  if (/\.(ogg|wav|bank)$/.test(normalized)) return "audio";
  return "asset";
};

const makeEntity = ({ type, key, displayName = "", sourceTable, sourceRowKey, raw, normalized }) => ({
  type,
  key: String(key),
  display_name: displayName || String(key),
  source_table: sourceTable,
  source_row_key: String(sourceRowKey),
  raw_json: raw,
  normalized_json: normalized,
  source_hash: hashJson(normalized)
});

const makeRelation = ({ fromType, fromKey, relationType, toType, toKey, data = {} }) => {
  const relation = {
    from_entity_type: fromType,
    from_entity_key: String(fromKey),
    relation_type: relationType,
    to_entity_type: toType,
    to_entity_key: String(toKey),
    relation_json: data
  };
  return { ...relation, relation_hash: hashJson(relation) };
};

const assetForPath = (logicalPath, metadata = {}) => {
  const normalized = normalizeSlash(logicalPath);
  return {
    asset_key: `asset:${normalized}`,
    kind: assetKind(normalized),
    logical_path: normalized,
    source_path: normalized,
    local_path: "",
    byte_size: 0,
    content_hash: "",
    metadata_json: metadata,
    status: "referenced"
  };
};

const connectAsset = ({ entityType, entityKey, asset, relationType, entityAssets, relations }) => {
  entityAssets.push({
    entity_type: entityType,
    entity_key: String(entityKey),
    asset_key: asset.asset_key,
    relation_type: relationType,
    metadata_json: { logical_path: asset.logical_path, kind: asset.kind }
  });
  relations.push(makeRelation({
    fromType: entityType,
    fromKey: entityKey,
    relationType,
    toType: "asset",
    toKey: asset.asset_key,
    data: { logical_path: asset.logical_path, kind: asset.kind }
  }));
};

const addAsset = (assets, entityAssets, relations, {
  logicalPath,
  entityType,
  entityKey,
  relationType = "uses_asset",
  metadata = {}
}) => {
  if (!logicalPath) return;
  const asset = assetForPath(logicalPath, metadata);
  assets.push(asset);
  if (entityType && entityKey) connectAsset({ entityType, entityKey, asset, relationType, entityAssets, relations });
};

const statEntries = (indexes, row, max = 6) => Array.from({ length: max }, (_, index) => {
  const ordinal = index + 1;
  const stat = resolveKey(indexes, "stats", row[`Stat${ordinal}`]);
  if (!stat) return null;
  return {
    stat,
    value: row[`Stat${ordinal}Value`] ?? row[`Stat${ordinal}`] ?? 0
  };
}).filter(Boolean);

const passiveStatEntries = (indexes, row) => {
  const stats = resolveKeys(indexes, "stats", row.Stats);
  return stats.map((stat, index) => ({
    stat,
    value: row[`Stat${index + 1}`] ?? 0
  }));
};

const normalizeTables = (tables) => {
  const indexes = Object.fromEntries(Object.entries(tables).map(([name, payload]) => [name, tableIndex(payload)]));
  const entities = [];
  const relations = [];
  const assets = [];
  const entityAssets = [];

  for (const [index, row] of indexes.tags?.rows.entries() || []) {
    const key = rowKey(row, index);
    entities.push(makeEntity({
      type: "tag",
      key,
      displayName: row.DisplayText || row.Text || key,
      sourceTable: "tags",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        display_text: row.DisplayText || "",
        text: row.Text || "",
        hash: row.Hash32 || 0
      }
    }));
  }

  for (const [index, row] of indexes.stats?.rows.entries() || []) {
    const key = rowKey(row, index);
    entities.push(makeEntity({
      type: "stat",
      key,
      displayName: key,
      sourceTable: "stats",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        hash: row.Hash || 0,
        local: Boolean(row.Local),
        weapon_local: Boolean(row.WeaponLocal),
        virtual: Boolean(row.Virtual),
        semantic: row.Semantic ?? null,
        scalable: Boolean(row.IsScalable)
      }
    }));
  }

  for (const [index, row] of indexes.itemclasses?.rows.entries() || []) {
    const key = rowKey(row, index);
    entities.push(makeEntity({
      type: "item_class",
      key,
      displayName: rowName(row, key),
      sourceTable: "itemclasses",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        name: row.Name || key,
        flags: row.Flags || []
      }
    }));
  }

  for (const [index, row] of indexes.itemvisualidentity?.rows.entries() || []) {
    const key = rowKey(row, index);
    entities.push(makeEntity({
      type: "item_visual_identity",
      key,
      displayName: key,
      sourceTable: "itemvisualidentity",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        dds_file: row.DDSFile || "",
        ao_file: row.AOFile || "",
        epk_file: row.EPKFile || "",
        is_alternate_art: Boolean(row.IsAlternateArt)
      }
    }));
    addAsset(assets, entityAssets, relations, {
      logicalPath: row.DDSFile,
      entityType: "item_visual_identity",
      entityKey: key,
      relationType: "uses_icon",
      metadata: { source_table: "itemvisualidentity" }
    });
  }

  for (const [index, row] of indexes.baseitemtypes?.rows.entries() || []) {
    const key = rowKey(row, index);
    const tags = resolveKeys(indexes, "tags", row.Tags);
    const implicitMods = resolveKeys(indexes, "mods", row.ImplicitMods);
    const itemClass = resolveKey(indexes, "itemclasses", row.ItemClass);
    const visual = getVisual(indexes, row.ItemVisualIdentityKey);
    entities.push(makeEntity({
      type: "item_base",
      key,
      displayName: row.Name || key,
      sourceTable: "baseitemtypes",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        name: row.Name || "",
        base_type: row.BaseType || "",
        item_class: itemClass,
        drop_level: row.DropLevel || 0,
        width: row.Width || 0,
        height: row.Height || 0,
        tags,
        implicit_mods: implicitMods,
        visual_identity: visual ? rowKey(visual, keyIndex(row.ItemVisualIdentityKey)) : "",
        icon: visual?.DDSFile || "",
        corrupted: Boolean(row.IsCorrupted)
      }
    }));
    if (itemClass) relations.push(makeRelation({ fromType: "item_base", fromKey: key, relationType: "has_item_class", toType: "item_class", toKey: itemClass }));
    for (const tag of tags) relations.push(makeRelation({ fromType: "item_base", fromKey: key, relationType: "has_tag", toType: "tag", toKey: tag }));
    for (const mod of implicitMods) relations.push(makeRelation({ fromType: "item_base", fromKey: key, relationType: "implicit_mod", toType: "mod", toKey: mod }));
    addAsset(assets, entityAssets, relations, {
      logicalPath: visual?.DDSFile,
      entityType: "item_base",
      entityKey: key,
      relationType: "uses_icon",
      metadata: { source_table: "baseitemtypes", visual_identity: visual ? rowKey(visual, keyIndex(row.ItemVisualIdentityKey)) : "" }
    });
  }

  for (const [index, row] of indexes.mods?.rows.entries() || []) {
    const key = rowKey(row, index);
    const stats = statEntries(indexes, row, 6);
    const tags = resolveKeys(indexes, "tags", row.Tags);
    const spawnTags = resolveKeys(indexes, "tags", row.SpawnTags);
    entities.push(makeEntity({
      type: "mod",
      key,
      displayName: row.Name || key,
      sourceTable: "mods",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        name: row.Name || "",
        level: row.Level || 0,
        domain: row.Domain ?? null,
        generation_type: row.GenerationType ?? null,
        stats,
        tags,
        spawn_tags: spawnTags,
        spawn_weights: row.SpawnWeight || row.SpawnWeights || []
      }
    }));
    for (const stat of stats) relations.push(makeRelation({ fromType: "mod", fromKey: key, relationType: "has_stat", toType: "stat", toKey: stat.stat, data: { value: stat.value } }));
    for (const tag of tags) relations.push(makeRelation({ fromType: "mod", fromKey: key, relationType: "has_tag", toType: "tag", toKey: tag }));
    for (const tag of spawnTags) relations.push(makeRelation({ fromType: "mod", fromKey: key, relationType: "spawn_tag", toType: "tag", toKey: tag }));
  }

  for (const [index, row] of indexes.passiveskills?.rows.entries() || []) {
    const key = rowKey(row, index);
    const stats = passiveStatEntries(indexes, row);
    entities.push(makeEntity({
      type: "passive_node",
      key,
      displayName: row.Name || key,
      sourceTable: "passiveskills",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        node_id: row.PassiveSkillNodeId ?? null,
        name: row.Name || "",
        icon: row.Icon || "",
        stats,
        notable: Boolean(row.Notable),
        keystone: Boolean(row.Keystone),
        jewel_socket: Boolean(row.JewelSocket),
        ascendancy_start: Boolean(row.AscendancyStart),
        passive_points_granted: row.PassivePointsGranted || 0
      }
    }));
    for (const stat of stats) relations.push(makeRelation({ fromType: "passive_node", fromKey: key, relationType: "has_stat", toType: "stat", toKey: stat.stat, data: { value: stat.value } }));
    addAsset(assets, entityAssets, relations, {
      logicalPath: row.Icon,
      entityType: "passive_node",
      entityKey: key,
      relationType: "uses_icon",
      metadata: { source_table: "passiveskills" }
    });
  }

  for (const [index, row] of indexes.activeskills?.rows.entries() || []) {
    const key = rowKey(row, index);
    const skillStats = [
      ...resolveKeys(indexes, "stats", row.SkillSpecificStat),
      ...resolveKeys(indexes, "stats", row.GenericStat),
      ...resolveKeys(indexes, "stats", row.SecondarySkillSpecificStat)
    ];
    entities.push(makeEntity({
      type: "active_skill",
      key,
      displayName: row.DisplayName || key,
      sourceTable: "activeskills",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        name: row.DisplayName || "",
        description: row.Description || "",
        website_description: row.WebsiteDescription || "",
        short_description: row.ShortDescription || "",
        icon: row.Icon || "",
        video: row.Video || "",
        granted_effect: row.GrantedEffect || "",
        is_gem: Boolean(row.isGem),
        stats: uniqueSorted(skillStats)
      }
    }));
    if (row.GrantedEffect) relations.push(makeRelation({ fromType: "active_skill", fromKey: key, relationType: "grants_effect", toType: "granted_effect", toKey: row.GrantedEffect }));
    for (const stat of uniqueSorted(skillStats)) relations.push(makeRelation({ fromType: "active_skill", fromKey: key, relationType: "has_stat", toType: "stat", toKey: stat }));
    addAsset(assets, entityAssets, relations, {
      logicalPath: row.Icon,
      entityType: "active_skill",
      entityKey: key,
      relationType: "uses_icon",
      metadata: { source_table: "activeskills" }
    });
    addAsset(assets, entityAssets, relations, {
      logicalPath: row.Video,
      entityType: "active_skill",
      entityKey: key,
      relationType: "uses_video",
      metadata: { source_table: "activeskills" }
    });
  }

  for (const [index, row] of indexes.grantedeffects?.rows.entries() || []) {
    const key = rowKey(row, index);
    const activeSkill = resolveKey(indexes, "activeskills", row.ActiveSkill);
    entities.push(makeEntity({
      type: "granted_effect",
      key,
      displayName: key,
      sourceTable: "grantedeffects",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        active_skill: activeSkill,
        support: Boolean(row.IsSupport),
        support_gem_letter: row.SupportGemLetter || "",
        cast_time: row.CastTime || 0
      }
    }));
    if (activeSkill) relations.push(makeRelation({ fromType: "granted_effect", fromKey: key, relationType: "belongs_to_skill", toType: "active_skill", toKey: activeSkill }));
  }

  for (const [index, row] of indexes.worldareas?.rows.entries() || []) {
    const key = rowKey(row, index);
    entities.push(makeEntity({
      type: "world_area",
      key,
      displayName: row.Name || key,
      sourceTable: "worldareas",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        name: row.Name || "",
        act: row.Act || 0,
        area_level: row.AreaLevel || 0,
        town: Boolean(row.IsTown),
        hideout: Boolean(row.IsHideout),
        endgame: Boolean(row.IsEndGameArea),
        description: row.Description || ""
      }
    }));
  }

  for (const [index, row] of indexes.monstervarieties?.rows.entries() || []) {
    const key = rowKey(row, index);
    const displayName = monsterDisplayName(row, key);
    const objectLabel = readablePathLeaf(row.ObjectType || "");
    const tags = resolveKeys(indexes, "tags", row.Tags);
    const mods = resolveKeyList(indexes, "mods", row.Mods, row.ModsKeys2, row.SpecialMods, row.ModsPart1, row.ModsPart2, row.ModsEndgame);
    const grantedEffects = resolveKeyList(indexes, "grantedeffects", row.GrantedEffects);
    const activeSkills = uniqueSorted(grantedEffects.map((effectKey) => {
      const effectRow = indexes.grantedeffects?.byId.get(effectKey);
      return effectRow ? resolveKey(indexes, "activeskills", effectRow.ActiveSkill) : "";
    }).filter(Boolean));
    entities.push(makeEntity({
      type: "monster_variety",
      key,
      displayName,
      sourceTable: "monstervarieties",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        name: displayName,
        raw_name: row.Name || "",
        object_type: row.ObjectType || "",
        object_label: objectLabel,
        ai_script: row.AIScript || "",
        movement_speed: row.MovementSpeed || 0,
        damage_multiplier: row.DamageMultiplier || 0,
        life_multiplier: row.LifeMultiplier || 0,
        tags,
        mods,
        granted_effects: grantedEffects,
        active_skills: activeSkills
      }
    }));
    for (const tag of tags) relations.push(makeRelation({ fromType: "monster_variety", fromKey: key, relationType: "has_tag", toType: "tag", toKey: tag }));
    for (const mod of mods) relations.push(makeRelation({ fromType: "monster_variety", fromKey: key, relationType: "has_mod", toType: "mod", toKey: mod }));
    for (const effect of grantedEffects) relations.push(makeRelation({ fromType: "monster_variety", fromKey: key, relationType: "uses_granted_effect", toType: "granted_effect", toKey: effect }));
    for (const skill of activeSkills) relations.push(makeRelation({ fromType: "monster_variety", fromKey: key, relationType: "uses_skill", toType: "active_skill", toKey: skill }));
  }

  for (const [index, row] of indexes.craftingbenchoptions?.rows.entries() || []) {
    const key = `${row.Name || "craft"}:${row.Order ?? index}:${row.Tier ?? 0}`;
    const mod = resolveKey(indexes, "mods", row.Mod);
    const costItems = resolveKeys(indexes, "baseitemtypes", row.Cost_BaseItemTypes);
    entities.push(makeEntity({
      type: "crafting_recipe",
      key,
      displayName: row.Name || key,
      sourceTable: "craftingbenchoptions",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        name: row.Name || "",
        description: row.Description || "",
        required_level: row.RequiredLevel || 0,
        tier: row.Tier || 0,
        sockets: row.Sockets || 0,
        links: row.Links || 0,
        mod,
        cost_items: costItems,
        cost_values: row.CostValue || []
      }
    }));
    if (mod) relations.push(makeRelation({ fromType: "crafting_recipe", fromKey: key, relationType: "grants_mod", toType: "mod", toKey: mod }));
    for (const item of costItems) relations.push(makeRelation({ fromType: "crafting_recipe", fromKey: key, relationType: "costs_item", toType: "item_base", toKey: item }));
  }

  for (const [index, row] of indexes.endgamemaps?.rows.entries() || []) {
    const key = String(row.Id ?? index);
    const area = resolveKey(indexes, "worldareas", row.BossVersion);
    entities.push(makeEntity({
      type: "endgame_map",
      key,
      displayName: area || key,
      sourceTable: "endgamemaps",
      sourceRowKey: key,
      raw: row,
      normalized: {
        id: key,
        boss_area: area,
        flavour_text: row.FlavourText || "",
        min_watchstone_tier: row.MinWatchstoneTier || 0
      }
    }));
    if (area) relations.push(makeRelation({ fromType: "endgame_map", fromKey: key, relationType: "uses_world_area", toType: "world_area", toKey: area }));
  }

  return {
    entities: dedupe(entities, (entity) => `${entity.type}:${entity.key}`),
    relations: dedupe(relations, (relation) => [
      relation.from_entity_type,
      relation.from_entity_key,
      relation.relation_type,
      relation.to_entity_type,
      relation.to_entity_key
    ].join("|")),
    assets: dedupe(assets, (asset) => asset.asset_key),
    entityAssets: dedupe(entityAssets, (entry) => [
      entry.entity_type,
      entry.entity_key,
      entry.asset_key,
      entry.relation_type
    ].join("|"))
  };
};

const dedupe = (items, keyFn) => [...items.reduce((map, item) => map.set(keyFn(item), item), new Map()).values()];

const countBy = (items, keyFn) => items.reduce((acc, item) => {
  const key = keyFn(item);
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const mapperTableNames = [
  "tags",
  "stats",
  "itemclasses",
  "itemvisualidentity",
  "baseitemtypes",
  "mods",
  "passiveskills",
  "activeskills",
  "grantedeffects",
  "worldareas",
  "monstervarieties",
  "craftingbenchoptions",
  "endgamemaps"
];

const rawTablesFromManifest = (manifest) => (manifest.raw_index || []).map((entry) => {
  const decoded = (manifest.tables || []).find((table) => table.table === entry.table);
  return {
    table_name: entry.table,
    source_path: entry.source_file || "",
    source_kind: `ggpk_datc64_${entry.semantic_status || "raw"}`,
    column_count: decoded?.columns || 0,
    row_count: entry.rows || 0,
    table_hash: entry.hash || entry.row_block_hash || hashJson(entry),
    metadata_json: {
      spec_table: entry.spec_table || entry.table,
      semantic_status: entry.semantic_status || "",
      row_size: entry.row_size ?? null,
      row_block_hash: entry.row_block_hash || ""
    }
  };
});

const columnsFromTables = (tables) => Object.entries(tables).flatMap(([tableName, payload]) =>
  (payload.columns || []).map((column, index) => ({
    table_name: tableName,
    column_name: column.name || `Column${index + 1}`,
    ordinal: column.ordinal || index + 1,
    type_hint: column.type || "",
    raw_json: column
  })));

const rowsFromTables = (tables, rawRowTables = []) => {
  const wanted = new Set(rawRowTables.map((name) => name.toLowerCase()));
  if (wanted.size === 0) return [];
  return Object.entries(tables)
    .filter(([tableName]) => wanted.has(tableName))
    .flatMap(([tableName, payload]) => {
      const seen = new Map();
      return (payload.rows || []).map((row, index) => {
        const baseKey = rowKey(row, index);
        const count = seen.get(baseKey) || 0;
        seen.set(baseKey, count + 1);
        const key = count === 0 ? baseKey : `${baseKey}#${count + 1}`;
        return {
          table_name: tableName,
          row_key: key,
          row_index: index,
          source_path: payload.source_file || `${tableName}.datc64`,
          raw_json: row,
          row_hash: hashJson(row)
        };
      });
    });
};

export const buildGgpkFullSnapshot = async ({
  catalogDir = DEFAULT_GGPK_FULL_CATALOG_DIR,
  inventoryPath = "",
  rawRowTables = []
} = {}) => {
  const resolvedCatalogDir = path.resolve(catalogDir);
  const manifest = await readJson(path.join(resolvedCatalogDir, "catalog-manifest.json"));
  const resolvedInventoryPath = await resolveInventoryPath(resolvedCatalogDir, inventoryPath);
  const inventory = resolvedInventoryPath ? await readJson(resolvedInventoryPath) : null;
  const tablePayloads = {};

  for (const tableName of mapperTableNames) {
    const payload = await loadTablePayload(resolvedCatalogDir, manifest, tableName);
    if (payload) tablePayloads[tableName] = payload;
  }

  const rawTables = rawTablesFromManifest(manifest);
  const rawColumns = columnsFromTables(tablePayloads);
  const rawRows = rowsFromTables(tablePayloads, rawRowTables);
  const normalized = normalizeTables(tablePayloads);
  const failures = [
    ...(manifest.missing_specs || []).map((entry) => ({
      stage: "ggpk_schema_missing",
      source_path: entry.file || "",
      table_name: entry.table || "",
      entity_key: "",
      message: "Missing DAT schema for semantic decode.",
      details_json: entry
    })),
    ...(manifest.failures || []).map((entry) => ({
      stage: "ggpk_parse_failed",
      source_path: entry.file || "",
      table_name: entry.table || "",
      entity_key: "",
      message: entry.message || "DAT parse failed.",
      details_json: entry
    }))
  ];
  const source = {
    kind: "ggpk_full",
    version: manifest.catalog_hash || "unknown",
    label: "GGPK full extracted catalog",
    game_path: "",
    ggpk_path: "",
    pob_path: "",
    pob_commit: ""
  };
  const sourceHash = hashJson({
    catalog_hash: manifest.catalog_hash || "",
    inventory_hash: inventory?.inventory_hash || "",
    raw_tables: rawTables.map((table) => [table.table_name, table.table_hash])
  });
  const extractHash = hashJson({
    raw_tables: rawTables.map((table) => [table.table_name, table.table_hash]),
    raw_rows: rawRows.map((row) => [row.table_name, row.row_key, row.row_hash]),
    entities: normalized.entities.map((entity) => [entity.type, entity.key, entity.source_hash]),
    relations: normalized.relations.map((relation) => relation.relation_hash),
    assets: normalized.assets.map((asset) => [asset.asset_key, asset.kind, asset.content_hash])
  });
  const versionKey = `ggpk_full:${(manifest.catalog_hash || sourceHash).slice(0, 12)}:${extractHash.slice(0, 12)}`;
  const summary = {
    tables: {
      total: rawTables.length,
      decoded: manifest.summary?.parsed_tables || (manifest.tables || []).length,
      raw_only: rawTables.length - (manifest.summary?.parsed_tables || (manifest.tables || []).length)
    },
    rows: {
      decoded_total: manifest.summary?.rows || 0,
      imported_raw_rows: rawRows.length
    },
    columns: {
      total: rawColumns.length
    },
    entities: {
      total: normalized.entities.length,
      by_type: countBy(normalized.entities, (entity) => entity.type)
    },
    relations: {
      total: normalized.relations.length,
      by_type: countBy(normalized.relations, (relation) => relation.relation_type)
    },
    assets: {
      total: normalized.assets.length,
      by_kind: countBy(normalized.assets, (asset) => asset.kind),
      inventory_buckets: Object.fromEntries(Object.entries(inventory?.asset_buckets || {})
        .map(([name, bucket]) => [name, bucket.count || 0]))
    },
    failures: {
      total: failures.length,
      by_stage: countBy(failures, (failure) => failure.stage)
    }
  };

  return {
    generated_at: nowIso(),
    version_key: versionKey,
    source,
    source_hash: sourceHash,
    extract_hash: extractHash,
    raw: {
      tables: rawTables,
      columns: rawColumns,
      rows: rawRows
    },
    entities: normalized.entities,
    relations: normalized.relations,
    assets: normalized.assets,
    entity_assets: normalized.entityAssets,
    failures,
    summary,
    metadata: {
      catalog_dir: normalizeSlash(resolvedCatalogDir),
      inventory_path: normalizeSlash(resolvedInventoryPath),
      catalog_hash: manifest.catalog_hash || "",
      inventory_hash: inventory?.inventory_hash || "",
      mapper_tables: Object.keys(tablePayloads)
    }
  };
};

const insertRecordset = async (client, sql, records, versionId, batchSize) => {
  for (let index = 0; index < records.length; index += batchSize) {
    const batch = records.slice(index, index + batchSize);
    await client.query(sql, [asJsonParam(batch), versionId]);
  }
};

export const importGgpkFullSnapshotPostgres = async (pool, snapshot, {
  batchSize = 1000
} = {}) => withTransaction(pool, async (client) => {
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
    asJsonParam(snapshot.metadata || snapshot.source),
    asJsonParam(snapshot.summary)
  ]);
  const versionId = version.rows[0].id;

  for (const table of [
    "game_dat_tables",
    "game_dat_columns",
    "game_dat_rows",
    "game_entities",
    "game_entity_relations",
    "game_assets",
    "game_entity_assets",
    "game_extractor_failures"
  ]) {
    await client.query(`delete from ${table} where extract_version_id = $1`, [versionId]);
  }

  await insertRecordset(client, `
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
  `, snapshot.raw.tables, versionId, batchSize);

  await insertRecordset(client, `
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
  `, snapshot.raw.columns, versionId, batchSize);

  await insertRecordset(client, `
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
  `, snapshot.raw.rows, versionId, batchSize);

  await insertRecordset(client, `
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
  `, snapshot.entities, versionId, batchSize);

  await insertRecordset(client, `
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
  `, snapshot.relations, versionId, batchSize);

  await insertRecordset(client, `
    insert into game_assets
      (extract_version_id, asset_key, kind, logical_path, source_path, local_path, byte_size,
       content_hash, metadata_json, status)
    select $2, asset_key, kind, logical_path, source_path, local_path, byte_size,
      content_hash, metadata_json, status
    from jsonb_to_recordset($1::jsonb) as payload(
      asset_key text,
      kind text,
      logical_path text,
      source_path text,
      local_path text,
      byte_size bigint,
      content_hash text,
      metadata_json jsonb,
      status text
    )
  `, snapshot.assets, versionId, batchSize);

  await insertRecordset(client, `
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
  `, snapshot.entity_assets, versionId, batchSize);

  await insertRecordset(client, `
    insert into game_extractor_failures
      (extract_version_id, stage, source_path, table_name, entity_key, message, details_json)
    select $2, stage, source_path, table_name, entity_key, message, details_json
    from jsonb_to_recordset($1::jsonb) as payload(
      stage text,
      source_path text,
      table_name text,
      entity_key text,
      message text,
      details_json jsonb
    )
  `, snapshot.failures, versionId, batchSize);

  return {
    version_id: versionId,
    version_key: snapshot.version_key,
    inserted: {
      tables: snapshot.raw.tables.length,
      columns: snapshot.raw.columns.length,
      raw_rows: snapshot.raw.rows.length,
      entities: snapshot.entities.length,
      relations: snapshot.relations.length,
      assets: snapshot.assets.length,
      entity_assets: snapshot.entity_assets.length,
      failures: snapshot.failures.length
    }
  };
});

export const ggpkFullImportSummary = ({ snapshot, database }) => ({
  database,
  source: snapshot.source,
  version_key: snapshot.version_key,
  extract_hash: snapshot.extract_hash,
  summary: snapshot.summary,
  metadata: snapshot.metadata
});

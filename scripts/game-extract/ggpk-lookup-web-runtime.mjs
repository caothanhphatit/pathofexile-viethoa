import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_GGPK_LOOKUP_EXPORT_PATH = path.join(ROOT_DIR, "public", "data", "ggpk-lookup-data.js");

const nowIso = () => new Date().toISOString();
const asArray = (value) => Array.isArray(value) ? value : [];
const normalizeSlash = (value = "") => String(value || "").replace(/\\/g, "/");
const cleanPath = (value = "") => normalizeSlash(value)
  .replace(/^\/+/, "")
  .split("/")
  .filter((part) => part && part !== "." && part !== "..")
  .join("/");
const uniqueSorted = (values) => [...new Set(values.filter(Boolean).map(String))]
  .sort((a, b) => a.localeCompare(b));
const uniquePreserve = (values) => [...new Set(values.filter(Boolean).map(String))];

const entityTypeLabels = {
  active_skill: "Active Skills",
  crafting_recipe: "Crafting Recipes",
  endgame_map: "Endgame Maps",
  granted_effect: "Granted Effects",
  item_base: "Item Bases",
  item_class: "Item Classes",
  item_visual_identity: "Item Visuals",
  mod: "Mods",
  monster_variety: "Monsters",
  passive_node: "Passive Nodes",
  stat: "Stats",
  tag: "Tags",
  world_area: "World Areas"
};

const parseMaybeJson = (value, fallback) => {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

const cleanGameText = (value = "") => String(value || "")
  .replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2")
  .replace(/\[([^\]]+)\]/g, "$1")
  .replace(/\s+/g, " ")
  .trim();

const titleCase = (value = "") => String(value || "")
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .replace(/[_/-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const entityId = (type = "", key = "") => `${type}:${key}`;

const entityLabel = (type = "") => entityTypeLabels[type] || titleCase(type);

const meaningfulText = (value = "") => {
  const cleaned = cleanGameText(value || "");
  if (!cleaned || cleaned === "???") return "";
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : "";
};

const meaningfulTitle = (...values) => {
  for (const value of values) {
    const cleaned = meaningfulText(value);
    if (cleaned) return cleaned;
  }
  return "";
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

const monsterFallbackTitle = (key = "", normalized = {}) => {
  const segments = cleanPath(key || normalized.id || "").split("/").filter(Boolean);
  const monsterSegments = segments[0] === "Metadata" && segments[1] === "Monsters" ? segments.slice(2) : segments;
  const leaf = humanizeIdentifier(monsterSegments.at(-1) || normalized.object_type || key);
  const parent = humanizeIdentifier(monsterSegments.at(-2) || "");
  if (parent && leaf && parent !== leaf) return `${parent} ${leaf}`;
  return leaf || readablePathLeaf(normalized.object_type || key);
};

const typeOrder = (type = "") => [
  "active_skill",
  "granted_effect",
  "stat",
  "mod",
  "item_base",
  "item_class",
  "passive_node",
  "tag",
  "monster_variety",
  "world_area",
  "endgame_map",
  "crafting_recipe",
  "item_visual_identity"
].indexOf(type);

const cleanAsset = (asset) => {
  if (!asset) return null;
  const metadata = parseMaybeJson(asset.metadata_json, {});
  const logicalPath = cleanPath(asset.logical_path || asset.source_path || "");
  if (!asset.asset_key || !logicalPath) return null;
  return {
    key: String(asset.asset_key),
    kind: String(asset.kind || "asset"),
    logical_path: logicalPath,
    source_path: cleanPath(asset.source_path || logicalPath),
    status: String(asset.status || "referenced"),
    byte_size: Number(asset.byte_size || 0),
    content_hash: String(asset.content_hash || ""),
    storage_provider: String(metadata.storage_provider || ""),
    storage_key: String(metadata.storage_key || ""),
    public_url: safeStoredUrl(metadata.public_url || ""),
    conversion_status: String(metadata.conversion_status || ""),
    original_format: String(metadata.original_format || ""),
    converted_format: String(metadata.converted_format || "")
  };
};

const safeStoredUrl = (value = "") => {
  const url = String(value || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url, "https://example.invalid");
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "poe2db.tw" || hostname.endsWith(".poe2db.tw")) return "";
  } catch {
    return "";
  }
  return url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "";
};

const statLabel = (entry) => {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return "";
  const stat = entry.stat || entry.id || "";
  const values = [entry.value, entry.min, entry.max]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(String);
  return values.length ? `${stat} ${values.join("-")}` : stat;
};

const summarizeNormalized = (type, normalized, context = {}) => {
  if (!normalized || typeof normalized !== "object") return "";
  const stats = asArray(normalized.stats).map(statLabel).filter(Boolean).slice(0, 5);
  switch (type) {
    case "active_skill":
      return cleanGameText(normalized.description || normalized.website_description || normalized.short_description || normalized.granted_effect || "");
    case "mod":
      return cleanGameText([
        normalized.name,
        stats.join(", "),
        asArray(normalized.tags).slice(0, 4).join(", ")
      ].filter(Boolean).join(" | "));
    case "stat":
      return cleanGameText([
        normalized.id,
        normalized.semantic != null ? `semantic ${normalized.semantic}` : "",
        normalized.scalable ? "scalable" : "",
        normalized.local ? "local" : ""
      ].filter(Boolean).join(" | "));
    case "item_base":
      return cleanGameText([
        normalized.item_class,
        normalized.drop_level ? `drop ${normalized.drop_level}` : "",
        asArray(normalized.tags).slice(0, 4).join(", "),
        asArray(normalized.implicit_mods).slice(0, 3).join(", ")
      ].filter(Boolean).join(" | "));
    case "passive_node":
      return cleanGameText([
        normalized.notable ? "notable" : "",
        normalized.keystone ? "keystone" : "",
        stats.join(", ")
      ].filter(Boolean).join(" | "));
    case "granted_effect":
      return cleanGameText([
        normalized.active_skill,
        normalized.support ? "support" : "",
        normalized.cast_time ? `cast ${normalized.cast_time}` : ""
      ].filter(Boolean).join(" | "));
    case "world_area":
      return cleanGameText([
        normalized.description,
        normalized.act ? `act ${normalized.act}` : "",
        normalized.area_level ? `level ${normalized.area_level}` : "",
        normalized.endgame ? "endgame" : ""
      ].filter(Boolean).join(" | "));
    case "monster_variety":
      return cleanGameText([
        normalized.object_label || readablePathLeaf(normalized.object_type),
        normalized.life_multiplier ? `life ${normalized.life_multiplier}` : "",
        normalized.damage_multiplier ? `damage ${normalized.damage_multiplier}` : "",
        asArray(normalized.tags).slice(0, 4).join(", ")
      ].filter(Boolean).join(" | "));
    case "crafting_recipe":
      return cleanGameText([
        normalized.description,
        normalized.mod,
        asArray(normalized.cost_items).slice(0, 3).join(", ")
      ].filter(Boolean).join(" | "));
    case "endgame_map":
      return cleanGameText([
        normalized.flavour_text,
        normalized.min_watchstone_tier ? `min tier ${normalized.min_watchstone_tier}` : "",
        context.worldAreaTitle && context.worldAreaTitle !== context.title ? context.worldAreaTitle : ""
      ].filter(Boolean).join(" | "));
    case "item_visual_identity":
      return cleanGameText([normalized.dds_file, normalized.ao_file, normalized.epk_file].filter(Boolean).join(" | "));
    case "item_class":
      return cleanGameText([normalized.name, asArray(normalized.flags).join(", ")].filter(Boolean).join(" | "));
    case "tag":
      return cleanGameText([normalized.display_text, normalized.text, normalized.id].filter(Boolean).join(" | "));
    default:
      return cleanGameText(JSON.stringify(normalized).slice(0, 260));
  }
};

const facetsForRecord = (type, normalized, media) => {
  const facets = [entityLabel(type)];
  if (type === "active_skill") facets.push(normalized.is_gem ? "Gem" : "System");
  if (type === "item_base" && normalized.item_class) facets.push(String(normalized.item_class));
  if (type === "mod" && normalized.level) facets.push(`Level ${normalized.level}`);
  if (type === "world_area" && normalized.area_level) facets.push(`Level ${normalized.area_level}`);
  if (type === "passive_node" && normalized.notable) facets.push("Notable");
  if (type === "passive_node" && normalized.keystone) facets.push("Keystone");
  if (media.icon) facets.push("Has Icon");
  if (media.video) facets.push("Has Video");
  return uniquePreserve(facets);
};

const mediaForRecord = (normalized, linkedAssets) => {
  const iconAsset = linkedAssets.find((entry) => entry.relation_type === "uses_icon")?.asset || null;
  const videoAsset = linkedAssets.find((entry) => entry.relation_type === "uses_video")?.asset || null;
  const icon = cleanPath(normalized.icon || iconAsset?.logical_path || "");
  const video = cleanPath(normalized.video || videoAsset?.logical_path || "");
  return {
    icon,
    video,
    icon_url: safeStoredUrl(iconAsset?.public_url || ""),
    video_url: safeStoredUrl(videoAsset?.public_url || "")
  };
};

const collectSearchValues = (value, output = [], depth = 0) => {
  if (output.length > 80 || depth > 4 || value == null) return output;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    if (text) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSearchValues(item, output, depth + 1);
    return output;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      output.push(key);
      collectSearchValues(item, output, depth + 1);
    }
  }
  return output;
};

const searchTextForRecord = (record) => uniqueSorted([
  record.type,
  record.key,
  record.title,
  record.summary,
  record.source_table,
  ...record.facets,
  ...Object.values(record.media || {}),
  ...collectSearchValues(record.normalized)
]).join(" ").toLowerCase();

export const buildGgpkLookupData = ({
  version = {},
  entities = [],
  relations = [],
  assets = [],
  entityAssets = [],
  generatedAt = nowIso()
} = {}) => {
  const assetIndex = new Map(assets.map(cleanAsset).filter(Boolean).map((asset) => [asset.key, asset]));
  const entityTitleIndex = new Map();
  for (const entity of entities) {
    const type = String(entity.entity_type || entity.type || "");
    const key = String(entity.entity_key || entity.key || "");
    const normalized = parseMaybeJson(entity.normalized_json, {});
    if (!type || !key) continue;
    entityTitleIndex.set(entityId(type, key), meaningfulTitle(normalized.name, entity.display_name, normalized.id, key));
  }
  const entityAssetMap = new Map();
  for (const entry of entityAssets) {
    const key = entityId(entry.entity_type, entry.entity_key);
    if (!entry.entity_type || !entry.entity_key || !entry.asset_key) continue;
    if (!entityAssetMap.has(key)) entityAssetMap.set(key, []);
    entityAssetMap.get(key).push({
      relation_type: entry.relation_type || "uses_asset",
      asset: assetIndex.get(entry.asset_key) || null
    });
  }

  const relationRows = relations.map((relation) => {
    const from = entityId(relation.from_entity_type, relation.from_entity_key);
    const to = entityId(relation.to_entity_type, relation.to_entity_key);
    const data = parseMaybeJson(relation.relation_json, {});
    return {
      type: relation.relation_type,
      from,
      to,
      from_type: relation.from_entity_type,
      from_key: relation.from_entity_key,
      to_type: relation.to_entity_type,
      to_key: relation.to_entity_key,
      ...(data && Object.keys(data).length ? { data } : {})
    };
  });

  const outgoingCount = new Map();
  const incomingCount = new Map();
  const relationCounts = {};
  for (const relation of relationRows) {
    outgoingCount.set(relation.from, (outgoingCount.get(relation.from) || 0) + 1);
    incomingCount.set(relation.to, (incomingCount.get(relation.to) || 0) + 1);
    relationCounts[relation.type] = (relationCounts[relation.type] || 0) + 1;
  }

  const records = entities.map((entity) => {
    const type = String(entity.entity_type || entity.type || "");
    const key = String(entity.entity_key || entity.key || "");
    const normalized = parseMaybeJson(entity.normalized_json, {});
    const id = entityId(type, key);
    const linkedAssets = asArray(entityAssetMap.get(id)).filter((entry) => entry.asset);
    const media = mediaForRecord(normalized, linkedAssets);
    const worldAreaTitle = type === "endgame_map" && normalized.boss_area
      ? entityTitleIndex.get(entityId("world_area", normalized.boss_area)) || ""
      : "";
    const title = meaningfulTitle(
      type === "endgame_map" ? worldAreaTitle : "",
      type === "monster_variety" ? normalized.name : "",
      normalized.name,
      entity.display_name,
      type === "monster_variety" ? monsterFallbackTitle(key, normalized) : "",
      normalized.id,
      key
    );
    const summary = summarizeNormalized(type, normalized, { title, worldAreaTitle });
    const record = {
      id,
      type,
      type_label: entityLabel(type),
      key,
      title,
      summary,
      source_table: entity.source_table || "",
      source_row_key: entity.source_row_key || "",
      source_hash: entity.source_hash || "",
      status: entity.status || "active",
      normalized,
      facets: facetsForRecord(type, normalized, media),
      media,
      asset_keys: linkedAssets.map((entry) => entry.asset.key),
      asset_count: linkedAssets.length,
      relation_count: {
        outgoing: outgoingCount.get(id) || 0,
        incoming: incomingCount.get(id) || 0
      }
    };
    return {
      ...record,
      search_text: searchTextForRecord(record)
    };
  }).sort((a, b) => {
    const typeA = typeOrder(a.type);
    const typeB = typeOrder(b.type);
    if (typeA !== typeB) return (typeA === -1 ? 999 : typeA) - (typeB === -1 ? 999 : typeB);
    return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
  });

  const byType = {};
  for (const record of records) byType[record.type] = (byType[record.type] || 0) + 1;

  const entityTypes = Object.fromEntries(Object.entries(byType)
    .sort(([a], [b]) => entityLabel(a).localeCompare(entityLabel(b)))
    .map(([type, count]) => [type, { label: entityLabel(type), count }]));

  const assetCounts = {};
  for (const asset of assetIndex.values()) assetCounts[asset.kind] = (assetCounts[asset.kind] || 0) + 1;

  return {
    generated_at: generatedAt,
    source: {
      extract_version_id: version.id != null ? String(version.id) : "",
      version_key: version.version_key || "",
      source_kind: version.source_kind || "",
      source_label: version.source_label || "",
      extract_hash: version.extract_hash || "",
      source_hash: version.source_hash || "",
      created_at: version.created_at || ""
    },
    source_summary: parseMaybeJson(version.summary_json, {}),
    counts: {
      by_type: byType,
      assets: assetCounts,
      relations: relationCounts
    },
    entity_types: entityTypes,
    total: records.length,
    records,
    relations: relationRows,
    assets: [...assetIndex.values()].sort((a, b) => a.logical_path.localeCompare(b.logical_path))
  };
};

export const compactGgpkLookupDataForBrowser = (data) => ({
  ...data,
  records: asArray(data.records).map(({ search_text, ...record }) => record),
  relations: asArray(data.relations).map((relation) => ({
    type: relation.type,
    from: relation.from,
    to: relation.to,
    ...(relation.data && Object.keys(relation.data).length ? { data: relation.data } : {})
  })),
  assets: []
});

export const formatGgpkLookupDataScript = (data) =>
  `window.POE2_GGPK_LOOKUP=${JSON.stringify(compactGgpkLookupDataForBrowser(data))};\n`;

export const writeGgpkLookupDataFile = async (data, {
  outputPath = DEFAULT_GGPK_LOOKUP_EXPORT_PATH
} = {}) => {
  const resolvedOutput = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, formatGgpkLookupDataScript(data), "utf8");
  return resolvedOutput;
};

const latestVersionSql = `
  select id, version_key, source_kind, source_label, source_hash, extract_hash, summary_json, created_at
  from game_extract_versions
  where source_kind = 'ggpk_full'
  order by id desc
  limit 1
`;

export const loadLatestGgpkLookupPostgres = async (pool, {
  extractVersionId = ""
} = {}) => {
  const versionResult = extractVersionId
    ? await pool.query(`
      select id, version_key, source_kind, source_label, source_hash, extract_hash, summary_json, created_at
      from game_extract_versions
      where id = $1
      limit 1
    `, [extractVersionId])
    : await pool.query(latestVersionSql);
  const version = versionResult.rows[0];
  if (!version) throw new Error("No ggpk_full extract version found in game_extract_versions");

  const [entityResult, relationResult, assetResult, entityAssetResult] = await Promise.all([
    pool.query(`
      select entity_type, entity_key, display_name, source_table, source_row_key, source_hash, normalized_json, status
      from game_entities
      where extract_version_id = $1
      order by entity_type, display_name, entity_key
    `, [version.id]),
    pool.query(`
      select from_entity_type, from_entity_key, relation_type, to_entity_type, to_entity_key, relation_json
      from game_entity_relations
      where extract_version_id = $1
      order by from_entity_type, from_entity_key, relation_type, to_entity_type, to_entity_key
    `, [version.id]),
    pool.query(`
      select asset_key, kind, logical_path, source_path, byte_size, content_hash, metadata_json, status
      from game_assets
      where extract_version_id = $1
      order by kind, logical_path, asset_key
    `, [version.id]),
    pool.query(`
      select entity_type, entity_key, asset_key, relation_type
      from game_entity_assets
      where extract_version_id = $1
      order by entity_type, entity_key, relation_type, asset_key
    `, [version.id])
  ]);

  return {
    version,
    entities: entityResult.rows,
    relations: relationResult.rows,
    assets: assetResult.rows,
    entityAssets: entityAssetResult.rows
  };
};

export const exportLatestGgpkLookupPostgres = async (pool, options = {}) => {
  const source = await loadLatestGgpkLookupPostgres(pool, options);
  const data = buildGgpkLookupData(source);
  const outputPath = await writeGgpkLookupDataFile(data, options);
  return { data, outputPath };
};

export const ggpkLookupExportSummary = ({ data, outputPath }) => ({
  output: outputPath,
  source: data.source,
  counts: data.counts,
  entity_types: data.entity_types,
  total: data.total
});

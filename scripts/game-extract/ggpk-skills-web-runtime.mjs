import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_GGPK_SKILLS_EXPORT_PATH = path.join(ROOT_DIR, "public", "data", "ggpk-skills-data.js");

const nowIso = () => new Date().toISOString();
const normalizeSlash = (value = "") => String(value || "").replace(/\\/g, "/");
const asArray = (value) => Array.isArray(value) ? value : [];
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
const sourceCategoryLabels = new Map([
  ["activeskills", "Active Skills"]
]);

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
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const sourceCategoryKey = (sourceTable = "") => String(sourceTable || "activeskills")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_/-]+/g, "_")
  .replace(/^_+|_+$/g, "") || "activeskills";

const sourceCategoryLabel = (sourceTable = "") => {
  const key = sourceCategoryKey(sourceTable);
  return sourceCategoryLabels.get(key) || titleCase(key);
};

const cleanAssetPath = (value = "") => normalizeSlash(value)
  .replace(/^\/+/, "")
  .split("/")
  .filter((part) => part && part !== "." && part !== "..")
  .join("/");

const publicWebPath = (localPath = "") => {
  const normalized = cleanAssetPath(localPath);
  if (!normalized) return "";
  const marker = "/public/";
  const markerIndex = normalized.toLowerCase().indexOf(marker);
  if (markerIndex !== -1) return normalized.slice(markerIndex + marker.length);
  if (normalized.toLowerCase().startsWith("public/")) return normalized.slice("public/".length);
  return "";
};

const assetKeyForPath = (logicalPath = "") => `asset:${normalizeSlash(logicalPath)}`;

const browserPath = (webPath = "") => {
  const cleaned = cleanAssetPath(webPath);
  if (!cleaned) return "";
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
};

const cleanPublicUrl = (value = "") => {
  const url = String(value || "").trim();
  if (!url) return "";
  const blockedHosts = ["poe" + "2db.tw"];
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (blockedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return "";
  } catch {
    // Relative URLs are handled below.
  }
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return url;
  return "";
};

const storedAssetUrl = (asset) => cleanPublicUrl(asset?.public_url || asset?.metadata?.public_url || "");

const iconUrlForAsset = (asset) => {
  const storedUrl = storedAssetUrl(asset);
  if (storedUrl) return storedUrl;
  const webPath = asset?.web_path || "";
  if (webPath && /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(webPath)) return browserPath(webPath);
  return "";
};

const videoUrlForAsset = (asset) => {
  const storedUrl = storedAssetUrl(asset);
  if (storedUrl) return storedUrl;
  const webPath = asset?.web_path || "";
  if (webPath && /\.(mp4|ogg|webm)$/i.test(webPath)) return browserPath(webPath);
  return "";
};

const assetFromPath = (logicalPath = "", kind = "asset") => {
  const cleaned = cleanAssetPath(logicalPath);
  if (!cleaned) return null;
  return {
    key: assetKeyForPath(cleaned),
    kind,
    logical_path: cleaned,
    source_path: cleaned,
    local_path: "",
    web_path: "",
    public_url: "",
    storage_provider: "",
    storage_key: "",
    status: "referenced"
  };
};

const normalizeAsset = (asset) => {
  if (!asset) return null;
  const logicalPath = cleanAssetPath(asset.logical_path || asset.source_path || asset.local_path || "");
  if (!logicalPath) return null;
  const metadata = parseMaybeJson(asset.metadata_json, {});
  return {
    key: asset.asset_key || asset.key || assetKeyForPath(logicalPath),
    kind: asset.kind || "asset",
    logical_path: logicalPath,
    source_path: cleanAssetPath(asset.source_path || logicalPath),
    local_path: cleanAssetPath(asset.local_path || ""),
    web_path: publicWebPath(asset.local_path || ""),
    public_url: cleanPublicUrl(asset.public_url || metadata.public_url || ""),
    storage_provider: String(asset.storage_provider || metadata.storage_provider || ""),
    storage_bucket: String(asset.storage_bucket || metadata.storage_bucket || ""),
    storage_key: String(asset.storage_key || metadata.storage_key || ""),
    mime_type: String(asset.mime_type || metadata.mime_type || ""),
    original_format: String(asset.original_format || metadata.original_format || ""),
    converted_format: String(asset.converted_format || metadata.converted_format || ""),
    conversion_status: String(asset.conversion_status || metadata.conversion_status || ""),
    metadata,
    byte_size: Number(asset.byte_size || 0),
    content_hash: asset.content_hash || "",
    status: asset.status || "referenced"
  };
};

const relationKey = (relation) => [
  relation.from_entity_type,
  relation.from_entity_key,
  relation.relation_type,
  relation.to_entity_type,
  relation.to_entity_key
].join("|");

const skillTags = (skill) => {
  const source = [
    skill.description,
    skill.short_description,
    skill.website_description,
    ...asArray(skill.stats)
  ].join(" ");
  const keywords = [
    "Attack",
    "Spell",
    "AoE",
    "Projectile",
    "Melee",
    "Fire",
    "Cold",
    "Lightning",
    "Chaos",
    "Physical",
    "Minion",
    "Buff",
    "Curse",
    "Totem",
    "Trap",
    "Grenade",
    "Flask",
    "Channelling",
    "Trigger"
  ];
  return keywords.filter((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(source));
};

const exportableSkill = (entity) => {
  const normalized = parseMaybeJson(entity.normalized_json, {});
  const name = cleanGameText(normalized.name || entity.display_name || "");
  const description = cleanGameText(normalized.description || normalized.website_description || normalized.short_description || "");
  const icon = cleanAssetPath(normalized.icon || "");
  const video = cleanAssetPath(normalized.video || "");
  if (!name || name === "???") return false;
  return Boolean(description || icon || video || asArray(normalized.stats).length);
};

const entityName = (entity) => {
  const normalized = parseMaybeJson(entity.normalized_json, {});
  return cleanGameText(normalized.name || entity.display_name || entity.entity_key || entity.key || "");
};

export const buildGgpkSkillsData = ({
  version = {},
  entities = [],
  assets = [],
  entityAssets = [],
  relations = [],
  generatedAt = nowIso()
} = {}) => {
  const assetIndex = new Map(assets.map(normalizeAsset).filter(Boolean).map((asset) => [asset.key, asset]));
  const entityAssetMap = new Map();
  for (const entry of entityAssets) {
    if (entry.entity_type && entry.entity_type !== "active_skill") continue;
    const key = String(entry.entity_key || "");
    if (!key) continue;
    if (!entityAssetMap.has(key)) entityAssetMap.set(key, []);
    entityAssetMap.get(key).push(entry);
  }

  const relationMap = new Map();
  for (const relation of relations) {
    if (relation.from_entity_type && relation.from_entity_type !== "active_skill") continue;
    const key = String(relation.from_entity_key || "");
    if (!key) continue;
    if (!relationMap.has(key)) relationMap.set(key, []);
    relationMap.get(key).push(relation);
  }

  const skillEntities = entities.filter((entity) => (entity.entity_type || entity.type || "active_skill") === "active_skill");
  const skills = skillEntities
    .filter(exportableSkill)
    .map((entity) => {
      const normalized = parseMaybeJson(entity.normalized_json, {});
      const key = String(entity.entity_key || entity.key || normalized.id || "");
      const linkedAssets = asArray(entityAssetMap.get(key))
        .map((entry) => ({
          relation_type: entry.relation_type || "uses_asset",
          asset: assetIndex.get(entry.asset_key)
        }))
        .filter((entry) => entry.asset);
      const iconAsset = linkedAssets.find((entry) => entry.relation_type === "uses_icon")?.asset
        || assetFromPath(normalized.icon, "image");
      const videoAsset = linkedAssets.find((entry) => entry.relation_type === "uses_video")?.asset
        || assetFromPath(normalized.video, "video");
      const description = cleanGameText(normalized.description || normalized.website_description || "");
      const shortDescription = cleanGameText(normalized.short_description || description);
      const sourceTable = entity.source_table || "activeskills";
      const sourceCategory = sourceCategoryLabel(sourceTable);
      const skill = {
        slug: key,
        name: entityName(entity),
        description,
        short_description: shortDescription,
        website_description: cleanGameText(normalized.website_description || ""),
        is_gem: Boolean(normalized.is_gem),
        granted_effect: normalized.granted_effect || "",
        source_table: sourceTable,
        source_hash: entity.source_hash || "",
        source_category_key: sourceCategoryKey(sourceTable),
        source_category: sourceCategory,
        stats: uniqueSorted(asArray(normalized.stats).map(String)),
        icon_path: cleanAssetPath(normalized.icon || ""),
        video_path: cleanAssetPath(normalized.video || ""),
        icon_asset: iconAsset || null,
        video_asset: videoAsset || null,
        icon_url: iconUrlForAsset(iconAsset),
        video_url: videoUrlForAsset(videoAsset),
        relations: uniqueSorted(asArray(relationMap.get(key)).map(relationKey)).map((relationId) => {
          const relation = relationMap.get(key).find((entry) => relationKey(entry) === relationId);
          return {
            type: relation.relation_type,
            to_type: relation.to_entity_type,
            to: relation.to_entity_key
          };
        })
      };
      const tags = skillTags(skill);
      return {
        ...skill,
        tags,
        categories: uniqueSorted([sourceCategory, skill.is_gem ? "Gem" : "System", ...tags])
      };
    })
    .sort((a, b) => {
      if (a.is_gem !== b.is_gem) return a.is_gem ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const counts = {
    active_skill_raw: skillEntities.length,
    active_skill_exported: skills.length,
    with_icon: skills.filter((skill) => skill.icon_asset || skill.icon_path).length,
    with_video: skills.filter((skill) => skill.video_asset || skill.video_path).length,
    is_gem: skills.filter((skill) => skill.is_gem).length
  };

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
    counts,
    total: skills.length,
    skills
  };
};

export const formatGgpkSkillsDataScript = (data) =>
  `window.POE2_GGPK_SKILLS = ${JSON.stringify(data, null, 2)};\n`;

export const writeGgpkSkillsDataFile = async (data, {
  outputPath = DEFAULT_GGPK_SKILLS_EXPORT_PATH
} = {}) => {
  const resolvedOutput = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, formatGgpkSkillsDataScript(data), "utf8");
  return resolvedOutput;
};

const latestVersionSql = `
  select id, version_key, source_kind, source_label, source_hash, extract_hash, summary_json, created_at
  from game_extract_versions
  where source_kind = 'ggpk_full'
  order by id desc
  limit 1
`;

export const loadLatestGgpkSkillsPostgres = async (pool, {
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

  const [entityResult, assetResult, relationResult] = await Promise.all([
    pool.query(`
      select entity_type, entity_key, display_name, source_table, source_hash, normalized_json
      from game_entities
      where extract_version_id = $1
        and entity_type = 'active_skill'
      order by display_name, entity_key
    `, [version.id]),
    pool.query(`
      select
        ea.entity_type,
        ea.entity_key,
        ea.asset_key,
        ea.relation_type,
        a.kind,
        a.logical_path,
        a.source_path,
        a.local_path,
        a.byte_size,
        a.content_hash,
        a.metadata_json,
        a.status
      from game_entity_assets ea
      join game_assets a
        on a.extract_version_id = ea.extract_version_id
       and a.asset_key = ea.asset_key
      where ea.extract_version_id = $1
        and ea.entity_type = 'active_skill'
      order by ea.entity_key, ea.relation_type, ea.asset_key
    `, [version.id]),
    pool.query(`
      select from_entity_type, from_entity_key, relation_type, to_entity_type, to_entity_key
      from game_entity_relations
      where extract_version_id = $1
        and from_entity_type = 'active_skill'
      order by from_entity_key, relation_type, to_entity_type, to_entity_key
    `, [version.id])
  ]);

  const assetsByKey = new Map();
  const entityAssets = [];
  for (const row of assetResult.rows) {
    assetsByKey.set(row.asset_key, {
      asset_key: row.asset_key,
      kind: row.kind,
      logical_path: row.logical_path,
      source_path: row.source_path,
      local_path: row.local_path,
      byte_size: row.byte_size,
      content_hash: row.content_hash,
      metadata_json: row.metadata_json,
      status: row.status
    });
    entityAssets.push({
      entity_type: row.entity_type,
      entity_key: row.entity_key,
      asset_key: row.asset_key,
      relation_type: row.relation_type
    });
  }

  return {
    version,
    entities: entityResult.rows,
    assets: [...assetsByKey.values()],
    entityAssets,
    relations: relationResult.rows
  };
};

export const exportLatestGgpkSkillsPostgres = async (pool, options = {}) => {
  const source = await loadLatestGgpkSkillsPostgres(pool, options);
  const data = buildGgpkSkillsData(source);
  const outputPath = await writeGgpkSkillsDataFile(data, options);
  return { data, outputPath };
};

export const ggpkSkillsExportSummary = ({ data, outputPath }) => ({
  output: outputPath,
  source: data.source,
  counts: data.counts,
  total: data.total
});

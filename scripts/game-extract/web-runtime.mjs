import fs from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_OUTPUT_DIR,
  hashJson,
  loadSnapshotFile,
  stableJson
} from "./runtime.mjs";

export const DEFAULT_WEB_OUTPUT_DIR = path.join(path.dirname(DEFAULT_OUTPUT_DIR), "web");

const PRODUCT_FILES = {
  planner: "planner.json",
  items: "items.json",
  skills: "skills.json",
  mods: "mods.json",
  calculator: "calculator-seeds.json"
};

const normalizeSlash = (value = "") => String(value).replace(/\\/g, "/");
const asArray = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values.filter((value) => value != null && value !== ""))];
const sortText = (values) => [...values].sort((a, b) => String(a).localeCompare(String(b)));
const sortBy = (items, keyFn) => [...items].sort((a, b) => String(keyFn(a)).localeCompare(String(keyFn(b))));
const byType = (snapshot, type) => (snapshot.entities || []).filter((entity) => entity.type === type);

const safeWebPath = (value = "") => {
  const normalized = normalizeSlash(value).replace(/^\/+/, "");
  if (!normalized) return "";
  if (/^[A-Za-z]:\//.test(normalized) || normalized.includes("Program Files")) {
    return path.posix.basename(normalized);
  }
  return normalized.split("/").filter((part) => part && part !== "." && part !== "..").join("/");
};

const productSource = (snapshot) => ({
  version_key: snapshot.version_key,
  extract_hash: snapshot.extract_hash,
  kind: snapshot.source?.kind || "unknown",
  version: snapshot.source?.version || "",
  label: snapshot.source?.label || "",
  source_kind: snapshot.source?.kind || "unknown",
  source_version: snapshot.source?.version || "",
  source_label: snapshot.source?.label || "",
  pob_commit: snapshot.source?.pob_commit || ""
});

const productParity = (snapshot, productKey, gaps = []) => ({
  status: snapshot.source?.kind === "pob_upstream" ? "pob_backed_unverified" : "fixture_verified",
  upstream: snapshot.source?.kind || "unknown",
  product_key: productKey,
  gaps
});

const relationKey = (relation) => [
  relation.from_entity_type,
  relation.from_entity_key,
  relation.relation_type,
  relation.to_entity_type,
  relation.to_entity_key
].join("|");

const buildAssetIndex = (snapshot) => new Map((snapshot.assets || []).map((asset) => [
  asset.asset_key,
  {
    key: asset.asset_key,
    kind: asset.kind || "asset",
    path: safeWebPath(asset.local_path || asset.logical_path || asset.source_path),
    logical_path: safeWebPath(asset.logical_path || asset.source_path),
    byte_size: asset.byte_size || 0,
    hash: asset.content_hash || "",
    status: asset.status || "active"
  }
]));

const passiveNodeIconAsset = (snapshot, nodeEntity, assetIndex) => {
  const direct = (snapshot.entity_assets || []).find((entry) =>
    entry.entity_type === "passive_node" && entry.entity_key === nodeEntity.key);
  if (direct && assetIndex.has(direct.asset_key)) return direct.asset_key;
  const icon = nodeEntity.normalized_json?.icon || "";
  if (!icon) return "";
  const logical = safeWebPath(icon);
  const matched = [...assetIndex.values()].find((asset) => asset.logical_path === logical || asset.path === logical);
  return matched?.key || "";
};

const buildPlannerProduct = (snapshot) => {
  const assetIndex = buildAssetIndex(snapshot);
  const passiveNodes = sortBy(byType(snapshot, "passive_node"), (entity) => entity.key);
  const nodes = passiveNodes.map((entity) => {
    const normalized = entity.normalized_json || {};
    const assetKey = passiveNodeIconAsset(snapshot, entity, assetIndex);
    return {
      id: entity.key,
      name: entity.display_name || normalized.name || entity.key,
      type: normalized.node_type || "small",
      stats: asArray(normalized.stats),
      icon_asset_key: assetKey,
      position: {
        group: normalized.group || "",
        orbit: normalized.orbit || 0,
        orbit_index: normalized.orbit_index || 0
      }
    };
  });
  const edges = sortBy((snapshot.relations || [])
    .filter((relation) =>
      relation.from_entity_type === "passive_node" &&
      relation.to_entity_type === "passive_node" &&
      relation.relation_type === "connects_to")
    .map((relation) => ({
      from: relation.from_entity_key,
      to: relation.to_entity_key
    })), (edge) => `${edge.from}:${edge.to}`);
  const stats = sortText(unique(nodes.flatMap((node) => node.stats)));
  const assets = sortBy([...assetIndex.values()].filter((asset) =>
    asset.kind.includes("passive") || nodes.some((node) => node.icon_asset_key === asset.key)), (asset) => asset.key);

  return {
    classes: [],
    ascendancies: [],
    nodes,
    edges,
    stats,
    assets
  };
};

const weightPairs = (mod) => {
  const keys = asArray(mod.weight_keys);
  const values = asArray(mod.weight_values);
  return keys.map((key, index) => ({
    key,
    weight: Number(values[index] ?? 0)
  }));
};

const buildItemsProduct = (snapshot, mods) => {
  const bases = sortBy(byType(snapshot, "item_base").map((entity) => {
    const normalized = entity.normalized_json || {};
    return {
      id: entity.key,
      name: entity.display_name || normalized.name || entity.key,
      base_type_name: normalized.base_type_name || "",
      item_type: normalized.item_type || "",
      tags: sortText(asArray(normalized.tags)),
      requirements: normalized.requirements || {},
      properties: normalized.properties || {},
      weapon: normalized.weapon || {},
      armour: normalized.armour || {},
      implicit: normalized.implicit || ""
    };
  }), (base) => base.id);
  const itemClasses = sortText(unique(bases.map((base) => base.item_type)));
  const spawnableMods = sortBy(bases.flatMap((base) => mods.flatMap((mod) =>
    weightPairs(mod).filter((entry) => entry.weight > 0 && base.tags.includes(entry.key)).map((entry) => ({
      base_id: base.id,
      mod_id: mod.id,
      weight_key: entry.key,
      weight: entry.weight
    })))), (entry) => `${entry.base_id}:${entry.mod_id}:${entry.weight_key}`);

  return {
    item_classes: itemClasses,
    bases,
    spawnable_mods: spawnableMods
  };
};

const buildSkillsProduct = (snapshot) => {
  const gems = sortBy(byType(snapshot, "skill_gem").map((entity) => {
    const normalized = entity.normalized_json || {};
    const raw = entity.raw_json || {};
    return {
      id: entity.key,
      name: entity.display_name || normalized.name || entity.key,
      base_type_name: normalized.base_type_name || "",
      variant_id: normalized.variant_id || "",
      granted_effect_id: normalized.granted_effect_id || "",
      gem_type: normalized.gem_type || "",
      tags: sortText(asArray(normalized.tags)),
      requirements: normalized.requirements || {},
      tier: normalized.tier || 0,
      natural_max_level: normalized.natural_max_level || 0,
      levels: [],
      description: raw.tagString || ""
    };
  }), (gem) => gem.id);
  const relations = sortBy((snapshot.relations || [])
    .filter((relation) => relation.from_entity_type === "skill_gem")
    .map((relation) => ({
      from: relation.from_entity_key,
      type: relation.relation_type,
      to_type: relation.to_entity_type,
      to: relation.to_entity_key
    })), (relation) => `${relation.from}:${relation.type}:${relation.to}`);

  return {
    gems,
    active_gems: gems.filter((gem) => !gem.tags.includes("support")),
    supports: gems.filter((gem) => gem.tags.includes("support")),
    relations
  };
};

export const parseModStatLine = (text = "") => {
  const source = String(text || "").trim();
  if (!source) {
    return {
      status: "missing_text",
      text: "",
      template: "",
      values: [],
      keywords: []
    };
  }

  const values = [];
  const template = source.replace(/\((-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\)|(-?\d+(?:\.\d+)?)/g, (match, min, max, single) => {
    if (single != null) {
      values.push({ raw: match, value: Number(single) });
    } else {
      values.push({ raw: match, min: Number(min), max: Number(max) });
    }
    return "#";
  });
  const keywords = ["Fire", "Cold", "Lightning", "Physical", "Chaos", "Damage", "Life", "Mana", "Energy Shield"]
    .filter((keyword) => new RegExp(`\\b${keyword.replace(/\s+/g, "\\s+")}\\b`, "i").test(source));
  return {
    status: "parsed",
    text: source,
    template,
    values,
    keywords
  };
};

const buildModsProduct = (snapshot) => {
  const parserFailures = [];
  const mods = sortBy(byType(snapshot, "mod").map((entity) => {
    const normalized = entity.normalized_json || {};
    const parsed = parseModStatLine(normalized.text);
    if (parsed.status !== "parsed") {
      parserFailures.push({
        mod_id: entity.key,
        reason: parsed.status
      });
    }
    return {
      id: entity.key,
      type: normalized.mod_type || "",
      affix: normalized.affix || entity.display_name || "",
      level: normalized.level || 0,
      group: normalized.group || "",
      tags: sortText(asArray(normalized.tags)),
      weight_keys: asArray(normalized.weight_keys),
      weight_values: asArray(normalized.weight_values),
      text: normalized.text || "",
      parsed_stats: parsed.status === "parsed" ? [parsed] : []
    };
  }), (mod) => mod.id);

  return {
    mods,
    parser_failures: sortBy(parserFailures, (failure) => failure.mod_id)
  };
};

const pushMapValue = (target, key, value) => {
  if (!target[key]) target[key] = [];
  target[key].push(value);
};

const buildCalculatorProduct = (items, skills, mods) => {
  const byId = {};
  const byGroup = {};
  const byTag = {};
  const spawnWeights = [];
  const statTextIndex = {};

  for (const mod of mods.mods) {
    byId[mod.id] = {
      type: mod.type,
      affix: mod.affix,
      group: mod.group,
      level: mod.level,
      text: mod.text,
      parsed_stats: mod.parsed_stats,
      tags: mod.tags
    };
    if (mod.group) pushMapValue(byGroup, mod.group, mod.id);
    for (const tag of mod.tags) pushMapValue(byTag, tag, mod.id);
    for (const pair of weightPairs({ weight_keys: mod.weight_keys, weight_values: mod.weight_values })) {
      spawnWeights.push({ mod_id: mod.id, ...pair });
    }
    for (const parsed of mod.parsed_stats) {
      if (parsed.template) pushMapValue(statTextIndex, parsed.template, mod.id);
    }
  }

  const sortMapLists = (map) => Object.fromEntries(Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => [key, sortText(unique(values))]));

  return {
    mod_cache: {
      by_id: Object.fromEntries(Object.entries(byId).sort(([a], [b]) => a.localeCompare(b))),
      by_group: sortMapLists(byGroup),
      by_tag: sortMapLists(byTag),
      spawn_weights: sortBy(spawnWeights, (entry) => `${entry.mod_id}:${entry.key}`)
    },
    item_base_index: Object.fromEntries(items.bases.map((base) => [base.id, {
      name: base.name,
      type: base.item_type,
      tags: base.tags
    }])),
    skill_gem_index: Object.fromEntries(skills.gems.map((gem) => [gem.id, {
      name: gem.name,
      granted_effect_id: gem.granted_effect_id,
      tags: gem.tags
    }])),
    stat_text_index: sortMapLists(statTextIndex)
  };
};

const countProduct = (key, product) => {
  if (key === "planner") {
    return {
      classes: product.classes.length,
      ascendancies: product.ascendancies.length,
      nodes: product.nodes.length,
      edges: product.edges.length,
      assets: product.assets.length,
      stats: product.stats.length
    };
  }
  if (key === "items") {
    return {
      bases: product.bases.length,
      item_classes: product.item_classes.length,
      spawnable_mods: product.spawnable_mods.length
    };
  }
  if (key === "skills") {
    return {
      gems: product.gems.length,
      active_gems: product.active_gems.length,
      supports: product.supports.length,
      relations: product.relations.length
    };
  }
  if (key === "mods") {
    return {
      mods: product.mods.length,
      parsed_stats: product.mods.reduce((sum, mod) => sum + mod.parsed_stats.length, 0),
      parser_failures: product.parser_failures.length
    };
  }
  return {
    mods: Object.keys(product.mod_cache.by_id).length,
    groups: Object.keys(product.mod_cache.by_group).length,
    tags: Object.keys(product.mod_cache.by_tag).length,
    spawn_weights: product.mod_cache.spawn_weights.length,
    stat_templates: Object.keys(product.stat_text_index).length
  };
};

const wrapProduct = ({ key, generatedAt, source, parity, payload }) => {
  const counts = countProduct(key, payload);
  const productHash = hashJson({ key, source, parity, counts, payload });
  return {
    generated_at: generatedAt,
    product_key: key,
    product_hash: productHash,
    source,
    parity,
    counts,
    ...payload
  };
};

export const buildWebDataBundle = (snapshot) => {
  const generatedAt = new Date().toISOString();
  const source = productSource(snapshot);
  const plannerPayload = buildPlannerProduct(snapshot);
  const modsPayload = buildModsProduct(snapshot);
  const itemsPayload = buildItemsProduct(snapshot, modsPayload.mods);
  const skillsPayload = buildSkillsProduct(snapshot);
  const calculatorPayload = buildCalculatorProduct(itemsPayload, skillsPayload, modsPayload);
  const payloads = {
    planner: plannerPayload,
    items: itemsPayload,
    skills: skillsPayload,
    mods: modsPayload,
    calculator: calculatorPayload
  };
  const gaps = {
    planner: plannerPayload.classes.length || plannerPayload.ascendancies.length ? [] : ["class_and_ascendancy_payload_pending"],
    items: [],
    skills: skillsPayload.gems.some((gem) => gem.levels.length) ? [] : ["gem_level_payload_pending"],
    mods: modsPayload.parser_failures.length ? ["mod_parser_failures_present"] : [],
    calculator: ["full_pob_calculator_parity_pending"]
  };
  const products = Object.fromEntries(Object.entries(payloads).map(([key, payload]) => [key, wrapProduct({
    key,
    generatedAt,
    source,
    parity: productParity(snapshot, key, gaps[key]),
    payload
  })]));
  const productSummaries = Object.entries(products).map(([key, product]) => ({
    key,
    kind: key === "calculator" ? "calculator_seed" : "web_data",
    file: PRODUCT_FILES[key],
    hash: product.product_hash,
    counts: product.counts,
    parity: product.parity
  }));
  const generationHash = hashJson(productSummaries.map((product) => ({
    key: product.key,
    hash: product.hash
  })));

  return {
    generated_at: generatedAt,
    source,
    generation_hash: generationHash,
    manifest: {
      generated_at: generatedAt,
      source,
      generation_hash: generationHash,
      products: productSummaries
    },
    products
  };
};

export const writeWebDataProducts = async (bundle, {
  outputDir = DEFAULT_WEB_OUTPUT_DIR
} = {}) => {
  const resolvedOutput = path.resolve(outputDir);
  await fs.mkdir(resolvedOutput, { recursive: true });
  const productPaths = {};
  for (const [key, product] of Object.entries(bundle.products)) {
    const file = PRODUCT_FILES[key];
    const outputPath = path.join(resolvedOutput, file);
    await fs.writeFile(outputPath, `${JSON.stringify(product, null, 2)}\n`, "utf8");
    productPaths[key] = outputPath;
  }
  const manifestPath = path.join(resolvedOutput, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(bundle.manifest, null, 2)}\n`, "utf8");
  return {
    outputDir: resolvedOutput,
    manifestPath,
    productPaths
  };
};

export const loadSnapshotForWebExport = async (snapshotPath) => loadSnapshotFile(snapshotPath);

export const webOutputSummary = ({ bundle, output }) => ({
  source: bundle.source,
  generation_hash: bundle.generation_hash,
  products: Object.fromEntries(Object.entries(bundle.products).map(([key, product]) => [key, {
    hash: product.product_hash,
    counts: product.counts,
    parity: product.parity.status
  }])),
  output: {
    dir: output.outputDir,
    manifest: output.manifestPath,
    products: output.productPaths
  },
  bytes: Buffer.byteLength(stableJson(bundle.products), "utf8")
});

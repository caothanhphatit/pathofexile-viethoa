import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closePool, createPool, withTransaction } from "../../src/db/pool.mjs";
import {
  buildI18nList,
  collectPassiveTreeContentStrings,
  loadTranslationLookup,
  parseLocales,
  upsertContentStrings
} from "../../src/localization/content-strings.mjs";
import {
  normalizePassiveTree,
  selectLatestPassiveTreePath
} from "./passive-tree-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const EXPORT_PATH = path.join(ROOT_DIR, "public/data/passive-tree-data.js");
export const DEFAULT_REPO = "PathOfBuildingCommunity/PathOfBuilding-PoE2";
export const DEFAULT_REF = "dev";
export const DEFAULT_SOURCE_URL = `https://github.com/${DEFAULT_REPO}/tree/${DEFAULT_REF}/src/TreeData`;

const nowIso = () => new Date().toISOString();
const jsonParam = (value) => JSON.stringify(value ?? null);
const normalizeText = (value = "") => String(value)
  .replace(/\u00a0/g, " ")
  .replace(/[ \t\r\n]+/g, " ")
  .trim();
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
const hiddenPassiveClasses = new Set(["Marauder"]);
const isVisiblePassiveClass = (name = "") => !hiddenPassiveClasses.has(normalizeText(name));
const cleanPassiveClassStarts = (values = []) => (Array.isArray(values) ? values : [])
  .map(normalizeText)
  .filter((name) => name && isVisiblePassiveClass(name));
const passiveNodeStats = (node = {}) => {
  const stats = Array.isArray(node.stats) ? node.stats : parseMaybeJson(node.stats_json, []);
  return (Array.isArray(stats) ? stats : []).map(normalizeText).filter(Boolean);
};
const isPassiveMasteryExportNode = (node = {}) =>
  Boolean(node.is_mastery || node.isMastery || String(node.type || "").includes("mastery") || /mastery/i.test(node.name || ""));
const shouldKeepPassiveExportNode = (node = {}) => {
  const stats = passiveNodeStats(node);
  if (isPassiveMasteryExportNode(node) && !stats.length) return false;
  return Boolean(normalizeText(node.name) || stats.length || normalizeText(node.icon || node.icon_path));
};
const passiveExportNodeName = (node = {}, classStarts = cleanPassiveClassStarts(node.classes_start)) => {
  const name = String(node.name ?? "");
  return name.trim().toLowerCase() === "marauder" && classStarts.length === 1 ? classStarts[0].toUpperCase() : name;
};
const cleanPassiveClasses = (classes = []) => (Array.isArray(classes) ? classes : [])
  .filter((row) => isVisiblePassiveClass(row?.name))
  .map((row) => ({
    ...row,
    name: row.name || ""
  }));

const rawUrlForPath = ({ repo = DEFAULT_REPO, ref = DEFAULT_REF, treePath }) =>
  `https://raw.githubusercontent.com/${repo}/${ref}/${treePath}`;

const sourceJson = (node) => ({
  id: node.node_id || node.id,
  tree_version: node.tree_version,
  name: node.name,
  type: node.type,
  group: node.group_id || node.group,
  orbit: node.orbit,
  orbit_index: node.orbit_index,
  arc: Number(node.arc || 0),
  x: Number(node.x),
  y: Number(node.y),
  icon: node.icon,
  icon_path: node.icon_path || "",
  classes_start: node.classes_start || parseMaybeJson(node.raw_json, {})?.classesStart || [],
  is_class_start: Boolean(node.is_class_start || parseMaybeJson(node.raw_json, {})?.classesStart?.length),
  ascendancy_name: node.ascendancy_name,
  is_ascendancy_start: Boolean(node.is_ascendancy_start),
  is_mastery: Boolean(node.is_mastery),
  stats: node.stats || parseMaybeJson(node.stats_json, []),
  recipe: node.recipe || parseMaybeJson(node.recipe_json, []),
  source_hash: node.source_hash
});

export const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const fetchJson = async (url, headers = {}) => {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "poe2-vietnamese-passive-tree-crawler/1.0",
      ...headers
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.json();
};

export const discoverLatestPassiveTreeSource = async ({
  repo = DEFAULT_REPO,
  ref = DEFAULT_REF
} = {}) => {
  const treeApiUrl = `https://api.github.com/repos/${repo}/contents/src/TreeData?ref=${encodeURIComponent(ref)}`;
  const payload = await fetchJson(treeApiUrl);
  const latest = selectLatestPassiveTreePath((payload || [])
    .filter((entry) => entry.type === "dir")
    .map((entry) => `src/TreeData/${entry.name}/tree.json`));
  return {
    repo,
    ref,
    version: latest.version,
    path: latest.path,
    source_url: rawUrlForPath({ repo, ref, treePath: latest.path }),
    commit_sha: ""
  };
};

export const readPassiveTreeSource = async ({
  repo = DEFAULT_REPO,
  ref = DEFAULT_REF,
  treePath,
  jsonPath
} = {}) => {
  if (jsonPath) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(ROOT_DIR, jsonPath), "utf8"));
    const normalizedJsonPath = String(jsonPath).replace(/\\/g, "/");
    const version = treePath?.match(/TreeData\/([^/]+)\//)?.[1] ||
      normalizedJsonPath.match(/TreeData\/([^/]+)\//)?.[1] ||
      raw.version ||
      raw.tree ||
      "local";
    return {
      raw,
      source: {
        repo,
        ref,
        version,
        path: treePath || jsonPath,
        source_url: path.resolve(ROOT_DIR, jsonPath),
        commit_sha: ""
      }
    };
  }

  const source = treePath
    ? {
      repo,
      ref,
      version: treePath.match(/TreeData\/([^/]+)\//)?.[1]?.replace(/_/g, ".") || String(ref || "").replace(/^v/i, "") || "unknown",
      path: treePath,
      source_url: rawUrlForPath({ repo, ref, treePath }),
      commit_sha: ""
    }
    : await discoverLatestPassiveTreeSource({ repo, ref });

  return {
    raw: await fetchJson(source.source_url),
    source
  };
};

export const crawlPassiveTreeData = async (options = {}) => {
  const { raw, source } = await readPassiveTreeSource(options);
  return normalizePassiveTree(raw, {
    treeVersion: source.version,
    sourceUrl: source.source_url,
    sourceRef: source.ref
  });
};

const requirePostgresConfig = () => {
  if (!process.env.POE2_DATABASE_URL) throw new Error("Missing POE2_DATABASE_URL");
};

export const runPassiveTreeWithPostgres = async (callback) => {
  requirePostgresConfig();
  const pool = createPool();
  try {
    return await callback(pool);
  } finally {
    await closePool(pool);
  }
};

export const upsertPassiveTreePostgres = async (pool, tree, {
  sourceUrl = tree.source_url || DEFAULT_SOURCE_URL,
  sourcePath = "",
  sourceRef = tree.source_ref || DEFAULT_REF,
  markRemoved = true
} = {}) => withTransaction(pool, async (client) => {
  const run = await client.query(`
    insert into crawl_runs (kind, source_url, total_count, metadata)
    values ('passive_tree', $1, $2, $3::jsonb)
    returning id
  `, [sourceUrl, tree.nodes.length, jsonParam({ tree_version: tree.version, source_ref: sourceRef, source_path: sourcePath })]);
  const runId = run.rows[0].id;

  await client.query("update passive_tree_versions set status = 'inactive', updated_at = now() where status = 'active' and source_hash <> $1", [tree.source_hash]);
  await client.query(`
    insert into passive_tree_versions
      (tree_version, tree_name, source_ref, source_path, source_url, source_hash,
       class_count, group_count, node_count, edge_count, bounds_json, classes_json,
       groups_json, constants_json,
       status, crawl_run_id, updated_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, 'active', $15, now())
    on conflict (source_hash) do update
    set status = 'active',
        crawl_run_id = excluded.crawl_run_id,
        class_count = excluded.class_count,
        group_count = excluded.group_count,
        node_count = excluded.node_count,
        edge_count = excluded.edge_count,
        bounds_json = excluded.bounds_json,
        classes_json = excluded.classes_json,
        groups_json = excluded.groups_json,
        constants_json = excluded.constants_json,
        updated_at = now()
  `, [
    tree.version,
    tree.tree,
    sourceRef,
    sourcePath,
    sourceUrl,
    tree.source_hash,
    tree.counts.classes,
    tree.counts.groups,
    tree.counts.nodes,
    tree.counts.edges,
    jsonParam(tree.bounds),
    jsonParam(tree.classes),
    jsonParam(tree.groups),
    jsonParam({
      ...tree.constants,
      scaleImage: tree.scale_image,
      treeSize: tree.tree_size
    }),
    runId
  ]);

  const nodeIds = tree.nodes.map((node) => node.id);
  const existingRows = nodeIds.length
    ? await client.query("select * from passive_tree_nodes where node_id = any($1::text[])", [nodeIds])
    : { rows: [] };
  const existingById = new Map(existingRows.rows.map((row) => [row.node_id, row]));
  const summary = { total: tree.nodes.length, new: 0, changed: 0, unchanged: 0, removed: 0 };
  const versionPayload = [];

  for (const node of tree.nodes) {
    const existing = existingById.get(node.id);
    if (!existing) summary.new += 1;
    else if (existing.source_hash === node.source_hash) summary.unchanged += 1;
    else {
      summary.changed += 1;
      versionPayload.push({
        node_id: node.id,
        previous_hash: existing.source_hash,
        next_hash: node.source_hash,
        previous_json: sourceJson(existing),
        next_json: sourceJson(node)
      });
    }
  }

  if (versionPayload.length) {
    await client.query(`
      insert into passive_tree_node_versions
        (node_id, previous_hash, next_hash, previous_json, next_json, run_id, changed_at)
      select node_id, previous_hash, next_hash, previous_json, next_json, $2, now()
      from jsonb_to_recordset($1::jsonb) as payload(
        node_id text,
        previous_hash text,
        next_hash text,
        previous_json jsonb,
        next_json jsonb
      )
    `, [jsonParam(versionPayload), runId]);
  }

  if (tree.nodes.length) {
    const nodePayload = tree.nodes.map((node) => ({
      node_id: node.id,
      tree_version: tree.version,
      name: node.name,
      type: node.type,
      group_id: node.group,
      orbit: node.orbit,
      orbit_index: node.orbit_index,
      arc: node.arc,
      x: node.x,
      y: node.y,
      icon: node.icon,
      icon_path: node.icon_path,
      ascendancy_name: node.ascendancy_name,
      is_ascendancy_start: node.is_ascendancy_start,
      is_mastery: node.is_mastery,
      stats_json: node.stats,
      recipe_json: node.recipe,
      raw_json: node.raw,
      source_hash: node.source_hash
    }));

    await client.query(`
      insert into passive_tree_nodes
        (node_id, tree_version, name, type, group_id, orbit, orbit_index, arc, x, y,
         icon, icon_path, ascendancy_name, is_ascendancy_start, is_mastery,
         stats_json, recipe_json, raw_json, source_hash,
         status, first_seen_run_id, last_seen_run_id, updated_at)
      select node_id, tree_version, name, type, group_id, orbit, orbit_index, arc, x, y,
        icon, icon_path, ascendancy_name, is_ascendancy_start, is_mastery,
        stats_json, recipe_json, raw_json, source_hash,
        'active', $2, $2, now()
      from jsonb_to_recordset($1::jsonb) as payload(
        node_id text,
        tree_version text,
        name text,
        type text,
        group_id text,
        orbit integer,
        orbit_index integer,
        arc numeric,
        x numeric,
        y numeric,
        icon text,
        icon_path text,
        ascendancy_name text,
        is_ascendancy_start boolean,
        is_mastery boolean,
        stats_json jsonb,
        recipe_json jsonb,
        raw_json jsonb,
        source_hash text
      )
      on conflict (node_id) do update
      set tree_version = excluded.tree_version,
          name = excluded.name,
          type = excluded.type,
          group_id = excluded.group_id,
          orbit = excluded.orbit,
          orbit_index = excluded.orbit_index,
          arc = excluded.arc,
          x = excluded.x,
          y = excluded.y,
          icon = excluded.icon,
          icon_path = excluded.icon_path,
          ascendancy_name = excluded.ascendancy_name,
          is_ascendancy_start = excluded.is_ascendancy_start,
          is_mastery = excluded.is_mastery,
          stats_json = excluded.stats_json,
          recipe_json = excluded.recipe_json,
          raw_json = excluded.raw_json,
          source_hash = excluded.source_hash,
          status = 'active',
          last_seen_run_id = excluded.last_seen_run_id,
          updated_at = now()
    `, [jsonParam(nodePayload), runId]);
  }

  await upsertContentStrings(
    client,
    tree.nodes.flatMap((node) => collectPassiveTreeContentStrings({ ...node, source_url: sourceUrl })),
    { runId }
  );

  if (tree.edges.length) {
    await client.query(`
      insert into passive_tree_edges
        (from_node_id, to_node_id, tree_version, orbit, status, first_seen_run_id, last_seen_run_id, updated_at)
      select from_node_id, to_node_id, $2, orbit, 'active', $3, $3, now()
      from jsonb_to_recordset($1::jsonb) as payload(
        from_node_id text,
        to_node_id text,
        orbit integer
      )
      on conflict (from_node_id, to_node_id) do update
      set tree_version = excluded.tree_version,
          orbit = excluded.orbit,
          status = 'active',
          last_seen_run_id = excluded.last_seen_run_id,
          updated_at = now()
    `, [jsonParam(tree.edges.map((edge) => ({
      from_node_id: edge.from,
      to_node_id: edge.to,
      orbit: edge.orbit
    }))), tree.version, runId]);
  }

  if (markRemoved) {
    if (nodeIds.length) {
      const removed = await client.query(`
        update passive_tree_nodes
        set status = 'removed',
            last_seen_run_id = $1,
            updated_at = now()
        where status = 'active'
          and not (node_id = any($2::text[]))
        returning node_id
      `, [runId, nodeIds]);
      summary.removed = removed.rowCount || 0;
    }

    const edgeKeys = tree.edges.map((edge) => `${edge.from}:${edge.to}`);
    if (edgeKeys.length) {
      await client.query(`
        update passive_tree_edges
        set status = 'removed',
            last_seen_run_id = $1,
            updated_at = now()
        where status = 'active'
          and not ((from_node_id || ':' || to_node_id) = any($2::text[]))
      `, [runId, edgeKeys]);
    }
  }

  await client.query(`
    update crawl_runs
    set status = 'completed',
        finished_at = clock_timestamp(),
        total_count = $2,
        new_count = $3,
        changed_count = $4,
        unchanged_count = $5,
        removed_count = $6
    where id = $1
  `, [runId, summary.total, summary.new, summary.changed, summary.unchanged, summary.removed]);

  return summary;
});

export const exportPassiveTreePostgres = async (pool) => {
  const locales = parseLocales();
  const [versionRows, nodeRows, edgeRows, localizationLookup] = await Promise.all([
    pool.query(`
      select *
      from passive_tree_versions
      where status = 'active'
      order by id desc
      limit 1
    `),
    pool.query(`
      select *
      from passive_tree_nodes
      where status = 'active'
      order by type, name, node_id
    `),
    pool.query(`
      select from_node_id, to_node_id, tree_version, orbit
      from passive_tree_edges
      where status = 'active'
      order by from_node_id, to_node_id
    `),
    loadTranslationLookup(pool, { entityTypes: ["passive_tree_node"], locales })
  ]);

  const latestVersion = versionRows.rows[0] || null;
  const nodes = nodeRows.rows.map((row) => {
    const stats = parseMaybeJson(row.stats_json, []);
    const raw = parseMaybeJson(row.raw_json, {});
    const normalized = raw.normalized || {};
    const classesStart = normalized.classes_start || raw.classesStart || [];
    return {
      id: row.node_id,
      tree_version: row.tree_version,
      name: row.name,
      type: row.type,
      group: row.group_id,
      orbit: row.orbit,
      orbit_index: row.orbit_index,
      arc: Number(row.arc ?? normalized.arc ?? 0),
      x: Number(row.x),
      y: Number(row.y),
      icon: row.icon,
      icon_path: row.icon_path || normalized.icon_path || "",
      classes_start: classesStart,
      is_class_start: Boolean(normalized.is_class_start || classesStart.length),
      ascendancy_name: row.ascendancy_name,
      is_ascendancy_start: Boolean(row.is_ascendancy_start ?? normalized.is_ascendancy_start),
      is_mastery: Boolean(row.is_mastery ?? normalized.is_mastery),
      stats,
      recipe: parseMaybeJson(row.recipe_json, []),
      i18n: {
        stats: buildI18nList(localizationLookup, "passive_tree_node", row.node_id, "stats", stats, locales)
      },
      source_hash: row.source_hash,
      updated_at: row.updated_at
    };
  });

  const activeTypes = [...new Set(nodes.map((node) => node.type))].sort();
  const typeRows = activeTypes.map((type) => ({
    id: type,
    label: typeLabel(type),
    count: nodes.filter((node) => node.type === type).length
  }));

  const bounds = parseMaybeJson(latestVersion?.bounds_json, {});
  const constants = parseMaybeJson(latestVersion?.constants_json, {});
  const scaleImage = Number(constants.scaleImage || constants.scale_image || 1);
  const treeSize = Number(constants.treeSize || constants.tree_size || Math.min(
    Math.abs(Number(bounds.max_x || 0) - Number(bounds.min_x || 0)),
    Math.abs(Number(bounds.max_y || 0) - Number(bounds.min_y || 0))
  ) * scaleImage * 1.1 || 0);

  return {
    generated_at: nowIso(),
    source_url: latestVersion?.source_url || DEFAULT_SOURCE_URL,
    source_ref: latestVersion?.source_ref || DEFAULT_REF,
    source_path: latestVersion?.source_path || "",
    version: latestVersion?.tree_version || "",
    tree: latestVersion?.tree_name || "Default",
    scale_image: scaleImage,
    tree_size: treeSize,
    bounds,
    constants,
    classes: parseMaybeJson(latestVersion?.classes_json, []),
    groups: parseMaybeJson(latestVersion?.groups_json, []),
    types: typeRows,
    total: nodes.length,
    edges: edgeRows.rows.map((edge) => ({
      from: edge.from_node_id,
      to: edge.to_node_id,
      orbit: edge.orbit
    })),
    path_edges: edgeRows.rows.map((edge) => ({
      from: edge.from_node_id,
      to: edge.to_node_id,
      orbit: edge.orbit
    })),
    nodes
  };
};

const typeLabel = (type = "") => ({
  small: "Small Passive",
  notable: "Notable",
  keystone: "Keystone",
  jewel: "Jewel Socket",
  mastery: "Mastery",
  ascendancy: "Ascendancy",
  ascendancy_notable: "Ascendancy Notable"
})[type] || type;

export const passiveTreeExportPayload = (tree, {
  generatedAt = nowIso(),
  sourcePath = "",
  updatedAt = generatedAt
} = {}) => {
  const nodes = (tree.nodes || []).filter(shouldKeepPassiveExportNode);
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  const edges = (tree.edges || []).filter((edge) => nodeIds.has(String(edge.from)) && nodeIds.has(String(edge.to)));
  const pathEdges = (tree.path_edges || tree.edges || []).filter((edge) => nodeIds.has(String(edge.from)) && nodeIds.has(String(edge.to)));
  const activeTypes = [...new Set(nodes.map((node) => node.type))].sort();
  return {
    generated_at: generatedAt,
    source_url: tree.source_url || DEFAULT_SOURCE_URL,
    source_ref: tree.source_ref || DEFAULT_REF,
    source_path: sourcePath,
    version: tree.version || "",
    tree: tree.tree || "Default",
    scale_image: Number(tree.scale_image || 1),
    tree_size: Number(tree.tree_size || 0),
    bounds: tree.bounds || {},
    constants: {
      ...(tree.constants || {}),
      scaleImage: Number(tree.scale_image || 1),
      treeSize: Number(tree.tree_size || 0)
    },
    classes: cleanPassiveClasses(tree.classes || []),
    groups: tree.groups || [],
    types: activeTypes.map((type) => ({
      id: type,
      label: typeLabel(type),
      count: nodes.filter((node) => node.type === type).length
    })),
    total: nodes.length,
    edges,
    path_edges: pathEdges,
    nodes: nodes.map((node) => {
      const classStarts = cleanPassiveClassStarts(node.classes_start || []);
      const stats = passiveNodeStats(node);
      return {
        id: node.id,
        tree_version: node.tree_version,
        name: passiveExportNodeName(node, classStarts),
        type: node.type,
        group: node.group,
        orbit: node.orbit,
        orbit_index: node.orbit_index,
        arc: Number(node.arc || 0),
        x: Number(node.x || 0),
        y: Number(node.y || 0),
        icon: node.icon,
        icon_path: node.icon_path || "",
        classes_start: classStarts,
        is_class_start: Boolean(classStarts.length),
        ascendancy_name: node.ascendancy_name,
        is_ascendancy_start: Boolean(node.is_ascendancy_start),
        is_mastery: Boolean(node.is_mastery),
        stats,
        recipe: node.recipe || [],
        i18n: {
          stats: stats.map((line, index) => ({
            en: line,
            vi: node.stats_vi?.[index] || line
          }))
        },
        source_hash: node.source_hash,
        updated_at: updatedAt
      };
    })
  };
};

export const compactPassiveTreeBrowserData = (data = {}) => {
  const sourceNodes = (data.nodes || []).filter(shouldKeepPassiveExportNode);
  const nodeIds = new Set(sourceNodes.map((node) => String(node.id)));
  return {
    version: data.version || "",
    scale_image: Number(data.scale_image || data.constants?.scaleImage || 1),
    bounds: data.bounds || {},
    constants: {
      orbitRadii: data.constants?.orbitRadii || []
    },
    classes: cleanPassiveClasses(data.classes || []).map((row) => ({
      name: row.name || "",
      background: row.background || null,
      ascendancies: (row.ascendancies || []).map((ascendancy) => ({
        name: ascendancy.name || ascendancy.id || "",
        background: ascendancy.background || null
      })).filter((ascendancy) => ascendancy.name)
    })).filter((row) => row.name),
    groups: (data.groups || []).map((group) => ({
      id: group.id,
      x: group.x,
      y: group.y
    })).filter((group) => group.id),
    path_edges: (data.path_edges || data.edges || []).map((edge) => {
      const compact = {
        from: edge.from,
        to: edge.to,
        orbit: edge.orbit,
        orbit_x: Number.isFinite(Number(edge.orbit_x ?? edge.orbitX)) ? Number(edge.orbit_x ?? edge.orbitX) : undefined,
        orbit_y: Number.isFinite(Number(edge.orbit_y ?? edge.orbitY)) ? Number(edge.orbit_y ?? edge.orbitY) : undefined
      };
      for (const key of Object.keys(compact)) {
        if (compact[key] === undefined || compact[key] === "") delete compact[key];
      }
      return compact;
    }).filter((edge) => edge.from && edge.to && nodeIds.has(String(edge.from)) && nodeIds.has(String(edge.to))),
    nodes: sourceNodes.map((node) => {
      const stats = passiveNodeStats(node);
      const statsVi = node.stats_vi || (node.i18n?.stats || []).map((line) => line.vi).filter(Boolean);
      const classStarts = cleanPassiveClassStarts(node.classes_start);
      const compact = {
        id: node.id,
        name: passiveExportNodeName(node, classStarts),
        type: node.type,
        group: node.group,
        orbit: node.orbit,
        orbit_index: node.orbit_index,
        arc: node.arc,
        x: node.x,
        y: node.y,
        stats,
        stats_vi: statsVi,
        classes_start: classStarts,
        ascendancy_name: node.ascendancy_name,
        icon_path: node.icon_path,
        is_class_start: classStarts.length ? true : undefined,
        is_ascendancy_start: node.is_ascendancy_start || undefined
      };
      for (const key of Object.keys(compact)) {
        if (compact[key] === undefined || compact[key] === "" || (Array.isArray(compact[key]) && compact[key].length === 0)) {
          delete compact[key];
        }
      }
      return compact;
    }).filter((node) => node.id)
  };
};

export const writePassiveTreeExportData = (data) => {
  fs.writeFileSync(EXPORT_PATH, `window.POE2_PASSIVE_TREE=${JSON.stringify(compactPassiveTreeBrowserData(data))};\n`, "utf8");
  return data;
};

export const writePassiveTreeExportPostgres = async (pool) => {
  const data = await exportPassiveTreePostgres(pool);
  return writePassiveTreeExportData(data);
};

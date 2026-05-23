import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closePool, createPool, withTransaction } from "../../src/db/pool.mjs";
import {
  buildI18nList,
  buildI18nText,
  collectItemContentStrings,
  loadTranslationLookup,
  parseLocales,
  upsertContentStrings
} from "../../src/localization/content-strings.mjs";
import { parseItemListingPage, parseItemsMenu } from "./items-lib.mjs";
import { retranslateContent } from "../retranslate-content.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_ITEMS_SOURCE_URL = "https://poe2db.tw/us/Items";
export const EXPORT_PATH = path.join(ROOT_DIR, "public/data/items-data.js");

export const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const nowIso = () => new Date().toISOString();

const asJsonParam = (value) => JSON.stringify(value ?? null);

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

const rowToSourceJson = (row = {}) => ({
  slug: row.slug,
  menu_key: row.menu_key,
  menu_label: row.menu_label,
  group_label: row.group_label,
  name: row.name,
  source_url: row.source_url,
  icon_url: row.icon_url,
  icon_alt: row.icon_alt,
  hover_url: row.hover_url || "",
  requirements: parseMaybeJson(row.requirements_json, []),
  properties: parseMaybeJson(row.properties_json, []),
  mods: parseMaybeJson(row.mods_json, []),
  tooltip_refs: parseMaybeJson(row.tooltip_refs_json, []),
  source_hash: row.source_hash
});

const broadMenuKeys = new Set(["items", "unique", "gem"]);

const itemSpecificityScore = (item, index) => {
  const menuScore = broadMenuKeys.has(item.menu_key) ? 0 : 1000;
  const contentScore = (item.properties?.length || 0) + (item.requirements?.length || 0) + (item.mods?.length || 0);
  return menuScore + contentScore + index / 100000;
};

export const dedupeItemsBySlug = (items = []) => {
  const bySlug = new Map();
  items.forEach((item, index) => {
    const current = bySlug.get(item.slug);
    if (!current || itemSpecificityScore(item, index) >= current.score) {
      bySlug.set(item.slug, { item, score: itemSpecificityScore(item, index) });
    }
  });
  return [...bySlug.values()].map((entry) => entry.item);
};

export const fetchText = async (sourceUrl, { timeoutMs = 30000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "poe2-vietnamese-items-crawler/1.0"
      }
    });
    if (!response.ok) throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
};

export const readItemsSourceHtml = async ({ sourceUrl = DEFAULT_ITEMS_SOURCE_URL, htmlPath } = {}) => {
  if (htmlPath) return fs.readFile(path.resolve(ROOT_DIR, htmlPath), "utf8");
  return fetchText(sourceUrl);
};

const createLimit = (concurrency = 2) => {
  const queue = [];
  let active = 0;

  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    const { task, resolve, reject } = queue.shift();
    active += 1;
    task()
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };

  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
};

export const insertCrawlRun = async (client, {
  kind = "items",
  sourceUrl = DEFAULT_ITEMS_SOURCE_URL,
  total = 0,
  metadata = {}
} = {}) => {
  const { rows } = await client.query(`
    insert into crawl_runs (kind, source_url, total_count, metadata)
    values ($1, $2, $3, $4::jsonb)
    returning id
  `, [kind, sourceUrl, total, asJsonParam(metadata)]);
  return rows[0].id;
};

export const finishCrawlRun = async (client, runId, summary) => {
  await client.query(`
    update crawl_runs
    set status = $2,
        finished_at = clock_timestamp(),
        total_count = $3,
        new_count = $4,
        changed_count = $5,
        unchanged_count = $6,
        removed_count = $7,
        failed_count = $8,
        metadata = $9::jsonb
    where id = $1
  `, [
    runId,
    summary.failed_count > 0 ? "partial" : "completed",
    summary.total_count,
    summary.new_count,
    summary.changed_count,
    summary.unchanged_count,
    summary.removed_count,
    summary.failed_count,
    asJsonParam(summary.metadata || {})
  ]);
};

export const upsertItemMenus = async (client, menus, runId) => {
  for (const menu of menus) {
    await client.query(`
      insert into item_menus
        (key, label, group_label, source_url, sort_order, status, first_seen_run_id, last_seen_run_id, updated_at)
      values ($1, $2, $3, $4, $5, 'active', $6, $6, now())
      on conflict (key) do update
      set label = excluded.label,
          group_label = excluded.group_label,
          source_url = excluded.source_url,
          sort_order = excluded.sort_order,
          status = 'active',
          last_seen_run_id = excluded.last_seen_run_id,
          updated_at = now()
    `, [
      menu.key,
      menu.label,
      menu.group_label,
      menu.source_url,
      menu.sort_order ?? 0,
      runId
    ]);
  }
  return { total: menus.length };
};

const insertTooltipRefs = async (client, item, runId) => {
  await client.query("delete from item_tooltip_refs where item_slug = $1", [item.slug]);
  for (const ref of item.tooltip_refs || []) {
    await client.query(`
      insert into item_tooltip_refs
        (item_slug, term, keyword, label, href, hover_url, source_url, run_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (item_slug, term, label, hover_url) do nothing
    `, [
      item.slug,
      ref.term,
      ref.keyword || "",
      ref.label || ref.term,
      ref.href || "",
      ref.hover_url || "",
      ref.source_url || item.source_url,
      runId
    ]);
  }
};

export const upsertItems = async (client, items, runId, { markRemoved = false } = {}) => {
  const uniqueItems = dedupeItemsBySlug(items);
  const summary = { new_count: 0, changed_count: 0, unchanged_count: 0, removed_count: 0, total_count: uniqueItems.length };
  if (!uniqueItems.length) return summary;

  const seenSlugs = new Set(uniqueItems.map((item) => item.slug));
  const seenMenus = [...new Set(uniqueItems.map((item) => item.menu_key).filter(Boolean))];
  const existingRows = await client.query("select * from items where slug = any($1::text[])", [[...seenSlugs]]);
  const existingBySlug = new Map(existingRows.rows.map((row) => [row.slug, row]));
  const itemPayload = [];
  const versionPayload = [];
  const tooltipPayload = [];

  for (const item of uniqueItems) {
    const rawJson = {
      slug: item.slug,
      name: item.name,
      source_url: item.source_url,
      hover_url: item.hover_url || "",
      properties: item.properties || [],
      requirements: item.requirements || [],
      mods: item.mods || []
    };
    const nextJson = {
      ...rawJson,
      tooltip_refs: item.tooltip_refs || [],
      source_hash: item.source_hash
    };
    const existing = existingBySlug.get(item.slug);
    if (!existing) summary.new_count += 1;
    else if (existing.source_hash === item.source_hash) summary.unchanged_count += 1;
    else {
      summary.changed_count += 1;
      versionPayload.push({
        slug: item.slug,
        previous_hash: existing.source_hash,
        next_hash: item.source_hash,
        previous_json: rowToSourceJson(existing),
        next_json: nextJson
      });
    }

    itemPayload.push({
      slug: item.slug,
      menu_key: item.menu_key,
      menu_label: item.menu_label,
      group_label: item.group_label,
      name: item.name,
      source_url: item.source_url,
      icon_url: item.icon_url || "",
      icon_alt: item.icon_alt || "",
      requirements_json: item.requirements || [],
      properties_json: item.properties || [],
      mods_json: item.mods || [],
      raw_json: rawJson,
      tooltip_refs_json: item.tooltip_refs || [],
      source_hash: item.source_hash
    });

    for (const ref of item.tooltip_refs || []) {
      tooltipPayload.push({
        item_slug: item.slug,
        term: ref.term,
        keyword: ref.keyword || "",
        label: ref.label || ref.term,
        href: ref.href || "",
        hover_url: ref.hover_url || "",
        source_url: ref.source_url || item.source_url
      });
    }
  }

  if (versionPayload.length) {
    await client.query(`
      insert into item_versions
        (slug, previous_hash, next_hash, previous_json, next_json, run_id, changed_at)
      select slug, previous_hash, next_hash, previous_json, next_json, $2, now()
      from jsonb_to_recordset($1::jsonb) as payload(
        slug text,
        previous_hash text,
        next_hash text,
        previous_json jsonb,
        next_json jsonb
      )
    `, [asJsonParam(versionPayload), runId]);
  }

  await client.query(`
    insert into items
      (slug, menu_key, menu_label, group_label, name, source_url, icon_url, icon_alt,
       requirements_json, properties_json, mods_json, raw_json, tooltip_refs_json,
       source_hash, status, first_seen_run_id, last_seen_run_id, updated_at)
    select slug, menu_key, menu_label, group_label, name, source_url, icon_url, icon_alt,
      requirements_json, properties_json, mods_json, raw_json, tooltip_refs_json,
      source_hash, 'active', $2, $2, now()
    from jsonb_to_recordset($1::jsonb) as payload(
      slug text,
      menu_key text,
      menu_label text,
      group_label text,
      name text,
      source_url text,
      icon_url text,
      icon_alt text,
      requirements_json jsonb,
      properties_json jsonb,
      mods_json jsonb,
      raw_json jsonb,
      tooltip_refs_json jsonb,
      source_hash text
    )
    on conflict (slug) do update
    set menu_key = excluded.menu_key,
        menu_label = excluded.menu_label,
        group_label = excluded.group_label,
        name = excluded.name,
        source_url = excluded.source_url,
        icon_url = excluded.icon_url,
        icon_alt = excluded.icon_alt,
        requirements_json = excluded.requirements_json,
        properties_json = excluded.properties_json,
        mods_json = excluded.mods_json,
        raw_json = excluded.raw_json,
        tooltip_refs_json = excluded.tooltip_refs_json,
        source_hash = excluded.source_hash,
        status = 'active',
        last_seen_run_id = excluded.last_seen_run_id,
        updated_at = now()
  `, [asJsonParam(itemPayload), runId]);

  await client.query("delete from item_tooltip_refs where item_slug = any($1::text[])", [[...seenSlugs]]);
  if (tooltipPayload.length) {
    await client.query(`
      insert into item_tooltip_refs
        (item_slug, term, keyword, label, href, hover_url, source_url, run_id)
      select item_slug, term, keyword, label, href, hover_url, source_url, $2
      from jsonb_to_recordset($1::jsonb) as payload(
        item_slug text,
        term text,
        keyword text,
        label text,
        href text,
        hover_url text,
        source_url text
      )
      on conflict (item_slug, term, label, hover_url) do nothing
    `, [asJsonParam(tooltipPayload), runId]);
  }

  await upsertContentStrings(
    client,
    uniqueItems.flatMap(collectItemContentStrings),
    { runId }
  );

  if (markRemoved && seenMenus.length) {
    const removed = await client.query(`
      update items
      set status = 'removed',
          last_seen_run_id = $1,
          updated_at = now()
      where status = 'active'
        and menu_key = any($2::text[])
        and not (slug = any($3::text[]))
      returning slug
    `, [runId, seenMenus, [...seenSlugs]]);
    summary.removed_count = removed.rowCount || 0;
  }

  return summary;
};

export const crawlItemsToPostgres = async ({
  pool,
  sourceUrl = DEFAULT_ITEMS_SOURCE_URL,
  htmlPath,
  limitMenus = 0,
  concurrency = 2,
  markRemoved = false,
  onProgress = () => {}
} = {}) => {
  if (!pool) throw new Error("PostgreSQL pool is required");
  const menuHtml = await readItemsSourceHtml({ sourceUrl, htmlPath });
  const allMenus = parseItemsMenu(menuHtml, sourceUrl);
  const menus = Number(limitMenus) > 0 ? allMenus.slice(0, Number(limitMenus)) : allMenus;
  const limit = createLimit(concurrency);
  const failures = [];
  const itemGroups = await Promise.all(menus.map((menu) => limit(async () => {
    try {
      onProgress({ event: "menu:start", key: menu.key, source_url: menu.source_url });
      const html = await fetchText(menu.source_url);
      const items = parseItemListingPage(html, menu);
      onProgress({ event: "menu:done", key: menu.key, count: items.length });
      return { menu, items };
    } catch (error) {
      failures.push({ menu_key: menu.key, source_url: menu.source_url, error: error.message });
      onProgress({ event: "menu:error", key: menu.key, error: error.message });
      return { menu, items: [] };
    }
  })));
  const items = itemGroups.flatMap((group) => group.items);

  return withTransaction(pool, async (client) => {
    const runId = await insertCrawlRun(client, {
      kind: "items",
      sourceUrl,
      total: items.length,
      metadata: { menu_count: menus.length, all_menu_count: allMenus.length, failures }
    });
    await upsertItemMenus(client, menus, runId);
    const shouldMarkRemoved = Boolean(markRemoved && failures.length === 0 && Number(limitMenus) === 0);
    const itemSummary = await upsertItems(client, items, runId, { markRemoved: shouldMarkRemoved });
    const summary = {
      ...itemSummary,
      failed_count: failures.length,
      metadata: { menu_count: menus.length, all_menu_count: allMenus.length, failures }
    };
    await finishCrawlRun(client, runId, summary);
    return { run_id: runId, menus: menus.length, items: items.length, ...summary };
  });
};

export const normalizeExportItem = (row, localizationLookup = new Map(), locales = parseLocales()) => {
  const properties = parseMaybeJson(row.properties_json, []);
  const requirements = parseMaybeJson(row.requirements_json, []);
  const mods = parseMaybeJson(row.mods_json, []);
  const nameI18n = buildI18nText(localizationLookup, "item", row.slug, "name", row.name, locales);
  const propertiesI18n = buildI18nList(localizationLookup, "item", row.slug, "properties", properties, locales);
  const requirementsI18n = buildI18nList(localizationLookup, "item", row.slug, "requirements", requirements, locales);
  const modsI18n = buildI18nList(localizationLookup, "item", row.slug, "mods", mods, locales);
  return {
    slug: row.slug,
    menu_key: row.menu_key,
    menu_label: row.menu_label,
    group_label: row.group_label,
    name: row.name,
    source_url: row.source_url,
    icon_url: row.icon_url || "",
    icon_alt: row.icon_alt || "",
    properties,
    requirements,
    mods,
    i18n: {
      name: nameI18n,
      properties: propertiesI18n,
      requirements: requirementsI18n,
      mods: modsI18n
    },
    tooltip_refs: parseMaybeJson(row.tooltip_refs_json, []),
    source_hash: row.source_hash,
    status: row.status || "active",
    updated_at: row.updated_at
  };
};

export const buildItemsExportPayload = ({
  menus = [],
  items = [],
  latestRun = null,
  sourceUrl = DEFAULT_ITEMS_SOURCE_URL,
  localizationLookup = new Map(),
  locales = parseLocales()
} = {}) => {
  const normalizedItems = items.map((item) => item.properties_json || item.mods_json
    ? normalizeExportItem(item, localizationLookup, locales)
    : item);
  const activeItems = normalizedItems.filter((item) => (item.status || "active") === "active");
  const menuRows = menus.map((menu) => ({
    key: menu.key,
    label: menu.label,
    group_label: menu.group_label,
    source_url: menu.source_url,
    sort_order: menu.sort_order ?? 0,
    count: activeItems.filter((item) => item.menu_key === menu.key).length
  }));

  return {
    generated_at: nowIso(),
    source_url: latestRun?.source_url || sourceUrl,
    latest_run: latestRun,
    total: normalizedItems.length,
    active_total: activeItems.length,
    menus: menuRows,
    items: normalizedItems
  };
};

export const exportItems = async (pool) => {
  const locales = parseLocales();
  const [menuRows, itemRows, runRows, localizationLookup] = await Promise.all([
    pool.query(`
      select key, label, group_label, source_url, sort_order, updated_at
      from item_menus
      where status = 'active'
      order by group_label, sort_order, label
    `),
    pool.query(`
      select slug, menu_key, menu_label, group_label, name, source_url, icon_url, icon_alt,
        requirements_json, properties_json, mods_json, tooltip_refs_json,
        source_hash, status, updated_at
      from items
      where status = 'active'
      order by group_label, menu_label, name
    `),
    pool.query(`
      select *
      from crawl_runs
      where kind = 'items'
      order by id desc
      limit 1
    `),
    loadTranslationLookup(pool, { entityTypes: ["item"], locales })
  ]);

  return buildItemsExportPayload({
    menus: menuRows.rows,
    items: itemRows.rows,
    latestRun: runRows.rows[0] || null,
    localizationLookup,
    locales
  });
};

export const writeItemsExport = async (pool, exportPath = EXPORT_PATH) => {
  await retranslateContent(pool);
  const data = await exportItems(pool);
  await fs.mkdir(path.dirname(exportPath), { recursive: true });
  await fs.writeFile(exportPath, `window.POE2_ITEMS = ${JSON.stringify(data, null, 2)};\n`, "utf8");
  return data;
};

export const runWithPool = async (callback) => {
  const pool = createPool();
  try {
    return await callback(pool);
  } finally {
    await closePool(pool);
  }
};

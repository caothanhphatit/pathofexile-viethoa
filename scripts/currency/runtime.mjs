import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closePool, createPool, withTransaction } from "../../src/db/pool.mjs";
import {
  buildI18nList,
  buildI18nText,
  collectCurrencyContentStrings,
  loadTranslationLookup,
  parseLocales,
  upsertContentStrings
} from "../../src/localization/content-strings.mjs";
import {
  DEFAULT_CURRENCY_SOURCE_URL,
  classifyCurrencySubtype
} from "../currency-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_SOURCE_URL = DEFAULT_CURRENCY_SOURCE_URL;
export const EXPORT_PATH = path.join(ROOT_DIR, "public/data/currency-data.js");

const CATEGORY_LABELS = {
  StackableCurrencyItem: "Currency",
  Essence: "Essence",
  SplinterItem: "Splinter",
  CatalystItem: "Catalyst"
};

const CATEGORY_ORDER = ["StackableCurrencyItem", "Essence", "SplinterItem", "CatalystItem"];

const FAMILY_LABELS = {
  "crafting-orb": "Crafting Orb",
  "quality-currency": "Quality Currency",
  "gem-currency": "Gem Currency",
  "socket-currency": "Socket Currency",
  "corruption-currency": "Corruption Currency",
  "delirium-liquid": "Delirium Liquid",
  "desecration-currency": "Desecration Currency",
  "expedition-artifact": "Expedition Artifact",
  shard: "Shard",
  "utility-currency": "Utility Currency",
  essence: "Essence",
  splinter: "Splinter",
  catalyst: "Catalyst"
};

const FAMILY_ORDER = [
  "crafting-orb",
  "quality-currency",
  "gem-currency",
  "socket-currency",
  "corruption-currency",
  "delirium-liquid",
  "desecration-currency",
  "expedition-artifact",
  "shard",
  "utility-currency",
  "essence",
  "splinter",
  "catalyst"
];

const nowIso = () => new Date().toISOString();
const jsonParam = (value) => JSON.stringify(value ?? null);
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

const currencyAliases = (item = {}) => {
  if (item.subtype && item.subtype_label) {
    return {
      subtype: item.subtype,
      subtype_label: item.subtype_label,
      family: item.family || item.subtype,
      family_label: item.family_label || item.subtype_label
    };
  }
  if (item.family && item.family_label) {
    return {
      subtype: item.family,
      subtype_label: item.family_label,
      family: item.family,
      family_label: item.family_label
    };
  }
  const subtype = classifyCurrencySubtype(item);
  return {
    ...subtype,
    family: subtype.subtype,
    family_label: subtype.subtype_label
  };
};

export const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export const readCurrencySourceHtml = async ({ sourceUrl = DEFAULT_SOURCE_URL, htmlPath } = {}) => {
  if (htmlPath) return fs.readFileSync(path.resolve(ROOT_DIR, htmlPath), "utf8");

  const response = await fetch(sourceUrl, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "poe2-vietnamese-currency-crawler/1.0"
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
  return response.text();
};

const sourceJson = (item) => {
  const aliases = currencyAliases(item);
  return {
    slug: item.slug,
    name: item.name,
    category: item.category,
    category_label: item.category_label,
    family: aliases.family,
    family_label: aliases.family_label,
    subtype: aliases.subtype,
    subtype_label: aliases.subtype_label,
    source_url: item.source_url,
    icon_url: item.icon_url,
    icon_alt: item.icon_alt,
    hover_url: item.hover_url,
    stack_size: item.stack_size,
    description_en: item.description_en,
    properties: item.properties || parseMaybeJson(item.properties_json, []),
    mods: item.mods || parseMaybeJson(item.mods_json, []),
    source_hash: item.source_hash
  };
};

const requirePostgresConfig = () => {
  if (!process.env.POE2_DATABASE_URL) throw new Error("Missing POE2_DATABASE_URL");
};

export const runCurrencyWithPostgres = async (callback) => {
  requirePostgresConfig();
  const pool = createPool();
  try {
    return await callback(pool);
  } finally {
    await closePool(pool);
  }
};

export const upsertCurrenciesPostgres = async (pool, currencies, { sourceUrl = DEFAULT_SOURCE_URL, markRemoved = true } = {}) =>
  withTransaction(pool, async (client) => {
    const run = await client.query(`
      insert into crawl_runs (kind, source_url, total_count, metadata)
      values ('currency', $1, $2, '{}'::jsonb)
      returning id
    `, [sourceUrl, currencies.length]);
    const runId = run.rows[0].id;
    const slugs = currencies.map((item) => item.slug);
    const existingRows = slugs.length
      ? await client.query("select * from currency_items where slug = any($1::text[])", [slugs])
      : { rows: [] };
    const existingBySlug = new Map(existingRows.rows.map((row) => [row.slug, row]));
    const summary = { total: currencies.length, new: 0, changed: 0, unchanged: 0, removed: 0 };
    const versionPayload = [];
    const itemPayload = [];

    for (const rawItem of currencies) {
      const aliases = currencyAliases(rawItem);
      const item = {
        ...rawItem,
        ...aliases
      };
      const existing = existingBySlug.get(item.slug);
      if (!existing) summary.new += 1;
      else if (existing.source_hash === item.source_hash) summary.unchanged += 1;
      else {
        summary.changed += 1;
        versionPayload.push({
          slug: item.slug,
          previous_hash: existing.source_hash,
          next_hash: item.source_hash,
          previous_json: sourceJson(existing),
          next_json: sourceJson(item)
        });
      }
      itemPayload.push({
        slug: item.slug,
        name: item.name,
        category: item.category,
        category_label: item.category_label,
        family: item.family,
        family_label: item.family_label,
        subtype: item.subtype,
        subtype_label: item.subtype_label,
        source_url: item.source_url,
        icon_url: item.icon_url || "",
        icon_alt: item.icon_alt || "",
        hover_url: item.hover_url || "",
        stack_size: item.stack_size || "",
        description_en: item.description_en || "",
        properties_json: item.properties || [],
        mods_json: item.mods || [],
        source_hash: item.source_hash
      });
    }

    await upsertContentStrings(
      client,
      currencies.flatMap((item) => collectCurrencyContentStrings({
        ...item,
        ...currencyAliases(item)
      })),
      { runId }
    );

    if (versionPayload.length) {
      await client.query(`
        insert into currency_versions
          (slug, previous_hash, next_hash, previous_json, next_json, run_id, changed_at)
        select slug, previous_hash, next_hash, previous_json, next_json, $2, now()
        from jsonb_to_recordset($1::jsonb) as payload(
          slug text,
          previous_hash text,
          next_hash text,
          previous_json jsonb,
          next_json jsonb
        )
      `, [jsonParam(versionPayload), runId]);
    }

    if (itemPayload.length) {
      await client.query(`
        insert into currency_items
          (slug, name, category, category_label, family, family_label, subtype, subtype_label,
           source_url, icon_url, icon_alt, hover_url, stack_size, description_en,
           properties_json, mods_json, source_hash, status, first_seen_run_id, last_seen_run_id, updated_at)
        select slug, name, category, category_label, family, family_label, subtype, subtype_label,
          source_url, icon_url, icon_alt, hover_url, stack_size, description_en,
          properties_json, mods_json, source_hash, 'active', $2, $2, now()
        from jsonb_to_recordset($1::jsonb) as payload(
          slug text,
          name text,
          category text,
          category_label text,
          family text,
          family_label text,
          subtype text,
          subtype_label text,
          source_url text,
          icon_url text,
          icon_alt text,
          hover_url text,
          stack_size text,
          description_en text,
          properties_json jsonb,
          mods_json jsonb,
          source_hash text
        )
        on conflict (slug) do update
        set name = excluded.name,
            category = excluded.category,
            category_label = excluded.category_label,
            family = excluded.family,
            family_label = excluded.family_label,
            subtype = excluded.subtype,
            subtype_label = excluded.subtype_label,
            source_url = excluded.source_url,
            icon_url = excluded.icon_url,
            icon_alt = excluded.icon_alt,
            hover_url = excluded.hover_url,
            stack_size = excluded.stack_size,
            description_en = excluded.description_en,
            properties_json = excluded.properties_json,
            mods_json = excluded.mods_json,
            source_hash = excluded.source_hash,
            status = 'active',
            last_seen_run_id = excluded.last_seen_run_id,
            updated_at = now()
      `, [jsonParam(itemPayload), runId]);
    }

    if (markRemoved && slugs.length) {
      const removed = await client.query(`
        update currency_items
        set status = 'removed',
            last_seen_run_id = $1,
            updated_at = now()
        where status = 'active'
          and not (slug = any($2::text[]))
        returning slug
      `, [runId, slugs]);
      summary.removed = removed.rowCount || 0;
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

export const exportCurrenciesPostgres = async (pool) => {
  const locales = parseLocales();
  const [itemRows, runRows, localizationLookup] = await Promise.all([
    pool.query(`
      select *
      from currency_items
      order by
        case category
          when 'StackableCurrencyItem' then 0
          when 'Essence' then 1
          when 'SplinterItem' then 2
          when 'CatalystItem' then 3
          else 99
        end,
        name
    `),
    pool.query(`
      select *
      from crawl_runs
      where kind = 'currency'
      order by id desc
      limit 1
    `),
    loadTranslationLookup(pool, { entityTypes: ["currency"], locales })
  ]);

  const items = itemRows.rows.map((row) => {
    const aliases = currencyAliases(row);
    const mods = parseMaybeJson(row.mods_json, []);
    const nameI18n = buildI18nText(localizationLookup, "currency", row.slug, "name", row.name, locales);
    const categoryI18n = buildI18nText(localizationLookup, "currency", row.slug, "category_label", row.category_label, locales);
    const subtypeI18n = buildI18nText(localizationLookup, "currency", row.slug, "subtype_label", aliases.subtype_label, locales);
    const descriptionI18n = buildI18nText(localizationLookup, "currency", row.slug, "description", row.description_en || "", locales);
    const propertiesI18n = buildI18nList(localizationLookup, "currency", row.slug, "properties", parseMaybeJson(row.properties_json, []), locales);
    const modsI18n = buildI18nList(localizationLookup, "currency", row.slug, "mods", mods, locales);
    return {
      slug: row.slug,
      name: row.name,
      category: row.category,
      category_label: row.category_label,
      family: aliases.family,
      family_label: aliases.family_label,
      subtype: aliases.subtype,
      subtype_label: aliases.subtype_label,
      source_url: row.source_url,
      icon_url: row.icon_url,
      icon_alt: row.icon_alt,
      hover_url: row.hover_url,
      stack_size: row.stack_size,
      description_en: row.description_en,
      properties: parseMaybeJson(row.properties_json, []),
      mods,
      i18n: {
        name: nameI18n,
        category_label: categoryI18n,
        subtype_label: subtypeI18n,
        description: descriptionI18n,
        properties: propertiesI18n,
        mods: modsI18n
      },
      source_hash: row.source_hash,
      status: row.status,
      updated_at: row.updated_at
    };
  });
  const activeItems = items.filter((item) => item.status === "active");
  const categoryRows = CATEGORY_ORDER.map((category) => ({
    id: category,
    label: CATEGORY_LABELS[category],
    count: activeItems.filter((item) => item.category === category).length
  })).filter((category) => category.count > 0);
  const seenSubtypes = new Set(activeItems.map((item) => item.subtype));
  const subtypeRows = FAMILY_ORDER
    .filter((subtype) => seenSubtypes.has(subtype))
    .map((subtype) => ({
      id: subtype,
      label: FAMILY_LABELS[subtype] || subtype,
      count: activeItems.filter((item) => item.subtype === subtype).length
    }))
    .concat([...seenSubtypes]
      .filter((subtype) => !FAMILY_ORDER.includes(subtype))
      .sort()
      .map((subtype) => ({
        id: subtype,
        label: activeItems.find((item) => item.subtype === subtype)?.subtype_label || subtype,
        count: activeItems.filter((item) => item.subtype === subtype).length
      })));

  return {
    generated_at: nowIso(),
    source_url: runRows.rows[0]?.source_url || DEFAULT_SOURCE_URL,
    latest_run: runRows.rows[0] || null,
    total: items.length,
    active_total: activeItems.length,
    categories: categoryRows,
    subtypes: subtypeRows,
    families: subtypeRows,
    items
  };
};

export const writeCurrencyExportPostgres = async (pool) => {
  const data = await exportCurrenciesPostgres(pool);
  fs.writeFileSync(EXPORT_PATH, `window.POE2_CURRENCY = ${JSON.stringify(data, null, 2)};\n`, "utf8");
  return data;
};

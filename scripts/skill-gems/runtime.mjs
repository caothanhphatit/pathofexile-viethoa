import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closePool, createPool, withTransaction } from "../../src/db/pool.mjs";
import {
  buildI18nList,
  buildI18nText,
  collectSkillGemContentStrings,
  loadTranslationLookup,
  parseLocales,
  upsertContentStrings
} from "../../src/localization/content-strings.mjs";
import { retranslateContent } from "../retranslate-content.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_SOURCE_URL = "https://poe2db.tw/us/Skill_Gems";
export const EXPORT_PATH = path.join(ROOT_DIR, "public/data/skill-gems-data.js");

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

export const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export const readSkillGemSourceHtml = async ({ sourceUrl = DEFAULT_SOURCE_URL, htmlPath } = {}) => {
  if (htmlPath) return fs.readFileSync(path.resolve(ROOT_DIR, htmlPath), "utf8");

  const response = await fetch(sourceUrl, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "poe2-vietnamese-skill-gems-crawler/1.0"
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
  return response.text();
};

const sourceJson = (gem) => ({
  slug: gem.slug,
  name: gem.name,
  tier: gem.tier,
  color: gem.color,
  source_url: gem.source_url,
  icon_url: gem.icon_url,
  icon_alt: gem.icon_alt,
  hover_url: gem.hover_url,
  tags: gem.tags || [],
  source_hash: gem.source_hash
});

const requirePostgresConfig = () => {
  if (!process.env.POE2_DATABASE_URL) throw new Error("Missing POE2_DATABASE_URL");
};

export const runSkillGemWithPostgres = async (callback) => {
  requirePostgresConfig();
  const pool = createPool();
  try {
    return await callback(pool);
  } finally {
    await closePool(pool);
  }
};

export const upsertSkillGemsPostgres = async (pool, gems, { sourceUrl = DEFAULT_SOURCE_URL, markRemoved = true } = {}) =>
  withTransaction(pool, async (client) => {
    const run = await client.query(`
      insert into crawl_runs (kind, source_url, total_count, metadata)
      values ('skill_gems', $1, $2, '{}'::jsonb)
      returning id
    `, [sourceUrl, gems.length]);
    const runId = run.rows[0].id;
    const slugs = gems.map((gem) => gem.slug);
    const existingRows = slugs.length
      ? await client.query("select * from skill_gems where slug = any($1::text[])", [slugs])
      : { rows: [] };
    const existingBySlug = new Map(existingRows.rows.map((row) => [row.slug, row]));
    const summary = { total: gems.length, new: 0, changed: 0, unchanged: 0, removed: 0 };
    const versionPayload = [];
    const gemPayload = [];
    const detailPayload = [];

    for (const gem of gems) {
      const existing = existingBySlug.get(gem.slug);
      if (!existing) summary.new += 1;
      else if (existing.source_hash === gem.source_hash) summary.unchanged += 1;
      else {
        summary.changed += 1;
        versionPayload.push({
          slug: gem.slug,
          previous_hash: existing.source_hash,
          next_hash: gem.source_hash,
          previous_json: sourceJson({
            ...existing,
            tags: parseMaybeJson(existing.tags_json, [])
          }),
          next_json: sourceJson(gem)
        });
      }

      gemPayload.push({
        slug: gem.slug,
        name: gem.name,
        tier: gem.tier,
        color: gem.color || "item",
        source_url: gem.source_url,
        icon_url: gem.icon_url || "",
        icon_alt: gem.icon_alt || "",
        hover_url: gem.hover_url || "",
        tags_json: gem.tags || [],
        source_hash: gem.source_hash
      });
      if (gem.detail) {
        detailPayload.push({
          slug: gem.slug,
          summary_en: gem.detail.summary_en || "",
          properties_json: gem.detail.properties || [],
          requirements_json: gem.detail.requirements || [],
          mods_json: gem.detail.mods || [],
          sections_json: gem.detail.sections || [],
          source_hash: gem.detail.source_hash || null
        });
      }
    }

    if (versionPayload.length) {
      await client.query(`
        insert into skill_gem_versions
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

    if (gemPayload.length) {
      await client.query(`
        insert into skill_gems
          (slug, name, tier, color, source_url, icon_url, icon_alt, hover_url, tags_json,
           source_hash, status, first_seen_run_id, last_seen_run_id, updated_at)
        select slug, name, tier, color, source_url, icon_url, icon_alt, hover_url, tags_json,
          source_hash, 'active', $2, $2, now()
        from jsonb_to_recordset($1::jsonb) as payload(
          slug text,
          name text,
          tier integer,
          color text,
          source_url text,
          icon_url text,
          icon_alt text,
          hover_url text,
          tags_json jsonb,
          source_hash text
        )
        on conflict (slug) do update
        set name = excluded.name,
            tier = excluded.tier,
            color = excluded.color,
            source_url = excluded.source_url,
            icon_url = excluded.icon_url,
            icon_alt = excluded.icon_alt,
            hover_url = excluded.hover_url,
            tags_json = excluded.tags_json,
            source_hash = excluded.source_hash,
            status = 'active',
            last_seen_run_id = excluded.last_seen_run_id,
            updated_at = now()
      `, [jsonParam(gemPayload), runId]);
    }

    if (detailPayload.length) {
      await client.query(`
        insert into skill_gem_details
          (slug, summary_en, properties_json, requirements_json, mods_json, sections_json, source_hash, updated_at)
        select slug, summary_en, properties_json, requirements_json, mods_json, sections_json, source_hash, now()
        from jsonb_to_recordset($1::jsonb) as payload(
          slug text,
          summary_en text,
          properties_json jsonb,
          requirements_json jsonb,
          mods_json jsonb,
          sections_json jsonb,
          source_hash text
        )
        on conflict (slug) do update
        set summary_en = excluded.summary_en,
            properties_json = excluded.properties_json,
            requirements_json = excluded.requirements_json,
            mods_json = excluded.mods_json,
            sections_json = excluded.sections_json,
            source_hash = excluded.source_hash,
            updated_at = now()
      `, [jsonParam(detailPayload)]);
    }

    if (markRemoved && slugs.length) {
      const removed = await client.query(`
        update skill_gems
        set status = 'removed',
            last_seen_run_id = $1,
            updated_at = now()
        where status = 'active'
          and not (slug = any($2::text[]))
        returning slug
      `, [runId, slugs]);
      summary.removed = removed.rowCount || 0;
    }

    await upsertContentStrings(
      client,
      gems.flatMap(collectSkillGemContentStrings),
      { runId }
    );

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

export const exportSkillGemsPostgres = async (pool) => {
  const locales = parseLocales();
  const [gemRows, runRows, localizationLookup] = await Promise.all([
    pool.query(`
      select
        g.slug, g.name, g.tier, g.color, g.source_url, g.icon_url, g.icon_alt, g.hover_url,
        g.tags_json, g.source_hash, g.status, g.updated_at,
        d.summary_en, d.properties_json, d.requirements_json, d.mods_json,
        d.sections_json, d.source_hash as detail_hash
      from skill_gems g
      left join skill_gem_details d on d.slug = g.slug
      order by coalesce(g.tier, 999), g.name
    `),
    pool.query(`
      select *
      from crawl_runs
      where kind = 'skill_gems'
      order by id desc
      limit 1
    `),
    loadTranslationLookup(pool, { entityTypes: ["skill_gem"], locales })
  ]);

  const gems = gemRows.rows.map((row) => {
    const properties = parseMaybeJson(row.properties_json, []);
    const requirements = parseMaybeJson(row.requirements_json, []);
    const mods = parseMaybeJson(row.mods_json, []);
    const sections = parseMaybeJson(row.sections_json, []);
    const tags = parseMaybeJson(row.tags_json, []);
    const nameI18n = buildI18nText(localizationLookup, "skill_gem", row.slug, "name", row.name, locales);
    const tagsI18n = buildI18nList(localizationLookup, "skill_gem", row.slug, "tags", tags, locales);
    const summaryI18n = buildI18nText(localizationLookup, "skill_gem", row.slug, "detail.summary", row.summary_en || "", locales);
    const propertiesI18n = buildI18nList(localizationLookup, "skill_gem", row.slug, "detail.properties", properties, locales);
    const requirementsI18n = buildI18nList(localizationLookup, "skill_gem", row.slug, "detail.requirements", requirements, locales);
    const modsI18n = buildI18nList(localizationLookup, "skill_gem", row.slug, "detail.mods", mods, locales);
    return {
      slug: row.slug,
      name: row.name,
      tier: row.tier,
      color: row.color,
      source_url: row.source_url,
      icon_url: row.icon_url,
      icon_alt: row.icon_alt,
      hover_url: row.hover_url,
      tags,
      source_hash: row.source_hash,
      status: row.status,
      summary_en: row.summary_en || "",
      properties,
      requirements,
      mods,
      sections,
      i18n: {
        name: nameI18n,
        tags: tagsI18n,
        summary: summaryI18n,
        properties: propertiesI18n,
        requirements: requirementsI18n,
        mods: modsI18n,
        sections: sections.map((section, sectionIndex) => ({
          title: buildI18nText(localizationLookup, "skill_gem", row.slug, `detail.sections.${sectionIndex}.title`, section.title || "", locales),
          lines: (section.lines || []).map((line, lineIndex) =>
            buildI18nText(localizationLookup, "skill_gem", row.slug, `detail.sections.${sectionIndex}.lines.${lineIndex}`, line, locales)
          )
        }))
      },
      detail_hash: row.detail_hash || null,
      updated_at: row.updated_at
    };
  });

  return {
    generated_at: nowIso(),
    source_url: runRows.rows[0]?.source_url || DEFAULT_SOURCE_URL,
    latest_run: runRows.rows[0] || null,
    total: gems.length,
    gems
  };
};

export const writeSkillGemExportPostgres = async (pool) => {
  await retranslateContent(pool);
  const data = await exportSkillGemsPostgres(pool);
  fs.writeFileSync(EXPORT_PATH, `window.POE2_SKILL_GEMS = ${JSON.stringify(data, null, 2)};\n`, "utf8");
  return data;
};

import crypto from "node:crypto";

export const DEFAULT_SOURCE_LOCALE = "en";
export const DEFAULT_TARGET_LOCALES = ["vi"];

const normalizeText = (value = "") => String(value)
  .replace(/\u00a0/g, " ")
  .replace(/[ \t\r\n]+/g, " ")
  .trim();

export const sourceHash = (value = "") =>
  crypto.createHash("sha256").update(normalizeText(value)).digest("hex");

export const contentStringKey = (entityType, entityId, fieldPath, sourceLocale = DEFAULT_SOURCE_LOCALE) =>
  [entityType, entityId, fieldPath, sourceLocale].join("|");

const buildString = ({
  entityType,
  entityId,
  fieldPath,
  sourceText,
  sourceLocale = DEFAULT_SOURCE_LOCALE,
  context = {}
}) => {
  const text = normalizeText(sourceText);
  if (!entityType || !entityId || !fieldPath || !text) return null;
  return {
    entity_type: entityType,
    entity_id: entityId,
    field_path: fieldPath,
    source_locale: sourceLocale,
    source_text: text,
    source_hash: sourceHash(text),
    context_json: context
  };
};

const lineStrings = ({ entityType, entityId, prefix, lines = [], context = {} }) =>
  lines
    .map((line, index) => buildString({
      entityType,
      entityId,
      fieldPath: `${prefix}.${index}`,
      sourceText: line,
      context: { ...context, index }
    }))
    .filter(Boolean);

const dedupeStrings = (strings = []) => {
  const byKey = new Map();
  for (const row of strings.filter(Boolean)) {
    byKey.set(contentStringKey(row.entity_type, row.entity_id, row.field_path, row.source_locale), row);
  }
  return [...byKey.values()];
};

export const collectItemContentStrings = (item = {}) => dedupeStrings([
  buildString({
    entityType: "item",
    entityId: item.slug,
    fieldPath: "name",
    sourceText: item.name,
    context: { source_url: item.source_url || "", menu_key: item.menu_key || "" }
  }),
  ...lineStrings({
    entityType: "item",
    entityId: item.slug,
    prefix: "properties",
    lines: item.properties || [],
    context: { source_url: item.source_url || "", menu_key: item.menu_key || "" }
  }),
  ...lineStrings({
    entityType: "item",
    entityId: item.slug,
    prefix: "requirements",
    lines: item.requirements || [],
    context: { source_url: item.source_url || "", menu_key: item.menu_key || "" }
  }),
  ...lineStrings({
    entityType: "item",
    entityId: item.slug,
    prefix: "mods",
    lines: item.mods || [],
    context: { source_url: item.source_url || "", menu_key: item.menu_key || "" }
  }),
  ...(item.tooltip_refs || []).map((ref, index) => buildString({
    entityType: "item",
    entityId: item.slug,
    fieldPath: `tooltip_refs.${index}.label`,
    sourceText: ref.label || ref.term,
    context: {
      source_url: ref.source_url || item.source_url || "",
      keyword: ref.keyword || "",
      hover_url: ref.hover_url || ""
    }
  }))
]);

export const collectSkillGemContentStrings = (gem = {}) => {
  const detail = gem.detail || {};
  const sectionRows = [];
  (detail.sections || []).forEach((section, sectionIndex) => {
    sectionRows.push(buildString({
      entityType: "skill_gem",
      entityId: gem.slug,
      fieldPath: `detail.sections.${sectionIndex}.title`,
      sourceText: section.title,
      context: { source_url: gem.source_url || "", section_index: sectionIndex }
    }));
    (section.lines || []).forEach((line, lineIndex) => {
      sectionRows.push(buildString({
        entityType: "skill_gem",
        entityId: gem.slug,
        fieldPath: `detail.sections.${sectionIndex}.lines.${lineIndex}`,
        sourceText: line,
        context: { source_url: gem.source_url || "", section_index: sectionIndex, line_index: lineIndex }
      }));
    });
  });

  return dedupeStrings([
    buildString({
      entityType: "skill_gem",
      entityId: gem.slug,
      fieldPath: "name",
      sourceText: gem.name,
      context: { source_url: gem.source_url || "" }
    }),
    ...lineStrings({
      entityType: "skill_gem",
      entityId: gem.slug,
      prefix: "tags",
      lines: gem.tags || [],
      context: { source_url: gem.source_url || "" }
    }),
    buildString({
      entityType: "skill_gem",
      entityId: gem.slug,
      fieldPath: "detail.summary",
      sourceText: detail.summary_en,
      context: { source_url: gem.source_url || "" }
    }),
    ...lineStrings({
      entityType: "skill_gem",
      entityId: gem.slug,
      prefix: "detail.properties",
      lines: detail.properties || [],
      context: { source_url: gem.source_url || "" }
    }),
    ...lineStrings({
      entityType: "skill_gem",
      entityId: gem.slug,
      prefix: "detail.requirements",
      lines: detail.requirements || [],
      context: { source_url: gem.source_url || "" }
    }),
    ...lineStrings({
      entityType: "skill_gem",
      entityId: gem.slug,
      prefix: "detail.mods",
      lines: detail.mods || [],
      context: { source_url: gem.source_url || "" }
    }),
    ...sectionRows
  ]);
};

export const collectCurrencyContentStrings = (item = {}) => dedupeStrings([
  buildString({
    entityType: "currency",
    entityId: item.slug,
    fieldPath: "name",
    sourceText: item.name,
    context: { source_url: item.source_url || "", category: item.category || "" }
  }),
  buildString({
    entityType: "currency",
    entityId: item.slug,
    fieldPath: "category_label",
    sourceText: item.category_label,
    context: { source_url: item.source_url || "", category: item.category || "" }
  }),
  buildString({
    entityType: "currency",
    entityId: item.slug,
    fieldPath: "subtype_label",
    sourceText: item.subtype_label || item.family_label,
    context: { source_url: item.source_url || "", subtype: item.subtype || item.family || "" }
  }),
  buildString({
    entityType: "currency",
    entityId: item.slug,
    fieldPath: "description",
    sourceText: item.description_en,
    context: { source_url: item.source_url || "", category: item.category || "" }
  }),
  ...lineStrings({
    entityType: "currency",
    entityId: item.slug,
    prefix: "properties",
    lines: item.properties || [],
    context: { source_url: item.source_url || "", category: item.category || "" }
  }),
  ...lineStrings({
    entityType: "currency",
    entityId: item.slug,
    prefix: "mods",
    lines: item.mods || [],
    context: { source_url: item.source_url || "", category: item.category || "" }
  })
]);

export const createTranslationLookup = (rows = []) => {
  const lookup = new Map();
  for (const row of rows) {
    const key = contentStringKey(row.entity_type, row.entity_id, row.field_path, row.source_locale || DEFAULT_SOURCE_LOCALE);
    const entry = lookup.get(key) || { en: row.source_text, locales: new Map() };
    entry.en = row.source_text || entry.en;
    if (row.locale) {
      entry.locales.set(row.locale, {
        text: normalizeText(row.translated_text),
        status: row.translation_status || "missing",
        needs_review: Boolean(row.needs_review)
      });
    }
    lookup.set(key, entry);
  }
  return lookup;
};

export const buildI18nText = (
  lookup,
  entityType,
  entityId,
  fieldPath,
  sourceText,
  locales = DEFAULT_TARGET_LOCALES
) => {
  const cleanSource = normalizeText(sourceText);
  const row = lookup?.get(contentStringKey(entityType, entityId, fieldPath, DEFAULT_SOURCE_LOCALE));
  const payload = { en: row?.en || cleanSource };
  for (const locale of locales) {
    const translation = row?.locales.get(locale);
    payload[locale] = translation?.text && !translation.needs_review ? translation.text : payload.en;
  }
  return payload;
};

export const buildI18nList = (lookup, entityType, entityId, prefix, lines = [], locales = DEFAULT_TARGET_LOCALES) =>
  lines.map((line, index) => buildI18nText(lookup, entityType, entityId, `${prefix}.${index}`, line, locales));

export const parseLocales = (value = process.env.POE2_LOCALES || DEFAULT_TARGET_LOCALES.join(",")) =>
  String(value)
    .split(",")
    .map((locale) => locale.trim().toLowerCase())
    .filter((locale) => locale && locale !== DEFAULT_SOURCE_LOCALE);

export const upsertContentStrings = async (client, strings = [], {
  runId,
  locales = parseLocales()
} = {}) => {
  const payload = dedupeStrings(strings);
  if (!payload.length) return { total_count: 0, locale_count: locales.length };

  await client.query(`
    with incoming as (
      select *
      from jsonb_to_recordset($1::jsonb) as payload(
        entity_type text,
        entity_id text,
        field_path text,
        source_locale text,
        source_text text,
        source_hash text,
        context_json jsonb
      )
    ),
    changed as (
      select cs.id
      from content_strings cs
      join incoming i
        on cs.entity_type = i.entity_type
       and cs.entity_id = i.entity_id
       and cs.field_path = i.field_path
       and cs.source_locale = i.source_locale
      where cs.source_hash <> i.source_hash
    ),
    upserted as (
      insert into content_strings
        (entity_type, entity_id, field_path, source_locale, source_text, source_hash,
         context_json, status, first_seen_run_id, last_seen_run_id, updated_at)
      select entity_type, entity_id, field_path, source_locale, source_text, source_hash,
        coalesce(context_json, '{}'::jsonb), 'active', $2, $2, now()
      from incoming
      on conflict (entity_type, entity_id, field_path, source_locale) do update
      set source_text = excluded.source_text,
          source_hash = excluded.source_hash,
          context_json = excluded.context_json,
          status = 'active',
          last_seen_run_id = excluded.last_seen_run_id,
          updated_at = now()
      returning id, source_locale
    ),
    seeded as (
      insert into content_translations
        (string_id, locale, translated_text, translation_status, needs_review, reviewed_source_hash, updated_at)
      select upserted.id, locale, '', 'missing', false, null, now()
      from upserted
      cross join unnest($3::text[]) as locale
      where locale <> upserted.source_locale
      on conflict (string_id, locale) do nothing
      returning string_id
    )
    update content_translations
    set needs_review = true,
        translation_status = case
          when translation_status = 'missing' then 'missing'
          else 'needs_review'
        end,
        updated_at = now()
    where string_id in (select id from changed)
      and locale <> $4
  `, [JSON.stringify(payload), runId || null, locales, DEFAULT_SOURCE_LOCALE]);

  return { total_count: payload.length, locale_count: locales.length };
};

export const loadTranslationLookup = async (pool, {
  entityTypes = [],
  locales = DEFAULT_TARGET_LOCALES
} = {}) => {
  const params = [locales];
  const where = [];
  if (entityTypes.length) {
    params.push(entityTypes);
    where.push(`cs.entity_type = any($${params.length}::text[])`);
  }
  const { rows } = await pool.query(`
    select
      cs.entity_type,
      cs.entity_id,
      cs.field_path,
      cs.source_locale,
      cs.source_text,
      ct.locale,
      ct.translated_text,
      ct.translation_status,
      ct.needs_review
    from content_strings cs
    left join content_translations ct
      on ct.string_id = cs.id
     and ct.locale = any($1::text[])
    ${where.length ? `where ${where.join(" and ")}` : ""}
  `, params);
  return createTranslationLookup(rows);
};

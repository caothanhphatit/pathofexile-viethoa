import dotenv from "dotenv";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { closePool, createPool } from "../src/db/pool.mjs";
import { translateCurrencyText } from "./currency-lib.mjs";
import { translateItemLine } from "./items/items-lib.mjs";
import {
  translateSkillDetailLine,
  translateSkillText
} from "./skill-gems-lib.mjs";
import { translatePassiveStatLine } from "./passive-tree/passive-tree-lib.mjs";

dotenv.config();

const DEFAULT_LOCALE = "vi";

const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const preserveSource = (row) => row.source_text || "";

export const translateContentString = (row, locale = DEFAULT_LOCALE) => {
  if (locale !== "vi") return "";
  const fieldPath = row.field_path || "";
  const source = row.source_text || "";

  if (row.entity_type === "item") {
    if (fieldPath === "name" || /^tooltip_refs\.\d+\.label$/.test(fieldPath)) return source;
    if (/^(properties|requirements|mods)\.\d+$/.test(fieldPath)) return translateItemLine(source);
    return preserveSource(row);
  }

  if (row.entity_type === "skill_gem") {
    if (fieldPath === "name" || /^tags\.\d+$/.test(fieldPath)) return source;
    if (fieldPath === "detail.summary") return translateSkillText(source);
    if (/^detail\.(properties|requirements|mods)\.\d+$/.test(fieldPath)) return translateSkillDetailLine(source);
    if (/^detail\.sections\.\d+\.title$/.test(fieldPath)) return source;
    if (/^detail\.sections\.\d+\.lines\.\d+$/.test(fieldPath)) return translateSkillDetailLine(source);
    return preserveSource(row);
  }

  if (row.entity_type === "currency") {
    if (["name", "category_label", "subtype_label"].includes(fieldPath)) return source;
    if (fieldPath === "description" || /^mods\.\d+$/.test(fieldPath)) return translateCurrencyText(source);
    if (/^properties\.\d+$/.test(fieldPath)) return source;
    return preserveSource(row);
  }

  if (row.entity_type === "passive_tree_node") {
    if (/^stats\.\d+$/.test(fieldPath)) return translatePassiveStatLine(source);
    return preserveSource(row);
  }

  return preserveSource(row);
};

export const retranslateContent = async (pool, {
  locale = DEFAULT_LOCALE,
  limit = 0
} = {}) => {
  const params = [];
  const limitSql = Number(limit) > 0 ? `limit ${Number(limit)}` : "";
  const { rows } = await pool.query(`
    select id, entity_type, entity_id, field_path, source_locale, source_text, source_hash
    from content_strings
    where source_locale = 'en'
      and status = 'active'
    order by entity_type, entity_id, field_path
    ${limitSql}
  `, params);

  const payload = rows.map((row) => ({
    string_id: row.id,
    locale,
    translated_text: translateContentString(row, locale),
    translation_status: locale === "vi" ? "auto" : "missing",
    needs_review: false,
    reviewed_source_hash: row.source_hash
  }));

  if (payload.length) {
    await pool.query(`
      insert into content_translations
        (string_id, locale, translated_text, translation_status, needs_review, reviewed_source_hash, updated_at)
      select string_id, locale, translated_text, translation_status, needs_review, reviewed_source_hash, now()
      from jsonb_to_recordset($1::jsonb) as payload(
        string_id bigint,
        locale text,
        translated_text text,
        translation_status text,
        needs_review boolean,
        reviewed_source_hash text
      )
      on conflict (string_id, locale) do update
      set translated_text = excluded.translated_text,
          translation_status = excluded.translation_status,
          needs_review = excluded.needs_review,
          reviewed_source_hash = excluded.reviewed_source_hash,
          updated_at = now()
      where content_translations.translation_status <> 'manual'
    `, [JSON.stringify(payload)]);
  }

  return {
    locale,
    total: payload.length,
    translated: payload.filter((row) => row.translated_text).length
  };
};

const isMainModule = () => {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
};

if (isMainModule()) {
  const args = parseCliArgs();
  const pool = createPool();
  try {
    const result = await retranslateContent(pool, {
      locale: args.get("locale") || DEFAULT_LOCALE,
      limit: Number(args.get("limit") || 0)
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closePool(pool);
  }
}

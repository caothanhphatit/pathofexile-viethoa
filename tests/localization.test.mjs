import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildI18nList,
  buildI18nText,
  collectCurrencyContentStrings,
  collectItemContentStrings,
  collectPassiveTreeContentStrings,
  collectSkillGemContentStrings,
  contentStringKey,
  createTranslationLookup,
  loadTranslationLookup
} from "../src/localization/content-strings.mjs";
import { exportCurrenciesPostgres } from "../scripts/currency/runtime.mjs";
import { exportSkillGemsPostgres } from "../scripts/skill-gems/runtime.mjs";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("content string collectors extract English source lines by stable field path", () => {
  const itemStrings = collectItemContentStrings({
    slug: "Iron_Claw",
    name: "Iron Claw",
    source_url: "https://poe2db.tw/us/Iron_Claw",
    menu_key: "claws",
    properties: ["Claw"],
    requirements: ["Requires Level 4, 14 Dex, 14 Int"],
    mods: ["Attack Skills gain 3 Life per Enemy Hit"],
    tooltip_refs: [{ label: "Attack", term: "Attack", keyword: "Attack" }]
  });
  const skillStrings = collectSkillGemContentStrings({
    slug: "Boneshatter",
    name: "Boneshatter",
    tags: ["Attack", "AoE"],
    detail: {
      summary_en: "Attack enemies with a melee Strike.",
      properties: ["Tier: 1"],
      requirements: ["Requires: Level 1"],
      mods: ["+2 to Melee Strike Range"],
      sections: [{ title: "Initial Strike", lines: ["Deals damage"] }]
    }
  });
  const currencyStrings = collectCurrencyContentStrings({
    slug: "Chaos_Orb",
    name: "Chaos Orb",
    category_label: "Currency",
    subtype_label: "Crafting Orb",
    description_en: "Removes a random modifier",
    properties: ["Stack Size: 1 / 20"],
    mods: ["Removes a random modifier"]
  });
  const passiveStrings = collectPassiveTreeContentStrings({
    id: "101",
    name: "Lightning Damage",
    stats: ["12% increased Lightning Damage"],
    source_url: "https://raw.githubusercontent.com/example/tree.json"
  });

  assert.deepEqual(itemStrings.map((row) => row.field_path), [
    "name",
    "properties.0",
    "requirements.0",
    "mods.0",
    "tooltip_refs.0.label"
  ]);
  assert.ok(skillStrings.some((row) => row.field_path === "detail.sections.0.lines.0"));
  assert.ok(currencyStrings.some((row) => row.field_path === "description"));
  assert.deepEqual(passiveStrings.map((row) => row.field_path), ["stats.0"]);
  assert.ok([...itemStrings, ...skillStrings, ...currencyStrings, ...passiveStrings].every((row) =>
    row.source_locale === "en" && /^[a-f0-9]{64}$/.test(row.source_hash)
  ));
});

test("translation lookup builds i18n payloads with English fallback per locale", () => {
  const lookup = createTranslationLookup([
    {
      entity_type: "item",
      entity_id: "Iron_Claw",
      field_path: "name",
      source_locale: "en",
      source_text: "Iron Claw",
      locale: "vi",
      translated_text: "Móng Sắt",
      translation_status: "manual",
      needs_review: false
    },
    {
      entity_type: "item",
      entity_id: "Iron_Claw",
      field_path: "mods.0",
      source_locale: "en",
      source_text: "Attack Skills gain 3 Life per Enemy Hit",
      locale: "vi",
      translated_text: "",
      translation_status: "missing",
      needs_review: false
    }
  ]);

  assert.equal(contentStringKey("item", "Iron_Claw", "name", "en"), "item|Iron_Claw|name|en");
  assert.deepEqual(buildI18nText(lookup, "item", "Iron_Claw", "name", "Iron Claw", ["vi"]), {
    en: "Iron Claw",
    vi: "Móng Sắt"
  });
  assert.deepEqual(buildI18nList(lookup, "item", "Iron_Claw", "mods", ["Attack Skills gain 3 Life per Enemy Hit"], ["vi"]), [{
    en: "Attack Skills gain 3 Life per Enemy Hit",
    vi: "Attack Skills gain 3 Life per Enemy Hit"
  }]);
});

test("loadTranslationLookup filters requested locales in the join so English fallback remains available", async () => {
  let capturedSql = "";
  let capturedParams = [];
  const fakePool = {
    async query(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [{
          entity_type: "item",
          entity_id: "Iron_Claw",
          field_path: "name",
          source_locale: "en",
          source_text: "Iron Claw",
          locale: null,
          translated_text: null,
          translation_status: null,
          needs_review: null
        }]
      };
    }
  };

  const lookup = await loadTranslationLookup(fakePool, { entityTypes: ["item"], locales: ["vi"] });

  assert.match(capturedSql, /left join content_translations ct\s+on ct\.string_id = cs\.id\s+and ct\.locale = any\(\$1::text\[\]\)/i);
  assert.deepEqual(capturedParams, [["vi"], ["item"]]);
  assert.deepEqual(buildI18nText(lookup, "item", "Iron_Claw", "name", "Iron Claw", ["vi"]), {
    en: "Iron Claw",
    vi: "Iron Claw"
  });
});

test("Postgres migrations define normalized localization tables", async () => {
  const migration = await readText("migrations/002_content_localization.sql");

  assert.match(migration, /create table if not exists content_strings/i);
  assert.match(migration, /create table if not exists content_translations/i);
  assert.match(migration, /unique \(entity_type, entity_id, field_path, source_locale\)/i);
  assert.match(migration, /primary key \(string_id, locale\)/i);
  assert.match(migration, /idx_content_strings_entity/i);
  assert.match(migration, /idx_content_translations_locale_status/i);
});

test("crawl runtimes write source text to content_strings instead of source-record translations", async () => {
  const [itemsRuntime, skillRuntime, currencyRuntime, passiveTreeRuntime, itemsLib] = await Promise.all([
    readText("scripts/items/runtime.mjs"),
    readText("scripts/skill-gems/runtime.mjs"),
    readText("scripts/currency/runtime.mjs"),
    readText("scripts/passive-tree/runtime.mjs"),
    readText("scripts/items/items-lib.mjs")
  ]);

  assert.match(itemsRuntime, /upsertContentStrings/);
  assert.match(skillRuntime, /upsertContentStrings/);
  assert.match(currencyRuntime, /upsertContentStrings/);
  assert.match(passiveTreeRuntime, /upsertContentStrings/);
  assert.doesNotMatch(itemsLib, /translated:\s*\{/);
});

test("skill gem export emits clean i18n payload without legacy Vietnamese fields", async () => {
  const fakePool = {
    async query(sql) {
      if (/from content_strings cs/i.test(sql)) {
        return {
          rows: [{
            entity_type: "skill_gem",
            entity_id: "Boneshatter",
            field_path: "detail.summary",
            source_locale: "en",
            source_text: "Attack enemies with a melee Strike.",
            locale: "vi",
            translated_text: "Tấn công kẻ địch bằng melee Strike.",
            translation_status: "auto",
            needs_review: false
          }]
        };
      }
      if (/from skill_gems g/i.test(sql)) {
        return {
          rows: [{
            slug: "Boneshatter",
            name: "Boneshatter",
            tier: 1,
            color: "red",
            source_url: "https://poe2db.tw/us/Boneshatter",
            icon_url: "",
            icon_alt: "",
            hover_url: "",
            tags_json: ["Attack"],
            source_hash: "a".repeat(64),
            status: "active",
            updated_at: "2026-05-23T00:00:00.000Z",
            summary_en: "Attack enemies with a melee Strike.",
            properties_json: [],
            requirements_json: [],
            mods_json: [],
            sections_json: [],
            detail_hash: "b".repeat(64)
          }]
        };
      }
      if (/from crawl_runs/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };

  const payload = await exportSkillGemsPostgres(fakePool);
  const gem = payload.gems[0];

  assert.deepEqual(gem.i18n.summary, {
    en: "Attack enemies with a melee Strike.",
    vi: "Tấn công kẻ địch bằng melee Strike."
  });
  assert.equal("vi_name" in gem, false);
  assert.equal("summary_vi" in gem, false);
  assert.equal("mods_vi" in gem, false);
});

test("currency export emits clean i18n payload without legacy Vietnamese fields", async () => {
  const fakePool = {
    async query(sql) {
      if (/from content_strings cs/i.test(sql)) {
        return {
          rows: [{
            entity_type: "currency",
            entity_id: "Chaos_Orb",
            field_path: "description",
            source_locale: "en",
            source_text: "Removes a random modifier",
            locale: "vi",
            translated_text: "Xóa một modifier ngẫu nhiên.",
            translation_status: "auto",
            needs_review: false
          }]
        };
      }
      if (/from currency_items/i.test(sql)) {
        return {
          rows: [{
            slug: "Chaos_Orb",
            name: "Chaos Orb",
            category: "StackableCurrencyItem",
            category_label: "Currency",
            family: "crafting-orb",
            family_label: "Crafting Orb",
            subtype: "crafting-orb",
            subtype_label: "Crafting Orb",
            source_url: "https://poe2db.tw/us/Chaos_Orb",
            icon_url: "",
            icon_alt: "",
            hover_url: "",
            stack_size: "1 / 20",
            description_en: "Removes a random modifier",
            properties_json: [],
            mods_json: [],
            source_hash: "c".repeat(64),
            status: "active",
            updated_at: "2026-05-23T00:00:00.000Z"
          }]
        };
      }
      if (/from crawl_runs/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };

  const payload = await exportCurrenciesPostgres(fakePool);
  const item = payload.items[0];

  assert.deepEqual(item.i18n.description, {
    en: "Removes a random modifier",
    vi: "Xóa một modifier ngẫu nhiên."
  });
  assert.equal("description_vi" in item, false);
  assert.equal("mods_vi" in item, false);
});

test("content translation CLI is wired for retranslation after crawl", async () => {
  const [packageJson, script] = await Promise.all([
    readText("package.json"),
    readText("scripts/retranslate-content.mjs")
  ]);

  assert.match(packageJson, /"translate:content": "node scripts\/retranslate-content\.mjs"/);
  assert.match(packageJson, /"rebuild:data": "node src\/db\/migrate\.mjs && npm run crawl:all && npm run translate:content && npm run export:all"/);
  assert.match(script, /translateContentString/);
  assert.match(script, /content_translations/);
});

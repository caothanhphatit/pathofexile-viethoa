import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const hardcodedRemoteDatabaseUrl = /postgres(?:ql)?:\/\/[^:@\s]+:[^@\s]+@(?!localhost\b|127\.0\.0\.1\b|\[::1\])[^\s"'`]+/i;

test("PostgreSQL migration defines production tables, jsonb payloads, and active indexes", async () => {
  const [coreMigration, localizationMigration, cleanupMigration, authMigration, relatedItemsMigration, commentsMigration] = await Promise.all([
    readText("migrations/001_core_schema.sql"),
    readText("migrations/002_content_localization.sql"),
    readText("migrations/003_drop_legacy_localization.sql"),
    readText("migrations/004_auth_leveling_accounts.sql"),
    readText("migrations/005_currency_related_items.sql"),
    readText("migrations/006_translation_comments.sql")
  ]);
  const migration = `${coreMigration}\n${localizationMigration}\n${cleanupMigration}\n${authMigration}\n${relatedItemsMigration}\n${commentsMigration}`;

  for (const table of [
    "schema_migrations",
    "users",
    "auth_accounts",
    "user_sessions",
    "leveling_characters",
    "leveling_character_progress",
    "leveling_log_cursors",
    "crawl_runs",
    "dictionary_terms",
    "skill_gems",
    "skill_gem_details",
    "skill_gem_versions",
    "currency_items",
    "currency_versions",
    "item_menus",
    "items",
    "item_versions",
    "item_tooltip_refs",
    "translation_comments"
  ]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}\\b`, "i"), `${table} table exists`);
  }

  assert.match(cleanupMigration, /drop table if exists skill_gem_translations/i);
  assert.match(cleanupMigration, /drop column if exists summary_vi/i);
  assert.match(cleanupMigration, /drop column if exists description_vi/i);
  assert.match(cleanupMigration, /drop column if exists translated_json/i);
  assert.match(migration, /\bjsonb\b/i);
  assert.match(migration, /related_items_json jsonb not null default '\[\]'::jsonb/i);
  assert.match(migration, /idx_currency_items_related_gin/i);
  assert.match(migration, /where status = 'active'/i);
  assert.match(migration, /provider_user_id/i);
  assert.match(migration, /session_hash/i);
  assert.match(migration, /unique \(provider, provider_user_id\)/i);
  assert.match(migration, /unique \(user_id, name\)/i);
  assert.match(migration, /user_id text not null references users\(id\) on delete cascade/i);
  assert.match(migration, /idx_translation_comments_entity_created/i);
  assert.match(migration, /idx_translation_comments_user_created/i);
  assert.match(migration, /using gin/i);
  assert.doesNotMatch(migration, /autoincrement|last_insert_rowid|integer primary key autoincrement/i);
});

test("database runtime uses env config and migrations without hardcoded secrets", async () => {
  const [pool, migrate, envExample] = await Promise.all([
    readText("src/db/pool.mjs"),
    readText("src/db/migrate.mjs"),
    readText(".env.example")
  ]);

  assert.match(pool, /POE2_DATABASE_URL/);
  assert.match(pool, /new Pool/);
  assert.match(pool, /withTransaction/);
  assert.match(migrate, /schema_migrations/);
  assert.match(migrate, /migrations/);
  assert.doesNotMatch(`${pool}\n${migrate}\n${envExample}`, hardcodedRemoteDatabaseUrl);
});

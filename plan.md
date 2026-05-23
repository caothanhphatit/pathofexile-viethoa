# POE2 PostgreSQL Backend And Items Crawl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the app from local SQLite-backed scripts to a production PostgreSQL-backed backend, keep the public site fast, and crawl all PoE2DB `Items` menus/items with Vietnamese tooltip glossary support.

**Architecture:** PostgreSQL becomes the source of truth. A Node.js Fastify backend exposes public read APIs and admin crawl/export endpoints. The existing static frontend remains fast by reading generated `*-data.js` files, while backend APIs support larger searchable data and future multi-user usage.

**Tech Stack:** Node.js ESM, Fastify, PostgreSQL `pg` pool, Cheerio crawler/parser, Zod validation, SQL migrations, static JS export files.

---

## Non-Negotiables

- Never commit a real PostgreSQL connection string or password.
- Use `POE2_DATABASE_URL` from environment at runtime.
- Keep frontend static data exports for fast page loads.
- Backend and crawler must be resumable enough that a partial crawl does not corrupt existing data.
- Store source English, Vietnamese translation, tooltip references, and source hash for change detection.
- Dictionary-supported terms must remain in English in visible text and be available for hover meaning in Vietnamese.

## Target File Structure

- Create `migrations/001_core_schema.sql`: PostgreSQL schema for crawl runs, skill gems, currency, dictionary, item menus, item records, item versions, tooltip references, and indexes.
- Create `src/db/pool.mjs`: pooled PostgreSQL client, transaction helper, and graceful shutdown.
- Create `src/db/migrate.mjs`: migration runner with `schema_migrations`.
- Create `src/db/query.mjs`: small query helpers.
- Create `src/server/app.mjs`: Fastify app factory with security, CORS, compression, routes, and error handling.
- Create `src/server/index.mjs`: backend entrypoint.
- Create `src/server/routes/public.mjs`: public read endpoints for health, dictionary, items, skill gems, and currency.
- Create `src/server/routes/admin.mjs`: token-protected crawl/export endpoints.
- Create `scripts/items/items-lib.mjs`: PoE2DB item menu parser, item page parser, tooltip extraction, and Vietnamese text helpers.
- Create `scripts/items/runtime.mjs`: runtime functions for fetching PoE2DB, Postgres repositories, crawl orchestration, and exports.
- Create `scripts/crawl-items.mjs`: CLI crawl entrypoint for `https://poe2db.tw/us/Items`.
- Create `scripts/export-items.mjs`: export `items-data.js` from PostgreSQL.
- Create `tests/postgres-schema.test.mjs`: static schema safety tests for indexes, constraints, and no SQLite syntax.
- Create `tests/items-crawler.test.mjs`: parser tests for Items menu and Claws-like item pages.
- Modify `scripts/skill-gems/runtime.mjs`: use PostgreSQL repo instead of SQLite for production scripts.
- Modify `scripts/currency/runtime.mjs`: use PostgreSQL repo instead of SQLite for production scripts.
- Modify `package.json`: add backend, migration, crawl/export scripts and dependencies.
- Modify `.env.example`: document safe environment variables only.

## Data Model

PostgreSQL tables:

- `crawl_runs`: one row per crawl/export operation.
- `dictionary_terms`: English term, Vietnamese meaning, category, examples, variants, tooltip metadata.
- `skill_gems`, `skill_gem_details`, `skill_gem_versions`.
- `currency_items`, `currency_versions`.
- `item_menus`: every menu/category under PoE2DB Items, including parent label and source URL.
- `items`: every crawled item/base entry with menu key, name, source URL, icon, requirements, properties, implicit/mod text, raw JSON, tooltip refs, source hash, and status.
- `content_strings`: English source strings keyed by entity, field path, and source locale.
- `content_translations`: per-locale translated strings keyed by source string and locale.
- `item_versions`: previous/next JSON snapshots for changed items.
- `item_tooltip_refs`: terms discovered from item pages, linked to dictionary terms where possible.

Indexes:

- Unique keys on slugs and source URLs.
- Partial indexes on active records.
- Composite indexes for common filters: `(menu_key, status)`, `(category, status)`, `(updated_at)`.
- GIN indexes on JSONB fields used for tags/search metadata.

## API Shape

Public:

- `GET /health`
- `GET /api/dictionary?q=&category=&limit=&offset=`
- `GET /api/items/menus`
- `GET /api/items?menu=&q=&status=&limit=&offset=`
- `GET /api/items/:slug`
- `GET /api/skill-gems?q=&tag=&limit=&offset=`
- `GET /api/currency?q=&subtype=&limit=&offset=`

Admin, protected by `ADMIN_API_TOKEN`:

- `POST /api/admin/crawl/items`
- `POST /api/admin/export/items`
- `POST /api/admin/export/all`

## Implementation Tasks

### Task 1: Add Safe Config And Dependency Baseline

- [ ] Add dependencies: `fastify`, `@fastify/cors`, `@fastify/helmet`, `@fastify/compress`, `pg`, `zod`, `dotenv`.
- [ ] Add `.env.example` with placeholders only:

```env
POE2_DATABASE_URL=postgresql://postgres:change-me@localhost:5432/poe2
PORT=3000
HOST=127.0.0.1
ADMIN_API_TOKEN=change-me
ALLOWED_ORIGINS=http://127.0.0.1:4173,http://localhost:4173
```

- [ ] Add npm scripts:

```json
{
  "db:migrate": "node src/db/migrate.mjs",
  "server": "node src/server/index.mjs",
  "crawl:items": "node scripts/crawl-items.mjs",
  "export:items": "node scripts/export-items.mjs",
  "export:all": "node scripts/export-skill-gems.mjs && node scripts/export-currency.mjs && node scripts/export-items.mjs"
}
```

- [ ] Run `npm test`; expected: current tests still pass.

### Task 2: Add PostgreSQL Schema

- [ ] Write failing tests in `tests/postgres-schema.test.mjs` asserting:
  - migrations use `jsonb`.
  - migrations include `schema_migrations`.
  - migrations include item tables and partial active indexes.
  - migrations do not contain SQLite-only `AUTOINCREMENT` or `last_insert_rowid`.
- [ ] Run `npm test -- tests/postgres-schema.test.mjs`; expected: fail before migration exists.
- [ ] Create `migrations/001_core_schema.sql`.
- [ ] Include idempotent PostgreSQL DDL with `bigserial`, `timestamptz`, `jsonb`, `ON CONFLICT`-friendly unique constraints, and indexes.
- [ ] Run schema test; expected: pass.

### Task 3: Add DB Pool And Migration Runner

- [ ] Write tests checking `src/db/pool.mjs` does not hardcode a database URL and `src/db/migrate.mjs` reads files from `migrations`.
- [ ] Implement `createPool`, `query`, `withTransaction`, `closePool`.
- [ ] Implement migration runner:
  - creates `schema_migrations`.
  - records filename and checksum.
  - runs each migration once inside a transaction.
- [ ] Run `npm test`; expected: pass.

### Task 4: Build Fastify Backend Skeleton

- [ ] Write tests checking backend files expose `/health`, public routes, admin token guard, and no secret literals.
- [ ] Implement `src/server/app.mjs`.
- [ ] Implement `src/server/index.mjs`.
- [ ] Implement public routes with repository stubs reading PostgreSQL.
- [ ] Implement admin token guard.
- [ ] Run `npm test`; expected: pass.

### Task 5: Build Items Parser

- [ ] Write parser tests using sample snippets from PoE2DB `Items` and `Claws`.
- [ ] Implement `parseItemsMenu(html, sourceUrl)`:
  - extracts menu groups like One Handed Weapons, Armour, Currency, Waystones.
  - returns label, href, group label, menu key.
- [ ] Implement `parseItemListingPage(html, menu)`:
  - extracts item name, icon, source URL, requirements, properties, mods, and keyword refs.
  - filters out unrelated calculator/import/crafting panels.
- [ ] Implement `translateItemLine` preserving dictionary terms while translating surrounding explanation.
- [ ] Run `npm test -- tests/items-crawler.test.mjs`; expected: pass.

### Task 6: Add Items PostgreSQL Repository And Export

- [ ] Add repository functions in `scripts/items/runtime.mjs`:
  - `upsertItemMenus(client, menus, runId)`.
  - `upsertItems(client, items, runId)`.
  - `exportItems(client)`.
- [ ] Use atomic `INSERT ... ON CONFLICT` and short transactions.
- [ ] Store `raw_json` and `tooltip_refs_json`; all localized text lives in `content_strings` and `content_translations`.
- [ ] Export `items-data.js` as `window.POE2_ITEMS = ...`.
- [ ] Run tests; expected: pass.

### Task 7: Wire Crawl Items CLI

- [ ] Implement `scripts/crawl-items.mjs`.
- [ ] Default source: `https://poe2db.tw/us/Items`.
- [ ] Crawl all menus under the Items page.
- [ ] Limit concurrency to a small number to avoid hammering PoE2DB.
- [ ] Log progress as JSON lines.
- [ ] On failures, record failed menu/item URL in run metadata and continue.
- [ ] Run `npm run crawl:items` with `POE2_DATABASE_URL` set.
- [ ] Run `npm run export:items`.

### Task 8: Port Existing Skill Gem And Currency Persistence To PostgreSQL

- [ ] Keep parser/translation functions pure.
- [x] Replace SQLite runtime persistence with Postgres repositories.
- [ ] Preserve existing generated frontend data shape.
- [x] Remove old SQLite helpers after tests are ported.
- [ ] Run `npm test`; expected: pass.

### Task 9: Dictionary Hover Support For Items UI

- [ ] Export dictionary terms with stable lookup keys.
- [ ] Add shared frontend helper `components/term-hover.js`.
- [ ] Add hover spans to item Vietnamese descriptions for dictionary-backed terms.
- [ ] Keep visible terms in English when the dictionary says the term is preserved.
- [ ] Verify in browser that item text hover shows Vietnamese meaning.

### Task 10: Cleanup And Production Verification

- [x] Remove obsolete SQLite write paths.
- [x] Remove obsolete local SQLite database file after Postgres export is verified.
- [x] Add cleanup migration that drops legacy localization columns/tables after the normalized i18n schema is available.
- [x] Run `npm test`.
- [x] Run `npm run db:migrate` against PostgreSQL.
- [x] Run `npm run crawl:all` against PostgreSQL.
- [x] Run `npm run translate:content`.
- [x] Run `npm run export:all`.
- [x] Start local static test server for frontend smoke testing.
- [x] Browser smoke test public pages using static exports.
- [ ] Rotate any development PostgreSQL credentials before production use.

### Task 11: Rebuild Text Localization Store

- [x] Add `content_strings` for English source text keyed by entity, field path, and source locale.
- [x] Add `content_translations` for per-locale translations with `missing`, `manual`, and `needs_review` workflow.
- [x] Collect localizable text during item, skill gem, and currency crawls.
- [x] Export i18n payloads shaped as `{ en, vi }` with English fallback while translations are missing.
- [x] Stop item parser from embedding auto Vietnamese translations in source records.
- [x] Convert existing JS snapshots to the new `i18n` payload shape while PostgreSQL is unavailable.
- [x] Run `npm test`.

## Self-Review

- Spec coverage: Backend, PostgreSQL migration, static export, Items crawl, tooltip dictionary hover, cleanup, and verification are covered.
- Placeholder scan: No implementation task uses TBD/TODO as a required action.
- Type consistency: Naming uses `items`, `item_menus`, `item_versions`, `item_tooltip_refs`, `POE2_DATABASE_URL`, and `POE2_ITEMS` consistently.

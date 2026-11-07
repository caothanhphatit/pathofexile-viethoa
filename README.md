# Path of Exile Việt Hóa Monorepo

Workspace chung cho trang tham khảo POE2 tiếng Việt và ứng dụng desktop POEVH.

## Layout

- `public/`: browser-facing static app, compiled CSS, shared UI helpers, images, and generated data exports.
- `src/`: backend, database, localization, and source CSS.
- `scripts/`: crawlers, exporters, translation rebuilds, and local static serving.
- `migrations/`: PostgreSQL schema migrations.
- `tests/`: Node test suite.
- `apps/poevh-desktop/`: ứng dụng desktop Rust quản lý instance, overlay, price-check,
  memory reader, virtual controller và các công cụ PoE2.

## What Is Included

- Production static pages for patch notes, dictionary, weapon basics, skill gems, currency, and leveling.
- Shared frontend shell, theme boot, dictionary tooltip modal, and data-page utilities.
- Fastify backend for health checks, public read APIs, account/log routes, and token-protected admin crawl/export endpoints.
- PostgreSQL migrations and crawl/export scripts for skill gems, currency, dictionary terms, and items.
- Node test suite covering parsers, translation cleanup, backend route shape, frontend listing behavior, and performance guards.

## Local Setup

```bash
npm install
npm run build
npm test
npm run site
```

POEVH desktop:

```bash
npm run poevh:check
npm run poevh:test
npm run poevh:clippy
npm run poevh:build
```

For backend and crawler workflows, copy `.env.example` to `.env` and fill local values:

```bash
npm run db:migrate
npm run crawl:all
npm run translate:content
npm run export:all
npm run server
```

Do not commit real database URLs, OAuth secrets, admin tokens, or local `.env` files.

### Checking the crawled data against the game files

`npm run check:game-data` reads BaseItemTypes, ItemClasses, UniqueStashLayout and Words
straight out of the installed game's `Content.ggpk` (via the GGPK helper in
`apps/poevh-desktop/tools/poevh-ggpk-patcher`) and compares the names with
`public/data/items-data.js` and `public/data/skill-gems-data.js`. It prints what the
game has that the web data lacks (run the crawlers again) and what the web data has
that the game no longer does (renamed or removed), and writes the full lists to
`data/game-extract/check/latest.json`. Pass `--game=<install dir>` when the game is
not in the default location, and `--strict` to fail the command when the web data is
behind the game.

Some gems and uniques exist in the game but are left off poe2db's list pages.
`npm run fill:missing` reads the latest check report and pulls each of those from its
own poe2db detail page into the data files (rows are tagged `source: "poe2db-detail"`).
It skips gems poe2db marks `[DNT-UNUSED]`, name templates like `Companion: {0}`, and
dev entries. Run it after the crawlers and exports, since those rewrite the files:

```bash
npm run crawl:skill-gems && node scripts/merge-support-gems-data.mjs
npm run crawl:items && npm run translate:content && npm run export:items
npm run check:game-data
npm run fill:missing
```

### Extracting data straight from the game (GGPK)

The long-term plan is for the game files to be the source of truth and poe2db only a
fallback (unique mod lists, pre-rendered text). `scripts/ggpk/reader.mjs` is the shared
reader: it pulls `data/balance/*.datc64` tables out of `Content.ggpk` through the GGPK
helper and decodes them with the poe-tool-dev schema, expanding arrays and tolerating
columns a new patch appended before the schema caught up (`trailingBytes`).

- `npm run extract:game-base-items` writes every equipment base (id, class, size,
  defences, weapon stats with elemental conversion applied, requirements, tags, implicit
  mod ids, icon) to `data/game-extract/ggpk/base-items.json` and compares each shared
  base with `items-data.js`.

Output under `data/game-extract/ggpk/` is regenerated from the install and is not
committed.

## Production Routing

The static pages use clean URLs such as `/dictionary`, `/skill-gems`, `/currency`, and `/leveling`.
When serving with nginx, include `deploy/nginx/poeviethoa-clean-routes.conf` inside the site server block so those URLs map directly to their matching HTML files instead of falling through to `404.html`.

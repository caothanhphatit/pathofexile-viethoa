# Path of Exile Việt Hóa Monorepo

Workspace chung cho trang tham khảo POE2 tiếng Việt và ứng dụng desktop POEVH.

## Layout

- `public/`: the SPA shell (`index.html`), built assets in `dist/`, images, generated data
  exports in `data/`, guide article sources in `content/` and published POEVH builds in
  `downloads/poevh/` (generated, not committed).
- `src/spa/`: the React app. Every page of the site is a route in `src/spa/lib/routes.ts`;
  there are no standalone HTML pages any more.
- `src/`: also the backend, database, localization, and the Tailwind source used only by
  the guide articles in `public/content/`.
- `scripts/`: crawlers, exporters, translation rebuilds, and local static serving.
- `migrations/`: PostgreSQL schema migrations.
- `tests/`: Node test suite.
- `apps/poevh-desktop/`: ứng dụng desktop Rust quản lý instance, overlay, price-check,
  memory reader, virtual controller và các công cụ PoE2.

## What Is Included

- One React app for patch notes, lookup, dictionary, items, skill gems, currency, passive
  tree, build planner, leveling, craft simulator, bosses, Premium and the POEVH download page.
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
npm run poevh:publish -- --notes="Ghi chú 1|Ghi chú 2"
```

`poevh:publish` copies the release exe to `public/downloads/poevh/` and writes the
`latest.json` the `/tai-app` page reads (version, size, SHA-256, notes). Upload both with
the rest of `public/` when deploying.

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

## Premium

Premium belongs to a web account. Paid periods are granted by an admin for now (no
payment gateway yet) and stack end to end. Each account can create one key for client
apps, and a key works on one device at a time.

1. Create the signing key once and put it in the server `.env`:

   ```bash
   node scripts/premium-keygen.mjs
   ```

   `PREMIUM_SIGNING_KEY` stays on the server. The printed public key is what apps embed;
   it is also served at `GET /api/premium/public-key`. Set `TRUST_PROXY=1` behind nginx so
   rate limits and device logs see the visitor's IP.

2. Grant a plan (`month`, `year`, `lifetime`, or `custom` with `days`):

   ```bash
   curl -X POST https://<site>/api/admin/premium/grant      -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "content-type: application/json"      -d '{"email":"player@example.com","plan":"month"}'
   ```

   Also: `GET /api/admin/premium/user?email=…`, `POST /api/admin/premium/revoke`
   (`subscription_id`), `POST /api/admin/premium/release-device` (frees the device at once).

Plans, prices and manual payment details come from `PREMIUM_OFFER_JSON` in `.env` and are
served at `GET /api/premium/offer` (the POEVH app shows them on its Premium page), e.g.
`{"plans":[{"id":"month","price":49000}],"payment":{"bank":"MB","account":"0123","holder":"NAME"}}`.
Plans left out keep their defaults; a missing price shows as "Liên hệ".

3. The user opens `/premium`, creates a key (shown once), and can change device once every
   30 days.

### For client apps

`POST /api/premium/verify` with `{"key": "...", "device_id": "...", "device_label": "..."}`
(20 requests per minute per IP). The first device to use a key is bound to it; other
devices get `409 device_mismatch` until the user or an admin releases it. `device_id`
is 16-256 printable characters chosen by the app; the server only stores a hash of it.

On success the response holds `token`, a licence of the form
`base64url(JSON payload).base64url(Ed25519 signature)` with `sub` (account), `kid` (key),
`dev` (device hash), `plan`, `premium_until` and `exp`. Check the signature with the public
key and call verify again before `exp`; tokens last at most 7 days and never past the
paid period, so revoked or expired premium stops within that time.
`verifyLicenceToken` in `src/server/services/premium-service.mjs` is a reference check.

The POEVH desktop app implements this client in `apps/poevh-desktop/crates/poe2-world/src/premium.rs`
(see `apps/poevh-desktop/README.md`, "Premium"). Build it with `POEVH_PREMIUM_PUBLIC_KEY` set to the
public key so the app does not have to trust the first key it downloads.

Error codes: `bad_key`, `bad_device`, `unknown_key`, `premium_expired`, `device_mismatch`,
`signing_unavailable`.

## Production Routing

The static pages use clean URLs such as `/dictionary`, `/skill-gems`, `/currency`, and `/leveling`.
When serving with nginx, include `deploy/nginx/poeviethoa-clean-routes.conf` inside the site server block so those URLs map directly to their matching HTML files instead of falling through to `404.html`.

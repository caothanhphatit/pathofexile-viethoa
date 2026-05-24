# POE2 Viet Hoa

Static-first Vietnamese POE2 reference app with PostgreSQL-backed crawl/export tooling.

## Layout

- `public/`: browser-facing static app, compiled CSS, shared UI helpers, images, and generated data exports.
- `src/`: backend, database, localization, and source CSS.
- `scripts/`: crawlers, exporters, translation rebuilds, and local static serving.
- `migrations/`: PostgreSQL schema migrations.
- `tests/`: Node test suite.

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

For backend and crawler workflows, copy `.env.example` to `.env` and fill local values:

```bash
npm run db:migrate
npm run crawl:all
npm run translate:content
npm run export:all
npm run server
```

Do not commit real database URLs, OAuth secrets, admin tokens, or local `.env` files.

## Production Routing

The static pages use clean URLs such as `/dictionary`, `/skill-gems`, `/currency`, and `/leveling`.
When serving with nginx, include `deploy/nginx/poeviethoa-clean-routes.conf` inside the site server block so those URLs map directly to their matching HTML files instead of falling through to `404.html`.

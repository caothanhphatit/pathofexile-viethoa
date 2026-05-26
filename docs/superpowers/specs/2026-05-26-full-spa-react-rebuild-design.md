# Full SPA React Rebuild Design

## Goal

Rebuild the public POE2 Viet Hoa frontend as a single React/Vite/TypeScript application while preserving the existing data export, backend, crawler, and static asset pipeline.

## Scope

The public clean routes become SPA routes: `/`, `/patchnote`, `/tra-cuu`, `/newbie`, `/beginner-guide`, `/items`, `/dictionary`, `/weapon`, `/skill-gems`, `/skill-gem`, `/currency`, `/currency-detail`, `/ggpk-skills`, `/ggpk-data`, `/passive-tree`, and `/leveling`. Legacy HTML files can remain as temporary compatibility artifacts, but production clean URLs and the local static server should serve the SPA shell.

The rewrite does not change PostgreSQL schemas, crawlers, exporters, generated `public/data/*.js` payload shapes, or image/font asset locations.

## Architecture

Add a Vite build entry under `src/spa`. The app owns routing, layout, theme, locale, list/detail pages, and the passive tree experience. Build output goes to `public/dist/spa`, and `public/index.html` becomes the SPA shell that loads the generated bundle.

The SPA uses browser history routing without an extra router dependency. A central route table maps clean paths to route keys, metadata, and page components. The local static server and nginx clean-route config should route all public app paths to `/index.html`.

## Data Flow

Existing generated data files stay in `public/data`. React pages lazy-load those files as classic scripts and read their `window.POE2_*` globals. Heavy payloads such as GGPK lookup and passive tree data are only loaded when their routes mount.

Common data helpers live in `src/spa/lib/data.ts`; route metadata and URL helpers live in `src/spa/lib/routes.ts`.

## UI Design

Use a product-style application shell: sticky compact header, route navigation, theme toggle, locale switch, controlled content width for data pages, and full-bleed app mode for passive tree. The visual direction is restrained dark fantasy: charcoal surfaces, aged gold accents, cyan/teal utility signals, dense readable data panels, and canvas-first map interaction.

Cards are used for repeated items only. Data pages prioritize scanning, filters, and detail affordances over marketing-style sections.

## Passive Tree

Passive tree stays Canvas 2D. React owns controls and state; the canvas module owns drawing, camera math, hit testing, culling, and pointer input. The first implementation keeps the current exported passive-tree-data shape and draws nodes/edges directly from it. Build allocation, hover preview, search focus, class/ascendancy filters, and summary counts remain user-facing features.

## SEO And Routing

The SPA shell keeps baseline production meta for the site. Route components update title, description, canonical, and OG/Twitter tags client-side. Detail routes update canonical query strings from selected slugs. Static SEO for every detail page is not part of this pass; prerender can be added later if needed.

## Testing

Tests should verify:

- Vite config and package scripts exist.
- SPA shell loads `public/dist/spa/assets/app.css` and `app.js`.
- Clean routes map to `/index.html` in the local server and nginx config.
- Route metadata covers public routes.
- Data loader creates script tags once and resolves globals.
- Passive tree canvas utilities clamp/fit view and hit-test nodes.
- Build succeeds and smoke tests can open the SPA.

## Risks

The old test suite contains many static HTML string assertions. Rewriting the app means those tests need to be shifted toward SPA artifacts and reusable modules. Large data files should remain route-lazy to avoid making the first page load heavy.

# Full SPA React Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public frontend as a React/Vite/TypeScript SPA without changing the data export/backend pipeline.

**Architecture:** Add a Vite entry in `src/spa`, build to `public/dist/spa`, and make `public/index.html` the SPA shell. Clean routes in the local server and nginx config serve the shell while React handles route rendering and route-level lazy data loading.

**Tech Stack:** React 18, Vite 5, TypeScript 5, Canvas 2D, existing generated `public/data/*.js` globals, existing Tailwind-built base CSS and local assets.

---

### Task 1: Tooling And Shell

**Files:**
- Modify: `package.json`
- Create: `tsconfig.spa.json`
- Create: `vite.spa.config.mjs`
- Modify: `public/index.html`

- [ ] Add React/Vite/TypeScript dependencies and scripts: `dev:spa`, `build:spa`, and make `build` run CSS then SPA.
- [ ] Add Vite config that builds `src/spa/main.tsx` to `public/dist/spa/assets/app.js` and emits CSS beside it.
- [ ] Replace `public/index.html` with a small shell that keeps SEO/favicons/theme boot/base CSS and mounts `#root`.
- [ ] Verify `npm run build:spa` emits JS and CSS.

### Task 2: SPA Core

**Files:**
- Create: `src/spa/main.tsx`
- Create: `src/spa/App.tsx`
- Create: `src/spa/styles.css`
- Create: `src/spa/lib/routes.ts`
- Create: `src/spa/lib/data.ts`
- Create: `src/spa/lib/seo.ts`
- Create: `src/spa/lib/text.ts`
- Create: `src/spa/types/global.d.ts`

- [ ] Implement history routing, route metadata, route link handling, theme, locale, and SEO updates.
- [ ] Implement a script-global data loader that de-duplicates script tags.
- [ ] Implement a product shell with top nav, mobile nav, and route content area.
- [ ] Verify the SPA renders home and navigates without full document reloads.

### Task 3: Data Pages

**Files:**
- Create: `src/spa/pages/HomePage.tsx`
- Create: `src/spa/pages/LookupPage.tsx`
- Create: `src/spa/pages/StaticGuidePages.tsx`
- Create: `src/spa/pages/DataListPages.tsx`
- Create: `src/spa/pages/LevelingPage.tsx`
- Create: `src/spa/components/DataCard.tsx`
- Create: `src/spa/components/FilterBar.tsx`

- [ ] Render home, lookup, newbie, beginner, weapon, patchnote guide placeholders with real route cards and existing content summaries.
- [ ] Render skill gems, currency, items, dictionary, GGPK skills, GGPK data list/search pages from existing globals.
- [ ] Render skill gem and currency detail pages from `?slug=`.
- [ ] Render leveling checklist from `window.levelingRouteZones`.

### Task 4: Passive Tree Canvas

**Files:**
- Create: `src/spa/pages/PassiveTreePage.tsx`
- Create: `src/spa/passive/camera.ts`
- Create: `src/spa/passive/tree.ts`
- Create: `src/spa/passive/draw.ts`
- Create: `src/spa/passive/TreeCanvas.tsx`

- [ ] Load `public/data/passive-tree-data.js` lazily.
- [ ] Convert exported nodes/edges/classes into renderable maps.
- [ ] Draw visible edges/nodes on Canvas 2D with viewport culling and DPR scaling.
- [ ] Support pan, wheel zoom, fit, reset, class/ascendancy filtering, search highlighting, hover tooltip, and allocation toggles.

### Task 5: Route Infrastructure

**Files:**
- Modify: `scripts/serve-static.mjs`
- Modify: `deploy/nginx/poeviethoa-clean-routes.conf`
- Modify: `public/404.html`

- [ ] Route every clean app URL to `/index.html`.
- [ ] Keep static assets, data files, robots, sitemap, and legacy direct HTML files readable.
- [ ] Make 404 fall through to the SPA shell for unknown app paths.

### Task 6: Tests And Verification

**Files:**
- Create: `tests/spa-build.test.mjs`
- Create: `tests/spa-routes.test.mjs`
- Create: `tests/spa-passive-tree.test.mjs`
- Modify existing tests that assert old clean-route HTML mappings.

- [ ] Add tests for package scripts, Vite config, SPA shell, routes, server mapping, nginx mapping, and passive canvas helpers.
- [ ] Run `npm run build`.
- [ ] Run targeted SPA tests.
- [ ] Run `npm test` where feasible and record any legacy-test fallout.

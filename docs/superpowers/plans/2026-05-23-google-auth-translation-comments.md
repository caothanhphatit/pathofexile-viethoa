# Google Auth Translation Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public translation comments that require Google login, so readers can review skill gem, currency, and dictionary translations directly on the app.

**Architecture:** Reuse the existing Google OAuth/session system and add a focused translation-comments domain. The backend owns validation, persistence, and session enforcement; the frontend uses one shared static component that can be embedded into listing cards and detail modals without duplicating auth/comment logic.

**Tech Stack:** Fastify, PostgreSQL migrations, existing session-cookie auth, vanilla HTML/CSS/JS, Tailwind build output, Node test runner.

---

### Task 1: Stabilize Current UI Loading and Label Text

**Files:**
- Modify: `scripts/serve-static.mjs`
- Modify: `src/styles/app.css`
- Modify: `tests/performance.test.mjs`
- Modify: `public/skill_gems.html`
- Create: `public/assets/fonts/material-symbols-rounded.woff2`

- [x] **Step 1: Verify the local Material Symbols font is served**

Run: `Invoke-WebRequest http://127.0.0.1:8023/assets/fonts/material-symbols-rounded.woff2`

Expected: HTTP 200 and `Content-Type` includes `font/woff2`.

- [x] **Step 2: Build CSS after adding the local font-face**

Run: `npm run build`

Expected: PASS and `public/dist/app.css` contains `/assets/fonts/material-symbols-rounded.woff2`.

- [x] **Step 3: Fix the broken skill card label**

In `public/skill_gems.html`, replace the literal `Chi ti?t` with `Chi tiết`.

- [x] **Step 4: Verify no production shell page loads Google Fonts remotely**

Run: `rg -n "fonts.googleapis|fonts.gstatic" public src tests scripts -S`

Expected: no matches in production shell pages; raw archived source files may be ignored if they are not loaded by the app.

### Task 2: Add Translation Comment Schema

**Files:**
- Create: `migrations/006_translation_comments.sql`
- Modify: `tests/postgres-schema.test.mjs`

- [x] **Step 1: Add a migration for public comments**

Create `translation_comments` with these fields: `id`, `entity_type`, `entity_id`, `entity_name`, `field_path`, `source_text`, `translated_text`, `body`, `user_id`, `status`, `page_url`, `created_at`, `updated_at`.

Constraints:
- `entity_type` is one of `skill_gem`, `currency`, `dictionary`.
- `status` is one of `visible`, `hidden`, `deleted`.
- `body` is required.
- `user_id` references `users(id)` with cascade delete.

- [x] **Step 2: Add schema tests**

Update `tests/postgres-schema.test.mjs` to assert the migration includes `translation_comments`, the `users(id)` reference, and indexes for entity and created time.

### Task 3: Add Public Comment API

**Files:**
- Create: `src/server/routes/translation-comments.mjs`
- Modify: `src/server/app.mjs`
- Modify: `tests/backend-architecture.test.mjs`
- Create: `tests/translation-comments-routes.test.mjs`

- [x] **Step 1: Add route validation**

Use `zod` to validate:
- `entityType`: `skill_gem`, `currency`, or `dictionary`
- `entityId`: non-empty, max 180 chars
- `entityName`: non-empty, max 220 chars
- `fieldPath`: default `summary`, max 120 chars
- `sourceText`: default empty, max 4000 chars
- `translatedText`: default empty, max 4000 chars
- `body`: 2 to 1200 chars
- `pageUrl`: default empty, max 1000 chars

- [x] **Step 2: Add read endpoint**

`GET /api/translation-comments?entityType=skill_gem&entityId=Spark`

Returns visible comments sorted newest first, joined with public user fields: `displayName` and `avatarUrl`.

- [x] **Step 3: Add create endpoint**

`POST /api/translation-comments`

Requires `app.auth.requireUser(app.db, request)`. Inserts a visible comment and returns the inserted public row.

- [x] **Step 4: Add focused tests**

Tests must cover:
- anonymous `POST` returns 401
- logged-in `POST` inserts a comment
- `GET` lists only `visible` comments
- invalid entity type returns 400

### Task 4: Add Shared Frontend Comment Component

**Files:**
- Create: `public/components/translation-comments.js`
- Modify: `tests/listing-ui.test.mjs`

- [x] **Step 1: Build a reusable component**

Expose `window.PoeTranslationComments.mount(target, context)` where `context` includes:
- `entityType`
- `entityId`
- `entityName`
- `fieldPath`
- `sourceText`
- `translatedText`

The component handles auth session loading via `/api/auth/config` and `/api/auth/session`, comment loading via `/api/translation-comments`, Google login redirect, logout, submit state, empty state, and error messages.

- [x] **Step 2: Keep UI compact**

Use a single small `Góp ý dịch` action on cards and a comment panel in detail modals. If the user is anonymous, show a compact Google-login button instead of a textarea. Public comments show avatar, display name, time, and body.

- [x] **Step 3: Add UI tests**

Assert the three target pages load `components/translation-comments.js` and contain `data-comments-slot` mount points.

### Task 5: Integrate Comments Into Skill, Currency, and Dictionary

**Files:**
- Modify: `public/skill_gems.html`
- Modify: `public/currency.html`
- Modify: `public/dictionary.html`
- Modify: `public/skill_gem_detail.html`
- Modify: `public/currency_detail.html`

- [x] **Step 1: Skill gems**

Add `Góp ý dịch` on each card without growing the detail button row, and mount the full comment panel inside the skill detail modal with the current gem summary metadata.

- [x] **Step 2: Currency**

Add `Góp ý dịch` on each card and mount the full comment panel in the currency detail modal with the current item description metadata.

- [x] **Step 3: Dictionary**

Add `Góp ý dịch` to each dictionary term card and mount the full comment panel in the dictionary modal with the term meaning and original tooltip text.

- [x] **Step 4: Direct detail pages**

Mount the same comment panel on `/skill-gem` and `/currency-detail` so shared links can receive public translation comments outside the listing modals.

### Task 6: Verify and Prepare for Push

**Files:**
- All changed files

- [x] **Step 1: Run the build**

Run: `npm run build`

Expected: PASS.

- [x] **Step 2: Run tests**

Run: `npm test`

Expected: PASS.

- [x] **Step 3: Check formatting and accidental whitespace**

Run: `git diff --check`

Expected: no output.

- [x] **Step 4: Browser verification**

Open `/skill-gems`, `/currency`, and `/dictionary` in the in-app browser. Confirm pages render, the broken `Chi tiết` label is fixed, comment buttons appear, anonymous users see Google-login gating, and existing detail modals still open.

- [x] **Step 5: Summarize status**

Report changed files, verification commands, and whether a push is needed for production data/UI.

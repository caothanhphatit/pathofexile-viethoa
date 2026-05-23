import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, filename), "utf8");

const shellPages = [
  "index.html",
  "analysis.html",
  "patchnote_vn.html",
  "dictionary.html",
  "weapon.html",
  "skill_gems.html",
  "skill_gem_detail.html",
  "currency.html",
  "currency_detail.html",
  "leveling.html"
];

test("app shell component owns shared header and theme behavior", async () => {
  const shell = await readProjectFile("components/app-shell.js");

  assert.match(shell, /renderSiteHeader/);
  assert.match(shell, /initTheme/);
  assert.match(shell, /data-component="site-header"/);
  assert.match(shell, /themeToggle/);
  assert.match(shell, /PoeRouter\.routes/);
  assert.match(shell, /poe-theme-change/);
});

test("tooltip term clicks open an in-page dictionary popup instead of navigating", async () => {
  const shell = await readProjectFile("components/app-shell.js");

  assert.match(shell, /\.poe-term/);
  assert.match(shell, /openPoeTermModal/);
  assert.match(shell, /poe-term-modal/);
  assert.match(shell, /role="dialog"/);
  assert.match(shell, /aria-modal="true"/);
  assert.doesNotMatch(shell, /dictionary\.html\?q/);
  assert.doesNotMatch(shell, /window\.location\.href\s*=/);
});

test("routes expose reusable nav metadata for the app shell", async () => {
  const routes = await readProjectFile("app-routes.js");

  for (const key of ["home", "patchnote", "dictionary", "weapon", "skillgems", "currency", "leveling"]) {
    assert.match(routes, new RegExp(`${key}:\\s*{[\\s\\S]*?icon:`), `${key} route has icon metadata`);
    assert.match(routes, new RegExp(`${key}:\\s*{[\\s\\S]*?navOrder:`), `${key} route has nav order`);
  }
});

test("main pages consume the reusable site header instead of copy-pasting it", async () => {
  for (const page of shellPages) {
    const html = await readProjectFile(page);

    assert.match(html, /components\/app-shell\.js/, `${page} loads app shell`);
    assert.match(html, /data-component="site-header"/, `${page} declares shell header slot`);
    assert.doesNotMatch(html, /<header class="sticky top-0 z-40/, `${page} does not inline site header`);
    assert.doesNotMatch(html, /const themeToggle = document\.getElementById\("themeToggle"\)/, `${page} does not inline shared theme toggle`);
  }
});

test("main pages use shared boot assets instead of inline shared setup", async () => {
  for (const page of shellPages) {
    const html = await readProjectFile(page);

    assert.match(html, /components\/theme-boot\.js/, `${page} loads shared theme boot`);
    assert.match(html, /dist\/app\.css/, `${page} loads compiled app styles`);
    assert.doesNotMatch(html, /components\/tailwind-config\.js/, `${page} does not load runtime Tailwind config`);
    assert.doesNotMatch(html, /components\/app-base\.css/, `${page} does not load uncompiled base styles`);
    assert.doesNotMatch(html, /cdn\.tailwindcss\.com/, `${page} does not load Tailwind CDN`);
    assert.doesNotMatch(html, /tailwind\.config\s*=/, `${page} does not inline shared Tailwind config`);
    assert.doesNotMatch(html, /localStorage\.getItem\("patchnote-theme"\)/, `${page} does not inline shared theme boot`);
    assert.doesNotMatch(html, /\.nav-scroll\s*{[^}]*scrollbar-width:\s*none/, `${page} does not inline shared nav-scroll styles`);
  }
});

test("redirect documents delegate route generation to the shared router", async () => {
  const redirectPages = [
    ["leveling_act1.html", "act1"],
    ["leveling_act2.html", "act2"],
    ["leveling_act3.html", "act3"],
    ["leveling_act4.html", "act4"],
    ["leveling_interlude.html", "interlude"]
  ];

  for (const [page, act] of redirectPages) {
    const html = await readProjectFile(page);

    assert.match(html, /app-routes\.js/, `${page} loads shared routes`);
    assert.match(html, new RegExp(`PoeRouter\\.to\\("leveling", \\{ act: "${act}" \\}\\)`), `${page} builds its target from PoeRouter`);
    assert.doesNotMatch(html, /20260522e/, `${page} does not hardcode a stale route version`);
  }
});

test("404 route redirects reuse the shared router table", async () => {
  const html = await readProjectFile("404.html");

  assert.match(html, /app-routes\.js/);
  assert.match(html, /PoeRouter\.redirectPrettyRoute\(\)/);
  assert.doesNotMatch(html, /const routes =/);
  assert.doesNotMatch(html, /const aliases =/);
});

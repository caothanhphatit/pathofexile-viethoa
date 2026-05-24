import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, "public", filename), "utf8");
const readRepoFile = (filename) => readFile(join(repoRoot, filename), "utf8");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  assert.match(shell, /poe2-viet-hoa-logo\.svg/);
  assert.match(shell, /data-component="site-header"/);
  assert.match(shell, /poe-shell-container/);
  assert.match(shell, /themeToggle/);
  assert.match(shell, /PoeRouter\.routes/);
  assert.match(shell, /poe-theme-change/);
  assert.doesNotMatch(shell, /dataset\.maxWidth/);
  assert.doesNotMatch(shell, /style="max-width/);
});

test("app shell keeps nav link dimensions stable across active tabs", async () => {
  const shell = await readProjectFile("components/app-shell.js");

  assert.match(shell, /const desktopClass = \(active\) => `poe-nav-link/);
  assert.match(shell, /const mobileClass = \(active\) => `poe-nav-link poe-nav-link-mobile/);
  assert.match(shell, /poe-nav-link-active/);
  assert.match(shell, /poe-nav-link-mobile-active/);
  assert.match(shell, /poe-nav-icon/);
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
  assert.doesNotMatch(shell, /Quy chuẩn/);
  assert.doesNotMatch(shell, /poeTermModalKeep/);
});

test("tooltip engine excludes filters, headers, and translate-no titles from being wrapped", async () => {
  const shell = await readProjectFile("components/app-shell.js");

  assert.match(shell, /EXCLUDE_SELECTOR/);
  assert.match(shell, /translate='no'/);
  assert.match(shell, /data-no-tooltip/);
  assert.match(shell, /subtype-pill/);
  assert.match(shell, /closest\(EXCLUDE_SELECTOR\)/);
});

test("routes expose reusable nav metadata for the app shell", async () => {
  const routes = await readProjectFile("app-routes.js");

  for (const key of ["home", "patchnote", "dictionary", "weapon", "skillgems", "currency", "leveling"]) {
    assert.match(routes, new RegExp(`${key}:\\s*{[\\s\\S]*?icon:`), `${key} route has icon metadata`);
    assert.match(routes, new RegExp(`${key}:\\s*{[\\s\\S]*?navOrder:`), `${key} route has nav order`);
  }
});

test("app routes and nav links use clean production URLs without html suffixes", async () => {
  const [routes, shell, home] = await Promise.all([
    readProjectFile("app-routes.js"),
    readProjectFile("components/app-shell.js"),
    readProjectFile("index.html")
  ]);

  assert.match(routes, /href:\s*"\/dictionary"/);
  assert.match(routes, /href:\s*"\/currency"/);
  assert.match(routes, /canonicalInternalHref/);
  assert.match(shell, /href:\s*"\/skill-gems"/);
  assert.match(home, /href="\/skill-gems"/);
  assert.doesNotMatch(home, /href="(?:index|dictionary|weapon|skill_gems|currency|leveling|patchnote_vn)\.html/);
});

test("main pages consume the reusable site header instead of copy-pasting it", async () => {
  for (const page of shellPages) {
    const html = await readProjectFile(page);

    assert.match(html, /components\/app-shell\.js/, `${page} loads app shell`);
    assert.match(html, /data-component="site-header"/, `${page} declares shell header slot`);
    assert.doesNotMatch(html, /data-max-width=/, `${page} does not override the shared shell width`);
    assert.doesNotMatch(html, /<header class="sticky top-0 z-40/, `${page} does not inline site header`);
    assert.doesNotMatch(html, /const themeToggle = document\.getElementById\("themeToggle"\)/, `${page} does not inline shared theme toggle`);
  }
});

test("main pages share the same outer body width to avoid tab-to-tab layout jumps", async () => {
  for (const page of shellPages) {
    const html = await readProjectFile(page);
    const mainClass = html.match(/<main class="([^"]*)"/)?.[1] || "";

    assert.match(mainClass, /\bpoe-shell-container\b/, `${page} uses the shared page container`);
    assert.doesNotMatch(html, /max-w-\[(1000|1180|1200|1400)px\]/, `${page} does not use page-specific shell widths`);
  }
});

test("main pages use shared boot assets instead of inline shared setup", async () => {
  for (const page of shellPages) {
    const html = await readProjectFile(page);

    assert.match(html, /rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" sizes="any"/, `${page} exposes the site favicon`);
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

test("site favicon is available from the public root for browsers and search crawlers", async () => {
  const favicon = await readProjectFile("favicon.svg");

  assert.match(favicon, /<svg[^>]*viewBox="0 0 96 96"/);
  assert.match(favicon, /<path fill="url\(#coin\)"/);
  assert.match(favicon, /<path fill="url\(#gem\)"/);
});

test("theme boot paints the document background before app CSS loads", async () => {
  const boot = await readProjectFile("components/theme-boot.js");

  assert.match(boot, /applyCriticalThemePaint/);
  assert.match(boot, /backgroundColor/);
  assert.match(boot, /#060813/);
  assert.match(boot, /#f8fafc/);

  for (const page of shellPages) {
    const html = await readProjectFile(page);
    assert.ok(
      html.indexOf("components/theme-boot.js") < html.indexOf("dist/app.css"),
      `${page} loads theme boot before app CSS`
    );
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

test("production nginx clean URL config maps app routes to static HTML", async () => {
  const config = await readRepoFile("deploy/nginx/poeviethoa-clean-routes.conf");
  const mappings = [
    ["/", "index.html"],
    ["/home", "index.html"],
    ["/patchnote", "patchnote_vn.html"],
    ["/patch-note", "patchnote_vn.html"],
    ["/dictionary", "dictionary.html"],
    ["/tu-dien", "dictionary.html"],
    ["/weapon", "weapon.html"],
    ["/skill-gems", "skill_gems.html"],
    ["/skill_gems", "skill_gems.html"],
    ["/skill-gem", "skill_gem_detail.html"],
    ["/skill_gem_detail", "skill_gem_detail.html"],
    ["/currency", "currency.html"],
    ["/currency-detail", "currency_detail.html"],
    ["/currency_detail", "currency_detail.html"],
    ["/leveling", "leveling.html"]
  ];

  for (const [route, file] of mappings) {
    const pattern = new RegExp(`location = ${escapeRegex(route)} \\{[\\s\\S]*?try_files /${escapeRegex(file)} =404;[\\s\\S]*?\\}`);
    assert.match(config, pattern, `${route} maps to ${file}`);
  }

  assert.match(config, /location \/ \{[\s\S]*?try_files \$uri \$uri\/ \/404\.html;[\s\S]*?\}/);
});

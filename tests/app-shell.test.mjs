import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, "public", filename), "utf8");
const readProjectBinary = (filename) => readFile(join(repoRoot, "public", filename));
const readRepoFile = (filename) => readFile(join(repoRoot, filename), "utf8");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const routeBlock = (routes, key) => routes.match(new RegExp(`${key}:\\s*{[^}]*}`))?.[0] || "";

const shellPages = [
  "index.html",
  "analysis.html",
  "newbie.html",
  "beginner.html",
  "lookup.html",
  "items.html",
  "patchnote_vn.html",
  "dictionary.html",
  "weapon.html",
  "skill_gems.html",
  "skill_gem_detail.html",
  "currency.html",
  "currency_detail.html",
  "passive_tree.html",
  "leveling.html"
];
const sharedHeaderPages = shellPages;
const sharedWidthPages = shellPages.filter((page) => page !== "passive_tree.html");

test("app shell component owns shared header and theme behavior", async () => {
  const shell = await readProjectFile("components/app-shell.js");

  assert.match(shell, /renderSiteHeader/);
  assert.match(shell, /initTheme/);
  assert.match(shell, /initLocaleToggle/);
  assert.match(shell, /poe-locale-change/);
  assert.match(shell, /data-locale-option/);
  assert.match(shell, /localeStorageKey\s*=\s*"poe-locale"/);
  assert.match(shell, /\/assets\/img\/logo\.jpg/);
  assert.match(shell, /data-component="site-header"/);
  assert.match(shell, /poe-shell-container/);
  assert.match(shell, /themeToggle/);
  assert.match(shell, /PoeRouter\.routes/);
  assert.match(shell, /poe-theme-change/);
  assert.match(shell, /https:\/\/www\.facebook\.com\/poeviethoa\//);
  assert.match(shell, /poe-facebook-link/);
  assert.match(shell, /target="_blank"/);
  assert.doesNotMatch(shell, /dataset\.maxWidth/);
  assert.doesNotMatch(shell, /style="max-width/);
});

test("app shell prompts users to follow the fanpage on entry and passive tree visits", async () => {
  const shell = await readProjectFile("components/app-shell.js");

  assert.match(shell, /fanpageModalSeenKey\s*=\s*"poe-fanpage-modal-seen"/);
  assert.match(shell, /passiveFanpageModalSeenKey\s*=\s*"poe-passive-fanpage-modal-seen"/);
  assert.match(shell, /initFanpagePrompt/);
  assert.match(shell, /Góp ý và theo dõi/);
  assert.match(shell, /Mở fanpage/);
  assert.match(shell, /activeRoute\(\) === "passivetree"/);
  assert.match(shell, /sessionStorage\.setItem\(key,\s*"true"\)/);
  assert.match(shell, /role="dialog"/);
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
  assert.match(shell, /applyTooltips/);
  assert.match(shell, /window\.PoeAppShell = \{[\s\S]*applyTooltips,/);
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

  for (const key of ["home", "patchnote", "lookup", "newbie", "passivetree", "leveling"]) {
    assert.match(routes, new RegExp(`${key}:\\s*{[\\s\\S]*?icon:`), `${key} route has icon metadata`);
    assert.match(routes, new RegExp(`${key}:\\s*{[\\s\\S]*?navOrder:`), `${key} route has nav order`);
  }

  {
    const block = routeBlock(routes, "weapon");
    assert.match(block, /navParent:\s*"newbie"/, "weapon route points at newbie nav");
    assert.doesNotMatch(block, /navOrder:/, "weapon route is not a top-level nav tab");
  }

  {
    const block = routeBlock(routes, "beginner");
    assert.match(block, /navParent:\s*"newbie"/, "beginner route points at newbie nav");
    assert.doesNotMatch(block, /navOrder:/, "beginner route is not a top-level nav tab");
  }

  for (const key of ["items", "currency", "dictionary", "skillgems"]) {
    const block = routeBlock(routes, key);
    assert.match(block, /navParent:\s*"lookup"/, `${key} route points at lookup nav`);
    assert.doesNotMatch(block, /navOrder:/, `${key} route is not a top-level nav tab`);
  }
});

test("app routes and nav links use clean production URLs without html suffixes", async () => {
  const [routes, shell, home] = await Promise.all([
    readProjectFile("app-routes.js"),
    readProjectFile("components/app-shell.js"),
    readProjectFile("index.html")
  ]);

  assert.match(routes, /href:\s*"\/tra-cuu"/);
  assert.match(routes, /href:\s*"\/newbie"/);
  assert.match(routes, /href:\s*"\/beginner-guide"/);
  assert.match(routes, /href:\s*"\/items"/);
  assert.match(routes, /href:\s*"\/dictionary"/);
  assert.match(routes, /href:\s*"\/currency"/);
  assert.match(routes, /href:\s*"\/passive-tree"/);
  assert.match(routes, /navActiveRoute/);
  assert.match(routes, /canonicalInternalHref/);
  assert.match(shell, /navActiveRoute/);
  assert.match(shell, /Tra cứu/);
  assert.match(shell, /href:\s*"\/skill-gems"/);
  assert.match(shell, /Newbie/);
  assert.match(home, /href="\/newbie"/);
  assert.match(home, /href="\/skill-gems"/);
  assert.doesNotMatch(home, /href="(?:index|dictionary|weapon|skill_gems|currency|leveling|patchnote_vn)\.html/);
});

test("lookup page presents item currency and dictionary as list cards", async () => {
  const html = await readProjectFile("lookup.html");

  assert.match(html, /data-lookup-card="items"/);
  assert.match(html, /data-lookup-card="currency"/);
  assert.match(html, /data-lookup-card="dictionary"/);
  assert.match(html, /data-lookup-card="skillgems"/);
  assert.match(html, /href="\/items"/);
  assert.match(html, /href="\/currency"/);
  assert.match(html, /href="\/dictionary"/);
  assert.match(html, /href="\/skill-gems"/);
  assert.match(html, />4 mục</);
  assert.match(html, /aria-label="Danh sách tra cứu"/);
  assert.doesNotMatch(html, /grid-cols-3/);
});

test("lookup child pages expose a back link to the lookup hub", async () => {
  for (const page of ["items.html", "currency.html", "dictionary.html", "skill_gems.html"]) {
    const html = await readProjectFile(page);

    assert.match(html, /href="\/tra-cuu"/, `${page} links back to lookup`);
    assert.match(html, /data-lookup-back/, `${page} marks the lookup back action`);
    assert.match(html, /arrow_back/, `${page} uses the back icon`);
  }
});

test("lookup data pages rerender when the user changes locale", async () => {
  for (const page of ["items.html", "currency.html", "dictionary.html", "skill_gems.html"]) {
    const html = await readProjectFile(page);

    assert.match(html, /currentLocale|setLocale|onLocaleChange/, `${page} reads shared locale`);
    assert.match(html, /i18nText|localeText|localizedName|termMeaning/, `${page} renders localized text`);
    assert.match(html, /poe-locale-change|onLocaleChange/, `${page} responds to locale changes`);
  }
});

test("main pages consume the reusable site header instead of copy-pasting it", async () => {
  for (const page of sharedHeaderPages) {
    const html = await readProjectFile(page);

    assert.match(html, /components\/app-shell\.js/, `${page} loads app shell`);
    assert.match(html, /data-component="site-header"/, `${page} declares shell header slot`);
    assert.doesNotMatch(html, /data-max-width=/, `${page} does not override the shared shell width`);
    assert.doesNotMatch(html, /<header class="sticky top-0 z-40/, `${page} does not inline site header`);
    assert.doesNotMatch(html, /const themeToggle = document\.getElementById\("themeToggle"\)/, `${page} does not inline shared theme toggle`);
  }
});

test("app shell can hydrate an already-parsed header before later page scripts run", async () => {
  const shell = await readProjectFile("components/app-shell.js");

  assert.match(shell, /const bootAppShell = \(\) => \{/);
  assert.match(shell, /document\.readyState === "loading"[\s\S]*document\.querySelector\('\[data-component="site-header"\]'\)/);
  assert.match(shell, /bootAppShell\(\);/);
});

test("main pages share the same outer body width to avoid tab-to-tab layout jumps", async () => {
  for (const page of sharedWidthPages) {
    const html = await readProjectFile(page);
    const mainClass = html.match(/<main class="([^"]*)"/)?.[1] || "";

    assert.match(mainClass, /\bpoe-shell-container\b/, `${page} uses the shared page container`);
    assert.doesNotMatch(html, /max-w-\[(1000|1180|1200|1400)px\]/, `${page} does not use page-specific shell widths`);
  }
});

test("passive tree keeps the shared header above its map shell", async () => {
  const html = await readProjectFile("passive_tree.html");
  const mainClass = html.match(/<main class="([^"]*)"/)?.[1] || "";

  assert.match(html, /components\/app-shell\.js/);
  assert.match(html, /data-component="site-header"/);
  assert.match(html, /passive-version-banner/);
  assert.match(html, /Đây là passive tree 0\.4\. Sẽ cập nhật bản 0\.5 khi có thông tin\./);
  assert.match(mainClass, /\bpassive-tree-page\b/);
  assert.match(mainClass, /\bp-0\b/);
  assert.doesNotMatch(mainClass, /\bpoe-shell-container\b/);
});

test("passive tree filterbar orders class, ascendancy, search and omits node type picker", async () => {
  const html = await readProjectFile("passive_tree.html");
  const filterbar = html.match(/<div class="passive-map-toolbar passive-map-filterbar[\s\S]*?<p class="sr-only" id="treeVersion"/)?.[0] || "";

  const classIndex = filterbar.indexOf('id="classFilter"');
  const ascendancyIndex = filterbar.indexOf('id="ascFilter"');
  const searchIndex = filterbar.indexOf('id="searchInput"');

  assert.notEqual(classIndex, -1, "filterbar exposes class selector");
  assert.notEqual(ascendancyIndex, -1, "filterbar exposes ascendancy selector");
  assert.notEqual(searchIndex, -1, "filterbar exposes search input");
  assert.ok(classIndex < ascendancyIndex, "class selector appears before ascendancy selector");
  assert.ok(ascendancyIndex < searchIndex, "ascendancy selector appears before search input");
  assert.doesNotMatch(filterbar, /id="typeFilter"/, "node type picker is removed from the toolbar");
});

test("main pages use shared boot assets instead of inline shared setup", async () => {
  for (const page of shellPages) {
    const html = await readProjectFile(page);

    assert.match(html, /rel="icon" href="\/favicon\.png" type="image\/png" sizes="64x64"/, `${page} exposes the site favicon`);
    assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/, `${page} exposes the touch icon`);
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
  const favicon = await readProjectBinary("favicon.png");
  const touchIcon = await readProjectBinary("apple-touch-icon.png");

  assert.deepEqual([...favicon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(favicon.readUInt32BE(16), 64);
  assert.equal(favicon.readUInt32BE(20), 64);
  assert.deepEqual([...touchIcon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(touchIcon.readUInt32BE(16), 180);
  assert.equal(touchIcon.readUInt32BE(20), 180);
});

test("theme boot paints the document background before app CSS loads", async () => {
  const boot = await readProjectFile("components/theme-boot.js");

  assert.match(boot, /applyCriticalThemePaint/);
  assert.match(boot, /poe-locale/);
  assert.match(boot, /root\.lang\s*=\s*locale/);
  assert.match(boot, /root\.dataset\.locale\s*=\s*locale/);
  assert.match(boot, /backgroundColor/);
  assert.match(boot, /#060813/);
  assert.match(boot, /#f8fafc/);
  assert.match(boot, /poe-route-transition/);
  assert.match(boot, /sessionStorage\.removeItem\("poe-route-transition"\)/);
  assert.doesNotMatch(boot, /dataset\.routeTransition\s*=\s*"enter"/);

  for (const page of shellPages) {
    const html = await readProjectFile(page);
    assert.ok(
      html.indexOf("components/theme-boot.js") < html.indexOf("dist/app.css"),
      `${page} loads theme boot before app CSS`
    );
  }
});

test("app shell background-loads internal routes before navigation", async () => {
  const shell = await readProjectFile("components/app-shell.js");

  assert.match(shell, /installRouteReadyNavigation/);
  assert.match(shell, /closest\('a\[href\]'\)/);
  assert.match(shell, /prefetchRoute/);
  assert.match(shell, /navigateAfterRoutePreload/);
  assert.match(shell, /isHeavyRouteUrl/);
  assert.match(shell, /passive-tree\|passive_tree/);
  assert.match(shell, /window\.fetch\(url\.href/);
  assert.match(shell, /cache:\s*"force-cache"/);
  assert.match(shell, /credentials:\s*"same-origin"/);
  assert.match(shell, /window\.location\.assign/);
  assert.match(shell, /installRouteReadyNavigation\(\)/);
  assert.doesNotMatch(shell, /document\.createElement\("iframe"\)/);
  assert.doesNotMatch(shell, /sessionStorage\.setItem\("poe-route-transition"/);
  assert.doesNotMatch(shell, /classList\.add\("poe-route-leaving"\)/);
  assert.doesNotMatch(shell, /poe-route-curtain/);
  assert.doesNotMatch(shell, /anchor\.dataset\.route === "lookup"/);
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
  const routes = await readProjectFile("app-routes.js");

  assert.match(html, /app-routes\.js/);
  assert.match(html, /PoeRouter\.redirectPrettyRoute\(\)/);
  assert.match(html, /<body><\/body>/);
  assert.doesNotMatch(html, /Äang chuyá»ƒn|Đang chuyển|chuyá»ƒn vá»|chuyển về/);
  assert.doesNotMatch(html, /const routes =/);
  assert.doesNotMatch(html, /const aliases =/);
  assert.match(routes, /preserveCurrentSearchParams/);
  assert.match(routes, /new URLSearchParams\(window\.location\.search\)/);
});

test("production nginx clean URL config maps app routes to static HTML", async () => {
  const config = await readRepoFile("deploy/nginx/poeviethoa-clean-routes.conf");
  const mappings = [
    ["/", "index.html"],
    ["/home", "index.html"],
    ["/patchnote", "patchnote_vn.html"],
    ["/patch-note", "patchnote_vn.html"],
    ["/tra-cuu", "lookup.html"],
    ["/lookup", "lookup.html"],
    ["/newbie", "newbie.html"],
    ["/beginner-guide", "beginner.html"],
    ["/items", "items.html"],
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
    ["/passive-tree", "passive_tree.html"],
    ["/passive_tree", "passive_tree.html"],
    ["/leveling", "leveling.html"]
  ];

  for (const [route, file] of mappings) {
    const pattern = new RegExp(`location = ${escapeRegex(route)} \\{[\\s\\S]*?try_files /${escapeRegex(file)} =404;[\\s\\S]*?\\}`);
    assert.match(config, pattern, `${route} maps to ${file}`);
  }

  assert.match(config, /location \/ \{[\s\S]*?try_files \$uri \$uri\/ \/404\.html;[\s\S]*?\}/);
});

test("local static dev server maps clean app routes to static HTML", async () => {
  const server = await readRepoFile("scripts/serve-static.mjs");
  const mappings = [
    ["/patchnote", "/patchnote_vn.html"],
    ["/tra-cuu", "/lookup.html"],
    ["/lookup", "/lookup.html"],
    ["/newbie", "/newbie.html"],
    ["/beginner-guide", "/beginner.html"],
    ["/items", "/items.html"],
    ["/dictionary", "/dictionary.html"],
    ["/weapon", "/weapon.html"],
    ["/skill-gems", "/skill_gems.html"],
    ["/currency", "/currency.html"],
    ["/passive-tree", "/passive_tree.html"],
    ["/leveling", "/leveling.html"]
  ];

  for (const [route, file] of mappings) {
    assert.match(server, new RegExp(`\\["${escapeRegex(route)}", "${escapeRegex(file)}"\\]`), `${route} maps to ${file}`);
  }
});

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, "public", filename), "utf8");
const indexOfPattern = (text, pattern) => {
  const match = pattern.exec(text);
  return match ? match.index : -1;
};

const dataPages = [
  ["skill_gems.html", "data/skill-gems-data.js"],
  ["skill_gem_detail.html", "data/skill-gems-data.js"],
  ["currency.html", "data/currency-data.js"],
  ["currency_detail.html", "data/currency-data.js"],
  ["dictionary.html", "data/dictionary-data.js"],
  ["items.html", "data/items-data.js"]
];

const shellPages = [
  "index.html",
  "analysis.html",
  "lookup.html",
  "items.html",
  "patchnote_vn.html",
  "dictionary.html",
  "weapon.html",
  "skill_gems.html",
  "skill_gem_detail.html",
  "currency.html",
  "currency_detail.html",
  "leveling.html"
];

test("shared base CSS does not block first paint with remote font imports", async () => {
  const css = await readProjectFile("dist/app.css");

  assert.doesNotMatch(css, /@import\s+url\(["']?https:\/\/fonts\.googleapis\.com/i);
  assert.doesNotMatch(css, /https:\/\/fonts\.(googleapis|gstatic)\.com/i);
  assert.match(css, /assets\/fonts\/material-symbols-rounded\.woff2/);
  assert.match(css, /system-ui/);
});

test("shared base CSS reserves the scrollbar gutter to prevent horizontal page jumps", async () => {
  const css = await readFile(join(repoRoot, "src", "styles", "app.css"), "utf8");

  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /overflow-y:\s*scroll/);
  assert.match(css, /\.poe-shell-container/);
  assert.match(css, /div\[data-component="site-header"\]\s*{[^}]*min-height:\s*7\.25rem;/s);
  assert.match(css, /@media \(min-width:\s*1024px\)\s*{[\s\S]*div\[data-component="site-header"\]\s*{[^}]*min-height:\s*4rem;/);
});

test("shared base CSS avoids document-level route transition flashes", async () => {
  const css = await readFile(join(repoRoot, "src", "styles", "app.css"), "utf8");

  assert.doesNotMatch(css, /@view-transition\s*{\s*navigation:\s*auto;/);
  assert.doesNotMatch(css, /::view-transition-old\(root\)/);
  assert.doesNotMatch(css, /@keyframes\s+poe-route-enter/);
  assert.doesNotMatch(css, /@keyframes\s+poe-route-leave/);
  assert.doesNotMatch(css, /\.poe-route-curtain/);
  assert.doesNotMatch(css, /html\[data-route-transition="enter"\]\s+body\s*>\s*main/);
  assert.doesNotMatch(css, /html\.poe-route-leaving\s+body\s*>\s*main/);
});

test("production pages load compiled Tailwind CSS instead of the browser CDN runtime", async () => {
  const cssStat = await stat(join(repoRoot, "public", "dist", "app.css"));
  assert.ok(cssStat.size > 25_000, "compiled Tailwind CSS should contain generated utilities");
  assert.ok(cssStat.size < 650_000, "compiled CSS should stay reasonably small");

  for (const page of shellPages) {
    const html = await readProjectFile(page);

    assert.match(html, /<link rel="preload" href="\/assets\/fonts\/material-symbols-rounded\.woff2" as="font" type="font\/woff2" crossorigin>/, `${page} preloads local icon font`);
    assert.match(html, /<link href="dist\/app\.css\?v=20260524-font" rel="stylesheet">/, `${page} loads versioned compiled app CSS`);
    assert.doesNotMatch(html, /https:\/\/cdn\.tailwindcss\.com/, `${page} does not load Tailwind CDN runtime`);
    assert.doesNotMatch(html, /https:\/\/fonts\.(googleapis|gstatic)\.com/, `${page} does not block on remote Google Fonts`);
    assert.doesNotMatch(html, /components\/tailwind-config\.js/, `${page} does not load runtime Tailwind config`);
    assert.doesNotMatch(html, /components\/app-base\.css/, `${page} does not load uncompiled base CSS separately`);
  }
});

test("large data exports are loaded near their runtime instead of blocking the document head", async () => {
  for (const [page, dataFile] of dataPages) {
    const html = await readProjectFile(page);
    const head = html.slice(0, html.indexOf("</head>"));

    assert.doesNotMatch(head, new RegExp(`<script\\s+src=["']${dataFile}["']><\\/script>`), `${page} must not block head parsing with ${dataFile}`);
    assert.match(html, new RegExp(`<script\\s+src=["']${dataFile}["']><\\/script>[\\s\\S]*<script>`), `${page} loads ${dataFile} before its inline runtime`);
  }
});

test("passive tree boots the shared shell before loading its heavy data export", async () => {
  const html = await readProjectFile("passive_tree.html");
  const headerIndex = html.indexOf('data-component="site-header"');
  const routesIndex = indexOfPattern(html, /<script src="app-routes\.js(?:\?[^"]*)?"><\/script>/);
  const shellIndex = indexOfPattern(html, /<script src="components\/app-shell\.js(?:\?[^"]*)?"><\/script>/);
  const plannerIndex = indexOfPattern(html, /<script src="components\/passive-tree-planner\.js/);
  const dataIndex = html.indexOf('script.src = "data/passive-tree-data.js');

  assert.ok(headerIndex > -1, "passive tree declares a shared shell header slot");
  assert.ok(routesIndex > headerIndex, "route metadata loads after the header slot exists");
  assert.ok(shellIndex > routesIndex, "app shell loads after route metadata");
  assert.ok(plannerIndex > shellIndex, "passive planner waits until the shared shell can render");
  assert.ok(dataIndex > plannerIndex, "heavy passive data waits until page chrome is stable");
  assert.match(html, /requestAnimationFrame\(\(\) => \{\s+window\.setTimeout\(loadPassiveTreeData, 0\);/);
});

test("raw patch-note snapshot does not use the 17MB remote infographic as page LCP", async () => {
  const html = await readProjectFile("src1.html");
  const imageStat = await stat(join(repoRoot, "public", "assets", "return-of-the-ancients-infographic-lcp.jpg"));

  assert.ok(imageStat.size < 350_000, "local LCP image should stay small");
  assert.doesNotMatch(html, /https:\/\/web\.poecdn\.com\/public\/news\/2026-05-22\/RotAInfographic\.png/);
  assert.match(html, /src="assets\/return-of-the-ancients-infographic-lcp\.jpg"/);
  assert.match(html, /width="1280"/);
  assert.match(html, /height="720"/);
  assert.match(html, /fetchpriority="high"/);
  assert.match(html, /decoding="async"/);
});

test("dictionary tooltip hydration is idle-loaded after the page shell is interactive", async () => {
  const shell = await readProjectFile("components/app-shell.js");

  assert.match(shell, /scheduleIdleWork/);
  assert.match(shell, /requestIdleCallback/);
  assert.match(shell, /loadDictionaryAndInitTooltips/);
  assert.match(shell, /script\.defer\s*=\s*true/);
});

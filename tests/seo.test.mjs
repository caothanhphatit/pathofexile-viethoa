import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readPublicFile = (filename) => readFile(join(repoRoot, "public", filename), "utf8");

const indexablePages = [
  ["index.html", "https://poeviethoa.net/"],
  ["patchnote_vn.html", "https://poeviethoa.net/patchnote"],
  ["newbie.html", "https://poeviethoa.net/newbie"],
  ["beginner.html", "https://poeviethoa.net/beginner-guide"],
  ["lookup.html", "https://poeviethoa.net/tra-cuu"],
  ["items.html", "https://poeviethoa.net/items"],
  ["dictionary.html", "https://poeviethoa.net/dictionary"],
  ["weapon.html", "https://poeviethoa.net/weapon"],
  ["skill_gems.html", "https://poeviethoa.net/skill-gems"],
  ["skill_gem_detail.html", "https://poeviethoa.net/skill-gem"],
  ["currency.html", "https://poeviethoa.net/currency"],
  ["currency_detail.html", "https://poeviethoa.net/currency-detail"],
  ["leveling.html", "https://poeviethoa.net/leveling"]
];

test("indexable pages expose production SEO metadata", async () => {
  for (const [page, canonical] of indexablePages) {
    const html = await readPublicFile(page);

    assert.match(html, /<meta name="description" content="[^"]{50,}">/, `${page} has a useful description`);
    assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large">/, `${page} is indexable`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`), `${page} has canonical URL`);
    assert.match(html, /<meta property="og:title" content="[^"]+">/, `${page} has OG title`);
    assert.match(html, /<meta property="og:description" content="[^"]{50,}">/, `${page} has OG description`);
    assert.match(html, /<meta property="og:image" content="https:\/\/poeviethoa\.net\/assets\//, `${page} has share image`);
    assert.match(html, /<meta name="twitter:card" content="summary(?:_large_image)?">/, `${page} has Twitter card`);
  }
});

test("non-canonical helper pages are marked noindex", async () => {
  const noindexPages = [
    "404.html",
    "analysis.html",
    "leveling_act1.html",
    "leveling_act2.html",
    "leveling_act3.html",
    "leveling_act4.html",
    "leveling_interlude.html",
    "src1.html"
  ];

  for (const page of noindexPages) {
    const html = await readPublicFile(page);
    assert.match(html, /<meta name="robots" content="noindex,(?:follow|nofollow)">/, `${page} is not indexed`);
  }
});

test("sitemap and robots expose the clean public URL set", async () => {
  const [sitemap, robots] = await Promise.all([
    readPublicFile("sitemap.xml"),
    readPublicFile("robots.txt")
  ]);

  for (const [, canonical] of indexablePages.filter(([page]) => !page.includes("_detail"))) {
    assert.match(sitemap, new RegExp(`<loc>${canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>`));
  }

  assert.match(robots, /Sitemap: https:\/\/poeviethoa\.net\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/src1\.html/);
  assert.match(robots, /Disallow: \/analysis/);
});

test("detail pages update SEO metadata from the selected item", async () => {
  const [skillDetail, currencyDetail, uiUtils] = await Promise.all([
    readPublicFile("skill_gem_detail.html"),
    readPublicFile("currency_detail.html"),
    readPublicFile("components/poe-ui-utils.js")
  ]);

  assert.match(uiUtils, /updateDocumentSeo/);
  assert.match(uiUtils, /PUBLIC_SITE_ORIGIN = "https:\/\/poeviethoa\.net"/);
  assert.doesNotMatch(uiUtils, /new URL\(path, window\.location\.origin\)/);
  assert.match(skillDetail, /updateDocumentSeo\(\{[\s\S]*?canonicalPath: `\/skill-gem\?slug=\$\{encodeURIComponent\(gem\.slug\)\}`/);
  assert.match(currencyDetail, /updateDocumentSeo\(\{[\s\S]*?canonicalPath: `\/currency-detail\?slug=\$\{encodeURIComponent\(item\.slug\)\}`/);
});

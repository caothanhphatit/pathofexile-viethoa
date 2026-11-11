import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readRepoFile = (filename) => readFile(join(repoRoot, filename), "utf8");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Public pages a search engine should find; every one is a React route.
const indexablePaths = [
  "/",
  "/patchnote",
  "/tra-cuu",
  "/newbie",
  "/beginner-guide",
  "/items",
  "/dictionary",
  "/weapon",
  "/skill-gems",
  "/currency",
  "/leveling",
  "/passive-tree",
  "/build",
  "/craft-sim",
  "/boss",
  "/tai-app"
];

test("the SPA shell ships production SEO defaults before React runs", async () => {
  const html = await readRepoFile("public/index.html");

  assert.match(html, /<meta name="description" content="[^"]{50,}">/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/poeviethoa\.net\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/poeviethoa\.net\/assets\//);
});

test("route changes rewrite title, description, canonical and social tags", async () => {
  const seo = await readRepoFile("src/spa/lib/seo.ts");

  assert.match(seo, /SITE_ORIGIN = "https:\/\/poeviethoa\.net"/);
  for (const tag of ['meta[name="description"]', 'link[rel="canonical"]', 'meta[property="og:title"]', 'meta[property="og:url"]', 'meta[name="twitter:card"]']) {
    assert.ok(seo.includes(tag), `updateSeo writes ${tag}`);
  }
});

test("boss guides publish their own canonical URL and description", async () => {
  const page = await readRepoFile("src/spa/pages/BossPages.tsx");

  assert.match(page, /updateSeo\(/);
  assert.match(page, /canonicalPath: bossDetailHref\(slug\)/);
});

test("sitemap and robots expose the clean public URL set", async () => {
  const [sitemap, robots, routes] = await Promise.all([
    readRepoFile("public/sitemap.xml"),
    readRepoFile("public/robots.txt"),
    readRepoFile("src/spa/lib/routes.ts")
  ]);

  for (const path of indexablePaths) {
    assert.match(sitemap, new RegExp(`<loc>https://poeviethoa\\.net${escapeRegex(path)}</loc>`), `${path} is in the sitemap`);
    assert.match(routes, new RegExp(`path:\\s*"${escapeRegex(path)}"`), `${path} is a SPA route`);
  }
  assert.doesNotMatch(sitemap, /\.html</, "sitemap lists clean URLs only");
  assert.match(robots, /Sitemap: https:\/\/poeviethoa\.net\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/content\//, "guide article sources are not indexed on their own");
});

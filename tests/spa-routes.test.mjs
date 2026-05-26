import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readRepoFile = (filename) => readFile(join(repoRoot, filename), "utf8");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const appRoutes = [
  "/",
  "/patchnote",
  "/tra-cuu",
  "/newbie",
  "/beginner-guide",
  "/items",
  "/dictionary",
  "/weapon",
  "/skill-gems",
  "/skill-gem",
  "/currency",
  "/currency-detail",
  "/ggpk-skills",
  "/ggpk-data",
  "/passive-tree",
  "/leveling"
];

test("SPA route table covers every public product route", async () => {
  const routes = await readRepoFile("src/spa/lib/routes.ts");

  for (const route of appRoutes) {
    assert.match(routes, new RegExp(`path:\\s*"${escapeRegex(route)}"`), `${route} exists`);
  }
  assert.match(routes, /routeFromLocation/);
  assert.match(routes, /navigateTo/);
  assert.match(routes, /canonicalPath/);
});

test("local static server sends clean app routes to the SPA shell", async () => {
  const server = await readRepoFile("scripts/serve-static.mjs");

  for (const route of appRoutes) {
    assert.match(server, new RegExp(`\\["${escapeRegex(route)}",\\s*"\\/index\\.html"\\]`), `${route} maps to index`);
  }
  assert.match(server, /const spaFallbackFile = "\/index\.html"/);
});

test("nginx clean route config sends app routes to the SPA shell", async () => {
  const config = await readRepoFile("deploy/nginx/poeviethoa-clean-routes.conf");

  for (const route of appRoutes) {
    const pattern = new RegExp(`location = ${escapeRegex(route)} \\{[\\s\\S]*?try_files /index\\.html =404;[\\s\\S]*?\\}`);
    assert.match(config, pattern, `${route} maps to SPA shell`);
  }
});

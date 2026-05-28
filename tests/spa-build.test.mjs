import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readRepoFile = (filename) => readFile(join(repoRoot, filename), "utf8");

test("package exposes React SPA build scripts and dependencies", async () => {
  const pkg = JSON.parse(await readRepoFile("package.json"));

  assert.equal(pkg.scripts["dev:spa"], "vite --config vite.spa.config.mjs");
  assert.equal(pkg.scripts["build:spa"], "vite build --config vite.spa.config.mjs");
  assert.match(pkg.scripts.build, /build:css/);
  assert.match(pkg.scripts.build, /build:spa/);
  assert.ok(pkg.dependencies.react);
  assert.ok(pkg.dependencies["react-dom"]);
  assert.ok(pkg.devDependencies.vite);
  assert.ok(pkg.devDependencies.typescript);
  assert.ok(pkg.devDependencies["@vitejs/plugin-react"]);
});

test("SPA shell mounts React bundle without legacy app shell scripts", async () => {
  const html = await readRepoFile("public/index.html");

  assert.match(html, /<div id="root">/);
  assert.match(html, /dist\/spa\/assets\/app\.css/);
  assert.match(html, /type="module" src="\/dist\/spa\/assets\/app\.js(?:\?[^"]*)?"/);
  assert.match(html, /components\/theme-boot\.js/);
  assert.doesNotMatch(html, /app-routes\.js/);
  assert.doesNotMatch(html, /components\/app-shell\.js/);
});

test("Vite SPA config emits stable app assets into public dist", async () => {
  const config = await readRepoFile("vite.spa.config.mjs");

  assert.match(config, /src\/spa\/main\.tsx/);
  assert.match(config, /public\/dist\/spa/);
  assert.match(config, /entryFileNames:\s*"assets\/app\.js"/);
  assert.match(config, /assetFileNames:/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, "public", filename), "utf8");

test("weapon guide exposes a Vietnamese NEWBIE tab with PoE2 weapon basics", async () => {
  const html = await readProjectFile("weapon.html");

  assert.match(html, /role="tablist"/);
  assert.match(html, /id="tab-newbie"/);
  assert.match(html, /\bNEWBIE\b/);
  assert.match(html, /Ưu tiên khi nhặt weapon/);
  assert.match(html, /Martial Weapon/);
  assert.match(html, /Caster Weapon/);
  assert.match(html, /Artificer's Orb/);
  assert.match(html, /Blacksmith's Whetstone/);
  assert.match(html, /Arcanist's Etcher/);
});

test("weapon guide avoids cross-version comparison language", async () => {
  const html = await readProjectFile("weapon.html");
  const pageText = html.replace(/<script[\s\S]*?<\/script>/gi, "");

  assert.doesNotMatch(pageText, /poe1|path of exile 1|so với|khác với|trước đây|previously/i);
});

test("weapon guide is linked from home and app routes", async () => {
  const [home, routes] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("app-routes.js")
  ]);

  assert.match(home, /href="weapon\.html"/);
  assert.match(home, />Weapon</);
  assert.match(routes, /weapon:\s*{/);
  assert.match(routes, /weapon\.html/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, "public", filename), "utf8");

test("weapon guide exposes a Vietnamese NEWBIE tab with PoE2 weapon basics", async () => {
  const html = await readProjectFile("weapon.html");

  assert.match(html, /Hướng dẫn cơ bản vũ khí đầu game/);
  assert.match(html, /data-subtitle="Newbie"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="tab-newbie"/);
  assert.match(html, /\bNEWBIE\b/);
  assert.match(html, /Ưu tiên khi nhặt vũ khí/);
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
  const [home, routes, newbie] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("app-routes.js"),
    readProjectFile("newbie.html")
  ]);

  assert.match(home, /href="\/newbie"/);
  assert.match(home, />Newbie</);
  assert.match(newbie, /href="\/weapon"/);
  assert.match(newbie, /Hướng dẫn cơ bản vũ khí đầu game/);
  assert.match(routes, /weapon:\s*{/);
  assert.match(routes, /href:\s*"\/weapon"/);
  assert.match(routes, /navParent:\s*"newbie"/);
});

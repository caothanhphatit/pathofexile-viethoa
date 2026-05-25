import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, "public", filename), "utf8");

test("newbie hub presents beginner articles as list cards", async () => {
  const html = await readProjectFile("newbie.html");

  assert.match(html, /<title>Newbie - POE2<\/title>/);
  assert.match(html, /data-component="site-header"/);
  assert.match(html, /aria-label="Danh sách bài newbie"/);
  assert.match(html, />2 bài</);
  assert.match(html, /data-newbie-card="weapon"/);
  assert.match(html, /data-newbie-card="beginner"/);
  assert.match(html, /href="\/weapon"/);
  assert.match(html, /href="\/beginner-guide"/);
  assert.match(html, /Hướng dẫn cơ bản vũ khí đầu game/);
  assert.match(html, /Hướng dẫn nhập môn Path of Exile 2/);
  assert.match(html, /Chế độ game/);
  assert.match(html, /Martial Weapon/);
  assert.match(html, /Caster Weapon/);
  assert.doesNotMatch(html, /Game Modes/);
  assert.doesNotMatch(html, /Mobalytics|mobalytics\.gg|guide Mobalytics/i);
  assert.doesNotMatch(html, /grid-cols-3/);
});

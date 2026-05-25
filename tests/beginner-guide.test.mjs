import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, "public", filename), "utf8");

test("beginner guide reads as a standalone Vietnamese beginner guide", async () => {
  const html = await readProjectFile("beginner.html");

  assert.match(html, /<title>Hướng dẫn nhập môn Path of Exile 2 - POE2<\/title>/);
  assert.match(html, /data-component="site-header" data-subtitle="Newbie"/);
  assert.match(html, /href="\/newbie"/);
  assert.match(html, /data-newbie-back/);
  assert.match(html, /Hướng dẫn nhập môn Path of Exile 2/);
  assert.match(html, /Bài hướng dẫn hệ thống hóa/);
  assert.doesNotMatch(html, /Mobalytics|mobalytics\.gg|bài gốc|guide nhập môn của|Nguồn tham khảo|source guide|The Mobalytics guide/i);
  assert.match(html, /Build guide/);
  assert.match(html, /Class/);
  assert.match(html, /Ascendancy/);
  assert.match(html, /Skill Gem/);
  assert.match(html, /Support Gem/);
  assert.match(html, /Dodge Roll/);
  assert.match(html, /Life/);
  assert.match(html, /Mana/);
  assert.match(html, /Spirit/);
  assert.match(html, /Flask/);
  assert.match(html, /Modifier/);
  assert.match(html, /Rarity/);
  assert.match(html, /Chế độ game, mùa giải/);
  assert.match(html, /Standard league/);
  assert.match(html, /League season/);
  assert.match(html, /Mặc định/);
  assert.match(html, /Hardcore/);
  assert.match(html, /Solo Self Found|SSF/);
  assert.match(html, /SSF x HC/);
  assert.match(html, /Chế độ cơ bản, không luật phụ/);
  assert.doesNotMatch(html, /Game Modes & Leagues/);
  assert.doesNotMatch(html, /Trước khi tạo nhân vật, bạn chọn môi trường chơi/);
  assert.doesNotMatch(html, /Chế độ nền/);
  assert.match(html, /Marauder/);
  assert.match(html, /Warrior/);
  assert.match(html, /Ranger/);
  assert.match(html, /Huntress/);
  assert.match(html, /Witch/);
  assert.match(html, /Sorceress/);
  assert.match(html, /Duelist/);
  assert.match(html, /Mercenary/);
  assert.match(html, /Shadow/);
  assert.match(html, /Monk/);
  assert.match(html, /Templar/);
  assert.match(html, /Druid/);
  assert.match(html, /3 Ascendancy/);
  assert.match(html, /36/);
  assert.match(html, /6 điểm bắt đầu chính/);
  assert.match(html, /Small Passive/);
  assert.match(html, /Notable/);
  assert.match(html, /Keystone/);
  assert.match(html, /Dual Specialization/);
  assert.match(html, /Uncut Skill Gem/);
  assert.match(html, /9 slot Skill Gem/);
  assert.match(html, /tối thiểu 2 socket Support Gem/);
  assert.match(html, /tối đa 5 support/);
  assert.match(html, /Meta Gem/);
  assert.match(html, /Trigger Gem/);
  assert.match(html, /Utility Flask/);
  assert.match(html, /5 slot Flask/);
  assert.match(html, /Implicit/);
  assert.match(html, /Prefix/);
  assert.match(html, /Suffix/);
  assert.match(html, /Resistance/);
  assert.match(html, /Fire, Cold, Lightning và Chaos Resistance/);
  assert.match(html, /Energy Shield/);
  assert.match(html, /Attack/);
  assert.match(html, /Spell/);
  assert.match(html, /Damage over Time/);
  assert.match(html, /Campaign/);
  assert.match(html, /từng character/);
  assert.match(html, /Gold/);
  assert.match(html, /Gold không trade trực tiếp/);
  assert.match(html, /NEWBIE_TEXT/);
  assert.match(html, /poe-locale-change|onLocaleChange/);
  assert.match(html, /data-article-i18n/);
  assert.doesNotMatch(html, /translated verbatim|dịch nguyên văn/i);
});

test("beginner guide is linked from newbie and app routes", async () => {
  const [newbie, routes] = await Promise.all([
    readProjectFile("newbie.html"),
    readProjectFile("app-routes.js")
  ]);

  assert.match(newbie, /href="\/beginner-guide"/);
  assert.match(newbie, /data-newbie-card="beginner"/);
  assert.match(routes, /beginner:\s*{/);
  assert.match(routes, /href:\s*"\/beginner-guide"/);
  assert.match(routes, /navParent:\s*"newbie"/);
});

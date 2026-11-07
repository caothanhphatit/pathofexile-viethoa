import assert from "node:assert/strict";
import test from "node:test";

import {
  detailUrl,
  gemRecordFromDetail,
  SKIP_GEM_NAME,
  uniqueRecordFromDetail
} from "../scripts/fill-missing-from-poe2db.mjs";

const uniquePage = `<!doctype html><html><head>
<meta property="og:image" content="https://cdn.poe2db.tw/image/Art/2DItems/Armours/Boots/Uniques/ThunderousSilence.webp">
</head><body>
<div class="newItemPopup UniquePopup item-popup--poe2">
  <div class="itemHeader doubleLine">
    <div class="itemName"><span class="lc">Thunderstep</span></div>
    <div class="itemName typeLine"><span class="lc">Studded Boots</span></div>
  </div>
  <div class="content"><div class="Stats">
    <div class="property">Boots</div>
    <div class="property"><a class="KeywordPopups">Evasion Rating</a>: <span class="colourAugmented">194</span></div>
    <div class="requirements">Requires:  <span>Level 28</span>, <span>39 <a>Dex</a></span></div>
    <div class="implicitMod">Grants Skill: Level 19 <a class="GemItem">Thunderous Impact</a></div>
    <div class="explicitMod">20% increased Movement Speed</div>
    <div class="explicitMod">local weapon implicit hidden % base damage is fire [50]</div>
  </div>
  <div class="FlavourText">Radya descended upon them,<br>a raging tempest.</div></div>
</div></body></html>`;

const menus = [{ key: "boots", label: "Boots", group_label: "Armour" }, { key: "body-armours", label: "Body Armours", group_label: "Armour" }];

test("uniqueRecordFromDetail reads the unique popup into an items-data row", () => {
  const row = uniqueRecordFromDetail("Thunderstep", uniquePage, menus, { now: "2026-11-07T00:00:00.000Z" });
  assert.equal(row.slug, "Thunderstep");
  assert.equal(row.menu_key, "boots");
  assert.equal(row.rarity, "unique");
  assert.deepEqual(row.build_slot_categories, ["boots"]);
  assert.deepEqual(row.properties, ["Studded Boots", "Evasion Rating: 194"]);
  assert.deepEqual(row.requirements, ["Requires: Level 28, 39 Dex"]);
  assert.deepEqual(row.mods, ["Grants Skill: Level 19 Thunderous Impact", "20% increased Movement Speed"]);
  assert.equal(row.flavour_text, "Radya descended upon them, a raging tempest.");
  assert.equal(row.source, "poe2db-detail");
  assert.equal(row.i18n.mods.length, 2);
});

test("uniqueRecordFromDetail returns null when the page has no matching unique popup", () => {
  assert.equal(uniqueRecordFromDetail("Other Name", uniquePage, menus), null);
});

const gemPage = (summary, tags) => `<!doctype html><html><head>
<meta property="og:image" content="https://cdn.poe2db.tw/image/Art/2DItems/Gems/New/NewSupport/RunicExtractionGem.webp">
<meta property="og:description" content="${summary}">
</head><body>
<div class="newItemPopup GemPopup item-popup--poe2"><div class="itemHeader"><div class="itemName"><span class="lc">Runic Extraction</span></div></div>
<div class="content"><div class="Stats"><div class="property">${tags}</div></div>
<div class="separator"></div><div class="secDescrText">${summary}</div></div></div>
</body></html>`;

test("gemRecordFromDetail skips gems poe2db marks as unused", () => {
  assert.equal(gemRecordFromDetail("Runic Extraction", gemPage("[DNT-UNUSED] Supports Bow Attacks.", "Support, Attack")), null);
});

test("gemRecordFromDetail builds a support row for Supports... gems", () => {
  const row = gemRecordFromDetail("Runic Extraction", gemPage("Supports any Skill that deals damage.", "Remnant"));
  assert.ok(row);
  assert.equal(row.gem_type, "support");
  assert.equal(row.slug, "Runic_Extraction");
  assert.equal(row.source, "poe2db-detail");
  assert.match(row.icon_url, /RunicExtractionGem\.webp$/);
});

test("skip list and URLs cover templates, dev gems and apostrophes", () => {
  for (const name of ["Companion: {0}", "Playtest Attack", "Prototype Seventeen", "Removed Skill"]) assert.ok(SKIP_GEM_NAME.test(name), name);
  assert.ok(!SKIP_GEM_NAME.test("Breachlord's Rift"));
  assert.equal(detailUrl("Wylund's Stake"), "https://poe2db.tw/us/Wylund's_Stake");
});

test("applyGameGemIds replaces guessed export ids with the game's own ids", async () => {
  const { applyGameGemIds } = await import("../scripts/fill-missing-from-poe2db.mjs");
  const gems = [
    { name: "Adhesive Grenades II", gem_type: "support", official_id: "Metadata/Items/Gems/SupportGemAdhesiveGrenadesTwo" },
    { name: "Boneshatter", gem_type: "skill" },
    { name: "Unknown Gem", gem_type: "skill", official_id: "keep-me" },
    { name: "Shared Name", gem_type: "support" }
  ];
  const changed = applyGameGemIds(gems, {
    "adhesive grenades ii": ["Metadata/Items/Gem/SupportGemAdhereTwo"],
    boneshatter: ["Metadata/Items/Gems/SkillGemBoneshatter"],
    "shared name": ["Metadata/Items/Gems/SkillGemShared", "Metadata/Items/Gem/SupportGemShared"]
  });
  assert.equal(changed, 3);
  assert.equal(gems[0].official_id, "Metadata/Items/Gem/SupportGemAdhereTwo");
  assert.equal(gems[1].official_id, "Metadata/Items/Gems/SkillGemBoneshatter");
  assert.equal(gems[2].official_id, "keep-me");
  assert.equal(gems[3].official_id, "Metadata/Items/Gem/SupportGemShared");
});

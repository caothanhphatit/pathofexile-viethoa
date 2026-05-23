import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGlossaryTerms,
  extractKeywordReferences,
  hasDirtyEnglishDescription,
  keywordHoverUrl,
  parseKeywordHoverHtml,
  translateKeywordDescription
} from "../scripts/glossary-lib.mjs";

const sampleKeywordHtml = `
<div class="explicitMod">
  <a data-keyword="Abyssalify" href="Desecrated_Modifiers" class="KeywordPopups" data-hover="?s=Data%5CKeywordPopups%2FAbyssalify">Desecrates</a>
  a <a data-keyword="ItemRarity" href="Item_Rarity" class="KeywordPopups" data-hover="?s=Data%5CKeywordPopups%2FItemRarity">Rare</a>
  Amulet, Ring or Belt
</div>`;

const sampleHoverHtml = `
<div class="newItemPopup keywordPopups">
  <div class="card mb-2">
    <h5 class="card-header"><a href="Desecrated_Modifiers">Desecrated Modifiers</a></h5>
    <div class="card-body"><div class="keyword-body">
      Desecrating an item adds an Unrevealed Desecrated modifier.<br>
      Items with Desecrated Modifiers cannot be Desecrated again.
    </div></div>
  </div>
</div>`;

test("extractKeywordReferences reads underlined PoE2DB keyword anchors", () => {
  const refs = extractKeywordReferences(sampleKeywordHtml, "https://poe2db.tw/us/Ancient_Collarbone");

  assert.deepEqual(refs.map((ref) => ({
    keyword: ref.keyword,
    label: ref.label,
    href: ref.href,
    hover_url: ref.hover_url
  })), [
    {
      keyword: "Abyssalify",
      label: "Desecrates",
      href: "https://poe2db.tw/us/Desecrated_Modifiers",
      hover_url: "https://poe2db.tw/us/hover?s=Data%5CKeywordPopups%2FAbyssalify"
    },
    {
      keyword: "ItemRarity",
      label: "Rare",
      href: "https://poe2db.tw/us/Item_Rarity",
      hover_url: "https://poe2db.tw/us/hover?s=Data%5CKeywordPopups%2FItemRarity"
    }
  ]);
});

test("parseKeywordHoverHtml extracts title and description lines", () => {
  assert.deepEqual(parseKeywordHoverHtml(sampleHoverHtml), {
    title: "Desecrated Modifiers",
    description_en: "Desecrating an item adds an Unrevealed Desecrated modifier. Items with Desecrated Modifiers cannot be Desecrated again."
  });
});

test("buildGlossaryTerms keeps item rarity as a protected glossary term", () => {
  const references = extractKeywordReferences(sampleKeywordHtml, "https://poe2db.tw/us/Ancient_Collarbone");
  const hovers = new Map([
    [keywordHoverUrl("?s=Data%5CKeywordPopups%2FAbyssalify", "https://poe2db.tw/us/Ancient_Collarbone"), parseKeywordHoverHtml(sampleHoverHtml)],
    [keywordHoverUrl("?s=Data%5CKeywordPopups%2FItemRarity", "https://poe2db.tw/us/Ancient_Collarbone"), {
      title: "Item Rarity",
      description_en: "Items can be Normal (grey), Magic (blue), Rare (yellow) or Unique (brown)."
    }]
  ]);
  const terms = buildGlossaryTerms(references, hovers);
  const rarity = terms.find((term) => term.term === "Item Rarity");

  assert.ok(terms.some((term) => term.term === "Desecrated Modifiers"));
  assert.deepEqual(rarity.variants, ["Rare"]);
  assert.match(rarity.meaning, /Normal.*Magic.*Rare.*Unique/);
});

test("translateKeywordDescription renders endgame item tooltips in clean Vietnamese", () => {
  const references = [{
    keyword: "PrecursorTablet",
    label: "Precursor Tablet",
    href: "https://poe2db.tw/us/Precursor_Tablets",
    hover_url: "https://poe2db.tw/us/hover?s=Data%5CKeywordPopups%2FPrecursorTablet",
    source_url: "https://poe2db.tw/us/Stackable_Currency"
  }];
  const hovers = new Map([[
    references[0].hover_url,
    {
      title: "Precursor Tablets",
      description_en: "Precursor Tablets are special items that can be used in the Map Device to add more Endgame Mechanics to Maps on your Atlas."
    }
  ]]);
  const [precursor] = buildGlossaryTerms(references, hovers);

  assert.equal(precursor.category, "endgame");
  assert.equal(
    translateKeywordDescription(
      "Precursor Tablets",
      "Precursor Tablets are special items that can be used in the Map Device to add more Endgame Mechanics to Maps on your Atlas."
    ),
    "Precursor Tablets là item đặc biệt dùng trong Map Device để thêm Endgame Mechanics vào Maps trên Atlas của bạn."
  );
  assert.equal(
    translateKeywordDescription(
      "Waystones",
      "Waystones are items that can be used to travel to Maps on the Atlas. Waystones come in different tiers, with higher tiers meaning higher level monsters to fight. Waystones can be modified to increase the difficulty and reward of the monster encountered in maps."
    ),
    "Waystones là item dùng để mở Maps trên Atlas. Waystones có nhiều tier; tier cao hơn nghĩa là monster level cao hơn. Có thể craft hoặc biến đổi Waystones để tăng độ khó và phần thưởng từ monster gặp trong Maps."
  );
});

test("translateKeywordDescription rejects mixed English/Vietnamese tooltip glue", () => {
  const cases = [
    [
      "Allies",
      "Your allies include other players, Minions, and any other entity that fights alongside you and has its own stats. You do not count as your own Ally."
    ],
    [
      "Augment",
      "Augments are items which can be placed into Augment sockets, usually on Equipment items. Once socketed, they can be replaced by other Augments, but cannot be removed by normal means."
    ],
    [
      "Damage Conversion",
      "Damage can be converted from one type to another. This causes it to deal the new damage type, scale with modifiers to the new damage type, and no longer scale with modifiers to the old damage type."
    ],
    [
      "Accurate",
      "Monster has 200% increased Accuracy Rating."
    ],
    [
      "Volatile Crag",
      "Monster periodically creates Volatile Crag that moves towards enemies; exploding when they get close enough; dealing Fire Damage."
    ]
  ];

  for (const [term, description] of cases) {
    const translated = translateKeywordDescription(term, description);
    assert.ok(translated.length > 20, `${term} has a useful translation`);
    assert.equal(hasDirtyEnglishDescription(translated), false, `${term} translation is clean`);
  }
});

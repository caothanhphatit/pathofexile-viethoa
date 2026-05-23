import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  classifyCurrencyFamily,
  parseCurrencyPage,
  translateCurrencyText
} from "../scripts/currency-lib.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const loadCurrencyExport = () => {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(join(repoRoot, "currency-data.js"), "utf8"), sandbox);
  return sandbox.window.POE2_CURRENCY;
};

const sampleHtml = `
<div id="StackableCurrencyItem" class="tab-pane fade show active">
  <div class="card mb-2">
    <h5 class="card-header">Stackable Currency Item /72</h5>
    <div class="row row-cols-1 row-cols-lg-2 g-2">
      <div class="col">
        <div class="d-flex border-top rounded">
          <div class="flex-shrink-0">
            <a class="item_currency StackableCurrency" data-hover="?s=Data%5CBaseItemTypes%2FMetadata%2FItems%2FCurrency%2FCurrencyWeaponQuality" href="Blacksmiths_Whetstone">
              <img loading="lazy" src="https://cdn.poe2db.tw/image/Art/2DItems/Currency/CurrencyWeaponQuality.webp" alt="CurrencyWeaponQuality" class="w1" />
            </a>
          </div>
          <div class="flex-grow-1 ms-2">
            <a class="item_currency StackableCurrency" href="Blacksmiths_Whetstone"><img height="16" />Blacksmith's Whetstone</a>
            <div>
              <div class="property">Stack Size: <span class='colourDefault'>1 / 20</span></div>
              <div class="separator"></div>
              <div class="explicitMod">Improves the quality of a Martial Weapon</div>
            </div>
          </div>
        </div>
      </div>
      <div class="col">
        <div class="d-flex border-top rounded">
          <div class="flex-shrink-0">
            <a class="item_currency StackableCurrency" data-hover="/cache2/us/CurrencyChaosOrb" href="/us/Chaos_Orb">
              <img src="/image/Art/2DItems/Currency/CurrencyRerollRare.webp" alt="CurrencyRerollRare" class="w1" />
            </a>
          </div>
          <div class="flex-grow-1 ms-2">
            <a class="item_currency StackableCurrency" href="/us/Chaos_Orb">Chaos Orb</a>
            <div>
              <div class="property">Stack Size: <span class='colourDefault'>1 / 20</span></div>
              <div class="explicitMod">Removes a random modifier and augments a rare item with a new random modifier</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<div id="Essence" class="tab-pane fade">
  <div class="card mb-2">
    <h5 class="card-header">Essence /81</h5>
    <div class="row row-cols-1 row-cols-lg-2 g-2">
      <div class="col">
        <div class="d-flex border-top rounded">
          <a class="item_currency StackableCurrency" href="/us/Greater_Essence_of_Ruin">
            <img src="/image/Art/2DItems/Currency/Essence/Ruin.webp" alt="EssenceRuin" class="w1" />
          </a>
          <div class="flex-grow-1 ms-2">
            <a class="item_currency StackableCurrency" href="/us/Greater_Essence_of_Ruin">Greater Essence of Ruin</a>
            <div class="property">Stack Size: <span>1 / 10</span></div>
            <div class="explicitMod">Upgrades a normal item to a magic item with one guaranteed Chaos modifier</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`;

test("classifyCurrencyFamily splits broad currency into useful families", () => {
  assert.deepEqual(
    classifyCurrencyFamily({ name: "Concentrated Liquid Isolation", category: "StackableCurrencyItem", description_en: "Players in Area are 50% Delirious" }),
    { family: "delirium-liquid", family_label: "Delirium Liquid" }
  );
  assert.deepEqual(
    classifyCurrencyFamily({ name: "Black Scythe Artifact", category: "StackableCurrencyItem", description_en: "" }),
    { family: "expedition-artifact", family_label: "Expedition Artifact" }
  );
  assert.deepEqual(
    classifyCurrencyFamily({ name: "Greater Essence of Ruin", category: "Essence", description_en: "" }),
    { family: "essence", family_label: "Essence" }
  );
  assert.equal(
    translateCurrencyText("Players in Area are 50% Delirious"),
    "Người chơi trong khu vực bị 50% Delirious."
  );
  assert.equal(
    translateCurrencyText("Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills"),
    "Có thể kết hợp với các Liquid Emotion khác để Instil Notable Passive Skill cho Amulet."
  );
});

test("parseCurrencyPage extracts categories, item records, stack size, and effects", () => {
  const currencies = parseCurrencyPage(sampleHtml, "https://poe2db.tw/us/Stackable_Currency");

  assert.equal(currencies.length, 3);
  assert.deepEqual(currencies[0], {
    slug: "Blacksmiths_Whetstone",
    name: "Blacksmith's Whetstone",
    category: "StackableCurrencyItem",
    category_label: "Currency",
    family: "quality-currency",
    family_label: "Quality Currency",
    subtype: "quality-currency",
    subtype_label: "Quality Currency",
    source_url: "https://poe2db.tw/us/Blacksmiths_Whetstone",
    icon_url: "https://cdn.poe2db.tw/image/Art/2DItems/Currency/CurrencyWeaponQuality.webp",
    icon_alt: "CurrencyWeaponQuality",
    hover_url: "https://poe2db.tw/us/Stackable_Currency?s=Data%5CBaseItemTypes%2FMetadata%2FItems%2FCurrency%2FCurrencyWeaponQuality",
    stack_size: "1 / 20",
    description_en: "Improves the quality of a Martial Weapon",
    properties: ["Stack Size: 1 / 20"],
    mods: ["Improves the quality of a Martial Weapon"],
    source_hash: currencies[0].source_hash
  });
  assert.match(currencies[0].source_hash, /^[a-f0-9]{64}$/);
  assert.equal(currencies[2].category_label, "Essence");
  assert.equal(currencies[2].family_label, "Essence");
  assert.equal(currencies[2].subtype_label, "Essence");
});

test("currency data uses subtype consistently for tags and filters", () => {
  const currencies = parseCurrencyPage(sampleHtml, "https://poe2db.tw/us/Stackable_Currency");

  assert.ok(new Set(currencies.map((item) => item.subtype)).size >= 2);
  assert.ok(currencies.every((item) => item.subtype && item.subtype_label));
  assert.deepEqual(
    currencies.map((item) => [item.slug, item.subtype, item.subtype_label]),
    currencies.map((item) => [item.slug, item.family, item.family_label])
  );
});

test("translateCurrencyText renders natural Vietnamese while preserving POE terms", () => {
  assert.equal(
    translateCurrencyText("Desecrates a Rare Amulet, Ring or Belt"),
    "Áp dụng Desecrate lên Rare Amulet, Ring hoặc Belt."
  );
  assert.equal(
    translateCurrencyText("Upgrades a normal item to a magic item with one guaranteed Chaos modifier"),
    "Nâng Normal item thành Magic item với một Chaos modifier được đảm bảo."
  );
  assert.equal(
    translateCurrencyText("Removes a random modifier and augments a rare item with a new random modifier"),
    "Xóa một modifier ngẫu nhiên và thêm một modifier ngẫu nhiên mới vào Rare item."
  );
  assert.equal(
    translateCurrencyText("Upgrades a normal item to a magic item with one guaranteed Chaos modifier"),
    "Nâng Normal item thành Magic item với một Chaos modifier được đảm bảo."
  );
  assert.equal(
    translateCurrencyText("Reforges a rare item with new random modifiers"),
    "Reforge Rare item với các modifier ngẫu nhiên mới."
  );
});

test("translateCurrencyText covers production currency and essence lines without English glue", () => {
  const cases = new Map([
    [
      "Upgrades a Magic item to a Rare item, adding a guaranteed modifier",
      "Nâng Magic item thành Rare item và thêm một modifier được đảm bảo."
    ],
    [
      "Augments a Rare item with a new random modifier",
      "Thêm một modifier ngẫu nhiên mới vào Rare item."
    ],
    [
      "Randomises the numeric values of modifiers on an item",
      "Reroll giá trị số của modifier trên item."
    ],
    [
      "Allows an item to foresee the result of the next Currency item used on it Modifying the item in any way removes the ability to foresee",
      "Cho phép item xem trước kết quả của Currency tiếp theo được dùng lên nó. Bất kỳ thay đổi nào lên item sẽ xóa khả năng xem trước này."
    ],
    [
      "Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills",
      "Có thể kết hợp với các Liquid Emotion khác để Instil Notable Passive Skill cho Amulet."
    ],
    [
      "One Handed Melee Weapon or Bow: Adds (10—15) to (18—26) Physical Damage",
      "One Handed Melee Weapon hoặc Bow: thêm (10—15) đến (18—26) Physical Damage."
    ],
    [
      "Two Handed Melee Weapon or Crossbow: Gain (25—33)% of Damage as Extra Physical Damage",
      "Two Handed Melee Weapon hoặc Crossbow: nhận (25—33)% Damage dưới dạng Extra Physical Damage."
    ],
    [
      "Bow or Crossbow: (11—13)% increased Attack Speed",
      "Bow hoặc Crossbow: tăng (11—13)% Attack Speed."
    ],
    [
      "Amulet, Boots or Gloves: +(85—99) to maximum Life",
      "Amulet, Boots hoặc Gloves: +(85—99) maximum Life."
    ],
    [
      "Belt: On Corruption, Item gains two Enchantments",
      "Belt: khi Corrupt, item nhận hai Enchantment."
    ]
  ]);

  const dirtyGlue = /\b(Upgrade|Augments?|Remove|Randomise|Identifies|Desecrates|Adds|Gain)\b|\bor Bow\b|\bor Crossbow\b|\bremove khả năng\b|unpredictably/i;

  for (const [source, expected] of cases) {
    const translated = translateCurrencyText(source);
    assert.equal(translated, expected);
    assert.doesNotMatch(translated, dirtyGlue, source);
  }
});

test("exported currency data avoids production-facing English glue in Vietnamese fields", () => {
  const data = loadCurrencyExport();
  const rows = [];

  for (const item of data.items || []) {
    if (item.i18n?.description?.vi) rows.push([item.slug, "description", item.i18n.description.vi]);
    for (const [index, mod] of (item.i18n?.mods || []).entries()) {
      if (mod.vi) rows.push([item.slug, `mods.${index}`, mod.vi]);
    }
  }

  const dirtyGlue = /\b(Upgrade|Randomise|Identifies|Desecrates)\b|\bAugment (?:Magic|Rare|Normal) item\b|\bRemove (?:một|toàn bộ)\b|\bAdds\b|\bGain\b|\bor Bow\b|\bor Crossbow\b|\bor Wand\b|\bremove khả năng\b|unpredictably/i;
  const dirty = rows.filter(([, , value]) => dirtyGlue.test(value));

  assert.equal(dirty.length, 0, dirty.slice(0, 20).map(([slug, field, value]) => `${slug}.${field}: ${value}`).join("\n"));
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseItemListingPage,
  parseItemsMenu,
  translateItemLine
} from "../scripts/items/items-lib.mjs";

const itemsMenuHtml = `
  <div id="left">
    <div class="card">
      <h5 class="card-header">One Handed Weapons</h5>
      <div class="list-group">
        <a class="list-group-item" href="/us/Claws">Claws</a>
        <a class="list-group-item" href="/us/Daggers">Daggers</a>
      </div>
    </div>
    <div class="card">
      <h5 class="card-header">Armour</h5>
      <a class="list-group-item" href="/us/Body_Armours">Body Armours</a>
    </div>
  </div>`;

const clawsHtml = `
  <div class="row">
    <div class="col">
      <div class="newItemPopup">
        <h5 class="card-header"><a href="/us/Iron_Claw">Iron Claw</a></h5>
        <img class="item_icon" src="/image/Art/2DItems/Weapons/Claws/Claw1.png" alt="Iron Claw">
        <div class="property">Claw</div>
        <div class="property">Physical Damage: 4-11</div>
        <div class="requirements">Requires Level 4, 14 Dex, 14 Int</div>
        <div class="explicitMod">
          <a class="KeywordPopups" data-keyword="Attack" data-hover="?s=Data%5CKeywordPopups%2FAttack" href="Attack">Attack</a>
          Skills gain 3 Life per Enemy Hit
        </div>
      </div>
    </div>
    <div class="col">
      <a href="/us/Trade">Trade</a>
    </div>
  </div>`;

test("parseItemsMenu extracts grouped PoE2DB item menus", () => {
  const menus = parseItemsMenu(itemsMenuHtml, "https://poe2db.tw/us/Items");

  assert.deepEqual(menus.map((menu) => ({
    key: menu.key,
    label: menu.label,
    group_label: menu.group_label,
    source_url: menu.source_url
  })), [
    {
      key: "claws",
      label: "Claws",
      group_label: "One Handed Weapons",
      source_url: "https://poe2db.tw/us/Claws"
    },
    {
      key: "daggers",
      label: "Daggers",
      group_label: "One Handed Weapons",
      source_url: "https://poe2db.tw/us/Daggers"
    },
    {
      key: "body-armours",
      label: "Body Armours",
      group_label: "Armour",
      source_url: "https://poe2db.tw/us/Body_Armours"
    }
  ]);
});

test("parseItemListingPage extracts source English items, tooltip refs, and hashes", () => {
  const [menu] = parseItemsMenu(itemsMenuHtml, "https://poe2db.tw/us/Items");
  const items = parseItemListingPage(clawsHtml, menu);

  assert.equal(items.length, 1);
  assert.equal(items[0].slug, "Iron_Claw");
  assert.equal(items[0].name, "Iron Claw");
  assert.equal(items[0].menu_key, "claws");
  assert.deepEqual(items[0].properties, ["Claw", "Physical Damage: 4-11"]);
  assert.deepEqual(items[0].requirements, ["Requires Level 4, 14 Dex, 14 Int"]);
  assert.match(items[0].mods[0], /Attack Skills gain/);
  assert.equal(items[0].tooltip_refs[0].term, "Attack");
  assert.equal("translated" in items[0], false);
  assert.match(items[0].source_hash, /^[a-f0-9]{64}$/);
});

test("translateItemLine keeps dictionary-backed terms in English", () => {
  assert.equal(
    translateItemLine("Attack Skills gain 3 Life per Enemy Hit"),
    "Attack Skill nhận 3 Life mỗi kẻ địch Hit."
  );
});

test("translateItemLine removes leaked English it/its from item modifiers", () => {
  const dirtyPronouns = /\b(it|its|itself)\b/i;
  const cases = new Map([
    [
      "This item gains bonuses from Socketed Items as though it was a Body Armour",
      "Item này nhận bonus từ Socketed Items như Body Armour."
    ],
    [
      "Modifies a Soul Core unpredictably, with a chance to destroy it",
      "Biến đổi Soul Core theo kết quả khó đoán, có thể phá hủy mục tiêu."
    ],
    [
      "Destroys an Equipment item, returning any Augments socketed in it",
      "Phá hủy Equipment item và hoàn trả mọi Augment đang socket trong đó."
    ],
    [
      "While this item is active in your inventory your next Divine Orb used on a Rare item will Sanctify it",
      "Khi item này đang active trong inventory, Divine Orb tiếp theo của bạn khi dùng lên Rare item sẽ Sanctify item đó."
    ],
    [
      "When you kill a Rare monster, you gain its Modifiers for 60 seconds",
      "Khi bạn giết Rare monster, bạn nhận Modifiers của monster đó trong 60 giây."
    ]
  ]);

  for (const [source, expected] of cases) {
    const translated = translateItemLine(source);
    assert.equal(translated, expected);
    assert.doesNotMatch(translated, dirtyPronouns, source);
  }
});

test("translateItemLine localizes common item modifier glue", () => {
  const cases = new Map([
    [
      "Adds 1 to (30—50) Lightning damage to Attacks",
      "Thêm 1 đến (30—50) Lightning Damage cho Attacks."
    ],
    [
      "25% increased Melee Strike Range with this weapon",
      "Tăng 25% Melee Strike Range với weapon này."
    ],
    [
      "Gain 5 Rage when Hit by an Enemy",
      "Nhận 5 Rage khi bị kẻ địch Hit."
    ],
    [
      "Regenerate 5% of maximum Life per second while Surrounded",
      "Regenerate 5% Life tối đa mỗi giây khi Surrounded."
    ],
    [
      "Adds a Mirror of Delirium to a Map 3 uses remaining",
      "Thêm Mirror of Delirium vào Map. Còn 3 lần dùng."
    ],
    [
      "Used when you take Chaos damage from a Hit",
      "Được dùng khi bạn nhận Chaos Damage từ Hit."
    ],
    [
      "Martial Weapon: Causes 30% increased Stun Buildup",
      "Martial Weapon: tăng 30% Stun Buildup."
    ],
    [
      "(30—50)% increased Evasion and Energy Shield",
      "(30—50)% tăng Evasion và Energy Shield."
    ],
    [
      "Bleeding you inflict is Aggravated",
      "Bleeding bạn gây được Aggravate."
    ],
    [
      "Cannot be Ignited",
      "Không thể bị Ignited."
    ],
    [
      "50% of Physical Damage from Hits taken as Fire Damage",
      "50% Physical Damage từ Hits nhận vào dưới dạng Fire Damage."
    ],
    [
      "You count as on Full Mana while at 90% of maximum Mana or above",
      "Bạn được tính là Full Mana khi đạt từ 90% Mana tối đa trở lên."
    ],
    [
      "Allies in your Presence deal 50% increased Damage",
      "Allies trong Presence của bạn gây 50% increased Damage."
    ],
    [
      "Enemies in your Presence have Lightning Resistance equal to yours",
      "Kẻ địch trong Presence của bạn có Lightning Resistance bằng chỉ số của bạn."
    ],
    [
      "Warcries Explode Corpses dealing 10% of their Life as Physical Damage",
      "Warcries Explode Corpses, gây 10% Life của Corpse dưới dạng Physical Damage."
    ]
  ]);

  const dirtyGlue = /\b(adds|when|while|used|with this weapon|per second|uses remaining|you inflict|and Energy Shield|Damage from Hits taken|count as on Full Mana)\b/i;
  for (const [source, expected] of cases) {
    const translated = translateItemLine(source);
    assert.equal(translated, expected);
    assert.doesNotMatch(translated, dirtyGlue, source);
  }
});

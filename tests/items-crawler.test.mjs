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
    "Attack Skill nhận 3 Life mỗi Enemy Hit."
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ITEMS_SOURCE_URL,
  buildItemsExportPayload,
  exportItems,
  inferItemRarity,
  upsertItems
} from "../scripts/items/runtime.mjs";

test("items runtime exports a stable frontend payload from Postgres rows", async () => {
  const queries = [];
  const fakePool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/from item_menus/i.test(sql)) {
        return {
          rows: [{
            key: "claws",
            label: "Claws",
            group_label: "One Handed Weapons",
            source_url: "https://poe2db.tw/us/Claws",
            sort_order: 1,
            updated_at: "2026-05-23T00:00:00.000Z"
          }]
        };
      }
      if (/from items/i.test(sql)) {
        return {
          rows: [{
            slug: "Iron_Claw",
            menu_key: "claws",
            menu_label: "Claws",
            group_label: "One Handed Weapons",
            name: "Iron Claw",
            source_url: "https://poe2db.tw/us/Iron_Claw",
            icon_url: "https://cdn.poe2db.tw/iron.png",
            icon_alt: "Iron Claw",
            properties_json: ["Claw"],
            requirements_json: ["Requires Level 4, 14 Dex, 14 Int"],
            mods_json: ["Attack Skills gain 3 Life per Enemy Hit"],
            tooltip_refs_json: [{ term: "Attack", keyword: "Attack" }],
            source_hash: "a".repeat(64),
            status: "active",
            updated_at: "2026-05-23T00:00:00.000Z"
          }]
        };
      }
      if (/from crawl_runs/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };

  const payload = await exportItems(fakePool);

  assert.equal(DEFAULT_ITEMS_SOURCE_URL, "https://poe2db.tw/us/Items");
  assert.equal(payload.total, 1);
  assert.equal(payload.active_total, 1);
  assert.equal(payload.menus[0].count, 1);
  assert.equal(payload.items[0].rarity, "");
  assert.deepEqual(payload.items[0].i18n.mods[0], {
    en: "Attack Skills gain 3 Life per Enemy Hit",
    vi: "Attack Skills gain 3 Life per Enemy Hit"
  });
  assert.equal("translated" in payload.items[0], false);
  assert.match(queries.map((query) => query.sql).join("\n"), /status = 'active'/i);
});

test("item export marks uniques even when Poe2DB icon paths omit the Uniques folder", () => {
  const payload = buildItemsExportPayload({
    menus: [{ key: "rings", label: "Rings", group_label: "Jewellery" }],
    items: [
      {
        slug: "Amethyst_Ring",
        menu_key: "rings",
        menu_label: "Rings",
        group_label: "Jewellery",
        name: "Amethyst Ring",
        source_url: "https://poe2db.tw/us/Amethyst_Ring",
        icon_url: "https://cdn.poe2db.tw/image/Art/2DItems/Rings/Basetypes/AmethystRing.webp",
        icon_alt: "AmethystRing",
        properties_json: [],
        requirements_json: ["Requires: Level 20"],
        mods_json: ["+(7-13)% to Chaos Resistance"],
        tooltip_refs_json: [],
        source_hash: "a".repeat(64),
        status: "active"
      },
      {
        slug: "Blackflame",
        menu_key: "rings",
        menu_label: "Rings",
        group_label: "Jewellery",
        name: "Blackflame",
        source_url: "https://poe2db.tw/us/Blackflame",
        icon_url: "https://cdn.poe2db.tw/image/Art/2DItems/Rings/BlackFlameChaos.webp",
        icon_alt: "BlackFlameChaos",
        properties_json: ["Amethyst Ring"],
        requirements_json: ["Requires: Level 20"],
        mods_json: ["use unique blackflame ignite effect [1]"],
        tooltip_refs_json: [],
        source_hash: "b".repeat(64),
        status: "active"
      },
      {
        slug: "Kalandras_Touch",
        menu_key: "rings",
        menu_label: "Rings",
        group_label: "Jewellery",
        name: "Kalandra's Touch",
        source_url: "https://poe2db.tw/us/Kalandras_Touch",
        icon_url: "https://cdn.poe2db.tw/image/Art/2DItems/Rings/MirrorRing.webp",
        icon_alt: "MirrorRing",
        properties_json: ["Amethyst Ring"],
        requirements_json: [],
        mods_json: ["Reflects opposite Ring"],
        tooltip_refs_json: [],
        source_hash: "c".repeat(64),
        status: "active"
      }
    ]
  });

  const byName = Object.fromEntries(payload.items.map((item) => [item.name, item]));
  assert.equal(byName["Amethyst Ring"].rarity, "");
  assert.equal(byName.Blackflame.rarity, "unique");
  assert.equal(byName["Kalandra's Touch"].rarity, "unique");
  assert.equal(inferItemRarity(byName.Blackflame, new Set(["Amethyst Ring"])), "unique");
});

test("buildItemsExportPayload counts active items per menu", () => {
  const payload = buildItemsExportPayload({
    menus: [{ key: "claws", label: "Claws", group_label: "One Handed Weapons" }],
    items: [
      { slug: "one", menu_key: "claws", status: "active" },
      { slug: "two", menu_key: "claws", status: "removed" }
    ]
  });

  assert.equal(payload.menus[0].count, 1);
  assert.equal(payload.active_total, 1);
});

test("upsertItems batches item and tooltip writes for remote Postgres", async () => {
  const calls = [];
  const item = (slug) => ({
    slug,
    menu_key: "claws",
    menu_label: "Claws",
    group_label: "One Handed Weapons",
    name: slug.replace("_", " "),
    source_url: `https://poe2db.tw/us/${slug}`,
    icon_url: "",
    icon_alt: "",
    requirements: [],
    properties: ["Claw"],
    mods: ["Attack Skills gain 3 Life per Enemy Hit"],
    tooltip_refs: [{ term: "Attack", keyword: "Attack", label: "Attack", href: "", hover_url: "", source_url: "" }],
    source_hash: "b".repeat(64)
  });
  const fakeClient = {
    async query(sql) {
      calls.push(sql);
      if (/select \* from items where slug = any/i.test(sql)) return { rows: [] };
      if (/returning slug/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }
  };

  const summary = await upsertItems(fakeClient, [item("Iron_Claw"), item("Bone_Claw")], 7);

  assert.equal(summary.new_count, 2);
  assert.ok(calls.length <= 6, `expected batched writes, got ${calls.length} queries`);
  assert.match(calls.join("\n"), /jsonb_to_recordset/i);
});

test("upsertItems deduplicates repeated slugs before batched upsert", async () => {
  let itemBatch = [];
  const baseItem = {
    slug: "Spark",
    menu_key: "gem",
    menu_label: "Gem",
    group_label: "Gems",
    name: "Spark",
    source_url: "https://poe2db.tw/us/Spark",
    icon_url: "",
    icon_alt: "",
    requirements: [],
    properties: [],
    mods: [],
    tooltip_refs: [],
    source_hash: "c".repeat(64)
  };
  const fakeClient = {
    async query(sql, params = []) {
      if (/select \* from items where slug = any/i.test(sql)) return { rows: [] };
      if (/insert into items/i.test(sql)) itemBatch = JSON.parse(params[0]);
      return { rows: [], rowCount: 0 };
    }
  };

  const summary = await upsertItems(fakeClient, [
    baseItem,
    { ...baseItem, menu_key: "skill-gems", menu_label: "Skill Gems" }
  ], 8);

  assert.equal(summary.total_count, 1);
  assert.equal(summary.new_count, 1);
  assert.equal(itemBatch.length, 1);
});

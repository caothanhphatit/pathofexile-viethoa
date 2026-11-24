import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildTranslationMemory,
  mergeCurrencyBundle,
  mergeItemsBundle,
  mergeSkillGemsBundle,
  preserveLineTranslations,
  renderMarkdownReport
} from "../scripts/sot/sync-from-sot.mjs";
import {
  localRelWebpPath,
  localWebUrl,
  normalizeArtPath,
  rewriteSiteIconUrls
} from "../scripts/ggpk/sync-site-icons.mjs";

test("preserveLineTranslations keeps existing Vietnamese lines across dash/whitespace formatting and memory fallback", () => {
  const memory = buildTranslationMemory([
    {
      i18n: {
        mods: {
          en: ["+(10-20) to maximum Life", "15% increased Cast Speed"],
          vi: ["+(10-20) Máu tối đa", "Tăng 15% Tốc độ Thi triển"]
        }
      }
    }
  ], [(r) => (r.i18n?.mods?.en || []).map((e, i) => [e, r.i18n?.mods?.vi?.[i]])]);

  const result = preserveLineTranslations(
    ["+(10—20) to maximum Life", "15% increased Cast Speed", "Brand new season mod"],
    { en: ["15% increased Cast Speed"], vi: ["Tăng 15% Tốc độ Thi triển (local)"] },
    memory
  );

  assert.deepEqual(result.vi, [
    "+(10-20) Máu tối đa",
    "Tăng 15% Tốc độ Thi triển (local)",
    "Brand new season mod"
  ]);
  assert.deepEqual(result.untranslated, ["Brand new season mod"]);
});

test("mergeSkillGemsBundle takes tier/tags/official_id from PoB, color from GGPK, preserves slugs & vi, and adds missing PoB gems", () => {
  const siteBundle = {
    total: 1,
    active_total: 1,
    support_total: 0,
    gems: [
      {
        slug: "Fireball",
        name: "Fireball",
        gem_type: "skill",
        tier: 1, // false tier from old crawl
        color: "red", // wrong color
        official_id: null,
        tags: ["Spell"],
        summary_en: "Hurls a ball of fire",
        properties: [],
        requirements: [],
        mods: [],
        sections: [],
        i18n: {
          summary: { en: "Hurls a ball of fire", vi: "Ném một quả cầu lửa" },
          tags: [{ en: "Spell", vi: "Phép" }, { en: "Fire", vi: "Lửa" }]
        }
      }
    ]
  };

  const pobGems = [
    {
      slug: "Fireball",
      name: "Fireball",
      gem_type: "skill",
      tier: null,
      color: "blue",
      official_id: "Metadata/Items/Gems/SkillGemFireball",
      tags: ["Spell", "Fire", "Projectile"],
      summary_en: "Hurls a ball of fire",
      properties: [],
      requirements: [],
      mods: [],
      sections: []
    },
    {
      slug: "Curse_on_Block",
      name: "Curse on Block",
      gem_type: "skill",
      tier: null,
      color: "red",
      official_id: "Metadata/Items/Gems/SkillGemCurseOnBlock",
      tags: ["Buff", "Meta"],
      summary_en: "Triggers socketed curses when you block",
      properties: ["Spirit: 60"],
      requirements: ["Requires: Level 31"],
      mods: [],
      sections: [{ title: "Stats", lines: ["Triggers socketed curses"] }]
    }
  ];

  const ggpkGems = [
    { id: "Metadata/Items/Gems/SkillGemFireball", name: "Fireball", gem_type: "skill", color: "blue", excluded: null },
    { id: "Metadata/Items/Gems/SkillGemCurseOnBlock", name: "Curse on Block", gem_type: "skill", color: "green", excluded: null }
  ];

  const { bundle, stats } = mergeSkillGemsBundle(siteBundle, pobGems, ggpkGems, { iconsDir: os.tmpdir() });
  assert.equal(bundle.total, 2);
  assert.equal(bundle.gems[0].slug, "Fireball");
  assert.equal(bundle.gems[0].tier, null);
  assert.equal(bundle.gems[0].color, "blue");
  assert.equal(bundle.gems[0].official_id, "Metadata/Items/Gems/SkillGemFireball");
  assert.deepEqual(bundle.gems[0].i18n.tags, [
    { en: "Spell", vi: "Phép" },
    { en: "Fire", vi: "Lửa" },
    { en: "Projectile", vi: "Projectile" }
  ]);
  assert.equal(bundle.gems[0].i18n.summary.vi, "Ném một quả cầu lửa");
  assert.ok(Array.isArray(bundle.gems[1].i18n.tags));
  assert.ok(Array.isArray(bundle.gems[1].i18n.sections));

  assert.equal(stats.added.length, 1);
  assert.equal(bundle.gems[1].name, "Curse on Block");
  assert.equal(bundle.gems[1].color, "green"); // GGPK wins on color
  assert.ok(stats.untranslated.includes("Triggers socketed curses"));
});

test("mergeItemsBundle enriches uniques with PoB flavour/league/source and adds GGPK requirements & stack size without losing vi", () => {
  const siteBundle = {
    items: [
      {
        slug: "Ab_Aeterno",
        menu_key: "boots",
        name: "Ab Aeterno",
        rarity: "unique",
        properties: ["Grand Cuisses"],
        requirements: ["Requires: Level 12"],
        mods: ["+10 to Strength"],
        i18n: { mods: { en: ["+10 to Strength"], vi: ["+10 Sức mạnh"] } }
      },
      {
        slug: "Absent_Amulet",
        menu_key: "amulets",
        name: "Absent Amulet",
        rarity: "normal",
        properties: [],
        requirements: [],
        mods: [],
        i18n: {}
      },
      {
        slug: "Omen_of_Corruption",
        menu_key: "omen",
        name: "Omen of Corruption",
        rarity: "currency",
        properties: [],
        requirements: [],
        mods: [],
        i18n: {}
      }
    ]
  };

  const { bundle, stats } = mergeItemsBundle(siteBundle, {
    pobUniques: [
      {
        name: "Ab Aeterno",
        flavour_text: "Time unravels all.",
        pob: { league: "Dawn of the Hunt", source: "Drops from Xesht" }
      }
    ],
    ggpkBaseItems: [
      { name: "Absent Amulet", requirements: { level: 50, str: 0, dex: 0, int: 0 } }
    ],
    ggpkMiscItems: [
      { name: "Omen of Corruption", stack_size: 10 }
    ]
  });

  assert.equal(bundle.items[0].flavour_text, "Time unravels all.");
  assert.equal(bundle.items[0].league, "Dawn of the Hunt");
  assert.equal(bundle.items[0].drop_source, "Drops from Xesht");
  assert.deepEqual(bundle.items[0].requirements, ["Requires: Level 12"]);
  assert.deepEqual(bundle.items[0].i18n.mods.vi, ["+10 Sức mạnh"]);

  assert.deepEqual(bundle.items[1].requirements, ["Requires: Level 50"]);
  assert.deepEqual(bundle.items[2].properties, ["Stack Size: 1 / 10"]);
  assert.equal(stats.updated_records, 3);
});

test("mergeCurrencyBundle fills missing stack_size from GGPK and reports site-only currencies", () => {
  const { bundle, stats } = mergeCurrencyBundle(
    {
      items: [
        { name: "Vaal Orb", stack_size: "" },
        { name: "Vaal Infuser", stack_size: "1 / 10" }
      ]
    },
    [{ name: "Vaal Orb", stack_size: 20 }]
  );
  assert.equal(bundle.items[0].stack_size, "1 / 20");
  assert.deepEqual(stats.site_only, ["Vaal Infuser"]);

  const md = renderMarkdownReport({
    generated_at: "2026-11-24T00:00:00Z",
    applied: true,
    sources: { pob_commit: "bb52d6b", pob_gems: 1, pob_uniques: 1, ggpk_fingerprint: "abc", ggpk_gems: 1, ggpk_base_items: 1, ggpk_misc_items: 1 },
    skill_gems: { existing_total: 1, matched_pob: 1, matched_ggpk: 1, updated_records: 1, fields_updated: { official_id: 1, tier: 1, tags: 1, color: 1, flavour_text: 0 }, added: [], untranslated: [] },
    items: { existing_total: 1, matched_pob_uniques: 1, matched_ggpk_bases: 0, matched_ggpk_misc: 0, updated_records: 1, enriched: { flavour_text: 1, league: 0, drop_source: 0, base_requirements: 0, misc_stack_size: 0 }, uniques_only_in_pob: [], untranslated: [] },
    currency: stats
  });
  assert.match(md, /Season SOT Sync Report/);
  assert.match(md, /Vaal Infuser/);
});

test("sync-site-icons helpers normalize art paths and rewrite only locally present icons", () => {
  assert.equal(normalizeArtPath("Art/2DItems/Armours/The%20Auspex.webp"), "Art/2DItems/Armours/The Auspex");
  assert.equal(localRelWebpPath("Art/2DItems/Currency/CurrencyVaal.dds"), "art/2ditems/currency/currencyvaal.webp");
  assert.equal(localWebUrl("Art/2DItems/Armours/The Auspex.dds"), "/assets/ggpk-icons/art/2ditems/armours/the%20auspex.webp");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "poevh-icon-rewrite-"));
  try {
    const dataDir = path.join(tmp, "data");
    const iconsDir = path.join(tmp, "icons");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(iconsDir, "art", "2ditems", "currency"), { recursive: true });
    fs.writeFileSync(path.join(iconsDir, "art", "2ditems", "currency", "currencyvaal.webp"), "fakewebp");
    fs.writeFileSync(
      path.join(dataDir, "sample.js"),
      `window.SAMPLE = ["https://cdn.poe2db.tw/image/Art/2DItems/Currency/CurrencyVaal.webp", "https://cdn.poe2db.tw/image/Art/2DItems/Hideout/Missing.webp"];`
    );

    const summary = rewriteSiteIconUrls({ dataDir, iconsDir, files: ["sample.js"] });
    assert.deepEqual(summary["sample.js"], { rewritten: 1, kept_cdn: 1 });
    const after = fs.readFileSync(path.join(dataDir, "sample.js"), "utf8");
    assert.match(after, /\/assets\/ggpk-icons\/art\/2ditems\/currency\/currencyvaal\.webp/);
    assert.match(after, /https:\/\/cdn\.poe2db\.tw\/image\/Art\/2DItems\/Hideout\/Missing\.webp/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

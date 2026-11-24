import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

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
import { compareTreeVersionDirs } from "../scripts/sot/sync-passive-tree.mjs";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");

function loadWindowData(relPath, globalName) {
  const full = path.join(ROOT_DIR, relPath);
  const sandbox = {};
  new Function("window", fs.readFileSync(full, "utf8"))(sandbox);
  return sandbox[globalName];
}

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
    ""
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

test("mergeSkillGemsBundle adds brand-new GGPK gems ahead of PoB and supports --overwrite-mods", () => {
  const siteBundle = {
    total: 1,
    active_total: 1,
    support_total: 0,
    gems: [
      {
        slug: "Fireball",
        name: "Fireball",
        gem_type: "skill",
        color: "blue",
        official_id: "Metadata/Items/Gems/SkillGemFireball",
        tags: ["Spell"],
        summary_en: "Old summary",
        properties: ["Mana Cost: 10"],
        requirements: ["Requires: Level 1"],
        mods: ["Old mod"],
        sections: [{ title: "Stats", lines: ["Old line"] }],
        i18n: {
          name: { en: "Fireball", vi: "Fireball" },
          summary: { en: "Old summary", vi: "Tóm tắt cũ" },
          tags: [{ en: "Spell", vi: "Phép" }],
          mods: [{ en: "Old mod", vi: "Mod cũ" }],
          sections: [{ title: "Stats", lines: [{ en: "Old line", vi: "Dòng cũ" }] }]
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
      tags: ["Spell"],
      summary_en: "New season summary",
      properties: ["Mana Cost: 12"],
      requirements: ["Requires: Level 1"],
      mods: ["New season mod"],
      sections: [{ title: "Stats", lines: ["Old line", "Brand new line"] }]
    }
  ];

  const ggpkGems = [
    { id: "Metadata/Items/Gems/SkillGemFireball", name: "Fireball", gem_type: "skill", color: "blue", tier: 3, excluded: null },
    {
      id: "Metadata/Items/Gems/SkillGemDayOne",
      name: "Day One Nova",
      gem_type: "skill",
      color: "blue",
      tier: 5,
      tags: ["Spell", "Cold"],
      active_skill: { description: "Releases a cold nova." },
      excluded: null
    },
    {
      id: "Metadata/Items/Gems/SkillGemCastOnFreeze",
      name: "Cast on Freeze",
      gem_type: "skill",
      color: "blue",
      tier: null,
      tags: ["Meta"],
      active_skill: { description: "Deprecated trigger." },
      excluded: null
    },
    {
      id: "Metadata/Items/Gems/SkillGemUnfinished",
      name: "DNT Gem",
      gem_type: "skill",
      color: "red",
      tier: 1,
      excluded: "dnt"
    }
  ];

  const { bundle, stats } = mergeSkillGemsBundle(siteBundle, pobGems, ggpkGems, {
    iconsDir: os.tmpdir(),
    overwriteMods: true
  });

  assert.equal(bundle.total, 2);
  assert.equal(stats.added_from_ggpk.length, 1);
  assert.equal(stats.added_from_ggpk[0].name, "Day One Nova");
  assert.ok(stats.skipped_unreleased.includes("Cast on Freeze"));
  assert.equal(bundle.gems[0].mods[0], "Old line");
  assert.equal(bundle.gems[0].i18n.sections[0].lines[0].vi, "Dòng cũ");
  assert.equal(bundle.gems[0].i18n.sections[0].lines[1].vi, "");
});

test("mergeItemsBundle adds brand-new PoB uniques, GGPK bases, and GGPK misc items cleanly", () => {
  const siteBundle = {
    items: [
      {
        slug: "Amethyst_Ring",
        menu_key: "rings",
        name: "Amethyst Ring",
        rarity: "normal",
        icon_url: "/assets/ggpk-icons/art/2ditems/rings/basetypes/amethystring.webp",
        properties: [],
        requirements: [],
        mods: [],
        i18n: {}
      },
      {
        slug: "Guiding_Palm_of_the_Eye",
        menu_key: "sceptres",
        name: "Guiding Palm of the Eye",
        rarity: "unique",
        icon_url: "/assets/ggpk-icons/art/2ditems/weapons/onehandweapons/sceptres/sceptre.webp",
        properties: ["Shrine Sceptre"],
        requirements: [],
        mods: [],
        i18n: {}
      }
    ]
  };

  const { bundle, stats } = mergeItemsBundle(siteBundle, {
    pobUniques: [
      {
        name: "Season Ring",
        menu_key: "rings",
        properties: ["Amethyst Ring"],
        mods: ["+30 to maximum Life"],
        pob: { league: "0.6", source: "World Drop" }
      },
      {
        name: "The Road Warrior",
        menu_key: "body-armours",
        properties: ["Raider Plate"],
        mods: ["+10 to all Attributes"],
        pob: { source: "No longer obtainable" }
      },
      {
        name: "Guiding Palm",
        menu_key: "sceptres",
        properties: ["Shrine Sceptre"],
        mods: ["+5 to all Attributes"],
        pob: { source: null }
      }
    ],
    ggpkBaseItems: [
      {
        name: "Obsidian Ring",
        item_class: "Rings",
        icon_dds: "Art/2DItems/Rings/ObsidianRing.dds",
        requirements: { level: 60, str: 0, dex: 0, int: 0 }
      }
    ],
    ggpkMiscItems: [
      {
        name: "Season Omen",
        category: "omen",
        stack_size: 10,
        description: "Consumed on craft."
      }
    ]
  });

  assert.equal(stats.added_uniques.length, 1);
  assert.equal(stats.added_uniques[0].name, "Season Ring");
  assert.equal(stats.added_bases.length, 1);
  assert.equal(stats.added_misc.length, 1);
  assert.equal(bundle.items.length, 5);
  const newUnique = bundle.items.find((i) => i.name === "Season Ring");
  assert.match(newUnique.icon_url, /\/2DItems\//i);
});

test("compareTreeVersionDirs sorts semantic underscore versions numerically", () => {
  assert.deepEqual(
    ["0_10", "0_4", "0_5", "1_0", "0_2"].sort(compareTreeVersionDirs),
    ["0_2", "0_4", "0_5", "0_10", "1_0"]
  );
});

test("standalone runtime audit: zero Google Fonts, zero external icon URLs, zero missing passive tree icons", () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, "public", "index.html"), "utf8");
  assert.doesNotMatch(indexHtml, /fonts\.googleapis\.com|fonts\.gstatic\.com/i);

  for (const file of ["items-data.js", "currency-data.js", "skill-gems-data.js", "craft-index.js"]) {
    const content = fs.readFileSync(path.join(ROOT_DIR, "public", "data", file), "utf8");
    const matches = content.match(/cdn\.poe2db\.tw\/image\//gi) || [];
    assert.equal(matches.length, 0, `${file} still contains ${matches.length} cdn.poe2db.tw/image/ URLs`);
  }

  for (const [relPath, globalName, listKey] of [
    ["public/data/items-data.js", "POE2_ITEMS", "items"],
    ["public/data/currency-data.js", "POE2_CURRENCY", "items"],
    ["public/data/skill-gems-data.js", "POE2_SKILL_GEMS", "gems"]
  ]) {
    const data = loadWindowData(relPath, globalName);
    const rows = data?.[listKey];
    assert.ok(Array.isArray(rows) && rows.length > 0, `${relPath} (${globalName}.${listKey}) must be non-empty`);
    const externalIcons = rows.filter((row) => /^https?:\/\//i.test(row.icon_url || ""));
    assert.equal(externalIcons.length, 0, `${relPath} still has ${externalIcons.length} external icon_url(s)`);
  }

  const tree = loadWindowData("public/data/passive-tree-data.js", "POE2_PASSIVE_TREE");
  const missingTreeIcons = [];
  for (const node of tree.nodes || []) {
    if (node.icon_path && !fs.existsSync(path.join(ROOT_DIR, "public", node.icon_path.replace(/^\/+/, "")))) {
      missingTreeIcons.push(node.icon_path);
    }
  }
  assert.deepEqual([...new Set(missingTreeIcons)], []);

  const itemMods = loadWindowData("public/data/item-mods-data.js", "POE2_ITEM_MODS");
  assert.ok(itemMods && itemMods.classes && Object.keys(itemMods.classes).length >= 50);
  for (const [poolName, pool] of Object.entries(itemMods.classes)) {
    assert.equal(pool.nw?.length, pool.normal?.length, `Pool ${poolName} missing matching nw spawn weights`);
  }
});

test("Craft Simulator PoB adapter builds real base tree and rolls PoB currency workflow end-to-end", () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, "src", "spa", "lib", "craftEngine.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText;
  const sandbox = { module: { exports: {} }, exports: {}, require: () => ({}) };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(js, sandbox);
  const { buildCraftSimFromPob, applyCurrency, findCurrency } = sandbox.module.exports;

  const itemMods = loadWindowData("public/data/item-mods-data.js", "POE2_ITEM_MODS");
  const itemsData = loadWindowData("public/data/items-data.js", "POE2_ITEMS");
  const { tree, classes } = buildCraftSimFromPob(itemMods, itemsData.items);

  assert.ok(tree.length >= 4, "Expected at least 4 top-level equipment groups");
  assert.ok(Object.keys(classes).length >= 50, "Expected at least 50 PoB craft classes");

  const allBases = tree.flatMap((g) => g.classes.flatMap((c) => c.bases));
  const amethystRing = allBases.find((b) => b.name === "Amethyst Ring");
  assert.ok(amethystRing, "Amethyst Ring present in PoB craft tree");
  assert.match(amethystRing.icon || "", /^\/assets\/ggpk-icons\//, "Amethyst Ring uses self-hosted GGPK icon");
  assert.ok(amethystRing.implicit, "Amethyst Ring carries its PoB implicit");

  const ringPool = classes[amethystRing.craft_key];
  assert.ok(ringPool, "Ring craft pool exists");
  assert.ok(ringPool.prefixes.length >= 10 && ringPool.suffixes.length >= 10, "Ring pool has PoB prefixes & suffixes");
  for (const fam of [...ringPool.prefixes, ...ringPool.suffixes]) {
    for (const tier of fam.tiers) {
      assert.ok(Number.isFinite(tier.weight) && tier.weight > 0, `Mod ${tier.name} carries positive PoB weight`);
    }
  }

  const item = {
    baseName: amethystRing.name,
    icon: amethystRing.icon,
    attr: amethystRing.attr,
    itemClass: amethystRing.craft_key,
    ilvl: 82,
    implicit: amethystRing.implicit || null,
    rarity: "normal",
    corrupted: false,
    craftKey: amethystRing.craft_key,
    mods: []
  };
  const runOrb = (orbName) => {
    const spec = findCurrency(orbName);
    assert.ok(spec, `Currency spec found for ${orbName}`);
    const err = applyCurrency(spec, orbName, ringPool, item);
    assert.equal(err, null, `${orbName} returned error: ${err}`);
  };

  runOrb("Orb of Transmutation");
  assert.equal(item.rarity, "magic");
  assert.equal(item.mods.length, 1);

  runOrb("Orb of Augmentation");
  assert.equal(item.mods.length, 2);

  runOrb("Regal Orb");
  assert.equal(item.rarity, "rare");
  assert.equal(item.mods.length, 3);

  runOrb("Exalted Orb");
  assert.equal(item.mods.length, 4);

  runOrb("Chaos Orb");
  assert.equal(item.mods.length, 4);

  runOrb("Divine Orb");

  // Every rolled mod text must have all (min-max) ranges instantiated to concrete numbers.
  for (const mod of item.mods) {
    assert.doesNotMatch(mod.text, /\(\d+(?:\.\d+)?-\d+(?:\.\d+)?\)/, `Unrolled range left in "${mod.text}"`);
  }
});

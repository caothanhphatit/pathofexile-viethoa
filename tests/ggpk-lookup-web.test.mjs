import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildGgpkLookupData,
  compactGgpkLookupDataForBrowser,
  formatGgpkLookupDataScript,
  ggpkLookupExportSummary
} from "../scripts/game-extract/ggpk-lookup-web-runtime.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, filename), "utf8");

const version = {
  id: "3",
  version_key: "ggpk_full:fixture",
  source_kind: "ggpk_full",
  source_label: "GGPK full extracted catalog",
  extract_hash: "extract-hash",
  source_hash: "source-hash",
  created_at: "2026-05-25T16:46:20.274Z",
  summary_json: {
    entities: { by_type: { active_skill: 1, mod: 1, stat: 1, item_base: 1 } },
    relations: { by_type: { has_stat: 2, uses_icon: 1 } }
  }
};

const entities = [
  {
    entity_type: "active_skill",
    entity_key: "arc",
    display_name: "Arc",
    source_table: "activeskills",
    source_row_key: "arc",
    source_hash: "skill-hash",
    normalized_json: {
      id: "arc",
      name: "Arc",
      description: "An arc of lightning reaches toward the target.",
      icon: "Art/2DArt/SkillIcons/SorceressArc.dds",
      video: "Art/Videos/SkillExamples/Arc.bk2",
      granted_effect: "ArcPlayer",
      is_gem: true,
      stats: ["active_skill_chain_count"]
    }
  },
  {
    entity_type: "mod",
    entity_key: "LightningDamage1",
    display_name: "Lightning Damage",
    source_table: "mods",
    source_row_key: "LightningDamage1",
    source_hash: "mod-hash",
    normalized_json: {
      id: "LightningDamage1",
      name: "Lightning Damage",
      level: 8,
      domain: 1,
      stats: [{ stat: "local_minimum_added_lightning_damage", min: 1, max: 4 }],
      tags: ["lightning"]
    }
  },
  {
    entity_type: "stat",
    entity_key: "local_minimum_added_lightning_damage",
    display_name: "local_minimum_added_lightning_damage",
    source_table: "stats",
    source_row_key: "local_minimum_added_lightning_damage",
    source_hash: "stat-hash",
    normalized_json: {
      id: "local_minimum_added_lightning_damage",
      hash: 123,
      semantic: 2,
      scalable: true
    }
  },
  {
    entity_type: "item_base",
    entity_key: "Metadata/Items/Weapons/Wand",
    display_name: "Wand",
    source_table: "baseitemtypes",
    source_row_key: "Metadata/Items/Weapons/Wand",
    source_hash: "item-hash",
    normalized_json: {
      id: "Metadata/Items/Weapons/Wand",
      name: "Wand",
      item_class: "Wands",
      drop_level: 2,
      tags: ["caster_weapon"],
      implicit_mods: ["LightningDamage1"],
      icon: "Art/2DItems/Weapons/Wands/Wand.dds"
    }
  }
];

const relations = [
  {
    from_entity_type: "active_skill",
    from_entity_key: "arc",
    relation_type: "has_stat",
    to_entity_type: "stat",
    to_entity_key: "active_skill_chain_count"
  },
  {
    from_entity_type: "mod",
    from_entity_key: "LightningDamage1",
    relation_type: "has_stat",
    to_entity_type: "stat",
    to_entity_key: "local_minimum_added_lightning_damage",
    relation_json: { value: { min: 1, max: 4 } }
  },
  {
    from_entity_type: "item_base",
    from_entity_key: "Metadata/Items/Weapons/Wand",
    relation_type: "implicit_mod",
    to_entity_type: "mod",
    to_entity_key: "LightningDamage1"
  }
];

const assets = [
  {
    asset_key: "asset:Art/2DArt/SkillIcons/SorceressArc.dds",
    kind: "image",
    logical_path: "Art/2DArt/SkillIcons/SorceressArc.dds",
    source_path: "Art/2DArt/SkillIcons/SorceressArc.dds",
    metadata_json: { source_table: "activeskills" },
    status: "referenced"
  },
  {
    asset_key: "asset:Art/Videos/SkillExamples/Arc.bk2",
    kind: "video",
    logical_path: "Art/Videos/SkillExamples/Arc.bk2",
    source_path: "Art/Videos/SkillExamples/Arc.bk2",
    metadata_json: { source_table: "activeskills" },
    status: "referenced"
  }
];

const entityAssets = [
  {
    entity_type: "active_skill",
    entity_key: "arc",
    asset_key: "asset:Art/2DArt/SkillIcons/SorceressArc.dds",
    relation_type: "uses_icon"
  },
  {
    entity_type: "active_skill",
    entity_key: "arc",
    asset_key: "asset:Art/Videos/SkillExamples/Arc.bk2",
    relation_type: "uses_video"
  }
];

test("GGPK lookup data exports typed entities, searchable text, assets, and relations", () => {
  const data = buildGgpkLookupData({
    version,
    entities,
    relations,
    assets,
    entityAssets,
    generatedAt: "2026-05-26T07:00:00.000Z"
  });

  assert.equal(data.source.extract_version_id, "3");
  assert.equal(data.total, 4);
  assert.equal(data.counts.by_type.active_skill, 1);
  assert.equal(data.counts.by_type.mod, 1);
  assert.equal(data.counts.assets.video, 1);
  assert.equal(data.counts.relations.has_stat, 2);
  assert.equal(data.entity_types.active_skill.label, "Active Skills");
  assert.equal(data.entity_types.item_base.label, "Item Bases");

  const arc = data.records.find((record) => record.key === "arc");
  assert.equal(arc.type, "active_skill");
  assert.equal(arc.title, "Arc");
  assert.equal(arc.summary, "An arc of lightning reaches toward the target.");
  assert.equal(arc.media.icon, "Art/2DArt/SkillIcons/SorceressArc.dds");
  assert.equal(arc.media.video, "Art/Videos/SkillExamples/Arc.bk2");
  assert.deepEqual(arc.facets, ["Active Skills", "Gem", "Has Icon", "Has Video"]);
  assert.match(arc.search_text, /arcplayer/);
  assert.match(arc.search_text, /active_skill_chain_count/);
  assert.equal(arc.relation_count.outgoing, 1);
  assert.equal(arc.asset_count, 2);

  const mod = data.records.find((record) => record.key === "LightningDamage1");
  assert.match(mod.summary, /local_minimum_added_lightning_damage/);
  assert.deepEqual(mod.facets, ["Mods", "Level 8"]);
  assert.equal(data.relations.some((relation) => relation.from === "item_base:Metadata/Items/Weapons/Wand" && relation.to === "mod:LightningDamage1"), true);
});

test("GGPK lookup data script exposes a browser global without third-party data hosts", () => {
  const data = buildGgpkLookupData({ version, entities, relations, assets, entityAssets });
  const script = formatGgpkLookupDataScript(data);
  const browserData = compactGgpkLookupDataForBrowser(data);

  assert.match(script, /^window\.POE2_GGPK_LOOKUP=/);
  assert.match(script, /"source_kind":"ggpk_full"/);
  assert.doesNotMatch(script, /poe2db/i);
  assert.equal("search_text" in browserData.records[0], false);
  assert.deepEqual(browserData.assets, []);
  assert.deepEqual(Object.keys(browserData.relations[0]), ["type", "from", "to"]);
  assert.match(script, /;\n$/);
});

test("GGPK lookup data uses entity keys when game rows expose placeholder names", () => {
  const data = buildGgpkLookupData({
    version,
    entities: [{
      entity_type: "active_skill",
      entity_key: "internal_skill_key",
      display_name: "???",
      source_table: "activeskills",
      source_row_key: "internal_skill_key",
      source_hash: "placeholder-hash",
      normalized_json: {
        id: "internal_skill_key",
        name: "???",
        description: ""
      }
    }]
  });

  assert.equal(data.records[0].title, "internal_skill_key");
});

test("GGPK lookup data resolves endgame map names from related world areas", () => {
  const data = buildGgpkLookupData({
    version,
    entities: [
      {
        entity_type: "world_area",
        entity_key: "MapUberBoss_CopperCitadel",
        display_name: "The Copper Citadel",
        source_table: "worldareas",
        source_row_key: "MapUberBoss_CopperCitadel",
        source_hash: "area-hash",
        normalized_json: {
          id: "MapUberBoss_CopperCitadel",
          name: "The Copper Citadel",
          act: 10,
          area_level: 80,
          endgame: true
        }
      },
      {
        entity_type: "endgame_map",
        entity_key: "47",
        display_name: "MapUberBoss_CopperCitadel",
        source_table: "endgamemaps",
        source_row_key: "47",
        source_hash: "map-hash",
        normalized_json: {
          id: "47",
          boss_area: "MapUberBoss_CopperCitadel",
          flavour_text: "A heart of corruption, borne of copper.",
          min_watchstone_tier: 15
        }
      }
    ],
    relations: [{
      from_entity_type: "endgame_map",
      from_entity_key: "47",
      relation_type: "uses_world_area",
      to_entity_type: "world_area",
      to_entity_key: "MapUberBoss_CopperCitadel"
    }]
  });

  const map = data.records.find((record) => record.type === "endgame_map");
  assert.equal(map.title, "The Copper Citadel");
  assert.equal(map.summary, "A heart of corruption, borne of copper. | min tier 15");
  assert.match(map.search_text, /mapuberboss_coppercitadel/);
});

test("GGPK lookup data replaces symbol-only monster names with readable metadata titles", () => {
  const data = buildGgpkLookupData({
    version,
    entities: [{
      entity_type: "monster_variety",
      entity_key: "Metadata/Monsters/Dummy/D100",
      display_name: "-|- -|- -|- -|- -|-",
      source_table: "monstervarieties",
      source_row_key: "Metadata/Monsters/Dummy/D100",
      source_hash: "monster-hash",
      normalized_json: {
        id: "Metadata/Monsters/Dummy/D100",
        name: "-|- -|- -|- -|- -|-",
        object_type: "Metadata/Monsters/Mannequin/MannequinDestroyable",
        movement_speed: 0,
        life_multiplier: 0,
        damage_multiplier: 100,
        tags: ["construct", "immobile", "is_unarmed", "light_armour"],
        mods: ["TestingDummyLife100k"]
      }
    }]
  });

  assert.equal(data.records[0].title, "Dummy D100");
  assert.equal(data.records[0].summary, "Mannequin Destroyable | damage 100 | construct, immobile, is_unarmed, light_armour");
  assert.match(data.records[0].search_text, /testingdummylife100k/);
});

test("GGPK lookup export summary reports typed coverage", () => {
  const data = buildGgpkLookupData({ version, entities, relations, assets, entityAssets });
  const summary = ggpkLookupExportSummary({ data, outputPath: "public/data/ggpk-lookup-data.js" });

  assert.equal(summary.total, 4);
  assert.equal(summary.counts.by_type.stat, 1);
  assert.equal(summary.counts.assets.image, 1);
  assert.equal(summary.output, "public/data/ggpk-lookup-data.js");
});

test("GGPK lookup page and clean route consume the aggregate data export", async () => {
  const [page, routes, server, packageJson] = await Promise.all([
    readProjectFile("public/ggpk_lookup.html"),
    readProjectFile("public/app-routes.js"),
    readProjectFile("scripts/serve-static.mjs"),
    readProjectFile("package.json")
  ]);

  assert.match(page, /<script src="data\/ggpk-lookup-data\.js"><\/script>/);
  assert.match(page, /window\.POE2_GGPK_LOOKUP/);
  assert.match(page, /id="ggpkLookupSearch"/);
  assert.match(page, /id="ggpkLookupTypeFilter"/);
  assert.match(page, /id="ggpkLookupGrid"/);
  assert.match(page, /id="ggpkLookupDetail"/);
  assert.doesNotMatch(page, /poe2db/i);
  assert.match(routes, /ggpklookup:\s*{[\s\S]*?href:\s*"\/ggpk-data"/);
  assert.match(routes, /ggpklookup:\s*{[\s\S]*?navParent:\s*"lookup"/);
  assert.match(server, /\["\/ggpk-data", "\/index\.html"\]/);
  assert.match(packageJson, /"export:ggpk-lookup": "node scripts\/export-ggpk-lookup\.mjs"/);
});

test("GGPK lookup page exposes grouped monster refs for mods and skills", async () => {
  const page = await readProjectFile("public/ggpk_lookup.html");

  assert.match(page, /monsterDetailGroups/);
  assert.match(page, /monsterCardBody/);
  assert.match(page, /monsterCounts/);
  assert.match(page, /cleanModLabel/);
  assert.match(page, /shownRows/);
  assert.match(page, /Showing \$\{formatNumber\(shownRows\.length\)\} of \$\{formatNumber\(rows\.length\)\}/);
  assert.match(page, /uses_skill/);
  assert.match(page, /uses_granted_effect/);
  assert.match(page, /has_mod/);
  assert.match(page, /Skills/);
  assert.match(page, /Granted Effects/);
  assert.match(page, /Mods/);
  assert.equal(page.indexOf('title: "Mods"') < page.indexOf('title: "Skills"'), true);
});

test("GGPK monster cards avoid raw keys and detail opens an obvious modal", async () => {
  const page = await readProjectFile("public/ggpk_lookup.html");

  assert.match(page, /openDetailModal/);
  assert.match(page, /renderDetailBody/);
  assert.match(page, /data-open-record/);
  assert.match(page, /selectRecord\(button\.dataset\.openRecord, \{ reveal: true \}\)/);
  assert.match(page, /isDesktopDetailVisible/);
  assert.match(page, /window\.getComputedStyle\(panel\)\.display !== "none"/);
  assert.match(page, /desktopDetailVisible/);
  assert.match(page, /record\.type === "monster_variety" \? monsterCardBody\(record\)/);
  assert.match(page, /ggpk-monster-card/);
  assert.match(page, /ggpk-creature-plate/);
  assert.match(page, /ggpk-stat-ribbon/);
  assert.match(page, /Creature Form/);
  assert.match(page, /AI pattern:/);
  assert.match(page, /monsterStatToken\("favorite", "Life"/);
  assert.match(page, /monsterStatToken\("swords", "Damage"/);
  assert.match(page, /monsterStatToken\("speed", "Move"/);
  assert.doesNotMatch(page, /monsterAbilityLine/);
  assert.match(page, /simpleRecordData/);
  assert.match(page, /-webkit-line-clamp: 2/);
});

test("GGPK stat results render as compact readable rows", async () => {
  const page = await readProjectFile("public/ggpk_lookup.html");

  assert.match(page, /statRecordCard/);
  assert.match(page, /humanizeStatKey/);
  assert.match(page, /statBadges/);
  assert.match(page, /statSourceRows/);
  assert.match(page, /statSourceSummary/);
  assert.match(page, /ggpk-stat-source/);
  assert.match(page, /ggpk-stat-results/);
  assert.match(page, /ggpk-stat-card/);
  assert.match(page, /ggpk-stat-title/);
  assert.doesNotMatch(page, /ggpk-stat-key/);
  assert.match(page, /record\.type === "stat"\) return statRecordCard\(record\)/);
  assert.match(page, /classList\.toggle\("ggpk-stat-results", state\.type === "stat"\)/);
});

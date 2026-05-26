import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  buildGgpkFullSnapshot
} from "../scripts/game-extract/ggpk-normalize-runtime.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const key = (lo) => ({ lo, hi: 0 });
const nullKey = { lo: 18374403900871475000, hi: 18374403900871475000 };

const writeTable = async (catalogDir, name, rows, columns) => {
  const tablePath = path.join(catalogDir, "tables", `${name}.json`);
  await writeFile(tablePath, `${JSON.stringify({
    generated_at: "2026-05-25T00:00:00.000Z",
    table: name,
    spec_table: name,
    source_file: `${name}.datc64`,
    columns,
    row_count: rows.length,
    row_size: 16,
    rows_hash: `${name}-hash`,
    rows
  }, null, 2)}\n`, "utf8");
};

const makeFixtureCatalog = async () => {
  const catalogDir = await mkdtemp(path.join(os.tmpdir(), "poe2-ggpk-normalize-"));
  await mkdir(path.join(catalogDir, "tables"), { recursive: true });

  await writeTable(catalogDir, "tags", [
    { Id: "default", DisplayText: "", Text: "" },
    { Id: "currency", DisplayText: "Currency", Text: "Currency" },
    { Id: "fire", DisplayText: "Fire", Text: "Fire" }
  ], [
    { name: "Id", type: "String" },
    { name: "DisplayText", type: "String" },
    { name: "Text", type: "String" }
  ]);
  await writeTable(catalogDir, "stats", [
    { Id: "base_fire_damage_+%", Hash: 101, Local: false, Virtual: false }
  ], [
    { name: "Id", type: "String" },
    { name: "Hash", type: "UInt" }
  ]);
  await writeTable(catalogDir, "itemclasses", [
    { Id: "StackableCurrency", Name: "Stackable Currency" }
  ], [
    { name: "Id", type: "String" },
    { name: "Name", type: "String" }
  ]);
  await writeTable(catalogDir, "itemvisualidentity", [
    { Id: "CurrencyWeaponQuality", DDSFile: "Art/2DItems/Currency/CurrencyWeaponQuality.dds" }
  ], [
    { name: "Id", type: "String" },
    { name: "DDSFile", type: "String" }
  ]);
  await writeTable(catalogDir, "baseitemtypes", [
    {
      Id: "Metadata/Items/Currency/CurrencyWeaponQuality",
      Name: "Blacksmith's Whetstone",
      BaseType: "Metadata/Items/Currency/StackableCurrency",
      DropLevel: 5,
      Width: 1,
      Height: 1,
      ItemClass: key(0),
      Tags: [key(1)],
      ImplicitMods: [],
      ItemVisualIdentityKey: key(0)
    }
  ], [
    { name: "Id", type: "String" },
    { name: "Name", type: "String" },
    { name: "ItemClass", type: "Key", ref_to: "ItemClasses" },
    { name: "Tags", type: "Key", list: true, ref_to: "Tags" },
    { name: "ItemVisualIdentityKey", type: "Key", ref_to: "ItemVisualIdentity" }
  ]);
  await writeTable(catalogDir, "mods", [
    {
      Id: "FireDamage1",
      Name: "of Embers",
      Level: 1,
      Stat1: key(0),
      Stat1Value: 5,
      Stat2: nullKey,
      Stat2Value: 0,
      SpawnTags: [key(2)],
      Tags: [key(2)]
    }
  ], [
    { name: "Id", type: "String" },
    { name: "Name", type: "String" },
    { name: "Stat1", type: "Key", ref_to: "Stats" },
    { name: "Tags", type: "Key", list: true, ref_to: "Tags" }
  ]);
  await writeTable(catalogDir, "passiveskills", [
    {
      Id: "fire_passive",
      PassiveSkillNodeId: 1001,
      Name: "Fire Walker",
      Icon: "Art/2DArt/SkillIcons/passives/fire.dds",
      Stats: [key(0)],
      Stat1: 10,
      Keystone: false,
      Notable: true
    }
  ], [
    { name: "Id", type: "String" },
    { name: "Stats", type: "Key", list: true, ref_to: "Stats" }
  ]);
  await writeTable(catalogDir, "activeskills", [
    {
      Id: "ground_slam",
      DisplayName: "Ground Slam",
      Description: "Slam the ground.",
      Icon: "Art/2DArt/SkillIcons/icongroundslam.dds",
      Video: "Art/Videos/SkillExamples/GroundSlam.bk2",
      GrantedEffect: "GroundSlamPlayer",
      SkillSpecificStat: [key(0)],
      isGem: true
    }
  ], [
    { name: "Id", type: "String" },
    { name: "Video", type: "String" },
    { name: "SkillSpecificStat", type: "Key", list: true, ref_to: "Stats" }
  ]);
  await writeTable(catalogDir, "grantedeffects", [
    { Id: "GroundSlamPlayer", IsSupport: false, ActiveSkill: key(0), GrantedEffectStatSets: nullKey }
  ], [
    { name: "Id", type: "String" },
    { name: "ActiveSkill", type: "Key", ref_to: "ActiveSkills" }
  ]);
  await writeTable(catalogDir, "worldareas", [
    { Id: "G1", Name: "Riverbank", Act: 1, AreaLevel: 1, IsTown: false, IsEndGameArea: false }
  ], [
    { name: "Id", type: "String" },
    { name: "Name", type: "String" }
  ]);
  await writeTable(catalogDir, "monstervarieties", [
    {
      Id: "Metadata/Monsters/Dummy/D100",
      Name: "-|- -|- -|- -|- -|-",
      ObjectType: "Metadata/Monsters/Mannequin/MannequinDestroyable",
      MovementSpeed: 0,
      DamageMultiplier: 100,
      LifeMultiplier: 0,
      Tags: [key(1), key(2)],
      Mods: [],
      GrantedEffects: [key(0)],
      ModsKeys2: [],
      SpecialMods: [key(0)],
      AIScript: "Metadata/Monsters/Dummy/D100.ais"
    }
  ], [
    { name: "Id", type: "String" },
    { name: "Name", type: "String" },
    { name: "ObjectType", type: "String" },
    { name: "Tags", type: "Key", list: true, ref_to: "Tags" },
    { name: "Mods", type: "Key", list: true, ref_to: "Mods" },
    { name: "GrantedEffects", type: "Key", list: true, ref_to: "GrantedEffects" },
    { name: "SpecialMods", type: "Key", list: true, ref_to: "Mods" }
  ]);

  const decoded = [
    "tags",
    "stats",
    "itemclasses",
    "itemvisualidentity",
    "baseitemtypes",
    "mods",
    "passiveskills",
    "activeskills",
    "grantedeffects",
    "worldareas",
    "monstervarieties"
  ];
  const rawIndex = [...decoded, "unknownraw"].map((table) => ({
    table,
    spec_table: table,
    source_file: `${table}.datc64`,
    semantic_status: decoded.includes(table) ? "parsed" : "missing_spec",
    rows: table === "unknownraw" ? 3 : 1,
    row_size: 16,
    hash: `${table}-file-hash`,
    row_block_hash: `${table}-row-hash`
  }));
  await writeFile(path.join(catalogDir, "catalog-manifest.json"), `${JSON.stringify({
    generated_at: "2026-05-25T00:00:00.000Z",
    catalog_hash: "fixture-catalog-hash",
    summary: {
      datc64_files: rawIndex.length,
      parsed_tables: decoded.length,
      raw_indexed_tables: rawIndex.length,
      rows: decoded.length,
      missing_specs: 1,
      failures: 0,
      relationships: 0,
      domains: 4
    },
    tables: decoded.map((table) => ({
      table,
      spec_table: table,
      file: `tables/${table}.json`,
      rows: 1,
      row_size: 16,
      columns: 2,
      hash: `${table}-hash`
    })),
    raw_index: rawIndex,
    missing_specs: [{ table: "unknownraw", spec_table: "unknownraw", file: "unknownraw.datc64" }],
    failures: []
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(catalogDir, "ggpk-file-inventory.json"), `${JSON.stringify({
    generated_at: "2026-05-25T00:00:00.000Z",
    inventory_hash: "fixture-inventory-hash",
    summary: { files: 12, extensions: 3, roots: 3 },
    asset_buckets: {
      images: { count: 2, sample_paths: ["Art/2DItems/Currency/CurrencyWeaponQuality.dds"] },
      videos: { count: 1, sample_paths: ["Art/Videos/SkillExamples/GroundSlam.bk2"] }
    }
  }, null, 2)}\n`, "utf8");

  return catalogDir;
};

test("GGPK full snapshot normalizes decoded tables without using PoB as data source", async () => {
  const catalogDir = await makeFixtureCatalog();
  try {
    const snapshot = await buildGgpkFullSnapshot({ catalogDir });

    assert.equal(snapshot.source.kind, "ggpk_full");
    assert.equal(snapshot.raw.tables.length, 12);
    assert.equal(snapshot.raw.rows.length, 0);
    assert.equal(snapshot.summary.tables.total, 12);
    assert.equal(snapshot.summary.tables.decoded, 11);
    assert.equal(snapshot.summary.tables.raw_only, 1);
    assert.equal(snapshot.summary.entities.by_type.item_base, 1);
    assert.equal(snapshot.summary.entities.by_type.mod, 1);
    assert.equal(snapshot.summary.entities.by_type.stat, 1);
    assert.equal(snapshot.summary.entities.by_type.passive_node, 1);
    assert.equal(snapshot.summary.entities.by_type.active_skill, 1);
    assert.equal(snapshot.summary.entities.by_type.granted_effect, 1);
    assert.equal(snapshot.summary.entities.by_type.world_area, 1);
    assert.equal(snapshot.summary.entities.by_type.monster_variety, 1);
    assert.equal(snapshot.entities.find((entity) => entity.type === "item_base").normalized_json.tags[0], "currency");
    assert.equal(snapshot.entities.find((entity) => entity.type === "mod").normalized_json.stats[0].stat, "base_fire_damage_+%");
    const monster = snapshot.entities.find((entity) => entity.type === "monster_variety");
    assert.equal(monster.display_name, "Dummy D100");
    assert.equal(monster.normalized_json.name, "Dummy D100");
    assert.equal(monster.normalized_json.raw_name, "-|- -|- -|- -|- -|-");
    assert.equal(monster.normalized_json.object_label, "Mannequin Destroyable");
    assert.equal(monster.normalized_json.ai_script, "Metadata/Monsters/Dummy/D100.ais");
    assert.deepEqual(monster.normalized_json.tags, ["currency", "fire"]);
    assert.deepEqual(monster.normalized_json.mods, ["FireDamage1"]);
    assert.deepEqual(monster.normalized_json.granted_effects, ["GroundSlamPlayer"]);
    assert.deepEqual(monster.normalized_json.active_skills, ["ground_slam"]);
    assert.equal(snapshot.assets.some((asset) => asset.kind === "video" && asset.logical_path.endsWith("GroundSlam.bk2")), true);
    assert.equal(snapshot.relations.some((relation) => relation.relation_type === "uses_video"), true);
    assert.equal(snapshot.relations.some((relation) =>
      relation.from_entity_type === "monster_variety" &&
      relation.relation_type === "has_mod" &&
      relation.to_entity_type === "mod" &&
      relation.to_entity_key === "FireDamage1"), true);
    assert.equal(snapshot.relations.some((relation) =>
      relation.from_entity_type === "monster_variety" &&
      relation.relation_type === "uses_granted_effect" &&
      relation.to_entity_type === "granted_effect" &&
      relation.to_entity_key === "GroundSlamPlayer"), true);
    assert.equal(snapshot.relations.some((relation) =>
      relation.from_entity_type === "monster_variety" &&
      relation.relation_type === "uses_skill" &&
      relation.to_entity_type === "active_skill" &&
      relation.to_entity_key === "ground_slam"), true);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

test("GGPK full import CLI can print a normalized no-db summary", async () => {
  const catalogDir = await makeFixtureCatalog();
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/import-ggpk-full.mjs",
      `--catalog-dir=${catalogDir}`,
      "--no-db"
    ], { cwd: repoRoot });
    const summary = JSON.parse(stdout);

    assert.equal(summary.database, "skipped");
    assert.equal(summary.source.kind, "ggpk_full");
    assert.equal(summary.summary.entities.by_type.item_base, 1);
    assert.equal(summary.summary.assets.by_kind.video, 1);
  } finally {
    await rm(catalogDir, { recursive: true, force: true });
  }
});

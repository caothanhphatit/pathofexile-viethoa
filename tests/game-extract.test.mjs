import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  buildExtractSnapshot,
  diffSnapshots,
  preflightGameInstall,
  readFixtureSource,
  writeSnapshotOutput
} from "../scripts/game-extract/runtime.mjs";

const execFileAsync = promisify(execFile);
const fixturePath = "tests/fixtures/game-extract/pob-source";
const fixtureV2Path = "tests/fixtures/game-extract/pob-source-v2";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readText = (repoPath) => readFile(new URL(`../${repoPath}`, import.meta.url), "utf8");

test("game extract migration defines versioned raw, domain, relation, asset, and diff tables", async () => {
  const migration = await readText("migrations/009_game_extract_schema.sql");
  for (const table of [
    "game_extract_versions",
    "game_dat_tables",
    "game_dat_columns",
    "game_dat_rows",
    "game_entities",
    "game_entity_relations",
    "game_assets",
    "game_entity_assets",
    "game_extract_diffs",
    "game_dat_row_diffs",
    "game_entity_diffs",
    "game_relation_diffs",
    "game_asset_diffs",
    "game_extractor_failures"
  ]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}\\b`, "i"), `${table} exists`);
  }
  assert.match(migration, /raw_json jsonb not null/i);
  assert.match(migration, /extract_version_id bigint not null references game_extract_versions\(id\)/i);
  assert.match(migration, /idx_game_entities_type_key/i);
  assert.match(migration, /idx_game_entity_relations_from/i);
  assert.match(migration, /idx_game_dat_rows_payload_gin/i);
});

test("game extract typed partial index migration accelerates common entity queries", async () => {
  const migration = await readText("migrations/011_game_entity_typed_indexes.sql");

  for (const indexName of [
    "idx_game_entities_item_base_typed",
    "idx_game_entities_mod_typed",
    "idx_game_entities_active_skill_typed",
    "idx_game_entities_passive_node_typed",
    "idx_game_entities_stat_typed",
    "idx_game_entities_monster_variety_typed",
    "idx_game_entities_world_area_typed",
    "idx_game_entities_crafting_recipe_typed",
    "idx_game_entities_endgame_map_typed",
    "idx_game_assets_image_typed",
    "idx_game_assets_video_typed",
    "idx_game_relations_has_stat_typed",
    "idx_game_relations_has_tag_typed",
    "idx_game_relations_monster_refs_typed",
    "idx_game_relations_uses_asset_typed"
  ]) {
    assert.match(migration, new RegExp(`create index if not exists ${indexName}\\b`, "i"), `${indexName} exists`);
  }

  for (const entityType of [
    "item_base",
    "mod",
    "active_skill",
    "passive_node",
    "stat",
    "monster_variety",
    "world_area",
    "crafting_recipe",
    "endgame_map"
  ]) {
    assert.match(migration, new RegExp(`where entity_type = '${entityType}'`, "i"), `${entityType} partial predicate`);
  }

  assert.match(migration, /where kind = 'video'/i);
  assert.match(migration, /where kind = 'image'/i);
  assert.match(migration, /where relation_type = 'has_stat'/i);
  assert.match(migration, /where relation_type = 'has_tag'/i);
  assert.match(migration, /where from_entity_type = 'monster_variety'/i);
  assert.match(migration, /where[\s\S]*relation_type in \('has_mod', 'has_tag', 'uses_granted_effect', 'uses_skill'\)/i);
  assert.match(migration, /where relation_type in \('uses_icon', 'uses_video'\)/i);
});

test("fixture source builds raw rows, normalized entities, relations, assets, and stable hashes", async () => {
  const source = await readFixtureSource({ fixturePath });
  const snapshot = await buildExtractSnapshot(source);

  assert.equal(snapshot.source.kind, "fixture");
  assert.equal(snapshot.raw.tables.length, 4);
  assert.equal(snapshot.raw.rows.length, 5);
  assert.equal(snapshot.entities.some((entity) => entity.type === "skill_gem" && entity.key.includes("EmberFusillade")), true);
  assert.equal(snapshot.entities.some((entity) => entity.type === "item_base" && entity.key === "item_base:driftwood_wand"), true);
  assert.equal(snapshot.entities.some((entity) => entity.type === "mod" && entity.key === "FireDamage1"), true);
  assert.equal(snapshot.entities.some((entity) => entity.type === "passive_node" && entity.key === "1001"), true);
  assert.equal(snapshot.relations.some((relation) => relation.relation_type === "grants_effect"), true);
  assert.equal(snapshot.relations.some((relation) => relation.relation_type === "has_tag"), true);
  assert.equal(snapshot.assets.length, 1);
  assert.match(snapshot.extract_hash, /^[a-f0-9]{64}$/);

  const repeat = await buildExtractSnapshot(source);
  assert.equal(repeat.extract_hash, snapshot.extract_hash);
});

test("passive tree normalization accepts PoB connection and orbit field names", async () => {
  const snapshot = await buildExtractSnapshot({
    source: { kind: "fixture", version: "pob-tree-shape" },
    baseDir: repoRoot,
    tables: [{
      name: "pob_passive_tree",
      source_path: "TreeData/fixture/tree.json",
      rows: [
        {
          id: "2001",
          name: "Connected Fire",
          type: "small",
          stats: ["5% increased Fire Damage"],
          connections: [{ id: 2002, orbit: 0 }],
          group: 99,
          orbit: 2,
          orbitIndex: 3
        },
        {
          id: "2002",
          name: "Target Fire",
          type: "small",
          stats: [],
          connections: [],
          group: 99,
          orbit: 2,
          orbitIndex: 4
        }
      ]
    }],
    assets: []
  });
  const node = snapshot.entities.find((entity) => entity.type === "passive_node" && entity.key === "2001");

  assert.equal(node.normalized_json.group, "99");
  assert.equal(node.normalized_json.orbit, 2);
  assert.equal(node.normalized_json.orbit_index, 3);
  assert.deepEqual(node.normalized_json.out, ["2002"]);
  assert.equal(snapshot.relations.some((relation) =>
    relation.from_entity_key === "2001" &&
    relation.relation_type === "connects_to" &&
    relation.to_entity_key === "2002"), true);
});

test("snapshot diff reports added, removed, changed, and unchanged entities", async () => {
  const before = await buildExtractSnapshot(await readFixtureSource({ fixturePath }));
  const after = await buildExtractSnapshot(await readFixtureSource({ fixturePath: fixtureV2Path }));
  const diff = diffSnapshots(before, after);

  assert.equal(diff.entities.added.length, 1);
  assert.equal(diff.entities.removed.length, 1);
  assert.equal(diff.entities.changed.some((entry) => entry.key === "Metadata/Items/Gems/SkillGemEmberFusillade"), true);
  assert.equal(diff.entities.unchanged.some((entry) => entry.key === "item_base:driftwood_wand"), true);
  assert.equal(diff.summary.entities.added, 1);
  assert.equal(diff.summary.entities.removed, 1);
  assert.equal(diff.summary.entities.changed >= 1, true);
});

test("writer emits snapshot, manifest, and copied fixture asset output", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-game-extract-"));
  try {
    const snapshot = await buildExtractSnapshot(await readFixtureSource({ fixturePath }));
    const result = await writeSnapshotOutput(snapshot, { outputDir, copyAssets: true });
    const latest = JSON.parse(await readFile(result.snapshotPath, "utf8"));
    const manifest = JSON.parse(await readFile(result.assetManifestPath, "utf8"));

    assert.equal(latest.summary.entities.total, snapshot.entities.length);
    assert.equal(manifest.assets.length, 1);
    assert.equal(manifest.assets[0].copied, true);
    assert.match(manifest.assets[0].hash, /^[a-f0-9]{64}$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("CLI fixture mode prints a compact JSON summary", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-game-extract-cli-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/extract-game.mjs",
      `--fixture=${fixturePath}`,
      `--output-dir=${outputDir}`,
      "--copy-assets=true",
      "--no-db"
    ], { cwd: repoRoot });
    const summary = JSON.parse(stdout);
    assert.equal(summary.database, "skipped");
    assert.equal(summary.source.kind, "fixture");
    assert.equal(summary.summary.entities.total, 5);
    assert.equal(summary.summary.assets.total, 1);
    assert.match(summary.output.snapshot, /latest\.json$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("preflight reports game install, GGPK, PoB upstream, and missing Oodle tools separately", async () => {
  const result = await preflightGameInstall({
    gamePath: "Z:/definitely/not/a/poe2/install",
    pobPath: "Z:/definitely/not/a/pob/install"
  });

  assert.equal(result.game_path.exists, false);
  assert.equal(result.ggpk.exists, false);
  assert.equal(result.pob_upstream.exists, false);
  assert.equal(result.oodle_tools.ready, false);
});

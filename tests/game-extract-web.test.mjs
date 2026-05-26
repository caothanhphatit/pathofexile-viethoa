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
  readFixtureSource
} from "../scripts/game-extract/runtime.mjs";
import {
  buildWebDataBundle,
  writeWebDataProducts
} from "../scripts/game-extract/web-runtime.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = "tests/fixtures/game-extract/pob-source";

const readText = (repoPath) => readFile(new URL(`../${repoPath}`, import.meta.url), "utf8");

const fixtureSnapshot = async () => buildExtractSnapshot(await readFixtureSource({ fixturePath }));

test("phase 3 migration defines generated product storage", async () => {
  const migration = await readText("migrations/010_game_generated_products.sql");

  assert.match(migration, /create table if not exists game_generated_products\b/i);
  assert.match(migration, /extract_version_id bigint not null references game_extract_versions\(id\)/i);
  assert.match(migration, /payload_json jsonb not null/i);
  assert.match(migration, /parity_json jsonb not null/i);
  assert.match(migration, /idx_game_generated_products_kind/i);
});

test("web data bundle exports planner, item, skill, mod, and calculator products", async () => {
  const bundle = buildWebDataBundle(await fixtureSnapshot());

  assert.equal(bundle.source.kind, "fixture");
  assert.match(bundle.generation_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(bundle.products).sort(), ["calculator", "items", "mods", "planner", "skills"]);

  assert.equal(bundle.products.planner.nodes.length, 2);
  assert.equal(bundle.products.planner.edges[0].from, "1001");
  assert.equal(bundle.products.planner.assets[0].path, "assets/fire-walker.txt");
  assert.equal(bundle.products.planner.classes.length, 0);
  assert.equal(bundle.products.planner.ascendancies.length, 0);

  assert.equal(bundle.products.items.bases[0].name, "Driftwood Wand");
  assert.equal(bundle.products.items.spawnable_mods[0].base_id, "item_base:driftwood_wand");
  assert.equal(bundle.products.skills.gems[0].granted_effect_id, "EmberFusilladePlayer");
  assert.equal(bundle.products.mods.mods[0].parsed_stats[0].template, "Adds # to # Fire Damage");
  assert.equal(bundle.products.calculator.mod_cache.by_id.FireDamage1.group, "FireDamage");
  assert.equal(bundle.products.calculator.mod_cache.by_tag.fire[0], "FireDamage1");
});

test("web data products include parity metadata and no absolute local paths", async () => {
  const bundle = buildWebDataBundle(await fixtureSnapshot());
  const serialized = JSON.stringify(bundle.products);

  assert.equal(bundle.manifest.products.length, 5);
  assert.equal(bundle.manifest.products.every((product) => product.hash.match(/^[a-f0-9]{64}$/)), true);
  assert.equal(bundle.manifest.products.every((product) => product.parity.status), true);
  assert.equal(/[A-Z]:\\\\/.test(serialized), false);
  assert.equal(serialized.includes("Program Files"), false);
});

test("writer emits manifest and product files for app-facing consumers", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-web-data-"));
  try {
    const bundle = buildWebDataBundle(await fixtureSnapshot());
    const output = await writeWebDataProducts(bundle, { outputDir });
    const manifest = JSON.parse(await readFile(output.manifestPath, "utf8"));
    const planner = JSON.parse(await readFile(output.productPaths.planner, "utf8"));

    assert.equal(manifest.products.find((product) => product.key === "planner").file, "planner.json");
    assert.equal(planner.nodes.length, 2);
    assert.match(output.productPaths.calculator, /calculator-seeds\.json$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("web export CLI prints a compact summary and writes generated outputs", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-web-data-cli-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/export-game-web.mjs",
      `--fixture=${fixturePath}`,
      `--output-dir=${outputDir}`
    ], { cwd: repoRoot });
    const summary = JSON.parse(stdout);

    assert.equal(summary.source.kind, "fixture");
    assert.equal(summary.products.planner.counts.nodes, 2);
    assert.equal(summary.products.mods.counts.parser_failures, 0);
    assert.match(summary.output.manifest, /manifest\.json$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

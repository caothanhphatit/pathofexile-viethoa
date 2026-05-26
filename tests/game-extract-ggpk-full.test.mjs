import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  buildNativeDat64FixtureBuffer
} from "../scripts/game-extract/native-runtime.mjs";
import {
  buildFullDatc64ManifestFromFileList,
  buildGgpkFileInventoryFromFileList,
  classifyDatc64TableDomain,
  parseExtractedDatc64Catalog,
  writeFullDatc64Manifest
} from "../scripts/game-extract/ggpk-full-runtime.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("full DATC64 manifest discovers every DAT table from a GGPK file list", async () => {
  const manifest = await buildFullDatc64ManifestFromFileList([
    "data/balance/baseitemtypes.datc64",
    "data/balance/mods.datc64",
    "art/textures/something.dds",
    "data/balance/baseitemtypes.datc64"
  ]);

  assert.equal(manifest.source.kind, "ggpk_full_datc64");
  assert.deepEqual(manifest.datc64.files, [
    "data/balance/baseitemtypes.datc64",
    "data/balance/mods.datc64"
  ]);
  assert.equal(manifest.summary.datc64_files, 2);
  assert.match(manifest.manifest_hash, /^[a-f0-9]{64}$/);
});

test("full DATC64 manifest writer emits regex extract list", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-full-datc64-"));
  try {
    const manifest = await buildFullDatc64ManifestFromFileList([
      "data/balance/baseitemtypes.datc64"
    ]);
    const output = await writeFullDatc64Manifest(manifest, { outputDir });
    const regex = await readFile(output.regexListPath, "utf8");

    assert.match(regex, /\^data\/balance\/.*\\\.datc64\$/);
    assert.match(output.manifestPath, /full-datc64-manifest\.json$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("parsed DATC64 catalog writes clean table rows, manifest, and failures", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-full-catalog-"));
  const datDir = path.join(outputDir, "files", "data", "balance");
  try {
    await mkdir(datDir, { recursive: true });
    const fixture = buildNativeDat64FixtureBuffer([
      { Id: "SkillOne", Level: 12, Enabled: true }
    ], [
      { name: "Id", type: "String" },
      { name: "Level", type: "Int" },
      { name: "Enabled", type: "Bool" }
    ]);
    await writeFile(path.join(datDir, "fixturetable.datc64"), fixture);

    const catalog = await parseExtractedDatc64Catalog({
      datDir,
      outputDir: path.join(outputDir, "catalog"),
      specs: new Map([["fixturetable", {
        name: "fixturetable",
        columns: [
          { name: "Id", type: "String" },
          { name: "Level", type: "Int" },
          { name: "Enabled", type: "Bool" }
        ]
      }]])
    });
    const table = JSON.parse(await readFile(catalog.tableOutputs[0].path, "utf8"));

    assert.equal(catalog.summary.parsed_tables, 1);
    assert.equal(catalog.summary.rows, 1);
    assert.equal(catalog.summary.failures, 0);
    assert.equal(table.rows[0].Id, "SkillOne");
    assert.match(catalog.catalog_hash, /^[a-f0-9]{64}$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("parsed DATC64 catalog can use an app-owned JSON spec without a PoB checkout", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-full-catalog-spec-json-"));
  const datDir = path.join(outputDir, "files", "data", "balance");
  try {
    await mkdir(datDir, { recursive: true });
    const spec = [
      { name: "Id", type: "String" },
      { name: "Level", type: "Int" }
    ];
    const fixture = buildNativeDat64FixtureBuffer([{ Id: "SpecJson", Level: 9 }], spec);
    const specPath = path.join(outputDir, "app-spec.json");
    await writeFile(path.join(datDir, "fixturetable.datc64"), fixture);
    await writeFile(specPath, `${JSON.stringify({
      source: { kind: "app_owned_spec" },
      tables: [{ name: "fixturetable", columns: spec }]
    })}\n`, "utf8");

    const catalog = await parseExtractedDatc64Catalog({
      datDir,
      outputDir: path.join(outputDir, "catalog"),
      specPath
    });
    const table = JSON.parse(await readFile(catalog.tableOutputs[0].path, "utf8"));

    assert.equal(catalog.summary.parsed_tables, 1);
    assert.equal(table.rows[0].Id, "SpecJson");
    assert.equal(table.rows[0].Level, 9);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("parsed DATC64 catalog preserves duplicate localized table basenames", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-full-catalog-localized-"));
  const datDir = path.join(outputDir, "files", "data", "balance");
  try {
    const spec = [
      { name: "Id", type: "String" }
    ];
    const english = buildNativeDat64FixtureBuffer([{ Id: "English" }], spec);
    const french = buildNativeDat64FixtureBuffer([{ Id: "French" }], spec);
    await mkdir(path.join(datDir, "french"), { recursive: true });
    await writeFile(path.join(datDir, "clientstrings.datc64"), english);
    await writeFile(path.join(datDir, "french", "clientstrings.datc64"), french);

    const catalog = await parseExtractedDatc64Catalog({
      datDir,
      outputDir: path.join(outputDir, "catalog"),
      specs: new Map([["clientstrings", { name: "clientstrings", columns: spec }]])
    });
    const files = catalog.tableOutputs.map((table) => path.basename(table.path)).sort();

    assert.equal(catalog.summary.parsed_tables, 2);
    assert.deepEqual(files, ["clientstrings.json", "french__clientstrings.json"]);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("parsed DATC64 catalog raw-indexes tables that cannot be semantically decoded", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-full-catalog-raw-"));
  const datDir = path.join(outputDir, "files", "data", "balance");
  try {
    await mkdir(datDir, { recursive: true });
    const fixture = buildNativeDat64FixtureBuffer([
      { Id: "Unschematized", Level: 7 }
    ], [
      { name: "Id", type: "String" },
      { name: "Level", type: "Int" }
    ]);
    await writeFile(path.join(datDir, "unknownshape.datc64"), fixture);

    const catalog = await parseExtractedDatc64Catalog({
      datDir,
      outputDir: path.join(outputDir, "catalog"),
      specs: new Map([["unknownshape", {
        name: "unknownshape",
        columns: []
      }]])
    });
    const raw = JSON.parse(await readFile(catalog.rawOutputs[0].path, "utf8"));

    assert.equal(catalog.summary.parsed_tables, 0);
    assert.equal(catalog.summary.raw_indexed_tables, 1);
    assert.equal(catalog.summary.failures, 1);
    assert.equal(raw.table, "unknownshape");
    assert.equal(raw.semantic_status, "raw_only");
    assert.equal(raw.row_count, 1);
    assert.equal(raw.row_size, 12);
    assert.match(raw.content_hash, /^[a-f0-9]{64}$/);
    assert.match(raw.row_block_hash, /^[a-f0-9]{64}$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("parsed DATC64 catalog emits ref_to relationship graph and domain coverage", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-full-catalog-rel-"));
  const datDir = path.join(outputDir, "files", "data", "balance");
  try {
    await mkdir(datDir, { recursive: true });
    const spec = [
      { name: "Id", type: "String" },
      { name: "BaseItem", type: "Int", ref_to: "BaseItemTypes" }
    ];
    const fixture = buildNativeDat64FixtureBuffer([
      { Id: "GemOne", BaseItem: 42 }
    ], spec);
    await writeFile(path.join(datDir, "skillgems.datc64"), fixture);

    const catalog = await parseExtractedDatc64Catalog({
      datDir,
      outputDir: path.join(outputDir, "catalog"),
      specs: new Map([["skillgems", { name: "skillgems", columns: spec }]])
    });
    const relationships = JSON.parse(await readFile(catalog.relationshipsPath, "utf8"));
    const domainCoverage = JSON.parse(await readFile(catalog.domainCoveragePath, "utf8"));

    assert.equal(relationships.summary.references, 1);
    assert.deepEqual(relationships.references[0], {
      from_table: "skillgems",
      from_column: "BaseItem",
      to_table: "baseitemtypes",
      cardinality: "one",
      value_type: "Int"
    });
    assert.equal(domainCoverage.domains.skills.parsed_tables, 1);
    assert.deepEqual(domainCoverage.domains.skills.tables[0], {
      table: "skillgems",
      status: "parsed",
      rows: 1,
      row_size: 12
    });
    assert.equal(classifyDatc64TableDomain("baseitemtypes"), "items");
    assert.equal(classifyDatc64TableDomain("atlaspassiveskills"), "passive_atlas");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("GGPK file inventory groups full client paths into buildable asset buckets", async () => {
  const inventory = await buildGgpkFileInventoryFromFileList([
    "data/balance/baseitemtypes.datc64",
    "art/2ditems/weapons/wand.dds",
    "art/2ditems/weapons/wand.dds.header",
    "art/videos/skillexamples/groundslam.bk2",
    "metadata/items/gems/skillgem.it",
    "audio/dialogue/example.ogg",
    "shadercached3d12/foo"
  ]);

  assert.equal(inventory.summary.files, 7);
  assert.equal(inventory.extensions.dds, 1);
  assert.equal(inventory.extensions.bk2, 1);
  assert.equal(inventory.asset_buckets.images.count, 1);
  assert.equal(inventory.asset_buckets.videos.count, 1);
  assert.equal(inventory.asset_buckets.metadata_templates.count, 1);
  assert.equal(inventory.asset_buckets.audio.count, 1);
  assert.equal(inventory.asset_buckets.shader_cache.count, 1);
});

test("GGPK file inventory hashes paths without JSON-stringifying the full client list", async () => {
  const files = [
    "Data/Balance/BaseItemTypes.datc64",
    "Art/2DItems/Weapons/Wand.dds"
  ];
  const inventory = await buildGgpkFileInventoryFromFileList(files);
  const expectedHash = crypto
    .createHash("sha256")
    .update("data/balance/baseitemtypes.datc64\nart/2ditems/weapons/wand.dds")
    .digest("hex");

  assert.equal(inventory.inventory_hash, expectedHash);
});

test("full GGPK CLI dry-run reports all DATC64 candidates from file list", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-full-cli-"));
  const fileListPath = path.join(outputDir, "file-list.log");
  try {
    await writeFile(fileListPath, [
      "data/balance/baseitemtypes.datc64",
      "data/balance/mods.datc64",
      "metadata/foo.ot"
    ].join("\n"));
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/extract-ggpk-full.mjs",
      "--dry-run",
      `--file-list=${fileListPath}`,
      `--output-dir=${outputDir}`
    ], { cwd: repoRoot });
    const summary = JSON.parse(stdout);

    assert.equal(summary.mode, "dry-run");
    assert.equal(summary.manifest.datc64_files, 2);
    assert.match(summary.output.manifest, /full-datc64-manifest\.json$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  buildNativeDat64FixtureBuffer,
  convertPobSpecLua,
  parseDat64Buffer,
  phase2NativeSummary,
  writeConvertedSpec
} from "../scripts/game-extract/native-runtime.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fixtureSpec = [
  { name: "Id", type: "String", list: false },
  { name: "Level", type: "Int", list: false },
  { name: "Enabled", type: "Bool", list: false },
  { name: "Tags", type: "String", list: true }
];

test("native DAT64 parser reads primitive strings, ints, bools, and string lists from fixture bytes", () => {
  const buffer = buildNativeDat64FixtureBuffer([
    { Id: "SkillOne", Level: 12, Enabled: true, Tags: ["fire", "spell"] },
    { Id: "SkillTwo", Level: 20, Enabled: false, Tags: ["cold"] }
  ], fixtureSpec);

  const parsed = parseDat64Buffer(buffer, fixtureSpec);

  assert.equal(parsed.row_count, 2);
  assert.equal(parsed.row_size, 29);
  assert.deepEqual(parsed.rows[0], {
    Id: "SkillOne",
    Level: 12,
    Enabled: true,
    Tags: ["fire", "spell"]
  });
  assert.deepEqual(parsed.rows[1], {
    Id: "SkillTwo",
    Level: 20,
    Enabled: false,
    Tags: ["cold"]
  });
});

test("PoB spec converter emits Rust-readable table and column metadata", async () => {
  const converted = await convertPobSpecLua({
    pobPath: "scratch/PathOfBuilding-PoE2",
    tableFilter: ["baseitemtypes", "skillgems", "mods"]
  });

  assert.equal(converted.source.kind, "pob_spec_lua");
  assert.equal(converted.tables.length, 3);
  assert.ok(converted.tables.find((table) => table.name === "baseitemtypes").columns.find((column) => column.name === "Id"));
  assert.ok(converted.tables.find((table) => table.name === "skillgems").columns.length > 5);
  assert.match(converted.spec_hash, /^[a-f0-9]{64}$/);
});

test("converted spec writer creates JSON output for Rust native parser", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-native-spec-"));
  try {
    const converted = await convertPobSpecLua({
      pobPath: "scratch/PathOfBuilding-PoE2",
      tableFilter: ["baseitemtypes"]
    });
    const result = await writeConvertedSpec(converted, { outputDir });
    const payload = JSON.parse(await readFile(result.specPath, "utf8"));

    assert.equal(payload.tables[0].name, "baseitemtypes");
    assert.equal(payload.tables[0].columns[0].ordinal, 1);
    assert.ok(payload.tables[0].columns.every((column) => "type" in column));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("phase2 native summary reports parser, spec conversion, Rust crate, and cargo availability", async () => {
  const summary = await phase2NativeSummary({
    pobPath: "scratch/PathOfBuilding-PoE2",
    tableFilter: ["baseitemtypes", "skillgems"]
  });

  assert.equal(summary.native_fixture.rows, 2);
  assert.equal(summary.spec.tables, 2);
  assert.equal(summary.rust_crate.manifest_exists, true);
  assert.equal(summary.rust_crate.lib_exists, true);
  assert.equal(typeof summary.toolchain.cargo_available, "boolean");
});

test("native CLI prints output summary and writes converted spec", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-native-cli-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/extract-game-native.mjs",
      "--pob-path=scratch/PathOfBuilding-PoE2",
      "--tables=baseitemtypes,skillgems",
      `--output-dir=${outputDir}`
    ], { cwd: repoRoot });
    const summary = JSON.parse(stdout);

    assert.equal(summary.spec.tables, 2);
    assert.equal(summary.native_fixture.rows, 2);
    assert.match(summary.output.spec, /pob-spec\.json$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

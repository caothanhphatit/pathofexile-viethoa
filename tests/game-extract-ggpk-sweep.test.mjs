import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  buildPobGgpkSweepManifest,
  validateOozToolDir,
  writeSweepManifest
} from "../scripts/game-extract/ggpk-sweep-runtime.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("PoB GGPK sweep manifest covers DAT64, stat description, object, and item sources", async () => {
  const manifest = await buildPobGgpkSweepManifest({
    pobPath: "scratch/PathOfBuilding-PoE2"
  });

  assert.equal(manifest.source.kind, "pob_ggpk_sweep");
  assert.equal(manifest.direct.files.includes("Data/Balance/BaseItemTypes.datc64"), true);
  assert.equal(manifest.direct.files.includes("Data/Balance/Mods.datc64"), true);
  assert.equal(manifest.direct.files.includes("Metadata/Items/Equipment.it"), true);
  assert.equal(manifest.regex.patterns.some((pattern) => pattern.includes("StatDescriptions")), true);
  assert.equal(manifest.regex.patterns.some((pattern) => pattern.includes("Metadata/Monsters")), true);
  assert.equal(manifest.summary.dat_tables > 200, true);
  assert.equal(manifest.summary.direct_files, manifest.direct.files.length);
});

test("OOZ tool validator detects bun extractor and dependent dlls", async () => {
  const tools = await validateOozToolDir(".codex_tmp/ooz/release");

  assert.match(tools.bun_extract_file.path, /bun_extract_file\.exe$/);
  assert.equal(tools.ready, true);
  assert.equal(tools.files.every((file) => file.exists), true);
});

test("sweep manifest writer emits app-readable JSON without absolute game paths", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-ggpk-sweep-"));
  try {
    const manifest = await buildPobGgpkSweepManifest({
      pobPath: "scratch/PathOfBuilding-PoE2"
    });
    const output = await writeSweepManifest(manifest, { outputDir });
    const payload = JSON.parse(await readFile(output.manifestPath, "utf8"));

    assert.equal(payload.direct.files.includes("Data/Balance/SkillGems.datc64"), true);
    assert.equal(JSON.stringify(payload).includes("Program Files"), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("GGPK sweep CLI dry-run prints manifest counts and tool readiness", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "poe2-ggpk-sweep-cli-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/extract-ggpk-sweep.mjs",
      "--dry-run",
      "--pob-path=scratch/PathOfBuilding-PoE2",
      "--tools-dir=.codex_tmp/ooz/release",
      `--output-dir=${outputDir}`
    ], { cwd: repoRoot });
    const summary = JSON.parse(stdout);

    assert.equal(summary.mode, "dry-run");
    assert.equal(summary.tools.ready, true);
    assert.equal(summary.manifest.direct_files > 200, true);
    assert.match(summary.output.manifest, /sweep-manifest\.json$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

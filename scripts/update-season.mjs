// Single "new season update" pipeline (`npm run update:season`):
//   1. Optionally pull PathOfBuilding-PoE2 (--pull-pob) and report commit info.
//   2. Guard-check Content.ggpk schema widths & extract base items, gems, and misc items.
//   3. Dump PoB gems, skills, and uniques via PoB's own LuaJIT.
//   4. Refresh Build Planner datasets (gem IDs, gem families, monsters, item mod pool, equipment rules).
//   5. Field-merge authoritative PoB + GGPK data into public/data/*.js while preserving
//      existing URL slugs and Vietnamese translations, and write docs/season-update-latest.md.
//   6. Incrementally extract & self-host any new icons from Content.ggpk as WebP.
//
// Usage:
//   npm run update:season
//   node scripts/update-season.mjs [--pull-pob] [--dry-run] [--skip-ggpk] [--skip-icons] [--game=<dir>]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POB_DIR = path.resolve(ROOT_DIR, "..", "pob-core");

function parseArgs(argv = process.argv.slice(2)) {
  return new Map(argv.map((arg) => {
    const [k, ...rest] = arg.split("=");
    return [k.replace(/^--/, ""), rest.join("=") || "true"];
  }));
}

function runStep(label, command, cmdArgs, { cwd = ROOT_DIR } = {}) {
  console.log(`\n==> ${label}`);
  const started = Date.now();
  const res = spawnSync(command, cmdArgs, { cwd, stdio: "inherit", env: process.env });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`Step failed (${res.status}): ${label}`);
  }
  console.log(`    OK in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

function checkPobStatus(pullPob) {
  if (!fs.existsSync(path.join(POB_DIR, ".git"))) {
    console.log(`PoB checkout not found at ${POB_DIR} — skipping git check.`);
    return;
  }
  if (pullPob) {
    runStep("Pull latest PathOfBuilding-PoE2", "git", ["-C", POB_DIR, "pull", "--ff-only", "origin", "dev"]);
  }
  const head = execFileSync("git", ["-C", POB_DIR, "log", "-n", "1", "--format=%h %cs %s"], { encoding: "utf8" }).trim();
  console.log(`PoB HEAD: ${head}`);
}

function main() {
  const args = parseArgs();
  const dryRun = args.has("dry-run");
  const skipGgpk = args.has("skip-ggpk");
  const skipIcons = args.has("skip-icons");
  const pullPob = args.has("pull-pob");
  const gameArg = args.get("game") ? [`--game=${args.get("game")}`] : [];
  const startedAll = Date.now();

  console.log("========================================");
  console.log("  PoE2 Viet Hoa — Season SOT Update");
  console.log("========================================");

  checkPobStatus(pullPob);

  if (!skipGgpk) {
    runStep("1/7 Check GGPK schema widths", process.execPath, ["scripts/ggpk/check-schema-widths.mjs", ...gameArg]);
    runStep("2/7 Extract GGPK base items, gems, and misc items", process.execPath, ["scripts/ggpk/extract-base-items.mjs", ...gameArg]);
    runStep("    Extract GGPK gems", process.execPath, ["scripts/ggpk/extract-gems.mjs", ...gameArg]);
    runStep("    Extract GGPK misc items (currency, omens, augments, tablets, waystones)", process.execPath, ["scripts/ggpk/extract-misc-items.mjs", ...gameArg]);
  } else {
    console.log("\n==> Skipping GGPK extraction (--skip-ggpk)");
  }

  runStep("3/7 Dump & generate PoB gems, skills, and uniques", process.execPath, ["scripts/pob-data/generate.mjs", "--dump"]);

  runStep("4/7 Refresh Build Planner & Craft PoB datasets", process.execPath, ["scripts/refresh-pob-gem-ids.mjs"]);
  runStep("    Refresh PoB gem families & monsters", process.execPath, ["scripts/refresh-pob-planner-data.mjs"]);
  runStep("    Rebuild PoB + GGPK gem compatibility & recommended supports", process.execPath, ["scripts/build-gem-compat-data.mjs", ...(skipGgpk ? ["--skip-ggpk"] : gameArg)]);
  runStep("    Rebuild PoB item mod pool (Build Planner + Craft Simulator)", process.execPath, ["scripts/build-item-mod-pool.mjs"]);
  runStep("    Rebuild PoB equipment rules", process.execPath, ["scripts/build-equipment-rules-data.mjs"]);

  runStep(
    `5/7 Sync Passive Tree from PoB TreeData (${dryRun ? "dry-run" : "apply"})`,
    process.execPath,
    ["scripts/sot/sync-passive-tree.mjs", ...(dryRun ? ["--dry-run"] : []), ...gameArg]
  );

  runStep(
    `6/7 Merge PoB + GGPK SOT into public/data/*.js (${dryRun ? "dry-run" : "apply"})`,
    process.execPath,
    ["scripts/sot/sync-from-sot.mjs", dryRun ? "--dry-run" : "--apply", ...(args.has("overwrite-mods") ? ["--overwrite-mods"] : [])]
  );

  if (!skipIcons && !skipGgpk) {
    runStep(
      "7/7 Sync self-hosted WebP icons from Content.ggpk",
      process.execPath,
      ["scripts/ggpk/sync-site-icons.mjs", ...gameArg, ...(dryRun ? ["--no-rewrite"] : []), ...(args.has("fetch-missing") ? ["--fetch-missing"] : [])]
    );
  } else {
    console.log("\n==> Skipping GGPK icon sync");
  }

  console.log(`\n========================================`);
  console.log(`  Season update complete in ${((Date.now() - startedAll) / 1000).toFixed(1)}s`);
  console.log(`  Report: docs/season-update-latest.md`);
  console.log(`  Next:   review report -> npm run translate:content (if needed) -> npm run build -> npm test`);
  console.log(`========================================`);
}

try {
  main();
} catch (error) {
  console.error(`\nSeason update halted: ${error.message || error}`);
  process.exitCode = 1;
}

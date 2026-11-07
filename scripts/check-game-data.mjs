// Cross-check the web data (crawled from poe2db) against the real game's
// Content.ggpk, so a game patch that adds, renames or removes items / gems /
// uniques shows up before the next crawl.
//
//   node scripts/check-game-data.mjs [--game="D:\Grinding Gear Games\Path of Exile 2"]
//                                    [--helper=<PoevhGgpkPatcher.exe>] [--out=<report.json>]
//                                    [--show=25] [--strict]
//
// Reads BaseItemTypes / ItemClasses / UniqueStashLayout / Words straight from
// the GGPK (same reader the vi-localization patcher uses), then compares names
// with public/data/items-data.js and public/data/skill-gems-data.js. Exit code
// is 0 unless --strict is given and the game has names the web data lacks.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const LOCALIZATION_DIR = path.join(ROOT_DIR, "apps", "poevh-desktop", "tools", "vi-localization");
const DEFAULT_HELPER = path.join(ROOT_DIR, "apps", "poevh-desktop", "tools", "poevh-ggpk-patcher", "publish", "PoevhGgpkPatcher.exe");
const DEFAULT_GAME_DIRS = [
  process.env.POE2_GAME_PATH,
  "D:\\Grinding Gear Games\\Path of Exile 2",
  "C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2"
].filter(Boolean);
const DEFAULT_REPORT = path.join(ROOT_DIR, "data", "game-extract", "check", "latest.json");

const TABLES = {
  baseItemTypes: "data/balance/baseitemtypes.datc64",
  itemClasses: "data/balance/itemclasses.datc64",
  uniqueStashLayout: "data/balance/uniquestashlayout.datc64",
  words: "data/balance/words.datc64"
};

/** Item classes the Build Planner can equip; everything else in BaseItemTypes is ignored. */
export const EQUIPMENT_CLASS = /^(Body Armours?|Boots|Gloves|Helmets?|Amulets?|Rings?|Belts?|Shields?|Foc(us|i)|Bucklers?|Quivers?|Claws?|Daggers?|Flails?|One Hand (Axes?|Maces?|Swords?)|Sceptres?|Spears?|Wands?|Bows?|Crossbows?|Quarterstaves|Quarterstaff|Staves|Staff|Talismans?|Traps?|Two Hand (Axes?|Maces?|Swords?)|Life Flasks?|Mana Flasks?|Charms?|Jewels?|Relics?)$/i;
export const GEM_CLASS = /\bGems?$/i;
/** Gem rows in BaseItemTypes that are name templates or developer entries, not real gems. */
export const IGNORED_GEM_NAME = /\{\d+\}|^Playtest\b|^Prototype\b|^Removed Skill$/i;

export const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export const normalizeName = (value) => String(value || "")
  .replace(/\s+/g, " ")
  .replace(/[’`]/g, "'")
  .trim()
  .toLowerCase();

/** Evaluate a `window.X = {...}` data bundle and return the first array of records that carry a name. */
export const loadWebBundle = (filePath) => {
  const source = fs.readFileSync(filePath, "utf8");
  const sandbox = {};
  new Function("window", source)(sandbox);
  const bundle = Object.values(sandbox)[0];
  if (!bundle || typeof bundle !== "object") throw new Error(`${filePath}: no window.* bundle found`);
  const findRecords = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 5) return null;
    if (Array.isArray(node) && node.length && node.every((row) => row && typeof row === "object" && "name" in row)) return node;
    for (const value of Array.isArray(node) ? node : Object.values(node)) {
      const found = findRecords(value, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const records = findRecords(bundle) || [];
  return {
    generatedAt: bundle.generated_at || null,
    sourceUrl: bundle.source_url || null,
    runStatus: bundle.latest_run?.status || null,
    runFinishedAt: bundle.latest_run?.finished_at || null,
    records
  };
};

/** Compare two name sets; returns what the game has that the web lacks and vice versa. */
export const compareNames = (gameNames, webNames) => {
  const game = new Map();
  for (const name of gameNames) game.set(normalizeName(name), name);
  const web = new Map();
  for (const name of webNames) web.set(normalizeName(name), name);
  const missingInWeb = [...game.entries()].filter(([key]) => !web.has(key)).map(([, name]) => name).sort();
  const missingInGame = [...web.entries()].filter(([key]) => !game.has(key)).map(([, name]) => name).sort();
  return {
    game: game.size,
    web: web.size,
    shared: game.size - missingInWeb.length,
    missingInWeb,
    missingInGame
  };
};

const resolveGameDir = (explicit) => {
  const candidates = explicit ? [explicit] : DEFAULT_GAME_DIRS;
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, "Content.ggpk"))) return dir;
  }
  throw new Error(`Content.ggpk not found. Pass --game=<install dir> or set POE2_GAME_PATH (tried: ${candidates.join(" | ")})`);
};

const extractTables = ({ ggpk, helper, workDir }) => {
  if (!fs.existsSync(helper)) {
    throw new Error(`GGPK helper missing at ${helper}. Build it: "%LOCALAPPDATA%\\Microsoft\\dotnet\\dotnet.exe" publish -c Release -o publish (in apps/poevh-desktop/tools/poevh-ggpk-patcher)`);
  }
  const result = JSON.parse(execFileSync(helper, ["--extract", ggpk, Object.values(TABLES).join(","), workDir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  if (!result.ok) throw new Error(result.message || "GGPK extract failed");
  const read = (bundlePath) => fs.readFileSync(path.join(workDir, bundlePath.replace(/\//g, "_")));
  return Object.fromEntries(Object.entries(TABLES).map(([key, bundlePath]) => [key, read(bundlePath)]));
};

export const readGameNames = async (buffers) => {
  const { loadSchema, tableSchema, parse } = await import(path.join(LOCALIZATION_DIR, "datc64.mjs").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));
  const schema = loadSchema(path.join(LOCALIZATION_DIR, "schema", "schema.min.json"));
  const table = (name, buffer) => parse(buffer, tableSchema(schema, name));

  const itemClasses = table("ItemClasses", buffers.itemClasses).rows;
  const classNameOf = (row) => (row.ItemClass === null ? "" : itemClasses[row.ItemClass]?.Name || "");
  const baseItems = table("BaseItemTypes", buffers.baseItemTypes).rows
    .map((row) => ({ id: row.Id, name: row.Name, itemClass: classNameOf(row) }))
    .filter((row) => row.name && !/^\[?(DNT|UNUSED)\]?|^Coming Soon$/i.test(row.name));

  const equipment = baseItems.filter((row) => EQUIPMENT_CLASS.test(row.itemClass));
  const gems = baseItems.filter((row) => GEM_CLASS.test(row.itemClass) && !/^Uncut /i.test(row.name));

  const words = table("Words", buffers.words).rows;
  let uniques = [];
  try {
    const layout = table("UniqueStashLayout", buffers.uniqueStashLayout).rows;
    uniques = layout
      .filter((row) => row.WordsKey !== null && words[row.WordsKey])
      .map((row) => words[row.WordsKey].Text);
  } catch {
    uniques = [];
  }
  if (!uniques.length) {
    // Wordlists enum (1-indexed): UNIQUE_ITEM is the 6th entry.
    uniques = words.filter((row) => row.Wordlist === 6).map((row) => row.Text);
  }
  uniques = [...new Set(uniques.filter(Boolean))];

  const classCounts = {};
  for (const row of baseItems) classCounts[row.itemClass || "(none)"] = (classCounts[row.itemClass || "(none)"] || 0) + 1;

  return {
    fingerprint: crypto.createHash("sha256").update(buffers.baseItemTypes).update(buffers.words).digest("hex").slice(0, 16),
    baseItemCount: baseItems.length,
    classCounts,
    equipment,
    gems,
    uniques
  };
};

/** Web item categories that map onto the equipment slots (plus jewels, which sit under "other"). */
export const WEB_EQUIPMENT_CATEGORY = new Set(["body-armour", "boots", "gloves", "helmet", "belt", "amulet", "ring", "offhand", "weapon", "charm", "life-flask", "mana-flask", "relic"]);

export const isWebEquipment = (row) => {
  if (String(row.rarity || "").toLowerCase() === "unique") return false;
  if (WEB_EQUIPMENT_CATEGORY.has(String(row.item_category || ""))) return true;
  return /^Jewels?$/i.test(String(row.menu_label || ""));
};

export const buildReport = ({ game, items, gems, gameDir, ggpkStat }) => {
  const webBases = items.records.filter(isWebEquipment).map((row) => row.name);
  const webUniques = items.records.filter((row) => String(row.rarity || "").toLowerCase() === "unique").map((row) => row.name);
  const webGems = gems.records.map((row) => row.name);
  const equipment = compareNames(game.equipment.map((row) => row.name), webBases);
  // Name templates ("Companion: {0}") and dev entries are never real gems; report them apart.
  const gemDiff = compareNames(game.gems.map((row) => row.name), webGems);
  gemDiff.ignored = gemDiff.missingInWeb.filter((name) => IGNORED_GEM_NAME.test(name));
  gemDiff.missingInWeb = gemDiff.missingInWeb.filter((name) => !IGNORED_GEM_NAME.test(name));
  // Game ids of the missing gems (e.g. Metadata/Items/Gems/SupportGemArbitersReach), which
  // poe2db does not show for every gem but the Build Planner needs for .build export.
  const gemIdByName = new Map(game.gems.map((row) => [normalizeName(row.name), row.id]));
  gemDiff.gameIds = Object.fromEntries(gemDiff.missingInWeb.map((name) => [name, gemIdByName.get(normalizeName(name)) || ""]));
  // Every gem name -> its BaseItemTypes ids, so fill:missing can correct guessed export ids.
  const allIds = {};
  for (const row of game.gems) (allIds[normalizeName(row.name)] ||= []).push(row.id);
  gemDiff.gameIdsByName = allIds;
  // A unique whose name doubles as its base type (e.g. Golden Blade) is listed as a unique on
  // poe2db, so the base is not really missing; report it apart from genuinely new bases.
  const uniqueKeys = new Set(webUniques.map(normalizeName));
  equipment.baseOfUnique = equipment.missingInWeb.filter((name) => uniqueKeys.has(normalizeName(name)));
  equipment.missingInWeb = equipment.missingInWeb.filter((name) => !uniqueKeys.has(normalizeName(name)));
  return {
    checkedAt: new Date().toISOString(),
    game: {
      dir: gameDir,
      ggpkBytes: ggpkStat.size,
      ggpkModifiedAt: ggpkStat.mtime.toISOString(),
      dataFingerprint: game.fingerprint,
      baseItemCount: game.baseItemCount,
      classCounts: game.classCounts
    },
    web: {
      items: { generatedAt: items.generatedAt, runStatus: items.runStatus, records: items.records.length },
      gems: { generatedAt: gems.generatedAt, runStatus: gems.runStatus, records: gems.records.length }
    },
    equipment,
    gems: gemDiff,
    uniques: compareNames(game.uniques, webUniques)
  };
};

const printSection = (label, diff, show) => {
  const head = `${label}: game ${diff.game} | web ${diff.web} | shared ${diff.shared} | game-only ${diff.missingInWeb.length} | web-only ${diff.missingInGame.length}`;
  console.log(head);
  const list = (title, rows) => {
    if (!rows.length) return;
    console.log(`  ${title} (${rows.length}):`);
    for (const name of rows.slice(0, show)) console.log(`    - ${name}`);
    if (rows.length > show) console.log(`    ... ${rows.length - show} more in the JSON report`);
  };
  list("in game, not in web data → crawl again", diff.missingInWeb);
  list("in web data, not in game → renamed or removed", diff.missingInGame);
  if (diff.baseOfUnique?.length) list("base type shared with a unique (listed as unique on poe2db)", diff.baseOfUnique);
  if (diff.ignored?.length) list("name templates / dev entries (ignored)", diff.ignored);
};

export const run = async (args) => {
  const gameDir = resolveGameDir(args.get("game"));
  const helper = args.get("helper") || DEFAULT_HELPER;
  const show = Number(args.get("show") || 25);
  const reportPath = path.resolve(args.get("out") || DEFAULT_REPORT);
  const ggpk = path.join(gameDir, "Content.ggpk");
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "poevh-check-"));
  try {
    const buffers = extractTables({ ggpk, helper, workDir });
    const game = await readGameNames(buffers);
    const items = loadWebBundle(path.join(ROOT_DIR, "public", "data", "items-data.js"));
    const gems = loadWebBundle(path.join(ROOT_DIR, "public", "data", "skill-gems-data.js"));
    const report = buildReport({ game, items, gems, gameDir, ggpkStat: fs.statSync(ggpk) });

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`Game: ${gameDir}`);
    console.log(`  Content.ggpk ${(report.game.ggpkBytes / 1e9).toFixed(1)} GB, modified ${report.game.ggpkModifiedAt}, data fingerprint ${report.game.dataFingerprint}`);
    console.log(`  BaseItemTypes rows with a name: ${report.game.baseItemCount}`);
    console.log(`Web data:`);
    console.log(`  items-data.js      generated ${report.web.items.generatedAt} (run ${report.web.items.runStatus}) · ${report.web.items.records} records`);
    console.log(`  skill-gems-data.js generated ${report.web.gems.generatedAt} (run ${report.web.gems.runStatus}) · ${report.web.gems.records} records`);
    console.log("");
    printSection("Equipment bases", report.equipment, show);
    printSection("Gems", report.gems, show);
    printSection("Uniques", report.uniques, show);
    console.log("");
    console.log(`Report: ${reportPath}`);

    const stale = report.equipment.missingInWeb.length + report.gems.missingInWeb.length + report.uniques.missingInWeb.length;
    if (stale) {
      console.log(`${stale} game entries are missing from the web data → crawl again, then run: npm run fill:missing`);
      if (args.get("strict") === "true") process.exitCode = 2;
    } else {
      console.log("Web data covers every equipment base, gem and unique in the game files.");
    }
    return report;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run(parseCliArgs()).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

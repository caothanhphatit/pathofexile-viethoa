// Refreshes src/server/data/pob-gem-ids.json (every gem id + name Path of Building
// knows, read from PoB's src/Data/Gems.lua) and then writes PoB's ids into the site's
// gem records (public/data/skill-gems-data.js -> official_id).
//
// PoB reads <Gem gemId="..."> through data.gemsByGameId, keyed by the gem's game id, and
// silently drops a gem whose id it does not know (the card then shows Punch's DPS).
// Run it after updating pob-core (scripts/update-pob-core.sh) or re-exporting gems:
//
//   node scripts/refresh-pob-gem-ids.mjs [<pob-core dir>] [--no-data]
//
// The pob-core dir defaults to $POB_CORE_DIR/.. or ../pob-core next to the repo. Without
// a pob-core checkout the committed JSON is kept and only the gem records are updated.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const POB_GEM_IDS_PATH = path.join(ROOT_DIR, "src", "server", "data", "pob-gem-ids.json");

/** [gameId, name, 1 when support] for every gem in PoB's Gems.lua, in file order. */
export const parseGemsLua = (source) => {
  const gems = [];
  const seen = new Set();
  const entry = /^\t\["([^"]+)"\] = \{([\s\S]*?)^\t\},/gm;
  let match;
  while ((match = entry.exec(source))) {
    const body = match[2];
    const field = (key) => body.match(new RegExp(`^\\t\\t${key} = "([^"]*)"`, "m"))?.[1];
    const gameId = field("gameId") || match[1];
    const name = field("name");
    if (!name || seen.has(gameId)) continue;
    seen.add(gameId);
    gems.push(field("gemType") === "Support" ? [gameId, name, 1] : [gameId, name]);
  }
  return gems;
};

const defaultPobDir = () => (process.env.POB_CORE_DIR
  ? path.resolve(process.env.POB_CORE_DIR, "..")
  : path.resolve(ROOT_DIR, "..", "pob-core"));

export const refreshPobGemIds = (pobDir = defaultPobDir()) => {
  const gemsLua = path.join(pobDir, "src", "Data", "Gems.lua");
  if (!fs.existsSync(gemsLua)) return null;
  let commit = "";
  try {
    commit = execFileSync("git", ["-C", pobDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // Not a git checkout (the server's copy); the id list is still valid.
  }
  const gems = parseGemsLua(fs.readFileSync(gemsLua, "utf8"));
  if (gems.length < 100) throw new Error(`Only ${gems.length} gems parsed from ${gemsLua}`);
  const data = { source: `PathOfBuilding-PoE2${commit ? ` ${commit}` : ""} src/Data/Gems.lua`, gems };
  // One gem per line keeps diffs readable.
  const body = gems.map((gem) => `    ${JSON.stringify(gem)}`).join(",\n");
  fs.mkdirSync(path.dirname(POB_GEM_IDS_PATH), { recursive: true });
  fs.writeFileSync(POB_GEM_IDS_PATH, `{\n  "source": ${JSON.stringify(data.source)},\n  "gems": [\n${body}\n  ]\n}\n`, "utf8");
  return data;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const pobDir = args.find((arg) => !arg.startsWith("--"));
  const refreshed = refreshPobGemIds(pobDir ? path.resolve(pobDir) : undefined);
  console.log(refreshed
    ? `Wrote ${path.relative(ROOT_DIR, POB_GEM_IDS_PATH)}: ${refreshed.gems.length} gems (${refreshed.source})`
    : `No pob-core checkout found; kept ${path.relative(ROOT_DIR, POB_GEM_IDS_PATH)}`);
  if (!args.includes("--no-data")) {
    // A fresh process, so the resolver reads the JSON just written.
    execFileSync(process.execPath, ["-e", `import(${JSON.stringify(new URL("./skill-gems/pob-gem-ids.mjs", import.meta.url).href)}).then((m) => console.log(JSON.stringify(m.applyPobGemIdsToFile(), null, 2)))`], { stdio: "inherit" });
  }
}

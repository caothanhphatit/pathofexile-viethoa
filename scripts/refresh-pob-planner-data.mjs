// Refreshes two small data files the Build Planner reads, both taken from Path of
// Building's own data (run it after updating pob-core, next to refresh-pob-gem-ids.mjs):
//
//   src/server/data/pob-monsters.json      every monster a Spectre / Companion gem can
//                                          summon (PoB's src/Data/Spectres.lua): id, name,
//                                          category and PoB's "recommended" flags.
//   src/server/data/pob-gem-families.json  the families of each support gem (gemFamily of
//                                          its granted effect in src/Data/Skills/*.lua, by the
//                                          gem's game id from src/Data/Gems.lua). Only one
//                                          support of a family works on a skill
//                                          (CalcSetup addBestSupport).
//
//   node scripts/refresh-pob-planner-data.mjs [<pob-core dir>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const POB_MONSTERS_PATH = path.join(ROOT_DIR, "src", "server", "data", "pob-monsters.json");
export const POB_GEM_FAMILIES_PATH = path.join(ROOT_DIR, "src", "server", "data", "pob-gem-families.json");

/** [id, name, category, flags] per monster of Spectres.lua; flags: "s" recommended spectre, "b" recommended beast. */
export const parseSpectresLua = (source) => {
  const monsters = [];
  const entry = /^minions\["([^"]+)"\] = \{([\s\S]*?)^\}/gm;
  let match;
  while ((match = entry.exec(source))) {
    const body = match[2];
    const name = body.match(/^\tname = "([^"]*)"/m)?.[1];
    if (!name) continue;
    const category = body.match(/^\tmonsterCategory = "([^"]*)"/m)?.[1] || "";
    const flags = `${/^\t\trecommendedSpectre = true/m.test(body) ? "s" : ""}${/^\t\trecommendedBeast = true/m.test(body) ? "b" : ""}`;
    monsters.push(flags ? [match[1], name, category, flags] : [match[1], name, category]);
  }
  return monsters;
};

/** { grantedEffectId: [family, ...] } from one Data/Skills/*.lua file. */
export const parseSkillFamilies = (source) => {
  const families = {};
  const entry = /^skills\["([^"]+)"\] = \{([\s\S]*?)^\}/gm;
  let match;
  while ((match = entry.exec(source))) {
    const list = match[2].match(/^\tgemFamily = \{([^}]*)\}/m)?.[1];
    if (!list) continue;
    const names = [...list.matchAll(/"([^"]+)"/g)].map((row) => row[1]);
    if (names.length) families[match[1]] = names;
  }
  return families;
};

/** [gameId, grantedEffectId] for every support gem of Gems.lua. */
export const parseSupportGems = (source) => {
  const gems = [];
  const entry = /^\t\["([^"]+)"\] = \{([\s\S]*?)^\t\},/gm;
  let match;
  while ((match = entry.exec(source))) {
    const body = match[2];
    const field = (key) => body.match(new RegExp(`^\\t\\t${key} = "([^"]*)"`, "m"))?.[1];
    if (field("gemType") !== "Support") continue;
    const effect = field("grantedEffectId");
    if (effect) gems.push([field("gameId") || match[1], effect]);
  }
  return gems;
};

const defaultPobDir = () => (process.env.POB_CORE_DIR
  ? path.resolve(process.env.POB_CORE_DIR, "..")
  : path.resolve(ROOT_DIR, "..", "pob-core"));

const writeRows = (file, source, key, rows) => {
  const body = rows.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `{\n  "source": ${JSON.stringify(source)},\n  "${key}": [\n${body}\n  ]\n}\n`, "utf8");
};

export const refreshPobPlannerData = (pobDir = defaultPobDir()) => {
  const dataDir = path.join(pobDir, "src", "Data");
  if (!fs.existsSync(path.join(dataDir, "Spectres.lua"))) return null;
  const monsters = parseSpectresLua(fs.readFileSync(path.join(dataDir, "Spectres.lua"), "utf8"));
  if (monsters.length < 100) throw new Error(`Only ${monsters.length} monsters parsed from Spectres.lua`);
  writeRows(POB_MONSTERS_PATH, "PathOfBuilding-PoE2 src/Data/Spectres.lua", "monsters", monsters);

  const byEffect = {};
  const skillsDir = path.join(dataDir, "Skills");
  for (const file of fs.readdirSync(skillsDir).filter((name) => name.endsWith(".lua")).sort()) {
    Object.assign(byEffect, parseSkillFamilies(fs.readFileSync(path.join(skillsDir, file), "utf8")));
  }
  const families = parseSupportGems(fs.readFileSync(path.join(dataDir, "Gems.lua"), "utf8"))
    .filter(([, effect]) => byEffect[effect])
    .map(([gameId, effect]) => [gameId, effect, byEffect[effect]]);
  if (families.length < 100) throw new Error(`Only ${families.length} support families parsed`);
  writeRows(POB_GEM_FAMILIES_PATH, "PathOfBuilding-PoE2 src/Data/Gems.lua + src/Data/Skills/*.lua (gemFamily)", "gems", families);
  return { monsters: monsters.length, families: families.length };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = refreshPobPlannerData(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  if (!result) {
    console.error("No pob-core checkout found (pass its directory or set POB_CORE_DIR).");
    process.exitCode = 1;
  } else {
    console.log(`pob-monsters.json: ${result.monsters} monsters; pob-gem-families.json: ${result.families} support gems`);
  }
}

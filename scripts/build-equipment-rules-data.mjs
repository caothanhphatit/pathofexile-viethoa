// Builds src/shared/equipment-rules-data.mjs from a Path of Building PoE2 checkout:
//   node scripts/build-equipment-rules-data.mjs [../pob-core]
//
// The planner's weapon-set rules (src/shared/equipment-rules.mjs) need to know, for
// every weapon and off-hand base, what PoB knows about it: its type and the tags
// ItemsTab:IsItemValidForSlot reads (onehand, twohand, one_hand_weapon, axe, mace,
// sword). They also need the passive nodes that lift a restriction (Giant's Blood,
// Instruments of Power, Lord of the Wilds) and the level each gem level requires.
// All of it is read from PoB's data so no rule is written from memory.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const pobDir = path.resolve(process.argv[2] || process.env.POB_DIR || path.join(ROOT_DIR, "..", "pob-core"));
const srcDir = path.join(pobDir, "src");

const BASE_FILES = ["axe", "bow", "claw", "crossbow", "dagger", "flail", "focus", "mace", "quiver", "sceptre", "shield", "spear", "staff", "sword", "talisman", "traptool", "wand", "fishing"];
// Tags PoB's slot rules read, plus "weapon" (martial weapons: what attack skills need) and
// "ranged"; every other tag (basetype families, implicit skills) is left out.
const RULE_TAGS = ["onehand", "twohand", "one_hand_weapon", "axe", "mace", "sword", "warstaff", "buckler", "weapon", "ranged"];

/** itemBases["Name"] = { type = "..", tags = { a = true, .. }, .. } blocks of one Data/Bases file. */
export function parseBases(lua) {
  const rows = [];
  const pattern = /itemBases\["([^"]+)"\] = \{([\s\S]*?)\n\}/g;
  for (let match = pattern.exec(lua); match; match = pattern.exec(lua)) {
    const type = match[2].match(/\btype = "([^"]*)"/)?.[1] ?? "";
    const tagText = match[2].match(/\btags = \{([^}]*)\}/)?.[1] ?? "";
    const tags = [...tagText.matchAll(/(\w+) = true/g)].map((row) => row[1]);
    rows.push({ name: match[1], type, tags });
  }
  return rows;
}

/** The site's name for a class: PoB files quarterstaves under type "Staff" with the tag warstaff. */
const classKey = (base) => {
  if (base.type === "Staff") return base.tags.includes("warstaff") ? "Quarterstaff" : "Staff";
  if (base.type === "Shield") return base.tags.includes("buckler") ? "Buckler" : "Shield";
  return base.type;
};

export function weaponClasses(bases) {
  const classes = {};
  for (const base of bases) {
    const key = classKey(base);
    const tags = RULE_TAGS.filter((tag) => base.tags.includes(tag)).sort();
    const entry = classes[key] ??= { type: base.type, tags, bases: [] };
    if (entry.tags.join() !== tags.join()) throw new Error(`${base.name}: tags ${tags} differ from its class ${key} (${entry.tags})`);
    entry.bases.push(base.name);
  }
  for (const entry of Object.values(classes)) entry.bases.sort();
  return Object.fromEntries(Object.entries(classes).sort(([a], [b]) => a.localeCompare(b)));
}

/** Passive nodes whose stats hold one of the lines PoB's ModParser turns into a weapon flag. */
export function flagNodes(tree, lines) {
  const out = {};
  for (const [flag, line] of Object.entries(lines)) {
    out[flag] = Object.values(tree.nodes ?? {})
      .filter((node) => Array.isArray(node.stats) && node.stats.includes(line))
      .map((node) => Number(node.skill))
      .sort((a, b) => a - b);
    if (!out[flag].length) throw new Error(`No passive node has the stat "${line}"`);
  }
  return out;
}

// ModParser.lua: the stat lines behind flag("GiantsBlood"), flag("InstrumentsOfPower"), flag("LordOfTheWilds").
export const FLAG_LINES = {
  giantsBlood: "You can wield Two-Handed Axes, Maces and Swords in one hand",
  instrumentsOfPower: "You can equip a Focus while wielding a Staff",
  lordOfTheWilds: "You can equip a non-Unique Sceptre while wielding a Talisman"
};

/**
 * Level a character needs for each gem level. PoB keeps it per skill
 * (Data/Skills/*.lua: levels = { [n] = { levelRequirement = .. } }); the table is
 * only written when every player skill gem agrees on it.
 */
export function gemLevelRequirements(skillFiles) {
  const tables = new Map();
  for (const lua of skillFiles) {
    for (const block of lua.matchAll(/\n\tlevels = \{([\s\S]*?)\n\t\},/g)) {
      const levels = [...block[1].matchAll(/\[(\d+)\] = \{[^\n]*?levelRequirement = (\d+)/g)].map((row) => [Number(row[1]), Number(row[2])]);
      if (levels.length < 20) continue;
      const key = JSON.stringify(levels.slice(0, 20));
      tables.set(key, (tables.get(key) ?? 0) + 1);
    }
  }
  const ranked = [...tables.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) throw new Error("No gem level tables found");
  const total = ranked.reduce((sum, row) => sum + row[1], 0);
  return { levels: JSON.parse(ranked[0][0]).map((row) => row[1]), share: ranked[0][1] / total, variants: ranked.length };
}

/**
 * PoB's act table (Modules/Build.lua, "calculate acts Table based on data.questRewards"):
 * per act the highest area level of a quest that gives passive points, and the quest
 * points earned up to and including that act. Entry 0 is the start (level 1, no points).
 */
export function passivePointActs(questRewardsLua) {
  const acts = [{ level: 1, questPoints: 0 }];
  for (const block of questRewardsLua.matchAll(/\{\s*\n([\s\S]*?)\n\t\}/g)) {
    const field = (name) => block[1].match(new RegExp(`\\["${name}"\\] = "?([^",\\n]+)"?`))?.[1];
    const questPoints = Number(field("questPoints"));
    if (!questPoints) continue;
    const act = Number(field("Act")) + (field("Type") === "Cruel" ? 3 : 0);
    const areaLevel = Number(field("AreaLevel"));
    if (!acts[act]) acts[act] = { level: areaLevel, questPoints: questPoints + acts[act - 1].questPoints };
    else {
      acts[act].questPoints += questPoints;
      acts[act].level = Math.max(acts[act].level, areaLevel);
    }
  }
  return acts;
}

function main() {
  const bases = BASE_FILES.flatMap((name) => parseBases(fs.readFileSync(path.join(srcDir, "Data", "Bases", `${name}.lua`), "utf8")));
  const classes = weaponClasses(bases);
  const treeDirs = fs.readdirSync(path.join(srcDir, "TreeData")).filter((dir) => /^\d+_\d+$/.test(dir)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const treeVersion = treeDirs.at(-1);
  const tree = JSON.parse(fs.readFileSync(path.join(srcDir, "TreeData", treeVersion, "tree.json"), "utf8"));
  const nodes = flagNodes(tree, FLAG_LINES);
  // PoB does not count these towards the ascendancy points (PassiveSpec:CountAllocNodes).
  const choiceOptions = Object.values(tree.nodes ?? {}).filter((node) => node.isMultipleChoiceOption).map((node) => Number(node.skill)).sort((a, b) => a - b);
  const skillDir = path.join(srcDir, "Data", "Skills");
  const gems = gemLevelRequirements(fs.readdirSync(skillDir).filter((file) => /^act_.*\.lua$/.test(file)).map((file) => fs.readFileSync(path.join(skillDir, file), "utf8")));
  const acts = passivePointActs(fs.readFileSync(path.join(srcDir, "Data", "QuestRewards.lua"), "utf8"));
  let commit = "";
  try { commit = execFileSync("git", ["-C", pobDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }

  const classLines = Object.entries(classes).map(([key, entry]) => `  ${JSON.stringify(key)}: ${JSON.stringify(entry)}`).join(",\n");
  const text = `// Generated by scripts/build-equipment-rules-data.mjs from Path of Building PoE2${commit ? ` (commit ${commit})` : ""}.
// Do not edit: rerun the script after updating the PoB checkout.
// Sources: src/Data/Bases/*.lua (type, tags), src/TreeData/${treeVersion}/tree.json (nodes),
// src/Data/Skills/act_*.lua (gem level requirements), src/Data/QuestRewards.lua (passive points).

/** Active passive tree version from PoB's newest src/TreeData/<version>/ directory. */
export const TREE_VERSION = ${JSON.stringify(treeVersion)};

/** PoB's item type and the tags its slot rules read, per weapon / off-hand class. */
export const WEAPON_CLASSES = {
${classLines}
};

/** Passive nodes that set a weapon flag in PoB (ModParser: GiantsBlood, InstrumentsOfPower, LordOfTheWilds). */
export const WEAPON_FLAG_NODES = ${JSON.stringify(nodes)};

/** The stat lines behind those flags; an equipped item carrying one sets the flag too. */
export const WEAPON_FLAG_LINES = ${JSON.stringify(FLAG_LINES, null, 2)};

/**
 * Character level needed for gem level 1..20 (index 0 = gem level 1). ${Math.round(gems.share * 100)}% of PoB's
 * active skills use exactly this table (${gems.variants} variants in all), so it is a warning aid, not a rule.
 */
export const GEM_LEVEL_REQUIREMENTS = ${JSON.stringify(gems.levels)};

/** Ascendancy nodes that are an option of a multiple-choice node: PoB counts the choice node, not its options. */
export const MULTIPLE_CHOICE_OPTION_NODES = ${JSON.stringify(choiceOptions)};

/**
 * PoB's act table (Modules/Build.lua): the area level of each act's last passive-point
 * quest and the quest points earned by then. PoB estimates the level a tree needs from it.
 */
export const PASSIVE_POINT_ACTS = ${JSON.stringify(acts)};
`;
  const target = path.join(ROOT_DIR, "src", "shared", "equipment-rules-data.mjs");
  fs.writeFileSync(target, text);
  console.log(`Wrote ${path.relative(ROOT_DIR, target)}: ${Object.keys(classes).length} classes, ${bases.length} bases, tree ${treeVersion}, gem table share ${(gems.share * 100).toFixed(0)}%`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

// Builds the Build Planner's item mod pool from Path of Building's game data:
//
//   node scripts/build-item-mod-pool.mjs [<pob-core dir>] [--no-report]
//
// Reads <pob-core>/src/Data/{ModItem,ModJewel,ModFlask,ModCharm,ModVeiled,
// ModItemExclusive,ModCorrupted,Essence}.lua and Bases/*.lua (generated from the game
// files) and writes
//
//   public/data/item-mods-data.js          window.POE2_ITEM_MODS, read by
//                                           src/shared/item-mods.mjs (buildModPool)
//   docs/item-mod-pool-pob-vs-poe2db.md    the old poe2db pool compared with this one
//
// The rule is PoB's ItemClass:GetModSpawnWeight: a mod can roll on a base when the
// first of its weightKey tags that the base has carries a weight above 0. Bases with
// the same answers for every mod share one pool "class", so a staff whose implicit
// skill is physical (tags no_fire_spell_mods, no_cold_spell_mods...) gets its own.
//
// Per class the file lists three kinds of mod:
//   normal   weight > 0 on the base's own tags: what the editor offers;
//   special  only reachable through crafting that PoB models: essences for the item
//            type, desecrated mods, tags added by breach/abyss crafting and by the
//            influence runes of that item type (data.runeInfluences in PoB);
//   unbound  (one list per affix table) mods whose weights are all 0. The data does
//            not say what puts them on an item (alloys, hand wraps...), so they are
//            never offered, but a pasted item carrying one still parses.
//   excluded mods a tag of the base takes away (a physical staff's no_fire_spell_mods
//            = 0 listed before staff = 1): a pasted item cannot explain such a line
//            by an unbound mod.
// Re-run after updating pob-core, then bump itemModsDataVersion in src/spa/lib/data.ts.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { positional, readAllBases, readModFile } from "./lib/pob-lua-data.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ITEM_MODS_PATH = path.join(ROOT_DIR, "public", "data", "item-mods-data.js");
export const REPORT_PATH = path.join(ROOT_DIR, "docs", "item-mod-pool-pob-vs-poe2db.md");
export const ITEM_MODS_FORMAT = "pob-item-mods-1";

const defaultPobDir = () => (process.env.POB_CORE_DIR ? path.resolve(process.env.POB_CORE_DIR, "..") : path.resolve(ROOT_DIR, "..", "pob-core"));

/** PoB's data.runeInfluences: spawn tags an influence rune adds, by socketed-augment type. */
const RUNE_INFLUENCES = { boots: ["chronomancy"], gloves: ["marksman", "decay"], helmet: ["berserking"], weapon: ["destruction"], caster: ["destruction"], "body armour": ["soul"] };
const INFLUENCE_TAGS = new Set(Object.values(RUNE_INFLUENCES).flat());

/** PoB picks the affix table by base type (Item.lua: data.itemMods[type] or .Item). */
const tableOf = (base) => (base.type === "Jewel" ? "Jewel" : base.type === "Flask" ? "Flask" : base.type === "Charm" ? "Charm" : "Item");

/** ItemClass:GetModSpawnWeight with optional extra tags. */
export function spawnWeight(mod, tags, extraTags = null) {
  const keys = mod.weightKey ?? [];
  for (let index = 0; index < keys.length; index += 1) {
    if (tags[keys[index]] || extraTags?.has(keys[index])) return Number(mod.weightVal?.[index]) || 0;
  }
  return 0;
}

/**
 * True when a tag of the base overrides a weight the base would otherwise have: the
 * first matching weightKey gives 0, and a later one the base also has gives more
 * (a physical staff: no_fire_spell_mods = 0 before staff = 1).
 */
export function ruledOutByTag(mod, tags) {
  const keys = mod.weightKey ?? [];
  const first = keys.findIndex((key) => tags[key]);
  if (first < 0 || Number(mod.weightVal?.[first]) > 0) return false;
  return keys.some((key, index) => index > first && tags[key] && Number(mod.weightVal?.[index]) > 0);
}

/** ItemClass:GetSocketedAugmentTypes -> influence tags this base can gain. */
function influenceTags(base) {
  const baseType = base.weapon ? "weapon" : base.armour ? "armour" : base.tags.wand || base.tags.staff || base.tags.sceptre ? "caster" : "";
  const itemType = String(base.type).toLowerCase();
  return RUNE_INFLUENCES[itemType] ?? RUNE_INFLUENCES[baseType] ?? [];
}

/** Names of the uniques' bases, from src/Data/Uniques/*.lua ("[[ name \n base \n ..."). */
function uniqueBaseNames(pobDir) {
  const dir = path.join(pobDir, "src", "Data", "Uniques");
  const names = new Set();
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".lua"))) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    for (const match of source.matchAll(/\[\[\s*\n?([^\n]+)\n([^\n]+)\n/g)) names.add(match[2].trim());
  }
  return names;
}

export function buildItemModData(pobDir = defaultPobDir()) {
  const dataFile = (name) => path.join(pobDir, "src", "Data", `${name}.lua`);
  const tables = { Item: readModFile(dataFile("ModItem")), Jewel: readModFile(dataFile("ModJewel")), Flask: readModFile(dataFile("ModFlask")), Charm: readModFile(dataFile("ModCharm")) };
  const desecrated = readModFile(dataFile("ModVeiled"));
  const exclusive = readModFile(dataFile("ModItemExclusive"));
  const corrupted = readModFile(dataFile("ModCorrupted"));
  const essences = readModFile(dataFile("Essence"));
  const bases = readAllBases(pobDir);

  const baseTags = new Set(Object.values(bases).flatMap((base) => Object.keys(base.tags ?? {})));
  // Tags no base has are added by crafting (breach_desecration, ulaman_mod, marksman...).
  const craftTags = new Set();
  for (const file of [...Object.values(tables), desecrated]) {
    for (const mod of Object.values(file)) for (const key of mod.weightKey ?? []) if (!baseTags.has(key)) craftTags.add(key);
  }

  // A type is "released" when PoB lists at least one unique on it. PoB also carries the
  // bases of weapon types the game files hold but players cannot get yet (claws,
  // daggers...); those have no uniques. They stay in the file so pasted text parses,
  // but the editor does not offer them.
  const uniqueBases = uniqueBaseNames(pobDir);
  const releasedTypes = new Set(Object.entries(bases).filter(([name]) => uniqueBases.has(name)).map(([, base]) => base.type));

  const essenceByType = new Map();
  for (const essence of Object.values(essences)) {
    for (const [type, modId] of Object.entries(essence.mods ?? {})) {
      if (!essenceByType.has(type)) essenceByType.set(type, new Set());
      essenceByType.get(type).add(modId);
    }
  }

  const mods = [];
  const modIndex = new Map();
  const addMod = (source, id, mod) => {
    const key = `${source}:${id}`;
    if (modIndex.has(key)) return modIndex.get(key);
    const lines = positional(mod).filter((line) => typeof line === "string");
    if (!lines.length) return -1;
    const gen = mod.type === "Prefix" ? "P" : mod.type === "Suffix" ? "S" : "";
    mods.push([id, gen, mod.group || id, Number(mod.level) || 1, lines, (mod.modTags ?? []).join(",")]);
    modIndex.set(key, mods.length - 1);
    return mods.length - 1;
  };

  const classes = [];
  const classIndex = new Map();
  const outBases = [];
  for (const [name, base] of Object.entries(bases)) {
    if (base.type === "Transcendent Limb") continue;
    const table = tableOf(base);
    const extra = new Set([...craftTags].filter((tag) => !INFLUENCE_TAGS.has(tag)));
    for (const tag of influenceTags(base)) extra.add(tag);
    const normal = [];
    const special = [];
    const excluded = [];
    for (const [id, mod] of Object.entries(tables[table])) {
      if (mod.type !== "Prefix" && mod.type !== "Suffix") continue;
      if (spawnWeight(mod, base.tags) > 0) normal.push(addMod(table, id, mod));
      else if (spawnWeight(mod, base.tags, extra) > 0) special.push(addMod(table, id, mod));
      // A tag of the base takes away a weight it would otherwise have: the data rules
      // the mod out on this base.
      else if (ruledOutByTag(mod, base.tags)) excluded.push(addMod(table, id, mod));
    }
    for (const [id, mod] of Object.entries(desecrated)) {
      if (spawnWeight(mod, base.tags, extra) > 0) special.push(addMod("Desecrated", id, mod));
    }
    // PoB's essence list: keyed by item type (a quarterstaff by its sub type); the mod
    // comes from the affix table or from ModItemExclusive.
    const essenceTypes = [base.type === "Staff" && base.subType ? base.subType : base.type];
    if (base.type === "Shield" && base.tags.buckler) essenceTypes.push("Buckler");
    for (const type of essenceTypes) {
      for (const id of essenceByType.get(type) ?? []) {
        const index = tables[table][id] ? addMod(table, id, tables[table][id]) : exclusive[id] ? addMod("Exclusive", id, exclusive[id]) : -1;
        if (index >= 0 && !normal.includes(index)) special.push(index);
      }
    }
    const corrupt = [];
    for (const [id, mod] of Object.entries(corrupted)) {
      if (mod.type === "Corrupted" && spawnWeight(mod, base.tags) > 0) corrupt.push(addMod("Corrupted", id, mod));
    }
    const lists = [normal, [...new Set(special)].filter((index) => index >= 0), corrupt, excluded].map((list) => list.sort((a, b) => a - b));
    const key = `${table}|${base.type}|${lists.map((list) => list.join(",")).join("|")}`;
    if (!classIndex.has(key)) {
      classIndex.set(key, classes.length);
      classes.push({ type: base.type, table, normal: lists[0], special: lists[1], corrupt: lists[2], excluded: lists[3] });
    }
    const record = { n: name, c: classIndex.get(key), t: base.type };
    if (base.subType) record.st = base.subType;
    if (base.implicit) {
      // "{variant:3}Grants Skill: ..." lines are alternatives: the base has one of them.
      const lines = String(base.implicit).split("\n");
      const fixed = lines.filter((line) => !/^\{variant:[\d,]+\}/.test(line));
      const variants = lines.filter((line) => /^\{variant:[\d,]+\}/.test(line)).map((line) => line.replace(/^\{variant:[\d,]+\}/, ""));
      if (fixed.length) record.i = fixed;
      if (variants.length) record.iv = variants;
    }
    const req = base.req ?? {};
    if (req.level || req.str || req.dex || req.int) record.r = [req.level || 0, req.str || 0, req.dex || 0, req.int || 0];
    if (base.socketLimit) record.s = base.socketLimit;
    if (base.quality) record.q = base.quality;
    if (base.armour && !Array.isArray(base.armour)) record.a = base.armour;
    if (base.weapon && !Array.isArray(base.weapon)) record.w = base.weapon;
    if (base.spirit) record.sp = base.spirit;
    // 1 = PoB hides it (unique-only and runemastered bases), 2 = type with no uniques.
    if (base.hidden) record.h = 1;
    else if (!releasedTypes.has(base.type)) record.h = 2;
    outBases.push(record);
  }

  // Mods no weight can reach, per affix table.
  const unbound = {};
  for (const [table, file] of Object.entries(tables)) {
    unbound[table] = [];
    for (const [id, mod] of Object.entries(file)) {
      if (mod.type !== "Prefix" && mod.type !== "Suffix") continue;
      if ((mod.weightVal ?? []).every((value) => !(Number(value) > 0))) unbound[table].push(addMod(table, id, mod));
    }
  }

  let commit = "";
  try {
    commit = execFileSync("git", ["-C", pobDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // Not a git checkout; the data is still valid.
  }
  return {
    format: ITEM_MODS_FORMAT,
    source: `PathOfBuilding-PoE2${commit ? ` ${commit}` : ""} src/Data`,
    mods,
    classes,
    unbound,
    bases: outBases
  };
}

// ── Comparison with the poe2db pool ─────────────────────────────────────────

const loadGlobal = (file, name) => {
  const target = path.join(ROOT_DIR, "public", "data", file);
  if (!fs.existsSync(target)) return null;
  const scope = {};
  new Function("window", fs.readFileSync(target, "utf8"))(scope);
  return scope[name];
};

export async function buildReport(data) {
  const { buildModPool, normalizeText, poolClassForBase } = await import(pathToFileURL(path.join(ROOT_DIR, "src", "shared", "item-mods.mjs")).href);
  const craft = loadGlobal("craft-data.js", "POE2_CRAFT");
  const index = loadGlobal("craft-index.js", "POE2_CRAFT_INDEX");
  if (!craft || !index) return null;
  const oldPool = buildModPool(craft, index, []);
  const newPool = buildModPool(data, null, []);
  const sig = (mod) => `${mod.gen}: ${mod.templates.join(" / ")}`;
  const top = (mod) => mod.tiers[mod.tiers.length - 1].lines.flatMap((line) => line.ranges).map(([a, b]) => `${a}-${b}`).join(", ");
  // poe2db keeps one family per stat whatever its text ("+# to Level of all Fire Spell
  // Skills" and "... Cold Spell Skills" are tiers of IncreaseSocketedGemLevel): split
  // each family by tier text so it can be compared with PoB's one-text mods.
  const byText = (mod) => {
    const parts = new Map();
    for (const tier of mod.tiers) {
      const templates = tier.lines.map((line) => line.template);
      const key = `${mod.gen}: ${templates.join(" / ")}`;
      if (!parts.has(key)) parts.set(key, { gen: mod.gen, family: mod.family, templates, tiers: [] });
      parts.get(key).tiers.push(tier);
    }
    return parts;
  };
  const rows = [];
  const details = [];
  const totals = { oldFamilies: 0, oldMods: 0, newMods: 0, added: 0, removed: 0, ranges: 0, tiers: 0, restricted: 0, bases: 0, missingBases: 0, wrongFamilies: 0 };
  const oldBaseNames = new Set(oldPool.bases.keys());
  for (const [classKey, cls] of [...oldPool.classes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const baseNames = [...oldPool.bases.values()].filter((base) => base.classKey === classKey).map((base) => base.name);
    const known = baseNames.filter((name) => newPool.bases.has(normalizeText(name)) || newPool.hiddenBases.has(normalizeText(name)));
    const oldMods = new Map();
    for (const mod of cls.mods) for (const [key, part] of byText(mod)) if (!oldMods.has(key)) oldMods.set(key, part);
    const union = new Map();
    const perBase = new Map();
    for (const name of known) {
      const found = poolClassForBase(newPool, name);
      const sigs = new Set();
      for (const mod of found?.cls?.mods ?? []) {
        sigs.add(sig(mod));
        const seen = union.get(sig(mod));
        if (!seen || mod.tiers.length > seen.tiers.length) union.set(sig(mod), mod);
      }
      perBase.set(name, sigs);
    }
    const added = [...union.keys()].filter((key) => !oldMods.has(key)).sort();
    const removed = [...oldMods.keys()].filter((key) => !union.has(key)).sort();
    const rangeChanges = [];
    const tierChanges = [];
    for (const [key, mod] of oldMods) {
      const next = union.get(key);
      if (!next) continue;
      if (top(mod) !== top(next)) rangeChanges.push(`${key}: best tier ${top(mod)} -> ${top(next)}`);
      if (mod.tiers.length !== next.tiers.length) tierChanges.push(`${key}: ${mod.tiers.length} -> ${next.tiers.length} tiers`);
    }
    // Families poe2db merged: one old family whose texts PoB puts in several groups.
    const groupsByFamily = new Map();
    for (const [key, mod] of oldMods) {
      const next = union.get(key);
      if (!next) continue;
      const id = `${mod.gen} ${mod.family}`;
      if (!groupsByFamily.has(id)) groupsByFamily.set(id, new Set());
      groupsByFamily.get(id).add(next.family);
    }
    const merged = [...groupsByFamily.entries()].filter(([, groups]) => groups.size > 1).map(([family, groups]) => `${family} -> ${[...groups].sort().join(", ")}`);
    const restricted = known.filter((name) => perBase.get(name).size < union.size);
    totals.oldFamilies += cls.mods.length;
    totals.oldMods += oldMods.size;
    totals.newMods += union.size;
    totals.added += added.length;
    totals.removed += removed.length;
    totals.ranges += rangeChanges.length;
    totals.tiers += tierChanges.length;
    totals.restricted += restricted.length;
    totals.bases += baseNames.length;
    totals.missingBases += baseNames.length - known.length;
    totals.wrongFamilies += merged.length;
    rows.push(`| ${classKey} | ${baseNames.length} | ${baseNames.length - known.length} | ${oldMods.size} | ${union.size} | ${added.length} | ${removed.length} | ${rangeChanges.length} | ${tierChanges.length} | ${merged.length} | ${restricted.length} |`);
    const section = [`### ${classKey}`, ""];
    const list = (title, items) => {
      if (!items.length) return;
      section.push(`<details><summary>${title} (${items.length})</summary>`, "", ...items.map((item) => `- ${item}`), "", "</details>", "");
    };
    list("Mods only in the PoB pool (added)", added);
    list("Mods only in the poe2db pool (removed)", removed);
    list("Best-tier range changed", rangeChanges);
    list("Tier count changed", tierChanges);
    list("poe2db family split into PoB groups", merged);
    list("Bases with a smaller pool than the rest of the class (special tags)", restricted.map((name) => {
      const missing = [...union.keys()].filter((key) => !perBase.get(name).has(key));
      return `${name}: cannot roll ${missing.length} of ${union.size} (${missing.slice(0, 4).join("; ")}${missing.length > 4 ? "; …" : ""})`;
    }));
    list("Bases poe2db listed that PoB does not have", baseNames.filter((name) => !known.includes(name)));
    if (section.length > 2) details.push(...section);
  }
  const newOnly = [...newPool.bases.values()].filter((base) => !oldBaseNames.has(normalizeText(base.name)));
  const hiddenOffered = [...oldPool.bases.values()].filter((base) => newPool.hiddenBases.has(normalizeText(base.name)));
  const typeCounts = new Map();
  for (const base of hiddenOffered) typeCounts.set(newPool.hiddenBases.get(normalizeText(base.name)).itemClass, (typeCounts.get(newPool.hiddenBases.get(normalizeText(base.name)).itemClass) ?? 0) + 1);
  const lines = [
    "# Item mod pool: poe2db (old) vs Path of Building (new)",
    "",
    "Generated by `node scripts/build-item-mod-pool.mjs`. Do not edit by hand.",
    "",
    `- Old pool: \`public/data/craft-data.js\` + \`craft-index.js\` (poe2db ModifiersCalc, crawled ${craft.generated_at ?? "2026-06-10"}), one pool per item class.`,
    `- New pool: \`public/data/item-mods-data.js\` from ${data.source}, one pool per set of base tags (${data.classes.length} pools for ${data.bases.length} bases, ${data.mods.length} mods).`,
    "- A mod is compared by prefix/suffix and its text with numbers replaced by `#` (a poe2db family whose tiers have different texts counts once per text). \"New\" columns are the union over the old class's bases; a single base can have fewer (last column).",
    "",
    "## Totals",
    "",
    `- Old classes: ${oldPool.classes.size}; old bases: ${totals.bases}, of which PoB does not know ${totals.missingBases}.`,
    `- Bases offered by the editor: ${oldPool.bases.size} -> ${newPool.bases.size} (${newOnly.length} are new; ${hiddenOffered.length} old ones are no longer offered: ${[...typeCounts.entries()].map(([type, count]) => `${type} ${count}`).join(", ") || "none"}).`,
    `- Mods (prefix/suffix + text, summed over old classes): ${totals.oldMods} in ${totals.oldFamilies} poe2db families -> ${totals.newMods}; added ${totals.added}, removed ${totals.removed}.`,
    `- Mods kept whose best-tier range changed: ${totals.ranges}; whose tier count changed: ${totals.tiers}.`,
    `- poe2db families that PoB splits into several groups (mods the old editor wrongly made exclusive): ${totals.wrongFamilies}.`,
    `- Bases whose pool is smaller than the union of their old class (their own tags, or a narrower PoB type): ${totals.restricted}.`,
    `- Mods never offered (all weights 0): ${Object.entries(data.unbound).map(([table, list]) => `${table} ${list.length}`).join(", ")}; they still parse on pasted items.`,
    "",
    "## Per class",
    "",
    "| Old class | Bases | Not in PoB | Old mods | New mods | Added | Removed | Range changed | Tiers changed | Families split | Restricted bases |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    "## Details",
    "",
    ...details
  ];
  return { text: `${lines.join("\n")}\n`, totals };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const pobDir = args.find((arg) => !arg.startsWith("--")) || defaultPobDir();
  if (!fs.existsSync(path.join(pobDir, "src", "Data", "ModItem.lua"))) {
    console.error(`Path of Building data not found in ${pobDir} (pass the pob-core directory or set POB_CORE_DIR).`);
    process.exit(1);
  }
  const data = buildItemModData(pobDir);
  if (data.mods.length < 2000 || data.bases.length < 1000) throw new Error(`Suspicious pool: ${data.mods.length} mods, ${data.bases.length} bases`);
  fs.writeFileSync(ITEM_MODS_PATH, `window.POE2_ITEM_MODS = ${JSON.stringify(data)};\n`, "utf8");
  console.log(`${path.relative(ROOT_DIR, ITEM_MODS_PATH)}: ${data.mods.length} mods, ${data.classes.length} pools, ${data.bases.length} bases (${data.source}).`);
  if (!args.includes("--no-report")) {
    const report = await buildReport(data);
    if (report) {
      fs.writeFileSync(REPORT_PATH, report.text, "utf8");
      console.log(`${path.relative(ROOT_DIR, REPORT_PATH)}: mods ${report.totals.oldMods} -> ${report.totals.newMods} (added ${report.totals.added}, removed ${report.totals.removed}).`);
    } else {
      console.log("No craft-data.js / craft-index.js: comparison report skipped.");
    }
  }
}

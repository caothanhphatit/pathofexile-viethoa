// Step 1 of sourcing web data from the game itself: equipment base items.
//
//   npm run extract:game-base-items [-- --game="D:\Grinding Gear Games\Path of Exile 2"] [--out=<json>]
//
// Reads BaseItemTypes, ItemClasses, ArmourTypes, WeaponTypes, ShieldTypes,
// AttributeRequirements, ItemVisualIdentity, Tags and Mods from Content.ggpk and writes
// one record per equipment base name to data/game-extract/ggpk/base-items.json. Then it
// compares every shared base with public/data/items-data.js (poe2db) and prints where the
// two disagree. Implicit mod *text* is a later step; implicits are kept as Mods ids.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openGame, ROOT_DIR } from "./reader.mjs";

const DEFAULT_OUT = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "base-items.json");
const ITEMS_DATA = path.join(ROOT_DIR, "public", "data", "items-data.js");
export const ICON_CDN = "https://cdn.poe2db.tw/image/";

export const TABLES = [
  "BaseItemTypes", "ItemClasses", "ArmourTypes", "WeaponTypes", "ShieldTypes",
  "AttributeRequirements", "ItemVisualIdentity", "Tags", "Mods", "Stats"
];

/** Item classes the site treats as equipment (same list as check-game-data). */
export const EQUIPMENT_CLASS = /^(Body Armours?|Boots|Gloves|Helmets?|Amulets?|Rings?|Belts?|Shields?|Foc(us|i)|Bucklers?|Quivers?|Claws?|Daggers?|Flails?|One Hand (Axes?|Maces?|Swords?)|Sceptres?|Spears?|Wands?|Bows?|Crossbows?|Quarterstaves|Quarterstaff|Staves|Staff|Talismans?|Traps?|Two Hand (Axes?|Maces?|Swords?)|Life Flasks?|Mana Flasks?|Charms?|Jewels?|Relics?)$/i;

/** PoE2 item ids live under a "Four..." name; other rows are PoE1 leftovers. */
export const isPoe2Id = (id) => /\/Four[A-Z]/.test(String(id || ""));
/** Bases made for one unique (e.g. FourOneHandMace13VerisiumUnique3). */
export const isUniqueOnlyBase = (id) => /Unique\d*$|Unique\d*[A-Z]/.test(String(id || "").split("/").pop() || "");

export const iconUrlFromDds = (dds) => (dds ? ICON_CDN + String(dds).replace(/\.dds$/i, ".webp") : "");

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Act-difficulty copies of a base (FourBodyDexInt1Cruel) are not the base poe2db or the game list shows. */
export const isDifficultyCopy = (id) => /Cruel$/i.test(String(id || ""));

/** Pick the row that represents a base name: PoE2 id, not unique-only, not a Cruel copy, lowest drop level, then id. */
export const pickCanonical = (rows) => [...rows].sort((a, b) =>
  (isPoe2Id(b.Id) - isPoe2Id(a.Id)) ||
  (isUniqueOnlyBase(a.Id) - isUniqueOnlyBase(b.Id)) ||
  (isDifficultyCopy(a.Id) - isDifficultyCopy(b.Id)) ||
  (a.DropLevel - b.DropLevel) ||
  a.Id.localeCompare(b.Id))[0];

/**
 * Build base item records from decoded tables. `t` maps table name -> rows; kept pure so
 * tests can feed synthetic rows.
 */
export const buildBaseItems = (t) => {
  const byBase = (rows, key = "BaseItemType") => {
    const map = new Map();
    for (const row of rows || []) if (row[key] !== null && row[key] !== undefined && !map.has(row[key])) map.set(row[key], row);
    return map;
  };
  const armour = byBase(t.ArmourTypes);
  const weapon = byBase(t.WeaponTypes);
  const shield = byBase(t.ShieldTypes);
  const reqs = byBase(t.AttributeRequirements);
  const classOf = (row) => (row.ItemClass === null ? null : t.ItemClasses[row.ItemClass] || null);
  const statId = (index) => (index === null || index === undefined ? "" : t.Stats?.[index]?.Id || "");
  /** Percent of a weapon's base damage that its implicits turn into each element. */
  const convertedShare = (row) => {
    const share = {};
    for (const modIndex of row.Implicit_Mods || []) {
      const mod = t.Mods?.[modIndex];
      if (!mod) continue;
      for (let k = 1; k <= 6; k += 1) {
        const m = statId(mod[`Stat${k}`]).match(/%_base_damage_is_(fire|cold|lightning|chaos)$/);
        if (m) share[m[1]] = (share[m[1]] || 0) + (mod[`Stat${k}Value`] || 0);
      }
    }
    return share;
  };
  const statsFor = (row) => {
    const out = {};
    const a = armour.get(row._index);
    const s = shield.get(row._index);
    const w = weapon.get(row._index);
    const r = reqs.get(row._index);
    out.requirements = { level: row.DropLevel, str: r?.ReqStr || 0, dex: r?.ReqDex || 0, int: r?.ReqInt || 0 };
    if (a) out.defences = { armour: a.Armour, evasion: a.Evasion, energy_shield: a.EnergyShield, movement_speed: a.IncreasedMovementSpeed };
    if (s) out.block = s.Block;
    if (w) {
      // The game stores the whole base damage; implicits like "50% of base damage is fire"
      // move part of it to an element, and the tooltip shows only the physical remainder.
      const share = convertedShare(row);
      const converted = Object.values(share).reduce((sum, v) => sum + v, 0);
      const keep = Math.max(0, 100 - converted) / 100;
      out.weapon = {
        physical_min: round(w.DamageMin * keep),
        physical_max: round(w.DamageMax * keep),
        base_damage_min: w.DamageMin,
        base_damage_max: w.DamageMax,
        converted_damage: Object.fromEntries(Object.entries(share).map(([el, pct]) => [el, { percent: pct, min: round(w.DamageMin * pct / 100), max: round(w.DamageMax * pct / 100) }])),
        crit_chance: round(w.CritChance / 100),
        attacks_per_second: w.Speed ? round(1000 / w.Speed) : 0,
        range: round(w.RangeMax / 10, 1),
        reload_time: w.ReloadTime ? round(w.ReloadTime / 1000) : 0
      };
    }
    return out;
  };

  const groups = new Map();
  for (const row of t.BaseItemTypes) {
    const cls = classOf(row);
    if (!row.Name || !cls || !EQUIPMENT_CLASS.test(cls.Name)) continue;
    if (/^\[?(DNT|UNUSED)\]?/i.test(row.Name)) continue;
    if (!groups.has(row.Name)) groups.set(row.Name, []);
    groups.get(row.Name).push(row);
  }

  const records = [];
  for (const [name, rows] of groups) {
    const row = pickCanonical(rows);
    const cls = classOf(row);
    const visual = row.ItemVisualIdentity === null ? null : t.ItemVisualIdentity[row.ItemVisualIdentity];
    const stats = statsFor(row);
    const record = {
      id: row.Id,
      name,
      item_class: cls.Name,
      width: row.Width,
      height: row.Height,
      drop_level: row.DropLevel,
      ...stats,
      tags: (row.Tags || []).map((i) => t.Tags[i]?.Id).filter(Boolean),
      implicit_mod_ids: (row.Implicit_Mods || []).map((i) => t.Mods?.[i]?.Id).filter(Boolean),
      icon_dds: visual?.DDSFile || "",
      icon_url: iconUrlFromDds(visual?.DDSFile),
      poe2: isPoe2Id(row.Id),
      unique_only: isUniqueOnlyBase(row.Id),
      variant_ids: rows.map((v) => v.Id).filter((id) => id !== row.Id).sort(),
      // Same-name rows with their own numbers (e.g. Runeforged Grasping Mail Verisium1-4).
      variants: rows.filter((v) => v.Id !== row.Id).map((v) => ({ id: v.Id, ...statsFor(v) }))
    };
    records.push(record);
  }
  return records.sort((a, b) => a.item_class.localeCompare(b.item_class) || a.name.localeCompare(b.name));
};

/** The property lines poe2db shows for a base, rebuilt from a game record, keyed by label. */
export const expectedLines = (record) => {
  const lines = {};
  const d = record.defences;
  if (d?.armour) lines["Armour"] = String(d.armour);
  if (d?.evasion) lines["Evasion Rating"] = String(d.evasion);
  if (d?.energy_shield) lines["Energy Shield"] = String(d.energy_shield);
  if (record.block) lines["Block chance"] = `${record.block}%`;
  const w = record.weapon;
  if (w) {
    if (w.physical_max) lines["Physical Damage"] = `${w.physical_min}-${w.physical_max}`;
    if (w.crit_chance) lines["Critical Hit Chance"] = `${w.crit_chance}%`;
    if (w.attacks_per_second) lines["Attacks per Second"] = String(w.attacks_per_second);
    if (w.range) lines["Weapon Range"] = String(w.range);
  }
  const req = record.requirements;
  const parts = [`Level ${req.level}`];
  if (req.str) parts.push(`${req.str} Str`);
  if (req.dex) parts.push(`${req.dex} Dex`);
  if (req.int) parts.push(`${req.int} Int`);
  lines["Requires"] = parts.join(", ");
  return lines;
};

const parseWebLines = (item) => {
  const lines = {};
  for (const line of [...(item.properties || []), ...(item.requirements || [])]) {
    const m = String(line).match(/^([^:]+):\s*(.+)$/);
    if (m) lines[m[1].trim()] = m[2].trim().replace(/\s+/g, " ");
  }
  return lines;
};

const sameValue = (a, b) => {
  if (a === b) return true;
  const na = Number(a.replace(/%$/, "")), nb = Number(b.replace(/%$/, ""));
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 0.011;
};

/** Compare game base records with poe2db item rows (non-unique, same name). */
export const compareWithWeb = (records, webItems) => {
  const web = new Map();
  for (const item of webItems) {
    if (String(item.rarity || "").toLowerCase() === "unique") continue;
    if (!web.has(item.name)) web.set(item.name, item);
  }
  // Bases whose name is also a unique (Golden Blade...) are listed only as uniques on poe2db.
  const uniqueNames = new Set(webItems.filter((item) => String(item.rarity || "").toLowerCase() === "unique").map((item) => item.name));
  const result = { compared: 0, identical: 0, matchedVariant: [], onlyInGame: [], fieldDiffs: {}, iconDiffs: [], examples: [] };
  const mismatches = (stats, have) => Object.entries(expectedLines(stats))
    .filter(([label, value]) => label in have && !sameValue(value, have[label])); // missing labels are not disagreements
  for (const record of records) {
    const item = web.get(record.name);
    if (!item) {
      if (!record.unique_only && !uniqueNames.has(record.name)) result.onlyInGame.push(record.name);
      continue;
    }
    result.compared += 1;
    const have = parseWebLines(item);
    let bad = mismatches(record, have);
    // poe2db sometimes shows another same-name variant (Runeforged ... Verisium2); accept it but list it.
    if (bad.length) {
      const variant = (record.variants || []).find((v) => mismatches(v, have).length === 0);
      if (variant) {
        result.matchedVariant.push(`${record.name} (${variant.id.split("/").pop()})`);
        bad = [];
      }
    }
    for (const [label, value] of bad) {
      result.fieldDiffs[label] = (result.fieldDiffs[label] || 0) + 1;
      if (result.examples.length < 25) result.examples.push(`${record.name} · ${label}: game ${value} | poe2db ${have[label]}`);
    }
    let clean = bad.length === 0;
    if (item.icon_url && record.icon_url && item.icon_url.toLowerCase() !== record.icon_url.toLowerCase()) {
      clean = false;
      result.iconDiffs.push(record.name);
    }
    if (clean) result.identical += 1;
  }
  result.onlyInGame.sort();
  return result;
};

const loadWebItems = () => {
  const sandbox = {};
  new Function("window", fs.readFileSync(ITEMS_DATA, "utf8"))(sandbox);
  return Object.values(sandbox)[0]?.items || [];
};

const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export const run = async (args) => {
  const out = path.resolve(args.get("out") || DEFAULT_OUT);
  const game = await openGame({ gameDir: args.get("game"), tables: TABLES });
  try {
    const t = Object.fromEntries(TABLES.map((name) => [name, game.table(name).rows]));
    const trailing = TABLES.map((name) => [name, game.table(name).trailingBytes]).filter(([, bytes]) => bytes);
    const records = buildBaseItems(t);
    const payload = {
      generated_at: new Date().toISOString(),
      source: "Content.ggpk",
      game_dir: game.gameDir,
      ggpk_modified_at: game.ggpkStat.mtime.toISOString(),
      data_fingerprint: game.fingerprint,
      total: records.length,
      items: records
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(payload, null, 2));

    const byClass = {};
    for (const r of records) byClass[r.item_class] = (byClass[r.item_class] || 0) + 1;
    console.log(`Base items from GGPK: ${records.length} (${records.filter((r) => r.poe2).length} PoE2 ids, ${records.filter((r) => r.unique_only).length} unique-only bases)`);
    console.log(`  by class: ${Object.entries(byClass).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    if (trailing.length) console.log(`  tables wider than the schema (unknown trailing bytes ignored): ${trailing.map(([n, b]) => `${n} +${b}`).join(", ")}`);

    const diff = compareWithWeb(records, loadWebItems());
    console.log(`\nCompared with poe2db (items-data.js): ${diff.compared} shared bases, ${diff.identical} identical`);
    if (Object.keys(diff.fieldDiffs).length) console.log(`  value differences by field: ${Object.entries(diff.fieldDiffs).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    for (const line of diff.examples) console.log(`    - ${line}`);
    if (diff.matchedVariant.length) console.log(`  poe2db shows another same-name variant (${diff.matchedVariant.length}): ${diff.matchedVariant.join(", ")}`);
    if (diff.iconDiffs.length) console.log(`  icon path differs: ${diff.iconDiffs.length} (e.g. ${diff.iconDiffs.slice(0, 5).join(", ")})`);
    if (diff.onlyInGame.length) console.log(`  only in game (${diff.onlyInGame.length}): ${diff.onlyInGame.slice(0, 20).join(", ")}${diff.onlyInGame.length > 20 ? " ..." : ""}`);
    console.log(`\nWrote ${out}`);
    return { records, diff };
  } finally {
    game.close();
  }
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run(parseCliArgs()).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

// Feasibility pilot: non-equipment items (currency, omens, essences, augments/runes,
// waystones, tablets, fragments, keys, relics) straight from the installed game's
// Content.ggpk, as a possible replacement for the poe2db crawl.
//
//   node scripts/ggpk/extract-misc-items.mjs [--game=<install dir>] [--helper=<PoevhGgpkPatcher.exe>]
//                                            [--out=data/game-extract/ggpk/misc-items.json]
//                                            [--allow-wider=Table,Table]
//
// Read-only: the helper is only called with --extract. Nothing is written to the game folder.
//
// What it does on top of reader.mjs (which is left untouched):
//   * layout guards  - every table must be exactly as wide as the schema, foreign keys must
//                      point inside their target table, and a few well-known rows ("anchors")
//                      must decode to what the game shows. Any failure aborts with a message.
//   * Mods           - the community schema describes Stat<N>Value as one i32, the game stores
//                      a (min, max) pair. reader.mjs would silently shift every later column,
//                      so Mods is decoded here with a patched layout (see patchModsSchema).
//   * effect text    - stat ids + values are turned into text with data/statdescriptions/*.csd.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_HELPER, ROOT_DIR, columnLayout, openGame, parseTable, tablePath, tableSchema } from "./reader.mjs";
import { createStatRenderer, decodeCsd, parseStatDescriptions } from "./stat-descriptions.mjs";

export const DEFAULT_OUT = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "misc-items.json");

/** Stash-tab layout tables of PoE2 leagues: a row here means the item has a slot in a live stash tab. */
export const STASH_LAYOUTS = {
  CurrencyStashTabLayout: "StoredItem",
  EssenceStashTabLayout: "StoredItem",
  FragmentStashTabLayout: "BaseItemType",
  SocketableStashTabLayout: "StoredItem",
  BreachStashTabLayout: "BaseItemType",
  DeliriumStashTabLayout: "StoredItem",
  ExpeditionStashTabLayout: "BaseItemType",
  RitualStashTabLayout: "StoredItem",
  AbyssStashTabLayout: "StoredItem"
};

export const TABLES = [
  "BaseItemTypes", "ItemClasses", "CurrencyItems", "ItemVisualIdentity", "FlavourText", "Tags", "Stats",
  "Essences", "EssenceMods", "EssenceTargetItemCategories",
  "SoulCores", "SoulCoreStats", "SoulCoreStatCategories", "SoulCoreTypes", "SoulCoreLimits", "ClientStrings2",
  "EndgameMapTablets", "MapFragmentMods", "LiquidEmotionOutcomes", "CurrencyExchange", "CurrencyExchangeCategories",
  ...Object.keys(STASH_LAYOUTS)
];

export const STAT_DESCRIPTION_FILES = [
  "data/statdescriptions/stat_descriptions.csd",
  "data/statdescriptions/map_stat_descriptions.csd",
  "data/statdescriptions/tablet_stat_descriptions.csd"
];

/**
 * ItemClasses.Id -> site category. `evidence: true` marks classes that still hold PoE1
 * leftovers (Orb of Alteration, scarabs, Sacrifice at Dusk...): a row of such a class is
 * kept only when the game references it from the currency exchange or a PoE2 stash layout.
 */
export const CLASS_RULES = {
  StackableCurrency: { category: "currency", evidence: true },
  SoulCore: { category: "augment" },
  Omen: { category: "omen" },
  Map: { category: "waystone" },
  TowerAugmentation: { category: "tablet" },
  MapFragment: { category: "fragment", evidence: true },
  AtlasCurrency: { category: "fragment", evidence: true },
  Breachstone: { category: "fragment", evidence: true },
  MiscMapItem: { category: "fragment", evidence: true },
  VaultKey: { category: "key", evidence: true },
  PinnacleKeyStackable: { category: "key" },
  UltimatumKey: { category: "key" },
  ItemisedSanctum: { category: "key" },
  Expedition2Logbooks: { category: "key" },
  Relic: { category: "relic" },
  IncubatorStackable: { category: "currency", evidence: true },
  UncutSkillGemStackable: { category: "uncut-gem" },
  UncutReservationGemStackable: { category: "uncut-gem" },
  UncutSupportGemStackable: { category: "uncut-gem" }
};

/** Developer placeholders: "[DNT] ...", "[DNT-UNUSED] ...", "[UNUSED] ...", "... (not visible to players)". */
export const isPlaceholderName = (name) => /\[(DNT|UNUSED)[^\]]*\]|not visible to players/i.test(String(name || "")) || /^UNUSED\b/.test(String(name || ""));

/**
 * Game text markup -> plain display text.
 *   [Corrupted|Corrupts] -> Corrupts      [Rune] -> Rune
 *   <size:28>{text} / <default>{text}     -> text      <<HBG01>> (glyph font codes) -> removed
 */
export const decodeMarkup = (text) => String(text ?? "")
  .replace(/<<[^>]*>>/g, "")
  .replace(/<[a-z_]+(?::[^>]*)?>\{([^{}]*)\}/gi, "$1")
  .replace(/<[a-z_]+(?::[^>]*)?>/gi, "")
  .replace(/\[([^\[\]|]*)\|([^\[\]]*)\]/g, "$2")
  .replace(/\[([^\[\]|]*)\]/g, "$1")
  .replace(/\r\n?/g, "\n")
  .replace(/[ \t]+\n/g, "\n")
  .trim();

/**
 * Why a BaseItemTypes row is left out, or "" when it is kept. Pure: `cls` is the
 * ItemClasses row, `evidence` the list of game tables that reference the row.
 */
export const rejectReason = (row, cls, evidence = []) => {
  const rule = cls ? CLASS_RULES[cls.Id] : null;
  if (!rule) return "class-out-of-scope";
  if (!String(row.Name || "").trim()) return "no-name";
  if (isPlaceholderName(row.Name)) return "placeholder-name";
  if (rule.evidence && !evidence.length) return "no-release-evidence";
  return "";
};

// ---------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------

/** Schema row width in bytes. */
export const schemaWidth = (table) => columnLayout(table).reduce((sum, column) => sum + column.width, 0);

/**
 * Community schema -> real Mods layout. Each Stat<N>Value is a (min, max) pair in the file;
 * the schema has a single i32, which makes the row 32 bytes too short and shifts every
 * column after Stat1Value. PoB's spec.lua (type "Interval") agrees with the pair reading.
 */
export const patchModsSchema = (table) => ({
  ...table,
  columns: table.columns.flatMap((column) => (/^Stat\dValue$/.test(column.name || "") && column.type === "i32" && !column.array
    ? [{ ...column, name: column.name.replace("Value", "Min") }, { ...column, name: column.name.replace("Value", "Max") }]
    : [column]))
});

/**
 * Row-size check. `tables` = [{ name, rowCount, rowWidth, expectedWidth }]. A table wider
 * than its schema has columns the schema does not know; whether they were appended (safe)
 * or inserted (every later column shifts) cannot be told from the width, so it is an error
 * unless the table is named in `allowWider`.
 */
export const checkRowWidths = (tables, allowWider = []) => {
  const allowed = new Set(allowWider.map((name) => name.toLowerCase()));
  const problems = [];
  for (const t of tables) {
    if (!t.rowCount) { problems.push(`${t.name}: table is empty`); continue; }
    if (!Number.isInteger(t.rowWidth)) problems.push(`${t.name}: row width ${t.rowWidth} is not a whole number of bytes (row count or data marker misread)`);
    else if (t.rowWidth < t.expectedWidth) problems.push(`${t.name}: row is ${t.expectedWidth - t.rowWidth} bytes narrower than the schema (${t.rowWidth} < ${t.expectedWidth})`);
    else if (t.rowWidth > t.expectedWidth && !allowed.has(t.name.toLowerCase())) {
      problems.push(`${t.name}: row is ${t.rowWidth - t.expectedWidth} bytes wider than the schema (${t.rowWidth} > ${t.expectedWidth}); new columns may sit in the middle and shift the values read after them`);
    }
  }
  if (problems.length) {
    throw new Error(`GGPK layout guard: the game tables do not match the schema.\n  - ${problems.join("\n  - ")}\nUpdate apps/poevh-desktop/tools/vi-localization/schema/schema.min.json (or pass --allow-wider=<Table> after checking the new columns are at the end).`);
  }
};

/**
 * Foreign keys must point inside their target table. A shifted column almost always turns
 * row indexes into garbage, so this catches layout changes that keep the row width.
 * `parsed` maps table name -> { layout, rows, rowCount }.
 */
export const checkForeignKeys = (parsed) => {
  const sizes = new Map(Object.entries(parsed).map(([name, t]) => [name.toLowerCase(), t.rowCount]));
  const problems = [];
  for (const [name, t] of Object.entries(parsed)) {
    for (const column of t.layout) {
      if (column.type !== "foreignrow" && column.type !== "row") continue;
      const target = column.type === "row" && !column.references ? name : column.references;
      const size = sizes.get(String(target).toLowerCase());
      if (size === undefined) continue; // target table not loaded
      let bad = 0;
      let sample = null;
      for (const row of t.rows) {
        const values = column.array ? row[column.name] : [row[column.name]];
        for (const value of values) {
          if (value === null || value === undefined) continue;
          if (!Number.isInteger(value) || value < 0 || value >= size) { bad += 1; sample ??= value; }
        }
      }
      if (bad) problems.push(`${name}.${column.name} -> ${target}: ${bad} value(s) outside 0..${size - 1} (e.g. ${sample})`);
    }
  }
  if (problems.length) throw new Error(`GGPK layout guard: foreign keys point outside their table, the column layout has shifted.\n  - ${problems.join("\n  - ")}`);
};

/**
 * Sanity anchors: rows every player knows. They fail when a column moved but widths and
 * keys still look fine (e.g. two i32 columns swapped). Values that balance patches change
 * are checked loosely.
 */
export const ANCHORS = [
  { name: "Vaal Orb", check: (r) => r.item_class === "Stackable Currency" && r.stack_size === 20 && /corrupt/i.test(r.description) && /CurrencyVaal\.dds$/i.test(r.icon_dds), expect: "class Stackable Currency, stack size 20, description mentioning Corrupt, icon .../CurrencyVaal.dds" },
  { name: "Chaos Orb", check: (r) => r.stack_size === 20 && /modifier/i.test(r.description) && /right click/i.test(r.directions), expect: "stack size 20, description mentioning modifier, directions starting with Right click" },
  { name: "Omen of Whittling", check: (r) => r.item_class === "Omen" && r.stack_size === 10 && /Chaos Orb/.test(r.description), expect: "class Omen, stack size 10, description mentioning Chaos Orb" },
  { name: "Desert Rune", check: (r) => r.category === "augment" && r.effect_lines.some((line) => /Adds \d+ to \d+ Fire Damage/.test(line)), expect: "an augment with a line 'Adds N to N Fire Damage'" },
  { name: "Essence of the Body", check: (r) => r.effect_lines.some((line) => /maximum Life/i.test(line)), expect: "an essence with a 'maximum Life' modifier line" },
  { name: "Breach Tablet", check: (r) => r.category === "tablet" && r.effect_lines.some((line) => /Breach/.test(line)), expect: "a tablet whose implicit mentions Breach" },
  { name: "Waystone (Tier 1)", check: (r) => r.category === "waystone" && /\.dds$/i.test(r.icon_dds), expect: "class Waystones with an icon" }
];

export const checkAnchors = (records, anchors = ANCHORS) => {
  const byName = new Map();
  for (const record of records) if (!byName.has(record.name)) byName.set(record.name, record);
  const problems = [];
  for (const anchor of anchors) {
    const record = byName.get(anchor.name);
    if (!record) problems.push(`"${anchor.name}" not found (expected ${anchor.expect})`);
    else if (!anchor.check(record)) {
      problems.push(`"${anchor.name}" decoded wrong: expected ${anchor.expect}; got ${JSON.stringify({ item_class: record.item_class, stack_size: record.stack_size, description: record.description, directions: record.directions, icon_dds: record.icon_dds, effect_lines: record.effect_lines.slice(0, 3) })}`);
    }
  }
  if (problems.length) throw new Error(`GGPK sanity anchors failed: the data decoded but does not look like the game.\n  - ${problems.join("\n  - ")}\nA column probably moved inside a table; compare the schema with the game version before trusting this extract.`);
};

/** Mods anchor: a (min, max) pair must have min <= max and unused stat slots must be empty. */
export const checkModsAnchor = (mods, stats) => {
  const row = mods.find((mod) => mod.Id === "Strength1");
  const stat = row && row.Stat1 !== null ? stats[row.Stat1]?.Id : "";
  if (!row || !/strength/.test(stat || "") || !(row.Stat1Min > 0 && row.Stat1Min <= row.Stat1Max && row.Stat1Max < 1000) || row.Stat2 !== null || row.Stat5 !== null) {
    throw new Error(`GGPK sanity anchors failed: Mods row "Strength1" should be one strength stat with a small (min, max) pair and no other stats; got ${JSON.stringify(row && { Stat1: stat, Stat1Min: row.Stat1Min, Stat1Max: row.Stat1Max, Stat2: row.Stat2, Stat5: row.Stat5 })}. The patched Mods layout (patchModsSchema) no longer fits this game version.`);
  }
};

// ---------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------

const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows || []) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
};

/** Stat ids + [min, max] values of a Mods row decoded with the patched layout. */
export const modStats = (mod, stats) => {
  const ids = [];
  const values = [];
  for (let k = 1; k <= 6; k += 1) {
    const index = mod[`Stat${k}`];
    if (index === null || index === undefined) continue;
    ids.push(stats[index]?.Id || `stat#${index}`);
    values.push([mod[`Stat${k}Min`], mod[`Stat${k}Max`]]);
  }
  return { ids, values };
};

/**
 * Build the item records. `t` maps table name -> rows (Mods decoded with patchModsSchema),
 * `renderer` is a stat renderer (createStatRenderer) or null to keep stat ids only.
 * Returns { records, rejected: { reason: count }, rejectedItems: [named rows left out],
 * unresolvedStats: [ids] }.
 */
export const buildMiscItems = (t, renderer = null) => {
  const stats = t.Stats || [];
  const unresolved = new Set();
  const render = (ids, values) => {
    if (!renderer) return ids.map((id, i) => `${id} = ${[values[i]].flat().join("..")}`);
    const out = renderer.render(ids, values);
    for (const id of out.missing) unresolved.add(id);
    return out.lines.map(decodeMarkup);
  };
  const modLines = (index) => {
    const mod = t.Mods?.[index];
    if (!mod) return [];
    const { ids, values } = modStats(mod, stats);
    return render(ids, values);
  };

  const currency = new Map((t.CurrencyItems || []).map((row) => [row.BaseItemType, row]));
  const evidence = new Map();
  const addEvidence = (index, source) => {
    if (index === null || index === undefined) return;
    if (!evidence.has(index)) evidence.set(index, []);
    if (!evidence.get(index).includes(source)) evidence.get(index).push(source);
  };
  const exchange = new Map();
  for (const row of t.CurrencyExchange || []) {
    addEvidence(row.Item, "CurrencyExchange");
    exchange.set(row.Item, {
      category: t.CurrencyExchangeCategories?.[row.Category]?.Name || "",
      subcategory: t.CurrencyExchangeCategories?.[row.SubCategory]?.Name || "",
      challenge_league: Boolean(row.EnabledInChallengeLeague)
    });
  }
  for (const [table, column] of Object.entries(STASH_LAYOUTS)) for (const row of t[table] || []) addEvidence(row[column], table);
  for (const row of t.CurrencyItems || []) if (row.IsGold) addEvidence(row.BaseItemType, "CurrencyItems.IsGold");

  const essenceByBase = new Map((t.Essences || []).map((row) => [row.BaseItemType, row]));
  const essenceMods = groupBy(t.EssenceMods, "Essence");
  const soulCoreByBase = new Map((t.SoulCores || []).map((row) => [row.BaseItemType, row]));
  const soulCoreStats = groupBy(t.SoulCoreStats, "SoulCore");
  const fragmentMods = groupBy(t.MapFragmentMods, "BaseItemType");
  const tabletByBase = new Map((t.EndgameMapTablets || []).map((row) => [row.BaseItemType, row]));
  const emotionOutcomes = groupBy(t.LiquidEmotionOutcomes, "BaseItemType");

  const effectLines = (row) => {
    const lines = [];
    const essence = essenceByBase.get(row._index);
    if (essence) {
      for (const em of essenceMods.get(essence._index) || []) {
        const target = decodeMarkup(t.EssenceTargetItemCategories?.[em.TargetItemCategory]?.Text || "");
        const shown = em.DisplayMod ?? em.Mod;
        const text = em.Text ? [decodeMarkup(em.Text)] : shown !== null && shown !== undefined ? modLines(shown) : [];
        if (text.length) lines.push(`${target ? `${target}: ` : ""}${text.join("\n")}`);
      }
    }
    const core = soulCoreByBase.get(row._index);
    if (core) {
      for (const entry of soulCoreStats.get(core._index) || []) {
        const category = t.SoulCoreStatCategories?.[entry.StatCategory];
        // Categories without a display string are a list of item classes (shown by class name).
        const classNames = (category?.TargetItemClasses || []).map((i) => t.ItemClasses[i]?.Name).filter(Boolean);
        const label = decodeMarkup(category?.Display || classNames.join(", ") || category?.Id || "");
        const main = render(entry.Stats.map((i) => stats[i]?.Id || `stat#${i}`), entry.StatsValues);
        if (main.length) lines.push(`${label}: ${main.join("\n")}`);
        const bonded = render((entry.BondedStats || []).map((i) => stats[i]?.Id || `stat#${i}`), entry.BondedStatsValues || []);
        if (bonded.length) lines.push(`${label} (Bonded): ${bonded.join("\n")}`);
      }
      for (const key of ["Description", "ExtraDescription"]) {
        const text = core[key] === null || core[key] === undefined ? "" : decodeMarkup(t.ClientStrings2?.[core[key]]?.Text || "");
        if (text) lines.push(text);
      }
    }
    for (const outcome of emotionOutcomes.get(row._index) || []) {
      for (const gem of ["Ruby", "Sapphire", "Emerald", "Diamond"]) {
        for (const affix of ["Prefix", "Suffix"]) {
          const index = outcome[`${gem}${affix}`];
          if (index === null || index === undefined) continue;
          const text = modLines(index);
          // RadiusJewel is kept in the label: its meaning (which jewel kind) is not confirmed.
          if (text.length) lines.push(`${gem} ${affix}${outcome.RadiusJewel ? ` (RadiusJewel ${outcome.RadiusJewel})` : ""}: ${text.join("\n")}`);
        }
      }
    }
    for (const index of row.Implicit_Mods || []) lines.push(...modLines(index));
    for (const fm of fragmentMods.get(row._index) || []) for (const index of fm.Mods || []) lines.push(...modLines(index));
    // The same mod can be both an implicit and a MapFragmentMods entry (reliquary keys).
    return [...new Set(lines)];
  };

  const rejected = {};
  const rejectedItems = [];
  const records = [];
  for (const row of t.BaseItemTypes) {
    const cls = row.ItemClass === null ? null : t.ItemClasses[row.ItemClass];
    const proof = evidence.get(row._index) || [];
    const reason = rejectReason(row, cls, proof);
    if (reason) {
      rejected[reason] = (rejected[reason] || 0) + 1;
      if (row.Name) rejectedItems.push({ id: row.Id, name: row.Name, item_class: cls ? cls.Name || cls.Id : "", reason });
      continue;
    }
    const rule = CLASS_RULES[cls.Id];
    const ci = currency.get(row._index);
    const core = soulCoreByBase.get(row._index);
    const essence = essenceByBase.get(row._index);
    const tablet = tabletByBase.get(row._index);
    const visual = row.ItemVisualIdentity === null ? null : t.ItemVisualIdentity[row.ItemVisualIdentity];
    const limit = core && core.Limit !== null && core.Limit !== undefined ? t.SoulCoreLimits?.[core.Limit] : null;
    records.push({
      id: row.Id,
      name: row.Name,
      item_class: cls.Name || cls.Id,
      item_class_id: cls.Id,
      category: essence ? "essence" : rule.category,
      stack_size: ci ? ci.StackSize : null,
      stash_stack_size: ci ? ci.CurrencyTab_StackSize : null,
      description: decodeMarkup(ci?.Description),
      directions: decodeMarkup(ci?.Directions),
      flavour_text: row.FlavourText === null || row.FlavourText === undefined ? "" : decodeMarkup(t.FlavourText?.[row.FlavourText]?.Text),
      drop_level: row.DropLevel,
      required_level: core ? core.RequiredLevel : null,
      limit: limit ? limit.Limit : null,
      augment_type: core && core.Type !== null ? decodeMarkup(t.SoulCoreTypes?.[core.Type]?.Name) : "",
      socket_bound: core ? Boolean(core.IsSocketBound) : null,
      essence_tier: essence ? { perfect: Boolean(essence.Perfect), tier: essence.Tier } : null,
      tablet_stats: tablet ? (tablet.MapStats || []).map((i) => stats[i]?.Id).filter(Boolean) : [],
      effect_lines: effectLines(row),
      tags: (row.Tags || []).map((i) => t.Tags?.[i]?.Id).filter(Boolean),
      icon_dds: visual?.DDSFile || "",
      release_evidence: proof,
      exchange: exchange.get(row._index) || null
    });
  }
  records.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { records, rejected, rejectedItems, unresolvedStats: [...unresolved].sort() };
};

// ---------------------------------------------------------------------------------------
// Game access
// ---------------------------------------------------------------------------------------

/** Read-only: pull raw bundle files out of Content.ggpk. Returns Map(path -> Buffer). */
export const extractFiles = (ggpk, paths, helper = DEFAULT_HELPER) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "poevh-ggpk-misc-"));
  try {
    let result;
    try {
      result = JSON.parse(execFileSync(helper, ["--extract", ggpk, paths.join(","), workDir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    } catch (error) {
      if (!error.stdout) throw error;
      result = JSON.parse(error.stdout); // the helper exits non-zero when a path is missing
    }
    const missing = result.alreadyPatchedAssets || [];
    if (missing.length) throw new Error(`Not in the game bundles: ${missing.join(", ")}`);
    if (!result.ok) throw new Error(result.error || result.message || "GGPK extract failed");
    return new Map(paths.map((p) => [p, fs.readFileSync(path.join(workDir, p.replace(/[\\/]/g, "_")))]));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};

const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

/** Load every table, run the guards and build the records. */
export const loadGame = async ({ gameDir, helper = DEFAULT_HELPER, allowWider = [] } = {}) => {
  const game = await openGame({ gameDir, helper, tables: TABLES });
  try {
    const parsed = Object.fromEntries(TABLES.map((name) => [name, game.table(name)]));
    const modsPath = tablePath("Mods");
    const raw = extractFiles(game.ggpk, [modsPath, ...STAT_DESCRIPTION_FILES], helper);
    const modsSchema = patchModsSchema(tableSchema("Mods"));
    parsed.Mods = parseTable(raw.get(modsPath), modsSchema);

    checkRowWidths(Object.entries(parsed).map(([name, table]) => ({
      name,
      rowCount: table.rowCount,
      rowWidth: table.rowWidth,
      expectedWidth: schemaWidth(name === "Mods" ? modsSchema : tableSchema(name))
    })), allowWider);
    checkForeignKeys(parsed);

    const t = Object.fromEntries(Object.entries(parsed).map(([name, table]) => [name, table.rows]));
    checkModsAnchor(t.Mods, t.Stats);
    const renderer = createStatRenderer(STAT_DESCRIPTION_FILES.map((file) => parseStatDescriptions(decodeCsd(raw.get(file)))));
    const built = buildMiscItems(t, renderer);
    checkAnchors(built.records);

    const hash = crypto.createHash("sha256").update(game.fingerprint);
    for (const buffer of raw.values()) hash.update(buffer);
    return {
      ...built,
      unknownHandlers: [...renderer.unknownHandlers].sort(),
      meta: {
        game_dir: game.gameDir,
        ggpk_size: game.ggpkStat.size,
        ggpk_modified_at: game.ggpkStat.mtime.toISOString(),
        // sha256 over the extracted tables + stat description files (first 16 hex chars)
        data_fingerprint: hash.digest("hex").slice(0, 16),
        tables_fingerprint: game.fingerprint,
        table_rows: Object.fromEntries(Object.entries(parsed).map(([name, table]) => [name, { rows: table.rowCount, row_width: table.rowWidth }])),
        base_item_rows: t.BaseItemTypes.length
      }
    };
  } finally {
    game.close();
  }
};

export const run = async (args) => {
  const started = Date.now();
  const out = path.resolve(args.get("out") || DEFAULT_OUT);
  const loaded = await loadGame({
    gameDir: args.get("game"),
    helper: args.get("helper") || DEFAULT_HELPER,
    allowWider: (args.get("allow-wider") || "").split(",").filter(Boolean)
  });
  const { records, rejected, rejectedItems, unresolvedStats, unknownHandlers, meta } = loaded;
  const count = (key) => {
    const map = {};
    for (const record of records) map[record[key]] = (map[record[key]] || 0) + 1;
    return map;
  };
  const payload = {
    generated_at: new Date().toISOString(),
    source: "Content.ggpk",
    ...meta,
    filter: {
      kept: records.length,
      rejected,
      rule: "ItemClasses.Id in CLASS_RULES; Name not empty; Name not a [DNT]/[UNUSED] placeholder; classes that still hold PoE1 rows need a reference from CurrencyExchange or a PoE2 stash-tab layout"
    },
    by_category: count("category"),
    by_class: count("item_class"),
    unresolved_stats: unresolvedStats,
    unknown_stat_handlers: unknownHandlers,
    total: records.length,
    items: records
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  // Named rows that were left out, with the reason; the comparison uses it to explain site-only names.
  const rejectedOut = `${out.replace(/\.json$/i, "")}-rejected.json`;
  fs.writeFileSync(rejectedOut, JSON.stringify({ generated_at: payload.generated_at, data_fingerprint: meta.data_fingerprint, total: rejectedItems.length, items: rejectedItems }));

  const list = (map) => Object.entries(map).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`Misc items from GGPK: ${records.length} of ${meta.base_item_rows} BaseItemTypes rows (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log(`  fingerprint ${meta.data_fingerprint}, Content.ggpk ${meta.ggpk_size} bytes, modified ${meta.ggpk_modified_at}`);
  console.log(`  by category: ${list(payload.by_category)}`);
  console.log(`  by class: ${list(payload.by_class)}`);
  console.log(`  rejected: ${list(rejected)}`);
  console.log(`  guards passed: row widths (${Object.keys(meta.table_rows).length} tables), foreign keys, ${ANCHORS.length + 1} anchors`);
  if (unresolvedStats.length) console.log(`  stats without a description (${unresolvedStats.length}): ${unresolvedStats.slice(0, 8).join(", ")}${unresolvedStats.length > 8 ? " ..." : ""}`);
  if (unknownHandlers.length) console.log(`  unknown value handlers: ${unknownHandlers.join(", ")}`);
  console.log(`\nWrote ${out}`);
  return payload;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run(parseCliArgs()).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

// Extract skill / support / meta gems straight from the installed game's Content.ggpk,
// then compare them with the poe2db crawl in public/data/skill-gems-data.js.
//
//   node scripts/ggpk/extract-gems.mjs [--game="D:\Grinding Gear Games\Path of Exile 2"]
//                                      [--out=data/game-extract/ggpk/gems.json] [--show=20]
//
// Tables: BaseItemTypes -> ItemClasses (which rows are gems), SkillGems (colour, tier,
// GemEffects), GemEffects (tags, support text, GrantedEffect), GemTags, GrantedEffects
// (cast time, cost types, stat sets, ActiveSkill), ActiveSkills (display name, description),
// GrantedEffectsPerLevel (cost / cooldown / spirit per level), GrantedEffectStatSets and
// GrantedEffectStatSetsPerLevel (stat ids + values per level), Stats, CostTypes.
//
// Stat lines are kept as stat ids + values; turning them into text needs stat_descriptions
// and is a later step. Writes gems.json and gems-compare.json next to each other.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IGNORED_GEM_NAME, normalizeName, parseCliArgs } from "../check-game-data.mjs";
import { ROOT_DIR, openGame } from "./reader.mjs";

export const DEFAULT_OUT = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "gems.json");
export const WEB_GEMS_PATH = path.join(ROOT_DIR, "public", "data", "skill-gems-data.js");

export const TABLES = [
  "BaseItemTypes", "ItemClasses", "SkillGems", "GemEffects", "GemTags", "ActiveSkills",
  "GrantedEffects", "GrantedEffectsPerLevel", "GrantedEffectStatSets", "GrantedEffectStatSetsPerLevel",
  "Stats", "CostTypes"
];

/** ItemClasses.Id -> gem kind. Meta gems (Cast on X, Blasphemy...) have an empty class Name. */
export const GEM_CLASS_KIND = {
  "Active Skill Gem": "active",
  "Support Skill Gem": "support",
  "Meta Skill Gem": "meta"
};
/** SkillGems.GemColour -> the colour words the web data uses (4 = white / item-granted). */
export const GEM_COLOUR = { 1: "red", 2: "green", 3: "blue", 4: "item" };
/** Developer markers in names / descriptions: these gems are not obtainable. */
export const DNT_MARK = /\[DNT\b|\bDNT-UNUSED\b/i;
/** Unreleased slots the game ships as "Coming Soon" gems. */
export const PLACEHOLDER_GEM_NAME = /^Coming Soon$/i;
/** Gems poe2db marks [DNT-UNUSED] although the game text carries no marker. */
export const UNUSED_PER_POE2DB = new Set(["kinetic bash", "styrn's anthem"]);

/** "[AoESkill|AoE]" -> "AoE", "[Fire]" -> "Fire": strip the game's keyword markup. */
export const plainText = (value) => String(value || "")
  .replace(/\[([^\]|]*)\|([^\]]*)\]/g, "$2")
  .replace(/\[([^\]]*)\]/g, "$1")
  .replace(/\s+/g, " ")
  .trim();

const pairs = (keys, values, statId) => {
  const out = {};
  keys.forEach((key, i) => {
    const id = statId(key);
    if (id) out[id] = values[i] ?? null;
  });
  return out;
};

const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
};

/**
 * Build the gem list from decoded tables.
 * `db.rows(name)` returns a table's rows, `db.ref(name, index)` one row (or null).
 */
export const extractGems = (db) => {
  const statId = (index) => db.ref("Stats", index)?.Id || null;
  const levelsByEffect = groupBy(db.rows("GrantedEffectsPerLevel"), "GrantedEffect");
  const levelsByStatSet = groupBy(db.rows("GrantedEffectStatSetsPerLevel"), "StatSet");
  const skillGemByBase = new Map(db.rows("SkillGems").map((row) => [row.BaseItemType, row]));
  const costTypes = {};

  const statSet = (index) => {
    const set = db.ref("GrantedEffectStatSets", index);
    if (!set) return null;
    const levels = (levelsByStatSet.get(index) || [])
      .slice()
      .sort((a, b) => a.GemLevel - b.GemLevel)
      .map((row) => {
        const stats = {
          ...pairs(row.FloatStats || [], row.BaseResolvedValues || [], statId),
          ...pairs(row.AdditionalStats || [], row.AdditionalStatsValues || [], statId)
        };
        for (const flag of row.AdditionalFlags || []) {
          const id = statId(flag);
          if (id) stats[id] = 1;
        }
        const level = { level: row.GemLevel, stats };
        if (row.SpellCritChance) level.spell_crit_chance = row.SpellCritChance;
        if (row.AttackCritChance) level.attack_crit_chance = row.AttackCritChance;
        if (row.FloatStats?.length) level.float_stats = pairs(row.FloatStats, row.FloatStatsValues || [], statId);
        return level;
      });
    return {
      id: set.Id,
      constant_stats: pairs(set.ConstantStats || [], set.ConstantStatsValues || [], statId),
      implicit_stats: (set.ImplicitStats || []).map(statId).filter(Boolean),
      base_effectiveness: set.BaseEffectiveness,
      incremental_effectiveness: set.IncrementalEffectiveness,
      levels
    };
  };

  const grantedEffect = (index, primary) => {
    const effect = db.ref("GrantedEffects", index);
    if (!effect) return null;
    const costs = (effect.CostTypes || []).map((i) => db.ref("CostTypes", i)).filter(Boolean);
    for (const cost of costs) {
      costTypes[cost.Id] ||= { stat: statId(cost.Stat), format: cost.FormatText, divisor: cost.Divisor, per_minute: cost.PerMinute };
    }
    const active = db.ref("ActiveSkills", effect.ActiveSkill);
    const levels = (levelsByEffect.get(index) || [])
      .slice()
      .sort((a, b) => a.Level - b.Level)
      .map((row) => {
        const level = { level: row.Level };
        const cost = {};
        costs.forEach((type, i) => {
          if (row.CostAmounts?.[i] !== undefined) cost[type.Id] = row.CostAmounts[i];
        });
        if (Object.keys(cost).length) level.cost = cost;
        if (row.CostMultiplier && row.CostMultiplier !== 100) level.cost_multiplier = row.CostMultiplier;
        if (row.Cooldown) level.cooldown_ms = row.Cooldown;
        if (row.StoredUses) level.stored_uses = row.StoredUses;
        if (row.Reservation) level.spirit = row.Reservation;
        if (row.AttackSpeedMultiplier) level.attack_speed_multiplier = row.AttackSpeedMultiplier;
        if (row.AttackTime) level.attack_time_ms = row.AttackTime;
        return level;
      });
    return {
      id: effect.Id,
      primary,
      is_support: Boolean(effect.IsSupport),
      cast_time_ms: effect.CastTime || 0,
      active_skill: active ? {
        id: active.Id,
        name: plainText(active.DisplayedName),
        description: plainText(active.Description),
        description_markup: active.Description || ""
      } : null,
      cost_types: costs.map((cost) => cost.Id),
      levels,
      stat_sets: [effect.StatSet, ...(effect.AdditionalStatSets || [])]
        .filter((i) => i !== null && i !== undefined)
        .map(statSet)
        .filter(Boolean)
    };
  };

  const gems = [];
  for (const base of db.rows("BaseItemTypes")) {
    const itemClass = db.ref("ItemClasses", base.ItemClass);
    const kind = itemClass && GEM_CLASS_KIND[itemClass.Id];
    if (!kind) continue;
    const skillGem = skillGemByBase.get(base._index);
    if (!skillGem) continue;
    const gemEffects = (skillGem.GemEffects || []).map((i) => db.ref("GemEffects", i)).filter(Boolean);
    const gemEffect = gemEffects[0] || null;
    const tags = (gemEffect?.GemTags || []).map((i) => db.ref("GemTags", i)).filter(Boolean);
    const effects = gemEffects.flatMap((ge, n) => [
      grantedEffect(ge.GrantedEffect, n === 0),
      ...(ge.AdditionalGrantedEffects || []).map((i) => grantedEffect(i, false))
    ]).filter(Boolean);
    const main = effects[0] || null;
    const name = base.Name || "";
    const supportText = plainText(gemEffect?.SupportText);

    // Markers are checked on the raw text: plainText turns "[DNT] ..." into "DNT ...".
    // ActiveSkills.DisplayedName alone is not used: Shroud's reads "[DNT-UNUSED] Shroud"
    // while the gem name and description are clean and poe2db lists it.
    let excluded = "";
    if (IGNORED_GEM_NAME.test(name)) excluded = "ignored-name";
    else if (PLACEHOLDER_GEM_NAME.test(name)) excluded = "placeholder";
    else if ([name, main?.active_skill?.description_markup, gemEffect?.SupportText].some((text) => DNT_MARK.test(text || ""))) excluded = "dnt";
    else if (UNUSED_PER_POE2DB.has(normalizeName(name))) excluded = "unused-per-poe2db";

    const levelCount = Math.max(0, ...effects.filter((e) => e.primary).map((e) => e.levels.length));
    gems.push({
      id: base.Id,
      name,
      gem_type: kind === "support" ? "support" : "skill",
      gem_kind: kind,
      color: GEM_COLOUR[skillGem.GemColour] || null,
      gem_colour: skillGem.GemColour,
      requirement_percent: {
        str: skillGem.StrengthRequirementPercent,
        dex: skillGem.DexterityRequirementPercent,
        int: skillGem.IntelligenceRequirementPercent
      },
      // SkillGems.CraftingLevel is the uncut-gem tier shown in game (matches poe2db's tier
      // for skills); SkillGems.Tier is kept raw (0-3, only set on supports).
      tier: skillGem.CraftingLevel || null,
      tier_column: skillGem.Tier,
      min_level_requirement: skillGem.MinLevelReq,
      tags: tags.map((tag) => plainText(tag.Name)).filter(Boolean),
      tag_ids: tags.map((tag) => tag.Id),
      gem_effect_id: gemEffect?.Id || "",
      support_name: plainText(gemEffect?.SupportName),
      support_text: supportText,
      support_text_markup: gemEffect?.SupportText || "",
      active_skill: main?.active_skill || null,
      cast_time_ms: main?.cast_time_ms || 0,
      max_level: levelCount,
      spirit: main?.levels.find((level) => level.spirit)?.spirit || 0,
      ...(excluded ? { excluded } : {}),
      effects
    });
  }
  gems.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { gems, costTypes };
};

/** Read window.POE2_SKILL_GEMS from the web bundle. */
export const loadWebGems = (filePath = WEB_GEMS_PATH) => {
  const sandbox = {};
  new Function("window", fs.readFileSync(filePath, "utf8"))(sandbox);
  const bundle = sandbox.POE2_SKILL_GEMS;
  if (!bundle?.gems) throw new Error(`${filePath}: window.POE2_SKILL_GEMS.gems missing`);
  return bundle.gems;
};

const tagKey = (tag) => normalizeName(tag);

/**
 * Compare game gems with web gems. Matching uses official_id first, then name.
 * Returns only-in-game / only-in-web lists and per-gem disagreements.
 */
export const compareGems = (gameGems, webGems) => {
  const real = gameGems.filter((gem) => !gem.excluded);
  const byId = new Map(gameGems.map((gem) => [gem.id, gem]));
  const byName = new Map();
  for (const gem of real) {
    const key = normalizeName(gem.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(gem);
  }
  // Same name twice (e.g. Ember Fusillade + the unique-item-granted copy): prefer the gem.
  for (const list of byName.values()) list.sort((a, b) => /Unique/.test(a.id) - /Unique/.test(b.id));
  const excludedByName = new Map(gameGems.filter((gem) => gem.excluded).map((gem) => [normalizeName(gem.name), gem]));

  const matchedGame = new Set();
  const pairsOut = [];
  const onlyInWeb = [];
  const webExcluded = [];
  const staleIds = [];
  const idMismatch = [];
  let matchedById = 0;
  let matchedByName = 0;

  for (const web of webGems) {
    const key = normalizeName(web.name);
    let game = web.official_id ? byId.get(web.official_id) : null;
    if (game && game.excluded) {
      webExcluded.push({ name: web.name, official_id: web.official_id, reason: game.excluded });
      continue;
    }
    if (game) matchedById += 1;
    if (!game) {
      const candidates = byName.get(key) || [];
      game = candidates[0] || null;
      if (game) {
        matchedByName += 1;
        if (web.official_id) staleIds.push({ name: web.name, web_id: web.official_id, game_ids: candidates.map((g) => g.id) });
      }
    } else if (normalizeName(game.name) !== key) {
      idMismatch.push({ official_id: web.official_id, web_name: web.name, game_name: game.name });
    }
    if (!game) {
      const excluded = excludedByName.get(key);
      if (excluded) webExcluded.push({ name: web.name, official_id: web.official_id || "", reason: excluded.excluded });
      else onlyInWeb.push({ name: web.name, official_id: web.official_id || "", gem_type: web.gem_type });
      continue;
    }
    matchedGame.add(game.id);
    pairsOut.push({ web, game });
  }

  // A game gem counts as "in web" when any gem with its name was matched (Gem/ and Gems/ twins).
  const matchedNames = new Set(gameGems.filter((gem) => matchedGame.has(gem.id)).map((gem) => normalizeName(gem.name)));
  const onlyInGame = real
    .filter((gem) => !matchedGame.has(gem.id) && !matchedNames.has(normalizeName(gem.name)))
    .map((gem) => ({ name: gem.name, id: gem.id, gem_type: gem.gem_type, color: gem.color }));

  const tagDiffs = [];
  const typeDiffs = [];
  const colourDiffs = [];
  for (const { web, game } of pairsOut) {
    const webTags = new Map((web.tags || []).map((tag) => [tagKey(tag), tag]));
    const gameTags = new Map(game.tags.map((tag) => [tagKey(tag), tag]));
    const onlyGame = [...gameTags].filter(([k]) => !webTags.has(k)).map(([, t]) => t);
    const onlyWeb = [...webTags].filter(([k]) => !gameTags.has(k)).map(([, t]) => t);
    if (onlyGame.length || onlyWeb.length) tagDiffs.push({ name: game.name, id: game.id, only_game: onlyGame, only_web: onlyWeb });
    if (web.gem_type && web.gem_type !== game.gem_type) typeDiffs.push({ name: game.name, id: game.id, game: game.gem_type, web: web.gem_type });
    if (web.color && web.color !== game.color) colourDiffs.push({ name: game.name, id: game.id, game: game.color, web: web.color });
  }

  const sortByName = (list) => list.sort((a, b) => String(a.name || a.web_name).localeCompare(String(b.name || b.web_name)));
  return {
    counts: {
      game_total: gameGems.length,
      game_real: real.length,
      game_excluded: gameGems.length - real.length,
      web_total: webGems.length,
      matched: pairsOut.length,
      matched_by_id: matchedById,
      matched_by_name: matchedByName,
      only_in_game: onlyInGame.length,
      only_in_web: onlyInWeb.length,
      web_excluded: webExcluded.length,
      tag_diffs: tagDiffs.length,
      gem_type_diffs: typeDiffs.length,
      colour_diffs: colourDiffs.length,
      stale_web_ids: staleIds.length,
      id_name_mismatch: idMismatch.length
    },
    onlyInGame: sortByName(onlyInGame),
    onlyInWeb: sortByName(onlyInWeb),
    webExcluded: sortByName(webExcluded),
    staleIds: sortByName(staleIds),
    idMismatch: sortByName(idMismatch),
    tagDiffs: sortByName(tagDiffs),
    typeDiffs: sortByName(typeDiffs),
    colourDiffs: sortByName(colourDiffs)
  };
};

const printList = (title, list, show, format) => {
  console.log(`\n${title}: ${list.length}`);
  for (const item of list.slice(0, show)) console.log(`  - ${format(item)}`);
  if (list.length > show) console.log(`  ... ${list.length - show} more`);
};

export const run = async (args = parseCliArgs()) => {
  const out = path.resolve(args.get("out") || DEFAULT_OUT);
  const show = Number(args.get("show") || 20);
  const game = await openGame({ gameDir: args.get("game"), helper: args.get("helper"), tables: TABLES });
  try {
    for (const name of TABLES) {
      const table = game.table(name);
      if (table.trailingBytes) console.warn(`warning: ${name} rows have ${table.trailingBytes} bytes the schema does not describe`);
    }
    const db = { rows: (name) => game.table(name).rows, ref: game.ref };
    const { gems, costTypes } = extractGems(db);
    const real = gems.filter((gem) => !gem.excluded);
    const count = (list, key) => list.reduce((acc, gem) => ({ ...acc, [gem[key]]: (acc[gem[key]] || 0) + 1 }), {});

    const result = {
      extracted_at: new Date().toISOString(),
      source: "Content.ggpk",
      game: { dir: game.gameDir, ggpk_bytes: game.ggpkStat.size, ggpk_modified_at: game.ggpkStat.mtime.toISOString(), data_fingerprint: game.fingerprint },
      counts: { total: gems.length, real: real.length, excluded: gems.length - real.length, by_excluded: count(gems.filter((gem) => gem.excluded), "excluded"), by_kind: count(real, "gem_kind"), by_color: count(real, "color") },
      cost_types: costTypes,
      gems
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(result)}\n`);
    console.log(`Wrote ${path.relative(ROOT_DIR, out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
    console.log(`Gems in game: ${gems.length} rows, ${real.length} real (${JSON.stringify(result.counts.by_kind)}), ${gems.length - real.length} excluded ${JSON.stringify(result.counts.by_excluded)}`);
    console.log(`Colours: ${JSON.stringify(result.counts.by_color)}`);

    const webGems = loadWebGems(args.get("web") || WEB_GEMS_PATH);
    const report = compareGems(gems, webGems);
    const reportPath = out.replace(/\.json$/i, "-compare.json");
    fs.writeFileSync(reportPath, `${JSON.stringify({ compared_at: result.extracted_at, ...report }, null, 2)}\n`);
    const c = report.counts;
    console.log(`\nWeb (${path.relative(ROOT_DIR, WEB_GEMS_PATH)}): ${c.web_total} gems; matched ${c.matched} (${c.matched_by_id} by official_id, ${c.matched_by_name} by name)`);
    printList("Only in game", report.onlyInGame, show, (g) => `${g.name} [${g.gem_type}/${g.color}] ${g.id}`);
    printList("Only in web", report.onlyInWeb, show, (g) => `${g.name} [${g.gem_type}] ${g.official_id}`);
    printList("Web lists gems the game marks DNT / template", report.webExcluded, show, (g) => `${g.name} (${g.reason})`);
    printList("Web official_id not in game (matched by name)", report.staleIds, show, (g) => `${g.name}: web ${g.web_id} -> game ${g.game_ids.join(", ")}`);
    printList("official_id points at a differently named gem", report.idMismatch, show, (g) => `${g.official_id}: web "${g.web_name}" vs game "${g.game_name}"`);
    printList("gem_type disagreements", report.typeDiffs, show, (g) => `${g.name}: game ${g.game}, web ${g.web}`);
    printList("Colour disagreements", report.colourDiffs, show, (g) => `${g.name}: game ${g.game}, web ${g.web}`);
    printList("Tag differences", report.tagDiffs, show, (g) => `${g.name}: +game [${g.only_game.join(", ")}] +web [${g.only_web.join(", ")}]`);
    console.log(`\nFull comparison: ${path.relative(ROOT_DIR, reportPath)}`);
    return { result, report };
  } finally {
    game.close();
  }
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

// Builds public/data/gem-compat-data.js (window.POE2_GEM_COMPAT) for the Build Planner's
// Gemcutting popup modal:
//   - Exact PoB / PoE2 support validity rules (skillTypes, minionSkillTypes, requireSkillTypes,
//     excludeSkillTypes, ignoreMinionTypes, supportGemsOnly, cannotBeSupported) from
//     ../pob-core/src/Data/Skills/*.lua + Gems.lua.
//   - Official GGG Recommended Supports per active skill from Content.ggpk's SkillGemSupports
//     table (cached in data/game-extract/ggpk/recommended-supports.json for offline reuse).
//   - Uncut Support Gem tier (1..5) from data/game-extract/ggpk/gems.json.
//
//   node scripts/build-gem-compat-data.mjs [--pob=<pob-core dir>] [--game=<dir>] [--skip-ggpk]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_HELPER, openGame, resolveGameDir } from "./ggpk/reader.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT_PATH = path.join(ROOT_DIR, "public", "data", "gem-compat-data.js");
export const RECOMMENDED_CACHE_PATH = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "recommended-supports.json");
export const GGPK_GEMS_PATH = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "gems.json");

const defaultPobDir = () => (process.env.POB_CORE_DIR
  ? path.resolve(process.env.POB_CORE_DIR, "..")
  : path.resolve(ROOT_DIR, "..", "pob-core"));

const normKey = (name) => String(name || "").trim().toLowerCase();

/** Parse skills["..."] blocks from a PoB src/Data/Skills/*.lua file. */
export function parseSkillsLua(source) {
  const skills = {};
  const entryRe = /^skills\["([^"]+)"\] = \{([\s\S]*?)^\}/gm;
  let match;
  while ((match = entryRe.exec(source))) {
    const id = match[1];
    const body = match[2];
    const name = body.match(/^\tname = "([^"]*)"/m)?.[1] || "";
    const baseTypeName = body.match(/^\tbaseTypeName = "([^"]*)"/m)?.[1] || "";
    const support = /^\tsupport = true\b/m.test(body);
    const hidden = /^\thidden = true\b/m.test(body);
    const cannotBeSupported = /^\tcannotBeSupported = true\b/m.test(body);
    const ignoreMinionTypes = /^\tignoreMinionTypes = true\b/m.test(body);
    const supportGemsOnly = /^\tsupportGemsOnly = true\b/m.test(body);

    const parseMapTypes = (field) => {
      const m = body.match(new RegExp(`^\\t${field} = \\{([^}]*)\\}`, "m"));
      if (!m) return [];
      return [...m[1].matchAll(/\[SkillType\.([A-Za-z0-9_]+)\]\s*=\s*true/g)].map((row) => row[1]);
    };
    const parseListTypes = (field) => {
      const m = body.match(new RegExp(`^\\t${field} = \\{([^}]*)\\}`, "m"));
      if (!m) return [];
      return [...m[1].matchAll(/SkillType\.([A-Za-z0-9_]+)/g)].map((row) => row[1]);
    };
    const famMatch = body.match(/^\tgemFamily = \{([^}]*)\}/m);
    const gemFamily = famMatch ? [...famMatch[1].matchAll(/"([^"]+)"/g)].map((row) => row[1]) : [];

    skills[id] = {
      id,
      name: baseTypeName || name,
      support,
      hidden,
      cannotBeSupported,
      ignoreMinionTypes,
      supportGemsOnly,
      skillTypes: parseMapTypes("skillTypes"),
      minionSkillTypes: parseMapTypes("minionSkillTypes"),
      requireSkillTypes: parseListTypes("requireSkillTypes"),
      excludeSkillTypes: parseListTypes("excludeSkillTypes"),
      gemFamily
    };
  }
  return skills;
}

/** Parse gem entries from PoB src/Data/Gems.lua. */
export function parseGemsLua(source) {
  const gems = [];
  const entryRe = /^\t\["([^"]+)"\] = \{([\s\S]*?)^\t\},/gm;
  let match;
  while ((match = entryRe.exec(source))) {
    const body = match[2];
    const field = (key) => body.match(new RegExp(`^\\t\\t${key} = "([^"]*)"`, "m"))?.[1] || "";
    const name = field("name");
    const grantedEffectId = field("grantedEffectId");
    if (!name || !grantedEffectId) continue;
    const additional = [];
    for (let i = 1; i <= 4; i += 1) {
      const extra = field(`additionalGrantedEffectId${i}`);
      if (extra) additional.push(extra);
    }
    gems.push({
      id: match[1],
      gameId: field("gameId") || match[1],
      name,
      gemType: field("gemType"),
      grantedEffectId,
      additionalGrantedEffectIds: additional
    });
  }
  return gems;
}

/** Extract official GGG SkillGemSupports (recommended supports per active skill) from Content.ggpk. */
export async function extractRecommendedSupportsFromGgpk({ gameDir, helper = DEFAULT_HELPER } = {}) {
  let dir = "";
  try {
    dir = resolveGameDir(gameDir);
  } catch {
    return null;
  }
  const ggpk = path.join(dir, "Content.ggpk");
  if (!fs.existsSync(ggpk) || !fs.existsSync(helper)) return null;

  const game = await openGame({
    gameDir: dir,
    helper,
    tables: ["SkillGemSupports", "SkillGems", "BaseItemTypes"]
  });
  try {
    const rows = game.table("SkillGemSupports").rows;
    const bySkill = {};
    for (const row of rows) {
      const sg = game.ref("SkillGems", row.SkillGem);
      const bi = sg ? game.ref("BaseItemTypes", sg.BaseItemTypesKey ?? sg.BaseItemType) : null;
      const skillName = String(bi?.Name || "").trim();
      if (!skillName) continue;
      const key = normKey(skillName);
      const list = bySkill[key] || [];
      const seen = new Set(list.map(normKey));
      for (const supIdx of row.Supports || []) {
        const supGem = game.ref("SkillGems", supIdx);
        const supBi = supGem ? game.ref("BaseItemTypes", supGem.BaseItemTypesKey ?? supGem.BaseItemType) : null;
        const supName = String(supBi?.Name || "").trim();
        if (!supName || /^\[DNT\]/i.test(supName)) continue;
        const supKey = normKey(supName);
        if (!seen.has(supKey)) {
          seen.add(supKey);
          list.push(supName);
        }
      }
      if (list.length) bySkill[key] = list;
    }
    const payload = {
      generated_at: new Date().toISOString(),
      ggpk_fingerprint: game.fingerprint,
      skills_count: Object.keys(bySkill).length,
      recommended: bySkill
    };
    fs.mkdirSync(path.dirname(RECOMMENDED_CACHE_PATH), { recursive: true });
    fs.writeFileSync(RECOMMENDED_CACHE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  } finally {
    game.close();
  }
}

function loadRecommendedSupports(args) {
  if (!args.has("skip-ggpk")) {
    // caller handles async extraction; fallback to cache
  }
  if (fs.existsSync(RECOMMENDED_CACHE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(RECOMMENDED_CACHE_PATH, "utf8"))?.recommended || {};
    } catch {
      return {};
    }
  }
  return {};
}

function loadGgpkGemMeta() {
  const supportTiers = new Map();
  const activeMeta = new Map();
  if (!fs.existsSync(GGPK_GEMS_PATH)) return { supportTiers, activeMeta };
  try {
    const raw = JSON.parse(fs.readFileSync(GGPK_GEMS_PATH, "utf8"));
    for (const g of raw?.gems || []) {
      if (g.excluded || !g.name) continue;
      const key = normKey(g.name);
      if (g.gem_type === "support") {
        if (typeof g.tier === "number" && g.tier > 0) supportTiers.set(key, g.tier);
      } else {
        activeMeta.set(key, {
          tier: typeof g.tier === "number" && g.tier > 0 ? g.tier : null,
          tags: Array.isArray(g.tags) ? g.tags : [],
          color: g.color || "item"
        });
      }
    }
  } catch {
    // ignore
  }
  return { supportTiers, activeMeta };
}

/** Classify an active skill into its PoE2 Gemcutting sidebar category. */
function classifyActiveCategory({ name, requirements = [], tags = [], tier = null }) {
  const req = requirements.join(" ");
  const tagSet = new Set(tags.map((t) => String(t).toLowerCase()));
  // Persistent spirit gems (Uncut Spirit Gem tiers 4, 8, 14 or Persistent/Buff/Aura/Herald/Meta)
  const isSpiritTier = tier === 4 || tier === 8 || tier === 14;
  if (isSpiritTier || (tagSet.has("persistent") && (tagSet.has("buff") || tagSet.has("aura") || tagSet.has("herald") || tagSet.has("meta")))) {
    return "spirit";
  }
  if (/\bSpears?\b/i.test(req)) return "spear";
  if (/\bBows?\b/i.test(req)) return "bow";
  if (/\bQuartersta/i.test(req)) return "quarterstaff";
  if (/\bCrossbows?\b/i.test(req)) return "crossbow";
  if (/\bDaggers?\b/i.test(req)) return "dagger";
  if (/\bFlails?\b/i.test(req)) return "flail";
  if (/\bMaces?\b|\bShield\b|\bBucklers?\b/i.test(req)) return "mace";
  if (/\bAxes?\b/i.test(req)) return "axe";
  if (/\bSwords?\b/i.test(req)) return "sword";
  if (/\bTalismans?\b/i.test(req) || tagSet.has("shapeshift") || tagSet.has("plant") || tagSet.has("companion") || tagSet.has("bear") || tagSet.has("wolf") || tagSet.has("wyvern")) {
    return "primal";
  }
  if (tagSet.has("chaos") || tagSet.has("curse") || tagSet.has("minion") || tagSet.has("physical") && tagSet.has("spell")) {
    return "occult";
  }
  if (tagSet.has("spell") || tagSet.has("fire") || tagSet.has("cold") || tagSet.has("lightning")) {
    return "elemental";
  }
  if (/\bUnarmed\b/i.test(req)) return "quarterstaff";
  if (/\bSpear\b/i.test(name)) return "spear";
  if (/\bArrow\b|\bBow\b/i.test(name)) return "bow";
  return "other";
}

function loadSiteSkillMeta() {
  const sitePath = path.join(ROOT_DIR, "public", "data", "skill-gems-data.js");
  const byName = new Map();
  if (!fs.existsSync(sitePath)) return byName;
  try {
    const sandbox = {};
    new Function("window", fs.readFileSync(sitePath, "utf8"))(sandbox);
    for (const g of sandbox.POE2_SKILL_GEMS?.gems || []) {
      if (g.gem_type === "support" || !g.name) continue;
      const key = normKey(g.name);
      if (!byName.has(key)) {
        byName.set(key, { requirements: g.requirements || [], tags: g.tags || [] });
      }
    }
  } catch {
    // ignore
  }
  return byName;
}

export async function buildGemCompatData({ pobDir = defaultPobDir(), gameDir, skipGgpk = false } = {}) {
  const dataDir = path.join(pobDir, "src", "Data");
  const skillsDir = path.join(dataDir, "Skills");
  if (!fs.existsSync(skillsDir) || !fs.existsSync(path.join(dataDir, "Gems.lua"))) {
    throw new Error(`PoB Data/Skills or Gems.lua not found under ${dataDir}`);
  }

  let recommended = {};
  if (!skipGgpk) {
    const fresh = await extractRecommendedSupportsFromGgpk({ gameDir });
    if (fresh?.recommended) recommended = fresh.recommended;
  }
  if (!Object.keys(recommended).length) {
    recommended = loadRecommendedSupports(new Map());
  }

  const { supportTiers: ggpkTiers, activeMeta: ggpkActiveMeta } = loadGgpkGemMeta();
  const siteSkillMeta = loadSiteSkillMeta();

  const allSkills = {};
  for (const file of fs.readdirSync(skillsDir).filter((name) => name.endsWith(".lua")).sort()) {
    Object.assign(allSkills, parseSkillsLua(fs.readFileSync(path.join(skillsDir, file), "utf8")));
  }
  const gems = parseGemsLua(fs.readFileSync(path.join(dataDir, "Gems.lua"), "utf8"));

  // Build compact SkillType dictionary (keep AND/OR/NOT at fixed indices 0, 1, 2).
  const typeIndex = new Map([["AND", 0], ["OR", 1], ["NOT", 2]]);
  const types = ["AND", "OR", "NOT"];
  const encodeTypes = (list) => (list || []).map((name) => {
    if (!typeIndex.has(name)) {
      typeIndex.set(name, types.length);
      types.push(name);
    }
    return typeIndex.get(name);
  });

  const active = {};
  const support = {};

  const recordActive = (nameKey, effect, extraEffects = []) => {
    if (!nameKey || !effect || effect.support) return;
    const stSet = new Set(effect.skillTypes || []);
    const mstSet = new Set(effect.minionSkillTypes || []);
    for (const extra of extraEffects) {
      if (!extra || extra.support) continue;
      for (const t of extra.skillTypes || []) stSet.add(t);
      for (const t of extra.minionSkillTypes || []) mstSet.add(t);
    }
    if (!stSet.size && !mstSet.size && !effect.cannotBeSupported) return;
    const prev = active[nameKey];
    if (prev && (prev.st?.length || 0) >= stSet.size) return;
    const entry = { st: encodeTypes([...stSet]) };
    if (mstSet.size) entry.mst = encodeTypes([...mstSet]);
    if (effect.cannotBeSupported) entry.noSup = 1;
    active[nameKey] = entry;
  };

  const recordSupport = (nameKey, effect) => {
    if (!nameKey || !effect || !effect.support) return;
    const entry = {
      req: encodeTypes(effect.requireSkillTypes || [])
    };
    if (effect.excludeSkillTypes?.length) entry.exc = encodeTypes(effect.excludeSkillTypes);
    if (effect.ignoreMinionTypes) entry.ignM = 1;
    if (effect.supportGemsOnly) entry.gemOnly = 1;
    if (effect.gemFamily?.length) entry.fam = effect.gemFamily;
    const tier = ggpkTiers.get(nameKey);
    if (tier) entry.tier = tier;
    support[nameKey] = entry;
  };

  // 1. Register every gem in Gems.lua first (canonical player gem names).
  for (const gem of gems) {
    const effect = allSkills[gem.grantedEffectId];
    if (!effect) continue;
    const key = normKey(gem.name);
    if (gem.gemType === "Support" || effect.support) {
      recordSupport(key, effect);
    } else {
      const extras = gem.additionalGrantedEffectIds.map((id) => allSkills[id]).filter(Boolean);
      recordActive(key, effect, extras);
    }
  }

  // 2. Also register item-granted / ascendancy / default active skills (e.g. Mace Strike, Righteous Descent).
  for (const effect of Object.values(allSkills)) {
    if (!effect.name) continue;
    const key = normKey(effect.name);
    if (effect.support) {
      if (!support[key]) recordSupport(key, effect);
    } else if (!active[key]) {
      recordActive(key, effect);
    }
  }

  // 3. Attach GGPK tiers & Gemcutting categories to active skills and GGPK tiers to supports.
  for (const [nameKey, meta] of ggpkActiveMeta) {
    const site = siteSkillMeta.get(nameKey);
    const cat = classifyActiveCategory({
      name: nameKey,
      requirements: site?.requirements || [],
      tags: site?.tags?.length ? site.tags : meta.tags,
      tier: meta.tier
    });
    if (!active[nameKey]) active[nameKey] = { st: [] };
    if (meta.tier) active[nameKey].tier = meta.tier;
    if (cat) active[nameKey].cat = cat;
  }
  for (const [nameKey, site] of siteSkillMeta) {
    if (!active[nameKey]) active[nameKey] = { st: [] };
    if (!active[nameKey].cat) {
      active[nameKey].cat = classifyActiveCategory({
        name: nameKey,
        requirements: site.requirements,
        tags: site.tags,
        tier: active[nameKey].tier ?? null
      });
    }
  }
  for (const [nameKey, tier] of ggpkTiers) {
    if (support[nameKey]) {
      support[nameKey].tier = tier;
    } else {
      support[nameKey] = { req: [], tier };
    }
  }

  let commit = "";
  try {
    commit = execFileSync("git", ["-C", pobDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // not a git checkout
  }

  const payload = {
    format: "pob-gem-compat-1",
    source: `PathOfBuilding-PoE2${commit ? ` ${commit}` : ""} + Content.ggpk SkillGemSupports`,
    types,
    active,
    support,
    recommended
  };

  const out = `window.POE2_GEM_COMPAT = ${JSON.stringify(payload)};\n`;
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, out, "utf8");
  return {
    output: path.relative(ROOT_DIR, OUTPUT_PATH),
    bytes: Buffer.byteLength(out, "utf8"),
    types: types.length,
    active: Object.keys(active).length,
    support: Object.keys(support).length,
    recommended: Object.keys(recommended).length
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [k, ...rest] = arg.split("=");
    return [k.replace(/^--/, ""), rest.join("=") || "true"];
  }));
  const summary = await buildGemCompatData({
    pobDir: args.get("pob") ? path.resolve(args.get("pob")) : defaultPobDir(),
    gameDir: args.get("game"),
    skipGgpk: args.has("skip-ggpk")
  });
  console.log(JSON.stringify(summary, null, 2));
}

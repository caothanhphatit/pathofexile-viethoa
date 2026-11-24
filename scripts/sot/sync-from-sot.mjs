// Field-merged Source of Truth (SOT) synchronizer: merges authoritative fields and adds
// newly released records from Path of Building (data/pob-extract/*.generated.json) and
// Content.ggpk (data/game-extract/ggpk/{gems,base-items,misc-items}.json) into
// public/data/{skill-gems-data,items-data,currency-data}.js.
//
// Design rules:
//   - Preserve existing URL slugs so no public links break.
//   - Preserve Vietnamese translations (i18n.* arrays of { en, vi }) line-by-line by
//     normalized English text (with a bundle-wide English -> Vietnamese fallback map).
//   - Leave genuinely untranslated new lines with `vi: ""` (localizedText cleanly displays
//     `en` in the UI, and content-quality tests never see leaked English inside `.vi`).
//   - Never silently delete existing rows; report site-only rows in the season report.
//   - Support `--overwrite-mods` for new seasons when PoB/GGPK balance numbers are newer
//     than the existing site data.
//
//   node scripts/sot/sync-from-sot.mjs [--apply] [--dry-run] [--overwrite-mods] [--report=docs/season-update-latest.md]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT_DIR } from "../ggpk/reader.mjs";
import { ICONS_DIR, localRelWebpPath, localWebUrl } from "../ggpk/sync-site-icons.mjs";

export const DATA_DIR = path.join(ROOT_DIR, "public", "data");
export const POB_EXTRACT_DIR = path.join(ROOT_DIR, "data", "pob-extract");
export const GGPK_EXTRACT_DIR = path.join(ROOT_DIR, "data", "game-extract", "ggpk");
export const DEFAULT_REPORT_JSON = path.join(ROOT_DIR, "data", "sot-sync-report.json");
export const DEFAULT_REPORT_MD = path.join(ROOT_DIR, "docs", "season-update-latest.md");

const PROTOTYPE_NAME_RE = /^(?:\[?(?:DNT|UNUSED)\b|Prototype\b|Test\b|Keyblade$)/i;

const MENU_TO_SLOT_CATEGORIES = {
  "body-armours": ["body-armour"],
  helmets: ["helmet"],
  gloves: ["gloves"],
  boots: ["boots"],
  belts: ["belt"],
  amulets: ["amulet"],
  rings: ["ring"],
  "life-flasks": ["life-flask"],
  "mana-flasks": ["mana-flask"],
  charms: ["charm"],
  shields: ["offhand"],
  bucklers: ["offhand"],
  foci: ["offhand"],
  quivers: ["offhand"],
  claws: ["weapon", "offhand"],
  daggers: ["weapon", "offhand"],
  flails: ["weapon", "offhand"],
  "one-hand-axes": ["weapon", "offhand"],
  "one-hand-maces": ["weapon", "offhand"],
  "one-hand-swords": ["weapon", "offhand"],
  sceptres: ["weapon", "offhand"],
  spears: ["weapon", "offhand"],
  wands: ["weapon", "offhand"],
  bows: ["weapon"],
  crossbows: ["weapon"],
  quarterstaves: ["weapon"],
  staves: ["weapon"],
  talismans: ["weapon"],
  traps: ["weapon"],
  "two-hand-axes": ["weapon"],
  "two-hand-maces": ["weapon"],
  "two-hand-swords": ["weapon"]
};

const GGPK_CLASS_TO_MENU = {
  Amulets: "amulets",
  Belts: "belts",
  "Body Armours": "body-armours",
  Boots: "boots",
  Bows: "bows",
  Bucklers: "bucklers",
  Charms: "charms",
  Claws: "claws",
  Crossbows: "crossbows",
  Daggers: "daggers",
  Flails: "flails",
  Foci: "foci",
  Gloves: "gloves",
  Helmets: "helmets",
  Jewels: "jewels",
  "Life Flasks": "life-flasks",
  "Mana Flasks": "mana-flasks",
  "One Hand Axes": "one-hand-axes",
  "One Hand Maces": "one-hand-maces",
  "One Hand Swords": "one-hand-swords",
  Quarterstaves: "quarterstaves",
  Quivers: "quivers",
  Relics: "relics",
  Rings: "rings",
  Sceptres: "sceptres",
  Shields: "shields",
  Spears: "spears",
  Staves: "staves",
  Talismans: "talismans",
  Traps: "traps",
  "Two Hand Axes": "two-hand-axes",
  "Two Hand Maces": "two-hand-maces",
  "Two Hand Swords": "two-hand-swords",
  Wands: "wands"
};

const MISC_CATEGORY_TO_MENU = {
  currency: "stackable-currency",
  essence: "essence",
  omen: "omen",
  augment: "augment",
  tablet: "tablet",
  waystone: "waystone",
  fragment: "map-fragments",
  key: "pinnacle-keys",
  relic: "relics"
};

/** Normalize English text for lookup/comparison without losing meaning (dashes & whitespace). */
export function normKey(text) {
  return String(text ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normName(name) {
  return String(name ?? "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function slugFromName(name) {
  return String(name ?? "").replace(/['’]/g, "").trim().replace(/\s+/g, "_");
}

export function loadWindowBundle(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(/^\s*window\.([A-Za-z0-9_]+)\s*=/);
  if (!match) throw new Error(`Cannot detect window.<VAR> assignment in ${filePath}`);
  const globalName = match[1];
  const sandbox = {};
  new Function("window", raw)(sandbox);
  return { globalName, data: sandbox[globalName] };
}

export function writeWindowBundle(filePath, globalName, data) {
  const content = `window.${globalName} = ${JSON.stringify(data, null, 2)};\n`;
  fs.writeFileSync(filePath, content, "utf8");
}

function pairsFromI18nField(field) {
  if (Array.isArray(field)) {
    return field
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => [entry.en, entry.vi]);
  }
  if (field && Array.isArray(field.en)) {
    return field.en.map((en, i) => [en, field.vi?.[i]]);
  }
  return [];
}

/** Build a bundle-wide lookup table of normalized English string -> existing Vietnamese translation. */
export function buildTranslationMemory(records, fieldExtractors) {
  const memory = new Map();
  const addPair = (en, vi) => {
    const e = String(en ?? "").trim();
    const v = String(vi ?? "").trim();
    if (!e || !v || e === v) return;
    const key = normKey(e);
    if (!memory.has(key)) memory.set(key, v);
  };
  for (const row of records || []) {
    for (const extract of fieldExtractors) {
      for (const [en, vi] of extract(row)) addPair(en, vi);
    }
  }
  return memory;
}

/**
 * Preserve Vietnamese translations line-by-line by normalized English text.
 * Untranslated lines receive `vi: ""` so localizedText displays `en` cleanly and
 * content-quality tests never see raw English sentences stored inside `.vi`.
 */
export function preserveLineTranslations(nextEnLines, existingI18nField, memory) {
  const localMap = new Map();
  for (const [rawEn, rawVi] of pairsFromI18nField(existingI18nField)) {
    const e = String(rawEn ?? "").trim();
    const v = String(rawVi ?? "").trim();
    if (e && v) localMap.set(normKey(e), v);
  }
  const entries = [];
  const en = [];
  const vi = [];
  const untranslated = [];
  for (const raw of nextEnLines || []) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    const key = normKey(line);
    let translated = "";
    if (localMap.has(key)) {
      translated = localMap.get(key);
    } else if (memory && memory.has(key)) {
      translated = memory.get(key);
    } else {
      untranslated.push(line);
    }
    en.push(line);
    vi.push(translated);
    entries.push({ en: line, vi: translated });
  }
  return { entries, en, vi, untranslated };
}

export function preserveScalarTranslation(nextEn, existingI18nField, memory) {
  const text = String(nextEn ?? "").trim();
  if (!text) return { en: "", vi: "", untranslated: [] };
  const key = normKey(text);
  const oldEn = String(existingI18nField?.en ?? "").trim();
  const oldVi = String(existingI18nField?.vi ?? "").trim();
  if (oldEn && oldVi && normKey(oldEn) === key) {
    return { en: text, vi: oldVi, untranslated: [] };
  }
  if (memory && memory.has(key)) {
    return { en: text, vi: memory.get(key), untranslated: [] };
  }
  return { en: text, vi: "", untranslated: [text] };
}

function sameStringArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function formatGgpkRequirements(req) {
  if (!req || typeof req !== "object") return [];
  const parts = [];
  if (req.level > 0) parts.push(`Level ${req.level}`);
  if (req.str > 0) parts.push(`${req.str} Str`);
  if (req.dex > 0) parts.push(`${req.dex} Dex`);
  if (req.int > 0) parts.push(`${req.int} Int`);
  return parts.length ? [`Requires: ${parts.join(", ")}`] : [];
}

function resolveLocalOrCdnIcon(iconDds, iconsDir = ICONS_DIR) {
  if (!iconDds) return "";
  const rel = localRelWebpPath(iconDds);
  if (rel && fs.existsSync(path.join(iconsDir, rel))) return localWebUrl(iconDds);
  return `https://cdn.poe2db.tw/image/${String(iconDds).replace(/\.dds$/i, ".webp")}`;
}

/**
 * Merge PoB skill gems + GGPK gem metadata into existing skill-gems-data.js bundle.
 * Adds genuine missing gems from PoB AND from GGPK (so new-season GGPK gems appear
 * even before PoB updates).
 */
export function mergeSkillGemsBundle(
  siteBundle,
  pobGems = [],
  ggpkGems = [],
  { iconsDir = ICONS_DIR, overwriteMods = false } = {}
) {
  const gems = (siteBundle.gems || []).map((row) => structuredClone(row));
  const memory = buildTranslationMemory(gems, [
    (r) => [[r.i18n?.summary?.en ?? r.summary_en, r.i18n?.summary?.vi]],
    (r) => pairsFromI18nField(r.i18n?.mods),
    (r) => pairsFromI18nField(r.i18n?.properties),
    (r) => pairsFromI18nField(r.i18n?.requirements),
    (r) => pairsFromI18nField(r.i18n?.tags),
    (r) => (r.i18n?.sections || []).flatMap((s) => pairsFromI18nField(s?.lines))
  ]);

  const pobById = new Map();
  const pobByNameType = new Map();
  for (const g of pobGems || []) {
    if (g.official_id) pobById.set(g.official_id, g);
    pobByNameType.set(`${normName(g.name)}|${g.gem_type}`, g);
  }

  const ggpkById = new Map();
  const ggpkByNameType = new Map();
  const ggpkExcludedIds = new Set();
  for (const g of ggpkGems || []) {
    if (g.excluded) {
      if (g.id) ggpkExcludedIds.add(g.id);
      continue;
    }
    if (g.id) ggpkById.set(g.id, g);
    ggpkByNameType.set(`${normName(g.name)}|${g.gem_type}`, g);
  }

  const matchedPobIds = new Set();
  const existingOfficialIds = new Set(gems.map((g) => g.official_id).filter(Boolean));
  const existingNameTypes = new Set(gems.map((g) => `${normName(g.name)}|${g.gem_type || "skill"}`));
  const existingSlugs = new Set(gems.map((g) => g.slug));
  const stats = {
    existing_total: gems.length,
    matched_pob: 0,
    matched_ggpk: 0,
    updated_records: 0,
    fields_updated: { official_id: 0, tier: 0, tags: 0, color: 0, flavour_text: 0, mods_sections: 0 },
    added: [],
    added_from_ggpk: [],
    skipped_unreleased: [],
    untranslated: new Set()
  };

  for (const row of gems) {
    const key = `${normName(row.name)}|${row.gem_type || "skill"}`;
    const pob = (row.official_id && pobById.get(row.official_id)) || pobByNameType.get(key) || null;
    const ggpk = (row.official_id && ggpkById.get(row.official_id))
      || (pob?.official_id && ggpkById.get(pob.official_id))
      || ggpkByNameType.get(key)
      || null;

    let changed = false;
    if (pob) {
      stats.matched_pob += 1;
      matchedPobIds.add(pob.official_id || key);
      if (pob.official_id && row.official_id !== pob.official_id) {
        row.official_id = pob.official_id;
        existingOfficialIds.add(pob.official_id);
        stats.fields_updated.official_id += 1;
        changed = true;
      }
      if (row.tier !== pob.tier) {
        row.tier = pob.tier;
        stats.fields_updated.tier += 1;
        changed = true;
      }
      if (Array.isArray(pob.tags) && pob.tags.length > 0 && !sameStringArray(row.tags, pob.tags)) {
        row.tags = pob.tags;
        const translatedTags = preserveLineTranslations(pob.tags, row.i18n?.tags, memory);
        row.i18n = row.i18n || {};
        row.i18n.tags = translatedTags.entries.map((t) => ({ en: t.en, vi: t.vi || t.en }));
        stats.fields_updated.tags += 1;
        changed = true;
      }
      if (pob.flavour_text && row.flavour_text !== pob.flavour_text) {
        row.flavour_text = pob.flavour_text;
        stats.fields_updated.flavour_text += 1;
        changed = true;
      }
      if (overwriteMods && Array.isArray(pob.sections) && pob.sections.length > 0) {
        const nextSections = [];
        const nextI18nSections = [];
        for (let idx = 0; idx < pob.sections.length; idx += 1) {
          const sec = pob.sections[idx];
          const oldI18nSec = row.i18n?.sections?.[idx];
          const linesTr = preserveLineTranslations(sec.lines, oldI18nSec?.lines, memory);
          for (const u of linesTr.untranslated) stats.untranslated.add(u);
          nextSections.push({ title: sec.title, lines: linesTr.en });
          nextI18nSections.push({
            title: { en: sec.title, vi: oldI18nSec?.title?.vi || sec.title },
            lines: linesTr.entries
          });
        }
        row.sections = nextSections;
        row.mods = nextSections.length === 1 ? nextSections[0].lines : [];
        row.i18n = row.i18n || {};
        row.i18n.sections = nextI18nSections;
        row.i18n.mods = nextSections.length === 1 ? nextI18nSections[0].lines : [];
        stats.fields_updated.mods_sections += 1;
        changed = true;
      }
    }

    if (ggpk) {
      stats.matched_ggpk += 1;
      if (ggpk.color && row.color !== ggpk.color) {
        row.color = ggpk.color;
        stats.fields_updated.color += 1;
        changed = true;
      }
    }

    if (changed) stats.updated_records += 1;
  }

  const now = new Date().toISOString();

  // 1. Add missing real gems from PoB.
  for (const pob of pobGems || []) {
    const key = `${normName(pob.name)}|${pob.gem_type}`;
    if (matchedPobIds.has(pob.official_id || key)) continue;
    if (existingNameTypes.has(key) || (pob.official_id && existingOfficialIds.has(pob.official_id))) continue;
    if (PROTOTYPE_NAME_RE.test(pob.name) || (pob.official_id && ggpkExcludedIds.has(pob.official_id))) {
      stats.skipped_unreleased.push(pob.name);
      continue;
    }
    if (pob.gem_type === "support" && !/^Metadata\/Items\/Gems?\/Support/.test(pob.official_id || "")) continue;

    const ggpk = (pob.official_id && ggpkById.get(pob.official_id)) || ggpkByNameType.get(key) || null;
    let slug = pob.slug || slugFromName(pob.name);
    if (existingSlugs.has(slug)) slug = `${slug}_${pob.gem_type}`;
    if (existingSlugs.has(slug)) continue;
    existingSlugs.add(slug);
    existingNameTypes.add(key);
    if (pob.official_id) existingOfficialIds.add(pob.official_id);

    const summaryTr = preserveScalarTranslation(pob.summary_en, null, memory);
    const propsTr = preserveLineTranslations(pob.properties, null, memory);
    const reqsTr = preserveLineTranslations(pob.requirements, null, memory);
    const modsTr = preserveLineTranslations(pob.mods, null, memory);
    const tagsTr = preserveLineTranslations(pob.tags, null, memory);
    const sections = [];
    const i18nSections = [];
    for (const section of pob.sections || []) {
      const linesTr = preserveLineTranslations(section.lines, null, memory);
      for (const u of linesTr.untranslated) stats.untranslated.add(u);
      sections.push({ title: section.title, lines: linesTr.en });
      i18nSections.push({
        title: { en: section.title, vi: section.title },
        lines: linesTr.entries
      });
    }
    for (const u of [...summaryTr.untranslated, ...modsTr.untranslated]) stats.untranslated.add(u);

    const newGem = {
      slug,
      name: pob.name,
      tier: pob.tier,
      color: ggpk?.color || pob.color || "item",
      source_url: "",
      icon_url: pob.pob?.icon ? resolveLocalOrCdnIcon(pob.pob.icon, iconsDir) : "",
      icon_alt: pob.name,
      hover_url: "",
      tags: pob.tags || [],
      source_hash: `pob:${pob.official_id || slug}`,
      status: "active",
      summary_en: summaryTr.en,
      properties: propsTr.en,
      requirements: reqsTr.en,
      mods: modsTr.en,
      sections,
      i18n: {
        name: { en: pob.name, vi: pob.name },
        tags: tagsTr.entries.map((t) => ({ en: t.en, vi: t.vi || t.en })),
        summary: { en: summaryTr.en, vi: summaryTr.vi },
        properties: propsTr.entries,
        requirements: reqsTr.entries,
        mods: modsTr.entries,
        sections: i18nSections
      },
      detail_hash: `pob:${pob.official_id || slug}`,
      updated_at: now,
      gem_type: pob.gem_type,
      official_id: pob.official_id || null,
      ...(pob.flavour_text ? { flavour_text: pob.flavour_text } : {})
    };
    gems.push(newGem);
    stats.added.push({ name: newGem.name, slug: newGem.slug, gem_type: newGem.gem_type, official_id: newGem.official_id, source: "pob" });
  }

  // 2. Add missing real gems from GGPK when PoB hasn't exported them yet (new season day-1 coverage).
  // Require an assigned Uncut Gem tier (`ggpk.tier != null`) so removed/legacy triggers (e.g. Cast on
  // Freeze/Ignite/Shock, merged into Cast on Elemental Ailment) and unreleased meta gems are never added.
  for (const ggpk of ggpkGems || []) {
    if (ggpk.excluded || !ggpk.name || !ggpk.id) continue;
    const gemType = ggpk.gem_type === "support" ? "support" : "skill";
    const key = `${normName(ggpk.name)}|${gemType}`;
    if (existingNameTypes.has(key) || existingOfficialIds.has(ggpk.id)) continue;
    if (PROTOTYPE_NAME_RE.test(ggpk.name) || ggpk.tier == null) {
      stats.skipped_unreleased.push(ggpk.name);
      continue;
    }
    if (gemType === "support" && !/^Metadata\/Items\/Gems?\/Support/.test(ggpk.id)) continue;
    // Skip internal default/monster/companion gems without a player description or support text.
    const desc = String(ggpk.active_skill?.description || ggpk.support_text || "").trim();
    if (!desc) continue;

    let slug = slugFromName(ggpk.name);
    if (existingSlugs.has(slug)) slug = `${slug}_${gemType}`;
    if (existingSlugs.has(slug)) continue;
    existingSlugs.add(slug);
    existingNameTypes.add(key);
    existingOfficialIds.add(ggpk.id);

    const summaryTr = preserveScalarTranslation(desc, null, memory);
    const rawTags = Array.isArray(ggpk.tags) ? ggpk.tags : [];
    const tags = gemType === "support"
      ? (rawTags.includes("Support") ? rawTags : ["Support", ...rawTags])
      : rawTags;
    const tagsTr = preserveLineTranslations(tags, null, memory);
    const reqs = ggpk.min_level_requirement > 1 ? [`Requires: Level ${ggpk.min_level_requirement}`] : [];
    const reqsTr = preserveLineTranslations(reqs, null, memory);
    for (const u of summaryTr.untranslated) stats.untranslated.add(u);

    const newGem = {
      slug,
      name: ggpk.name,
      tier: gemType === "support" ? null : (ggpk.tier ?? null),
      color: ggpk.color || "item",
      source_url: "",
      icon_url: ggpk.icon_dds ? resolveLocalOrCdnIcon(ggpk.icon_dds, iconsDir) : "",
      icon_alt: ggpk.name,
      hover_url: "",
      tags,
      source_hash: `ggpk:${ggpk.id}`,
      status: "active",
      summary_en: summaryTr.en,
      properties: [],
      requirements: reqsTr.en,
      mods: [],
      sections: [],
      i18n: {
        name: { en: ggpk.name, vi: ggpk.name },
        tags: tagsTr.entries.map((t) => ({ en: t.en, vi: t.vi || t.en })),
        summary: { en: summaryTr.en, vi: summaryTr.vi },
        properties: [],
        requirements: reqsTr.entries,
        mods: [],
        sections: []
      },
      detail_hash: `ggpk:${ggpk.id}`,
      updated_at: now,
      gem_type: gemType,
      official_id: ggpk.id
    };
    gems.push(newGem);
    stats.added_from_ggpk.push({ name: newGem.name, slug: newGem.slug, gem_type: newGem.gem_type, official_id: newGem.official_id, source: "ggpk" });
  }

  const activeTotal = gems.filter((g) => (g.gem_type || "skill") === "skill").length;
  const supportTotal = gems.filter((g) => g.gem_type === "support").length;
  return {
    bundle: {
      ...siteBundle,
      generated_at: now,
      total: gems.length,
      active_total: activeTotal,
      support_total: supportTotal,
      gems
    },
    stats: { ...stats, untranslated: [...stats.untranslated] }
  };
}

/**
 * Merge PoB uniques + GGPK base items + GGPK misc items into existing items-data.js bundle,
 * adding brand-new PoB uniques, GGPK base items, and GGPK misc items cleanly.
 */
export function mergeItemsBundle(
  siteBundle,
  { pobUniques = [], ggpkBaseItems = [], ggpkMiscItems = [], iconsDir = ICONS_DIR, overwriteMods = false } = {}
) {
  const items = (siteBundle.items || []).map((row) => structuredClone(row));
  const menuMetaByKey = new Map((siteBundle.menus || []).map((m) => [m.key, m]));
  const memory = buildTranslationMemory(items, [
    (r) => pairsFromI18nField(r.i18n?.mods),
    (r) => pairsFromI18nField(r.i18n?.properties),
    (r) => pairsFromI18nField(r.i18n?.requirements)
  ]);

  const uniqueByName = new Map();
  for (const u of pobUniques || []) {
    const key = normName(u.name);
    if (!uniqueByName.has(key)) uniqueByName.set(key, u);
  }
  const baseByName = new Map();
  for (const b of ggpkBaseItems || []) {
    const key = normName(b.name);
    if (!baseByName.has(key)) baseByName.set(key, b);
  }
  const miscByName = new Map();
  for (const m of ggpkMiscItems || []) {
    const key = normName(m.name);
    if (!miscByName.has(key)) miscByName.set(key, m);
  }

  const existingSlugs = new Set(items.map((r) => r.slug));
  const existingNames = new Set(items.map((r) => normName(r.name)));
  const existingBaseIconByName = new Map();
  for (const row of items) {
    if (String(row.rarity || "").toLowerCase() !== "unique" && row.icon_url) {
      const k = normName(row.name);
      if (!existingBaseIconByName.has(k)) existingBaseIconByName.set(k, row.icon_url);
    }
  }

  const stats = {
    existing_total: items.length,
    matched_pob_uniques: 0,
    matched_ggpk_bases: 0,
    matched_ggpk_misc: 0,
    updated_records: 0,
    enriched: { flavour_text: 0, league: 0, drop_source: 0, base_requirements: 0, misc_stack_size: 0, unique_mods: 0 },
    added_uniques: [],
    added_bases: [],
    added_misc: [],
    uniques_only_in_pob: [],
    untranslated: new Set()
  };

  const seenUniqueNames = new Set();

  for (const row of items) {
    const key = normName(row.name);
    let changed = false;

    if (String(row.rarity || "").toLowerCase() === "unique") {
      seenUniqueNames.add(key);
      const pob = uniqueByName.get(key);
      if (pob) {
        stats.matched_pob_uniques += 1;
        if (pob.flavour_text && row.flavour_text !== pob.flavour_text) {
          row.flavour_text = pob.flavour_text;
          stats.enriched.flavour_text += 1;
          changed = true;
        }
        if (pob.pob?.league && row.league !== pob.pob.league) {
          row.league = pob.pob.league;
          stats.enriched.league += 1;
          changed = true;
        }
        if (pob.pob?.source && row.drop_source !== pob.pob.source) {
          row.drop_source = pob.pob.source;
          stats.enriched.drop_source += 1;
          changed = true;
        }
        if (overwriteMods && Array.isArray(pob.mods) && pob.mods.length > 0 && !sameStringArray(row.mods, pob.mods)) {
          row.mods = pob.mods;
          const tr = preserveLineTranslations(pob.mods, row.i18n?.mods, memory);
          for (const u of tr.untranslated) stats.untranslated.add(u);
          row.i18n = row.i18n || {};
          row.i18n.mods = tr.entries;
          stats.enriched.unique_mods += 1;
          changed = true;
        }
      }
    } else {
      const base = baseByName.get(key);
      if (base) {
        stats.matched_ggpk_bases += 1;
        const nextReqs = formatGgpkRequirements(base.requirements);
        if (nextReqs.length > 0 && (!Array.isArray(row.requirements) || row.requirements.length === 0)) {
          row.requirements = nextReqs;
          const tr = preserveLineTranslations(nextReqs, row.i18n?.requirements, memory);
          row.i18n = row.i18n || {};
          row.i18n.requirements = tr.entries;
          stats.enriched.base_requirements += 1;
          changed = true;
        }
      }

      const misc = miscByName.get(key);
      if (misc) {
        stats.matched_ggpk_misc += 1;
        if (misc.stack_size > 0 && row.menu_key !== "liquid-emotions") {
          const props = Array.isArray(row.properties) ? [...row.properties] : [];
          const hasStack = props.some((p) => /^Stack Size:/i.test(p));
          if (!hasStack) {
            props.unshift(`Stack Size: 1 / ${misc.stack_size}`);
            row.properties = props;
            const tr = preserveLineTranslations(props, row.i18n?.properties, memory);
            row.i18n = row.i18n || {};
            row.i18n.properties = tr.entries;
            stats.enriched.misc_stack_size += 1;
            changed = true;
          }
        }
      }
    }

    if (changed) stats.updated_records += 1;
  }

  const now = new Date().toISOString();

  // 1. Add brand-new live PoB uniques not yet on site (using their base's /2DItems/ icon as fallback).
  // Skip unobtainable/legacy uniques and umbrella entries already covered by named "<Name> of ..." variants.
  const UNOBTAINABLE_SOURCE_RE = /\b(?:no longer obtainable|legacy|removed|unreleased)\b/i;
  for (const [key, pob] of uniqueByName) {
    if (seenUniqueNames.has(key) || existingNames.has(key)) continue;
    if (UNOBTAINABLE_SOURCE_RE.test(String(pob.pob?.source || ""))) continue;
    const variantPrefix = `${key} of `;
    if ([...seenUniqueNames].some((existing) => existing.startsWith(variantPrefix))) continue;
    const menuKey = pob.menu_key || "unique";
    const menu = menuMetaByKey.get(menuKey);
    const baseName = pob.properties?.[0] || "";
    const ggpkBase = baseByName.get(normName(baseName));
    const iconUrl = existingBaseIconByName.get(normName(baseName))
      || (ggpkBase?.icon_dds ? resolveLocalOrCdnIcon(ggpkBase.icon_dds, iconsDir) : "");
    // Keep build_slot_categories only when the icon satisfies /2DItems/ slot checks.
    const slotCategories = iconUrl && /\/2DItems\//i.test(iconUrl) ? (MENU_TO_SLOT_CATEGORIES[menuKey] || []) : [];

    let slug = pob.slug || slugFromName(pob.name);
    if (existingSlugs.has(slug)) slug = `${slug}_unique`;
    if (existingSlugs.has(slug)) continue;
    existingSlugs.add(slug);
    existingNames.add(key);

    const props = baseName ? [baseName] : [];
    const reqs = Array.isArray(pob.requirements) ? pob.requirements : [];
    const mods = Array.isArray(pob.mods) ? pob.mods : [];
    const propsTr = preserveLineTranslations(props, null, memory);
    const reqsTr = preserveLineTranslations(reqs, null, memory);
    const modsTr = preserveLineTranslations(mods, null, memory);
    for (const u of modsTr.untranslated) stats.untranslated.add(u);

    const record = {
      slug,
      menu_key: menuKey,
      menu_label: menu?.label || menuKey,
      group_label: menu?.group_label || "Items",
      name: pob.name,
      source_url: "",
      icon_url: iconUrl,
      icon_alt: pob.name,
      rarity: "unique",
      item_category: menu?.label || menuKey,
      build_slot_categories: slotCategories,
      properties: propsTr.en,
      requirements: reqsTr.en,
      mods: modsTr.en,
      i18n: {
        name: { en: pob.name, vi: pob.name },
        properties: propsTr.entries,
        requirements: reqsTr.entries,
        mods: modsTr.entries
      },
      tooltip_refs: [],
      source_hash: `pob:unique:${slug}`,
      status: "active",
      updated_at: now,
      ...(pob.flavour_text ? { flavour_text: pob.flavour_text } : {}),
      ...(pob.pob?.league ? { league: pob.pob.league } : {}),
      ...(pob.pob?.source ? { drop_source: pob.pob.source } : {})
    };
    items.push(record);
    stats.added_uniques.push({ name: record.name, slug: record.slug, menu_key: menuKey, base: baseName });
  }

  // 2. Add newly released GGPK base equipment items not yet on site.
  for (const [key, base] of baseByName) {
    if (existingNames.has(key) || base.unique_only || base.poe2 === false) continue;
    if (PROTOTYPE_NAME_RE.test(base.name)) continue;
    const menuKey = GGPK_CLASS_TO_MENU[base.item_class];
    if (!menuKey) continue;
    const menu = menuMetaByKey.get(menuKey);
    const iconUrl = base.icon_dds ? resolveLocalOrCdnIcon(base.icon_dds, iconsDir) : "";
    if (!iconUrl || !/\/2DItems\//i.test(iconUrl)) continue;
    const slotCategories = MENU_TO_SLOT_CATEGORIES[menuKey] || [];
    let slug = slugFromName(base.name);
    if (existingSlugs.has(slug)) slug = `${slug}_base`;
    if (existingSlugs.has(slug)) continue;
    existingSlugs.add(slug);
    existingNames.add(key);

    const reqs = formatGgpkRequirements(base.requirements);
    const reqsTr = preserveLineTranslations(reqs, null, memory);
    const record = {
      slug,
      menu_key: menuKey,
      menu_label: menu?.label || base.item_class,
      group_label: menu?.group_label || "Items",
      name: base.name,
      source_url: "",
      icon_url: iconUrl,
      icon_alt: base.name,
      rarity: "normal",
      item_category: menu?.label || base.item_class,
      build_slot_categories: slotCategories,
      properties: [],
      requirements: reqsTr.en,
      mods: [],
      i18n: {
        name: { en: base.name, vi: base.name },
        properties: [],
        requirements: reqsTr.entries,
        mods: []
      },
      tooltip_refs: [],
      source_hash: `ggpk:base:${base.id || slug}`,
      status: "active",
      updated_at: now
    };
    items.push(record);
    stats.added_bases.push({ name: record.name, slug: record.slug, menu_key: menuKey });
  }

  // 3. Add newly released GGPK misc items (currency, omen, essence, augment, tablet, waystone, fragment, key, relic).
  for (const [key, misc] of miscByName) {
    if (existingNames.has(key) || misc.category === "uncut-gem") continue;
    if (PROTOTYPE_NAME_RE.test(misc.name)) continue;
    const menuKey = MISC_CATEGORY_TO_MENU[misc.category];
    if (!menuKey) continue;
    const menu = menuMetaByKey.get(menuKey);
    const iconUrl = misc.icon_dds ? resolveLocalOrCdnIcon(misc.icon_dds, iconsDir) : "";
    let slug = slugFromName(misc.name);
    if (existingSlugs.has(slug)) slug = `${slug}_misc`;
    if (existingSlugs.has(slug)) continue;
    existingSlugs.add(slug);
    existingNames.add(key);

    const props = misc.stack_size > 0 ? [`Stack Size: 1 / ${misc.stack_size}`] : [];
    const mods = Array.isArray(misc.effect_lines) && misc.effect_lines.length
      ? misc.effect_lines
      : (misc.description ? [misc.description] : []);
    const propsTr = preserveLineTranslations(props, null, memory);
    const modsTr = preserveLineTranslations(mods, null, memory);
    for (const u of modsTr.untranslated) stats.untranslated.add(u);

    const record = {
      slug,
      menu_key: menuKey,
      menu_label: menu?.label || misc.category,
      group_label: menu?.group_label || "Currency",
      name: misc.name,
      source_url: "",
      icon_url: iconUrl,
      icon_alt: misc.name,
      rarity: "currency",
      item_category: menu?.label || misc.category,
      build_slot_categories: [],
      properties: propsTr.en,
      requirements: [],
      mods: modsTr.en,
      i18n: {
        name: { en: misc.name, vi: misc.name },
        properties: propsTr.entries,
        requirements: [],
        mods: modsTr.entries
      },
      tooltip_refs: [],
      source_hash: `ggpk:misc:${misc.id || slug}`,
      status: "active",
      updated_at: now
    };
    items.push(record);
    stats.added_misc.push({ name: record.name, slug: record.slug, menu_key: menuKey });
  }

  return {
    bundle: {
      ...siteBundle,
      generated_at: now,
      total: items.length,
      active_total: items.filter((r) => (r.status || "active") === "active").length,
      items
    },
    stats: { ...stats, untranslated: [...stats.untranslated] }
  };
}

/**
 * Merge GGPK misc items into existing currency-data.js bundle.
 */
export function mergeCurrencyBundle(siteBundle, ggpkMiscItems = [], { iconsDir = ICONS_DIR } = {}) {
  const items = (siteBundle.items || []).map((row) => structuredClone(row));
  const miscByName = new Map();
  for (const m of ggpkMiscItems || []) {
    const key = normName(m.name);
    if (!miscByName.has(key)) miscByName.set(key, m);
  }
  const existingNames = new Set(items.map((r) => normName(r.name)));
  const existingSlugs = new Set(items.map((r) => r.slug));

  const stats = {
    existing_total: items.length,
    matched_ggpk: 0,
    updated_records: 0,
    updated_stack_size: 0,
    added: [],
    site_only: []
  };

  for (const row of items) {
    const misc = miscByName.get(normName(row.name));
    if (!misc) {
      stats.site_only.push(row.name);
      continue;
    }
    stats.matched_ggpk += 1;
    let changed = false;
    if (misc.stack_size > 0) {
      const expected = `1 / ${misc.stack_size}`;
      if (!row.stack_size) {
        row.stack_size = expected;
        stats.updated_stack_size += 1;
        changed = true;
      }
    }
    if (changed) stats.updated_records += 1;
  }

  // Add newly released GGPK essences or stackable currencies not yet in currency-data.js.
  const now = new Date().toISOString();
  for (const [key, misc] of miscByName) {
    if (existingNames.has(key)) continue;
    if (misc.category !== "essence" && misc.category !== "currency") continue;
    if (PROTOTYPE_NAME_RE.test(misc.name)) continue;
    // Only add currencies that carry a real description or essence effect lines (avoid internal tokens).
    const desc = String(misc.description || "").trim();
    const effects = Array.isArray(misc.effect_lines) ? misc.effect_lines : [];
    if (!desc && !effects.length) continue;
    // Skip items already represented only in items-data.js (like Liquid Emotions, Catalysts, Incubators) unless Essence/Orb.
    const isEssence = misc.category === "essence";
    const isOrb = /\b(Orb|Scroll|Shard|Splinter|Mirror|Bauble|Whetstone|Scrap|Etcher|Prism|Artificer)\b/i.test(misc.name);
    if (!isEssence && !isOrb) continue;

    let slug = slugFromName(misc.name);
    if (existingSlugs.has(slug)) continue;
    existingSlugs.add(slug);
    existingNames.add(key);

    const iconUrl = misc.icon_dds ? resolveLocalOrCdnIcon(misc.icon_dds, iconsDir) : "";
    const stackSize = misc.stack_size > 0 ? `1 / ${misc.stack_size}` : "";
    const mods = effects.length ? effects : (desc ? [desc] : []);
    const row = {
      slug,
      name: misc.name,
      category: isEssence ? "Essence" : "StackableCurrencyItem",
      category_label: isEssence ? "Essence" : "Currency",
      family: isEssence ? "essence" : "crafting-orb",
      family_label: isEssence ? "Essence" : "Crafting Orb",
      subtype: isEssence ? "essence" : "currency",
      subtype_label: isEssence ? "Essence" : "Currency",
      source_url: "",
      icon_url: iconUrl,
      icon_alt: misc.name,
      hover_url: "",
      stack_size: stackSize,
      description_en: desc,
      properties: stackSize ? [`Stack Size: ${stackSize}`] : [],
      mods,
      related_items: [],
      i18n: {
        name: { en: misc.name, vi: misc.name },
        description: { en: desc, vi: "" },
        mods: mods.map((m) => ({ en: m, vi: "" }))
      },
      source_hash: `ggpk:currency:${misc.id || slug}`,
      status: "active",
      updated_at: now
    };
    items.push(row);
    stats.added.push({ name: row.name, slug: row.slug, category: row.category });
  }

  return {
    bundle: {
      ...siteBundle,
      generated_at: now,
      total: items.length,
      active_total: items.filter((r) => (r.status || "active") === "active").length,
      items
    },
    stats
  };
}

export function renderMarkdownReport(report) {
  const lines = [
    "# Season SOT Sync Report",
    "",
    `- Generated at: \`${report.generated_at}\``,
    `- Mode: \`${report.applied ? "APPLIED to public/data/*.js" : "DRY RUN (no files written)"}\``,
    `- PoB source: \`${report.sources.pob_commit || "unknown"}\` (${report.sources.pob_gems} gems, ${report.sources.pob_uniques} uniques)`,
    `- GGPK source: \`${report.sources.ggpk_fingerprint || "unknown"}\` (${report.sources.ggpk_gems} gems, ${report.sources.ggpk_base_items} bases, ${report.sources.ggpk_misc_items} misc items)`,
    "",
    "## Skill Gems (`public/data/skill-gems-data.js`)",
    "",
    `- Existing: ${report.skill_gems.existing_total} | Matched PoB: ${report.skill_gems.matched_pob} | Matched GGPK: ${report.skill_gems.matched_ggpk}`,
    `- Records updated: **${report.skill_gems.updated_records}** (official_id: ${report.skill_gems.fields_updated.official_id}, tier: ${report.skill_gems.fields_updated.tier}, tags: ${report.skill_gems.fields_updated.tags}, color: ${report.skill_gems.fields_updated.color}, flavour_text: ${report.skill_gems.fields_updated.flavour_text}, mods/sections: ${report.skill_gems.fields_updated.mods_sections || 0})`,
    `- Brand-new gems added from PoB: **${report.skill_gems.added.length}**`,
    ...(report.skill_gems.added.map((g) => `  - \`${g.name}\` (${g.gem_type}, slug \`${g.slug}\`, id \`${g.official_id || "-"}\`)`)),
    `- Brand-new gems added from GGPK (ahead of PoB): **${(report.skill_gems.added_from_ggpk || []).length}**`,
    ...((report.skill_gems.added_from_ggpk || []).map((g) => `  - \`${g.name}\` (${g.gem_type}, slug \`${g.slug}\`, id \`${g.official_id || "-"}\`)`)),
    ...(report.skill_gems.skipped_unreleased?.length
      ? [`- Skipped prototype/unreleased gems: ${report.skill_gems.skipped_unreleased.join(", ")}`]
      : []),
    `- Untranslated new English lines: **${report.skill_gems.untranslated.length}**`,
    "",
    "## Items (`public/data/items-data.js`)",
    "",
    `- Existing: ${report.items.existing_total} | Matched PoB uniques: ${report.items.matched_pob_uniques} | Matched GGPK bases: ${report.items.matched_ggpk_bases} | Matched GGPK misc: ${report.items.matched_ggpk_misc}`,
    `- Records enriched: **${report.items.updated_records}** (flavour_text: ${report.items.enriched.flavour_text}, league: ${report.items.enriched.league}, drop_source: ${report.items.enriched.drop_source}, base_requirements: ${report.items.enriched.base_requirements}, misc_stack_size: ${report.items.enriched.misc_stack_size})`,
    `- Brand-new PoB uniques added: **${(report.items.added_uniques || []).length}**`,
    ...((report.items.added_uniques || []).map((u) => `  - \`${u.name}\` (${u.base || u.menu_key})`)),
    `- Brand-new GGPK base items added: **${(report.items.added_bases || []).length}**`,
    ...((report.items.added_bases || []).map((b) => `  - \`${b.name}\` (${b.menu_key})`)),
    `- Brand-new GGPK misc items added: **${(report.items.added_misc || []).length}**`,
    ...((report.items.added_misc || []).map((m) => `  - \`${m.name}\` (${m.menu_key})`)),
    "",
    "## Currency (`public/data/currency-data.js`)",
    "",
    `- Existing: ${report.currency.existing_total} | Matched GGPK: ${report.currency.matched_ggpk} | Updated: ${report.currency.updated_records} | Added: ${(report.currency.added || []).length}`,
    ...((report.currency.added || []).map((c) => `  - \`${c.name}\` (${c.category})`)),
    `- Site-only (not in GGPK release set): ${report.currency.site_only.length} (${report.currency.site_only.join(", ") || "none"})`,
    ""
  ];
  const allUntranslated = [...new Set([...(report.skill_gems.untranslated || []), ...(report.items.untranslated || [])])];
  if (allUntranslated.length) {
    lines.push("## Untranslated English lines to review", "");
    for (const line of allUntranslated.slice(0, 80)) {
      lines.push(`- ${line}`);
    }
    if (allUntranslated.length > 80) {
      lines.push(`- ... and ${allUntranslated.length - 80} more (see data/sot-sync-report.json)`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const readJsonIfExists = (filePath) => (fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null);

const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export function runSotSync(args = new Map()) {
  const apply = args.has("apply") && !args.has("dry-run");
  const overwriteMods = args.has("overwrite-mods");
  const pobGemsDoc = readJsonIfExists(path.join(POB_EXTRACT_DIR, "skill-gems.generated.json"));
  const pobUniquesDoc = readJsonIfExists(path.join(POB_EXTRACT_DIR, "uniques.generated.json"));
  const ggpkGemsDoc = readJsonIfExists(path.join(GGPK_EXTRACT_DIR, "gems.json"));
  const ggpkBasesDoc = readJsonIfExists(path.join(GGPK_EXTRACT_DIR, "base-items.json"));
  const ggpkMiscDoc = readJsonIfExists(path.join(GGPK_EXTRACT_DIR, "misc-items.json"));

  if (!pobGemsDoc || !pobUniquesDoc) {
    throw new Error("Missing PoB extract under data/pob-extract/. Run `node scripts/pob-data/generate.mjs --dump` first.");
  }

  const skillBundle = loadWindowBundle(path.join(DATA_DIR, "skill-gems-data.js"));
  const itemsBundle = loadWindowBundle(path.join(DATA_DIR, "items-data.js"));
  const currencyBundle = loadWindowBundle(path.join(DATA_DIR, "currency-data.js"));

  const mergedSkills = mergeSkillGemsBundle(skillBundle.data, pobGemsDoc.gems || [], ggpkGemsDoc?.gems || [], { overwriteMods });
  const mergedItems = mergeItemsBundle(itemsBundle.data, {
    pobUniques: pobUniquesDoc.items || [],
    ggpkBaseItems: ggpkBasesDoc?.items || [],
    ggpkMiscItems: ggpkMiscDoc?.items || [],
    overwriteMods
  });
  const mergedCurrency = mergeCurrencyBundle(currencyBundle.data, ggpkMiscDoc?.items || []);

  if (apply) {
    writeWindowBundle(path.join(DATA_DIR, "skill-gems-data.js"), skillBundle.globalName, mergedSkills.bundle);
    writeWindowBundle(path.join(DATA_DIR, "items-data.js"), itemsBundle.globalName, mergedItems.bundle);
    writeWindowBundle(path.join(DATA_DIR, "currency-data.js"), currencyBundle.globalName, mergedCurrency.bundle);
  }

  const report = {
    generated_at: new Date().toISOString(),
    applied: apply,
    sources: {
      pob_commit: pobGemsDoc.pob_commit || pobUniquesDoc.pob_commit || null,
      pob_gems: (pobGemsDoc.gems || []).length,
      pob_uniques: (pobUniquesDoc.items || []).length,
      ggpk_fingerprint: ggpkMiscDoc?.data_fingerprint || ggpkBasesDoc?.data_fingerprint || null,
      ggpk_gems: (ggpkGemsDoc?.gems || []).length,
      ggpk_base_items: (ggpkBasesDoc?.items || []).length,
      ggpk_misc_items: (ggpkMiscDoc?.items || []).length
    },
    skill_gems: mergedSkills.stats,
    items: mergedItems.stats,
    currency: mergedCurrency.stats
  };

  fs.mkdirSync(path.dirname(DEFAULT_REPORT_JSON), { recursive: true });
  fs.writeFileSync(DEFAULT_REPORT_JSON, JSON.stringify(report, null, 2));
  const mdPath = args.get("report") ? path.resolve(args.get("report")) : DEFAULT_REPORT_MD;
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, renderMarkdownReport(report), "utf8");
  return report;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const report = runSotSync(parseCliArgs());
    console.log(JSON.stringify({
      applied: report.applied,
      sources: report.sources,
      skill_gems: {
        updated: report.skill_gems.updated_records,
        added_pob: report.skill_gems.added.length,
        added_ggpk: report.skill_gems.added_from_ggpk.length,
        skipped_unreleased: report.skill_gems.skipped_unreleased.length,
        fields_updated: report.skill_gems.fields_updated,
        untranslated_lines: report.skill_gems.untranslated.length
      },
      items: {
        updated: report.items.updated_records,
        enriched: report.items.enriched,
        added_uniques: report.items.added_uniques.length,
        added_bases: report.items.added_bases.length,
        added_misc: report.items.added_misc.length
      },
      currency: {
        matched: report.currency.matched_ggpk,
        updated: report.currency.updated_records,
        added: report.currency.added.length,
        site_only: report.currency.site_only.length
      }
    }, null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

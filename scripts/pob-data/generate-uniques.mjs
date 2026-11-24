// Parse PoB's unique item text (src/Data/Uniques/*.lua, dumped by scripts/pob-data/dump.mjs)
// and build records shaped like the unique rows of public/data/items-data.js.
// Pure functions; nothing here reads or writes files.
import { formatG, slugFromName, toSiteRanges } from "./generate-gems.mjs";

// "Key: value" lines PoB puts between the base type and the mods (Classes/Item.lua ParseRaw).
const HEADER_KEYS = new Set([
  "Variant", "League", "Source", "Implicits", "Version", "Sockets", "Limited to", "Radius", "Crafted",
  "Has Alt Variant", "Has Alt Variant Two", "Has Alt Variant Three", "Has Alt Variant Four", "Has Alt Variant Five",
  "Selected Variant", "Selected Alt Variant", "Selected Alt Variant Two", "Selected Alt Variant Three",
  "Selected Alt Variant Four", "Selected Alt Variant Five", "Allow Duplicate Variants", "Grants Skill",
  "Left ring slot", "Right ring slot", "Quality", "Item Level", "LevelReq", "Unique ID", "Spirit", "Rune", "Evasion",
  "Armour", "Energy Shield", "Ward", "Charm Slots", "Talisman Tier", "Upgrade", "Catalyst"
]);

/** Split "{variant:1,2}{tags:fire}text" into its tag map and the bare text. */
export const parseModLine = (line) => {
  const tags = {};
  let text = line;
  for (;;) {
    const match = text.match(/^\{([a-zA-Z]+):?([^}]*)\}/);
    if (!match) break;
    tags[match[1]] = match[2];
    text = text.slice(match[0].length);
  }
  const out = { text: text.trim() };
  if (tags.variant !== undefined) out.variants = tags.variant.split(",").map(Number).filter(Number.isFinite);
  if (tags.tags) out.tags = tags.tags.split(",");
  for (const key of Object.keys(tags)) {
    if (key !== "variant" && key !== "tags") (out.extra ||= {})[key] = tags[key];
  }
  return out;
};

/**
 * Parse one unique as PoB stores it:
 *   name / base type / header lines / [Implicits: N + N implicit lines] / explicit mods.
 * The base type can follow the "Variant:" lines and can differ per variant
 * ("{variant:1}Ironclad Vestments" / "{variant:2}Plated Vestments"); `isBase(name)` tells a
 * base type line from a mod line in that case. Without it, the second line is the base.
 */
export const parseUniqueText = (raw, { isBase } = {}) => {
  const lines = String(raw).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const item = {
    name: lines[0] || "",
    base: "",
    bases: [],
    variants: [],
    league: null,
    source: null,
    level_requirement: null,
    grants_skills: [],
    headers: {},
    implicits: [],
    explicits: []
  };
  let implicitsLeft = 0;
  let sawImplicits = false;
  lines.slice(1).forEach((line, index) => {
    if (implicitsLeft > 0) {
      item.implicits.push(parseModLine(line));
      implicitsLeft -= 1;
      return;
    }
    const mod = parseModLine(line);
    // "Grants Skill: ..." is a header for PoB but a visible line on the item, so it stays a mod.
    const header = mod.text.match(/^([A-Z][A-Za-z ]*?): ?(.*)$/);
    if (header && HEADER_KEYS.has(header[1]) && header[1] !== "Grants Skill") {
      const [, key, value] = header;
      if (key === "Variant") item.variants.push(value);
      else if (key === "League") item.league = value;
      else if (key === "Source") item.source = value;
      else if (key === "Implicits") {
        implicitsLeft = Number(value) || 0;
        sawImplicits = true;
      } else item.headers[key] = value;
      return;
    }
    const pastHeader = sawImplicits || item.explicits.length > 0;
    if (!pastHeader && (isBase ? isBase(mod.text) : index === 0)) {
      item.bases.push({ name: mod.text, variants: mod.variants || null });
      return;
    }
    const level = mod.text.match(/^Requires Level (\d+)/);
    if (level && !pastHeader) {
      item.level_requirement = Number(level[1]);
      return;
    }
    item.explicits.push(mod);
  });
  // PoB's own fallback when nothing on line 2 is a known base type: treat it as the base anyway.
  if (!item.bases.length && lines[1]) {
    const first = parseModLine(lines[1]);
    item.bases.push({ name: first.text, variants: first.variants || null });
    item.explicits = item.explicits.filter((mod) => mod.text !== first.text);
  }
  item.base = item.bases[0]?.name || "";
  item.grants_skills = [...item.implicits, ...item.explicits].filter((mod) => mod.text.startsWith("Grants Skill: ")).map((mod) => mod.text.slice("Grants Skill: ".length));
  return item;
};

/** Base type of a variant; PoB sometimes forgets to list the newest variant, then the last base applies. */
export const baseForVariant = (item, index) =>
  (item.bases.find((base) => !base.variants || index === null || base.variants.includes(index)) || item.bases[item.bases.length - 1])?.name || "";

/** The site writes negative ranges as "(-40—-30)%"; PoB as "-(40-30)%". */
export const uniqueModText = (text) =>
  toSiteRanges(String(text).replace(/-\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/g, "(-$1--$2)"));

/**
 * Which variant the site should show. PoB lists patch versions oldest first and names the live
 * one "Current"; when no variant is called "Current" the variants are options of one item
 * (slot, roll pool...), and PoB's own default (Selected Variant, else the last one) is used.
 */
export const pickVariant = (item) => {
  if (!item.variants.length) return { index: null, kind: "none" };
  const current = item.variants.findIndex((name) => /^current$/i.test(name));
  if (current >= 0) {
    // Items with both patch versions and options (e.g. "Current" plus slot variants) stay "versioned".
    return { index: current + 1, kind: "versioned" };
  }
  const selected = Number(item.headers["Selected Variant"]);
  return { index: Number.isFinite(selected) && selected > 0 ? selected : item.variants.length, kind: "options" };
};

const inVariant = (mod, index) => !mod.variants || index === null || mod.variants.includes(index);

/**
 * PoB wraps some long mods over two text lines (the second starts lower-case and carries the
 * same tags). The site keeps one mod per line, so glue those back together.
 */
export const joinWrappedMods = (texts) => {
  const out = [];
  for (const text of texts) {
    if (out.length && /^[a-z]/.test(text)) out[out.length - 1] += ` ${text}`;
    else out.push(text);
  }
  return out;
};

const MENU_KEYS = {
  "Body Armour": "body-armours", Boots: "boots", Gloves: "gloves", Helmet: "helmets", Belt: "belts",
  Amulet: "amulets", Ring: "rings", Jewel: "jewels", Focus: "foci", Quiver: "quivers", Shield: "shields",
  "One Hand Mace": "one-hand-maces", "Two Hand Mace": "two-hand-maces", "One Hand Sword": "one-hand-swords",
  "Two Hand Sword": "two-hand-swords", "One Hand Axe": "one-hand-axes", "Two Hand Axe": "two-hand-axes",
  Sceptre: "sceptres", Spear: "spears", Wand: "wands", Bow: "bows", Crossbow: "crossbows", Staff: "staves",
  Talisman: "talismans", Charm: "charms", Flask: "flasks", Dagger: "daggers", Claw: "claws", Flail: "flails"
};

export const menuKeyForBase = (base) => {
  if (!base) return null;
  if (base.type === "Shield" && base.subType === "Evasion") return "bucklers";
  if (base.type === "Staff" && base.subType === "Warstaff") return "quarterstaves";
  if (base.type === "Flask" && base.subType === "Life") return "life-flasks";
  if (base.type === "Flask" && base.subType === "Mana") return "mana-flasks";
  return MENU_KEYS[base.type] || null;
};

export const buildUniqueRequirements = (item, base) => {
  const req = base?.req || {};
  const level = item.level_requirement ?? req.level ?? null;
  const parts = [];
  if (level) parts.push(`Level ${level}`);
  for (const [label, key] of [["Str", "str"], ["Dex", "dex"], ["Int", "int"]]) {
    if (req[key]) parts.push(`${formatG(req[key])} ${label}`);
  }
  return parts.length ? [`Requires: ${parts.join(", ")}`] : [];
};

export const buildUniqueRecord = (entry, bases, flavourByName) => {
  const item = parseUniqueText(entry.raw, { isBase: (name) => Object.hasOwn(bases, name) });
  const variant = pickVariant(item);
  const baseName = baseForVariant(item, variant.index);
  const base = bases[baseName] || null;
  const lines = (mods) => joinWrappedMods(mods.filter((mod) => inVariant(mod, variant.index)).map((mod) => uniqueModText(mod.text)));
  const implicits = lines(item.implicits);
  const explicits = lines(item.explicits);
  const flavour = flavourByName.get(item.name) || null;
  return {
    slug: slugFromName(item.name),
    menu_key: menuKeyForBase(base),
    name: item.name,
    rarity: "unique",
    properties: [baseName],
    requirements: buildUniqueRequirements(item, base),
    mods: [...implicits, ...explicits],
    flavour_text: flavour ? flavour.text.join("\n") : null,
    // Not site fields: what PoB knows beyond the site's current shape.
    pob: {
      group: entry.group,
      base_type: base?.type || null,
      base_sub_type: base?.subType || null,
      base_known: Boolean(base),
      implicit_count: implicits.length,
      league: item.league,
      source: item.source,
      grants_skills: item.grants_skills,
      variant_kind: variant.kind,
      shown_variant: variant.index ? item.variants[variant.index - 1] : null,
      variants: item.variants,
      bases: item.bases,
      variant_mods: item.variants.map((name, index) => ({
        name,
        mods: [
          ...joinWrappedMods(item.implicits.filter((mod) => inVariant(mod, index + 1)).map((mod) => uniqueModText(mod.text))),
          ...joinWrappedMods(item.explicits.filter((mod) => inVariant(mod, index + 1)).map((mod) => uniqueModText(mod.text)))
        ]
      })),
      flavour_id: flavour?.id || null
    }
  };
};

export const buildUniqueRecords = ({ uniques, bases, flavourText }) => {
  const flavourByName = new Map();
  for (const entry of flavourText || []) if (entry?.name && !flavourByName.has(entry.name)) flavourByName.set(entry.name, entry);
  return uniques.map((entry) => buildUniqueRecord(entry, bases, flavourByName));
};

// Crafting engine for the PoE2-style craft simulator.
// Pure logic — rolls mods from a craft pool (craft-data.js) respecting the
// 6-modifier rule (3 prefix / 3 suffix), one-mod-per-family, and ilvl gates.

export type Gen = "prefix" | "suffix";
export type Rarity = "normal" | "magic" | "rare";

export interface ModTier { name: string | null; ilvl: number; weight: number; min: number | null; max: number | null; text: string; }
export interface ModFamily { family: string; gen: Gen; tags: string[]; spawn: string[]; tiers: ModTier[]; }
export interface CraftPool { label: string; item_class?: string; attr?: string | null; prefixes: ModFamily[]; suffixes: ModFamily[]; }

export interface RolledMod {
  family: string; gen: Gen; tags: string[];
  tierIndex: number;       // index within family.tiers (0 = lowest ilvl)
  tierLabel: number;       // human tier number (T1 = highest)
  name: string | null;
  value: number | null;    // rolled numeric value (within min..max)
  min: number | null; max: number | null; // tier range (for re-rolling with Divine)
  template: string;        // original text with the (a—b) range placeholder
  text: string;            // display text with rolled value substituted
  fractured?: boolean;
}

export interface CraftItem {
  baseName: string; icon: string | null; attr: string | null; itemClass: string;
  ilvl: number; implicit: string | null;
  rarity: Rarity; corrupted: boolean;
  craftKey: string;
  mods: RolledMod[];
  _cn?: string; // transient: currency display name for floor logic
}

const rint = (lo: number, hi: number) => Math.floor(lo + Math.random() * (hi - lo + 1));
const rnum = (lo: number, hi: number) => {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  if (Number.isInteger(a) && Number.isInteger(b)) return rint(a, b);
  return Math.round((a + Math.random() * (b - a)) * 100) / 100;
};
const pickIndexWeighted = (weights: number[]): number => {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return -1;
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i += 1) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
};

const countGen = (item: CraftItem, gen: Gen) => item.mods.filter((m) => m.gen === gen).length;
const hasFamily = (item: CraftItem, family: string) => item.mods.some((m) => m.family === family);

const RANGE_RE = /\(\s*(-?[\d.]+)\s*[—–-]\s*(-?[\d.]+)\s*\)/g;

const substituteValue = (text: string, value: number | null): string => {
  if (RANGE_RE.test(text)) {
    RANGE_RE.lastIndex = 0;
    let first = true;
    return text.replace(RANGE_RE, (_match, loStr, hiStr) => {
      if (first && value != null) {
        first = false;
        return String(value);
      }
      first = false;
      return String(rnum(Number(loStr), Number(hiStr)));
    });
  }
  if (value == null) return text;
  return text.replace(/\(?\s*[\d.]+\s*[—–-]\s*[\d.]+\s*\)?/, String(value));
};

// Build a rolled mod from a family + chosen tier.
const rollFromFamily = (family: ModFamily, tierIndex: number): RolledMod => {
  const tier = family.tiers[tierIndex];
  const value = tier.min != null && tier.max != null ? rnum(tier.min, tier.max) : null;
  return {
    family: family.family, gen: family.gen, tags: family.tags,
    tierIndex,
    tierLabel: family.tiers.length - tierIndex, // highest ilvl tier -> T1
    name: tier.name, value, min: tier.min, max: tier.max,
    template: tier.text,
    text: substituteValue(tier.text, value)
  };
};

// Candidate (family, tierIndex) pairs eligible to be added, with weights.
const candidates = (pool: CraftPool, item: CraftItem, gen: Gen | null, floor: number) => {
  const out: { family: ModFamily; tierIndex: number; weight: number }[] = [];
  const sideCap = item.rarity === "magic" ? 1 : 3; // Magic = 1 prefix + 1 suffix; Rare = 3 + 3
  const consider = (families: ModFamily[]) => {
    for (const fam of families) {
      if (hasFamily(item, fam.family)) continue;
      if (countGen(item, fam.gen) >= sideCap) continue;
      // pick the highest-ilvl tier that is <= item ilvl and >= floor (the tier the game would roll within the eligible band)
      const eligible = fam.tiers.filter((t) => t.ilvl <= item.ilvl && t.ilvl >= floor && t.weight > 0);
      if (!eligible.length) continue;
      // each eligible tier competes by its own weight
      for (const t of eligible) {
        out.push({ family: fam, tierIndex: fam.tiers.indexOf(t), weight: t.weight });
      }
    }
  };
  if (gen === null || gen === "prefix") consider(pool.prefixes);
  if (gen === null || gen === "suffix") consider(pool.suffixes);
  return out;
};

const addRandomMod = (pool: CraftPool, item: CraftItem, gen: Gen | null, floor = 0): boolean => {
  const cand = candidates(pool, item, gen, floor);
  if (!cand.length) return false;
  const idx = pickIndexWeighted(cand.map((c) => c.weight));
  if (idx < 0) return false;
  item.mods.push(rollFromFamily(cand[idx].family, cand[idx].tierIndex));
  return true;
};

const removableMods = (item: CraftItem) => item.mods.filter((m) => !m.fractured);
const removeRandomMod = (item: CraftItem): boolean => {
  const rem = removableMods(item);
  if (!rem.length) return false;
  const victim = rem[rint(0, rem.length - 1)];
  item.mods = item.mods.filter((m) => m !== victim);
  return true;
};

export interface CurrencySpec {
  id: string;             // matches a substring/key
  match: RegExp;          // match against currency display name
  label: string;
  desc: string;           // in-game effect (description_en) the condition is derived from
  action: (pool: CraftPool, item: CraftItem) => string | null; // returns error msg or null on success
}

const requireRarity = (item: CraftItem, ...r: Rarity[]) => r.includes(item.rarity);

// Mod-slot caps from the rarity rules: Magic = 1 prefix + 1 suffix (2 total),
// Rare = 3 prefix + 3 suffix (6 total). A white item carries no affixes.
const modCap = (rarity: Rarity) => (rarity === "rare" ? 6 : rarity === "magic" ? 2 : 0);
const isFull = (item: CraftItem) => item.mods.length >= modCap(item.rarity);

// Higher-grade orb variants only roll higher-ilvl mods. Basic orbs have no floor.
// (Greater/Perfect floors are community estimates; basic currencies = 0.)
const floorFor = (name: string) => {
  if (/^Perfect /i.test(name)) return /Transmut|Augment/i.test(name) ? 70 : 50;
  if (/^Greater /i.test(name)) return 35;
  return 0;
};

// Fill an item up to `target` modifiers (used by Alchemy: result = 4 mods).
const fillTo = (pool: CraftPool, item: CraftItem, target: number, floor: number) => {
  let guard = 0;
  while (item.mods.length < target && item.mods.length < modCap(item.rarity) && guard < 20) {
    if (!addRandomMod(pool, item, null, floor)) break;
    guard += 1;
  }
};

// Conditions below mirror each currency's in-game description (description_en).
export const CURRENCIES: CurrencySpec[] = [
  { id: "transmute", label: "Transmutation", match: /Orb of Transmutation/i,
    desc: "Upgrades a Normal item to a Magic item with 1 modifier",
    action: (pool, item) => {
      if (!requireRarity(item, "normal")) return "Chỉ dùng trên item Normal (trắng)";
      item.rarity = "magic";
      return addRandomMod(pool, item, null, floorFor(item._cn || "")) ? null : "Không còn mod hợp lệ";
    } },
  { id: "augment", label: "Augmentation", match: /Orb of Augmentation/i,
    desc: "Augments a Magic item with a new random modifier",
    action: (pool, item) => {
      if (!requireRarity(item, "magic")) return "Chỉ dùng trên item Magic";
      if (isFull(item)) return "Item Magic đã đủ 2 mod";
      return addRandomMod(pool, item, null, floorFor(item._cn || "")) ? null : "Không còn mod hợp lệ";
    } },
  { id: "regal", label: "Regal", match: /Regal Orb/i,
    desc: "Upgrades a Magic item to a Rare item, adding 1 modifier",
    action: (pool, item) => {
      if (!requireRarity(item, "magic")) return "Chỉ dùng trên item Magic";
      item.rarity = "rare";
      return addRandomMod(pool, item, null, floorFor(item._cn || "")) ? null : "Không còn mod hợp lệ";
    } },
  { id: "alchemy", label: "Alchemy", match: /Orb of Alchemy/i,
    desc: "Upgrades a Normal or Magic item to a Rare item with 4 random modifiers",
    action: (pool, item) => {
      if (requireRarity(item, "rare")) return "Chỉ dùng trên item Normal/Magic";
      item.rarity = "rare";
      fillTo(pool, item, 4, floorFor(item._cn || ""));
      return null;
    } },
  { id: "exalted", label: "Exalted", match: /Exalted Orb/i,
    desc: "Augments a Rare item with a new random modifier",
    action: (pool, item) => {
      if (!requireRarity(item, "rare")) return "Chỉ dùng trên item Rare";
      if (isFull(item)) return "Item đã đủ 6 mod";
      return addRandomMod(pool, item, null, floorFor(item._cn || "")) ? null : "Không còn ô/mod hợp lệ";
    } },
  { id: "chaos", label: "Chaos", match: /Chaos Orb/i,
    desc: "Removes a random modifier and augments a Rare item with a new random modifier",
    action: (pool, item) => {
      if (!requireRarity(item, "rare")) return "Chỉ dùng trên item Rare";
      if (!removeRandomMod(item)) return "Không có mod để xóa";
      addRandomMod(pool, item, null, floorFor(item._cn || ""));
      return null;
    } },
  { id: "annul", label: "Annulment", match: /Orb of Annulment/i,
    desc: "Removes a random modifier from an item",
    action: (_pool, item) => {
      if (!requireRarity(item, "magic", "rare")) return "Dùng trên Magic/Rare";
      return removeRandomMod(item) ? null : "Không có mod để xóa";
    } },
  { id: "divine", label: "Divine", match: /Divine Orb/i,
    desc: "Randomises the numeric values of modifiers on an item",
    action: (_pool, item) => {
      if (!item.mods.length) return "Item chưa có mod để roll lại";
      for (const m of item.mods) {
        if (m.min != null && m.max != null) { m.value = rint(m.min, m.max); m.text = substituteValue(m.template, m.value); }
      }
      return null;
    } },
  { id: "vaal", label: "Vaal (Corrupt)", match: /Vaal Orb/i,
    desc: "Corrupts an item, modifying it unpredictably",
    action: (pool, item) => {
      if (item.corrupted) return "Item đã bị corrupt";
      item.corrupted = true;
      const roll = Math.random();
      if (roll < 0.25 && item.mods.length) removeRandomMod(item);
      else if (roll < 0.5 && !isFull(item) && item.rarity === "rare") addRandomMod(pool, item, null, 0);
      // else: unchanged (cosmetic corrupt)
      return null;
    } }
];

export const findCurrency = (name: string): CurrencySpec | null =>
  CURRENCIES.find((c) => c.match.test(name)) || null;

export const applyCurrency = (spec: CurrencySpec, displayName: string, pool: CraftPool, item: CraftItem): string | null => {
  if (item.corrupted) return "Item đã bị Corrupt — không thể craft nữa";
  item._cn = displayName;
  const err = spec.action(pool, item);
  delete item._cn;
  return err;
};

export const prefixCount = (item: CraftItem) => countGen(item, "prefix");
export const suffixCount = (item: CraftItem) => countGen(item, "suffix");

// ── PoB item-mods-data.js adapter (replaces poe2db craft-data.js + craft-index.js) ──

export interface CraftBaseEntry {
  name: string;
  slug: string;
  icon: string | null;
  attr: string | null;
  req_level: number;
  craft_key: string;
  implicit: string | null;
}
export interface CraftClassEntry {
  label: string;
  attr_split: boolean;
  base_count: number;
  bases: CraftBaseEntry[];
}
export interface CraftGroupEntry {
  group: string;
  classes: CraftClassEntry[];
}

const POB_CRAFT_GROUPS: Array<{ group: string; types: Array<{ type: string; subType?: string; label: string }> }> = [
  {
    group: "Armour",
    types: [
      { type: "Body Armour", label: "Body Armours" },
      { type: "Helmet", label: "Helmets" },
      { type: "Gloves", label: "Gloves" },
      { type: "Boots", label: "Boots" }
    ]
  },
  {
    group: "Off-hand",
    types: [
      { type: "Shield", subType: "Evasion", label: "Bucklers" },
      { type: "Shield", label: "Shields" },
      { type: "Focus", label: "Foci" },
      { type: "Quiver", label: "Quivers" }
    ]
  },
  {
    group: "One Handed Weapons",
    types: [
      { type: "Wand", label: "Wands" },
      { type: "Sceptre", label: "Sceptres" },
      { type: "One Handed Mace", label: "One Hand Maces" },
      { type: "Spear", label: "Spears" },
      { type: "One Handed Sword", label: "One Hand Swords" },
      { type: "One Handed Axe", label: "One Hand Axes" },
      { type: "Dagger", label: "Daggers" },
      { type: "Claw", label: "Claws" },
      { type: "Flail", label: "Flails" }
    ]
  },
  {
    group: "Two Handed Weapons",
    types: [
      { type: "Bow", label: "Bows" },
      { type: "Crossbow", label: "Crossbows" },
      { type: "Staff", subType: "Warstaff", label: "Quarterstaves" },
      { type: "Staff", label: "Staves" },
      { type: "Two Handed Mace", label: "Two Hand Maces" },
      { type: "Two Handed Sword", label: "Two Hand Swords" },
      { type: "Two Handed Axe", label: "Two Hand Axes" },
      { type: "Talisman", label: "Talismans" }
    ]
  },
  {
    group: "Jewellery",
    types: [
      { type: "Amulet", label: "Amulets" },
      { type: "Ring", label: "Rings" }
    ]
  },
  { group: "Belt", types: [{ type: "Belt", label: "Belts" }] },
  {
    group: "Flasks",
    types: [
      { type: "Flask", subType: "Life", label: "Life Flasks" },
      { type: "Flask", subType: "Mana", label: "Mana Flasks" },
      { type: "Charm", label: "Charms" }
    ]
  },
  { group: "Jewels", types: [{ type: "Jewel", label: "Jewels" }] }
];

const firstRange = (text: string): [number | null, number | null] => {
  const m = text.match(/\(\s*(-?[\d.]+)\s*[—–-]\s*(-?[\d.]+)\s*\)/);
  if (!m) return [null, null];
  return [Number(m[1]), Number(m[2])];
};

const attrFromPobArmour = (armour?: Record<string, number>): string | null => {
  if (!armour) return null;
  const parts: string[] = [];
  if (armour.Armour) parts.push("Str");
  if (armour.Evasion) parts.push("Dex");
  if (armour.EnergyShield) parts.push("Int");
  return parts.length ? parts.join("/") : null;
};

/**
 * Build CraftSimPage's category tree + CraftPool map straight from PoB's item-mods-data.js
 * (window.POE2_ITEM_MODS) + items-data.js (for self-hosted base icons).
 */
export function buildCraftSimFromPob(
  itemModsData: {
    mods?: Array<[string, string, string, number, string[], string]>;
    classes?: Array<{ type: string; table: string; normal: number[]; nw?: number[] }>;
    bases?: Array<{
      n: string; c: number; t: string; st?: string; i?: string[]; r?: number[]; a?: Record<string, number>; h?: number;
    }>;
  },
  itemsData: Array<{ name?: string; slug?: string; icon_url?: string; rarity?: string }> = []
): { tree: CraftGroupEntry[]; classes: Record<string, CraftPool> } {
  const iconByName = new Map<string, { icon: string | null; slug: string }>();
  for (const row of itemsData || []) {
    if (!row?.name || String(row.rarity || "").toLowerCase() === "unique") continue;
    const key = row.name.trim().toLowerCase();
    if (!iconByName.has(key)) iconByName.set(key, { icon: row.icon_url || null, slug: row.slug || "" });
  }

  const classes: Record<string, CraftPool> = {};
  const rawMods = itemModsData?.mods || [];
  const rawClasses = itemModsData?.classes || [];

  for (let classIdx = 0; classIdx < rawClasses.length; classIdx += 1) {
    const cls = rawClasses[classIdx];
    const normal = cls.normal || [];
    const weights = cls.nw || [];
    const prefixMap = new Map<string, ModFamily>();
    const suffixMap = new Map<string, ModFamily>();

    for (let i = 0; i < normal.length; i += 1) {
      const modIdx = normal[i];
      const mod = rawMods[modIdx];
      if (!mod) continue;
      const [id, genCode, group, ilvl, lines, tagsCsv] = mod;
      if (genCode !== "P" && genCode !== "S") continue;
      const gen: Gen = genCode === "P" ? "prefix" : "suffix";
      const text = (lines || []).join(" / ");
      if (!text) continue;
      const weight = Number(weights[i] ?? 1000) || 1000;
      const [min, max] = firstRange(text);
      const targetMap = gen === "prefix" ? prefixMap : suffixMap;
      const famKey = `${gen}:${group}`;
      let fam = targetMap.get(famKey);
      if (!fam) {
        fam = {
          family: group,
          gen,
          tags: tagsCsv ? tagsCsv.split(",").filter(Boolean) : [],
          spawn: [],
          tiers: []
        };
        targetMap.set(famKey, fam);
      }
      fam.tiers.push({ name: id, ilvl: Number(ilvl) || 1, weight, min, max, text });
    }

    const sortTiers = (fam: ModFamily) => {
      fam.tiers.sort((a, b) => a.ilvl - b.ilvl || (a.min ?? 0) - (b.min ?? 0));
      return fam;
    };
    classes[String(classIdx)] = {
      label: cls.type,
      item_class: cls.type,
      prefixes: [...prefixMap.values()].map(sortTiers),
      suffixes: [...suffixMap.values()].map(sortTiers)
    };
  }

  const visibleBases = (itemModsData?.bases || []).filter((b) => !b.h && classes[String(b.c)]);
  const tree: CraftGroupEntry[] = [];
  for (const groupDef of POB_CRAFT_GROUPS) {
    const groupClasses: CraftClassEntry[] = [];
    for (const typeDef of groupDef.types) {
      const matched = visibleBases.filter((b) => {
        if (b.t !== typeDef.type) return false;
        if (typeDef.subType) return b.st === typeDef.subType;
        // Avoid matching subTypes that already have their own dedicated bucket (e.g. Bucklers vs Shields, Quarterstaves vs Staves).
        if (typeDef.type === "Shield" && b.st === "Evasion") return false;
        if (typeDef.type === "Staff" && b.st === "Warstaff") return false;
        return true;
      });
      if (!matched.length) continue;
      const bases: CraftBaseEntry[] = matched
        .map((b) => {
          const site = iconByName.get(b.n.trim().toLowerCase());
          return {
            name: b.n,
            slug: site?.slug || b.n.replace(/['’]/g, "").replace(/\s+/g, "_"),
            icon: site?.icon || null,
            attr: attrFromPobArmour(b.a),
            req_level: Number(b.r?.[0] || 0),
            craft_key: String(b.c),
            implicit: b.i?.length ? b.i.join(" · ") : null
          };
        })
        .sort((a, b) => a.req_level - b.req_level || a.name.localeCompare(b.name));
      groupClasses.push({
        label: typeDef.label,
        attr_split: bases.some((b) => Boolean(b.attr)),
        base_count: bases.length,
        bases
      });
    }
    if (groupClasses.length) tree.push({ group: groupDef.group, classes: groupClasses });
  }

  return { tree, classes };
}

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
const pickIndexWeighted = (weights: number[]): number => {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return -1;
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i += 1) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
};

const countGen = (item: CraftItem, gen: Gen) => item.mods.filter((m) => m.gen === gen).length;
const hasFamily = (item: CraftItem, family: string) => item.mods.some((m) => m.family === family);

const substituteValue = (text: string, value: number | null): string => {
  if (value == null) return text;
  // Replace a "(a—b)" / "(a-b)" range with the rolled value.
  return text.replace(/\(?\s*[\d.]+\s*[—–-]\s*[\d.]+\s*\)?/, String(value));
};

// Build a rolled mod from a family + chosen tier.
const rollFromFamily = (family: ModFamily, tierIndex: number): RolledMod => {
  const tier = family.tiers[tierIndex];
  const value = tier.min != null && tier.max != null ? rint(tier.min, tier.max) : null;
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

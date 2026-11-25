// Exact PoB / PoE2 support gem compatibility & GGG official recommended supports
// backed by public/data/gem-compat-data.js (window.POE2_GEM_COMPAT).
//
// Evaluates PoB's SkillType postfix expressions (CalcTools.lua: doesTypeExpressionMatch
// & canGrantedEffectSupportActiveSkill) so the Gemcutting popup's "All Valid" tab
// matches Path of Exile 2's in-game support rules.
import { gemCandidates, gemScore, type GemTagRecord } from "./gemSuggest";

export type ActiveSkillCategory =
  | "spear"
  | "bow"
  | "quarterstaff"
  | "dagger"
  | "elemental"
  | "occult"
  | "primal"
  | "flail"
  | "mace"
  | "axe"
  | "crossbow"
  | "sword"
  | "spirit"
  | "other";

export interface GemCompatActiveEntry {
  st: number[];
  mst?: number[];
  noSup?: 1;
  tier?: number;
  cat?: ActiveSkillCategory;
}

export const ACTIVE_SKILL_CATEGORIES: Array<{ key: ActiveSkillCategory; label: string; icon: string }> = [
  { key: "spear", label: "Spear", icon: "north_east" },
  { key: "bow", label: "Bow", icon: "gps_fixed" },
  { key: "quarterstaff", label: "Quarterstaff", icon: "sports_martial_arts" },
  { key: "dagger", label: "Dagger", icon: "carpenter" },
  { key: "elemental", label: "Elemental", icon: "local_fire_department" },
  { key: "occult", label: "Occult", icon: "skull" },
  { key: "primal", label: "Primal", icon: "pets" },
  { key: "flail", label: "Flail", icon: "flare" },
  { key: "mace", label: "Mace", icon: "gavel" },
  { key: "axe", label: "Axe", icon: "hardware" },
  { key: "crossbow", label: "Crossbow", icon: "my_location" },
  { key: "sword", label: "Sword", icon: "swords" },
  { key: "spirit", label: "Spirit", icon: "auto_awesome" },
  { key: "other", label: "Other", icon: "category" }
];

const ROMAN_TIERS: Record<number, string> = {
  1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII",
  8: "VIII", 9: "IX", 10: "X", 11: "XI", 12: "XII", 13: "XIII", 14: "XIV", 15: "XV", 16: "XVI"
};

export function romanTier(tier: number | null | undefined): string {
  if (!tier || tier <= 0) return "";
  return ROMAN_TIERS[tier] || String(tier);
}

export interface GemCompatSupportEntry {
  req: number[];
  exc?: number[];
  ignM?: 1;
  gemOnly?: 1;
  tier?: number;
  fam?: string[];
}

export interface GemCompatData {
  format: string;
  source: string;
  /** Index 0 = AND, 1 = OR, 2 = NOT; >= 3 are SkillType names. */
  types: string[];
  active: Record<string, GemCompatActiveEntry>;
  support: Record<string, GemCompatSupportEntry>;
  recommended: Record<string, string[]>;
}

export type SupportTierBucket = "1" | "2" | "3" | "4" | "5" | "lineage" | "other";

export const SUPPORT_TIER_ORDER: SupportTierBucket[] = ["1", "2", "3", "4", "5", "lineage", "other"];

export const SUPPORT_TIER_LABELS: Record<SupportTierBucket, { roman: string; vi: string; en: string }> = {
  "1": { roman: "I", vi: "Bậc I", en: "Tier I" },
  "2": { roman: "II", vi: "Bậc II", en: "Tier II" },
  "3": { roman: "III", vi: "Bậc III", en: "Tier III" },
  "4": { roman: "IV", vi: "Bậc IV", en: "Tier IV" },
  "5": { roman: "V", vi: "Bậc V", en: "Tier V" },
  lineage: { roman: "L", vi: "Lineage", en: "Lineage" },
  other: { roman: "★", vi: "Khác", en: "Other" }
};

const TYPE_AND = 0;
const TYPE_OR = 1;
const TYPE_NOT = 2;

const normName = (name: string | undefined | null) => String(name || "").trim().toLowerCase();

/**
 * Exact TypeScript port of PoB's calcLib.doesTypeExpressionMatch (Modules/CalcTools.lua).
 * Evaluates a postfix expression of SkillType ids against the skill's active (+ optional minion) types.
 */
export function doesTypeExpressionMatch(
  checkTypes: number[] | undefined,
  skillTypes: Set<number>,
  minionTypes?: Set<number>
): boolean {
  if (!checkTypes || !checkTypes.length) return false;
  const stack: boolean[] = [];
  for (let i = 0; i < checkTypes.length; i += 1) {
    const token = checkTypes[i];
    if (token === TYPE_OR) {
      const b = stack.pop() ?? false;
      const a = stack.pop() ?? false;
      stack.push(a || b);
    } else if (token === TYPE_AND) {
      const b = stack.pop() ?? false;
      const a = stack.pop() ?? false;
      stack.push(a && b);
    } else if (token === TYPE_NOT) {
      const a = stack.pop() ?? false;
      stack.push(!a);
    } else {
      stack.push(skillTypes.has(token) || Boolean(minionTypes && minionTypes.has(token)));
    }
  }
  return stack.some(Boolean);
}

/**
 * Check whether `supportName` can support `activeName` using PoB's exact SkillType rules.
 * Returns `null` when either skill is unknown in `compat` (callers may fall back to tag matching).
 */
export function canSupportByPobRules(
  activeName: string | undefined,
  supportName: string | undefined,
  compat: GemCompatData | null | undefined,
  options: { isGrantedSkill?: boolean } = {}
): boolean | null {
  if (!compat || !activeName || !supportName) return null;
  const act = compat.active[normName(activeName)];
  const sup = compat.support[normName(supportName)];
  if (!act || !sup) return null;
  if (act.noSup) return false;
  if (sup.gemOnly && options.isGrantedSkill) return false;
  // Supports without requireSkillTypes in PoB (e.g. GGPK-only fallback entries) are unknown unless exc applies.
  const skillTypes = new Set(act.st || []);
  const minionTypes = !sup.ignM && act.mst?.length ? new Set(act.mst) : undefined;

  if (sup.exc?.length && doesTypeExpressionMatch(sup.exc, skillTypes)) {
    return false;
  }
  if (!sup.req?.length) {
    // Some supports in PoB have empty requireSkillTypes (universal supports like Inspiration/Efficiency): valid!
    return true;
  }
  return doesTypeExpressionMatch(sup.req, skillTypes, minionTypes);
}

export interface GemLikeRecord extends GemTagRecord {
  name: string;
  tags?: string[];
  summary_en?: string;
  color?: string;
  tier?: number | null;
}

/** Determine whether a support gem is valid for the selected active skill. */
export function isSupportValidForSkill(
  activeGem: GemLikeRecord | undefined,
  supportGem: GemLikeRecord,
  compat: GemCompatData | null | undefined,
  options: { isGrantedSkill?: boolean; triggered?: boolean } = {}
): boolean {
  if (!activeGem?.name) return true;
  const exact = canSupportByPobRules(activeGem.name, supportGem.name, compat, options);
  if (exact !== null) return exact;
  // Graceful fallback for skills/supports not present in PoB's Lua tables yet.
  return gemScore(activeGem.tags, supportGem, { triggered: options.triggered }) > 0;
}

/**
 * Return recommended supports for `activeGem`:
 * 1. Official GGG SkillGemSupports list from Content.ggpk (filtered to valid supports).
 * 2. Fallback to tag/damage heuristic (`gemCandidates`) when a skill has no GGPK entry.
 */
export function recommendedSupportsForSkill<T extends GemLikeRecord>(
  activeGem: GemLikeRecord | undefined,
  allSupports: T[],
  compat: GemCompatData | null | undefined,
  options: { isGrantedSkill?: boolean; triggered?: boolean } = {}
): { items: T[]; source: "ggpk" | "heuristic" } {
  if (!activeGem?.name) return { items: [], source: "heuristic" };
  const byName = new Map<string, T>();
  for (const sup of allSupports) {
    const key = normName(sup.name);
    if (!byName.has(key)) byName.set(key, sup);
  }
  const officialNames = compat?.recommended?.[normName(activeGem.name)];
  if (officialNames?.length) {
    const items: T[] = [];
    const seen = new Set<string>();
    for (const name of officialNames) {
      const key = normName(name);
      if (seen.has(key)) continue;
      const record = byName.get(key);
      if (!record) continue;
      const valid = canSupportByPobRules(activeGem.name, record.name, compat, options);
      if (valid === false) continue;
      seen.add(key);
      items.push(record);
    }
    if (items.length) return { items, source: "ggpk" };
  }
  const validPool = allSupports.filter((sup) => isSupportValidForSkill(activeGem, sup, compat, options));
  return {
    items: gemCandidates(activeGem.tags, validPool, { limit: 24, triggered: options.triggered }),
    source: "heuristic"
  };
}

/** Classify a support gem into its PoE2 Gemcutting tier bucket (I, II, III, IV, V, Lineage, Other). */
export function supportTierBucket(
  supportGem: GemLikeRecord,
  compat: GemCompatData | null | undefined
): SupportTierBucket {
  const entry = compat?.support?.[normName(supportGem.name)];
  const tier = entry?.tier ?? supportGem.tier ?? null;
  if (tier === 1 || tier === 2 || tier === 3 || tier === 4 || tier === 5) {
    return String(tier) as SupportTierBucket;
  }
  if ((supportGem.tags || []).some((t) => String(t).toLowerCase() === "lineage")) {
    return "lineage";
  }
  return "other";
}

/** Return the PoB gem family names for a support (used to flag same-family conflicts in the modal). */
export function supportFamilies(
  supportName: string | undefined,
  compat: GemCompatData | null | undefined
): string[] {
  if (!supportName || !compat) return [];
  return compat.support?.[normName(supportName)]?.fam ?? [];
}

/** Return the PoE2 Gemcutting sidebar category for an active skill gem. */
export function activeSkillCategory(
  skillGem: GemLikeRecord,
  compat: GemCompatData | null | undefined
): ActiveSkillCategory {
  const fromCompat = compat?.active?.[normName(skillGem.name)]?.cat;
  if (fromCompat) return fromCompat;
  const tags = new Set((skillGem.tags || []).map((t) => String(t).toLowerCase()));
  if (tags.has("persistent") && (tags.has("buff") || tags.has("aura") || tags.has("herald") || tags.has("meta"))) return "spirit";
  if (tags.has("chaos") || tags.has("curse") || tags.has("minion")) return "occult";
  if (tags.has("shapeshift") || tags.has("plant") || tags.has("companion")) return "primal";
  if (tags.has("spell")) return "elemental";
  return "other";
}

/** Return the numeric Uncut Skill Gem tier (1, 3, 4, 5, 7, 8, 9, 11, 13, 14) or null. */
export function activeSkillTier(
  skillGem: GemLikeRecord,
  compat: GemCompatData | null | undefined
): number | null {
  const t = compat?.active?.[normName(skillGem.name)]?.tier ?? skillGem.tier ?? null;
  return typeof t === "number" && t > 0 ? t : null;
}

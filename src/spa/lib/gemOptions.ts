// Per-gem choices Path of Building offers (skill part, stat set, stages, minion type,
// minion skill, corruption) and how the planner stores the player's pick.
//
// PoB tells which choices exist: scripts/pob-calculate.lua returns `GemOptions`
// (per socket group, per active skill). The pick is kept in the gem's `pobAttrs`
// with PoB's own <Gem> attribute names, so it survives saving, PoB code export
// and import, and src/server/pob-build-xml.mjs writes it back to PoB unchanged.
// Stat sets are not a <Gem> attribute in PoB but <StatSetIndex grantedEffect=".."
// index=".."/> children; the planner keeps them as one `statSets` attribute
// ("CometPlayer:2,SparkPlayer:1") and the XML builder turns it into those children.

/** One active skill's choices, as scripts/pob-calculate.lua reports them. */
export interface PobGemOptions {
  /** 1-based position of the gem in its PoB group (1 = the group's main gem). */
  gem: number;
  name: string;
  grantedEffect: string;
  parts?: string[];
  part?: number;
  statSets?: string[];
  statSet?: number;
  maxStages?: number;
  stages?: number;
  minions?: Array<{ id: string; name: string }>;
  minion?: string;
  minionSkills?: string[];
  minionSkill?: number;
  /** Position in the group's skill list (PoB's mainActiveSkill for it). */
  skill?: number;
  /** Which gem and group this is, to find them in the planner (see plannerGemTargets). */
  skillId?: string;
  gemId?: string;
  groupSource?: string;
  groupSlot?: string;
  groupSkillId?: string;
  groupGemId?: string;
  /** XML <Skill> row the group was loaded from (none: a group PoB built itself). */
  xmlRow?: number;
  /** Granted by an item, the tree or a weapon: PoB never corrupts it. */
  grantedSkill?: boolean;
}

export type CorruptChoice = "none" | "plus" | "corrupted" | "minus";

/** PoB's corruption drop-down (SkillsTab corruptOption), in its order. */
export const CORRUPT_CHOICES: Array<{ value: CorruptChoice; vi: string; en: string; corrupted: boolean; level: number }> = [
  { value: "none", vi: "Chưa corrupt", en: "Not corrupted", corrupted: false, level: 0 },
  { value: "plus", vi: "Corrupt +1 cấp", en: "+1 to gem level", corrupted: true, level: 1 },
  { value: "corrupted", vi: "Corrupt (không đổi cấp)", en: "Corrupted", corrupted: true, level: 0 },
  { value: "minus", vi: "Corrupt −1 cấp", en: "−1 to gem level", corrupted: true, level: -1 }
];

export type GemOptionChange =
  | { kind: "part"; value: number }
  | { kind: "statSet"; grantedEffect: string; value: number }
  | { kind: "stages"; value: number }
  | { kind: "minion"; value: string }
  | { kind: "minionSkill"; value: number }
  | { kind: "corrupt"; value: CorruptChoice };

type Attrs = Record<string, string> | undefined;

export function corruptChoice(attrs: Attrs): CorruptChoice {
  const level = Number(attrs?.corruptLevel ?? 0) || 0;
  if (level > 0) return "plus";
  if (level < 0) return "minus";
  return attrs?.corrupted === "true" ? "corrupted" : "none";
}

/** "CometPlayer:2,SparkPlayer:1" -> { CometPlayer: 2, SparkPlayer: 1 }. */
export function parseStatSets(value: string | undefined): Record<string, number> {
  const sets: Record<string, number> = {};
  for (const part of String(value ?? "").split(",")) {
    const match = part.trim().match(/^([\w.-]+):(\d+)$/);
    if (match && Number(match[2]) > 0) sets[match[1]] = Number(match[2]);
  }
  return sets;
}

export function formatStatSets(sets: Record<string, number>): string {
  return Object.entries(sets)
    .filter(([id, index]) => /^[\w.-]+$/.test(id) && Number.isInteger(index) && index > 0)
    .map(([id, index]) => `${id}:${index}`)
    .join(",");
}

/** The gem's pobAttrs after one change (undefined when nothing is left). */
export function withGemOption(attrs: Attrs, change: GemOptionChange): Record<string, string> | undefined {
  const next: Record<string, string> = { ...(attrs ?? {}) };
  // PoB keeps a main-sidebar value and a Calcs-tab value; the planner sets both.
  const both = (key: string, value: string) => {
    next[key] = value;
    next[`${key}Calcs`] = value;
  };
  switch (change.kind) {
    case "part":
      both("skillPart", String(Math.max(1, Math.trunc(change.value))));
      break;
    case "stages":
      both("skillStageCount", String(Math.max(1, Math.trunc(change.value))));
      break;
    case "minion":
      both("skillMinion", change.value);
      break;
    case "minionSkill":
      both("skillMinionSkill", String(Math.max(1, Math.trunc(change.value))));
      break;
    case "statSet": {
      const sets = parseStatSets(next.statSets);
      if (change.value > 1) sets[change.grantedEffect] = Math.trunc(change.value);
      else delete sets[change.grantedEffect];
      const text = formatStatSets(sets);
      if (text) next.statSets = text;
      else delete next.statSets;
      break;
    }
    case "corrupt": {
      const choice = CORRUPT_CHOICES.find((row) => row.value === change.value) ?? CORRUPT_CHOICES[0];
      next.corrupted = choice.corrupted ? "true" : "false";
      next.corruptLevel = String(choice.level);
      break;
    }
  }
  return Object.keys(next).length ? next : undefined;
}

/** The stat set index picked for a skill (1 when none is stored). */
export function pickedStatSet(attrs: Attrs, grantedEffect: string): number {
  return parseStatSets(attrs?.statSets)[grantedEffect] ?? 1;
}

/** Where a GemOptions entry points in the planner: the group's main gem or one of its rows. */
export interface PlannerGemTarget {
  /** Planner skill group index (0-based, as listed). */
  group: number;
  /** undefined = the group's main gem; otherwise the id of the support row. */
  supportId?: string;
  option: PobGemOptions;
}

interface GemLike {
  skillId: string;
  pobSkillId?: string;
  pobGemId?: string;
}

interface GroupLike extends GemLike {
  itemSource?: string;
  itemSlot?: string;
  supportSkills: Array<GemLike & { id: string }>;
}

/** Every id a planner gem may be known by in PoB (its skillId, its gem path...). */
const gemKeys = (gem: GemLike): string[] => {
  const site = gem.skillId.trim();
  const keys = [gem.pobSkillId, gem.pobGemId, site];
  if (site && !site.startsWith("Metadata/")) {
    keys.push(site.startsWith("Support") ? `Metadata/Items/Gems/SupportGem${site.replace(/^Support/, "")}` : `Metadata/Items/Gems/SkillGem${site}`);
  }
  return keys.filter((key): key is string => Boolean(key)).map((key) => key.toLowerCase());
};
const sameGem = (gem: GemLike, ...ids: Array<string | undefined>) => {
  const keys = gemKeys(gem);
  return ids.some((id) => id && keys.includes(id.toLowerCase()));
};
/**
 * Matches PoB's GemOptions with the planner's groups and gems. PoB's group numbers are
 * not the order the groups were sent in (it folds the player's group for a granted skill
 * into that skill's group and builds groups of its own), so each entry carries the XML
 * row its group was loaded from (xmlRow): the planner sends one row per group that has
 * a gem, in order. Entries without a row are groups PoB built itself, with no planner
 * card. Within a group the gem is found by its ids (by position only when there are none).
 * Output from an older calculate script has no rows at all: PoB's number is used then.
 */
export function plannerGemTargets(gemOptions: unknown, skills: GroupLike[]): PlannerGemTarget[] {
  if (!gemOptions || typeof gemOptions !== "object") return [];
  const sent = skills.map((skill, index) => ({ skill, index })).filter((row) => row.skill.skillId.trim());
  const groups = Object.entries(gemOptions as Record<string, unknown>)
    .map(([key, rows]) => ({ key: Number(key), rows: (Array.isArray(rows) ? rows : []).filter((row): row is PobGemOptions => row && typeof row.gem === "number") }))
    .filter((group) => group.key > 0 && group.rows.length);
  const tagged = groups.some((group) => group.rows.some((row) => typeof row.xmlRow === "number"));
  const targets: PlannerGemTarget[] = [];
  for (const { key, rows } of groups) {
    const xmlRow = rows.find((row) => typeof row.xmlRow === "number")?.xmlRow;
    const match = tagged ? (xmlRow ? sent[xmlRow - 1] : undefined) : sent[key - 1];
    if (!match) continue;
    const supports = match.skill.supportSkills.filter((support) => support.skillId.trim());
    for (const row of rows) {
      const ids = [row.skillId, row.gemId].filter(Boolean) as string[];
      if (row.gem === 1) {
        targets.push({ group: match.index, option: row });
        continue;
      }
      const support = ids.length ? supports.find((gem) => sameGem(gem, ...ids)) : supports[row.gem - 2];
      if (support) targets.push({ group: match.index, supportId: support.id, option: row });
    }
  }
  return targets;
}

/** Whether PoB offers any choice for this gem (not just the "granted skill" flag). */
export function hasGemChoices(option: PobGemOptions | undefined): boolean {
  return Boolean(option && (option.parts || option.statSets || option.maxStages || option.minions || option.minionSkills));
}

/** Vietnamese words for PoB's usual stat-set / part names; the rest stay as PoB writes them. */
const OPTION_WORDS: Record<string, string> = {
  base: "Cơ bản",
  explosion: "Nổ",
  projectile: "Đạn",
  beam: "Tia",
  impact: "Va chạm",
  empowered: "Cường hoá",
  buff: "Hiệu ứng buff",
  melee: "Cận chiến",
  shockwave: "Sóng chấn động",
  strike: "Đòn đánh",
  physical: "Vật lý",
  fire: "Lửa",
  cold: "Băng",
  lightning: "Sét",
  chaos: "Hỗn mang",
  "fire-infused": "Nạp lửa",
  "cold-infused": "Nạp băng",
  "lightning-infused": "Nạp sét",
  "basic attack": "Đòn đánh thường"
};

export function optionLabel(name: string, locale: string): string {
  if (locale !== "vi") return name;
  const vi = OPTION_WORDS[name.trim().toLowerCase()];
  return vi ? `${vi} (${name})` : name;
}

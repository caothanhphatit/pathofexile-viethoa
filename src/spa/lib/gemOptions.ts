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

interface GroupLike {
  skillId: string;
  supportSkills: Array<{ id: string; skillId: string }>;
}

/**
 * Matches PoB's GemOptions (keyed by PoB group number, gem position) with the planner's
 * groups. Groups without a gem are not sent to PoB, and inside a group only the rows
 * with a gem are, in order (see calculationRequestBody), so both numberings shift.
 */
export function plannerGemTargets(gemOptions: unknown, skills: GroupLike[]): PlannerGemTarget[] {
  if (!gemOptions || typeof gemOptions !== "object") return [];
  const targets: PlannerGemTarget[] = [];
  let pobGroup = 0;
  skills.forEach((skill, group) => {
    if (!skill.skillId.trim()) return;
    pobGroup += 1;
    const rows = (gemOptions as Record<string, unknown>)[String(pobGroup)];
    if (!Array.isArray(rows)) return;
    const supports = skill.supportSkills.filter((support) => support.skillId.trim());
    for (const row of rows as PobGemOptions[]) {
      if (!row || typeof row.gem !== "number") continue;
      if (row.gem === 1) targets.push({ group, option: row });
      else if (supports[row.gem - 2]) targets.push({ group, supportId: supports[row.gem - 2].id, option: row });
    }
  });
  return targets;
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

// What the Build Planner shows from Path of Building's output, and the PoB
// Configuration inputs it lets the player change, with plain Vietnamese labels
// and one-line explanations (players should not need to know PoB's terms).
import type { PobConfigInput } from "./buildPlanner";

export type StatFormat = "int" | "short" | "pct" | "pct1" | "mult" | "rate" | "speed" | "seconds" | "metres" | "modpct";

export interface StatDefinition {
  /** Key of PoB's calcsTab.mainOutput. */
  stat: string;
  vi: string;
  en: string;
  /** Plain explanation shown on hover. */
  hint: string;
  format: StatFormat;
  /** Higher is better (for the change arrows); false for costs and the like. */
  higherIsBetter?: boolean;
  /** Only shown when the value is not zero. */
  hideZero?: boolean;
}

export interface StatSection {
  id: string;
  vi: string;
  en: string;
  stats: StatDefinition[];
}

const s = (stat: string, vi: string, en: string, hint: string, format: StatFormat, extra: Partial<StatDefinition> = {}): StatDefinition => ({
  stat, vi, en, hint, format, higherIsBetter: true, ...extra
});

/** Detailed sections, most important first. */
export const STAT_SECTIONS: StatSection[] = [
  {
    id: "offence",
    vi: "Tấn công (kỹ năng chính)",
    en: "Offence (main skill)",
    stats: [
      s("CombinedDPS", "Tổng DPS", "Total DPS", "Sát thương mỗi giây của kỹ năng chính, đã cộng cả sát thương theo thời gian (đốt, độc, chảy máu). Đây là con số PoB dùng để so build.", "short"),
      s("TotalDPS", "DPS đòn đánh", "Hit DPS", "Chỉ tính sát thương của các đòn trúng trực tiếp mỗi giây, chưa cộng hiệu ứng gây sát thương theo thời gian.", "short"),
      s("AverageDamage", "Sát thương trung bình mỗi đòn", "Average hit", "Một đòn trúng gây trung bình bao nhiêu sát thương, đã tính chí mạng và tỉ lệ trúng.", "short"),
      s("Speed", "Tốc độ đánh / niệm", "Attack / cast rate", "Số lần dùng kỹ năng mỗi giây.", "speed"),
      s("CritChance", "Tỉ lệ chí mạng", "Critical hit chance", "Phần trăm đòn đánh thành chí mạng (crit).", "pct1"),
      s("CritMultiplier", "Hệ số sát thương chí mạng", "Critical damage multiplier", "Đòn chí mạng gây gấp bao nhiêu lần sát thương thường.", "mult"),
      s("HitChance", "Tỉ lệ đánh trúng", "Hit chance", "Phần trăm đòn đánh trúng mục tiêu. Dưới 100% là đang mất sát thương vì trượt — cần thêm Accuracy.", "pct"),
      s("TotalDotDPS", "DPS theo thời gian", "Damage over time DPS", "Sát thương mỗi giây từ đốt (ignite), độc (poison), chảy máu (bleed) và các hiệu ứng tương tự.", "short", { hideZero: true }),
      s("IgniteDPS", "DPS đốt (Ignite)", "Ignite DPS", "Sát thương mỗi giây của hiệu ứng đốt cháy kỹ năng gây ra.", "short", { hideZero: true }),
      s("BleedDPS", "DPS chảy máu (Bleed)", "Bleed DPS", "Sát thương mỗi giây của hiệu ứng chảy máu.", "short", { hideZero: true }),
      s("PoisonDPS", "DPS độc (Poison)", "Poison DPS", "Sát thương mỗi giây của các lớp độc.", "short", { hideZero: true }),
      s("ProjectileCount", "Số đạn", "Projectiles", "Số viên đạn / mũi tên mỗi lần dùng kỹ năng.", "int", { hideZero: true }),
      s("AreaOfEffectRadiusMetres", "Bán kính vùng ảnh hưởng", "Area radius", "Kỹ năng có vùng ảnh hưởng rộng bao nhiêu mét.", "metres", { hideZero: true }),
      s("ManaCost", "Mana mỗi lần dùng", "Mana cost", "Mana mất mỗi lần dùng kỹ năng. Nếu cao hơn lượng mana hồi được thì sẽ hết mana khi đánh liên tục.", "int", { higherIsBetter: false, hideZero: true })
    ]
  },
  {
    id: "defence",
    vi: "Phòng thủ",
    en: "Defence",
    stats: [
      s("TotalEHP", "Máu hiệu dụng (EHP)", "Effective health pool", "Lượng sát thương ước tính bạn chịu được trước khi chết, đã tính Life, ES, giáp, né, kháng... Càng cao càng trâu.", "short"),
      s("Life", "Máu (Life)", "Life", "Lượng máu tối đa.", "int"),
      s("EnergyShield", "Khiên năng lượng (ES)", "Energy shield", "Lớp khiên hấp thụ sát thương trước Life và tự hồi sau vài giây không bị đánh.", "int"),
      s("Mana", "Mana", "Mana", "Lượng mana tối đa.", "int"),
      s("Spirit", "Spirit", "Spirit", "Tài nguyên dùng để duy trì aura, buff, minion. Không đủ Spirit thì không bật được hết các kỹ năng duy trì.", "int"),
      s("SpiritUnreserved", "Spirit còn trống", "Unreserved spirit", "Spirit còn lại sau khi trừ các kỹ năng đang duy trì. Số âm nghĩa là đang dùng quá Spirit.", "int"),
      s("Armour", "Giáp (Armour)", "Armour", "Giảm sát thương vật lý của mỗi đòn trúng. Hiệu quả hơn với đòn nhỏ.", "int", { hideZero: true }),
      s("PhysicalDamageReduction", "Giảm sát thương vật lý", "Physical damage reduction", "Phần trăm sát thương vật lý được giảm nhờ giáp và các nguồn khác.", "pct", { hideZero: true }),
      s("Evasion", "Né (Evasion rating)", "Evasion rating", "Chỉ số né. Càng cao thì càng dễ né đòn đánh.", "int", { hideZero: true }),
      s("EvadeChance", "Tỉ lệ né đòn", "Evade chance", "Phần trăm né hoàn toàn đòn tấn công (không áp dụng cho phép thuật).", "pct", { hideZero: true }),
      s("DeflectChance", "Tỉ lệ đỡ chệch (Deflect)", "Deflect chance", "Phần trăm đòn trúng bị đỡ chệch, chỉ nhận một phần sát thương.", "pct", { hideZero: true }),
      s("BlockChance", "Tỉ lệ chặn (Block)", "Block chance", "Phần trăm chặn hoàn toàn đòn đánh (cần khiên hoặc chỉ số chặn).", "pct", { hideZero: true }),
      s("PhysicalMaximumHitTaken", "Đòn vật lý lớn nhất chịu được", "Max physical hit", "Một đòn vật lý lớn đến mức này thì bạn vẫn sống.", "short"),
      s("FireMaximumHitTaken", "Đòn lửa lớn nhất chịu được", "Max fire hit", "Một đòn lửa lớn đến mức này thì bạn vẫn sống.", "short"),
      s("ColdMaximumHitTaken", "Đòn băng lớn nhất chịu được", "Max cold hit", "Một đòn băng lớn đến mức này thì bạn vẫn sống.", "short"),
      s("LightningMaximumHitTaken", "Đòn sét lớn nhất chịu được", "Max lightning hit", "Một đòn sét lớn đến mức này thì bạn vẫn sống.", "short"),
      s("ChaosMaximumHitTaken", "Đòn hỗn mang lớn nhất chịu được", "Max chaos hit", "Một đòn hỗn mang (chaos) lớn đến mức này thì bạn vẫn sống.", "short"),
      s("StunThreshold", "Ngưỡng choáng", "Stun threshold", "Đòn trúng càng gần ngưỡng này càng dễ làm bạn bị choáng.", "int", { hideZero: true })
    ]
  },
  {
    id: "recovery",
    vi: "Hồi phục",
    en: "Recovery",
    stats: [
      s("LifeRegenRecovery", "Hồi máu mỗi giây", "Life regeneration", "Lượng máu tự hồi mỗi giây.", "rate", { hideZero: true }),
      s("ManaRegenRecovery", "Hồi mana mỗi giây", "Mana regeneration", "Lượng mana tự hồi mỗi giây.", "rate", { hideZero: true }),
      s("EnergyShieldRecharge", "Tốc độ hồi ES", "Energy shield recharge", "ES hồi mỗi giây khi đang nạp lại.", "rate", { hideZero: true }),
      s("EnergyShieldRechargeDelay", "Thời gian chờ hồi ES", "ES recharge delay", "Bao lâu không bị đánh thì ES bắt đầu hồi.", "seconds", { higherIsBetter: false, hideZero: true }),
      s("MaxLifeLeechRate", "Hút máu tối đa mỗi giây", "Max life leech rate", "Lượng máu tối đa có thể hút (leech) mỗi giây.", "rate", { hideZero: true }),
      s("EffectiveMovementSpeedMod", "Tốc độ di chuyển", "Movement speed", "So với tốc độ chạy gốc của nhân vật.", "modpct")
    ]
  }
];

/** The 4 resistances, shown together with how much is over the cap. */
export const RESISTANCES = [
  { stat: "FireResist", overCap: "FireResistOverCap", vi: "Lửa", en: "Fire", cls: "nj-c-fire" },
  { stat: "ColdResist", overCap: "ColdResistOverCap", vi: "Băng", en: "Cold", cls: "nj-c-cold" },
  { stat: "LightningResist", overCap: "LightningResistOverCap", vi: "Sét", en: "Lightning", cls: "nj-c-lightning" },
  { stat: "ChaosResist", overCap: "ChaosResistOverCap", vi: "Hỗn mang", en: "Chaos", cls: "nj-c-chaos" }
];

export function formatStat(value: number | undefined, format: StatFormat): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  const round = (n: number, digits = 0) => {
    const f = 10 ** digits;
    return (Math.round(n * f) / f).toLocaleString("en-US", { maximumFractionDigits: digits });
  };
  switch (format) {
    case "short":
      if (Math.abs(value) >= 1e6) return `${round(value / 1e6, 2)}M`;
      if (Math.abs(value) >= 1e4) return `${round(value / 1e3, 1)}k`;
      return round(value);
    case "pct": return `${round(value)}%`;
    case "pct1": return `${round(value, 1)}%`;
    case "mult": return `x${round(value, 2)}`;
    case "rate": return `${round(value, 1)}/s`;
    case "speed": return `${round(value, 2)}/s`;
    case "seconds": return `${round(value, 2)}s`;
    case "metres": return `${round(value, 1)}m`;
    case "modpct": {
      const pct = (value - 1) * 100;
      return `${pct >= 0 ? "+" : ""}${round(pct)}%`;
    }
    default: return round(value);
  }
}

export interface StatChange {
  delta: number;
  /** delta relative to the old value, 0..∞ */
  ratio: number;
  better: boolean;
}

/** How a stat moved since the previous calculation; undefined when it did not (or cannot be compared). */
export function statChange(def: Pick<StatDefinition, "higherIsBetter">, current: number | undefined, previous: number | undefined): StatChange | undefined {
  if (typeof current !== "number" || typeof previous !== "number") return undefined;
  const delta = current - previous;
  if (Math.abs(delta) < 1e-6 || Math.abs(delta) < Math.abs(previous) * 1e-4) return undefined;
  const higher = def.higherIsBetter !== false;
  return { delta, ratio: previous ? Math.abs(delta / previous) : 1, better: higher ? delta > 0 : delta < 0 };
}

export function formatStatChange(change: StatChange, format: StatFormat): string {
  const sign = change.delta > 0 ? "+" : "−";
  const magnitude = Math.abs(change.delta);
  const text = format === "modpct" ? `${Math.round(magnitude * 100)}%` : formatStat(magnitude, format === "mult" ? "int" : format);
  const pct = change.ratio > 0.0005 && format !== "pct" && format !== "pct1" && format !== "modpct" ? ` (${sign}${(change.ratio * 100).toFixed(change.ratio < 0.1 ? 1 : 0)}%)` : "";
  return `${sign}${format === "mult" ? `x${Math.round(magnitude * 100) / 100}` : text}${pct}`;
}

// ── Configuration (PoB "Configuration" tab) ────────────────────────────────

export interface ConfigOption {
  /** PoB ConfigOptions var name. */
  name: string;
  kind: "boolean" | "number" | "string";
  vi: string;
  en: string;
  hint: string;
  /** For kind "string": the allowed values and their labels. */
  choices?: Array<{ value: string; vi: string; en: string }>;
  /** What PoB assumes when the build does not set it. */
  defaultValue: boolean | number | string;
  min?: number;
  max?: number;
}

export interface ConfigGroup {
  id: string;
  vi: string;
  en: string;
  options: ConfigOption[];
}

const flag = (name: string, vi: string, en: string, hint: string): ConfigOption => ({ name, kind: "boolean", vi, en, hint, defaultValue: false });
const count = (name: string, vi: string, en: string, hint: string, defaultValue: number, min = 0, max = 999): ConfigOption => ({ name, kind: "number", vi, en, hint, defaultValue, min, max });

/** The PoB options that matter for most builds, in plain words. */
export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    id: "enemy",
    vi: "Kẻ địch",
    en: "Enemy",
    options: [
      {
        name: "enemyIsBoss",
        kind: "string",
        vi: "Loại kẻ địch",
        en: "Enemy type",
        hint: "Boss có kháng và giáp cao hơn quái thường, nên DPS lên boss thấp hơn. PoB mặc định tính với boss cuối (Pinnacle).",
        defaultValue: "Pinnacle",
        choices: [
          { value: "None", vi: "Quái thường", en: "Normal enemy" },
          { value: "Boss", vi: "Boss thường", en: "Standard boss" },
          { value: "Pinnacle", vi: "Boss cuối (Pinnacle)", en: "Pinnacle boss" },
          { value: "Uber", vi: "Boss Uber", en: "Uber boss" }
        ]
      },
      count("multiplierNearbyEnemies", "Số kẻ địch ở gần", "Nearby enemies", "Một số chỉ số tăng theo số quái quanh bạn.", 0, 0, 100),
      flag("conditionEnemyShocked", "Kẻ địch bị sốc (Shock)", "Enemy is shocked", "Kẻ địch bị sốc nhận thêm sát thương."),
      flag("conditionEnemyChilled", "Kẻ địch bị làm lạnh (Chill)", "Enemy is chilled", "Bật nếu build thường xuyên làm chậm kẻ địch bằng băng."),
      flag("conditionEnemyFrozen", "Kẻ địch bị đóng băng (Freeze)", "Enemy is frozen", "Bật nếu build đóng băng được kẻ địch."),
      flag("conditionEnemyIgnited", "Kẻ địch đang cháy (Ignite)", "Enemy is ignited", "Bật nếu kẻ địch luôn bị đốt."),
      flag("conditionEnemyPoisoned", "Kẻ địch bị trúng độc", "Enemy is poisoned", "Bật nếu kẻ địch luôn có độc."),
      flag("conditionEnemyBleeding", "Kẻ địch đang chảy máu", "Enemy is bleeding", "Bật nếu kẻ địch luôn chảy máu."),
      flag("conditionEnemyElectrocuted", "Kẻ địch bị điện giật (Electrocute)", "Enemy is electrocuted", "Bật nếu build gây Electrocute."),
      flag("conditionEnemyStunned", "Kẻ địch bị choáng", "Enemy is stunned", "Bật nếu kẻ địch thường xuyên bị choáng."),
      flag("conditionEnemyHeavyStunned", "Kẻ địch bị choáng nặng", "Enemy is heavy stunned", "Choáng nặng (Heavy Stun): kẻ địch đứng yên lâu hơn."),
      flag("conditionEnemyArmourBroken", "Giáp kẻ địch bị phá (Armour Break)", "Enemy armour is broken", "Kẻ địch bị phá giáp nhận thêm sát thương vật lý."),
      flag("conditionEnemyCursed", "Kẻ địch bị nguyền (Curse)", "Enemy is cursed", "Bật nếu bạn luôn nguyền kẻ địch.")
    ]
  },
  {
    id: "self",
    vi: "Nhân vật",
    en: "Character",
    options: [
      flag("conditionFullLife", "Luôn đầy máu", "Always on full life", "Một số chỉ số chỉ có tác dụng khi đầy máu."),
      flag("conditionLowLife", "Luôn ở trạng thái ít máu", "Always on low life", "Ít máu = còn 35% máu trở xuống."),
      flag("conditionFullEnergyShield", "Luôn đầy ES", "Always on full energy shield", "Một số chỉ số chỉ có tác dụng khi ES đầy."),
      flag("conditionHitRecently", "Vừa đánh trúng gần đây", "Hit recently", "\"Gần đây\" trong game là 4 giây vừa qua."),
      flag("conditionCritRecently", "Vừa chí mạng gần đây", "Crit recently", "Đã gây chí mạng trong 4 giây vừa qua."),
      flag("conditionKilledRecently", "Vừa hạ gục kẻ địch gần đây", "Killed recently", "Đã giết quái trong 4 giây vừa qua."),
      flag("conditionBeenHitRecently", "Vừa bị đánh trúng gần đây", "Been hit recently", "Đã bị trúng đòn trong 4 giây vừa qua."),
      flag("conditionMoving", "Luôn di chuyển", "Always moving", "Một số chỉ số chỉ có tác dụng khi đang chạy."),
      flag("buffOnslaught", "Có Onslaught", "Have onslaught", "Onslaught tăng tốc đánh, tốc niệm và tốc chạy."),
      flag("usePowerCharges", "Dùng Power Charge", "Use power charges", "Tính với số Power Charge tối đa (tăng chí mạng)."),
      flag("useFrenzyCharges", "Dùng Frenzy Charge", "Use frenzy charges", "Tính với số Frenzy Charge tối đa (tăng tốc đánh, sát thương)."),
      flag("useEnduranceCharges", "Dùng Endurance Charge", "Use endurance charges", "Tính với số Endurance Charge tối đa (tăng giảm sát thương vật lý, kháng).")
    ]
  }
];

export const CONFIG_OPTIONS: ConfigOption[] = CONFIG_GROUPS.flatMap((group) => group.options);

export function configInputValue(inputs: PobConfigInput[] | undefined, option: ConfigOption): boolean | number | string {
  const input = inputs?.find((row) => row.name === option.name);
  if (!input) return option.defaultValue;
  if (option.kind === "boolean") return input.value === true || input.value === "true";
  if (option.kind === "number") return Number(input.value) || 0;
  return String(input.value);
}

/** New input list with `name` set; removing it when it equals PoB's default keeps the config small. */
export function setConfigInput(inputs: PobConfigInput[] | undefined, option: ConfigOption, value: boolean | number | string): PobConfigInput[] {
  const rest = (inputs ?? []).filter((row) => row.name !== option.name);
  let next: boolean | number | string = value;
  if (option.kind === "number") {
    const n = Number(value);
    next = Number.isFinite(n) ? Math.min(Math.max(n, option.min ?? -Infinity), option.max ?? Infinity) : 0;
  }
  if (next === option.defaultValue || (option.kind === "boolean" && !next)) return rest;
  return [...rest, { name: option.name, kind: option.kind, value: next }];
}

/** Inputs the build sets that the planner has no control for (kept and sent unchanged). */
export function otherConfigInputs(inputs: PobConfigInput[] | undefined): PobConfigInput[] {
  const known = new Set(CONFIG_OPTIONS.map((option) => option.name));
  return (inputs ?? []).filter((row) => !known.has(row.name));
}

// ── Items picked on the site ────────────────────────────────────────────────

export interface ItemTextSource {
  name?: string;
  rarity?: string;
  /** Base type, e.g. "Amethyst Ring" (first property line of a unique record). */
  baseName?: string;
  mods?: string[];
}

/**
 * PoB item text for an item picked from the site's item list (no imported text):
 * uniques with their mods at the middle of each roll, other items as a plain base.
 */
export function pobItemTextFromRecord(record: ItemTextSource): string {
  const name = String(record.name ?? "").trim();
  if (!name) return "";
  if (String(record.rarity ?? "").toLowerCase() !== "unique") return `Rarity: Normal\n${name}`;
  const mods = (record.mods ?? [])
    .map((line) => String(line).replace(/[—–]/g, "-").trim())
    // Lines such as "use unique blackflame ignite effect [1]" are internal stat ids.
    .filter((line) => line && !/\[[-+]?\d+(?:\.\d+)?\]\s*\.?$/.test(line));
  return ["Rarity: Unique", name, String(record.baseName ?? "").trim(), ...mods].filter(Boolean).join("\n");
}

// ── Damage of every skill ───────────────────────────────────────────────────

/** One row of PoB's SkillDPS list (scripts/pob-calculate.lua). */
export interface PobSkillDps {
  name: string;
  dps: number;
  count?: number;
  trigger?: string;
  skillPart?: string;
}

/** Rows PoB adds as summaries rather than skills ("Full Culling DPS", "Best Ignite DPS"). */
const SUMMARY_ROW = /^(full|best) .*dps$/i;

const nameKey = (value: string) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * DPS of each skill group, from PoB's per-skill list. `groupNames[i]` holds the names
 * of the active gems of group i (its skill, and e.g. the spell in Cast on Critical).
 * Rows are matched in group order, so two groups with the same skill each get their
 * own row. Groups with no row get 0.
 */
export function skillDpsByGroup(rows: PobSkillDps[] | undefined, groupNames: string[][]): number[] {
  const pending = (rows ?? []).filter((row) => row && !SUMMARY_ROW.test(row.name) && Number(row.dps) > 0)
    .map((row) => ({ key: nameKey(row.name), dps: Number(row.dps) * (Number(row.count) > 0 ? Number(row.count) : 1), used: false }));
  return groupNames.map((names) => {
    let total = 0;
    for (const name of names) {
      const key = nameKey(name);
      if (!key) continue;
      // "Arc (part 2)"-style rows still belong to Arc.
      const row = pending.find((candidate) => !candidate.used && (candidate.key === key || candidate.key.startsWith(`${key} `)));
      if (row) {
        row.used = true;
        total += row.dps;
      }
    }
    return total;
  });
}

export interface SkillCardInput {
  index: number;
  /** Group has an active gem picked. */
  hasSkill: boolean;
  disabled: boolean;
  /** Its DPS from the last calculation; undefined while unknown. */
  dps: number | undefined;
  isMain: boolean;
}

/**
 * Skills panel order: damaging skills first (highest DPS first, the main skill on
 * ties), then new empty groups; disabled groups and skills without damage (auras,
 * buffs, utility) go to "Kỹ năng phụ". Before the first calculation everything
 * stays in the build's own order.
 */
export function arrangeSkillCards(cards: SkillCardInput[]): { primary: number[]; secondary: number[] } {
  const known = cards.some((card) => card.dps !== undefined);
  const primary: SkillCardInput[] = [];
  const secondary: SkillCardInput[] = [];
  for (const card of cards) {
    if (card.disabled) secondary.push(card);
    else if (!card.hasSkill) primary.push(card);
    // Unknown DPS (not calculated yet, or an older calculator) stays visible.
    else if (card.dps === undefined || card.isMain || card.dps > 0) primary.push(card);
    else secondary.push(card);
  }
  if (known) {
    primary.sort((a, b) => Number(b.hasSkill) - Number(a.hasSkill)
      || (b.dps ?? 0) - (a.dps ?? 0)
      || Number(b.isMain) - Number(a.isMain)
      || a.index - b.index);
  }
  return { primary: primary.map((card) => card.index), secondary: secondary.map((card) => card.index) };
}

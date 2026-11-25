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

const flag = (name: string, vi: string, en: string, hint: string, defaultValue = false): ConfigOption => ({ name, kind: "boolean", vi, en, hint, defaultValue });
const count = (name: string, vi: string, en: string, hint: string, defaultValue: number, min = 0, max = 999): ConfigOption => ({ name, kind: "number", vi, en, hint, defaultValue, min, max });
const questChoice = (
  name: string,
  vi: string,
  en: string,
  hint: string,
  choices: Array<{ value: string; vi: string; en: string }>
): ConfigOption => ({
  name,
  kind: "string",
  vi,
  en,
  hint,
  defaultValue: "None",
  choices: [{ value: "None", vi: "Chưa chọn", en: "None" }, ...choices]
});

/** The PoB options that matter for most builds, in plain words. */
export const CONFIG_GROUPS: ConfigGroup[] = [
  {
    id: "quests_choice",
    vi: "Phần thưởng nhiệm vụ (Lựa chọn)",
    en: "Quest rewards (Choices)",
    options: [
      questChoice(
        "questAct 2Valley of the TitansMedallion",
        "Act 2 · Valley of the Titans (Medallion)",
        "Act 2 · Valley of the Titans (Medallion)",
        "Phần thưởng chọn 1 trong 2 tại Valley of the Titans (Act 2).",
        [
          { value: "30% increased Charm Charges Gained\n\t+1 Charm Slot", vi: "+30% lượng nạp Charm · +1 ô Charm", en: "30% increased Charm Charges Gained, +1 Charm Slot" },
          { value: "30% increased Charm Effect Duration\n\t+1 Charm Slot", vi: "+30% thời lượng Charm · +1 ô Charm", en: "30% increased Charm Effect Duration, +1 Charm Slot" }
        ]
      ),
      questChoice(
        "questAct 3Venom CryptsVenom Draught",
        "Act 3 · Venom Crypts (Venom Draught)",
        "Act 3 · Venom Crypts (Venom Draught)",
        "Thuốc thưởng chọn 1 trong 3 từ Servi sau khi xong Venom Crypts (Act 3).",
        [
          { value: "25% increased Stun Threshold", vi: "+25% ngưỡng choáng (Stun Threshold)", en: "25% increased Stun Threshold" },
          { value: "30% increased Elemental Ailment Threshold", vi: "+30% ngưỡng hiệu ứng nguyên tố", en: "30% increased Elemental Ailment Threshold" },
          { value: "25% increased Mana Regeneration Rate", vi: "+25% tốc độ hồi Mana", en: "25% increased Mana Regeneration Rate" }
        ]
      ),
      questChoice(
        "questAct 4Abandoned PrisonGoddess of Justice",
        "Act 4 · Abandoned Prison (Goddess of Justice)",
        "Act 4 · Abandoned Prison (Goddess of Justice)",
        "Phần thưởng hồi phục từ bình tại Abandoned Prison (Act 4).",
        [
          { value: "30% increased Life Recovery from Flasks", vi: "+30% hồi Máu từ bình (Life Flask)", en: "30% increased Life Recovery from Flasks" },
          { value: "30% increased Mana Recovery from Flasks", vi: "+30% hồi Mana từ bình (Mana Flask)", en: "30% increased Mana Recovery from Flasks" }
        ]
      ),
      questChoice(
        "questAct 4Eye of HinekoraTribal Medicine",
        "Act 4 · Eye of Hinekora / Whakapanu (Tribal Medicine)",
        "Act 4 · Eye of Hinekora (Tribal Medicine)",
        "Phần thưởng phòng thủ chọn 1 trong 2 (Tribal Medicine / Great White One, Act 4).",
        [
          { value: "30% increased Global Armour, Evasion and Energy Shield", vi: "+30% Giáp, Né & Khiên năng lượng", en: "30% increased Global Armour, Evasion and Energy Shield" },
          {
            value: "+15% of Armour also applies to Elemental Damage\n\tGain Deflection Rating equal to 12% of Evasion Rating\n\t12% faster start of Energy Shield Recharge",
            vi: "+15% Giáp đỡ nguyên tố · +12% Deflection · ES hồi nhanh 12%",
            en: "+15% Armour to Elemental, 12% Evasion as Deflection, 12% faster ES Recharge"
          }
        ]
      ),
      questChoice(
        "questAct 4Halls Of The DeadNgamahu's Test",
        "Act 4 · Halls of the Dead (Ngamahu)",
        "Act 4 · Halls of the Dead (Ngamahu)",
        "Hình xăm thưởng từ thử thách Ngamahu tại Halls of the Dead (Act 4).",
        [
          { value: "+5 to Strength", vi: "+5 Sức mạnh (Strength)", en: "+5 to Strength" },
          { value: "+5% to Fire Resistance", vi: "+5% kháng Lửa (Fire)", en: "+5% to Fire Resistance" }
        ]
      ),
      questChoice(
        "questAct 4Halls Of The DeadTasalio's Test",
        "Act 4 · Halls of the Dead (Tasalio)",
        "Act 4 · Halls of the Dead (Tasalio)",
        "Hình xăm thưởng từ thử thách Tasalio tại Halls of the Dead (Act 4).",
        [
          { value: "+5 to Intelligence", vi: "+5 Trí tuệ (Intelligence)", en: "+5 to Intelligence" },
          { value: "+5% to Cold Resistance", vi: "+5% kháng Băng (Cold)", en: "+5% to Cold Resistance" }
        ]
      ),
      questChoice(
        "questAct 4Halls Of The DeadTawhoa's Test",
        "Act 4 · Halls of the Dead (Tawhoa)",
        "Act 4 · Halls of the Dead (Tawhoa)",
        "Hình xăm thưởng từ thử thách Tawhoa tại Halls of the Dead (Act 4).",
        [
          { value: "+5 to Dexterity", vi: "+5 Nhanh nhẹn (Dexterity)", en: "+5 to Dexterity" },
          { value: "+5% to Lightning Resistance", vi: "+5% kháng Sét (Lightning)", en: "+5% to Lightning Resistance" }
        ]
      ),
      questChoice(
        "questInterlude 2QimahSeven Pillars",
        "Interlude 2 · Qimah (Seven Pillars)",
        "Interlude 2 · Qimah (Seven Pillars)",
        "Chọn 1 trong 7 trụ buff tại Qimah (Interlude 2).",
        [
          { value: "+5% to all Elemental Resistances", vi: "+5% tất cả kháng nguyên tố", en: "+5% to all Elemental Resistances" },
          { value: "3% increased Movement Speed", vi: "+3% tốc độ di chuyển", en: "3% increased Movement Speed" },
          { value: "15% increased Global Armour, Evasion and Energy Shield", vi: "+15% Giáp, Né & Khiên năng lượng", en: "15% increased Global Armour, Evasion and Energy Shield" },
          { value: "20% increased Presence Area Of Effect", vi: "+20% phạm vi Presence", en: "20% increased Presence Area Of Effect" },
          { value: "12% increased Cooldown Recovery Rate", vi: "+12% tốc độ hồi chiêu (CDR)", en: "12% increased Cooldown Recovery Rate" },
          { value: "+5 to all Attributes", vi: "+5 tất cả thuộc tính (STR/DEX/INT)", en: "+5 to all Attributes" },
          {
            value: "5% increased Experience Gain\n\t-5% to all Elemental Resistances\n\t3% reduced Movement Speed\n\t15% reduced Global Armour, Evasion and Energy Shield\n\t20% reduced Presence Area Of Effect\n\t12% reduced Cooldown Recovery Rate\n\t5% reduced Attributes",
            vi: "+5% kinh nghiệm (giảm kháng, tốc chạy, phòng thủ, thuộc tính)",
            en: "5% increased Experience Gain (with stat penalties)"
          }
        ]
      )
    ]
  },
  {
    id: "quests_fixed",
    vi: "Phần thưởng nhiệm vụ cố định (Cốt truyện)",
    en: "Campaign quest bonuses (Fixed)",
    options: [
      flag("questAct 1ClearfellBeira", "Act 1 · Clearfell (Beira): +10% kháng Băng", "Act 1 · Clearfell (Beira): +10% Cold Resistance", "Phần thưởng cố định từ boss Beira ở Clearfell (PoB mặc định bật sẵn).", true),
      flag("questAct 1FreythornKing In The Mists", "Act 1 · Freythorn (King in the Mists): +30 Spirit", "Act 1 · Freythorn (King in the Mists): +30 Spirit", "Phần thưởng cố định từ King in the Mists ở Freythorn (PoB mặc định bật sẵn).", true),
      flag("questAct 1Ogham ManorCandlemass", "Act 1 · Ogham Manor (Candlemass): +20 Máu tối đa", "Act 1 · Ogham Manor (Candlemass): +20 maximum Life", "Phần thưởng cố định từ Candlemass ở Ogham Manor (PoB mặc định bật sẵn).", true),
      flag("questAct 2Spires of DesharSisters of Garukhan Shrine", "Act 2 · Spires of Deshar: +10% kháng Sét", "Act 2 · Spires of Deshar: +10% Lightning Resistance", "Phần thưởng cố định tại đền Sisters of Garukhan (PoB mặc định bật sẵn).", true),
      flag("questAct 3Azak BogIgnagduk", "Act 3 · Azak Bog (Ignagduk): +30 Spirit", "Act 3 · Azak Bog (Ignagduk): +30 Spirit", "Phần thưởng cố định từ Ignagduk ở Azak Bog (PoB mặc định bật sẵn).", true),
      flag("questAct 3Jiquani's MachinariumBlackjaw", "Act 3 · Jiquani's Machinarium (Blackjaw): +10% kháng Lửa", "Act 3 · Jiquani's Machinarium (Blackjaw): +10% Fire Resistance", "Phần thưởng cố định từ Blackjaw (PoB mặc định bật sẵn).", true),
      flag("questAct 4Eye of HinekoraSilent Hall", "Act 4 · Eye of Hinekora (Silent Hall): +5% Mana tối đa", "Act 4 · Eye of Hinekora (Silent Hall): +5% maximum Mana", "Phần thưởng cố định tại Silent Hall (PoB mặc định bật sẵn).", true),
      flag("questInterlude 2Khari CrossingMolten Shrine", "Interlude 2 · Khari Crossing (Molten Shrine): +5% Máu tối đa", "Interlude 2 · Khari Crossing (Molten Shrine): +5% maximum Life", "Phần thưởng cố định +5% Máu tối đa tại Khari Crossing (PoB mặc định bật sẵn).", true),
      flag("questInterlude 3Kriar VillageLythara", "Interlude 3 · Kriar Village (Lythara): +40 Spirit", "Interlude 3 · Kriar Village (Lythara): +40 Spirit", "Phần thưởng cố định +40 Spirit từ Lythara (PoB mặc định bật sẵn).", true)
    ]
  },
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

const CONFIG_OPTION_BY_NAME = new Map<string, ConfigOption>(CONFIG_OPTIONS.map((option) => [option.name, option]));

const collapseWs = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Restores PoB's canonical multi-line option string (with `\n\t`) when browser DOMParser
 * normalized raw newline/tab characters in an XML attribute into spaces on PoB import.
 */
export function normalizeConfigInputString(name: string, value: string): string {
  const option = CONFIG_OPTION_BY_NAME.get(name);
  if (!option?.choices?.length) return value;
  if (option.choices.some((choice) => choice.value === value)) return value;
  const collapsed = collapseWs(value);
  const match = option.choices.find((choice) => collapseWs(choice.value) === collapsed);
  return match ? match.value : value;
}

export function configInputValue(inputs: PobConfigInput[] | undefined, option: ConfigOption): boolean | number | string {
  const input = inputs?.find((row) => row.name === option.name);
  if (!input) return option.defaultValue;
  if (option.kind === "boolean") return input.value === true || input.value === "true";
  if (option.kind === "number") return Number(input.value) || 0;
  return normalizeConfigInputString(option.name, String(input.value));
}

/** New input list with `name` set; removing it when it equals PoB's default keeps the config small. */
export function setConfigInput(inputs: PobConfigInput[] | undefined, option: ConfigOption, value: boolean | number | string): PobConfigInput[] {
  const rest = (inputs ?? []).filter((row) => row.name !== option.name);
  let next: boolean | number | string = value;
  if (option.kind === "number") {
    const n = Number(value);
    next = Number.isFinite(n) ? Math.min(Math.max(n, option.min ?? -Infinity), option.max ?? Infinity) : 0;
  } else if (option.kind === "string") {
    next = normalizeConfigInputString(option.name, String(value));
  }
  if (next === option.defaultValue) return rest;
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
  const totals = groupNames.map(() => 0);
  const gems = groupNames.flatMap((names, group) => names.map((name) => ({ group, key: nameKey(name), matched: false })).filter((gem) => gem.key));
  // Exact names first for every group, then "Arc (part 2)"-style rows that only start
  // with a name, so a short name cannot take the row of a longer one ("Arc" vs "Arc X").
  const claim = (matches: (rowKey: string, key: string) => boolean) => {
    for (const gem of gems) {
      if (gem.matched) continue;
      const row = pending.find((candidate) => !candidate.used && matches(candidate.key, gem.key));
      if (!row) continue;
      row.used = true;
      gem.matched = true;
      totals[gem.group] += row.dps;
    }
  };
  claim((rowKey, key) => rowKey === key);
  claim((rowKey, key) => rowKey.startsWith(`${key} `));
  return totals;
}

/** One skill PoB calculated in a group (GroupDPS[row].skills of scripts/pob-calculate.lua). */
export interface GroupSkillDamage {
  /** PoB's name for the skill ("Comet", "Gale Force", "Companion: Elephant Tortoise"). */
  name: string;
  /** Its damage: per second, or per hit when `average`. Already times `count`. */
  value: number;
  average?: boolean;
  /** The number is its minion's. */
  minion?: boolean;
  /** Which gem of the group it comes from (1 = the group's first gem); undefined from an older calculator. */
  gem?: number;
  skillId?: string;
}

/** One group's damage from the calculator's GroupDPS (scripts/pob-calculate.lua). */
export interface GroupDamage {
  /** Damage per second of the group's skills (with their minions), 0 when none. */
  dps: number;
  /** Average damage per hit, for skills PoB shows per hit and that have no rate. */
  average?: number;
  /** Every skill PoB calculated for the group, in PoB's order, with or without damage. */
  skills?: GroupSkillDamage[];
}

const groupSkills = (value: unknown): GroupSkillDamage[] => (Array.isArray(value) ? value : []).flatMap((row): GroupSkillDamage[] => {
  if (!row || typeof row !== "object" || typeof row.name !== "string" || !row.name) return [];
  const count = Number(row.count) > 1 ? Number(row.count) : 1;
  const damage = Number(row.value) * count;
  return [{
    name: row.name,
    value: Number.isFinite(damage) && damage > 0 ? damage : 0,
    ...(row.average ? { average: true } : {}),
    ...(row.minion ? { minion: true } : {}),
    ...(Number(row.gem) > 0 ? { gem: Number(row.gem) } : {}),
    ...(typeof row.skillId === "string" ? { skillId: row.skillId } : {})
  }];
});

/**
 * Each planner group's damage from PoB's GroupDPS, keyed by the XML row its group was
 * sent as: the planner sends one row per group that has a gem, in order (as for
 * GemOptions). undefined when the calculator sent no GroupDPS (older script); a group
 * without an entry (not in PoB's Full DPS pass) gets undefined too.
 */
export function groupDamageByRow(groupDps: unknown, skills: Array<{ skillId: string }>): Array<GroupDamage | undefined> | undefined {
  if (!groupDps || typeof groupDps !== "object") return undefined;
  const rows = groupDps as Record<string, { dps?: unknown; average?: unknown; skills?: unknown } | undefined>;
  let row = 0;
  return skills.map((skill) => {
    if (!skill.skillId.trim()) return undefined;
    row += 1;
    const entry = rows[String(row)];
    if (!entry || typeof entry !== "object") return undefined;
    const dps = Number(entry.dps);
    const average = Number(entry.average);
    const skills = groupSkills(entry.skills);
    return {
      dps: Number.isFinite(dps) && dps > 0 ? dps : 0,
      ...(Number.isFinite(average) && average > 0 ? { average } : {}),
      ...(skills.length ? { skills } : {})
    };
  });
}

/** One line of a card's damage: which skill, how much. */
export interface CardDamageLine {
  name: string;
  value: number;
  /** An average hit (no rate per second), shown "/đòn". */
  perHit: boolean;
  minion: boolean;
  /** The skill of the card's own (first) gem; false for a skill another gem of the group or a support grants. */
  own: boolean;
}

/**
 * Whose damage a card's number is. A group's number adds up every skill PoB calculated
 * in it, and those are often not the card's own gem: the spells socketed in Cast on
 * Critical, Vile Effusion from Dark Effigy, a damaging skill a support grants on a curse.
 * Returns the skills that deal damage, highest first, each under PoB's name for it.
 * `own` marks the first skill of the group's first gem (the card's title).
 */
export function cardDamageLines(damage: GroupDamage | undefined): CardDamageLine[] {
  const skills = damage?.skills ?? [];
  // The card's own skill: the first one PoB lists for the first gem (the group's first
  // skill when the calculator does not say which gem each skill is from).
  const tagged = skills.some((skill) => skill.gem !== undefined);
  const ownIndex = tagged ? skills.findIndex((skill) => skill.gem === 1) : 0;
  return skills
    .map((skill, index) => ({ name: skill.name, value: skill.value, perHit: Boolean(skill.average), minion: Boolean(skill.minion), own: index === ownIndex }))
    .filter((line) => line.value > 0)
    .sort((a, b) => Number(a.perHit) - Number(b.perHit) || b.value - a.value);
}

/**
 * Whether the card has to spell out whose damage its number is: more than one damaging
 * skill, or one that is not the card's own gem (a card must not show another skill's
 * damage under its own name).
 */
export const cardDamageNeedsNames = (lines: CardDamageLine[]): boolean =>
  lines.length > 1 || (lines.length === 1 && !lines[0].own);

/** "Comet, Arc": the skills the group's damage belongs to, for a one-line summary. */
export const cardDamageOwners = (lines: CardDamageLine[], limit = 3): string => {
  const names = [...new Set(lines.map((line) => line.name))];
  return names.length > limit ? `${names.slice(0, limit).join(", ")}, +${names.length - limit}` : names.join(", ");
};

interface GrantedGroupLike {
  skillId: string;
  pobSkillId?: string;
  itemSlot?: string;
  itemSource?: string;
  disabled?: boolean;
  supportSkills: Array<{ skillId: string }>;
}

/**
 * Item-granted groups PoB folds into the player's own group for the same skill, by
 * index. An item grants its skill as a group of its own (Raise Shield from the shield,
 * Purity of Fire from a sceptre); when the player also has a group for that skill (to
 * give it supports), PoB calculates the two as one (CalcSetup), and a PoB code lists
 * both. The planner shows one card for them: the player's. Groups are paired one to
 * one in order; `keep` (the main group) is never hidden.
 */
export function foldedGrantedGroups(skills: GrantedGroupLike[], keep?: number): Set<number> {
  const key = (skill: GrantedGroupLike) => (skill.pobSkillId || skill.skillId).trim().toLowerCase();
  const granted = (skill: GrantedGroupLike) => /^Item:/i.test(skill.itemSource || "");
  const owned = new Map<string, number>();
  skills.forEach((skill) => {
    if (!skill.skillId.trim() || skill.disabled || granted(skill) || skill.itemSlot) return;
    owned.set(key(skill), (owned.get(key(skill)) ?? 0) + 1);
  });
  const hidden = new Set<number>();
  skills.forEach((skill, index) => {
    if (!skill.skillId.trim() || !granted(skill) || index === keep) return;
    if (skill.supportSkills.some((support) => support.skillId.trim())) return;
    const left = owned.get(key(skill)) ?? 0;
    if (left <= 0) return;
    owned.set(key(skill), left - 1);
    hidden.add(index);
  });
  return hidden;
}

/**
 * Whether the numbers stamped in a PoB code (<PlayerStat>) may be shown. They were
 * calculated by the PoB version that wrote the code, which is rarely the one this site
 * runs: showing them first and the site's own numbers a few seconds later makes DPS
 * and defences "change by themselves" (180,730 -> 156,817 on a poe.ninja Titan).
 * So they are only a fallback when the site's calculator gave no answer.
 */
export const stampedStatsUsable = (state: { calculated: boolean; calculating: boolean; failed: boolean }): boolean =>
  !state.calculated && !state.calculating && state.failed;

/** The number a card shows: its DPS, or its average hit when it deals damage only per hit. */
export const groupDamageValue = (damage: GroupDamage | undefined): number | undefined =>
  damage === undefined ? undefined : damage.dps > 0 ? damage.dps : damage.average ?? 0;

export interface SkillCardInput {
  index: number;
  /** Group has an active gem picked. */
  hasSkill: boolean;
  disabled: boolean;
  /** Its DPS from the last calculation; undefined while unknown. */
  dps: number | undefined;
  isMain: boolean;
  /** PoB offers a stat set / part / minion choice: its damage may be in another one. */
  hasChoices?: boolean;
}

/**
 * Skills panel order: damaging skills first (highest DPS first, the main skill on
 * ties), then new empty groups; disabled groups and skills without damage (auras,
 * buffs, utility) go to "Kỹ năng phụ" — unless PoB offers a choice for them (stat set,
 * part, minion): the damage may be in another choice, so they stay in view. Before the first calculation everything
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
    else if (card.dps === undefined || card.isMain || card.dps > 0 || card.hasChoices) primary.push(card);
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

/**
 * A resistance the way PoB's sidebar shows it: the capped percentage, except chaos with
 * Chaos Inoculation, which PoB shows as "Immune" (BuildDisplayStats: ChaosResist is
 * hidden and an "Immune" row shown when output.ChaosInoculation). undefined when the
 * stats have no value for it.
 */
export function resistanceText(stats: Record<string, unknown> | null | undefined, stat: string, locale: string, fallback?: number): string | undefined {
  if (stat === "ChaosResist" && stats?.ChaosInoculation === true) return locale === "vi" ? "Miễn nhiễm" : "Immune";
  const value = typeof stats?.[stat] === "number" ? stats[stat] as number : fallback;
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : undefined;
}

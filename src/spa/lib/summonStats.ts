// Minion and totem numbers of the main skill (the `Minion` / `Totem` objects that
// scripts/pob-calculate.lua adds from PoB's output), with plain Vietnamese labels.
import type { StatDefinition } from "./buildStats";

const s = (stat: string, vi: string, en: string, hint: string, format: StatDefinition["format"], extra: Partial<StatDefinition> = {}): StatDefinition => ({
  stat, vi, en, hint, format, higherIsBetter: true, ...extra
});

export const MINION_STATS: StatDefinition[] = [
  s("CombinedDPS", "DPS mỗi minion", "DPS per minion", "Sát thương mỗi giây của một minion với kỹ năng nó đang dùng (đã cộng sát thương theo thời gian). Có nhiều minion thì tổng sát thương nhân lên theo số lượng.", "short"),
  s("Count", "Số lượng", "Count", "Số minion loại này cùng lúc, theo PoB. Không hiện khi PoB không tính được (nhiều kỹ năng PoE2 gọi 1 minion mỗi gem).", "int"),
  s("AverageDamage", "Sát thương mỗi đòn", "Average hit", "Một đòn trúng của minion gây trung bình bao nhiêu sát thương.", "short"),
  s("Speed", "Tốc độ đánh / niệm", "Attack / cast rate", "Số lần minion dùng kỹ năng mỗi giây.", "speed"),
  s("CritChance", "Tỉ lệ chí mạng", "Critical hit chance", "Phần trăm đòn của minion thành chí mạng.", "pct1", { hideZero: true }),
  s("HitChance", "Tỉ lệ đánh trúng", "Hit chance", "Phần trăm đòn của minion trúng mục tiêu.", "pct"),
  s("Life", "Máu (Life)", "Life", "Máu tối đa của một minion. Minion chết thì phải gọi lại, mất sát thương.", "int"),
  s("EnergyShield", "Khiên năng lượng (ES)", "Energy shield", "Khiên năng lượng của minion, chịu sát thương trước máu.", "int", { hideZero: true }),
  s("Armour", "Giáp (Armour)", "Armour", "Giáp của minion, giảm sát thương vật lý mỗi đòn.", "int", { hideZero: true }),
  s("Evasion", "Né (Evasion)", "Evasion", "Chỉ số né của minion.", "int", { hideZero: true }),
  s("TotalEHP", "Máu hiệu dụng (EHP)", "Effective health pool", "Lượng sát thương ước tính một minion chịu được trước khi chết.", "short")
];

export const TOTEM_STATS: StatDefinition[] = [
  s("DPS", "DPS mỗi totem", "DPS per totem", "Sát thương mỗi giây của một totem, như PoB tính. Đặt nhiều totem cùng đánh thì tổng sát thương nhân lên theo số totem.", "short"),
  s("Count", "Số totem cùng lúc", "Active totems", "Số totem tối đa đặt được cùng lúc.", "int"),
  s("Life", "Máu mỗi totem", "Totem life", "Máu của một totem. Totem bị phá thì phải đặt lại.", "int"),
  s("EnergyShield", "Khiên năng lượng (ES)", "Energy shield", "Khiên năng lượng của totem.", "int", { hideZero: true }),
  s("Armour", "Giáp (Armour)", "Armour", "Giáp của totem.", "int", { hideZero: true })
];

export const MINION_RESISTANCES = ["FireResist", "ColdResist", "LightningResist", "ChaosResist"];

export interface SummonSheet {
  kind: "minion" | "totem";
  title: string;
  /** e.g. "Skeletal Storm Mage · Arc". */
  subtitle?: string;
  values: Record<string, number>;
  defs: StatDefinition[];
}

const numbers = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
};

/** The minion / totem sheets to show for a calculation (none for a plain skill). */
export function summonSheets(stats: Record<string, unknown> | null | undefined, locale: string): SummonSheet[] {
  const vi = locale === "vi";
  const sheets: SummonSheet[] = [];
  const minion = stats?.Minion as Record<string, unknown> | undefined;
  if (minion && typeof minion === "object") {
    const name = typeof minion.Name === "string" ? minion.Name : "";
    const skill = typeof minion.Skill === "string" ? minion.Skill : "";
    sheets.push({
      kind: "minion",
      title: vi ? "Minion (kỹ năng chính)" : "Minion (main skill)",
      subtitle: [name, skill].filter(Boolean).join(" · ") || undefined,
      values: numbers(minion),
      defs: MINION_STATS
    });
  }
  const totem = stats?.Totem as Record<string, unknown> | undefined;
  if (totem && typeof totem === "object") {
    sheets.push({ kind: "totem", title: vi ? "Totem (kỹ năng chính)" : "Totem (main skill)", values: numbers(totem), defs: TOTEM_STATS });
  }
  return sheets;
}

/** DPS shown for the main group: PoB's main-skill DPS, or its minion's when the player deals none. */
export function mainSkillDps(stats: Record<string, unknown> | null | undefined): number {
  const own = Number(stats?.CombinedDPS ?? stats?.TotalDPS ?? 0) || 0;
  if (own > 0) return own;
  const minion = stats?.Minion as Record<string, unknown> | undefined;
  return Number(minion?.CombinedDPS ?? 0) || 0;
}

// "Where does this number come from": PoB's stat breakdown (scripts/pob-calculate.lua,
// STAT BREAKDOWN block) turned into plain Vietnamese — sources grouped by type, mod
// names translated, no raw mod ids.

export interface BreakdownSource {
  /** BASE, INC, MORE (others are shown as they are). */
  type: string;
  value: number;
  /** PoB mod name: Life, FireResist, ElementalResist, LightningDamage... */
  name: string;
  /** item, tree, gem, quest, base, config... */
  kind: string;
  label: string;
}

export interface StatBreakdownEntry {
  value?: number;
  lines: string[];
  sources: BreakdownSource[];
}

const LINE_WORDS: Array<[RegExp, string]> = [
  [/\(base\)/g, "(gốc)"],
  [/\(increased\/reduced\)/g, "(tăng/giảm)"],
  [/\(more\/less\)/g, "(nhân thêm/bớt)"],
  [/\(crit chance\)/g, "(tỉ lệ chí mạng)"],
  [/\(average damage\)/g, "(sát thương trung bình)"],
  [/\(attack rate\)/g, "(tốc độ đánh)"],
  [/\(cast rate\)/g, "(tốc độ niệm)"],
  [/\(DPS multiplier for this skill\)/g, "(hệ số DPS của kỹ năng)"],
  [/casts per second/g, "lần niệm mỗi giây"],
  [/attacks per second/g, "lần đánh mỗi giây"],
  [/^Min:/, "Thấp nhất:"],
  [/^Max:/, "Tối đa:"],
  [/^Total:/, "Tổng (trước trần):"],
  [/Critical Strike Bifurcates:/g, "Chí mạng hai lần (Bifurcate):"]
];

/** One PoB breakdown line in Vietnamese where the wording is known. */
export function translateBreakdownLine(line: string): string {
  return LINE_WORDS.reduce((text, [pattern, vi]) => text.replace(pattern, vi), String(line));
}

const MOD_NAMES: Record<string, string> = {
  Life: "Máu", Mana: "Mana", Spirit: "Spirit", EnergyShield: "Khiên năng lượng",
  Armour: "Giáp", Evasion: "Né", ArmourAndEvasion: "Giáp và né", Defences: "Mọi phòng thủ (giáp, né, ES)",
  FireResist: "Kháng lửa", ColdResist: "Kháng băng", LightningResist: "Kháng sét", ChaosResist: "Kháng hỗn mang",
  ElementalResist: "Kháng mọi nguyên tố",
  LifeRegen: "Hồi máu", LifeRegenPercent: "Hồi máu theo %", ManaRegen: "Hồi mana", ManaRegenPercent: "Hồi mana theo %",
  MovementSpeed: "Tốc độ di chuyển", BlockChance: "Tỉ lệ chặn", EvadeChance: "Tỉ lệ né",
  CritChance: "Tỉ lệ chí mạng", CritMultiplier: "Sát thương chí mạng", Speed: "Tốc độ đánh / niệm", Accuracy: "Chính xác",
  Damage: "Sát thương (mọi loại)", PhysicalDamage: "Sát thương vật lý", FireDamage: "Sát thương lửa",
  ColdDamage: "Sát thương băng", LightningDamage: "Sát thương sét", ChaosDamage: "Sát thương hỗn mang",
  ElementalDamage: "Sát thương nguyên tố"
};

export const modNameVi = (name: string) => MOD_NAMES[name] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2");

const KIND_ORDER = ["base", "attribute", "item", "tree", "gem", "quest", "config", "other"];
/** PoB names attribute bonuses after the attribute ("Strength" gives Life). */
const ATTRIBUTE_SOURCES: Record<string, string> = { strength: "Sức mạnh (Str)", dexterity: "Khéo léo (Dex)", intelligence: "Trí tuệ (Int)" };
const KIND_TITLES: Record<string, string> = {
  base: "Gốc của nhân vật",
  attribute: "Từ thuộc tính",
  item: "Trang bị",
  tree: "Cây thụ động",
  gem: "Gem kỹ năng",
  quest: "Phần thưởng nhiệm vụ",
  config: "Điều kiện tính",
  other: "Nguồn khác"
};

const round = (value: number) => (Math.abs(value) >= 100 || Number.isInteger(value) ? Math.round(value) : Math.round(value * 100) / 100);

/** "+37", "+12% tăng", "−10% giảm", "+25% nhân thêm" / "−20% nhân bớt". */
export function sourceValueText(row: Pick<BreakdownSource, "type" | "value">): string {
  const sign = row.value >= 0 ? "+" : "−";
  const magnitude = round(Math.abs(row.value));
  if (row.type === "INC") return `${sign}${magnitude}% ${row.value >= 0 ? "tăng" : "giảm"}`;
  if (row.type === "MORE") return `${sign}${magnitude}% ${row.value >= 0 ? "nhân thêm" : "nhân bớt"}`;
  if (row.type === "OVERRIDE") return `= ${magnitude}`;
  return `${sign}${magnitude}`;
}

export interface BreakdownGroup {
  kind: string;
  title: string;
  rows: Array<BreakdownSource & { text: string; nameVi: string }>;
}

/** Sources grouped by where they come from (base, items, passives, gems...), biggest first. */
export function groupBreakdownSources(sources: BreakdownSource[]): BreakdownGroup[] {
  const typeRank = (type: string) => ({ BASE: 0, INC: 1, MORE: 2 } as Record<string, number>)[type] ?? 3;
  const groups = new Map<string, BreakdownGroup>();
  for (const row of sources ?? []) {
    const attribute = ATTRIBUTE_SOURCES[String(row.kind).toLowerCase()];
    const kind = attribute ? "attribute" : KIND_ORDER.includes(row.kind) ? row.kind : "other";
    if (!groups.has(kind)) groups.set(kind, { kind, title: KIND_TITLES[kind], rows: [] });
    groups.get(kind)!.rows.push({ ...row, label: attribute ?? row.label, text: sourceValueText(row), nameVi: modNameVi(row.name) });
  }
  for (const group of groups.values()) {
    group.rows.sort((a, b) => typeRank(a.type) - typeRank(b.type) || Math.abs(b.value) - Math.abs(a.value));
  }
  return KIND_ORDER.filter((kind) => groups.has(kind)).map((kind) => groups.get(kind)!);
}

/** Sum of increases and product of "more" modifiers, as PoB combines them. */
export function breakdownTotals(sources: BreakdownSource[]): { base: number; increased: number; more: number } {
  let base = 0;
  let increased = 0;
  let more = 1;
  for (const row of sources ?? []) {
    if (row.type === "BASE") base += row.value;
    else if (row.type === "INC") increased += row.value;
    else if (row.type === "MORE") more *= 1 + row.value / 100;
  }
  return { base, increased, more };
}

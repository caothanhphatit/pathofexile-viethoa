// "Nhân vật này chưa dùng được build": items and gems whose level or attribute
// requirements the character does not meet, and more passive points than its level
// gives. The warnings never block anything and never change the numbers: Path of
// Building keeps counting an item or gem whose requirements are not met (it only
// paints the requirement red), so the planner's calculation does the same.
//
// Where the numbers come from:
// - attributes: PoB's own output of the calculation (ReqStr / ReqDex / ReqInt against
//   Str / Dex / Int, and "<Attr>RequirementsOn<slot>" per equipped item);
// - item level: the item's text ("LevelReq:" in PoB text, "Requires: Level N" in a game
//   copy), else the site's record of the item;
// - gem level and passive points: PoB's data and formula (src/shared/equipment-rules.mjs).
import { MAX_ASCENDANCY_POINTS, WEAPON_SET_POINT_LIMIT, gemLevelRequirement, passivePointUse } from "../../shared/equipment-rules.mjs";

export type BuildWarningKind =
  | "item-level"
  | "gem-level"
  | "attribute"
  | "skill-weapon"
  | "spirit"
  | "passive-points"
  | "ascendancy-points"
  | "weapon-set-points";

export interface BuildWarning {
  kind: BuildWarningKind;
  text: string;
}

export interface WarningItem {
  /** Planner slot id (Weapon1, Helm1...). */
  slotId: string;
  slotLabel: string;
  name: string;
  /** Character level the item needs, when known. */
  levelReq?: number;
}

export interface WarningGem {
  name: string;
  gemLevel: number;
}

export interface WarningPoints {
  /** Allocated non-ascendancy nodes, class starts and nodes an item allocates left out. */
  passive: number;
  ascendancy: number;
  set1: number;
  set2: number;
}

/** Character level an item needs, read from its text or from the site's requirement lines. */
export function itemLevelRequirement(text: string | undefined, recordRequirements: string[] = []): number | undefined {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
  const patterns = [/^LevelReq:\s*(\d+)/i, /^Requires:?\s*Level\s*(\d+)/i, /^Level:\s*(\d+)/i];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      // "Level: 20" is also a gem's own level line in a game copy; items list it under "Requirements:".
      if (match && (pattern !== patterns[2] || lines.some((row) => /^Requirements:?$/i.test(row)))) return Number(match[1]) || undefined;
    }
  }
  for (const line of recordRequirements) {
    const match = String(line).match(/Level\s*(\d+)/i);
    if (match) return Number(match[1]) || undefined;
  }
  return undefined;
}

/** PoB's slot name for a planner slot in the calculation that ran (the active weapon set is "Weapon 1/2"). */
export function pobRequirementSlot(slotId: string, activeWeaponSet: 1 | 2): string | undefined {
  const names: Record<string, string> = {
    Helm1: "Helmet", BodyArmour1: "Body Armour", Gloves1: "Gloves", Boots1: "Boots", Amulet1: "Amulet",
    Ring1: "Ring 1", Ring2: "Ring 2", Ring3: "Ring 3", Belt1: "Belt"
  };
  if (names[slotId]) return names[slotId];
  const set = slotId === "Weapon1" || slotId === "Weapon2" ? 1 : slotId === "Weapon3" || slotId === "Weapon4" ? 2 : 0;
  if (!set) return undefined;
  const hand = slotId === "Weapon1" || slotId === "Weapon3" ? "Weapon 1" : "Weapon 2";
  // PoB names the set in use "Weapon 1/2" and the other one "... Swap".
  return set === activeWeaponSet ? hand : `${hand} Swap`;
}

const ATTRIBUTES = [
  { key: "Str", vi: "Sức mạnh (Str)", en: "Strength" },
  { key: "Dex", vi: "Khéo léo (Dex)", en: "Dexterity" },
  { key: "Int", vi: "Trí tuệ (Int)", en: "Intelligence" }
] as const;

const listNames = (names: string[], vi: boolean, limit = 3): string => {
  const shown = names.slice(0, limit).join(", ");
  const rest = names.length - limit;
  return rest > 0 ? `${shown} ${vi ? `và ${rest} món khác` : `and ${rest} more`}` : shown;
};

export function buildWarnings(input: {
  level: number;
  locale: string;
  items?: WarningItem[];
  gems?: WarningGem[];
  /** Enabled skill gems whose active weapon set cannot use them (e.g. Bow skill with Wand). */
  skillWeaponWarnings?: string[];
  /** PoB's output for the build, or null while it has not been calculated. */
  stats?: Record<string, unknown> | null;
  activeWeaponSet?: 1 | 2;
  points?: WarningPoints | null;
}): BuildWarning[] {
  const vi = input.locale === "vi";
  const level = input.level;
  const warnings: BuildWarning[] = [];

  const lowItems = (input.items ?? []).filter((item) => (item.levelReq ?? 0) > level).sort((a, b) => (b.levelReq ?? 0) - (a.levelReq ?? 0));
  if (lowItems.length) {
    const names = lowItems.map((item) => `${item.name} (${vi ? "cấp" : "level"} ${item.levelReq})`);
    warnings.push({
      kind: "item-level",
      text: vi
        ? `${lowItems.length} món đồ cần cấp cao hơn cấp ${level} của nhân vật: ${listNames(names, true)}.`
        : `${lowItems.length} item(s) need a higher level than ${level}: ${listNames(names, false)}.`
    });
  }

  const lowGems = (input.gems ?? [])
    .map((gem) => ({ ...gem, levelReq: gemLevelRequirement(gem.gemLevel) ?? 0 }))
    .filter((gem) => gem.levelReq > level)
    .sort((a, b) => b.levelReq - a.levelReq);
  if (lowGems.length) {
    const names = lowGems.map((gem) => `${gem.name} Lv ${gem.gemLevel} (${vi ? "cấp" : "level"} ${gem.levelReq})`);
    warnings.push({
      kind: "gem-level",
      text: vi
        ? `${lowGems.length} gem kỹ năng cần cấp cao hơn cấp ${level} của nhân vật: ${listNames(names, true).replace("món khác", "gem khác")}.`
        : `${lowGems.length} skill gem(s) need a higher level than ${level}: ${listNames(names, false)}.`
    });
  }

  const stats = input.stats;
  if (stats) {
    const number = (key: string) => (typeof stats[key] === "number" ? (stats[key] as number) : undefined);
    for (const attribute of ATTRIBUTES) {
      const have = number(attribute.key);
      const need = number(`Req${attribute.key}`);
      if (have === undefined || need === undefined || need <= have) continue;
      // Who asks for it: every item that needs more than the character has, and the gems
      // when the highest requirement is not an item's.
      const itemNeeds = (input.items ?? []).map((item) => {
        const slot = pobRequirementSlot(item.slotId, input.activeWeaponSet ?? 1);
        return { name: item.name, need: slot ? number(`${attribute.key}RequirementsOn${slot}`) ?? 0 : 0 };
      }).filter((row) => row.need > have).sort((left, right) => right.need - left.need);
      const sources = itemNeeds.map((row) => `${row.name} (${Math.round(row.need)})`);
      if (!itemNeeds.length || itemNeeds[0].need < need) sources.unshift(`${vi ? "gem kỹ năng" : "skill gems"} (${Math.round(need)})`);
      const from = listNames(sources, vi);
      warnings.push({
        kind: "attribute",
        text: vi
          ? `Thiếu ${attribute.vi}: cần ${Math.round(need)}, nhân vật có ${Math.round(have)}. Yêu cầu từ: ${from}.`
          : `Not enough ${attribute.en}: ${Math.round(need)} needed, ${Math.round(have)} available. Required by: ${from}.`
      });
    }
    const spiritUnreserved = number("SpiritUnreserved");
    if (spiritUnreserved !== undefined && spiritUnreserved < 0) {
      const deficit = Math.abs(Math.round(spiritUnreserved));
      const setRoman = (input.activeWeaponSet ?? 1) === 2 ? "II" : "I";
      warnings.push({
        kind: "spirit",
        text: vi
          ? `Thiếu ${deficit} Spirit ở Bộ vũ khí ${setRoman}: các kỹ năng duy trì đang bật trên Bộ ${setRoman} vượt quá tổng Spirit hiện có.`
          : `Not enough Spirit on Weapon Set ${setRoman} (short by ${deficit}): active persistent skills on Set ${setRoman} exceed total Spirit.`
      });
    }
  }

  for (const text of input.skillWeaponWarnings ?? []) {
    if (text) warnings.push({ kind: "skill-weapon", text });
  }

  const points = input.points;
  if (points) {
    // Extra points PoB found for this build (quest and item bonuses): its ExtraPoints and
    // PassivePointsToWeaponSetPoints outputs. Without a calculation the hard limits are not judged.
    const statNumber = (key: string) => (stats && typeof stats[key] === "number" ? (stats[key] as number) : 0);
    const extra = statNumber("ExtraPoints");
    const setLimit = WEAPON_SET_POINT_LIMIT + statNumber("PassivePointsToWeaponSetPoints");
    const use = passivePointUse({ pointsUsed: points.passive, set1: points.set1, set2: points.set2, extra });
    if (stats && use.used > use.max) {
      warnings.push({
        kind: "passive-points",
        text: vi
          ? `Cây thụ động dùng ${use.used} điểm, nhiều hơn tối đa ${use.max} điểm của nhân vật cấp 100.`
          : `The tree uses ${use.used} passive points; a level 100 character has ${use.max}.`
      });
    } else if (use.requiredLevel > level) {
      warnings.push({
        kind: "passive-points",
        text: vi
          ? `Cây thụ động dùng ${use.used} điểm: cần khoảng cấp ${use.requiredLevel}, nhân vật đang cấp ${level}.`
          : `The tree uses ${use.used} passive points: that takes about level ${use.requiredLevel}, the character is level ${level}.`
      });
    }
    if (points.ascendancy > MAX_ASCENDANCY_POINTS) {
      warnings.push({
        kind: "ascendancy-points",
        text: vi
          ? `Đã chọn ${points.ascendancy} điểm thăng hoa (ascendancy), tối đa là ${MAX_ASCENDANCY_POINTS}.`
          : `${points.ascendancy} ascendancy points allocated; the maximum is ${MAX_ASCENDANCY_POINTS}.`
      });
    }
    for (const [set, used] of [[1, points.set1], [2, points.set2]]) {
      if (!stats || used <= setLimit) continue;
      warnings.push({
        kind: "weapon-set-points",
        text: vi
          ? `Bộ vũ khí ${set} dùng ${used} điểm, tối đa là ${setLimit}.`
          : `Weapon set ${set} uses ${used} points; the maximum is ${setLimit}.`
      });
    }
  }
  return warnings;
}

/**
 * Passive nodes an equipped item allocates for free ("Allocates <notable>", PoB's
 * GrantedPassive): PoB leaves them out of the point count.
 */
export function freeAllocatedNames(itemTexts: Iterable<string | undefined>): string[] {
  const names: string[] = [];
  for (const text of itemTexts) {
    for (const line of String(text ?? "").split(/\r?\n/)) {
      const match = line.replace(/^(?:\{[^}]*\})+/, "").trim().match(/^Allocates (.+)$/i);
      if (match) names.push(match[1].trim().toLowerCase());
    }
  }
  return names;
}

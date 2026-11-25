// Per-skill and per-item usability checks (weapon compatibility, gem level,
// STR/DEX/INT requirements, and Spirit overflow), plus Meta/trigger skill detection.
import { gemLevelRequirement } from "../../shared/equipment-rules.mjs";
import { pobRequirementSlot, type WarningItem } from "./buildWarnings";
import { skillWeaponHint, skillWeaponMissing, skillWeaponNeed, type WeaponHands } from "./skillWeapon";

export type SkillUsabilityKind = "weapon" | "level" | "attribute" | "spirit";

export interface SkillUsabilityIssue {
  kind: SkillUsabilityKind;
  /** Short pill shown directly on the skill card ("Cần Bows", "Thiếu 31 Dex", "Cần cấp 90"). */
  shortLabel: string;
  /** Full explanation shown in tooltips, detail panel, and build warnings. */
  message: string;
}

/** True when a skill gem is a PoE2 Meta / Trigger gem (e.g. Cast on Critical, Blasphemy, Invocation). */
export function isMetaTriggerSkill(tags: string[] | undefined): boolean {
  return (tags ?? []).some((tag) => tag.trim().toLowerCase() === "meta");
}

/** True when a skill gem reserves Spirit while active (Persistent Buff/Aura/Herald/Meta/Minion). */
export function isSpiritReservingSkill(tags: string[] | undefined): boolean {
  const lower = new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()));
  if (!lower.has("persistent")) return false;
  return lower.has("buff") || lower.has("aura") || lower.has("herald") || lower.has("meta") || lower.has("minion");
}

const ATTR_KEYS = [
  { key: "Str", vi: "Str", en: "Str" },
  { key: "Dex", vi: "Dex", en: "Dex" },
  { key: "Int", vi: "Int", en: "Int" }
] as const;

/**
 * All exact reasons an enabled skill group cannot currently be used:
 * - wrong weapon for an Attack/weapon-restricted skill vs active Weapon Set I/II
 * - character level below PoB's gem level requirement
 * - exact per-gem attribute requirement (only when supplied directly, never linearly guessed)
 * - negative unreserved Spirit from PoB for Persistent skills
 */
export function skillUsabilityIssues(input: {
  skillName: string;
  gemLevel: number;
  disabled?: boolean;
  granted?: boolean;
  tags?: string[];
  requirements?: string[];
  gemReq?: Partial<Record<"Str" | "Dex" | "Int", number>>;
  characterLevel: number;
  activeSet: 1 | 2;
  sets: Record<1 | 2, WeaponHands>;
  stats?: Record<string, unknown> | null;
  locale: string;
}): SkillUsabilityIssue[] {
  if (input.disabled) return [];
  const vi = input.locale === "vi";
  const issues: SkillUsabilityIssue[] = [];

  // 1. Weapon compatibility (Attack skills & weapon-specific skills vs active Weapon Set I/II).
  if (!input.granted) {
    const need = skillWeaponNeed(input.requirements);
    if (need && skillWeaponMissing(need, input.sets[input.activeSet])) {
      const hint = skillWeaponHint({
        skillName: input.skillName,
        requirements: input.requirements,
        activeSet: input.activeSet,
        sets: input.sets,
        locale: input.locale
      });
      const needText = need.kind === "unarmed"
        ? (vi ? "tay không" : "Unarmed")
        : need.kind === "martial"
          ? (vi ? "vũ khí cận chiến/cung" : "Martial Weapon")
          : need.label;
      issues.push({
        kind: "weapon",
        shortLabel: vi ? `Cần ${needText}` : `Needs ${needText}`,
        message: hint || (vi ? `${input.skillName} cần ${needText}.` : `${input.skillName} requires ${needText}.`)
      });
    }
  }

  // 2. Character level requirement (for socketed non-granted gems).
  if (!input.granted) {
    const reqLevel = gemLevelRequirement(input.gemLevel) ?? 0;
    if (reqLevel > input.characterLevel) {
      issues.push({
        kind: "level",
        shortLabel: vi ? `Cần cấp ${reqLevel}` : `Needs Lv ${reqLevel}`,
        message: vi
          ? `${input.skillName} (Lv ${input.gemLevel}) cần nhân vật cấp ${reqLevel} (hiện cấp ${input.characterLevel}).`
          : `${input.skillName} (Lv ${input.gemLevel}) requires character level ${reqLevel} (currently ${input.characterLevel}).`
      });
    }
  }

  // 3. Per-gem attribute requirements — only when exact per-gem values are provided
  //    (avoids false positives from linear interpolation against build-wide ReqStr/Dex/Int).
  const stats = input.stats;
  if (!input.granted && stats && input.gemReq) {
    const statNum = (key: string) => (typeof stats[key] === "number" ? (stats[key] as number) : undefined);
    for (const attr of ATTR_KEYS) {
      const need = input.gemReq[attr.key];
      if (!need) continue;
      const have = statNum(attr.key);
      if (have !== undefined && need > have) {
        const missing = Math.ceil(need - have);
        issues.push({
          kind: "attribute",
          shortLabel: vi ? `Thiếu ${missing} ${attr.vi}` : `-${missing} ${attr.en}`,
          message: vi
            ? `${input.skillName} (Lv ${input.gemLevel}) cần ${Math.round(need)} ${attr.vi}, nhân vật hiện có ${Math.round(have)}.`
            : `${input.skillName} (Lv ${input.gemLevel}) requires ${Math.round(need)} ${attr.en}, character has ${Math.round(have)}.`
        });
      }
    }
  }

  // 4. Spirit over-reservation (Persistent / Aura / Herald / Meta skills when SpiritUnreserved < 0).
  if (stats && isSpiritReservingSkill(input.tags)) {
    const unreserved = typeof stats.SpiritUnreserved === "number" ? stats.SpiritUnreserved : undefined;
    if (unreserved !== undefined && unreserved < 0) {
      issues.push({
        kind: "spirit",
        shortLabel: vi ? `Thiếu ${Math.abs(Math.round(unreserved))} Spirit` : `Need ${Math.abs(Math.round(unreserved))} Spirit`,
        message: vi
          ? `Không đủ Spirit để bật hết kỹ năng duy trì (đang thiếu ${Math.abs(Math.round(unreserved))} Spirit).`
          : `Not enough Spirit for active persistent skills (short by ${Math.abs(Math.round(unreserved))} Spirit).`
      });
    }
  }

  return issues;
}

/**
 * Per-slot reasons an equipped item cannot currently be worn (level or STR/DEX/INT
 * requirements from PoB's per-slot outputs).
 */
export function unusableItemReasonsBySlot(input: {
  items: WarningItem[];
  characterLevel: number;
  activeWeaponSet: 1 | 2;
  stats?: Record<string, unknown> | null;
  locale: string;
}): Map<string, string[]> {
  const vi = input.locale === "vi";
  const result = new Map<string, string[]>();
  const stats = input.stats;
  const statNum = (key: string) => (stats && typeof stats[key] === "number" ? (stats[key] as number) : undefined);

  for (const item of input.items) {
    const reasons: string[] = [];
    if (item.levelReq && item.levelReq > input.characterLevel) {
      reasons.push(vi ? `Cần cấp ${item.levelReq} (hiện cấp ${input.characterLevel})` : `Requires level ${item.levelReq} (current ${input.characterLevel})`);
    }
    if (stats) {
      const slot = pobRequirementSlot(item.slotId, input.activeWeaponSet);
      if (slot) {
        for (const attr of ATTR_KEYS) {
          const have = statNum(attr.key);
          const need = statNum(`${attr.key}RequirementsOn${slot}`);
          if (have !== undefined && need !== undefined && need > have) {
            reasons.push(vi
              ? `Thiếu ${Math.ceil(need - have)} ${attr.vi} (cần ${Math.round(need)}, có ${Math.round(have)})`
              : `Missing ${Math.ceil(need - have)} ${attr.en} (needs ${Math.round(need)}, have ${Math.round(have)})`);
          }
        }
      }
    }
    if (reasons.length) result.set(item.slotId, reasons);
  }
  return result;
}

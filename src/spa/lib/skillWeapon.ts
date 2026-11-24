// "This skill needs a bow": the weapon a skill gem asks for against what the active
// weapon set holds, so a skill card can say why it shows no damage.
//
// The requirement is the gem's own line in the site's gem data ("Requires: Bows",
// "Requires: One Hand Maces, Two Hand Maces", "Requires: Any Martial Weapon"), as the
// game prints it. Equipped items are classified with PoB's base types and tags
// (src/shared/equipment-rules.mjs); "martial weapon" is PoB's `weapon` tag (wands,
// sceptres and caster staves do not have it). Requirements the data cannot settle
// (melee-only, armoured shields) are only judged when no weapon of any kind is held.
import { describeEquipment, type EquipmentRow, type WeaponInfo } from "../../shared/equipment-rules.mjs";

/** Game item-class names (as gem requirements print them) -> the class keys of the weapon data. */
const CLASS_KEYS: Record<string, string> = {
  bow: "Bow", bows: "Bow",
  crossbow: "Crossbow", crossbows: "Crossbow",
  claw: "Claw", claws: "Claw",
  dagger: "Dagger", daggers: "Dagger",
  flail: "Flail", flails: "Flail",
  spear: "Spear", spears: "Spear",
  talisman: "Talisman", talismans: "Talisman",
  wand: "Wand", wands: "Wand",
  sceptre: "Sceptre", sceptres: "Sceptre",
  staff: "Staff", staves: "Staff",
  quarterstaff: "Quarterstaff", quarterstaves: "Quarterstaff",
  "one hand axe": "One Hand Axe", "one hand axes": "One Hand Axe",
  "one hand mace": "One Hand Mace", "one hand maces": "One Hand Mace",
  "one hand sword": "One Hand Sword", "one hand swords": "One Hand Sword",
  "two hand axe": "Two Hand Axe", "two hand axes": "Two Hand Axe",
  "two hand mace": "Two Hand Mace", "two hand maces": "Two Hand Mace",
  "two hand sword": "Two Hand Sword", "two hand swords": "Two Hand Sword"
};

export interface SkillWeaponNeed {
  /** The requirement as the game prints it ("Bows", "One Hand Maces, Two Hand Maces"). */
  label: string;
  /** Weapon classes that satisfy it; empty for the kinds below. */
  classes: string[];
  /** "classes": one of `classes`; "martial": any martial weapon; "shield": a shield in the off-hand; "unarmed": empty hands. */
  kind: "classes" | "martial" | "shield" | "unarmed";
  /** Empty hands also work ("... or Unarmed"). */
  allowUnarmed: boolean;
}

/** The weapon requirement among a gem's requirement lines, or null when it has none the planner can read. */
export function skillWeaponNeed(requirements: string[] | undefined): SkillWeaponNeed | null {
  for (const line of requirements ?? []) {
    const match = String(line).match(/^Requires:\s*(.+)$/i);
    if (!match || /\bLevel\b/i.test(match[1])) continue;
    const label = match[1].trim().replace(/\.$/, "");
    const lower = label.toLowerCase();
    if (lower === "unarmed") return { label, classes: [], kind: "unarmed", allowUnarmed: true };
    const allowUnarmed = /\bunarmed\b/.test(lower);
    if (/shield|buckler/.test(lower)) return { label, classes: [], kind: "shield", allowUnarmed: false };
    if (/martial weapon/.test(lower)) return { label, classes: [], kind: "martial", allowUnarmed };
    const classes = lower.split(/,|\bor\b/).map((part) => CLASS_KEYS[part.trim()]).filter((key): key is string => Boolean(key));
    if (classes.length) return { label, classes: [...new Set(classes)], kind: "classes", allowUnarmed };
  }
  return null;
}

export interface WeaponHands {
  main?: EquipmentRow | null;
  off?: EquipmentRow | null;
}

const infoOf = (row: EquipmentRow | null | undefined): WeaponInfo | null => describeEquipment(row)?.info ?? null;
const filled = (row: EquipmentRow | null | undefined) => Boolean(row && (row.itemName || row.rawText));

/**
 * True when the hands certainly do not meet the requirement. An item the weapon data
 * does not know is given the benefit of the doubt.
 */
export function skillWeaponMissing(need: SkillWeaponNeed | null, hands: WeaponHands): boolean {
  if (!need) return false;
  const main = infoOf(hands.main);
  const off = infoOf(hands.off);
  const mainUnknown = filled(hands.main) && !main;
  const offUnknown = filled(hands.off) && !off;
  const unarmed = !filled(hands.main) && !(off && off.tags.includes("weapon"));
  if (need.kind === "unarmed") return !unarmed && !mainUnknown;
  if (need.allowUnarmed && unarmed) return false;
  if (need.kind === "shield") return !offUnknown && off?.type !== "Shield";
  if (mainUnknown) return false;
  if (need.kind === "martial") return !(main?.tags.includes("weapon") || off?.tags.includes("weapon"));
  // A dual-wielded off-hand weapon counts too (a mace skill with a mace in the off-hand).
  return !(main && need.classes.includes(main.classKey)) && !(off && need.classes.includes(off.classKey));
}

/** What the hands hold, for the message ("Dualstring Bow", "tay không"). */
export function handsLabel(hands: WeaponHands, locale: string): string {
  const name = (row: EquipmentRow | null | undefined) => (row ? String(row.baseName || row.itemName || "") : "");
  const main = name(hands.main);
  if (main) return main;
  return name(hands.off) || (locale === "vi" ? "tay không" : "nothing");
}

/**
 * The line a skill card shows instead of a bare 0: what the skill needs, what the
 * active set holds, and whether the other set would do.
 */
export function skillWeaponHint(input: {
  skillName: string;
  requirements: string[] | undefined;
  activeSet: 1 | 2;
  sets: Record<1 | 2, WeaponHands>;
  locale: string;
}): string | null {
  const need = skillWeaponNeed(input.requirements);
  const active = input.sets[input.activeSet];
  if (!skillWeaponMissing(need, active) || !need) return null;
  const vi = input.locale === "vi";
  const roman = (set: 1 | 2) => (set === 1 ? "I" : "II");
  const otherSet = input.activeSet === 1 ? 2 : 1;
  const other = input.sets[otherSet];
  const otherWorks = (filled(other.main) || filled(other.off) || need.kind === "unarmed") && !skillWeaponMissing(need, other);
  const needText = need.kind === "unarmed" ? (vi ? "tay không (Unarmed)" : "empty hands (Unarmed)") : need.label;
  const base = vi
    ? `${input.skillName} cần ${needText}, nhưng bộ vũ khí ${roman(input.activeSet)} đang cầm ${handsLabel(active, "vi")} nên không gây sát thương.`
    : `${input.skillName} needs ${needText}, but weapon set ${roman(input.activeSet)} holds ${handsLabel(active, "en")}, so it deals no damage.`;
  if (!otherWorks) return base;
  return vi
    ? `${base} Bộ ${roman(otherSet)} dùng được: bấm «${roman(otherSet)}» ở phần Trang bị để tính theo bộ đó.`
    : `${base} Set ${roman(otherSet)} works: switch to it in Equipment to calculate with it.`;
}

// Single source of truth for PoB's multi-line quest reward config strings.
// Browser DOMParser normalizes raw `\n` and `\t` inside XML attributes into spaces (XML 1.0),
// so both browser import and server XML serialization restore PoB's exact `\n\t` separators here.

export const POB_MULTILINE_CONFIG_STRINGS = Object.freeze({
  "questAct 2Valley of the TitansMedallion": Object.freeze([
    "30% increased Charm Charges Gained\n\t+1 Charm Slot",
    "30% increased Charm Effect Duration\n\t+1 Charm Slot"
  ]),
  "questAct 4Eye of HinekoraTribal Medicine": Object.freeze([
    "+15% of Armour also applies to Elemental Damage\n\tGain Deflection Rating equal to 12% of Evasion Rating\n\t12% faster start of Energy Shield Recharge"
  ]),
  "questInterlude 2QimahSeven Pillars": Object.freeze([
    "5% increased Experience Gain\n\t-5% to all Elemental Resistances\n\t3% reduced Movement Speed\n\t15% reduced Global Armour, Evasion and Energy Shield\n\t20% reduced Presence Area Of Effect\n\t12% reduced Cooldown Recovery Rate\n\t5% reduced Attributes"
  ])
});

/** Restores PoB's exact `\n\t` string value when whitespace was flattened by XML attribute parsing. */
export function restorePobConfigString(name, value) {
  const candidates = POB_MULTILINE_CONFIG_STRINGS[name];
  if (!candidates || candidates.includes(value)) return value;
  const collapsed = String(value).replace(/\s+/g, " ").trim();
  return candidates.find((candidate) => candidate.replace(/\s+/g, " ").trim() === collapsed) ?? value;
}

// An item's own numbers with its local modifiers and quality applied: weapon damage,
// attacks per second, critical hit chance, armour / evasion / energy shield, block
// and Spirit. The tooltip used to show the base type's numbers only.
//
// Formulas are Path of Building's (Classes/Item.lua, ItemClass:BuildModListForSlotNum):
//   attack rate  = round(base * (1 + inc / 100), 2)
//   physical     = round((base + added) * (1 + inc / 100) * (1 + quality / 100))
//   elemental    = round(base + added)                     (local elemental inc: none on PoE2 items)
//   crit chance  = round((base + added) * (1 + inc / 100), 2)
//   defence      = round((base + added) * (1 + (own inc + hybrid inc + defences inc) / 100) * (1 + quality / 100))
//   block        = floor((base + added) * (1 + inc / 100))
//   spirit       = round((base + added) * (1 + inc / 100))
// A modifier is local only when the item has that property (a "+ to maximum Energy
// Shield" on a ring is global and changes nothing here), as in PoB's calcLocal.

export interface LocalStatLine {
  /** The property line with its new value ("Physical Damage: 213-318"). */
  line: string;
  /** The value differs from the base type's. */
  changed: boolean;
  /** Position of the base property line this came from; -1 for a line the item adds (elemental damage). */
  index: number;
}

/** lua's round(): half away from zero for the positive numbers used here. */
const round = (value: number, decimals = 0): number => {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 0.5) / factor;
};

const clean = (line: string) => String(line ?? "").replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();

interface Totals {
  flat: Record<string, number>;
  flatMax: Record<string, number>;
  inc: Record<string, number>;
}

/** Sums the local modifier lines of an item. Lines the patterns do not know are ignored. */
function readMods(mods: string[]): Totals {
  const totals: Totals = { flat: {}, flatMax: {}, inc: {} };
  const add = (bucket: Record<string, number>, key: string, value: number) => { bucket[key] = (bucket[key] ?? 0) + value; };
  for (const raw of mods) {
    const line = clean(raw);
    let match: RegExpMatchArray | null;
    if ((match = line.match(/^Adds (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?) (Physical|Fire|Cold|Lightning|Chaos) Damage$/i))) {
      const type = match[3][0].toUpperCase() + match[3].slice(1).toLowerCase();
      add(totals.flat, type, Number(match[1]));
      add(totals.flatMax, type, Number(match[2]));
    } else if ((match = line.match(/^(\d+(?:\.\d+)?)% (increased|reduced) (.+)$/i))) {
      const value = Number(match[1]) * (match[2].toLowerCase() === "reduced" ? -1 : 1);
      const what = match[3].toLowerCase();
      const keys: Record<string, string> = {
        "physical damage": "Physical",
        "attack speed": "AttackSpeed",
        "critical hit chance": "Crit",
        "armour": "Armour",
        "evasion rating": "Evasion",
        "energy shield": "EnergyShield",
        "armour and evasion": "ArmourEvasion",
        "armour and energy shield": "ArmourEnergyShield",
        "evasion and energy shield": "EvasionEnergyShield",
        "armour, evasion and energy shield": "Defences",
        "block chance": "Block",
        "spirit": "Spirit"
      };
      if (keys[what]) add(totals.inc, keys[what], value);
    } else if ((match = line.match(/^\+(\d+(?:\.\d+)?)(%?) to (.+)$/i))) {
      const value = Number(match[1]);
      const what = match[3].toLowerCase();
      const percent = match[2] === "%";
      if (percent && what === "critical hit chance") add(totals.flat, "Crit", value);
      else if (percent && what === "block chance") add(totals.flat, "Block", value);
      else if (!percent && what === "armour") add(totals.flat, "Armour", value);
      else if (!percent && what === "evasion rating") add(totals.flat, "Evasion", value);
      else if (!percent && what === "maximum energy shield") add(totals.flat, "EnergyShield", value);
      else if (!percent && what === "spirit") add(totals.flat, "Spirit", value);
    }
  }
  return totals;
}

const numberText = (value: number, decimals: number) => {
  const fixed = value.toFixed(decimals);
  return decimals ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
};

/**
 * The base type's property lines ("Physical Damage: 35-59", "Armour: 496"...) with the
 * item's modifiers and quality applied; elemental damage a weapon gains gets its own
 * line after the physical one. Lines that are not numbers the item changes come back as they are.
 */
export function applyLocalMods(baseProperties: string[], mods: string[], quality = 0): LocalStatLine[] {
  const totals = readMods(mods);
  const flat = (key: string) => totals.flat[key] ?? 0;
  const inc = (key: string) => totals.inc[key] ?? 0;
  const isWeapon = baseProperties.some((line) => /^(Attacks per Second|Physical Damage):/i.test(clean(line)));
  const qualityMult = 1 + Math.max(0, quality) / 100;
  const out: LocalStatLine[] = [];
  const push = (label: string, value: string, original: string) => out.push({ line: `${label}: ${value}`, changed: clean(original) !== `${label}: ${value}`, index: position });
  const elementalLines = () => {
    for (const type of ["Fire", "Cold", "Lightning", "Chaos"]) {
      if (baseProperties.some((line) => new RegExp(`^${type} Damage:`, "i").test(clean(line)))) continue;
      const min = round(flat(type));
      const max = round(totals.flatMax[type] ?? 0);
      if (min > 0 && max > 0) out.push({ line: `${type} Damage: ${min}-${max}`, changed: true, index: -1 });
    }
  };
  let elementalDone = !isWeapon;
  let position = -1;

  for (const original of baseProperties) {
    position += 1;
    const line = clean(original).replace(/\.$/, "");
    const split = line.indexOf(":");
    const label = split < 0 ? "" : line.slice(0, split).trim();
    const value = split < 0 ? "" : line.slice(split + 1).trim();
    const key = label.toLowerCase();
    const damage = value.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/);
    const single = value.match(/^(\d+(?:\.\d+)?)(%?)$/);

    if (isWeapon && key === "physical damage" && damage) {
      const scale = (1 + inc("Physical") / 100) * qualityMult;
      push(label, `${round((Number(damage[1]) + flat("Physical")) * scale)}-${round((Number(damage[2]) + (totals.flatMax.Physical ?? 0)) * scale)}`, line);
    } else if (isWeapon && /^(fire|cold|lightning|chaos) damage$/.test(key) && damage) {
      const type = label.split(" ")[0];
      const name = type[0].toUpperCase() + type.slice(1).toLowerCase();
      push(label, `${round(Number(damage[1]) + flat(name))}-${round(Number(damage[2]) + (totals.flatMax[name] ?? 0))}`, line);
    } else if (isWeapon && key === "attacks per second" && single) {
      push(label, numberText(round(Number(single[1]) * (1 + inc("AttackSpeed") / 100), 2), 2), line);
    } else if (isWeapon && key === "critical hit chance" && single) {
      push(label, `${numberText(round((Number(single[1]) + flat("Crit")) * (1 + inc("Crit") / 100), 2), 2)}%`, line);
    } else if (!isWeapon && key === "armour" && single) {
      push(label, String(round((Number(single[1]) + flat("Armour")) * (1 + (inc("Armour") + inc("ArmourEvasion") + inc("ArmourEnergyShield") + inc("Defences")) / 100) * qualityMult)), line);
    } else if (!isWeapon && key === "evasion rating" && single) {
      push(label, String(round((Number(single[1]) + flat("Evasion")) * (1 + (inc("Evasion") + inc("ArmourEvasion") + inc("EvasionEnergyShield") + inc("Defences")) / 100) * qualityMult)), line);
    } else if (!isWeapon && key === "energy shield" && single) {
      push(label, String(round((Number(single[1]) + flat("EnergyShield")) * (1 + (inc("EnergyShield") + inc("ArmourEnergyShield") + inc("EvasionEnergyShield") + inc("Defences")) / 100) * qualityMult)), line);
    } else if (!isWeapon && key === "block chance" && single) {
      push(label, `${Math.floor((Number(single[1]) + flat("Block")) * (1 + inc("Block") / 100))}%`, line);
    } else if (key === "spirit" && single) {
      push(label, String(round((Number(single[1]) + flat("Spirit")) * (1 + inc("Spirit") / 100))), line);
    } else {
      out.push({ line: clean(original), changed: false, index: position });
    }
    // Added elemental damage sits right under the physical line (or first, without one).
    if (!elementalDone && key === "physical damage") {
      elementalLines();
      elementalDone = true;
    }
  }
  if (!elementalDone) {
    const extra: LocalStatLine[] = [];
    const before = out.length;
    elementalLines();
    extra.push(...out.splice(before));
    out.unshift(...extra);
  }
  return out;
}

// Turn the PoB gem/skill dump (scripts/pob-data/dump.mjs) into records shaped like the rows
// of public/data/skill-gems-data.js. Pure functions; nothing here reads or writes files.
//
// Only fields PoB can fill are produced. Vietnamese text (i18n.*.vi), icon_url, hover_url,
// source_url and the crawl bookkeeping fields are left out on purpose (see docs/pob-data-pilot.md).
//
// Where PoB and the site (poe2db) only differ in presentation, the site's convention is used so
// the two can be compared line by line:
//   - ranges use an em dash and, inside stat text, run low to high: "(1—20)"
//   - a stat line shows level 1 to the gem's natural max level, merged from PoB's two renderings
//   - stats without description text are listed as "stat id with spaces [value]" after the text
//   - "Cooldown Time: 4.00 s" (PoB prints "sec"), no "Cast Time: Instant" in the header block

const EM_DASH = "—";

/** PoB prints ranges as "(1-20)"; the site uses an em dash: "(1—20)". */
export const toSiteRanges = (text) =>
  String(text).replace(/\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, `($1${EM_DASH}$2)`);

/** printf("%g")-style number: at most 6 significant digits, no trailing zeros. */
export const formatG = (value) => String(Number(Number(value).toPrecision(6)));

/** "a" when both ends are equal, else "(a—b)". */
export const formatRange = (min, max, format = formatG) => {
  const low = format(min);
  const high = format(max);
  return low === high ? low : `(${low}${EM_DASH}${high})`;
};

/** poe2db page slug convention used by the site: spaces to underscores, apostrophes dropped. */
export const slugFromName = (name) => String(name).replace(/['’]/g, "").trim().replace(/\s+/g, "_");

const COLORS = { 1: "red", 2: "green", 3: "blue" };

/**
 * In-game attribute requirement of a gem (PoB calcLib.getGemStatRequirement) without PoB's
 * "below 8 shows as 0" display clamp, because poe2db (and so the site) prints the raw value.
 */
export const gemAttributeRequirement = (level, multiplier) => {
  if (!multiplier) return 0;
  return Math.round((5 + (level - 3) * 1.7) * (multiplier / 100) ** 0.9) + 4;
};

/** A line from PoB's StatDescriber: wrapped lines joined, ranges in site style. */
export const siteLine = (text) => toSiteRanges(String(text).replace(/\s*\n\s*/g, " ").trim());

/** Stats PoB has no description for, printed the way poe2db does: "stat id with spaces [value]" or "[min,max]". */
export const rawStatLine = (stat) =>
  `${stat.id.replace(/_/g, " ")} [${stat.min === stat.max ? formatG(stat.min) : `${formatG(stat.min)},${formatG(stat.max)}`}]`;

// A number inside rendered stat text. A leading "-" belongs to the number, a leading "+" is text.
const NUMBER = /(?<![\w.])-?\d+(?:\.\d+)?/g;

/**
 * Merge the same stat line rendered at two gem levels into one line with ranges:
 *   "Deals 1 to 13 Lightning Damage" + "Deals 20 to 386 Lightning Damage"
 *     -> "Deals (1—20) to (13—386) Lightning Damage"
 * Returns null when the two lines differ in more than their numbers (plural forms, another
 * description variant), in which case the caller falls back to PoB's own range rendering.
 */
export const mergeLevelLines = (low, high) => {
  const lowNumbers = low.match(NUMBER) || [];
  const highNumbers = high.match(NUMBER) || [];
  if (lowNumbers.length !== highNumbers.length) return null;
  if (low.replace(NUMBER, "#") !== high.replace(NUMBER, "#")) {
    // Same description with another plural form ("1 lodged Spear" / "3 lodged Spears"): poe2db
    // keeps the wording of the higher level. Anything further apart is not merged.
    const words = (text) => text.replace(NUMBER, "#").split(" ");
    const a = words(low);
    const b = words(high);
    if (a.length !== b.length || a.some((word, i) => word !== b[i] && !(b[i].startsWith(word.replace(/y$/, "")) && b[i].length - word.length <= 3))) return null;
  }
  let index = 0;
  return high.replace(NUMBER, () => {
    const a = Number(lowNumbers[index]);
    const b = Number(highNumbers[index]);
    index += 1;
    return a === b ? formatG(a) : `(${formatG(Math.min(a, b))}${EM_DASH}${formatG(Math.max(a, b))})`;
  });
};

/** PoB splits a description on "\n"; lines of one description share their stat. Join them back. */
const groupByStat = (lines) => {
  const groups = [];
  for (const line of lines || []) {
    const last = groups[groups.length - 1];
    const text = String(line.text).replace(/\s*\n\s*/g, " ").trim();
    if (last && line.stat && last.stat === line.stat) last.text += ` ${text}`;
    else groups.push({ stat: line.stat, text });
  }
  return groups;
};

/**
 * Described lines of one stat set for levels 1..max. PoB's max-level rendering gives the order;
 * each line is merged with its level 1 rendering. A stat that is 0 at level 1 has no level 1 line:
 * a single number then becomes "(0—N)", anything else falls back to PoB's range line.
 */
export const describedLines = (set) => {
  const low = groupByStat(set.linesLevel1);
  const high = groupByStat(set.linesLevelMax);
  const range = new Map(groupByStat(set.lines).map((group) => [group.stat, siteLine(group.text)]));
  const lowByStat = new Map(low.map((group) => [group.stat, group.text]));
  const out = [];
  const seen = new Set();
  for (const group of high) {
    seen.add(group.stat);
    const lowText = lowByStat.get(group.stat);
    let line = lowText === undefined ? null : mergeLevelLines(lowText, group.text);
    if (line === null && lowText === undefined && (group.text.match(NUMBER) || []).length === 1) {
      line = mergeLevelLines(group.text.replace(NUMBER, "0"), group.text);
    }
    out.push(line ?? range.get(group.stat) ?? group.text);
  }
  // Stats that only have a value at level 1.
  for (const group of low) if (!seen.has(group.stat)) out.push(range.get(group.stat) ?? group.text);
  return out;
};

/** Quality line: PoB describes the value at 20% quality; the site shows it as a 0—20% range. */
export const qualityLine = (text) => {
  const line = String(text).replace(/\s*\n\s*/g, " ").trim();
  if ((line.match(NUMBER) || []).length === 1) return mergeLevelLines(line.replace(NUMBER, "0"), line);
  return siteLine(line).replace(/([+-]?)(\d+(?:\.\d+)?)/, (_, sign, value) => `${sign}(0${EM_DASH}${value})`);
};

const two = (value) => Number(value).toFixed(2);

const costText = (level1, levelMax, costs) => {
  const parts = [];
  for (const cost of costs) {
    const low = level1?.cost?.[cost.resource];
    if (low === undefined) continue;
    const high = levelMax?.cost?.[cost.resource] ?? low;
    const round2 = (value) => formatG(Math.round((value / cost.divisor) * 100) / 100);
    parts.push(cost.format.replace("{0}", formatRange(low, high, round2)).trim());
  }
  return parts.join(", ");
};

/**
 * Cost, reservation, cooldown, attack/cast time and crit lines of one granted effect, in the
 * order Classes/GemTooltip.lua prints them. `instant`: print "Cast Time: Instant" for a zero
 * cast time (the site does that for secondary effects only).
 */
export const effectInfoLines = (gem, skill, costs, { instant = false } = {}) => {
  const out = [];
  const low = skill.level1 || {};
  const high = skill.levelMax || low;
  if (skill.support) {
    if (low.manaMultiplier !== undefined && low.manaMultiplier === low.reservationMultiplier) {
      out.push(`Cost & Reservation Multiplier: ${low.manaMultiplier + 100}%`);
    } else if (low.reservationMultiplier !== undefined) {
      out.push(`Reservation Multiplier: ${low.reservationMultiplier + 100}%`);
    } else if (low.manaMultiplier !== undefined) {
      out.push(`Cost Multiplier: ${low.manaMultiplier + 100}%`);
    }
    if (low.spiritReservationFlat !== undefined) out.push(`Additional Reservation: ${low.spiritReservationFlat} Spirit`);
  } else {
    if (low.spiritReservationFlat !== undefined) {
      out.push(`Reservation: ${formatRange(low.spiritReservationFlat, high.spiritReservationFlat ?? low.spiritReservationFlat)} Spirit`);
    }
    if (low.spiritReservationPercent !== undefined) {
      const one = (value) => Number(value).toFixed(1);
      out.push(`Reservation: ${formatRange(low.spiritReservationPercent, high.spiritReservationPercent ?? low.spiritReservationPercent, one)}% Spirit`);
    }
    const cost = costText(low, high, costs);
    if (cost) out.push(`Cost: ${cost}`);
  }
  if (low.cooldown !== undefined) {
    let line = `Cooldown Time: ${formatRange(low.cooldown, high.cooldown ?? low.cooldown, two)} s`;
    if ((low.storedUses || 0) > 1) line += ` (${formatRange(low.storedUses, high.storedUses ?? low.storedUses)} Times)`;
    out.push(line);
  }
  if (gem.tags.includes("attack")) {
    if (low.attackSpeedMultiplier !== undefined) {
      out.push(`Attack Speed: ${formatRange(low.attackSpeedMultiplier + 100, (high.attackSpeedMultiplier ?? low.attackSpeedMultiplier) + 100)}% of base`);
    }
    if (low.attackTime !== undefined) {
      out.push(`Attack Time: ${formatRange(low.attackTime / 1000, (high.attackTime ?? low.attackTime) / 1000, two)} sec`);
    }
    if (low.baseMultiplier !== undefined) {
      out.push(`Attack Damage: ${formatRange(low.baseMultiplier, high.baseMultiplier ?? low.baseMultiplier, percent)}% of base`);
    }
  } else if (!skill.support) {
    if ((skill.castTime || 0) > 0) out.push(`Cast Time: ${two(skill.castTime)} sec`);
    else if (instant) out.push("Cast Time: Instant");
  }
  if (low.critChance !== undefined) {
    out.push(`Critical Hit Chance: ${formatRange(low.critChance, high.critChance ?? low.critChance, two)}%`);
  }
  return out;
};

const percent = (value) => formatG(Math.round(value * 100 * 100) / 100);

/**
 * The effect whose cost and timings head the tooltip: the first one a player actually uses.
 * For ammunition skills PoB lists the hidden shot first and the visible "Load ..." skill second.
 */
export const headerEffectKey = (gem, skills) =>
  gem.skillKeys.find((key) => skills[key] && !skills[key].hidden && !skills[key].support) || gem.skillKeys[0];

/** The header block of a gem tooltip. */
export const buildProperties = (gem, skill, costs) => {
  const out = [];
  if (gem.tagString) out.push(gem.tagString);
  if (gem.gemFamily) out.push(`Category: ${gem.gemFamily}`);
  if (gem.tier > 0 && !skill.isLineage) out.push(`Tier: ${gem.tier}`);
  if (!skill.support) out.push(`Level: ${formatRange(1, gem.naturalMaxLevel)}`);
  return [...out, ...effectInfoLines(gem, skill, costs)];
};

export const buildRequirements = (gem, skill) => {
  const out = [];
  if (!skill.support) {
    const [low, high] = gem.statRequirements;
    const parts = [`Level ${formatRange(Math.max(1, low.level), Math.max(1, high.level))}`];
    for (const [label, multiplier] of [["Str", gem.reqStr], ["Dex", gem.reqDex], ["Int", gem.reqInt]]) {
      if (!multiplier) continue;
      parts.push(`${formatRange(gemAttributeRequirement(low.level, multiplier), gemAttributeRequirement(high.level, multiplier))} ${label}`);
    }
    out.push(`Requires: ${parts.join(", ")}`);
  }
  if (gem.weaponRequirements) out.push(`Requires: ${gem.weaponRequirements}`);
  return out;
};

/** One section per stat set of every granted effect, as the site lists them. */
export const buildSections = (gem, skills, costs = []) => {
  const sections = [];
  const headerKey = headerEffectKey(gem, skills);
  for (const key of gem.skillKeys) {
    const skill = skills[key];
    if (!skill) continue;
    const first = sections.length;
    skill.statSets.forEach((set, setIndex) => {
      const info = [];
      // Effects other than the one in the header carry their own cost/timing lines.
      if (setIndex === 0 && key !== headerKey && !skill.support) info.push(...effectInfoLines(gem, skill, costs, { instant: true }));
      if (set.level1?.critChance !== undefined) {
        info.push(`Critical Hit Chance: ${formatRange(set.level1.critChance, set.levelMax?.critChance ?? set.level1.critChance, two)}%`);
      }
      if (set.level1?.baseMultiplier !== undefined) {
        info.push(`Attack Damage: ${formatRange(set.level1.baseMultiplier, set.levelMax?.baseMultiplier ?? set.level1.baseMultiplier, percent)}%`);
      }
      const described = describedLines(set);
      // Stats without description text in the scope chain are what poe2db prints raw.
      const raw = set.stats.filter((stat) => stat.scope !== "described" && (stat.min !== 0 || stat.max !== 0)).map(rawStatLine).sort();
      sections.push({
        title: skill.support && skill.hidden ? "Support" : set.label || skill.name,
        lines: [...info, ...described, ...raw],
        described_count: described.length
      });
    });
    // Quality lines go under the stat set PoB attributes them to (first set when unspecified).
    for (const quality of skill.qualityStats) {
      if (quality.kind !== "quality") continue;
      const target = sections[first + (quality.statSetIndexes?.[0] || 0)] || sections[first];
      if (!target) continue;
      for (const line of quality.lines || []) target.lines.push(qualityLine(line.text));
    }
  }
  if (sections.length === 1) sections[0].title = "Stats";
  return sections;
};

export const buildGemRecord = (gem, skills, costs) => {
  const skill = skills[gem.skillKeys[0]];
  const headerSkill = skills[headerEffectKey(gem, skills)] || skill;
  const isSupport = gem.gemType === "Support";
  const sections = buildSections(gem, skills, costs);
  const publicSections = sections.map(({ title, lines }) => ({ title, lines }));
  return {
    slug: slugFromName(gem.name),
    name: gem.name,
    gem_type: isSupport ? "support" : "skill",
    // The site keeps the tier of supports only in properties ("Tier: 1"); PoB uses 0 for "no tier".
    tier: isSupport || !(gem.tier > 0) ? null : gem.tier,
    color: COLORS[skill.color] || "item",
    official_id: gem.gameId,
    tags: [gem.gemType, ...(gem.tagString ? gem.tagString.split(/,\s*/) : [])],
    summary_en: (headerSkill.description || skill.description || "").replace(/\s*\n\s*/g, " ").trim(),
    properties: buildProperties(gem, headerSkill, costs),
    requirements: buildRequirements(gem, skill),
    mods: publicSections.length === 1 ? publicSections[0].lines : [],
    sections: publicSections,
    flavour_text: skill.flavourText || null,
    // Not site fields: kept so a later switch-over can join back to PoB and judge coverage.
    pob: {
      id: gem.id,
      variant_id: gem.variantId,
      granted_effects: gem.skillKeys.map((key) => skills[key]?.id),
      icon: skill.icon || null,
      natural_max_level: gem.naturalMaxLevel,
      described_lines: sections.reduce((sum, section) => sum + section.described_count, 0)
    }
  };
};

export const buildGemRecords = ({ gems, costs }, skills) => gems.map((gem) => buildGemRecord(gem, skills, costs));

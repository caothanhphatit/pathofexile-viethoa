// Minimal reader for the game's stat description files (data/statdescriptions/*.csd,
// UTF-16LE). It turns stat ids + values into the English line the game shows, e.g.
//   render(["local_minimum_added_fire_damage","local_maximum_added_fire_damage"], [7, 11])
//     -> ["Adds 7 to 11 [Fire|Fire] Damage"]
//
// Pilot scope: English only, the value handlers that item/augment/tablet/essence stats
// use. A handler this file does not know is reported in `unknownHandlers` (and the raw
// value is printed) instead of being guessed.
//
// File format (tab indented):
//   description
//   	<N> <stat id 1> ... <stat id N>
//   	<K>                                  number of variants for the default language
//   		<cond 1> ... <cond N> "text {0}" [handler <arg index>]...
//   	lang "German"                        other languages repeat the <K> + variants part
//   no_description <stat id>
//   include "Data/StatDescriptions/other.csd"

/** Decode a .csd buffer (UTF-16LE with BOM) to text. */
export const decodeCsd = (buffer) => buffer.toString("utf16le").replace(/^﻿/, "");

const parseCondition = (token) => {
  if (token === "#") return { any: true };
  if (token.startsWith("!")) return { not: Number(token.slice(1)) };
  if (token.includes("|")) {
    const [lo, hi] = token.split("|");
    return { min: lo === "#" ? -Infinity : Number(lo), max: hi === "#" ? Infinity : Number(hi) };
  }
  const exact = Number(token);
  return Number.isFinite(exact) ? { min: exact, max: exact } : { any: true, keyword: token };
};

const VARIANT_LINE = /^(.*?)"((?:[^"\\]|\\.)*)"\s*(.*)$/;

/**
 * Parse one file. Returns { descriptions: [{ stats, variants }], noDescription: Set, includes: [] }.
 * Only the default (English) block of each description is kept.
 */
export const parseStatDescriptions = (text) => {
  const descriptions = [];
  const noDescription = new Set();
  const includes = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  let english = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!raw.startsWith("\t")) {
      current = null;
      if (line === "description") {
        current = { stats: null, variants: [] };
        english = true;
        descriptions.push(current);
      } else if (line.startsWith("no_description")) {
        noDescription.add(line.split(/\s+/)[1]);
      } else if (line.startsWith("include")) {
        includes.push((line.match(/"(.*)"/) || [])[1] || "");
      }
      continue;
    }
    if (!current) continue;
    if (/^lang "/.test(line)) { english = false; continue; }
    if (!english) continue;
    if (!current.stats) {
      const parts = line.split(/\s+/);
      current.stats = parts.slice(1, 1 + Number(parts[0]));
      continue;
    }
    const match = line.match(VARIANT_LINE);
    if (!match) continue; // the <K> count line
    const conditions = match[1].trim().split(/\s+/).filter(Boolean).map(parseCondition);
    const tokens = match[3].trim().split(/\s+/).filter(Boolean);
    const handlers = [];
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i] === "canonical_line") continue;
      if (tokens[i] === "reminderstring") { i += 1; continue; }
      handlers.push({ name: tokens[i], arg: Number(tokens[i + 1]) });
      i += 1;
    }
    current.variants.push({ conditions, text: match[2].replace(/\\n/g, "\n"), handlers });
  }
  return { descriptions: descriptions.filter((d) => d.stats?.length), noDescription, includes };
};

const dp = (value, digits, ifRequired) => {
  const fixed = value.toFixed(digits);
  return ifRequired ? String(Number(fixed)) : fixed;
};

/** Value handlers: name -> (number) => number | string. */
export const HANDLERS = {
  negate: (v) => -v,
  double: (v) => v * 2,
  negate_and_double: (v) => -v * 2,
  times_twenty: (v) => v * 20,
  add_one: (v) => v + 1,
  subtract_one: (v) => v - 1,
  plus_two_hundred: (v) => v + 200,
  divide_by_two_0dp: (v) => dp(v / 2, 0),
  divide_by_three: (v) => dp(v / 3, 2, true),
  divide_by_four: (v) => dp(v / 4, 2, true),
  divide_by_five: (v) => dp(v / 5, 2, true),
  divide_by_ten_0dp: (v) => dp(v / 10, 0),
  divide_by_ten_1dp: (v) => dp(v / 10, 1),
  divide_by_ten_1dp_if_required: (v) => dp(v / 10, 1, true),
  divide_by_fifteen_0dp: (v) => dp(v / 15, 0),
  divide_by_fifty: (v) => dp(v / 50, 2, true),
  divide_by_one_hundred: (v) => dp(v / 100, 2, true),
  divide_by_one_hundred_1dp: (v) => dp(v / 100, 1),
  divide_by_one_hundred_2dp: (v) => dp(v / 100, 2),
  divide_by_one_hundred_2dp_if_required: (v) => dp(v / 100, 2, true),
  divide_by_one_hundred_and_negate: (v) => dp(-v / 100, 2, true),
  per_minute_to_per_second: (v) => dp(v / 60, 1, true),
  per_minute_to_per_second_0dp: (v) => dp(v / 60, 0),
  per_minute_to_per_second_1dp: (v) => dp(v / 60, 1),
  per_minute_to_per_second_2dp: (v) => dp(v / 60, 2),
  per_minute_to_per_second_2dp_if_required: (v) => dp(v / 60, 2, true),
  milliseconds_to_seconds: (v) => dp(v / 1000, 2, true),
  milliseconds_to_seconds_0dp: (v) => dp(v / 1000, 0),
  milliseconds_to_seconds_1dp: (v) => dp(v / 1000, 1),
  milliseconds_to_seconds_2dp: (v) => dp(v / 1000, 2),
  milliseconds_to_seconds_2dp_if_required: (v) => dp(v / 1000, 2, true),
  deciseconds_to_seconds: (v) => dp(v / 10, 1, true)
};

const matches = (condition, value) => {
  if (condition.any) return true;
  if ("not" in condition) return value !== condition.not;
  return value >= condition.min && value <= condition.max;
};

/** Range separator poe2db and the game's advanced tooltip use. */
export const RANGE_DASH = "—";

/**
 * Build a renderer over parsed files (later files win on the same stat id).
 * Values are numbers or [min, max] pairs; a pair prints as "(min—max)".
 */
export const createStatRenderer = (parsedFiles) => {
  const byStat = new Map();
  const noDescription = new Set();
  for (const parsed of parsedFiles) {
    for (const description of parsed.descriptions) for (const id of description.stats) byStat.set(id, description);
    for (const id of parsed.noDescription) noDescription.add(id);
  }
  const unknownHandlers = new Set();

  const renderOne = (description, valueOf) => {
    const values = description.stats.map((id) => valueOf.get(id) ?? [0, 0]);
    if (values.every(([lo, hi]) => lo === 0 && hi === 0)) return null;
    // Pick the variant by the top of each range, like the item tooltip does.
    const variant = description.variants.find((v) => v.conditions.every((c, i) => i >= values.length || matches(c, values[i][1])));
    if (!variant) return null;
    const shown = values.map(([lo, hi]) => [lo, hi]);
    for (const handler of variant.handlers) {
      const fn = HANDLERS[handler.name];
      const slot = shown[handler.arg - 1];
      if (!slot) continue;
      if (!fn) { unknownHandlers.add(handler.name); continue; }
      slot[0] = fn(Number(slot[0]));
      slot[1] = fn(Number(slot[1]));
    }
    let next = 0;
    return variant.text.replace(/\{(\d*)(?::([+-]?)d)?\}/g, (_, index, sign) => {
      const slot = shown[index === "" ? next : Number(index)];
      next += 1;
      if (!slot) return "";
      const [lo, hi] = slot;
      const plus = sign === "+" && Number(hi) >= 0 ? "+" : "";
      return String(lo) === String(hi) ? `${plus}${lo}` : `${plus}(${lo}${RANGE_DASH}${hi})`;
    });
  };

  /**
   * @param {string[]} statIds
   * @param {(number|[number, number])[]} statValues
   * @returns {{ lines: string[], missing: string[] }} `missing` = stat ids with no description
   */
  const render = (statIds, statValues) => {
    const valueOf = new Map(statIds.map((id, i) => {
      const value = statValues[i];
      return [id, Array.isArray(value) ? value : [value ?? 0, value ?? 0]];
    }));
    const lines = [];
    const missing = [];
    const done = new Set();
    for (const id of statIds) {
      const description = byStat.get(id);
      if (!description) {
        if (!noDescription.has(id)) missing.push(id);
        continue;
      }
      if (done.has(description)) continue;
      done.add(description);
      const line = renderOne(description, valueOf);
      if (line) lines.push(...line.split("\n").map((part) => part.trim()).filter(Boolean));
    }
    return { lines, missing };
  };

  return { render, has: (id) => byStat.has(id), unknownHandlers, size: byStat.size };
};

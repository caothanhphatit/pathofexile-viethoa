// Item mods for the Build Planner's item editor, shared by the browser, the server
// and the tests so both sides apply the same rules:
//
//   - the mod pool: which prefixes/suffixes each base can roll, their tiers (item
//     level, value range) and mod groups, from public/data/item-mods-data.js
//     (Path of Building's game data, scripts/build-item-mod-pool.mjs). The older
//     poe2db files (craft-data.js + craft-index.js) are still read when given;
//   - an editable item model parsed from / written back to PoB item text;
//   - validation with Vietnamese messages, in two strengths: the full rules for what
//     the editor builds or changes (validateEditableItem: affix counts, tiers,
//     groups, bases, sockets, quality, implicits, uniques, corruption), and the rules
//     no real item breaks for item text pasted from the game (validatePastedItem);
//   - corruption outcomes (Vaal Orb) and the level requirement of a crafted item;
//   - mod search for the add-mod box (accent-insensitive, Vietnamese keywords).
//
// Lines a game item already had are trusted as they are when unchanged (within the
// pasted-item rules); the full rules apply to what the player adds or changes. Mods
// can only be added from the pool, never typed in.

const DASH = /[—–]/g;

/** Lowercase, no Vietnamese accents (đ -> d), single spaces. */
export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A mod line as a template ("+# to maximum Life") and, for each "#", its range:
 * "(a-b)" gives [a, b]; a plain number gives [n, n].
 */
export function lineTemplate(line) {
  const text = String(line ?? "").replace(DASH, "-").trim();
  const ranges = [];
  const template = text.replace(NUMBER_OR_RANGE, (match, a, b) => {
    ranges.push(a !== undefined ? [Number(a), Number(b)] : [Number(match), Number(match)]);
    return "#";
  });
  return { template, ranges };
}

const NUMBER_OR_RANGE = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)|\d+(?:\.\d+)?/g;

/** Numbers of a concrete line, in order (signs are part of the template). */
export function lineNumbers(line) {
  return [...String(line ?? "").replace(DASH, "-").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

export function fillTemplate(template, values) {
  let index = 0;
  return template.replace(/#/g, () => formatNumber(values[index++] ?? 0));
}

const formatNumber = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** "(6—13)% increased Evasion Rating+(7—10) to maximum Life" -> two lines. */
export function splitHybridText(text) {
  return String(text ?? "")
    .replace(DASH, "-")
    .split(/(?<=[a-z%])(?=\+?\(\d)|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// ── Pool ────────────────────────────────────────────────────────────────────

/** Pool mods (one per group + text, tiers by level) from mod records. */
function groupTiers(records) {
  const byKey = new Map();
  for (const record of records) {
    const templates = record.lines.map((line) => line.template);
    const key = `${record.gen}:${record.group}:${templates.join("|")}`;
    if (!byKey.has(key)) byKey.set(key, { key, gen: record.gen, family: record.group, tags: record.tags, templates, tiers: [] });
    byKey.get(key).tiers.push({ name: record.id, ilvl: record.level, lines: record.lines });
  }
  const top = (tier) => Math.max(0, ...tier.lines.flatMap((line) => line.ranges).map(([a, b]) => Math.max(Math.abs(a), Math.abs(b))));
  const mods = [...byKey.values()];
  for (const mod of mods) {
    mod.tiers.sort((x, y) => x.ilvl - y.ilvl || top(x) - top(y));
    const count = mod.tiers.length;
    mod.tiers.forEach((tier, index) => { tier.tier = count - index; });
  }
  return mods;
}

function uniqueLines(uniqueRecords) {
  const uniques = new Map();
  for (const record of uniqueRecords ?? []) {
    if (String(record?.rarity).toLowerCase() !== "unique" || !record.name) continue;
    const lines = (record.mods ?? []).filter((line) => !/\[[-+]?\d+(?:\.\d+)?\]\s*\.?$/.test(line)).flatMap(splitHybridText).map(lineTemplate);
    uniques.set(normalizeText(record.name), lines);
  }
  return uniques;
}

/** The poe2db pool: craft-data (classes with prefixes/suffixes) + craft-index (bases). */
function buildLegacyPool(craftData, craftIndex, uniqueRecords) {
  const classes = new Map();
  for (const [classKey, cls] of Object.entries(craftData?.classes ?? {})) {
    const mods = [];
    for (const gen of ["prefix", "suffix"]) {
      for (const mod of cls[gen === "prefix" ? "prefixes" : "suffixes"] ?? []) {
        const tiers = (mod.tiers ?? [])
          .map((tier) => ({ name: tier.name, ilvl: Number(tier.ilvl) || 1, lines: splitHybridText(tier.text).map(lineTemplate) }))
          .filter((tier) => tier.lines.length)
          .sort((a, b) => a.ilvl - b.ilvl);
        if (!tiers.length) continue;
        const count = tiers.length;
        tiers.forEach((tier, index) => { tier.tier = count - index; });
        mods.push({
          key: `${gen}:${mod.family}:${tiers[0].lines.map((line) => line.template).join("|")}`,
          gen,
          family: mod.family,
          tags: mod.tags ?? [],
          templates: tiers[0].lines.map((line) => line.template),
          tiers
        });
      }
    }
    classes.set(classKey, { key: classKey, itemClass: cls.item_class || cls.label, label: cls.label, table: "Item", mods, special: [], corruptions: [] });
  }
  const bases = new Map();
  for (const group of craftIndex?.tree ?? []) {
    for (const cls of group.classes ?? []) {
      for (const base of cls.bases ?? []) {
        if (base.name && base.craft_key) bases.set(normalizeText(base.name), { name: base.name, classKey: base.craft_key, itemClass: cls.label, reqLevel: base.req_level, implicit: [] });
      }
    }
  }
  return { source: "poe2db", classes, bases, hiddenBases: new Map(), unbound: {}, known: {}, uniques: uniqueLines(uniqueRecords) };
}

export const ITEM_MODS_FORMAT = "pob-item-mods-1";

/**
 * The mod pool. `data` is public/data/item-mods-data.js (window.POE2_ITEM_MODS, from
 * Path of Building); the older poe2db pair (craft-data, craft-index) still works.
 * `uniqueRecords` are the site's unique items ({ name, rarity: "unique", mods }).
 */
export function buildModPool(data, craftIndex, uniqueRecords = []) {
  if (data?.format !== ITEM_MODS_FORMAT) return buildLegacyPool(data, craftIndex, uniqueRecords);
  const GEN = { P: "prefix", S: "suffix" };
  const records = data.mods.map(([id, gen, group, level, lines, tags]) => ({
    id,
    gen: GEN[gen] ?? "",
    group,
    level,
    // Array.from: the data may come from another realm (node:vm), its arrays must not leak.
    lines: Array.from(lines, lineTemplate),
    tags: tags ? String(tags).split(",") : []
  }));
  const classes = new Map();
  data.classes.forEach((cls, index) => {
    classes.set(`c${index}`, {
      key: `c${index}`,
      itemClass: cls.type,
      label: cls.type,
      table: cls.table,
      mods: groupTiers(cls.normal.map((at) => records[at])),
      special: cls.special.map((at) => records[at]),
      excluded: (cls.excluded ?? []).map((at) => records[at]),
      corruptions: cls.corrupt.map((at) => records[at])
    });
  });
  const bases = new Map();
  const hiddenBases = new Map();
  for (const row of data.bases) {
    const base = {
      name: row.n,
      classKey: `c${row.c}`,
      itemClass: row.t,
      subType: row.st,
      reqLevel: row.r?.[0] ?? 0,
      req: { level: row.r?.[0] ?? 0, str: row.r?.[1] ?? 0, dex: row.r?.[2] ?? 0, int: row.r?.[3] ?? 0 },
      implicit: Array.from(row.i ?? []),
      implicitVariants: Array.from(row.iv ?? []),
      socketLimit: row.s ?? 0,
      maxQuality: row.q ?? 0,
      armour: row.a,
      weapon: row.w,
      spirit: row.sp
    };
    (row.h ? hiddenBases : bases).set(normalizeText(row.n), base);
  }
  const unbound = {};
  for (const [table, list] of Object.entries(data.unbound ?? {})) unbound[table] = list.map((at) => records[at]);
  // Every mod text the data knows for an affix table, on any base.
  const known = {};
  const know = (table, record) => {
    known[table] ??= new Set();
    for (const line of record.lines) known[table].add(line.template);
  };
  for (const cls of classes.values()) {
    for (const mod of cls.mods) for (const template of mod.templates) (known[cls.table] ??= new Set()).add(template);
    for (const record of cls.special) know(cls.table, record);
  }
  for (const [table, list] of Object.entries(unbound)) for (const record of list) know(table, record);
  return { source: "pob", classes, bases, hiddenBases, unbound, known, uniques: uniqueLines(uniqueRecords) };
}

/** A base by name: one the editor offers, or one that only exists on items from the game. */
export function findBase(pool, baseName) {
  const key = normalizeText(baseName);
  return pool.bases.get(key) ?? pool.hiddenBases?.get(key) ?? null;
}

export function poolClassForBase(pool, baseName) {
  const base = findBase(pool, baseName);
  return base ? { base, cls: pool.classes.get(base.classKey) } : null;
}

// ── Limits ──────────────────────────────────────────────────────────────────

export const AFFIX_LIMITS = { normal: 0, magic: 1, rare: 3, unique: 0 };

/**
 * Prefixes (= suffixes) an item of this rarity can hold. PoB gives rare jewels 2 + 2,
 * but rare jewels in the ladder fixtures carry five mods, so jewels use 3 + 3 as well.
 */
export function affixLimit(rarity) {
  return AFFIX_LIMITS[rarity] ?? 0;
}

const TWO_HAND_CLASSES = /body armour|bow|crossbow|staff|staves|quarterstaff|two hand|talisman/i;
const ONE_HAND_CLASSES = /helmet|gloves|boots|shield|buckler|foci|focus|claw|dagger|wand|sceptre|one hand|spear|flail/i;

/**
 * Rune sockets an item can have. PoB's base data gives the hard maximum (socketLimit:
 * 4 for body armour and two-handed weapons, 3 for the rest); the last one only comes
 * from corruption. Takes a pool base, or an item class name when the base is unknown.
 */
export function maxSockets(baseOrClass, corrupted = false) {
  const limit = typeof baseOrClass === "object" && baseOrClass
    ? baseOrClass.socketLimit ?? maxSockets(baseOrClass.itemClass, true)
    : TWO_HAND_CLASSES.test(baseOrClass || "") ? 4 : ONE_HAND_CLASSES.test(baseOrClass || "") ? 3 : 0;
  return limit ? limit - (corrupted ? 0 : 1) : 0;
}

export const MAX_QUALITY = 20;
export const MAX_ITEM_LEVEL = 100;
/**
 * Quality a pasted item can show: 20% from the base plus the only "+% to Maximum
 * Quality" mod in PoB's data (+20%). Real items go above 20% (30% in the ladder).
 */
export const PASTED_MAX_QUALITY = 40;

// ── Editable item ───────────────────────────────────────────────────────────

const META = /^(Rarity|Item Class|Unique ID|Item Level|Quality|Sockets|Rune|LevelReq|Requires|Implicits|Selected Variant|Variant|League|Source|Limited to|Radius|Armour|Evasion|Energy Shield|Ward|Spirit|Physical Damage|Elemental Damage|Chaos Damage|Critical Hit Chance|Attacks per Second|Reload Time|Block chance|Charm Slots|Requirements|Level|Str|Dex|Int|\w+BasePercentile):/i;
const FLAG_LINE = /^(Corrupted|Twice Corrupted|Mirrored|Split|Unidentified|Sanctified|Fractured Item|Desecrated Item|Synthesised Item)$/i;

let lineCounter = 0;
const newLineId = () => `l${(lineCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Leading {flag}{key:value} groups of a PoB line. */
function splitFlags(line) {
  const flags = [];
  let rest = line;
  for (let match = rest.match(/^\{([^}]*)\}/); match; match = rest.match(/^\{([^}]*)\}/)) {
    flags.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  return { flags, text: rest.trim() };
}

/** Applies "{range:x}" to "(a-b)" parts, as PoB does, so lines read as plain values. */
function resolveRange(text, flags) {
  const range = flags.find((flag) => /^range:/i.test(flag));
  if (!range) return text.replace(DASH, "-");
  const r = Number(range.split(":")[1]);
  return text.replace(DASH, "-").replace(/\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, (_, a, b) => {
    const min = Number(a);
    const max = Number(b);
    const value = min + (max - min) * (Number.isFinite(r) ? r : 0.5);
    return formatNumber(Number.isInteger(min) && Number.isInteger(max) ? Math.round(value) : Math.round(value * 100) / 100);
  });
}

const tierHolds = (tier, values) => tier.lines.flatMap((line) => line.ranges).every(([min, max], index) => values[index] === undefined || (values[index] >= Math.min(min, max) && values[index] <= Math.max(min, max)));

/**
 * The pool mod that starts at line `start`: its first text is that line and its other
 * texts are on later free lines (a hybrid's lines are not always next to each other).
 * Mods whose tiers hold the values win; among those, the one with fewer lines.
 * Returns { mod, at: [line indexes] } or null.
 */
function matchPoolMod(cls, lines, start, taken) {
  if (!cls) return null;
  const templates = lines.map((line) => (line.template ??= lineTemplate(line.text).template));
  let best = null;
  for (const mod of cls.mods) {
    if (mod.templates[0] !== templates[start]) continue;
    const at = [start];
    for (let offset = 1; offset < mod.templates.length; offset += 1) {
      const found = templates.findIndex((template, index) => index > start && !taken.has(index) && !at.includes(index) && template === mod.templates[offset]);
      if (found < 0) break;
      at.push(found);
    }
    if (at.length !== mod.templates.length) continue;
    const values = at.flatMap((index) => lineNumbers(lines[index].text));
    const fits = mod.tiers.some((tier) => tierHolds(tier, values)) ? 1 : 0;
    const score = fits * 10 - at.length;
    if (!best || score > best.score) best = { mod, at, score };
  }
  return best;
}

/** Best (highest) tier whose ranges hold the values and whose level the item reaches; else the closest. */
export function tierForValues(mod, values, itemLevel = MAX_ITEM_LEVEL) {
  const allowed = mod.tiers.filter((tier) => tier.ilvl <= itemLevel);
  const fits = (tier) => tierHolds(tier, values);
  return [...allowed].reverse().find(fits) ?? [...mod.tiers].reverse().find(fits) ?? allowed[allowed.length - 1] ?? mod.tiers[0];
}

/** Item text (PoB or game copy) -> editable item. */
export function parseEditableItem(rawText, pool) {
  const lines = String(rawText ?? "").replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
  const rarityIndex = lines.findIndex((line) => /^Rarity:/i.test(line));
  const rarity = (rarityIndex >= 0 ? lines[rarityIndex].replace(/^Rarity:\s*/i, "") : "normal").trim().toLowerCase();
  const item = {
    rarity: ["normal", "magic", "rare", "unique"].includes(rarity) ? rarity : "normal",
    name: "",
    baseName: "",
    itemLevel: undefined,
    quality: 0,
    sockets: 0,
    runes: [],
    corrupted: false,
    header: [],
    implicits: [],
    mods: []
  };
  const body = lines.slice(rarityIndex + 1);
  item.name = body.shift() || "";
  const hasBaseLine = item.rarity === "rare" || item.rarity === "unique";
  if (hasBaseLine && body[0] && !META.test(body[0]) && !/^-+$/.test(body[0])) item.baseName = body.shift();
  else item.baseName = item.name;
  // Magic names wrap the base ("Glowing Iron Ring of the Fox"): find the known base inside.
  if (item.rarity === "magic" && pool) {
    const words = item.name.split(" ");
    for (let from = 0; from < words.length && item.baseName === item.name; from += 1) {
      for (let to = words.length; to > from; to -= 1) {
        const candidate = words.slice(from, to).join(" ");
        if (findBase(pool, candidate)) {
          item.baseName = candidate;
          break;
        }
      }
    }
  }

  let implicitCount = 0;
  const modLines = [];
  for (const line of body) {
    if (!line || /^-+$/.test(line)) continue;
    const meta = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (meta && META.test(line)) {
      const key = meta[1].toLowerCase();
      const value = meta[2].trim();
      if (key === "item level") item.itemLevel = Number.parseInt(value, 10) || undefined;
      else if (key === "quality") item.quality = Number.parseInt(value.replace(/[^\d]/g, ""), 10) || 0;
      else if (key === "sockets") item.sockets = value.split(/\s+/).filter(Boolean).length;
      else if (key === "rune") item.runes.push(value);
      else if (key === "implicits") implicitCount = Number.parseInt(value, 10) || 0;
      else if (key !== "item class") item.header.push(line);
      continue;
    }
    if (FLAG_LINE.test(line)) {
      if (/^corrupted$/i.test(line)) item.corrupted = true;
      else {
        // "Twice Corrupted" is corrupted too; the line itself is kept as the game wrote it.
        if (/corrupted$/i.test(line)) item.corrupted = true;
        item.header.push(line);
      }
      continue;
    }
    const { flags, text } = splitFlags(line);
    // Game copies mark implicits / runes with a suffix instead of a count.
    const suffix = text.match(/\s+\((implicit|rune|enchant|crafted|fractured|desecrated)\)$/i)?.[1]?.toLowerCase();
    const clean = resolveRange(suffix ? text.replace(/\s+\([a-z]+\)$/i, "") : text, flags);
    const keptFlags = flags.filter((flag) => !/^range:/i.test(flag));
    if (suffix && suffix !== "implicit" && suffix !== "rune" && suffix !== "enchant") keptFlags.push(suffix);
    const isImplicit = implicitCount > 0 || suffix === "implicit" || suffix === "rune" || suffix === "enchant";
    if (implicitCount > 0) implicitCount -= 1;
    const entry = { flags: suffix === "rune" ? [...keptFlags, "rune"] : suffix === "enchant" ? [...keptFlags, "enchant"] : keptFlags, text: clean };
    if (isImplicit) item.implicits.push(entry);
    else modLines.push(entry);
  }

  const found = pool ? poolClassForBase(pool, item.baseName) : null;
  const uniqueRows = item.rarity === "unique" && pool ? pool.uniques.get(normalizeText(item.name)) : null;
  const taken = new Set();
  for (let index = 0; index < modLines.length; index += 1) {
    if (taken.has(index)) continue;
    const line = modLines[index];
    if (item.rarity === "unique") {
      const { template, ranges } = lineTemplate(line.text);
      const known = uniqueRows?.find((row) => row.template === template);
      // A line still written as a range ("+(5-7) to Level...") starts at its best roll.
      const values = ranges.some(([a, b]) => a !== b) ? ranges.map(([a, b]) => Math.max(a, b)) : lineNumbers(line.text);
      item.mods.push(known && known.ranges.some(([a, b]) => a !== b)
        ? { id: newLineId(), kind: "unique", template, ranges: known.ranges, values, flags: line.flags, original: line.text }
        : { id: newLineId(), kind: "fixed", text: line.text, flags: line.flags, original: line.text });
      continue;
    }
    const match = matchPoolMod(found?.cls, modLines, index, taken);
    if (match) {
      const text = match.at.map((at) => modLines[at].text);
      const values = text.flatMap(lineNumbers);
      const tier = tierForValues(match.mod, values, item.itemLevel ?? MAX_ITEM_LEVEL);
      item.mods.push({ id: newLineId(), kind: "pool", modKey: match.mod.key, gen: match.mod.gen, family: match.mod.family, tier: tier.tier, values, flags: line.flags, original: text.join("\n") });
      for (const at of match.at) taken.add(at);
    } else {
      item.mods.push({ id: newLineId(), kind: "fixed", text: line.text, flags: line.flags, original: line.text });
    }
  }
  return item;
}

export function findPoolMod(pool, item, modKey) {
  const found = poolClassForBase(pool, item.baseName);
  return found?.cls?.mods.find((mod) => mod.key === modKey) ?? null;
}

/** Text lines of one editable mod line. */
export function modLineText(pool, item, line) {
  if (line.kind === "fixed") return [line.text];
  if (line.kind === "unique") return [fillTemplate(line.template, line.values)];
  const mod = findPoolMod(pool, item, line.modKey);
  if (!mod) return [];
  let offset = 0;
  return mod.templates.map((template) => {
    const count = (template.match(/#/g) || []).length;
    const text = fillTemplate(template, line.values.slice(offset, offset + count));
    offset += count;
    return text;
  });
}

const flagPrefix = (flags) => flags.filter((flag) => flag !== "rune" && flag !== "enchant").map((flag) => `{${flag}}`).join("");

const headerLevelReq = (item) => {
  const line = item.header.find((row) => /^LevelReq:/i.test(row));
  const value = line ? Number.parseInt(line.replace(/^LevelReq:\s*/i, ""), 10) : NaN;
  return Number.isFinite(value) ? value : null;
};

/**
 * Level needed to equip the item, as PoB's ItemClass:Craft computes it: the base's
 * level, raised to floor(0.8 x mod level) by each affix. Lines the pool does not know
 * have no mod level: then the game's own number (a "LevelReq:" line) is the floor, and
 * without one the answer is null (unknown) rather than a number that may be too low.
 * A unique keeps the number the game gave it.
 */
export function requiredLevel(item, pool) {
  const given = headerLevelReq(item);
  if (item.rarity === "unique") return given;
  const found = poolClassForBase(pool, item.baseName);
  if (!found) return given;
  let level = found.base.reqLevel || 0;
  let complete = true;
  for (const line of item.mods) {
    const tier = line.kind === "pool" ? found.cls?.mods.find((mod) => mod.key === line.modKey)?.tiers.find((row) => row.tier === line.tier) : null;
    if (tier) level = Math.max(level, Math.floor(tier.ilvl * 0.8));
    else complete = false;
  }
  if (given !== null) return Math.max(given, level);
  return complete ? level : null;
}

/** Editable item -> PoB item text (what the calculator gets). */
export function serializeEditableItem(item, pool) {
  const out = [`Rarity: ${item.rarity.toUpperCase()}`, item.name];
  if ((item.rarity === "rare" || item.rarity === "unique") && item.baseName && item.baseName !== item.name) out.push(item.baseName);
  if (item.itemLevel) out.push(`Item Level: ${item.itemLevel}`);
  if (item.quality) out.push(`Quality: ${item.quality}`);
  if (item.sockets) out.push(`Sockets: ${Array.from({ length: item.sockets }, () => "S").join(" ")}`);
  for (const rune of item.runes) out.push(`Rune: ${rune}`);
  const levelReq = pool ? requiredLevel(item, pool) : headerLevelReq(item);
  for (const line of item.header) {
    if (FLAG_LINE.test(line)) continue;
    if (/^LevelReq:/i.test(line)) {
      if (levelReq !== null) out.push(`LevelReq: ${levelReq}`);
    } else out.push(line);
  }
  if (levelReq !== null && levelReq > 0 && headerLevelReq(item) === null) out.push(`LevelReq: ${levelReq}`);
  out.push(`Implicits: ${item.implicits.length}`);
  for (const line of item.implicits) {
    const kind = line.flags.includes("rune") ? "{enchant}{rune}" : line.flags.includes("enchant") ? "{enchant}" : "";
    out.push(`${kind}${flagPrefix(line.flags)}${line.text}`);
  }
  for (const line of item.mods) {
    for (const text of modLineText(pool, item, line)) out.push(`${flagPrefix(line.flags)}${text}`);
  }
  for (const line of item.header) if (FLAG_LINE.test(line)) out.push(line);
  if (item.corrupted && !item.header.some((line) => /corrupted$/i.test(line))) out.push("Corrupted");
  return out.join("\n");
}

// ── Implicits of a new item ─────────────────────────────────────────────────

const isRune = (line) => line.flags.includes("rune");
const isEnchant = (line) => line.flags.includes("enchant") && !isRune(line);
const isBaseImplicit = (line) => !line.flags.includes("rune") && !line.flags.includes("enchant");

/** A data line at its best roll ("+(7-13)% to Chaos Resistance" -> "+13% to Chaos Resistance"). */
const bestRoll = (line) => {
  const { template, ranges } = lineTemplate(line);
  return fillTemplate(template, ranges.map(([a, b]) => Math.max(a, b)));
};

/**
 * The base's implicit lines at their best roll. A base whose implicit is one of several
 * (an amulet that grants one skill out of a list) takes alternative `variant`.
 */
export function baseImplicitLines(base, variant = 0) {
  const lines = [...(base?.implicit ?? [])];
  if (base?.implicitVariants?.length) lines.push(base.implicitVariants[variant] ?? base.implicitVariants[0]);
  return lines.map((line) => ({ flags: [], text: bestRoll(line) }));
}

/** An item built in the planner gets its base's implicit, as the game gives it. */
export function withBaseImplicits(item, pool, variant = 0) {
  if (item.rarity === "unique") return item;
  const base = findBase(pool, item.baseName);
  const lines = baseImplicitLines(base, variant);
  if (!lines.length) return item;
  return { ...item, implicits: [...item.implicits.filter((line) => !isBaseImplicit(line)), ...lines] };
}

/** Which alternative implicit the item carries (index into base.implicitVariants), or -1. */
export function implicitVariantOf(item, base) {
  const templates = item.implicits.filter(isBaseImplicit).map((line) => lineTemplate(line.text).template);
  return (base?.implicitVariants ?? []).findIndex((line) => templates.includes(lineTemplate(line).template));
}

/** Null when the lines are the base's implicit (same text, rolls inside the ranges), else what is wrong. */
function baseImplicitProblem(lines, base) {
  const fixed = base?.implicit ?? [];
  const variants = base?.implicitVariants ?? [];
  const wanted = variants.length ? [...fixed, "một trong các kỹ năng của base"].join(" / ") : fixed.join(" / ");
  const message = fixed.length || variants.length ? `Dòng ẩn (implicit) của ${base.name} phải là: ${wanted}.` : `${base?.name ?? "Món này"} không có dòng ẩn (implicit).`;
  const matches = (line, data) => {
    const expected = lineTemplate(data);
    const values = lineNumbers(line.text);
    return lineTemplate(line.text).template === expected.template && expected.ranges.every(([a, b], at) => values[at] >= Math.min(a, b) && values[at] <= Math.max(a, b));
  };
  if (lines.length !== fixed.length + (variants.length ? 1 : 0)) return message;
  if (!fixed.every((data, index) => matches(lines[index], data))) return message;
  if (variants.length && !variants.some((data) => matches(lines[fixed.length], data))) return message;
  return null;
}

/**
 * Prefixes and suffixes the item can hold: the rarity's limit, changed by implicit
 * lines such as "-1 Prefix Modifier allowed" (some amulet bases).
 */
export function affixLimits(item) {
  const limits = { prefix: affixLimit(item.rarity), suffix: affixLimit(item.rarity) };
  if (!limits.prefix && !limits.suffix) return limits;
  for (const line of item.implicits) {
    const match = line.text.match(/^([+-]\d+) (Prefix|Suffix) Modifiers? allowed$/i);
    if (match) limits[match[2].toLowerCase()] = Math.max(0, limits[match[2].toLowerCase()] + Number(match[1]));
  }
  return limits;
}

// ── Corruption (Vaal Orb) ───────────────────────────────────────────────────

/** Enchant lines the item has that its original did not. */
function newEnchants(item, original) {
  const before = (original?.implicits ?? []).filter(isEnchant).map((line) => line.text);
  return item.implicits.filter(isEnchant).filter((line) => {
    const at = before.indexOf(line.text);
    if (at < 0) return true;
    before.splice(at, 1);
    return false;
  });
}

const rangeText = (line) => {
  let index = 0;
  return line.template.replace(/#/g, () => {
    const [min, max] = line.ranges[index++] ?? [0, 0];
    return min === max ? formatNumber(min) : `(${formatNumber(min)}–${formatNumber(max)})`;
  });
};

/** The corruption mod of this class whose text matches these enchant lines (values inside the ranges), or null. */
function matchCorruption(cls, texts) {
  for (const record of cls?.corruptions ?? []) {
    if (record.lines.length !== texts.length) continue;
    const ok = record.lines.every((line, index) => {
      if (lineTemplate(texts[index]).template !== line.template) return false;
      const values = lineNumbers(texts[index]);
      return line.ranges.every(([a, b], at) => values[at] >= Math.min(a, b) && values[at] <= Math.max(a, b));
    });
    if (ok) return record;
  }
  return null;
}

/**
 * What corrupting this item can do, from PoB's data: add one rune socket (bases with
 * sockets; socketLimit is the corrupted maximum) or one enchant of ModCorrupted.lua
 * that can spawn on the base. `locked` is true when the item came corrupted.
 */
export function corruptionOptions(pool, item, original = null) {
  const found = poolClassForBase(pool, item.baseName);
  const socketsBefore = Math.max(maxSockets(found?.base ?? "", false), original?.sockets ?? 0);
  return {
    locked: Boolean(original?.corrupted),
    socket: Boolean(found) && maxSockets(found.base, true) > socketsBefore,
    enchants: (found?.cls?.corruptions ?? []).map((record) => ({
      key: record.id,
      text: record.lines.map(rangeText).join(" / "),
      ranges: record.lines.flatMap((line) => line.ranges)
    }))
  };
}

/** The outcome the item shows now: { kind: "none" | "plain" | "socket" | "enchant", key?, values? }. */
export function corruptionState(pool, item, original = null) {
  if (!item.corrupted) return { kind: "none" };
  const found = poolClassForBase(pool, item.baseName);
  const added = newEnchants(item, original);
  if (added.length) {
    const record = matchCorruption(found?.cls, added.map((line) => line.text));
    return { kind: "enchant", key: record?.id ?? "", values: added.flatMap((line) => lineNumbers(line.text)) };
  }
  const socketsBefore = Math.max(maxSockets(found?.base ?? "", false), original?.sockets ?? 0);
  return { kind: found && item.sockets > socketsBefore ? "socket" : "plain" };
}

/**
 * Sets the corruption outcome (and removes the previous one): "none" (not corrupted),
 * "plain" (corrupted, nothing else), "socket" (+1 socket) or "enchant" (choice.key,
 * rolled at choice.values or the top of its ranges).
 */
export function setCorruption(pool, item, original, choice) {
  if (original?.corrupted) return item;
  const found = poolClassForBase(pool, item.baseName);
  const socketsBefore = Math.max(maxSockets(found?.base ?? "", false), original?.sockets ?? 0);
  const added = new Set(newEnchants(item, original));
  const next = {
    ...item,
    corrupted: choice.kind !== "none",
    sockets: Math.min(item.sockets, socketsBefore),
    implicits: item.implicits.filter((line) => !added.has(line))
  };
  if (choice.kind === "socket" && found && maxSockets(found.base, true) > socketsBefore) next.sockets = maxSockets(found.base, true);
  if (choice.kind === "enchant") {
    const record = found?.cls?.corruptions.find((row) => row.id === choice.key);
    if (record) {
      let offset = 0;
      const lines = record.lines.map((line) => {
        const values = line.ranges.map(([a, b], index) => clamp(choice.values?.[offset + index] ?? Math.max(a, b), a, b));
        offset += line.ranges.length;
        return { flags: ["enchant"], text: fillTemplate(line.template, values) };
      });
      next.implicits = [...lines, ...next.implicits];
    }
  }
  return next;
}

// ── Editing ─────────────────────────────────────────────────────────────────

/** A new mod line from the pool, at the best tier the item level allows (values at the top of it). */
export function newPoolModLine(mod, item, values) {
  const allowed = mod.tiers.filter((tier) => tier.ilvl <= (item.itemLevel ?? MAX_ITEM_LEVEL));
  // Typed numbers pick the tier that holds them ("54 life" -> the 40-59 tier), else the best one.
  const holds = (tier) => values?.length && tierHolds(tier, values);
  const tier = [...allowed].reverse().find(holds) ?? allowed[allowed.length - 1] ?? mod.tiers[0];
  const ranges = tier.lines.flatMap((line) => line.ranges);
  const filled = ranges.map(([min, max], index) => clamp(values?.[index] ?? Math.max(min, max), min, max));
  return { id: newLineId(), kind: "pool", modKey: mod.key, gen: mod.gen, family: mod.family, tier: tier.tier, values: filled, flags: [] };
}

export const clamp = (value, a, b) => Math.min(Math.max(Number(value), Math.min(a, b)), Math.max(a, b));

/** Ranges of the current tier of a mod line (for sliders and inputs). */
export function lineRanges(pool, item, line) {
  if (line.kind === "unique") return line.ranges;
  if (line.kind !== "pool") return [];
  const mod = findPoolMod(pool, item, line.modKey);
  const tier = mod?.tiers.find((row) => row.tier === line.tier);
  return tier ? tier.lines.flatMap((row) => row.ranges) : [];
}

/** "T3 · 100–119" for a tier (its first range). */
export function tierText(tier) {
  const [min, max] = tier.lines.flatMap((line) => line.ranges).find(([a, b]) => a !== b) ?? tier.lines[0]?.ranges[0] ?? [0, 0];
  return `T${tier.tier} · ${formatNumber(min)}–${formatNumber(max)}`;
}

export function tierLabel(pool, item, line) {
  const mod = line.kind === "pool" ? findPoolMod(pool, item, line.modKey) : null;
  const tier = mod?.tiers.find((row) => row.tier === line.tier);
  return tier ? tierText(tier) : "";
}

/** Tiers the item level allows, best first. */
export function availableTiers(mod, item) {
  return mod.tiers.filter((tier) => tier.ilvl <= (item.itemLevel ?? MAX_ITEM_LEVEL)).reverse();
}

// ── Validation ──────────────────────────────────────────────────────────────

const RARITY_VI = { normal: "đồ thường", magic: "đồ ma thuật", rare: "đồ hiếm", unique: "đồ độc nhất" };
const GEN_VI = { prefix: "tiền tố", suffix: "hậu tố" };

/** Template of an editable line of a unique. */
const uniqueLineTemplate = (line) => (line.kind === "unique" ? line.template : lineTemplate(line.kind === "fixed" ? line.text : "").template);

/** Items of `wanted` not found in `have` (both lists of strings, as multisets). */
function missingFrom(wanted, have) {
  const left = [...have];
  return wanted.filter((entry) => {
    const at = left.indexOf(entry);
    if (at < 0) return true;
    left.splice(at, 1);
    return false;
  });
}

/**
 * Errors of an edited item, as { lineId?, field?, message } with Vietnamese messages.
 * `original` (the item before editing, if any) marks what came from the game:
 * unchanged lines are trusted, and limits are checked against what the player added.
 */
export function validateEditableItem(item, pool, original = null) {
  const errors = [];
  const found = poolClassForBase(pool, item.baseName);
  const itemClass = found?.base.itemClass || found?.cls?.itemClass || "";
  const originalLines = new Map((original?.mods ?? []).map((line) => [line.original ?? "", line]));
  const unchanged = (line) => {
    if (!line.original) return false;
    const before = originalLines.get(line.original);
    return Boolean(before) && modLineText(pool, item, line).join("\n") === line.original;
  };

  if (!item.baseName) errors.push({ field: "base", message: "Chưa chọn loại đồ (base)." });
  else if (!found && item.mods.some((line) => line.kind === "pool")) errors.push({ field: "base", message: `Không có dữ liệu mod cho "${item.baseName}".` });

  const itemLevel = item.itemLevel ?? MAX_ITEM_LEVEL;
  if (item.itemLevel !== undefined && (item.itemLevel < 1 || item.itemLevel > MAX_ITEM_LEVEL)) errors.push({ field: "itemLevel", message: `Cấp vật phẩm phải từ 1 đến ${MAX_ITEM_LEVEL}.` });
  if (item.quality < 0 || item.quality > MAX_QUALITY) {
    if (!(original && original.quality === item.quality)) errors.push({ field: "quality", message: `Chất lượng tối đa ${MAX_QUALITY}%.` });
  }
  const socketSource = found?.base ?? itemClass;
  const socketsBefore = Math.max(maxSockets(socketSource, false), original?.sockets ?? 0);
  const socketLimit = Math.max(maxSockets(socketSource, item.corrupted), original?.sockets ?? 0);
  if (item.sockets > socketLimit) {
    errors.push({
      field: "sockets",
      message: socketLimit
        ? `${itemClass || "Món này"} có tối đa ${socketLimit} lỗ rune${!item.corrupted && maxSockets(socketSource, true) > socketLimit ? " (thêm 1 lỗ nếu corrupt ra lỗ)" : ""}.`
        : `${itemClass || "Món này"} không có lỗ rune.`
    });
  }
  if (item.runes.length > item.sockets) errors.push({ field: "sockets", message: `Đang gắn ${item.runes.length} rune nhưng chỉ có ${item.sockets} lỗ.` });

  // Implicits and runes: the editor never changes them. A built item carries its base's implicit.
  const runesOf = (row) => [...row.runes, ...row.implicits.filter(isRune).map((line) => line.text)];
  if (original) {
    const same = (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]);
    if (!same(runesOf(item), runesOf(original)) || !same(item.implicits.filter(isBaseImplicit).map((line) => line.text), original.implicits.filter(isBaseImplicit).map((line) => line.text))) {
      errors.push({ field: "implicits", message: "Dòng ẩn (implicit) và rune không sửa được trong trình sửa đồ." });
    }
    if (missingFrom(original.implicits.filter(isEnchant).map((line) => line.text), item.implicits.filter(isEnchant).map((line) => line.text)).length) {
      errors.push({ field: "implicits", message: "Dòng enchant có sẵn của món đồ không xóa được." });
    }
  } else {
    if (runesOf(item).length) errors.push({ field: "implicits", message: "Dòng implicit và rune không sửa được trong trình sửa đồ: đồ tạo mới chưa gắn rune." });
    const implicits = item.implicits.filter(isBaseImplicit);
    if (item.rarity !== "unique" && implicits.length && pool.source === "pob") {
      const problem = found ? baseImplicitProblem(implicits, found.base) : "Không có dữ liệu dòng ẩn (implicit) cho loại đồ này.";
      if (problem) errors.push({ field: "implicits", message: problem });
    } else if (item.rarity !== "unique" && implicits.length) {
      errors.push({ field: "implicits", message: "Dòng implicit và rune không sửa được trong trình sửa đồ." });
    }
  }

  // Corruption: locked when the item came corrupted; else one outcome of the Vaal Orb.
  const addedEnchants = newEnchants(item, original);
  if (original?.corrupted && !item.corrupted) errors.push({ field: "corrupted", message: "Đồ đã corrupt không thể bỏ corrupt." });
  if (original?.corrupted) {
    const before = (original.mods ?? []).map((line) => line.original ?? "").join("\n");
    const after = item.mods.map((line) => modLineText(pool, item, line).join("\n")).join("\n");
    if (before !== after) errors.push({ field: "mods", message: "Đồ đã corrupt: không đổi được dòng mod nào." });
    if (original.quality !== item.quality || original.sockets !== item.sockets) errors.push({ field: "quality", message: "Đồ đã corrupt: không đổi được chất lượng hay số lỗ." });
    if (addedEnchants.length) errors.push({ field: "corrupted", message: "Đồ đã corrupt: không thêm được dòng enchant." });
  } else if (addedEnchants.length) {
    if (!item.corrupted) errors.push({ field: "corrupted", message: "Dòng enchant của Vaal Orb chỉ có trên đồ đã corrupt." });
    else {
      if (!matchCorruption(found?.cls, addedEnchants.map((line) => line.text))) {
        errors.push({ field: "corrupted", message: `Enchant "${addedEnchants.map((line) => line.text).join(" / ")}" không phải kết quả corrupt của ${itemClass || "loại đồ này"} (hoặc vượt khoảng giá trị).` });
      }
      if (item.sockets > socketsBefore) errors.push({ field: "corrupted", message: "Corrupt chỉ cho một kết quả: thêm 1 lỗ rune hoặc thêm 1 dòng enchant, không được cả hai." });
    }
  }

  // A unique keeps exactly its lines: none removed, none added.
  if (item.rarity === "unique") {
    const reference = original
      ? original.mods.map(uniqueLineTemplate)
      : pool.uniques.get(normalizeText(item.name))?.map((line) => line.template) ?? null;
    const current = original ? item.mods.map(uniqueLineTemplate) : [...item.implicits.filter(isBaseImplicit).map((line) => lineTemplate(line.text).template), ...item.mods.map(uniqueLineTemplate)];
    if (!reference) errors.push({ field: "mods", message: `Không có dữ liệu cho đồ độc nhất "${item.name}", không tạo mới được.` });
    else {
      const removed = missingFrom(reference, current);
      const added = missingFrom(current, reference);
      if (removed.length) errors.push({ field: "mods", message: `Đồ độc nhất có mod cố định, không xóa được dòng nào (thiếu ${removed.length} dòng: "${removed[0]}").` });
      if (added.length) errors.push({ field: "mods", message: `Đồ độc nhất có mod cố định, không thêm được dòng nào ("${added[0]}").` });
    }
  }

  // Lines the player added or changed.
  for (const line of item.mods) {
    if (unchanged(line)) continue;
    if (line.kind === "fixed") {
      // The fixed lines of a unique are checked as a set above.
      if (item.rarity !== "unique" || original) errors.push({ lineId: line.id, message: "Không nhận diện được dòng này, không sửa được." });
      continue;
    }
    if (line.kind === "unique") {
      line.ranges.forEach(([a, b], index) => {
        const value = line.values[index];
        if (!(value >= Math.min(a, b) && value <= Math.max(a, b))) errors.push({ lineId: line.id, message: `Giá trị vượt khoảng ${formatNumber(Math.min(a, b))}–${formatNumber(Math.max(a, b))}.` });
      });
      continue;
    }
    if (item.rarity === "unique") {
      errors.push({ lineId: line.id, message: "Đồ độc nhất có mod cố định, chỉ chỉnh được giá trị trong khoảng." });
      continue;
    }
    const mod = found?.cls?.mods.find((row) => row.key === line.modKey);
    if (!mod) {
      errors.push({ lineId: line.id, message: `Mod này không xuất hiện trên ${found?.base.name && pool.source === "pob" ? `${found.base.name} (${itemClass})` : itemClass || item.baseName || "loại đồ này"}.` });
      continue;
    }
    const tier = mod.tiers.find((row) => row.tier === line.tier);
    if (!tier) {
      errors.push({ lineId: line.id, message: "Bậc (tier) không tồn tại." });
      continue;
    }
    if (tier.ilvl > itemLevel) errors.push({ lineId: line.id, message: `T${tier.tier} cần cấp vật phẩm ${tier.ilvl} (đang ${itemLevel}).` });
    const ranges = tier.lines.flatMap((row) => row.ranges);
    if (ranges.length !== line.values.length) errors.push({ lineId: line.id, message: "Số giá trị không khớp mod." });
    ranges.forEach(([a, b], index) => {
      const value = line.values[index];
      if (!(value >= Math.min(a, b) && value <= Math.max(a, b))) errors.push({ lineId: line.id, message: `Giá trị vượt khoảng ${formatNumber(Math.min(a, b))}–${formatNumber(Math.max(a, b))} của T${tier.tier}.` });
    });
  }

  // Groups and affix counts over all recognised lines.
  const families = new Map();
  for (const line of item.mods) {
    if (line.kind !== "pool") continue;
    const seen = families.get(line.family);
    if (seen && !(unchanged(line) && unchanged(seen))) errors.push({ lineId: line.id, message: "Đã có mod cùng nhóm này trên món đồ." });
    else families.set(line.family, line);
  }
  if (item.rarity !== "unique") {
    const limits = affixLimits(item);
    for (const gen of ["prefix", "suffix"]) {
      const limit = limits[gen];
      const count = item.mods.filter((line) => line.kind === "pool" && line.gen === gen).length;
      const before = (original?.mods ?? []).filter((line) => line.kind === "pool" && line.gen === gen).length;
      if (count > limit && count > before) {
        errors.push({
          field: gen,
          message: affixLimit(item.rarity) === 0
            ? `${capitalize(RARITY_VI[item.rarity] ?? "đồ này")} không có ${GEN_VI[gen]}. Đổi sang ma thuật hoặc hiếm để thêm mod.`
            : `Quá số ${GEN_VI[gen]}: đang có ${count}, ${RARITY_VI[item.rarity]} chỉ có tối đa ${limit}. Hãy xóa bớt ${count - limit} dòng.`
        });
      }
    }
  }
  return errors;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ── Pasted items ────────────────────────────────────────────────────────────

/**
 * How far above the data a pasted value may be before it counts as impossible.
 * Real items read higher than a tier's top: catalyst quality scales jewellery mods,
 * sanctified items scale theirs, and the game moves ranges between patches. Rings in
 * the ladder fixtures read up to 1.5x the best total in PoB's data, so the check is
 * for values "far outside any tier": more than double.
 */
export const PASTED_VALUE_TOLERANCE = 2;
/**
 * Mods of one group a pasted item may show. The game allows one, but item text from
 * the trade API lists a desecrated or fractured copy as its own line (two "+% to Fire
 * Resistance" lines on one helmet in the ladder fixtures), so only a third is refused.
 */
export const PASTED_MAX_PER_GROUP = 2;
/** Lines that scale the item's other mods: "57% increased Effect of Prefixes", "30% increased Explicit Speed Modifier magnitudes". */
const MAGNITUDE_LINE = /^(\d+(?:\.\d+)?)% increased (?:Effect of (?:Prefixes|Suffixes)|Explicit .*Modifier magnitudes)$/i;

/** Mods that can carry a text on this class: normal tiers, special (essence, desecrated...) and unbound ones. */
function classCarriers(pool, cls) {
  if (cls.carriers) return cls.carriers;
  const byTemplate = new Map();
  const add = (carrier) => {
    carrier.templates = carrier.lines.map((line) => line.template);
    for (const template of new Set(carrier.templates)) {
      if (!byTemplate.has(template)) byTemplate.set(template, []);
      byTemplate.get(template).push(carrier);
    }
  };
  for (const mod of cls.mods) for (const tier of mod.tiers) add({ gen: mod.gen, group: mod.family, level: tier.ilvl, lines: tier.lines, source: "normal" });
  for (const record of cls.special ?? []) add({ gen: record.gen, group: record.group, level: record.level, lines: record.lines, source: "special" });
  for (const record of pool.unbound?.[cls.table] ?? []) add({ gen: record.gen, group: record.group, level: record.level, lines: record.lines, source: "unbound" });
  // Texts a tag of the base itself rules out, unless a normal or special mod gives them.
  cls.ruledOut = new Set();
  for (const record of cls.excluded ?? []) {
    for (const line of record.lines) {
      if (!(byTemplate.get(line.template) ?? []).some((carrier) => carrier.source !== "unbound")) cls.ruledOut.add(line.template);
    }
  }
  cls.carriers = byTemplate;
  return byTemplate;
}

/** Explicit text lines of an editable item, as written. */
const explicitTexts = (item, pool) => item.mods.flatMap((line) => (line.original ? line.original.split("\n") : modLineText(pool, item, line)));

/**
 * Can the lines be explained by at most `limits.prefix` prefixes and `limits.suffix`
 * suffixes? Each mod covers one line per text it has (its lines must all be on the
 * item; a line can be the sum of two mods), and at most `perGroup` mods come from one
 * group. Gives up (true) on very long searches.
 */
function coverExists(lines, shapesByTemplate, limits, perGroup) {
  const present = new Set(lines);
  let budget = 20000;
  const covered = new Array(lines.length).fill(false);
  const used = new Map();
  const count = { prefix: 0, suffix: 0 };
  const search = () => {
    if ((budget -= 1) < 0) return true;
    const at = covered.indexOf(false);
    if (at < 0) return true;
    for (const shape of shapesByTemplate.get(lines[at]) ?? []) {
      if ((used.get(shape.group) ?? 0) >= perGroup) continue;
      if (shape.gen && count[shape.gen] >= limits[shape.gen]) continue;
      if (!shape.templates.every((template) => present.has(template))) continue;
      const marked = [];
      for (const template of new Set(shape.templates)) {
        const index = template === lines[at] ? at : lines.findIndex((line, i) => line === template && !covered[i]);
        if (index >= 0 && !covered[index]) {
          covered[index] = true;
          marked.push(index);
        }
      }
      used.set(shape.group, (used.get(shape.group) ?? 0) + 1);
      if (shape.gen) count[shape.gen] += 1;
      const ok = search();
      if (shape.gen) count[shape.gen] -= 1;
      used.set(shape.group, used.get(shape.group) - 1);
      for (const index of marked) covered[index] = false;
      if (ok) return true;
    }
    return false;
  };
  return search();
}

/**
 * Errors of item text that came from outside the editor (pasted from the game,
 * imported from a PoB code). Real items break the editor's limits (desecrated and
 * essence mods, alloys, quality above 20%), so only what no real item can break is
 * checked, on the lines the data knows:
 *   - a mod text that exists in the data but on no mod this base can ever carry;
 *   - a value far above every tier that could give it (PASTED_VALUE_TOLERANCE);
 *   - a value whose every tier needs a higher item level than the item has;
 *   - more prefixes / suffixes than the rarity holds, or two mods of one group;
 *   - more rune sockets than the base's hard limit, more runes than sockets;
 *   - quality above PASTED_MAX_QUALITY.
 * Lines the data does not know are left alone. Uniques are not checked here.
 */
export function validatePastedItem(item, pool, { tolerance = PASTED_VALUE_TOLERANCE } = {}) {
  const errors = [];
  if (item.quality > PASTED_MAX_QUALITY) errors.push({ field: "quality", message: `Chất lượng ${item.quality}% không có trong game (tối đa ${PASTED_MAX_QUALITY}%).` });
  if (item.itemLevel !== undefined && (item.itemLevel < 1 || item.itemLevel > MAX_ITEM_LEVEL)) errors.push({ field: "itemLevel", message: `Cấp vật phẩm phải từ 1 đến ${MAX_ITEM_LEVEL}.` });
  const found = poolClassForBase(pool, item.baseName);
  if (item.rarity === "unique" || !found?.cls || pool.source !== "pob") return errors;
  const { base, cls } = found;
  const hardSockets = maxSockets(base, true);
  if (item.sockets > hardSockets) errors.push({ field: "sockets", message: hardSockets ? `${base.itemClass} có tối đa ${hardSockets} lỗ rune (đang ${item.sockets}).` : `${base.itemClass} không có lỗ rune.` });
  if (item.runes.length > item.sockets) errors.push({ field: "sockets", message: `Đang gắn ${item.runes.length} rune nhưng chỉ có ${item.sockets} lỗ.` });

  const carriers = classCarriers(pool, cls);
  const known = pool.known?.[cls.table] ?? new Set();
  const itemLevel = item.itemLevel ?? MAX_ITEM_LEVEL;
  const recognised = [];
  const limits = affixLimits(item);
  const texts = explicitTexts(item, pool);
  // "57% increased Effect of Prefixes" raises what the other lines can read.
  const magnitude = 1 + Math.max(0, ...texts.map((text) => Number(text.match(MAGNITUDE_LINE)?.[1]) || 0)) / 100;
  // "+1 Prefix Modifier allowed" as a mod (a jewel craft) raises the limit too.
  for (const text of texts) {
    const allowed = text.match(/^\+(\d+) (Prefix|Suffix) Modifiers? allowed$/i);
    if (allowed) limits[allowed[2].toLowerCase()] += Number(allowed[1]);
  }
  for (const text of texts) {
    const { template } = lineTemplate(text);
    // An unbound mod (no weight anywhere) does not explain a line the base's own tags rule out.
    const list = cls.ruledOut.has(template) ? null : carriers.get(template);
    if (!list) {
      if (known.has(template) || cls.ruledOut.has(template)) errors.push({ field: "mods", message: `Mod "${text}" không thể xuất hiện trên ${base.name} (${base.itemClass}).` });
      continue;
    }
    recognised.push(template);
    const values = lineNumbers(text);
    // The most a line can read: the two strongest groups that carry it, added up
    // (a pure mod plus a hybrid one show as a single line).
    for (let at = 0; at < values.length; at += 1) {
      const topByGroup = new Map();
      let signed = false;
      for (const carrier of list) {
        const range = carrier.lines[carrier.templates.indexOf(template)].ranges[at];
        if (!range) continue;
        if (range[0] < 0 || range[1] < 0) signed = true;
        topByGroup.set(carrier.group, Math.max(topByGroup.get(carrier.group) ?? 0, range[0], range[1]));
      }
      if (signed || !topByGroup.size) continue;
      const tops = [...topByGroup.values()].sort((a, b) => b - a);
      const bound = (tops[0] + (tops[1] ?? 0)) * tolerance * magnitude;
      if (values[at] > bound) {
        errors.push({ field: "mods", message: `"${text}": giá trị ${formatNumber(values[at])} vượt xa mọi bậc của mod này trên ${base.itemClass} (bậc cao nhất ${formatNumber(tops[0])}).` });
        break;
      }
      // Normal mods of a single group: the value needs a tier, and the tier an item level.
      if (at === 0 && topByGroup.size === 1 && list.every((carrier) => carrier.source === "normal")) {
        const reach = list.filter((carrier) => Math.max(...carrier.lines[carrier.templates.indexOf(template)].ranges[0]) * tolerance * magnitude >= values[0]);
        const needed = Math.min(...reach.map((carrier) => carrier.level));
        if (reach.length && needed > itemLevel) {
          errors.push({ field: "mods", message: `"${text}": giá trị này cần cấp vật phẩm ${needed} trở lên (món đồ đang cấp ${itemLevel}).` });
          break;
        }
      }
    }
  }

  if (recognised.length) {
    const shapesByTemplate = new Map();
    const present = new Set(recognised);
    for (const template of present) {
      const seen = new Set();
      const shapes = [];
      for (const carrier of carriers.get(template)) {
        const key = `${carrier.gen}|${carrier.group}|${carrier.templates.join("|")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        shapes.push({ gen: carrier.gen, group: carrier.group, templates: carrier.templates });
      }
      // Mods with more lines first: the search then finds small covers quickly.
      shapesByTemplate.set(template, shapes.sort((a, b) => b.templates.length - a.templates.length));
    }
    if (!coverExists(recognised, shapesByTemplate, limits, PASTED_MAX_PER_GROUP)) {
      const kind = RARITY_VI[item.rarity] ?? "đồ này";
      if (limits.prefix + limits.suffix === 0) errors.push({ field: "mods", message: `${capitalize(kind)} không có tiền tố hay hậu tố, nhưng món này có ${recognised.length} dòng mod.` });
      else if (coverExists(recognised, shapesByTemplate, limits, Infinity)) errors.push({ field: "mods", message: "Món đồ có quá nhiều mod cùng một nhóm (trong game mỗi nhóm mod chỉ xuất hiện một lần trên một món)." });
      else errors.push({ field: "mods", message: `Món đồ có quá nhiều mod: ${kind} chỉ có tối đa ${limits.prefix} tiền tố và ${limits.suffix} hậu tố.` });
    }
  }
  return errors;
}

/** validatePastedItem for item text. */
export function validatePastedItemText(rawText, pool) {
  return validatePastedItem(parseEditableItem(rawText, pool), pool);
}

/**
 * Validates item text the browser sent as edited or built in the planner, against the
 * text it started from (if any): the full rules for what changed (validateEditableItem)
 * and, when it started from game text, the pasted-item rules for the whole item.
 *
 * What is "from the game" cannot be proven, so the original is held to the rules no
 * real item breaks, and the edit to what the editor can do.
 */
export function validateItemText(rawText, pool, originalText = "") {
  const item = parseEditableItem(rawText, pool);
  const original = originalText ? parseEditableItem(originalText, pool) : null;
  // Read-only lines must come from the original: pair them by text.
  if (original) {
    const originalTexts = new Set(original.mods.map((line) => line.original));
    for (const line of item.mods) if (!originalTexts.has(line.original)) delete line.original;
  } else {
    for (const line of item.mods) delete line.original;
  }
  const errors = validateEditableItem(item, pool, original);
  if (!original) return errors;
  const seen = new Set(errors.map((error) => error.message));
  return [...errors, ...validatePastedItem(parseEditableItem(rawText, pool), pool).filter((error) => !seen.has(error.message))];
}

// ── Add-mod suggestions ─────────────────────────────────────────────────────

/** Vietnamese (accent-free) words players type -> the English words in mod text. */
const VI_WORDS = [
  ["khang lua", "fire resistance"], ["khang bang", "cold resistance"], ["khang set", "lightning resistance"],
  ["khang hon mang", "chaos resistance"], ["khang nguyen to", "elemental resistances"], ["khang", "resistance"],
  ["toc danh", "attack speed"], ["toc do danh", "attack speed"], ["toc niem", "cast speed"], ["toc do niem", "cast speed"],
  ["toc chay", "movement speed"], ["di chuyen", "movement speed"], ["toc do", "speed"],
  ["sat thuong chi mang", "critical damage"], ["ti le chi mang", "critical hit chance"], ["chi mang", "critical"],
  ["tay sai", "minion"], ["de tu", "minion"], ["thu ha", "minion"], ["quai trieu hoi", "minion"], ["trieu hoi", "minion"], ["linh", "minion"],
  ["dong minh", "allies"], ["dong doi", "allies"],
  ["sat thuong", "damage"], ["vat ly", "physical"], ["nguyen to", "elemental"],
  ["khien nang luong", "energy shield"], ["la chan nang luong", "energy shield"],
  ["hoi mau", "life regeneration"], ["hoi mana", "mana regeneration"], ["hoi nang luong", "mana regeneration"], ["hoi phuc", "recover"], ["hoi", "regeneration"],
  ["mau", "life"], ["nang luong", "mana"],
  ["giap", "armour"], ["ne tranh", "evasion"], ["ne", "evasion"], ["chinh xac", "accuracy"],
  ["suc manh", "strength"], ["kheo leo", "dexterity"], ["nhanh nhen", "dexterity"], ["tri tue", "intelligence"], ["thuoc tinh", "attributes"],
  ["cap ky nang", "level of all"], ["cap skill", "level of all"], ["ky nang", "skills"],
  ["can chien", "melee"], ["tam xa", "projectile"], ["phep", "spell"], ["phep thuat", "spell"], ["tan cong", "attack"],
  ["lua", "fire"], ["bang", "cold"], ["set", "lightning"], ["hon mang", "chaos"], ["cung", "bow"],
  ["dan", "projectile"], ["mui ten", "arrow"], ["hut mau", "life leech"], ["hut mana", "mana leech"], ["hut", "leech"],
  ["choang", "stun"], ["chan don", "block"], ["chan", "block"], ["tinh than", "spirit"],
  ["do hiem", "rarity"], ["vang", "rarity"], ["doc", "poison"], ["chay mau", "bleeding"], ["thieu dot", "ignite"], ["dot chay", "ignite"],
  ["dong bang", "freeze"], ["dong cung", "freeze"], ["giat dien", "shock"], ["soc dien", "shock"], ["nguyen rua", "curse"],
  ["vat to", "totem"], ["gai", "thorns"], ["binh", "flask"], ["bua", "charm"], ["thoi gian", "duration"], ["pham vi", "area"],
  ["hieu ung", "effect"], ["chi phi", "cost"], ["xuyen khang", "penetrate"], ["xuyen", "pierce"], ["phan don", "thorns"],
  ["hien dien", "presence"], ["tu si", "minion"], ["no", "rage"]
];

/** Query -> English search words plus any numbers typed ("54 máu" -> words ["life"], numbers [54]). */
export function parseModQuery(query) {
  let text = normalizeText(query);
  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  text = text.replace(/[+#%]|\d+(?:\.\d+)?/g, " ").replace(/\s+/g, " ").trim();
  const words = [];
  // Longer phrases first, so "hồi máu" is not read as "hồi" + "máu".
  for (const [vi, en] of [...VI_WORDS].sort((a, b) => b[0].length - a[0].length)) {
    const pattern = new RegExp(`(^|\\s)${vi}(?=\\s|$)`);
    if (pattern.test(text)) {
      words.push(...en.split(" "));
      text = text.replace(pattern, " ");
    }
  }
  words.push(...text.split(" ").filter((word) => word.length > 1 || /\d/.test(word)));
  return { words: [...new Set(words)], numbers };
}

const USEFUL_TAGS = ["damage", "life", "resistance", "elemental", "critical", "speed", "defences"];

/** Why a pool mod cannot be added right now ("" when it can). */
export function addModBlockedReason(mod, item) {
  if (item.corrupted) return "Đồ đã corrupt.";
  if (item.rarity === "unique") return "Đồ độc nhất có mod cố định.";
  if (!affixLimit(item.rarity)) return "Đồ thường không có mod. Đổi sang ma thuật hoặc hiếm.";
  const limit = affixLimits(item)[mod.gen];
  if (item.mods.some((line) => line.kind === "pool" && line.family === mod.family)) return "Đã có mod cùng nhóm.";
  const count = item.mods.filter((line) => line.kind === "pool" && line.gen === mod.gen).length;
  if (count > limit) return `Đang có ${count} ${GEN_VI[mod.gen]}, tối đa ${limit}: hãy xóa bớt.`;
  if (count === limit) return `Đã đủ ${limit} ${GEN_VI[mod.gen]}.`;
  if (!mod.tiers.some((tier) => tier.ilvl <= (item.itemLevel ?? MAX_ITEM_LEVEL))) return `Cần cấp vật phẩm ${mod.tiers[0].ilvl}.`;
  return "";
}

/**
 * Pool mods for the add-mod box, matching the query, each with its best tier at
 * this item level, prefix/suffix, group and why it is blocked (still listed).
 * Order: recently picked, then allowed before blocked, useful tags, then A-Z
 * (prefixes before suffixes).
 */
export function suggestMods(pool, item, query, { recent = [], limit = 30 } = {}) {
  const found = poolClassForBase(pool, item.baseName);
  if (!found?.cls) return [];
  const { words, numbers } = parseModQuery(query);
  const recentRank = new Map(recent.map((key, index) => [key, index]));
  const rows = [];
  for (const mod of found.cls.mods) {
    const tiers = availableTiers(mod, item);
    const tier = tiers[0] ?? mod.tiers[0];
    const display = tier.lines.map((line) => rangeText(line)).join(" / ");
    const text = normalizeText(display);
    const haystack = normalizeText(`${display} ${mod.templates.join(" ")} ${mod.family} ${mod.tags.join(" ")} ${mod.gen}`);
    if (words.length && !words.every((word) => haystack.includes(word))) continue;
    const blocked = addModBlockedReason(mod, item);
    // The words in the mod text itself beat words found only in its tags or group.
    const direct = words.length && words.every((word) => text.includes(word)) ? 1 : 0;
    const useful = mod.tags.some((tag) => USEFUL_TAGS.includes(String(tag).toLowerCase())) ? 1 : 0;
    rows.push({ mod, tier, display, gen: mod.gen, family: mod.family, tierLabel: `T${tier.tier}`, blocked, useful, direct, recent: recentRank.has(mod.key) ? recentRank.get(mod.key) : Infinity, numbers });
  }
  rows.sort((a, b) => a.recent - b.recent
    || Number(Boolean(a.blocked)) - Number(Boolean(b.blocked))
    || b.direct - a.direct
    || b.useful - a.useful
    || (a.gen === b.gen ? 0 : a.gen === "prefix" ? -1 : 1)
    || a.display.length - b.display.length
    || a.display.localeCompare(b.display));
  return rows.slice(0, limit);
}

/** Adds a suggested mod; numbers typed in the query fill its values (clamped to the tier). */
export function addSuggestedMod(item, suggestion) {
  if (suggestion.blocked) return item;
  const line = newPoolModLine(suggestion.mod, item, suggestion.numbers.length ? suggestion.numbers : undefined);
  return { ...item, mods: [...item.mods, line] };
}

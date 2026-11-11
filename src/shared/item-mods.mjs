// Item mods for the Build Planner's item editor, shared by the browser, the server
// and the tests so both sides apply the same rules:
//
//   - the mod pool: which prefixes/suffixes each base can roll, their tiers (item
//     level, value range) and mod families, from public/data/craft-data.js
//     (poe2db ModifiersCalc) and craft-index.js (base -> item class);
//   - an editable item model parsed from / written back to PoB item text;
//   - validation (affix counts, tiers, families, bases, sockets, quality,
//     uniques, corruption) with Vietnamese messages;
//   - mod search for the add-mod box (accent-insensitive, Vietnamese keywords).
//
// Lines a game item already had are trusted as they are (the pool does not know
// desecrated, essence or boosted mods); the rules apply to what the player adds
// or changes. Mods can only be added from the pool, never typed in.

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

/**
 * craft-data (classes with prefixes/suffixes) + craft-index (bases) + optional
 * unique item records ({ name, rarity: "unique", mods }) -> pool.
 */
export function buildModPool(craftData, craftIndex, uniqueRecords = []) {
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
    classes.set(classKey, { key: classKey, itemClass: cls.item_class || cls.label, label: cls.label, mods });
  }
  const bases = new Map();
  for (const group of craftIndex?.tree ?? []) {
    for (const cls of group.classes ?? []) {
      for (const base of cls.bases ?? []) {
        if (base.name && base.craft_key) bases.set(normalizeText(base.name), { name: base.name, classKey: base.craft_key, itemClass: cls.label, reqLevel: base.req_level });
      }
    }
  }
  const uniques = new Map();
  for (const record of uniqueRecords) {
    if (String(record?.rarity).toLowerCase() !== "unique" || !record.name) continue;
    const lines = (record.mods ?? []).filter((line) => !/\[[-+]?\d+(?:\.\d+)?\]\s*\.?$/.test(line)).flatMap(splitHybridText).map(lineTemplate);
    uniques.set(normalizeText(record.name), lines);
  }
  return { classes, bases, uniques };
}

export function poolClassForBase(pool, baseName) {
  const base = pool.bases.get(normalizeText(baseName));
  return base ? { base, cls: pool.classes.get(base.classKey) } : null;
}

// ── Limits ──────────────────────────────────────────────────────────────────

export const AFFIX_LIMITS = { normal: 0, magic: 1, rare: 3, unique: 0 };

const TWO_SOCKET_CLASSES = /body armour|bow|crossbow|staff|staves|quarterstaff|two hand|talisman/i;
const ONE_SOCKET_CLASSES = /helmet|gloves|boots|shield|buckler|foci|focus|claw|dagger|wand|sceptre|one hand|spear|flail|trap/i;

/** Rune sockets a base can have (corruption may add one). */
export function maxSockets(itemClass, corrupted = false) {
  const base = TWO_SOCKET_CLASSES.test(itemClass || "") ? 2 : ONE_SOCKET_CLASSES.test(itemClass || "") ? 1 : 0;
  return base ? base + (corrupted ? 1 : 0) : 0;
}

export const MAX_QUALITY = 20;
export const MAX_ITEM_LEVEL = 100;

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

function matchPoolMods(cls, lines, start) {
  if (!cls) return null;
  const first = lineTemplate(lines[start].text).template;
  for (const mod of cls.mods) {
    if (mod.templates[0] !== first) continue;
    const span = mod.templates.length;
    if (start + span > lines.length) continue;
    if (mod.templates.every((template, offset) => lineTemplate(lines[start + offset].text).template === template)) return mod;
  }
  return null;
}

/** Best (highest) tier whose ranges hold the values and whose level the item reaches; else the closest. */
export function tierForValues(mod, values, itemLevel = MAX_ITEM_LEVEL) {
  const ranges = (tier) => tier.lines.flatMap((line) => line.ranges);
  const fits = (tier) => ranges(tier).every(([min, max], index) => values[index] === undefined || (values[index] >= Math.min(min, max) && values[index] <= Math.max(min, max)));
  const allowed = mod.tiers.filter((tier) => tier.ilvl <= itemLevel);
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
        if (pool.bases.has(normalizeText(candidate))) {
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
  const uniqueLines = item.rarity === "unique" && pool ? pool.uniques.get(normalizeText(item.name)) : null;
  for (let index = 0; index < modLines.length; index += 1) {
    const line = modLines[index];
    if (item.rarity === "unique") {
      const { template } = lineTemplate(line.text);
      const known = uniqueLines?.find((row) => row.template === template);
      item.mods.push(known && known.ranges.some(([a, b]) => a !== b)
        ? { id: newLineId(), kind: "unique", template, ranges: known.ranges, values: lineNumbers(line.text), flags: line.flags, original: line.text }
        : { id: newLineId(), kind: "fixed", text: line.text, flags: line.flags, original: line.text });
      continue;
    }
    const mod = matchPoolMods(found?.cls, modLines, index);
    if (mod) {
      const span = mod.templates.length;
      const text = modLines.slice(index, index + span).map((row) => row.text);
      const values = text.flatMap(lineNumbers);
      const tier = tierForValues(mod, values, item.itemLevel ?? MAX_ITEM_LEVEL);
      item.mods.push({ id: newLineId(), kind: "pool", modKey: mod.key, gen: mod.gen, family: mod.family, tier: tier.tier, values, flags: line.flags, original: text.join("\n") });
      index += span - 1;
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

/** Editable item -> PoB item text (what the calculator gets). */
export function serializeEditableItem(item, pool) {
  const out = [`Rarity: ${item.rarity.toUpperCase()}`, item.name];
  if ((item.rarity === "rare" || item.rarity === "unique") && item.baseName && item.baseName !== item.name) out.push(item.baseName);
  if (item.itemLevel) out.push(`Item Level: ${item.itemLevel}`);
  if (item.quality) out.push(`Quality: ${item.quality}`);
  if (item.sockets) out.push(`Sockets: ${Array.from({ length: item.sockets }, () => "S").join(" ")}`);
  for (const rune of item.runes) out.push(`Rune: ${rune}`);
  for (const line of item.header) {
    if (!FLAG_LINE.test(line)) out.push(line);
  }
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

// ── Editing ─────────────────────────────────────────────────────────────────

/** A new mod line from the pool, at the best tier the item level allows (values at the top of it). */
export function newPoolModLine(mod, item, values) {
  const allowed = mod.tiers.filter((tier) => tier.ilvl <= (item.itemLevel ?? MAX_ITEM_LEVEL));
  // Typed numbers pick the tier that holds them ("54 life" -> the 40-59 tier), else the best one.
  const holds = (tier) => values?.length && tier.lines.flatMap((line) => line.ranges).every(([min, max], index) => values[index] === undefined || (values[index] >= Math.min(min, max) && values[index] <= Math.max(min, max)));
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

export function tierLabel(pool, item, line) {
  const mod = line.kind === "pool" ? findPoolMod(pool, item, line.modKey) : null;
  const tier = mod?.tiers.find((row) => row.tier === line.tier);
  if (!tier) return "";
  const [min, max] = tier.lines[0].ranges[0] ?? [0, 0];
  return `T${tier.tier} · ${formatNumber(min)}–${formatNumber(max)}`;
}

/** Tiers the item level allows, best first. */
export function availableTiers(mod, item) {
  return mod.tiers.filter((tier) => tier.ilvl <= (item.itemLevel ?? MAX_ITEM_LEVEL)).reverse();
}

// ── Validation ──────────────────────────────────────────────────────────────

const RARITY_VI = { normal: "đồ thường", magic: "đồ ma thuật", rare: "đồ hiếm", unique: "đồ độc nhất" };

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
  const socketLimit = Math.max(maxSockets(itemClass, item.corrupted), original?.sockets ?? 0);
  if (item.sockets > socketLimit) errors.push({ field: "sockets", message: socketLimit ? `${itemClass || "Món này"} có tối đa ${socketLimit} lỗ rune.` : `${itemClass || "Món này"} không có lỗ rune.` });
  if (item.runes.length > item.sockets) errors.push({ field: "sockets", message: `Đang gắn ${item.runes.length} rune nhưng chỉ có ${item.sockets} lỗ.` });

  if (original?.corrupted && !item.corrupted) errors.push({ field: "corrupted", message: "Đồ đã corrupt không thể bỏ corrupt." });
  if (original?.corrupted) {
    const before = (original.mods ?? []).map((line) => line.original ?? "").join("\n");
    const after = item.mods.map((line) => modLineText(pool, item, line).join("\n")).join("\n");
    if (before !== after) errors.push({ field: "mods", message: "Đồ đã corrupt: không đổi được dòng mod nào." });
    if (original.quality !== item.quality || original.sockets !== item.sockets) errors.push({ field: "quality", message: "Đồ đã corrupt: không đổi được chất lượng hay số lỗ." });
  }

  // Lines the player added or changed.
  for (const line of item.mods) {
    if (unchanged(line)) continue;
    if (line.kind === "fixed") {
      errors.push({ lineId: line.id, message: "Không nhận diện được dòng này, không sửa được." });
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
      errors.push({ lineId: line.id, message: `Mod này không xuất hiện trên ${itemClass || item.baseName || "loại đồ này"}.` });
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
      if (!(value >= Math.min(a, b) && value <= Math.max(a, b))) errors.push({ lineId: line.id, message: `Giá trị vượt khoảng ${formatNumber(Math.min(a, b))}–${formatNumber(Math.max(a, b))}.` });
    });
  }

  // Families and affix counts over all recognised lines.
  const families = new Map();
  for (const line of item.mods) {
    if (line.kind !== "pool") continue;
    const seen = families.get(line.family);
    if (seen && !(unchanged(line) && unchanged(seen))) errors.push({ lineId: line.id, message: "Đã có mod cùng nhóm này trên món đồ." });
    else families.set(line.family, line);
  }
  if (item.rarity !== "unique") {
    const limit = AFFIX_LIMITS[item.rarity] ?? 0;
    for (const gen of ["prefix", "suffix"]) {
      const count = item.mods.filter((line) => line.kind === "pool" && line.gen === gen).length;
      const before = (original?.mods ?? []).filter((line) => line.kind === "pool" && line.gen === gen).length;
      if (count > limit && count > before) {
        errors.push({
          field: gen,
          message: limit === 0
            ? `${RARITY_VI[item.rarity] ?? "Đồ này"} không có ${gen === "prefix" ? "tiền tố" : "hậu tố"}. Đổi sang ma thuật hoặc hiếm để thêm mod.`
            : `Đã đủ ${limit} ${gen === "prefix" ? "tiền tố" : "hậu tố"} (${RARITY_VI[item.rarity]}).`
        });
      }
    }
  }
  return errors;
}

/** Validates item text the browser sent, against the text it started from (if any). */
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
  return validateEditableItem(item, pool, original);
}

// ── Add-mod suggestions ─────────────────────────────────────────────────────

/** Vietnamese (accent-free) words players type -> the English words in mod text. */
const VI_WORDS = [
  ["khang lua", "fire resistance"], ["khang bang", "cold resistance"], ["khang set", "lightning resistance"],
  ["khang hon mang", "chaos resistance"], ["khang nguyen to", "elemental resistances"], ["khang", "resistance"],
  ["toc danh", "attack speed"], ["toc niem", "cast speed"], ["toc chay", "movement speed"], ["di chuyen", "movement speed"],
  ["chi mang", "critical"], ["sat thuong", "damage"], ["vat ly", "physical"], ["nguyen to", "elemental"],
  ["khien nang luong", "energy shield"], ["mau", "life"], ["hoi mau", "life regeneration"], ["hoi", "regeneration"],
  ["giap", "armour"], ["ne", "evasion"], ["chinh xac", "accuracy"], ["suc manh", "strength"], ["kheo leo", "dexterity"],
  ["tri tue", "intelligence"], ["thuoc tinh", "attributes"], ["cap ky nang", "level of all"], ["ky nang", "skills"],
  ["lua", "fire"], ["bang", "cold"], ["set", "lightning"], ["hon mang", "chaos"], ["phep", "spell"], ["cung", "bow"],
  ["dan", "projectile"], ["hut", "leech"], ["choang", "stun"], ["chan", "block"], ["tinh than", "spirit"], ["vang", "rarity"]
];

/** Query -> English search words plus any numbers typed ("54 máu" -> words ["life"], numbers [54]). */
export function parseModQuery(query) {
  let text = normalizeText(query);
  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  text = text.replace(/[+#%]|\d+(?:\.\d+)?/g, " ");
  const words = [];
  for (const [vi, en] of VI_WORDS) {
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
  const limit = AFFIX_LIMITS[item.rarity] ?? 0;
  if (!limit) return "Đồ thường không có mod. Đổi sang ma thuật hoặc hiếm.";
  if (item.mods.some((line) => line.kind === "pool" && line.family === mod.family)) return "Đã có mod cùng nhóm.";
  const count = item.mods.filter((line) => line.kind === "pool" && line.gen === mod.gen).length;
  if (count >= limit) return `Đã đủ ${limit} ${mod.gen === "prefix" ? "tiền tố" : "hậu tố"}.`;
  if (!mod.tiers.some((tier) => tier.ilvl <= (item.itemLevel ?? MAX_ITEM_LEVEL))) return `Cần cấp vật phẩm ${mod.tiers[0].ilvl}.`;
  return "";
}

/**
 * Pool mods for the add-mod box, matching the query, each with its best tier at
 * this item level, prefix/suffix, family and why it is blocked (still listed).
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
    const tier = tiers[0] ?? mod.tiers[mod.tiers.length - 1];
    const display = tier.lines.map((line) => fillRangeTemplate(line)).join(" / ");
    const haystack = normalizeText(`${display} ${mod.templates.join(" ")} ${mod.family} ${mod.tags.join(" ")} ${mod.gen}`);
    if (words.length && !words.every((word) => haystack.includes(word))) continue;
    const blocked = addModBlockedReason(mod, item);
    // The words in the mod text itself beat words found only in its tags or family.
    const direct = words.length && words.every((word) => normalizeText(display).includes(word)) ? 1 : 0;
    const useful = mod.tags.some((tag) => USEFUL_TAGS.includes(String(tag).toLowerCase())) ? 1 : 0;
    rows.push({ mod, tier, display, gen: mod.gen, family: mod.family, tierLabel: `T${tier.tier}`, blocked, useful, direct, recent: recentRank.has(mod.key) ? recentRank.get(mod.key) : Infinity, numbers });
  }
  rows.sort((a, b) => a.recent - b.recent
    || Number(Boolean(a.blocked)) - Number(Boolean(b.blocked))
    || b.direct - a.direct
    || b.useful - a.useful
    || (a.gen === b.gen ? 0 : a.gen === "prefix" ? -1 : 1)
    || a.display.localeCompare(b.display));
  return rows.slice(0, limit);
}

function fillRangeTemplate(line) {
  let index = 0;
  return line.template.replace(/#/g, () => {
    const [min, max] = line.ranges[index++] ?? [0, 0];
    return min === max ? formatNumber(min) : `(${formatNumber(min)}–${formatNumber(max)})`;
  });
}

/** Adds a suggested mod; numbers typed in the query fill its values (clamped to the tier). */
export function addSuggestedMod(item, suggestion) {
  if (suggestion.blocked) return item;
  const line = newPoolModLine(suggestion.mod, item, suggestion.numbers.length ? suggestion.numbers : undefined);
  return { ...item, mods: [...item.mods, line] };
}

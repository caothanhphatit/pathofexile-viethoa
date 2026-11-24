// Pilot comparison: misc items extracted from the game (extract-misc-items.mjs) against
// what the site shows today (poe2db crawl in public/data/currency-data.js and the
// non-equipment menus of public/data/items-data.js). Read-only on the site data.
//
//   node scripts/ggpk/compare-misc-items.mjs [--in=data/game-extract/ggpk/misc-items.json]
//                                            [--out=data/game-extract/ggpk/misc-items-compare.json]
//                                            [--md=<file>]   markdown tables for the pilot report
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT_DIR } from "./reader.mjs";

export const DEFAULT_IN = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "misc-items.json");
const DATA_DIR = path.join(ROOT_DIR, "public", "data");

/** items-data.js menus that hold non-equipment items. */
export const MISC_MENUS = [
  "stackable-currency", "essence", "catalysts", "liquid-emotions", "splinter", "incubators", "omen", "augment",
  "waystones", "tablet", "map-fragments", "pinnacle-keys", "vault-keys", "trial-coins", "inscribed-ultimatum", "relics"
];

const loadSiteFile = (file) => {
  const sandbox = {};
  new Function("window", fs.readFileSync(path.join(DATA_DIR, file), "utf8"))(sandbox);
  return Object.values(sandbox)[0];
};

/** Collapse whitespace and unify dashes so line breaks and "(1-2)" vs "(1—2)" do not count as differences. */
export const normalizeText = (text) => String(text ?? "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

/** "Stack Size: 1 / 20" -> 20, from a site row's properties. */
export const siteStackSize = (row) => {
  const line = [row.stack_size ? `Stack Size: ${row.stack_size}` : "", ...(row.properties || [])].find((p) => /Stack Size/i.test(p));
  const match = line && line.match(/\/\s*([\d,]+)/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
};

/** Art path of a poe2db icon URL, lower case, without extension. */
export const iconKey = (value) => String(value || "").replace(/^https?:\/\/[^/]+\/image\//i, "").replace(/\.(webp|png|dds)$/i, "").toLowerCase();

/** The text lines the game extract would put in the site's `mods` field. */
export const gameModLines = (record) => [record.description, ...record.effect_lines].filter(Boolean);

/**
 * Compare one site row with one game record. Returns { field: "same" | "differs" | "site-empty" | "game-empty" | "both-empty" }.
 * `mods` is compared as normalized text: the site joins multi-line text with spaces.
 */
export const compareRow = (row, record) => {
  const verdict = (siteValue, gameValue) => {
    const s = normalizeText(siteValue), g = normalizeText(gameValue);
    if (!s && !g) return "both-empty";
    if (!s) return "site-empty";
    if (!g) return "game-empty";
    return s === g ? "same" : "differs";
  };
  const out = {};
  const stack = siteStackSize(row);
  out.stack_size = verdict(stack ?? "", record.stack_size ?? "");
  if ("description_en" in row) out.description = verdict(row.description_en, record.description);
  const siteMods = (row.mods || []).map(normalizeText).filter(Boolean);
  const gameMods = gameModLines(record).map(normalizeText).filter(Boolean);
  if (!siteMods.length && !gameMods.length) out.mods = "both-empty";
  else if (!siteMods.length) out.mods = "site-empty";
  else if (!gameMods.length) out.mods = "game-empty";
  else {
    const gameText = gameMods.join(" ");
    const siteText = siteMods.join(" ");
    if (siteText === gameText) out.mods = "same";
    else if (siteMods.every((line) => gameText.includes(line))) out.mods = "game-has-more";
    else if (gameMods.every((line) => siteText.includes(line))) out.mods = "site-has-more";
    else out.mods = "differs";
  }
  out.icon = verdict(iconKey(row.icon_url), iconKey(record.icon_dds));
  const siteLevel = ((row.requirements || []).join(" ").match(/Level (\d+)/) || [])[1] || "";
  if (siteLevel || record.required_level) out.required_level = verdict(siteLevel, record.required_level || "");
  return out;
};

/** Why a site name has no released game record. `rejected` maps name -> rejected rows. */
export const explainSiteOnly = (row, rejected) => {
  const rows = rejected.get(row.name);
  if (rows?.length) {
    const scoped = rows.find((r) => r.reason !== "class-out-of-scope") || rows[0];
    return scoped.reason === "class-out-of-scope" ? `in game as another class (${scoped.item_class || "no class name"})` : `in game, filtered: ${scoped.reason}`;
  }
  if (String(row.rarity || "").toLowerCase() === "unique") return "unique item (not a base type)";
  if (/SkillIcons\/passives/i.test(row.icon_url || "") || (row.properties || []).some((p) => /^SubTree:|^Applies to Level|^Requires completing/i.test(p))) return "atlas passive node listed on the poe2db page";
  return "not a BaseItemTypes name";
};

export const compare = (game, rejectedItems, currencyRows, itemRows) => {
  const byName = new Map();
  for (const record of game.items) {
    if (!byName.has(record.name)) byName.set(record.name, []);
    byName.get(record.name).push(record);
  }
  const pick = (name) => {
    const list = byName.get(name);
    return list ? [...list].sort((a, b) => b.release_evidence.length - a.release_evidence.length)[0] : null;
  };
  const rejected = new Map();
  for (const item of rejectedItems) {
    if (!rejected.has(item.name)) rejected.set(item.name, []);
    rejected.get(item.name).push(item);
  }

  const sources = [
    ...[...new Set(currencyRows.map((r) => r.category))].map((category) => ({ source: "currency-data.js", group: category, rows: currencyRows.filter((r) => r.category === category) })),
    ...MISC_MENUS.map((menu) => ({ source: "items-data.js", group: menu, rows: itemRows.filter((r) => r.menu_key === menu) }))
  ];
  const groups = [];
  const siteNames = new Set();
  for (const { source, group, rows } of sources) {
    const result = { source, group, site_rows: rows.length, matched: 0, site_mod_lines: 0, site_mod_lines_in_game: 0, site_only: {}, site_only_names: {}, fields: {}, game_categories: {}, examples: {} };
    for (const row of rows) {
      siteNames.add(row.name);
      const record = pick(row.name);
      if (!record) {
        const why = explainSiteOnly(row, rejected);
        result.site_only[why] = (result.site_only[why] || 0) + 1;
        (result.site_only_names[why] ||= []).push(row.name);
        continue;
      }
      result.matched += 1;
      result.game_categories[record.category] = (result.game_categories[record.category] || 0) + 1;
      // Line level: how many of the site's mod lines the game text contains word for word.
      const gameText = gameModLines(record).map(normalizeText).join(" ");
      for (const line of (row.mods || []).map(normalizeText).filter(Boolean)) {
        result.site_mod_lines += 1;
        if (gameText.includes(line)) result.site_mod_lines_in_game += 1;
      }
      for (const [field, verdict] of Object.entries(compareRow(row, record))) {
        result.fields[field] ||= {};
        result.fields[field][verdict] = (result.fields[field][verdict] || 0) + 1;
        if (verdict !== "same" && verdict !== "both-empty") {
          const list = (result.examples[`${field}:${verdict}`] ||= []);
          if (list.length < 10) {
            list.push({
              name: row.name,
              site: field === "mods" ? row.mods : field === "icon" ? iconKey(row.icon_url) : field === "stack_size" ? siteStackSize(row) : field === "description" ? row.description_en : (row.requirements || []).join(" "),
              game: field === "mods" ? gameModLines(record) : field === "icon" ? iconKey(record.icon_dds) : field === "stack_size" ? record.stack_size : field === "description" ? record.description : record.required_level
            });
          }
        }
      }
    }
    groups.push(result);
  }

  const allSiteNames = new Set([...currencyRows, ...itemRows].map((r) => r.name));
  const gameOnly = {};
  const gameCategory = {};
  for (const record of game.items) {
    const c = (gameCategory[record.category] ||= { game_rows: 0, distinct_names: new Set(), on_site_misc: 0, on_site_elsewhere: 0, not_on_site: 0, with_description: 0, with_effect_lines: 0, with_flavour: 0, with_icon: 0, with_stack: 0 });
    c.game_rows += 1;
    c.distinct_names.add(record.name);
    if (siteNames.has(record.name)) c.on_site_misc += 1;
    else if (allSiteNames.has(record.name)) c.on_site_elsewhere += 1;
    else { c.not_on_site += 1; (gameOnly[record.category] ||= []).push(record.name); }
    if (record.description) c.with_description += 1;
    if (record.effect_lines.length) c.with_effect_lines += 1;
    if (record.flavour_text) c.with_flavour += 1;
    if (record.icon_dds) c.with_icon += 1;
    if (record.stack_size !== null) c.with_stack += 1;
  }
  for (const c of Object.values(gameCategory)) c.distinct_names = c.distinct_names.size;
  const relatedRows = currencyRows.filter((r) => (r.related_items || []).length);
  return {
    data_fingerprint: game.data_fingerprint,
    site: { currency_rows: currencyRows.length, item_rows: itemRows.length, misc_item_rows: itemRows.filter((r) => MISC_MENUS.includes(r.menu_key)).length, rows_with_related_items: relatedRows.length, related_items_sample: relatedRows.slice(0, 3).map((r) => ({ name: r.name, related_items: r.related_items })) },
    groups,
    game_categories: gameCategory,
    game_only: gameOnly
  };
};

const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/\n/g, " / ");
const fieldSummary = (counts = {}) => Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ") || "-";

/** Markdown tables for the pilot report. */
export const toMarkdown = (result) => {
  const lines = [];
  lines.push("### Site rows vs game (name match)", "", "| site file | site group | site rows | matched in game | site-only (reason: count) |", "|---|---|---:|---:|---|");
  for (const g of result.groups) lines.push(`| ${g.source} | ${g.group} | ${g.site_rows} | ${g.matched} | ${cell(fieldSummary(g.site_only))} |`);
  lines.push("", "### Game rows vs site (name match)", "", "| game category | game rows | distinct names | on site (misc menus) | on site (other menu) | not on site | has description | has effect lines | has flavour text | has icon path | has stack size |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [name, c] of Object.entries(result.game_categories)) lines.push(`| ${name} | ${c.game_rows} | ${c.distinct_names} | ${c.on_site_misc} | ${c.on_site_elsewhere} | ${c.not_on_site} | ${c.with_description} | ${c.with_effect_lines} | ${c.with_flavour} | ${c.with_icon} | ${c.with_stack} |`);
  lines.push("", "### Field agreement on matched rows", "", "| site group | stack size | description_en | mods (whole row) | site mod lines found word for word in the game text | icon path | required level |", "|---|---|---|---|---|---|---|");
  for (const g of result.groups) if (g.matched) lines.push(`| ${g.group} (${g.matched}) | ${fieldSummary(g.fields.stack_size)} | ${fieldSummary(g.fields.description)} | ${fieldSummary(g.fields.mods)} | ${g.site_mod_lines_in_game} of ${g.site_mod_lines} | ${fieldSummary(g.fields.icon)} | ${fieldSummary(g.fields.required_level)} |`);
  lines.push("", "### Site-only names", "");
  for (const g of result.groups) for (const [why, names] of Object.entries(g.site_only_names)) lines.push(`- **${g.group}** - ${why} (${names.length}): ${cell(names.slice(0, 40).join(", "))}${names.length > 40 ? ", ..." : ""}`);
  lines.push("", "### Game-only names (released by the rule, not on the site at all)", "");
  for (const [category, names] of Object.entries(result.game_only)) lines.push(`- **${category}** (${names.length}): ${cell(names.slice(0, 60).join(", "))}${names.length > 60 ? ", ..." : ""}`);
  lines.push("", "### Examples of differences (up to 10 per kind)", "");
  const seen = new Set();
  for (const g of result.groups) {
    for (const [kind, examples] of Object.entries(g.examples)) {
      lines.push(`#### ${g.group} - ${kind}`, "");
      for (const e of examples) {
        const key = `${kind}|${e.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(`- ${cell(e.name)}`, `  - site: ${cell(JSON.stringify(e.site))}`, `  - game: ${cell(JSON.stringify(e.game))}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
};

const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export const run = (args) => {
  const input = path.resolve(args.get("in") || DEFAULT_IN);
  const out = path.resolve(args.get("out") || input.replace(/\.json$/i, "-compare.json"));
  const game = JSON.parse(fs.readFileSync(input, "utf8"));
  const rejected = JSON.parse(fs.readFileSync(input.replace(/\.json$/i, "-rejected.json"), "utf8")).items;
  const result = compare(game, rejected, loadSiteFile("currency-data.js").items, loadSiteFile("items-data.js").items);
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  const markdown = toMarkdown(result);
  if (args.get("md")) fs.writeFileSync(path.resolve(args.get("md")), markdown);
  for (const g of result.groups) console.log(`${g.source} ${g.group}: ${g.site_rows} site rows, ${g.matched} matched; site-only ${fieldSummary(g.site_only)}; mods ${fieldSummary(g.fields.mods)}`);
  console.log(`\nWrote ${out}${args.get("md") ? ` and ${path.resolve(args.get("md"))}` : ""}`);
  return result;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) run(parseCliArgs());

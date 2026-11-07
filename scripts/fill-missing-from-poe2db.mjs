// Fill gems and uniques that exist in the game files but that poe2db leaves off its
// list pages, by reading each one's own poe2db detail page.
//
//   npm run check:game-data          # writes data/game-extract/check/latest.json
//   node scripts/fill-missing-from-poe2db.mjs [--report=<latest.json>] [--dry-run]
//
// Run it after the crawlers / exports (crawl:skill-gems, merge-support-gems-data,
// export:items), because those rewrite the data files from scratch. Added rows carry
// `source: "poe2db-detail"`. Gems poe2db marks [DNT-UNUSED], name placeholders such as
// "Companion: {0}", and dev entries (Playtest, Prototype, Removed Skill) are skipped.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

import { translateItemLine } from "./items/items-lib.mjs";
import { IGNORED_GEM_NAME } from "./check-game-data.mjs";
import { buildSlotCategoriesForItem } from "./items/runtime.mjs";
import {
  parseSkillGemDetailPage,
  translateSkillDetailLine,
  translateSkillName,
  translateSkillText,
  translateTags
} from "./skill-gems-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const GEMS_PATH = path.join(ROOT_DIR, "public", "data", "skill-gems-data.js");
const ITEMS_PATH = path.join(ROOT_DIR, "public", "data", "items-data.js");
const DEFAULT_REPORT = path.join(ROOT_DIR, "data", "game-extract", "check", "latest.json");
const BASE_URL = "https://poe2db.tw/us/";

export const SKIP_GEM_NAME = IGNORED_GEM_NAME;
export const UNUSED_MARKER = /\[DNT|UNUSED\]/i;

const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export const detailUrl = (name) => BASE_URL + encodeURIComponent(String(name).replace(/ /g, "_"));
export const slugFromName = (name) => String(name).replace(/ /g, "_").replace(/[^\p{L}\p{N}_'-]/gu, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchPage = async (url) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: "text/html", "user-agent": "poe2-vietnamese-detail-filler/1.0" } });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt === 3) throw new Error(`Failed to fetch ${url}: ${error.message}`);
      await sleep(1500 * (attempt + 1));
    }
  }
  return null;
};

const mapLimit = async (values, limit, worker) => {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
};

const i18nText = (value, translator) => ({ en: value, vi: value ? translator(value) || value : "" });
const i18nList = (values, translator) => values.map((value) => i18nText(value, translator));

const ogImage = ($) => $("meta[property=\"og:image\"]").attr("content") || "";

/** Build a skill-gems-data row from a gem's detail page, or null when it is not a usable gem. */
export const gemRecordFromDetail = (name, html, { now = new Date().toISOString(), gameId = "" } = {}) => {
  const detail = parseSkillGemDetailPage(html);
  if (UNUSED_MARKER.test(detail.summary_en || "")) return null;
  const $ = load(html);
  const tagLine = (detail.properties || []).find((line) => !line.includes(":")) || "";
  const tags = tagLine ? tagLine.split(",").map((tag) => tag.trim()).filter(Boolean) : [];
  const isSupport = /^Supports\b/i.test(detail.summary_en || "") || tags.some((tag) => /^(Support|Lineage)$/i.test(tag));
  const ownLink = $("a.gem_red, a.gem_green, a.gem_blue").filter((_, a) => $(a).text().trim() === name).first();
  const color = (ownLink.attr("class") || "").match(/\bgem_(red|green|blue)\b/)?.[1] || "item";
  const icon = ogImage($) || ownLink.find("img").attr("src") || "";
  const slug = slugFromName(name);
  const row = {
    slug,
    name,
    gem_type: isSupport ? "support" : "skill",
    tier: null,
    color,
    source_url: detailUrl(name),
    icon_url: icon,
    icon_alt: name,
    hover_url: ownLink.attr("data-hover") || "",
    // Build Planner export ids come from the game (BaseItemTypes.Id), falling back to the page.
    official_id: gameId || (html.match(/Metadata\/Items\/Gems?\/(?:SupportGem|SkillGem)[A-Za-z0-9_]+/) || [""])[0],
    tags,
    source: "poe2db-detail",
    status: "active",
    summary_en: detail.summary_en || "",
    properties: detail.properties || [],
    requirements: detail.requirements || [],
    mods: detail.mods || [],
    sections: detail.sections || [],
    i18n: {
      name: i18nText(name, translateSkillName),
      tags: i18nList(tags, (tag) => translateTags([tag])[0] || tag),
      summary: i18nText(detail.summary_en || "", translateSkillText),
      properties: i18nList(detail.properties || [], translateSkillDetailLine),
      requirements: i18nList(detail.requirements || [], translateSkillDetailLine),
      mods: i18nList(detail.mods || [], translateSkillDetailLine),
      sections: (detail.sections || []).map((section) => ({
        title: i18nText(section.title || "", translateSkillDetailLine),
        lines: i18nList(section.lines || [], translateSkillDetailLine)
      }))
    },
    source_hash: null,
    detail_hash: detail.source_hash || null,
    updated_at: now
  };
  return row;
};

const lineText = ($, node) => $(node).text().replace(/\s+/g, " ").replace(/\s+([,.:])/g, "$1").trim();

/** Build an items-data row from a unique's detail page popup, or null when the page has none. */
export const uniqueRecordFromDetail = (name, html, menus = [], { now = new Date().toISOString() } = {}) => {
  const $ = load(html);
  const popup = $(".newItemPopup.UniquePopup").filter((_, node) => $(node).find(".itemName").first().text().trim() === name).first();
  if (!popup.length) return null;
  const typeLine = popup.find(".itemName.typeLine").first().text().trim();
  const statLines = popup.find(".Stats > .property").map((_, node) => lineText($, node)).get().filter(Boolean);
  const itemClass = statLines.find((line) => !line.includes(":")) || "";
  const stats = statLines.filter((line) => line.includes(":"));
  const requirements = popup.find(".Stats > .requirements").map((_, node) => lineText($, node)).get().filter(Boolean);
  // poe2db also prints internal stat ids such as "local weapon implicit hidden % base damage is fire [50]".
  const internalMod = /^[a-z][a-z0-9_% ]*\[[-\d.]+\]$|\bhidden\b/;
  const mods = popup.find(".Stats > .implicitMod, .Stats > .explicitMod").map((_, node) => lineText($, node)).get()
    .filter((line) => line && !internalMod.test(line));
  const flavourNode = popup.find(".FlavourText").first().clone();
  flavourNode.find("br").replaceWith(" ");
  const flavour = flavourNode.text().replace(/\s+/g, " ").trim();
  // Class lines vary ("Body Armour", "Ezomyte Shields"); match a menu on the trailing class noun.
  const singular = (value) => String(value || "").toLowerCase().replace(/(ies)$/, "y").replace(/(ves)$/, "f").replace(/s$/, "");
  const classKey = singular(itemClass);
  const menu = menus.find((entry) => singular(entry.label) === classKey)
    || menus.find((entry) => classKey.endsWith(` ${singular(entry.label)}`))
    || null;
  // Some pages have no og:image; fall back to the first unique item art on the page.
  const icon = ogImage($) || $("img").map((_, img) => $(img).attr("src") || "").get().find((src) => /\/2DItems\/.*\/Uniques\//i.test(src)) || "";
  const properties = [typeLine, ...stats].filter(Boolean);
  const draft = { name, menu_key: menu?.key || "", icon_url: icon, properties, requirements, mods };
  const slots = buildSlotCategoriesForItem(draft);
  return {
    slug: slugFromName(name),
    menu_key: menu?.key || "",
    menu_label: menu?.label || itemClass,
    group_label: menu?.group_label || "",
    name,
    source_url: detailUrl(name),
    icon_url: icon,
    icon_alt: icon.split("/").pop()?.replace(/\.\w+$/, "") || name,
    rarity: "unique",
    item_category: slots[0] || "other",
    build_slot_categories: slots,
    properties,
    requirements,
    mods,
    flavour_text: flavour,
    source: "poe2db-detail",
    i18n: {
      name: { en: name, vi: name },
      properties: i18nList(properties, translateItemLine),
      requirements: i18nList(requirements, translateItemLine),
      mods: i18nList(mods, translateItemLine)
    },
    tooltip_refs: [],
    source_hash: null,
    status: "active",
    updated_at: now
  };
};

const readBundle = (filePath) => {
  const source = fs.readFileSync(filePath, "utf8");
  const sandbox = {};
  new Function("window", source)(sandbox);
  const [globalName] = Object.keys(sandbox);
  return { globalName, data: sandbox[globalName] };
};

const writeBundle = (filePath, globalName, data) => {
  fs.writeFileSync(filePath, `window.${globalName} = ${JSON.stringify(data, null, 2)};\n`, "utf8");
};

const lookupKey = (value) => String(value || "").replace(/\s+/g, " ").replace(/[’`]/g, "'").trim().toLowerCase();

/**
 * Set every gem's official_id (the id written into .build exports) to the game's own
 * BaseItemTypes id. Ids guessed from names are often wrong: the game mixes
 * Metadata/Items/Gem/ and Metadata/Items/Gems/, and some ids differ from the name
 * (Adhesive Grenades II is SupportGemAdhereTwo). Returns how many rows changed.
 */
export const applyGameGemIds = (gems, idsByName) => {
  let changed = 0;
  for (const gem of gems) {
    const ids = idsByName[lookupKey(gem.name)] || [];
    const kind = gem.gem_type === "support" ? /SupportGem/i : /SkillGem/i;
    const candidates = ids.filter((id) => kind.test(id));
    const pick = candidates.length === 1 ? candidates[0] : (ids.length === 1 ? ids[0] : "");
    if (!pick || gem.official_id === pick) continue;
    gem.official_id = pick;
    changed += 1;
  }
  return changed;
};

export const run = async (args) => {
  const reportPath = path.resolve(args.get("report") || DEFAULT_REPORT);
  if (!fs.existsSync(reportPath)) throw new Error(`No check report at ${reportPath}. Run: npm run check:game-data`);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const dryRun = args.get("dry-run") === "true";
  const now = new Date().toISOString();

  const gems = readBundle(GEMS_PATH);
  const items = readBundle(ITEMS_PATH);
  const gemSlugs = new Set(gems.data.gems.map((gem) => gem.slug));
  const itemSlugs = new Set(items.data.items.map((item) => item.slug));

  const gemNames = report.gems.missingInWeb.filter((name) => !SKIP_GEM_NAME.test(name));
  const uniqueNames = report.uniques.missingInWeb;
  const summary = { gems: { added: [], unused: [], notFound: [] }, uniques: { added: [], notFound: [] } };

  await mapLimit(gemNames, 4, async (name) => {
    const html = await fetchPage(detailUrl(name));
    if (!html) return summary.gems.notFound.push(name);
    const row = gemRecordFromDetail(name, html, { now, gameId: report.gems.gameIds?.[name] || "" });
    if (!row) return summary.gems.unused.push(name);
    if (gemSlugs.has(row.slug)) return null;
    gemSlugs.add(row.slug);
    gems.data.gems.push(row);
    return summary.gems.added.push(`${name} (${row.gem_type})`);
  });

  await mapLimit(uniqueNames, 4, async (name) => {
    const html = await fetchPage(detailUrl(name));
    const row = html ? uniqueRecordFromDetail(name, html, items.data.menus || [], { now }) : null;
    if (!row) return summary.uniques.notFound.push(name);
    if (itemSlugs.has(row.slug)) return null;
    itemSlugs.add(row.slug);
    items.data.items.push(row);
    return summary.uniques.added.push(`${name} (${row.menu_label || "?"})`);
  });

  summary.gems.idsCorrected = applyGameGemIds(gems.data.gems, report.gems.gameIdsByName || {});

  if (!dryRun) {
    const gemList = gems.data.gems;
    gemList.sort((a, b) =>
      (a.gem_type === b.gem_type ? 0 : a.gem_type === "skill" ? -1 : 1) ||
      (a.tier ?? 999) - (b.tier ?? 999) ||
      a.name.localeCompare(b.name));
    gems.data.total = gemList.length;
    gems.data.active_total = gemList.filter((gem) => gem.gem_type !== "support").length;
    gems.data.support_total = gemList.filter((gem) => gem.gem_type === "support").length;
    writeBundle(GEMS_PATH, gems.globalName, gems.data);

    items.data.total = items.data.items.length;
    items.data.active_total = items.data.items.filter((item) => (item.status || "active") === "active").length;
    writeBundle(ITEMS_PATH, items.globalName, items.data);
  }

  for (const key of ["added", "unused", "notFound"]) summary.gems[key].sort();
  for (const key of ["added", "notFound"]) summary.uniques[key].sort();
  console.log(JSON.stringify({ dryRun, ...summary }, null, 2));
  return summary;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run(parseCliArgs()).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

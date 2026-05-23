import crypto from "node:crypto";
import { load } from "cheerio";

const DEFAULT_ITEMS_SOURCE_URL = "https://poe2db.tw/us/Items";

const ITEM_ANCHOR_SELECTOR = [
  "a.whiteitem",
  "a.magicitem",
  "a.rareitem",
  "a.uniqueitem",
  "a.currencyitem",
  "a.gemitem",
  "a[class*='item']"
].join(", ");

export const normalizeItemText = (value = "") => String(value)
  .replace(/\u00a0/g, " ")
  .replace(/[ \t\r\n]+/g, " ")
  .replace(/\s+([,.;:!?])/g, "$1")
  .trim();

export const toAbsoluteUrl = (href = "", baseUrl = DEFAULT_ITEMS_SOURCE_URL) => {
  if (!href) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
};

export const slugFromHref = (href = "", baseUrl = DEFAULT_ITEMS_SOURCE_URL) => {
  if (!href) return "";
  try {
    const url = new URL(href, baseUrl);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    return decodeURIComponent(href.split(/[?#]/)[0].split("/").filter(Boolean).pop() || "");
  }
};

const pageLang = (sourcePageUrl = DEFAULT_ITEMS_SOURCE_URL) => {
  try {
    const [, lang] = new URL(sourcePageUrl).pathname.match(/^\/([a-z]{2})\//i) || [];
    return lang || "us";
  } catch {
    return "us";
  }
};

export const keywordHoverUrl = (dataHover = "", sourcePageUrl = DEFAULT_ITEMS_SOURCE_URL) => {
  const hover = String(dataHover || "").trim();
  if (!hover) return "";
  if (hover.startsWith("?")) {
    const url = new URL(sourcePageUrl);
    return `${url.origin}/${pageLang(sourcePageUrl)}/hover${hover}`;
  }
  if (/^https?:\/\//i.test(hover)) return hover;
  if (hover.startsWith("/cache1/") || hover.startsWith("/cache2/")) {
    return `https://cdn.poe2db.tw${hover}`;
  }
  return toAbsoluteUrl(hover, sourcePageUrl);
};

const kebabKey = (value = "") => normalizeItemText(value)
  .replace(/&/g, " and ")
  .replace(/['’]/g, "")
  .replace(/[^a-z0-9]+/gi, "-")
  .replace(/^-+|-+$/g, "")
  .toLowerCase();

const hashJson = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const nodeText = ($, node) => {
  const clone = $(node).clone();
  clone.find("script, style").remove();
  clone.find("br").replaceWith(" ");
  return normalizeItemText(clone.text());
};

const readLines = ($, scope, selector) => scope.find(selector)
  .map((_, node) => nodeText($, node))
  .get()
  .map(normalizeItemText)
  .filter(Boolean);

const uniqueBy = (values, keyFn) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const parseItemsMenu = (html, sourceUrl = DEFAULT_ITEMS_SOURCE_URL) => {
  const $ = load(html);
  const menus = [];
  let sortOrder = 0;

  $(".itemList").each((_, list) => {
    const scope = $(list);
    const groupLabel = normalizeItemText(scope.find("li span.disabled, li > span").first().text()) || "Items";
    scope.find("a[href]").each((__, anchor) => {
      const label = normalizeItemText($(anchor).text());
      const href = $(anchor).attr("href") || "";
      if (!label || !href || /^#|javascript:/i.test(href)) return;
      menus.push({
        key: kebabKey(label),
        label,
        group_label: groupLabel,
        source_url: toAbsoluteUrl(href, sourceUrl),
        sort_order: sortOrder++
      });
    });
  });

  const fallbackCards = $("#left .card, .card").filter((_, card) => !$(card).find(".itemList").length);
  fallbackCards.each((_, card) => {
    const scope = $(card);
    const groupLabel = normalizeItemText(scope.find(".card-header, h5, h4").first().text()) || "Items";
    scope.find("a.list-group-item[href], .list-group a[href]").each((__, anchor) => {
      const label = normalizeItemText($(anchor).text());
      const href = $(anchor).attr("href") || "";
      if (!label || !href || /^#|javascript:/i.test(href)) return;
      menus.push({
        key: kebabKey(label),
        label,
        group_label: groupLabel,
        source_url: toAbsoluteUrl(href, sourceUrl),
        sort_order: sortOrder++
      });
    });
  });

  return uniqueBy(menus, (menu) => menu.key);
};

const extractTooltipRefs = ($, scope, sourcePageUrl) => uniqueBy(
  scope.find(".KeywordPopups[data-keyword]").map((_, node) => {
    const link = $(node);
    const keyword = normalizeItemText(link.attr("data-keyword"));
    const label = normalizeItemText(link.text()) || keyword;
    const hover = link.attr("data-hover") || "";
    return {
      term: label || keyword,
      label: label || keyword,
      keyword,
      href: toAbsoluteUrl(link.attr("href") || "", sourcePageUrl),
      hover_url: keywordHoverUrl(hover, sourcePageUrl),
      source_url: sourcePageUrl
    };
  }).get().filter((ref) => ref.keyword && ref.label),
  (ref) => `${ref.keyword}|${ref.label}|${ref.hover_url}`
);

const findNameAnchor = ($, scope) => {
  const headerAnchor = scope.find("h5.card-header a[href], .card-header a[href]").filter((_, anchor) =>
    normalizeItemText($(anchor).clone().find("img").remove().end().text())
  ).first();
  if (headerAnchor.length) return headerAnchor;

  const namedItemAnchor = scope.find(ITEM_ANCHOR_SELECTOR).filter((_, anchor) =>
    normalizeItemText($(anchor).clone().find("img").remove().end().text())
  ).first();
  if (namedItemAnchor.length) return namedItemAnchor;

  return scope.find("a[href]").filter((_, anchor) =>
    normalizeItemText($(anchor).clone().find("img").remove().end().text())
  ).first();
};

const parseItemNode = ($, node, menu) => {
  const scope = $(node);
  const sourcePageUrl = menu.source_url || DEFAULT_ITEMS_SOURCE_URL;
  const nameAnchor = findNameAnchor($, scope);
  const rawName = normalizeItemText(
    nameAnchor.find(".uniqueName").first().text() ||
    nameAnchor.clone().find("img, .uniqueTypeLine").remove().end().text()
  );
  const href = nameAnchor.attr("href") || "";
  const sourceSlug = slugFromHref(href, sourcePageUrl);
  if (!rawName || !sourceSlug) return null;

  const icon = scope.find("img.item_icon[src], img.w1[src], img[src]").first();
  const iconAnchor = icon.closest("a[href]");
  const properties = readLines($, scope, ".property, .hybridProperty")
    .concat(nameAnchor.find(".uniqueTypeLine").first().text() ? [normalizeItemText(nameAnchor.find(".uniqueTypeLine").first().text())] : []);
  const requirements = readLines($, scope, ".requirements");
  const mods = readLines($, scope, ".implicitMod, .explicitMod, .enchantMod, .fracturedMod, .craftedMod, .utilityMod, .descrText, .secDescrText, .text-type0");
  const hasItemShape = icon.length || properties.length || requirements.length || mods.length || /\bitem\b/i.test(scope.attr("class") || "");
  if (!hasItemShape) return null;

  const slug = sourceSlug;
  const hover = nameAnchor.attr("data-hover") || iconAnchor.attr("data-hover") || "";
  const tooltipRefs = extractTooltipRefs($, scope, sourcePageUrl);
  const raw = {
    slug,
    menu_key: menu.key,
    menu_label: menu.label,
    group_label: menu.group_label,
    name: rawName,
    source_url: toAbsoluteUrl(href, sourcePageUrl),
    icon_url: toAbsoluteUrl(icon.attr("src") || "", sourcePageUrl),
    icon_alt: icon.attr("alt") || "",
    hover_url: keywordHoverUrl(hover, sourcePageUrl),
    requirements,
    properties,
    mods,
    tooltip_refs: tooltipRefs
  };

  return {
    ...raw,
    source_hash: hashJson(raw)
  };
};

export const parseItemListingPage = (html, menu) => {
  const $ = load(html);
  const candidates = [];

  $(".newItemPopup").each((_, node) => candidates.push(node));
  $(".row .col").each((_, node) => {
    const scope = $(node);
    if (scope.find(".newItemPopup").length) return;
    if (scope.find(ITEM_ANCHOR_SELECTOR).length || scope.find(".property, .requirements, .implicitMod, .explicitMod").length) {
      candidates.push(node);
    }
  });

  return uniqueBy(
    candidates
      .map((node) => parseItemNode($, node, menu))
      .filter(Boolean),
    (item) => item.source_url || item.slug
  );
};

const exactItemLines = new Map([
  [
    "Attack Skills gain 3 Life per Enemy Hit",
    "Attack Skill nhận 3 Life mỗi Enemy Hit."
  ]
]);

const withPeriod = (value = "") => {
  const clean = normalizeItemText(value);
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
};

export const translateItemLine = (line = "") => {
  const clean = normalizeItemText(line);
  if (!clean) return "";
  if (exactItemLines.has(clean)) return exactItemLines.get(clean);

  const translated = clean
    .replace(/^Requires:\s*/i, "Yêu cầu: ")
    .replace(/\bSkills gain\b/g, "Skill nhận")
    .replace(/\bgain\b/g, "nhận")
    .replace(/\bGrants Skill:\s*/i, "Cấp Skill: ")
    .replace(/\bper\b/g, "mỗi")
    .replace(/\bincreased\b/gi, "tăng")
    .replace(/\breduced\b/gi, "giảm")
    .replace(/\bto maximum\b/gi, "tối đa")
    .replace(/\bof maximum\b/gi, "tối đa")
    .replace(/\bLevel of all\b/gi, "Level của toàn bộ")
    .replace(/\s{2,}/g, " ");

  return withPeriod(translated);
};

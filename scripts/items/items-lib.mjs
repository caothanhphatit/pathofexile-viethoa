import crypto from "node:crypto";
import { load } from "cheerio";

import { translateCurrencyText } from "../currency-lib.mjs";

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
    "Attack Skill nhận 3 Life mỗi kẻ địch Hit."
  ]
]);

const withPeriod = (value = "") => {
  const clean = normalizeItemText(value);
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
};

const translateItemPhrase = (value = "") => normalizeItemText(value)
  .replace(/\bArmour, Evasion and Energy Shield\b/gi, "Armour, Evasion và Energy Shield")
  .replace(/\bArmour and Evasion\b/gi, "Armour và Evasion")
  .replace(/\bArmour and Energy Shield\b/gi, "Armour và Energy Shield")
  .replace(/\bEvasion and Energy Shield\b/gi, "Evasion và Energy Shield")
  .replace(/\bAttack and Cast Speed\b/gi, "Attack Speed và Cast Speed")
  .replace(/\bEquipment and Skill Gems\b/gi, "Equipment và Skill Gems")
  .replace(/\bRare and Magic Monsters\b/gi, "Rare và Magic Monsters")
  .replace(/\bPower and\/or Endurance Charges\b/gi, "Power và/hoặc Endurance Charges")
  .replace(/\bPower, Frenzy or Endurance Charges\b/gi, "Power, Frenzy hoặc Endurance Charges")
  .replace(/\bRare or Unique Enemies\b/gi, "kẻ địch Rare hoặc Unique")
  .replace(/\bRare and Unique Enemies\b/gi, "kẻ địch Rare và Unique")
  .replace(/\bHexproof Enemies\b/gi, "kẻ địch Hexproof")
  .replace(/\bEnemy Attacks\b/gi, "Attack của kẻ địch")
  .replace(/\bEnemy Hit\b/gi, "kẻ địch Hit")
  .replace(/\bEnemy Critically Hit\b/gi, "kẻ địch Critically Hit")
  .replace(/\benemy killed\b/gi, "kẻ địch bị giết")
  .replace(/\bDamage taken\b/gi, "Damage nhận vào")
  .replace(/\bdamage taken\b/gi, "Damage nhận vào")
  .replace(/\bthe Effect of\b/gi, "Effect của")
  .replace(/\bin your Presence\b/gi, "trong Presence của bạn")
  .replace(/\byour Presence\b/gi, "Presence của bạn")
  .replace(/\byour maximum\b/gi, "tối đa của bạn")
  .replace(/\bof your maximum\b/gi, "tối đa của bạn")
  .replace(/\bof maximum\b/gi, "tối đa")
  .replace(/\bMaximum\b/g, "Tối đa")
  .replace(/\bmaximum\b/g, "tối đa")
  .replace(/\byou inflict\b/gi, "bạn gây")
  .replace(/\byou have not been\b/gi, "bạn chưa bị")
  .replace(/\byou have been\b/gi, "bạn đã bị")
  .replace(/\byou haven't dealt\b/gi, "bạn chưa gây")
  .replace(/\byou've dealt\b/gi, "bạn đã gây")
  .replace(/\bon You\b/g, "lên bạn")
  .replace(/\bon you\b/gi, "lên bạn")
  .replace(/\bon Enemies\b/g, "lên kẻ địch")
  .replace(/\bon enemies\b/gi, "lên kẻ địch")
  .replace(/\bfrom Attack Hits\b/gi, "từ Attack Hits")
  .replace(/\bfrom Projectile Attacks\b/gi, "từ Projectile Attacks")
  .replace(/\bfrom Hits\b/gi, "từ Hits")
  .replace(/\bper enemy killed\b/gi, "mỗi kẻ địch bị giết")
  .replace(/\bper second\b/gi, "mỗi giây")
  .replace(/\beach second\b/gi, "mỗi giây")
  .replace(/\bevery ([^,.]+?) seconds\b/gi, "mỗi $1 giây")
  .replace(/\bin the past ([^,.]+?) seconds\b/gi, "trong $1 giây vừa qua")
  .replace(/\bwhile\b/gi, "khi")
  .replace(/\bwhen\b/gi, "khi")
  .replace(/\bif\b/gi, "nếu")
  .replace(/\buntil\b/gi, "cho đến khi")
  .replace(/\bequal to yours\b/gi, "bằng chỉ số của bạn")
  .replace(/\bequal to\b/gi, "bằng")
  .replace(/\binstead of\b/gi, "thay vì")
  .replace(/\binstead\b/gi, "thay vào đó")
  .replace(/\bwith\b/gi, "với")
  .replace(/\band\/or\b/gi, "và/hoặc")
  .replace(/\band\b/gi, "và")
  .replace(/\bor\b/gi, "hoặc")
  .replace(/\bEnemies\b/g, "Kẻ địch")
  .replace(/\benemies\b/g, "kẻ địch")
  .replace(/\bEnemy\b/g, "Kẻ địch")
  .replace(/\benemy\b/g, "kẻ địch")
  .replace(/\bAllies\b/g, "Allies")
  .replace(/\ballies\b/g, "Allies")
  .replace(/\byour\b/gi, "của bạn")
  .replace(/\bYou\b/g, "Bạn")
  .replace(/\byou\b/g, "bạn")
  .replace(/\s{2,}/g, " ")
  .trim();

const normalizeTranslatedItemLine = (value = "") => withPeriod(translateItemPhrase(value))
  .replace(/\s{2,}/g, " ")
  .trim();

const sameTextIgnoringPeriod = (left = "", right = "") =>
  normalizeItemText(left).replace(/[.!?]$/u, "").toLocaleLowerCase("en-US") ===
  normalizeItemText(right).replace(/[.!?]$/u, "").toLocaleLowerCase("en-US");

const translateItemTarget = (value = "") => normalizeItemText(value)
  .replace(/^(?:a|an)\s+/i, "");

const translateItemCondition = (value = "") => normalizeItemText(value)
  .replace(/^on /i, "")
  .replace(/^affected by (?:a|an) /i, "bị ảnh hưởng bởi ")
  .replace(/^affected by /i, "bị ảnh hưởng bởi ")
  .replace(/^moving$/i, "di chuyển")
  .replace(/^stationary$/i, "đứng yên");

const lowercaseFirst = (value = "") => value
  ? value.charAt(0).toLocaleLowerCase("vi-VN") + value.slice(1)
  : "";

const formatPrefixedTranslation = (value = "") => {
  const clean = normalizeItemText(value).replace(/[.!?]$/u, "");
  return /^(Thêm|Tăng|Giảm|Mất|Nhận|Sacrifice|Recover|Regenerate|Gây|Xóa|Được|Có thể|Để lại|Shock|Inflict)\b/u.test(clean)
    ? lowercaseFirst(clean)
    : clean;
};

export const translateItemLine = (line = "") => {
  const clean = normalizeItemText(line);
  if (!clean) return "";
  if (exactItemLines.has(clean)) return exactItemLines.get(clean);

  const patternTranslations = [
    [
      /^This item gains bonuses from Socketed (Items|Soul Cores) as though it was(?: also)? (?:a )?(.+)$/i,
      ([, source, target]) => `Item này nhận bonus từ Socketed ${source} như ${normalizeItemText(target)}.`
    ],
    [
      /^Modifies (.+?) unpredictably, with a chance to destroy it$/i,
      ([, target]) => `Biến đổi ${translateItemTarget(target)} theo kết quả khó đoán, có thể phá hủy mục tiêu.`
    ],
    [
      /^Modifies (.+?) unpredictably or destroys it$/i,
      ([, target]) => `Biến đổi ${translateItemTarget(target)} theo kết quả khó đoán hoặc phá hủy mục tiêu.`
    ],
    [
      /^Destroys an Equipment item, returning any Augments socketed in it$/i,
      () => "Phá hủy Equipment item và hoàn trả mọi Augment đang socket trong đó."
    ],
    [
      /^Helmets: A random Skill that requires Glory generates (.+?) of its maximum Glory when your Mark Activates$/i,
      ([, amount]) => `Helmets: một Skill ngẫu nhiên cần Glory tạo ${amount} Glory tối đa khi Mark của bạn Activate.`
    ],
    [
      /^When a Monster in your Maps is Possessed by a Sacred Spirit, it is also Possessed by another random Spirit$/i,
      () => "Khi một Monster trong Maps của bạn bị Possessed bởi Sacred Spirit, Monster đó cũng bị Possessed bởi một Spirit ngẫu nhiên khác."
    ],
    [
      /^(.+?) chance on Consuming a Shock on an Enemy to reapply it$/i,
      ([, chance]) => `${chance} chance khi Consume Shock trên kẻ địch để áp dụng lại Shock đó.`
    ],
    [
      /^While this item is active in your inventory the next Possessed monster you kill will release its Azmeri Spirit$/i,
      () => "Khi item này đang active trong inventory, Possessed monster tiếp theo bạn giết sẽ phóng thích Azmeri Spirit của monster đó."
    ],
    [
      /^While this item is active in your inventory your next Divine Orb used on a Rare item will Sanctify it$/i,
      () => "Khi item này đang active trong inventory, Divine Orb tiếp theo của bạn khi dùng lên Rare item sẽ Sanctify item đó."
    ],
    [
      /^While this item is active in your inventory your next (.+)$/i,
      () => translateCurrencyText(clean)
    ],
    [
      /^On Hitting an Enemy while a Life Flask is at full Charges, (.+?) of its Charges are consumed Gain (.+?) of damage as Physical damage for (.+?) seconds per Charge consumed this way$/i,
      ([, charges, damage, seconds]) => `Khi Hit kẻ địch trong lúc Life Flask đầy Charges, ${charges} Charges của flask bị tiêu hao. Nhận ${damage} Damage dưới dạng Physical Damage trong ${seconds} giây cho mỗi Charge tiêu hao theo cách này.`
    ],
    [
      /^This Flask cannot be Used but applies its Effect constantly$/i,
      () => "Flask này không thể Used nhưng áp dụng Effect liên tục."
    ],
    [
      /^When you kill a Rare monster, you gain its Modifiers for (.+?) seconds$/i,
      ([, seconds]) => `Khi bạn giết Rare monster, bạn nhận Modifiers của monster đó trong ${seconds} giây.`
    ],
    [
      /^You can only Socket (.+?) in this item$/i,
      ([, target]) => `Bạn chỉ có thể Socket ${normalizeItemText(target)} vào item này.`
    ],
    [
      /^This item is destroyed when applied to a Trial$/i,
      () => "Item này bị phá hủy khi áp dụng vào Trial."
    ],
    [
      /^([+()0-9—.%]+.*?) of their maximum Life as Extra maximum Energy Shield$/i,
      ([, amount]) => `${amount} Life tối đa của họ dưới dạng Extra maximum Energy Shield.`
    ],
    [
      /^Adds (.+?) to (.+?) (Physical|Fire|Cold|Lightning|Chaos) damage(?: to (.+?))?(?: per (.+))?$/i,
      ([, min, max, type, target, per]) => `Thêm ${min} đến ${max} ${type} Damage${target ? ` cho ${normalizeItemText(target)}` : ""}${per ? ` mỗi ${normalizeItemText(per)}` : ""}.`
    ],
    [
      /^(.+?) increased (Melee Strike Range|Projectile Speed) with this weapon$/i,
      ([, amount, stat]) => `Tăng ${amount} ${stat} với weapon này.`
    ],
    [
      /^Causes (.+?) increased Stun Buildup$/i,
      ([, amount]) => `Tăng ${amount} Stun Buildup.`
    ],
    [
      /^(.+?) reduced (Charm|Flask) Charges used$/i,
      ([, amount, kind]) => `Giảm ${amount} ${kind} Charges tiêu hao.`
    ],
    [
      /^(.+?) reduced Movement Speed Penalty from using Skills while moving$/i,
      ([, amount]) => `Giảm ${amount} Movement Speed Penalty khi dùng Skills trong lúc di chuyển.`
    ],
    [
      /^Bleeding you inflict deals Damage (.+?) faster$/i,
      ([, amount]) => `Bleeding bạn gây sẽ gây Damage nhanh hơn ${amount}.`
    ],
    [
      /^Gain (.+?) when Critically Hit by an Enemy$/i,
      ([, value]) => `Nhận ${normalizeItemText(value)} khi bị Enemy Critically Hit.`
    ],
    [
      /^Gain (.+?) when Hit by an Enemy$/i,
      ([, value]) => `Nhận ${normalizeItemText(value)} khi bị Enemy Hit.`
    ],
    [
      /^Regenerate (.+?) of maximum Life per second while (.+)$/i,
      ([, amount, condition]) => `Regenerate ${amount} Life tối đa mỗi giây khi ${translateItemCondition(condition)}.`
    ],
    [
      /^(.+?): Lose (.+?) of maximum Life per second while Sprinting, (.+?) increased Movement Speed while Sprinting$/i,
      ([, slot, life, speed]) => `${normalizeItemText(slot)}: mất ${life} Life tối đa mỗi giây khi Sprinting, tăng ${speed} Movement Speed khi Sprinting.`
    ],
    [
      /^Regenerate (.+?) of maximum Life over (.+?) second when Stunned$/i,
      ([, amount, seconds]) => `Regenerate ${amount} Life tối đa trong ${seconds} giây khi bị Stunned.`
    ],
    [
      /^(.+?) chance to be inflicted with (.+?) when Hit$/i,
      ([, chance, ailment]) => `${chance} chance bị ${normalizeItemText(ailment)} khi Hit.`
    ],
    [
      /^Lose all (.+?) when Hit$/i,
      ([, value]) => `Mất toàn bộ ${normalizeItemText(value)} khi bị Hit.`
    ],
    [
      /^Lose (.+?) Life when you use a Skill$/i,
      ([, amount]) => `Mất ${amount} Life khi bạn dùng Skill.`
    ],
    [
      /^You have (.+?) around you while (.+)$/i,
      ([, effect, condition]) => `Bạn có ${translateItemTarget(effect)} quanh mình khi ${translateItemCondition(condition)}.`
    ],
    [
      /^Shocks you when you reach maximum (.+)$/i,
      ([, value]) => `Shock bạn khi đạt ${normalizeItemText(value)} tối đa.`
    ],
    [
      /^Inflicts (.+?) on you when your (.+?) die, ignoring (.+?) limit$/i,
      ([, effect, subject, limit]) => `Inflict ${translateItemTarget(effect)} lên bạn khi ${normalizeItemText(subject)} của bạn chết, bỏ qua giới hạn ${normalizeItemText(limit)}.`
    ],
    [
      /^Damage of Enemies Hitting you is Unlucky while you are on (.+)$/i,
      ([, condition]) => `Damage của kẻ địch Hit bạn là Unlucky khi bạn ${translateItemCondition(condition)}.`
    ],
    [
      /^Damage over Time bypasses your Energy Shield While not on Full Life, Sacrifice (.+?) of maximum Mana per Second to Recover that much Life$/i,
      ([, amount]) => `Damage over Time bỏ qua Energy Shield của bạn. Khi không Full Life, Sacrifice ${amount} Mana tối đa mỗi giây để Recover lượng Life tương ứng.`
    ],
    [
      /^Moving while Bleeding doesn't cause you to take extra damage$/i,
      () => "Di chuyển khi Bleeding không khiến bạn nhận thêm Damage."
    ],
    [
      /^Life that would be lost by taking Damage is instead Reserved until you take no Damage to Life for (.+?) seconds$/i,
      ([, seconds]) => `Life lẽ ra mất do nhận Damage sẽ được Reserved cho đến khi bạn không nhận Damage vào Life trong ${seconds} giây.`
    ],
    [
      /^Aggravate Bleeding on Enemies when they Enter your Presence$/i,
      () => "Aggravate Bleeding trên kẻ địch khi chúng đi vào Presence của bạn."
    ],
    [
      /^Drop (Ignited|Shocked) Ground while moving, lasting (.+?) seconds$/i,
      ([, ground, seconds]) => `Để lại ${ground} Ground khi di chuyển, tồn tại ${seconds} giây.`
    ],
    [
      /^Drop (Ignited|Shocked) Ground while moving, which lasts (.+?) seconds and Ignites as though dealing (.+?) Damage equal to (.+?) of your maximum Life$/i,
      ([, ground, seconds, type, amount]) => `Để lại ${ground} Ground khi di chuyển, tồn tại ${seconds} giây và Ignite như thể gây ${type} Damage bằng ${amount} Life tối đa của bạn.`
    ],
    [
      /^(.+?) increased Reservation Efficiency of Skills which create (.+)$/i,
      ([, amount, subject]) => `Tăng ${amount} Reservation Efficiency của Skills tạo ${normalizeItemText(subject)}.`
    ],
    [
      /^Gain (.+?) to (.+?) increased (.+?) at random when Hit, until Hit again$/i,
      ([, min, max, stat]) => `Nhận ngẫu nhiên ${min} đến ${max} increased ${normalizeItemText(stat)} khi bị Hit, cho đến lần Hit tiếp theo.`
    ],
    [
      /^(.+?) increased Chance to be afflicted by (.+?) when Hit$/i,
      ([, amount, ailment]) => `Tăng ${amount} chance bị ${normalizeItemText(ailment)} khi Hit.`
    ],
    [
      /^Sacrifice (.+?) of Life to gain that much (.+?) when you Cast a Spell$/i,
      ([, amount, stat]) => `Sacrifice ${amount} Life để nhận lượng ${normalizeItemText(stat)} tương ứng khi bạn Cast Spell.`
    ],
    [
      /^Can be modified while Corrupted$/i,
      () => "Có thể được chỉnh sửa khi Corrupted."
    ],
    [
      /^Deal (.+?) increased Damage with Hits to (.+?) for each second they've ever been in your Presence, up to a maximum of (.+)$/i,
      ([, amount, target, cap]) => `Gây tăng ${amount} Damage với Hits lên ${normalizeItemText(target)} cho mỗi giây chúng từng ở trong Presence của bạn, tối đa ${cap}.`
    ],
    [
      /^Remove a (.+?) when you use a (.+?)$/i,
      ([, target, trigger]) => `Xóa ${normalizeItemText(target)} khi bạn dùng ${normalizeItemText(trigger)}.`
    ],
    [
      /^One of your Persistent Minions revives when an Offering expires$/i,
      () => "Một Persistent Minion của bạn revive khi Offering hết hạn."
    ],
    [
      /^Sacrifice (.+?) of maximum Life to gain that much Guard when you Dodge Roll$/i,
      ([, amount]) => `Sacrifice ${amount} Life tối đa để nhận lượng Guard tương ứng khi bạn Dodge Roll.`
    ],
    [
      /^Minions gain (.+?) of their Physical Damage as Extra Lightning Damage$/i,
      ([, amount]) => `Minions nhận ${amount} Physical Damage của chúng dưới dạng Extra Lightning Damage.`
    ],
    [
      /^Each Runic Inscription from your Curse Skills causes you to Regenerate Mana per second equal to (.+?) of that Skill's Mana Cost$/i,
      ([, amount]) => `Mỗi Runic Inscription từ Curse Skills của bạn khiến bạn Regenerate Mana mỗi giây bằng ${amount} Mana Cost của Skill đó.`
    ],
    [
      /^(.+?) of Armour also applies to Chaos Damage while on full Energy Shield$/i,
      ([, amount]) => `${amount} Armour cũng áp dụng cho Chaos Damage khi Full Energy Shield.`
    ],
    [
      /^Attacks with this Weapon have (.+?) chance to inflict (.+)$/i,
      ([, chance, ailment]) => `Attacks với Weapon này có ${chance} chance inflict ${normalizeItemText(ailment)}.`
    ],
    [
      /^(.+?) chance to Poison on Hit with this weapon$/i,
      ([, chance]) => `${chance} chance Poison on Hit với weapon này.`
    ],
    [
      /^Attacks with this Weapon Penetrate (.+?) Elemental Resistances$/i,
      ([, amount]) => `Attacks với Weapon này Penetrate ${amount} Elemental Resistances.`
    ],
    [
      /^(.+?) chance when you gain (?:an?|the) (.+? Charge) to gain an additional \2$/i,
      ([, chance, charge]) => `${chance} chance nhận thêm một ${charge} khi bạn nhận ${charge}.`
    ],
    [
      /^Lose (.+?) of maximum Life per second while Sprinting, (.+?) increased Movement Speed while Sprinting$/i,
      ([, life, speed]) => `Mất ${life} Life tối đa mỗi giây khi Sprinting, tăng ${speed} Movement Speed khi Sprinting.`
    ],
    [
      /^(.+?) chance to gain Onslaught on Killing Hits with this Weapon$/i,
      ([, chance]) => `${chance} chance nhận Onslaught khi Killing Hit với Weapon này.`
    ],
    [
      /^Attacks used by Totems have (.+?) increased Attack Speed per Summoned Totem$/i,
      ([, amount]) => `Attacks được Totems dùng có ${amount} increased Attack Speed cho mỗi Summoned Totem.`
    ],
    [
      /^Recover (.+?) of Maximum Mana when you collect a Remnant$/i,
      ([, amount]) => `Recover ${amount} Mana tối đa khi bạn nhặt Remnant.`
    ],
    [
      /^Gain (.+?) when your (.+?) begins$/i,
      ([, gain, trigger]) => `Nhận ${normalizeItemText(gain)} khi ${normalizeItemText(trigger)} của bạn bắt đầu.`
    ],
    [
      /^(.+?) chance to Gain (.+?) when you deal a Critical Hit$/i,
      ([, chance, gain]) => `${chance} chance nhận ${normalizeItemText(gain)} khi bạn gây Critical Hit.`
    ],
    [
      /^Enemies you Heavy Stun while Shapeshifted are Intimidated for (.+?) seconds$/i,
      ([, seconds]) => `Kẻ địch bạn Heavy Stun khi Shapeshifted bị Intimidated trong ${seconds} giây.`
    ],
    [
      /^Blind Enemies when they Stun you$/i,
      () => "Blind kẻ địch khi chúng Stun bạn."
    ],
    [
      /^(.+?) increased (.+?) when on (.+)$/i,
      ([, amount, stat, condition]) => `Tăng ${amount} ${normalizeItemText(stat)} khi ${translateItemCondition(condition)}.`
    ],
    [
      /^(.+?) increased (.+?) while (.+)$/i,
      ([, amount, stat, condition]) => `Tăng ${amount} ${normalizeItemText(stat)} khi ${translateItemCondition(condition)}.`
    ],
    [
      /^Adds (?:a|an) (.+?) to a Map (.+?) uses? remaining$/i,
      ([, mechanic, uses]) => `Thêm ${normalizeItemText(mechanic)} vào Map. Còn ${uses} lần dùng.`
    ],
    [
      /^Used when you take (.+?) damage from a Hit$/i,
      ([, type]) => `Được dùng khi bạn nhận ${normalizeItemText(type)} Damage từ Hit.`
    ],
    [
      /^Used when you become (.+)$/i,
      ([, state]) => `Được dùng khi bạn trở nên ${normalizeItemText(state)}.`
    ],
    [
      /^Used when you (.+)$/i,
      ([, condition]) => `Được dùng khi bạn ${normalizeItemText(condition)}.`
    ],
    [
      /^([(+\-\d][^:]*?) increased (.+)$/i,
      ([, amount, stat]) => `${amount} tăng ${translateItemPhrase(stat)}.`
    ],
    [
      /^([(+\-\d][^:]*?) reduced (.+)$/i,
      ([, amount, stat]) => `${amount} giảm ${translateItemPhrase(stat)}.`
    ],
    [
      /^([(+\-\d][^:]*?) less (.+)$/i,
      ([, amount, stat]) => `${amount} giảm ${translateItemPhrase(stat)}.`
    ],
    [
      /^Cannot be (.+)$/i,
      ([, state]) => `Không thể bị ${translateItemPhrase(state)}.`
    ],
    [
      /^Cannot have (.+)$/i,
      ([, value]) => `Không thể có ${translateItemPhrase(value)}.`
    ],
    [
      /^Cannot (.+)$/i,
      ([, action]) => `Không thể ${translateItemPhrase(action)}.`
    ],
    [
      /^Can't use (.+)$/i,
      ([, value]) => `Không thể dùng ${translateItemPhrase(value)}.`
    ],
    [
      /^You have no (.+)$/i,
      ([, value]) => `Bạn không có ${translateItemPhrase(value)}.`
    ],
    [
      /^You cannot be (.+?) for (.+?) seconds after being (.+)$/i,
      ([, state, seconds, trigger]) => `Bạn không thể bị ${translateItemPhrase(state)} trong ${seconds} giây sau khi bị ${translateItemPhrase(trigger)}.`
    ],
    [
      /^You cannot (.+)$/i,
      ([, action]) => `Bạn không thể ${translateItemPhrase(action)}.`
    ],
    [
      /^You can have (.+)$/i,
      ([, value]) => `Bạn có thể có ${translateItemPhrase(value)}.`
    ],
    [
      /^You can (.+)$/i,
      ([, action]) => `Bạn có thể ${translateItemPhrase(action)}.`
    ],
    [
      /^You count as on Full Mana while at (.+?) of maximum Mana or above$/i,
      ([, amount]) => `Bạn được tính là Full Mana khi đạt từ ${amount} Mana tối đa trở lên.`
    ],
    [
      /^(.+?) of (.+?) Physical Damage taken reflected to Attacker$/i,
      ([, amount, source]) => `${amount} ${translateItemPhrase(source)} Physical Damage nhận vào phản lại Attacker.`
    ],
    [
      /^(.+?) Damage taken reflected to Attacker$/i,
      ([, amount]) => `${translateItemPhrase(amount)} Damage nhận vào phản lại Attacker.`
    ],
    [
      /^Evasion Rating is doubled if you have not been Hit Recently$/i,
      () => "Evasion Rating được nhân đôi nếu bạn chưa bị Hit Recently."
    ],
    [
      /^(.+?) less Damage taken if you have not been Hit Recently$/i,
      ([, amount]) => `${amount} giảm Damage nhận vào nếu bạn chưa bị Hit Recently.`
    ],
    [
      /^(.+?) increased Evasion Rating if you have been Hit Recently$/i,
      ([, amount]) => `${amount} tăng Evasion Rating nếu bạn đã bị Hit Recently.`
    ],
    [
      /^Minions gain (.+?) of their maximum Life as Extra maximum Energy Shield$/i,
      ([, amount]) => `Minions nhận ${amount} Life tối đa của chúng dưới dạng Extra maximum Energy Shield.`
    ],
    [
      /^Dodge Roll passes through Enemies$/i,
      () => "Dodge Roll đi xuyên qua kẻ địch."
    ],
    [
      /^Inflict (.+?) Exposure on (Igniting|Shocking|Chilling|Freezing) an Enemy$/i,
      ([, exposure, trigger]) => `Inflict ${translateItemPhrase(exposure)} Exposure khi ${translateItemPhrase(trigger)} kẻ địch.`
    ],
    [
      /^(Fire|Cold|Lightning|Chaos|Physical|All) Damage from Hits Contributes to (.+?)(?: instead of (.+))?$/i,
      ([, type, target, instead]) => `${translateItemPhrase(type)} Damage từ Hits đóng góp vào ${translateItemPhrase(target)}${instead ? ` thay vì ${translateItemPhrase(instead)}` : ""}.`
    ],
    [
      /^Targets can be affected by \+(.+?) of your Poisons at the same time$/i,
      ([, amount]) => `Mục tiêu có thể chịu thêm +${amount} Poison của bạn cùng lúc.`
    ],
    [
      /^Enemies in your Presence killed by anyone count as being killed by you instead$/i,
      () => "Kẻ địch trong Presence của bạn dù bị ai giết cũng được tính là do bạn giết."
    ],
    [
      /^Leeching Life from your Hits causes Allies in your Presence to also Leech the same amount of Life$/i,
      () => "Life Leech từ Hit của bạn cũng khiến Allies trong Presence của bạn Leech cùng lượng Life đó."
    ],
    [
      /^Attacks cost an additional (.+?) of your maximum Mana$/i,
      ([, amount]) => `Attacks tốn thêm ${amount} Mana tối đa của bạn.`
    ],
    [
      /^Every second, inflicts (.+?) on enemies in your Presence for (.+?) seconds$/i,
      ([, effect, seconds]) => `Mỗi giây, inflict ${translateItemPhrase(effect)} lên kẻ địch trong Presence của bạn trong ${seconds} giây.`
    ],
    [
      /^Every (.+?) seconds, Consume a nearby Corpse to Recover (.+?) of maximum Life$/i,
      ([, seconds, amount]) => `Mỗi ${seconds} giây, Consume một Corpse gần đó để hồi ${amount} Life tối đa.`
    ],
    [
      /^Aggravate Bleeding on targets you Critically Hit with Attacks$/i,
      () => "Aggravate Bleeding lên mục tiêu bạn Critically Hit bằng Attacks."
    ],
    [
      /^Leeches (.+?) of (.+?) Damage as (Life|Mana)$/i,
      ([, amount, type, resource]) => `Leech ${amount} ${translateItemPhrase(type)} Damage dưới dạng ${resource}.`
    ],
    [
      /^(.+?) of (.+?) Damage as (Life|Mana)$/i,
      ([, amount, type, resource]) => `${amount} ${translateItemPhrase(type)} Damage dưới dạng ${resource}.`
    ],
    [
      /^Bleeding you inflict is Aggravated$/i,
      () => "Bleeding bạn gây được Aggravate."
    ],
    [
      /^(.+?) you inflict (?:has|have) infinite Duration$/i,
      ([, effect]) => `${translateItemPhrase(effect)} bạn gây có Duration vô hạn.`
    ],
    [
      /^(.+?) you inflict can affect (.+)$/i,
      ([, effect, target]) => `${translateItemPhrase(effect)} bạn gây có thể ảnh hưởng ${translateItemPhrase(target)}.`
    ],
    [
      /^Curses you inflict are reflected back to you$/i,
      () => "Curses bạn gây bị phản lại lên bạn."
    ],
    [
      /^(.+?) in your Presence (?:are|is) (.+)$/i,
      ([, subject, state]) => `${translateItemPhrase(subject)} trong Presence của bạn bị ${translateItemPhrase(state)}.`
    ],
    [
      /^(.+?) in your Presence have no (.+)$/i,
      ([, subject, value]) => `${translateItemPhrase(subject)} trong Presence của bạn không có ${translateItemPhrase(value)}.`
    ],
    [
      /^(.+?) in your Presence have (.+)$/i,
      ([, subject, value]) => `${translateItemPhrase(subject)} trong Presence của bạn có ${translateItemPhrase(value)}.`
    ],
    [
      /^(.+?) in your Presence deal (.+)$/i,
      ([, subject, value]) => `${translateItemPhrase(subject)} trong Presence của bạn gây ${translateItemPhrase(value)}.`
    ],
    [
      /^(.+?) in your Presence Regenerate (.+)$/i,
      ([, subject, value]) => `${translateItemPhrase(subject)} trong Presence của bạn Regenerate ${translateItemPhrase(value)}.`
    ],
    [
      /^Gain no inherent bonus from (.+)$/i,
      ([, attribute]) => `Không nhận bonus mặc định từ ${translateItemPhrase(attribute)}.`
    ],
    [
      /^Gain (.+?) of (.+?) Damage as Extra (.+?) Damage$/i,
      ([, amount, source, target]) => `Nhận ${amount} ${translateItemPhrase(source)} Damage dưới dạng Extra ${translateItemPhrase(target)} Damage.`
    ],
    [
      /^Gain (.+?) of Damage as Extra (.+?) Damage$/i,
      ([, amount, target]) => `Nhận ${amount} Damage dưới dạng Extra ${translateItemPhrase(target)} Damage.`
    ],
    [
      /^Gain (.+?) as (.+)$/i,
      ([, amount, target]) => `Nhận ${translateItemPhrase(amount)} dưới dạng ${translateItemPhrase(target)}.`
    ],
    [
      /^Gain (.+?) equal to (.+)$/i,
      ([, gain, source]) => `Nhận ${translateItemPhrase(gain)} bằng ${translateItemPhrase(source)}.`
    ],
    [
      /^Gain (.+?) per (.+)$/i,
      ([, gain, rate]) => `Nhận ${translateItemPhrase(gain)} mỗi ${translateItemPhrase(rate)}.`
    ],
    [
      /^Gain (.+?) on (.+)$/i,
      ([, gain, trigger]) => `Nhận ${translateItemPhrase(gain)} khi ${translateItemPhrase(trigger)}.`
    ],
    [
      /^Gain (.+?)$/i,
      ([, gain]) => `Nhận ${translateItemPhrase(gain)}.`
    ],
    [
      /^Grants Skill: (.+)$/i,
      ([, skill]) => `Cấp Skill: ${normalizeItemText(skill)}.`
    ],
    [
      /^Has (\d+) Augment Sockets? \(Hidden\)$/i,
      ([, amount]) => `Có ${amount} Augment Sockets (ẩn).`
    ],
    [
      /^Has (\d+) Jewel Sockets?$/i,
      ([, amount]) => `Có ${amount} Jewel Sockets.`
    ],
    [
      /^Has no (.+)$/i,
      ([, value]) => `Không có ${translateItemPhrase(value)}.`
    ],
    [
      /^(.+?) of (.+?) Damage from Hits taken as (.+?) Damage$/i,
      ([, amount, source, target]) => `${amount} ${translateItemPhrase(source)} Damage từ Hits nhận vào dưới dạng ${translateItemPhrase(target)} Damage.`
    ],
    [
      /^(.+?) of (.+?) damage from Hits taken as (.+?) damage$/i,
      ([, amount, source, target]) => `${amount} ${translateItemPhrase(source)} Damage từ Hits nhận vào dưới dạng ${translateItemPhrase(target)} Damage.`
    ],
    [
      /^(.+?) of (.+?) Damage taken as (.+?) Damage$/i,
      ([, amount, source, target]) => `${amount} ${translateItemPhrase(source)} Damage nhận vào dưới dạng ${translateItemPhrase(target)} Damage.`
    ],
    [
      /^(.+?) of Damage is taken from Mana before Life$/i,
      ([, amount]) => `${amount} Damage được trừ từ Mana trước Life.`
    ],
    [
      /^(.+?) Damage taken from (.+)$/i,
      ([, amount, source]) => `${translateItemPhrase(amount)} Damage nhận từ ${translateItemPhrase(source)}.`
    ],
    [
      /^(.+?) of Damage taken Recouped as (Life|Mana)$/i,
      ([, amount, resource]) => `Recoup ${amount} Damage nhận vào dưới dạng ${resource}.`
    ],
    [
      /^Damage taken Recouped as Life is also Recouped as Energy Shield$/i,
      () => "Damage nhận vào được Recoup dưới dạng Life cũng được Recoup dưới dạng Energy Shield."
    ],
    [
      /^(.+?) of (.+?) Damage prevented Recouped as Life$/i,
      ([, amount, type]) => `Recoup ${amount} ${translateItemPhrase(type)} Damage đã ngăn chặn dưới dạng Life.`
    ],
    [
      /^(.+?) of (.+?) Damage Leeched as Life$/i,
      ([, amount, type]) => `${amount} ${translateItemPhrase(type)} Damage được Leech dưới dạng Life.`
    ],
    [
      /^(.+?) of Damage taken bypasses Energy Shield$/i,
      ([, amount]) => `${amount} Damage nhận vào bỏ qua Energy Shield.`
    ],
    [
      /^(.+?) chance to Avoid (.+?) Damage from Hits$/i,
      ([, chance, type]) => `${chance} chance Avoid ${translateItemPhrase(type)} Damage từ Hits.`
    ],
    [
      /^(.+?) chance to Avoid Death from Hits$/i,
      ([, chance]) => `${chance} chance Avoid Death từ Hits.`
    ],
    [
      /^Take no Extra Damage from Critical Hits$/i,
      () => "Không nhận Extra Damage từ Critical Hits."
    ],
    [
      /^Take (.+?) of (.+?) as (.+?) Damage$/i,
      ([, amount, source, target]) => `Nhận ${amount} ${translateItemPhrase(source)} dưới dạng ${translateItemPhrase(target)} Damage.`
    ],
    [
      /^(.+?) is doubled$/i,
      ([, subject]) => `${translateItemPhrase(subject)} được nhân đôi.`
    ],
    [
      /^(.+?) is reversed$/i,
      ([, subject]) => `${translateItemPhrase(subject)} bị đảo ngược.`
    ],
    [
      /^(.+?) is zero$/i,
      ([, subject]) => `${translateItemPhrase(subject)} bằng 0.`
    ],
    [
      /^(.+?) is instant$/i,
      ([, subject]) => `${translateItemPhrase(subject)} diễn ra tức thì.`
    ],
    [
      /^(.+?) is Converted to (.+)$/i,
      ([, source, target]) => `${translateItemPhrase(source)} được Convert thành ${translateItemPhrase(target)}.`
    ],
    [
      /^(.+?) is Pinning$/i,
      ([, source]) => `${translateItemPhrase(source)} gây Pinning.`
    ],
    [
      /^(.+?) does not affect (.+)$/i,
      ([, source, target]) => `${translateItemPhrase(source)} không ảnh hưởng đến ${translateItemPhrase(target)}.`
    ],
    [
      /^(.+?) also grants (.+)$/i,
      ([, source, value]) => `${translateItemPhrase(source)} cũng cấp ${translateItemPhrase(value)}.`
    ],
    [
      /^Every (.+?) also grants (.+)$/i,
      ([, source, value]) => `Mỗi ${translateItemPhrase(source)} cũng cấp ${translateItemPhrase(value)}.`
    ],
    [
      /^Increases and Reductions to (.+?) also apply to (.+)$/i,
      ([, source, target]) => `Tăng/Giảm ${translateItemPhrase(source)} cũng áp dụng cho ${translateItemPhrase(target)}.`
    ],
    [
      /^(.+?) can (.+)$/i,
      ([, subject, action]) => `${translateItemPhrase(subject)} có thể ${translateItemPhrase(action)}.`
    ],
    [
      /^(.+?) cannot (.+)$/i,
      ([, subject, action]) => `${translateItemPhrase(subject)} không thể ${translateItemPhrase(action)}.`
    ],
    [
      /^(.+?) have no (.+)$/i,
      ([, subject, value]) => `${translateItemPhrase(subject)} không có ${translateItemPhrase(value)}.`
    ],
    [
      /^(.+?) have (.+)$/i,
      ([, subject, value]) => `${translateItemPhrase(subject)} có ${translateItemPhrase(value)}.`
    ],
    [
      /^(.+?) deal (.+)$/i,
      ([, subject, value]) => `${translateItemPhrase(subject)} gây ${translateItemPhrase(value)}.`
    ],
    [
      /^Deal (.+?) to enemies within (.+?) of the enemy killed$/i,
      ([, damage, range]) => `Gây ${translateItemPhrase(damage)} lên kẻ địch trong phạm vi ${translateItemPhrase(range)} quanh kẻ địch bị giết.`
    ],
    [
      /^Warcries Explode Corpses dealing (.+?) of their Life as (.+?) Damage$/i,
      ([, amount, type]) => `Warcries Explode Corpses, gây ${amount} Life của Corpse dưới dạng ${translateItemPhrase(type)} Damage.`
    ],
    [
      /^Skills have (.+?) seconds to Cooldown$/i,
      ([, seconds]) => `Skills có ${seconds} giây Cooldown.`
    ],
    [
      /^Base Critical Hit Chance for Attacks with Weapons is (.+)$/i,
      ([, chance]) => `Base Critical Hit Chance cho Attacks bằng Weapons là ${chance}.`
    ],
    [
      /^Your base (.+?) is (.+)$/i,
      ([, stat, value]) => `${translateItemPhrase(stat)} cơ bản của bạn là ${translateItemPhrase(value)}.`
    ],
    [
      /^(.+?) are (.+)$/i,
      ([, subject, state]) => `${translateItemPhrase(subject)} là ${translateItemPhrase(state)}.`
    ],
    [
      /^(.+?) is (.+)$/i,
      ([, subject, state]) => `${translateItemPhrase(subject)} là ${translateItemPhrase(state)}.`
    ]
  ];

  for (const [pattern, formatter] of patternTranslations) {
    const match = clean.match(pattern);
    if (match) return normalizeTranslatedItemLine(formatter(match));
  }

  const prefixedLine = clean.match(/^([^:]{2,48}):\s+(.+)$/);
  if (prefixedLine && !/^Requires$/i.test(prefixedLine[1])) {
    const [, prefix, rest] = prefixedLine;
    const translatedRest = translateItemLine(rest);
    if (translatedRest && !sameTextIgnoringPeriod(translatedRest, rest)) {
      return `${translateItemPhrase(prefix)}: ${formatPrefixedTranslation(translatedRest)}.`;
    }
  }

  const currencyTranslation = translateCurrencyText(clean);
  if (currencyTranslation && !sameTextIgnoringPeriod(currencyTranslation, clean)) return currencyTranslation;

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

import crypto from "node:crypto";
import { load } from "cheerio";

export const DEFAULT_CURRENCY_SOURCE_URL = "https://poe2db.tw/us/Stackable_Currency";

const CATEGORY_LABELS = {
  StackableCurrencyItem: "Currency",
  Essence: "Essence",
  SplinterItem: "Splinter",
  CatalystItem: "Catalyst"
};

const CATEGORY_ORDER = ["StackableCurrencyItem", "Essence", "SplinterItem", "CatalystItem"];

const FAMILY_LABELS = {
  "crafting-orb": "Crafting Orb",
  "quality-currency": "Quality Currency",
  "gem-currency": "Gem Currency",
  "socket-currency": "Socket Currency",
  "corruption-currency": "Corruption Currency",
  "delirium-liquid": "Delirium Liquid",
  "desecration-currency": "Desecration Currency",
  "expedition-artifact": "Expedition Artifact",
  shard: "Shard",
  "utility-currency": "Utility Currency",
  essence: "Essence",
  splinter: "Splinter",
  catalyst: "Catalyst",
  omen: "Omen"
};

const FAMILY_ORDER = [
  "crafting-orb",
  "omen",
  "quality-currency",
  "gem-currency",
  "socket-currency",
  "corruption-currency",
  "delirium-liquid",
  "desecration-currency",
  "expedition-artifact",
  "shard",
  "utility-currency",
  "essence",
  "splinter",
  "catalyst"
];

const subtypeAliases = (item = {}) => {
  if (item.subtype && item.subtype_label) {
    return {
      subtype: item.subtype,
      subtype_label: item.subtype_label,
      family: item.family || item.subtype,
      family_label: item.family_label || item.subtype_label
    };
  }
  if (item.family && item.family_label) {
    return {
      subtype: item.family,
      subtype_label: item.family_label,
      family: item.family,
      family_label: item.family_label
    };
  }
  const subtype = classifyCurrencySubtype(item);
  return {
    ...subtype,
    family: subtype.subtype,
    family_label: subtype.subtype_label
  };
};

const normalizeText = (value = "") => String(value)
  .replace(/\u00a0/g, " ")
  .replace(/[ \t\r\n]+/g, " ")
  .replace(/\s+([,.;:!?])/g, "$1")
  .trim();

const nowIso = () => new Date().toISOString();

const toAbsoluteUrl = (href = "", baseUrl = DEFAULT_CURRENCY_SOURCE_URL) => {
  if (!href) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
};

const slugFromHref = (href = "", baseUrl = DEFAULT_CURRENCY_SOURCE_URL) => {
  if (!href) return "";
  try {
    const url = new URL(href, baseUrl);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    return decodeURIComponent(href.split(/[?#]/)[0].split("/").filter(Boolean).pop() || "");
  }
};

const hashJson = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const sourceForHash = (item) => ({
  slug: item.slug,
  name: item.name,
  category: item.category,
  category_label: item.category_label,
  family: item.family,
  family_label: item.family_label,
  source_url: item.source_url,
  icon_url: item.icon_url,
  icon_alt: item.icon_alt,
  hover_url: item.hover_url,
  stack_size: item.stack_size,
  description_en: item.description_en,
  properties: item.properties,
  mods: item.mods,
  related_items: item.related_items || []
});

const normalizeSource = (item) => {
  const aliases = subtypeAliases(item);
  const normalized = sourceForHash({ ...item, ...aliases });
  normalized.source_hash = item.source_hash || hashJson(normalized);
  return normalized;
};

const stripArticle = (value = "") => normalizeText(value).replace(/^(?:a|an|the)\s+/i, "");

const translateTarget = (value = "") => stripArticle(value)
  .replace(/\bor\b/gi, "hoặc")
  .replace(/\band\b/gi, "và")
  .replace(/\bmartial weapon\b/gi, "Martial Weapon")
  .replace(/\bcaster weapon\b/gi, "Caster Weapon")
  .replace(/\barmour\b/gi, "Armour")
  .replace(/\bflask\b/gi, "Flask")
  .replace(/\bwand\b/gi, "Wand")
  .replace(/\bstaff\b/gi, "Staff")
  .replace(/\bsceptre\b/gi, "Sceptre")
  .replace(/\bamulet\b/gi, "Amulet")
  .replace(/\bring\b/gi, "Ring")
  .replace(/\bbelt\b/gi, "Belt")
  .replace(/\bquiver\b/gi, "Quiver")
  .replace(/\bjewel\b/gi, "Jewel")
  .replace(/\bwaystone\b/gi, "Waystone")
  .replace(/\bequipment\b/gi, "Equipment")
  .replace(/\bitem\b/gi, "item");

const withPeriod = (value) => {
  const clean = normalizeText(value);
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
};

const translateFragment = (value = "") => normalizeText(value)
  .replace(/\bmodifiers\b/gi, "modifier")
  .replace(/\bmodifier\b/gi, "modifier")
  .replace(/\bvalues\b/gi, "giá trị")
  .replace(/\bquality\b/gi, "quality")
  .replace(/\bnormal item\b/gi, "Normal item")
  .replace(/\bmagic item\b/gi, "Magic item")
  .replace(/\brare item\b/gi, "Rare item")
  .replace(/\bunique item\b/gi, "Unique item")
  .replace(/\bnormal\b/gi, "Normal")
  .replace(/\bmagic\b/gi, "Magic")
  .replace(/\brare\b/gi, "Rare")
  .replace(/\bunique\b/gi, "Unique");

const translateStatName = (value = "") => normalizeText(value)
  .replace(/\bor\b/gi, "hoặc")
  .replace(/\band\b/gi, "và")
  .replace(/\bitems\b/gi, "item");

const translatePrefixedStatLine = (line = "") => {
  const match = normalizeText(line).match(/^(.+?):\s*(.+)$/);
  if (!match) return "";

  const [, rawTarget, rawEffect] = match;
  const target = translateTarget(rawTarget);
  const effect = normalizeText(rawEffect);
  let statMatch;

  statMatch = effect.match(/^Adds (.+?) to (.+?) (Physical|Fire|Cold|Lightning|Chaos) Damage$/i);
  if (statMatch) {
    return `${target}: thêm ${statMatch[1]} đến ${statMatch[2]} ${statMatch[3]} Damage.`;
  }

  statMatch = effect.match(/^Gain (.+?) of Damage as Extra (Physical|Fire|Cold|Lightning|Chaos) Damage$/i);
  if (statMatch) {
    return `${target}: nhận ${statMatch[1]} Damage dưới dạng Extra ${statMatch[2]} Damage.`;
  }

  statMatch = effect.match(/^Allies in your Presence deal (.+?) increased Damage$/i);
  if (statMatch) return `${target}: Allies trong Presence của bạn gây ${statMatch[1]} increased Damage.`;

  statMatch = effect.match(/^Aura Skills have (.+?) increased Magnitudes$/i);
  if (statMatch) return `${target}: Aura Skills có ${statMatch[1]} increased Magnitudes.`;

  statMatch = effect.match(/^Aura Skills have (.+?) Magnitudes$/i);
  if (statMatch) return `${target}: Aura Skills có ${statMatch[1]} Magnitudes.`;

  statMatch = effect.match(/^Hits against you have (.+?) reduced Critical Damage Bonus$/i);
  if (statMatch) return `${target}: Hit lên bạn có ${statMatch[1]} reduced Critical Damage Bonus.`;

  statMatch = effect.match(/^Recoup (.+?) (Physical|Fire|Cold|Lightning|Chaos) Damage taken as Life$/i);
  if (statMatch) return `${target}: Recoup ${statMatch[1]} ${statMatch[2]} Damage nhận vào dưới dạng Life.`;

  statMatch = effect.match(/^Recoup (.+?) Damage taken as Life$/i);
  if (statMatch) return `${target}: Recoup ${statMatch[1]} Damage nhận vào dưới dạng Life.`;

  statMatch = effect.match(/^(.+?) increased Rarity of Items found$/i);
  if (statMatch) return `${target}: tăng ${statMatch[1]} Rarity của item rơi.`;

  statMatch = effect.match(/^(.+?) increased Quantity of Gold Dropped by Slain Enemies$/i);
  if (statMatch) return `${target}: tăng ${statMatch[1]} lượng Gold rơi từ kẻ địch bị hạ.`;

  statMatch = effect.match(/^(.+?) increased (.+)$/i);
  if (statMatch) return `${target}: tăng ${statMatch[1]} ${translateStatName(statMatch[2])}.`;

  statMatch = effect.match(/^(.+?) reduced (.+)$/i);
  if (statMatch) return `${target}: giảm ${statMatch[1]} ${translateStatName(statMatch[2])}.`;

  statMatch = effect.match(/^(.+?) of (.+?) Damage taken Recouped as Life$/i);
  if (statMatch) return `${target}: Recoup ${statMatch[1]} ${statMatch[2]} Damage nhận vào dưới dạng Life.`;

  statMatch = effect.match(/^(.+?) of Damage taken Recouped as Life$/i);
  if (statMatch) return `${target}: Recoup ${statMatch[1]} Damage nhận vào dưới dạng Life.`;

  statMatch = effect.match(/^\+(.+?) to (.+)$/i);
  if (statMatch) return `${target}: +${statMatch[1]} ${translateStatName(statMatch[2])}.`;

  statMatch = effect.match(/^(.+?) to (.+?) (Physical|Fire|Cold|Lightning|Chaos) Thorns damage$/i);
  if (statMatch) return `${target}: ${statMatch[1]} đến ${statMatch[2]} ${statMatch[3]} Thorns Damage.`;

  statMatch = effect.match(/^Allocates a random Notable Passive Skill$/i);
  if (statMatch) return `${target}: Allocate một Notable Passive Skill ngẫu nhiên.`;

  statMatch = effect.match(/^On Corruption, Item gains two Enchantments$/i);
  if (statMatch) return `${target}: khi Corrupt, item nhận hai Enchantment.`;

  statMatch = effect.match(/^(.+?) chance to gain Onslaught on Killing Hits with this Weapon$/i);
  if (statMatch) return `${target}: ${statMatch[1]} chance nhận Onslaught khi Killing Hit bằng Weapon này.`;

  return "";
};

const translateLine = (line = "") => {
  const clean = normalizeText(line);
  if (!clean) return "";

  const exact = new Map([
    [
      "removes a random modifier and augments a rare item with a new random modifier",
      "Xóa một modifier ngẫu nhiên và thêm một modifier ngẫu nhiên mới vào Rare item."
    ],
    [
      "removes a random modifier and augments a rare item with a new guaranteed modifier",
      "Xóa một modifier ngẫu nhiên và thêm một modifier được đảm bảo mới vào Rare item."
    ],
    [
      "reforges a rare item with new random modifiers",
      "Reforge Rare item với các modifier ngẫu nhiên mới."
    ],
    [
      "upgrades a normal item to a magic item",
      "Nâng Normal item thành Magic item."
    ],
    [
      "upgrades a magic item to a rare item",
      "Nâng Magic item thành Rare item."
    ],
    [
      "upgrades a normal item to a magic item with 1 modifier",
      "Nâng Normal item thành Magic item với 1 modifier."
    ],
    [
      "upgrades a magic item to a rare item, adding 1 modifier",
      "Nâng Magic item thành Rare item và thêm 1 modifier."
    ],
    [
      "upgrades a magic item to a rare item, adding a guaranteed modifier",
      "Nâng Magic item thành Rare item và thêm một modifier được đảm bảo."
    ],
    [
      "augments a magic item with a new random modifier",
      "Thêm một modifier ngẫu nhiên mới vào Magic item."
    ],
    [
      "augments a rare item with a new random modifier",
      "Thêm một modifier ngẫu nhiên mới vào Rare item."
    ],
    [
      "removes all modifiers from an item",
      "Xóa toàn bộ modifier khỏi item."
    ],
    [
      "removes a random modifier from an item",
      "Xóa một modifier ngẫu nhiên khỏi item."
    ],
    [
      "randomises the numeric values of modifiers on an item",
      "Reroll giá trị số của modifier trên item."
    ],
    [
      "fracture a random modifier on a rare item with at least 4 modifiers, locking it in place.",
      "Fracture một modifier ngẫu nhiên trên Rare item có ít nhất 4 modifier, khóa cố định nó lại."
    ],
    [
      "can be spent at vendors.",
      "Dùng để chi trả tại Vendor."
    ],
    [
      "creates a mirrored copy of an item",
      "Tạo một bản sao Mirrored của item."
    ],
    [
      "upgrades a normal or magic item to a rare item with 4 random modifiers",
      "Nâng Normal hoặc Magic item thành Rare item với 4 modifier ngẫu nhiên."
    ],
    [
      "unpredictably either upgrades a normal item to unique rarity or destroys it",
      "Có thể nâng Normal item lên Unique hoặc phá hủy item theo kết quả khó đoán."
    ],
    [
      "destroys an equipment item, returning any augments socketed in it",
      "Phá hủy Equipment item và hoàn trả mọi Augment đang socket trong đó."
    ],
    [
      "identifies an item",
      "Định danh item."
    ],
    [
      "allows an item to foresee the result of the next currency item used on it modifying the item in any way removes the ability to foresee",
      "Cho phép item xem trước kết quả của Currency tiếp theo được dùng lên nó. Bất kỳ thay đổi nào lên item sẽ xóa khả năng xem trước này."
    ],
    [
      "replaces up to 2 modifiers on a corrupted vaal unique replaces other uniques with a corrupted unique of the same item class",
      "Thay thế tối đa 2 modifier trên Corrupted Vaal Unique. Thay thế các Unique khác bằng một Corrupted Unique cùng Item Class."
    ],
    [
      "improves the quality of a martial weapon, caster weapon or armour above 20% with a chance of corrupting it",
      "Cải thiện Quality của Martial Weapon, Caster Weapon hoặc Armour vượt trên 20%, với cơ hội Corrupt nó."
    ],
    [
      "modifies an item unpredictably and corrupts it",
      "Biến đổi item theo kết quả khó đoán và Corrupt nó."
    ],
    [
      "corrupts an item",
      "Corrupt một item."
    ]
  ]);
  const exactKey = clean.toLocaleLowerCase("en-US");
  if (exact.has(exactKey)) return exact.get(exactKey);

  const prefixedStatLine = translatePrefixedStatLine(clean);
  if (prefixedStatLine) return prefixedStatLine;

  const patternTranslations = [
    [
      /^Desecrates (.+)$/i,
      ([, target]) => `Áp dụng Desecrate lên ${translateTarget(translateFragment(target))}.`
    ],
    [
      /^Modifies (.+?) unpredictably$/i,
      ([, target]) => `Biến đổi ${translateTarget(translateFragment(target))} theo kết quả khó đoán.`
    ],
    [
      /^Modifies (.+?) unpredictably or destroys it$/i,
      ([, target]) => `Biến đổi ${translateTarget(translateFragment(target))} theo kết quả khó đoán hoặc phá hủy nó.`
    ],
    [
      /^Modifies (.+?) unpredictably, with a chance to destroy it$/i,
      ([, target]) => `Biến đổi ${translateTarget(translateFragment(target))} theo kết quả khó đoán, có thể phá hủy nó.`
    ],
    [
      /^Improves the quality of (.+)$/i,
      ([, target]) => `Tăng chất lượng cho ${translateTarget(target)}.`
    ],
    [
      /^Upgrades a normal item to a magic item with one guaranteed (.+?) modifier$/i,
      ([, type]) => `Nâng Normal item thành Magic item với một ${normalizeText(type)} modifier được đảm bảo.`
    ],
    [
      /^Upgrades a magic item to a rare item with one guaranteed (.+?) modifier$/i,
      ([, type]) => `Nâng Magic item thành Rare item với một ${normalizeText(type)} modifier được đảm bảo.`
    ],
    [
      /^Upgrades a normal item to a magic item with (\d+) modifiers?$/i,
      ([, count]) => `Nâng Normal item thành Magic item với ${count} modifier.`
    ],
    [
      /^Upgrades a magic item to a rare item, adding (\d+) modifiers?$/i,
      ([, count]) => `Nâng Magic item thành Rare item và thêm ${count} modifier.`
    ],
    [
      /^Upgrades a magic item to a rare item, adding a guaranteed modifier$/i,
      () => "Nâng Magic item thành Rare item và thêm một modifier được đảm bảo."
    ],
    [
      /^Reforges (.+?) with new random modifiers$/i,
      ([, target]) => `Reroll ${translateTarget(target)} với các modifier ngẫu nhiên mới.`
    ],
    [
      /^Randomises the numeric values of (.+)$/i,
      ([, target]) => `Reroll giá trị số của ${translateFragment(target)}.`
    ],
    [
      /^Adds (?:a|an|one) (.+?) socket to (.+)$/i,
      ([, socket, target]) => `Thêm ${normalizeText(socket)} socket vào ${translateTarget(target)}.`
    ],
    [
      /^Adds quality that enhances (.+?) modifiers on a ring or amulet Replaces other quality types$/i,
      ([, type]) => `Thêm quality giúp tăng hiệu lực các ${normalizeText(type)} modifier trên ring hoặc amulet. Thay thế các loại quality khác.`
    ],
    [
      /^Adds (.+?) sockets to (.+)$/i,
      ([, count, target]) => `Thêm ${normalizeText(count)} socket vào ${translateTarget(target)}.`
    ],
    [
      /^Removes (?:a|one) socket from (.+)$/i,
      ([, target]) => `Gỡ một socket khỏi ${translateTarget(target)}.`
    ],
    [
      /^Sets quality to (.+)$/i,
      ([, value]) => `Đặt quality thành ${normalizeText(value)}.`
    ],
    [
      /^Sets a Skill Gem to have (\d+) Support Gem Sockets$/i,
      ([, count]) => `Đặt Skill Gem có ${count} Support Gem Socket.`
    ],
    [
      /^Players in Area are (\d+)% Delirious$/i,
      ([, percent]) => `Người chơi trong khu vực bị ${percent}% Delirious.`
    ],
    [
      /^Players in Area are (\d+)% Delirious (\d+)% increased Rarity of Items found in this Area$/i,
      ([, delirious, rarity]) => `Người chơi trong khu vực bị ${delirious}% Delirious. Item rơi trong khu vực tăng ${rarity}% Rarity.`
    ],
    [
      /^Players in Area are (\d+)% Delirious (\d+)% increased Pack size$/i,
      ([, delirious, pack]) => `Người chơi trong khu vực bị ${delirious}% Delirious. Pack size tăng ${pack}%.`
    ],
    [
      /^Players in Area are (\d+)% Delirious (\d+)% increased number of Magic Monsters$/i,
      ([, delirious, monsters]) => `Người chơi trong khu vực bị ${delirious}% Delirious. Số Magic Monster tăng ${monsters}%.`
    ],
    [
      /^Players in Area are (\d+)% Delirious (\d+)% increased number of Rare Monsters$/i,
      ([, delirious, monsters]) => `Người chơi trong khu vực bị ${delirious}% Delirious. Số Rare Monster tăng ${monsters}%.`
    ],
    [
      /^Players in Area are (\d+)% Delirious Rare Monsters have a (\d+)% chance to have an additional Modifier$/i,
      ([, delirious, chance]) => `Người chơi trong khu vực bị ${delirious}% Delirious. Rare Monster có ${chance}% cơ hội có thêm một modifier.`
    ],
    [
      /^Players in Area are (\d+)% Delirious Unique Monsters have (\d+) additional Rare Modifier$/i,
      ([, delirious, count]) => `Người chơi trong khu vực bị ${delirious}% Delirious. Unique Monster có thêm ${count} Rare modifier.`
    ],
    [
      /^(\d+)% increased Stack size of Simulacrum Splinters found in Area Players in Area are (\d+)% Delirious$/i,
      ([, stack, delirious]) => `Simulacrum Splinter rơi trong khu vực có Stack size tăng ${stack}%. Người chơi trong khu vực bị ${delirious}% Delirious.`
    ],
    [
      /^Players in Area are (\d+)% Delirious (\d+)% increased Precursor Tablets found in Area$/i,
      ([, delirious, tablets]) => `Người chơi trong khu vực bị ${delirious}% Delirious. Precursor Tablet rơi trong khu vực tăng ${tablets}%.`
    ],
    [
      /^Players in Area are (\d+)% Delirious (\d+)% increased Waystones found in Area$/i,
      ([, delirious, waystones]) => `Người chơi trong khu vực bị ${delirious}% Delirious. Waystone rơi trong khu vực tăng ${waystones}%.`
    ],
    [
      /^Can be combined with other Liquid Emotions to Instil Amulets with Notable Passive Skills$/i,
      () => "Có thể kết hợp với các Liquid Emotion khác để Instil Notable Passive Skill cho Amulet."
    ],
    [
      /^Sceptre: Allies in your Presence deal (.+?) increased Damage$/i,
      ([, amount]) => `Sceptre: Allies trong Presence của bạn gây ${amount} increased Damage.`
    ],
    [
      /^Gloves or Boots: (.+?) increased effect of Socketed Items$/i,
      ([, amount]) => `Gloves hoặc Boots: ${amount} increased effect của Socketed Items.`
    ],
    [
      /^Helmet: \+(.+?) to Level of all Minion Skills$/i,
      ([, amount]) => `Helmet: +${amount} Level của tất cả Minion Skills.`
    ],
    [
      /^One Handed Melee Weapon or Bow: \+(.+?) to Level of all Attack Skills$/i,
      ([, amount]) => `One Handed Melee Weapon hoặc Bow: +${amount} Level của tất cả Attack Skills.`
    ],
    [
      /^Two Handed Melee Weapon or Crossbow: \+(.+?) to Level of all Attack Skills$/i,
      ([, amount]) => `Two Handed Melee Weapon hoặc Crossbow: +${amount} Level của tất cả Attack Skills.`
    ],
    [
      /^Sceptre: Aura Skills have (.+?) increased Magnitudes$/i,
      ([, amount]) => `Sceptre: Aura Skills có ${amount} increased Magnitudes.`
    ],
    [
      /^Body Armour: (.+?) of Physical Damage from Hits taken as Chaos Damage$/i,
      ([, amount]) => `Body Armour: ${amount} Physical Damage từ Hits nhận thành Chaos Damage.`
    ],
    [
      /^Body Armour: Hits against you have (.+?) reduced Critical Damage Bonus$/i,
      ([, amount]) => `Body Armour: Hit lên bạn có ${amount} reduced Critical Damage Bonus.`
    ],
    [
      /^Wand: \+(.+?) to Level of all Spell Skills$/i,
      ([, amount]) => `Wand: +${amount} Level của tất cả Spell Skills.`
    ],
    [
      /^Staff: \+(.+?) to Level of all Spell Skills$/i,
      ([, amount]) => `Staff: +${amount} Level của tất cả Spell Skills.`
    ],
    [
      /^Instils a (.+?) into (.+)$/i,
      ([, effect, target]) => `Gắn ${translateTarget(effect)} vào ${translateTarget(target)}.`
    ],
    [
      /^Corrupts (.+)$/i,
      ([, target]) => `Corrupt ${translateTarget(target)}.`
    ],
    [
      /^Destroys (.+?) to create (.+)$/i,
      ([, source, result]) => `Phá hủy ${translateTarget(source)} để tạo ${translateTarget(result)}.`
    ],
    [
      /^Grants (.+)$/i,
      ([, value]) => `Cấp ${translateFragment(value)}.`
    ],
    [
      /^While this item is active in your inventory your next (.+?) used on a (.+?) item will (.+)$/i,
      ([, currency, rarity, effect]) => `Khi item này đang active trong inventory, ${translateTarget(currency)} tiếp theo của bạn khi dùng lên ${translateFragment(`${rarity} item`)} sẽ ${normalizeText(effect).replace(/\bit\b/i, "item đó")}.`
    ],
    [
      /^While this item is active in your inventory your next (.+?) will (.+)$/i,
      ([, currency, effect]) => {
        const transCurrency = translateTarget(currency);
        const rawEffect = normalizeText(effect);
        let transEffect = rawEffect;

        transEffect = transEffect
          .replace(/\bremove the lowest level modifiers?\b/i, "xóa modifier có cấp thấp nhất")
          .replace(/\bremove only prefix modifiers?\b/i, "chỉ xóa prefix modifier")
          .replace(/\bremove only suffix modifiers?\b/i, "chỉ xóa suffix modifier")
          .replace(/\breplace all modifiers? on a Waystone with modifiers? that grant Item Rarity\b/i, "thay thế toàn bộ modifier trên Waystone bằng các modifier tăng Item Rarity")
          .replace(/\breplace all modifiers? on a Waystone with modifiers? that grant Pack Size\b/i, "thay thế toàn bộ modifier trên Waystone bằng các modifier tăng Pack Size")
          .replace(/\breplace all modifiers? on a Waystone with modifiers? that grant Rare and Magic Monsters\b/i, "thay thế toàn bộ modifier trên Waystone bằng các modifier tăng số lượng Rare và Magic Monster")
          .replace(/\bonly reroll Implicit modifiers?\b/i, "chỉ reroll Implicit Modifier")
          .replace(/\bused on a Rare item will Sanctify it\b/i, "Sanctify Rare item được dùng lên")
          .replace(/\badd two random modifiers?\b/i, "thêm hai modifier ngẫu nhiên")
          .replace(/\badd only prefix modifiers?\b/i, "chỉ thêm prefix modifier")
          .replace(/\badd only suffix modifiers?\b/i, "chỉ thêm suffix modifier")
          .replace(/\badd a modifiers? of the same type as an existing modifiers? on the items?\b/i, "thêm một modifier cùng loại với một modifier sẵn có trên item")
          .replace(/\bconsume all Catalyst Quality to increase the chance of the corresponding type of modifiers?\b/i, "tiêu thụ toàn bộ Catalyst Quality để tăng cơ hội nhận loại modifier tương ứng");

        return `Khi item này đang active trong inventory, ${transCurrency} tiếp theo của bạn sẽ ${transEffect}.`;
      }
    ]
  ];

  for (const [pattern, formatter] of patternTranslations) {
    const match = clean.match(pattern);
    if (match) return formatter(match);
  }

  return withPeriod(translateFragment(clean));
};

export const translateCurrencyText = (text = "") => {
  const clean = normalizeText(text);
  if (!clean) return "";
  const lines = clean
    .split(/\s*(?:\n|(?<=\.)\s+)\s*/u)
    .map(translateLine)
    .filter(Boolean);
  return lines.join(" ");
};

const nodeText = ($, node) => {
  const clone = $(node).clone();
  clone.find("br").replaceWith(" ");
  return normalizeText(clone.text());
};

const readLines = ($, scope, selector) => scope.find(selector)
  .map((_, node) => nodeText($, node))
  .get()
  .filter(Boolean);

const categoryLabel = ($, pane, categoryId) => {
  const header = normalizeText(pane.find("h5.card-header").first().text()).replace(/\s*\/\d+\s*$/, "");
  return CATEGORY_LABELS[categoryId] || header || categoryId;
};

export const classifyCurrencySubtype = ({ name = "", category = "", description_en: descriptionEn = "" } = {}) => {
  const itemName = normalizeText(name);
  const itemNameLower = itemName.toLocaleLowerCase("en-US");
  if (itemNameLower.startsWith("omen ") || itemNameLower.includes(" omen")) {
    return { subtype: "omen", subtype_label: FAMILY_LABELS.omen };
  }

  if (category === "Essence") return { subtype: "essence", subtype_label: FAMILY_LABELS.essence };
  if (category === "SplinterItem") return { subtype: "splinter", subtype_label: FAMILY_LABELS.splinter };
  if (category === "CatalystItem") return { subtype: "catalyst", subtype_label: FAMILY_LABELS.catalyst };

  const haystack = `${itemName} ${descriptionEn}`.toLocaleLowerCase("en-US");

  if (/\bliquid\b/.test(haystack) || /\bdelirious\b/.test(haystack) || /\bsimulacrum\b/.test(haystack)) {
    return { subtype: "delirium-liquid", subtype_label: FAMILY_LABELS["delirium-liquid"] };
  }
  if (/\bartifact$/.test(itemNameLower) || itemNameLower === "exotic coinage") {
    return { subtype: "expedition-artifact", subtype_label: FAMILY_LABELS["expedition-artifact"] };
  }
  if (/\bshard$/.test(itemNameLower)) {
    return { subtype: "shard", subtype_label: FAMILY_LABELS.shard };
  }
  if (/\bdesecrates\b/.test(haystack) || /\b(collarbone|jawbone|rib|cranium|vertebrae)\b/.test(haystack)) {
    return { subtype: "desecration-currency", subtype_label: FAMILY_LABELS["desecration-currency"] };
  }
  if (/\bjeweller's orb\b/.test(itemNameLower) || /\bsupport gem sockets?\b/.test(haystack)) {
    return { subtype: "socket-currency", subtype_label: FAMILY_LABELS["socket-currency"] };
  }
  if (/\b(gemcutter|skill gem|support gem|uncut gem)\b/.test(haystack)) {
    return { subtype: "gem-currency", subtype_label: FAMILY_LABELS["gem-currency"] };
  }
  if (/\b(vaal|corrupt|corrupted|corruption)\b/.test(haystack)) {
    return { subtype: "corruption-currency", subtype_label: FAMILY_LABELS["corruption-currency"] };
  }
  if (/\b(whetstone|scrap|bauble|etcher)\b/.test(itemNameLower) || /\bquality\b/.test(haystack)) {
    return { subtype: "quality-currency", subtype_label: FAMILY_LABELS["quality-currency"] };
  }
  if (/\borb\b/.test(itemNameLower) || /\b(annulment|alchemy|transmutation|augmentation|chaos|exalted|regal|divine|mirror|chance|fracturing|hinekora)\b/.test(haystack)) {
    return { subtype: "crafting-orb", subtype_label: FAMILY_LABELS["crafting-orb"] };
  }
  return { subtype: "utility-currency", subtype_label: FAMILY_LABELS["utility-currency"] };
};

export const classifyCurrencyFamily = (item = {}) => {
  const subtype = classifyCurrencySubtype(item);
  return { family: subtype.subtype, family_label: subtype.subtype_label };
};

const parseCurrencyItem = ($, itemNode, sourcePageUrl, category, label, slugCounts) => {
  const item = $(itemNode);
  const icon = item.find("img[src]").filter((_, image) => /\bw1\b/.test($(image).attr("class") || "")).first();
  const firstIcon = icon.length ? icon : item.find("img[src]").first();
  const iconAnchor = firstIcon.closest("a[href]");
  const nameAnchor = item.find("a[href]").filter((_, anchor) => normalizeText($(anchor).clone().find("img").remove().end().text())).first();
  const anchor = nameAnchor.length ? nameAnchor : iconAnchor;
  const name = normalizeText(anchor.clone().find("img").remove().end().text());
  const sourceSlug = slugFromHref(anchor.attr("href"), sourcePageUrl);
  if (!name || !sourceSlug) return null;

  const slugCount = (slugCounts.get(sourceSlug) || 0) + 1;
  slugCounts.set(sourceSlug, slugCount);
  const slug = slugCount === 1 ? sourceSlug : `${sourceSlug}__${slugCount}`;
  const hover = anchor.attr("data-hover") || iconAnchor.attr("data-hover") || "";
  const properties = readLines($, item, ".property, .hybridProperty");
  const mods = readLines($, item, ".explicitMod, .implicitMod, .enchantMod, .descrText, .secDescrText, .text-type0");
  const stackSize = properties
    .map((line) => line.match(/^Stack Size:\s*(.+)$/i)?.[1])
    .find(Boolean) || "";
  const descriptionEn = mods[0] || properties.find((line) => !/^Stack Size:/i.test(line)) || "";

  const currency = {
    slug,
    name,
    category,
    category_label: label,
    source_url: toAbsoluteUrl(anchor.attr("href"), sourcePageUrl),
    icon_url: toAbsoluteUrl(firstIcon.attr("src"), sourcePageUrl),
    icon_alt: firstIcon.attr("alt") || "",
    hover_url: toAbsoluteUrl(hover, sourcePageUrl),
    stack_size: stackSize,
    description_en: descriptionEn,
    properties,
    mods
  };
  Object.assign(currency, subtypeAliases(currency));
  currency.source_hash = hashJson(sourceForHash(currency));
  return currency;
};

export const parseCurrencyPage = (html, sourcePageUrl = DEFAULT_CURRENCY_SOURCE_URL) => {
  const $ = load(html);
  const currencies = [];
  const slugCounts = new Map();
  const panes = CATEGORY_ORDER
    .map((id) => $(`#${id}`).first())
    .filter((pane) => pane.length)
    .concat($(".tab-pane[id]").filter((_, pane) => !CATEGORY_ORDER.includes($(pane).attr("id"))).get().map((pane) => $(pane)));

  for (const pane of panes) {
    const category = pane.attr("id");
    const label = categoryLabel($, pane, category);
    pane.find(".row .col").each((_, col) => {
      const parsed = parseCurrencyItem($, col, sourcePageUrl, category, label, slugCounts);
      if (parsed) currencies.push(parsed);
    });
  }

  const order = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
  return currencies.sort((a, b) =>
    (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) ||
    a.name.localeCompare(b.name)
  );
};

export const parseCurrencyRelatedItems = (html, sourcePageUrl = DEFAULT_CURRENCY_SOURCE_URL) => {
  const $ = load(html);
  const related = [];

  $("#Acronym .d-flex").each((_, el) => {
    const dFlex = $(el);
    const anchor = dFlex.find("a").first();
    const textAnchor = dFlex.find("a").filter((_, a) => $(a).text().trim().length > 0).first();
    if (!anchor.length) return;

    const href = textAnchor.attr("href") || anchor.attr("href") || "";
    const slug = slugFromHref(href, sourcePageUrl);
    if (slug === "Convention_Treasure" || slug.toLowerCase().includes("convention") || slug.toLowerCase().includes("treasure")) {
      return;
    }
    const name = textAnchor.text().trim() || slug.replace(/_/g, " ");

    const img = dFlex.find("img").first();
    const iconUrl = img.attr("src") || "";
    const iconAlt = img.attr("alt") || "";
    const hover = anchor.attr("data-hover") || "";

    const properties = [];
    const mods = [];

    dFlex.find(".property, .hybridProperty").each((_, p) => {
      const txt = $(p).text().trim();
      if (txt) properties.push(txt);
    });

    dFlex.find(".explicitMod, .implicitMod, .enchantMod, .descrText, .secDescrText, .text-type0").each((_, m) => {
      const txt = $(m).text().trim();
      if (txt) mods.push(txt.replace(/\s+/g, " "));
    });

    const stackSizeText = properties.find((p) => /^Stack Size:/i.test(p));
    const stackSize = stackSizeText ? stackSizeText.replace(/^Stack Size:\s*/i, "") : "";
    const descriptionEn = mods[0] || properties.find((line) => !/^Stack Size:/i.test(line)) || "";

    related.push({
      slug,
      name,
      source_url: toAbsoluteUrl(href, sourcePageUrl),
      icon_url: toAbsoluteUrl(iconUrl, sourcePageUrl),
      icon_alt: iconAlt,
      hover_url: toAbsoluteUrl(hover, sourcePageUrl),
      stack_size: stackSize,
      description_en: descriptionEn,
      properties,
      mods,
      relation_source: "acronym-item"
    });
  });

  return related;
};

export const buildBidirectionalCurrencyRelations = (currencies) => {
  const itemMap = new Map();

  // 1. Map all existing items
  for (const item of currencies) {
    if (!item.related_items) item.related_items = [];
    itemMap.set(item.slug, item);
  }

  // 2. Discover related items that are not in the main list and create them
  for (const item of currencies) {
    for (const rel of item.related_items) {
      if (!itemMap.has(rel.slug)) {
        const newCurrency = {
          slug: rel.slug,
          name: rel.name,
          source_url: rel.source_url,
          icon_url: rel.icon_url,
          icon_alt: rel.icon_alt || "",
          hover_url: rel.hover_url || "",
          stack_size: rel.stack_size || "",
          description_en: rel.description_en || "",
          properties: rel.properties || [],
          mods: rel.mods || [],
          related_items: []
        };
        newCurrency.category = item.category || "StackableCurrencyItem";
        newCurrency.category_label = item.category_label || "Currency";

        // classify the family of the new item
        const familyInfo = classifyCurrencyFamily(newCurrency);
        newCurrency.family = familyInfo.family;
        newCurrency.family_label = familyInfo.family_label;
        newCurrency.subtype = familyInfo.family;
        newCurrency.subtype_label = familyInfo.family_label;
        newCurrency.status = "active";
        newCurrency.source_hash = hashJson(sourceForHash(newCurrency));

        itemMap.set(rel.slug, newCurrency);
      }
    }
  }

  // 3. Mirror the relationships two-way
  const allItems = Array.from(itemMap.values());
  for (const item of allItems) {
    for (const rel of item.related_items) {
      const target = itemMap.get(rel.slug);
      if (target) {
        if (!target.related_items) target.related_items = [];
        const alreadyRelated = target.related_items.some((r) => r.slug === item.slug);
        if (!alreadyRelated) {
          target.related_items.push({
            slug: item.slug,
            name: item.name,
            source_url: item.source_url,
            icon_url: item.icon_url,
            icon_alt: item.icon_alt || "",
            hover_url: item.hover_url || "",
            stack_size: item.stack_size || "",
            description_en: item.description_en || "",
            properties: item.properties || [],
            mods: item.mods || [],
            relation_source: "bidirectional-mirror"
          });
        }
      }
    }
  }

  return allItems.map((item) => ({
    ...item,
    source_hash: hashJson(sourceForHash(item))
  }));
};

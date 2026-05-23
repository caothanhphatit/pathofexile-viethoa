import { load } from "cheerio";

export const normalizeGlossaryText = (value = "") => String(value)
  .replace(/\u00a0/g, " ")
  .replace(/[ \t\r\n]+/g, " ")
  .replace(/\s+([,.;:!?])/g, "$1")
  .trim();

const toAbsoluteUrl = (href = "", baseUrl = "https://poe2db.tw/us/") => {
  if (!href) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
};

const pageLang = (sourcePageUrl = "https://poe2db.tw/us/") => {
  try {
    const [, lang] = new URL(sourcePageUrl).pathname.match(/^\/([a-z]{2})\//i) || [];
    return lang || "us";
  } catch {
    return "us";
  }
};

export const keywordHoverUrl = (dataHover = "", sourcePageUrl = "https://poe2db.tw/us/") => {
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

export const extractKeywordReferences = (html = "", sourcePageUrl = "https://poe2db.tw/us/") => {
  const $ = load(html);
  return $(".KeywordPopups[data-keyword]").map((_, node) => {
    const link = $(node);
    const keyword = normalizeGlossaryText(link.attr("data-keyword"));
    const label = normalizeGlossaryText(link.text());
    const dataHover = link.attr("data-hover") || "";
    return {
      keyword,
      label: label || keyword,
      href: toAbsoluteUrl(link.attr("href") || "", sourcePageUrl),
      hover_url: keywordHoverUrl(dataHover, sourcePageUrl),
      source_url: sourcePageUrl
    };
  }).get().filter((ref) => ref.keyword && ref.label);
};

export const parseKeywordHoverHtml = (html = "") => {
  const $ = load(html);
  $(".keyword-body br").replaceWith(" ");
  const title = normalizeGlossaryText($(".card-header").first().text());
  const descriptionEn = normalizeGlossaryText($(".keyword-body").first().text());
  return {
    title,
    description_en: descriptionEn
  };
};

const exactDescriptions = new Map([
  [
    "Item Rarity",
    "Trang bị có các độ hiếm gồm Normal (xám), Magic (xanh dương), Rare (vàng) hoặc Unique (nâu). Trang bị Magic có tối đa 1 Prefix và 1 Suffix; trang bị Rare có tối đa 3 Prefix và 3 Suffix."
  ],
  [
    "Desecrated Modifiers",
    "Hiệu ứng Desecrating sẽ thêm một modifier ẩn chưa tiết lộ (Unrevealed Desecrated modifier). Nếu trang bị đã đầy modifier thì một dòng ngẫu nhiên sẽ bị xóa. Dòng ẩn này được hiển thị tại Bể Hồn (Well of Souls); trang bị đã có dòng Desecrated không thể thực hiện Desecrating lại."
  ],
  [
    "Minimum Modifier Level",
    "Dòng thuộc tính ngẫu nhiên được thêm vào sẽ có level tối thiểu bằng mức này hoặc cao hơn, trừ khi loại modifier cụ thể bị loại khỏi danh sách thuộc tính có thể xuất hiện. Không thể dùng currency này trên trang bị có item level thấp hơn mức tối thiểu này."
  ],
  [
    "Maximum Item Level",
    "Giới hạn level trang bị tối đa mà currency có thể áp dụng."
  ],
  [
    "Quality",
    "Chất lượng (Quality) là chỉ số phụ giúp tăng hiệu lực của trang bị, gem hoặc một nhóm thuộc tính tùy thuộc vào loại currency/catalyst được sử dụng."
  ],
  [
    "Liquid Emotions",
    "Cảm xúc lỏng (Liquid Emotions) là nhóm currency Delirium có thể kết hợp để ban cho Dây chuyền (Amulet) một Kỹ năng Nội tại Nổi bật (Notable Passive Skill)."
  ],
  [
    "Precursor Tablets",
    "Precursor Tablets là item đặc biệt dùng trong Map Device để thêm Endgame Mechanics vào Maps trên Atlas của bạn."
  ],
  [
    "Waystones",
    "Waystones là item dùng để mở Maps trên Atlas. Waystones có nhiều tier; tier cao hơn nghĩa là monster level cao hơn. Có thể craft hoặc biến đổi Waystones để tăng độ khó và phần thưởng từ monster gặp trong Maps."
  ],
  [
    "Attack",
    "Tấn công (Attack) là các kỹ năng sử dụng trực tiếp vũ khí đang trang bị để gây sát thương. Spell không được tính là Attack. Sát thương cơ bản, tốc độ tấn công (Attack Speed) và tỉ lệ chí mạng (Critical Hit Chance) của Attack thường lấy từ chỉ số vũ khí, trừ khi kỹ năng ghi khác."
  ],
  [
    "Martial Weapons",
    "Vũ khí chiến đấu (Martial Weapons) là nhóm vũ khí dùng để tấn công vật lý (Attack), gồm Rìu (Axe), Cung (Bow), Vuốt (Claw), Nỏ (Crossbow), Dao găm (Dagger), Chùy xích (Flail), Chùy (Mace), Gậy võ tăng (Quarterstaff), Thương (Spear), Kiếm (Sword) và Bùa hộ mệnh (Talisman)."
  ],
  [
    "Caster Weapon",
    "Vũ khí phép thuật (Caster Weapon) là nhóm vũ khí thiên về niệm phép (Spell) hoặc Spirit, gồm Quyền trượng (Sceptre), Gậy phép (Staff) và Đũa phép (Wand)."
  ],
  [
    "Bows",
    "Cung (Bow) là vũ khí đánh xa dùng hai tay, yêu cầu chỉ số Khéo léo (Dexterity) và có thể đi kèm Quiver. Cung có ưu thế về tầm đánh xa, độ cơ động cao và nhiều kỹ năng bắn vật thể bay (Projectile)."
  ],
  [
    "Crossbows",
    "Nỏ (Crossbow) là vũ khí đánh xa dùng hai tay, yêu cầu Sức mạnh (Strength) và Khéo léo (Dexterity). Đòn đánh cơ bản của Nỏ có thể được thay đổi bằng kỹ năng nạp đạn (Ammunition Skill); nhiều Projectile từ cùng một kỹ năng Nỏ có thể cùng trúng (Hit) một mục tiêu."
  ],
  [
    "Chaos",
    "Chaos (Hỗn mang) là loại sát thương bị giảm trừ bởi Kháng Chaos. Trong giao diện và nhãn kỹ năng, giữ nguyên thuật ngữ Chaos để đồng bộ với phiên bản gốc."
  ],
  [
    "Channelling",
    "Tập trung (Channelling) là nhãn cho kỹ năng cần nhấn giữ nút hoặc duy trì thao tác liên tục trong một khoảng thời gian."
  ],
  [
    "Persistent",
    "Duy trì (Persistent) là nhãn cho các kỹ năng được bật/tắt trong Bảng kỹ năng thay vì dùng như kỹ năng bấm thường; nhiều kỹ năng duy trì cần giữ Spirit để hoạt động."
  ],
  [
    "Staged",
    "Cấp độ (Staged) là nhãn cho các kỹ năng có cơ chế tích lũy, giữ hoặc tiêu thụ nhiều tầng (stage) để gia tăng hiệu ứng."
  ],
  [
    "Sustained",
    "Kéo dài (Sustained) là nhãn cho kỹ năng có trạng thái duy trì liên tục trong khi sử dụng, thường yêu cầu sự tập trung hoặc đáp ứng các điều kiện cụ thể."
  ],
  [
    "Spells",
    "Kỹ năng phép (Spell) là các kỹ năng sử dụng ma pháp thuần túy để tiêu diệt kẻ địch. Attack không phải là Spell. Spell sở hữu sát thương cơ bản (Base Damage), tốc độ niệm (Cast Speed) và tỉ lệ chí mạng (Critical Hit Chance) riêng biệt quyết định bởi chính kỹ năng đó, không nhận bonus từ vũ khí."
  ],
  [
    "Charges",
    "Điểm tích lũy (Charges) nhận được từ nhiều kỹ năng, nội tại hoặc hiệu ứng khác. Bản thân chúng không cộng trực tiếp chỉ số nhưng có thể tiêu dùng để cường hóa (Empower) kỹ năng hoặc kích hoạt hiệu ứng khác."
  ],
  [
    "Dexterity",
    "Khéo léo (Dexterity) là chỉ số thuộc tính yêu cầu để sử dụng các trang bị tăng Né tránh (Evasion Rating), vũ khí tầm xa và cận chiến. Dexterity cũng cung cấp thêm chỉ số Né tránh và Độ chính xác (Accuracy Rating) thụ động."
  ],
  [
    "Intelligence",
    "Thông thái (Intelligence) là chỉ số thuộc tính yêu cầu để sử dụng các trang bị tăng Khiên năng lượng (Energy Shield), vũ khí phép và kỹ năng Spell. Intelligence cũng cung cấp thêm Mana tối đa và Khiên năng lượng thụ động."
  ],
  [
    "Resistances",
    "Kháng (Resistances) giúp giảm sát thương nhận vào từ các loại tương ứng — gồm Lửa (Fire), Băng (Cold), Sét (Lightning) hoặc Hỗn mang (Chaos) — áp dụng cho cả đòn đánh trực tiếp (Hit) và sát thương theo thời gian (Damage over Time)."
  ],
  [
    "Slow",
    "Làm chậm (Slow) là hiệu ứng bất lợi từ Debuff khiến các hành động tốn nhiều thời gian hơn. Làm chậm có thể áp dụng cho chỉ số cụ thể như tốc độ đánh (Attack Speed), tốc độ niệm (Cast Speed), tốc độ di chuyển (Movement Speed), hoặc tốc độ hành động chung."
  ],
  [
    "Slows",
    "Làm chậm (Slow) là hiệu ứng bất lợi từ Debuff khiến các hành động tốn nhiều thời gian hơn. Làm chậm có thể áp dụng cho chỉ số cụ thể như tốc độ đánh (Attack Speed), tốc độ niệm (Cast Speed), tốc độ di chuyển (Movement Speed), hoặc tốc độ hành động chung."
  ],
  [
    "Strength",
    "Sức mạnh (Strength) là chỉ số thuộc tính yêu cầu để sử dụng các trang bị tăng Giáp (Armour) và vũ khí cận chiến. Strength cũng cung cấp thêm Máu tối đa thụ động."
  ],
  [
    "Flask",
    "Bình thuốc để phục hồi Máu hoặc Mana cho nhân vật. Bình thuốc không bị tiêu hao mất đi khi dùng mà tích lũy số lần sử dụng (Charge) khi tiêu diệt kẻ địch."
  ],
  [
    "Flasks",
    "Bình thuốc để phục hồi Máu hoặc Mana cho nhân vật. Bình thuốc không bị tiêu hao mất đi khi dùng mà tích lũy số lần sử dụng (Charge) khi tiêu diệt kẻ địch. Các Checkpoint và Well sẽ bơm đầy lại hoàn toàn bình thuốc khi kích hoạt."
  ],
  [
    "Life",
    "Máu (Life) là sinh mệnh của nhân vật. Nếu chỉ số Life giảm về 0, nhân vật sẽ hy sinh."
  ],
  [
    "Mana",
    "Mana (năng lượng) dùng để thi triển các kỹ năng chủ động (Active Skills)."
  ],
  [
    "Life Flask",
    "Bình máu (Life Flask) dùng để phục hồi máu (Life) cho nhân vật."
  ],
  [
    "Mana Flask",
    "Bình mana (Mana Flask) dùng để phục hồi mana cho nhân vật."
  ]
]);

for (const [term, meaning] of [
  ["Accuracy", "Chỉ số quyết định khả năng đánh trúng."],
  ["Ailment", "Ailment là trạng thái bất lợi đặt lên mục tiêu, ví dụ Bleeding, Poison, Ignite, Chill, Freeze, Shock hoặc Electrocution tùy nguồn gây hiệu ứng. App giữ nguyên Ailment vì đây là thuật ngữ gốc xuất hiện trực tiếp trong modifier và tooltip."],
  ["Ailments", "Ailments là nhóm trạng thái bất lợi đặt lên mục tiêu, ví dụ Bleeding, Poison, Ignite, Chill, Freeze, Shock hoặc Electrocution tùy nguồn gây hiệu ứng. App giữ nguyên Ailment/Ailments để đối chiếu đúng modifier trong game."],
  ["Elemental Ailment", "Elemental Ailment là Ailment liên quan Fire, Cold hoặc Lightning, thường gặp như Ignite, Chill, Freeze, Shock hoặc Electrocution. Những hiệu ứng này phụ thuộc vào loại Damage và cơ chế của skill/modifier."],
  ["Elemental Ailments", "Elemental Ailments là nhóm Ailment liên quan Fire, Cold hoặc Lightning, thường gặp như Ignite, Chill, Freeze, Shock hoặc Electrocution. Những hiệu ứng này phụ thuộc vào loại Damage và cơ chế của skill/modifier."],
  ["Ailment Threshold", "Ailment Threshold là ngưỡng chống Ailment của mục tiêu. Threshold càng cao thì Hit thường cần gây nhiều Damage hoặc buildup hơn để tạo Ailment đủ mạnh, đủ chance hoặc đủ điều kiện kích hoạt."],
  ["Elemental Ailment Threshold", "Elemental Ailment Threshold là ngưỡng chống các Elemental Ailment như Ignite, Chill, Freeze, Shock hoặc Electrocution. Tăng chỉ số này giúp mục tiêu khó bị các Ailment nguyên tố ảnh hưởng mạnh."],
  ["Lightning Ailment", "Lightning Ailment là Ailment thuộc nhóm Lightning, thường liên quan Shock hoặc Electrocution. Shock làm mục tiêu nhận thêm Damage, còn Electrocution có thể ngắt hành động tùy nguồn gây hiệu ứng."],
  ["Allies", "Allies gồm người chơi khác, Minions và các thực thể chiến đấu cùng phe với bạn, có bộ chỉ số riêng. Nhân vật của bạn không được tính là Ally của chính mình."],
  ["Ancient Augment", "Ancient Augment là loại Augment có hiệu ứng đơn lẻ rất mạnh nhưng bị giới hạn: mỗi lần chỉ gắn được tối đa một Augment loại này."],
  ["Armour Break", "Armour Break làm giảm Armour của mục tiêu theo một lượng cụ thể. Khi Armour bị đưa về 0, mục tiêu bị Fully Broken trong 12 giây, hoặc 4 giây với người chơi; non-player target bị Fully Broken nhận thêm 20% Physical Damage từ Hit."],
  ["Attributes", "Attributes gồm Strength, Dexterity và Intelligence. Chúng chủ yếu dùng để đáp ứng yêu cầu Equipment/Gem, đồng thời mỗi Attribute cho một bonus nội tại riêng."],
  ["Augment", "Augment là item gắn vào Augment socket, thường nằm trên Equipment. Sau khi gắn có thể thay bằng Augment khác, nhưng không thể tháo ra bằng cách thông thường."],
  ["Auras", "Aura áp dụng Buff cho Allies hoặc Debuff cho kẻ địch trong phạm vi quanh nguồn phát Aura."],
  ["Armour", "Chỉ số giảm sát thương vật lý từ hit."],
  ["Block", "Block chặn hoàn toàn Damage của Hit đi vào, nhưng vẫn có thể nhận Stun từ Hit bị Block. Không thể Block khi đang Stunned hoặc Frozen; một số kỹ năng Boss có tín hiệu đỏ/âm thanh và không thể Block."],
  ["Buff/Debuff Magnitude", "Magnitude của Buff hoặc Debuff là giá trị chỉ số mà hiệu ứng áp lên mục tiêu. Magnitude cao hơn khiến hiệu ứng mạnh hơn và thường nhân với các modifier tăng Effect trên mục tiêu."],
  ["Burning", "Burning là trạng thái khi kẻ địch đang nhận Fire Damage over Time, thường xuất phát từ Ignite."],
  ["Chaos Damage", "Sát thương hỗn mang/độc hệ Chaos."],
  ["Chilled Ground", "Chilled Ground gây Chill cho đơn vị đứng trên đó và mặc định tồn tại 6 giây."],
  ["Cold Damage", "Sát thương lạnh."],
  ["Corrupted Items", "Corrupted Items có thuộc tính bị biến đổi khó đoán, thường đến từ Vaal Orb hoặc nguồn Corruption. Hầu hết cách craft/chỉnh sửa item không dùng được trên Corrupted item."],
  ["Critical Damage Bonus", "Critical Damage Bonus nhân Damage gây ra bởi Critical Hit. Giá trị mặc định là +100%, tức Hit chí mạng gây gấp đôi Damage trước khi cộng thêm bonus khác."],
  ["Critical Hits", "Critical Hit mặc định gây thêm +100% Damage. Attack thường dùng Critical Hit Chance cơ bản của vũ khí, còn Spell và một số skill dùng Critical Hit Chance ghi trực tiếp trên skill."],
  ["Damage Contributing to Ailments", "Damage Contributing to Ailments cho phép loại Damage khác được cộng vào phép tính Ailment. Với Ailment dựa trên Hit Damage, Damage type đó có thể góp phần tạo chance, buildup hoặc Magnitude tùy cơ chế."],
  ["Damage Conversion", "Damage Conversion đổi Damage từ một type sang type khác. Damage sau khi convert hưởng modifier của type mới, không còn hưởng modifier của type cũ; Conversion từ Skill được áp trước các nguồn khác. Damage over Time không thể convert."],
  ["Damage Gained as extra X", "Damage gained as extra X tạo thêm Damage thuộc type mới từ Damage gốc. Phần Damage thêm này hưởng modifier của type mới; Damage over Time không hưởng Damage Gain."],
  ["Damage Types", "Damage Types gồm Physical, Fire, Cold, Lightning và Chaos."],
  ["Defences", "Defences tiêu chuẩn gồm Armour, Evasion Rating và Energy Shield. Những chỉ số bảo vệ khác như Resistances không được tính là Defences."],
  ["Delirious Players", "Delirious khiến combat khó hơn: monster gây nhiều Damage hơn, có thêm Toughness, có thể sinh thêm monster hoặc thêm modifier, đổi lại item drop từ monster tốt hơn theo mức Delirium."],
  ["Efficiency", "Efficiency modifier hoạt động như mẫu số cho chỉ số nó chỉnh. Ví dụ tăng Reservation Efficiency làm Reservation còn lại thấp hơn so với giá trị gốc; giảm Efficiency khiến chỉ số tiêu tốn nhiều hơn."],
  ["Electrocution", "Electrocution là Ailment ngắt hành động của mục tiêu và mặc định kéo dài 5 giây. Chỉ Lightning Damage từ Hit của skill/effect cụ thể mới góp Electrocution Buildup."],
  ["Elemental Surges", "Elemental Surges được consume khi dùng non-Melee Projectile Attack để cường hóa Projectile, tạo Surging Blast cuối đường bay. Surge gắn với vũ khí hiện tại, mặc định tối đa 6 mỗi loại và tồn tại 15 giây."],
  ["Energy Shield Recharge", "Energy Shield bị mất sẽ bắt đầu Recharge sau độ trễ cơ bản 4 giây, hồi 12.5% mỗi giây. Mất thêm Energy Shield sẽ reset độ trễ này."],
  ["Energy Shield Recharge Rate", "Energy Shield Recharge Rate quyết định Energy Shield hồi nhanh đến mức nào sau khi Recharge đã bắt đầu."],
  ["Equippable Armours", "Equippable Armours là các mảnh Equipment đeo được để lấy phòng thủ, gồm Helmet, Body Armour, Gloves, Boots, Shield và Foci."],
  ["Flame of Chayula", "Flames of Chayula cho bonus khi nhặt: Red leech Life, Blue leech Mana, Purple cho Buff cộng Chaos Damage theo stack. Flames of Chayula cũng được tính là Remnants."],
  ["Flammability", "Flammability là Debuff tạo chance để Hit Ignite mục tiêu. Fire Damage từ Hit góp vào Magnitude của Flammability; nhiều instance có thể stack đến 100% chance Ignite và mỗi instance có Duration riêng."],
  ["Fire Damage", "Sát thương lửa."],
  ["Foci", "Foci là armour item cầm ở off hand, yêu cầu Intelligence, thường cho Energy Shield lớn và bonus mạnh cho Spell."],
  ["Fractured Modifiers", "Fractured Modifier bị khóa vĩnh viễn trên item và không thể bị xóa hoặc thay đổi bằng cách thông thường."],
  ["Guard", "Guard là Buff tạo lớp đệm nhận Damage từ Hit trước Life hoặc Energy Shield cho đến khi hết Duration hoặc hết lượng Guard. Mỗi nhân vật chỉ giữ một Guard Buff tại một thời điểm."],
  ["Herald Skills", "Herald Skills là nhóm Persistent Buff cho hiệu ứng mạnh khi giết kẻ địch."],
  ["Hit Damage", "Hit Damage là mọi Damage không phải Damage over Time. Damaging Ailment sinh từ Hit sẽ tính Damage từ Hit đó; tăng Hit Damage thường làm Damaging Ailment mạnh hơn một cách gián tiếp."],
  ["Ignited Ground", "Ignited Ground liên tục áp Flammability lên kẻ địch đứng trên đó và Ignite khi đạt 50%. Mặc định tồn tại 4 giây với bán kính 2 mét nếu không ghi khác."],
  ["Intimidate", "Intimidate là Debuff khiến mục tiêu nhận thêm 10% Damage và gây ít hơn 10% Damage."],
  ["Jewellery", "Jewellery là nhóm trang sức gồm Amulets và Rings."],
  ["Jewels", "Jewels là item gắn vào Jewel Socket trên Passive Skill Tree để nhận bonus. Basic Jewel cho chỉ số trực tiếp; một số Jewel có hiệu ứng phức tạp hơn trong phạm vi nhất định."],
  ["Lightning Damage", "Sát thương sét."],
  ["Lucky", "Lucky nghĩa là roll hai lần và lấy kết quả tốt hơn."],
  ["Melee", "Melee là tag cho skill cận chiến, thường dùng weapon range và vị trí đứng gần mục tiêu."],
  ["Maximum Resistances", "Maximum Resistance mặc định của Elemental hoặc Chaos là 75% và không thể vượt quá 90%."],
  ["Minions", "Minions là Allies được triệu hồi, đi cùng và chiến đấu cạnh bạn. Persistent Minions thường reserve một phần Spirit khi hoạt động."],
  ["Mirrored Items", "Mirrored Items là bản sao của item gốc, thường tạo bởi Mirror of Kalandra hoặc nguồn Mirror khác. Hầu hết cách craft/chỉnh sửa item không dùng được trên Mirrored item."],
  ["Monster Modifiers", "Magic và Rare Monsters có thể có Monster Modifier khiến chúng nguy hiểm hơn. Magic Monster thường có một Modifier, còn Rare Monster có thể có nhiều Modifier."],
  ["Offering Skills", "Offering Skills nhắm vào Skeleton Minion đang hoạt động để tạo Offering Spike. Offering Spike cho Buff cho bạn hoặc Minions, có thể gây Damage trực tiếp lên Enemies, và mất hiệu ứng nếu bị phá hủy."],
  ["Omens", "Omens là Currency item mở các hiệu ứng meta-crafting riêng, phục vụ craft chuyên sâu hơn."],
  ["Onslaught", "Onslaught cho 20% increased Skill Speed và 10% increased Movement Speed. Nếu không ghi khác, Onslaught tồn tại 4 giây."],
  ["Parried", "Parried khiến kẻ địch bị Parry bởi Buckler nhận thêm Attack Damage và không thể Evade Attack trong một khoảng thời gian."],
  ["Parry", "Parry là Skill từ Buckler cho phép Block rồi phản kích Strike hoặc Projectile của kẻ địch, khiến mục tiêu mất thăng bằng và nhận Parried Debuff."],
  ["Persistent Skills", "Persistent Skills được bật/tắt trong Skills Panel thay vì bấm dùng như skill thường, và thường cần Reserve Spirit để hoạt động."],
  ["Physical Damage", "Sát thương vật lý."],
  ["Player Heavy Stun", "Người chơi và Minions thường không bị Heavy Stun, trừ khi cơ chế cụ thể cho phép nhận Heavy Stun buildup trong lúc đang giơ Shield, Parry bằng Buckler hoặc cưỡi mount."],
  ["Player Stun Threshold", "Stun Threshold cơ bản của người chơi bằng Maximum Life. Hit gây Damage bằng hoặc vượt Stun Threshold sẽ chắc chắn Stun; chance giảm tuyến tính với Hit thấp hơn và dưới 10% được tính là 0%."],
  ["Presence", "Presence là vùng quanh nhân vật nơi một số hiệu ứng như Aura được áp dụng. Mặc định bán kính 4 mét; kích thước vùng này chịu Presence Area modifier, không chịu Skill Area modifier."],
  ["Purple Flame of Chayula", "Purple Flame of Chayula cho Buff cộng 7% Damage as extra Chaos Damage, stack tối đa 10 lần."],
  ["Quarterstaves", "Quarterstaves là vũ khí Two-Handed Melee yêu cầu Dexterity và Intelligence. Quarterstaff Attack thường thiên về độ cơ động cao trong combat."],
  ["Quivers", "Quivers là off hand item chỉ dùng được khi đang cầm Bow, cho nhiều bonus cho Bow Attack."],
  ["Rarity", "Item hoặc monster rarity gồm Normal (grey), Magic (blue), Rare (yellow) và Unique (brown). Monster có rarity cao hơn thường khó hơn."],
  ["Recoup", "Recoup hồi lại một phần resource trong 8 giây dựa trên Damage bạn nhận từ Hit."],
  ["Sacrifice", "Sacrifice là mất resource như Life, Mana hoặc Energy Shield nhưng không tính là nhận Damage. Không thể Sacrifice resource bạn không có; Sacrifice Life của bản thân không thể làm Life xuống dưới 1."],
  ["Sceptres", "Sceptres là vũ khí One-Handed yêu cầu Strength và Intelligence, có thể cầm main hand hoặc off hand nhưng không thể Dual Wield hai Sceptres. Chúng không dùng để Attack trực tiếp, thay vào đó cho Spirit và bonus cho Allies."],
  ["Shields", "Shields là armour item cầm ở off hand. Khi cầm Shield bạn có chance Block thụ động; nhiều Shield có thể giơ lên để Block Strike và Projectile từ phía trước. Buckler là Shield đặc biệt dùng Parry thay vì giơ Block."],
  ["Shroud Walker", "Shroud Walker cho Monster dịch chuyển định kỳ tới kẻ địch nhìn thấy, để lại Smoke Cloud tại vị trí rời đi và vị trí tới."],
  ["Slow Resistant", "Slow Resistant khiến Monster giảm hiệu lực của các Debuff làm chậm đang áp lên nó."],
  ["Slow", "Slow là modifier từ Debuff khiến hành động mất nhiều thời gian hơn. Nếu không ghi rõ loại Slow, nó áp lên toàn bộ hành động của mục tiêu; các Slow nhân với nhau và bị giảm hiệu lực trên monster rarity cao."],
  ["Soul Core", "Soul Core là artifact của Vaal cổ đại và hoạt động như một loại Augment."],
  ["Soul Eater", "Soul Eater cho 1% increased Skill Speed trong 4 giây khi kẻ địch chết trong Presence của bạn, stack tối đa 50 lần; nếu không nhận stack mới trong 4 giây thì mỗi 0.5 giây mất một stack."],
  ["Stat Totals", "Total của một stat là giá trị sau khi hoàn tất mọi phép tính. Modifier áp lên Total được tính sau các modifier khác."],
  ["Staves", "Staves là vũ khí Two-Handed Spellcasting yêu cầu Intelligence. Staff không dùng để Attack, nhưng cho Spell tích hợp theo loại staff và bonus mạnh cho Spell."],
  ["Stun", "Stun ngắt hành động hiện tại của mục tiêu trong thời gian ngắn. Light Stun có thể xảy ra từ Hit theo Damage gây ra; Heavy Stun xảy ra khi thanh Stun đầy và kéo dài lâu hơn."],
  ["Thorns", "Thorns Damage là một dạng Hit Damage phản lại Melee Attack Hit vào kẻ địch đã đánh bạn. Nó không phải Attack Damage hay Spell Damage, nên không hưởng modifier riêng của hai loại đó."],
  ["Thorny Ground", "Thorny Ground gây Spell Damage khi được tạo, sau đó tiếp tục gây Damage lên kẻ địch di chuyển qua vùng đó, tối đa hai lần mỗi giây."],
  ["Triggered Skills", "Triggered Skill kích hoạt ngay lập tức, không cần Attack Time hoặc Cast Time, và thường nhắm vào nguồn gây trigger. Triggering không được tính là tự dùng skill."],
  ["Unique Culture", "Unique Culture là biểu tượng văn hóa trên tooltip Unique item, gợi ý item đó gắn với một nền văn hóa và có thể có cơ chế thao tác riêng."],
  ["Unleash", "Unleash cho Spell tích lũy Seal để lặp lại khi cast. Mỗi Spell mặc định có giới hạn 2 Seal."],
  ["Wands", "Wands là vũ khí One-Handed Spellcasting yêu cầu Intelligence, không thể Dual Wield và không dùng để Attack trực tiếp. Wand cho Spell tích hợp theo loại wand và bonus cho Spell."]
]) {
  exactDescriptions.set(term, meaning);
}

const SKILL_TAG_MEANINGS = new Map([
  ["Chaos", exactDescriptions.get("Chaos")],
  ["Channelling", exactDescriptions.get("Channelling")],
  ["Persistent", exactDescriptions.get("Persistent")],
  ["Staged", exactDescriptions.get("Staged")],
  ["Sustained", exactDescriptions.get("Sustained")],
  ["AoE", "AoE là tag cho skill có Area of Effect, tức tác động trong một vùng thay vì chỉ một mục tiêu."],
  ["Ammunition", "Ammunition là tag cho skill đạn của Crossbow hoặc cơ chế nạp/đổi loại đạn."],
  ["Attack", exactDescriptions.get("Attack")],
  ["Aura", "Aura là tag cho skill tạo hiệu ứng quanh nhân vật hoặc đồng minh trong phạm vi."],
  ["Buff", "Buff là tag cho skill tạo hiệu ứng có lợi hoặc trạng thái hỗ trợ."],
  ["Curse", "Curse là tag cho skill nguyền rủa, đặt Debuff mạnh lên enemy."],
  ["Duration", "Duration là tag cho skill có thời lượng tồn tại hoặc hiệu ứng kéo dài."],
  ["Fire", "Fire là tag cho skill liên quan Fire damage hoặc Fire effect."],
  ["Cold", "Cold là tag cho skill liên quan Cold damage, Chill hoặc Freeze."],
  ["Lightning", "Lightning là tag cho skill liên quan Lightning damage hoặc Shock."],
  ["Physical", "Physical là tag cho skill liên quan Physical damage."],
  ["Projectile", "Projectile là tag cho skill bắn hoặc phóng vật thể bay."],
  ["Melee", "Melee là tag cho skill cận chiến, thường dùng weapon range và vị trí đứng gần mục tiêu."],
  ["Spell", "Spell là tag cho skill dùng spell stat riêng, không lấy base damage từ weapon trừ khi skill ghi rõ."],
  ["Minion", "Minion là tag cho skill tạo hoặc tương tác với đồng minh được triệu hồi."],
  ["Totem", "Totem là tag cho skill dựng Totem để cast hoặc attack thay nhân vật."],
  ["Trigger", "Trigger là tag cho skill hoặc effect tự kích hoạt khi đạt điều kiện."],
  ["Meta", "Meta là tag cho skill dùng để chứa, trigger hoặc điều phối skill khác."]
]);

const preferredTermByKeyword = new Map([
  ["Attack", "Attack"]
]);

export const hasDirtyEnglishDescription = (value = "") => /\b(are|is|was|were|can|cannot|can't|will|does|do|has|have|had|grants?|creates?|deals?|takes?|used|include|includes|provide|provides|require|requires|equipped|applies|affects|causes?|allows?|prevents?|reduces?|increases?|modifies|consumed|converted|socketed|recovered|releases|moves?|explodes?|standing|fights|count|placed|replaced|removed|listed|lowers|brings|benefitting|using|changes|scales?|summed|performing|determine|need|appears|gaining|lasts|expires|drains|target's|your|their|them|that|which|while|when|where|within|against|from|into|onto|instead|towards|upon|after|before|during|usually|more|less|higher|lower|twice|current|default|single|multiple|various|certain|other|any|all|some|these)\b/i
  .test(normalizeGlossaryText(value));

const normalizeStatText = (value = "") => normalizeGlossaryText(value)
  .replace(/\blife\b/gi, "Life")
  .replace(/\bdamage\b/gi, "Damage")
  .replace(/\bmovement speed\b/gi, "Movement Speed")
  .replace(/\bskill speed\b/gi, "Skill Speed")
  .replace(/\bcritical hit\b/gi, "Critical Hit")
  .replace(/\bcritical damage bonus\b/gi, "Critical Damage Bonus")
  .replace(/\bstun threshold\b/gi, "Stun Threshold")
  .replace(/\bstun buildup\b/gi, "Stun buildup");

const translateGrantClause = (value = "") => {
  const clean = normalizeStatText(value);
  let match = clean.match(/^(\d+(?:\.\d+)?)% increased (.+)$/i);
  if (match) return `${match[1]}% tăng ${normalizeStatText(match[2])}`;
  match = clean.match(/^(\d+(?:\.\d+)?)% of Maximum Life as added Energy Shield$/i);
  if (match) return `Energy Shield cộng thêm bằng ${match[1]}% Maximum Life`;
  return clean;
};

const translateStructuredKeywordDescription = (description = "") => {
  const clean = normalizeGlossaryText(description);
  let match = clean.match(/^Monster has (\d+(?:\.\d+)?)% increased (.+)\.?$/i);
  if (match) return `Monster có ${match[1]}% tăng ${normalizeStatText(match[2])}.`;

  match = clean.match(/^Monster has (\d+(?:\.\d+)?)% reduced (.+)\.?$/i);
  if (match) return `Monster có ${match[1]}% giảm ${normalizeStatText(match[2])}.`;

  match = clean.match(/^Hits against this Monster have (\d+(?:\.\d+)?)% reduced (.+)\.?$/i);
  if (match) return `Hit lên Monster này có ${match[1]}% giảm ${normalizeStatText(match[2])}.`;

  match = clean.match(/^Monster gains extra Armour based off of their Strength\.?$/i);
  if (match) return "Monster nhận thêm Armour dựa trên Strength.";

  match = clean.match(/^Monster gains extra Evasion based off of their Dexterity\.?$/i);
  if (match) return "Monster nhận thêm Evasion dựa trên Dexterity.";

  match = clean.match(/^Monster Breaks Armour equal to (\d+(?:\.\d+)?)% of Physical Damage dealt\.?$/i);
  if (match) return `Monster gây Armour Break bằng ${match[1]}% Physical Damage đã gây.`;

  match = clean.match(/^Monster Gains (\d+(?:\.\d+)?)% of damage as extra (Fire|Cold|Lightning|Chaos) damage\.?$/i);
  if (match) return `Monster nhận thêm ${match[1]}% Damage dưới dạng ${match[2]} Damage.`;

  match = clean.match(/^Monster's Pack Minions have (\d+(?:\.\d+)?)% increased Damage and (\d+(?:\.\d+)?)% increased Life\.?$/i);
  if (match) return `Pack Minions của Monster có ${match[1]}% tăng Damage và ${match[2]}% tăng Life.`;

  match = clean.match(/^(\d+(?:\.\d+)?)% of damage taken from Monster is taken from Monster's Pack Minions instead\.?$/i);
  if (match) return `${match[1]}% Damage nhận từ Monster được chuyển sang Pack Minions của Monster.`;

  match = clean.match(/^Affects how quickly Energy Shield is recovered by Recharge once it starts Recharging\.?$/i);
  if (match) return "Quyết định tốc độ Energy Shield hồi lại sau khi Recharge đã bắt đầu.";

  match = clean.match(/^Affects the delay before your Energy Shield starts Recharging after losing Energy Shield\.?$/i);
  if (match) return "Quyết định độ trễ trước khi Energy Shield bắt đầu Recharge sau khi bị mất.";

  match = clean.match(/^Monster creates circular walls of Fire that deal damage to enemies standing in them\.?$/i);
  if (match) return "Monster tạo vòng tường Fire, gây Damage cho kẻ địch đứng bên trong.";

  match = clean.match(/^Monster creates circular walls of Ice around enemies\.?$/i);
  if (match) return "Monster tạo vòng tường Ice bao quanh kẻ địch.";

  match = clean.match(/^Monster creates an Aura that grants (.+) to Allies within ([\d.]+) metres\.?$/i);
  if (match) return `Monster tạo Aura cho Allies trong phạm vi ${match[2]} mét, cho ${translateGrantClause(match[1])}.`;

  match = clean.match(/^Monster creates an Aura that Hinders enemies within ([\d.]+) metres\.?$/i);
  if (match) return `Monster tạo Aura gây Hinder lên kẻ địch trong phạm vi ${match[1]} mét.`;

  match = clean.match(/^Monster creates an Aura that removes (\d+) Flask and Charm charges from enemies every (\d+) seconds within ([\d.]+) metres\.?$/i);
  if (match) return `Monster tạo Aura xóa ${match[1]} Flask và Charm charge của kẻ địch mỗi ${match[2]} giây trong phạm vi ${match[3]} mét.`;

  match = clean.match(/^Monster creates an Aura that Debuffs enemies within ([\d.]+) metres, causing their Life and Energy Shield to not be able to recover past (\d+)%\.?$/i);
  if (match) return `Monster tạo Aura Debuff kẻ địch trong phạm vi ${match[1]} mét, khiến Life và Energy Shield không thể hồi vượt ${match[2]}%.`;

  match = clean.match(/^Monster creates an Aura that Debuffs Enemies within ([\d.]+) metres; Slowing by (\d+)%, making effects expire (\d+)% slower and reducing Cooldown Recovery Rate by (\d+)%\.?$/i);
  if (match) return `Monster tạo Aura Debuff Enemies trong phạm vi ${match[1]} mét: gây Slow ${match[2]}%, làm hiệu ứng hết hạn chậm hơn ${match[3]}% và giảm Cooldown Recovery Rate ${match[4]}%.`;

  match = clean.match(/^Monster releases a nova that makes Allies invulnerable for (\d+) seconds while the monster is alive within (\d+) metres every (\d+) seconds\.?$/i);
  if (match) return `Monster phát nova mỗi ${match[3]} giây, khiến Allies trong phạm vi ${match[2]} mét Invulnerable trong ${match[1]} giây khi Monster còn sống.`;

  match = clean.match(/^Monster releases a nova that reduces Enemy Life and Energy Shield Recovery Rate by (\d+)% and causes Allies to Regenerate ([\d.]+)% of Maximum Life per second for (\d+) seconds within (\d+) metres every (\d+) seconds\.?$/i);
  if (match) return `Monster phát nova mỗi ${match[5]} giây trong phạm vi ${match[4]} mét: giảm ${match[1]}% Life và Energy Shield Recovery Rate của Enemy, đồng thời cho Allies Regenerate ${match[2]}% Maximum Life mỗi giây trong ${match[3]} giây.`;

  match = clean.match(/^Monster periodically creates (Powerful )?Volatile Crag that moves towards enemies; exploding when they get close enough; dealing Fire Damage\.?$/i);
  if (match) return `Monster định kỳ tạo ${match[1] || ""}Volatile Crag lao tới kẻ địch và nổ khi đến gần, gây Fire Damage.`;

  match = clean.match(/^Monster periodically creates (Powerful )?Volatile Plants, releasing orbs that move towards enemies; exploding when they get close enough; dealing Chaos Damage\.?$/i);
  if (match) return `Monster định kỳ tạo ${match[1] || ""}Volatile Plants, phóng orb lao tới kẻ địch và nổ khi đến gần, gây Chaos Damage.`;

  match = clean.match(/^Monster creates a Mirage when Hit that moves towards enemies and explodes when it gets close enough, dealing Lightning Damage\.?$/i);
  if (match) return "Khi bị Hit, Monster tạo một Mirage lao tới kẻ địch và nổ khi đến gần, gây Lightning Damage.";

  match = clean.match(/^Monster creates Mirages when Hit that move towards enemies and explode when they get close enough, dealing Lightning Damage\.?$/i);
  if (match) return "Khi bị Hit, Monster tạo nhiều Mirage lao tới kẻ địch và nổ khi đến gần, gây Lightning Damage.";

  match = clean.match(/^Monster creates a 90% damage absorption barrier that explodes after taking a certain amount of damage, dealing Fire Damage\.?$/i);
  if (match) return "Monster tạo barrier hấp thụ 90% Damage; barrier nổ sau khi nhận đủ Damage và gây Fire Damage.";

  match = clean.match(/^Monster periodically Enrages; gaining (\d+)% increased Damage, (\d+)% increased Skill and Movement Speed and (\d+)% less damage taken for (\d+) seconds every (\d+) seconds\.?$/i);
  if (match) return `Monster định kỳ Enrage mỗi ${match[5]} giây trong ${match[4]} giây: tăng ${match[1]}% Damage, tăng ${match[2]}% Skill và Movement Speed, đồng thời nhận ít hơn ${match[3]}% Damage.`;

  match = clean.match(/^Monster cannot be Stunned\.?$/i);
  if (match) return "Monster không thể bị Stun.";

  match = clean.match(/^Monster cannot be damaged by enemies any further than ([\d.]+) metres from them\.?$/i);
  if (match) return `Monster không thể bị kẻ địch cách xa hơn ${match[1]} mét gây Damage.`;

  match = clean.match(/^Monster creates a circular effect that drains Mana and deals Lightning Damage over time to enemies near the edge of the circle\.?$/i);
  if (match) return "Monster tạo vùng tròn hút Mana và gây Lightning Damage over Time lên kẻ địch gần rìa vòng.";

  match = clean.match(/^Monster creates Volatile Crystals when Hit, which explode upon the Monster's death, dealing Chaos damage\.?$/i);
  if (match) return "Khi bị Hit, Monster tạo Volatile Crystals; các Crystal nổ khi Monster chết và gây Chaos Damage.";

  return "";
};

export const translateKeywordDescription = (title = "", description = "") => {
  const cleanTitle = normalizeGlossaryText(title);
  const cleanDescription = normalizeGlossaryText(description);
  if (exactDescriptions.has(cleanTitle)) return exactDescriptions.get(cleanTitle);
  if (!cleanDescription) return "";
  const structured = translateStructuredKeywordDescription(cleanDescription);
  if (structured) return structured;
  const translated = cleanDescription
    .replace(/\bItems\b/g, "Item")
    .replace(/\bModifiers\b/g, "Modifier")
    .replace(/\bmodifiers\b/g, "modifier")
    .replace(/\bDamage\b/g, "Damage")
    .replace(/\bdamage\b/g, "damage")
    .replace(/\bcan be\b/g, "có thể được")
    .replace(/\bwith\b/g, "với")
    .replace(/\band\b/g, "và")
    .replace(/\bor\b/g, "hoặc");
  return hasDirtyEnglishDescription(translated) ? fallbackKeywordMeaning(cleanTitle) : translated;
};

const inferCategory = (term = "", keyword = "") => {
  const haystack = `${term} ${keyword}`.toLowerCase();
  if (/\b(breach|ritual|expedition|delirium|abyss|atlas|map|maps|boss|tablet|tablets|precursor|waystone|waystones)\b/.test(haystack)) {
    return "endgame";
  }
  if (/\b(normal|magic|rare|unique|rarity|item|quality|modifier|socket|currency|weapon|armour|jewel|quiver|waystone)\b/.test(haystack)) {
    return "item";
  }
  if (/\b(fire|cold|lightning|chaos|physical|damage|ailment|bleed|poison|ignite|shock|freeze|chill|critical)\b/.test(haystack)) {
    return "damage";
  }
  if (/\b(life|mana|spirit|rage|charge|energy shield|reservation)\b/.test(haystack)) {
    return "resource";
  }
  if (/\b(armour|evasion|block|resistance|defence|defense)\b/.test(haystack)) {
    return "defense";
  }
  if (/\b(skill|attack|spell|minion|totem|aura|buff|curse|mark|projectile|melee|strike|slam)\b/.test(haystack)) {
    return "skill";
  }
  return "combat";
};

const uniqueSorted = (values = []) => [...new Set(values.map(normalizeGlossaryText).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, "en"));

const exactFallbackMeanings = new Map([
  ["Aftershock", "Aftershock là nhịp sát thương phụ xảy ra sau cú đánh chính, thường gặp ở Slam hoặc kỹ năng tạo chấn động. Nó có thể Hit lần nữa tại vùng tác động nên rất quan trọng với build đánh diện rộng."],
  ["Aggravate", "Aggravate làm Bleeding trở nên nguy hiểm hơn, thường khiến mục tiêu chịu phần sát thương Bleed như khi đang di chuyển hoặc làm hiệu ứng Bleed mạnh hơn tùy nguồn."],
  ["Ancestral Boost", "Ancestral Boost là trạng thái cường hóa gắn với nhóm kỹ năng/totem mang tính tổ tiên, giúp đòn đánh hoặc hiệu ứng liên quan mạnh hơn trong một thời gian ngắn."],
  ["Ancestrally Boosted", "Ancestrally Boosted nghĩa là kỹ năng hoặc đòn đánh đang được Ancestral Boost cường hóa."],
  ["Barrageable", "Barrageable là nhãn cho kỹ năng có thể bắn theo loạt hoặc tương tác với cơ chế Barrage, thường liên quan Projectile và nhiều phát liên tiếp."],
  ["Base Skill Attack Time", "Base Skill Attack Time là thời gian tấn công cơ bản của kỹ năng trước khi cộng/trừ Attack Speed. Chỉ số càng thấp thì kỹ năng đánh càng nhanh."],
  ["Blind", "Blind làm mục tiêu kém chính xác hơn, khiến Attack của chúng dễ hụt hơn. Đây là Debuff phòng thủ rất hữu ích khi đối đầu quái đánh bằng Attack."],
  ["Blinding", "Blinding là hành động gây Blind lên mục tiêu."],
  ["Block Chance", "Block Chance là tỉ lệ chặn Hit đi vào. Khi Block thành công, Damage của Hit bị chặn nhưng một số hiệu ứng phụ vẫn có thể xảy ra tùy cơ chế."],
  ["Break Armour", "Break Armour là hành động làm giảm Armour của mục tiêu. Khi Armour bị phá về 0, mục tiêu thường rơi vào trạng thái Fully Broken và chịu Physical Damage tốt hơn."],
  ["Chain", "Chain cho Projectile hoặc hiệu ứng bật sang mục tiêu khác sau khi Hit. Số Chain càng cao thì kỹ năng càng dọn nhóm quái tốt hơn."],
  ["Chaining", "Chaining là cơ chế cho Projectile hoặc hiệu ứng bật nối tiếp sang mục tiêu khác sau khi Hit."],
  ["Conditional", "Conditional là nhãn cho kỹ năng chỉ phát huy đầy đủ khi thỏa điều kiện cụ thể, ví dụ mục tiêu đang bị Debuff, ở trạng thái đặc biệt hoặc bạn đã chuẩn bị setup trước."],
  ["Consume", "Consume nghĩa là tiêu thụ một tài nguyên/trạng thái như Charge, Corpse, Infusion hoặc buff để kích hoạt hiệu ứng mạnh hơn."],
  ["Convert", "Convert là chuyển một phần Damage hoặc tài nguyên từ dạng này sang dạng khác. Sau khi Convert, phần đó thường scaling theo loại mới."],
  ["Cooldown Recovery Rate", "Cooldown Recovery Rate làm kỹ năng hồi cooldown nhanh hơn. Chỉ số này ảnh hưởng trực tiếp tới nhịp dùng lại skill có cooldown."],
  ["Corpse", "Corpse là xác quái/người chơi để lại sau khi chết, có thể bị Consume, Detonate hoặc dùng làm điều kiện cho một số kỹ năng."],
  ["Corrupted Blood", "Corrupted Blood là Debuff cộng dồn gây Physical Damage over Time lên nhân vật. Càng nhiều stack thì mất Life càng nhanh, thường cần Flask hoặc miễn nhiễm Corrupted Blood để xử lý."],
  ["Cull", "Cull kết liễu mục tiêu ngay khi Life của mục tiêu xuống dưới ngưỡng nhất định, bỏ qua phần máu còn lại."],
  ["Daze", "Daze làm mục tiêu bị gián đoạn nhịp hành động, thường dùng như một Debuff kiểm soát."],
  ["Dazed", "Dazed là trạng thái đang bị Daze, khiến hành động hoặc phản ứng của mục tiêu bị suy giảm tùy nguồn gây hiệu ứng."],
  ["Debuff", "Debuff là hiệu ứng bất lợi đặt lên mục tiêu, ví dụ giảm chỉ số, làm chậm, tăng Damage nhận vào hoặc khóa một phần khả năng hồi phục."],
  ["Detonate", "Detonate kích nổ đối tượng như Corpse, Grenade, Crystal hoặc hiệu ứng đã đặt sẵn để gây Damage hoặc tạo hiệu ứng vùng."],
  ["Detonated", "Detonated nghĩa là đối tượng đã bị kích nổ."],
  ["Detonator", "Detonator là nhãn cho kỹ năng dùng để kích nổ Grenade, Corpse, Crystal hoặc hiệu ứng đã đặt trước."],
  ["Dual Wielding", "Dual Wielding là đang cầm hai vũ khí một tay. Một số skill, passive hoặc modifier chỉ hoạt động khi bạn Dual Wield."],
  ["Electrocute", "Electrocute là Ailment Lightning có thể làm mục tiêu bị khóa hành động trong thời gian ngắn sau khi tích đủ buildup."],
  ["Element", "Element chỉ ba loại nguyên tố chính: Fire, Cold và Lightning."],
  ["Empower", "Empower cường hóa kỹ năng hoặc hiệu ứng tiếp theo, thường bằng cách tiêu thụ Charge/tài nguyên để tăng Damage hoặc thêm thuộc tính."],
  ["Energy", "Energy là tài nguyên tích lũy dùng cho một số Meta skill hoặc Trigger, thường được nạp khi điều kiện chiến đấu xảy ra rồi tiêu thụ để kích hoạt skill."],
  ["Enraged", "Enraged là trạng thái cuồng nộ, thường làm quái hoặc nhân vật tăng Damage/tốc độ nhưng có thể đi kèm rủi ro."],
  ["Evade", "Evade là né tránh Hit từ Attack. Khi Evade thành công, Hit đó không gây Damage lên bạn."],
  ["Fork", "Fork làm Projectile tách thành nhiều Projectile mới sau khi Hit mục tiêu, giúp mở rộng vùng clear."],
  ["Frozen", "Frozen là trạng thái bị đóng băng, khiến mục tiêu không thể hành động cho đến khi hiệu ứng kết thúc hoặc bị phá."],
  ["Heavy Stun", "Heavy Stun là dạng Stun mạnh, khóa hành động lâu hơn và thường kích hoạt các hiệu ứng cần mục tiêu bị choáng nặng."],
  ["Hinder", "Hinder là Debuff làm chậm Movement Speed của mục tiêu."],
  ["Impale", "Impale găm một phần Physical Hit lên mục tiêu; các Hit sau có thể khai thác phần đã găm để gây thêm Damage."],
  ["Invocation", "Invocation là cơ chế tích trữ hoặc gọi ra kỹ năng/hiệu ứng đã chuẩn bị, thường hoạt động như một dạng meta skill kích hoạt theo điều kiện."],
  ["Knock Back", "Knock Back đẩy mục tiêu ra xa khỏi nguồn Hit hoặc hiệu ứng."],
  ["Leech", "Leech hồi Life, Mana hoặc Energy Shield theo một phần Damage bạn gây ra trong thời gian ngắn."],
  ["Low Life", "Low Life là trạng thái Life thấp dưới ngưỡng nhất định, thường dùng để kích hoạt passive, unique hoặc modifier đặc biệt."],
  ["Maim", "Maim làm mục tiêu chậm lại và thường liên quan đến Physical Attack."],
  ["Merging", "Merging là cơ chế hợp nhất nhiều thực thể, stack hoặc hiệu ứng thành một hiệu ứng lớn hơn."],
  ["Overkill", "Overkill là phần Damage vượt quá lượng Life còn lại khi bạn kết liễu mục tiêu. Một số hiệu ứng dùng lượng Overkill để nổ lan hoặc hồi tài nguyên."],
  ["Overwhelm", "Overwhelm bỏ qua hoặc xuyên qua một phần phòng thủ của mục tiêu, thường là Physical Damage Reduction hoặc Armour."],
  ["Payoff", "Payoff là nhãn cho kỹ năng tiêu thụ setup/điều kiện đã chuẩn bị để tạo hiệu ứng mạnh hơn ở nhịp kết thúc."],
  ["Penetrate", "Penetrate bỏ qua một phần Resistance của mục tiêu khi tính Damage, giúp Hit thuộc loại đó gây sát thương hiệu quả hơn."],
  ["Pierce", "Pierce cho Projectile xuyên qua mục tiêu sau khi Hit để tiếp tục bay và có thể Hit mục tiêu phía sau."],
  ["Pin", "Pin giữ mục tiêu tại chỗ hoặc hạn chế di chuyển, thường là hiệu ứng kiểm soát vị trí."],
  ["Recharge", "Recharge là cơ chế hồi Energy Shield sau một khoảng trễ khi bạn không tiếp tục mất Energy Shield."],
  ["Return", "Return làm Projectile quay ngược về phía nguồn bắn sau khi đi hết đường hoặc sau một điều kiện nhất định."],
  ["Revive", "Revive hồi sinh đồng minh, minion hoặc thực thể đã chết tùy cơ chế."],
  ["Shatter", "Shatter làm mục tiêu bị vỡ khi chết trong trạng thái Frozen hoặc dưới hiệu ứng Cold phù hợp, thường ngăn xác để lại Corpse."],
  ["Shattered", "Shattered nghĩa là mục tiêu đã bị Shatter."],
  ["Shapeshift", "Shapeshift là nhãn cho kỹ năng biến đổi hình thái, đổi bộ kỹ năng hoặc trạng thái chiến đấu của nhân vật."],
  ["Shocked Ground", "Shocked Ground là vùng mặt đất gây Shock hoặc làm mục tiêu đứng trên đó chịu ảnh hưởng Lightning bất lợi."],
  ["Skill Speed", "Skill Speed ảnh hưởng tốc độ thực hiện kỹ năng, bao gồm các thao tác như Attack, Cast hoặc dùng skill tùy loại."],
  ["Slam", "Slam là nhóm kỹ năng melee đánh mạnh xuống đất hoặc vùng trước mặt, thường gây Area Damage và có thể tạo Aftershock."],
  ["Strike", "Strike là nhóm kỹ năng melee đánh trực tiếp mục tiêu gần bạn, thường mạnh ở đánh đơn mục tiêu hoặc đánh theo tầm vũ khí."],
  ["Travel", "Travel là nhãn cho kỹ năng di chuyển, dùng để lướt, nhảy, lao tới hoặc đổi vị trí trong combat."],
  ["Unarmed", "Unarmed là trạng thái không dùng vũ khí trong tay chính để tấn công. Một số skill/passive như Hollow Palm cần điều kiện này."],
  ["Volatility", "Volatility chỉ độ dao động của Damage hoặc hiệu ứng, làm kết quả có biên độ thấp-cao rõ hơn thay vì ổn định."],
  ["Weapon Set", "Weapon Set là bộ trang bị vũ khí có thể hoán đổi. POE2 cho phép gán skill hoặc passive theo từng Weapon Set, nên một số kỹ năng yêu cầu active ở cả hai Weapon Set để hoạt động đúng."],
  ["Wither", "Wither là Debuff làm mục tiêu chịu thêm Chaos Damage, thường có thể cộng dồn nhiều stack."],
  ["Withers", "Withers là hành động gây Wither hoặc các stack Wither đang áp lên mục tiêu."]
]);

const damageTypeLabel = (value = "") => ({
  fire: "Fire",
  cold: "Cold",
  lightning: "Lightning",
  chaos: "Chaos",
  physical: "Physical"
})[value.toLowerCase()] || value;

const fallbackSkillTagMeaning = (tag = "") => {
  const clean = normalizeGlossaryText(tag);
  if (!clean) return "";
  if (exactFallbackMeanings.has(clean)) return exactFallbackMeanings.get(clean);
  if (/^(bear|werewolf|wyvern)$/i.test(clean)) {
    return `${clean} là nhãn cho kỹ năng gắn với hình thái hoặc sinh vật ${clean}, dùng để lọc các kỹ năng tương tác với dạng đó.`;
  }
  if (/^(banner|herald|mark|warcry)$/i.test(clean)) {
    return `${clean} là nhãn cho nhóm skill hỗ trợ hoặc điều kiện chiến đấu cùng tên, giúp nhận diện support gem và modifier tương thích.`;
  }
  if (/^(grenade|hazard|orb|plant|storm|wind|nova|remnant)$/i.test(clean)) {
    return `${clean} là nhãn cho skill tạo thực thể hoặc vùng hiệu ứng ${clean}, thường dùng để lọc kỹ năng đặt bẫy, phóng vật thể hoặc gây Damage theo vùng.`;
  }
  if (/^(command|companion|minion|totem)$/i.test(clean)) {
    return `${clean} là nhãn cho skill điều khiển hoặc tương tác với đồng minh triệu hồi, companion, minion hay totem.`;
  }
  if (/^(conditional|payoff|detonator|barrageable|chaining|merging|shapeshift|travel)$/i.test(clean)) {
    return `${clean} là nhãn cơ chế mô tả cách skill kích hoạt, nối chuỗi, di chuyển, biến hình hoặc nhận payoff từ điều kiện khác.`;
  }
  return `${clean} là nhãn phân loại cho nhóm kỹ năng có cơ chế ${clean}. Nhãn này giúp lọc skill và xác định support/modifier nào có thể tương tác.`;
};

const skillTagMeaning = (tag = "") =>
  SKILL_TAG_MEANINGS.get(tag) || fallbackSkillTagMeaning(tag);

export const buildSkillTagGlossaryTerms = (tags = []) => uniqueSorted(tags).map((tag) => ({
  term: tag,
  keyword: tag,
  category: inferCategory(tag, tag),
  meaning: skillTagMeaning(tag),
  keep: `Giữ nguyên "${tag}" bằng tiếng Anh để khớp tooltip, filter và UI trong game.`,
  variants: [],
  examples: [tag],
  description_en: "",
  source_url: "https://poe2db.tw/us/Skill_Gems",
  hover_url: ""
}));

const glossaryTermKey = (term = "") => normalizeGlossaryText(term).toLocaleLowerCase("en-US");

export function fallbackKeywordMeaning(term = "") {
  const clean = normalizeGlossaryText(term);
  const lower = clean.toLowerCase();
  if (!clean) return "";
  if (exactFallbackMeanings.has(clean)) return exactFallbackMeanings.get(clean);
  if (/^(banner|bear|barrageable|chaining|command|companion|conditional|detonator|grenade|hazard|herald|invocation|mark|merging|nova|orb|payoff|plant|remnant|shapeshift|slam|storm|strike|travel|warcry|werewolf|wind|wyvern)$/i.test(clean)) {
    return fallbackSkillTagMeaning(clean);
  }

  const resistant = clean.match(/^(Fire|Cold|Lightning|Chaos|Physical) Resistant$/i);
  if (resistant) {
    const type = damageTypeLabel(resistant[1]);
    return `${clean} chỉ mục tiêu có khả năng kháng ${type} cao hơn bình thường, vì vậy ${type} Damage kém hiệu quả hơn khi đánh vào mục tiêu đó.`;
  }

  const infused = clean.match(/^(Fire|Cold|Lightning|Chaos|Physical)-Infused$/i);
  if (infused) {
    const type = damageTypeLabel(infused[1]);
    return `${clean} là trạng thái được truyền ${type}, thường làm đòn đánh hoặc kỹ năng gây thêm ${type} Damage hoặc nhận hiệu ứng phụ thuộc ${type}.`;
  }

  if (/aura$/i.test(clean)) {
    return `${clean} là Aura tác động trong phạm vi quanh nguồn phát, thường buff đồng minh hoặc debuff kẻ địch tùy mô tả modifier.`;
  }
  if (/ground|surface/i.test(clean)) {
    return `${clean} là hiệu ứng mặt đất. Đơn vị đứng trong vùng đó sẽ chịu Damage, Ailment hoặc Debuff tương ứng với loại hiệu ứng.`;
  }
  if (/critical|crit/i.test(clean)) {
    return `${clean} là thuật ngữ liên quan đến Critical Hit, dùng để tính tỉ lệ chí mạng, Damage chí mạng hoặc điều kiện khi Hit chí mạng.`;
  }
  if (/armou?r|block|evad|resistance|defence|defense/i.test(clean)) {
    return `${clean} là thuật ngữ phòng thủ, ảnh hưởng cách nhân vật hoặc monster giảm, chặn, né hoặc chịu Damage.`;
  }
  if (/life|mana|energy shield|charge|rage|spirit|reservation/i.test(clean)) {
    return `${clean} là thuật ngữ tài nguyên/trạng thái, thường dùng làm điều kiện kích hoạt hoặc giới hạn hồi phục, tiêu hao và tích lũy.`;
  }
  if (/weapon|mace|spear|quarterstaff|buckler|charm|oil|orb|item|jewel|quiver/i.test(clean)) {
    return `${clean} là thuật ngữ trang bị hoặc craft, thường dùng để chỉ loại item, nhóm vũ khí hoặc điều kiện áp dụng modifier/currency.`;
  }
  if (/skill|attack|spell|cooldown|cast|projectile|chain|fork|pierce|return|nova|slam|strike|warcry|trigger/i.test(clean)) {
    return `${clean} là thuật ngữ kỹ năng, mô tả cách skill được dùng, hồi lại, bắn ra, lan mục tiêu hoặc tương tác với support/modifier.`;
  }
  if (/damage|fire|cold|lightning|chaos|physical|ailment|bleed|poison|ignite|shock|freeze|chill|wither/i.test(clean)) {
    return `${clean} là thuật ngữ sát thương hoặc Ailment, dùng để xác định loại Damage, trạng thái bất lợi hoặc cách hiệu ứng scaling trên mục tiêu.`;
  }
  if (/(ed|ing|ate|ify|stun|daze|maim|hinder|pin|cull|kill|detonate|consume)$/i.test(lower)) {
    return `${clean} là hành động hoặc trạng thái chiến đấu. Khi xuất hiện trong tooltip, nó thường là điều kiện kích hoạt hoặc hiệu ứng đang áp lên mục tiêu.`;
  }
  return `${clean} là thuật ngữ cơ chế trong POE2, dùng để mô tả một hiệu ứng, điều kiện hoặc nhóm tương tác trên skill, item và monster modifier.`;
}

const mergeTermRecords = (records = []) => {
  const byTerm = new Map();
  for (const record of records) {
    const key = glossaryTermKey(record.term);
    if (!key) continue;
    const current = byTerm.get(key);
    if (!current) {
      byTerm.set(key, {
        ...record,
        variants: uniqueSorted(record.variants || []).filter((variant) => glossaryTermKey(variant) !== key),
        examples: uniqueSorted(record.examples || [])
      });
      continue;
    }

    const variants = uniqueSorted([
      ...(current.variants || []),
      ...(record.variants || []),
      ...(current.examples || []),
      ...(record.examples || [])
    ]).filter((variant) => glossaryTermKey(variant) !== key);

    byTerm.set(key, {
      ...current,
      keyword: current.keyword || record.keyword,
      category: current.category || record.category,
      meaning: current.meaning || record.meaning,
      keep: current.keep || record.keep,
      variants,
      examples: variants.slice(0, 6),
      description_en: current.description_en || record.description_en || "",
      source_url: current.source_url || record.source_url || "",
      hover_url: current.hover_url || record.hover_url || ""
    });
  }

  return [...byTerm.values()].sort((a, b) => a.term.localeCompare(b.term, "en"));
};

export const buildGlossaryTerms = (references = [], hoverByUrl = new Map()) => {
  const grouped = new Map();
  for (const ref of references) {
    const key = ref.keyword || ref.hover_url || ref.label;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(ref);
  }

  const records = [...grouped.entries()].map(([keyword, refs]) => {
    const hover = refs.map((ref) => hoverByUrl.get(ref.hover_url)).find(Boolean) || {};
    const crawledTerm = normalizeGlossaryText(hover.title) || uniqueSorted(refs.map((ref) => ref.label))[0] || keyword;
    const term = preferredTermByKeyword.get(keyword) || crawledTerm;
    const variants = uniqueSorted([crawledTerm, ...refs.map((ref) => ref.label)])
      .filter((label) => glossaryTermKey(label) !== glossaryTermKey(term));
    const meaning = translateKeywordDescription(term, hover.description_en) || fallbackKeywordMeaning(term);
    return {
      term,
      keyword,
      category: inferCategory(term, keyword),
      meaning,
      keep: `Giữ nguyên "${term}" bằng tiếng Anh để khớp tooltip, modifier và UI trong game.`,
      variants,
      examples: variants.slice(0, 6),
      description_en: hover.description_en || "",
      source_url: refs.find((ref) => ref.href)?.href || "",
      hover_url: refs.find((ref) => ref.hover_url)?.hover_url || ""
    };
  });

  return mergeTermRecords(records);
};

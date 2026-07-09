import { readFileSync, writeFileSync } from 'node:fs';

// Load boss data
global.window = {};
await import(new URL('../../public/data/boss-data.js', import.meta.url).href);
await import(new URL('../../public/data/boss-images.js', import.meta.url).href);

const bossDetails = global.window.POE2_BOSS_DETAILS;
const bossImages = global.window.POE2_BOSS_IMAGES;

const combinedConfigs = {
  "breach": {
    name: "Chuỗi Boss Breach",
    group: "Breach",
    source: "https://game8.co/games/Path-of-Exile-2/archives/488754",
    overview: "Breach là cơ chế thử thách thời gian và mật độ quái vật. Bằng cách thu thập Breach Splinter từ các vết nứt (Breach) trong map, bạn ghép thành Breachstone để tiến vào Twisted Domain đối đầu với Xesht, We That Are One.",
    flow: [
      "Mở các vết nứt (Breach) trong Atlas Map để thu thập Breach Splinters.",
      "Hợp nhất 300 Splinters thành Breachstone.",
      "Đặt Breachstone vào Realmgate để mở cổng Twisted Domain.",
      "Đánh bại boss Breach — It That Was Tul and Esh để nhận Splinters / đồ phẩm chất cao.",
      "Đánh bại Pinnacle boss — Xesht, We That Are One tại Twisted Domain."
    ],
    partsSlugs: ["it-that-was-tul-and-esh", "xesht-we-that-are-one"]
  },
  "delirium": {
    name: "Chuỗi Boss Delirium",
    group: "Delirium",
    source: "https://game8.co/games/Path-of-Exile-2/archives/495435",
    overview: "Delirium phủ màn sương ảo ảnh lên bản đồ, tăng mạnh độ khó và phần thưởng. Vượt qua sương mù hoặc leo các tầng Simulacrum để chạm trán Kosis, Omniphobia, và thu thập Raven's Reflection để khiêu chiến Tangmazu.",
    flow: [
      "Kích hoạt Mirror of Delirium trong map để chiến đấu trong màn sương.",
      "Thu thập Simulacrum Splinters để ghép thành Simulacrum (mở đấu trường 20 wave).",
      "Chạm trán Kosis, the Revelation và Omniphobia, Fear Manifest trong map Delirium / Simulacrum.",
      "Tìm vật phẩm Raven's Reflection (rớt từ Simulacrum).",
      "Sử dụng Raven's Reflection tại gương Withered Willow để khiêu chiến Pinnacle boss Tangmazu."
    ],
    partsSlugs: ["kosis-the-revelation", "omniphobia-fear-manifest", "tangmazu-the-raven-trickster"]
  },
  "abyss": {
    name: "Chuỗi Boss Abyss",
    group: "Abyss",
    source: "https://game8.co/games/Path-of-Exile-2/archives/551525",
    overview: "Abyss là những vết nứt hắc ám dưới lòng đất. Lần theo vết nứt để tiêu diệt các quái vật cổ xưa, chạm trán Vandroth và Tasgul tại các Abyssal Wounds, và dùng Kulemak's Invitation để khiêu chiến Vessel of Kulemak.",
    flow: [
      "Kích hoạt và đuổi theo các vết nứt Abyss xuất hiện ngẫu nhiên trong map.",
      "Tiến vào Abyssal Depths / Abyssal Wounds qua hố nứt.",
      "Đánh bại Vandroth, Blackblooded Enslaver (phong ấn Northern Abyssal Wounds).",
      "Đánh bại Tasgul, Swallower of Light (dọn sạch Eastern Abyssal Wound).",
      "Thu thập Kulemak's Invitation rớt từ các boss phụ Abyss.",
      "Sử dụng Kulemak's Invitation tại Realmgate để khiêu chiến Pinnacle boss Vessel of Kulemak."
    ],
    partsSlugs: ["vandroth-blackblooded-enslaver", "tasgul-swallower-of-light", "vessel-of-kulemak"]
  },
  "trial-sekhemas": {
    name: "Trial of the Sekhemas",
    group: "Trial of the Sekhemas",
    source: "https://game8.co/games/Path-of-Exile-2/archives/488759",
    overview: "Trial of the Sekhemas là chuỗi thử thách đấu trường leo tầng đầy cam go. Bằng cách sử dụng Balbala's Barya để mở khóa, bạn cần vượt qua các tầng bảo vệ bởi Rattlecage, Terracota Sentinels, Ashar trước khi đối đầu với Zarokh.",
    flow: [
      "Đánh bại Balbala, the Traitor để lấy Balbala's Barya (kích hoạt đấu trường Sekhemas).",
      "Kích hoạt đấu trường trên Atlas để bắt đầu leo tầng.",
      "Vượt qua Tầng 1: Đánh bại Rattlecage, the Earthbreaker.",
      "Vượt qua Tầng 2: Đánh bại Terracota Sentinels.",
      "Vượt qua Tầng 3: Đánh bại Ashar, the Sand Mother.",
      "Đạt Area Level 75+ và đặt Djinn Barya để đối đầu Pinnacle boss Zarokh, the Temporal."
    ],
    partsSlugs: ["rattlecage-the-earthbreaker", "terracota-sentinels", "ashar-the-sand-mother", "zarokh-the-temporal"]
  },
  "trial-chaos": {
    name: "Trial of Chaos",
    group: "Trial of Chaos",
    source: "https://game8.co/games/Path-of-Exile-2/archives/490749",
    overview: "Trial of Chaos (trước đây là Ultimatum) là đấu trường sinh tử đầy cám dỗ của Trialmaster. Vượt qua 10 vòng thử thách ngẫu nhiên với các boss phụ Bahlak, Uxmal, Chetza trước khi chiến đấu trực diện với Trialmaster.",
    flow: [
      "Kích hoạt Trial of Chaos trong bản đồ Atlas.",
      "Lựa chọn các modifier tăng độ khó qua từng vòng (tối đa 10 vòng).",
      "Chạm trán ngẫu nhiên Bahlak (Sky Seer), Uxmal (Beastlord), Chetza (Feathered Plague).",
      "Hoàn thành vòng 9 xuất sắc để nhận Fate Keys.",
      "Đặt 3 Fate Keys để mở khóa vòng 10: đối đầu trực diện Pinnacle boss The Trialmaster."
    ],
    partsSlugs: ["bahlak-the-sky-seer", "uxmal-the-beastlord", "chetza-the-feathered-plague", "the-trialmaster"]
  },
  "expedition": {
    name: "Chuỗi Boss Expedition",
    group: "Expedition",
    source: "https://game8.co/games/Path-of-Exile-2/archives/486754",
    overview: "Expedition là hành trình khai quật tàn tích cổ xưa. Đặt thuốc nổ để giải phóng quái vật và rương báu, sử dụng các Saga Logbook để săn tìm Medved, Vorana, Uhtred, Olroth, và rèn Triskelion để diệt The Aberration.",
    flow: [
      "Đặt thuốc nổ khai quật các di chỉ Expedition trong map hoặc Logbook.",
      "Sử dụng Medved's/Vorana's/Uhtred's/Olroth's Saga trên Atlas để vào khu vực Ocean Biome.",
      "Đánh bại các boss Logbook: Medved, Vorana, Uhtred, và Olroth.",
      "Thu thập Shattered Triskelion từ Olroth và mang tới Verisium Anvil tại Kingsmarch để rèn The Triskelion Reforged.",
      "Nói chuyện với Makoru để di chuyển đến Verisium Crater.",
      "Đặt Triskelion Reforged để phá rào chắn và tiêu diệt Pinnacle boss The Aberration."
    ],
    partsSlugs: ["styrn-fallen-knight-of-aldur", "medved-the-fallen-seer", "vorana-last-to-fall", "uhtred-the-stardrinker", "olroth-origin-of-the-fall", "the-aberration"]
  },
  "atziri-temple": {
    name: "Đền Thờ Atziri",
    group: "Atziri's Temple",
    source: "https://game8.co/games/Path-of-Exile-2/archives/574808",
    overview: "Đền thờ Vaal cổ xưa ẩn chứa sức mạnh tàn bạo của Nữ hoàng Atziri. Vận hành các bảng điều khiển đền thờ để dọn đường qua kiến trúc sư Xipocado và đột kích vào Royal Access Chamber diện kiến Atziri.",
    flow: [
      "Tìm kiếm các tàn tích Vaal trong map để tiến vào Đền Thờ Atziri.",
      "Vận hành Temple Console để xoay chuyển các phòng đền thờ.",
      "Đánh bại kiến trúc sư hoàng gia Xipocado, Royal Architect.",
      "Đạt Area Level 75+ và mở cửa Royal Access Chamber để đối đầu Pinnacle boss Atziri, the Red Queen."
    ],
    partsSlugs: ["xipocado-royal-architect", "atziri-the-red-queen"]
  },
  "precursor-fortress": {
    name: "Pháo Đài Precursor",
    group: "Precursor Fortress (Pinnacle)",
    source: "https://game8.co/games/Path-of-Exile-2/archives/486754",
    overview: "Precursor Fortress là thử thách tối thượng từ nền văn minh tiền thân cổ xưa. Thu thập các mảnh khóa để khiêu chiến phán quan Arbiter of Ash và Arbiter of Divinity bảo vệ pháo đài.",
    flow: [
      "Thu thập Crisis Fragments từ các map tier cao.",
      "Sử dụng Crisis Fragments tại Realmgate để tiến vào Burning Monolith khiêu chiến Arbiter of Ash.",
      "Thu thập Origin Spark và Origin Cradle.",
      "Đặt chúng tại Realmgate để kích hoạt Origin Tower khiêu chiến Arbiter of Divinity."
    ],
    partsSlugs: ["the-arbiter-of-ash", "the-arbiter-of-divinity"]
  }
};

for (const [combinedSlug, cfg] of Object.entries(combinedConfigs)) {
  const parts = [];
  let combinedHero = null;

  for (const partSlug of cfg.partsSlugs) {
    const boss = bossDetails[partSlug];
    if (!boss) {
      console.warn(`Part boss not found: ${partSlug}`);
      continue;
    }
    const images = bossImages[partSlug] || { hero: null, images: [] };

    // Use final boss hero as the main combined guide hero
    if (partSlug === cfg.partsSlugs[cfg.partsSlugs.length - 1]) {
      combinedHero = images.hero;
    }

    const phases = (boss.vi && Array.isArray(boss.vi.phases) && boss.vi.phases.length > 0)
      ? boss.vi.phases
      : ((boss.vi && Array.isArray(boss.vi.mechanics) && boss.vi.mechanics.length > 0)
        ? [{ name: "Cơ chế chiến đấu", points: boss.vi.mechanics }]
        : []);

    parts.push({
      name: boss.name,
      subtitle: boss.location,
      image: images.hero || null,
      access: Array.isArray(boss.conditions) ? boss.conditions.join('. ') : '',
      phases: phases,
      drops: Array.isArray(boss.drops) ? boss.drops : []
    });
  }

  bossDetails[combinedSlug] = {
    guide: true,
    name: cfg.name,
    group: cfg.group,
    source: cfg.source,
    vi: {
      overview: cfg.overview
    },
    flow: cfg.flow,
    parts: parts
  };

  bossImages[combinedSlug] = {
    hero: combinedHero,
    images: []
  };
}

writeFileSync(new URL('../../public/data/boss-data.js', import.meta.url), `window.POE2_BOSS_DETAILS = ${JSON.stringify(bossDetails, null, 2)};\n`);
writeFileSync(new URL('../../public/data/boss-images.js', import.meta.url), `// Curated Game8 images -> Cloudflare R2. Auto-generated.\nwindow.POE2_BOSS_IMAGES = ${JSON.stringify(bossImages, null, 2)};\n`);

console.log("Successfully combined chain guides and updated data files!");

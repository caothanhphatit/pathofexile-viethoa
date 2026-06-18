export const meta = {
  name: 'boss-curate',
  description: 'Per-boss manual curation: pick correct Game8 images + rewrite VN content, 5 agents concurrent',
  phases: [{ title: 'Curate' }],
};

const BOSSES = [
  {
    "slug": "zarokh-the-temporal",
    "name": "Zarokh, the Temporal",
    "group": "Trial of the Sekhemas",
    "location": "Trial of the Sekhemas (Floor 4)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/491885"
  },
  {
    "slug": "the-trialmaster",
    "name": "The Trialmaster",
    "group": "Trial of Chaos",
    "location": "Trial of Chaos",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/492849"
  },
  {
    "slug": "the-bodach",
    "name": "The Bodach",
    "group": "Ritual",
    "location": "Caer Tarth",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/604622"
  },
  {
    "slug": "tangmazu-the-raven-trickster",
    "name": "Tangmazu, The Raven Trickster",
    "group": "Delirium",
    "location": "Paracosm",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/604659"
  },
  {
    "slug": "xesht-we-that-are-one",
    "name": "Xesht, We That Are One",
    "group": "Breach",
    "location": "Twisted Domain",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/488754"
  },
  {
    "slug": "vessel-of-kulemak",
    "name": "Vessel of Kulemak",
    "group": "Abyss",
    "location": "Well of Souls",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/551527"
  },
  {
    "slug": "atziri-the-red-queen",
    "name": "Atziri, the Red Queen",
    "group": "Atziri's Temple",
    "location": "Vaal Temple",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/574807"
  },
  {
    "slug": "the-arbiter-of-ash",
    "name": "The Arbiter of Ash",
    "group": "Precursor Fortress (Pinnacle)",
    "location": "Burning Monolith (Sealed Passageway in the Atlas)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/493384"
  },
  {
    "slug": "the-arbiter-of-divinity",
    "name": "The Arbiter of Divinity",
    "group": "Precursor Fortress (Pinnacle)",
    "location": "The Origin Tower, Precursor Fortress",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/604768"
  },
  {
    "slug": "the-devourer",
    "name": "The Devourer",
    "group": "Optional — Act 1",
    "location": "Mud Burrow (Act 1)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/487627"
  },
  {
    "slug": "the-brambleghast",
    "name": "The Brambleghast",
    "group": "Optional — Act 1",
    "location": "The Grelwood (Act 1)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/488377"
  },
  {
    "slug": "the-crowbell",
    "name": "The Crowbell",
    "group": "Optional — Act 1",
    "location": "The Hunting Grounds (Act 1)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/488500"
  },
  {
    "slug": "the-king-in-the-mists",
    "name": "The King in the Mists",
    "group": "Optional — Act 1",
    "location": "Freythorn (Act 1)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/488438"
  },
  {
    "slug": "candlemass-the-living-rite",
    "name": "Candlemass, the Living Rite",
    "group": "Optional — Act 1",
    "location": "Ogham Manor (Act 1)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/488494"
  },
  {
    "slug": "beira-of-the-rotten-pack",
    "name": "Beira of the Rotten Pack",
    "group": "Optional — Act 1",
    "location": "Clearfell (Act 1)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/487075"
  },
  {
    "slug": "the-rotten-druid",
    "name": "The Rotten Druid",
    "group": "Optional — Act 1",
    "location": "The Grim Tangle (Act 1)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/488398"
  },
  {
    "slug": "balbala-the-traitor",
    "name": "Balbala, The Traitor",
    "group": "Optional — Act 2",
    "location": "Traitor's Passage (Act 2)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/488611"
  },
  {
    "slug": "kabala-constrictor-queen",
    "name": "Kabala, Constrictor Queen",
    "group": "Optional — Act 2",
    "location": "Keth (Act 2)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/488758"
  },
  {
    "slug": "mektul-the-forgemaster",
    "name": "Mektul, the Forgemaster",
    "group": "Optional — Act 3",
    "location": "The Molten Vault (Act 3)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/489550"
  },
  {
    "slug": "ignagduk-the-bog-witch",
    "name": "Ignagduk, the Bog Witch",
    "group": "Optional — Act 3",
    "location": "The Azak Bog (Act 3)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/489484"
  },
  {
    "slug": "rootdredge",
    "name": "Rootdredge",
    "group": "Optional — Act 3",
    "location": "Sandswept Marsh (Act 3)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/489441"
  },
  {
    "slug": "mighty-silverfist",
    "name": "Mighty Silverfist",
    "group": "Optional — Act 3",
    "location": "Jungle Ruins (Act 3)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/487648"
  },
  {
    "slug": "great-white-one",
    "name": "Great White One",
    "group": "Optional — Act 4",
    "location": "Whakapanu Island (Act 4)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/548329"
  },
  {
    "slug": "captain-hartlin",
    "name": "Captain Hartlin",
    "group": "Optional — Act 4",
    "location": "Journey's End (Act 4)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/548227"
  },
  {
    "slug": "the-blind-beast",
    "name": "The Blind Beast",
    "group": "Optional — Act 4",
    "location": "Isle of Kin (Act 4)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/548431"
  },
  {
    "slug": "yama-the-white",
    "name": "Yama the White",
    "group": "Optional — Act 4",
    "location": "Halls of the Dead (Act 4)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/548225"
  },
  {
    "slug": "akthi-and-anundr",
    "name": "Akthi and Anundr",
    "group": "Optional — Interlude",
    "location": "The Khari Crossing",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/548766"
  },
  {
    "slug": "sigbert-and-godwin",
    "name": "Sigbert and Godwin",
    "group": "Optional — Interlude",
    "location": "Holten",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/549614"
  },
  {
    "slug": "oswin-the-dread-warden",
    "name": "Oswin, the Dread Warden",
    "group": "Optional — Interlude",
    "location": "Wolvenhold",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/549615"
  },
  {
    "slug": "the-abominable-yeti",
    "name": "The Abominable Yeti",
    "group": "Optional — Interlude",
    "location": "Howling Caves",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/549621"
  },
  {
    "slug": "the-pale-angel",
    "name": "The Pale Angel",
    "group": "Atlas / Map",
    "location": "Corrupted Nexus",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/519526"
  },
  {
    "slug": "the-skittermind",
    "name": "The Skittermind",
    "group": "Atlas / Map",
    "location": "Corrupted Nexus",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/519527"
  },
  {
    "slug": "the-eater-of-flesh",
    "name": "The Eater of Flesh",
    "group": "Atlas / Map",
    "location": "Corrupted Nexus",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/519529"
  },
  {
    "slug": "the-immured-fury",
    "name": "The Immured Fury",
    "group": "Atlas / Map",
    "location": "Cleansed Maps",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/519530"
  },
  {
    "slug": "zekoa-the-headcrusher",
    "name": "Zekoa, the Headcrusher",
    "group": "Atlas / Map",
    "location": "Riverside/Rupture Map",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/605051"
  },
  {
    "slug": "manoki-the-chosen",
    "name": "Manoki, the Chosen",
    "group": "Atlas / Map",
    "location": "The Jade Isles",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/605098"
  },
  {
    "slug": "zahmir-the-blade-sovereign",
    "name": "Zahmir, the Blade Sovereign",
    "group": "Atlas / Map",
    "location": "Sacred Reservoir",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/605106"
  },
  {
    "slug": "rattlecage-the-earthbreaker",
    "name": "Rattlecage, the Earthbreaker",
    "group": "Trial of the Sekhemas",
    "location": "Trial of the Sekhemas (Floor 1)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/488759"
  },
  {
    "slug": "terracota-sentinels",
    "name": "Terracota Sentinels",
    "group": "Trial of the Sekhemas",
    "location": "Trial of the Sekhemas (Floor 2)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/491134"
  },
  {
    "slug": "ashar-the-sand-mother",
    "name": "Ashar, the Sand Mother",
    "group": "Trial of the Sekhemas",
    "location": "Trial of the Sekhemas (Floor 3)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/491135"
  },
  {
    "slug": "bahlak-the-sky-seer",
    "name": "Bahlak, the Sky Seer",
    "group": "Trial of Chaos",
    "location": "Trial of Chaos",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/490749"
  },
  {
    "slug": "uxmal-the-beastlord",
    "name": "Uxmal, the Beastlord",
    "group": "Trial of Chaos",
    "location": "Trial of Chaos",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/490769"
  },
  {
    "slug": "chetza-the-feathered-plague",
    "name": "Chetza, the Feathered Plague",
    "group": "Trial of Chaos",
    "location": "Trial of Chaos",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/490768"
  },
  {
    "slug": "the-king-in-the-mists-ritual",
    "name": "The King in the Mists (Endgame)",
    "group": "Ritual",
    "location": "Ritual",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/488438"
  },
  {
    "slug": "kosis-the-revelation",
    "name": "Kosis, the Revelation",
    "group": "Delirium",
    "location": "Delirium / Simulacrum",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/495435"
  },
  {
    "slug": "omniphobia-fear-manifest",
    "name": "Omniphobia, Fear Manifest",
    "group": "Delirium",
    "location": "Delirium / Simulacrum",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/495530"
  },
  {
    "slug": "it-that-was-tul-and-esh",
    "name": "It That Was Tul and Esh",
    "group": "Breach",
    "location": "Hive Colony (Nest of the Lords)",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/604778"
  },
  {
    "slug": "vandroth-blackblooded-enslaver",
    "name": "Vandroth, Blackblooded Enslaver",
    "group": "Abyss",
    "location": "Dark Domain",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/551525"
  },
  {
    "slug": "tasgul-swallower-of-light",
    "name": "Tasgul, Swallower of Light",
    "group": "Abyss",
    "location": "Lightless Void",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/551524"
  },
  {
    "slug": "xipocado-royal-architect",
    "name": "Xipocado, Royal Architect",
    "group": "Atziri's Temple",
    "location": "Atziri's Temple",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/574808"
  },
  {
    "slug": "styrn-fallen-knight-of-aldur",
    "name": "Styrn, Fallen Knight of Aldur",
    "group": "Expedition",
    "location": "Tomb of the Fallen Knight",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/486754"
  },
  {
    "slug": "medved-the-fallen-seer",
    "name": "Medved, the Fallen Seer",
    "group": "Expedition",
    "location": "Ocean Biome",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/603250"
  },
  {
    "slug": "vorana-last-to-fall",
    "name": "Vorana, Last to Fall",
    "group": "Expedition",
    "location": "Ocean Biome",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/603250"
  },
  {
    "slug": "uhtred-the-stardrinker",
    "name": "Uhtred, the Stardrinker",
    "group": "Expedition",
    "location": "Ocean Biome",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/603250"
  },
  {
    "slug": "olroth-origin-of-the-fall",
    "name": "Olroth, Origin of the Fall",
    "group": "Expedition",
    "location": "Ocean Biome",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/492043"
  },
  {
    "slug": "the-aberration",
    "name": "The Aberration",
    "group": "Expedition",
    "location": "Verisium Crater",
    "guide": "https://game8.co/games/Path-of-Exile-2/archives/603250"
  }
];

const PROMPT = (b) => `Bạn xử lý DUY NHẤT 1 boss Path of Exile 2 cho web poeviethoa: "${b.name}" (slug: ${b.slug}).
Nhóm: ${b.group} | Vị trí: ${b.location} | Guide Game8: ${b.guide}
Làm việc tại thư mục repo gốc (/root/pathofexile-viethoa-v2).

BƯỚC 1 — Lấy dữ liệu guide (Bash):
  node scripts/boss/extract-guide.mjs "${b.guide}"
Lệnh in JSON { images:[{base,alt}], text }. Đọc kỹ "text" (nội dung guide Game8) và "images".

BƯỚC 2 — CHỌN ĐÚNG ẢNH, BỎ ảnh quảng cáo/related/banner/ảnh game khác:
- hero = ảnh chân dung boss (alt trùng tên boss).
- drops = ảnh từng item phần thưởng (alt = tên item, vd "Ab Aeterno Grand Cuisses").
- mechanic = 1..4 ảnh minh hoạ cơ chế/đòn quan trọng (alt mô tả cơ chế). BỎ ảnh location-map chung chung, banner, ảnh không liên quan.
Với MỖI ảnh đã chọn, upload R2 (Bash), key theo mẫu:
  node scripts/boss/upload-image.mjs "<base>" "boss/${b.slug}/hero.<ext>"
  node scripts/boss/upload-image.mjs "<base>" "boss/${b.slug}/drop-1.<ext>"
  node scripts/boss/upload-image.mjs "<base>" "boss/${b.slug}/mech-1.<ext>"
(<base> = field base của ảnh; <ext> lấy đuôi từ base: png/jpg/webp). Lệnh in ra URL R2 — DÙNG đúng URL đó. Nếu in "ERROR" thì bỏ ảnh đó.

BƯỚC 3 — Viết nội dung TIẾNG VIỆT thân thiện, rõ ràng, chính xác, DỰA TRÊN text guide (KHÔNG bịa). Giữ thuật ngữ game tiếng Anh, diễn giải bằng tiếng Việt tự nhiên.

BƯỚC 4 — Ghi file kết quả bằng Write tool vào: /tmp/boss-curated/${b.slug}.json
JSON đúng cấu trúc:
{
  "slug": "${b.slug}",
  "name": "${b.name}",
  "group": "${b.group}",
  "location": "${b.location}",
  "source": "${b.guide}",
  "hero": "<URL R2 hero hoặc null>",
  "vi": {
    "overview": "...",
    "mechanics": ["..."],
    "phases": [{"name":"Phase 1 — mô tả ngắn","points":["Tên đòn (EN): cách né/xử lý ngắn gọn","..."]}],
    "strategy": "...",
    "tips": ["..."]
  },
  "drops": [{"name":"<tên item EN>","image":"<URL R2 hoặc null>"}],
  "conditions": ["<điều kiện/requirement để mở & vào đánh boss, tiếng Việt>"],
  "gallery": ["<URL R2 ảnh mechanic>"]
}
QUAN TRỌNG: trình bày cơ chế THEO PHA bằng bullet NGẮN GỌN trong phases[].points (mỗi đòn 1 dòng: tên đòn tiếng Anh + cách xử lý). Nếu boss CÓ pha thì để mechanics=[] (KHÔNG lặp lại ở cả 2 chỗ); chỉ dùng mechanics[] khi boss 1 pha. phases=[] nếu hoàn toàn không có pha. drops/conditions/gallery=[] nếu không có. Item nào guide chỉ có tên (không ảnh) thì image=null.

Trả về 1 DÒNG tóm tắt: slug + số drops + số ảnh up. KHÔNG trả về toàn bộ JSON.`;

phase('Curate');
const CHUNK = 5;
const summaries = [];
for (let i = 0; i < BOSSES.length; i += CHUNK) {
  const group = BOSSES.slice(i, i + CHUNK);
  log(`Wave ${Math.floor(i / CHUNK) + 1}/${Math.ceil(BOSSES.length / CHUNK)}: ${group.map((b) => b.slug).join(', ')}`);
  const r = await parallel(
    group.map((b) => () => agent(PROMPT(b), { label: b.slug, phase: 'Curate', agentType: 'general-purpose' }))
  );
  summaries.push(...r.filter(Boolean));
}
log(`Curation finished: ${summaries.length}/${BOSSES.length} agents returned`);
return { agents: summaries.length, total: BOSSES.length };

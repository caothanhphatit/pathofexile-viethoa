import crypto from "node:crypto";
import { load } from "cheerio";

const TAG_TRANSLATIONS = {
  AoE: "Diện rộng",
  Attack: "Tấn công",
  Aura: "Hào quang",
  Ammunition: "Đạn dược",
  Banner: "Cờ hiệu",
  Barrageable: "Loạt bắn được",
  Bear: "Dạng gấu",
  Buff: "Hiệu ứng hỗ trợ",
  Channelling: "Duy trì",
  Chaining: "Nảy chuỗi",
  Chaos: "Hỗn mang",
  Cold: "Băng",
  Command: "Lệnh",
  Companion: "Đồng hành",
  Conditional: "Theo điều kiện",
  Curse: "Nguyền rủa",
  Detonator: "Kích nổ",
  Duration: "Thời lượng",
  Fire: "Lửa",
  Grenade: "Lựu đạn",
  Hazard: "Hiểm họa",
  Herald: "Sứ giả",
  Invocation: "Triệu dẫn",
  Lightning: "Sét",
  Mark: "Dấu ấn",
  Melee: "Cận chiến",
  Meta: "Meta",
  Merging: "Hợp nhất",
  Minion: "Đệ tử",
  Movement: "Di chuyển",
  Nova: "Nova",
  Orb: "Quả cầu",
  Persistent: "Duy trì thường trực",
  Physical: "Vật lý",
  Plant: "Thực vật",
  Payoff: "Khai thác",
  Projectile: "Đạn bay",
  Remnant: "Tàn tích",
  Shapeshift: "Biến hình",
  Slam: "Nện",
  Spell: "Phép",
  Staged: "Theo giai đoạn",
  Strike: "Đòn đánh",
  Storm: "Bão",
  Sustained: "Kéo dài",
  Totem: "Totem",
  Travel: "Di chuyển xa",
  Trigger: "Kích hoạt",
  Warcry: "Chiến hống",
  Werewolf: "Người sói",
  Wind: "Gió",
  Wyvern: "Rồng Wyvern"
};

const PHRASE_TRANSLATIONS = new Map([
  ["Arc", "Tia Hồ Quang"],
  ["Alchemist's Boon", "Phước Lành của Nhà Giả Kim"],
  ["Apocalypse", "Khải Huyền"],
  ["Archmage", "Đại Pháp Sư"],
  ["Artillery Ballista", "Ballista Pháo Kích"],
  ["Barkskin", "Da Vỏ Cây"],
  ["Berserk", "Cuồng Chiến"],
  ["Bind Spectre", "Trói Hồn Ma"],
  ["Blasphemy", "Báng Bổ"],
  ["Bonestorm", "Bão Xương"],
  ["Briarpatch", "Bụi Gai"],
  ["Bloodhound's Mark", "Dấu Ấn Chó Săn Máu"],
  ["Charged Staff", "Trượng Tích Điện"],
  ["Combat Frenzy", "Cuồng Nộ Chiến Đấu"],
  ["Herald of Ash", "Sứ Giả Tro Tàn"],
  ["Herald of Blood", "Sứ Giả Máu"],
  ["Herald of Ice", "Sứ Giả Băng"],
  ["Herald of Plague", "Sứ Giả Dịch Bệnh"],
  ["Herald of Thunder", "Sứ Giả Sấm"],
  ["Boneshatter", "Đập Vỡ Xương"],
  ["Called Shots", "Đòn Ngắm Bắn"],
  ["Chaos Bolt", "Tia Hỗn Mang"],
  ["Companion: {0}", "Bạn Đồng Hành: {0}"],
  ["Conductivity", "Dẫn Điện"],
  ["Consecrate", "Thánh Hóa"],
  ["Cull The Weak", "Kết Liễu Kẻ Yếu"],
  ["Demon Form", "Dạng Quỷ"],
  ["Defiance Banner", "Cờ Hiệu Thách Thức"],
  ["Despair", "Tuyệt Vọng"],
  ["Discipline", "Kỷ Luật"],
  ["Disengage", "Thoát Ly"],
  ["Earthshatter", "Đất Vỡ"],
  ["Elemental Expression", "Biểu Hiện Nguyên Tố"],
  ["Elemental Surge", "Trào Dâng Nguyên Tố"],
  ["Emergency Reload", "Nạp Đạn Khẩn Cấp"],
  ["Encase in Jade", "Bọc Trong Ngọc"],
  ["Enervating Nova", "Nova Suy Yếu"],
  ["Enfeeble", "Làm Suy Yếu"],
  ["Entangle", "Trói Buộc"],
  ["Exsanguinate", "Rút Máu"],
  ["Eternal Rage", "Cơn Giận Vĩnh Hằng"],
  ["Firestorm", "Bão Lửa"],
  ["Firebolt", "Tia Lửa"],
  ["Flameblast", "Vụ Nổ Lửa"],
  ["Flammability", "Dễ Cháy"],
  ["Fulmination", "Bộc Sét"],
  ["Hexblast", "Vụ Nổ Nguyền Rủa"],
  ["Hypothermia", "Hạ Thân Nhiệt"],
  ["Impurity", "Ô Uế"],
  ["Incinerate", "Thiêu Rụi"],
  ["Inevitable Agony", "Đau Đớn Không Tránh Khỏi"],
  ["Into the Breach", "Vào Khe Nứt"],
  ["Kelari's Deception", "Sự Lừa Dối của Kelari"],
  ["Kelari's Judgment", "Phán Xét của Kelari"],
  ["Kelari's Malediction", "Lời Nguyền của Kelari"],
  ["Kelari, the Tainted Sands", "Kelari, Cát Ô Uế"],
  ["Living Bomb", "Bom Sống"],
  ["Malice", "Ác Ý"],
  ["Mana Drain", "Rút Mana"],
  ["Meditate", "Thiền Định"],
  ["Mortar Cannon", "Đại Bác Cối"],
  ["Navira's Fracturing", "Sự Phân Tách của Navira"],
  ["Navira's Oasis", "Ốc Đảo của Navira"],
  ["Navira's Well", "Giếng của Navira"],
  ["Navira, the Last Mirage", "Navira, Ảo Ảnh Cuối Cùng"],
  ["Parry", "Đỡ Đòn"],
  ["Punch", "Đấm"],
  ["Primal Strikes", "Đòn Đánh Nguyên Sơ"],
  ["Rake", "Cào Xé"],
  ["Reap", "Gặt Hái"],
  ["Rhoa Mount", "Cưỡi Rhoa"],
  ["Reaper's Invocation", "Triệu Dẫn Tử Thần"],
  ["Ruzhan's Fury", "Cơn Thịnh Nộ của Ruzhan"],
  ["Ruzhan's Reckoning", "Báo Ứng của Ruzhan"],
  ["Ruzhan's Trap", "Bẫy của Ruzhan"],
  ["Ruzhan, the Blazing Sword", "Ruzhan, Thanh Kiếm Rực Cháy"],
  ["Shard Scavenger", "Kẻ Thu Nhặt Mảnh Vỡ"],
  ["Sniper's Mark", "Dấu Ấn Xạ Thủ"],
  ["Spearfield", "Trường Giáo"],
  ["Spiral Volley", "Loạt Bắn Xoắn Ốc"],
  ["Stampede", "Xung Phong"],
  ["Soulrend", "Xé Linh Hồn"],
  ["Spellslinger", "Pháp Xạ"],
  ["Snipe", "Bắn Tỉa"],
  ["Sunder", "Chẻ Tách"],
  ["Tame Beast", "Thuần Hóa Quái Thú"],
  ["Thunderstorm", "Bão Sấm"],
  ["Twister", "Lốc Xoáy"],
  ["Unearth", "Khai Quật"],
  ["Vaulting Impact", "Cú Va Nhảy Vọt"],
  ["Volcanic Fissure", "Khe Nứt Núi Lửa"],
  ["Volcano", "Núi Lửa"],
  ["War Banner", "Cờ Hiệu Chiến Tranh"],
  ["Wind Serpent's Fury", "Cơn Thịnh Nộ Mãng Xà Gió"],
  ["Wither", "Héo Tàn"],
  ["Wolf Pack", "Bầy Sói"],
  ["[DNT] Crushing Earth", "[DNT] Đất Nghiền Nát"],
  ["Lightning Arrow", "Mũi Tên Sét"],
  ["Spark", "Tia Lửa"],
  ["Fireball", "Cầu Lửa"],
  ["Frostbolt", "Chớp Băng"],
  ["Rolling Magma", "Dung Nham Lăn"],
  ["Shockwave Totem", "Totem Sóng Chấn"],
  ["Flicker Strike", "Đòn Đánh Chớp Nhoáng"],
  ["Gathering Storm", "Bão Tụ"],
  ["Flame Breath", "Hơi Thở Lửa"],
  ["Cast on Dodge", "Thi Triển Khi Né"],
  ["Dread Banner", "Cờ Hiệu Khiếp Đảm"],
  ["Trinity", "Tam Nguyên"]
]);

const WORD_TRANSLATIONS = {
  Abyssal: "Vực Sâu",
  Acid: "Axit",
  Acidic: "Axit",
  Ailment: "Bệnh Trạng",
  Align: "Căn Chỉnh",
  Arctic: "Băng Giá",
  Ancestral: "Tổ Tiên",
  Archer: "Cung Thủ",
  Armour: "Giáp",
  Arrows: "Mũi Tên",
  Arrow: "Mũi Tên",
  Arsonist: "Kẻ Phóng Hỏa",
  Ash: "Tro",
  Assault: "Tấn Kích",
  Attrition: "Tiêu Hao",
  Avatar: "Hóa Thân",
  Axe: "Rìu",
  Ball: "Cầu",
  Ballista: "Ballista",
  Barrage: "Loạt Bắn",
  Barrier: "Kết Giới",
  Blazing: "Rực Cháy",
  Beam: "Tia",
  Bearer: "Người Mang",
  Beast: "Quái Thú",
  Bell: "Chuông",
  Bleeding: "Chảy Máu",
  Blink: "Dịch Chuyển",
  Block: "Đỡ Đòn",
  Blast: "Vụ Nổ",
  Blessing: "Phước Lành",
  Blood: "Máu",
  Bloodhound: "Chó Săn Máu",
  Boil: "Sôi Sục",
  Bolt: "Tia",
  Bolts: "Tia",
  Bone: "Xương",
  Bones: "Xương",
  Bomb: "Bom",
  Breath: "Hơi Thở",
  Breaker: "Phá Giáp",
  Brute: "Quái Lực",
  Cage: "Lồng",
  Calamity: "Tai Ương",
  Caltrops: "Chông Gai",
  Cascade: "Thác Đổ",
  Cast: "Thi Triển",
  Chain: "Chuỗi",
  Chains: "Xiềng Xích",
  Charge: "Tích Điện",
  Chaos: "Hỗn Mang",
  Claw: "Vuốt",
  Cleric: "Giáo Sĩ",
  Cluster: "Chùm",
  Conduit: "Ống Dẫn",
  Conflux: "Hội Tụ",
  Companion: "Bạn Đồng Hành",
  Concoction: "Hỗn Dược",
  Cold: "Băng",
  Comet: "Sao Chổi",
  Convalescence: "Hồi Phục",
  Contagion: "Lây Nhiễm",
  Cross: "Chéo",
  Crossbow: "Nỏ",
  Critical: "Chí Mạng",
  Cry: "Tiếng Hô",
  Cull: "Kết Liễu",
  Called: "Ngắm",
  Curse: "Nguyền",
  Dagger: "Dao Găm",
  Dark: "Hắc Ám",
  Dance: "Vũ Điệu",
  Dancer: "Vũ Công",
  Dead: "Chết",
  Death: "Cái Chết",
  Deadeye: "Thiện Xạ",
  Deception: "Lừa Dối",
  Decompose: "Phân Hủy",
  Destruction: "Hủy Diệt",
  Devour: "Nuốt Chửng",
  Detonate: "Kích Nổ",
  Detonating: "Kích Nổ",
  Domain: "Lãnh Địa",
  Dodge: "Né",
  Darts: "Phi Tiêu",
  Drain: "Hút Cạn",
  Earthquake: "Động Đất",
  Earth: "Đất",
  Effigy: "Hình Nộm",
  Electrocuting: "Điện Giật",
  Ember: "Than Hồng",
  Elemental: "Nguyên Tố",
  Elements: "Nguyên Tố",
  Energy: "Năng Lượng",
  Escape: "Thoát",
  Essence: "Tinh Chất",
  Eye: "Mắt",
  Explosive: "Nổ",
  Fangs: "Nanh",
  Fate: "Định Mệnh",
  Falling: "Giáng Xuống",
  Feast: "Bữa Tiệc",
  Feral: "Hoang Dã",
  Ferocious: "Hung Bạo",
  Field: "Trường",
  Fire: "Lửa",
  Flash: "Chớp",
  Flame: "Lửa",
  Flurry: "Loạt Đòn",
  Flail: "Chùy Xích",
  Flesh: "Xác Thịt",
  Forge: "Lò Rèn",
  Fortifying: "Gia Cố",
  Freeze: "Đóng Băng",
  Freezing: "Đóng Băng",
  Frost: "Băng",
  Frozen: "Đóng Băng",
  Fragmentation: "Phân Mảnh",
  Fusillade: "Loạt Bắn",
  Fulminating: "Bộc Sét",
  Furious: "Cuồng Nộ",
  Fury: "Cơn Thịnh Nộ",
  Galvanic: "Điện Hóa",
  Gas: "Khí",
  Ghost: "Ma",
  Gods: "Chư Thần",
  Glacial: "Băng Hà",
  Grenade: "Lựu Đạn",
  Grim: "U Ám",
  Growth: "Sinh Trưởng",
  Hailstorm: "Bão Mưa Đá",
  Hammer: "Búa",
  Hand: "Bàn Tay",
  Heart: "Trái Tim",
  Herald: "Sứ Giả",
  High: "Cao",
  Hit: "Trúng Đòn",
  Hound: "Chó Săn",
  Howl: "Tiếng Hú",
  Hunt: "Săn Đuổi",
  Ice: "Băng",
  Incendiary: "Gây Cháy",
  Ignite: "Đốt Cháy",
  Illusion: "Ảo Ảnh",
  Infernal: "Hỏa Ngục",
  Invocation: "Triệu Dẫn",
  Iron: "Sắt",
  Judgment: "Phán Xét",
  Killing: "Kết Liễu",
  Last: "Cuối Cùng",
  Lance: "Thương",
  Leap: "Nhảy",
  Life: "Sinh Lực",
  Lingering: "Vương Lại",
  Lightning: "Sét",
  Locus: "Tiêu Điểm",
  Lunar: "Nguyệt",
  Mace: "Chùy",
  Mage: "Pháp Sư",
  Magnetic: "Từ Tính",
  Magma: "Dung Nham",
  Malediction: "Lời Nguyền",
  Mana: "Mana",
  Manifest: "Hiện Hình",
  Mantra: "Chân Ngôn",
  Mark: "Dấu Ấn",
  Mirage: "Ảo Ảnh",
  Minion: "Đệ Tử",
  Mirror: "Gương",
  Molten: "Nóng Chảy",
  Moment: "Khoảnh Khắc",
  Mountain: "Núi",
  Need: "Nhu Cầu",
  Nova: "Nova",
  Offering: "Hiến Tế",
  Oil: "Dầu",
  Overwhelming: "Áp Đảo",
  Orb: "Quả Cầu",
  Pain: "Đau Đớn",
  Palm: "Chưởng",
  Pact: "Khế Ước",
  Perfect: "Hoàn Hảo",
  Plasma: "Plasma",
  Plague: "Dịch Bệnh",
  Plating: "Giáp Phủ",
  Poisonburst: "Bùng Độc",
  Power: "Sức Mạnh",
  Pounce: "Vồ",
  Presence: "Hiện Diện",
  Profane: "Báng Bổ",
  Purity: "Thanh Tẩy",
  Rain: "Mưa",
  Rampage: "Cuồng Kích",
  Rapid: "Nhanh",
  Raise: "Dựng",
  Ravenous: "Háu Đói",
  Raging: "Thịnh Nộ",
  Reaper: "Tử Thần",
  Reaver: "Kẻ Cướp Đoạt",
  Reckoning: "Báo Ứng",
  Refraction: "Khúc Xạ",
  Regulation: "Điều Tiết",
  Reload: "Nạp Đạn",
  Remnants: "Tàn Tích",
  Resonating: "Cộng Hưởng",
  Rift: "Khe Nứt",
  Ritual: "Nghi Lễ",
  Roar: "Gầm",
  Rolling: "Lăn",
  Rounds: "Đạn",
  Sacrifice: "Hy Sinh",
  Salvo: "Loạt Phóng",
  Sands: "Cát",
  Savage: "Hoang Dã",
  Scavenged: "Thu Nhặt",
  Seismic: "Địa Chấn",
  Serpent: "Mãng Xà",
  Shattering: "Phá Vỡ",
  Shards: "Mảnh Vỡ",
  Shield: "Khiên",
  Shock: "Sốc",
  Shockburst: "Bùng Sốc",
  Shockchain: "Chuỗi Sốc",
  Shockwave: "Sóng Chấn",
  Shot: "Phát Bắn",
  Shots: "Phát Bắn",
  Siege: "Công Thành",
  Sigil: "Ấn Ký",
  Siphon: "Hút",
  Siphoning: "Hút Cạn",
  Skeletal: "Xương",
  Solar: "Mặt Trời",
  Sorcery: "Pháp Thuật",
  Slash: "Chém",
  Slam: "Nện",
  Snap: "Búng",
  Sniper: "Xạ Thủ",
  Soul: "Linh Hồn",
  Spark: "Tia Lửa",
  Spell: "Phép",
  Spear: "Giáo",
  Spike: "Gai",
  Spirits: "Linh Hồn",
  Spirit: "Linh Hồn",
  Stab: "Đâm",
  Staggering: "Lảo Đảo",
  Staff: "Trượng",
  Storm: "Bão",
  Stormblast: "Bão Nổ",
  Stormcaller: "Gọi Bão",
  Storms: "Bão",
  Strike: "Đòn Đánh",
  Summon: "Triệu Hồi",
  Sundering: "Chẻ Tách",
  Supporting: "Yểm Trợ",
  Supercharged: "Siêu Nạp",
  Surge: "Trào Dâng",
  Swarm: "Bầy Đàn",
  Sword: "Kiếm",
  Tainted: "Ô Uế",
  Temper: "Tôi Luyện",
  Tempest: "Bão Tố",
  Temporal: "Thời Gian",
  Thunder: "Sấm",
  Thunderous: "Sấm Rền",
  Time: "Thời Gian",
  Totem: "Totem",
  Tornado: "Lốc Xoáy",
  Toxic: "Độc",
  Tipped: "Bọc Đầu",
  Throw: "Ném",
  Thrashing: "Quất Mạnh",
  Trail: "Vệt",
  Trinity: "Tam Nguyên",
  Unleash: "Giải Phóng",
  Unbound: "Giải Phóng",
  Voltaic: "Điện",
  Void: "Hư Không",
  Volatile: "Bất Ổn",
  Velocity: "Tốc Độ",
  Vulnerability: "Dễ Tổn Thương",
  Warp: "Dịch Chuyển",
  Vine: "Dây Leo",
  Vines: "Dây Leo",
  Wall: "Tường",
  Ward: "Hộ Thuẫn",
  Warrior: "Chiến Binh",
  Weapon: "Vũ Khí",
  Walking: "Hành Tẩu",
  War: "Chiến Tranh",
  Wave: "Sóng",
  Weak: "Yếu",
  Weakness: "Yếu Điểm",
  Whirling: "Xoáy",
  Wind: "Gió",
  Wing: "Cánh",
  Winter: "Mùa Đông",
  Withering: "Héo Tàn",
  Whirlwind: "Gió Lốc",
  Zombie: "Xác Sống",
  Quarterstaff: "Trượng",
  Piercing: "Xuyên Giáp",
  Permafrost: "Băng Vĩnh Cửu",
  of: "của",
  Of: "của",
  the: "",
  The: "",
  on: "khi",
  in: "trong"
};

const nowIso = () => new Date().toISOString();

const toAbsoluteUrl = (value, baseUrl) => {
  if (!value) return "";
  return new URL(value, baseUrl).href;
};

const slugFromHref = (href = "") => {
  const path = href.split("?")[0].replace(/\/$/, "");
  return decodeURIComponent(path.split("/").pop() || "");
};

const normalizedHash = (record) => {
  const stable = {
    slug: record.slug,
    name: record.name,
    tier: record.tier,
    color: record.color,
    source_url: record.source_url,
    icon_url: record.icon_url,
    icon_alt: record.icon_alt,
    hover_url: record.hover_url,
    tags: record.tags
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
};

const detailHash = (detail) => {
  const stable = {
    summary_en: detail.summary_en || "",
    properties: detail.properties || [],
    requirements: detail.requirements || [],
    mods: detail.mods || [],
    sections: detail.sections || []
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
};

const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

export const translateTags = (tags = []) => tags.map((tag) => String(tag || "").trim()).filter(Boolean);

export const translateSkillName = (name) => {
  if (PHRASE_TRANSLATIONS.has(name)) return PHRASE_TRANSLATIONS.get(name);
  return name
    .split(/(\s+|-|')/)
    .map((part) => {
      if (/^\s+$|^-$|^'$/.test(part)) return part;
      return Object.prototype.hasOwnProperty.call(WORD_TRANSLATIONS, part) ? WORD_TRANSLATIONS[part] : part;
    })
    .join("")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,:;])/g, "$1")
    .trim();
};

const TEXT_TRANSLATIONS = [
  [/\bAttack enemies with\b/gi, "Tấn công kẻ địch bằng"],
  [/\ba melee\b/gi, "melee"],
  [/\ba Heavy Stun\b/gi, "Heavy Stun"],
  [/\ba Shockwave\b/gi, "Shockwave"],
  [/\bFire a\b/gi, "Bắn ra một"],
  [/\bFires a\b/gi, "Bắn ra một"],
  [/\bFire\b/g, "Fire"],
  [/\bThe Strike will cause\b/gi, "Strike sẽ gây"],
  [/\bUpon causing\b/gi, "Khi gây"],
  [/\bit will also create\b/gi, "nó cũng tạo ra"],
  [/\bdealing\b/gi, "gây"],
  [/\bdeals\b/gi, "gây"],
  [/\ba large amount of\b/gi, "một lượng lớn"],
  [/\bin an area\b/gi, "trong một vùng"],
  [/\benemies\b/gi, "kẻ địch"],
  [/\benemy\b/gi, "kẻ địch"],
  [/\bwith a melee\b/gi, "bằng melee"],
  [/\bwill cause\b/gi, "sẽ gây"],
  [/\bon enemies that are\b/gi, "lên kẻ địch đang"],
  [/\bon kẻ địch that are\b/gi, "lên kẻ địch đang"],
  [/\bfor Stun\b/gi, "for Stun"],
  [/\bdamage\b/gi, "damage"],
  [/\barea\b/gi, "area"]
];

const EXACT_SKILL_TEXT_TRANSLATIONS = new Map([
  [
    "Consume charges from your Mana Flask to throw a flask that explodes, dealing Physical Attack damage in an area. The thrown flask Consumes Poison on Hit to cause an acidic burst.",
    "Tiêu hao Charge từ Mana Flask để ném một flask phát nổ, gây Physical Attack damage diện rộng. Flask được ném sẽ Consume Poison khi Hit để kích hoạt một vụ nổ acid."
  ],
  [
    "While active, visages of yourself from alternate timelines will occasionally appear and cast one of your Spells from your first valid Weapon Set. Until the next visage appears, your next cast of the same Spell aligns your fate, Empowering that Spell. Visages can only cast non-Channelling, non-Buff Spells you could cast that have no cooldown.",
    "Khi đang active, các ảo ảnh của chính bạn từ các dòng thời gian khác thỉnh thoảng sẽ xuất hiện và cast một trong các Spell của bạn từ Weapon Set hợp lệ đầu tiên. Cho đến khi ảo ảnh tiếp theo xuất hiện, lần cast tiếp theo của cùng Spell đó sẽ đồng điệu vận mệnh của bạn, Empower Spell đó. Ảo ảnh chỉ có thể cast các Spell không phải Channelling, không phải Buff mà bạn có thể cast và không có Cooldown."
  ],
  [
    "Each of your Totems will summon an Ancestral Spirit Minion to fight for you. If the Totem that summoned the Minion dies then the Ancestral Spirit will too.",
    "Mỗi Totem của bạn sẽ summon một Ancestral Spirit Minion để chiến đấu cho bạn. Nếu Totem đã summon Minion đó chết, Ancestral Spirit cũng sẽ chết theo."
  ],
  [
    "Build Glory by Hitting enemies with Elemental damage. When you have maximum Glory, you may become the walking Apocalypse for a duration, Triggering one of multiple powerful Elemental Skills at an interval while this Buff lasts.",
    "Tích lũy Glory bằng cách Hit kẻ địch với Elemental damage. Khi đạt Glory tối đa, bạn có thể trở thành Apocalypse di động trong một khoảng thời gian, Trigger một trong nhiều Elemental Skills mạnh mẽ theo chu kỳ trong lúc Buff này đang duy trì."
  ],
  [
    "Load your Crossbow with a clip of bolts that can be fired rapidly and Break enemy Armour. Using this Skill again reloads the clip.",
    "Nạp Crossbow của bạn bằng một băng bolt có thể bắn liên tục và Break Armour của kẻ địch. Dùng lại Skill này để reload băng đạn."
  ],
  [
    "Consume Corpses near you to recover Life and Mana over a short time per Corpse Consumed.",
    "Consume các Corpse gần bạn để hồi phục Life và Mana trong một thời gian ngắn ứng với mỗi Corpse đã Consume."
  ],
  [
    "Deploy a Ballista Totem that rains down a salvo of Pinning, Maiming bolts.",
    "Triển khai một Ballista Totem bắn mưa loạt bolt gây hiệu ứng Pinning và Maiming."
  ],
  [
    "Channel to charge up before firing off a burning arrow. At maximum stages, the arrow will create a Detonating explosion at the end of its flight.",
    "Channel để tích tụ năng lượng trước khi bắn một arrow rực cháy. Ở stages tối đa, arrow sẽ tạo ra một vụ nổ Detonating khi kết thúc đường bay."
  ],
  [
    "Rain a storm of flaming bolts over the targeted area. Can Consume all three types of Elemental Infusion, creating a much larger storm when Fire-Infused, causing lightning bolts when Lightning-Infused, and raining ice bolts when Cold-Infused.",
    "Gọi xuống một cơn bão bolt lửa trên vùng chỉ định. Có thể Consume cả 3 loại Elemental Infusion: tạo ra bão lớn hơn nhiều khi Fire-Infused, gọi lightning bolts khi Lightning-Infused, và trút mưa ice bolts khi Cold-Infused."
  ],
  [
    "While active, you gain powerful Buffs based on your active Charges. However, maintaining the Buff Consumes Charges every few seconds.",
    "Khi đang active, bạn nhận được các Buffs mạnh mẽ dựa trên các Charges đang kích hoạt. Tuy nhiên, duy trì Buff này sẽ Consume các Charges mỗi vài giây."
  ],
  [
    "Capture the spirit of a defeated monster, transforming this gem to instead allow you to summon the monster's ghost as a Reviving Minion.",
    "Bắt giữ linh hồn của quái vật bị đánh bại, biến đổi gem này thành dạng cho phép bạn summon bóng ma của quái vật đó dưới dạng một Reviving Minion."
  ],
  [
    "Mark a target, making them more susceptible to being Frozen. When the Marked target is Frozen, the Mark Activates, granting you a Buff which gives extra Cold damage and Consuming the Mark. Marking another target while you have the Buff will remove the Buff.",
    "Mark một mục tiêu, khiến chúng dễ bị Frozen hơn. Khi mục tiêu bị Mark bị Frozen, Mark sẽ Activate, cấp cho bạn một Buff tăng thêm Cold damage và Consume Mark đó. Mark mục tiêu khác khi đang có Buff này sẽ loại bỏ Buff."
  ],
  [
    "Load your Crossbow with icy bolts that create two walls of Ice Crystals at the end of their flight.",
    "Nạp Crossbow của bạn bằng các icy bolt tạo ra hai bức tường Ice Crystal khi kết thúc đường bay."
  ],
  [
    "Create a storm of arcane energies that Empowers your Mana-costing Spells while you remain inside it. Maintaining the storm constantly drains your Mana, and spending more causes it to drain faster. The storm will dissipate when you exit it or run out of Mana.",
    "Tạo một cơn bão năng lượng arcane giúp Empower các Spell tốn Mana của bạn khi đứng trong đó. Duy trì cơn bão sẽ liên tục rút Mana của bạn, tiêu tốn Mana nhiều hơn sẽ khiến nó rút nhanh hơn. Cơn bão sẽ tan biến khi bạn rời khỏi đó hoặc cạn sạch Mana."
  ],
  [
    "Launch a spray of sparking Projectiles that travel erratically along the ground until they hit an enemy or expire. Consumes a Cold Infusion if possible to fire many sparks in a circle.",
    "Phóng một loạt Projectile tia lửa bay ngẫu nhiên dọc theo mặt đất cho đến khi chúng Hit kẻ địch hoặc hết thời lượng. Nếu có thể, Consume Cold Infusion để bắn ra nhiều tia lửa theo một vòng tròn."
  ],
  [
    "Launch a large ball of Fire which explodes on impact. The explosion Consumes a Fire Infusion if possible to launch a ring of smaller firebolts.",
    "Phóng một quả cầu Fire lớn phát nổ khi va chạm. Nếu có thể, vụ nổ Consume Fire Infusion để phóng một vòng các firebolt nhỏ hơn."
  ],
  [
    "Shapeshift into a demon, vastly boosting the power of your Spells. You gain Demonflame every second you remain in demon form, causing your Life to be lost at an ever-increasing rate. Maximum 10 Demonflame. Revert to human form if you reach 1 Life, use a Skill that isn't a Spell, or reactivate this Skill.",
    "Biến hình thành demon, tăng mạnh sức mạnh Spells của bạn. Bạn nhận Demonflame mỗi giây khi duy trì dạng demon, khiến Life bị mất với tốc độ ngày càng tăng. Tối đa 10 Demonflame. Trở về dạng người nếu bạn còn 1 Life, dùng Skill không phải Spell, hoặc kích hoạt lại Skill này."
  ],
  [
    "Applies a socketed Mark Skill to a nearby unmarked Enemy every few seconds. Consuming socketed Marks will cause them to be reapplied to an unmarked Enemy. This reapplication can happen at most once every few seconds.",
    "Áp dụng Mark Skill được socket lên một kẻ địch chưa bị Mark gần đó mỗi vài giây. Consume socketed Marks sẽ khiến chúng được áp dụng lại lên một kẻ địch chưa bị Mark. Việc áp dụng lại này chỉ có thể xảy ra tối đa một lần mỗi vài giây."
  ],
  [
    "Jump back as you rupture the earth in front of you with spearpoints, damaging enemies. Consumes the Parried Debuff on Hitting enemies to release a shockwave and grant you a Frenzy Charge. This skill can be used while using other skills, and causes Strikes and Projectiles to miss you while jumping. This skill cannot be Ancestrally Boosted.",
    "Nhảy lùi khi bạn xé mặt đất phía trước bằng các mũi spear, gây damage lên kẻ địch. Consume Parried Debuff khi Hitting kẻ địch để phóng shockwave và cấp Frenzy Charge cho bạn. Skill này có thể dùng trong lúc dùng Skill khác, đồng thời khiến Strikes và Projectiles trượt bạn khi đang nhảy. Skill này không thể được Ancestrally Boosted."
  ],
  [
    "[DNT] Convene the surrounding earth into an immense boulder to crash down, dealing high damage at the targeted location after a short delay.",
    "[DNT] Gom đất xung quanh thành một tảng đá khổng lồ rơi xuống, gây damage cao tại vị trí chỉ định sau một khoảng trễ ngắn."
  ],
  [
    "Consume all stacks of Jade to grant Guard based off your maximum Life for each Jade consumed. You cannot gain Jade stacks while you have Guard.",
    "Consume toàn bộ stack Jade để cấp Guard dựa trên Maximum Life của bạn cho mỗi Jade đã Consume. Bạn không thể nhận stack Jade khi đang có Guard."
  ],
  [
    "Unleash a Nova of Lightning damage to Electrocute enemies. Enemies close to you take no damage while enemies at the edge of the ring take significantly more damage. Enemies Hit can be Electrocuted by all Lightning damage for a short duration.",
    "Giải phóng một Nova Lightning damage để Electrocute kẻ địch. Kẻ địch gần bạn không nhận damage, còn kẻ địch ở rìa vòng nhận damage cao hơn đáng kể. Kẻ địch bị Hit có thể bị Electrocuted bởi mọi Lightning damage trong thời lượng ngắn."
  ],
  [
    "Hurl a single payload Spear that pierces through enemies and lodges in terrain where it lands. The Spear will explode at the end of its Detonation Time or if Detonated. Consumes a Frenzy Charge if you have one to explode immediately, dealing more damage in a cross-shaped area and creating Ignited Ground.",
    "Ném một payload Spear xuyên qua kẻ địch và cắm vào địa hình tại điểm rơi. Spear sẽ phát nổ khi hết Detonation Time hoặc khi bị Detonated. Nếu bạn có Frenzy Charge, Consume nó để phát nổ ngay lập tức, gây nhiều damage hơn trong vùng hình chữ thập và tạo Ignited Ground."
  ],
  [
    "Expel your own blood as Chaining blood tendrils in a cone in front of you. Enemies Hit by the tendrils take Physical damage and are inflicted with Bleeding.",
    "Phóng máu của chính bạn thành các xúc tu máu Chaining theo hình nón phía trước. Kẻ địch bị xúc tu Hit nhận Physical damage và bị inflict Bleeding."
  ],
  [
    "Activate to summon Reviving Skeletal Frost Mages that can envelop your Minions in an icy shield on Command.",
    "Activate để summon Reviving Skeletal Frost Mages có thể bọc Minions của bạn trong một Shield băng khi Command."
  ],
  [
    "Plunge your Spear into the ground to emit a pulse that Consumes Freeze, Shock and Ignite on a number of nearby enemies, Allies and Corpses. The pulse itself deals no damage, but each Ailment Consumed causes an explosion of the corresponding elemental damage type.",
    "Cắm Spear của bạn xuống đất để phát ra pulse Consume Freeze, Shock và Ignite trên một số kẻ địch, Allies và Corpses gần đó. Bản thân pulse không gây damage, nhưng mỗi Ailment bị Consume sẽ gây một vụ nổ thuộc loại elemental damage tương ứng."
  ],
  [
    "Smash the ground, dealing damage in an area and leaving behind Jagged Ground that slows enemies. The Jagged Ground erupts in a powerful Aftershock after a duration. Cannot create Jagged Ground on top of an existing patch, or if you already have the maximum number of active patches.",
    "Đập mạnh xuống đất, gây damage diện rộng và để lại Jagged Ground làm chậm kẻ địch. Sau một thời lượng, Jagged Ground phun trào thành một Aftershock mạnh. Không thể tạo Jagged Ground đè lên mảng đã có, hoặc khi bạn đã đạt số mảng active tối đa."
  ],
  [
    "Create a fiery explosion, an arcing bolt of lightning, or an icy wave of projectiles. The chance for an explosion is proportional to your Strength, for a bolt proportional to your Dexterity, and for a wave proportional to your Intelligence.",
    "Tạo một vụ nổ lửa, một tia lightning phóng vòng cung, hoặc một làn sóng Projectiles băng. Tỉ lệ tạo vụ nổ dựa theo Strength, tạo tia dựa theo Dexterity, và tạo làn sóng dựa theo Intelligence của bạn."
  ],
  [
    "Create a stationary Fire, Cold or Lightning storm at a target location for a duration, based on the highest Elemental Damage type for the Hit that Triggered the storm. Hits which do not deal Elemental Damage will not Trigger the storm.",
    "Tạo một cơn bão Fire, Cold hoặc Lightning cố định tại vị trí mục tiêu trong một thời lượng, dựa trên loại Elemental Damage cao nhất của Hit đã Trigger cơn bão. Các Hit không gây Elemental Damage sẽ không Trigger cơn bão."
  ],
  [
    "Grants your weapon Surges. Non-Melee Projectile Attacks with that weapon Consume Surges to cause the Projectiles fired to explode at the end of their flight.",
    "Cấp Surges cho vũ khí của bạn. Non-Melee Projectile Attack bằng vũ khí đó sẽ Consume Surges để khiến Projectiles đã bắn phát nổ ở cuối đường bay."
  ],
  [
    "Conjure a blazing Ember that hovers above you. After a short duration, the Ember launches at an enemy, dealing Fire damage in an area on impact and prioritising the last enemy targeted. Recasting this spell resets the duration for all active Embers. Multiple Embers fired in the same Fusillade will attempt to target different enemies. Consumes a Lightning Infusion if possible to cause the entire Fusillade to create beams that Chain to enemies.",
    "Tạo một Ember rực cháy lơ lửng trên bạn. Sau một thời gian ngắn, Ember phóng tới kẻ địch, gây Fire damage diện rộng khi va chạm và ưu tiên kẻ địch được nhắm gần nhất. Recast Spell này sẽ reset thời lượng của tất cả Ember đang active. Nhiều Ember bắn trong cùng Fusillade sẽ cố nhắm vào các kẻ địch khác nhau. Nếu có thể, Consume Lightning Infusion để khiến toàn bộ Fusillade tạo các beam Chain tới kẻ địch."
  ],
  [
    "Leap backwards, firing an icy arrow which can Chill or Freeze enemies around the location from which you escaped. This arrow will create Ice Fragments on impact.",
    "Nhảy lùi, bắn một arrow băng có thể Chill hoặc Freeze kẻ địch quanh vị trí bạn vừa thoát ra. Arrow này tạo Ice Fragments khi va chạm."
  ],
  [
    "Fire a bouncing Grenade that unleashes a devastating fiery blast when its fuse expires.",
    "Bắn một Grenade nảy, phát ra vụ nổ lửa tàn phá khi ngòi nổ hết hạn."
  ],
  [
    "Suffuse your Quarterstaff with electrical energy, then Slam the ground to deal damage in a large cone in front of you. Consumes your Power Charges to fire Lightning Projectiles forwards from the impact.",
    "Nạp điện vào Quarterstaff của bạn, sau đó Slam mặt đất để gây damage theo hình nón lớn phía trước. Consume Power Charges của bạn để bắn Lightning Projectiles về phía trước từ điểm va chạm."
  ],
  [
    "Create a wall of Fire in front of the character, which Ignites everything within its area. Any Projectiles fired through the wall by you and Allies deal added Fire damage. Consumes a Lightning Infusion if possible to also add Lightning damage to the Projectiles.",
    "Tạo một bức tường Fire phía trước nhân vật, Ignite mọi thứ trong vùng của nó. Projectiles do bạn và Allies bắn xuyên qua tường gây thêm Fire damage. Nếu có thể, Consume Lightning Infusion để thêm Lightning damage cho Projectiles."
  ],
  [
    "Load your Crossbow with Piercing bolts that fragment in flight. Bolts that hit a Frozen enemy Consume the Freeze and cause an explosion of shrapnel. Bolts that hit an Ice Crystal cause it to explode. These fragments can Merge.",
    "Nạp Crossbow bằng các Piercing bolt vỡ mảnh khi bay. Bolt Hit kẻ địch Frozen sẽ Consume Freeze và gây vụ nổ mảnh đạn. Bolt Hit Ice Crystal sẽ khiến nó phát nổ. Các mảnh này có thể Merge."
  ],
  [
    "Launch icy Projectiles in a sweeping arc. Multiple Projectiles can hit the same enemy.",
    "Phóng các Projectile băng theo một cung quét rộng. Nhiều Projectiles có thể Hit cùng một kẻ địch."
  ],
  [
    "Create a pulsing Orb of frost. Each pulse inflicts Elemental Exposure on nearby enemies. When the Orb's duration ends, it Detonates, dealing Cold damage to surrounding enemies and leaving behind a Cold Infusion.",
    "Tạo một Orb băng phát xung. Mỗi xung inflict Elemental Exposure lên kẻ địch gần đó. Khi hết thời lượng, Orb Detonate, gây Cold damage lên kẻ địch xung quanh và để lại Cold Infusion."
  ],
  [
    "Leap backward and crack the ground with your staff to call forth an Ice Crystal which can be damaged by you and enemies. If the Crystal is destroyed it causes an icy explosion. This skill can be used while using other skills.",
    "Nhảy lùi và làm nứt mặt đất bằng staff của bạn để gọi ra Ice Crystal có thể bị bạn và kẻ địch gây damage. Nếu Crystal bị phá hủy, nó gây một vụ nổ băng. Skill này có thể dùng khi đang dùng Skill khác."
  ],
  [
    "While active, the first time any Skill Hits a Shocked enemy in your Presence, that Skill also Hits other Shocked enemies in your Presence, up to a maximum.",
    "Khi đang active, lần đầu bất kỳ Skill nào Hit kẻ địch Shocked trong Presence của bạn, Skill đó cũng Hit các kẻ địch Shocked khác trong Presence của bạn, đến giới hạn tối đa."
  ],
  [
    "Shapeshift into a Bear and Slam the ground with great force, causing a pair of shockwaves. Can spend Rage to create larger shockwaves that leave behind Jagged Ground.",
    "Biến hình thành Bear và Slam mặt đất thật mạnh, tạo ra hai shockwave. Có thể tiêu Rage để tạo shockwave lớn hơn và để lại Jagged Ground."
  ],
  [
    "Gain a Buff that boosts your Shock chance. Shocking an enemy consumes the Buff to attach an Orb of electricity to that enemy. The Orb fires bolts of electricity at nearby enemies until it expires.",
    "Nhận một Buff tăng cơ hội Shock. Khi bạn Shock kẻ địch, Buff bị Consume để gắn một Orb điện vào kẻ địch đó. Orb bắn các tia điện vào kẻ địch gần đó cho đến khi hết thời lượng."
  ],
  [
    "Sweep your Quarterstaff upwards, releasing an icy fissure which deals damage in a series of bursts culminating in a large spike. Frozen enemies hit by the final spike are dealt heavy damage but the Freeze is Consumed. Ice Crystals hit by the final spike explode.",
    "Quét Quarterstaff lên trên, phóng ra khe nứt băng gây damage qua nhiều đợt nổ và kết thúc bằng một gai lớn. Kẻ địch Frozen bị gai cuối Hit sẽ nhận damage nặng nhưng Freeze bị Consume. Ice Crystals bị gai cuối Hit sẽ phát nổ."
  ],
  [
    "While active, killing Shocked enemies with a non-Herald Attack Hit will cause subsequent Attack Hits to release lightning bolts which deals Attack damage to all surrounding enemies.",
    "Khi đang active, tiêu diệt kẻ địch Shocked bằng non-Herald Attack Hit sẽ khiến các Attack Hit tiếp theo phóng lightning bolts gây Attack damage lên tất cả kẻ địch xung quanh."
  ],
  [
    "Conjure a wave of ice in all directions, Knocking Back enemies based on how close they are to you. Casting Ice Nova targeting near a Frostbolt Projectile will cause it to originate from the Frostbolt instead of you. Consumes a Cold Infusion if possible to leave a patch of Chilled Ground.",
    "Tạo một làn sóng băng tỏa ra mọi hướng, Knock Back kẻ địch dựa trên khoảng cách của chúng tới bạn. Cast Ice Nova gần một Frostbolt Projectile sẽ khiến nó phát ra từ Frostbolt thay vì từ bạn. Nếu có thể, Consume Cold Infusion để để lại một mảng Chilled Ground."
  ],
  [
    "Drink the blood of your enemies to restore your Life. While active, enemies you kill have a chance to spawn a Life Remnant, and Hitting a target spawns a Life Remnant every few seconds. Picking up a Life Remnant grants you Life which can Overflow maximum Life.",
    "Uống máu kẻ địch để hồi Life. Khi đang active, kẻ địch bạn tiêu diệt có cơ hội spawn Life Remnant, và Hitting một mục tiêu sẽ spawn Life Remnant mỗi vài giây. Nhặt Life Remnant cấp Life cho bạn và có thể Overflow Maximum Life."
  ],
  [
    "Passively manifests a protective barrier which takes Elemental Damage from Hits for you until depleted. The barrier instantly recharges to its full value a short time after it stops taking damage or is fully depleted.",
    "Tự động tạo một hàng rào bảo hộ nhận Elemental Damage từ Hits thay bạn cho đến khi cạn. Hàng rào lập tức recharge về đầy sau một thời gian ngắn khi ngừng nhận damage hoặc đã cạn hoàn toàn."
  ],
  [
    "Activate to summon a Reviving Infernal Hound which Ignites enemies near it.",
    "Activate để summon một Reviving Infernal Hound Ignite kẻ địch gần nó."
  ],
  [
    "Fire a bouncing Grenade that unleashes a Blinding, Stunning explosion when its fuse expires.",
    "Bắn một Grenade nảy, phát ra vụ nổ Blinding và Stunning khi ngòi nổ hết hạn."
  ],
  [
    "Throw a single copy of your spear. When it hits an enemy it bursts, firing secondary lightning bolt Projectiles at multiple other enemies within a large area around it. Consumes a Frenzy Charge if possible to cause the main spear to split into multiple copies on impact, each of which then bursts.",
    "Ném một bản sao Spear của bạn. Khi Hit kẻ địch, nó nổ bung, bắn các Projectile lightning bolt phụ vào nhiều kẻ địch khác trong vùng lớn xung quanh. Nếu có thể, Consume Frenzy Charge để khiến Spear chính tách thành nhiều bản sao khi va chạm, mỗi bản sao sau đó cũng nổ bung."
  ],
  [
    "Shapeshift into a Wyvern and lob a ball of magma that deals area damage as it hits the ground. The skill Chains, bouncing forward to deal damage multiple times. Impacts on Molten Fissures or Volcanos will activate them as though they were Slammed.",
    "Biến hình thành Wyvern và ném một quả cầu magma gây area damage khi chạm đất. Skill này Chain, nảy về phía trước để gây damage nhiều lần. Các va chạm trên Molten Fissures hoặc Volcanos sẽ kích hoạt chúng như thể chúng đã bị Slam."
  ],
  [
    "Channel to charge up your bow before releasing a powerful shot. Releasing with Perfect Timing causes the arrow to explode on impact and Consume Freeze on directly Hitting. Consuming Freeze enhances the explosion.",
    "Channel để nạp lực cho Bow trước khi bắn một phát mạnh. Thả đúng Perfect Timing khiến arrow phát nổ khi va chạm và Consume Freeze khi Hit trực tiếp. Consume Freeze sẽ cường hóa vụ nổ."
  ],
  [
    "Dash to an enemy and Strike them, instantly Heavily Stunning enemies which are Primed for Stun and performing additional dashing Strikes to other Primed targets in range if your first target was Stunned. Heavy Stunning an enemy with this Skill grants you a Buff that causes your Quarterstaff Attacks to also fire Projectiles for a short duration. Heavy Stunning additional enemies adds to the Buff's duration.",
    "Dash tới kẻ địch và Strike chúng, lập tức Heavy Stun kẻ địch đang Primed for Stun; nếu mục tiêu đầu tiên bị Stunned, tiếp tục dashing Strike tới các mục tiêu Primed khác trong tầm. Heavy Stun kẻ địch bằng Skill này cấp cho bạn Buff khiến Quarterstaff Attacks cũng bắn Projectiles trong thời lượng ngắn. Heavy Stun thêm kẻ địch sẽ cộng thêm thời lượng cho Buff."
  ],
  [
    "Fire an arrow that embeds where it lands for a short duration. At the end of the duration, a Lightning Bolt strikes the arrow, disintegrating it and damaging enemies, with a high chance to Shock. Shocking any enemy with the Bolt also applies Shock to all enemies near the impact.",
    "Bắn một arrow cắm lại tại điểm rơi trong thời lượng ngắn. Khi hết thời lượng, Lightning Bolt đánh vào arrow, phá hủy nó và gây damage lên kẻ địch với cơ hội Shock cao. Nếu Bolt Shock bất kỳ kẻ địch nào, Shock cũng được áp dụng lên toàn bộ kẻ địch gần điểm va chạm."
  ],
  [
    "Build Combo by successfully Striking Enemies with other skills. After reaching maximum Combo, use this skill to cause the Bell on your staff to grow to massive size as you drop it on the ground. The Bell damages enemies on impact and can be Hit by your skills, creating a damaging shockwave. Elemental Ailments applied to the Bell cause its shockwaves to deal extra damage of the corresponding type, and Hits which would have caused Knockback increase the area of effect of the shockwaves.",
    "Tích Combo bằng cách Strike kẻ địch thành công với các Skill khác. Khi đạt Combo tối đa, dùng Skill này để chiếc Bell trên staff phóng to cực lớn rồi rơi xuống đất. Bell gây damage lên kẻ địch khi va chạm và có thể bị Skill của bạn Hit, tạo shockwave gây damage. Elemental Ailments áp dụng lên Bell khiến shockwave gây thêm damage cùng loại, còn Hit lẽ ra gây Knockback sẽ tăng Area of Effect của shockwave."
  ],
  [
    "Fire an arrow into the air that lands after a short delay, damaging enemies and causing a plant to spring up at the impact location. The plant sprouts vines that latch onto nearby enemies, Slowing their movement speed and dealing Chaos damage over time. The plant can be Poisoned, causing it to deal more damage.",
    "Bắn một arrow lên trời, rơi xuống sau một khoảng trễ ngắn, gây damage lên kẻ địch và mọc một cây tại điểm va chạm. Cây mọc dây leo bám vào kẻ địch gần đó, Slow tốc độ di chuyển và gây Chaos damage over time. Cây có thể bị Poisoned, khiến nó gây nhiều damage hơn."
  ],
  [
    "Conjure surging arcane energy to restore your Mana. While active, enemies you kill affected by Elemental Ailments have a chance to spawn a Mana Remnant, and Critically Hitting a target with Elemental Ailments spawns a Mana Remnant every few seconds. Picking up a Mana Remnant grants you Mana which can Overflow maximum Mana.",
    "Tạo dòng năng lượng arcane dâng trào để hồi Mana. Khi đang active, kẻ địch bị Elemental Ailments mà bạn tiêu diệt có cơ hội spawn Mana Remnant; Critically Hitting mục tiêu đang có Elemental Ailments cũng spawn Mana Remnant mỗi vài giây. Nhặt Mana Remnant cấp Mana cho bạn và có thể Overflow Maximum Mana."
  ],
  [
    "While active, Fire Spells you use yourself will also summon Raging Spirits, which are short-lived flaming skulls that rush at nearby enemies and rapidly Attack them, ignoring commands. Enemies will not directly engage these Minions, and can pass through them.",
    "Khi đang active, Fire Spells do chính bạn dùng cũng summon Raging Spirits: các sọ lửa tồn tại ngắn, lao vào kẻ địch gần đó và Attack rất nhanh, bỏ qua lệnh điều khiển. Kẻ địch sẽ không trực tiếp giao chiến với các Minions này và có thể đi xuyên qua chúng."
  ],
  [
    "An arc of Lightning stretches from the caster to a targeted enemy and Chains on to other nearby enemies. Consumes a Lightning Infusion if possible to deal more damage and Chain further.",
    "Một tia Lightning phóng từ người cast tới kẻ địch được nhắm và Chain sang các kẻ địch gần đó. Nếu có thể, Consume Lightning Infusion để gây nhiều damage hơn và Chain xa hơn."
  ],
  [
    "Fire a bouncing Grenade that causes a burst of Poison gas when its fuse expires, damaging enemies and leaving behind a growing Poison cloud. Burning effects or Detonator skills will cause the cloud to explode in a fiery blast.",
    "Bắn một Grenade nảy, tạo burst khí Poison khi ngòi nổ hết hạn, gây damage lên kẻ địch và để lại đám mây Poison lan rộng. Burning effects hoặc Detonator Skills sẽ khiến đám mây phát nổ thành một vụ nổ lửa."
  ],
  [
    "Load your Crossbow with a clip of icy bolts that rapidly fire at the ground, leaving a shard of ice at the impact location that arms after a duration. After arming, the ice shards explode when enemies step on them, dealing more damage the longer they have been armed, up to a maximum. Using this Skill again reloads the clip.",
    "Nạp Crossbow bằng một clip bolt băng bắn nhanh xuống đất, để lại mảnh băng tại điểm va chạm và sẽ arm sau một thời lượng. Sau khi arm, các mảnh băng phát nổ khi kẻ địch bước lên, gây damage càng cao nếu đã arm càng lâu, đến giới hạn tối đa. Dùng lại Skill này sẽ reload clip."
  ],
  [
    "Throw an electrified Spear that lodges in the ground and periodically zaps nearby enemies with Lightning bolts. If the Spear is Detonated by another Skill, it immediately unleashes a volley of bolts and expires. Consumes a Frenzy Charge if possible to fire bolts more frequently for a shorter duration, automatically Detonate at the end of its duration, and create Shocked Ground on Detonation.",
    "Ném Spear tích điện cắm xuống đất và định kỳ giật kẻ địch gần đó bằng Lightning bolts. Nếu Spear bị Skill khác Detonate, nó lập tức phóng một loạt bolt rồi hết hiệu lực. Nếu có thể, Consume Frenzy Charge để bắn bolt thường xuyên hơn trong thời lượng ngắn hơn, tự Detonate khi hết thời lượng và tạo Shocked Ground khi Detonation."
  ],
  [
    "Conjure a thunderstorm which causes lightning strikes and torrential rain in an area. Enemies in the area are Drenched, causing them to become Shocked or Frozen more easily. Plants in the area become Overgrown.",
    "Tạo một thunderstorm gây lightning strikes và mưa lớn trong một vùng. Kẻ địch trong vùng bị Drenched, khiến chúng dễ bị Shocked hoặc Frozen hơn. Plants trong vùng trở thành Overgrown."
  ],
  [
    "Fire a rain of Toxic Pustules into the air. The Pustules deal damage on impact, then Detonate after a delay. They can also be Poisoned, causing them to Detonate faster and more violently.",
    "Bắn một cơn mưa Toxic Pustules lên không trung. Pustules gây damage khi va chạm rồi Detonate sau một khoảng trễ. Chúng cũng có thể bị Poisoned, khiến chúng Detonate nhanh và dữ dội hơn."
  ],
  [
    "Load your Crossbow with flaming bolts that explode on impact. The explosion will cause any Grenades in its area of effect to also explode.",
    "Nạp Crossbow bằng bolt lửa phát nổ khi va chạm. Vụ nổ sẽ khiến mọi Grenade trong Area of Effect của nó cũng phát nổ."
  ],
  [
    "Throw a single Piercing lance that leaves icy fragments in its wake. The fragments Chill nearby enemies. Consumes a Frenzy Charge if possible to cause the glacial fragments created by the first Projectile to explode outwards after a short duration, peppering enemies with shrapnel.",
    "Ném một lance Piercing để lại các mảnh băng trên đường bay. Các mảnh này Chill kẻ địch gần đó. Nếu có thể, Consume Frenzy Charge để khiến các mảnh băng do Projectile đầu tiên tạo ra phát nổ ra ngoài sau thời lượng ngắn, rải shrapnel lên kẻ địch."
  ],
  [
    "Fire a bouncing Grenade that discharges an Electrocuting Lightning blast when its fuse expires, causing all Lightning Hits against enemies to contribute to Electrocution buildup for a duration.",
    "Bắn một Grenade nảy, phóng ra vụ nổ Lightning gây Electrocute khi ngòi nổ hết hạn, khiến mọi Lightning Hit lên kẻ địch góp vào Electrocution buildup trong một thời lượng."
  ],
  [
    "Flip backwards and send forth a Freezing wave in front of you, immediately Freezing enemies which are Primed for Freeze.",
    "Lộn ngược ra sau và phóng một làn sóng Freezing phía trước, lập tức Freeze kẻ địch đang Primed for Freeze."
  ],
  [
    "Create a wall of Ice Crystals which holds back enemies. The Crystals explode if sufficiently damaged, or if pushed hard enough, damaging nearby enemies. Consumes a Lightning Infusion if possible to add another Lightning explosion if destroyed.",
    "Tạo một bức tường Ice Crystals chặn kẻ địch. Crystals phát nổ nếu nhận đủ damage hoặc bị đẩy đủ mạnh, gây damage lên kẻ địch gần đó. Nếu có thể, Consume Lightning Infusion để thêm một vụ nổ Lightning khi bị phá hủy."
  ],
  [
    "Gain fuel by spending Mana on any Skill, then use the accumulated fuel to conjure a torrent of Fire from your hand, Igniting enemies in front of you. The flames grow stronger the longer you Channel. Consumes a Fire Infusion if possible to also create Ignited Ground. Cannot gain fuel while using this skill.",
    "Nhận fuel bằng cách tiêu Mana cho bất kỳ Skill nào, rồi dùng fuel đã tích để tạo dòng Fire phun từ tay, Ignite kẻ địch phía trước. Channel càng lâu, ngọn lửa càng mạnh. Nếu có thể, Consume Fire Infusion để tạo thêm Ignited Ground. Không thể nhận fuel khi đang dùng Skill này."
  ],
  [
    "Target an enemy to either teleport inside the target's body if they are under the Cull threshold, causing it to violently explode, or to apply a Debuff to them, which will cause the same effect if that enemy falls under the Cull threshold during its duration. Can also be used on Ball Lightning Projectiles. On teleport, the target is destroyed, and the explosion deals Lightning damage to surrounding enemies. If targeting an enemy, the explosion also creates Shocked Ground. Creates a Lightning Infusion on successful use. Highlights enemies that can be Culled.",
    "Nhắm một kẻ địch: nếu chúng dưới ngưỡng Cull, bạn teleport vào bên trong cơ thể mục tiêu khiến nó nổ tung dữ dội; nếu chưa, bạn áp Debuff khiến hiệu ứng tương tự xảy ra nếu kẻ địch rơi xuống dưới ngưỡng Cull trong thời lượng Debuff. Cũng có thể dùng lên Ball Lightning Projectiles. Khi teleport, mục tiêu bị hủy diệt và vụ nổ gây Lightning damage lên kẻ địch xung quanh. Nếu nhắm kẻ địch, vụ nổ cũng tạo Shocked Ground. Tạo Lightning Infusion khi dùng thành công. Làm nổi bật kẻ địch có thể bị Culled."
  ],
  [
    "Shapeshift into a Wyvern and spit Oil at enemies, creating Oil Ground where the Projectiles land. Consumes Power Charges if possible to instead Channel a sustained barrage of electrified Oil that does not create Oil Ground. Projectiles are fired in sequence, allowing multiple Projectiles to Hit the same target.",
    "Biến hình thành Wyvern và phun Oil vào kẻ địch, tạo Oil Ground tại nơi Projectiles rơi xuống. Nếu có thể, Consume Power Charges để thay bằng Channel một loạt Oil tích điện duy trì liên tục và không tạo Oil Ground. Projectiles được bắn theo chuỗi, cho phép nhiều Projectiles Hit cùng một mục tiêu."
  ],
  [
    "Fire a bouncing Grenade that bursts in a spray of Oil when the fuse expires or when it impacts an Enemy, dealing minimal damage but covering the ground and nearby enemies in Oil. Oil created this way can be Ignited by Detonator Skills or Ignited Ground.",
    "Bắn một Grenade nảy, bung thành luồng Oil khi ngòi nổ hết hạn hoặc khi va chạm kẻ địch, gây damage rất thấp nhưng phủ Oil lên mặt đất và kẻ địch gần đó. Oil tạo theo cách này có thể bị Ignited bởi Detonator Skills hoặc Ignited Ground."
  ],
  [
    "Spur the growth of huge vines, which emerge randomly within the target area. The vines crash to the ground then retreat, targeting nearby enemies if possible.",
    "Kích thích các dây leo khổng lồ mọc ngẫu nhiên trong vùng mục tiêu. Dây leo đập xuống đất rồi rút lại, nếu có thể sẽ nhắm vào kẻ địch gần đó."
  ],
  [
    "Fire a slow-moving Projectile that moves through enemies. The Projectile itself does not Hit enemies, but repeatedly discharges bolts of Lightning at nearby enemies. Consumes a Fire Infusion if possible to slow down over time, create Ignited Ground as it travels, and explode dealing Fire damage in an Area after it dissipates.",
    "Bắn một Projectile di chuyển chậm xuyên qua kẻ địch. Bản thân Projectile không Hit kẻ địch, nhưng liên tục phóng các bolt Lightning vào kẻ địch gần đó. Nếu có thể, Consume Fire Infusion để Projectile chậm dần theo thời gian, tạo Ignited Ground trên đường đi và phát nổ gây Fire damage trong Area sau khi tan biến."
  ],
  [
    "Call down a mass of ice from the sky, dealing high damage at the targeted location. Targeting close to you will cause you to jump back as you cast. Consumes a Fire Infusion if possible to cause a devastating blast of ice and fire.",
    "Gọi khối băng từ trời rơi xuống, gây damage cao tại vị trí chỉ định. Nhắm gần bản thân sẽ khiến bạn nhảy lùi khi cast. Nếu có thể, Consume Fire Infusion để tạo vụ nổ băng và lửa tàn phá."
  ],
  [
    "Detonate a Curse on every enemy in an area, causing explosions of Chaos damage but removing the Curse. Can only detonate Curses for which at least half of the duration has expired.",
    "Detonate Curse trên mọi kẻ địch trong một vùng, gây các vụ nổ Chaos damage nhưng xóa Curse đó. Chỉ có thể detonate Curses đã hết ít nhất một nửa thời lượng."
  ],
  [
    "Load your Crossbow with a clip of charged bolts which release damaging pulses upon Hitting an enemy affected by a Lightning Ailment. Using this Skill again reloads the clip.",
    "Nạp Crossbow bằng một clip bolt tích điện, phóng xung gây damage khi Hit kẻ địch đang chịu Lightning Ailment. Dùng lại Skill này sẽ reload clip."
  ],
  [
    "Channel to charge up a heavy swing, drawing earth from the ground to enlarge your mace. Release to Slam the ground, dealing damage in an area around the impact, followed by Aftershocks dealing damage in a larger area.",
    "Channel để nạp lực cho cú vung nặng, kéo đất từ mặt đất lên để phóng to Mace của bạn. Thả ra để Slam mặt đất, gây damage trong vùng quanh điểm va chạm, sau đó là Aftershocks gây damage trong vùng lớn hơn."
  ],
  [
    "Throw a Spear with enough force to kick up a Whirlwind where it lands, Slowing enemies and Blinding them in its area of effect. Entering the Whirlwind collapses it, dealing damage and causing Knockback. Consumes a Frenzy Charge if possible to create the Whirlwind with one more than its normal maximum number of stages.",
    "Ném Spear đủ mạnh để tạo Whirlwind tại điểm rơi, Slow và Blind kẻ địch trong Area of Effect. Đi vào Whirlwind sẽ làm nó sụp lại, gây damage và Knockback. Nếu có thể, Consume Frenzy Charge để tạo Whirlwind với số stage tối đa cao hơn bình thường 1."
  ],
  [
    "Fire a bouncing Grenade that explodes when its fuse expires, throwing out a ring of mini Grenades that explode when they come to a stop.",
    "Bắn một Grenade nảy phát nổ khi ngòi nổ hết hạn, văng ra một vòng mini Grenades sẽ phát nổ khi dừng lại."
  ],
  [
    "Fire a single Eye Projectile which does not Hit enemies. The Eye constantly releases damaging shard Projectiles in a spiral as it flies. If the Eye passes over an Elemental Ground Surface or Orb, it will take on that surface's effect causing shards to deal more damage of the corresponding Type.",
    "Bắn một Eye Projectile không Hit kẻ địch. Khi bay, Eye liên tục phóng shard Projectiles gây damage theo hình xoắn ốc. Nếu Eye đi qua Elemental Ground Surface hoặc Orb, nó nhận hiệu ứng của bề mặt đó, khiến shards gây thêm damage thuộc Type tương ứng."
  ],
  [
    "Shapeshift into a Wyvern and take to the skies, immolating enemies with a jet of fire. Channelling ends after a short amount of time but can be prolonged by spending Rage. Consumes a Power Charge if possible to Empower the Skill, Gaining extra Lightning damage and spending Rage more slowly.",
    "Biến hình thành Wyvern và bay lên trời, thiêu kẻ địch bằng luồng lửa. Channelling kết thúc sau một thời gian ngắn nhưng có thể kéo dài bằng cách tiêu Rage. Nếu có thể, Consume Power Charge để Empower Skill, nhận thêm Lightning damage và tiêu Rage chậm hơn."
  ],
  [
    "Load your Crossbow with enemy-seeking payloads which are fired into the air, dropping a bolt near every enemy in the target area. These bolts lodge in the ground and explode after a short delay.",
    "Nạp Crossbow bằng payloads tự tìm kẻ địch được bắn lên không trung, thả một bolt gần mỗi kẻ địch trong vùng mục tiêu. Các bolt này cắm xuống đất và phát nổ sau một khoảng trễ ngắn."
  ],
  [
    "Build Glory by inflicting Freeze, Shock or Ignite on enemies. When you have maximum Glory you may call forth the Azmeri goddess Solaris, jumping backwards and throwing your Spear in the air. On landing the spear deals heavy damage in an area, then calls a divine skybeam that pulses periodically and creates expanding Ignited Ground. Modifiers to number of Projectiles fired do not apply to this skill.",
    "Tích Glory bằng cách inflict Freeze, Shock hoặc Ignite lên kẻ địch. Khi đạt Glory tối đa, bạn có thể triệu gọi nữ thần Azmeri Solaris, nhảy lùi và ném Spear lên không trung. Khi rơi xuống, Spear gây damage nặng trong một vùng, rồi gọi skybeam thần thánh phát xung định kỳ và tạo Ignited Ground mở rộng. Modifiers về số Projectiles bắn ra không áp dụng cho Skill này."
  ],
  [
    "Create an area of Toxic Bloom on the ground around you. While in the Bloom, you have increased Skill costs, Regenerate Life, and your Projectile Attacks attach a Toxic Pustule, which can be Poisoned. Pustules will Detonate after a duration or when enough Poison has been applied, dealing more damage based on the stored Poison damage and applying Poison in an area around it.",
    "Tạo vùng Toxic Bloom trên mặt đất quanh bạn. Khi đứng trong Bloom, bạn có increased Skill costs, Regenerate Life, và Projectile Attacks của bạn gắn Toxic Pustule có thể bị Poisoned. Pustules sẽ Detonate sau một thời lượng hoặc khi đủ Poison được áp dụng, gây nhiều damage hơn dựa trên Poison damage đã lưu trữ và áp dụng Poison trong vùng xung quanh."
  ],
  [
    "Launch a large ball of Fire which explodes on impact. The explosion Consumes a Fire Infusion if possible to launch a ring of smaller firebolts.",
    "Phóng một quả cầu Fire lớn phát nổ khi va chạm. Nếu có thể, vụ nổ Consume Fire Infusion để phóng một vòng các firebolt nhỏ hơn."
  ],
  [
    "Shapeshift into a demon, vastly boosting the power of your Spells. You gain Demonflame every second you remain in demon form, causing your Life to be lost at an ever-increasing rate. Maximum 10 Demonflame. Revert to human form if you reach 1 Life, use a Skill that isn't a Spell, or reactivate this Skill.",
    "Biến hình thành demon, tăng mạnh sức mạnh Spells của bạn. Bạn nhận Demonflame mỗi giây khi duy trì dạng demon, khiến Life bị mất với tốc độ ngày càng tăng. Tối đa 10 Demonflame. Trở về dạng người nếu bạn còn 1 Life, dùng Skill không phải Spell, hoặc kích hoạt lại Skill này."
  ],
  [
    "Dash to a target and Strike them with your Quarterstaff. If the target is Shocked, Consume their Shock to release a Lightning shockwave around the target and grant you a Power Charge. This skill cannot be Ancestrally Boosted.",
    "Dash đến mục tiêu và Strike bằng Quarterstaff của bạn. Nếu mục tiêu đang bị Shocked, Consume Shock của chúng để phóng ra một Lightning shockwave xung quanh mục tiêu và cấp cho bạn một Power Charge. Skill này không thể được Ancestrally Boosted."
  ],
  [
    "Mark a target. The next Critical Hit the target receives Activates the Mark, Consuming it to deal extra damage and grant you a Frenzy Charge.",
    "Mark một mục tiêu. Critical Hit tiếp theo mục tiêu phải gánh chịu sẽ Activate Mark, Consume Mark đó để gây thêm damage và cấp cho bạn một Frenzy Charge."
  ],
  [
    "Consume any combination of 3 Power and/or Endurance Charges to raise a Totem that uses socketed Spells. Cannot use Skills with Cooldowns.",
    "Consume bất kỳ tổ hợp gồm 3 Power Charge và/hoặc Endurance Charge để dựng một Totem sử dụng các Spell được socket. Không thể sử dụng Skills có Cooldown."
  ],
  [
    "Sweep your Quarterstaff, projecting a bolt of Lightning through the ground in a long fissure ahead of you.",
    "Quét Quarterstaff của bạn, phóng ra một bolt Lightning chạy dọc mặt đất thành một khe nứt dài phía trước mặt bạn."
  ],
  [
    "Mark a target, making them more susceptible to being Electrocuted. When the Marked target is Electrocuted, the Mark Activates, granting a Buff which gives extra Lightning damage and Consuming the Mark. Marking another target while you have the Buff will remove the Buff.",
    "Mark một mục tiêu, khiến chúng dễ bị Electrocuted hơn. Khi mục tiêu bị Mark bị Electrocuted, Mark sẽ Activate, cấp cho bạn một Buff tăng thêm Lightning damage và Consume Mark đó. Mark mục tiêu khác khi đang có Buff này sẽ loại bỏ Buff."
  ],
  [
    "While active, gains Energy when one of your Persistent Minions is Killed, and triggers socketed Spells upon reaching maximum Energy. Very underlevelled Minions will incur an Energy generation penalty. Cannot socket Spells which create Minions.",
    "Khi đang active, nhận thêm Energy khi một trong các Persistent Minion của bạn bị Killed, và trigger các Spell được socket khi đạt Energy tối đa. Minion quá thấp cấp so với bạn sẽ chịu hình phạt giảm tốc độ tích lũy Energy. Không thể socket các Spell tạo Minion."
  ],
  [
    "While active, dodge rolling will create a Mirage that uses socketed ranged Attacks for a short duration, then vanish.",
    "Khi đang active, mỗi khi dodge roll sẽ tạo ra một Mirage sử dụng các ranged Attack được socket trong thời lượng ngắn, sau đó biến mất."
  ],
  [
    "While active, has a chance to create an Infusion Remnant when you Freeze, Shock or Ignite a target.",
    "Khi đang active, có cơ hội tạo ra một Infusion Remnant mỗi khi bạn Freeze, Shock hoặc Ignite một mục tiêu."
  ],
  [
    "While active, periodically invokes divine blessings to heal you and remove Curses and Elemental Ailments from you.",
    "Khi đang active, định kỳ gọi divine blessing để trị thương và loại bỏ mọi Curse cũng như Elemental Ailments khỏi bạn."
  ],
  [
    "While active, scatters caltrops in your wake when you dodge.",
    "Khi đang active, rải caltrops phía sau đường di chuyển của bạn mỗi khi dodge."
  ],
  [
    "Mark a target, making them suffer Heavy Stun build up from Blood Loss. If they suffer enough Blood Loss while Marked, the Mark will Activate, Consuming itself and releasing an explosion of blood when they are killed or Heavy Stunned. The Mark's duration does not expire while the Marked target is suffering Blood Loss.",
    "Mark một mục tiêu, khiến chúng phải gánh chịu tích lũy Heavy Stun từ Blood Loss. Nếu chúng chịu đủ Blood Loss trong lúc bị Mark, Mark sẽ Activate, tự Consume và kích hoạt một vụ nổ máu khi chúng bị tiêu diệt hoặc bị Heavy Stunned. Thời lượng của Mark sẽ không suy giảm khi mục tiêu bị Mark đang chịu ảnh hưởng từ Blood Loss."
  ],
  [
    "Consume all Power Charges to charge your Quarterstaff with electricity, adding Lightning damage and a Lightning shockwave to your Quarterstaff Attacks. Reusing this skill while the Buff is active adds to the Buff's duration and damage.",
    "Consume toàn bộ Power Charge để nạp điện cho Quarterstaff của bạn, bổ sung thêm Lightning damage và một Lightning shockwave vào các đòn Quarterstaff Attack. Sử dụng lại Skill này khi Buff đang active sẽ cộng dồn thêm thời lượng và damage cho Buff."
  ],
  [
    "Hurl a fiery hammer that Slams into the ground and lodges there. While the hammer is lodged in the ground, reusing this Skill recalls the hammer and resets the Skill's cooldown. Alternatively, using a Warcry near the lodged hammer causes it to shatter, releasing a number of Molten Fissures in a spiral.",
    "Ném một chiếc búa lửa Slam xuống đất và cắm chặt tại đó. Khi chiếc búa còn cắm dưới đất, sử dụng lại Skill này sẽ gọi búa quay về và reset Cooldown của Skill. Ngoài ra, sử dụng một Warcry gần búa đang cắm sẽ khiến nó vỡ vụn, phóng ra hàng loạt Molten Fissures theo hình xoắn ốc."
  ],
  [
    "Perform a Warcry that grants Guard and Triggers Shield Wave when subsequent Shield Attacks deal damage. This Skill's cooldown can be bypassed by expending an Endurance Charge.",
    "Thực hiện một Warcry giúp cấp Guard và Trigger Shield Wave mỗi khi các đòn Shield Attack tiếp theo gây damage. Cooldown của Skill này có thể được bỏ qua bằng cách tiêu hao một Endurance Charge."
  ],
  [
    "Fire an icy arrow that sprays a cone of ice shards when it hits a target.",
    "Bắn một icy arrow, phun ra một hình nón các mảnh băng khi nó găm trúng mục tiêu."
  ],
  [
    "Deploy a Ballista Totem that fires bolts skyward, to explode a short time after landing.",
    "Triển khai một Ballista Totem bắn các bolt lên trời, phát nổ một thời gian ngắn sau khi rơi xuống đất."
  ],
  [
    "Load your Crossbow with charged bolts that land around the target location and explode if hit by a Detonator Skill. Using this Skill again reloads the clip.",
    "Nạp Crossbow của bạn bằng các charged bolt rơi xuống xung quanh vị trí mục tiêu và phát nổ nếu bị đánh trúng bởi một Detonator Skill. Dùng lại Skill này để reload băng đạn."
  ],
  [
    "Conjure Azmeri wisps to engulf a Rare Beast for a duration, Hindering them. If you defeat the Beast while it is engulfed in wisps, it will be captured by this gem, transforming the gem to instead allow you to summon the Beast as a Reviving Companion.",
    "Triệu hồi các Azmeri wisp bao phủ một Rare Beast trong một thời lượng và Hinder chúng. Nếu bạn đánh bại Beast đó khi nó còn bị bao phủ bởi wisp, nó sẽ bị bắt giữ bởi gem này, biến đổi gem thành dạng cho phép bạn summon Beast đó như một Reviving Companion."
  ],
  [
    "Dash to an enemy and Strike them, Culling enemies if their life is low enough and performing additional dashing Strikes to other Cullable targets in range if your target was Culled. Each enemy killed by this strike grants a Power Charge, with higher Rarity monsters granting additional Charges. Enemies around you that can be Culled will be highlighted.",
    "Dash đến một kẻ địch và Strike chúng, Culling kẻ địch nếu Life của chúng xuống đủ thấp; nếu mục tiêu bị Culled thì tiếp tục dashing Strike đến các mục tiêu Cullable khác trong tầm. Mỗi kẻ địch bị tiêu diệt bởi Strike này sẽ cấp một Power Charge, quái vật có Rarity càng cao sẽ cấp thêm các Charges. Kẻ địch xung quanh bạn có thể bị Culled sẽ được làm nổi bật."
  ],
  [
    "Dash to an enemy and run them through, Culling enemies if their life is low enough. If this Attack kills at least one enemy, it grants you a Frenzy Charge, with higher Rarity monsters granting additional Charges. Enemies around you that can be Culled will be highlighted.",
    "Dash đến một kẻ địch và đâm xuyên qua chúng, Culling kẻ địch nếu Life của chúng xuống đủ thấp. Nếu đòn Attack này tiêu diệt ít nhất một kẻ địch, nó sẽ cấp cho bạn một Frenzy Charge, quái vật có Rarity càng cao sẽ cấp thêm các Charges. Kẻ địch xung quanh bạn có thể bị Culled sẽ được làm nổi bật."
  ],
  [
    "Shapeshift into a Werewolf and leap to a target location, damaging enemies in an area around where you land. Predator's Mark will be Triggered targeting the highest Rarity enemy Hit, or if a Mark gem is socketed into this Skill, that Mark will be Triggered instead. Using this Skill allows any Wolf Minions you have to leap immediately.",
    "Shapeshift thành một Werewolf và nhảy tới vị trí mục tiêu, gây damage diện rộng xung quanh điểm đáp. Predator's Mark sẽ được Trigger nhắm vào kẻ địch có Rarity cao nhất bị Hit; nếu một gem Mark được socket vào Skill này, Mark đó sẽ được Trigger thay thế. Sử dụng Skill này cho phép mọi Wolf Minion của bạn nhảy theo ngay lập tức."
  ],
  [
    "While active, causes you to deal more Hit damage to Rare and Unique enemies the longer you've been fighting them, and gain Culling Strike against them once you've been fighting them for long enough.",
    "Khi đang active, khiến bạn gây thêm nhiều Hit damage hơn lên các kẻ địch Rare và Unique theo thời gian bạn giao chiến với chúng, và nhận được Culling Strike lên chúng khi đã giao chiến đủ lâu."
  ],
  [
    "While active, uses fragments of armour scavenged from enemies to bolster your own. Fully Breaking an enemy's Armour grants you stacks of Scavenged Plating for a duration based on the enemy's rarity, and you gain Armour and Thorns per stack. Normal enemies grant 1 stack, Magic enemies grant 2 stacks, Rare enemies grant 5 stacks and Unique enemies grant 10 stacks.",
    "Khi đang active, sử dụng các mảnh giáp thu được từ kẻ địch để gia cố cho chính bạn. Break hoàn toàn Armour của một kẻ địch sẽ cấp cho bạn các stack Scavenged Plating với thời lượng dựa trên Rarity của kẻ địch đó, giúp bạn nhận thêm Armour và Thorns ứng với mỗi stack. Kẻ địch Normal cấp 1 stack, kẻ địch Magic cấp 2 stack, kẻ địch Rare cấp 5 stack và kẻ địch Unique cấp 10 stack."
  ],
  [
    "Leap into the air and plunge your Spear into the ground at the target location, emitting a Lightning-charged shockwave.",
    "Nhảy lên không trung và cắm Spear của bạn xuống đất tại vị trí mục tiêu, phóng ra một shockwave tích Lightning."
  ],
  [
    "Instantly reload all your Crossbow Ammunition clips and Empower each clip's Ammunition to deal more damage for a duration.",
    "Lập tự reload toàn bộ các băng đạn Crossbow Ammunition và Empower đạn dược của mỗi băng để gây thêm nhiều damage hơn trong một thời lượng."
  ],
  [
    "Passively generate bolts of ice at a frequency equal to reload time, up to a cap. Activate to Load the accumulated bolts into your Crossbow. All loaded bolts are fired at once, causing them to rain down over the target area.",
    "Tự động tạo các ice bolt với tần suất bằng thời gian reload, tối đa theo giới hạn. Activate để nạp các bolt đã tích lũy vào Crossbow của bạn. Tất cả bolt đã nạp sẽ được bắn ra cùng một lúc, trút xuống như mưa trên vùng mục tiêu."
  ],
  [
    "Raise a cannon Ballista Totem which uses socketed Grenade Skills, with significantly improved Cooldown Recovery Rate.",
    "Dựng một cannon Ballista Totem sử dụng các Grenade Skill được socket, với Cooldown Recovery Rate được cải thiện đáng kể."
  ],
  [
    "Shapeshift into a Bear and charge forward, Slamming the ground as you run. Channelling ends after a short amount of time but can be prolonged by spending Rage.",
    "Shapeshift thành một Bear và lao về phía trước, nện Slam xuống đất trong khi chạy. Channelling kết thúc sau một khoảng thời gian ngắn nhưng có thể kéo dài bằng cách tiêu hao Rage."
  ],
  [
    "Consume 3 Endurance Charges to Raise a Totem that uses socketed Mace Skills. Cannot use Channelling Skills or Skills with Cooldowns.",
    "Consume 3 Endurance Charge để dựng một Totem sử dụng các Mace Skill được socket. Không thể sử dụng Channelling Skills hoặc các Skill có Cooldown."
  ],
  [
    "Channel to build destructive energy around you. Releasing the energy causes a devastating explosion that is larger and more intense the longer you Channelled for.",
    "Channel để tích tụ năng lượng hủy diệt xung quanh bạn. Phóng thích năng lượng sẽ tạo ra một vụ nổ kinh hoàng, vụ nổ sẽ càng rộng lớn và dữ dội hơn nếu bạn Channel càng lâu."
  ],
  [
    "Shapeshift into a Werewolf and offer your Rage to the moon to receive a blessing, gaining bonus Cold damage for yourself and any Wolf Minions you have from Wolf Pack or Predator's Mark. Spends all Rage to extend the Buff's duration. While the Buff is active, your Werewolf Melee Attacks call down Moonbeams on Hit.",
    "Shapeshift thành một Werewolf và hiến dâng Rage của bạn cho mặt trăng để nhận blessing, giúp bản thân bạn và bất kỳ Wolf Minion nào bạn có từ Wolf Pack hoặc Predator's Mark nhận thêm Cold damage. Tiêu hao toàn bộ Rage để kéo dài thời lượng của Buff. Khi Buff này active, đòn Werewolf Melee Attack của bạn sẽ gọi Moonbeam giáng xuống mỗi khi Hit."
  ],
  [
    "Skewer a Skeleton on a bone spike, granting you a powerful Spell damage Buff as long as the spike remains. Does not affect your Minions. The bone spike is itself a Minion. If it dies, the effect ends immediately.",
    "Xiên một Skeleton lên gai xương, cấp cho bạn một Buff Spell damage mạnh mẽ miễn là gai xương đó còn tồn tại. Không ảnh hưởng đến các Minion khác của bạn. Bản thân gai xương cũng là một Minion. Nếu nó chết, hiệu ứng sẽ kết thúc ngay lập tức."
  ],
  [
    "Load your Bow with a volley of enchanted arrows and fire them in a circle as you spin forward, firing directly at targets if possible. Consumes Frenzy Charges to cause the arrows to deal more damage and Chain to other targets. Each target can only be Hit once.",
    "Nạp Bow của bạn bằng một loạt enchanted arrows và bắn chúng theo vòng tròn trong khi xoay người tiến về phía trước, bắn trực diện vào các mục tiêu nếu có thể. Consume các Frenzy Charge để khiến tên gây thêm nhiều damage hơn và Chain sang các mục tiêu khác. Mỗi mục tiêu chỉ có thể bị Hit một lần."
  ],
  [
    "While active, grants you Flask charges passively and causes Life and Mana recovery from your Flasks to also apply to Allies in your Presence.",
    "Khi đang active, cấp Flask Charge cho bạn một cách bị động và khiến hiệu quả phục hồi Life và Mana từ Flask của bạn cũng được áp dụng cho Allies trong Presence của bạn."
  ],
  [
    "While active, causes your Non-Channelling Spells to cost additional mana and deal extra Lightning damage, both based on your maximum Mana.",
    "Khi đang active, khiến các Non-Channelling Spell của bạn tiêu tốn thêm mana và gây thêm Lightning damage, cả hai đều dựa trên Mana tối đa của bạn."
  ],
  [
    "While active, strengthens your Rage, but causes you to lose Life while not losing Rage.",
    "Khi đang active, cường hóa Rage của bạn nhưng khiến bạn liên tục tiêu hao Life thay vì mất Rage."
  ],
  [
    "While active, gains Energy when you Critically Hit enemies and triggers socketed Spells on reaching maximum Energy.",
    "Khi đang active, nhận thêm Energy mỗi khi bạn Critically Hit kẻ địch và trigger các Spell được socket khi đạt Energy tối đa."
  ],
  [
    "While active, gains Energy when you dodge roll and triggers socketed spells on reaching maximum Energy.",
    "Khi đang active, nhận thêm Energy mỗi khi bạn dodge roll và trigger các Spell được socket khi đạt Energy tối đa."
  ],
  [
    "While active, gains Energy when you Freeze, Shock, or Ignite enemies, and triggers socketed spells on reaching maximum Energy.",
    "Khi đang active, nhận thêm Energy mỗi khi bạn Freeze, Shock hoặc Ignite kẻ địch, và trigger các Spell được socket khi đạt Energy tối đa."
  ],
  [
    "While active, Attacking enemies builds Glory. When you have maximum Glory, you can place an inspiring Banner for a duration with an Aura that grants you and nearby Allies Elemental Ailment Threshold, Maximum Elemental Resistances and Flask charges.",
    "Khi đang active, các đòn Attack lên kẻ địch sẽ tích lũy Glory. Khi đạt Glory tối đa, bạn có thể cắm một chiếc cờ Banner truyền cảm hứng trong một thời lượng, tạo ra một Aura giúp cấp cho bạn và Allies lân cận Elemental Ailment Threshold, Maximum Elemental Resistances và Flask Charge."
  ],
  [
    "Tap into a current of raw and unpredictable Elemental power, causing you to deal greatly more damage of a randomly chosen Element. The Element affected changes frequently, though the same Element can be affected multiple times in succession.",
    "Khai thác luồng Elemental power thô sơ và không thể đoán trước, giúp bạn gây thêm cực kỳ nhiều damage thuộc về một Element được chọn ngẫu nhiên. Element chịu ảnh hưởng sẽ thay đổi liên tục, mặc dù một Element vẫn có thể được chọn nhiều lần liên tiếp."
  ],
  [
    "While active, you constantly regenerate Rage.",
    "Khi đang active, bạn liên tục regenerate Rage."
  ],
  [
    "While active, gains Energy when you spend Mana. Using the Invocation once sufficient Energy is gathered will consume the Energy to create visages which attack once with a socketed Shapeshifting Attack, creating multiple visages if it has enough Energy.",
    "Khi đang active, nhận Energy khi bạn tiêu Mana. Dùng Invocation sau khi tích đủ Energy sẽ Consume Energy để tạo các visage tấn công một lần bằng Shapeshifting Attack được socket, tạo nhiều visage nếu có đủ Energy."
  ],
  [
    "While active, gains Energy when you kill an enemy with a Melee Attack. Using the Invocation once sufficient Energy is gathered will consume the Energy to trigger socketed Spells, and can trigger them multiple times if it has enough Energy.",
    "Khi đang active, nhận Energy khi bạn giết kẻ địch bằng Melee Attack. Dùng Invocation sau khi tích đủ Energy sẽ Consume Energy để trigger Spells được socket, và có thể trigger nhiều lần nếu có đủ Energy."
  ],
  [
    "Harnesses a Companion Rhoa you can mount while you're wielding a Bow or Spear. While mounted you can use Bow, thrown Spear, and Mark Skills, and are much less slowed while using Skills, but being Hit will cause Heavy Stun buildup. While you aren't mounted, the Rhoa will attack your enemies alongside you with its beak, but can be damaged.",
    "Điều khiển một Companion Rhoa mà bạn có thể cưỡi khi đang cầm Bow hoặc Spear. Khi cưỡi, bạn có thể dùng Bow, thrown Spear và Mark Skills, bị làm chậm ít hơn nhiều khi dùng Skills, nhưng khi bị Hit sẽ gây Heavy Stun buildup. Khi không cưỡi, Rhoa sẽ dùng mỏ tấn công kẻ địch cùng bạn, nhưng có thể bị damage."
  ],
  [
    "While active, your undead Reviving Minions can be used in place of Corpses by your skills, but your Minions Revive more slowly.",
    "Khi đang active, Reviving Minions undead của bạn có thể được Skills dùng thay cho Corpses, nhưng Minions của bạn Revive chậm hơn."
  ],
  [
    "Become attuned to all Elements building up Fire, Cold and Lightning Resonance based off the highest Elemental Damage type dealt by your Hits. Your Elemental Damage is enhanced the more Resonance of any type you have.",
    "Đồng điệu với tất cả Elements, tích Fire, Cold và Lightning Resonance dựa trên loại Elemental damage cao nhất từ các Hit của bạn. Elemental damage của bạn được tăng theo lượng Resonance thuộc bất kỳ loại nào bạn đang có."
  ]
]);

for (const [source, translation] of [
  [
    "Create a wall of Fire in front of the character, which Ignites everything within its area. Any Projectiles fired through the wall by you and Allies deal added Fire damage. Consumes a Lightning Infusion if possible to also add Lightning damage to the Projectiles.",
    "Tạo một tường Fire trước mặt nhân vật, Ignite mọi thứ trong vùng. Projectiles của bạn và Allies bay xuyên qua tường sẽ có thêm Fire Damage. Nếu có thể, Consume Lightning Infusion để thêm Lightning Damage cho các Projectiles."
  ],
  [
    "Fire an arrow that drops from above, creating a Lightning burst. The arrow remains in the ground, and any Chaining Lightning beams can Chain to it. When Chained to, the arrows charge up for a brief period before releasing another Lightning burst. The Lightning Arrow Skill reduces this delay, causing bursts to happen more quickly.",
    "Bắn một arrow rơi từ trên cao, tạo Lightning burst. Arrow cắm lại trên mặt đất; Lightning beam đang Chain có thể Chain vào arrow đó. Khi bị Chain vào, arrow tích điện trong thời gian ngắn rồi phát thêm Lightning burst. Lightning Arrow Skill giảm độ trễ này để burst xảy ra nhanh hơn."
  ],
  [
    "Channel to Recharge Energy Shield and allow that Recharge to Overflow. Channelling ends when you take damage or your Energy Shield is fully Overflowed.",
    "Channel để Recharge Energy Shield và cho phép Recharge đó Overflow. Channelling kết thúc khi bạn nhận Damage hoặc Energy Shield đã Overflow hoàn toàn."
  ],
  [
    "While active, gains Energy when you cast Spells. Using the Invocation once sufficient Energy is gathered will consume the Energy to trigger socketed Spells, and can trigger them multiple times if it has enough Energy.",
    "Khi đang active, nhận Energy khi bạn cast Spells. Dùng Invocation sau khi tích đủ Energy sẽ Consume Energy để Trigger Spells được socket, và có thể Trigger nhiều lần nếu còn đủ Energy."
  ],
  [
    "Release a large wave that stops time for all affected enemies for a duration. Duration is lower the more times the enemy has had time stopped for them.",
    "Release một làn sóng lớn làm dừng thời gian của mọi kẻ địch bị ảnh hưởng trong một Duration. Kẻ địch càng bị Time Stop nhiều lần thì Duration càng ngắn."
  ],
  [
    "Augment yourself with temporal magic for a short duration, Empowering the next Spell you cast to repeat multiple times. Cannot Empower Channelling Skills or Skills with a Cooldown.",
    "Cường hóa bản thân bằng temporal magic trong thời gian ngắn, Empower Spell tiếp theo bạn cast để lặp lại nhiều lần. Không thể Empower Channelling Skills hoặc Skills có Cooldown."
  ],
  [
    "While active, creates a short-lived illusory copy of yourself whenever you dodge roll. The copy can be damaged by enemies, and copies that are destroyed by an enemy will cause damaging explosions. Copies created this way have 1 Life.",
    "Khi đang active, mỗi lần dodge roll sẽ tạo một bản sao ảo tồn tại ngắn. Bản sao có thể bị kẻ địch gây Damage; nếu bị kẻ địch phá hủy, nó sẽ phát nổ gây Damage. Bản sao tạo theo cách này có 1 Life."
  ],
  [
    "Passively coalesces icy missiles from the air over time. Using the skill fires a missile, firing an additional missile for each that has been accumulated. Fires an additional missile, up to its current missile count, targeting each Ice Fragment in its Area of effect, causing the Fragments to Detonate immediately.",
    "Tự động ngưng tụ các missile băng từ không khí theo thời gian. Dùng Skill sẽ bắn một missile, cộng thêm một missile cho mỗi missile đã tích lũy. Skill cũng bắn thêm missile, tối đa bằng số missile hiện có, nhắm vào từng Ice Fragment trong Area of Effect và khiến chúng Detonate ngay."
  ],
  [
    "Perform a Warcry, Empowering subsequent Melee Attacks if there are enemies nearby. Enemies in the warcry's area are destabilised and will Combust on death. This Skill's cooldown can be bypassed by expending an Endurance Charge.",
    "Thực hiện Warcry, Empower các Melee Attacks tiếp theo nếu có kẻ địch gần đó. Kẻ địch trong vùng Warcry bị destabilised và sẽ Combust khi chết. Có thể bỏ qua cooldown của Skill này bằng cách tiêu hao một Endurance Charge."
  ],
  [
    "Activate to summon bomb-throwing, Reviving Skeletal Arsonists that can detonate other Minions on Command.",
    "Activate để summon các Reviving Skeletal Arsonists ném bom, có thể detonate Minions khác theo Command."
  ],
  [
    "While active, grants a skill that you can use to instantly begin Recharging Energy Shield and gain a Buff for a duration that prevents that Recharge being interrupted. The Buff is removed at maximum Energy Shield and the skill cannot be used while Energy Shield is full.",
    "Khi đang active, cấp một Skill giúp bạn lập tức bắt đầu Recharge Energy Shield và nhận Buff ngăn Recharge bị gián đoạn trong một Duration. Buff bị xóa khi Energy Shield đầy, và Skill này không dùng được khi Energy Shield đang full."
  ],
  [
    "While active, killing an enemy with Blood Loss will cause a bloody explosion that deals Physical Attack damage to surrounding enemies based off the life of the exploded enemy, destroying their Corpse if the enemy was Normal or Magic. The explosion also has a chance to Aggravate Bleeding.",
    "Khi đang active, giết kẻ địch bằng Blood Loss sẽ tạo vụ nổ máu gây Physical Attack Damage lên kẻ địch xung quanh dựa trên Life của kẻ địch phát nổ. Nếu mục tiêu là Normal hoặc Magic, Corpse của chúng bị phá hủy. Vụ nổ cũng có chance Aggravate Bleeding."
  ],
  [
    "While active, increases your Block Chance passively and imbues your Shield with lava over time. When fully imbued, your next Block with your Shield raised will expend the lava to create an explosion, granting you an Endurance Charge.",
    "Khi đang active, tăng Block Chance thụ động và dần imbue Shield của bạn bằng lava. Khi imbue đầy, lần Block tiếp theo lúc đang giơ Shield sẽ tiêu hao lava để tạo vụ nổ và cấp một Endurance Charge."
  ],
  [
    "While active, your Fury builds from Attacking enemies. Using this Skill releases your Fury to send you into a bestial frenzy, gaining damage and Onslaught but constantly losing life and forcing you into animal form. The frenzy ends immediately if you return to human form. You cannot gain Fury while in a frenzy.",
    "Khi đang active, Fury tăng lên khi bạn Attack kẻ địch. Dùng Skill này sẽ phóng thích Fury, đưa bạn vào bestial frenzy: nhận thêm Damage và Onslaught nhưng liên tục mất Life và bị ép vào animal form. Frenzy kết thúc ngay nếu bạn trở lại human form. Không thể nhận Fury khi đang frenzy."
  ],
  [
    "Shapeshift into a Werewolf and let out an icy howl that damages enemies and Freezes Primed enemies. If an enemy is Frozen or a Frozen enemy is Hit, this Skill Empowers your attacks with added Cold damage, causes Empowered Slams to create Chilled Ground, and grants your Allies added Cold damage. This Skill's cooldown can be bypassed by expending an Endurance Charge.",
    "Biến thành Werewolf và hú băng, gây Damage lên kẻ địch và Freeze kẻ địch đã Primed. Nếu kẻ địch bị Frozen hoặc kẻ địch Frozen bị Hit, Skill này Empower Attacks của bạn bằng added Cold Damage, khiến Empowered Slams tạo Chilled Ground và cấp added Cold Damage cho Allies. Có thể bỏ qua cooldown bằng cách tiêu hao Endurance Charge."
  ],
  [
    "Ready a volley of arrows or spears, Empowering your next Barrageable Bow or Projectile Spear Attack to Repeat multiple times. Consumes your Frenzy Charges on use to add additional repeats.",
    "Chuẩn bị một loạt arrows hoặc spears, Empower Barrageable Bow hoặc Projectile Spear Attack tiếp theo để Repeat nhiều lần. Khi dùng sẽ Consume Frenzy Charges để thêm số lần Repeat."
  ],
  [
    "Shapeshift into a Wyvern and devour a Corpse or Cullable enemy, and additional nearby Corpses. For each enemy or corpse devoured, you regenerate life and gain a Power Charge. If the target is far enough away, you will leap to them and damage nearby enemies where you land. Targeting nearby enemies or corpses will not perform a leap or a Slam.",
    "Biến thành Wyvern và devour một Corpse hoặc kẻ địch Cullable, kèm các Corpses gần đó. Với mỗi kẻ địch hoặc Corpse bị devour, bạn Regenerate Life và nhận một Power Charge. Nếu mục tiêu đủ xa, bạn sẽ nhảy tới đó và gây Damage lên kẻ địch gần điểm đáp. Nhắm mục tiêu quá gần sẽ không thực hiện Leap hoặc Slam."
  ],
  [
    "Ready your active Bow or Spear, Empowering your next Barrageable Bow or Projectile Spear Attacks to Convert Physical Damage to Cold Damage and create Ice Fragments on Hit. This Skill's cooldown can be bypassed by expending a Frenzy Charge. Cannot Empower Sustained Skills.",
    "Chuẩn bị Bow hoặc Spear đang active, Empower Barrageable Bow hoặc Projectile Spear Attacks tiếp theo để Convert Physical Damage thành Cold Damage và tạo Ice Fragments on Hit. Có thể bỏ qua cooldown của Skill bằng cách tiêu hao Frenzy Charge. Không thể Empower Sustained Skills."
  ],
  [
    "Stab the ground causing multiple spears to burst out of the ground in front of you in a large area. The spears remain for a duration, or explode when enemies touch them, damaging and Maiming them.",
    "Đâm xuống đất, khiến nhiều spear trồi lên từ mặt đất phía trước trong một vùng lớn. Spears tồn tại trong một Duration hoặc phát nổ khi kẻ địch chạm vào, gây Damage và Maim."
  ],
  [
    "Shapeshift into a Werewolf and leap backwards as you gouge the ground with both claws. Enemies can be Hit separately by both gouges. Hitting a Marked enemy with both gouges will Activate the Mark and cause an additional shockwave. Ice Fragments will be pulled into the location where the gouges cross and explode immediately. This skill can be used while using other skills to interrupt them.",
    "Biến thành Werewolf và nhảy lùi khi cào đất bằng cả hai vuốt. Kẻ địch có thể bị Hit riêng bởi từng vệt cào. Hit kẻ địch Marked bằng cả hai vệt sẽ Activate Mark và tạo thêm shockwave. Ice Fragments bị kéo vào điểm hai vệt cào giao nhau rồi nổ ngay. Có thể dùng Skill này khi đang dùng Skill khác để interrupt chúng."
  ],
  [
    "Cause a Corpse to violently explode, damaging surrounding enemies.",
    "Khiến một Corpse phát nổ dữ dội, gây Damage lên kẻ địch xung quanh."
  ],
  [
    "Shapeshift into a Bear and roar in defiance, immediately gaining Rage if there are enemies nearby and Empowering subsequent Attacks to Break Armour. Alternatively, socketing a human-form Warcry into this Skill triggers that Warcry instead, and augments its damage and area. This Skill's cooldown can be bypassed by expending an Endurance Charge.",
    "Biến thành Bear và gầm thách thức, nhận Rage ngay nếu có kẻ địch gần đó và Empower các Attacks tiếp theo để Break Armour. Nếu socket một human-form Warcry vào Skill này, Skill sẽ Trigger Warcry đó thay thế và tăng Damage lẫn Area cho nó. Có thể bỏ qua cooldown bằng cách tiêu hao Endurance Charge."
  ],
  [
    "Throw a single Piercing lance that leaves icy fragments in its wake. The fragments Chill nearby enemies. Consumes a Frenzy Charge if possible to cause the glacial fragments created by the first Projectile to explode outwards after a short duration, peppering enemies with shrapnel.",
    "Ném một lance Piercing để lại các mảnh băng trên đường bay. Các mảnh này Chill kẻ địch gần đó. Nếu có thể, Consume Frenzy Charge để các mảnh băng do Projectile đầu tiên tạo ra nổ ra ngoài sau Duration ngắn, rải shrapnel lên kẻ địch."
  ],
  [
    "Jump into the air, damaging and Knocking Back enemies with your mace where you land. Enemies you would land on are pushed out of the way.",
    "Nhảy lên không trung rồi đáp xuống, gây Damage và Knock Back kẻ địch bằng Mace tại điểm đáp. Kẻ địch ở vị trí bạn sắp đáp sẽ bị đẩy ra khỏi đường."
  ],
  [
    "Perform a Lightning-charged stab that can be chained into a combination of up to three attacks. The first two attacks conjure a charging Wildwood spirit if they Hit a Shocked enemy and refresh Shock duration. The third attack is a large swipe that inflicts Elemental Exposure, and can Consume Shock to conjure a stampede of spirits.",
    "Thực hiện một cú đâm tích Lightning có thể chain thành combo tối đa 3 Attacks. Hai Attack đầu tạo Wildwood spirit đang tích lực nếu Hit kẻ địch Shocked và refresh Shock Duration. Attack thứ ba là cú quét lớn inflict Elemental Exposure, và có thể Consume Shock để tạo một stampede of spirits."
  ],
  [
    "While active, taking Hit damage from enemies to your Energy Shield causes you to gain Armour for a short duration. Armour gained from multiple Hits can stack. The total Armour gained from this Skill cannot exceed the Item Armour on your Equipped Armour Items.",
    "Khi đang active, Hit Damage từ kẻ địch vào Energy Shield khiến bạn nhận Armour trong Duration ngắn. Armour nhận từ nhiều Hit có thể stack. Tổng Armour nhận từ Skill này không thể vượt Item Armour trên Equipped Armour Items của bạn."
  ],
  [
    "While active, gains Energy when your Energy Shield is damaged by Enemy Hits. Using the Invocation once sufficient Energy is gathered will consume the Energy to trigger socketed Spells, and can trigger them multiple times if it has enough Energy.",
    "Khi đang active, nhận Energy khi Energy Shield của bạn bị Enemy Hit gây Damage. Dùng Invocation sau khi tích đủ Energy sẽ Consume Energy để Trigger Spells được socket, và có thể Trigger nhiều lần nếu còn đủ Energy."
  ],
  [
    "While active, gains Energy when you Freeze, Shock or Ignite an enemy. Using the Invocation once sufficient Energy is gathered will consume the Energy to trigger socketed Spells, and can trigger them multiple times if it has enough Energy.",
    "Khi đang active, nhận Energy khi bạn Freeze, Shock hoặc Ignite kẻ địch. Dùng Invocation sau khi tích đủ Energy sẽ Consume Energy để Trigger Spells được socket, và có thể Trigger nhiều lần nếu còn đủ Energy."
  ],
  [
    "While active, creates a short-lived illusory copy of yourself whenever you dodge roll. The copy can be damaged by enemies, and copies that are destroyed by an enemy will drop a Remnant that grants you a Power Charge on pickup.",
    "Khi đang active, mỗi lần dodge roll sẽ tạo một bản sao ảo tồn tại ngắn. Bản sao có thể bị kẻ địch gây Damage; nếu bị kẻ địch phá hủy, nó sẽ rơi Remnant cấp một Power Charge khi nhặt."
  ],
  [
    "Activate to summon a pack of Wolf Companions. The pack treated as a single Companion for effects that count or limit Companions, regardless of the number of Wolves in the pack.",
    "Activate để summon một pack Wolf Companions. Cả pack được tính là một Companion duy nhất với các hiệu ứng đếm hoặc giới hạn Companions, bất kể số Wolves trong pack."
  ],
  [
    "Perform a Warcry that grants Guard and Triggers Shield Wave when subsequent Shield Attacks deal damage. This Skill's cooldown can be bypassed by expending an Endurance Charge.",
    "Thực hiện Warcry cấp Guard và Trigger Shield Wave khi các Shield Attacks tiếp theo gây Damage. Có thể bỏ qua cooldown của Skill này bằng cách tiêu hao Endurance Charge."
  ],
  [
    "Activate to summon aggressive, Reviving Skeletal Reavers that can enrage on Command. Skeletal Reavers do more Attack Damage and gain increased Attack speed based on their Rage",
    "Activate để summon các Reviving Skeletal Reavers hung hãn, có thể enrage theo Command. Skeletal Reavers gây more Attack Damage và nhận increased Attack Speed dựa trên Rage của chúng."
  ],
  [
    "Impale a Skeleton on a bone spike to shield your Minions while the spike remains, reducing the amount of damage taken from Hits. Taking a Hit that deals damage above a certain threshold will cause that Minion's shield to absorb all damage from that Hit, then explode. The bone spike is itself a Minion, and shields itself. If it dies, shields on your other Minions disappear.",
    "Impale một Skeleton lên bone spike để che chắn Minions của bạn khi spike còn tồn tại, giảm lượng Damage nhận từ Hits. Khi nhận một Hit vượt ngưỡng nhất định, shield của Minion đó sẽ hấp thụ toàn bộ Damage từ Hit rồi phát nổ. Bone spike cũng là Minion và tự che chắn chính nó; nếu nó chết, shield trên các Minions khác biến mất."
  ],
  [
    "Perform a damaging Warcry, Knocking Back nearby enemies and Heavy Stunning enemies that are Primed for Stun. If an enemy is Heavy Stunned or a currently Heavy Stunned enemy is Hit, this Skill Empowers subsequent Slams to perform an additional Aftershock. This Skill's cooldown can be bypassed by expending an Endurance Charge.",
    "Thực hiện Warcry gây Damage, Knock Back kẻ địch gần đó và Heavy Stun kẻ địch đã Primed for Stun. Nếu một kẻ địch bị Heavy Stunned hoặc kẻ địch đang Heavy Stunned bị Hit, Skill này Empower các Slams tiếp theo để tạo thêm Aftershock. Có thể bỏ qua cooldown bằng cách tiêu hao Endurance Charge."
  ],
  [
    "Fire a skyward shot that whips up a Tornado where it lands, dealing Physical damage over time and Hindering enemies standing in it. Arrows, thrown Spears and Crossbow bolts fired at the Tornado are sucked into it, causing the Tornado to spit out a ring of copied Projectiles. Copied Projectiles cannot be copied again, even by further Tornados.",
    "Bắn một phát lên trời, tạo Tornado tại điểm rơi, gây Physical Damage over Time và Hinder kẻ địch đứng trong đó. Arrows, thrown Spears và Crossbow bolts bắn vào Tornado sẽ bị hút vào, khiến Tornado phun ra một vòng copied Projectiles. Copied Projectiles không thể được copy lại, kể cả bởi Tornado khác."
  ],
  [
    "Build Glory by Heavy Stunning enemies. When you have maximum Glory you may entreat the Ancestors to crush your enemies, manifesting a massive hammer that falls from the sky onto your target, Slamming into the ground after a short duration and dealing immense damage based on your weapon.",
    "Build Glory bằng cách Heavy Stun kẻ địch. Khi có Glory tối đa, bạn có thể cầu khẩn Ancestors nghiền nát kẻ địch, tạo một chiếc búa khổng lồ rơi từ trời xuống mục tiêu, Slam xuống đất sau Duration ngắn và gây Damage cực lớn dựa trên vũ khí của bạn."
  ],
  [
    "Activate to summon Reviving Skeletal Clerics that heal other minions and revive fallen Skeletons.",
    "Activate để summon Reviving Skeletal Clerics, có thể heal Minions khác và revive Skeletons đã ngã xuống."
  ],
  [
    "Build Glory by gaining Rage while already at maximum Rage. When you have maximum Glory, roar to the heavens to bring them down upon your enemies. For the duration of the Skill, meteors rain down around you and you Gain Fire damage and Rage regeneration. This Skill's effects are suppressed if you leave Bear form, but will resume if you return to Bear form before the duration expires.",
    "Build Glory bằng cách nhận Rage khi đã ở Rage tối đa. Khi có Glory tối đa, gầm lên trời để gọi thiên thạch xuống kẻ địch. Trong Duration của Skill, meteors rơi quanh bạn và bạn nhận Fire Damage cùng Rage regeneration. Hiệu ứng bị suppress nếu rời Bear form, nhưng sẽ tiếp tục nếu bạn trở lại Bear form trước khi Duration hết."
  ],
  [
    "Tap into a current of raw and unpredictable Elemental power, causing you to deal greatly more damage of a randomly chosen Element. The Element affected changes frequently, though the same Element can be affected multiple times in succession.",
    "Khai thác luồng Elemental power thô sơ và khó đoán, khiến bạn gây greatly more Damage thuộc một Element được chọn ngẫu nhiên. Element được chọn thay đổi thường xuyên, nhưng cùng một Element vẫn có thể chọn nhiều lần liên tiếp."
  ],
  [
    "While active, your undead Reviving Minions can be used in place of Corpses by your skills, but your Minions Revive more slowly.",
    "Khi đang active, Skills của bạn có thể dùng undead Reviving Minions thay cho Corpses, nhưng Minions của bạn Revive chậm hơn."
  ],
  [
    "While active, gains Energy when you Hit enemies with Melee Attacks and triggers socketed Fire spells on reaching maximum Energy.",
    "Khi đang active, nhận Energy khi bạn Hit kẻ địch bằng Melee Attacks và Trigger Fire Spells được socket khi đạt Energy tối đa."
  ],
  [
    "Send out a temporal Nova to take advantage of enemies' moment of vulnerability. Hitting enemies that are Primed for Stun, Electrocution, or Freeze causes a visage of them to appear, lasting as long as the original target would have been affected by the form of Immobilisation used to create the visage. A portion of the damage dealt to visages is also dealt to the original.",
    "Phóng ra một temporal Nova để tận dụng khoảnh khắc sơ hở của kẻ địch. Hit kẻ địch đang Primed for Stun, Electrocution hoặc Freeze sẽ tạo một visage của chúng, tồn tại lâu bằng thời lượng mà mục tiêu gốc lẽ ra bị ảnh hưởng bởi dạng Immobilisation đã dùng để tạo visage. Một phần Damage gây lên visage cũng được gây lên mục tiêu gốc."
  ],
  [
    "Recruit artillery Minions that takes up positions behind you. They will lay in wait for your Command then fire volleys of arrows at the target location.",
    "Tuyển artillery Minions vào vị trí phía sau bạn. Chúng sẽ chờ Command của bạn rồi bắn loạt arrow vào vị trí mục tiêu."
  ],
  [
    "Raise spikes of bone from the earth in front of you, damaging enemies. The bones of Corpses and dead Reviving Minions in the area are ripped out and reassembled into short-lived Bone Construct Minions that fight for you. Larger Corpses create more than one Bone Construct.",
    "Dựng các gai xương từ mặt đất phía trước, gây Damage lên kẻ địch. Xương từ Corpses và Reviving Minions đã chết trong vùng bị kéo ra và ghép lại thành Bone Construct Minions tồn tại ngắn để chiến đấu cho bạn. Corpse lớn hơn tạo nhiều hơn một Bone Construct."
  ],
  [
    "Uplift a volcano from the earth, damaging enemies standing on it and releasing a spray of molten Projectiles. While the volcano persists, Slamming it will cause another Projectile spray. Channelling this Skill for longer makes the initial eruption more violent, but does not affect subsequent Projectile sprays.",
    "Nâng một volcano từ mặt đất, gây Damage lên kẻ địch đứng trên đó và phóng một loạt molten Projectiles. Khi volcano còn tồn tại, Slam vào nó sẽ tạo thêm một loạt Projectile. Channel Skill này lâu hơn khiến lần phun trào ban đầu mạnh hơn, nhưng không ảnh hưởng các loạt Projectile sau đó."
  ],
  [
    "Raise a ring of bone spikes around you. The spikes are destroyed when enemies touch them, damaging and Pinning those enemies. Raising a new ring of spikes destroys the previous one.",
    "Dựng một vòng gai xương quanh bạn. Gai bị phá hủy khi kẻ địch chạm vào, gây Damage và Pinning các kẻ địch đó. Dựng vòng gai mới sẽ phá hủy vòng trước."
  ],
  [
    "Dash to an enemy and Strike them, instantly Heavily Stunning enemies which are Primed for Stun and performing additional dashing Strikes to other Primed targets in range if your first target was Stunned. Heavy Stunning an enemy with this Skill grants you a Buff that causes your Quarterstaff Attacks to also fire Projectiles for a short duration. Heavy Stunning additional enemies adds to the Buff's duration.",
    "Lướt tới kẻ địch và Strike chúng, lập tức Heavy Stun kẻ địch đang Primed for Stun. Nếu mục tiêu đầu tiên bị Stunned, tiếp tục dashing Strike tới các mục tiêu Primed khác trong tầm. Heavy Stun kẻ địch bằng Skill này cấp Buff khiến Quarterstaff Attacks cũng bắn Projectiles trong thời lượng ngắn. Heavy Stun thêm kẻ địch sẽ cộng thời lượng cho Buff."
  ],
  [
    "Shapeshift into a Wyvern and launch yourself backwards with a powerful wingbeat that Knocks Back enemies. Enemies Primed for Heavy Stun will be stunned, release a shockwave, and have a chance to grant you a Power Charge. This skill can be used while using other skills to interrupt them.",
    "Biến hình thành Wyvern và bật lùi bằng một cú đập cánh mạnh, Knock Back kẻ địch. Kẻ địch Primed for Heavy Stun sẽ bị Stun, release Shockwave và có cơ hội cấp cho bạn Power Charge. Skill này có thể dùng khi đang dùng Skill khác để interrupt chúng."
  ],
  [
    "Load your Crossbow with a large clip of heated bolts. Heat builds up on your Crossbow as you fire them, and reaching maximum Heat will prevent you from firing or reloading these bolts for a short time. However, other Skills can Consume Heat for extra benefits. Using this Skill again reloads the clip.",
    "Nạp Crossbow bằng một clip lớn các bolt nung nóng. Heat tích tụ trên Crossbow khi bạn bắn chúng; đạt Heat tối đa sẽ ngăn bạn bắn hoặc reload các bolt này trong thời gian ngắn. Tuy nhiên, Skills khác có thể Consume Heat để nhận thêm lợi ích. Dùng lại Skill này để reload clip."
  ],
  [
    "Perform a series of six rapid stabs. The final stab inflicts Bleeding and leaves a spearhead stuck in the target, Maiming them for a duration. Detonator Skills will cause the stuck spearheads to explode, dealing further damage to the target and other nearby enemies.",
    "Thực hiện chuỗi 6 cú đâm nhanh. Cú đâm cuối gây Bleeding và để lại một Spearhead cắm trong mục tiêu, Maim chúng trong một thời lượng. Detonator Skills sẽ kích nổ các Spearhead đang cắm, gây thêm Damage lên mục tiêu và kẻ địch gần đó."
  ],
  [
    "Slam the ground, creating a roiling fissure that damages enemies in a sequence of areas in front of you. A number of enemies hit by the wave will release a shockwave, damaging other enemies. Hitting an enemy with Fully Broken Armour applies Sundered Armour, making it take additional increased Physical damage.",
    "Slam xuống đất, tạo một khe nứt cuộn trào gây Damage lên kẻ địch theo chuỗi vùng phía trước bạn. Một số kẻ địch bị wave Hit sẽ release Shockwave, gây Damage lên kẻ địch khác. Hit kẻ địch có Fully Broken Armour sẽ áp dụng Sundered Armour, khiến chúng nhận thêm increased Physical Damage."
  ],
  [
    "Load your Crossbow with unstable bolts that require a lengthy charging period to fire but deal devastating damage, Pierce through enemies, and explode upon hitting terrain. Additional Projectiles are fired in a spread, unlike other Crossbow Skills.",
    "Nạp Crossbow bằng bolt bất ổn định, cần thời gian charge dài trước khi bắn nhưng gây Damage cực lớn, Pierce xuyên kẻ địch và phát nổ khi chạm địa hình. Các Projectile bổ sung được bắn tỏa ra, khác với các Crossbow Skills khác."
  ],
  [
    "Harness Kelari's power to passively Consume Corpses in your Presence, causing Corpse Beetle Minions to burst forth. The Beetles passively follow you until Commanded. On your Command, they rush the target and explode.",
    "Khai thác sức mạnh của Kelari để tự động Consume Corpses trong Presence của bạn, gọi Corpse Beetle Minions trồi ra. Beetles sẽ đi theo bạn cho đến khi được Command. Khi bạn Command, chúng lao tới mục tiêu và phát nổ."
  ],
  [
    "Attempt to rip the lifeforce from an enemy. Enemies within Culling range will be highlighted and instantly killed on Hit, granting a Power Charge. Can only target Enemies in Culling range.",
    "Cố rút lifeforce khỏi một kẻ địch. Kẻ địch trong Culling range sẽ được highlight và bị giết ngay khi Hit, cấp Power Charge. Chỉ có thể nhắm kẻ địch trong Culling range."
  ],
  [
    "Summon Ruzhan, an invulnerable Flame Djinn Minion, to do your bidding. Ruzhan emerges to Strike enemies with his greatsword whenever you use a damaging Skill, and casts devastating Fire Spells when Commanded to do so.",
    "Summon Ruzhan, Flame Djinn Minion bất khả thương, để làm theo lệnh của bạn. Ruzhan xuất hiện và Strike kẻ địch bằng greatsword mỗi khi bạn dùng Skill gây Damage, đồng thời cast Fire Spells cực mạnh khi được Command."
  ],
  [
    "Load your Crossbow with Piercing bolts that apply Riven Armour to enemies with Fully Broken Armour, causing any Hits against those enemies to deal extra damage.",
    "Nạp Crossbow bằng Piercing bolts áp dụng Riven Armour lên kẻ địch có Fully Broken Armour, khiến mọi Hit lên các kẻ địch đó gây thêm Damage."
  ],
  [
    "Channel to conjure a swarm of bone spikes in the air, then release to fire them at enemies and explode. Shrapnel Impales enemies Hit, causing subsequent Attack Hits against those targets to deal extra damage. Consumes your Power Charges to cause much larger explosions.",
    "Channel để tạo một đàn gai xương trên không, rồi release để bắn chúng vào kẻ địch và phát nổ. Shrapnel Impale kẻ địch bị Hit, khiến các Attack Hit tiếp theo lên mục tiêu đó gây thêm Damage. Consume Power Charges của bạn để tạo vụ nổ lớn hơn nhiều."
  ],
  [
    "Load your Crossbow with charged bolts that fragment in flight, releasing Chaining Lightning beams when they Hit enemies. These fragments can Merge.",
    "Nạp Crossbow bằng charged bolts vỡ mảnh khi bay, release các Chaining Lightning beams khi Hit kẻ địch. Các mảnh này có thể Merge."
  ],
  [
    "Channel to charge up your weapon with Fire. Releasing with Perfect Timing will create a damaging wave of intense Fire.",
    "Channel để nạp Fire vào vũ khí. Release với Perfect Timing sẽ tạo một wave Fire cực mạnh gây Damage."
  ],
  [
    "Consume the elemental energy from a Frozen, Shocked or Ignited enemy, creating an elemental blast that leaves behind an Infusion Remnant. The blast will spread to other enemies affected by the same Ailment, but those blasts cannot spread further. Can also be cast on a Frostbolt to create a larger cold blast.",
    "Consume năng lượng elemental từ kẻ địch Frozen, Shocked hoặc Ignited, tạo một elemental blast để lại Infusion Remnant. Blast sẽ lan sang kẻ địch khác đang chịu cùng Ailment, nhưng các blast đó không thể lan tiếp. Cũng có thể cast lên Frostbolt để tạo cold blast lớn hơn."
  ],
  [
    "Leap forward and Slam the ground, sending out a shockwave. The shockwave applies Broken Stance to Dazed enemies, causing any Hits against those enemies to deal extra damage.",
    "Nhảy tới trước và Slam xuống đất, phóng ra Shockwave. Shockwave áp dụng Broken Stance lên kẻ địch Dazed, khiến mọi Hit lên các kẻ địch đó gây thêm Damage."
  ],
  [
    "Ram your Shield into the ground, throwing up a wall of earth. Enemies can attack your wall segments, and your Slams, Warcries, and Shield Charge will instantly shatter them all. The segments explode when shattered, damaging enemies in front of and around them.",
    "Đập Shield xuống đất, dựng lên một tường đất. Kẻ địch có thể tấn công các đoạn tường; Slams, Warcries và Shield Charge của bạn sẽ lập tức shatter toàn bộ chúng. Các đoạn tường phát nổ khi bị shatter, gây Damage lên kẻ địch phía trước và xung quanh."
  ],
  [
    "Fire a Lightning-charged arrow that homes in on enemies afflicted by Lightning Ailments. Hitting such an enemy will cause your arrow to release a damaging shockwave and Chain towards nearby targets, with those Chaining Hits also releasing a shockwave. After the final Chain, the arrow lodges into the ground as a Lightning Rod. Consumes Shock from enemies it Hits, but not Electrocution.",
    "Bắn một arrow tích Lightning tự tìm tới kẻ địch đang chịu Lightning Ailments. Hit kẻ địch đó sẽ khiến arrow release Shockwave gây Damage và Chain tới các mục tiêu gần đó; các Chaining Hits này cũng release Shockwave. Sau Chain cuối, arrow cắm xuống đất thành Lightning Rod. Consume Shock từ kẻ địch bị Hit, nhưng không Consume Electrocution."
  ],
  [
    "Charges forward, cracking the earth and leaving a patch of Jagged Ground with every footstep. At the end of your charge, a massive leaping Slam damages enemies and causes all nearby patches of Jagged Ground to explode, damaging enemies standing on them. Once you begin your charge, the use speed of this Skill is affected by movement speed instead of Attack speed.",
    "Charge về phía trước, nứt đất và để lại một mảng Jagged Ground theo mỗi bước chân. Cuối cú charge, một leaping Slam cực mạnh gây Damage lên kẻ địch và khiến mọi mảng Jagged Ground gần đó phát nổ, gây Damage lên kẻ địch đứng trên chúng. Khi đã bắt đầu charge, Use Speed của Skill này chịu ảnh hưởng bởi Movement Speed thay vì Attack Speed."
  ],
  [
    "Flip backward and Channel to charge your Quarterstaff with Lightning. Releasing dashes towards the target location, damaging enemies along the way. Releasing with Perfect Timing performs a Lightning-assisted dash that releases shockwaves from enemies you dash through and leaves a trail of Shocked Ground in your wake. This skill cannot be Ancestrally Boosted.",
    "Lộn ra sau và Channel để nạp Lightning vào Quarterstaff. Release sẽ lướt tới vị trí mục tiêu, gây Damage lên kẻ địch trên đường. Release với Perfect Timing thực hiện một dash được Lightning hỗ trợ, release Shockwaves từ kẻ địch bạn lướt xuyên qua và để lại vệt Shocked Ground phía sau. Skill này không thể được Ancestrally Boosted."
  ],
  [
    "Summon Kelari, an invulnerable Sand Djinn Minion, to do your bidding. Kelari will only act when you Command him to do so. Kelari delivers swift Hits with massive Critical Hit potential.",
    "Summon Kelari, Sand Djinn Minion bất khả thương, để làm theo lệnh của bạn. Kelari chỉ hành động khi bạn Command. Kelari gây các Hit nhanh với tiềm năng Critical Hit rất lớn."
  ],
  [
    "Summon Navira, an invulnerable Water Djinn Minion to do your bidding. Navira will only act when you Command her to do so, bestowing restorative blessings upon you and your Allies with her Spells.",
    "Summon Navira, Water Djinn Minion bất khả thương, để làm theo lệnh của bạn. Navira chỉ hành động khi bạn Command, ban các restorative blessings cho bạn và Allies bằng Spells của cô ấy."
  ],
  [
    "Fire a Piercing Projectile that seeks out enemies. Enemies hit are inflicted with a Debuff that Hinders them and deals Chaos damage over time for a short duration.",
    "Bắn một Piercing Projectile tự tìm kẻ địch. Kẻ địch bị Hit sẽ nhận Debuff Hinder và chịu Chaos Damage theo thời gian trong thời lượng ngắn."
  ]
]) {
  EXACT_SKILL_TEXT_TRANSLATIONS.set(source, translation);
}

const normalizeSkillTarget = (value = "") => normalizeText(value)
  .replace(/\bcrossbow\b/gi, "Crossbow")
  .replace(/\baxe\b/gi, "Axe")
  .replace(/\baxes\b/gi, "Axes")
  .replace(/\bbow\b/gi, "Bow")
  .replace(/\bclaws\b/gi, "Claws")
  .replace(/\bdaggers\b/gi, "Daggers")
  .replace(/\bflail\b/gi, "Flail")
  .replace(/\bmace\b/gi, "Mace")
  .replace(/\bquarterstaff\b/gi, "Quarterstaff")
  .replace(/\bshield\b/gi, "Shield")
  .replace(/\bspell\b/gi, "Spell")
  .replace(/\bspells\b/gi, "Spells")
  .replace(/\bskill\b/gi, "Skill")
  .replace(/\bskills\b/gi, "Skills")
  .replace(/\bprojectile\b/gi, "Projectile")
  .replace(/\bprojectiles\b/gi, "Projectiles")
  .replace(/\benemies\b/gi, "kẻ địch")
  .replace(/\benemy\b/gi, "kẻ địch")
  .replace(/\btargets\b/gi, "mục tiêu")
  .replace(/\btarget\b/gi, "mục tiêu");

const normalizeProtectedSkillTerms = (value = "") => normalizeText(value)
  .replace(/\bRare and Unique kẻ địch\b/gi, "Rare và Unique enemy")
  .replace(/\b(Normal|Magic|Rare|Unique|Non-Unique) kẻ địch\b/g, "$1 enemy")
  .replace(/\b(Normal|Magic|Rare|Unique|Non-Unique) enemies\b/gi, "$1 enemy")
  .replace(/\b(Normal|Magic|Rare|Unique|Non-Unique) enemy\b/gi, (_, rarity) => `${rarity} enemy`)
  .replace(/\bnormal item\b/gi, "Normal item")
  .replace(/\bmagic item\b/gi, "Magic item")
  .replace(/\brare item\b/gi, "Rare item")
  .replace(/\bunique item\b/gi, "Unique item")
  .replace(/\bCannot\b/g, "Không thể")
  .replace(/\bcannot\b/g, "không thể")
  .replace(/\bCan be\b/g, "Có thể")
  .replace(/\bcan be\b/g, "có thể")
  .replace(/\bCó thể được affected\b/gi, "có thể bị ảnh hưởng")
  .replace(/\bCó thể được triggered\b/gi, "có thể Trigger")
  .replace(/\bCó thể được collected\b/gi, "có thể nhặt")
  .replace(/\bCó thể được được dùng\b/gi, "có thể dùng")
  .replace(/\bCó thể only create one\b/gi, "chỉ có thể tạo một")
  .replace(/\bonly create one\b/gi, "chỉ tạo một")
  .replace(/\bKhông thể gây\b/gi, "Không thể gây")
  .replace(/\bKhông thể create\b/gi, "Không thể tạo")
  .replace(/\bKhông thể nhận\b/gi, "Không thể nhận")
  .replace(/\bKhông thể Nhận\b/gi, "Không thể nhận")
  .replace(/\bAny\b/g, "Bất kỳ")
  .replace(/\bany\b/g, "bất kỳ")
  .replace(/\bfive\b/gi, "5")
  .replace(/\bModifiers để (.+?) cũng affects\b/gi, "Modifier lên $1 cũng ảnh hưởng")
  .replace(/\baffects\b/gi, "ảnh hưởng")
  .replace(/\baffected\b/gi, "bị ảnh hưởng")
  .replace(/\bappears\b/gi, "xuất hiện")
  .replace(/\bCreate\b/g, "Tạo")
  .replace(/\bCreates\b/g, "Tạo")
  .replace(/\bcreate\b/g, "tạo")
  .replace(/\bcreated\b/gi, "được tạo")
  .replace(/\baccumulate\b/gi, "tích lũy")
  .replace(/\baccumulated\b/gi, "đã tích lũy")
  .replace(/\bnumber của Projectiles instead áp dụng để number của Embers accumulated\b/gi, "số Projectile thay vào đó áp dụng cho số Embers đã tích lũy")
  .replace(/\binstead áp dụng để\b/gi, "thay vào đó áp dụng cho")
  .replace(/\binstead của\b/gi, "thay vì")
  .replace(/\binstead\b/gi, "thay vào đó")
  .replace(/\bConverted để\b/gi, "Convert thành")
  .replace(/\bConverted to\b/gi, "Convert thành")
  .replace(/\bConverted\b/gi, "Convert")
  .replace(/\bConverted thành\b/gi, "Convert thành")
  .replace(/\bConvert Physical damage để Cold damage\b/gi, "Convert Physical damage thành Cold damage")
  .replace(/\bPower Charge was Consumed\b/gi, "Power Charge đã được Consume")
  .replace(/\bFrenzy Charge was Consumed\b/gi, "Frenzy Charge đã được Consume")
  .replace(/\bPower Charge Consumed\b/gi, "Power Charge đã Consume")
  .replace(/\bFrenzy Charge Consumed\b/gi, "Frenzy Charge đã Consume")
  .replace(/\bEndurance Charge Consumed\b/gi, "Endurance Charge đã Consume")
  .replace(/\bBlood Loss Consumed\b/gi, "Blood Loss đã Consume")
  .replace(/\bCorpse Consumed\b/gi, "Corpse đã Consume")
  .replace(/\bCorpse consumed\b/gi, "Corpse đã Consume")
  .replace(/\bconsumed\b/gi, "đã Consume")
  .replace(/\bConsumed\b/g, "đã Consume")
  .replace(/\bRecover (.+?) over (.+?) giây\b/gi, "Hồi $1 trong $2 giây")
  .replace(/\bRegenerates (.+?) over (.+?) giây\b/gi, "Regenerate $1 trong $2 giây")
  .replace(/\bRecover\b/g, "Hồi")
  .replace(/\bRegenerates\b/g, "Regenerate")
  .replace(/\bover (\S+) giây\b/gi, "trong $1 giây")
  .replace(/\blasts (.+?) giây\b/gi, "kéo dài $1 giây")
  .replace(/\blasts\b/gi, "kéo dài")
  .replace(/\blast\b/gi, "kéo dài")
  .replace(/\blevel higher than\b/gi, "level cao hơn")
  .replace(/\bfor mỗi\b/gi, "cho mỗi")
  .replace(/\bFor mỗi\b/g, "Cho mỗi")
  .replace(/\bfrom mỗi\b/gi, "cho mỗi")
  .replace(/\bagainst\b/gi, "lên")
  .replace(/\bHits lên\b/g, "Hit lên")
  .replace(/\bHit against\b/gi, "Hit lên")
  .replace(/\bmore damage lên\b/gi, "more Damage lên")
  .replace(/\bmore damage\b/gi, "more Damage")
  .replace(/\bincreased damage\b/gi, "increased Damage")
  .replace(/\bincreased area của Effect\b/gi, "increased Area of Effect")
  .replace(/\barea của Effect\b/gi, "Area of Effect")
  .replace(/\barea của effect\b/gi, "Area of Effect")
  .replace(/\barea of Effect\b/gi, "Area of Effect")
  .replace(/\bEffect của\b/gi, "Effect của")
  .replace(/\bIgnite thời lượng for mỗi Fragment trong một single hit\b/gi, "Ignite Duration cho mỗi Fragment trong một Hit")
  .replace(/\bfor mỗi Fragment trong một single hit\b/gi, "cho mỗi Fragment trong một Hit")
  .replace(/\bmột single use\b/gi, "một lần dùng")
  .replace(/\bmột single Hit\b/gi, "một Hit")
  .replace(/\bMinimum (.+?) giây between gaining Stages\b/gi, "Tối thiểu $1 giây giữa các lần nhận Stage")
  .replace(/\bbetween gaining Ghost Shrouds\b/gi, "giữa các lần nhận Ghost Shroud")
  .replace(/\bCooldown không recover during Buff effect\b/gi, "Cooldown không hồi trong thời gian Buff")
  .replace(/\bduring Buff effect\b/gi, "trong thời gian Buff")
  .replace(/\bRun speed là bị ảnh hưởng bởi (.+?) modifiers thay vì (.+?) modifiers\b/gi, "Run Speed chịu ảnh hưởng bởi $1 modifier thay vì $2 modifier")
  .replace(/\bremoved\b/gi, "bị xóa")
  .replace(/\bremoved sau\b/gi, "bị xóa sau")
  .replace(/\bis removed\b/gi, "bị xóa")
  .replace(/\blà removed\b/gi, "bị xóa")
  .replace(/\btrigger Socketed Warcry thay vì\b/gi, "Trigger Socketed Warcry thay vì")
  .replace(/\btrigger\b/g, "Trigger")
  .replace(/\btriggered\b/gi, "Trigger")
  .replace(/\breload\b/gi, "reload")
  .replace(/\brestores one cooldown use for của bạn Grenades\b/gi, "hồi một lần dùng cooldown cho Grenades của bạn")
  .replace(/\bMinimum thời lượng between consumptions là\b/gi, "Thời gian tối thiểu giữa các lần Consume là")
  .replace(/\bview Monster Categories\b/gi, "xem Monster Categories")
  .replace(/\bLarge meteors Có thể mục tiêu một single enemy only một lần mỗi\b/gi, "Large meteor chỉ có thể nhắm một enemy một lần mỗi")
  .replace(/\bonly một lần\b/gi, "chỉ một lần")
  .replace(/\bwith its first Hit\b/gi, "với Hit đầu tiên của nó")
  .replace(/\bits first Hit\b/gi, "Hit đầu tiên của nó")
  .replace(/\bany type\b/gi, "bất kỳ type nào")
  .replace(/\bto không destroy\b/gi, "để không phá hủy")
  .replace(/\bdestroy\b/gi, "phá hủy")
  .replace(/\bfully Overflowed\b/gi, "Overflow hoàn toàn")
  .replace(/\bfully imbued\b/gi, "được imbue đầy đủ")
  .replace(/\bover time\b/gi, "theo thời gian")
  .replace(/\bon death\b/gi, "khi chết")
  .replace(/\bupon Consume\b/gi, "khi Consume")
  .replace(/\bupon\b/gi, "khi")
  .replace(/\bsocketed Marks\b/gi, "Marks được socket")
  .replace(/\bsocketed Curses\b/gi, "Curses được socket")
  .replace(/\bsocketed Curse\b/gi, "Curse được socket")
  .replace(/\bsocketed Skills\b/gi, "Skills được socket")
  .replace(/\bsocketed Warcry\b/gi, "Warcry được socket")
  .replace(/\bSocketed skills\b/gi, "Socketed Skills")
  .replace(/\bSocketed Skills cannot Consume Charges\b/gi, "Socketed Skills không thể Consume Charges")
  .replace(/\bSupported Skills cannot Consume Charges\b/gi, "Supported Skills không thể Consume Charges")
  .replace(/\bSupported Crossbow Ammunition Skills cannot reload\b/gi, "Supported Crossbow Ammunition Skills không thể reload")
  .replace(/\bProjectiles cannot Split\b/gi, "Projectiles không thể Split")
  .replace(/\bCannot gây Freeze buildup hoặc inflict Chill\b/gi, "Không thể gây Freeze buildup hoặc inflict Chill")
  .replace(/\bCannot gây Freeze Buildup\b/gi, "Không thể gây Freeze Buildup")
  .replace(/\bCannot gây Bleeding\b/gi, "Không thể gây Bleeding")
  .replace(/\bCannot gây Critical Hits\b/gi, "Không thể gây Critical Hits")
  .replace(/\bCannot gây Stun buildup\b/gi, "Không thể gây Stun buildup")
  .replace(/\bCannot nhận Rage\b/gi, "Không thể nhận Rage")
  .replace(/\byou cannot nhận\b/gi, "bạn không thể nhận")
  .replace(/\bMaximum 100 Unbound Fury Không thể Nhận Unbound Fury khi Unbound\b/gi, "Tối đa 100 Unbound Fury. Không thể nhận Unbound Fury khi đang Unbound")
  .replace(/\bMaximum 3 Stages Channelling kết thúc 1 giây sau reaching stage tối đa Releases 1 Aftershock mỗi Stage\b/gi, "Tối đa 3 Stage. Channelling kết thúc 1 giây sau khi đạt stage tối đa. Release 1 Aftershock mỗi Stage")
  .replace(/\bMaximum\b/g, "Tối đa")
  .replace(/\breaching\b/gi, "đạt")
  .replace(/\bReleases\b/g, "Release")
  .replace(/\bRelease\b/g, "Release")
  .replace(/\breleases\b/g, "phát ra")
  .replace(/\bmoves forward erratically\b/gi, "di chuyển ngẫu nhiên về phía trước")
  .replace(/\bthat can fire\b/gi, "có thể bắn")
  .replace(/\bthat can detonate\b/gi, "có thể detonate")
  .replace(/\bthat heal\b/gi, "có thể heal")
  .replace(/\bthat can call down\b/gi, "có thể gọi xuống")
  .replace(/\bthat can Stun\b/gi, "có thể Stun")
  .replace(/\bthat can enrage\b/gi, "có thể enrage")
  .replace(/\bdo của bạn bidding\b/gi, "làm theo lệnh của bạn")
  .replace(/\bonly act\b/gi, "chỉ hành động")
  .replace(/\bdo so\b/gi, "làm vậy")
  .replace(/\bdelivers\b/gi, "gây ra")
  .replace(/\bbestowing\b/gi, "ban")
  .replace(/\bupon bạn\b/gi, "cho bạn")
  .replace(/\bwith her Spells\b/gi, "bằng Spells của cô ấy")
  .replace(/\bwith his greatsword\b/gi, "bằng greatsword của hắn")
  .replace(/\bwhenever bạn use\b/gi, "mỗi khi bạn dùng")
  .replace(/\bcasts\b/gi, "cast")
  .replace(/\bCommanded để do so\b/gi, "được Command làm vậy")
  .replace(/\bBắn một arrow đó drops từ trên cao\b/gi, "Bắn một arrow rơi từ trên cao")
  .replace(/\bremains trong các mặt đất\b/gi, "nằm lại trên mặt đất")
  .replace(/\bChaining Lightning beams Có thể Chain để it\b/gi, "Lightning beam đang Chain có thể Chain vào nó")
  .replace(/\bkhi Chained để\b/gi, "khi bị Chain vào")
  .replace(/\breleasing another\b/gi, "phát ra thêm")
  .replace(/\bFire damage\b/g, "Fire Damage")
  .replace(/\bCold damage\b/g, "Cold Damage")
  .replace(/\bLightning damage\b/g, "Lightning Damage")
  .replace(/\bPhysical damage\b/g, "Physical Damage")
  .replace(/\bChaos damage\b/g, "Chaos Damage")
  .replace(/\bHit damage\b/g, "Hit Damage")
  .replace(/\bdamage\b/g, "Damage")
  .replace(/\bDamage lên\b/g, "Damage lên")
  .replace(/\bmặt đất\b/g, "mặt đất");

const hasUnicodeLetterBeside = (source, index, length) => (
  /\p{L}$/u.test(source.slice(0, index)) || /^\p{L}/u.test(source.slice(index + length))
);

const applySkillTextReplacements = (value, replacements) => replacements.reduce(
  (current, [pattern, replacement]) => current.replace(pattern, (...args) => {
    const match = args[0];
    const offset = args[args.length - 2];
    const source = args[args.length - 1];
    if (hasUnicodeLetterBeside(source, offset, match.length)) return match;
    return typeof replacement === "function" ? replacement(...args) : replacement;
  }),
  value
);

const SKILL_TEXT_REPLACEMENTS = [
  [/\bWhile active\b/gi, "Khi đang active"],
  [/\bShapeshift into a\b/gi, "Biến hình thành một"],
  [/\bDeploy a\b/gi, "Triển khai một"],
  [/\bRaise a\b/gi, "Dựng một"],
  [/\bCreate a\b/gi, "Tạo một"],
  [/\bCreate an\b/gi, "Tạo một"],
  [/\bConjures a number of\b/gi, "Tạo nhiều"],
  [/\bConjures a\b/gi, "Tạo một"],
  [/\bConjures an\b/gi, "Tạo một"],
  [/\bConjure a\b/gi, "Tạo một"],
  [/\bConjure an\b/gi, "Tạo một"],
  [/\bConjures\b/gi, "Tạo"],
  [/\bConjure\b/gi, "Tạo"],
  [/\bCreates a\b/gi, "tạo một"],
  [/\bcreated by\b/gi, "được tạo bởi"],
  [/\bcreating a\b/gi, "tạo một"],
  [/\bcreating\b/gi, "tạo"],
  [/\bConsume all\b/gi, "Consume toàn bộ"],
  [/\bConsume any combination of\b/gi, "Consume tổ hợp bất kỳ gồm"],
  [/\bConsume a\b/gi, "Consume một"],
  [/\bConsume\b/gi, "Consume"],
  [/\bConsumes\b/gi, "Consume"],
  [/\bConsuming\b/gi, "Consume"],
  [/\bChannel to\b/gi, "Channel để"],
  [/\bChannelling ends\b/gi, "Channelling kết thúc"],
  [/\bFire an\b/gi, "Bắn một"],
  [/\bFire a\b/gi, "Bắn một"],
  [/\bFires\b/gi, "Bắn"],
  [/\bLaunch a\b/gi, "Phóng một"],
  [/\bLaunch\b/gi, "Phóng"],
  [/\bLoad your Crossbow with\b/gi, "Nạp Crossbow bằng"],
  [/\bLoad your Bow with\b/gi, "Nạp Bow bằng"],
  [/\bUsing this Skill again reloads the clip\b/gi, "Dùng lại Skill này sẽ reload clip"],
  [/\bUsing this Skill releases\b/gi, "Dùng Skill này sẽ phóng thích"],
  [/\busing this Skill\b/gi, "dùng Skill này"],
  [/\bthis skill\b/gi, "skill này"],
  [/\bthis Skill\b/gi, "Skill này"],
  [/\bSkill's cooldown\b/gi, "cooldown của Skill"],
  [/\bCannot use\b/gi, "Không thể dùng"],
  [/\bCannot socket\b/gi, "Không thể socket"],
  [/\bCannot Empower\b/gi, "Không thể Empower"],
  [/\bCan Consume\b/gi, "Có thể Consume"],
  [/\bCan spend\b/gi, "Có thể tiêu Rage để"],
  [/\bCan also be used\b/gi, "Cũng có thể dùng"],
  [/\bCan\b/gi, "Có thể"],
  [/\bInstantly reload\b/gi, "Reload ngay"],
  [/\breload all\b/gi, "reload toàn bộ"],
  [/\breloads\b/gi, "reload"],
  [/\bMark a target\b/gi, "Đánh dấu một mục tiêu"],
  [/\bMarking another target\b/gi, "Đánh dấu mục tiêu khác"],
  [/\bMarked target\b/gi, "mục tiêu bị Mark"],
  [/\bMarked enemy\b/gi, "kẻ địch bị Mark"],
  [/\bthe Marked target\b/gi, "mục tiêu bị Mark"],
  [/\bthe Mark\b/gi, "Mark"],
  [/\bMark Activates\b/gi, "Mark Activate"],
  [/\bActivates\b/gi, "Activate"],
  [/\bCapture the spirit of\b/gi, "Bắt giữ linh hồn của"],
  [/\btransforming this gem to instead allow you to summon\b/gi, "biến gem này thành dạng cho phép bạn summon"],
  [/\bto instead allow you to summon\b/gi, "để thay vào đó cho phép bạn summon"],
  [/\bSummon\b/gi, "Summon"],
  [/\bsummon\b/gi, "summon"],
  [/\bReviving Minion\b/gi, "Reviving Minion"],
  [/\bReviving Companion\b/gi, "Reviving Companion"],
  [/\bReviving Minions\b/gi, "Reviving Minions"],
  [/\bMinions\b/gi, "Minions"],
  [/\bMinion\b/gi, "Minion"],
  [/\bCompanion\b/gi, "Companion"],
  [/\bDash to a target\b/gi, "Lướt tới mục tiêu"],
  [/\bDash to an enemy\b/gi, "Lướt tới một kẻ địch"],
  [/\bLeap into the air\b/gi, "Nhảy lên không trung"],
  [/\bLeap backwards\b/gi, "Nhảy lùi"],
  [/\bLeap backward\b/gi, "Nhảy lùi"],
  [/\bLeap\b/gi, "Nhảy"],
  [/\bHurl a\b/gi, "Ném một"],
  [/\bHurl your\b/gi, "Ném"],
  [/\bSweep your\b/gi, "Quét"],
  [/\bprojecting a\b/gi, "phóng ra một"],
  [/\bSlam the ground\b/gi, "Nện xuống đất"],
  [/\bSlamming the ground\b/gi, "nện xuống đất"],
  [/\bSlam\b/gi, "Slam"],
  [/\bPerform a\b/gi, "Thực hiện một"],
  [/\bPerform\b/gi, "Thực hiện"],
  [/\bReady a volley of\b/gi, "Chuẩn bị một loạt"],
  [/\bRecruit\b/gi, "Tuyển"],
  [/\bManifest a copy of\b/gi, "Manifest một bản sao của"],
  [/\bManipulate time\b/gi, "Điều khiển thời gian"],
  [/\bAugment yourself\b/gi, "Cường hóa bản thân"],
  [/\bTap into\b/gi, "Khai thác"],
  [/\bPassively generate\b/gi, "Tự động tạo"],
  [/\bActivate to\b/gi, "Activate để"],
  [/\bRain a storm of\b/gi, "Gọi xuống một cơn bão"],
  [/\bRain\b/gi, "Gọi mưa"],
  [/\bGain a Buff\b/gi, "Nhận một Buff"],
  [/\bgain a Buff\b/gi, "nhận một Buff"],
  [/\bgain powerful Buffs\b/gi, "nhận các Buff mạnh"],
  [/\bgains Energy when\b/gi, "nhận Energy khi"],
  [/\bgains\b/gi, "nhận"],
  [/\bGain\b/gi, "Nhận"],
  [/\bgain\b/gi, "nhận"],
  [/\bgrants you\b/gi, "cấp cho bạn"],
  [/\bgrants a\b/gi, "cấp một"],
  [/\bgrants\b/gi, "cấp"],
  [/\bgrant\b/gi, "cấp"],
  [/\bEmpowering\b/gi, "Empower"],
  [/\bEmpower\b/gi, "Empower"],
  [/\bEmpowers\b/gi, "Empower"],
  [/\bTriggers\b/gi, "Trigger"],
  [/\btriggers\b/gi, "trigger"],
  [/\btriggering\b/gi, "trigger"],
  [/\btrigger\b/gi, "trigger"],
  [/\bsocketed Spells\b/gi, "Spells được socket"],
  [/\bsocketed ranged Attacks\b/gi, "ranged Attacks được socket"],
  [/\bsocketed Grenade Skills\b/gi, "Grenade Skills được socket"],
  [/\bsocketed Mace Skills\b/gi, "Mace Skills được socket"],
  [/\bsocketed Shapeshifting Attack\b/gi, "Shapeshifting Attack được socket"],
  [/\bupon reaching maximum Energy\b/gi, "khi đạt Energy tối đa"],
  [/\bon reaching maximum Energy\b/gi, "khi đạt Energy tối đa"],
  [/\bsufficient Energy is gathered\b/gi, "đã tích đủ Energy"],
  [/\bwill create\b/gi, "sẽ tạo"],
  [/\bwill cause\b/gi, "sẽ gây"],
  [/\bwill remove\b/gi, "sẽ gỡ"],
  [/\bwill dissipate\b/gi, "sẽ tan biến"],
  [/\bwill prevent you from\b/gi, "sẽ ngăn bạn"],
  [/\bthat crawls forward\b/gi, "bò về phía trước"],
  [/\bcauses you to\b/gi, "khiến bạn"],
  [/\bcauses it to\b/gi, "khiến nó"],
  [/\bcauses\b/gi, "khiến"],
  [/\bcausing\b/gi, "khiến"],
  [/\bto cause\b/gi, "để gây"],
  [/\bdamaging and Slowing them\b/gi, "gây damage và Slow chúng"],
  [/\bdeal extra\b/gi, "gây thêm"],
  [/\bdeal more damage\b/gi, "gây nhiều damage hơn"],
  [/\bdeal damage\b/gi, "gây damage"],
  [/\bdeals\b/gi, "gây"],
  [/\bdamaging\b/gi, "gây damage lên"],
  [/\bdamages\b/gi, "gây damage lên"],
  [/\bdamage\b/gi, "damage"],
  [/\bfor a short duration\b/gi, "trong thời lượng ngắn"],
  [/\bfor a duration\b/gi, "trong một thời lượng"],
  [/\bfor a brief period\b/gi, "trong một khoảng ngắn"],
  [/\bfor a short time\b/gi, "trong thời gian ngắn"],
  [/\bevery few seconds\b/gi, "mỗi vài giây"],
  [/\bevery second\b/gi, "mỗi giây"],
  [/\bperiodically\b/gi, "theo chu kỳ"],
  [/\bWhile the fissure persists\b/gi, "Khi khe nứt còn tồn tại"],
  [/\bpassively\b/gi, "một cách bị động"],
  [/\bwhile you remain inside it\b/gi, "khi bạn còn đứng bên trong"],
  [/\bwhen you exit it\b/gi, "khi bạn rời khỏi nó"],
  [/\brun out of Mana\b/gi, "cạn Mana"],
  [/\bmaximum Energy\b/gi, "Energy tối đa"],
  [/\bmaximum Mana\b/gi, "Mana tối đa"],
  [/\bmaximum Life\b/gi, "Life tối đa"],
  [/\bmaximum Rage\b/gi, "Rage tối đa"],
  [/\bmaximum Glory\b/gi, "Glory tối đa"],
  [/\bmaximum stages\b/gi, "stage tối đa"],
  [/\bmaximum Heat\b/gi, "Heat tối đa"],
  [/\btargeted area\b/gi, "vùng mục tiêu"],
  [/\btarget location\b/gi, "vị trí mục tiêu"],
  [/\btarget receives\b/gi, "mục tiêu nhận"],
  [/\bthe target receives\b/gi, "mục tiêu nhận"],
  [/\btowards the target\b/gi, "về phía mục tiêu"],
  [/\btowards a target\b/gi, "về phía mục tiêu"],
  [/\btowards\b/gi, "về phía"],
  [/\bthe target\b/gi, "mục tiêu"],
  [/\ba target\b/gi, "một mục tiêu"],
  [/\btarget\b/gi, "mục tiêu"],
  [/\bnearby enemies\b/gi, "kẻ địch gần đó"],
  [/\bsurrounding enemies\b/gi, "kẻ địch xung quanh"],
  [/\benemies near them\b/gi, "kẻ địch gần chúng"],
  [/\benemies\b/gi, "kẻ địch"],
  [/\benemy\b/gi, "kẻ địch"],
  [/\bAllies\b/gi, "Allies"],
  [/\bin your Presence\b/gi, "trong Presence của bạn"],
  [/\bin its path\b/gi, "trên đường đi"],
  [/\bin an area\b/gi, "trong một vùng"],
  [/\bin the area\b/gi, "trong vùng"],
  [/\baround you\b/gi, "quanh bạn"],
  [/\bin front of you\b/gi, "trước mặt bạn"],
  [/\bat the end of its flight\b/gi, "ở cuối đường bay"],
  [/\bat the target location\b/gi, "tại vị trí mục tiêu"],
  [/\brootbound fissure\b/gi, "khe nứt bám rễ"],
  [/\bicy fissure\b/gi, "khe nứt băng"],
  [/\bfissures\b/gi, "khe nứt"],
  [/\bfissure\b/gi, "khe nứt"],
  [/\bvines lash out from it\b/gi, "dây leo quất ra từ đó"],
  [/\blash out from it\b/gi, "quất ra từ đó"],
  [/\battach to\b/gi, "bám vào"],
  [/\bVines\b/g, "dây leo"],
  [/\bvines\b/g, "dây leo"],
  [/\bfrom your Mana Flask\b/gi, "từ Mana Flask của bạn"],
  [/\byour Crossbow\b/gi, "Crossbow của bạn"],
  [/\byour Quarterstaff\b/gi, "Quarterstaff của bạn"],
  [/\byour Bow\b/gi, "Bow của bạn"],
  [/\byour Spear\b/gi, "Spear của bạn"],
  [/\byour Shield\b/gi, "Shield của bạn"],
  [/\byour Spells\b/gi, "Spells của bạn"],
  [/\byour Skills\b/gi, "Skills của bạn"],
  [/\byour Skill\b/gi, "Skill của bạn"],
  [/\byour Minions\b/gi, "Minions của bạn"],
  [/\byour Flasks\b/gi, "Flasks của bạn"],
  [/\byour Rage\b/gi, "Rage của bạn"],
  [/\byour active Charges\b/gi, "các Charge hiện có"],
  [/\bPower Charges\b/gi, "Power Charges"],
  [/\bEndurance Charges\b/gi, "Endurance Charges"],
  [/\bFrenzy Charges\b/gi, "Frenzy Charges"],
  [/\bCharges\b/gi, "Charges"],
  [/\bCharge\b/gi, "Charge"],
  [/\bSpells\b/gi, "Spells"],
  [/\bSpell\b/gi, "Spell"],
  [/\bAttacks\b/gi, "Attacks"],
  [/\bAttack\b/gi, "Attack"],
  [/\bProjectiles\b/gi, "Projectiles"],
  [/\bProjectile\b/gi, "Projectile"],
  [/\bArrows\b/gi, "Arrows"],
  [/\barrows\b/gi, "arrows"],
  [/\barrow\b/gi, "arrow"],
  [/\bbolts\b/gi, "bolts"],
  [/\bbolt\b/gi, "bolt"],
  [/\bBuffs\b/gi, "Buffs"],
  [/\bBuff\b/gi, "Buff"],
  [/\bDebuff\b/gi, "Debuff"],
  [/\bCurse\b/gi, "Curse"],
  [/\bCurses\b/gi, "Curses"],
  [/\bElemental Ailments\b/gi, "Elemental Ailments"],
  [/\bElemental Infusion\b/gi, "Elemental Infusion"],
  [/\bFire Infusion\b/gi, "Fire Infusion"],
  [/\bLightning Infusion\b/gi, "Lightning Infusion"],
  [/\bCold Infusion\b/gi, "Cold Infusion"],
  [/\bLightning damage\b/gi, "Lightning damage"],
  [/\bCold damage\b/gi, "Cold damage"],
  [/\bFire damage\b/gi, "Fire damage"],
  [/\bChaos damage\b/gi, "Chaos damage"],
  [/\bPhysical damage\b/gi, "Physical damage"],
  [/\bmore damage\b/gi, "more damage"],
  [/\bextra\b/gi, "thêm"],
  [/\badditional\b/gi, "thêm"],
  [/\bthe affected Element\b/gi, "Element đang được ảnh hưởng"],
  [/\bwith Element đang được ảnh hưởng\b/gi, "với Element đang được ảnh hưởng"],
  [/\bpowerful\b/gi, "mạnh"],
  [/\bmuch larger\b/gi, "lớn hơn nhiều"],
  [/\blarger\b/gi, "lớn hơn"],
  [/\bmore slowly\b/gi, "chậm hơn"],
  [/\bSlowing their movement speed\b/gi, "Slow tốc độ di chuyển của chúng"],
  [/\bSlowing them\b/gi, "Slow chúng"],
  [/\bSlowing\b/gi, "Slow"],
  [/\bquickly\b/gi, "nhanh"],
  [/\bshort-lived\b/gi, "tồn tại ngắn"],
  [/\bnearby\b/gi, "gần đó"],
  [/\bbehind you\b/gi, "phía sau bạn"],
  [/\bfrom above\b/gi, "từ trên cao"],
  [/\bskyward\b/gi, "lên trời"],
  [/\bHowever\b/gi, "Tuy nhiên"],
  [/\bmodified by\b/gi, "được điều chỉnh bởi"],
  [/\baffected by\b/gi, "bị ảnh hưởng bởi"],
  [/\bcaused by\b/gi, "do"],
  [/\bcannot be\b/gi, "không thể được"],
  [/\bcan't be\b/gi, "không thể bị"],
  [/\bcan be\b/gi, "có thể được"],
  [/\bdoes not\b/gi, "không"],
  [/\bdo not\b/gi, "không"],
  [/\bto be\b/gi, "được"],
  [/\bbased on\b/gi, "dựa trên"],
  [/\bbased off\b/gi, "dựa trên"],
  [/\bequal to\b/gi, "bằng"],
  [/\bin addition to\b/gi, "ngoài"],
  [/\bas long as\b/gi, "miễn là"],
  [/\bat most\b/gi, "tối đa"],
  [/\bno more than\b/gi, "tối đa"],
  [/\btake no damage\b/gi, "không nhận damage"],
  [/\bmore easily\b/gi, "dễ hơn"],
  [/\bsignificantly\b/gi, "đáng kể"],
  [/\byour\b/gi, "của bạn"],
  [/\bwhile\b/gi, "khi"],
  [/\bbefore\b/gi, "trước khi"],
  [/\bafter\b/gi, "sau"],
  [/\bwithin\b/gi, "trong phạm vi"],
  [/\binside\b/gi, "bên trong"],
  [/\baround\b/gi, "xung quanh"],
  [/\bthrough\b/gi, "xuyên qua"],
  [/\binto\b/gi, "vào"],
  [/\bby\b/gi, "bởi"],
  [/\bthen\b/gi, "rồi"],
  [/\bonce\b/gi, "một lần"],
  [/\bagain\b/gi, "lại"],
  [/\bshort delay\b/gi, "khoảng trễ ngắn"],
  [/\bdelay\b/gi, "độ trễ"],
  [/\bduration\b/gi, "thời lượng"],
  [/\btargets\b/gi, "mục tiêu"],
  [/\btarget\b/gi, "mục tiêu"],
  [/\bportion\b/gi, "một phần"],
  [/\btracked\b/gi, "ghi nhận"],
  [/\bspawned\b/gi, "được spawn"],
  [/\bdamaged\b/gi, "bị gây damage"],
  [/\bdestroyed\b/gi, "bị phá hủy"],
  [/\bcreated\b/gi, "được tạo"],
  [/\bexpired\b/gi, "hết hạn"],
  [/\bexpires\b/gi, "hết hạn"],
  [/\bnear\b/gi, "gần"],
  [/\bfade\b/gi, "mờ dần"],
  [/\bpicked up\b/gi, "nhặt"],
  [/\bbypassed\b/gi, "bỏ qua"],
  [/\bexpending\b/gi, "tiêu hao"],
  [/\bstanding\b/gi, "đứng"],
  [/\blowering\b/gi, "giảm"],
  [/\bmovement speed\b/gi, "tốc độ di chuyển"],
  [/\bdistance travelled\b/gi, "quãng đường di chuyển"],
  [/\bup to an additional\b/gi, "tối đa thêm"],
  [/\bup to\b/gi, "tối đa"],
  [/\busing\b/gi, "dùng"],
  [/\bused\b/gi, "được dùng"],
  [/\bapplies\b/gi, "áp dụng"],
  [/\bapply\b/gi, "áp dụng"],
  [/\btakes\b/gi, "nhận"],
  [/\btake\b/gi, "nhận"],
  [/\bdealt\b/gi, "đã gây"],
  [/\bDeal\b/g, "Gây"],
  [/\bdeal\b/g, "gây"],
  [/\bdeals\b/gi, "gây"],
  [/\bis\b/gi, "là"],
  [/\bare\b/gi, "đang"],
  [/\bbe\b/gi, "được"],
  [/\bnot\b/gi, "không"],
  [/\bper\b/gi, "mỗi"],
  [/\btimes\b/gi, "lần"],
  [/\bseconds\b/gi, "giây"],
  [/\bsecond\b/gi, "giây"],
  [/\bmetres\b/gi, "mét"],
  [/\bmetre\b/gi, "mét"],
  [/\band\b/gi, "và"],
  [/\bor\b/gi, "hoặc"],
  [/\bbut\b/gi, "nhưng"],
  [/\bif\b/gi, "nếu"],
  [/\bthey\b/gi, "chúng"],
  [/\bthem\b/gi, "chúng"],
  [/\btheir\b/gi, "của chúng"],
  [/\byou\b/gi, "bạn"],
  [/\bwith\b/gi, "với"],
  [/\bfrom\b/gi, "từ"],
  [/\bin\b/gi, "trong"],
  [/\bon\b/gi, "trên"],
  [/\bat\b/gi, "vào"],
  [/\bof\b/gi, "của"],
  [/\bto\b/gi, "để"],
  [/\ba\b/gi, "một"],
  [/\ban\b/gi, "một"],
  [/\bthe\b/gi, "các"],
  [/\bthis\b/gi, "này"],
  [/\bthese\b/gi, "các"],
  [/\bthat\b/gi, "đó"],
  [/\bcan\b/gi, "có thể"],
  [/\bwill\b/gi, "sẽ"],
  [/\bhas\b/gi, "có"],
  [/\bhave\b/gi, "có"],
  [/\bhad\b/gi, "có"],
  [/\bas\b/gi, "như"],
  [/\bwhen\b/gi, "khi"],
  [/\balso\b/gi, "cũng"],
  [/\bmany\b/gi, "nhiều"],
  [/\bsome\b/gi, "một số"],
  [/\bmore\b/gi, "nhiều hơn"],
  [/\bless\b/gi, "ít hơn"],
  [/\bmost\b/gi, "hầu hết"],
  [/\bleast\b/gi, "ít nhất"],
  [/\bother\b/gi, "khác"],
  [/\bothers\b/gi, "khác"],
  [/\beach\b/gi, "mỗi"],
  [/\bevery\b/gi, "mỗi"],
  [/\ball\b/gi, "tất cả"],
  [/\buntil\b/gi, "cho đến khi"],
  [/\bexpire\b/gi, "hết thời hạn"],
  [/\bexpires\b/gi, "hết thời hạn"],
  [/\balong\b/gi, "dọc theo"],
  [/\bground\b/gi, "mặt đất"],
  [/\bAim\b/gi, "Nhắm"],
  [/\bfires\b/gi, "bắn"],
  [/\blingering\b/gi, "còn lại"],
  [/\benergy missiles\b/gi, "tên lửa năng lượng"],
  [/\bmissiles\b/gi, "tên lửa"],
  [/\bexplode\b/gi, "phát nổ"],
  [/\bexplodes\b/gi, "phát nổ"],
  [/\bland\b/gi, "đáp"],
  [/\blands\b/gi, "đáp"],
  [/\bclose\b/gi, "gần"],
  [/\bdestroying\b/gi, "phá hủy"],
  [/\bprocess\b/gi, "quá trình"],
  [/\bunstable\b/gi, "không ổn định"],
  [/\brequire\b/gi, "yêu cầu"],
  [/\brequires\b/gi, "yêu cầu"],
  [/\blengthy\b/gi, "kéo dài"],
  [/\bcharging\b/gi, "tích tụ"],
  [/\bperiod\b/gi, "giai đoạn"],
  [/\bdevastating\b/gi, "tàn khốc"],
  [/\bterrain\b/gi, "địa hình"],
  [/\bAlternatively\b/gi, "Hoặc"],
  [/\bto also\b/gi, "để cũng"]
];

const preserveSkillStatTerms = (value = "") => value
  .replace(/\bcủmột\b/g, "của")
  .replace(/\bđểàn\b/g, "toàn")
  .replace(/\btối đmột\b/g, "tối đa")
  .replace(/\bnhiều hơn (Hit damage|Damage|damage)\b/g, "more $1")
  .replace(/\bnhiều hơn (Elemental Damage|Fire damage|Cold damage|Lightning damage|Chaos damage|Physical damage)\b/g, "more $1");

const naturalSkillFallback = (value = "") => preserveSkillStatTerms(applySkillTextReplacements(
  applySkillTextReplacements(normalizeText(value), TEXT_TRANSLATIONS),
  SKILL_TEXT_REPLACEMENTS
));

const formatSkillStatValue = (value = "", kind = "") => {
  const clean = normalizeText(value);
  if (!clean) return "";

  let formatted = clean
    .replace(/\bLevel\b/g, "Cấp")
    .replace(/\bper Second\b/gi, "mỗi giây")
    .replace(/\bsec\b/gi, "giây")
    .replace(/\bseconds\b/gi, "giây")
    .replace(/\bsecond\b/gi, "giây")
    .replace(/\bmetres\b/gi, "mét")
    .replace(/\bmetre\b/gi, "mét")
    .replace(/\bbase (Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage\b/gi, "$1 Damage cơ bản")
    .replace(/\bbase Damage\b/gi, "Damage cơ bản")
    .replace(/\bbase cast time\b/gi, "Cast Time cơ bản");

  if (kind === "attack-speed") {
    formatted = formatted.replace(/\bof base\b/gi, "tốc độ cơ bản");
  } else if (kind === "attack-damage") {
    formatted = formatted.replace(/\bof base\b/gi, "sát thương cơ bản");
  } else {
    formatted = formatted.replace(/\bof base\b/gi, "cơ bản");
  }

  return normalizeProtectedSkillTerms(formatted.replace(/\bmét mỗi giây\b/gi, "mét/giây"));
};

const formatSkillStatSubject = (value = "") => {
  const subject = naturalSkillFallback(value).replace(/\.$/, "");
  return subject
    .replace(/^Shockwaves$/i, "Shockwave")
    .replace(/^explosions$/i, "explosion")
    .replace(/^blasts$/i, "blast")
    .replace(/^pulses$/i, "pulse")
    .replace(/^Explosion$/i, "Vụ nổ")
    .replace(/^Explosions$/i, "Vụ nổ")
    .replace(/^Consecrated mặt đất$/i, "Consecrated Ground")
    .replace(/^Jagged mặt đất$/i, "Jagged Ground")
    .replace(/^Shocked mặt đất$/i, "Shocked Ground")
    .replace(/^Chilled mặt đất$/i, "Chilled Ground")
    .replace(/^Ignited mặt đất$/i, "Ignited Ground");
};

const formatGloryTrigger = (value = "") => normalizeText(value)
  .replace(/^Hitting with an Attack$/i, "Hit bằng Attack")
  .replace(/^Igniting an enemy$/i, "Ignite kẻ địch")
  .replace(/^Heavy Stunning an enemy$/i, "Heavy Stun kẻ địch");

export const translateSkillDetailLine = (line = "") => {
  const clean = normalizeText(line);
  if (!clean) return "";

  const tagParts = clean.split(",").map((part) => part.trim()).filter(Boolean);
  if (tagParts.length > 1 && tagParts.every((part) => Object.prototype.hasOwnProperty.call(TAG_TRANSLATIONS, part))) {
    return translateTags(tagParts).join(", ");
  }

  const propertyPatterns = [
    [/^Requires:\s*(.+)$/i, ([, value]) => `Yêu cầu: ${formatSkillStatValue(value)}`],
    [/^Tier:\s*(.+)$/i, ([, value]) => `Tier: ${value}`],
    [/^Level:\s*(.+)$/i, ([, value]) => `Cấp: ${formatSkillStatValue(value)}`],
    [/^Cost:\s*(.+)$/i, ([, value]) => `Chi phí: ${formatSkillStatValue(value)}`],
    [/^Reservation:\s*(.+)$/i, ([, value]) => `Reservation: ${formatSkillStatValue(value)}`],
    [/^Cooldown Time:\s*(.+)$/i, ([, value]) => `Cooldown: ${formatSkillStatValue(value)}`],
    [/^Cast Time:\s*(.+)$/i, ([, value]) => `Cast Time: ${formatSkillStatValue(value)}`],
    [/^Use Time:\s*(.+)$/i, ([, value]) => `Use Time: ${formatSkillStatValue(value)}`],
    [/^Attack Speed:\s*(.+)$/i, ([, value]) => `Attack Speed: ${formatSkillStatValue(value, "attack-speed")}`],
    [/^Attack Damage:\s*(.+)$/i, ([, value]) => `Attack Damage: ${formatSkillStatValue(value, "attack-damage")}`],
    [/^Critical Hit Chance:\s*(.+)$/i, ([, value]) => `Critical Hit Chance: ${formatSkillStatValue(value)}`],
    [/^Projectile Speed:\s*(.+)$/i, ([, value]) => `Projectile Speed: ${formatSkillStatValue(value)}`],
    [/^(.+?) second delay between Visage$/i, ([, seconds]) => `${seconds} giây trễ giữa các Visage`],
    [/^(.+?) increased Visage frequency per Spell Visages could cast$/i, ([, amount]) => `${amount} increased tần suất Visage cho mỗi Spell mà Visage có thể cast`],
    [/^(.+?) increased Visage frequency$/i, ([, amount]) => `${amount} increased tần suất Visage`],
    [/^(.+?) chance to inflict Bleeding on Hit$/i, ([, amount]) => `${amount} chance gây Bleeding khi Hit`],
    [/^(.+?) more Corrupted Blood infliction Area of Effect per Blood Boil on slain Enemy$/i, ([, amount]) => `${amount} more Area of Effect khi áp dụng Corrupted Blood cho mỗi Blood Boil trên kẻ địch bị hạ`],
    [/^Inflicts a stack of Corrupted Blood on targets within (.+?) metres per Blood Boil on slain Enemy$/i, ([, metres]) => `Áp dụng một stack Corrupted Blood lên mục tiêu trong phạm vi ${metres} mét cho mỗi Blood Boil trên kẻ địch bị hạ`],
    [/^Deals (.+?) of exploded enemy's Blood Loss as unscalable Physical Attack Damage$/i, ([, amount]) => `Gây Physical Attack Damage không scale bằng ${amount} Blood Loss của kẻ địch đã phát nổ`],
    [/^Magma Spray radius is (.+?) metres$/i, ([, metres]) => `Luồng Magma có bán kính ${metres} mét`],
    [/^Oil spray radius is (.+?) metres$/i, ([, metres]) => `Vệt Oil có bán kính ${metres} mét`],
    [/^Damage and Oil spray radius is (.+?) metres$/i, ([, metres]) => `Damage và vệt Oil có bán kính ${metres} mét`],
    [/^Empowered Attacks Repeat \+(.+?) times, and a further \+(.+?) time per Frenzy Charge consumed$/i, ([, base, extra]) => `Empowered Attacks Repeat +${base} lần, thêm +${extra} lần nữa cho mỗi Frenzy Charge đã Consume`],
    [/^Remnants created by Supported Skills can be collected from (.+?) further away$/i, ([, distance]) => `Remnants được tạo bởi Supported Skills có thể nhặt từ xa hơn ${distance}`],
    [/^Illusions have (.+?) of your maximum Life$/i, ([, amount]) => `Illusions có ${amount} Life tối đa của bạn`],
    [/^Limit (.+?) Spearheads stuck in each Target$/i, ([, count]) => `Giới hạn ${count} Spearheads cắm trong mỗi mục tiêu`],
    [/^Once Ignited, Oil Ground adds (.+?) of this Attack's Fire Damage as unscalable Damage to the Ignite$/i, ([, amount]) => `Sau khi bị Ignited, Oil Ground thêm ${amount} Fire Damage của Attack này thành Damage không scale cho Ignite`],
    [/^Additional Effects From Quality:$/i, () => "Hiệu ứng thêm từ Quality:"],
    [/^\+(.+?) seconds to (.+?) duration$/i, ([, seconds, subject]) => `+${seconds} giây thời lượng ${naturalSkillFallback(subject).replace(/\.$/, "")}`],
    [/^\+(.+?) seconds (.+)$/i, ([, seconds, stat]) => `+${seconds} giây ${naturalSkillFallback(stat).replace(/\.$/, "")}`],
    [/^\+(.+?) metres to wave length for each wave in the Sequence$/i, ([, metres]) => `+${metres} mét chiều dài wave cho mỗi wave trong Sequence`],
    [/^(.+?) grants \+(.+?) metres to (.+?) radius$/i, ([, subject, metres, target]) => `${naturalSkillFallback(subject).replace(/\.$/, "")} cấp +${metres} mét bán kính ${naturalSkillFallback(target).replace(/\.$/, "")}`],
    [/^\+(.+?) metres to (.+?) radius if (.+)$/i, ([, metres, subject, condition]) => `+${metres} mét bán kính ${naturalSkillFallback(subject).replace(/\.$/, "")} nếu ${naturalSkillFallback(condition).replace(/\.$/, "")}`],
    [/^\+(.+?) metres to (.+?) radius$/i, ([, metres, subject]) => `+${metres} mét bán kính ${naturalSkillFallback(subject).replace(/\.$/, "")}`],
    [/^\+(.+?) metres (.+?) radius$/i, ([, metres, subject]) => `+${metres} mét bán kính ${naturalSkillFallback(subject).replace(/\.$/, "")}`],
    [/^\+(.+?) to maximum (.+)$/i, ([, amount, stat]) => `+${amount} ${naturalSkillFallback(stat).replace(/\.$/, "")} tối đa`],
    [/^\+(.+?) to (.+)$/i, ([, amount, stat]) => `+${amount} ${naturalSkillFallback(stat).replace(/\.$/, "")}`],
    [/^(.+?) to (.+?) Added (.+?) Damage per (.+?) (.+?) on (.+)$/i, ([, min, max, type, rate, source, target]) => `${min} đến ${max} Added ${type} Damage mỗi ${rate} ${naturalSkillFallback(source).replace(/\.$/, "")} trên ${naturalSkillFallback(target).replace(/\.$/, "")}`],
    [/^(.+?) to (.+?) Base Off Hand (.+?) Damage$/i, ([, min, max, type]) => `${min} đến ${max} Base Off Hand ${type} Damage`],
    [/^(.+?) to (.+?) Thorns per (.+)$/i, ([, min, max, source]) => `${min} đến ${max} Thorns mỗi ${naturalSkillFallback(source).replace(/\.$/, "")}`],
    [/^Ignites as though dealing (.+?) to (.+?) (.+?) Damage(?:, every (.+?) seconds)?$/i, ([, min, max, type, every]) => `Ignite như thể gây ${min} đến ${max} ${type} Damage${every ? `, mỗi ${every} giây` : ""}`],
    [/^Chills enemies in your Presence as though dealing (.+?) to (.+?) (.+?) Damage$/i, ([, min, max, type]) => `Chill kẻ địch trong Presence của bạn như thể gây ${min} đến ${max} ${type} Damage`],
    [/^(.+?) deals (.+?) to (.+?) (.+?) Damage per (.+?) (.+?) on (.+)$/i, ([, subject, min, max, type, rate, source, target]) => `${naturalSkillFallback(subject).replace(/\.$/, "")} gây ${min} đến ${max} ${type} Damage mỗi ${rate} ${naturalSkillFallback(source).replace(/\.$/, "")} trên ${naturalSkillFallback(target).replace(/\.$/, "")}`],
    [/^(.+?) deal (.+?) to (.+?) additional (.+?) Damage$/i, ([, subject, min, max, type]) => `${naturalSkillFallback(subject).replace(/\.$/, "")} gây ${min} đến ${max} thêm ${type} Damage`],
    [/^(.+?) more Magnitude of (.+?) inflicted$/i, ([, amount, ailment]) => `${amount} more Magnitude của ${naturalSkillFallback(ailment).replace(/\.$/, "")} đã inflict`],
    [/^(.+?) increased Magnitude of (.+?) inflicted$/i, ([, amount, ailment]) => `${amount} increased Magnitude của ${naturalSkillFallback(ailment).replace(/\.$/, "")} đã inflict`],
    [/^Does not Hit, but (Poisons|Pins|Shocks|Chills) enemies as though Hitting them$/i, ([, verb]) => `Không Hit, nhưng ${verb.replace(/s$/i, "")} kẻ địch như thể Hit chúng`],
    [/^(Poisons|Pins|Shocks|Chills) enemies as though Hitting them$/i, ([, verb]) => `${verb.replace(/s$/i, "")} kẻ địch như thể Hit chúng`],
    [/^(Poisons|Pins|Shocks|Chills|Ignites) enemies as though dealing (.+)$/i, ([, verb, value]) => `${verb.replace(/s$/i, "")} kẻ địch như thể gây ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^(.+?) Ignites enemies as though dealing the explosion's damage$/i, ([, subject]) => `${naturalSkillFallback(subject).replace(/\.$/, "")} Ignite kẻ địch như thể gây Damage của vụ nổ`],
    [/^Poison inflicted by this Skill is affected by Modifiers to Skill Effect Duration$/i, () => "Poison do Skill này inflict chịu ảnh hưởng bởi Modifiers lên Skill Effect Duration"],
    [/^Minions Ignite Enemies within a radius of (.+?) metres as though dealt Base Fire Damage equal to (.+?) of Minion's Maximum Life$/i, ([, metres, amount]) => `Minions Ignite kẻ địch trong bán kính ${metres} mét như thể gây Base Fire Damage bằng ${amount} Life tối đa của Minion`],
    [/^\((.+?)\)% chance to gain Flask and Charm charges as though killing the enemy on Corpse consumption$/i, ([, amount]) => `(${amount})% chance nhận Flask và Charm Charges như thể đã giết kẻ địch khi Consume Corpse`],
    [/^Overgrown Pustules grow as though dealt (.+?) Poison damage per second$/i, ([, damage]) => `Overgrown Pustules lớn lên như thể đã gây ${damage} Poison Damage mỗi giây`],
    [/^Pustules store expected damage of Poisons inflicted on them$/i, () => "Pustules lưu Damage dự kiến của Poisons đã inflict lên chúng"],
    [/^(.+?) grants \+(.+?) to maximum (.+)$/i, ([, subject, amount, stat]) => `${naturalSkillFallback(subject).replace(/\.$/, "")} cấp +${amount} ${naturalSkillFallback(stat).replace(/\.$/, "")} tối đa`],
    [/^(.+?) grants (.+?) to (.+)$/i, ([, subject, amount, stat]) => `${naturalSkillFallback(subject).replace(/\.$/, "")} cấp ${amount} ${naturalSkillFallback(stat).replace(/\.$/, "")}`],
    [/^While Dual Wielding, fires twice as many Projectiles with (.+?) less attack speed$/i, ([, amount]) => `Khi Dual Wielding, bắn gấp đôi số Projectiles với ${amount} less Attack Speed`],
    [/^Increases and reductions to Thorns Damage apply to Hit Damage with this skill$/i, () => "Tăng/giảm lên Thorns Damage cũng áp dụng cho Hit Damage với Skill này"],
    [/^(.+?) less damage if destroyed within (.+?) seconds by something other than you$/i, ([, amount, seconds]) => `${amount} less Damage nếu bị phá hủy trong ${seconds} giây bởi thứ không phải bạn`],
    [/^Corrupted Blood deals (.+?) of slain Enemy's maximum Life as Physical damage per second$/i, ([, amount]) => `Corrupted Blood gây Physical Damage mỗi giây bằng ${amount} Life tối đa của kẻ địch bị hạ`],
    [/^Blood Boil applies to non-Unique enemies in your Presence every (.+?) seconds$/i, ([, seconds]) => `Blood Boil áp dụng lên Non-Unique enemy trong Presence của bạn mỗi ${seconds} giây`],
    [/^(.+?) more Corrupted Blood infliction Area of Effect per Blood Boil on slain Enemy$/i, ([, amount]) => `${amount} more Corrupted Blood infliction Area of Effect mỗi Blood Boil trên kẻ địch bị hạ`],
    [/^Stored Poison adds up to (.+?) metres to base explosion radius$/i, ([, metres]) => `Stored Poison thêm tối đa ${metres} mét vào bán kính nổ cơ bản`],
    [/^Stored Poison grants up to (.+?) more explosion Damage$/i, ([, amount]) => `Stored Poison cấp tối đa ${amount} more explosion Damage`],
    [/^Gains up to (.+?) more damage and (.+?) more area of effect based on the percentage of target's Heavy Stun buildup caused by Blood Loss$/i, ([, damage, area]) => `Nhận tối đa ${damage} more Damage và ${area} more Area of Effect dựa trên phần trăm Heavy Stun buildup của mục tiêu do Blood Loss gây ra`],
    [/^Consumes all Endurance Charges to increase Warcry duration by (.+?) per charge$/i, ([, amount]) => `Consume tất cả Endurance Charges để tăng Warcry Duration thêm ${amount} mỗi Charge`],
    [/^Large meteors can target a single enemy only once every (.+?) seconds$/i, ([, seconds]) => `Large meteors chỉ có thể nhắm một kẻ địch một lần mỗi ${seconds} giây`],
    [/^Converts (.+?) of (.+?) damage to (.+?) damage$/i, ([, amount, from, to]) => `Chuyển ${amount} ${from} damage thành ${to} damage`],
    [/^Deals Damage every (.+?) seconds$/i, ([, seconds]) => `Gây Damage mỗi ${seconds} giây`],
    [/^(.+?) more Damage for each previous Ember fired in sequence$/i, ([, amount]) => `${amount} more Damage cho mỗi Ember đã bắn trước đó trong chuỗi`],
    [/^(.+?) more damage for each previous time this Skill has been used consecutively$/i, ([, amount]) => `${amount} more Damage cho mỗi lần Skill này đã được dùng liên tiếp trước đó`],
    [/^Enemies Hit receive (.+?) buildup from (.+?) damage for (.+?) second duration$/i, ([, ailment, type, seconds]) => `Kẻ địch bị Hit nhận ${ailment} buildup từ ${type} Damage trong ${seconds} giây`],
    [/^Freeze enemies that are Primed for Freeze$/i, () => "Freeze kẻ địch đang Primed for Freeze"],
    [/^Cannot apply (.+?) to enemies of level higher than (.+)$/i, ([, effect, level]) => `Không thể áp dụng ${effect} lên kẻ địch có cấp cao hơn ${level}`],
    [/^Cannot (.+?) enemies above level (.+)$/i, ([, effect, level]) => `Không thể ${effect} kẻ địch trên cấp ${level}`],
    [/^Cannot fire or reload for (.+?) seconds on reaching maximum Heat$/i, ([, seconds]) => `Không thể bắn hoặc reload trong ${seconds} giây khi đạt Heat tối đa`],
    [/^Curse does not apply to enemies above level (.+)$/i, ([, level]) => `Curse không áp dụng lên kẻ địch trên cấp ${level}`],
    [/^Marked enemy becomes (.+?) when Hit while Primed for (.+)$/i, ([, state, prime]) => `Kẻ địch bị Mark trở thành ${state} khi bị Hit trong lúc Primed for ${prime}`],
    [/^Pierces the first (.+?) targets Hit$/i, ([, count]) => `Pierce ${count} mục tiêu đầu tiên bị Hit`],
    [/^Projectiles from Supported Skills are fired in random directions$/i, () => "Projectiles từ Supported Skills được bắn theo hướng ngẫu nhiên"],
    [/^Triggers Navira's Calming when Commanded to use a Skill, granting nearby Allies (.+?) increased Mana Regeneration for (.+?) seconds$/i, ([, amount, seconds]) => `Trigger Navira's Calming khi được Command dùng Skill, cấp cho Allies gần đó ${amount} increased Mana Regeneration trong ${seconds} giây`],
    [/^Projectile Chains (.+?) additional times on first hitting a Shocked or Electrocuted enemy, releasing a Shockwave on each Hit$/i, ([, count]) => `Projectile Chain thêm ${count} lần khi Hit đầu tiên vào kẻ địch Shocked hoặc Electrocuted, release Shockwave trên mỗi Hit`],
    [/^Absorbs first Hit dealing over (.+?) of Minion's maximum life$/i, ([, amount]) => `Absorb Hit đầu tiên gây hơn ${amount} Maximum Life của Minion`],
    [/^Destabilises Enemies for (.+?) seconds$/i, ([, seconds]) => `Destabilise kẻ địch trong ${seconds} giây`],
    [/^Deals additional (.+?) damage equal to (.+?) of Minion's maximum Life$/i, ([, type, amount]) => `Gây thêm ${type} Damage bằng ${amount} Maximum Life của Minion`],
    [/^Generates 100% of Monster Power as Glory for this Skill on (.+)$/i, ([, trigger]) => `Tạo 100% Monster Power thành Glory cho Skill này khi ${formatGloryTrigger(trigger)}`],
    [/^Rage cost is ignored for first (.+?) seconds of Channelling$/i, ([, seconds]) => `Bỏ qua Rage cost trong ${seconds} giây đầu của Channelling`],
    [/^Rage cost is ignored for first second of Channelling$/i, () => "Bỏ qua Rage cost trong giây đầu của Channelling"],
    [/^Effects of Mana Tempest linger for (.+?) seconds after leaving the Tempest$/i, ([, seconds]) => `Hiệu ứng của Mana Tempest kéo dài thêm ${seconds} giây sau khi rời Tempest`],
    [/^Effects of Mana Tempest linger for (.+?) second after leaving the Tempest$/i, ([, seconds]) => `Hiệu ứng của Mana Tempest kéo dài thêm ${seconds} giây sau khi rời Tempest`],
    [/^(.+?) lingers for (.+?) second duration$/i, ([, subject, seconds]) => `${formatSkillStatSubject(subject)} kéo dài ${seconds} giây`],
    [/^(.+?) persist for (.+?) second duration$/i, ([, subject, seconds]) => `${formatSkillStatSubject(subject)} tồn tại ${seconds} giây`],
    [/^(.+?) grow for (.+?) second duration$/i, ([, subject, seconds]) => `${formatSkillStatSubject(subject)} mọc trong ${seconds} giây`],
    [/^(.+?) remain attached for up to (.+?) seconds?$/i, ([, subject, seconds]) => `${formatSkillStatSubject(subject)} bám trong tối đa ${seconds} giây`],
    [/^(.+?) last for (.+?) seconds$/i, ([, subject, seconds]) => `${formatSkillStatSubject(subject)} tồn tại ${seconds} giây`],
    [/^(.+?) have (.+?) maximum Life$/i, ([, subject, amount]) => `${formatSkillStatSubject(subject)} có ${amount} Life tối đa`],
    [/^(.+?) are immune to Damage for (.+?) seconds after being Revived$/i, ([, subject, seconds]) => `${formatSkillStatSubject(subject)} miễn nhiễm Damage trong ${seconds} giây sau khi được Revive`],
    [/^(.+?) take (.+?) less Damage for (.+?) second after Shield is lost$/i, ([, subject, amount, seconds]) => `${formatSkillStatSubject(subject)} nhận ${amount} less Damage trong ${seconds} giây sau khi mất Shield`],
    [/^\((.+?)\)% chance for an additional (.+)$/i, ([, amount, subject]) => `(${amount})% cơ hội tạo thêm ${naturalSkillFallback(subject).replace(/\.$/, "")}`],
    [/^\((.+?)\)% increased Area of Effect for Skills used by Totems$/i, ([, amount]) => `(${amount})% tăng Area of Effect cho Skills được Totems dùng`],
    [/^\+(.+?) metres to wave length for each wave in the Sequence$/i, ([, metres]) => `+${metres} mét vào chiều dài wave cho mỗi wave trong Sequence`],
    [/^Deals more damage to enemies based on distance from you, up to (.+?) to enemies on the far edge of the ring$/i, ([, amount]) => `Gây thêm damage lên kẻ địch dựa trên khoảng cách tới bạn, tối đa ${amount} với kẻ địch ở rìa xa của vòng`],
    [/^Deals up to an additional (.+?) more Damage, based on the distance travelled$/i, ([, amount]) => `Gây tối đa thêm ${amount} more Damage dựa trên quãng đường di chuyển`],
    [/^Deals up to (.+?) more Damage, based on the distance travelled$/i, ([, amount]) => `Gây tối đa ${amount} more Damage dựa trên quãng đường di chuyển`],
    [/^Debuff deals (.+?) more Damage for each time it has spread, up to (.+)$/i, ([, amount, cap]) => `Debuff gây ${amount} more Damage cho mỗi lần đã lan, tối đa ${cap}`],
    [/^Deals damage along the fissure's path and in a (.+?) metre radius around the emerging spike$/i, ([, metres]) => `Gây damage dọc theo đường đi của Fissure và trong bán kính ${metres} mét quanh gai trồi lên`],
    [/^Deals (.+?) to (.+?) (.+)$/i, ([, min, max, stat]) => `Gây ${min} đến ${max} ${formatSkillStatValue(stat)}`],
    [/^Deals (.+)$/i, ([, value]) => `Gây ${formatSkillStatValue(value)}`],
    [/^(.+?) to (.+?) base (Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage$/i, ([, min, max, type]) => `${min} đến ${max} ${type} Damage cơ bản`],
    [/^Consumes (\d+) Charges from your Mana Flask$/i, ([, count]) => `Consume ${count} Charges từ Mana Flask của bạn`],
    [/^Fires (.+?) Projectiles in a circle$/i, ([, count]) => `Bắn ${count} Projectiles theo vòng tròn`],
    [/^Supported Skills fire Projectiles in a circle$/i, () => "Skill được Support bắn Projectiles theo vòng tròn"],
    [/^Projectiles fired at the same time can Hit the same target no more than once every (.+?) seconds$/i, ([, seconds]) => `Các Projectile bắn cùng lúc chỉ có thể Hit cùng một mục tiêu tối đa một lần mỗi ${seconds} giây`],
    [/^Has (.+?) maximum Energy per (.+?) seconds of base cast time of Socketed Spells$/i, ([, energy, seconds]) => `Có ${energy} Energy tối đa cho mỗi ${seconds} giây Cast Time cơ bản của Socketed Spells`],
    [/^Minions from this skill have (.+?) increased Attack Speed per (.+?) of your Dexterity$/i, ([, value, dexterity]) => `Minions từ Skill này có ${value} increased Attack Speed cho mỗi ${dexterity} Dexterity của bạn`],
    [/^Minions from this skill have (.+?) increased Damage per (.+?) of your Strength$/i, ([, value, strength]) => `Minions từ Skill này có ${value} increased Damage cho mỗi ${strength} Strength của bạn`],
    [/^Minions have (.+?) more Maximum Life$/i, ([, amount]) => `Minions có ${amount} more Maximum Life`],
    [/^Duration of (.+?) is (.+)$/i, ([, subject, value]) => `${formatSkillStatSubject(subject)} có thời lượng ${formatSkillStatValue(value)}`],
    [/^(.+?) impact radius is (.+?) metres?$/i, ([, subject, metres]) => `Bán kính va chạm của ${naturalSkillFallback(subject)} là ${metres} mét`],
    [/^Impact radius is (.+?) metres?$/i, ([, metres]) => `Bán kính va chạm là ${metres} mét`],
    [/^Fire-Infused explosion radius is (.+?) metres$/i, ([, metres]) => `Vụ nổ Fire-Infused có bán kính ${metres} mét`],
    [/^Fire-Infused explosion deals (.+?) to (.+?) Fire damage$/i, ([, min, max]) => `Vụ nổ Fire-Infused gây ${min} đến ${max} Fire damage`],
    [/^Triggers one of three disasters every (.+?) seconds$/i, ([, seconds]) => `Trigger một trong ba thiên tai mỗi ${seconds} giây`],
    [/^Chains (.+?) additional times when Lightning Infused$/i, ([, count]) => `Chain thêm ${count} lần khi Lightning Infused`],
    [/^(.+?) more damage when Lightning Infused$/i, ([, amount]) => `${amount} more damage khi Lightning Infused`],
    [/^Casting the matching Spell before the next Visage Empowers it Empowered Spells deal (.+?) more damage$/i, ([, amount]) => `Cast đúng Spell tương ứng trước Visage tiếp theo sẽ Empower Spell đó. Empowered Spells gây ${amount} more damage`],
    [/^Meteor lands after (.+?) seconds$/i, ([, seconds]) => `Meteor rơi xuống sau ${seconds} giây`],
    [/^Pulses (.+?) times before final strike$/i, ([, count]) => `Phát xung ${count} lần trước cú đánh cuối`],
    [/^Final strike occurs after (.+?) seconds$/i, ([, seconds]) => `Cú đánh cuối xảy ra sau ${seconds} giây`],
    [/^Inflicts a stack of Corrupted Blood on targets within (.+?) metres per Blood Boil on slain Enemy$/i, ([, metres]) => `Inflict một stack Corrupted Blood lên mục tiêu trong phạm vi ${metres} mét cho mỗi Blood Boil trên kẻ địch bị hạ`],
    [/^While Dual Wielding, both weapons hit with (.+?) less damage$/i, ([, amount]) => `Khi Dual Wielding, cả hai vũ khí Hit với ${amount} less damage`],
    [/^Applies socketed Marks to Enemies within (.+?) metres$/i, ([, metres]) => `Áp dụng Marks được socket lên kẻ địch trong phạm vi ${metres} mét`],
    [/^Supported Skills will Mark another Enemy within (.+?) Metres of Marked Enemy when Consumed$/i, ([, metres]) => `Supported Skills sẽ Mark thêm một kẻ địch trong phạm vi ${metres} mét quanh kẻ địch bị Mark khi bị Consume`],
    [/^Curse applies after (.+?) seconds delay$/i, ([, seconds]) => `Curse áp dụng sau ${seconds} giây trễ`],
    [/^Uses your life if no Minion in range$/i, () => "Dùng Life của bạn nếu không có Minion trong tầm"],
    [/^(.+?) more damage with Hits if using your life$/i, ([, amount]) => `${amount} more damage với Hits nếu dùng Life của bạn`],
    [/^\((.+?)\)% increased Cast Speed while in Demon Form$/i, ([, amount]) => `(${amount})% increased Cast Speed khi ở Demon Form`],
    [/^Deal (.+?) more Spell damage per Demonflame$/i, ([, amount]) => `Gây ${amount} more Spell damage cho mỗi Demonflame`],
    [/^Enemies inside the storm are Hindered$/i, () => "Kẻ địch bên trong storm bị Hindered"],
    [/^Gain Guard equal to (.+?) of your maximum life per Jade consumed$/i, ([, amount]) => `Nhận Guard bằng ${amount} Maximum Life của bạn cho mỗi Jade đã Consume`],
    [/^Fissure length is (.+?) metres$/i, ([, metres]) => `Chiều dài Fissure là ${metres} mét`],
    [/^Attaches Vines to enemies within (.+?) metres$/i, ([, metres]) => `Gắn Vines vào kẻ địch trong phạm vi ${metres} mét`],
    [/^Vines can stretch to a (.+?) metre length before breaking$/i, ([, metres]) => `Vines có thể kéo dài ${metres} mét trước khi đứt`],
    [/^Each attached Vine Slows enemy by (.+?)$/i, ([, amount]) => `Mỗi Vine đang bám Slow kẻ địch ${amount}`],
    [/^First (\d+) minions summoned have no base spirit reservation$/i, ([, count]) => `${count} Minion đầu tiên được summon không tốn Spirit Reservation cơ bản`],
    [/^Lose Combo if you generate no Combo for (.+?) seconds$/i, ([, seconds]) => `Mất Combo nếu bạn không tạo Combo trong ${seconds} giây`],
    [/^(.+?) more Damage to enemies within (.+?) metres of you, scaling down to no bonus at (.+?) metres or further$/i, ([, amount, near, far]) => `${amount} more Damage lên kẻ địch trong phạm vi ${near} mét quanh bạn, giảm dần về không còn bonus ở ${far} mét trở lên`],
    [/^Buff duration is up to (.+?) seconds, or until your next Attack$/i, ([, seconds]) => `Buff có thời lượng tối đa ${seconds} giây, hoặc cho đến Attack tiếp theo của bạn`],
    [/^Buff duration is (.+?) seconds or until your Empowered bolts are expended$/i, ([, seconds]) => `Buff có thời lượng ${seconds} giây hoặc cho đến khi Empowered bolts của bạn được tiêu hao`],
    [/^Projectile count cannot be modified$/i, () => "Số Projectile không thể bị thay đổi"],
    [/^Detonation Time is (.+?) seconds$/i, ([, seconds]) => `Detonation Time là ${seconds} giây`],
    [/^Explosion width is (.+?) metres$/i, ([, metres]) => `Chiều rộng vụ nổ là ${metres} mét`],
    [/^Explosion length is (.+?) metres$/i, ([, metres]) => `Chiều dài vụ nổ là ${metres} mét`],
    [/^Cone length is (.+?) metres$/i, ([, metres]) => `Chiều dài hình nón là ${metres} mét`],
    [/^Hailstorm creates (\d+) chunks of ice$/i, ([, count]) => `Hailstorm tạo ${count} mảnh băng`],
    [/^\((.+?)\)% increased frequency of Triggers$/i, ([, amount]) => `(${amount})% tăng tần suất Trigger`],
    [/^Enemies lose Life equal to (.+?) of the expected remaining Damage of the Consumed Poison$/i, ([, amount]) => `Kẻ địch mất Life bằng ${amount} lượng Damage còn lại dự kiến của Poison đã Consume`],
    [/^(.+?) more Area of Effect per Poison affecting the Enemy$/i, ([, amount]) => `${amount} more Area of Effect cho mỗi Poison đang ảnh hưởng lên kẻ địch`],
    [/^Consumes (\d+) Heat if possible to (Gain|gain) (.+)$/i, ([, heat, , value]) => `Nếu có thể, Consume ${heat} Heat để nhận ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^Spends (\d+) Rage to perform enraged slam if possible$/i, ([, rage]) => `Nếu có thể, tiêu ${rage} Rage để thực hiện enraged Slam`],
    [/^Projectiles which pass through the (Infused )?wall deal (.+?) to (.+?) Added (Fire|Lightning) Damage$/i, ([, infused, min, max, type]) => `Projectiles đi xuyên qua ${infused ? "tường Infused" : "tường"} gây thêm ${min} đến ${max} Added ${type} Damage`],
    [/^Projectiles which shatter Mirrors are copied (.+?) times$/i, ([, count]) => `Projectiles làm vỡ Mirrors được sao chép ${count} lần`],
    [/^Bolts shatter on impact, dealing Damage in a (.+?) metre cone$/i, ([, metres]) => `Bolts vỡ khi va chạm, gây Damage theo hình nón ${metres} mét`],
    [/^\((.+?)\)% chance to cause an additional Burst on impact$/i, ([, amount]) => `(${amount})% cơ hội gây thêm một Burst khi va chạm`],
    [/^(Projectiles|Twisters) fired at the same time can Hit the same target no more than once every (.+?) seconds$/i, ([, subject, seconds]) => `${subject} bắn cùng lúc chỉ có thể Hit cùng một mục tiêu tối đa một lần mỗi ${seconds} giây`],
    [/^\+(.+?) metres to impact radius$/i, ([, metres]) => `+${metres} mét vào bán kính va chạm`],
    [/^One impact every (.+?) seconds$/i, ([, seconds]) => `Một va chạm mỗi ${seconds} giây`],
    [/^Impact and Jagged Ground radius are (.+?) metres$/i, ([, metres]) => `Bán kính va chạm và Jagged Ground là ${metres} mét`],
    [/^Caltrops land within a (.+?) metre radius of Projectile impact$/i, ([, metres]) => `Caltrops rơi trong bán kính ${metres} mét quanh điểm va chạm của Projectile`],
    [/^Spear cannot Pierce, Fork, Chain or Return Modifiers to the number of Projectiles fired only affect the maximum number of lightning bolt Projectiles$/i, () => "Spear không thể Pierce, Fork, Chain hoặc Return. Modifiers về số Projectiles bắn ra chỉ ảnh hưởng đến số Projectile lightning bolt tối đa"],
    [/^Hits 4 times per salvo Modifiers to number of Projectiles fired instead apply to number of Hits per salvo$/i, () => "Hit 4 lần mỗi salvo. Modifiers về số Projectiles bắn ra thay vào đó áp dụng cho số Hit mỗi salvo"],
    [/^Tornado spits out 3 copies of Projectiles fired into it$/i, () => "Tornado phóng ra 3 bản sao của Projectiles được bắn vào nó"],
    [/^Buff grants (.+)$/i, ([, value]) => `Buff cấp ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^Consumes Freeze on (Non-Unique|Unique) enemies to deal (.+)$/i, ([, rarity, value]) => `Consume Freeze trên ${rarity} enemy để gây ${value}`],
    [
      /^Normal and Magic monsters grant (\d+) (Power|Frenzy) Charges? Rare monsters grant (\d+) \2 Charges? Unique monsters grant (\d+) \2 Charges?$/i,
      ([, normalMagic, chargeType, rare, unique]) => `Normal và Magic monster cấp ${normalMagic} ${chargeType} Charge. Rare monster cấp ${rare} ${chargeType} Charges. Unique monster cấp ${unique} ${chargeType} Charges`
    ],
    [
      /^You have Culling Strike against Rare and Unique enemies that have been in your Presence for a total of at least (.+?) seconds$/i,
      ([, seconds]) => `Bạn có Culling Strike lên Rare và Unique enemy đã ở trong Presence của bạn tổng cộng ít nhất ${seconds} giây`
    ],
    [
      /^You deal (.+?) more Hit damage to Rare and Unique enemies for every (.+?) seconds they have ever been in your Presence, up to (.+)$/i,
      ([, damage, seconds, cap]) => `Bạn gây ${damage} more Hit damage lên Rare và Unique enemy cho mỗi ${seconds} giây chúng từng ở trong Presence của bạn, tối đa ${cap}`
    ],
    [/^Grants (.+)$/i, ([, value]) => `Cấp ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^Gain (.+)$/i, ([, value]) => `Nhận ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^Gains (.+)$/i, ([, value]) => `Nhận ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^(.+?) gains (.+)$/i, ([, subject, value]) => `${naturalSkillFallback(subject)} nhận ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^(.+?) Gain (.+)$/i, ([, subject, value]) => `${naturalSkillFallback(subject)} nhận ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^(.+?) deal (.+)$/i, ([, subject, value]) => `${naturalSkillFallback(subject)} gây ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^(.+?) deals (.+)$/i, ([, subject, value]) => `${naturalSkillFallback(subject)} gây ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^(.+?) cost (.+)$/i, ([, subject, value]) => `${naturalSkillFallback(subject)} tốn ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^(.+?) becomes (.+)$/i, ([, subject, value]) => `${naturalSkillFallback(subject)} trở thành ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^(.+?) cause (.+)$/i, ([, subject, value]) => `${naturalSkillFallback(subject)} gây ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^(.+?) causes (.+)$/i, ([, subject, value]) => `${naturalSkillFallback(subject)} gây ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^(.+?) loaded per clip$/i, ([, value]) => `${naturalSkillFallback(value)} được nạp mỗi clip`],
    [/^\((.+?)\)% increased (.+)$/i, ([, amount, stat]) => `(${amount})% tăng ${naturalSkillFallback(stat).replace(/\.$/, "")}`],
    [/^On dealing (.+?) with a Hit, gain (.+)$/i, ([, damage, value]) => `Khi gây ${naturalSkillFallback(damage)} bằng Hit, nhận ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^Triggers all Socketed Spells and loses all Energy on reaching maximum Energy$/i, () => "Trigger tất cả Socketed Spells và mất toàn bộ Energy khi đạt Energy tối đa"],
    [/^Limit (.+)$/i, ([, value]) => `Giới hạn ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^Modifiers to (.+?) apply to (.+)$/i, ([, source, target]) => `Modifier lên ${naturalSkillFallback(source)} áp dụng cho ${naturalSkillFallback(target)}`],
    [/^Debuff deals (.+?) more Damage for each time it has spread, up to (.+)$/i, ([, amount, cap]) => `Debuff gây ${amount} more Damage cho mỗi lần đã lan, tối đa ${cap}`],
    [/^(.+?) more Damage with Hits for (Shockwaves|explosions|blasts|pulses) originating from a Unique enemy$/i, ([, amount, source]) => `${amount} more Damage với Hits cho ${formatSkillStatSubject(source)} phát ra từ Unique enemy`],
    [/^(.+?) more Damage per previous Ember fired in sequence$/i, ([, amount]) => `${amount} more Damage cho mỗi Ember đã bắn trước đó trong chuỗi`],
    [/^Can accumulate up to (.+?) Embers Modifiers to number of Projectiles instead apply to number of Embers accumulated$/i, ([, amount]) => `Có thể tích lũy tối đa ${amount} Ember. Modifier về số Projectiles thay vào đó áp dụng cho số Ember đã tích lũy`],
    [/^(.+?) duration is (.+)$/i, ([, subject, value]) => `${formatSkillStatSubject(subject)} có thời lượng ${formatSkillStatValue(value)}`],
    [/^(.+?) radius is (.+)$/i, ([, subject, value]) => `${formatSkillStatSubject(subject)} có bán kính ${formatSkillStatValue(value)}`],
    [/^(.+?) Duration is (.+)$/i, ([, subject, value]) => `${formatSkillStatSubject(subject)} có thời lượng ${formatSkillStatValue(value)}`],
    [/^(.+?) Radius is (.+)$/i, ([, subject, value]) => `${formatSkillStatSubject(subject)} có bán kính ${formatSkillStatValue(value)}`],
    [/^Fires (.+)$/i, ([, value]) => `Bắn ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^Can Hit (.+)$/i, ([, value]) => `Có thể Hit ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^Cannot (.+)$/i, ([, value]) => `Không thể ${naturalSkillFallback(value).replace(/\.$/, "")}`],
    [/^Must be active in both Weapon Sets$/i, () => "Phải active ở cả hai Weapon Set"]
  ];

  for (const [pattern, formatter] of propertyPatterns) {
    const match = clean.match(pattern);
    if (match) return normalizeProtectedSkillTerms(formatter(match));
  }

  return normalizeProtectedSkillTerms(naturalSkillFallback(clean));
};

const translateSkillSentence = (sentence = "") => {
  const clean = normalizeText(sentence);
  if (!clean) return "";
  if (EXACT_SKILL_TEXT_TRANSLATIONS.has(clean)) return normalizeProtectedSkillTerms(EXACT_SKILL_TEXT_TRANSLATIONS.get(clean));

  const sentencePatterns = [
    [
      /^Conjures a rootbound fissure that crawls forward, damaging enemies in its path\.$/i,
      () => "Tạo một khe nứt bám rễ bò về phía trước, gây damage lên kẻ địch trên đường đi."
    ],
    [
      /^While the fissure persists, vines lash out from it and attach to nearby enemies, damaging and Slowing them\.$/i,
      () => "Khi khe nứt còn tồn tại, dây leo quất ra từ đó và bám vào kẻ địch gần đó, gây damage và Slow chúng."
    ],
    [
      /^Conjures a number of icy Projectiles that launch towards the target\.$/i,
      () => "Tạo nhiều Projectile băng phóng về phía mục tiêu."
    ],
    [
      /^Projectiles that Hit a Chilled or Frozen target create chunks of ice that deal additional damage on impacting the ground\.$/i,
      () => "Projectile Hit mục tiêu Chilled hoặc Frozen sẽ tạo mảnh băng gây thêm damage khi va xuống đất."
    ],
    [
      /^Consumes a Cold Infusion if possible to cause each Projectile to lodge into the enemy then explode\.$/i,
      () => "Nếu có thể, Consume Cold Infusion để mỗi Projectile cắm vào kẻ địch rồi phát nổ."
    ],
    [
      /^Consume charges from your Mana Flask to throw a flask that explodes, dealing (.+?) Attack damage in an area(?: and (.+))?\.$/i,
      ([, damageType, extra]) => {
        const suffix = extra
          ? ` và ${normalizeSkillTarget(extra)
            .replace(/^Aggravating Bleeding on kẻ địch hit$/i, "Aggravate Bleeding lên kẻ địch bị Hit")
            .replace(/^inflicting Exposure$/i, "inflict Exposure")}.`
          : ".";
        return `Tiêu hao charge từ Mana Flask để ném một flask phát nổ, gây ${normalizeText(damageType)} Attack damage trong một vùng${suffix}`;
      }
    ],
    [
      /^The thrown flask Consumes Poison on Hit to cause an acidic burst\.$/i,
      () => "Flask được ném sẽ tiêu thụ Poison on Hit để tạo một vụ nổ acid."
    ],
    [
      /^Additional smaller flasks are thrown at nearby Ignited Enemies\.$/i,
      () => "Các flask nhỏ hơn được ném thêm vào kẻ địch Ignited gần đó."
    ],
    [
      /^Strike with your (.+)\.$/i,
      ([, weapon]) => `Đánh bằng ${normalizeSkillTarget(weapon)} của bạn.`
    ],
    [
      /^Fire an arrow with your Bow\.$/i,
      () => "Bắn một arrow bằng Bow của bạn."
    ],
    [
      /^Fire a bolt from your crossbow\.$/i,
      () => "Bắn một bolt từ Crossbow của bạn."
    ],
    [
      /^Fire a burst of Chaos energy at the target\.$/i,
      () => "Bắn một luồng Chaos energy vào mục tiêu."
    ],
    [
      /^Launch a fiery Projectile towards a target\.$/i,
      () => "Phóng một fiery Projectile về phía mục tiêu."
    ],
    [
      /^The Projectile explodes on impact, damaging foes in a small area\.$/i,
      () => "Projectile phát nổ khi va chạm, gây damage lên kẻ địch trong vùng nhỏ."
    ],
    [
      /^Curse all targets in an area after a short delay, lowering their (.+?) Resistance\.$/i,
      ([, type]) => `Curse tất cả mục tiêu trong vùng sau một khoảng trễ ngắn, giảm ${normalizeText(type)} Resistance của chúng.`
    ],
    [
      /^Create an area of Consecrated Ground around you\.$/i,
      () => "Tạo một vùng Consecrated Ground quanh bạn."
    ],
    [
      /^Summon a Reviving Beast Companion to aid you in combat\.$/i,
      () => "Summon một Reviving Beast Companion hỗ trợ bạn trong combat."
    ],
    [
      /^Activate to summon (.+)\.$/i,
      ([, summon]) => `Activate để summon ${normalizeSkillTarget(summon)}.`
    ],
    [
      /^While active, gains Energy when you (.+?) and triggers socketed (.+?) on reaching maximum Energy\.$/i,
      ([, condition, socketed]) => `Khi đang active, nhận Energy khi bạn ${normalizeSkillTarget(condition)} và trigger ${normalizeSkillTarget(socketed)} được socket khi đạt Energy tối đa.`
    ],
    [
      /^Emit an Aura that boosts the (.+?) Resistance of you and Allies in your Presence\.$/i,
      ([, type]) => `Phát ra Aura tăng ${normalizeText(type)} Resistance cho bạn và Allies trong Presence của bạn.`
    ],
    [
      /^Emit an Aura that grants you and Allies in your Presence additional Total Energy Shield\.$/i,
      () => "Phát ra Aura cấp thêm Total Energy Shield cho bạn và Allies trong Presence của bạn."
    ],
    [
      /^While active, replaces your dodge roll with a short-cooldown Spell that allows you to tunnel through space, instantly reappearing a medium distance away\.$/i,
      () => "Khi đang active, thay dodge roll của bạn bằng một Spell cooldown ngắn cho phép xuyên qua không gian và lập tức xuất hiện lại ở khoảng cách trung bình."
    ],
    [
      /^Enemies in your Presence accumulate blood boils periodically\.$/i,
      () => "Kẻ địch trong Presence của bạn định kỳ tích tụ blood boil."
    ],
    [
      /^When they die, the boils pop applying Corrupted Blood to enemies near them\.$/i,
      () => "Khi chúng chết, blood boil nổ ra và áp dụng Corrupted Blood lên kẻ địch gần đó."
    ],
    [
      /^Conjure a circle of ritual inscriptions that last for a short duration\.$/i,
      () => "Tạo một vòng nghi thức tồn tại trong thời gian ngắn."
    ],
    [
      /^When the duration ends, spikes of bone erupt from enemies in the area, damaging them and potentially causing Bleeding\.$/i,
      () => "Khi hết thời lượng, gai xương trồi lên từ kẻ địch trong vùng, gây damage và có thể gây Bleeding."
    ],
    [
      /^Afflict a single enemy with a Debuff that deals Chaos damage over time\.$/i,
      () => "Gắn Debuff lên một kẻ địch, gây Chaos damage over time."
    ],
    [
      /^If the enemy dies while affected by Contagion, it and all other Chaos damage over time Debuffs spread to nearby enemies and refresh their durations\.$/i,
      () => "Nếu kẻ địch chết khi đang bị Contagion, hiệu ứng này và các Debuff Chaos damage over time khác sẽ lan sang kẻ địch gần đó và làm mới thời lượng."
    ],
    [
      /^Sacrifice the life of a Minion to deal Chaos damage in an area around it\.$/i,
      () => "Hy sinh Life của một Minion để gây Chaos damage trong vùng quanh nó."
    ],
    [
      /^If you have no Minions, your own life is sacrificed instead\.$/i,
      () => "Nếu bạn không có Minion, Life của chính bạn sẽ bị hy sinh thay thế."
    ],
    [
      /^Consume a Corpse to create a cloud of flammable Poisonous gas\.$/i,
      () => "Tiêu thụ một Corpse để tạo đám khí Poisonous dễ cháy."
    ],
    [
      /^Any Burning effects or Detonator skills will explode the gas cloud, creating a fiery explosion\.$/i,
      () => "Bất kỳ Burning effect hoặc Detonator skill nào cũng sẽ làm đám khí phát nổ, tạo một vụ nổ lửa."
    ],
    [
      /^Grants Skill: (.+)$/i,
      ([, skill]) => `Cấp Skill: ${normalizeText(skill)}`
    ],
    [
      /^Chills all enemies in your Presence\.$/i,
      () => "Chill tất cả kẻ địch trong Presence của bạn."
    ],
    [
      /^Perform an Unarmed Strike\.$/i,
      () => "Thực hiện một Unarmed Strike."
    ]
  ];

  for (const [pattern, formatter] of sentencePatterns) {
    const match = clean.match(pattern);
    if (match) return normalizeProtectedSkillTerms(formatter(match));
  }

  return normalizeProtectedSkillTerms(naturalSkillFallback(clean));
};

export const translateSkillText = (text = "") => {
  const clean = normalizeText(text);
  if (!clean) return "";
  if (EXACT_SKILL_TEXT_TRANSLATIONS.has(clean)) return normalizeProtectedSkillTerms(EXACT_SKILL_TEXT_TRANSLATIONS.get(clean));
  const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
  return normalizeProtectedSkillTerms(sentences.map(translateSkillSentence).join(" "));
};

export const parseSkillGemDetailPage = (html) => {
  const $ = load(html);
  const popup = $(".newItemPopup.GemPopup").first();
  const firstStats = popup.find(".Stats").first();
  const nodeText = (node) => {
    const clone = $(node).clone();
    clone.find("br").replaceWith(" ");
    return normalizeText(clone.text());
  };
  const summaryEn = normalizeText($('meta[property="og:description"]').attr("content") || nodeText(firstStats.find(".secDescrText").first()));
  const readLines = (scope, selector) => scope.find(selector).map((_, node) => nodeText(node)).get().filter(Boolean);
  const readDirectLines = (scope, selector) => scope.children(selector).map((_, node) => nodeText(node)).get().filter(Boolean);
  const sections = popup.find(".hybridHeader.gemTabs").map((_, header) => {
    const title = normalizeText($(header).find(".ItemType").first().text() || $(header).text());
    const stats = $(header).nextAll(".Stats").first();
    return {
      title,
      lines: readDirectLines(stats, ".property, .hybridProperty, .explicitMod, .qualityMod, .text-type0")
    };
  }).get().filter((section) => section.title || section.lines.length);

  const detail = {
    summary_en: summaryEn,
    properties: readDirectLines(firstStats, ".property, .hybridProperty"),
    requirements: readDirectLines(firstStats, ".requirements"),
    mods: readDirectLines(firstStats, ".explicitMod, .qualityMod, .text-type0"),
    sections: sections.length ? sections : readLines(popup, ".explicitMod, .qualityMod").length ? [{
      title: "Stats",
      lines: readLines(popup, ".explicitMod, .qualityMod")
    }] : []
  };
  detail.source_hash = detailHash(detail);
  return detail;
};

export const parseSkillGemsPage = (html, sourcePageUrl = "https://poe2db.tw/us/Skill_Gems") => {
  const $ = load(html);
  const gems = [];
  const slugCounts = new Map();

  $("#SkillGemsGem tbody tr").each((_, row) => {
    const cells = $(row).children("td");
    const iconCell = cells.eq(0);
    const dataCell = cells.eq(1);
    const nameAnchor = dataCell.children("a").first();
    const name = nameAnchor.text().trim();
    const href = nameAnchor.attr("href") || "";
    const sourceSlug = slugFromHref(href);
    if (!name || !sourceSlug) return;

    const tierMatch = dataCell.clone().children(".gem_tags").remove().end().text().match(/\((\d+)\)/);
    const icon = iconCell.find("img").first();
    const classNames = nameAnchor.attr("class") || "";
    const color = classNames.match(/\bgem_(red|green|blue|item)\b/)?.[1] || "item";
    const tags = dataCell.find(".gem_tags a").map((__, tag) => $(tag).text().trim()).get().filter(Boolean);
    const hoverUrl = nameAnchor.attr("data-hover") || iconCell.find("a").first().attr("data-hover") || "";

    const slugCount = (slugCounts.get(sourceSlug) || 0) + 1;
    slugCounts.set(sourceSlug, slugCount);
    const slug = slugCount === 1 ? sourceSlug : `${sourceSlug}__${slugCount}`;

    const gem = {
      slug,
      name,
      tier: tierMatch ? Number(tierMatch[1]) : null,
      color,
      source_url: toAbsoluteUrl(href, sourcePageUrl),
      icon_url: toAbsoluteUrl(icon.attr("src"), sourcePageUrl),
      icon_alt: icon.attr("alt") || "",
      hover_url: toAbsoluteUrl(hoverUrl, sourcePageUrl),
      tags
    };
    gem.source_hash = normalizedHash(gem);
    gems.push(gem);
  });

  return gems.sort((a, b) => (a.tier ?? 999) - (b.tier ?? 999) || a.name.localeCompare(b.name));
};

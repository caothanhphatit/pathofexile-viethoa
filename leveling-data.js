window.levelingRouteZones = [
  {
    id: "riverbank",
    title: "Riverbank",
    level: "Lvl 1",
    tasks: [
      { id: "riverbank-talk-wounded", required: true, text: "Nói chuyện với <strong>Wounded Man</strong>, trang bị weapon khởi đầu" },
      { id: "riverbank-loot-chests", required: true, text: "Loot <strong>Large Chests</strong>, trang bị item + skill vừa nhặt" },
      { id: "riverbank-kill-miller", required: true, text: "Giết <strong>The Bloated Miller</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "riverbank-enter-town", required: true, text: "Vào <strong>Clearfell Encampment</strong> phía sau boss", badges: [{ text: "town", tone: "violet" }] }
    ]
  },
  {
    id: "clearfell-encampment",
    title: "Clearfell Encampment",
    level: "Lvl 2",
    meta: "Town",
    tasks: [
      { id: "town-talk-renly", required: true, text: "Nói chuyện với <strong>Renly</strong>", badges: [{ text: "Skill Gem Lv1", tone: "blue" }] },
      { id: "town-accept-quest", required: true, text: "Nhận quest, vào <strong>Clearfell</strong>" }
    ]
  },
  {
    id: "clearfell",
    title: "Clearfell",
    level: "Lvl 2-3",
    tasks: [
      { id: "clearfell-kill-beira", required: true, text: "Giết <strong>Beira of the Rotten Pack</strong> ở phía bắc", badges: [{ text: "+10% Cold Res", tone: "green" }] },
      { id: "clearfell-mud-burrow", text: "<em>(Opt)</em> Mud Burrow -> <strong>The Devourer</strong>", badges: [{ text: "Skill Gem Lv2", tone: "blue" }] },
      { id: "clearfell-stash", text: "<em>(Opt)</em> Nhặt <strong>Abandoned Stash</strong> trong cái nhà", badges: [{ text: "Skill Gem Lv1", tone: "blue" }] },
      { id: "clearfell-enter-grelwood", required: true, text: "Vào <strong>The Grelwood</strong>" }
    ]
  },
  {
    id: "grelwood",
    title: "The Grelwood",
    level: "Lvl 3-5",
    meta: "Waypoint",
    tasks: [
      { id: "grelwood-find-una", required: true, text: "Gọi <strong>Una</strong> ra để nói chuyện" },
      { id: "grelwood-waypoint", required: true, text: "Lấy waypoint <strong>The Grelwood</strong>" },
      { id: "grelwood-open-grim", required: true, text: "Vào <strong>Grim Tangle</strong>, lấy waypoint rồi quay lại" },
      { id: "grelwood-open-red-vale", required: true, text: "Vào <strong>The Red Vale</strong>, lấy waypoint rồi quay lại" },
      { id: "grelwood-gerung", text: "<em>(Opt)</em> Giết <strong>Gerung, the Brambleghast</strong>", badges: [{ text: "Skill Gem Lv1", tone: "blue" }] },
      { id: "grelwood-cauldron-areagne", text: "<em>(Opt)</em> Hut with Cauldron để nâng flask -> giết <strong>Areagne</strong>", badges: [{ text: "flask upgrade", tone: "green" }, { text: "Support Gem", tone: "blue" }] },
      { id: "grelwood-areagne-tip", tip: true, text: "Areagne là fight khó đầu game; <strong>Frost Bomb</strong> giúp chill boss nên dễ xử lý hơn.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "grelwood-enter-red-vale", required: true, text: "Vào <strong>The Red Vale</strong>" }
    ]
  },
  {
    id: "red-vale",
    title: "The Red Vale",
    level: "Lvl 5-6",
    meta: "Waypoint",
    tasks: [
      { id: "red-vale-obelisks", required: true, text: "Tìm đủ 3 <strong>Obelisks of Rust</strong>, nhặt <strong>Runed Girdle</strong> ở mỗi Obelisk" },
      { id: "red-vale-rust-king", required: true, text: "<strong>The Rust King</strong> spawn ở Obelisk cuối", badges: [{ text: "boss", tone: "red" }] },
      { id: "red-vale-rust-king-tip", tip: true, text: "Kéo quái đứng dưới chân boss để tận dụng AoE damage uptime.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "red-vale-tp-town", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "clearfell-encampment-runed-spikes",
    title: "Clearfell Encampment",
    tasks: [
      { id: "red-vale-renly", required: true, text: "Nói <strong>Renly</strong>, lấy <strong>Runed Spikes</strong>" },
      { id: "red-vale-tp-grelwood", required: true, text: "TP tới <strong>The Grelwood</strong>" }
    ]
  },
  {
    id: "grelwood-return",
    title: "The Grelwood (Return)",
    tasks: [
      { id: "red-vale-runic-seal", required: true, text: "Kích hoạt 3 <strong>Runic Seals</strong>" },
      { id: "grelwood-return-talk-una", required: true, text: "Nói chuyện với <strong>Una</strong>" },
      { id: "grelwood-return-tp-town", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "clearfell-encampment-to-grim",
    title: "Clearfell Encampment",
    tasks: [
      { id: "town-talk-una-after-seals", required: true, text: "Nói chuyện với <strong>Una</strong>" },
      { id: "town-tp-grim-tangle", required: true, text: "TP tới <strong>Grim Tangle</strong>" }
    ]
  },
  {
    id: "grim-tangle",
    title: "Grim Tangle",
    level: "Lvl 6",
    meta: "Waypoint",
    tasks: [
      { id: "grim-tangle-rotten-druid", text: "<em>(Opt)</em> Giết <strong>The Rotten Druid</strong>", badges: [{ text: "Support Gem", tone: "blue" }] },
      { id: "cemetery-enter", required: true, text: "Vào <strong>Cemetery of the Eternals</strong>" }
    ]
  },
  {
    id: "cemetery",
    title: "Cemetery of the Eternals",
    level: "Lvl 6-9",
    tasks: [
      { id: "cemetery-talk-lachlann", required: true, text: "Nói chuyện với <strong>Lachlann the Lost</strong>" },
      { id: "cemetery-sarcophagus", text: "<em>(Opt)</em> Mở <strong>Sarcophagus</strong> gần checkpoint", badges: [{ text: "Ring", tone: "violet" }] },
      { id: "cemetery-draven", required: true, text: "<strong>Mausoleum of the Praetor</strong> -> giết <strong>Draven</strong> -> lấy Key Piece, TP back", badges: [{ text: "Key Piece", tone: "blue" }] },
      { id: "cemetery-draven-note", tip: true, text: "Làm Draven trước để giữ Asinia ở level cao hơn -> drop tốt hơn.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "cemetery-asinia", required: true, text: "<strong>Tomb of the Consort</strong> -> giết <strong>Asinia</strong> -> lấy Key Piece, TP back", badges: [{ text: "Key Piece", tone: "blue" }] },
      { id: "cemetery-gate", required: true, text: "Mở <strong>Memorial Gate</strong> cạnh <strong>Lachlann</strong>" },
      { id: "cemetery-kill-lachlann", required: true, text: "Giết <strong>Lachlann</strong>, nhặt Ring", badges: [{ text: "Ring", tone: "green" }] },
      { id: "cemetery-tp-town", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "clearfell-encampment-after-cemetery",
    title: "Clearfell Encampment",
    tasks: [
      { id: "hunting-town-talk", required: true, text: "Nói <strong>Finn</strong>, <strong>Una</strong>, <strong>The Hooded One</strong>" },
      { id: "act1-town-tp-hunting", required: true, text: "TP tới <strong>Hunting Grounds</strong>" }
    ]
  },
  {
    id: "hunting-grounds",
    title: "Hunting Grounds",
    level: "Lvl 10",
    meta: "Waypoint",
    tasks: [
      { id: "hunting-pathing-tip", tip: true, text: "0.5 pathing: sau ritual nhỏ, đi theo trail locusts tới Freythorn; Crowbells để lại blood trail dẫn tới boss; signpost trên đường chỉ tới Ogham Village.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "hunting-talk-delwyn", required: true, text: "Nói chuyện với <strong>Delwyn</strong>" },
      { id: "hunting-kill-crowbell", required: true, text: "Giết <strong>The Crowbell</strong>", badges: [{ text: "+2 Skill Points", tone: "green" }] },
      { id: "hunting-crowbell-tip", tip: true, text: "Coi chừng slam attack rất đau; boss thấp máu sẽ bỏ chạy, kite cẩn thận.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "hunting-open-freythorn", required: true, text: "Vào <strong>Freythorn</strong>, lấy waypoint rồi quay lại" },
      { id: "hunting-open-farmlands", required: true, text: "Vào <strong>Ogham Farmlands</strong>, lấy waypoint rồi quay lại" },
      { id: "hunting-small-ritual", text: "<em>(Opt)</em> Small ritual event gần checkpoint", badges: [{ text: "Support Gem", tone: "blue" }] },
      { id: "hunting-league", text: "<em>(Opt)</em> Cơ chế league nếu gặp", badges: [{ text: "Exalted Orb", tone: "blue" }] },
      { id: "hunting-tp-freythorn", required: true, text: "TP tới <strong>Freythorn</strong>" }
    ]
  },
  {
    id: "freythorn",
    title: "Freythorn",
    level: "Lvl 11-12",
    meta: "Waypoint",
    tasks: [
      { id: "freythorn-small-altars", required: true, text: "Kích hoạt 3 <strong>Ritual Altars</strong> nhỏ" },
      { id: "freythorn-altar-tip", tip: true, text: "Smoke/tendril từ Big Ritual Altar chỉ hướng tới các altar nhỏ.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "freythorn-king", required: true, text: "<strong>Big Ritual Altar</strong> -> giết <strong>The King in the Mists</strong>", badges: [{ text: "+30 Spirit", tone: "green" }] },
      { id: "freythorn-king-tip", tip: true, text: "Phase 2: né totem summon và curse bắt đứng yên/di chuyển đúng lúc.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "freythorn-tp-farmlands", required: true, text: "TP tới <strong>Ogham Farmlands</strong>" }
    ]
  },
  {
    id: "ogham-farmlands",
    title: "Ogham Farmlands",
    level: "Lvl 12",
    meta: "Waypoint",
    tasks: [
      { id: "farmlands-lute-box", required: true, text: "<strong>Una's Lute Box</strong> trong nhà gần checkpoint -> lấy <strong>Una's Lute</strong>", badges: [{ text: "+2 Skill Points", tone: "green" }] },
      { id: "farmlands-return-lute", tip: true, text: "Đem <strong>Una's Lute</strong> về cho Una trong town để nhận thưởng.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "farmlands-rare-dogs", text: "<em>(Opt)</em> Rare dogs trong crop circle", badges: [{ text: "Skill Gem Lv4", tone: "blue" }] },
      { id: "farmlands-enter-village", required: true, text: "Vào <strong>Ogham Village</strong>" }
    ]
  },
  {
    id: "ogham-village",
    title: "Ogham Village",
    level: "Lvl 12-13",
    tasks: [
      { id: "village-smithing-tools", text: "<em>(1st char)</em> Lấy <strong>Smithing Tools</strong> trong nhà", badges: [{ text: "Salvage Bench", tone: "green" }] },
      { id: "village-blacksmith-chest", text: "<em>(Opt)</em> <strong>Blacksmith's Chest</strong> cùng nhà", badges: [{ text: "Blank Rune", tone: "blue" }, { text: "Artificer's Orb", tone: "blue" }] },
      { id: "village-executioner", required: true, text: "Giết <strong>The Executioner</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "village-lever-leitis", required: true, text: "Lên tầng -> kéo Lever -> nói <strong>Leitis</strong>" },
      { id: "village-enter-ramparts", required: true, text: "Vào <strong>The Manor Ramparts</strong>" }
    ]
  },
  {
    id: "manor-ramparts",
    title: "The Manor Ramparts",
    level: "Lvl 13",
    tasks: [
      { id: "manor-rope-corpse", text: "<em>(Opt)</em> Nhặt dây thừng trên xác treo gần checkpoint", badges: [{ text: "Support Gem", tone: "blue" }] },
      { id: "manor-gear-check", tip: true, text: "Confirm flask level 10 + chest piece level 11 trước khi vào Manor để an toàn hơn.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "manor-enter", required: true, text: "Vào <strong>Ogham Manor</strong>" }
    ]
  },
  {
    id: "ogham-manor",
    title: "Ogham Manor",
    level: "Lvl 13-14",
    tasks: [
      { id: "manor-candlemass", required: true, text: "Giết <strong>Candlemass</strong> ở tầng 1", badges: [{ text: "+20 Max Life", tone: "green" }] },
      { id: "manor-candlemass-tip", tip: true, text: "Thường ở sau walkway đầu tiên, đôi khi sớm hơn; rơi Essence + double-res belt.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "manor-kill-geonor", required: true, text: "Xuống tầng dưới -> giết <strong>Geonor</strong>", badges: [{ text: "Act boss", tone: "red" }] },
      { id: "manor-geonor-tip", tip: true, text: "Phase 2: dodge roll lướt dưới kiếm; Frost Bomb đầu phase giúp chill boss.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "manor-tp-town", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act1-end",
    title: "Clearfell Encampment (End of Act)",
    tasks: [
      { id: "act1-end-talk-all", required: true, text: "Nói chuyện với tất cả NPC" },
      { id: "act1-end-follow-beast", required: true, text: "Nói <strong>The Hooded One</strong> -> <strong>Follow the Beast's Trail</strong>" },
      { id: "act1-complete-note", tip: true, text: "Act I complete -> sang Act II.", badges: [{ text: "complete", tone: "green" }] }
    ]
  },

  {
    id: "act2-vastiri-outskirts",
    act: "act2",
    title: "Vastiri Outskirts",
    level: "Lvl 14-15",
    tasks: [
      { id: "a2-outskirts-talk-hooded", required: true, text: "Nói chuyện với <strong>The Hooded One</strong>", badges: [{ text: "Act 2", tone: "violet" }] },
      { id: "a2-outskirts-kill-rathbreaker", required: true, text: "Giết <strong>Rathbreaker</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "a2-outskirts-tp-start", required: true, text: "TP back về đầu zone" },
      { id: "a2-outskirts-talk-zarka", required: true, text: "Nói chuyện với <strong>Zarka</strong>" },
      { id: "a2-outskirts-enter-caravan", required: true, text: "Vào <strong>The Ardura Caravan</strong>", badges: [{ text: "town", tone: "violet" }] }
    ]
  },
  {
    id: "act2-ardura-caravan",
    act: "act2",
    title: "The Ardura Caravan",
    meta: "Town",
    tasks: [
      { id: "a2-caravan-talk-hooded-asala", required: true, text: "Nói <strong>Hooded One</strong> + <strong>Sekhema Asala</strong> 2 lần" },
      { id: "a2-caravan-halani-map", required: true, text: "Dùng <strong>Desert Map</strong> -> đi tới <strong>Halani Gates</strong>" },
      { id: "a2-caravan-halani-asala", required: true, text: "Vào <strong>Halani Gates</strong> -> nói <strong>Sekhema Asala</strong>" },
      { id: "a2-caravan-return-asala", required: true, text: "Quay lại Caravan -> nói <strong>Sekhema Asala</strong>" },
      { id: "a2-caravan-travel-mawdun", required: true, text: "Đi tới <strong>Mawdun Quarry</strong>" }
    ]
  },
  {
    id: "act2-mawdun",
    act: "act2",
    title: "Mawdun Quarry",
    level: "Lvl 15",
    tasks: [
      { id: "a2-mawdun-war-cache", text: "<em>(Opt)</em> <strong>Faridun War Cache</strong> gần checkpoint", badges: [{ text: "Artificer's Orb", tone: "blue" }] },
      { id: "a2-mawdun-enter-mine", required: true, text: "Vào <strong>Mawdun Mine</strong>, đi theo checkpoints" }
    ]
  },
  {
    id: "act2-mawdun-mine",
    act: "act2",
    title: "Mawdun Mine",
    level: "Lvl 16",
    tasks: [
      { id: "a2-mawdun-kill-rudja", required: true, text: "Giết <strong>Rudja</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "a2-mawdun-talk-risu-cage", required: true, text: "Nói <strong>Risu</strong> trong lồng" },
      { id: "a2-mawdun-tp-caravan", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act2-caravan-after-mawdun",
    act: "act2",
    title: "The Ardura Caravan",
    tasks: [
      { id: "a2-mawdun-talk-risu-asala", required: true, text: "Nói <strong>Risu</strong> + <strong>Sekhema Asala</strong>" },
      { id: "a2-mawdun-travel-traitors", required: true, text: "Đi tới <strong>Traitor's Passage</strong>" }
    ]
  },
  {
    id: "act2-traitors-passage",
    act: "act2",
    title: "Traitor's Passage",
    level: "Lvl 17",
    tasks: [
      { id: "a2-traitors-ancient-seal", required: true, text: "Tương tác với cửa <strong>Ancient Seal</strong> + các <strong>Runic Seals</strong>" },
      { id: "a2-traitors-balbala", text: "<em>(Opt)</em> Giết <strong>Balbala, the Traitor</strong>", badges: [{ text: "Djinn Barya", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a2-traitors-balbala-note", tip: true, text: "Đa số build skip Balbala; lấy backup Barya từ Deshar vultures dễ hơn và đủ XP hơn ở level 28.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-traitors-bell-chest", text: "<em>(Opt)</em> <strong>Bell Chest</strong> trong ngõ cụt", badges: [{ text: "random loot", tone: "blue" }] },
      { id: "a2-traitors-enter-halani", required: true, text: "Vào <strong>The Halani Gates</strong> bằng cầu thang lên" }
    ]
  },
  {
    id: "act2-halani-gates",
    act: "act2",
    title: "The Halani Gates",
    level: "Lvl 18",
    tasks: [
      { id: "a2-halani-summon-asala", required: true, text: "Gọi <strong>Asala</strong> để mở gates" },
      { id: "a2-halani-asala-tip", tip: true, text: "Nếu Asala bị lag sau terra-cotta soldiers, reset checkpoint để cô ấy snap tới bạn.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-halani-jamanra-first", required: true, text: "Giết <strong>Jamanra</strong> lần gặp đầu", badges: [{ text: "boss", tone: "red" }] },
      { id: "a2-halani-checkpoint-search", required: true, text: "Đi cầu thang lên, tìm checkpoint" },
      { id: "a2-halani-tp-caravan", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act2-caravan-after-halani",
    act: "act2",
    title: "The Ardura Caravan",
    tasks: [
      { id: "a2-halani-talk-shambrin", required: true, text: "Nói <strong>Shambrin</strong>, <strong>Zarka</strong>, <strong>Sekhema Asala</strong>" },
      { id: "a2-halani-trial-wp", required: true, text: "Đi tới <strong>Trial of Sekhemas</strong>, lấy waypoint", badges: [{ text: "Run later Lvl 28", tone: "green" }] },
      { id: "a2-halani-travel-mastodon", required: true, text: "TP back -> đi tới <strong>Mastodon Badlands</strong>" }
    ]
  },
  {
    id: "act2-mastodon",
    act: "act2",
    title: "Mastodon Badlands",
    level: "Lvl 19-20",
    tasks: [
      { id: "a2-mastodon-pathing-tip", tip: true, text: "0.5 pathing: tìm các vết nứt dưới đất để tới <strong>Lightless Caverns</strong> và unlock <strong>Well of Souls</strong>.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-mastodon-before-keth-tip", tip: true, text: "Chạy Mastodon trước Keth để đẩy level Keth lên, giúp Kabala drop gem level 7.", badges: [{ text: "routing", tone: "amber" }] },
      { id: "a2-mastodon-effigy", text: "<em>(Opt)</em> Effigy gần checkpoint", badges: [{ text: "Support Gem Lv2", tone: "blue" }] },
      { id: "a2-mastodon-league", text: "<em>(Opt)</em> Cơ chế league nếu gặp", badges: [{ text: "Regal Orb", tone: "blue" }] },
      { id: "a2-mastodon-enter-bone", required: true, text: "Vào <strong>The Bone Pits</strong>" }
    ]
  },
  {
    id: "act2-bone-pits",
    act: "act2",
    title: "The Bone Pits",
    level: "Lvl 20-21",
    tasks: [
      { id: "a2-bone-sun-relic", required: true, text: "Giết hyenas tới khi rơi <strong>Sun Clan Relic</strong>" },
      { id: "a2-bone-sun-relic-tip", tip: true, text: "Tall hyenas (Goliaths) có tỉ lệ rơi cao hơn; giữ relic cho altar ở Valley of the Titans.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-bone-ikbab-ekbab", required: true, text: "Giết <strong>Iktab & Ekbab</strong> -> nhặt <strong>Mastodon Tusks</strong>", badges: [{ text: "quest", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a2-bone-tp-caravan", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act2-caravan-after-bone",
    act: "act2",
    title: "The Ardura Caravan",
    tasks: [
      { id: "a2-bone-talk-zarka", required: true, text: "Nói <strong>Zarka</strong>" },
      { id: "a2-bone-travel-keth", required: true, text: "Đi tới <strong>Keth</strong>" }
    ]
  },
  {
    id: "act2-keth",
    act: "act2",
    title: "Keth",
    level: "Lvl 22",
    tasks: [
      { id: "a2-keth-kabala-relic", required: true, text: "Giết snakes tới khi rơi <strong>Kabala Clan Relic</strong>" },
      { id: "a2-keth-league", text: "<em>(Opt)</em> Cơ chế league nếu gặp", badges: [{ text: "Gemcutter's Prism", tone: "blue" }] },
      { id: "a2-keth-kabala", required: true, text: "Giết <strong>Kabala, Constrictor Queen</strong>", badges: [{ text: "+2 Skill Points", tone: "green" }, { text: "Uncut Skill Gem Lv7", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a2-keth-kabala-tip", tip: true, text: "Kabala drop gem level 7 vì đã làm Mastodon trước; rất hữu ích cho mọi class.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-keth-enter-lost-city", required: true, text: "Vào <strong>The Lost City</strong>" }
    ]
  },
  {
    id: "act2-lost-city",
    act: "act2",
    title: "The Lost City",
    level: "Lvl 23",
    tasks: [
      { id: "a2-lost-ninth-treasure", text: "<em>(Opt)</em> Giết <strong>Ninth Treasure of Keth</strong>", badges: [{ text: "random loot", tone: "blue" }] },
      { id: "a2-lost-golden-tomb", text: "<em>(Opt)</em> <strong>Golden Tomb</strong>", badges: [{ text: "Spirit Gem Lv7", tone: "blue" }] },
      { id: "a2-lost-enter-shrines", required: true, text: "Vào <strong>Buried Shrines</strong>" }
    ]
  },
  {
    id: "act2-buried-shrines",
    act: "act2",
    title: "Buried Shrines",
    level: "Lvl 23",
    tasks: [
      { id: "a2-shrines-sarcophagus", text: "<em>(Opt)</em> Guarded Sarcophagus", badges: [{ text: "Support Gem / Lesser Jeweller's Orb", tone: "blue" }] },
      { id: "a2-shrines-offering", text: "<em>(Opt)</em> Chọn Offering fire/water/lightning", badges: [{ text: "Resist Ring", tone: "blue" }] },
      { id: "a2-shrines-enter-heart", required: true, text: "Vào <strong>The Heart of Keth</strong>" }
    ]
  },
  {
    id: "act2-heart-keth",
    act: "act2",
    title: "The Heart of Keth",
    level: "Lvl 24",
    tasks: [
      { id: "a2-heart-azarian", required: true, text: "Giết <strong>Azarian</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "a2-heart-cinders", required: true, text: "Nói <strong>Water Goddess</strong> -> lấy <strong>Everburning Cinders</strong> -> ignite Goddess" },
      { id: "a2-heart-tp-caravan", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act2-caravan-after-heart",
    act: "act2",
    title: "The Ardura Caravan",
    tasks: [
      { id: "a2-heart-talk-zarka", required: true, text: "Nói <strong>Zarka</strong>" },
      { id: "a2-heart-travel-valley", required: true, text: "Đi tới <strong>Valley of the Titans</strong>" }
    ]
  },
  {
    id: "act2-valley-titans",
    act: "act2",
    title: "Valley of the Titans",
    level: "Lvl 25",
    meta: "Waypoint",
    tasks: [
      { id: "a2-valley-seals", required: true, text: "Tìm đủ 3 <strong>Ancient Seals</strong> quanh perimeter" },
      { id: "a2-valley-league", text: "<em>(Opt)</em> Cơ chế league nếu gặp", badges: [{ text: "Random Unique", tone: "blue" }] },
      { id: "a2-valley-league-tip", tip: true, text: "Có thể ra Wake of Destruction, Blackheart, Goldrim, Crown of the Victor hoặc 1k gold floor.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-valley-medallion", required: true, text: "Tìm Medallion gần waypoint, đặt 2 Relics và chọn buff", badges: [{ text: "reward vĩnh viễn", tone: "green" }] },
      { id: "a2-valley-medallion-tip", tip: true, text: "Chọn +30% Charm Charges hoặc +15% Mana Recovery; có thể đổi lại sau.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-valley-enter-grotto", required: true, text: "Vào <strong>The Titan Grotto</strong>" }
    ]
  },
  {
    id: "act2-titan-grotto",
    act: "act2",
    title: "The Titan Grotto",
    level: "Lvl 25-26",
    tasks: [
      { id: "a2-grotto-zalmarath", required: true, text: "Giết <strong>Zalmarath, the Colossus</strong> -> nhặt <strong>Flame Ruby</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "a2-grotto-tp-caravan", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act2-caravan-after-grotto",
    act: "act2",
    title: "The Ardura Caravan",
    tasks: [
      { id: "a2-grotto-talk-zarka-asala", required: true, text: "Nói <strong>Zarka</strong> + <strong>Sekhema Asala</strong>" },
      { id: "a2-grotto-travel-halani", required: true, text: "Đi tới <strong>Halani Gates</strong> nhưng đừng vào" },
      { id: "a2-grotto-sound-horn", required: true, text: "Thổi <strong>Horn</strong> ở đỉnh Caravan" },
      { id: "a2-grotto-talk-asala", required: true, text: "Nói <strong>Sekhema Asala</strong>" },
      { id: "a2-grotto-travel-deshar", required: true, text: "Đi tới <strong>Deshar</strong>" }
    ]
  },
  {
    id: "act2-deshar",
    act: "act2",
    title: "Deshar",
    level: "Lvl 26-27",
    tasks: [
      { id: "a2-deshar-fallen-dekhara", required: true, text: "Tìm/nhặt <strong>Fallen Dekhara</strong> gần tower", badges: [{ text: "+2 Skill Points", tone: "green" }] },
      { id: "a2-deshar-letter", tip: true, text: "<strong>Letter from Lihl Lima</strong> -> đem cho Shambrin trong town.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-deshar-vultures", required: true, text: "Giết 2 <strong>Vultures</strong> ở side area", badges: [{ text: "Backup Djinn Barya Lvl 28", tone: "blue" }] },
      { id: "a2-deshar-vultures-note", tip: true, text: "Đây là đường ascend dễ hơn Balbala cho mọi class.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-deshar-orb", text: "<em>(Opt)</em> Side dead-end", badges: [{ text: "Artificer's Orb", tone: "blue" }] },
      { id: "a2-deshar-enter-path", required: true, text: "Vào <strong>Path of Mourning</strong>" }
    ]
  },
  {
    id: "act2-path-mourning",
    act: "act2",
    title: "Path of Mourning",
    level: "Lvl 27",
    tasks: [
      { id: "a2-path-map-tip", tip: true, text: "Tin hướng trên overworld map; exit khá thẳng.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-path-vases", text: "<em>(Opt)</em> Shifting Vases encounter", badges: [{ text: "4 rares + Support Gem Lv2", tone: "blue" }] },
      { id: "a2-path-enter-spires", required: true, text: "Vào <strong>The Spires of Deshar</strong>" }
    ]
  },
  {
    id: "act2-spires-deshar",
    act: "act2",
    title: "The Spires of Deshar",
    level: "Lvl 27",
    tasks: [
      { id: "a2-spires-sisters", required: true, text: "Tương tác shrine <strong>Sisters of Garukhan</strong>", badges: [{ text: "+10% Lightning Res", tone: "green" }] },
      { id: "a2-spires-league", text: "<em>(Opt)</em> Cơ chế league nếu gặp", badges: [{ text: "Gemcutter's Prism", tone: "blue" }] },
      { id: "a2-spires-tor-gul", required: true, text: "Giết <strong>Tor Gul</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "a2-spires-tor-gul-note", tip: true, text: "Một trong các fight khó nhất Act II; cap Lightning Res và coi chừng defiler attacks.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-spires-tp-caravan", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act2-trial-sekhemas",
    act: "act2",
    title: "Trial of the Sekhemas",
    level: "Lvl 28",
    meta: "Waypoint",
    tasks: [
      { id: "a2-trial-waypoint", required: true, text: "Vào Trial -> tự chọn <strong>Lvl 28 Djinn Barya</strong>, không dùng default Lvl 22" },
      { id: "a2-trial-barya-tip", tip: true, text: "Default thường là Lvl 22 Balbala Barya; chọn Lvl 28 từ Deshar Vultures để đủ XP + reward tốt hơn.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-trial-select-barya", required: true, text: "Set relic affinity để inventory gọn hơn" },
      { id: "a2-trial-room-priority", required: true, text: "Ưu tiên phòng <strong>Ritual > Chalice > Hourglass > Gauntlet</strong>" },
      { id: "a2-trial-room-tip", tip: true, text: "Hourglass: giết rares để chunk timer. Chalice: chỉ tới vị trí rare.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-trial-complete", required: true, text: "Hoàn thành Trial -> lấy <strong>Ascendancy</strong> đầu", badges: [{ text: "Ascendancy", tone: "green" }] },
      { id: "a2-trial-white-chest", tip: true, text: "Warrior/Smith of Kitava: giữ white chest piece trong stash; ascendancy lock khỏi magic/rare chests.", badges: [{ text: "tip", tone: "amber" }] }
    ]
  },
  {
    id: "act2-dreadnought",
    act: "act2",
    title: "The Dreadnought",
    level: "Lvl 28-29",
    tasks: [
      { id: "a2-dreadnought-travel", required: true, text: "Đi tới <strong>The Dreadnought</strong>" },
      { id: "a2-dreadnought-enter-vanguard", required: true, text: "Vào <strong>Dreadnought Vanguard</strong>" }
    ]
  },
  {
    id: "act2-dreadnought-vanguard",
    act: "act2",
    title: "Dreadnought Vanguard",
    level: "Lvl 29",
    tasks: [
      { id: "a2-dreadnought-jamanra", required: true, text: "Giết <strong>Jamanra, the Risen King</strong>", badges: [{ text: "Act boss", tone: "red" }] },
      { id: "a2-dreadnought-jamanra-tip", tip: true, text: "Boss bắt đầu ở trạng thái armor-broken; khoảng 55k phys damage có thể stun trước phase lightning fence.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a2-dreadnought-tp-caravan", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act2-end-caravan",
    act: "act2",
    title: "The Ardura Caravan (End of Act)",
    tasks: [
      { id: "a2-dreadnought-exit-caravan", required: true, text: "Ra khỏi Caravan ở góc trên trái -> nói <strong>Hooded One</strong> -> chờ animation" },
      { id: "a2-dreadnought-travel-act3", required: true, text: "Quay lại -> nói <strong>Sekhema Asala</strong> -> <strong>Travel to the Sandswept Marsh</strong>" },
      { id: "a2-complete-note", tip: true, text: "Act II complete -> sang Act III.", badges: [{ text: "complete", tone: "green" }] }
    ]
  },

  {
    id: "act3-sandswept-marsh",
    act: "act3",
    title: "Sandswept Marsh",
    level: "Lvl 30",
    tasks: [
      { id: "a3-marsh-talk-hooded", required: true, text: "Nói chuyện với <strong>The Hooded One</strong>", badges: [{ text: "Act 3", tone: "violet" }] },
      { id: "a3-marsh-rootdredge", text: "<em>(Opt)</em> Giết <strong>Rootdredge</strong>", badges: [{ text: "Skill Gem Lv9", tone: "blue" }] },
      { id: "a3-marsh-basket", text: "<em>(Opt)</em> Basket ở <strong>Orok Campsite</strong>", badges: [{ text: "Lesser Jeweller's Orb", tone: "blue" }] },
      { id: "a3-marsh-hanging-tree", text: "<em>(Opt)</em> Xác treo trên cây", badges: [{ text: "Magic Ring", tone: "blue" }] },
      { id: "a3-marsh-ring-point", text: "<em>(Opt)</em> Point of interest Ring level 33", badges: [{ text: "High-tier flat damage", tone: "blue" }] },
      { id: "a3-marsh-enter-ziggurat", required: true, text: "Vào <strong>Ziggurat Encampment</strong>" }
    ]
  },
  {
    id: "act3-ziggurat-town",
    act: "act3",
    title: "Ziggurat Encampment",
    meta: "Town",
    tasks: [
      { id: "a3-ziggurat-talk-alva-oswald-hooded", required: true, text: "Nói <strong>Alva</strong>, <strong>Oswald</strong>, <strong>The Hooded One</strong>" },
      { id: "a3-ziggurat-rog-flask", required: true, text: "Nâng flask level 30 ở <strong>Rog</strong>", badges: [{ text: "increased recovery + charges", tone: "green" }] },
      { id: "a3-ziggurat-enter-jungle", required: true, text: "Vào <strong>Jungle Ruins</strong> bằng lối trên" }
    ]
  },
  {
    id: "act3-jungle-ruins",
    act: "act3",
    title: "Jungle Ruins",
    level: "Lvl 30-31",
    meta: "Waypoint",
    tasks: [
      { id: "a3-jungle-pathing", tip: true, text: "0.5 pathing: nói chuyện với explorer camps, họ sẽ chỉ hướng và reveal điểm đến trên minimap.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-jungle-silverfist", required: true, text: "Giết <strong>Mighty Silverfist</strong>", badges: [{ text: "+2 Skill Points", tone: "green" }] },
      { id: "a3-jungle-silverfist-tip", tip: true, text: "Né slam theo hướng ngang, đừng lùi thẳng; wave đi theo hướng đánh.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-jungle-grave", required: true, text: "<strong>Jungle Grave</strong> / xác bị tàn phá -> Servi tặng Rare Belt", badges: [{ text: "Rare Belt", tone: "blue" }] },
      { id: "a3-jungle-field-vendor-gloves", text: "<em>(Opt)</em> Field vendor", badges: [{ text: "Guaranteed Rare Gloves", tone: "blue" }] },
      { id: "a3-jungle-venom-wp", required: true, text: "Tìm waypoint gần <strong>Venom Crypts</strong>" },
      { id: "a3-jungle-enter-barrens", required: true, text: "Vào <strong>Infested Barrens</strong>" }
    ]
  },
  {
    id: "act3-infested-barrens",
    act: "act3",
    title: "Infested Barrens",
    level: "Lvl 31-32",
    meta: "Waypoint",
    tasks: [
      { id: "a3-barrens-find-alva", required: true, text: "Tìm/nói <strong>Alva</strong>, lấy waypoint cạnh cô ấy" },
      { id: "a3-barrens-field-vendor-boots", text: "<em>(Opt)</em> Field vendor", badges: [{ text: "Guaranteed Rare Boots", tone: "blue" }] },
      { id: "a3-barrens-chimeral-wp", required: true, text: "Vào <strong>Chimeral Wetlands</strong>, lấy waypoint rồi quay lại" },
      { id: "a3-barrens-azak-wp", required: true, text: "Vào <strong>Azak Bog</strong>, lấy waypoint rồi quay lại" },
      { id: "a3-barrens-tp-venom", required: true, text: "TP tới <strong>Venom Crypts</strong> qua waypoint Jungle Ruins" }
    ]
  },
  {
    id: "act3-venom-crypts",
    act: "act3",
    title: "The Venom Crypts",
    level: "Lvl 31",
    tasks: [
      { id: "a3-venom-sarcophagus", text: "<em>(Opt)</em> Sarcophagus event", badges: [{ text: "Guaranteed Lv3 Support", tone: "blue" }] },
      { id: "a3-venom-corpse-snake", required: true, text: "Tìm xác -> nhặt <strong>Corpse-snake Venom</strong>" },
      { id: "a3-venom-tp-town", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act3-ziggurat-after-venom",
    act: "act3",
    title: "Ziggurat Encampment",
    tasks: [
      { id: "a3-venom-servi-choice", required: true, text: "Nói <strong>Servi</strong>, chọn reward vĩnh viễn từ venom", badges: [{ text: "PERMANENT", tone: "red" }] },
      { id: "a3-venom-servi-choice-tip", tip: true, text: "Không đổi lại được: +25% Stun Threshold phổ biến; +30% Elemental Ailment Threshold nếu tree thiếu; +25% Mana Regeneration hiếm dùng.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-venom-tp-chimeral", required: true, text: "TP tới <strong>Chimeral Wetlands</strong>" }
    ]
  },
  {
    id: "act3-chimeral-wetlands",
    act: "act3",
    title: "Chimeral Wetlands",
    level: "Lvl 32-33",
    meta: "Waypoint",
    tasks: [
      { id: "a3-chimeral-field-vendor-helm", text: "<em>(Opt)</em> Field vendor", badges: [{ text: "Guaranteed Rare Helm", tone: "blue" }] },
      { id: "a3-chimeral-toxic-bloom", text: "<em>(Opt)</em> Toxic Bloom point of interest", badges: [{ text: "Amulet", tone: "blue" }] },
      { id: "a3-chimeral-league", text: "<em>(Opt)</em> Cơ chế league nếu gặp", badges: [{ text: "Skill Gem Lv9", tone: "blue" }] },
      { id: "a3-chimeral-enter-chaos", required: true, text: "Vào <strong>Temple of Chaos</strong>, lấy waypoint rồi quay lại", badges: [{ text: "2nd Ascendancy", tone: "green" }] },
      { id: "a3-chimeral-xyclucian", required: true, text: "Giết <strong>Xyclucian, the Chimera</strong> -> nhặt <strong>Inscribed Ultimatum</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "a3-chimeral-enter-machinarium", required: true, text: "Vào <strong>Jiquani's Machinarium</strong> sau lưng boss" }
    ]
  },
  {
    id: "act3-trial-chaos",
    act: "act3",
    title: "Trial of Chaos",
    level: "Lvl 33+",
    tasks: [
      { id: "a3-chaos-use-ultimatum", required: true, text: "Dùng <strong>Inscribed Ultimatum</strong> ở cổng Trial" },
      { id: "a3-chaos-pick-mods", required: true, text: "Chọn mod dễ chịu; tránh lightning runes nếu Lightning Res thấp" },
      { id: "a3-chaos-soul-core-tip", tip: true, text: "Soul Core skip: dodge roll giữa slam và animation xoay để duplicate core vào mọi socket.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-chaos-complete", required: true, text: "Hoàn thành Trial -> lấy <strong>2nd Ascendancy</strong>", badges: [{ text: "Ascendancy", tone: "green" }] }
    ]
  },
  {
    id: "act3-jiquani-machinarium",
    act: "act3",
    title: "Jiquani's Machinarium",
    level: "Lvl 33",
    tasks: [
      { id: "a3-machinarium-layout", tip: true, text: "Layout dạng chữ U vuông, generators ở hai đầu đối diện.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-machinarium-alva", required: true, text: "Gọi/nói chuyện với <strong>Alva</strong>" },
      { id: "a3-machinarium-small-core", required: true, text: "Nhặt <strong>Small Soul Core</strong> -> dùng trên Stone Altar cạnh Alva" },
      { id: "a3-machinarium-three-cores", required: true, text: "Nhặt 3 <strong>Small Soul Cores</strong> để mở cửa" },
      { id: "a3-machinarium-blackjaw", required: true, text: "Mở cửa -> giết <strong>Blackjaw</strong> -> dùng <strong>Flame Core</strong>", badges: [{ text: "+10% Fire Res", tone: "green" }] },
      { id: "a3-machinarium-enter-sanctum", required: true, text: "Mở cửa khác -> vào <strong>Jiquani's Sanctum</strong>" }
    ]
  },
  {
    id: "act3-jiquani-sanctum",
    act: "act3",
    title: "Jiquani's Sanctum",
    level: "Lvl 33-34",
    tasks: [
      { id: "a3-sanctum-alva", required: true, text: "Gọi/nói chuyện với <strong>Alva</strong>" },
      { id: "a3-sanctum-medium-cores", required: true, text: "Nhặt 2 <strong>Medium Soul Cores</strong>, đặt vào Generators" },
      { id: "a3-sanctum-zicoatly", required: true, text: "Quay lại đầu zone -> bấm <strong>Large Soul Core</strong> -> giết <strong>Zicoatly</strong> -> nhặt core" },
      { id: "a3-sanctum-tp-barrens", required: true, text: "TP tới <strong>Infested Barrens</strong>" }
    ]
  },
  {
    id: "act3-infested-barrens-return",
    act: "act3",
    title: "Infested Barrens (Return)",
    tasks: [
      { id: "a3-barrens-use-large-core", required: true, text: "Dùng core trên <strong>Stone Altar</strong> cạnh waypoint" },
      { id: "a3-sanctum-enter-matlan", required: true, text: "Vào <strong>The Matlan Waterways</strong>" }
    ]
  },
  {
    id: "act3-matlan-waterways",
    act: "act3",
    title: "The Matlan Waterways",
    level: "Lvl 35",
    tasks: [
      { id: "a3-matlan-hut", text: "<em>(Opt)</em> Hut -> giết rare", badges: [{ text: "Random loot", tone: "blue" }] },
      { id: "a3-matlan-levers", required: true, text: "Kéo các levers trong zone (6-8 tùy layout)" },
      { id: "a3-matlan-big-canal-lever", required: true, text: "Kéo <strong>Big Canal Lever</strong> ở cuối zone" },
      { id: "a3-matlan-portal-skip", tip: true, text: "Portal-skip: mở portal trước khi bấm lever cuối, spam-click để khỏi mở map và thoát nhanh hơn.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-matlan-tp-town", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act3-ziggurat-after-matlan",
    act: "act3",
    title: "Ziggurat Encampment",
    tasks: [
      { id: "a3-matlan-talk-alva", required: true, text: "Xuống dưới -> nói <strong>Alva</strong>" },
      { id: "a3-matlan-enter-drowned", required: true, text: "Vào <strong>The Drowned City</strong> bằng lối dưới" }
    ]
  },
  {
    id: "act3-drowned-city",
    act: "act3",
    title: "The Drowned City",
    level: "Lvl 35-36",
    tasks: [
      { id: "a3-drowned-apex-wp", required: true, text: "Tìm <strong>Apex of Filth</strong>, lấy waypoint rồi quay lại" },
      { id: "a3-drowned-molten-wp", required: true, text: "Tìm <strong>The Molten Vault</strong>, lấy waypoint rồi quay lại" },
      { id: "a3-drowned-tp-azak", required: true, text: "TP tới <strong>Azak Bog</strong>" }
    ]
  },
  {
    id: "act3-azak-bog",
    act: "act3",
    title: "Azak Bog",
    level: "Lvl 33-34",
    meta: "Waypoint",
    tasks: [
      { id: "a3-azak-summon-servi", required: true, text: "Gọi/nói chuyện với <strong>Servi</strong>" },
      { id: "a3-azak-flameskin", text: "<em>(Opt)</em> Flameskin rituals", badges: [{ text: "Fire Res + Rarity buff", tone: "blue" }] },
      { id: "a3-azak-ignagduk-layout-tip", tip: true, text: "Boss arena luôn ở góc trên phải; có thể reset farm magic packs quanh fire shrine để lấy XP.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-azak-ignagduk", required: true, text: "Giết <strong>Ignagduk, the Bog Witch</strong> -> dùng <strong>Gemrot Skull</strong>", badges: [{ text: "+30 Spirit", tone: "green" }, { text: "boss", tone: "red" }] },
      { id: "a3-azak-talk-servi", required: true, text: "Nói <strong>Servi</strong> trong town để lấy <strong>Frozen Charm</strong>" },
      { id: "a3-azak-tp-molten", required: true, text: "TP tới <strong>Molten Vault</strong> nếu là character đầu tiên; alt có thể về town" }
    ]
  },
  {
    id: "act3-molten-vault",
    act: "act3",
    title: "The Molten Vault",
    level: "Lvl 36",
    meta: "Waypoint",
    tasks: [
      { id: "a3-molten-mektul", required: true, text: "<em>(1st char)</em> Giết <strong>Mektul, the Forgemaster</strong>", badges: [{ text: "Reforging Bench", tone: "green" }, { text: "boss", tone: "red" }] },
      { id: "a3-molten-mektul-tip", tip: true, text: "Trả <strong>Hammer of Kamasa</strong> cho Oswald ở town để mở bench; alt character có thể skip.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-molten-tp-town", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act3-ziggurat-after-molten",
    act: "act3",
    title: "Ziggurat Encampment",
    tasks: [
      { id: "a3-molten-talk-oswald", required: true, text: "Nói chuyện với <strong>Oswald</strong>" },
      { id: "a3-molten-tp-apex", required: true, text: "TP tới <strong>Apex of Filth</strong>" }
    ]
  },
  {
    id: "act3-apex-temple",
    act: "act3",
    title: "Apex of Filth",
    level: "Lvl 36-37",
    meta: "Waypoint",
    tasks: [
      { id: "a3-apex-mushrooms", text: "<em>(Opt)</em> Tìm 3 <strong>Mushrooms</strong> -> dùng Cauldron", badges: [{ text: "Superior Flasks", tone: "blue" }] },
      { id: "a3-apex-mushrooms-tip", tip: true, text: "Đi qua bottleneck có checkpoint rồi kiểm tra các góc khuất phía sau.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-apex-queen", required: true, text: "Giết <strong>Queen of Filth</strong> -> nhặt <strong>Temple Door Idol</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "a3-apex-queen-tip", tip: true, text: "Đứng gần boss; đi xa có thể kích hoạt ultimate rolling slam.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-apex-tp-town", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act3-ziggurat-after-apex",
    act: "act3",
    title: "Ziggurat Encampment",
    tasks: [
      { id: "a3-apex-talk-alva", required: true, text: "Xuống dưới -> nói <strong>Alva</strong>" },
      { id: "a3-apex-enter-temple", required: true, text: "Đi cửa sau lưng Alva -> vào <strong>Temple of Kopec</strong>" }
    ]
  },
  {
    id: "act3-temple-kopec",
    act: "act3",
    title: "Temple of Kopec",
    level: "Lvl 37",
    tasks: [
      { id: "a3-temple-layout", tip: true, text: "Mỗi tầng là tam giác; góc xa có 50% chance đúng, nên kiểm tra trước.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-temple-ketzuli", required: true, text: "Giết <strong>Ketzuli, High Priest of the Sun</strong> ở tầng trên", badges: [{ text: "boss", tone: "red" }] },
      { id: "a3-temple-talk-alva", required: true, text: "Nói <strong>Alva</strong>, chờ lore" }
    ]
  },
  {
    id: "act3-ziggurat-after-temple",
    act: "act3",
    title: "Ziggurat Encampment",
    tasks: [
      { id: "a3-temple-gateway", required: true, text: "Đi qua <strong>Gateway</strong>" },
      { id: "a3-temple-enter-utzaal", required: true, text: "Xuống dưới -> vào <strong>Utzaal</strong>" }
    ]
  },
  {
    id: "act3-utzaal-aggorat",
    act: "act3",
    title: "Utzaal",
    level: "Lvl 38-39",
    tasks: [
      { id: "a3-utzaal-road", tip: true, text: "Layout giống Drowned City; đi theo đường lát đá sẽ dẫn tới Viper.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-utzaal-sac-heart", text: "<em>(Opt)</em> Farm <strong>Sacrificial Heart</strong> từ Vaal Goliaths có canister trên vai" },
      { id: "a3-utzaal-sac-heart-tip", tip: true, text: "Có thể drop trong Aggorat; chỉ đúng monster type có canister trên vai mới drop.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-utzaal-idols", text: "<em>(Opt)</em> Vào các cửa phụ để lấy idols, bán cho Oswald lấy gold" },
      { id: "a3-utzaal-viper", required: true, text: "Giết <strong>Viper Napuatzi</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "a3-utzaal-viper-tip", tip: true, text: "Boss rất cơ động; nhử attack cycle đầu từ vị trí ổn định để dễ đoán hướng.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-utzaal-enter-aggorat", required: true, text: "Vào <strong>Aggorat</strong>" }
    ]
  },
  {
    id: "act3-aggorat",
    act: "act3",
    title: "Aggorat",
    level: "Lvl 39-40",
    tasks: [
      { id: "a3-aggorat-town-crier", tip: true, text: "Tiếng hô của Town crier chỉ đúng hướng; mép pyramid là phía boss.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-aggorat-sac-altar", required: true, text: "Tìm <strong>Sacrificial Altar</strong> ở góc trên phải map" },
      { id: "a3-aggorat-stab-heart", required: true, text: "Đặt <strong>Sacrificial Heart</strong> -> đâm bằng Dagger", badges: [{ text: "+2 Skill Points", tone: "green" }] },
      { id: "a3-aggorat-league", text: "<em>(Opt)</em> Cơ chế league với <strong>Crag Tooth</strong>", badges: [{ text: "Vaal Orb", tone: "blue" }] },
      { id: "a3-aggorat-enter-black", required: true, text: "Vào <strong>The Black Chambers</strong> ở góc trên trái map" }
    ]
  },
  {
    id: "act3-black-chambers",
    act: "act3",
    title: "The Black Chambers",
    level: "Lvl 40-42",
    tasks: [
      { id: "a3-black-doryani", required: true, text: "Giết <strong>Doryani, the Blood Alchemist</strong>", badges: [{ text: "Act boss", tone: "red" }] },
      { id: "a3-black-doryani-tip", tip: true, text: "Phase 2 Doryani's Triumph: khi boss rage, bật fortifying buff trước khi lao vào.", badges: [{ text: "tip", tone: "amber" }] },
      { id: "a3-black-wait-loot", required: true, text: "Chờ loot rơi khoảng 30s" },
      { id: "a3-black-tp-town", required: true, text: "TP back về town" }
    ]
  },
  {
    id: "act3-end-ziggurat",
    act: "act3",
    title: "Ziggurat Encampment (End of Act)",
    tasks: [
      { id: "a3-black-talk-doryani", required: true, text: "Nói <strong>Doryani</strong>" },
      { id: "a3-black-end-sequence", required: true, text: "Nói <strong>Doryani</strong> lần nữa -> <strong>Alva</strong> -> <strong>Hooded One</strong> -> <strong>Alva</strong>" },
      { id: "a3-complete-note", tip: true, text: "Act III complete -> sang Act IV (Karui Archipelago).", badges: [{ text: "complete", tone: "green" }] }
    ]
  },

  {
    id: "act4-kingsmarch",
    act: "act4",
    title: "Kingsmarch",
    level: "Lvl 42",
    meta: "Hub town",
    tasks: [
      { id: "a4-kingsmarch-talk-doryani", required: true, text: "Nói <strong>Doryani</strong>", badges: [{ text: "Act 4", tone: "violet" }] },
      { id: "a4-kingsmarch-talk-alva", required: true, text: "Đi tiếp vào town, nói <strong>Alva</strong> với <strong>Rog</strong>" },
      { id: "a4-kingsmarch-talk-rog", required: true, text: "Nói <strong>Rog</strong> trong nhà để lấy boat charter" },
      { id: "a4-kingsmarch-talk-makoru", required: true, text: "Nói <strong>Makoru</strong> trên ship, chọn destination" }
    ]
  },
  {
    id: "act4-whakapanu-singing",
    act: "act4",
    title: "Whakapanu Island",
    level: "Lvl 42-43",
    meta: "Frag / Matiki? / Map",
    tasks: [
      { id: "a4-whakapanu-petrified-pirate", text: "<em>(Opt)</em> Petrified Pirate trên coast", badges: [{ text: "Torn Map 2/4", tone: "blue" }] },
      { id: "a4-whakapanu-shark-pit", text: "<em>(Opt)</em> Shark Pit: <strong>Great White One</strong>", badges: [{ text: "Shark Fin", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a4-whakapanu-crabshell", text: "<em>(Opt)</em> Crabshell Cavern: <strong>Clawcrunch</strong>", badges: [{ text: "Support Gem 4", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a4-whakapanu-enter-singing", required: true, text: "Vào <strong>Singing Caverns</strong>" }
    ]
  },
  {
    id: "act4-singing-caverns",
    act: "act4",
    title: "Singing Caverns",
    meta: "Waypoint",
    tasks: [
      { id: "a4-singing-beckoning-clam", text: "<em>(Opt)</em> Beckoning Clam -> <strong>Humming Pearl</strong> cho Rog" },
      { id: "a4-singing-diamora", required: true, text: "Giết <strong>Diamora, Song of Death</strong>", badges: [{ text: "Fragment?", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a4-singing-hooded-tp", required: true, text: "Nói <strong>Hooded One</strong>, TP về town" }
    ]
  },
  {
    id: "act4-hideout",
    act: "act4",
    title: "Kingsmarch - Hideout",
    tasks: [
      { id: "a4-hideout-ange", required: true, text: "Nói <strong>Ange</strong> -> <strong>Shoreline Hideout</strong>" },
      { id: "a4-hideout-clear", required: true, text: "Dọn hideout, nói <strong>Ange</strong>", badges: [{ text: "Hideout + Trading", tone: "green" }] }
    ]
  },
  {
    id: "act4-shrike-prison",
    act: "act4",
    title: "Shrike Island",
    level: "Lvl 43-44",
    meta: "Frag / Matiki? / Map",
    tasks: [
      { id: "a4-shrike-corpse-nest", text: "<em>(Opt)</em> Corpse Nest / Impaled Karui", badges: [{ text: "Torn Map 4/4", tone: "blue" }] },
      { id: "a4-shrike-scourge", required: true, text: "Giết <strong>Scourge of the Skies</strong>", badges: [{ text: "Fragment?", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a4-shrike-hooded-sail", required: true, text: "Nói <strong>Hooded One</strong>, TP, sail next" }
    ]
  },
  {
    id: "act4-abandoned-prison",
    act: "act4",
    title: "Abandoned Prison",
    level: "Lvl 44",
    meta: "Frag / Matiki? / Waypoint",
    tasks: [
      { id: "a4-prison-chapel-key", required: true, text: "Giết mobs tới khi rơi <strong>Chapel Key</strong>" },
      { id: "a4-prison-forael", required: true, text: "Mở Chapel, giết <strong>Forael</strong>, dùng <strong>Goddess of Justice</strong>", badges: [{ text: "flask choice", tone: "green" }, { text: "boss", tone: "red" }] },
      { id: "a4-prison-enter-solitary", required: true, text: "Vào <strong>Solitary Confinement</strong>" }
    ]
  },
  {
    id: "act4-solitary-confinement",
    act: "act4",
    title: "Solitary Confinement",
    tasks: [
      { id: "a4-solitary-prisoner", required: true, text: "Giết <strong>The Prisoner</strong>", badges: [{ text: "Fragment?", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a4-solitary-sail-kin", required: true, text: "Nói <strong>Hooded One</strong>, sail tới <strong>Isle of Kin</strong>" }
    ]
  },
  {
    id: "act4-isle-of-kin",
    act: "act4",
    title: "Isle of Kin",
    level: "Lvl 45",
    meta: "Matiki? / Map",
    tasks: [
      { id: "a4-kin-flayed-sailor", text: "<em>(Opt)</em> Flayed Sailor gần shore", badges: [{ text: "Torn Map 3/4", tone: "blue" }] },
      { id: "a4-kin-beast-pen", text: "<em>(Opt)</em> Beast Pen", badges: [{ text: "Skill + Support Gem", tone: "blue" }] },
      { id: "a4-kin-mimok", required: true, text: "Giết <strong>Mimok the Enslaved</strong>", badges: [{ text: "Tier 4 Support Gem", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a4-kin-blind-beast", text: "<em>(Opt)</em> Primal Arena: <strong>Blind Beast</strong>", badges: [{ text: "Greater Blank Rune", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a4-kin-enter-volcanic", required: true, text: "Vào <strong>Volcanic Warrens</strong>" }
    ]
  },
  {
    id: "act4-volcanic-hinekora",
    act: "act4",
    title: "Volcanic Warrens",
    level: "Lvl 45-46",
    meta: "Waypoint",
    tasks: [
      { id: "a4-volcanic-magma-twins", text: "<em>(Opt)</em> Volcanic Nest: <strong>Magma Twins</strong> - giết Lightning trước", badges: [{ text: "Ruby Ring", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a4-volcanic-magma-twins-alt", text: "<em>(Alt)</em> Magma Twins - giết Fire trước", badges: [{ text: "Topaz Ring", tone: "blue" }] },
      { id: "a4-volcanic-krutog", required: true, text: "Giết <strong>Krutog, Lord of Kin</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "a4-volcanic-free-matiki", required: true, text: "Bấm lồng, giải cứu <strong>Matiki</strong>" },
      { id: "a4-volcanic-tp-kingsmarch", required: true, text: "TP tới <strong>Kingsmarch</strong>" }
    ]
  },
  {
    id: "act4-eye-hinekora",
    act: "act4",
    title: "Eye of Hinekora",
    level: "Lvl 46-47",
    meta: "Waypoint",
    tasks: [
      { id: "a4-hinekora-matiki-well", required: true, text: "Nói <strong>Matiki</strong> trong town, bấm well" },
      { id: "a4-hinekora-waterfall", text: "<em>(Opt)</em> Chest sau waterfall", badges: [{ text: "Skill Gem 12 + Spirit Gem 12", tone: "blue" }] },
      { id: "a4-hinekora-tests", required: true, text: "Hoàn thành 3 Tests: Fire, Nature, Cold" },
      { id: "a4-hinekora-navali", required: true, text: "<strong>Silent Hall</strong> altar / Pay Respects, nói <strong>Navali</strong>", badges: [{ text: "+5% Max Mana", tone: "green" }] },
      { id: "a4-hinekora-enter-halls", required: true, text: "Vào <strong>Halls of the Dead</strong>" }
    ]
  },
  {
    id: "act4-halls-ancestors",
    act: "act4",
    title: "Halls of the Dead",
    level: "Lvl 47",
    tasks: [
      { id: "a4-halls-ngakanu-trial", required: true, text: "Trial of Ngakanu: hoàn thành 3 tests dạng clover-leaf, nhặt <strong>Blank Tattoos</strong>", badges: [{ text: "Blank Tattoos", tone: "blue" }] },
      { id: "a4-halls-yama", required: true, text: "Đánh <strong>Yama the White</strong> (ít máu, dễ stun)", badges: [{ text: "boss", tone: "red" }] },
      { id: "a4-halls-enter-ancestors", required: true, text: "Vào <strong>Trial of the Ancestors</strong>" }
    ]
  },
  {
    id: "act4-trial-ancestors",
    act: "act4",
    title: "Trial of the Ancestors",
    level: "Lvl 47-48",
    tasks: [
      { id: "a4-ancestors-hinekora", required: true, text: "Nói <strong>Hinekora</strong>", badges: [{ text: "+2 Skill Points", tone: "green" }] },
      { id: "a4-ancestors-tattoo", required: true, text: "Chọn tattoo: +5% Fire/Cold/Lightning Res khuyến nghị, hoặc +5 Str/Dex/Int nếu thiếu stat", badges: [{ text: "+1 Tattoo Slot", tone: "green" }] },
      { id: "a4-ancestors-sail-kedge", required: true, text: "TP, sail tới <strong>Kedge Bay</strong>" }
    ]
  },
  {
    id: "act4-kedge-journey",
    act: "act4",
    title: "Kedge Bay",
    level: "Lvl 47-48",
    meta: "Map / Waypoint",
    tasks: [
      { id: "a4-kedge-map", text: "<em>(Opt)</em> Dead Man's Chest / Smuggler's Stash", badges: [{ text: "Torn Map 1/4", tone: "blue" }] },
      { id: "a4-kedge-enter-journey", required: true, text: "Vào <strong>Journey's End</strong>" }
    ]
  },
  {
    id: "act4-journeys-end",
    act: "act4",
    title: "Journey's End",
    level: "Lvl 48-49",
    meta: "Waypoint",
    tasks: [
      { id: "a4-journey-talk-tujen", required: true, text: "Nói <strong>Tujen</strong>" },
      { id: "a4-journey-harlin", required: true, text: "Giết <strong>Captain Harlin</strong>, nhặt <strong>Verisium</strong>", badges: [{ text: "Verisium", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "a4-journey-freya-start", required: true, text: "TP start, nói <strong>Freya Hartlin</strong>" },
      { id: "a4-journey-dannig-spikes", required: true, text: "Town -> <strong>Dannig</strong> -> lấy <strong>Verisium Spikes</strong>", badges: [{ text: "Verisium Spikes", tone: "blue" }] },
      { id: "a4-journey-back-freya", required: true, text: "Quay lại <strong>Journey's End</strong> -> nói <strong>Freya</strong>" },
      { id: "a4-journey-omniphobia", required: true, text: "Totem -> giết <strong>Omniphobia</strong>", badges: [{ text: "+2 Skill Points", tone: "green" }, { text: "NEW 0.4", tone: "violet" }, { text: "boss", tone: "red" }] },
      { id: "a4-journey-tujen-reward", required: true, text: "Nói <strong>Tujen</strong> trong town để nhận reward" }
    ]
  },
  {
    id: "act4-plunders-point",
    act: "act4",
    title: "Plunder's Point (Optional)",
    tasks: [
      { id: "a4-plunders-point", text: "<em>(Opt)</em> Đưa đủ 4 maps cho <strong>Makoru</strong> -> sail -> <strong>Dannig</strong> -> Expedition", badges: [{ text: "Expedition", tone: "blue" }] }
    ]
  },
  {
    id: "act4-arastas-excavation",
    act: "act4",
    title: "Arastas",
    level: "Lvl 49-50",
    meta: "Waypoint",
    tasks: [
      { id: "a4-arastas-lorandis", required: true, text: "<strong>Missionari Lorandis</strong> -> follow -> destroy shield" },
      { id: "a4-arastas-bells", text: "<em>(Opt)</em> Evening/Morning Bells", badges: [{ text: "3 Regal mỗi cái", tone: "blue" }] },
      { id: "a4-arastas-torvian", required: true, text: "Giết <strong>Torvian</strong> -> vào <strong>The Excavation</strong>", badges: [{ text: "boss", tone: "red" }] }
    ]
  },
  {
    id: "act4-excavation",
    act: "act4",
    title: "The Excavation",
    level: "Lvl 50-51",
    tasks: [
      { id: "a4-excavation-benedictus", required: true, text: "Giết <strong>Benedictus</strong>, nói <strong>Hooded One</strong>", badges: [{ text: "boss", tone: "red" }] },
      { id: "a4-excavation-sail-ngakanu", required: true, text: "Sail tới <strong>Ngakanu</strong>" }
    ]
  },
  {
    id: "act4-ngakanu-finale",
    act: "act4",
    title: "Ngakanu -> Heart of the Tribe",
    level: "Lvl 51",
    tasks: [
      { id: "a4-ngakanu-heart", required: true, text: "Đi qua maze tới <strong>Heart of the Tribe</strong>" },
      { id: "a4-ngakanu-tavaki", required: true, text: "Giết <strong>Tavaki</strong>, nói chuyện với hắn", badges: [{ text: "boss", tone: "red" }] },
      { id: "a4-ngakanu-rhodri-final", required: true, text: "TP town -> <strong>Rhodri</strong> -> sail tới final" }
    ]
  },
  {
    id: "act4-finale",
    act: "act4",
    title: "Act 4 Finale",
    level: "Lvl 52",
    tasks: [
      { id: "a4-finale-zarokh", required: true, text: "Giết <strong>Zarokh</strong>", badges: [{ text: "Final Act 4 Boss", tone: "red" }] },
      { id: "a4-finale-hooded-one", required: true, text: "Quay lại, nói <strong>Hooded One</strong> -> unlock Interludes", badges: [{ text: "Mở Interludes", tone: "violet" }] }
    ]
  },

  {
    id: "interlude-5-1-ogham",
    act: "interlude",
    title: "5.1 Ogham, The Refuge",
    level: "Lvl 52-53",
    tasks: [
      { id: "interlude-51-holten", required: true, text: "Đi tới <strong>Holten</strong> ở khu docks của town, nói <strong>The Hooded One</strong>", badges: [{ text: "5.1", tone: "violet" }] },
      { id: "interlude-51-ferryman", text: "<em>(Opt)</em> Ghé <strong>Soul of the Ferryman</strong> ở docks", badges: [{ text: "Greater Runes ~2000g", tone: "blue" }] },
      { id: "interlude-51-wolvenhold", required: true, text: "Đi qua <strong>Wolvenhold</strong> sau Holten" },
      { id: "interlude-51-oswin", required: true, text: "Giết <strong>Oswin, the Dread Warden</strong>", badges: [{ text: "+2 Skill Points", tone: "green" }, { text: "boss", tone: "red" }] },
      { id: "interlude-51-return", required: true, text: "Hoàn thành Interlude 5.1, quay về town để mở interlude tiếp theo" }
    ]
  },
  {
    id: "interlude-5-2-khari",
    act: "interlude",
    title: "5.2 Khari Bazaar",
    level: "Lvl 54-55",
    tasks: [
      { id: "interlude-52-khari-crossing", required: true, text: "Đi tới <strong>Khari Crossing</strong> qua Hooded One", badges: [{ text: "5.2", tone: "violet" }] },
      { id: "interlude-52-akthi-anundr", required: true, text: "Giết <strong>Akthi & Anundr</strong> (Worm + Scorpion), nói <strong>Risu</strong> sau fight", badges: [{ text: "+2 Skill Points", tone: "green" }, { text: "boss", tone: "red" }] },
      { id: "interlude-52-torbek", text: "<em>(Opt)</em> <strong>Torbek</strong> ở Khari Crossing", badges: [{ text: "Discount rare caster weapons", tone: "blue" }] },
      { id: "interlude-52-skullmaw", required: true, text: "Vào <strong>Skullmaw Stairway</strong> qua Khari Crossing" },
      { id: "interlude-52-molten-gift", required: true, text: "Kích hoạt <strong>Molten One's Gift</strong> -> tìm seals, reset instance nếu bug", badges: [{ text: "+5% Maximum Life", tone: "green" }] },
      { id: "interlude-52-qimah", required: true, text: "Đi tới <strong>Qimah</strong>" },
      { id: "interlude-52-orbala", required: true, text: "Dùng <strong>Orbala's Pillar</strong> -> chọn 1 trong 7 Boons, có thể đổi bất cứ lúc nào", badges: [{ text: "Boon vĩnh viễn", tone: "green" }] },
      { id: "interlude-52-reservoir", text: "<em>(Opt)</em> <strong>Qimah Reservoir Sacred Wells</strong>", badges: [{ text: "Exalt/Alchemy via Vials", tone: "blue" }] },
      { id: "interlude-52-sanctuary", required: true, text: "Vào <strong>Sel Khari Sanctuary</strong>" },
      { id: "interlude-52-baryas", required: true, text: "Đặt <strong>Baryas of Rageen & Yoon</strong> lên pedestals", badges: [{ text: "Rare Ring/Amulet/Jewel", tone: "blue" }] },
      { id: "interlude-52-return", required: true, text: "Hoàn thành Interlude 5.2, quay về town" }
    ]
  },
  {
    id: "interlude-5-3-mount-kriar",
    act: "interlude",
    title: "5.3 Mount Kriar, The Glade",
    level: "Lvl 55-58",
    tasks: [
      { id: "interlude-53-travel", required: true, text: "Đi tới <strong>Mount Kriar</strong> qua Hooded One", badges: [{ text: "5.3", tone: "violet" }] },
      { id: "interlude-53-ashen-forest", required: true, text: "Vào <strong>Ashen Forest</strong>" },
      { id: "interlude-53-monument", required: true, text: "Tìm <strong>Ancient Monument</strong> trong Ashen Forest", badges: [{ text: "Skill Gem Lv14", tone: "blue" }] },
      { id: "interlude-53-kriar-village", required: true, text: "Đi tới <strong>Kriar Village</strong>" },
      { id: "interlude-53-lythara", required: true, text: "Giết <strong>Lythara, the Wayward Spear</strong>", badges: [{ text: "+40 Spirit", tone: "green" }, { text: "Spirit Gem Lv14 + Gemcrust Skull", tone: "blue" }, { text: "boss", tone: "red" }] },
      { id: "interlude-53-howling-caves", required: true, text: "Đi tới <strong>Glacial Tarn</strong> -> vào <strong>Howling Caves</strong>" },
      { id: "interlude-53-yeti", required: true, text: "Giết <strong>The Abominable Yeti</strong>, nhặt <strong>Icy Tusks</strong>", badges: [{ text: "+2 Skill Points", tone: "green" }, { text: "boss", tone: "red" }] },
      { id: "interlude-53-peaks", required: true, text: "Đi tới <strong>Kriar Peaks</strong>" },
      { id: "interlude-53-madox", required: true, text: "Tìm <strong>Elder Madox</strong> ở hướng 10-11 giờ", badges: [{ text: "Free Unique Item", tone: "green" }] },
      { id: "interlude-53-doriani", text: "<em>(Opt)</em> Đi thật xa về bên phải tới <strong>Doriani's Contingency</strong>", badges: [{ text: "Titan Rock Catafract", tone: "blue" }] }
    ]
  },
  {
    id: "interlude-completion",
    act: "interlude",
    title: "Completion +2 SP Final",
    tasks: [
      { id: "interlude-complete-hooded-one", required: true, text: "Sau khi xong cả 3 Interludes, nói <strong>The Hooded One</strong>", badges: [{ text: "+2 Skill Points", tone: "green" }] }
    ]
  },
  {
    id: "interlude-maps",
    act: "interlude",
    title: "Maps / Endgame",
    level: "Lvl 58-60",
    tasks: [
      { id: "interlude-map-unlock", required: true, text: "Mở <strong>Endgame Atlas / Maps</strong>", badges: [{ text: "Endgame begins", tone: "violet" }] }
    ]
  }
];

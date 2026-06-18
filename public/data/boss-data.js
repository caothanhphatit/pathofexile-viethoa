window.POE2_BOSS_DETAILS = {
  "zarokh-the-temporal": {
    name: "Zarokh, the Temporal",
    group: "Trial of the Sekhemas",
    location: "Trial of the Sekhemas (Floor 4)",
    vi: {
      overview: "Zarokh, the Temporal là boss cuối cùng của Trial of the Sekhemas, nằm trên tầng thứ tư của khu vực này. Bạn cần ít nhất Area Level 75 để tiếp cận cuộc gặp gỡ này. Đây là một cuộc chiến cuối cùng đòi hỏi sự chuẩn bị kỹ lưỡng và kỹ năng né tránh cao.",
      mechanics: [
        "Time Stop Phase: Khi máu boss dưới 60%, hourglasses sẽ xuất hiện xung quanh đấu trường và phải thu thập chúng trước khi hết thời gian, nếu không sẽ chết ngay lập tức",
        "Lightning Phase: Boss đứng ở giữa đấu trường và thiết lập các trap đóng băng bạn trong thời gian, sau đó phóng Sweeping Lightning Bolts theo hướng ngược chiều kim đồng hồ",
        "Backtrack Explosion: Tạo ra một cái trap lớn với Clock Hand, teleport người chơi về giữa và gây sát thương lớn",
        "Temporal Balls: Những quả projectile chuyển động chậm",
        "Pillar Projectiles: Những projectile dạng cột",
        "Bubble Projectiles: Những projectile dạng bong bóng",
        "Boomerang Projectiles: Những projectile quay lại"
      ],
      phases: [
        { name: "Phase 1 (100% - 60% Health)", vi: "Boss sử dụng các cuộc tấn công cơ bản bao gồm Lightning Phase, Temporal Balls, Pillar Projectiles, Bubble Projectiles, và Boomerang Projectiles. Tập trung né tránh các projectile và duy trì vị trí an toàn." },
        { name: "Phase 2 (Below 60% Health)", vi: "Kích hoạt Time Stop Phase, đòi hỏi bạn thu thập hourglasses nhanh chóng. Đây là giai đoạn nguy hiểm nhất vì không hoàn thành sẽ chết ngay." }
      ],
      strategy: "Chuẩn bị Movement Speed cao hoặc có một Movement Skill là rất cần thiết để sống sót qua Time Stop Phase. Khi boss phóng Lightning Attacks, hãy đứng ở một trong các góc của đấu trường để tránh sát thương. Sử dụng các skill như Attrition và Alchemist's Boon để kéo dài trận chiến. Luôn luôn chú ý đến vị trí của hourglasses trong Phase 2 và di chuyển nhanh chóng để thu thập chúng trước khi hết giờ.",
      rewards: [
        "Fourth set of Ascendancy Points",
        "Exclusive unique relics",
        "The Last Flame (rarest drop)",
        "Temporalis unique body armor"
      ],
      tips: [
        "Trang bị Movement Speed cao để có thể chạy nhanh đủ để thu thập hourglasses",
        "Sẵn sàng các skill di chuyển nhanh để thoát khỏi vị trí nguy hiểm",
        "Luôn chuẩn bị defenses mạnh trước khi chiến với Zarokh",
        "Trong Phase 2, ưu tiên thu thập hourglasses hơn là tấn công boss",
        "Đứng ở các góc đấu trường để tránh Sweeping Lightning Bolts"
      ]
    }
  },
  "the-trialmaster": {
    name: "The Trialmaster",
    group: "Trial of Chaos",
    location: "Trial of Chaos",
    vi: {
      overview: "The Trialmaster là boss cuối cùng của Trial of Chaos, một cuộc thi thách thức yêu cầu người chơi hoàn thành 10 thử thách và thu thập ba mục Fate đặc biệt (Deadly Fate, Cowardly Fate, Victorious Fate) bằng cách đánh bại các boss ở mỗi vòng. Để truy cập được cuộc gặp này, bạn phải là cấp độ 75 trở lên và kéo các mục Fate tới cửa để mở khóa trận chiến với The Trialmaster.",
      mechanics: [
        "Entropy! or Ultimatum! - Time Stop Sunder: Thời gian dừng lại khi boss nhảy mạnh xuống ba lần tạo ra những gai nhọn; bạn phải ghi nhớ vị trí ban đầu và chạy tránh đến vùng an toàn.",
        "Sunder - Cú đánh cơ bản tạo ra các gai nhọn trên toàn bộ sân đấu; tránh bằng cách đứng sang hai bên hoặc phía sau boss.",
        "Shred - Chuỗi bốn cú đánh nhanh phát ra các viên đạn máu, với cú thứ tư nhanh hơn các cú trước.",
        "Be obliterated! - Cuộc tấn công AoE có điện tích lớn với thời gian kích hoạt đủ lâu để bạn thoát ra.",
        "Chaos aid me! - Ném spear tạo ra các xung dãn ngoài theo chu kỳ, chuyển sang pha tấn công từ xa.",
        "Ultimatum! - Time Stop Projectiles: Boss dịch chuyển tức thời và phóng các viên đạn theo nhiều hướng; bạn cần theo dõi quỹ đạo của chúng.",
        "Be still! - Heart Tethers: Boss triệu hồi những trái tim kết nối người chơi, gây choáng nếu bạn di chuyển vượt quá phạm vi cho phép trước khi chúng phát nổ.",
        "Farcical! - Ba viên đạn nguyên tố được phóng ra thường xuyên.",
        "Embrace Chaos! - Các viên đạn đỏ phát sinh khi chạm vào tường và quay trở lại điểm xuất phát."
      ],
      phases: [
        { name: "Melee Phase (Spear)", vi: "Pha đầu tiên nơi boss cầm spear và tấn công gần với các cú đánh mạnh như Sunder, Shred, và các cuộc tấn công AoE được sạc điện. Trong pha này, hãy tập trung vào việc định vị gần cạnh sân đấu để có thêm không gian di chuyển khi boss ném spear." },
        { name: "Ranged Phase (No-Spear)", vi: "Sau khi ném spear, boss chuyển sang pha tấn công từ xa nơi anh ta sử dụng thời gian dừng để phóng các viên đạn, triệu hồi những trái tim kết nối, và phóng các viên đạn nguyên tố nhân đôi. Pha này đòi hỏi sự chính xác cao trong việc theo dõi quỹ đạo đạn và quản lý tốc độ di chuyển." }
      ],
      strategy: "Để chiến thắng The Trialmaster, bạn cần chuẩn bị kỹ lưỡng với máu cao, cối cân bằng các kháng cự, và các lớp phòng thủ bổ sung (Armor, Evasion, hoặc Energy Shield); một Stone Charm cung cấp Stun Immunity. Đại lượng thiệt hại rất quan trọng vì boss có khoảng 10 triệu máu, nên hãy xem xét các vật phẩm xuyên thủng giáp hoặc giảm kháng cự của kẻ thù. Trong pha melee, hãy đứng gần cạnh sân đấu trước khi boss ném spear để buộc nó phải ném từ vị trí đó, tối đa hóa không gian di chuyển của bạn. Trong pha ranged, theo dõi cẩn thận quỹ đạo của các viên đạn chậm di chuyển có thể tách ra và phản lại khi chạm vào tường.",
      rewards: [
        "Mahuxotl's Machination (Omen Crest Shield)",
        "Zerphi's Genesis (Heavy Belt)",
        "Hateforge (Moulded Mitts)",
        "Glimpse of Chaos (Tribal Mask)",
        "The Adorned (Diamond)",
        "Ascendancy Points (the last set on first clear)"
      ],
      tips: [
        "Hãy nhớ vị trí ban đầu của các gai nhọn trong pha Time Stop Sunder để có thể chạy tránh hiệu quả.",
        "Sử dụng Stone Charm để miễn dịch choáng, giúp bạn vượt qua các cuộc tấn công Heart Tethers dễ dàng hơn.",
        "Các viên đạn từ Embrace Chaos! sẽ nhân đôi khi chạm tường - dự đoán đường đi của chúng và chạy tránh trước khi chúng quay trở lại.",
        "Đảm bảo rằng thiệt hại của bạn đủ cao để đánh bại boss trước khi quá mệt mỏi; 10 triệu máu là một lượng lớn nên hãy trang bị kỹ lưỡng.",
        "Các chỉnh sửa từ Trial of Chaos không áp dụng trong trận chiến Trialmaster, vì vậy bạn có thể chỉ phải lo lắng về các cơ chế boss cốt lõi."
      ]
    }
  },
  "the-bodach": {
    name: "The Bodach",
    group: "Ritual",
    location: "Caer Tarth",
    vi: {
      overview: "The Bodach là một Pinnacle Boss trong cơ chế Ritual endgame của Path of Exile 2. Bạn sẽ gặp phải boss này sau khi thực hiện Rite of the Nameless ở Caer Tarth trong Legacy of the Maji Quest. Đặt Head of the King vào Effigy để chuyển đổi endgame maps và mở khóa để chiến đấu với The Bodach.",
      mechanics: [
        "Darkness Mechanic: The Moriggan yêu cầu bạn di chuyển đến ánh sáng, bạn phải theo dõi green wisps được tạo ra bởi The Mhacha trong khi tránh các projectiles màu đỏ",
        "Red Sphere Attack: Boss triệu hồi nhiều red spheres rơi xuống sàn, tạo ra black circles gây sát thương cao khi bước vào",
        "Bright Wisps: Những ánh sáng này định kỳ xuất hiện xung quanh arena, cấp các buffs khác nhau để hỗ trợ trong trận chiến"
      ],
      phases: [
        { name: "Initial Combat Phase", vi: "Phase ban đầu nơi The Bodach tấn công trực tiếp với Red Sphere Attack và các cơ chế khác" },
        { name: "Darkness Phase", vi: "Phase tối nơi bạn phải điều hướng bằng cách theo green wisps trong khi tránh projectiles" }
      ],
      strategy: "Hãy cố gắng thu thập bright wisps khi có thể để nhận được các buffs hỗ trợ. Tránh các black puddles trên sàn vì chúng gây sát thương cao. Trong các darkness sequences, hãy theo dõi sát green wisps và liên tục di chuyển để tránh projectiles. Định vị cơ thể của bạn giữa các hazards và sử dụng các buffs từ bright wisps để tăng khả năng sống sót.",
      rewards: [
        "Vestige of Darkness (Tenebrous Crown)",
        "Sylvan's Effigy (Stoic Sceptre)"
      ],
      tips: [
        "Luôn chú ý đến vị trí của green wisps trong darkness phases để tránh bị thất lạc",
        "Tập trung vào việc tránh black circles thay vì cố gắng tấn công liên tục",
        "Thu thập bright wisps bất cứ khi nào có thể để duy trì các buffs hữu ích",
        "Duy trì khoảng cách an toàn từ The Bodach khi nó triệu hồi red spheres"
      ]
    }
  },
  "tangmazu-the-raven-trickster": {
    name: "Tangmazu, The Raven Trickster",
    group: "Delirium",
    location: "Paracosm",
    vi: {
      overview: "Tangmazu, The Raven Trickster là một boss Pinnacle trong cơ chế Delirium endgame. Bạn có thể gặp phải trong Paracosm sau khi đặt Raven's Reflection vào chiếc gương của Withered Willow. Để truy cập, người chơi phải trước tiên vượt qua các đợt kẻ địch trong Simulacrum of Delusion để có được vật phẩm Raven's Reflection.",
      mechanics: [
        "Positional Attacks - nhiều cuộc tấn công của Tangmazu theo dõi vị trí của bạn, yêu cầu di chuyển liên tục để tránh",
        "Heal & Blast Phase - ở khoảng 60% máu còn lại, Tangmazu sẽ đi tới giữa sân và hồi máu về đầy đủ, sau đó phát động một cuộc tấn công Blast lớn che phủ hầu hết trung tâm sân đấu",
        "Giant Beam Attack - một trong những cuộc tấn công lớn nhất là một tia sáng Beam khổng lồ xuyên qua sân"
      ],
      phases: [
        { name: "Positional Phase", vi: "Tangmazu liên tục tấn công theo vị trí của bạn. Hãy duy trì chuyển động nhanh chóng và không đứng yên để tránh bị trúng." },
        { name: "60% Health Threshold - Heal & Blast", vi: "Khi đạt 60% máu, Tangmazu tiến tới giữa sân và tự hồi máu về đầy đủ. Sau đó, nó phát động một Blast lớn che phủ hầu hết sân. Hãy rút lui về mép sân để tránh sát thương." },
        { name: "Beam Phase", vi: "Tangmazu phát động một tia sáng Beam khổng lồ xuyên qua sân. Bạn có thể lượn qua tia sáng này để duy trì vị trí tấn công." }
      ],
      strategy: "Để chiến thắng Tangmazu, hãy duy trì chuyển động liên tục để tránh các cuộc tấn công theo vị trí. Nhận ra mốc 60% máu là giai đoạn hồi máu/Blast quan trọng và sẵn sàng rút lui về mép sân để tránh sát thương từ Blast lớn. Luyện tập lượn qua Beam Attack để duy trì khả năng tấn công trong khi tránh sát thương. Bạn nên tối ưu hóa đế kháng và phòng thủ tương ứng với kiểu tấn công của boss này.",
      rewards: [
        "Sadist's Mercy (Flanged Mace)",
        "Veilpiercer (Amethyst Ring)"
      ],
      tips: [
        "Duy trì chuyển động liên tục để tránh các cuộc tấn công theo vị trí",
        "Nhận biết mốc 60% máu là tín hiệu quan trọng để chuẩn bị cho giai đoạn hồi máu và Blast",
        "Rút lui về mép sân khi Blast lớn được phát động ở trung tâm",
        "Luyện tập lượn qua Giant Beam Attack để duy trì vị trí tấn công hiệu quả"
      ]
    }
  },
  "xesht-we-that-are-one": {
    name: "Xesht, We That Are One",
    group: "Breach",
    location: "Twisted Domain",
    vi: {
      overview: "Xesht, We That Are One là một boss Breach pinnacle/uber được gặp ở Twisted Domain bằng cách sử dụng Breachstone tại Realmgate trong endgame Atlas. Đây là một trận chiến phức tạp với nhiều cơ chế tấn công mạnh mẽ bao gồm phát lửa từ ngón tay, slamming tay khổng lồ, và triệu hồi các puppet sóng lạnh/điện. Chiến đấu yêu cầu chuyển động liên tục, quản lý khoảng cách, và phòng chống cẩn thận.",
      mechanics: [
        "Finger Guns: Xesht phát ra những viên đạn nổ từ các ngón tay, cần lắt léo gần boss và né cuộn về phía sau để tránh",
        "Giant Hand Slam: Một bàn tay bay lơ lửng theo dõi vị trí người chơi, kích hoạt bóng và cần né cuộn nhanh",
        "Arm Portals: Ở giai đoạn 2, cổng địa phương sinh ra những chiếc tay khổng lồ tấn công, di chuyển về phía trung tâm để vượt qua",
        "Double Puppets: Triệu hồi puppet lạnh và sét tràn ngập arena, cần rút lui về các lối đi thoát",
        "Wind Blast: Tấn công phát lửa gió tích tụ yêu cầu quản lý khoảng cách",
        "Fireball: Tấn công không khí nhỏ dễ tránh",
        "Lightning Puppet: Tạo ra trường điện mở rộng",
        "Cold Puppet: Mưa phát lửa lạnh",
        "Hand Crawl: Bàn tay đuổi theo người chơi với tấn công sóng theo"
      ],
      phases: [
        { name: "Phase 1", vi: "Xesht tấn công bằng Finger Guns, Giant Hand Slam, Wind Blast và các tấn công cơ bản. Tập trung né tránh các phát lửa và giữ khoảng cách an toàn." },
        { name: "Phase 2", vi: "Arm Portals xuất hiện, sinh ra những chiếc tay tấn công. Double Puppets được triệu hồi, yêu cầu rút lui về các lối đi an toàn. Các tấn công tổng hợp từ phase 1 vẫn tiếp tục." }
      ],
      strategy: "Để đánh bại Xesht, duy trì chuyển động liên tục để tránh các tấn công từ xa, đặc biệt là Finger Guns và Wind Blast. Khi Giant Hand Slam kích hoạt bóng, cần né cuộn ngay lập tức. Với Double Puppets, rút lui vào các lối đi thoát để tránh trường điện và tấn công lạnh. Sử dụng khiên để chặn phát lửa từ các add. Duy trì khoảng cách tối đa từ các puppet và sử dụng Thawing Charm để phòng chống freeze từ cold puppets. Xesht có kháng lửa, lạnh, và sét cao, nhưng yếu với tổn thương vật lý và chaos. Tránh shock và chill debuff bằng cách di chuyển liên tục và sử dụng potion phù hợp.",
      rewards: [
        "Otherworldly Book of Knowledge (lần đầu clear, cấp 2 Breach Atlas Passive Points)",
        "The Pandemonius",
        "Beyond Reach",
        "Hand of Wisdom and Action",
        "Skin of the Loyal",
        "Choir of the Storm",
        "Xoph's Blood",
        "Controlled Metamorphosis"
      ],
      tips: [
        "Lắt léo gần Xesht và chuyển động tròn quanh nó để né Finger Guns hiệu quả",
        "Sử dụng Thawing Charm để ngăn chặn freeze từ cold puppets",
        "Giữ khiên để phòng chống phát lửa từ mercenary adds",
        "Arm Portals tiếp tục tấn công ngay cả sau khi đánh bại Xesht, cần tiếp tục canh chừng",
        "Duy trì sức khỏe cao và quản lý resistances (lửa, lạnh, sét) cẩn thận"
      ]
    }
  },
  "vessel-of-kulemak": {
    name: "Vessel of Kulemak",
    group: "Abyss",
    location: "Well of Souls",
    vi: {
      overview: "Vessel of Kulemak là một trùm boss Abyss Pinnacle được tìm thấy trong Well of Souls, được truy cập thông qua Kulemak's Invitation từ Atlas. Đây là một cuộc chiến đa pha phức tạp nơi mà boss sẽ hồi sinh nhiều lần khi bạn chọn các modifier từ ba Lich đã chết. Cuộc chiến sẽ kết thúc ở sức mạnh tối đa sau khi bạn thu thập ba modifier, nơi boss sẽ có thêm các cơ chế Abyssal.",
      mechanics: [
        "Ground effects và cold bursts làm những mối đe dọa chính trong cuộc chiến",
        "Spawns waves of minions để hỗ trợ boss",
        "Attacks tăng tốc độ với mỗi lần hồi sinh",
        "Các loại sát thương bổ sung được thêm vào qua các pha liên tiếp",
        "Abyssal fissures xuất hiện khi boss ở sức mạnh tối đa"
      ],
      phases: [
        { name: "Initial Phase", vi: "Đánh bại boss lần đầu tiên. Tránh chọn 'Take the Finger' vì điều này sẽ kết thúc cuộc chiến sớm." },
        { name: "Revival Phases", vi: "Di chuyển đến phía sau của đấu trường và tương tác với các biểu tượng xanh trên các Lich đã tê liệt, chọn từ ba pool modifier: Kurgal's Memory, Ulaman's Expanse, hoặc Amanamu's Deceit. Mỗi lựa chọn sẽ hồi sinh boss và thêm một Desecrated modifier vào Grip of Kulemak." },
        { name: "Full Strength Phase", vi: "Sau khi thu thập ba modifier, chọn 'Return the Finger' để kích hoạt cuộc chiến cuối cùng nơi boss có quyền truy cập vào các cơ chế bổ sung, bao gồm Abyssal fissures trên toàn bộ đấu trường." }
      ],
      strategy: "Để chiến thắng Vessel of Kulemak, bạn phải luôn di chuyển để tránh Spikes và các cuộc tấn công Area-of-Effect vì 'đứng yên là một câu kết tử'. Tăng cường frost resistance tối đa và tránh ở lại các khu vực nguy hiểm nơi mà nguồn tài nguyên Flask sẽ cạn kiệt nhanh chóng. Kế hoạch của bạn nên tập trung vào tính di động cao và quản lý tài nguyên hiệu quả.",
      rewards: [
        "Grip of Kulemak (unique ring với tối đa bốn custom modifiers)",
        "Darkness Enthroned",
        "Undying Hate Timeless Jewel",
        "Tecrod's Revenge (Lineage Gem)",
        "The Unborn Lich Ravenous Staff",
        "Abyssal Lich Ascendancy (unlock)"
      ],
      tips: [
        "Không bao giờ đứng yên - luôn di chuyển để tránh các hiệu ứng trên mặt đất",
        "Overcap frost resistance vì boss phát ra nhiều cold damage",
        "Quản lý Flask resources cẩn thận trong các khu vực nguy hiểm",
        "Chọn ba modifier một cách chiến lược để chuẩn bị cho cuộc chiến sức mạnh tối đa",
        "Cẩn thận với Abyssal fissures trong pha cuối"
      ]
    }
  },
  "atziri-the-red-queen": {
    name: "Atziri, the Red Queen",
    group: "Atziri's Temple",
    location: "Vaal Temple",
    vi: {
      overview: "Atziri, the Red Queen là trận chiến kết thúc trong Vaal Temple, được giới thiệu trong Fate of the Vaal League. Đây là một thử thách endgame Atlas yêu cầu sự chuẩn bị đáng kể. Để truy cập, bạn cần đánh bại Architect khi temple ở mức Area Level 75 trở lên, sau đó điều hướng qua các phòng khác nhau để đến buồng của Atziri.",
      mechanics: [
        "Physical, Fire, và Lightning attacks - ba loại tổn thương chính",
        "Falling spears - những cây mũi rơi xuống duy trì kéo dài trong suốt giai đoạn cuối",
        "Arena-wide red AoE - hiệu ứng phạm vi rộng nhất toàn bộ sân chiến khi sinh mệnh xuống 20%",
        "Evasion mechanics - khả năng né tránh cao"
      ],
      phases: [
        { name: "Final Phase", vi: "Khi Atziri giảm xuống khoảng 20% Life trong giai đoạn thứ hai, cô bắt đầu một cuộc tấn công hủy diệt bao trùm toàn bộ sân chiến trong một vùng AoE đỏ rộng lớn." }
      ],
      strategy: "Tập trung tối đa sát thương khi sinh mệnh của boss giảm xuống 20% để khai thác cơ hội quan trọng. Hãy chuẩn bị cho cuộc tấn công AoE đỏ toàn bộ sân chiến. Quản lý vị trí của bạn cẩn thận liên quan đến cơ chế falling spear và các hiệu ứng môi trường kéo dài. Duy trì nhận thức cao về các nguy hiểm liên tục trong sân chiến. Boss có khả năng kháng Physical, Fire, Cold, Lightning và Evasion cao, vì vậy hãy sử dụng tấn công xuyên thủng hoặc bỏ qua kháng cáng nếu có thể.",
      rewards: [
        "Drillneck (Penetrating Quiver)",
        "Atziri's Rule (Reflecting Staff)",
        "Atziri's Splendour (Sacrificial Regalia)",
        "Atziri's Step (Cinched Boots)",
        "Atziri's Contempt (Pronged Spear)",
        "Flesh Crucible (Diamond)",
        "Atziri's Medallion (Special Currency)",
        "Architect's Orb",
        "Crystallised Corruption",
        "Vaal Cultivation Orb"
      ],
      tips: [
        "Tập trung sát thương khi boss ở 20% Life để tối đa hóa cơ hội",
        "Chuẩn bị tinh thần và phòng vệ cho cuộc tấn công AoE đỏ rộng lớn",
        "Quản lý vị trí để tránh falling spear kéo dài",
        "Duy trì nhận thức cao về các hiệu ứng môi trường của sân chiến",
        "Sử dụng penetrating damage hoặc ignore resistances do khả năng kháng cao của boss"
      ]
    }
  },
  "the-arbiter-of-ash": {
    name: "The Arbiter of Ash",
    group: "Precursor Fortress (Pinnacle)",
    location: "Burning Monolith (Sealed Passageway in the Atlas)",
    vi: {
      overview: "The Arbiter of Ash là một Pinnacle Boss nằm trong Burning Monolith của Atlas. Để gặp boss này, người chơi phải sử dụng ba Crisis Fragments khác nhau (Ancient Crisis Fragment từ Iron Citadel, Weathered Crisis Fragment từ Copper Citadel, và Faded Crisis Fragment từ Stone Citadel) tại Sealed Passageway. Boss có khả năng miễn nhiễm với vật lý, lửa, lạnh và tia sét, đồng thời sử dụng các cuộc tấn công dựa trên vật lý và lửa kèm theo hiệu ứng ignite, chill và burning ground.",
      mechanics: [
        "Laser Beam - Một tia laser phía trước liên tục yêu cầu né sang bên",
        "Fiery Winds - Combo AoE với các quả cầu lửa; ở trong các vòng tròn để an toàn",
        "Firebolt - Cuộc tấn công bằng đạn duy nhất",
        "Fire Stars - Phóng các đạn lớn sinh ra những đạn nhỏ hơn",
        "Blazing Waves - Tạo ra các sóng lửa với con đường an toàn hẹp",
        "Sword Slashes - Nhiều cú đánh gần chiến đấu khi di chuyển",
        "Fire Blast - Arena bốc cháy trừ khu vực an toàn gần một quả cầu xuống",
        "Elemental Orbs - Suy giảm mặt đất; kích hoạt các quả cầu có thể phủ định buff boss",
        "Fire Pulse Orb - Firebolts liên tục yêu cầu né các sóng",
        "Sword Smash - Cuộc tấn công bay tạo ra cột lửa rồi AoE lớn"
      ],
      phases: [
        { name: "Phase 1", vi: "Giai đoạn đầu tiên tập trung vào các cuộc tấn công dựa trên lửa như Laser Beam, Fiery Winds, Firebolt, Fire Stars và Blazing Waves. Người chơi cần né tránh các tia laser và dòng lửa, đồng thời tận dụng các vòng tròn an toàn." },
        { name: "Phase 2", vi: "Giai đoạn thứ hai trở nên phức tạp hơn với các cuộc tấn công gần chiến đấu (Sword Slashes, Sword Smash) kết hợp với Fire Blast. Boss sử dụng Elemental Orbs có thể kích hoạt để phủ định buff của nó. Cơ chế quan trọng liên quan đến các flame bombs - người chơi phải đứng thẳng dưới mỗi quả bom khi nổ xảy ra." }
      ],
      strategy: "Cơ chế quan trọng nhất liên quan đến flame bombs được triển khai trong suốt trận đấu - bạn phải đứng thẳng dưới mỗi quả bom khi nó nổ. Trong Phase 2, đối với quả bom đầu tiên, đợi laser kết thúc trước khi vào khu vực an toàn. Đối với quả bom thứ hai, tránh cuộc tấn công lặn trước khi vào an toàn, sau đó né cú đánh dọc theo sau. Được khuyến cáo nên có sự kháng cự cao với lửa và những phòng thủ tốt để chịu đựng các hiệu ứng ignite và burning ground.",
      rewards: [
        "Arbiter's Book of Knowledge (grants two Arbiter Atlas Passive Points per difficulty tier)",
        "Ab Aeterno Grand Cuisses",
        "Morior Invictus Grand Regalia",
        "Sine Aequo Grand Manchettes",
        "Sacred Flame Shrine Sceptre",
        "Solus Ipse Grand Visage",
        "Prism of Belief Diamond"
      ],
      tips: [
        "Flame bombs là cơ chế phòng thủ chính - hãy đứng trực tiếp dưới chúng khi nổ",
        "Trong Phase 2, hãy chờ laser kết thúc trước khi vào khu vực an toàn từ quả bom đầu tiên",
        "Tránh các cuộc tấn công lặn trước khi tìm kiếm sự an toàn ở quả bom thứ hai",
        "Xây dựng kháng lửa cao để xử lý ignite, chill và burning ground effects",
        "Có thể kích hoạt Elemental Orbs để phủ định buff của boss trong Phase 2"
      ]
    }
  },
  "the-arbiter-of-divinity": {
    name: "The Arbiter of Divinity",
    group: "Precursor Fortress (Pinnacle)",
    location: "The Origin Tower, Precursor Fortress",
    vi: {
      overview: "The Arbiter of Divinity là trận đấu cuối cùng trong Legacy of the Precursors Quest, nằm trong The Origin Tower của Precursor Fortress. Trước khi đối mặt với boss này, bạn phải đánh bại The Arbiter of Ash và thu thập Origin Spark cùng Origin Cradle từ các boss trong Patriarch và Matriarch Halls, sau đó lắp chúng vào The Origin Engine để truy cập trận chiến.",
      mechanics: [
        "Summons multiple volatile orbs - gọi ra nhiều quả cầu nổ xung quanh đấu trường",
        "Circles around arena's center - di chuyển vòng quanh trung tâm đấu trường",
        "Arena-wide lightning attack - tấn công điện toàn bộ đấu trường, chỉ để lại vài điểm an toàn",
        "Summons clones - tạo ra bản sao mà bạn phải đối mặt",
        "Divine Power orbs - xuất hiện quả cầu màu vàng gọi là Divine Power trên sàn"
      ],
      phases: [
        { name: "Phase One", vi: "Boss summons multiple volatile orbs around the arena while circling. Tránh những quả cầu nổ này bằng cách định vị cách xa chúng." },
        { name: "Phase Two", vi: "Arena-wide lightning attack xuất hiện với chỉ một vài vùng an toàn. Bạn phải thu thập Divine Power orbs để có được miễn dịch tất cả sát thương trong 6 giây, điều này cho phép bạn tiêu diệt clones. Tránh bị kẹt giữa những bản sao bằng cách giữ khoảng cách an toàn." }
      ],
      strategy: "Định vị bản thân cách xa những quả cầu nổ volatile orbs trong Phase One. Trong Phase Two, tìm kiếm các vùng an toàn khỏi tấn công lightning arena-wide. Thu thập Divine Power orbs bằng cách đứng trên chúng để có được buff miễn dịch 6 giây, cho phép bạn tiêu diệt clones. Giữ khoảng cách từ các bản sao để tránh bị kẹt vào góc. Không cần thêm yêu cầu điện trở đặc biệt nhưng nên chuẩn bị phòng chống sát thương lượng lớn.",
      rewards: [
        "Tower Relay (kích hoạt tất cả maps trong khu vực tower để nhận Atlas Skill Points)",
        "Decree of Acuity (Ancient Visor)",
        "The Ordained (Grand Spear)"
      ],
      tips: [
        "Luôn tìm kiếm vùng an toàn khỏi các tấn công arena-wide lightning.",
        "Ưu tiên thu thập Divine Power orbs để có buff miễn dịch trong Phase Two.",
        "Tránh bị kẹt giữa multiple clones bằng cách duy trì khoảng cách an toàn và định vị tốt.",
        "Đánh bại The Arbiter of Ash trước khi có thể thử thách The Arbiter of Divinity."
      ]
    }
  }
};

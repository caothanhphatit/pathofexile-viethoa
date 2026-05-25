import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePassiveTree,
  passiveIconAssetPath,
  selectLatestPassiveTreePath,
  translatePassiveStatLine
} from "../scripts/passive-tree/passive-tree-lib.mjs";
import { passiveTreeExportPayload } from "../scripts/passive-tree/runtime.mjs";

const sampleTree = {
  tree: "Default",
  min_x: -1000,
  max_x: 1200,
  min_y: -900,
  max_y: 1100,
  constants: {
    orbitAnglesByOrbit: [
      [0],
      [0, Math.PI / 2, Math.PI]
    ],
    orbitRadii: [0, 100],
    skillsPerOrbit: [1, 12]
  },
  classes: [
    {
      name: "Sorceress",
      integerId: 3,
      base_str: 7,
      base_dex: 7,
      base_int: 15,
      background: {
        image: "ClassesSorceress",
        width: 1500,
        height: 1500,
        x: 12.5,
        y: -25
      },
      ascendancies: [{
        id: "Stormweaver",
        internalId: "Sorceress1",
        name: "Stormweaver",
        background: {
          image: "ClassesStormweaver",
          width: 1500,
          height: 1500,
          x: 0,
          y: -15536.765136719
        }
      }]
    }
  ],
  groups: {
    10: {
      x: 500,
      y: -200,
      orbits: [0, 1],
      nodes: [101, 102, 103],
      background: {
        image: "PSGroupBackground3",
        offsetX: 20,
        offsetY: -10
      }
    }
  },
  nodes: {
    101: {
      skill: 101,
      group: 10,
      orbit: 0,
      orbitIndex: 0,
      name: "Lightning Damage",
      classesStart: ["Sorceress"],
      icon: "Art/2DArt/SkillIcons/passives/LightningDamagenode.dds",
      stats: ["12% increased Lightning Damage"],
      connections: [{ id: 102, orbit: 0 }]
    },
    102: {
      skill: 102,
      group: 10,
      orbit: 1,
      orbitIndex: 1,
      name: "Pure Power",
      isKeystone: true,
      isAscendancyStart: true,
      ascendancyName: "Stormweaver",
      stats: ["30% increased maximum Mana"],
      connections: [{ id: 101, orbit: 0 }]
    },
    103: {
      skill: 103,
      group: 10,
      orbit: 1,
      orbitIndex: 2,
      name: "Jewel Socket",
      isJewelSocket: true,
      stats: [],
      connections: []
    }
  }
};

test("normalizes passive tree nodes, coordinates, classes, and edges", () => {
  const normalized = normalizePassiveTree(sampleTree, {
    treeVersion: "0_4",
    sourceUrl: "https://example.test/tree.json",
    sourceRef: "dev"
  });

  assert.equal(normalized.version, "0_4");
  assert.equal(normalized.scale_image, 1);
  assert.equal(normalized.tree_size, 2200);
  assert.equal(normalized.classes.length, 1);
  assert.equal(normalized.classes[0].background.image, "ClassesSorceress");
  assert.equal(normalized.classes[0].start_node_id, "101");
  assert.equal(normalized.classes[0].ascendancies[0].name, "Stormweaver");
  assert.equal(normalized.classes[0].ascendancies[0].background.image, "ClassesStormweaver");
  assert.equal(normalized.classes[0].ascendancies[0].start_node_id, "102");
  assert.equal(normalized.groups.length, 1);
  assert.equal(normalized.groups[0].background.image, "PSGroupBackground3");
  assert.equal(normalized.nodes.length, 3);
  assert.equal(normalized.edges.length, 0);
  assert.equal(normalized.path_edges.length, 1);

  const small = normalized.nodes.find((node) => node.id === "101");
  assert.equal(small.type, "small");
  assert.equal(small.x, 500);
  assert.equal(small.y, -200);
  assert.equal(small.arc, 0);
  assert.equal(small.icon_path, "/assets/passive-tree/icons/LightningDamagenode.webp");
  assert.equal(small.is_class_start, true);
  assert.deepEqual(small.classes_start, ["Sorceress"]);
  assert.equal(small.is_ascendancy_start, false);
  assert.deepEqual(small.stats_vi, ["Tăng 12% Lightning Damage"]);

  const keystone = normalized.nodes.find((node) => node.id === "102");
  assert.equal(keystone.type, "keystone");
  assert.equal(keystone.ascendancy_name, "Stormweaver");
  assert.equal(keystone.is_ascendancy_start, true);
  assert.equal(keystone.x, 600);
  assert.equal(keystone.y, -200);
  assert.equal(keystone.arc, 1.5708);
  assert.deepEqual(keystone.stats_vi, ["Tăng 30% Mana tối đa"]);

  const jewel = normalized.nodes.find((node) => node.id === "103");
  assert.equal(jewel.type, "jewel");
  assert.equal(jewel.x, 500);
  assert.equal(jewel.y, -100);

  assert.deepEqual(normalized.path_edges[0], { from: "101", to: "102", orbit: 0 });
  assert.deepEqual(normalized.constants, {
    orbitAnglesByOrbit: [[0], [0, Math.PI / 2, Math.PI]],
    orbitRadii: [0, 100],
    skillsPerOrbit: [1, 12]
  });
});

test("maps PoB passive icons from passive and root skill icon folders", () => {
  assert.equal(
    passiveIconAssetPath("Art/2DArt/SkillIcons/passives/LightningDamagenode.dds"),
    "/assets/passive-tree/icons/LightningDamagenode.webp"
  );
  assert.equal(
    passiveIconAssetPath("Art/2DArt/SkillIcons/WitchBoneStorm.dds"),
    "/assets/passive-tree/icons/WitchBoneStorm.webp"
  );
});

test("uses the group that actually contains a passive node when upstream group id is offset", () => {
  const normalized = normalizePassiveTree({
    ...sampleTree,
    groups: {
      10: { x: 500, y: -200, orbits: [0], nodes: [201] },
      11: { x: 4000, y: 4000, orbits: [0], nodes: [] }
    },
    nodes: {
      201: {
        skill: 201,
        group: 11,
        orbit: 0,
        orbitIndex: 0,
        name: "Attribute",
        stats: ["+5 to Strength"],
        connections: []
      }
    }
  });

  assert.equal(normalized.nodes[0].group, "10");
  assert.equal(normalized.nodes[0].x, 500);
  assert.equal(normalized.nodes[0].y, -200);
});

test("filters PoB non-passive tree nodes and omits their connector edges", () => {
  const normalized = normalizePassiveTree({
    ...sampleTree,
    groups: {
      20: { x: 0, y: 0, orbits: [0], nodes: [201, 202, 203, 206, 207] },
      21: { x: 1000, y: 1000, isProxy: true, orbits: [0], nodes: [204] }
    },
    nodes: {
      201: {
        skill: 201,
        group: 20,
        orbit: 0,
        orbitIndex: 0,
        name: "Real Passive",
        stats: ["10% increased Damage"],
        connections: [
          { id: 202, orbit: 0 },
          { id: 203, orbit: 0 },
          { id: 204, orbit: 0 },
          { id: 205, orbit: 0 },
          { id: 206, orbit: 0 },
          { id: 207, orbit: 0 }
        ]
      },
      202: {
        skill: 202,
        group: 20,
        orbit: 0,
        orbitIndex: 0,
        name: "Decoration",
        isOnlyImage: true,
        activeEffectImage: "PSGroupIconDamage",
        stats: [],
        connections: [{ id: 201, orbit: 0 }]
      },
      203: {
        skill: 203,
        group: 20,
        orbit: 0,
        orbitIndex: 0,
        name: "Proxy Passive",
        isProxy: true,
        stats: ["10% increased Damage"],
        connections: [{ id: 201, orbit: 0 }]
      },
      204: {
        skill: 204,
        group: 21,
        orbit: 0,
        orbitIndex: 0,
        name: "Proxy Group Passive",
        stats: ["10% increased Damage"],
        connections: [{ id: 201, orbit: 0 }]
      },
      205: {
        skill: 205,
        orbit: 0,
        orbitIndex: 0,
        name: "Groupless Passive",
        stats: ["10% increased Damage"],
        connections: [{ id: 201, orbit: 0 }]
      },
      206: {
        skill: 206,
        group: 20,
        orbit: 0,
        orbitIndex: 0,
        name: "Expansion Child",
        expansionJewel: { parent: 999 },
        stats: ["10% increased Damage"],
        connections: [{ id: 201, orbit: 0 }]
      },
      207: {
        skill: 207,
        group: 20,
        orbit: 0,
        orbitIndex: 0,
        name: "Linked Real Passive",
        stats: ["10% increased Damage"],
        connections: [{ id: 201, orbit: 0 }]
      }
    }
  }, { treeVersion: "0_4" });

  assert.deepEqual(normalized.nodes.map((node) => node.id), ["201", "207"]);
  assert.equal(normalized.nodes.some((node) => node.type === "mastery"), false);
  assert.deepEqual(normalized.edges, [{ from: "201", to: "207", orbit: 0 }]);
  assert.deepEqual(normalized.path_edges, [{ from: "201", to: "207", orbit: 0 }]);
  assert.equal(normalized.counts.nodes, 2);
  assert.equal(normalized.counts.edges, 1);
});

test("separates PoB render connectors from path graph links", () => {
  const normalized = normalizePassiveTree({
    ...sampleTree,
    groups: {
      30: { x: 0, y: 0, orbits: [0], nodes: [301, 302] },
      31: { x: 200, y: 0, orbits: [0], nodes: [303] },
      32: { x: 400, y: 0, orbits: [0], nodes: [304] }
    },
    nodes: {
      301: {
        skill: 301,
        group: 30,
        orbit: 0,
        orbitIndex: 0,
        name: "WITCH",
        classesStart: ["Witch"],
        stats: [],
        connections: [{ id: 302, orbit: 0 }]
      },
      302: {
        skill: 302,
        group: 30,
        orbit: 0,
        orbitIndex: 0,
        name: "Energy Shield",
        stats: ["10% increased maximum Energy Shield"],
        connections: [
          { id: 303, orbit: 0 },
          { id: 304, orbit: 0 }
        ]
      },
      303: {
        skill: 303,
        group: 31,
        orbit: 0,
        orbitIndex: 0,
        name: "Stormweaver",
        ascendancyName: "Stormweaver",
        stats: [],
        connections: []
      },
      304: {
        skill: 304,
        group: 32,
        orbit: 0,
        orbitIndex: 0,
        name: "Mana",
        stats: ["10% increased maximum Mana"],
        connections: []
      }
    }
  }, { treeVersion: "0_4" });

  assert.deepEqual(normalized.path_edges, [
    { from: "301", to: "302", orbit: 0 },
    { from: "302", to: "303", orbit: 0 },
    { from: "302", to: "304", orbit: 0 }
  ]);
  assert.deepEqual(normalized.edges, [{ from: "302", to: "304", orbit: 0 }]);
  assert.equal(normalized.counts.edges, 1);
  assert.equal(normalized.counts.path_edges, 3);
});

test("exports normalized passive tree render metadata without postgres", () => {
  const normalized = normalizePassiveTree(sampleTree, {
    treeVersion: "0_4",
    sourceUrl: "https://example.test/tree.json",
    sourceRef: "dev"
  });
  const payload = passiveTreeExportPayload(normalized, {
    generatedAt: "2026-05-25T00:00:00.000Z",
    sourcePath: "scratch/tree.json"
  });

  assert.equal(payload.database, undefined);
  assert.equal(payload.scale_image, 1);
  assert.equal(payload.tree_size, 2200);
  assert.equal(payload.constants.scaleImage, 1);
  assert.equal(payload.constants.treeSize, 2200);
  assert.equal(payload.constants.orbitAnglesByOrbit[1][1], Math.PI / 2);
  assert.equal(payload.classes[0].background.image, "ClassesSorceress");
  assert.equal(payload.classes[0].start_node_id, "101");
  assert.equal(payload.classes[0].ascendancies[0].background.image, "ClassesStormweaver");
  assert.equal(payload.classes[0].ascendancies[0].start_node_id, "102");
  assert.equal(payload.groups[0].background.image, "PSGroupBackground3");
  assert.deepEqual(payload.edges, []);
  assert.deepEqual(payload.path_edges, [{ from: "101", to: "102", orbit: 0 }]);
  assert.equal(payload.nodes[0].is_class_start, true);
  assert.deepEqual(payload.nodes[0].classes_start, ["Sorceress"]);
  assert.deepEqual(payload.nodes[0].i18n.stats[0], {
    en: "12% increased Lightning Damage",
    vi: "Tăng 12% Lightning Damage"
  });
});

test("translates common passive stat lines into clean Vietnamese", () => {
  assert.equal(translatePassiveStatLine("+10 to Dexterity"), "+10 Dexterity");
  assert.equal(translatePassiveStatLine("Grants Skill: Acidic Concoction"), "Cấp Skill: Acidic Concoction");
  assert.equal(translatePassiveStatLine("Banner Skills have 20% increased Area of Effect"), "Banner Skill có tăng 20% khu vực đánh lan");
  assert.equal(translatePassiveStatLine("Hits against you have 12% reduced Critical Damage Bonus"), "Hit lên bạn có giảm 12% Critical Damage Bonus");
  assert.equal(translatePassiveStatLine("Projectiles deal 20% more Hit damage to targets in the first 3.5 metres of their movement, scaling down with distance travelled to reach 0% after 7 metres"), "Projectile gây 20% more Hit Damage lên mục tiêu trong 3.5 mét đầu khi di chuyển, rồi giảm dần theo quãng đường để đạt 0% sau 7 mét");
  assert.equal(translatePassiveStatLine("Minions deal 10% increased Damage"), "Minion gây tăng 10% Damage");
  assert.equal(translatePassiveStatLine("6% increased Movement Speed if you've successfully Parried Recently"), "Tăng 6% Movement Speed nếu gần đây bạn Parry thành công");
  assert.equal(translatePassiveStatLine("Damage Penetrates 6% of Enemy Elemental Resistances while Shapeshifted"), "Damage xuyên 6% Elemental Resistance của kẻ địch khi đang biến hình");
  assert.equal(translatePassiveStatLine("Body Armour grants Hits against you have 100% reduced Critical Damage Bonus"), "Body Armour cấp Hit lên bạn có giảm 100% Critical Damage Bonus");
  assert.equal(translatePassiveStatLine("While you are not on Low Mana, you and Allies in your Presence have Unholy Might"), "Khi bạn không ở Low Mana, bạn và Allies trong Presence của bạn có Unholy Might");
  assert.equal(translatePassiveStatLine("50% more Mana Cost of Skills if you have no Energy Shield"), "50% more Mana Cost của Skill nếu bạn không có Energy Shield");
  assert.equal(translatePassiveStatLine("Cannot be Heavy Stunned while Sprinting"), "Không thể bị Heavy Stunned khi Sprinting");
  assert.equal(translatePassiveStatLine("Skills have a 15% chance to not consume Glory"), "Skill có 15% cơ hội không Consume Glory");
  assert.equal(translatePassiveStatLine("Enemies you Mark take 10% increased Damage"), "Kẻ địch bạn Mark nhận tăng 10% Damage");
  assert.equal(translatePassiveStatLine("Enemies Ignited by you permanently take 1% increased Fire Damage for each second they have ever been Ignited by you, up to a maximum of 10%"), "Kẻ địch bị bạn gây bỏng vĩnh viễn nhận tăng 1% Fire Damage cho mỗi giây chúng từng bị bạn gây bỏng, tối đa 10%");
  assert.equal(translatePassiveStatLine("Minions have 10% chance to inflict Withered on Hit"), "Minion có 10% cơ hội gây Withered khi Hit");
});

test("removes leftover English a/an articles from passive translations", () => {
  const englishArticle = /(^|[^\p{L}\p{N}_])(?:a|an)(?=$|[^\p{L}\p{N}_])/iu;
  const cases = [
    "Skills have 33% chance to not consume a Cooldown when used",
    "15% chance to Pierce an Enemy",
    "Attack Skills deal 10% increased Damage while holding a Shield",
    "8% increased Attack and Cast Speed if you've summoned a Totem Recently",
    "Regenerate 1% of maximum Life per second while you have a Totem"
  ];

  for (const source of cases) {
    assert.equal(englishArticle.test(translatePassiveStatLine(source)), false, source);
  }
  assert.equal(translatePassiveStatLine("Skills have 33% chance to not consume a Cooldown when used"), "Skill có 33% cơ hội không Consume Cooldown khi dùng");
  assert.equal(translatePassiveStatLine("3% increased maximum Mana"), "Tăng 3% Mana tối đa");
});

test("translates passive tree combat context without half-English fragments", () => {
  const cases = [
    ["Enemies affected by your Hazards Recently have 25% reduced Armour", "Kẻ địch bị Hazard của bạn ảnh hưởng gần đây bị giảm 25% Armour"],
    ["Enemies affected by your Hazards Recently have 25% reduced Evasion Rating", "Kẻ địch bị Hazard của bạn ảnh hưởng gần đây bị giảm 25% tỷ lệ né tránh"],
    ["Gain 20 Life per enemy killed", "Hồi 20 Life khi giết kẻ địch"],
    ["8% increased Attack Speed if you've killed Recently", "Tăng 8% Attack Speed nếu gần đây bạn đã giết kẻ địch"],
    ["16% increased Attack Speed if you haven't Attacked Recently", "Tăng 16% Attack Speed nếu gần đây bạn chưa tấn công"],
    ["100% increased Evasion Rating if you have been Hit Recently", "Tăng 100% tỷ lệ né tránh nếu gần đây bạn đã bị Hit"],
    ["30% reduced Evasion Rating if you haven't been Hit Recently", "Giảm 30% tỷ lệ né tránh nếu gần đây bạn chưa bị Hit"],
    ["Gain 2 Rage when Hit by an Enemy", "Nhận 2 Rage khi bị kẻ địch Hit"],
    ["15% increased Freeze Buildup", "Tăng 15% Freeze Buildup (đóng băng)"]
  ];

  for (const [source, expected] of cases) {
    const translated = translatePassiveStatLine(source);
    assert.equal(translated, expected, source);
    assert.doesNotMatch(translated, /bạn['’]ve|haven't|affected by|enemy killed|killed$/i, source);
  }
});

test("translates scanned passive tree leftovers from recent-action and affected-by lines", () => {
  const cases = [
    ["expend Ammunition if you've Reloaded Recently", "tiêu hao Ammunition nếu gần đây bạn đã Reload"],
    ["20% increased Damage for each different Warcry you've used Recently", "Tăng 20% Damage cho mỗi Warcry khác nhau bạn đã dùng gần đây"],
    ["12% increased Attack Damage for each different Non-Instant Spell you've used in the past 8 seconds", "Tăng 12% Attack Damage cho mỗi Spell không tức thời khác nhau bạn đã dùng trong 8 giây trước"],
    ["4% increased Cast Speed for each different Non-Instant Spell you've Cast Recently", "Tăng 4% Cast Speed cho mỗi Spell không tức thời khác nhau bạn đã Cast gần đây"],
    ["15% increased Melee Damage if you've dealt a Projectile Attack Hit in the past eight seconds", "Tăng 15% sát thương đánh gần nếu bạn đã gây Projectile Attack Hit trong 8 giây trước"],
    ["+4 to Melee Strike Range if you've dealt a Projectile Attack Hit in the past eight seconds", "+4 Melee Strike Range nếu bạn đã gây Projectile Attack Hit trong 8 giây trước"],
    ["60% faster start of Energy Shield Recharge if you've been Stunned Recently", "Energy Shield Recharge bắt đầu nhanh hơn 60% nếu gần đây bạn đã bị Stunned"],
    ["Regenerate 1% of maximum Life per Second if you've used a Life Flask in the past 10 seconds", "Hồi 1% Life tối đa mỗi giây nếu bạn đã dùng Life Flask trong 10 giây trước"],
    ["40% increased Cold Damage while affected by Herald of Ice", "Tăng 40% Cold Damage khi đang chịu ảnh hưởng của Herald of Ice"],
    ["20% faster start of Energy Shield Recharge while affected by an Archon Buff", "Energy Shield Recharge bắt đầu nhanh hơn 20% khi đang chịu ảnh hưởng của Archon Buff"],
    ["25% increased Stun Threshold if you haven't been Stunned Recently", "Tăng 25% Stun Threshold nếu gần đây bạn chưa bị Stunned"],
    ["Cannot be Light Stunned if you haven't been Hit Recently", "Không thể bị Light Stunned nếu gần đây bạn chưa bị Hit"],
    ["Gain 3 Volatility when an Allied Persistent Reviving Minion is Killed", "Nhận 3 Volatility khi Allied Persistent Reviving Minion bị giết"],
    ["Gain 8% of Damage as Extra Damage of a random Element while Shapeshifted", "Nhận 8% Damage dưới dạng Extra Damage thuộc một Element ngẫu nhiên khi đang biến hình"],
    ["Gain 25% of Cold Damage as Extra Fire Damage against Frozen Enemies", "Nhận 25% Cold Damage dưới dạng Extra Fire Damage lên kẻ địch bị Frozen"],
    ["Gain Tailwind on Skill use", "Nhận Tailwind khi dùng Skill"]
  ];

  for (const [source, expected] of cases) {
    const translated = translatePassiveStatLine(source);
    assert.equal(translated, expected, source);
    assert.doesNotMatch(translated, /bạn['’]ve|affected by|haven't|in the past|each different|as Extra Damage of|on Skill use/i, source);
  }
});

test("translates remaining scanned passive tree fragments into readable Vietnamese", () => {
  const cases = [
    ["Minions deal 30% increased Damage if you've Hit Recently", "Minion gây tăng 30% Damage nếu gần đây bạn đã Hit"],
    ["25% of Infernal Flame lost per second if none was gained in the past 2 seconds", "Mất 25% Infernal Flame mỗi giây nếu trong 2 giây trước không nhận thêm Infernal Flame"],
    ["50% increased Evasion Rating if Energy Shield Recharge has started in the past 2 seconds", "Tăng 50% tỷ lệ né tránh nếu Energy Shield Recharge đã bắt đầu trong 2 giây trước"],
    ["25% increased Damage with Crossbows for each type of Ammunition fired in the past 10 seconds", "Tăng 25% Damage với Crossbow cho mỗi loại Ammunition đã bắn trong 10 giây trước"],
    ["every different Grenade fired in the past 8 seconds", "mỗi Grenade khác nhau đã bắn trong 8 giây trước"],
    ["Minions deal 10% increased Damage with Command Skills for each different type of Persistent Minion in your Presence", "Minion gây tăng 10% Damage bằng Command Skill cho mỗi loại Persistent Minion khác nhau trong Presence của bạn"],
    ["Spells Gain 5% of Damage as extra Chaos Damage", "Spell nhận 5% Damage dưới dạng Extra Chaos Damage"],
    ["Empowered Attacks Gain 15% of Physical Damage as Extra Fire damage", "Empowered Attack nhận 15% Physical Damage dưới dạng Extra Fire Damage"],
    ["Gain 8% of Evasion Rating as extra Armour", "Nhận thêm Armour bằng 8% tỷ lệ né tránh"],
    ["Gain 100% of Evasion Rating as extra Ailment Threshold", "Nhận thêm Ailment Threshold bằng 100% tỷ lệ né tránh"],
    ["Gain 10% of Damage as Extra Damage of a random Element", "Nhận 10% Damage dưới dạng Extra Damage thuộc một Element ngẫu nhiên"],
    ["Regenerate 1% of maximum Life per second while stationary", "Hồi 1% Life tối đa mỗi giây khi đứng yên"],
    ["Regenerate 2.5% of maximum Life per second while Surrounded", "Hồi 2.5% Life tối đa mỗi giây khi bị bao quanh"],
    ["Regenerate 1 Rage per second per 4 Rage spent Recently", "Hồi 1 Rage mỗi giây mỗi 4 Rage đã tiêu gần đây"],
    ["Regenerate 3% of maximum Life over 1 second when Stunned", "Hồi 3% Life tối đa trong 1 giây khi bị Stunned"],
    ["Regenerate 1.5% of maximum Life per second while on Low Life", "Hồi 1.5% Life tối đa mỗi giây khi đang Low Life"]
  ];

  for (const [source, expected] of cases) {
    const translated = translatePassiveStatLine(source);
    assert.equal(translated, expected, source);
    assert.doesNotMatch(translated, /bạn['’]ve|in the past|each different| of .* as extra |^Regenerate\b|lost per second/i, source);
  }
});

test("translates scanned passive tree structural lines without raw English grammar", () => {
  const cases = [
    ["All Flames of Chayula that you manifest are Purple", "Toàn bộ Flame of Chayula bạn tạo ra là màu Purple"],
    ["6% increased bonuses gained from Equipped Quiver", "Tăng 6% bonus nhận từ Quiver đang trang bị"],
    ["8% increased Flask and Charm Charges gained", "Tăng 8% Flask Charge và Charm Charge nhận được"],
    ["6% reduced Charm Charges used", "Giảm 6% Charm Charge tiêu hao"],
    ["Immune to Chill if a majority of your Socketed Support Gems are Blue", "Miễn nhiễm Chill nếu phần lớn Support Gem đã Socket của bạn là màu Blue"],
    ["Enemies you Heavy Stun while Shapeshifted are Intimidated for 6 seconds", "Kẻ địch bạn Heavy Stun khi đang biến hình bị Intimidated trong 6 giây"],
    ["Base Bleeding Duration is 1 second", "Base thời lượng Bleeding (chảy máu) là 1 giây"],
    ["Minions Revive 15% faster if all your Minions are Companions", "Minion Revive nhanh hơn 15% nếu toàn bộ Minion của bạn là Companion"],
    ["10% chance when a Charm is used to use another Charm without consuming Charges", "10% cơ hội khi Charm được dùng để dùng thêm một Charm khác mà không Consume Charge"],
    ["10% increased Defences while your Companion is in your Presence", "Tăng 10% Defences khi Companion của bạn ở trong Presence của bạn"],
    ["Enemies are Intimidated for 4 seconds when you Immobilise them", "Kẻ địch bị Intimidated trong 4 giây khi bạn Immobilise chúng"],
    ["Ignites you cause are reflected back to you", "bỏng bạn gây bị phản lại lên bạn"],
    ["Your speed is unaffected by Slows", "Speed của bạn không bị Slow ảnh hưởng"],
    ["For each colour of Socketed Support Gem that is most numerous, gain:", "Với mỗi màu Support Gem đã Socket có số lượng nhiều nhất, nhận:"],
    ["Maximum Volatility is 30", "Volatility tối đa là 30"],
    ["Accuracy Rating is Doubled", "Accuracy Rating được nhân đôi"],
    ["20% chance that when Volatility on you explodes, you regain an equivalent amount of Volatility", "20% cơ hội khi Volatility trên bạn phát nổ, bạn nhận lại lượng Volatility tương đương"],
    ["4% increased Movement Speed if you've used a Mark Recently", "Tăng 4% Movement Speed nếu gần đây bạn đã dùng Mark"],
    ["Apply Debilitate to Enemies 3 Metres in front of you while your Shield is raised", "Áp dụng Debilitate lên kẻ địch trong 3 mét trước mặt bạn khi Shield của bạn đang giơ lên"],
    ["Enemies near Enemies you Mark are Blinded", "Kẻ địch gần kẻ địch bạn Mark bị Blinded"],
    ["Carry a Chest which adds 20 Inventory Slots", "Mang theo Chest thêm 20 ô Inventory"],
    ["Demonflame has no maximum", "Demonflame không có giới hạn tối đa"]
  ];

  for (const [source, expected] of cases) {
    const translated = translatePassiveStatLine(source);
    assert.equal(translated, expected, source);
    assert.doesNotMatch(translated, /\b(?:that|are|is|which|gained|used|reflected|majority of|all your)\b/i, source);
  }
});

test("translates repeated passive tree grammar patterns from the full scan", () => {
  const cases = [
    ["20% increased Life Flask Charges gained", "Tăng 20% Life Flask Charge nhận được"],
    ["Inherent loss of Rage is 15% slower", "Rage mất tự nhiên chậm hơn 15%"],
    ["Every second Slam Skill you use yourself is Ancestrally Boosted", "Mỗi Slam Skill thứ hai bạn tự dùng được Ancestrally Boosted"],
    ["4% increased Attack Speed while a Rare or Unique Enemy is in your Presence", "Tăng 4% Attack Speed khi kẻ địch Rare hoặc Unique ở trong Presence của bạn"],
    ["Life Leech effects are not removed when Unreserved Life is Filled", "Hiệu ứng hút máu không bị xóa khi Unreserved Life đầy"],
    ["40% increased Projectile Damage with Spears while there are no Enemies within 3m", "Tăng 40% Projectile Damage với Spear khi không có kẻ địch trong phạm vi 3m"],
    ["25% increased Life Recovery from Flasks used when on Low Life", "Tăng 25% Life Recovery từ Flask dùng khi đang Low Life"],
    ["Quarterstaff Skills that consume Power Charges count as consuming an additional Power Charge", "Quarterstaff Skill Consume Power Charge được tính như Consume thêm một Power Charge"],
    ["Life Leeched from Empowered Attacks is Instant", "Máu hút từ Empowered Attack là tức thời"],
    ["Attacks used by Totems have 4% increased Attack Speed", "Attack do Totem dùng có tăng 4% Attack Speed"],
    ["Attacks used by Totems have 3% increased Attack Speed per Summoned Totem", "Attack do Totem dùng có tăng 3% Attack Speed mỗi Summoned Totem"],
    ["Enemies you Fully Armour Break are Maimed", "Kẻ địch bạn Fully Armour Break bị Maimed"],
    ["12% increased Spell Damage with Spells that cost Life", "Tăng 12% Spell Damage với Spell tiêu tốn Life"],
    ["Culling Strike against Beasts while your Companion is in your Presence", "Culling Strike lên Beast khi Companion của bạn ở trong Presence của bạn"],
    ["Chance to Evade is Unlucky", "cơ hội Evade là Unlucky"],
    ["10 Life gained when you Block", "Hồi 10 Life khi bạn Block"],
    ["4% reduced Flask Charges used from Mana Flasks", "Giảm 4% Flask Charge tiêu hao từ Mana Flask"],
    ["Base Critical Hit Chance for Spells is 15%", "Base cơ hội Critical Hit cho Spell là 15%"],
    ["20% increased Critical Damage Bonus if you've gained a Power Charge Recently", "Tăng 20% Critical Damage Bonus nếu gần đây bạn đã nhận Power Charge"],
    ["Attack Hits Aggravate any Bleeding on targets which is older than 4 seconds", "Attack Hit Aggravate Bleeding (chảy máu) trên mục tiêu đã tồn tại hơn 4 giây"],
    ["20% chance for Attack Hits to apply Incision", "20% cơ hội để Attack Hit áp dụng Incision"],
    ["Apply 10 Critical Weakness to Enemies when Consuming a Mark on them", "Áp dụng 10 Critical Weakness lên kẻ địch khi Consume Mark trên chúng"]
  ];

  for (const [source, expected] of cases) {
    const translated = translatePassiveStatLine(source);
    assert.equal(translated, expected, source);
    assert.doesNotMatch(translated, /\b(?:that|are|is|which|gained|used|there are|to apply|is Filled)\b/i, source);
  }
});

test("translates final passive tree scan leftovers", () => {
  const cases = [
    ["60% of your current Energy Shield is added to your Armour for", "Thêm 60% Energy Shield hiện tại của bạn vào Armour của bạn trong"],
    ["Hits that Heavy Stun Enemies have Culling Strike", "Hit gây Heavy Stun lên kẻ địch có Culling Strike"],
    ["Damage with Hits is Lucky against Heavy Stunned Enemies", "Damage bằng Hit là Lucky lên kẻ địch bị Heavy Stunned"],
    ["Evasion Rating from Equipped Helmet, Gloves and Boots is doubled", "Tỷ lệ né tránh từ Helmet, Gloves và Boots đang trang bị được nhân đôi"],
    ["Evasion Rating from Equipped Body Armour is halved", "Tỷ lệ né tránh từ Body Armour đang trang bị bị giảm một nửa"]
  ];

  for (const [source, expected] of cases) {
    const translated = translatePassiveStatLine(source);
    assert.equal(translated, expected, source);
    assert.doesNotMatch(translated, /\b(?:that|is added|is doubled|is halved|Equipped)\b/i, source);
  }
});

test("translates melee damage and leech terms naturally", () => {
  const cases = [
    ["20% increased Melee Damage", "Tăng 20% sát thương đánh gần"],
    ["75% increased Melee Damage with Spears while Surrounded", "Tăng 75% sát thương đánh gần với Spear khi bị bao quanh"],
    ["40% increased Melee Damage with Hits at Close Range", "Tăng 40% sát thương đánh gần với Hit ở Close Range"],
    ["20% increased Melee Damage against Heavy Stunned enemies", "Tăng 20% sát thương đánh gần lên kẻ địch bị Heavy Stunned"],
    ["15% increased Stun Buildup with Melee Damage", "Tăng 15% Stun Buildup với sát thương đánh gần"],
    ["11% increased amount of Life Leeched", "Tăng 11% lượng máu hút được"],
    ["11% increased amount of Mana Leeched", "Tăng 11% lượng mana hút được"],
    ["11% increased amount of Life and Mana Leeched", "Tăng 11% lượng máu và mana hút được"],
    ["15% increased amount of Life Leeched while Shapeshifted", "Tăng 15% lượng máu hút được khi đang biến hình"],
    ["10% of Spell Damage Leeched as Life", "10% Spell Damage được hút thành máu"],
    ["10% of Thorns Damage Leeched as Life", "10% Thorns Damage được hút thành máu"],
    ["Life Leech recovers based on your Elemental damage as well as Physical damage", "Hút máu hồi phục dựa trên Elemental Damage của bạn cũng như Physical Damage"],
    ["Leech recovers based on Chaos Damage as well as Physical Damage", "Leech hồi phục dựa trên Chaos Damage cũng như Physical Damage"],
    ["Life Leech is Instant", "Hút máu là tức thời"],
    ["Leech Life 25% faster", "Hút máu nhanh hơn 25%"],
    ["Leech Life 5% slower", "Hút máu chậm hơn 5%"],
    ["40% increased Armour and Evasion Rating while Leeching", "Tăng 40% Armour và tỷ lệ né tránh khi đang hút"],
    ["Unaffected by Chill while Leeching Mana", "Không bị Chill ảnh hưởng khi đang hút mana"],
    ["20% of Leech is Instant", "20% lượng hút là tức thời"]
  ];

  for (const [source, expected] of cases) {
    const translated = translatePassiveStatLine(source);
    assert.equal(translated, expected, source);
    assert.doesNotMatch(translated, /Melee Damage|Life Leeched|Mana Leeched|Leech Life|Leeching Mana|amount of/i, source);
  }
});

test("translates defensive rating and hazard noun phrases in Vietnamese order", () => {
  const cases = [
    ["20% increased Evasion Rating", "Tăng 20% tỷ lệ né tránh"],
    ["Prevent +3% of Damage from Deflected Hits", "Ngăn +3% Damage từ Hit bị Deflect"],
    ["Prevent +3% of Damage from Deflected Hit", "Ngăn +3% Damage từ Hit bị Deflect"],
    ["30% increased Hazard Duration", "Tăng 30% thời lượng Hazard"],
    ["40% increased Hazard Damage", "Tăng 40% Damage của Hazard"]
  ];

  for (const [source, expected] of cases) {
    const translated = translatePassiveStatLine(source);
    assert.equal(translated, expected, source);
    assert.doesNotMatch(translated, /Evasion Rating|Prevent\b|Hazard thời lượng|Hazard Damage|Deflected Hit/i, source);
  }
});

test("translates minion reduced stats and command skill damage naturally", () => {
  const cases = [
    ["Minions have 15% reduced Attack Speed", "Minion bị giảm 15% Attack Speed"],
    ["Minions have 15% reduced Cast Speed", "Minion bị giảm 15% Cast Speed"],
    ["Minions have 10% reduced Life Recovery rate", "Minion bị giảm 10% Life Recovery rate"],
    ["Minions deal 100% increased Damage with Command Skills", "Minion gây tăng 100% Damage bằng Command Skill"],
    ["Minions deal 10% increased Damage with Command Skills for each different type of Persistent Minion in your Presence", "Minion gây tăng 10% Damage bằng Command Skill cho mỗi loại Persistent Minion khác nhau trong Presence của bạn"]
  ];

  for (const [source, expected] of cases) {
    const translated = translatePassiveStatLine(source);
    assert.equal(translated, expected, source);
    assert.doesNotMatch(translated, /có giảm|Damage với Command Skill/i, source);
  }
});

test("translates chance, pierce, bleed, and ignite terms consistently", () => {
  const cases = [
    ["50% chance for Projectiles to Pierce Enemies within 3m distance of you", "50% cơ hội để Projectile xuyên kẻ địch trong khoảng cách 3m từ bạn"],
    ["15% chance to Pierce an Enemy", "15% cơ hội xuyên kẻ địch"],
    ["15% chance to inflict Bleeding on Critical Hit", "15% cơ hội gây Bleeding (chảy máu) khi Critical Hit"],
    ["10% chance to Aggravate Bleeding on targets you Hit with Attacks", "10% cơ hội Aggravate Bleeding (chảy máu) trên mục tiêu bạn Hit bằng Attack"],
    ["20% chance for Bleeding to be Aggravated when Inflicted against Enemies on Jagged Ground", "20% cơ hội để Bleeding (chảy máu) được Aggravated khi gây lên kẻ địch trên Jagged Ground"],
    ["50% chance to Knock Back Bleeding Enemies with Hits", "50% cơ hội Knock Back kẻ địch đang bị Bleeding (chảy máu) bằng Hit"],
    ["30% increased Armour while Bleeding", "Tăng 30% Armour khi đang bị Bleeding (chảy máu)"],
    ["Immune to Bleeding if Equipped Helmet has higher Armour than Evasion Rating", "Miễn nhiễm Bleeding (chảy máu) nếu Helmet đang trang bị có Armour cao hơn tỷ lệ né tránh"],
    ["Immune to Chaos Damage and Bleeding", "Miễn nhiễm Chaos Damage và Bleeding (chảy máu)"],
    ["Elemental Damage also Contributes to Bleeding Magnitude", "Elemental Damage cũng góp vào Magnitude của Bleeding (chảy máu)"],
    ["Bleeding you inflict is Aggravated", "Bleeding (chảy máu) bạn gây được Aggravated"],
    ["Enemies Ignited by you permanently take 1% increased Fire Damage for each second they have ever been Ignited by you, up to a maximum of 10%", "Kẻ địch bị bạn gây bỏng vĩnh viễn nhận tăng 1% Fire Damage cho mỗi giây chúng từng bị bạn gây bỏng, tối đa 10%"],
    ["4% increased Area of Effect for Attacks per Enemy you've Ignited in the last 8 seconds, up to 40%", "Tăng 4% khu vực đánh lan cho Attack mỗi kẻ địch bạn đã gây bỏng trong 8 giây gần nhất, tối đa 40%"]
  ];

  for (const [source, expected] of cases) {
    const translated = translatePassiveStatLine(source);
    assert.equal(translated, expected, source);
    assert.doesNotMatch(translated, /\bchance\b|Pierce|Ignite|Ignited|(?<!\()Bleeding(?! \(chảy máu\))/i, source);
  }
});

test("translates passive tree split-line edge cases without English leftovers", () => {
  const cases = [
    ["Modifiers to Fire Resistance also grant Cold and Lightning Resistance at 50% of their value", "Modifier lên Fire Resistance cũng cấp Cold và Lightning Resistance bằng 50% giá trị đó"],
    ["+1 to maximum number of Summoned Totems", "+1 số lượng Summoned Totem tối đa"],
    ["Totems die 6 seconds after their Life is reduced to 0", "Totem chết sau 6 giây kể từ khi Life của chúng giảm về 0"],
    ["Warcries Explode Corpses dealing 25% of their Life as Physical Damage", "Warcry làm Corpse Explode, gây Physical Damage bằng 25% Life của chúng"],
    ["Ignore Warcry Cooldowns", "Bỏ qua Warcry Cooldown"],
    ["Break enemy Concentration on Hit equal to 100% of Damage Dealt", "Break Concentration của kẻ địch khi Hit bằng 100% Damage đã gây"],
    ["Enemies regain 10% of Concentration every second if they haven't lost Concentration in the past 5 seconds", "Kẻ địch hồi 10% Concentration mỗi giây nếu chúng chưa mất Concentration trong 5 giây trước"],
    ["10% chance for Enemies you Kill to Explode, dealing 100%", "10% cơ hội khiến kẻ địch bạn hạ Explode, gây 100%"],
    ["of their maximum Life as Physical Damage", "Life tối đa của chúng dưới dạng Physical Damage"],
    ["Unarmed Attacks that would use your Quarterstaff's damage gain:", "Unarmed Attack lẽ ra dùng Damage từ Quarterstaff của bạn sẽ nhận:"],
    ["Physical damage based on their Skill Level", "Physical Damage dựa trên Skill Level của chúng"],
    ["1% more Attack Speed per 75 Item Evasion Rating on Equipped Armour Items", "1% more Attack Speed mỗi 75 tỷ lệ né tránh từ Item trên Armour Item đang trang bị"],
    ["+0.1% to Critical Hit Chance per 10 Item Energy Shield on Equipped Armour Items", "+0.1% cơ hội Critical Hit mỗi 10 Item Energy Shield trên Armour Item đang trang bị"],
    ["Increases and Reductions to Armour also apply to Energy Shield", "Tăng và giảm Armour cũng áp dụng cho Energy Shield"],
    ["Recharge Rate at 40% of their value", "Recharge Rate bằng 40% giá trị của chúng"],
    ["Blind Enemies when they Stun you", "Blind kẻ địch khi chúng Stun bạn"],
    ["15% chance for Remnants you create to grant their effects twice", "15% cơ hội để Remnant bạn tạo cấp hiệu ứng của chúng hai lần"],
    ["25% chance on Consuming a Shock on an Enemy to reapply it", "25% cơ hội khi Consume Shock trên kẻ địch để áp lại Shock đó"],
    ["Burning Enemies you kill have a 5% chance to Explode, dealing a", "Kẻ địch đang Burning bị bạn hạ có 5% cơ hội Explode, gây"],
    ["tenth of their maximum Life as Fire Damage", "một phần mười Life tối đa của chúng dưới dạng Fire Damage"],
    ["4% of Maximum Life Converted to Energy Shield", "Chuyển 4% Life tối đa thành Energy Shield"],
    ["Minions gain 15% of their maximum Life as Extra maximum Energy Shield", "Minion nhận thêm Energy Shield tối đa bằng 15% Life tối đa của chúng"],
    ["Life Flasks applied to you grant Guard for 4 seconds equal to 8% of the Life Recovery per Second they apply", "Life Flask áp dụng lên bạn cấp Guard trong 4 giây bằng 8% Life Recovery mỗi giây mà chúng áp dụng"],
    ["Attacks gain increased Accuracy Rating equal to their Critical Hit Chance", "Attack nhận tăng Accuracy Rating bằng cơ hội Critical Hit của chúng"],
    ["Arrows gain Critical Hit Chance as they travel farther, up to", "Arrow nhận cơ hội Critical Hit khi bay xa hơn, tối đa"],
    ["40% increased Critical Hit Chance after 7 metres", "Tăng 40% cơ hội Critical Hit sau 7 mét"],
    ["Recoup 5% of damage taken by your Totems as Life", "Recoup 5% Damage Totem của bạn nhận dưới dạng Life"],
    ["Each Totem applies 2% increased Damage taken to Enemies in their Presence", "Mỗi Totem khiến kẻ địch trong Presence của nó nhận tăng 2% Damage Taken"],
    ["Unwithered enemies are Withered for 8 seconds when they enter your Presence", "Kẻ địch chưa bị Withered sẽ bị Withered trong 8 giây khi chúng vào Presence của bạn"],
    ["Curse zones erupt after 10% reduced delay", "Curse zone phun trào với delay giảm 10%"],
    ["Break Armour equal to 10% of Hit Damage dealt", "Break Armour bằng 10% Hit Damage đã gây"],
    ["Gain Deflection Rating equal to 20% of Armour", "Nhận Deflection Rating bằng 20% Armour"],
    ["Skills gain a Base Life Cost equal to Base Mana Cost", "Skill nhận Base Life Cost bằng Base Mana Cost"],
    ["Regenerate Mana equal to 6% of maximum Life per second", "Hồi Mana mỗi giây bằng 6% Life tối đa"],
    ["Remnants you create reappear once, 3 seconds after being collected", "Remnant bạn tạo tái xuất hiện một lần, 3 giây sau khi được thu thập"],
    ["Excess Life Recovery from Regeneration is applied to Energy Shield", "Life Recovery dư từ Regeneration được áp dụng cho Energy Shield"],
    ["Gain Elemental Archon after spending 100% of your Maximum Mana", "Nhận Elemental Archon sau khi tiêu 100% Mana tối đa của bạn"],
    ["Banner Buffs linger on you for 2 seconds after you leave the Area", "Banner Buff duy trì trên bạn trong 2 giây sau khi bạn rời Area"],
    ["Break Armour on Critical Hit with Spells equal to 10% of Physical Damage dealt", "Break Armour khi Critical Hit bằng Spell bằng 10% Physical Damage đã gây"],
    ["Remove a Curse after Channelling for 2 seconds", "Xóa một Curse sau khi Channeling trong 2 giây"],
    ["Gain Accuracy Rating equal to your Intelligence", "Nhận Accuracy Rating bằng Intelligence của bạn"],
    ["Gain Ailment Threshold equal to the lowest of Evasion and Armour on your Boots", "Nhận Ailment Threshold bằng giá trị thấp hơn giữa Evasion và Armour trên Boots của bạn"],
    ["Enemies are Maimed for 4 seconds after becoming Unpinned", "Kẻ địch bị Maimed trong 4 giây sau khi trở thành Unpinned"],
    ["Gain Physical Thorns damage equal to 10% of Item Armour on Equipped Body Armour", "Nhận Physical Thorns Damage bằng 10% Item Armour trên Body Armour đang trang bị"],
    ["Gain Physical Thorns damage equal to 8% of maximum Life while Shapeshifted", "Nhận Physical Thorns Damage bằng 8% Life tối đa khi đang biến hình"],
    ["Minions Break Armour equal to 3% of Physical damage dealt", "Minion Break Armour bằng 3% Physical Damage đã gây"],
    ["Gain Stun Threshold equal to the lowest of Evasion and Armour on your Helmet", "Nhận Stun Threshold bằng giá trị thấp hơn giữa Evasion và Armour trên Helmet của bạn"],
    ["Gain Arcane Surge when you Shapeshift to Human form after", "Nhận Arcane Surge khi bạn biến hình về Human form sau"],
    ["being Shapeshifted for at least 8 seconds", "đã biến hình ít nhất 8 giây"],
    ["Charms applied to you have 25% increased Effect", "Charm áp dụng lên bạn có tăng 25% Effect"],
    ["Damage taken is Reserved from Darkness before being taken from Life or Energy Shield", "Damage nhận vào được Reserved từ Darkness trước khi trừ vào Life hoặc Energy Shield"],
    ["On Freezing Enemies create Chilled Ground", "Khi Freeze kẻ địch, tạo Chilled Ground"],
    ["Every Third Slam skill that doesn't create Fissures which you use yourself causes 3 additional Aftershocks ahead and to each side of the initial area", "Mỗi Slam Skill thứ ba bạn tự dùng mà không tạo Fissure sẽ gây thêm 3 Aftershock phía trước và hai bên vùng ban đầu"],
    ["Gain Infernal Flame instead of spending Mana for Skill costs", "Nhận Infernal Flame thay vì tiêu Mana cho Skill Cost"],
    ["Create Lightning Infusion Remnants instead of Fire", "Tạo Lightning Infusion Remnant thay vì Fire"],
    ["Create Cold Infusion Remnants instead of Lightning", "Tạo Cold Infusion Remnant thay vì Lightning"],
    ["Create Fire Infusion Remnants instead of Cold", "Tạo Fire Infusion Remnant thay vì Cold"],
    ["50% increased Minion Damage while you have at least two different active Offerings", "Tăng 50% Minion Damage khi bạn có ít nhất hai Offering đang active khác nhau"],
    ["10% chance to create an additional Remnant", "10% cơ hội tạo thêm một Remnant"],
    ["Recover 3% of maximum Life when you create an Offering", "Hồi 3% Life tối đa khi bạn tạo Offering"],
    ["15% increased Magnitude of Jagged Ground you create", "Tăng 15% Magnitude của Jagged Ground bạn tạo"],
    ["20% of Damage is taken from Mana before Life", "20% Damage được trừ từ Mana trước Life"],
    ["Hit damage is taken from Mana before Life if your current Mana is higher than your current Life", "Hit Damage được trừ từ Mana trước Life nếu Mana hiện tại của bạn cao hơn Life hiện tại của bạn"],
    ["Gain 35% Base Chance to Block from Equipped Shield instead of the Shield's value", "Nhận 35% Base cơ hội Block từ Shield đang trang bị thay vì giá trị của Shield"],
    ["100% of Elemental Damage is taken from Mana before Life", "100% Elemental Damage được trừ từ Mana trước Life"],
    ["20% of Damage from Hits is taken from your nearest Totem's Life before you", "20% Damage từ Hit được trừ từ Life của Totem gần nhất của bạn trước khi trừ vào bạn"],
    ["Life Recharges instead of Energy Shield", "Life Recharge thay vì Energy Shield"],
    ["All Damage is taken from Mana before Life", "Toàn bộ Damage được trừ từ Mana trước Life"],
    ["All bonuses from Equipped Amulet apply to your Minions instead of you", "Toàn bộ bonus từ Amulet đang trang bị áp dụng cho Minion của bạn thay vì bạn"],
    ["Gain Power Charges instead of Frenzy Charges", "Nhận Power Charge thay vì Frenzy Charge"],
    ["Stun Threshold is based on 30% of your Energy Shield instead of Life", "Stun Threshold dựa trên 30% Energy Shield của bạn thay vì Life"],
    ["5% of Damage from Hits is taken from your Damageable Companion's Life before you", "5% Damage từ Hit được trừ từ Life của Damageable Companion của bạn trước khi trừ vào bạn"],
    ["Arcane Surge grants more Life Regeneration Rate instead of Mana Regeneration Rate", "Arcane Surge cấp more Life Regeneration Rate thay vì Mana Regeneration Rate"],
    ["Leeching Life from your Hits causes your Companion to also Leech the same amount of Life", "Hút máu từ Hit của bạn khiến Companion của bạn cũng hút cùng lượng máu đó"],
    ["Increases and Reductions to Mana Regeneration Rate also apply to Rage Regeneration Rate", "Tăng và giảm Mana Regeneration Rate cũng áp dụng cho Rage Regeneration Rate"],
    ["Increases and Reductions to Projectile Speed also apply to Damage with Bows", "Tăng và giảm Projectile Speed cũng áp dụng cho Damage với Bow"],
    ["Increases and Reductions to Companion Damage also apply to you", "Tăng và giảm Companion Damage cũng áp dụng cho bạn"],
    ["Fully Broken Armour you inflict increases all Damage Taken from Hits instead", "Fully Broken Armour bạn gây sẽ tăng toàn bộ Damage Taken từ Hit thay thế"],
    ["Fully Broken Armour you inflict also increases Fire Damage Taken from Hits", "Fully Broken Armour bạn gây cũng tăng Fire Damage Taken từ Hit"],
    ["You can Break Enemy Armour to below 0", "Bạn có thể Break Armour của kẻ địch xuống dưới 0"],
    ["+10% to Fire Resistance", "+10% Fire Resistance"],
    ["15% increased effect of Fully Broken Armour", "Tăng 15% Effect của Fully Broken Armour"],
    ["15% chance to inflict Bleeding on Critical Hit", "15% cơ hội gây Bleeding (chảy máu) khi Critical Hit"],
    ["15% increased Magnitude of Chill you inflict", "Tăng 15% Magnitude của Chill bạn gây"],
    ["Remnants have 50% increased effect", "Remnant có tăng 50% Effect"],
    ["Remnants can be collected from 50% further away", "Remnant có thể được thu thập từ xa hơn 50%"],
    ["15% increased Area of Effect of Curses", "Tăng 15% khu vực đánh lan của Curse"],
    ["12% increased Effect of your Mark Skills", "Tăng 12% Effect của Mark Skill của bạn"],
    ["Can Allocate Passives from the Sorceress's starting point", "Có thể Allocate Passive từ điểm bắt đầu của Sorceress"],
    ["Ritual Sacrifice can be used on yourself to remove 20% of maximum Life and grant a random Monster Modifier", "Ritual Sacrifice có thể dùng lên bản thân để xóa 20% Life tối đa và cấp một Monster Modifier ngẫu nhiên"],
    ["A maximum of one Modifer can be granted this way", "Tối đa một Modifier có thể được cấp theo cách này"],
    ["Double Adaptation Effect", "Nhân đôi Adaptation Effect"],
    ["Sorcery Ward's Barrier can also take Physical and Chaos Damage from Hits", "Barrier của Sorcery Ward cũng có thể nhận Physical và Chaos Damage từ Hit"],
    ["Chance to Hit with Attacks can exceed 100%", "cơ hội Hit bằng Attack có thể vượt 100%"],
    ["25% of Life Loss from Hits is prevented, then that much Life is lost over 4 seconds instead", "Ngăn 25% Life Loss từ Hit, sau đó mất lượng Life đó trong 4 giây thay thế"],
    ["You can apply an additional Curse", "Bạn có thể áp dụng thêm một Curse"],
    ["You can equip a Focus while wielding a Staff", "Bạn có thể trang bị Focus khi đang cầm Staff"],
    ["Can instead consume 25% of maximum Mana to trigger Charms with insufficient charges", "Có thể Consume 25% Mana tối đa để Trigger Charm khi không đủ Charge thay thế"],
    ["Double the number of your Poisons that targets can be affected by at the same time", "Nhân đôi số Poison của bạn có thể ảnh hưởng lên mục tiêu cùng lúc"],
    ["Can only use a Normal Body Armour", "Chỉ có thể dùng Body Armour Normal"],
    ["Recoup Effects instead occur over 4 seconds", "Recoup Effect diễn ra trong 4 giây thay thế"],
    ["Attribute Passive Skills can instead grant 5% increased Damage", "Attribute Passive Skill có thể cấp tăng 5% Damage thay thế"],
    ["There is no Limit on the number of Banners you can place", "Không giới hạn số lượng Banner bạn có thể đặt"],
    ["Can Socket a non-Unique Basic Jewel into the Phylactery", "Có thể Socket một Basic Jewel không Unique vào Phylactery"],
    ["If you would gain a Charge, Allies in your Presence gain that Charge instead", "Nếu bạn sắp nhận một Charge, Allies trong Presence của bạn nhận Charge đó thay thế"],
    ["Bleeding you inflict is Aggravated", "Bleeding (chảy máu) bạn gây được Aggravated"],
    ["50% more Magnitude of Bleeding you inflict", "50% more Magnitude của Bleeding (chảy máu) bạn gây"],
    ["You can wield Two-Handed Axes, Maces and Swords in one hand", "Bạn có thể cầm Two-Handed Axe, Mace và Sword bằng một tay"],
    ["No Rage effect", "Không có Rage Effect"],
    ["Invocation Skills instead Trigger Spells every 2 seconds", "Invocation Skill Trigger Spell mỗi 2 giây thay thế"],
    ["Slam Skills you use yourself have 30% increased Aftershock Area of Effect", "Slam Skill bạn tự dùng có tăng 30% Aftershock khu vực đánh lan"],
    ["10% increased Mana Recovery Rate during Effect of any Mana Flask", "Tăng 10% Mana Recovery Rate trong thời gian Effect của bất kỳ Mana Flask nào"],
    ["8% increased Skill Effect Duration per Enemy you've Frozen in the last 8 seconds, up to 40%", "Tăng 8% Skill Effect Duration cho mỗi kẻ địch bạn đã Freeze trong 8 giây gần nhất, tối đa 40%"],
    ["12% increased Area of Effect if you have Stunned an Enemy Recently", "Tăng 12% khu vực đánh lan nếu gần đây bạn đã Stun một kẻ địch"],
    ["Final Repeat of Spells has 30% increased Area of Effect", "Final Repeat của Spell có tăng 30% khu vực đánh lan"],
    ["30% increased chance to inflict Ailments against Rare or Unique Enemies", "Tăng 30% cơ hội gây Ailment lên kẻ địch Rare hoặc Unique"],
    ["80% increased Effect of Poison you inflict on targets that are not Poisoned", "Tăng 80% Effect của Poison bạn gây lên mục tiêu chưa bị Poisoned"],
    ["Debuffs you inflict have 6% increased Slow Magnitude", "Debuff bạn gây có tăng 6% Slow Magnitude"],
    ["30% reduced Effect of Chill on you", "Giảm 30% Effect của Chill lên bạn"],
    ["Attacks with One-Handed Weapons have 20% increased Chance to inflict Ailments", "Attack với One-Handed Weapon có tăng 20% cơ hội gây Ailment"],
    ["20% increased duration of Ailments you inflict against Cursed Enemies", "Tăng 20% Duration của Ailment bạn gây lên kẻ địch bị Cursed"],
    ["35% increased Critical Hit Chance against Enemies that are affected", "Tăng 35% cơ hội Critical Hit lên kẻ địch đang"],
    ["by no Elemental Ailments", "không chịu Elemental Ailment nào"],
    ["30% increased Stun Buildup against Enemies that are on Low Life", "Tăng 30% Stun Buildup lên kẻ địch đang Low Life"],
    ["40% increased Critical Hit Chance against Enemies that are on Full Life", "Tăng 40% cơ hội Critical Hit lên kẻ địch đang Full Life"],
    ["30% chance to Poison on Hit against Enemies that are not Poisoned", "30% cơ hội Poison khi Hit lên kẻ địch chưa bị Poisoned"],
    ["2% chance that if you would gain Power Charges, you instead gain up to", "2% cơ hội: nếu bạn sắp nhận Power Charge, thay vào đó nhận tối đa"],
    ["your maximum number of Power Charges", "số Power Charge tối đa của bạn"],
    ["+1 to Maximum Power Charges", "+1 Maximum Power Charge"],
    ["Enemies you inflict Bleeding on cannot Regenerate Life", "Kẻ địch bạn gây Bleeding (chảy máu) lên không thể Regenerate Life"],
    ["25% chance to inflict Daze with Hits against Enemies further than 6m", "25% cơ hội gây Daze bằng Hit lên kẻ địch cách xa hơn 6m"],
    ["Warcries inflict 3 Critical Weakness on Enemies", "Warcry gây 3 Critical Weakness lên kẻ địch"],
    ["Defend with 150% of Armour against Hits from Enemies that are further than 6m away", "Defend bằng 150% Armour trước Hit từ kẻ địch cách xa hơn 6m"],
    ["Bleeding you inflict on Pinned Enemies is Aggravated", "Bleeding (chảy máu) bạn gây lên kẻ địch bị Pinned được Aggravated"],
    ["Damage with Hits is Lucky against Enemies that are on Low Life", "Damage bằng Hit là Lucky lên kẻ địch đang Low Life"],
    ["Deflected Hits cannot inflict Maim on you", "Hit bị Deflect không thể gây Maim lên bạn"],
    ["Exposure you inflict lowers Resistances by an additional 5%", "Exposure bạn gây giảm thêm 5% Resistance"],
    ["40% increased chance to inflict Elemental Ailments if you have Shapeshifted to an Animal form Recently", "Tăng 40% cơ hội gây Elemental Ailment nếu gần đây bạn đã biến hình sang Animal form"],
    ["10% chance to inflict Bleeding on Critical Hit with Attacks", "10% cơ hội gây Bleeding (chảy máu) khi Critical Hit bằng Attack"],
    ["15% increased Magnitude of Bleeding you inflict against Enemies affected by Incision", "Tăng 15% Magnitude của Bleeding (chảy máu) bạn gây lên kẻ địch bị ảnh hưởng bởi Incision"],
    ["Cannot gain Spirit from Equipment", "Không thể nhận Spirit từ Trang bị"],
    ["Pinned enemies cannot perform actions", "Kẻ địch bị Pinned không thể thực hiện hành động"],
    ["Dodge Roll cannot Avoid Damage", "Dodge Roll không thể Avoid Damage"],
    ["Invocation Skills cannot gain Energy while Triggering Spells", "Invocation Skill không thể nhận Energy khi đang Trigger Spell"],
    ["You cannot Recover Energy Shield from Regeneration", "Bạn không thể hồi Energy Shield từ Regeneration"],
    ["You cannot Recover Energy Shield to above Armour", "Bạn không thể hồi Energy Shield vượt quá Armour"],
    ["Skills deal 8% increased Damage per Combo consumed, up to 40%", "Skill gây tăng 8% Damage mỗi Combo đã Consume, tối đa 40%"],
    ["+8 maximum Rage for each time you've used a Skill that Requires Glory in the past 6 seconds, up to 5 times", "+8 Rage tối đa cho mỗi lần bạn đã dùng Skill yêu cầu Glory trong 6 giây trước, tối đa 5 lần"],
    ["Projectiles have 25% increased Critical Hit Chance against Enemies further than 6m", "Projectile có tăng 25% cơ hội Critical Hit lên kẻ địch cách xa hơn 6m"],
    ["Projectiles deal 25% increased Damage with Hits against Enemies further than 6m", "Projectile gây tăng 25% Damage bằng Hit lên kẻ địch cách xa hơn 6m"],
    ["4% increased Area of Effect for Attacks per Enemy you've Ignited in the last 8 seconds, up to 40%", "Tăng 4% khu vực đánh lan cho Attack mỗi kẻ địch bạn đã gây bỏng trong 8 giây gần nhất, tối đa 40%"],
    ["10% increased Damage for each Hazard triggered Recently, up to 50%", "Tăng 10% Damage cho mỗi Hazard đã Trigger gần đây, tối đa 50%"],
    ["15% increased Duration of Ailments against Enemies with Exposure", "Tăng 15% Duration của Ailment lên kẻ địch có Exposure"],
    ["1% increased Attack Speed per 400 Accuracy Rating, up to 20%", "Tăng 1% Attack Speed mỗi 400 Accuracy Rating, tối đa 20%"],
    ["Enemies you Curse cannot Recharge Energy Shield", "Kẻ địch bạn Curse không thể Recharge Energy Shield"],
    ["50% increased Duration of Ailments on Beasts", "Tăng 50% Duration của Ailment lên Beast"],
    ["5% increased Life and Mana Regeneration Rate for each Minion in your Presence, up to a maximum of 40%", "Tăng 5% Life và Mana Regeneration Rate cho mỗi Minion trong Presence của bạn, tối đa 40%"],
    ["Enemies you Fully Armour Break cannot Regenerate Life", "Kẻ địch bạn Fully Armour Break không thể Regenerate Life"],
    ["10% reduced Duration of Ailments on You", "Giảm 10% Duration của Ailment lên bạn"],
    ["20% reduced Magnitude of Poison you inflict", "Giảm 20% Magnitude của Poison bạn gây"],
    ["Consuming Glory grants you 3% increased Attack damage per Glory consumed for 6 seconds, up to 60%", "Consume Glory cấp cho bạn tăng 3% Attack Damage mỗi Glory đã Consume trong 6 giây, tối đa 60%"],
    ["10% increased Stun Threshold for each time you've been Hit by an Enemy Recently, up to 100%", "Tăng 10% Stun Threshold cho mỗi lần gần đây bạn bị kẻ địch Hit, tối đa 100%"],
    ["30% increased maximum Energy Shield if you've consumed a Power Charge Recently", "Tăng 30% Energy Shield tối đa nếu gần đây bạn đã Consume Power Charge"],
    ["On Hitting an Enemy while a Life Flask is at full Charges, 40% of its Charges are consumed", "Khi Hit kẻ địch trong lúc Life Flask đầy Charge, 40% Charge của nó bị Consume"],
    ["Gain 1% of damage as Physical damage for 3 seconds per Charge consumed this way", "Nhận 1% Damage dưới dạng Physical Damage trong 3 giây mỗi Charge đã Consume theo cách này"],
    ["When you Shapeshift to Human form, gain 10% increased Spell Damage per second you were Shapeshifted, up to a maximum of 80%, for 8 seconds", "Khi biến hình về Human form, nhận tăng 10% Spell Damage mỗi giây bạn đã biến hình, tối đa 80%, trong 8 giây"],
    ["100% increased Stun Threshold for each time you've been Stunned Recently", "Tăng 100% Stun Threshold cho mỗi lần gần đây bạn đã bị Stunned"],
    ["Damage Penetrates 20% Elemental Resistances for each time you've used a Skill that Requires Glory in the past 6 seconds", "Damage xuyên 20% Elemental Resistance cho mỗi lần bạn đã dùng Skill yêu cầu Glory trong 6 giây trước"],
    ["8% increased Damage for each time you've Warcried Recently", "Tăng 8% Damage cho mỗi lần gần đây bạn đã Warcry"],
    ["Gain 2% of Damage as Extra Fire Damage per Endurance Charge consumed Recently", "Nhận 2% Damage dưới dạng Extra Fire Damage mỗi Endurance Charge đã Consume gần đây"],
    ["Recover 3% of maximum Life for each Endurance Charge consumed", "Hồi 3% Life tối đa cho mỗi Endurance Charge đã Consume"],
    ["Recover 1% of maximum Life per Glory consumed", "Hồi 1% Life tối đa mỗi Glory đã Consume"],
    ["Consume all Rage when Shapeshifting to Human form to recover 1% of maximum life per Rage Consumed", "Consume toàn bộ Rage khi biến hình về Human form để hồi 1% Life tối đa mỗi Rage đã Consume"],
    ["1% increased Movement Speed for each time you've Blocked in the past 10 seconds", "Tăng 1% Movement Speed cho mỗi lần bạn đã Block trong 10 giây trước"],
    ["Life Flasks also recover Mana", "Life Flask cũng hồi Mana"],
    ["Damage of Enemies Hitting you is Unlucky", "Damage của kẻ địch Hit bạn là Unlucky"],
    ["Melee Attack Skills have +1 to maximum number of Summoned Totems", "Melee Attack Skill có +1 số lượng Summoned Totem tối đa"],
    ["Recover 3% of Maximum Mana when you collect a Remnant", "Hồi 3% Mana tối đa khi bạn thu thập Remnant"],
    ["Recover 1% of maximum Life on Kill", "Hồi 1% Life tối đa khi Kill"],
    ["Recover 50% of maximum Life when you Heavy Stun a Rare or Unique Enemy", "Hồi 50% Life tối đa khi bạn Heavy Stun kẻ địch Rare hoặc Unique"],
    ["Recover 2% of maximum Life when one of your Minions is Revived", "Hồi 2% Life tối đa khi một Minion của bạn được Revive"],
    ["When a Banner expires, recover 15% of the Glory required for that Banner", "Khi Banner hết hạn, hồi 15% Glory cần cho Banner đó"],
    ["2% chance to Recover all Life when you Kill an Enemy", "2% cơ hội hồi toàn bộ Life khi bạn Kill kẻ địch"],
    ["Recover 5% of maximum Mana when a Charm is used", "Hồi 5% Mana tối đa khi Charm được dùng"],
    ["Recover 2% of maximum Life and Mana when you use a Warcry", "Hồi 2% Life và Mana tối đa khi bạn dùng Warcry"],
    ["Recover 5% of maximum Mana when you consume a Power Charge", "Hồi 5% Mana tối đa khi bạn Consume Power Charge"],
    ["3% increased Fire Damage per Endurance Charge consumed Recently", "Tăng 3% Fire Damage mỗi Endurance Charge đã Consume gần đây"],
    ["40% increased Spell Damage if one of your Minions has died Recently", "Tăng 40% Spell Damage nếu gần đây một Minion của bạn đã chết"],
    ["Archon recovery period expires 30% slower", "Thời gian hồi Archon kết thúc chậm hơn 30%"],
    ["Archon recovery period expires 25% faster", "Thời gian hồi Archon kết thúc nhanh hơn 25%"]
  ];

  for (const [source, expected] of cases) {
    assert.equal(translatePassiveStatLine(source), expected);
  }
});

test("selects the newest passive tree source path by numeric version", () => {
  assert.deepEqual(selectLatestPassiveTreePath([
    "src/TreeData/0_1/tree.json",
    "src/TreeData/0_10/tree.json",
    "src/TreeData/0_4/tree.json",
    "src/TreeData/atlas/tree.json"
  ]), {
    version: "0_10",
    path: "src/TreeData/0_10/tree.json"
  });
});

test("ignores null passive tree groups from upstream data", () => {
  const tree = normalizePassiveTree({
    ...sampleTree,
    groups: {
      ...sampleTree.groups,
      99: null
    }
  }, { treeVersion: "0_4" });

  assert.equal(tree.groups.some((group) => group.id === "99"), false);
  assert.equal(tree.nodes.length, 3);
});

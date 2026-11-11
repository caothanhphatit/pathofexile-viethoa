// Build Planner ↔ Path of Building parity.
// The structural checks always run; the numeric check runs real PoB when it is
// installed locally (see scripts/check-pob-parity.mjs) and is skipped otherwise.
import assert from "node:assert/strict";
import test from "node:test";

import { buildPobXml, configXml } from "../src/server/pob-build-xml.mjs";
import { checkFixture, formatReport, pobRuntime, readFixtures } from "../scripts/check-pob-parity.mjs";
import { NodeDOMParser, plannerCalculationRequest } from "../scripts/lib/planner-node.mjs";

const fixtures = readFixtures();
const parse = (xml) => new NodeDOMParser().parseFromString(xml).documentElement;
const attrs = (element, keys) => Object.fromEntries(keys.map((key) => [key, element.getAttribute(key)]));
const activeSet = (root, container, child, attr) => {
  const element = root.querySelector(container);
  const sets = element ? element.querySelectorAll(child) : [];
  return sets.find((row) => row.getAttribute("id") === element.getAttribute(attr)) ?? sets[0];
};

test("parity fixtures are real PoB codes with PoB's own numbers", () => {
  assert.ok(fixtures.length >= 3, "tests/fixtures/pob-builds needs at least 3 builds");
  for (const fixture of fixtures) {
    assert.match(fixture.code, /^eN/, fixture.file);
    assert.ok(fixture.name && fixture.source, `${fixture.file} needs name and source`);
  }
});

for (const fixture of fixtures) {
  test(`planner keeps everything PoB calculates from: ${fixture.name}`, async () => {
    const { body, xml } = await plannerCalculationRequest(fixture.code);
    const original = parse(xml);
    const planner = parse(buildPobXml(body));

    // Skill groups: same count and order (disabled ones too), same gems, same settings.
    const gemKeys = ["gemId", "variantId", "level", "quality", "enabled", "corruptLevel"];
    const groups = (root) => activeSet(root, "Skills", "SkillSet", "activeSkillSet").querySelectorAll("Skill");
    const originalGroups = groups(original).filter((group) => group.querySelectorAll("Gem").length);
    const plannerGroups = groups(planner);
    assert.equal(plannerGroups.length, originalGroups.length, "socket group count");
    originalGroups.forEach((group, index) => {
      const mine = plannerGroups[index];
      assert.equal(mine.getAttribute("enabled"), group.getAttribute("enabled") === "false" ? "false" : "true", `group ${index + 1} enabled`);
      assert.equal(mine.getAttribute("slot"), group.getAttribute("slot"), `group ${index + 1} slot`);
      const sortGems = (rows) => rows.map((gem) => JSON.stringify(attrs(gem, gemKeys))).sort();
      assert.deepEqual(sortGems(mine.querySelectorAll("Gem")), sortGems(group.querySelectorAll("Gem")), `group ${index + 1} gems`);
    });

    // The main skill points at the same group.
    const mainIndex = (root, list) => Number(root.querySelector("Build").getAttribute("mainSocketGroup")) - 1;
    const originalMain = groups(original)[mainIndex(original)];
    const plannerMain = plannerGroups[mainIndex(planner)];
    assert.equal(plannerMain.querySelector("Gem").getAttribute("gemId"), originalMain.querySelectorAll("Gem")
      .find((gem) => plannerMain.querySelector("Gem").getAttribute("gemId") === gem.getAttribute("gemId"))?.getAttribute("gemId"), "main socket group");

    // Every worn item, in the same PoB slot, with the same text.
    const itemText = (root, id) => root.querySelectorAll("Item").find((item) => item.getAttribute("id") === id)?.textContent.replace(/\s+/g, " ").trim();
    const worn = (root) => Object.fromEntries(activeSet(root, "Items", "ItemSet", "activeItemSet").querySelectorAll("Slot")
      .filter((slot) => slot.getAttribute("itemId") !== "0")
      .map((slot) => [slot.getAttribute("name"), itemText(root, slot.getAttribute("itemId"))]));
    assert.deepEqual(worn(planner), worn(original), "worn items");

    // Passive tree: nodes, weapon-set nodes, jewel sockets.
    const spec = (root) => root.querySelector("Spec");
    for (const key of ["classId", "ascendClassId", "ascendancyInternalId"]) {
      assert.equal(spec(planner).getAttribute(key), spec(original).getAttribute(key), key);
    }
    for (const key of ["className", "ascendClassName", "level"]) {
      assert.equal(planner.querySelector("Build").getAttribute(key), original.querySelector("Build").getAttribute(key), key);
    }
    const ids = (value) => String(value || "").split(",").filter(Boolean).sort();
    assert.deepEqual(ids(spec(planner).getAttribute("nodes")), ids(spec(original).getAttribute("nodes")), "allocated nodes");
    for (const set of ["WeaponSet1", "WeaponSet2"]) {
      assert.deepEqual(ids(spec(planner).querySelector(set)?.getAttribute("nodes")), ids(spec(original).querySelector(set)?.getAttribute("nodes")), set);
    }
    const sockets = (root) => spec(root).querySelectorAll("Socket").map((socket) => `${socket.getAttribute("nodeId")}:${itemText(root, socket.getAttribute("itemId"))}`).sort();
    assert.deepEqual(sockets(planner), sockets(original), "jewel sockets");

    // Config: every Input of the active config set.
    const inputs = (root) => {
      const set = activeSet(root, "Config", "ConfigSet", "activeConfigSet");
      return (set ? set.querySelectorAll("Input") : []).map((input) => input.outerHTML.replace(/\s+/g, " ")).map((row) => {
        const element = parse(row);
        return `${element.getAttribute("name")}=${element.getAttribute("boolean") ?? element.getAttribute("number") ?? element.getAttribute("string")}`;
      }).sort();
    };
    assert.deepEqual(inputs(planner), inputs(original), "config inputs");
  });
}

test("calculation XML escapes and whitelists what the browser sends", () => {
  const xml = buildPobXml({
    className: "Witch\"><Evil/>",
    ascendancy: "Blood Mage",
    level: 500,
    passives: ["1", "2", "abc", -4],
    weapon_set_passives: { 1: ["5", "x"], 2: "6,7" },
    activeWeaponSet: 2,
    inventory_slots: [
      { inventory_id: "Weapon3", raw_text: "Rarity: Rare\nFoo </Item><Evil/>" },
      { inventory_id: "PobSlot:Arm 1", raw_text: "Rarity: Magic\nAugment" },
      { inventory_id: "PobSlot:Evil\"/>", raw_text: "Rarity: Magic\nDropped" },
      { inventory_id: "PassiveJewel:61419", raw_text: "Rarity: Rare\nJewel" }
    ],
    skills: [{
      skill_id: "Metadata/Items/Gems/SkillGemArc",
      pob_gem_id: "Metadata/Items/Gem/SkillGemArc\"/>",
      level: 99,
      quality: 20,
      group_enabled: false,
      main_active_skill: 9,
      pob_attrs: { corruptLevel: "1", onclick: "x", skillPart: "2\"<" },
      support: [{ skill_id: "SupportFoo", enabled: false }]
    }],
    main_socket_group: 7,
    config_inputs: [
      { name: "conditionEnemyShocked", kind: "boolean", value: true },
      { name: "conditionOff", kind: "boolean", value: false },
      { name: "enemyLevel", kind: "number", value: "83" },
      { name: "bad\"name", kind: "string", value: "<x>" }
    ]
  });
  const root = parse(xml);
  assert.equal(root.querySelector("Build").getAttribute("className"), "WitchEvil");
  assert.equal(root.querySelector("Build").getAttribute("level"), "100");
  assert.equal(root.querySelector("Build").getAttribute("mainSocketGroup"), "1");
  assert.equal(root.querySelector("Spec").getAttribute("nodes"), "1,2");
  assert.equal(root.querySelector("Spec").getAttribute("ascendancyInternalId"), "Witch2");
  assert.equal(root.querySelector("WeaponSet1").getAttribute("nodes"), "5");
  assert.equal(root.querySelector("WeaponSet2").getAttribute("nodes"), "6,7");
  assert.equal(root.querySelector("ItemSet").getAttribute("useSecondWeaponSet"), "true");
  assert.deepEqual(root.querySelectorAll("Slot").map((slot) => slot.getAttribute("name")), ["Weapon 1 Swap", "Arm 1"]);
  assert.equal(root.querySelectorAll("Evil").length, 0, "item text cannot inject elements");
  assert.equal(root.querySelector("Socket").getAttribute("nodeId"), "61419");
  const group = root.querySelector("Skill");
  assert.equal(group.getAttribute("enabled"), "false");
  assert.equal(group.getAttribute("mainActiveSkill"), "2");
  const [main, support] = group.querySelectorAll("Gem");
  assert.equal(main.getAttribute("gemId"), "Metadata/Items/Gem/SkillGemArc/", "quotes and brackets are stripped from ids");
  assert.equal(main.getAttribute("level"), "40");
  assert.equal(main.getAttribute("corruptLevel"), "1");
  assert.equal(main.getAttribute("skillPart"), "2");
  assert.equal(main.getAttribute("onclick"), null);
  assert.equal(support.getAttribute("gemId"), "Metadata/Items/Gems/SupportGemFoo");
  assert.equal(support.getAttribute("enabled"), "false");
  const inputs = root.querySelectorAll("Input").map((input) => [input.getAttribute("name"), input.getAttribute("boolean") ?? input.getAttribute("number") ?? input.getAttribute("string")]);
  assert.deepEqual(inputs, [["conditionEnemyShocked", "true"], ["enemyLevel", "83"], ["bad\"name", "<x>"]]);
  assert.equal(configXml([]), "");
});

test("calculation XML still accepts the raw <Config> of older clients, and nothing else", () => {
  assert.match(buildPobXml({ config: "<Config><Input name=\"a\" boolean=\"true\"/></Config>" }), /<Input name="a"/);
  assert.doesNotMatch(buildPobXml({ config: "</PathOfBuilding2><Evil/>" }), /<Evil/);
});

const runtime = pobRuntime();
test("planner numbers match Path of Building on every fixture", {
  skip: runtime.available ? false : `PoB not installed locally (${runtime.coreDir}); run scripts/setup-pob-local.mjs`,
  timeout: 300_000
}, async () => {
  const results = [];
  for (const fixture of fixtures) results.push(await checkFixture(fixture, runtime));
  const failed = results.filter((result) => !result.ok);
  assert.equal(failed.length, 0, formatReport(failed));
});

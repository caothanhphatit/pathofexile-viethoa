// Build Planner ↔ Path of Building parity.
// The structural checks always run; the numeric check runs real PoB when it is
// installed locally (see scripts/check-pob-parity.mjs) and is skipped otherwise.
import assert from "node:assert/strict";
import test from "node:test";

import { buildPobXml, configXml } from "../src/server/pob-build-xml.mjs";
import { checkFixture, compareStats, formatReport, pobRuntime, readFixtures } from "../scripts/check-pob-parity.mjs";
import { NodeDOMParser, loadPlannerLib, loadSpaLib, plannerCalculationRequest } from "../scripts/lib/planner-node.mjs";

const fixtures = readFixtures();
const plain = (value) => JSON.parse(JSON.stringify(value));
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
    // Attribute picks (PoB's AttributeOverride), each list in any order.
    const overrides = (root) => {
      const element = spec(root).querySelector("AttributeOverride");
      return Object.fromEntries(["strNodes", "dexNodes", "intNodes"].map((key) => [key, ids(element?.getAttribute(key))]));
    };
    assert.deepEqual(overrides(planner), overrides(original), "attribute overrides");
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

test("stat breakdown requests ride in the build XML, whitelisted", async () => {
  const { plannerRequestXml, BREAKDOWN_STATS } = await import("../src/server/pob-breakdown.mjs");
  assert.equal(plannerRequestXml(null), "");
  assert.equal(plannerRequestXml({ breakdown: ["Nope"] }), "");
  assert.equal(plannerRequestXml({ breakdown: ["Life", "CritChance", "Life", "Evil\"/>"] }), '\n\t<PlannerRequest breakdown="Life,CritChance"/>');
  assert.ok(BREAKDOWN_STATS.includes("CombinedDPS"));
  assert.match(buildPobXml({ className: "Witch", analysis: { breakdown: ["Life"] } }), /<PlannerRequest breakdown="Life"\/>\n<\/PathOfBuilding2>/);
  assert.doesNotMatch(buildPobXml({ className: "Witch" }), /PlannerRequest/);
});

test("one PoB run explains where stats come from", {
  skip: runtime.available ? false : "PoB not installed locally",
  timeout: 120_000
}, async () => {
  const { runPob } = await import("../scripts/check-pob-parity.mjs");
  const [fixture] = readFixtures(["mercenary-gemling.json"]);
  const { body } = await plannerCalculationRequest(fixture.code);
  const out = await runPob(buildPobXml({ ...body, analysis: { breakdown: ["Life", "FireResist", "CritChance", "CombinedDPS"] } }), runtime);
  const life = out.Breakdown.Life;
  assert.equal(life.value, out.Life);
  assert.ok(life.lines.some((line) => /\(base\)/.test(line)), "PoB's own breakdown lines");
  assert.ok(life.sources.some((row) => row.kind === "item" && row.type === "BASE" && row.label), "Life from named items");
  assert.ok(out.Breakdown.FireResist.sources.some((row) => row.kind === "quest"), "resistance from quests");
  assert.ok(out.Breakdown.CritChance.sources.some((row) => row.kind === "tree" && row.type === "INC"), "crit from passives");
  assert.ok(out.Breakdown.CombinedDPS.sources.length > 0);
  assert.equal(out.NodeDeltas, undefined);
  assert.equal(Math.round(out.CombinedDPS), Math.round((await runPob(buildPobXml(body), runtime)).CombinedDPS), "asking for a breakdown does not change the numbers");
});

// ── Tree editing round trips (weapon sets, attributes, jewels) ─────────────

const socketsOf = (xml) => parse(xml).querySelector("Spec").querySelectorAll("Socket").map((row) => row.getAttribute("nodeId")).sort();
/** Sockets as "node:item text", worn slots as "slot:item text", and the rest of the XML without items. */
const buildShape = (xml) => {
  const root = parse(xml);
  const text = (id) => root.querySelectorAll("Item").find((item) => item.getAttribute("id") === id)?.textContent.trim();
  return {
    sockets: root.querySelector("Spec").querySelectorAll("Socket").map((row) => `${row.getAttribute("nodeId")}:${text(row.getAttribute("itemId"))}`).sort(),
    slots: root.querySelectorAll("Slot").map((row) => `${row.getAttribute("name")}:${text(row.getAttribute("itemId"))}`).sort(),
    rest: xml.replace(/<Items[\s\S]*<\/Items>/, "").replace(/<Sockets>[\s\S]*<\/Sockets>/, "")
  };
};
const isAllocatedSocket = (body, row) => {
  const nodeId = row.inventoryId.replace(/^PassiveJewel:/, "");
  return row.inventoryId.startsWith("PassiveJewel:") && body.passives.includes(Number(nodeId)) ? nodeId : "";
};

test("weapon-set and attribute picks survive the PoB-code export and a re-import", async () => {
  const lib = await loadPlannerLib();
  for (const fixture of readFixtures(["mercenary-gemling.json", "sorceress-stormweaver.json"])) {
    const { tree, bodyFor } = await plannerCalculationRequest(fixture.code);
    assert.ok(Object.keys(tree.weaponSets).length > 0, `${fixture.file} has weapon-set passives`);
    // Change the picks the way the tree does: one attribute node to Dex, one set node to set 2.
    const attributeNode = Object.keys(tree.attributeChoices)[0];
    const setNode = Object.keys(tree.weaponSets).find((id) => tree.weaponSets[id] === 1);
    const attributeChoices = { ...tree.attributeChoices, [attributeNode]: "dex" };
    const weaponSets = { ...tree.weaponSets, [setNode]: 2 };
    const body = bodyFor({ attributeChoices, weaponSets });
    const code = await lib.encodePobXmlText(buildPobXml(body));
    const back = lib.treePicksFromPobImport(await lib.parsePobExportCode(code));
    assert.deepEqual(plain(back.weaponSets), plain(lib.createTreeSnapshot({ ...tree, weaponSets }).weaponSets), "weapon sets after export + import");
    assert.deepEqual(plain(back.attributeChoices), plain(attributeChoices), "attributes after export + import");
    assert.match(parse(buildPobXml(body)).querySelector("AttributeOverride").getAttribute("dexNodes"), new RegExp(`(^|,)${attributeNode}(,|$)`));
  }
});

test("a jewel taken out of its socket and put back gives the same XML", async () => {
  const inv = await loadSpaLib("buildInventory");
  let checked = 0;
  for (const fixture of fixtures) {
    const { body, inventory, project, bodyFor } = await plannerCalculationRequest(fixture.code);
    const row = inventory.find((choice) => isAllocatedSocket(body, choice));
    if (!row) continue;
    const nodeId = isAllocatedSocket(body, row);
    const removed = inv.unsocketJewel({ inventory, stash: project.stash }, nodeId);
    const restored = inv.socketJewel(removed, removed.stash[0].id, nodeId);
    assert.deepEqual(socketsOf(buildPobXml(bodyFor({ inventory: removed.inventory }))), socketsOf(buildPobXml(body)).filter((id) => id !== nodeId));
    assert.deepEqual(buildShape(buildPobXml(bodyFor({ inventory: restored.inventory }))), buildShape(buildPobXml(body)), `${fixture.file}: same build after the round trip`);
    checked += 1;
  }
  assert.ok(checked > 0, "at least one fixture has a socketed jewel");
});

test("socketing a jewel in the planner moves the numbers exactly as PoB does", {
  skip: runtime.available ? false : "PoB not installed locally",
  timeout: 300_000
}, async () => {
  const { runPob } = await import("../scripts/check-pob-parity.mjs");
  const inv = await loadSpaLib("buildInventory");
  const fixture = fixtures.find((row) => row.file === "mercenary-gemling.json") ?? fixtures[0];
  const { body, inventory, project, bodyFor, xml } = await plannerCalculationRequest(fixture.code);
  // The jewel that matters most is not known up front: take the first allocated socket.
  const row = inventory.find((choice) => isAllocatedSocket(body, choice));
  assert.ok(row, "fixture has a socketed jewel");
  const nodeId = isAllocatedSocket(body, row);
  const removed = inv.unsocketJewel({ inventory, stash: project.stash }, nodeId);
  const restored = inv.socketJewel(removed, removed.stash[0].id, nodeId);
  const [pobOwn, before, without, withAgain] = await Promise.all([
    runPob(xml, runtime),
    runPob(buildPobXml(body), runtime),
    runPob(buildPobXml(bodyFor({ inventory: removed.inventory })), runtime),
    runPob(buildPobXml(bodyFor({ inventory: restored.inventory })), runtime)
  ]);
  const stats = ["CombinedDPS", "Life", "EnergyShield", "Mana", "Spirit", "Str", "Dex", "Int", "FireResist", "ColdResist", "LightningResist", "ChaosResist", "TotalEHP"];
  for (const stat of stats) assert.equal(withAgain[stat], before[stat], `${stat}: the numbers come back once the jewel is put back`);
  assert.ok(stats.some((stat) => without[stat] !== before[stat]), "taking the jewel out changes something");
  const rows = compareStats({ code: {}, pob: pobOwn, planner: withAgain });
  assert.ok(rows.every((row) => row.plannerOk), `jewel put back in the planner = PoB on the code itself: ${JSON.stringify(rows.filter((row) => !row.plannerOk))}`);
});

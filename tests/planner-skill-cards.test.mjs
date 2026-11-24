// Build Planner skill cards and import parity: whose damage a card shows, Companion /
// Spectre monsters, support gem families, what a PoB code keeps through the planner.
// The checks against real Path of Building run when it is installed locally
// (scripts/setup-pob-local.mjs; POB_CORE_DIR), as in pob-parity.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { buildPobXml, configXml } from "../src/server/pob-build-xml.mjs";
import { supportFamilies, supportFamilyClash, supportFamilyConflicts } from "../src/server/pob-gem-families.mjs";
import { POB_GEMS } from "../src/server/pob-gem-ids.mjs";
import { MONSTER_GEMS, monsterGemTitle, monsterLibraryOf } from "../src/server/pob-monster-gems.mjs";
import { POB_MONSTERS, isRecommendedMonster, monsterById, monsterGemPatch, monstersForLibrary } from "../src/server/pob-monsters.mjs";
import { nodeDeltasFromOutput, nodeDeltasXml } from "../src/server/pob-node-deltas.mjs";
import { pobRuntime, readFixtures, runPob } from "../scripts/check-pob-parity.mjs";
import { NodeDOMParser, loadPlannerLib, loadSpaLib, plannerCalculationRequest } from "../scripts/lib/planner-node.mjs";
import { parseSkillFamilies, parseSpectresLua, parseSupportGems } from "../scripts/refresh-pob-planner-data.mjs";

const runtime = pobRuntime();
const needsPob = { skip: runtime.available ? false : `PoB not installed locally (${runtime.coreDir}); run scripts/setup-pob-local.mjs`, timeout: 600_000 };
const fixture = (file) => readFixtures([file])[0];
const plain = (value) => JSON.parse(JSON.stringify(value));
const parse = (xml) => new NodeDOMParser().parseFromString(xml).documentElement;
const pool = async (jobs, size = 4) => {
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await jobs[index]();
    }
  }));
  return results;
};

// ── Whose damage a card shows ───────────────────────────────────────────────

test("a card names the skills its number belongs to, never another skill under its own name", async () => {
  const stats = await loadSpaLib("buildStats");
  const skills = [{ skillId: "CastOnCritical" }, { skillId: "" }, { skillId: "Enfeeble" }, { skillId: "Spark" }, { skillId: "WindDancer" }];
  const damage = stats.groupDamageByRow({
    // Cast on Critical with Comet and Arc socketed: the meta gem itself deals nothing.
    1: { dps: 462817, skills: [
      { name: "Cast on Critical", gem: 1, value: 0 },
      { name: "Comet", gem: 2, value: 157901 },
      { name: "Arc", gem: 3, value: 304916 }
    ] },
    // A curse whose support grants a damaging skill.
    2: { dps: 252000, skills: [{ name: "Enfeeble", gem: 1, value: 0 }, { name: "Dark Consequences", gem: 3, value: 252000 }] },
    3: { dps: 685409, skills: [{ name: "Spark", gem: 1, value: 685409 }] },
    // A gem's own second skill, and a per-hit skill with a count.
    4: { dps: 109114, average: 800, skills: [{ name: "Wind Dancer", gem: 1, value: 0 }, { name: "Gale Force", gem: 1, value: 109114 }, { name: "Explosion", gem: 1, value: 400, count: 2, average: true }] }
  }, skills);
  assert.equal(damage[1], undefined, "an empty group has no row");
  const [coc, , enfeeble, spark, wind] = damage.map((entry) => stats.cardDamageLines(entry));

  assert.deepEqual(plain(coc.map((line) => [line.name, line.value, line.own])), [["Arc", 304916, false], ["Comet", 157901, false]], "highest first, the meta gem itself is not listed");
  assert.equal(stats.cardDamageNeedsNames(coc), true);
  assert.equal(stats.cardDamageOwners(coc), "Arc, Comet");

  assert.deepEqual(plain(enfeeble.map((line) => [line.name, line.own])), [["Dark Consequences", false]]);
  assert.equal(stats.cardDamageNeedsNames(enfeeble), true, "damage on a curse card is labelled as the granted skill");

  assert.deepEqual(plain(spark.map((line) => [line.name, line.own])), [["Spark", true]]);
  assert.equal(stats.cardDamageNeedsNames(spark), false, "a card whose number is its own skill needs no list");

  assert.deepEqual(plain(wind.map((line) => [line.name, line.value, line.perHit])), [["Gale Force", 109114, false], ["Explosion", 800, true]], "per-hit lines last, count applied");
  assert.equal(stats.cardDamageNeedsNames(wind), true, "the gem's own first skill (Wind Dancer) deals none: Gale Force is named");

  // An older calculator sends no gem numbers: the first skill is the card's own.
  const old = stats.cardDamageLines(stats.groupDamageByRow({ 1: { dps: 5, skills: [{ name: "Arc", value: 5 }] } }, [{ skillId: "Arc" }])[0]);
  assert.equal(stats.cardDamageNeedsNames(old), false);
  assert.deepEqual(plain(stats.cardDamageLines(undefined)), []);
  assert.equal(stats.cardDamageOwners([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "A" }], 3), "A, B, C, +1");
});

test("an item-granted group folded into the player's own group for the same skill shows one card", async () => {
  const stats = await loadSpaLib("buildStats");
  const group = (pobSkillId, extra = {}) => ({ skillId: `Metadata/Items/Gems/${pobSkillId}`, pobSkillId, supportSkills: [], ...extra });
  const skills = [
    group("ShieldBlockPlayer"),                                                        // 0: the exporter's own Raise Shield
    group("ShieldBlockPlayer"),                                                        // 1: ... one per weapon set
    group("SunderPlayer", { supportSkills: [{ skillId: "SupportDefy" }] }),            // 2
    group("PurityOfFirePlayer", { supportSkills: [{ skillId: "SupportClarity" }] }),   // 3: player's group, with supports
    group("ShieldBlockPlayer", { itemSlot: "Weapon 2", itemSource: "Item:15:Shield" }),       // 4
    group("ShieldBlockPlayer", { itemSlot: "Weapon 2 Swap", itemSource: "Item:17:Targe" }),   // 5
    group("PurityOfFirePlayer", { itemSlot: "Weapon 1", itemSource: "Item:3:Sceptre" }),      // 6
    group("ChaosBoltPlayer", { itemSlot: "Weapon 1", itemSource: "Item:3:Wand" }),            // 7: no player twin
    group("ThornsPlayer", { itemSource: "Tree:123" })                                         // 8: tree-granted
  ];
  assert.deepEqual([...stats.foldedGrantedGroups(skills)].sort(), [4, 5, 6], "each granted twin is hidden, the player's cards stay");
  assert.deepEqual([...stats.foldedGrantedGroups(skills, 6)].sort(), [4, 5], "the main group is never hidden");
  assert.deepEqual([...stats.foldedGrantedGroups(skills.slice(1))].sort(), [3, 5], "one player group folds one granted group");
  assert.deepEqual([...stats.foldedGrantedGroups([{ ...skills[0], disabled: true }, skills[4]])], [], "a disabled player group folds nothing");
});

test("numbers stamped in a PoB code are only a fallback; chaos resistance reads as PoB shows it", async () => {
  const stats = await loadSpaLib("buildStats");
  const usable = (calculated, calculating, failed) => stats.stampedStatsUsable({ calculated, calculating, failed });
  assert.equal(usable(false, false, false), false, "right after import: wait for our own calculation");
  assert.equal(usable(false, true, false), false);
  assert.equal(usable(true, false, false), false);
  assert.equal(usable(false, false, true), true, "calculator unreachable: the code's numbers are better than none");
  assert.equal(usable(true, false, true), false);

  assert.equal(stats.resistanceText({ ChaosResist: 5, ChaosInoculation: true }, "ChaosResist", "vi"), "Miễn nhiễm");
  assert.equal(stats.resistanceText({ ChaosResist: 5, ChaosInoculation: true }, "ChaosResist", "en"), "Immune");
  assert.equal(stats.resistanceText({ ChaosResist: 67.4, ChaosInoculation: false }, "ChaosResist", "vi"), "67%");
  assert.equal(stats.resistanceText({ FireResist: 75, ChaosInoculation: true }, "FireResist", "vi"), "75%", "only chaos is immune");
  assert.equal(stats.resistanceText(null, "ChaosResist", "vi"), undefined);
  assert.equal(stats.resistanceText(null, "ChaosResist", "vi", 43), "43%");
});

// ── Support gem families ────────────────────────────────────────────────────

test("support families come from PoB's data: two of one family on a skill are reported", () => {
  const ARM2 = "Metadata/Items/Gems/SupportGemPrimalArmamentTwo";
  const ARM3 = "Metadata/Items/Gems/SupportGemPrimalArmamentThree";
  assert.deepEqual(supportFamilies(ARM2), ["ElementalArmament"]);
  assert.deepEqual(supportFamilies(ARM3), supportFamilies(ARM2));
  assert.deepEqual(supportFamilies("", "Elemental Armament III"), ["ElementalArmament"], "by name when the id is unknown");
  assert.deepEqual(supportFamilies("Metadata/Items/Gem/SupportGemPrimalArmamentTwo"), ["ElementalArmament"], "Gem/ and Gems/ are the same gem");
  assert.deepEqual(supportFamilies("Metadata/Items/Gems/SkillGemArc"), [], "an active skill has no support family");

  const gems = [
    { id: "Metadata/Items/Gems/SupportGemMartialTempoTwo" },
    { id: ARM2 },
    { id: "" },
    { id: ARM3 },
    { id: "Metadata/Items/Gems/SupportGemCloseCombatTwo" }
  ];
  assert.deepEqual(supportFamilyConflicts(gems), [{ family: "ElementalArmament", gems: [1, 3], kept: 3 }], "PoB keeps the later one");
  assert.deepEqual(supportFamilyConflicts([gems[1], { ...gems[3], disabled: true }]), [], "a disabled gem does not count");
  assert.deepEqual(supportFamilyConflicts([gems[0], gems[1], gems[4]]), []);
  assert.deepEqual(supportFamilyClash([gems[0], gems[1]], { id: ARM3 }), { index: 1, family: "ElementalArmament" });
  assert.equal(supportFamilyClash([gems[0]], { id: ARM3 }), null);

  // Every support family PoB lists belongs to a support gem PoB knows.
  const known = new Map(POB_GEMS.map((gem) => [gem.id, gem]));
  let withFamily = 0;
  for (const gem of POB_GEMS.filter((row) => row.support)) if (supportFamilies(gem.id).length) withFamily += 1;
  assert.ok(withFamily > 300, `${withFamily} support gems have a family`);
  assert.ok(known.get(ARM2)?.support);
});

test("the PoB data parsers read PoB's Lua tables", () => {
  const spectres = parseSpectresLua([
    "minions[\"Metadata/Monsters/A/A\"] = {",
    "\tname = \"Alpha Wolf\",",
    "\textraFlags = {",
    "\t\trecommendedBeast = true,",
    "\t},",
    "\tmonsterCategory = \"Beast\",",
    "}",
    "",
    "minions[\"Metadata/Monsters/B/B\"] = {",
    "\tname = \"Bone Mage\",",
    "\tmonsterCategory = \"Undead\",",
    "}",
    ""
  ].join("\n"));
  assert.deepEqual(spectres, [["Metadata/Monsters/A/A", "Alpha Wolf", "Beast", "b"], ["Metadata/Monsters/B/B", "Bone Mage", "Undead"]]);
  assert.deepEqual(parseSkillFamilies("skills[\"SupportX\"] = {\n\tname = \"X\",\n\tgemFamily = { \"Alpha\",\"Beta\",},\n}\nskills[\"Y\"] = {\n\tname = \"Y\",\n}\n"), { SupportX: ["Alpha", "Beta"] });
  assert.deepEqual(parseSupportGems("return {\n\t[\"Metadata/Items/Gems/SkillGemXSupport\"] = {\n\t\tname = \"X\",\n\t\tgameId = \"Metadata/Items/Gems/SupportGemX\",\n\t\tgrantedEffectId = \"SupportX\",\n\t\tgemType = \"Support\",\n\t},\n\t[\"Metadata/Items/Gems/SkillGemArc\"] = {\n\t\tname = \"Arc\",\n\t\tgrantedEffectId = \"ArcPlayer\",\n\t\tgemType = \"Spell\",\n\t},\n}\n"), [["Metadata/Items/Gems/SupportGemX", "SupportX"]]);
});

// ── Companion / Spectre monsters ────────────────────────────────────────────

test("Companion and Spectre gems pick a monster from PoB's list", () => {
  // PoB's two monster gems exist under the ids and names this module relies on.
  const gem = (id) => POB_GEMS.find((row) => row.id === id);
  assert.equal(gem(MONSTER_GEMS.spectre.gemId)?.name, "Spectre: {0}");
  assert.equal(gem(MONSTER_GEMS.beast.gemId)?.name, "Companion: {0}");

  assert.equal(monsterLibraryOf({ pobGemId: MONSTER_GEMS.beast.gemId, skillId: MONSTER_GEMS.beast.gemId, nameSpec: "Companion: Elephant Tortoise" }), "beast");
  assert.equal(monsterLibraryOf({ skillId: "Metadata/Items/Gems/SkillGemSummonSpectre" }), "spectre");
  assert.equal(monsterLibraryOf({ skillId: "Metadata/Items/Gems/SkillGemBindSpectre" }), "spectre", "Bind Spectre becomes a Spectre gem");
  assert.equal(monsterLibraryOf({ skillId: "Metadata/Items/Gem/SkillGemTameBeast" }), "beast", "Tame Beast becomes a Companion gem");
  assert.equal(monsterLibraryOf({ skillId: "Metadata/Items/Gems/SkillGemHyenaCackle", nameSpec: "Cackling Companions" }), null);
  assert.equal(monsterLibraryOf({ skillId: "Metadata/Items/Gems/SkillGemArc" }), null);
  assert.equal(monsterLibraryOf(null), null);
  assert.equal(monsterGemTitle({ pobGemId: MONSTER_GEMS.beast.gemId, nameSpec: "Companion: Elephant Tortoise" }), "Companion: Elephant Tortoise");
  assert.equal(monsterGemTitle({ pobGemId: MONSTER_GEMS.beast.gemId, nameSpec: "Companion: {0}" }), "", "no monster yet");
  assert.equal(monsterGemTitle({ skillId: "Metadata/Items/Gems/SkillGemArc", nameSpec: "Arc" }), "");

  assert.ok(POB_MONSTERS.length > 500, `${POB_MONSTERS.length} monsters`);
  const beasts = monstersForLibrary("beast");
  const spectres = monstersForLibrary("spectre");
  assert.ok(beasts.length > 100 && beasts.every((monster) => monster.category === "Beast"), "a Companion is a beast (PoB's library window)");
  assert.equal(spectres.length, POB_MONSTERS.length, "any monster can be a Spectre");
  const firstOther = beasts.findIndex((monster) => !isRecommendedMonster(monster, "beast"));
  assert.ok(firstOther > 0 && beasts.slice(firstOther).every((monster) => !isRecommendedMonster(monster, "beast")), "PoB's recommended beasts first");

  const tortoise = POB_MONSTERS.find((monster) => monster.name === "Elephant Tortoise");
  assert.equal(monsterById(tortoise.id), tortoise);
  assert.deepEqual(monsterGemPatch("beast", tortoise.id), {
    pobGemId: "Metadata/Items/Gems/SkillGemSummonBeast", pobSkillId: "SummonBeastPlayer", pobVariantId: "SummonBeast", nameSpec: "Companion: Elephant Tortoise"
  });
  assert.equal(monsterGemPatch("spectre", "Metadata/Monsters/Nope"), null);
});

test("the build XML carries the monster libraries: the imported ones and every picked monster", () => {
  const xml = buildPobXml({
    className: "Witch",
    spectres: ["Metadata/Monsters/Skeletons/SkeletonMage", "Metadata/Monsters/Skeletons/SkeletonMage", "bad\"/><Evil x=\""],
    beasts: ["Metadata/Monsters/ElephantRhino/ElephantRhino"],
    skills: [
      { skill_id: "Metadata/Items/Gems/SkillGemSummonBeast", pob_gem_id: "Metadata/Items/Gems/SkillGemSummonBeast", name_spec: "Companion: Pack Werewolf", pob_attrs: { skillMinion: "Metadata/Monsters/Werewolves/WerewolfPack1" } },
      // Picked on a Bind Spectre card: the gem is PoB's Spectre gem now.
      { skill_id: "Metadata/Items/Gems/SkillGemBindSpectre", pob_gem_id: "Metadata/Items/Gems/SkillGemSummonSpectre", pob_skill_id: "SummonSpectrePlayer", pob_attrs: { skillMinion: "Metadata/Monsters/Vaal/Golem", skillMinionCalcs: "Metadata/Monsters/Vaal/Golem" } },
      // A minion pick on an ordinary minion gem is not a library monster.
      { skill_id: "Metadata/Items/Gems/SkillGemSkeletalSniper", pob_attrs: { skillMinion: "SkeletalSniper" } }
    ]
  });
  const build = parse(xml).querySelector("Build");
  assert.deepEqual(build.querySelectorAll("Spectre").map((row) => row.getAttribute("id")), ["Metadata/Monsters/Skeletons/SkeletonMage", "bad/Evil x", "Metadata/Monsters/Vaal/Golem"]);
  assert.deepEqual(build.querySelectorAll("BeastCompanion").map((row) => row.getAttribute("id")), ["Metadata/Monsters/ElephantRhino/ElephantRhino", "Metadata/Monsters/Werewolves/WerewolfPack1"]);
  assert.equal(parse(xml).querySelectorAll("Evil").length, 0);
  const gems = parse(xml).querySelectorAll("Gem");
  assert.equal(gems[1].getAttribute("gemId"), "Metadata/Items/Gems/SkillGemSummonSpectre");
  assert.equal(gems[1].getAttribute("skillMinion"), "Metadata/Monsters/Vaal/Golem");
  assert.doesNotMatch(buildPobXml({ className: "Witch" }), /<Spectre|<BeastCompanion/);
});

test("a config input the build turns off stays off (PoB's default for it may be on)", () => {
  const xml = configXml([
    { name: "questAct 4Eye of HinekoraSilent Hall", kind: "boolean", value: false },
    { name: "conditionEnemyShocked", kind: "boolean", value: true }
  ]);
  assert.match(xml, /<Input name="questAct 4Eye of HinekoraSilent Hall" boolean="false"\/>/);
  assert.match(xml, /<Input name="conditionEnemyShocked" boolean="true"\/>/);
});

test("a PoB code's monster libraries and switched-off inputs survive the import", async () => {
  const lib = await loadPlannerLib();
  const beasts = ["Metadata/Monsters/ArmadilloDemon/ArmadilloDemon", "Metadata/Monsters/ElephantRhino/ElephantRhino"];
  const data = lib.parsePobXmlText(`<?xml version="1.0"?>
<PathOfBuilding2>
  <Build level="90" className="Witch" ascendClassName="Lich" mainSocketGroup="1">
    <Spectre id="Metadata/Monsters/Skeletons/SkeletonMage"/>
    <BeastCompanion id="${beasts[0]}"/>
    <BeastCompanion id="${beasts[1]}"/>
    <BeastCompanion id="${beasts[1]}"/>
    <PlayerStat stat="Life" value="1000"/>
  </Build>
  <Skills activeSkillSet="1"><SkillSet id="1">
    <Skill enabled="true" mainActiveSkill="1">
      <Gem gemId="Metadata/Items/Gems/SkillGemSummonBeast" skillId="SummonBeastPlayer" nameSpec="Companion: Elephant Tortoise" level="20" quality="0" enabled="true" skillMinion="${beasts[1]}" skillMinionCalcs="${beasts[1]}"/>
    </Skill>
  </SkillSet></Skills>
  <Config activeConfigSet="1"><ConfigSet id="1">
    <Input name="questAct 4Eye of HinekoraSilent Hall" boolean="false"/>
  </ConfigSet></Config>
</PathOfBuilding2>`);
  assert.deepEqual(plain(data.build.beasts), beasts);
  assert.deepEqual(plain(data.build.spectres), ["Metadata/Monsters/Skeletons/SkeletonMage"]);
  const payload = lib.buildPayloadFromPobImport(data);
  assert.deepEqual(plain(payload.pob_beasts), beasts);
  const skills = lib.skillChoicesFromBuildPayload(payload);
  assert.equal(skills[0].pobAttrs.skillMinion, beasts[1]);
  assert.equal(skills[0].nameSpec, "Companion: Elephant Tortoise", "the beast's name is kept");
  const body = lib.calculationRequestBody({ payload, passives: [], inventory: [], skills, activeWeaponSet: 1, mainSocketGroup: 1 });
  assert.deepEqual(plain(body.beasts), beasts);
  const root = parse(buildPobXml(plain(body)));
  assert.deepEqual(root.querySelector("Build").querySelectorAll("BeastCompanion").map((row) => row.getAttribute("id")), beasts);
  assert.equal(root.querySelector("Input").getAttribute("boolean"), "false");
});

// ── Against real Path of Building ───────────────────────────────────────────

/** Every number PoB reports for the build, flattened: "Life", "Minion.Life", ... */
const numbers = (stats) => {
  const out = {};
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === "number") out[key] = value;
    else if (key === "Minion" && value && typeof value === "object") {
      for (const [stat, number] of Object.entries(value)) if (typeof number === "number") out[`Minion.${stat}`] = number;
    }
  }
  return out;
};
// The planner asks for every group's damage (includeInFullDPS); the code's own XML may not.
const FULL_DPS_ONLY = /^(FullDPS|FullDotDPS)$/;

test("every number PoB calculates is the same for a PoB code and for that code imported into the planner", needsPob, async () => {
  const fixtures = readFixtures();
  const rows = await pool(fixtures.map((row) => async () => {
    const { body, xml } = await plannerCalculationRequest(row.code);
    const [pob, planner] = await Promise.all([runPob(xml, runtime), runPob(buildPobXml(body), runtime)]);
    return { file: row.file, pob: numbers(pob), planner: numbers(planner) };
  }));
  const problems = [];
  for (const { file, pob, planner } of rows) {
    // The main skill's damage first: the number the page's header and card show.
    for (const stat of ["CombinedDPS", "TotalDPS", "AverageDamage", "TotalDot", "Minion.CombinedDPS"]) {
      const a = pob[stat] ?? 0;
      const b = planner[stat] ?? 0;
      if (Math.abs(a - b) > Math.max(1e-6, Math.abs(a) * 1e-6)) problems.push(`${file}: main skill ${stat} PoB ${a} / planner ${b}`);
    }
    for (const stat of new Set([...Object.keys(pob), ...Object.keys(planner)])) {
      if (FULL_DPS_ONLY.test(stat)) continue;
      const a = pob[stat];
      const b = planner[stat];
      if (a === b) continue;
      // A stat only one side reports with value 0 (PoB omits unset limits) is not a difference.
      if ((a === undefined && b === 0) || (b === undefined && a === 0)) continue;
      if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-6)) continue;
      problems.push(`${file}: ${stat} PoB ${a} / planner ${b}`);
    }
  }
  assert.deepEqual(problems, [], "the planner must not lose or change anything PoB calculates from");
  // The builds that used to differ are among the fixtures.
  const byFile = Object.fromEntries(rows.map((row) => [row.file, row]));
  assert.ok(byFile["lich-companions.json"].pob.TotalCompanionLife > 0, "a companion build (its life counts towards EHP)");
  assert.ok(byFile["lich-companions.json"].planner["Minion.CombinedDPS"] > 0, "the companion deals damage after the import");
  assert.ok(byFile["titan-shield-sunder.json"].pob.BlockChance > 0, "a shield build");
});

test("companions keep their beast through the import and another beast can be picked", needsPob, async () => {
  const stats = await loadSpaLib("buildStats");
  const gemOptions = await loadSpaLib("gemOptions");
  const { body } = await plannerCalculationRequest(fixture("lich-companions.json").code);
  const out = await runPob(buildPobXml(body), runtime);
  assert.equal(out.Minion?.Name, "Elephant Tortoise");
  const groups = body.skills.map((group) => ({ skillId: group.skill_id }));
  const lines = stats.groupDamageByRow(out.GroupDPS, groups).map((entry) => stats.cardDamageLines(entry));
  const companions = lines.flat().filter((line) => line.name.startsWith("Companion: "));
  assert.deepEqual(companions.map((line) => line.name).sort(), ["Companion: Antlion Charger", "Companion: Elephant Tortoise"], "each card is named after its beast");
  assert.ok(companions.every((line) => line.value > 10_000 && line.minion && line.own), JSON.stringify(companions));

  // Pick Pack Werewolf on the main companion card, as the selector does.
  const werewolf = POB_MONSTERS.find((monster) => monster.name === "Pack Werewolf");
  const mainIndex = Number(body.main_socket_group) - 1;
  const edited = structuredClone(body);
  const gem = edited.skills[mainIndex];
  assert.equal(monsterLibraryOf({ pobGemId: gem.pob_gem_id, skillId: gem.skill_id, nameSpec: gem.name_spec }), "beast");
  const patch = monsterGemPatch("beast", werewolf.id);
  Object.assign(gem, { pob_gem_id: patch.pobGemId, pob_skill_id: patch.pobSkillId, pob_variant_id: patch.pobVariantId, name_spec: patch.nameSpec });
  gem.pob_attrs = gemOptions.withGemOption(gem.pob_attrs, { kind: "minion", value: werewolf.id });
  const after = await runPob(buildPobXml(edited), runtime);
  assert.equal(after.Minion?.Name, "Pack Werewolf", "a beast that was not in the imported library");
  assert.ok(after.Minion.CombinedDPS > 0 && after.Minion.CombinedDPS !== out.Minion.CombinedDPS);
  assert.ok(after.GroupDPS[String(mainIndex + 1)].skills.some((skill) => skill.name === "Companion: Pack Werewolf" && skill.value > 0));

  // Without a library and without a pick the gem has no monster: no damage (PoB's own rule).
  const bare = structuredClone(body);
  delete bare.beasts;
  for (const group of bare.skills) if (group.pob_attrs) { delete group.pob_attrs.skillMinion; delete group.pob_attrs.skillMinionCalcs; }
  const none = await runPob(buildPobXml(bare), runtime);
  assert.ok(!(none.Minion?.CombinedDPS > 0), "no monster, no damage");
});

test("a trigger group's damage is listed per triggered spell, under PoB's names", needsPob, async () => {
  const stats = await loadSpaLib("buildStats");
  const { body } = await plannerCalculationRequest(fixture("stormweaver-cast-on-critical.json").code);
  const out = await runPob(buildPobXml(body), runtime);
  assert.equal(out.ChaosInoculation, true, "a Chaos Inoculation build: chaos resistance reads Immune");
  assert.equal(stats.resistanceText(out, "ChaosResist", "en"), "Immune");
  const row = body.skills.findIndex((group) => /Cast on Critical/.test(group.name_spec) && (group.support ?? []).some((gem) => gem.name_spec === "Comet"));
  assert.ok(row >= 0, "the Cast on Critical group");
  const entry = out.GroupDPS[String(row + 1)];
  const byName = Object.fromEntries(entry.skills.map((skill) => [skill.name, skill]));
  assert.equal(byName["Cast on Critical"].gem, 1);
  assert.equal(byName["Cast on Critical"].value, 0, "the meta gem deals none itself");
  assert.ok(byName.Comet.value > 0 && byName.Comet.gem > 1 && byName.Arc.value > 0 && byName.Arc.gem > 1);
  assert.ok(Math.abs(entry.dps - (byName.Comet.value + byName.Arc.value)) < 1, "the group's number is the sum of its spells");
  const lines = stats.cardDamageLines(stats.groupDamageByRow(out.GroupDPS, body.skills.map((group) => ({ skillId: group.skill_id })))[row]);
  assert.equal(stats.cardDamageNeedsNames(lines), true);
  assert.deepEqual(lines.map((line) => line.name).sort(), ["Arc", "Comet"]);
  assert.ok(lines.every((line) => !line.own), "none of it is Cast on Critical's own");

  // Changing Comet's stat set moves Comet's line, not another skill's.
  const gemOptions = await loadSpaLib("gemOptions");
  const edited = structuredClone(body);
  const comet = edited.skills[row].support.find((gem) => gem.name_spec === "Comet");
  comet.pob_attrs = gemOptions.withGemOption(comet.pob_attrs, { kind: "statSet", grantedEffect: "CometPlayer", value: 2 });
  const after = await runPob(buildPobXml(edited), runtime);
  const afterByName = Object.fromEntries(after.GroupDPS[String(row + 1)].skills.map((skill) => [skill.name, skill]));
  assert.equal(afterByName.Arc.value, byName.Arc.value, "Arc is untouched");
  assert.notEqual(afterByName.Comet.value, byName.Comet.value, "Comet's own number moved");
});

test("two supports of one family: PoB counts the later one, as the card says", needsPob, async () => {
  const { body } = await plannerCalculationRequest(fixture("titan-shield-sunder.json").code);
  const main = Number(body.main_socket_group) - 1;
  const two = "Metadata/Items/Gems/SupportGemPrimalArmamentTwo";
  const three = "Metadata/Items/Gems/SupportGemPrimalArmamentThree";
  const at = body.skills[main].support.findIndex((gem) => gem.pob_gem_id === two);
  assert.ok(at >= 0, "Sunder has Elemental Armament II");
  const support = (id, name) => ({ skill_id: id, pob_gem_id: id, name_spec: name, level: 1, quality: 0, enabled: true });
  const withSupports = (list) => {
    const edited = structuredClone(body);
    edited.skills[main].support = [...edited.skills[main].support.filter((gem) => gem.pob_gem_id !== two), ...list];
    return runPob(buildPobXml(edited), runtime);
  };
  const [onlyTwo, onlyThree, both] = await Promise.all([
    withSupports([support(two, "Elemental Armament II")]),
    withSupports([support(three, "Elemental Armament III")]),
    withSupports([support(two, "Elemental Armament II"), support(three, "Elemental Armament III")])
  ]);
  assert.notEqual(Math.round(onlyTwo.CombinedDPS), Math.round(onlyThree.CombinedDPS), "the two tiers differ");
  assert.equal(both.CombinedDPS, onlyThree.CombinedDPS, "both socketed = only the later one (PoB's rule)");
  const conflicts = supportFamilyConflicts([{ id: two }, { id: three }]);
  assert.equal(conflicts[0].kept, 1);
});

test("the node preview prices the number the main skill's card shows", needsPob, async () => {
  // Living Bomb in Cast on Elemental Ailment: PoB shows it per hit (CombinedDPS is the
  // average hit) and has a rate for it, so its card shows damage per second.
  const { body } = await plannerCalculationRequest(fixture("stormweaver-cast-on-ailment.json").code);
  const ELDRITCH_BATTERY = 57513;
  assert.ok(body.passives.includes(ELDRITCH_BATTERY), "the build has Eldritch Battery");
  const [calc, preview] = await Promise.all([
    runPob(buildPobXml(body), runtime),
    runPob(nodeDeltasXml(body, [ELDRITCH_BATTERY]), runtime).then(nodeDeltasFromOutput)
  ]);
  const mainRow = calc.GroupDPS[String(body.main_socket_group)];
  const mainSkill = mainRow.skills.find((skill) => skill.name === "Living Bomb");
  assert.ok(mainSkill.value > calc.CombinedDPS * 2, "per second is not the average hit");
  assert.ok(Math.abs(preview.base.CombinedDPS - mainSkill.value) < 1, `preview base ${preview.base.CombinedDPS} = the card's ${mainSkill.value}`);

  // Removing the keystone for real moves the card by what the preview said.
  const without = await runPob(buildPobXml({ ...body, passives: body.passives.filter((id) => id !== ELDRITCH_BATTERY) }), runtime);
  const after = without.GroupDPS[String(body.main_socket_group)].skills.find((skill) => skill.name === "Living Bomb");
  const predicted = preview.nodes[String(ELDRITCH_BATTERY)].node.CombinedDPS;
  assert.ok(Math.abs((after.value - mainSkill.value) - predicted) <= Math.abs(predicted) * 1e-6 + 1, `real ${after.value - mainSkill.value} / preview ${predicted}`);
  for (const stat of ["EnergyShield", "Mana"]) {
    assert.ok(Math.abs((without[stat] - calc[stat]) - preview.nodes[String(ELDRITCH_BATTERY)].node[stat]) < 1, stat);
  }
});

test("the CALCS output skips the Full DPS pass without changing what the planner reads", needsPob, async () => {
  // One build with weapon-set skills and one with minions (their GemOptions depend on the
  // state the MAIN passes leave behind): every skill has damage and options as before.
  for (const file of ["mercenary-gemling.json", "lich-minions.json"]) {
    const { body } = await plannerCalculationRequest(fixture(file).code);
    const out = await runPob(buildPobXml(body), runtime);
    const total = Object.values(out.GroupDPS).reduce((sum, entry) => sum + entry.dps, 0);
    assert.ok(total > 0 && out.FullDPS > 0, `${file}: Full DPS ran for the MAIN output`);
    assert.ok(Array.isArray(out.SkillDPS) && out.SkillDPS.length > 0, `${file}: SkillDPS`);
    assert.ok(Object.keys(out.GemOptions ?? {}).length > 0, `${file}: GemOptions`);
    const main = out.GroupDPS[String(Number(body.main_socket_group) || 1)];
    const mainDps = out.CombinedDPS > 0 ? out.CombinedDPS : out.Minion?.CombinedDPS ?? 0;
    assert.ok(main.skills.some((skill) => Math.abs(skill.value - mainDps) < 1), `${file}: the main skill's number is in its group`);
  }
});

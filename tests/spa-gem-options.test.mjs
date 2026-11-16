// Build Planner: per-gem PoB choices (stat set, skill part, minion, corruption) and the
// minion / totem sheet. The numeric "same choice in PoB and planner" check runs with the
// PoB parity check (scripts/check-pob-parity.mjs, tests/pob-parity.test.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildPobXml, statSetsXml } from "../src/server/pob-build-xml.mjs";
import { editPobGem, playerStats } from "../scripts/check-pob-parity.mjs";
import { NodeDOMParser, loadPlannerLib, loadSpaLib, repoRoot } from "../scripts/lib/planner-node.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const parse = (xml) => new NodeDOMParser().parseFromString(xml).documentElement;

test("a gem choice is stored with PoB's own attribute names", async () => {
  const lib = await loadSpaLib("gemOptions");
  assert.deepEqual(plain(lib.withGemOption(undefined, { kind: "part", value: 2 })), { skillPart: "2", skillPartCalcs: "2" });
  assert.deepEqual(plain(lib.withGemOption({ count: "1" }, { kind: "minion", value: "RaisedZombie" })), { count: "1", skillMinion: "RaisedZombie", skillMinionCalcs: "RaisedZombie" });
  assert.deepEqual(plain(lib.withGemOption(undefined, { kind: "minionSkill", value: 2 })), { skillMinionSkill: "2", skillMinionSkillCalcs: "2" });
  assert.deepEqual(plain(lib.withGemOption(undefined, { kind: "stages", value: 0 })), { skillStageCount: "1", skillStageCountCalcs: "1" });

  // Corruption: PoB's four choices.
  const plus = lib.withGemOption(undefined, { kind: "corrupt", value: "plus" });
  assert.deepEqual(plain(plus), { corrupted: "true", corruptLevel: "1" });
  assert.equal(lib.corruptChoice(plus), "plus");
  assert.equal(lib.corruptChoice(lib.withGemOption(plus, { kind: "corrupt", value: "minus" })), "minus");
  assert.equal(lib.corruptChoice(lib.withGemOption(plus, { kind: "corrupt", value: "corrupted" })), "corrupted");
  assert.equal(lib.corruptChoice(lib.withGemOption(plus, { kind: "corrupt", value: "none" })), "none");
  // poe.ninja codes write "nil" for unset values.
  assert.equal(lib.corruptChoice({ corrupted: "nil", corruptLevel: "nil" }), "none");

  // Stat sets: one attribute for every granted effect of the gem; set 1 is PoB's default.
  let attrs = lib.withGemOption(undefined, { kind: "statSet", grantedEffect: "CometPlayer", value: 2 });
  attrs = lib.withGemOption(attrs, { kind: "statSet", grantedEffect: "SparkPlayer", value: 3 });
  assert.equal(attrs.statSets, "CometPlayer:2,SparkPlayer:3");
  assert.equal(lib.pickedStatSet(attrs, "SparkPlayer"), 3);
  assert.equal(lib.pickedStatSet(attrs, "ArcPlayer"), 1);
  attrs = lib.withGemOption(attrs, { kind: "statSet", grantedEffect: "CometPlayer", value: 1 });
  assert.equal(attrs.statSets, "SparkPlayer:3");
  assert.equal(lib.withGemOption(attrs, { kind: "statSet", grantedEffect: "SparkPlayer", value: 1 }), undefined);
  assert.deepEqual(plain(lib.parseStatSets("A:2, bad, B:x,C:0,D-1.x:4")), { A: 2, "D-1.x": 4 });
});

test("PoB's GemOptions land on the right planner gem", async () => {
  const lib = await loadSpaLib("gemOptions");
  const skills = [
    { skillId: "Arc", supportSkills: [{ id: "s1", skillId: "SupportA" }] },
    { skillId: "", supportSkills: [] }, // not sent to PoB: shifts the numbering
    { skillId: "CastOnCrit", supportSkills: [{ id: "empty", skillId: "" }, { id: "comet", skillId: "Comet" }] }
  ];
  const options = {
    1: [{ gem: 1, name: "Arc", grantedEffect: "ArcPlayer", statSets: ["Arc", "Beam"] }],
    2: [{ gem: 2, name: "Comet", grantedEffect: "CometPlayer", statSets: ["Comet", "Fire-Infused"] }, { gem: 9, name: "Nope", grantedEffect: "X" }]
  };
  const targets = plain(lib.plannerGemTargets(options, skills)).map((row) => [row.group, row.supportId ?? "main", row.option.name]);
  assert.deepEqual(targets, [[0, "main", "Arc"], [2, "comet", "Comet"]]);
  assert.deepEqual(plain(lib.plannerGemTargets(undefined, skills)), []);
  assert.equal(lib.optionLabel("Explosion", "vi"), "Nổ (Explosion)");
  assert.equal(lib.optionLabel("Explosion", "en"), "Explosion");
  assert.equal(lib.optionLabel("Large Star", "vi"), "Large Star");
});

test("stat sets reach PoB as <StatSetIndex> children, whitelisted", () => {
  assert.equal(statSetsXml("CometPlayer:2"), '<StatSetIndex grantedEffect="CometPlayer" index="2"/><StatSetCalcsIndex grantedEffect="CometPlayer" index="2"/>');
  assert.equal(statSetsXml('Evil"/><x:2,A:999,B:0'), "");
  assert.equal(statSetsXml(undefined), "");
  const xml = buildPobXml({
    skills: [{
      skill_id: "Comet",
      pob_skill_id: "CometPlayer",
      pob_attrs: { statSets: "CometPlayer:2", skillPart: "2", skillMinionSkill: "2", corrupted: "true", corruptLevel: "-1" },
      support: [{ skill_id: "SupportFoo" }]
    }]
  });
  const [main, support] = parse(xml).querySelector("Skill").querySelectorAll("Gem");
  assert.equal(main.getAttribute("statSets"), null, "not written as an attribute");
  assert.equal(main.querySelector("StatSetIndex").getAttribute("grantedEffect"), "CometPlayer");
  assert.equal(main.querySelector("StatSetIndex").getAttribute("index"), "2");
  assert.equal(main.getAttribute("skillPart"), "2");
  assert.equal(main.getAttribute("skillMinionSkill"), "2");
  assert.equal(main.getAttribute("corruptLevel"), "-1");
  assert.equal(support.querySelectorAll("StatSetIndex").length, 0);
});

test("an imported stat set survives the planner and goes back to PoB", async () => {
  const lib = await loadPlannerLib();
  const code = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" className="Witch" ascendClassName="None" mainSocketGroup="1"/>
  <Skills activeSkillSet="1"><SkillSet id="1">
    <Skill enabled="true" mainActiveSkill="1">
      <Gem gemId="Metadata/Items/Gems/SkillGemComet" skillId="CometPlayer" nameSpec="Comet" level="20" quality="0" enabled="true" corrupted="true" corruptLevel="1">
        <StatSetIndex grantedEffect="CometPlayer" index="2"/>
        <StatSetIndex grantedEffect="Evil&quot;" index="3"/>
      </Gem>
    </Skill>
  </SkillSet></Skills>
  <Tree activeSpec="1"><Spec treeVersion="0_5" nodes="" classId="1" ascendClassId="0"/></Tree>
</PathOfBuilding2>`;
  const data = lib.parsePobXmlText(code);
  const { choices } = lib.pobSkillGroupChoices(data);
  assert.equal(choices[0].pobAttrs.statSets, "CometPlayer:2");
  assert.equal(choices[0].pobAttrs.corruptLevel, "1");
  // Saved and reopened (localStorage), then sent to the calculator.
  const saved = lib.normalizeBuildProject(JSON.parse(JSON.stringify(lib.createBuildProject({ name: "t", author: "", description: "", inventory: [], skills: choices }))));
  const body = lib.calculationRequestBody({ payload: {}, passives: [], inventory: [], skills: saved.skills, activeWeaponSet: 1, mainSocketGroup: 1 });
  const gem = parse(buildPobXml(body)).querySelector("Gem");
  assert.equal(gem.querySelector("StatSetIndex").getAttribute("index"), "2");
});

test("minion and totem sheets read the compact objects from pob-calculate.lua", async () => {
  const lib = await loadSpaLib("summonStats");
  const stats = { CombinedDPS: 0, Minion: { CombinedDPS: 245447, Life: 12582, FireResist: 70, Name: "Skeletal Storm Mage", Skill: "Arc", Bad: "x" } };
  const [sheet] = plain(lib.summonSheets(stats, "vi"));
  assert.equal(sheet.kind, "minion");
  assert.equal(sheet.subtitle, "Skeletal Storm Mage · Arc");
  assert.deepEqual(sheet.values, { CombinedDPS: 245447, Life: 12582, FireResist: 70 });
  assert.equal(lib.mainSkillDps(stats), 245447, "a minion skill's card shows its minion's DPS");
  assert.equal(lib.mainSkillDps({ CombinedDPS: 10, Minion: { CombinedDPS: 99 } }), 10);
  const totem = plain(lib.summonSheets({ Totem: { Count: 3, Life: 1571, DPS: 1000 } }, "en"));
  assert.deepEqual(totem.map((row) => [row.kind, row.values.Count]), [["totem", 3]]);
  assert.deepEqual(plain(lib.summonSheets({ CombinedDPS: 5 }, "vi")), []);
  for (const def of [...lib.MINION_STATS, ...lib.TOTEM_STATS]) assert.ok(def.vi && def.hint, def.stat);
});

test("the parity check reads minion stats and edits a gem as PoB's UI does", () => {
  const xml = `<PathOfBuilding2><Build mainSocketGroup="2"/>
<PlayerStat stat="Life" value="100"/><MinionStat stat="CombinedDPS" value="5.5"/>
<Skills activeSkillSet="2"><SkillSet id="1"><Skill><Gem skillId="ArcPlayer" level="1"/></Skill></SkillSet>
<SkillSet id="2"><Skill><Gem skillId="ArcPlayer" level="2"/></Skill><Skill><Gem skillId="SupportX" level="1"/><Gem skillId="ArcPlayer" corruptLevel="0" level="3"/></Skill></SkillSet></Skills></PathOfBuilding2>`;
  assert.deepEqual(playerStats(xml), { Life: 100, "Minion.CombinedDPS": 5.5 });
  const edited = editPobGem(xml, { group: 2, skillId: "ArcPlayer", attrs: { corruptLevel: "1", skillPart: "2", statSets: "ArcPlayer:2" } });
  assert.match(edited, /<Gem skillId="ArcPlayer" corruptLevel="1" level="3" skillPart="2"><StatSetIndex grantedEffect="ArcPlayer" index="2"\/><\/Gem>/);
  assert.match(edited, /<Gem skillId="ArcPlayer" level="2"\/>/, "other groups untouched");
  assert.equal(editPobGem(xml, { group: 5, skillId: "ArcPlayer", attrs: {} }), null);
});

test("the planner page shows gem options in the card details and the minion sheet", () => {
  const page = readFileSync(join(repoRoot, "src/spa/pages/BuildPlannerPage.tsx"), "utf8");
  assert.match(page, /plannerGemTargets\(activeStats\?\.GemOptions, buildSkills\)/);
  assert.match(page, /<GemOptionControls option=\{gemOptionFor\(index\)\}/);
  assert.match(page, /<BuildSummonStats stats=\{activeStats\}/);
  const lua = readFileSync(join(repoRoot, "scripts/pob-calculate.lua"), "utf8");
  for (const key of ["cleanOutput.GemOptions", "cleanOutput.Minion", "cleanOutput.Totem"]) assert.ok(lua.includes(key), key);
});

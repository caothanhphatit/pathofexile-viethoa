// Weapon-set rules (src/shared/equipment-rules.mjs, PoB's IsItemValidForSlot) and the
// planner's use of them (src/spa/lib/weaponSets.ts).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { loadSpaLib, repoRoot } from "../scripts/lib/planner-node.mjs";
import * as rules from "../src/shared/equipment-rules.mjs";
import { WEAPON_CLASSES, WEAPON_FLAG_NODES } from "../src/shared/equipment-rules-data.mjs";
import { parseBases, weaponClasses, flagNodes, gemLevelRequirements } from "../scripts/build-equipment-rules-data.mjs";

const NONE = rules.NO_WEAPON_FLAGS;
const base = (name, unique = false) => rules.describeEquipment({ baseName: name, itemName: name, isUnique: unique });
const conflict = (main, off, flags = NONE) => rules.offHandConflict(main ? base(main) : null, typeof off === "string" ? base(off) : off, flags);

/** src/spa/lib/weaponSets.ts with its shared import wired to the real module. */
async function loadWeaponSets() {
  const source = await readFile(join(repoRoot, "src/spa/lib/weaponSets.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const inventory = await loadSpaLib("buildInventory");
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require: (id) => {
      if (id === "../../shared/equipment-rules.mjs") return rules;
      if (id === "./buildInventory") return inventory;
      throw new Error(`unexpected import ${id}`);
    }
  });
  return { ...module.exports, inventory };
}

const empty = (slotId) => ({ id: slotId, inventoryId: slotId, itemName: "", note: "", isUnique: false, levelStart: "", levelEnd: "" });
const worn = (slotId, baseName, extra = {}) => ({ ...empty(slotId), itemName: baseName, baseName, rawText: `Rarity: RARE\nTest ${slotId}\n${baseName}`, ...extra });
const stashItem = (id, baseName, rarity = "RARE") => ({ id, itemName: baseName, baseName, isUnique: rarity === "UNIQUE", rawText: `Rarity: ${rarity}\nItem ${id}\n${baseName}`, source: "paste" });
const plain = (value) => JSON.parse(JSON.stringify(value));
const slot = (state, id) => state.inventory.find((row) => row.inventoryId === id);

test("equipment rules: every weapon base carries PoB's type and tags", () => {
  assert.equal(rules.weaponInfoForBase("Dualstring Bow").type, "Bow");
  assert.deepEqual([...rules.weaponInfoForBase("Dualstring Bow").tags], ["ranged", "twohand", "weapon"]);
  assert.equal(rules.weaponInfoForBase("Aged Tower Shield").type, "Shield");
  assert.equal(rules.weaponInfoForBase("Antler Focus").type, "Focus");
  assert.equal(rules.weaponInfoForBase("Ashen Staff").classKey, "Staff");
  assert.equal(rules.weaponInfoForBase("Aegis Quarterstaff").classKey, "Quarterstaff");
  assert.equal(rules.weaponInfoForBase("Aegis Quarterstaff").type, "Staff", "PoB files quarterstaves under type Staff");
  assert.equal(rules.weaponInfoForBase("Gold Ring"), null);
  for (const key of ["Bow", "Crossbow", "Staff", "Quarterstaff", "Talisman", "Two Hand Axe", "Two Hand Mace", "Two Hand Sword", "TrapTool"]) {
    assert.ok(WEAPON_CLASSES[key].tags.includes("twohand"), `${key} is two-handed`);
  }
  for (const key of ["Claw", "Dagger", "Flail", "Spear", "Wand", "Sceptre", "One Hand Axe", "One Hand Mace", "One Hand Sword"]) {
    assert.ok(WEAPON_CLASSES[key].tags.includes("onehand"), `${key} is one-handed`);
  }
  // Wands and sceptres are one-handed but not "one hand weapons": they never dual wield.
  assert.ok(!WEAPON_CLASSES.Wand.tags.includes("one_hand_weapon"));
  assert.ok(!WEAPON_CLASSES.Sceptre.tags.includes("one_hand_weapon"));
});

test("equipment rules: item text names its base (rare, magic, unique, game copy)", () => {
  assert.equal(rules.describeEquipment({ rawText: "Rarity: RARE\nSoul Nock\nDualstring Bow\nQuality: 20" }).info.type, "Bow");
  assert.equal(rules.describeEquipment({ rawText: "Rarity: MAGIC\nSturdy Aged Tower Shield of the Fox" }).info.type, "Shield");
  const unique = rules.describeEquipment({ raw_text: "Item Class: Sceptres\nRarity: Unique\nFont of Power\nOmen Sceptre\n--------\nSpirit: 100" });
  assert.equal(unique.info.type, "Sceptre");
  assert.equal(unique.unique, true);
  assert.equal(rules.describeEquipment({ item_name: "Antler Focus" }).info.type, "Focus");
  assert.equal(rules.describeEquipment({ rawText: "Rarity: RARE\nDoom Loop\nGold Ring" }).info, null);
  assert.equal(rules.describeEquipment({}), null);
});

test("equipment rules: two-handed weapons take no off-hand", () => {
  for (const main of ["Ashen Staff", "Aegis Quarterstaff", "Alloy Crossbow", "Aberrant Sledge", "Alpha Talisman", "Bladed Trap"]) {
    assert.equal(conflict(main, "Aged Tower Shield"), "main-is-two-handed", main);
    assert.equal(conflict(main, "Antler Focus"), "main-is-two-handed", main);
    assert.equal(conflict(main, "Aromatic Sceptre"), "main-is-two-handed", main);
  }
  // The pairs the testers equipped.
  assert.equal(conflict("Dualstring Bow", "Aged Tower Shield"), "bow-needs-quiver");
  assert.equal(conflict("Ashen Staff", "Antler Focus"), "main-is-two-handed");
});

test("equipment rules: a bow takes a quiver and nothing else; a quiver needs a bow", () => {
  assert.equal(conflict("Dualstring Bow", "Blunt Quiver"), null);
  assert.equal(conflict("Dualstring Bow", "Antler Focus"), "bow-needs-quiver");
  assert.equal(conflict(null, "Blunt Quiver"), "quiver-needs-bow");
  assert.equal(conflict("Acrid Wand", "Blunt Quiver"), "quiver-needs-bow");
  assert.equal(conflict("Alloy Crossbow", "Blunt Quiver"), "main-is-two-handed", "PoB: a crossbow has no off-hand, not even a quiver");
});

test("equipment rules: one-handed main hand", () => {
  const mace = WEAPON_CLASSES["One Hand Mace"].bases[0];
  const sword = WEAPON_CLASSES["One Hand Sword"].bases[0];
  const spear = WEAPON_CLASSES.Spear.bases[0];
  const wand = WEAPON_CLASSES.Wand.bases[0];
  const sceptre = WEAPON_CLASSES.Sceptre.bases[0];
  for (const off of ["Aged Tower Shield", "Aegis Buckler", "Antler Focus", sceptre]) {
    assert.equal(conflict(mace, off), null, off);
    assert.equal(conflict(null, off), null, `${off} with an empty main hand`);
  }
  assert.equal(conflict(mace, sword), null, "dual wield");
  assert.equal(conflict(spear, mace), null, "a spear in the main hand may dual wield");
  assert.equal(conflict(mace, spear), "spear-main-hand-only");
  assert.equal(conflict(wand, mace), "no-dual-wield-with-caster");
  assert.equal(conflict(sceptre, mace), "no-dual-wield-with-caster");
  assert.equal(conflict(mace, wand), "main-hand-only", "a wand is never an off-hand item");
  assert.equal(conflict(wand, sceptre), null, "PoB allows a sceptre next to a wand");
  assert.equal(conflict(mace, "Aberrant Sledge"), "two-handed-item");
});

test("equipment rules: Giant's Blood, Instruments of Power, Lord of the Wilds", () => {
  const gb = { ...NONE, giantsBlood: true };
  const twoHandSword = WEAPON_CLASSES["Two Hand Sword"].bases[0];
  const twoHandAxe = WEAPON_CLASSES["Two Hand Axe"].bases[0];
  assert.equal(conflict("Aberrant Sledge", "Aged Tower Shield", gb), null);
  assert.equal(conflict("Aberrant Sledge", twoHandSword, gb), null);
  assert.equal(conflict(twoHandAxe, "Aberrant Sledge", gb), null);
  assert.equal(conflict("Aberrant Sledge", "Blunt Quiver", gb), "quiver-needs-bow");
  assert.equal(conflict("Aegis Quarterstaff", "Aged Tower Shield", gb), "main-is-two-handed", "Giant's Blood is axes, maces and swords only");
  assert.equal(conflict("Dualstring Bow", "Aged Tower Shield", gb), "bow-needs-quiver");

  const iop = { ...NONE, instrumentsOfPower: true };
  assert.equal(conflict("Ashen Staff", "Antler Focus", iop), null);
  assert.equal(conflict("Ashen Staff", "Aged Tower Shield", iop), "staff-needs-focus");

  const lotw = { ...NONE, lordOfTheWilds: true };
  assert.equal(conflict("Alpha Talisman", "Aromatic Sceptre", lotw), null);
  assert.equal(conflict("Alpha Talisman", base("Omen Sceptre", true), lotw), "talisman-needs-sceptre", "non-unique sceptres only");
  assert.equal(conflict("Alpha Talisman", "Antler Focus", lotw), "talisman-needs-sceptre");

  assert.deepEqual(rules.weaponFlags({ passives: WEAPON_FLAG_NODES.giantsBlood }), gb);
  assert.deepEqual(rules.weaponFlags({ passives: ["20701"] }), iop, "node ids may be strings");
  assert.deepEqual(rules.weaponFlags({ itemTexts: ["Rarity: UNIQUE\nX\nY\nYou can equip a non-Unique Sceptre while wielding a Talisman"] }), lotw);
  assert.deepEqual(rules.weaponFlags({ passives: [1, 2, 3] }), { ...NONE });
});

test("equipment rules: slots an item can go to", () => {
  const info = (name) => rules.weaponInfoForBase(name);
  assert.ok(rules.fitsMainHand(info("Dualstring Bow")) && !rules.fitsOffHand(info("Dualstring Bow")));
  assert.ok(!rules.fitsMainHand(info("Aged Tower Shield")) && rules.fitsOffHand(info("Aged Tower Shield")));
  assert.ok(rules.fitsMainHand(info("Acrid Wand")) && !rules.fitsOffHand(info("Acrid Wand")));
  assert.ok(rules.fitsMainHand(info("Aromatic Sceptre")) && rules.fitsOffHand(info("Aromatic Sceptre")));
  assert.ok(!rules.fitsOffHand(info("Aberrant Sledge")) && rules.fitsOffHand(info("Aberrant Sledge"), { ...NONE, giantsBlood: true }));
  assert.equal(rules.pairedWeaponSlot("Weapon1"), "Weapon2");
  assert.equal(rules.pairedWeaponSlot("Weapon4"), "Weapon3");
  assert.equal(rules.pairedWeaponSlot("Helm1"), "");
});

test("equipment rules: the calculation drops an impossible off-hand, per weapon set", () => {
  const row = (inventory_id, baseName) => ({ inventory_id, item_name: baseName, raw_text: `Rarity: RARE\nName\n${baseName}` });
  const rows = [
    row("Weapon1", "Dualstring Bow"), row("Weapon2", "Aged Tower Shield"),
    row("Weapon3", "Aberrant Sledge"), row("Weapon4", "Aged Tower Shield"),
    row("Helm1", "Rusted Cuirass")
  ];
  const plain = rules.dropImpossibleOffHands(rows, []);
  assert.deepEqual(plain.rows.map((r) => r.inventory_id), ["Weapon1", "Weapon3", "Helm1"]);
  assert.deepEqual(plain.dropped.map((r) => [r.slot, r.reason]), [["Weapon2", "bow-needs-quiver"], ["Weapon4", "main-is-two-handed"]]);
  // Giant's Blood allocated: the second set is legal.
  const titan = rules.dropImpossibleOffHands(rows, WEAPON_FLAG_NODES.giantsBlood);
  assert.deepEqual(titan.rows.map((r) => r.inventory_id), ["Weapon1", "Weapon3", "Weapon4", "Helm1"]);
  const fine = [row("Weapon1", "Dualstring Bow"), row("Weapon2", "Blunt Quiver")];
  assert.equal(rules.dropImpossibleOffHands(fine, []).rows, fine, "untouched rows keep their identity");
  assert.deepEqual(rules.dropImpossibleOffHands(undefined, []).dropped, []);
});

test("equipment rules: gem level requirements come from PoB's level table", () => {
  assert.equal(rules.gemLevelRequirement(1), 0);
  assert.equal(rules.gemLevelRequirement(20), 90);
  assert.equal(rules.gemLevelRequirement(21), 90);
  assert.equal(rules.gemLevelRequirement(undefined), undefined);
  assert.ok(rules.gemLevelRequirement(10) > rules.gemLevelRequirement(9));
});

test("equipment rules data: the generator reads PoB's base, tree and skill files", () => {
  const lua = `itemBases["Test Bow"] = {\n\ttype = "Bow",\n\ttags = { bow = true, default = true, twohand = true, two_hand_weapon = true, },\n}\nitemBases["Test Staff"] = {\n\ttype = "Staff",\n\ttags = { warstaff = true, twohand = true, },\n}`;
  const classes = weaponClasses(parseBases(lua));
  assert.deepEqual(classes.Bow, { type: "Bow", tags: ["twohand"], bases: ["Test Bow"] });
  assert.deepEqual(classes.Quarterstaff.bases, ["Test Staff"]);
  assert.deepEqual(flagNodes({ nodes: { a: { skill: 7, stats: ["x", "Line"] }, b: { skill: 3, stats: [] } } }, { flag: "Line" }), { flag: [7] });
  assert.throws(() => flagNodes({ nodes: {} }, { flag: "Line" }));
  const levels = Array.from({ length: 20 }, (_, index) => `\t\t[${index + 1}] = { levelRequirement = ${index * 2}, },`).join("\n");
  assert.deepEqual(gemLevelRequirements([`skills["A"] = {\n\tlevels = {\n${levels}\n\t},\n}`]).levels.slice(0, 3), [0, 2, 4]);
});

test("planner weapon sets: equipping a two-hander sends the off-hand back to the inventory", async () => {
  const sets = await loadWeaponSets();
  const state = { inventory: [worn("Weapon1", "Golden Blade"), worn("Weapon2", "Aged Tower Shield"), empty("Weapon3"), empty("Weapon4")], stash: [stashItem("bow", "Dualstring Bow")] };
  const result = sets.equipWithWeaponRules(state, "bow", "Weapon1");
  assert.equal(slot(result.state, "Weapon1").baseName, "Dualstring Bow");
  assert.equal(slot(result.state, "Weapon2").itemName, "", "the shield left its slot");
  assert.deepEqual(plain(result.state.stash.map((row) => row.baseName).sort()), ["Aged Tower Shield", "Golden Blade"]);
  assert.equal(result.notice.reason, "bow-needs-quiver");
  assert.equal(result.notice.movedName, "Test Weapon2");
  assert.match(sets.weaponNoticeText(result.notice, "vi"), /Cung chỉ đi cùng ống tên.*đã cất Test Weapon2 vào kho/);
  assert.match(sets.weaponNoticeText(result.notice, "en"), /went back to the inventory/);
});

test("planner weapon sets: equipping an off-hand next to a two-hander sends the weapon back", async () => {
  const sets = await loadWeaponSets();
  const state = { inventory: [worn("Weapon1", "Ashen Staff"), empty("Weapon2")], stash: [stashItem("focus", "Antler Focus"), stashItem("quiver", "Blunt Quiver"), stashItem("wand", "Acrid Wand"), stashItem("shield", "Aged Tower Shield")] };
  const focus = sets.equipWithWeaponRules(state, "focus", "Weapon2");
  assert.equal(slot(focus.state, "Weapon2").baseName, "Antler Focus");
  assert.equal(slot(focus.state, "Weapon1").itemName, "", "the staff went back");
  assert.equal(focus.notice.reason, "main-is-two-handed");
  assert.ok(focus.state.stash.some((row) => row.baseName === "Ashen Staff"));
  // With Instruments of Power the pair is legal and nothing moves.
  const legal = sets.equipWithWeaponRules(state, "focus", "Weapon2", ["20701"]);
  assert.equal(slot(legal.state, "Weapon1").baseName, "Ashen Staff");
  assert.equal(legal.notice, undefined);
  // A quiver without a bow and a wand in the off-hand are refused: nothing changes.
  const quiver = sets.equipWithWeaponRules(state, "quiver", "Weapon2");
  assert.equal(quiver.state, state);
  assert.deepEqual([quiver.notice.reason, quiver.notice.rejected], ["quiver-needs-bow", true]);
  const wand = sets.equipWithWeaponRules(state, "wand", "Weapon2");
  assert.equal(wand.state, state);
  assert.equal(wand.notice.reason, "main-hand-only");
  const shieldInMain = sets.equipWithWeaponRules(state, "shield", "Weapon1");
  assert.equal(shieldInMain.state, state);
  assert.equal(shieldInMain.notice.reason, "off-hand-only");
  assert.match(sets.weaponNoticeText(shieldInMain.notice, "vi"), /không mặc .* vào ô này được/);
});

test("planner weapon sets: other slots and the second set", async () => {
  const sets = await loadWeaponSets();
  const state = { inventory: [worn("Weapon1", "Dualstring Bow"), worn("Weapon2", "Blunt Quiver"), worn("Weapon3", "Golden Blade"), worn("Weapon4", "Aged Tower Shield"), empty("Ring1")], stash: [stashItem("ring", "Gold Ring"), stashItem("sledge", "Aberrant Sledge")] };
  const ring = sets.equipWithWeaponRules(state, "ring", "Ring1");
  assert.equal(slot(ring.state, "Ring1").baseName, "Gold Ring");
  assert.equal(ring.notice, undefined);
  const sledge = sets.equipWithWeaponRules(state, "sledge", "Weapon3");
  assert.equal(slot(sledge.state, "Weapon4").itemName, "", "set II lost its shield");
  assert.equal(slot(sledge.state, "Weapon2").baseName, "Blunt Quiver", "set I is untouched");
});

test("planner weapon sets: an imported build with an impossible pair is repaired", async () => {
  const sets = await loadWeaponSets();
  const state = { inventory: [worn("Weapon1", "Ashen Staff"), worn("Weapon2", "Aromatic Sceptre"), worn("Weapon3", "Dualstring Bow"), worn("Weapon4", "Blunt Quiver")], stash: [] };
  const fixed = sets.enforceWeaponSets(state);
  assert.equal(slot(fixed.state, "Weapon2").itemName, "");
  assert.equal(slot(fixed.state, "Weapon4").baseName, "Blunt Quiver");
  assert.deepEqual(plain(fixed.state.stash.map((row) => row.baseName)), ["Aromatic Sceptre"]);
  assert.equal(fixed.notices.length, 1);
  assert.equal(fixed.notices[0].movedName, "Test Weapon2");
  const ok = sets.enforceWeaponSets(fixed.state);
  assert.equal(ok.state, fixed.state);
  assert.deepEqual(plain(ok.notices), []);
  assert.deepEqual(plain(sets.inventoryWithoutImpossibleOffHands(state.inventory).map((row) => row.inventoryId)), ["Weapon1", "Weapon3", "Weapon4"]);
  assert.equal(sets.inventoryWithoutImpossibleOffHands(fixed.state.inventory), fixed.state.inventory);
  // Categories follow PoB, not the site's menus: a wand is main hand only.
  assert.deepEqual([...sets.weaponSlotCategories({ baseName: "Acrid Wand" }, NONE)], ["weapon"]);
  assert.deepEqual([...sets.weaponSlotCategories({ baseName: "Aromatic Sceptre" }, NONE)], ["weapon", "offhand"]);
  assert.equal(sets.weaponSlotCategories({ baseName: "Gold Ring" }, NONE), null);
});

test("calculate API: an impossible off-hand never reaches PoB and is reported", async () => {
  const { buildApp } = await import("../src/server/app.mjs");
  const seen = [];
  const app = await buildApp({
    db: null,
    logger: false,
    sessionSecret: "test-session-secret",
    premiumSigner: null,
    pobRunner: { mode: "remote", run: async (xml) => { seen.push(xml); return { Life: 1 }; } }
  });
  const row = (inventory_id, baseName) => ({ inventory_id, item_name: baseName, raw_text: `Rarity: RARE\nName ${inventory_id}\n${baseName}` });
  const payload = (passives) => ({ className: "Ranger", level: 90, skills: [], passives, inventory_slots: [row("Weapon1", "Aberrant Sledge"), row("Weapon2", "Aged Tower Shield")] });
  try {
    const plainBuild = await app.inject({ method: "POST", url: "/api/builds/calculate", payload: payload([]) });
    assert.equal(plainBuild.statusCode, 200, plainBuild.body);
    assert.deepEqual(plainBuild.json().equipment_dropped.map((entry) => [entry.slot, entry.reason]), [["Weapon2", "main-is-two-handed"]]);
    assert.match(seen[0], /Aberrant Sledge/);
    assert.doesNotMatch(seen[0], /Aged Tower Shield/);
    // Giant's Blood allocated: the shield stays.
    const titan = await app.inject({ method: "POST", url: "/api/builds/calculate", payload: payload(WEAPON_FLAG_NODES.giantsBlood) });
    assert.equal(titan.json().equipment_dropped, undefined);
    assert.match(seen[1], /Aged Tower Shield/);
  } finally {
    await app.close();
  }
});

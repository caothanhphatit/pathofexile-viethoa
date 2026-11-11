// Build Planner personal inventory ("Kho đồ") and the "what if" comparison queue.
import assert from "node:assert/strict";
import test from "node:test";

import { loadPlannerLib, loadSpaLib } from "../scripts/lib/planner-node.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const empty = (slotId) => ({ id: slotId, inventoryId: slotId, itemName: "", note: "", isUnique: false, levelStart: "", levelEnd: "" });
const ring = (name) => `Rarity: Rare\n${name}\nGold Ring\n+30% to Fire Resistance`;
const GAME_COPY = [
  "Item Class: Rings",
  "Rarity: Unique",
  "Blackflame",
  "Amethyst Ring",
  "--------",
  "Requires: Level 20",
  "--------",
  "+11% to Chaos Resistance"
].join("\n");

test("inventory: pasted game text becomes an item, several items split", async () => {
  const inv = await loadSpaLib("buildInventory");
  const item = inv.stashItemFromText(GAME_COPY, "paste");
  assert.equal(item.itemName, "Blackflame");
  assert.equal(item.isUnique, true);
  assert.equal(item.baseName, "Amethyst Ring");
  assert.equal(inv.stashItemFromText("hello world"), null, "text without Rarity: is not an item");
  assert.equal(inv.splitItemTexts(`${ring("A")}\n\n${GAME_COPY}`).length, 2);
  assert.deepEqual(plain(inv.itemCategoriesFromText(GAME_COPY)), ["ring"]);
  assert.deepEqual(plain(inv.itemCategoriesFromText("Rarity: Rare\nX\nPlated Greaves")), ["boots"]);
  assert.deepEqual(plain(inv.itemCategoriesFromText("Rarity: Normal\nAttuned Wand")), ["weapon", "offhand"]);
  assert.deepEqual(plain(inv.itemCategoriesFromText("Rarity: Rare\nX\nSapphire")), [], "jewels do not go on the doll");
});

test("inventory: equip, swap back into the stash, unequip", async () => {
  const inv = await loadSpaLib("buildInventory");
  const a = inv.stashItemFromText(ring("Doom Loop"), "pob");
  const b = inv.stashItemFromText(ring("Storm Band"), "paste");
  let state = { inventory: [empty("Ring1"), empty("Ring2")], stash: [a, b] };

  state = inv.equipStashItem(state, a.id, "Ring1");
  const ring1 = state.inventory.find((row) => row.inventoryId === "Ring1");
  assert.equal(ring1.rawText, a.rawText, "the slot gets the item's own text");
  assert.equal(ring1.itemName, "Gold Ring");
  assert.equal(ring1.rareName, "Doom Loop");
  assert.deepEqual(plain(state.stash.map((row) => row.id)), [b.id]);

  state = inv.equipStashItem(state, b.id, "Ring1");
  assert.equal(state.inventory.find((row) => row.inventoryId === "Ring1").rareName, "Storm Band");
  assert.equal(state.stash.length, 1, "the replaced ring went back");
  assert.equal(state.stash[0].rawText, a.rawText);
  assert.equal(state.stash[0].source, "unequipped");

  state = inv.unequipSlot(state, "Ring1");
  assert.equal(state.inventory.find((row) => row.inventoryId === "Ring1").itemName, "");
  assert.equal(state.stash.length, 2);
  assert.equal(inv.unequipSlot(state, "Ring1"), state, "an empty slot changes nothing");
  assert.equal(inv.equipStashItem(state, "missing", "Ring1"), state);

  state = inv.removeStashItem(state, state.stash[0].id);
  assert.equal(state.stash.length, 1);
});

test("inventory: a click equips straight away, asks only when there is a real choice", async () => {
  const inv = await loadSpaLib("buildInventory");
  const filled = (slotId) => ({ ...empty(slotId), itemName: "X" });
  const rings = { activeWeaponSet: 1, inventory: [empty("Ring1"), empty("Ring2")], availableSlots: ["Ring1", "Ring2"] };
  assert.deepEqual(plain(inv.equipTargets(["ring"], rings)), ["Ring1", "Ring2"], "two empty rings: ask");
  assert.deepEqual(plain(inv.equipTargets(["ring"], { ...rings, inventory: [filled("Ring1"), empty("Ring2")] })), ["Ring2"], "one empty ring: use it");
  assert.deepEqual(plain(inv.equipTargets(["ring"], { ...rings, selectedSlot: "Ring1" })), ["Ring1"], "the selected slot wins");
  assert.deepEqual(plain(inv.equipTargets(["helmet"], { activeWeaponSet: 1, inventory: [] })), ["Helm1"]);
  assert.deepEqual(plain(inv.equipTargets(["weapon"], { activeWeaponSet: 2, inventory: [] })), ["Weapon3"], "weapons go to the active weapon set");
  assert.deepEqual(plain(inv.equipTargets([], { activeWeaponSet: 1, inventory: [] })), []);
});

test("inventory: PoB alternates come in, survive a save, and old builds still load", async () => {
  const inv = await loadSpaLib("buildInventory");
  const planner = await loadPlannerLib();
  const data = {
    build: { className: "Witch", ascendClassName: "", level: 90, mainSkill: "" },
    treeSpec: null,
    skillGroups: [],
    notes: "",
    items: [
      { slot: "Ring 1", text: ring("Worn") },
      { slot: "", text: ring("Spare") },
      { slot: "", text: ring("Spare") },
      { slot: "", text: "Rarity: Rare\nGleam\nSapphire\n+5% to Cold Resistance" }
    ]
  };
  const stash = inv.stashFromPobImport(data);
  assert.equal(stash.length, 1, "worn items, duplicates and jewels stay out");
  assert.match(stash[0].rawText, /Spare/);

  const project = planner.createBuildProject({ name: "x", author: "", description: "", stash });
  const saved = planner.normalizeBuildProject(plain(project));
  assert.equal(saved.stash.length, 1);
  assert.equal(saved.stash[0].rawText, stash[0].rawText);
  assert.deepEqual(plain(planner.normalizeBuildProject({ id: "old", name: "old" }).stash), [], "builds saved before the inventory");
  assert.deepEqual(plain(inv.normalizeStash([{ itemName: "" }, null, { itemName: "Blackflame", isUnique: true, source: "weird" }]).map((row) => [row.itemName, row.source])), [["Blackflame", "paste"]]);
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test("comparison queue: one at a time, cached, deduplicated, hover jumps the line", async () => {
  const { CalcQueue, calcKey } = await loadSpaLib("calcQueue");
  const started = [];
  const pending = new Map();
  const queue = new CalcQueue((body) => {
    started.push(body.name);
    const job = deferred();
    pending.set(body.name, job);
    return job.promise;
  });
  let updates = 0;
  queue.subscribe(() => { updates += 1; });

  const keyA = queue.request({ name: "a" });
  const keyB = queue.request({ name: "b" });
  const keyC = queue.request({ name: "c" });
  assert.equal(queue.request({ name: "a" }), keyA, "same body, same key");
  assert.deepEqual(started, ["a"], "only one runs");
  assert.equal(queue.get(keyA).status, "running");
  assert.equal(queue.get(keyB).status, "queued");

  queue.request({ name: "c" }, 5); // the mouse is over c now
  pending.get("a").resolve({ dps: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(plain(queue.get(keyA)), { status: "done", result: { dps: 1 } });
  assert.deepEqual(started, ["a", "c"], "c jumped ahead of b");

  pending.get("c").reject(new Error("boom"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(queue.get(keyC).status, "error");
  assert.deepEqual(started, ["a", "c", "b"]);

  queue.request({ name: "a" });
  assert.deepEqual(started, ["a", "c", "b"], "a finished result is not run again");
  queue.request({ name: "c" });
  assert.equal(queue.get(keyC).status, "queued", "an error can be retried");

  queue.dropPending();
  assert.equal(queue.get(keyC), undefined, "dropped jobs are forgotten");
  assert.equal(queue.queuedCount, 0);

  queue.seed(calcKey({ name: "main" }), { dps: 9 });
  assert.deepEqual(plain(queue.get(calcKey({ name: "main" })).result), { dps: 9 });
  assert.ok(updates > 5);
});

test("gem suggestions: supports sharing the skill's tags first, generic ones after, group gems left out", async () => {
  const { gemCandidates, tagOverlap } = await loadSpaLib("gemSuggest");
  const arc = ["Spell", "Projectile", "Lightning", "Chaining", "Repeatable"];
  const supports = [
    { name: "Lightning Mastery", tags: ["Support", "Lightning"] },
    { name: "Controlled Destruction", tags: ["Support", "Spell"] },
    { name: "Pierce", tags: ["Support", "Projectile", "Spell"] },
    { name: "Melee Physical", tags: ["Support", "Melee", "Physical"] },
    { name: "Efficiency", tags: ["Support"] },
    { name: "Arcane Tempo", tags: ["Support", "Spell"] }
  ];
  assert.equal(tagOverlap(arc, ["Support", "Repeatable"]), 0, "generic tags do not count");
  const names = gemCandidates(arc, supports, { exclude: ["Arcane Tempo"] }).map((gem) => gem.name);
  assert.deepEqual(names, ["Pierce", "Controlled Destruction", "Lightning Mastery", "Efficiency"]);
  assert.equal(gemCandidates(arc, supports, { limit: 2 }).length, 2);
});

test("planner page: inventory beside the doll, drag and drop, hover comparison, gem strip", async () => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { repoRoot } = await import("../scripts/lib/planner-node.mjs");
  const page = await readFile(join(repoRoot, "src/spa/pages/BuildPlannerPage.tsx"), "utf8");
  assert.match(page, /<BuildInventoryPanel/);
  assert.match(page, /equipStashItem\(/);
  assert.match(page, /onContextMenu=/, "right-click unequips");
  assert.match(page, /STASH_DRAG_TYPE/, "items can be dropped on slots");
  assert.match(page, /stashFromPobImport\(pobData\)/, "PoB alternates land in the inventory");
  assert.match(page, /stash,\n\s+importedPayload: updatedPayload/, "the inventory is saved with the build");
  assert.match(page, /<CompareBlock queue=\{compareQueue\}/);
  assert.match(page, /compareQueue\.seed\(bodyKey/, "the page's own calculation feeds the comparison cache");
  assert.match(page, /<GemSwapStrip/);
  assert.match(page, /gemCandidates\(tagSource\?\.tags/, "suggestions follow the skill that does the damage");
});

test("gem suggestions: trigger supports rank below supports that boost the skill", async () => {
  const { gemCandidates } = await loadSpaLib("gemSuggest");
  const livingBomb = ["Spell", "AoE", "Fire", "Duration"];
  const names = gemCandidates(livingBomb, [
    { name: "Fiery Death", tags: ["Support", "Spell", "AoE", "Trigger", "Fire"] },
    { name: "Controlled Destruction", tags: ["Support", "Spell"] },
    { name: "Fire Mastery", tags: ["Support", "Spell", "Fire"] }
  ]).map((gem) => gem.name);
  assert.deepEqual(names, ["Fire Mastery", "Controlled Destruction", "Fiery Death"]);
});

test("gem suggestions: supports for another kind of skill (minions, attacks) are left out", async () => {
  const { gemCandidates } = await loadSpaLib("gemSuggest");
  const names = gemCandidates(["Spell", "AoE", "Fire", "Duration"], [
    { name: "Infernal Legion", tags: ["Support", "Minion", "Fire", "Duration"] },
    { name: "Fire Mastery", tags: ["Support", "Spell", "Fire"] },
    { name: "Brutality", tags: ["Support", "Attack", "Physical"] }
  ]).map((gem) => gem.name);
  assert.deepEqual(names, ["Fire Mastery"]);
});

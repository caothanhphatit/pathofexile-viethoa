import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReport,
  compareNames,
  EQUIPMENT_CLASS,
  GEM_CLASS,
  isWebEquipment,
  loadWebBundle,
  normalizeName
} from "../scripts/check-game-data.mjs";

test("compareNames ignores case, spacing and apostrophe style when matching", () => {
  const diff = compareNames(["Golden Blade", "Sekhema’s Resolve", "New Base"], ["golden  blade", "Sekhema's Resolve", "Old Base"]);
  assert.equal(diff.game, 3);
  assert.equal(diff.web, 3);
  assert.equal(diff.shared, 2);
  assert.deepEqual(diff.missingInWeb, ["New Base"]);
  assert.deepEqual(diff.missingInGame, ["Old Base"]);
  assert.equal(normalizeName("  A’b  C "), "a'b c");
});

test("class matchers pick equipment and gem item classes only", () => {
  for (const name of ["Body Armour", "One Hand Sword", "Quarterstaff", "Life Flask", "Jewel", "Focus", "Relic"]) {
    assert.ok(EQUIPMENT_CLASS.test(name), name);
  }
  for (const name of ["Stackable Currency", "Hideout Doodad", "Skill Gem", "Map"]) {
    assert.ok(!EQUIPMENT_CLASS.test(name), name);
  }
  assert.ok(GEM_CLASS.test("Skill Gem"));
  assert.ok(GEM_CLASS.test("Support Gem"));
  assert.ok(!GEM_CLASS.test("Gem Cutter"));
});

test("isWebEquipment keeps equipment categories and jewels, drops uniques and currency", () => {
  assert.ok(isWebEquipment({ name: "Ancient Visor", item_category: "helmet", rarity: "" }));
  assert.ok(isWebEquipment({ name: "Diamond", item_category: "other", menu_label: "Jewels" }));
  assert.ok(!isWebEquipment({ name: "Golden Blade", item_category: "weapon", rarity: "unique" }));
  assert.ok(!isWebEquipment({ name: "Exalted Orb", item_category: "other", menu_label: "Stackable Currency" }));
});

test("loadWebBundle evaluates a window.* data file and finds the record list", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "poevh-check-test-"));
  const file = path.join(dir, "items-data.js");
  fs.writeFileSync(file, `window.POE2_ITEMS = ${JSON.stringify({
    generated_at: "2026-07-02T09:56:18.599Z",
    latest_run: { status: "partial" },
    menus: [{ key: "helmets", items: [{ name: "Ancient Visor", item_category: "helmet" }, { name: "Golden Visage", rarity: "unique" }] }]
  })};`);
  const bundle = loadWebBundle(file);
  assert.equal(bundle.generatedAt, "2026-07-02T09:56:18.599Z");
  assert.equal(bundle.runStatus, "partial");
  assert.deepEqual(bundle.records.map((row) => row.name), ["Ancient Visor", "Golden Visage"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("buildReport separates bases shared with a unique from genuinely missing bases", () => {
  const report = buildReport({
    game: {
      fingerprint: "abc",
      baseItemCount: 4,
      classCounts: { Helmet: 2, "One Hand Sword": 1, "Skill Gem": 1 },
      equipment: [{ name: "Ancient Visor" }, { name: "Golden Blade" }, { name: "Brand New Helm" }],
      gems: [{ name: "Fireball" }, { name: "Aftershock III" }],
      uniques: ["Brynabas"]
    },
    items: {
      generatedAt: "2026-07-02", runStatus: "partial",
      records: [
        { name: "Ancient Visor", item_category: "helmet", rarity: "" },
        { name: "Golden Blade", item_category: "weapon", rarity: "unique" },
        { name: "Byrnabas", item_category: "helmet", rarity: "unique" },
        { name: "Exalted Orb", item_category: "other", menu_label: "Stackable Currency" }
      ]
    },
    gems: { generatedAt: "2026-05-29", runStatus: "completed", records: [{ name: "Fireball" }, { name: "Cast on Block" }] },
    gameDir: "D:\\game",
    ggpkStat: { size: 10, mtime: new Date("2026-11-05T16:53:22Z") }
  });
  assert.deepEqual(report.equipment.missingInWeb, ["Brand New Helm"]);
  assert.deepEqual(report.equipment.baseOfUnique, ["Golden Blade"]);
  assert.deepEqual(report.equipment.missingInGame, []);
  assert.deepEqual(report.gems.missingInWeb, ["Aftershock III"]);
  assert.deepEqual(report.gems.missingInGame, ["Cast on Block"]);
  assert.deepEqual(report.uniques.missingInWeb, ["Brynabas"]);
  assert.deepEqual(report.uniques.missingInGame, ["Byrnabas", "Golden Blade"]);
  assert.equal(report.web.items.runStatus, "partial");
});

// Stat breakdown ("where does this number come from") shown in Vietnamese.
import assert from "node:assert/strict";
import test from "node:test";

import { loadSpaLib } from "../scripts/lib/planner-node.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));

test("breakdown lines read in Vietnamese", async () => {
  const lib = await loadSpaLib("statBreakdown");
  assert.equal(lib.translateBreakdownLine("1572 (base)"), "1572 (gốc)");
  assert.equal(lib.translateBreakdownLine("x 1.15 (increased/reduced)"), "x 1.15 (tăng/giảm)");
  assert.equal(lib.translateBreakdownLine("= 1.66 casts per second"), "= 1.66 lần niệm mỗi giây");
  assert.equal(lib.translateBreakdownLine("Max: 75%"), "Tối đa: 75%");
  assert.equal(lib.translateBreakdownLine("something new"), "something new");
});

test("sources grouped by where they come from, with plain values and names", async () => {
  const lib = await loadSpaLib("statBreakdown");
  const groups = lib.groupBreakdownSources([
    { type: "INC", value: 5, name: "Life", kind: "quest", label: "Interlude 2" },
    { type: "BASE", value: 115, name: "Life", kind: "item", label: "Entropy Coil, Unset Ring" },
    { type: "BASE", value: 37, name: "Life", kind: "item", label: "Yoke of Suffering" },
    { type: "BASE", value: 1216, name: "Life", kind: "base", label: "" },
    { type: "MORE", value: -20, name: "Damage", kind: "gem", label: "Controlled Destruction" },
    { type: "INC", value: 10, name: "ElementalResist", kind: "weird", label: "x" }
  ]);
  assert.deepEqual(plain(groups.map((group) => group.title)), ["Gốc của nhân vật", "Trang bị", "Gem kỹ năng", "Phần thưởng nhiệm vụ", "Nguồn khác"]);
  assert.deepEqual(plain(groups[1].rows.map((row) => row.text)), ["+115", "+37"], "biggest first");
  assert.equal(groups[2].rows[0].text, "−20% nhân bớt");
  assert.equal(groups[3].rows[0].text, "+5% tăng");
  assert.equal(groups[4].rows[0].nameVi, "Kháng mọi nguyên tố");
  const attr = lib.groupBreakdownSources([{ type: "BASE", value: 142, name: "Life", kind: "strength", label: "Strength" }]);
  assert.deepEqual(plain([attr[0].title, attr[0].rows[0].label]), ["Từ thuộc tính", "Sức mạnh (Str)"]);
  assert.equal(lib.modNameVi("SomethingNew"), "Something New", "unknown mod names are spaced, not raw ids");
  assert.deepEqual(plain(lib.breakdownTotals([
    { type: "BASE", value: 100 }, { type: "INC", value: 10 }, { type: "INC", value: 5 }, { type: "MORE", value: 20 }, { type: "MORE", value: 50 }
  ])), { base: 100, increased: 15, more: 1.7999999999999998 });
});

test("planner page opens the breakdown from the stat sheet with a few lines", async () => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { repoRoot } = await import("../scripts/lib/planner-node.mjs");
  const page = await readFile(join(repoRoot, "src/spa/pages/BuildPlannerPage.tsx"), "utf8");
  assert.match(page, /<StatBreakdownDialog/);
  assert.match(page, /<StatBreakdownHoverCard/);
  assert.match(page, /onExplain=\{setExplainStat\}/);
});

test("hover breakdown groups sources by Base / Increased / More with top-4 rollup", async () => {
  const lib = await loadSpaLib("statBreakdown");
  const phases = lib.groupBreakdownByPhase([
    { type: "BASE", value: 1216, name: "Life", kind: "base", label: "" },
    { type: "BASE", value: 142, name: "Life", kind: "strength", label: "Strength" },
    { type: "BASE", value: 115, name: "Life", kind: "item", label: "Entropy Coil, Unset Ring" },
    { type: "BASE", value: 42, name: "Life", kind: "item", label: "Headhunter, Heavy Belt" },
    { type: "BASE", value: 37, name: "Life", kind: "item", label: "Yoke of Suffering" },
    { type: "BASE", value: 20, name: "Life", kind: "quest", label: "Act 1: Ogham Manor" },
    { type: "INC", value: 10, name: "Life", kind: "gem", label: "Virtuous Barrier" },
    { type: "INC", value: 5, name: "Life", kind: "quest", label: "Interlude 2: Khari Crossing" },
    { type: "MORE", value: 20, name: "EnergyShield", kind: "gem", label: "Charge Regulation" }
  ], 4);
  assert.deepEqual(plain(phases.map((p) => [p.phase, p.totalText])), [["BASE", "1,572"], ["INC", "+15%"], ["MORE", "+20%"]]);
  assert.equal(phases[0].rows.length, 4);
  assert.equal(phases[0].restCount, 2);
  assert.equal(phases[0].restText, "57");
  assert.equal(phases[0].rows[1].kindBadge, "ATTRIBUTE");
  assert.equal(phases[1].rows[0].kindBadge, "SKILL");
});

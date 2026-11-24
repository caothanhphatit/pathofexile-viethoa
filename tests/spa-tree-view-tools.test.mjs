// Passive tree view tools: undo/redo history, fit-to-build camera, node search
// (src/spa/passive/history.ts, fit.ts, search.ts).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const plain = (value) => JSON.parse(JSON.stringify(value));

async function loadPassiveLib(name) {
  const source = await readFile(join(repoRoot, "src/spa/passive", `${name}.ts`), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const sandbox = { module: { exports: {} } };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox);
  return sandbox.module.exports;
}

const history = await loadPassiveLib("history");
const fit = await loadPassiveLib("fit");
const search = await loadPassiveLib("search");

test("treeEditState is stable whatever the order of ids and keys", () => {
  const a = history.treeEditState(["3", "1", "2", "1"], { b: 2, a: 1 }, { y: "dex", x: "str" });
  const b = history.treeEditState(new Set(["2", "3", "1"]), { a: 1, b: 2 }, { x: "str", y: "dex" });
  assert.deepEqual(plain(a.allocatedIds), ["1", "2", "3"]);
  assert.ok(history.sameTreeEditState(a, b));
  assert.ok(!history.sameTreeEditState(a, history.treeEditState(["1", "2"], {}, {})));
});

test("undo of a refund brings back every node it took, redo takes them again", () => {
  const S = (ids, sets = {}, attrs = {}) => history.treeEditState(ids, sets, attrs);
  const same = history.sameTreeEditState;
  let h = history.createHistory();
  assert.equal(history.canUndo(h), false);
  // Allocate a path, pick an attribute, then refund the root of the branch.
  const s0 = S(["start"]);
  const s1 = S(["start", "a", "b", "c"], {}, { c: "str" });
  const s2 = S(["start", "a", "b", "c"], {}, { c: "int" });
  const s3 = S(["start"]);
  h = history.recordEdit(h, s0, s1, same);
  h = history.recordEdit(h, s1, s2, same);
  h = history.recordEdit(h, s2, s3, same);
  assert.equal(h.past.length, 3);

  let step = history.undoEdit(h, s3);
  assert.deepEqual(plain(step.state), plain(s2), "undo puts back the whole branch and its attribute");
  h = step.history;
  assert.ok(history.canRedo(h));
  step = history.undoEdit(h, step.state);
  assert.deepEqual(plain(step.state), plain(s1));
  h = step.history;

  step = history.redoEdit(h, s1);
  assert.deepEqual(plain(step.state), plain(s2));
  h = step.history;
  step = history.redoEdit(h, s2);
  assert.deepEqual(plain(step.state), plain(s3));
  h = step.history;
  assert.equal(history.redoEdit(h, s3), null);
  assert.equal(h.past.length, 3);
});

test("a new edit drops the redo steps; an edit that changes nothing is not recorded", () => {
  const same = history.sameTreeEditState;
  const s0 = history.treeEditState(["s"]);
  const s1 = history.treeEditState(["s", "a"]);
  const s2 = history.treeEditState(["s", "a", "w"], { w: 1 });
  let h = history.recordEdit(history.createHistory(), s0, s1, same);
  h = history.undoEdit(h, s1).history;
  assert.equal(h.future.length, 1);
  h = history.recordEdit(h, s0, s2, same);
  assert.equal(h.future.length, 0);
  assert.equal(history.recordEdit(h, s2, history.treeEditState(["w", "a", "s"], { w: 1 }), same), h);
  assert.equal(history.undoEdit(history.createHistory(), s0), null);
});

test("history keeps at most its limit of steps", () => {
  let h = history.createHistory(3);
  for (let i = 0; i < 6; i += 1) h = history.recordEdit(h, i, i + 1, (a, b) => a === b);
  assert.deepEqual(plain(h.past), [3, 4, 5]);
});

test("undo / redo keys", () => {
  assert.equal(history.historyKeyAction({ key: "z", ctrlKey: true }), "undo");
  assert.equal(history.historyKeyAction({ key: "Z", ctrlKey: true, shiftKey: true }), "redo");
  assert.equal(history.historyKeyAction({ key: "y", ctrlKey: true }), "redo");
  assert.equal(history.historyKeyAction({ key: "z", metaKey: true }), "undo");
  assert.equal(history.historyKeyAction({ key: "z" }), null);
  assert.equal(history.historyKeyAction({ key: "z", ctrlKey: true, altKey: true }), null);
  assert.equal(history.historyKeyAction({ key: "c", ctrlKey: true }), null);
});

test("boundsOfPoints skips missing and non-finite points", () => {
  assert.equal(fit.boundsOfPoints([]), null);
  assert.equal(fit.boundsOfPoints([undefined, null, { x: NaN, y: 1 }]), null);
  assert.deepEqual(plain(fit.boundsOfPoints([{ x: 1, y: -2 }, undefined, { x: -3, y: 4 }])), { minX: -3, minY: -2, maxX: 1, maxY: 4 });
});

test("fitViewToBounds frames the build with padding and clamps the zoom", () => {
  // A build spanning 10000 x 5000 in an 800 x 500 panel with 50px padding.
  const view = fit.fitViewToBounds({ minX: -2000, minY: 1000, maxX: 8000, maxY: 6000 }, 800, 500, { padding: 50 });
  assert.equal(view.x, 3000);
  assert.equal(view.y, 3500);
  assert.equal(view.zoom, Math.min(700 / 10000, 400 / 5000));
  // The whole box is on screen.
  assert.ok(10000 * view.zoom <= 700 + 1e-9 && 5000 * view.zoom <= 400 + 1e-9);

  // One node: grown to the minimum span instead of the max zoom on a single point.
  const one = fit.fitViewToBounds({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 800, 600, { padding: 40, minSpan: 2400, maxZoom: 0.45 });
  assert.equal(one.zoom, Math.min(720 / 2400, 520 / 2400));
  assert.equal(one.x, 5);

  // Clamped to the zoom range.
  assert.equal(fit.fitViewToBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 4000, 4000, { minSpan: 1, maxZoom: 0.45 }).zoom, 0.45);
  assert.equal(fit.fitViewToBounds({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }, 300, 300, { minZoom: 0.016 }).zoom, 0.016);

  // A viewport smaller than the padding still gets a finite, positive zoom.
  const tiny = fit.fitViewToBounds({ minX: 0, minY: 0, maxX: 5000, maxY: 5000 }, 60, 60, { padding: 64 });
  assert.ok(Number.isFinite(tiny.zoom) && tiny.zoom > 0);
});

test("search finds nodes by Vietnamese or English text, with or without accents", () => {
  const nodes = [
    { id: "1", name: "Heavy Hitter", type: "notable", stats: ["Tăng 20% sát thương vật lý"], searchText: "20% increased Physical Damage", x: 900, y: 0 },
    { id: "2", name: "Physical Damage", type: "small", stats: ["Tăng 8% sát thương vật lý"], searchText: "8% increased Physical Damage", x: 100, y: 0 },
    { id: "3", name: "Resolute Technique", type: "keystone", stats: ["Đòn đánh luôn trúng"], searchText: "Your hits can't be evaded", x: 4000, y: 0 },
    { id: "4", name: "Life", type: "small", stats: ["+10 [MaximumLife|Máu tối đa]"], searchText: "+10 to maximum Life", x: 50, y: 0 }
  ];
  const ids = (query) => plain(search.searchTreeNodes(nodes, query).map((node) => node.id));
  assert.deepEqual(ids("sát thương"), ["1", "2"], "notable first");
  assert.deepEqual(ids("sat thuong vat ly"), ["1", "2"], "accents optional");
  assert.deepEqual(ids("physical damage"), ["1", "2"]);
  assert.deepEqual(ids("PHYSICAL 20%"), ["1"]);
  assert.deepEqual(ids("resolute"), ["3"]);
  assert.deepEqual(ids("đòn đánh"), ["3"]);
  assert.deepEqual(ids("don danh"), ["3"]);
  assert.deepEqual(ids("máu tối đa"), ["4"], "PoE markup label is searchable");
  assert.deepEqual(ids("   "), []);
  assert.deepEqual(ids("không có"), []);
});

test("stepMatchIndex walks the matches and wraps", () => {
  assert.equal(search.stepMatchIndex(-1, 3, 1), 0);
  assert.equal(search.stepMatchIndex(-1, 3, -1), 2);
  assert.equal(search.stepMatchIndex(2, 3, 1), 0);
  assert.equal(search.stepMatchIndex(0, 3, -1), 2);
  assert.equal(search.stepMatchIndex(5, 3, 1), 0);
  assert.equal(search.stepMatchIndex(0, 0, 1), -1);
});

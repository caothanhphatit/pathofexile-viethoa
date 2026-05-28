import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readRepoFile = (filename) => readFile(join(repoRoot, filename), "utf8");

test("React passive tree keeps Canvas renderer split into focused modules", async () => {
  const [page, canvas, draw, camera, tree] = await Promise.all([
    readRepoFile("src/spa/pages/PassiveTreePage.tsx"),
    readRepoFile("src/spa/passive/TreeCanvas.tsx"),
    readRepoFile("src/spa/passive/draw.ts"),
    readRepoFile("src/spa/passive/camera.ts"),
    readRepoFile("src/spa/passive/tree.ts")
  ]);

  assert.match(page, /loadPassiveTreeData/);
  assert.match(page, /TreeCanvas/);
  assert.match(canvas, /getContext\("2d"/);
  assert.match(canvas, /requestAnimationFrame/);
  assert.match(canvas, /onPointerDown/);
  assert.match(draw, /renderPassiveTree/);
  assert.match(draw, /visibleNodes/);
  assert.match(draw, /filteredTreeNodes/);
  assert.match(camera, /fitCameraToBounds/);
  assert.match(camera, /zoomCameraAt/);
  assert.match(tree, /parsePassiveTree/);
  assert.match(tree, /ascendancyByName/);
  assert.match(tree, /projectNodeForView/);
  assert.match(tree, /hitTestNode/);
});

test("passive tree page exposes expected product controls", async () => {
  const page = await readRepoFile("src/spa/pages/PassiveTreePage.tsx");

  assert.match(page, /classFilter/);
  assert.match(page, /ascendancyFilter/);
  assert.match(page, /search/);
  assert.match(page, /allocatedIds/);
  assert.match(page, /Fit/);
  assert.match(page, /Reset/);
});

test("React passive tree stat tooltips are eligible for dictionary term wrapping", async () => {
  const [page, terms] = await Promise.all([
    readRepoFile("src/spa/pages/PassiveTreePage.tsx"),
    readRepoFile("src/spa/lib/poeTerms.ts")
  ]);
  const selectorStart = terms.indexOf("const EXCLUDE_SELECTOR = [");
  const selectorEnd = terms.indexOf("].join", selectorStart);
  const excludeSelectorBlock = selectorStart >= 0 && selectorEnd > selectorStart
    ? terms.slice(selectorStart, selectorEnd)
    : "";

  assert.match(page, /formatPassiveStatText/);
  assert.match(page, /className=\{`passive-tooltip/);
  assert.match(terms, /MutationObserver/);
  assert.match(terms, /applyTooltips\(node, index\)/);
  assert.notEqual(excludeSelectorBlock, "");
  assert.doesNotMatch(excludeSelectorBlock, /"\.passive-tooltip"/);
});

test("React passive tree can hold the hovered node detail while Alt is pressed", async () => {
  const canvas = await readRepoFile("src/spa/passive/TreeCanvas.tsx");

  assert.match(canvas, /heldHover/);
  assert.match(canvas, /event\.key !== "Alt"/);
  assert.match(canvas, /event\.type === "keydown"/);
  assert.match(canvas, /event\.type === "keyup"/);
  assert.match(canvas, /heldHover\.current/);
  assert.match(canvas, /releaseHeldHover/);
});

test("React passive tree lets held node details receive term hover events", async () => {
  const [page, canvas, styles] = await Promise.all([
    readRepoFile("src/spa/pages/PassiveTreePage.tsx"),
    readRepoFile("src/spa/passive/TreeCanvas.tsx"),
    readRepoFile("src/spa/styles.css")
  ]);

  assert.match(canvas, /held:\s*boolean/);
  assert.match(page, /hover\.held\s*\?\s*"is-held"/);
  assert.match(styles, /\.passive-tooltip\.is-held\s*{[^}]*pointer-events:\s*auto/s);
});

test("React passive tree keeps selected ascendancy projected into the class disc", async () => {
  const [page, canvas, draw, tree, styles] = await Promise.all([
    readRepoFile("src/spa/pages/PassiveTreePage.tsx"),
    readRepoFile("src/spa/passive/TreeCanvas.tsx"),
    readRepoFile("src/spa/passive/draw.ts"),
    readRepoFile("src/spa/passive/tree.ts"),
    readRepoFile("src/spa/styles.css")
  ]);

  assert.match(page, /parsed\.classByName\.get\(initialClass\)\?\.ascendancies\[0\]\?\.name/);
  assert.match(page, /tree\.classByName\.get\(classFilter\)\?\.ascendancies\.map/);
  assert.match(tree, /classDiscStrokeRadius/);
  assert.match(tree, /projectAscendancyNode/);
  assert.match(tree, /node\.ascendancyName !== ascendancyFilter/);
  assert.match(tree, /isAscendancyNode \|\| node\.ascendancyName/);
  assert.match(canvas, /fitCurrentView/);
  assert.match(canvas, /filteredTreeNodes\(tree, opts\.classFilter, opts\.ascendancyFilter\)/);
  assert.match(draw, /from\.ascendancyName !== to\.ascendancyName/);
  assert.match(styles, /\.passive-action/);
});

test("React passive tree exposes the official 0.4 to 0.5 changes overlay", async () => {
  const [page, draw, changes, data, dataFile, styles, script] = await Promise.all([
    readRepoFile("src/spa/pages/PassiveTreePage.tsx"),
    readRepoFile("src/spa/passive/draw.ts"),
    readRepoFile("src/spa/passive/changes.ts"),
    readRepoFile("src/spa/lib/data.ts"),
    readRepoFile("public/data/passive-tree-changes.js"),
    readRepoFile("src/spa/styles.css"),
    readRepoFile("scripts/passive-tree/build-changes.mjs")
  ]);

  assert.match(data, /loadPassiveTreeChanges/);
  assert.match(changes, /parsePassiveTreeChanges/);
  assert.match(changes, /CHANGE_COLORS/);
  assert.match(page, /loadPassiveTreeChanges/);
  assert.match(page, /passive-changes-panel/);
  assert.match(page, /changesOn/);
  assert.match(page, /runCommand\("focus"/);
  assert.match(draw, /changeById/);
  assert.match(draw, /drawRemovedGhosts/);
  assert.match(draw, /pushRing\(CHANGE_COLORS\[change\.status\]/);
  assert.match(styles, /\.passive-changes-panel/);
  assert.match(script, /buildPassiveTreeChanges/);
  assert.match(dataFile, /POE2_PASSIVE_TREE_CHANGES/);
  assert.match(dataFile, /"base_version":"0\.4\.0"/);
  assert.match(dataFile, /"target_version":"0\.5\.0"/);
  assert.match(dataFile, /"added":/);
  assert.match(dataFile, /"stats":/);
});

test("React passive tree renders newly added change nodes as real nodes", async () => {
  const [draw, changes, dataFile, script] = await Promise.all([
    readRepoFile("src/spa/passive/draw.ts"),
    readRepoFile("src/spa/passive/changes.ts"),
    readRepoFile("public/data/passive-tree-changes.js"),
    readRepoFile("scripts/passive-tree/build-changes.mjs")
  ]);

  assert.match(changes, /iconPath: string/);
  assert.match(changes, /iconPath:\s*String\(entry\.iconPath/);
  assert.match(script, /iconPath:\s*passiveIconAssetPath/);
  assert.match(dataFile, /"status":"added"/);
  assert.match(dataFile, /"iconPath":"\/assets\/passive-tree\/icons\//);
  assert.match(draw, /passiveIconForNode/);
  assert.match(draw, /change\.status === "added"/);
  assert.match(draw, /change\.status === "added"/);
});

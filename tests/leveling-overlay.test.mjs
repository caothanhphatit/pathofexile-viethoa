import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const levelingHtml = readFileSync(new URL("../leveling.html", import.meta.url), "utf8");

test("game overlay renders current quest context", () => {
  assert.match(levelingHtml, /data-overlay-current/);
  assert.match(levelingHtml, /Quest hiện tại/);
  assert.match(levelingHtml, /data-overlay-drag/);
});

test("game overlay starts from the current unfinished task instead of the first zone task", () => {
  assert.match(levelingHtml, /const overlayTasksForZone = \(zone, focusTaskId\) =>/);
  assert.match(levelingHtml, /const focusIndex = unfinishedTasks\.findIndex\(\(task\) => task\.id === focusTaskId\);/);
  assert.doesNotMatch(
    levelingHtml,
    /const visibleTasks = zone\.tasks\.filter\(overlayTaskVisible\);\s*const tasks = visibleTasks\.slice\(0, overlayMaxVisibleTasks\);/
  );
});

test("game overlay current quest ignores page task filter", () => {
  assert.match(levelingHtml, /const firstUnfinishedTaskInZone = \(zone\) =>/);
  assert.doesNotMatch(
    levelingHtml,
    /if \(checkbox\) return !checkbox\.checked && taskMatchesFilter\(checkbox\);/
  );
});

test("game overlay advances past a completed route zone", () => {
  assert.match(
    levelingHtml,
    /const unfinishedInRouteZone = firstUnfinishedTaskInZone\(zoneEntry\.zone\);\s*if \(unfinishedInRouteZone\) return/
  );
  assert.doesNotMatch(levelingHtml, /if \(zoneEntry\) return zoneEntry;/);
});

test("game overlay pip render uses the page document theme and closes failed blank windows", () => {
  assert.match(levelingHtml, /document\.documentElement\.classList\.contains\("dark"\)/);
  assert.doesNotMatch(levelingHtml, /root\.classList\.contains\("dark"\)/);
  assert.match(levelingHtml, /gameOverlayPipWindow\.close\(\);/);
  assert.match(levelingHtml, /gameOverlayPipWindow = null;\s*openGameOverlayPanel\(\);/);
});

test("game overlay stays compact and only exposes four quest items", () => {
  assert.match(levelingHtml, /const overlayMaxVisibleTasks = 4;/);
  assert.match(levelingHtml, /const overlayPipMinHeight = 96;/);
  assert.match(levelingHtml, /const overlayPipMaxHeight = 148;/);
  assert.match(levelingHtml, /const overlayVisibleTaskCount = \(\) =>/);
  assert.match(levelingHtml, /requestWindow\(\{ width: overlayPipWidth, height: overlayPipTargetHeight\(\) \}\)/);
  assert.match(levelingHtml, /resizeGameOverlayPipWindow\(\);/);
  assert.match(levelingHtml, /gameOverlayPipWindow\.resizeTo\(overlayPipWidth, nextHeight\);/);
  assert.doesNotMatch(levelingHtml, /max-height: min\(248px/);
  assert.doesNotMatch(levelingHtml, /\.game-overlay-card \{ height: 100vh;/);
  assert.match(levelingHtml, /\.dark body \{ background: transparent;/);
  assert.match(levelingHtml, /\.game-overlay-list \{\s*max-height: inherit;\s*overflow: hidden;/);
  assert.match(levelingHtml, /\.game-overlay-task-title \{[^}]*-webkit-line-clamp: 2;/s);
});

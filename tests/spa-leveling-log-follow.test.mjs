import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const levelingPage = readFileSync(new URL("../src/spa/pages/LevelingPage.tsx", import.meta.url), "utf8");
const spaStyles = readFileSync(new URL("../src/spa/styles.css", import.meta.url), "utf8");

test("React leveling v1 exposes game-log map follow state and API calls", () => {
  assert.match(levelingPage, /LOG_FOLLOW_KEY = "poe2-leveling-campaign-log-follow-v1"/);
  assert.match(levelingPage, /LOG_PATH_KEY = "poe2-leveling-campaign-log-path-v1"/);
  assert.match(levelingPage, /\/api\/leveling\/log\/status/);
  assert.match(levelingPage, /\/api\/leveling\/log\/config/);
  assert.match(levelingPage, /\/api\/leveling\/log\/events/);
  assert.match(levelingPage, /new EventSource/);
  assert.match(levelingPage, /id="classicLogAutoFollow"/);
  assert.match(levelingPage, /id="classicLogPath"/);
});

test("React leveling v1 maps log zones to route zones without auto-completing tasks", () => {
  assert.match(levelingPage, /buildClassicZoneAliasMap/);
  assert.match(levelingPage, /matchClassicLogZone/);
  assert.match(levelingPage, /applyClassicLogStatus/);
  assert.match(levelingPage, /revealZoneFromLog/);
  assert.doesNotMatch(levelingPage, /setCompleted[\s\S]*source:\s*"log"/);
  assert.match(spaStyles, /\.leveling-v1-log/);
  assert.match(spaStyles, /\.leveling-v1-log-status\[data-log-zone-status="ok"\]/);
});

test("React game overlay keeps manual tracking controls outside auto log permission", () => {
  assert.match(levelingPage, /overlayManualTaskId/);
  assert.match(levelingPage, /moveOverlayManual/);
  assert.match(levelingPage, /toggleOverlayCurrent/);
  assert.match(levelingPage, /className="game-overlay-manual"/);
  assert.match(levelingPage, /aria-label="Manual tracker"/);
  assert.match(levelingPage, /onClick=\{\(\) => moveOverlayManual\(-1\)\}/);
  assert.match(levelingPage, /onClick=\{toggleOverlayCurrent\}/);
  assert.doesNotMatch(levelingPage, /toggleOverlayCurrent[\s\S]{0,400}logAutoFollow/);
  assert.match(spaStyles, /\.game-overlay-manual/);
  assert.match(spaStyles, /\.game-overlay-inner\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const levelingHtml = readFileSync(new URL("../public/leveling.html", import.meta.url), "utf8");

test("classic checklist v1 exposes game log map-follow controls", () => {
  assert.match(levelingHtml, /poe2-leveling-campaign-log-follow-v1/);
  assert.match(levelingHtml, /poe2-leveling-campaign-log-path-v1/);
  assert.match(levelingHtml, /id="classicLogAutoFollow"/);
  assert.match(levelingHtml, /id="classicLogStatus"/);
  assert.match(levelingHtml, /id="classicLogPath"/);
  assert.match(levelingHtml, /id="classicLogConnect"/);
  assert.match(levelingHtml, /id="classicLogDetect"/);
  assert.match(levelingHtml, /Client\.txt/);
});

test("classic checklist v1 maps Client.txt zones without completing tasks", () => {
  assert.match(levelingHtml, /const buildClassicZoneAliasMap = \(\) =>/);
  assert.match(levelingHtml, /const matchClassicLogZone = \(zoneName\) =>/);
  assert.match(levelingHtml, /const applyClassicLogStatus = \(status\) =>/);
  assert.match(levelingHtml, /const revealZoneFromLog = \(zoneEntry, status\) =>/);
  assert.match(levelingHtml, /\/api\/leveling\/log\/status/);
  assert.match(levelingHtml, /\/api\/leveling\/log\/config/);
  assert.match(levelingHtml, /\/api\/leveling\/log\/events/);
  assert.match(levelingHtml, /EventSource/);
  assert.doesNotMatch(levelingHtml, /classicLog[\s\S]*syncTaskProgress\(.*true.*log/);
});

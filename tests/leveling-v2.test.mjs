import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const levelingHtml = readFileSync(new URL("../public/leveling.html", import.meta.url), "utf8");
const levelingV2 = readFileSync(new URL("../public/components/leveling-v2.js", import.meta.url), "utf8");

test("leveling page exposes Checklist V2 as an isolated tab", () => {
  assert.match(levelingHtml, /data-checklist-tab="classic"/);
  assert.match(levelingHtml, /data-checklist-tab="v2"/);
  assert.match(levelingHtml, /data-checklist-panel="classic"/);
  assert.match(levelingHtml, /data-checklist-panel="v2"/);
  assert.match(levelingHtml, /id="levelingV2Root"/);
  assert.match(levelingHtml, /components\/leveling-v2\.js/);
});

test("Checklist V2 uses separate progress and log-tracker state", () => {
  assert.match(levelingV2, /poe2-leveling-v2-progress-v1/);
  assert.match(levelingV2, /poe2-leveling-v2-guest-store-v1/);
  assert.match(levelingV2, /poe2-leveling-v2-current-zone-v1/);
  assert.match(levelingV2, /\/api\/leveling\/log\/status/);
  assert.match(levelingV2, /\/api\/leveling\/log\/config/);
  assert.match(levelingV2, /\/api\/leveling\/log\/events/);
  assert.match(levelingV2, /\/api\/auth\/config/);
  assert.match(levelingV2, /\/api\/auth\/session/);
  assert.match(levelingV2, /\/api\/auth\/google\/start/);
  assert.match(levelingV2, /\/api\/leveling\/me/);
  assert.match(levelingV2, /\/api\/leveling\/characters/);
  assert.match(levelingV2, /v2CreateCharacter/);
  assert.match(levelingV2, /v2SyncGuest/);
  assert.match(levelingV2, /loadGuestState/);
  assert.match(levelingV2, /saveGuestState/);
  assert.match(levelingV2, /Guest mode/);
  assert.match(levelingV2, /v2CharacterMismatch/);
  assert.match(levelingV2, /v2AutoDetectLog/);
  assert.match(levelingV2, /characterName/);
  assert.match(levelingV2, /Nhân vật/);
  assert.match(levelingV2, /Đã kết nối log/);
  assert.match(levelingV2, /Không tìm thấy log/);
  assert.doesNotMatch(levelingV2, /poe2-leveling-campaign-progress-v1/);
});

test("Checklist V2 is guest-first instead of blocking behind login", () => {
  assert.match(levelingV2, /renderAccountPanel/);
  assert.match(levelingV2, /state\.mode === "guest"/);
  assert.doesNotMatch(levelingV2, /root\.innerHTML = renderAuthGate\(\);\s*return;/);
});

test("Checklist V2 is visually locked while automatic mode is under development", () => {
  assert.match(levelingHtml, /v2-locked-shell/);
  assert.match(levelingHtml, /v2-lock-overlay/);
  assert.match(levelingHtml, /Chế độ tự động checklist đang phát triển/);
  assert.match(levelingHtml, /material-symbols-rounded" aria-hidden="true">lock/);
  assert.doesNotMatch(levelingHtml, /Tạm khóa phần auto-follow\/sync/);
});

test("Checklist V2 maps raw Client.txt zone names on the frontend", () => {
  assert.match(levelingV2, /const buildZoneAliasMap = \(\) =>/);
  assert.match(levelingV2, /const matchZoneName = \(zoneName\) =>/);
  assert.match(levelingV2, /normalizeZoneName/);
  assert.match(levelingV2, /phaseOneZoneFollow/);
  assert.match(levelingV2, /Auto-follow/);
});

test("Checklist V2 keeps Auto-follow in the top test controls", () => {
  assert.match(levelingV2, /renderStatusPanel/);
  assert.match(levelingV2, /renderTopTestControls/);
  assert.match(levelingV2, /v2-top-controls/);
  assert.match(levelingV2, /id="v2AutoFollow"/);
  assert.match(levelingV2, /Phase 1/);
  assert.doesNotMatch(levelingV2, /renderLogControls[\s\S]*id="v2AutoFollow"/);
});

test("Checklist V2 phase 1 only follows zones and does not auto-complete tasks", () => {
  assert.doesNotMatch(levelingV2, /LOG_TASK_RULES/);
  assert.doesNotMatch(levelingV2, /completeTaskFromLog/);
  assert.doesNotMatch(levelingV2, /completePreviousRequiredZones/);
  assert.doesNotMatch(levelingV2, /v2AutoCheck/);
  assert.doesNotMatch(levelingV2, /auto-check/i);
  assert.doesNotMatch(levelingV2, /syncTaskProgress\(taskId, true, "log"\)/);
});

// Compact in-game style Skills panel (base-art ratios) and Build Planner compact popup layout.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { loadPlannerLib, loadSpaLib, repoRoot } from "../scripts/lib/planner-node.mjs";

const readRepoFile = (filename) => readFile(join(repoRoot, filename), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

/** Loads pure helper functions from a TSX component without React DOM. */
async function loadTsxHelpers(relativePath, extraDeps = {}) {
  const source = await readRepoFile(relativePath);
  const buildStats = await loadSpaLib("buildStats");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const module = { exports: {} };
  const stub = {};
  const deps = new Map([
    ["react", { useCallback: () => {}, useEffect: () => {}, useLayoutEffect: () => {}, useRef: () => ({}), useState: () => [null, () => {}] }],
    ["react/jsx-runtime", { jsx: () => null, jsxs: () => null, Fragment: "Fragment" }],
    ["../lib/buildStats", buildStats],
    ["../lib/buildPlanner", stub],
    ["../lib/gemOptions", stub],
    ["../../server/pob-monster-gems.mjs", stub],
    ["../../server/pob-gem-families.mjs", stub],
    ["./BuildGemOptions", stub],
    ["./BuildInventoryPanel", stub],
    ["./BuildSkillDetail", stub],
    ["../styles/planner-skills.css", stub],
    ...Object.entries(extraDeps)
  ]);
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require: (id) => deps.get(id) ?? stub,
    Math,
    Number,
    String,
    Array,
    Set,
    Object
  });
  return module.exports;
}

test("skillDamageBadge keeps full comma-formatted numbers (never abbreviated) and distinguishes DPS vs DMG", async () => {
  const { skillDamageBadge, formatBadgeNumber, supportInitials } = await loadTsxHelpers("src/spa/components/BuildSkillDetail.tsx");

  assert.equal(formatBadgeNumber(2656065), "2,656,065");
  assert.equal(formatBadgeNumber(15_400_000), "15,400,000");

  assert.deepEqual(
    plain(skillDamageBadge({ dps: 226771, before: 200000, perHit: false, disabled: false, calculating: false, locale: "vi" })),
    { kind: "DPS", value: "226,771", deltaText: "+13%", deltaBetter: true, exact: "226,771 DPS" }
  );
  assert.deepEqual(
    plain(skillDamageBadge({ dps: 2_656_065, perHit: false, disabled: false, calculating: false, locale: "vi" })),
    { kind: "DPS", value: "2,656,065", exact: "2,656,065 DPS" }
  );
  assert.deepEqual(
    plain(skillDamageBadge({ dps: 30615, perHit: true, disabled: false, calculating: false, locale: "vi" })),
    { kind: "DMG", value: "30,615", unit: "/đòn", exact: "30,615 sát thương/đòn" }
  );
  assert.deepEqual(
    plain(skillDamageBadge({ dps: 30615, perHit: true, disabled: false, calculating: false, locale: "en" })),
    { kind: "DMG", value: "30,615", unit: "/hit", exact: "30,615 DMG/hit" }
  );
  assert.deepEqual(
    plain(skillDamageBadge({ dps: 0, perHit: false, disabled: false, calculating: false, locale: "vi" })),
    { value: "—" }
  );
  assert.deepEqual(
    plain(skillDamageBadge({ dps: 12000, perHit: false, disabled: true, calculating: false, locale: "vi" })),
    { value: "Tắt" }
  );
  assert.deepEqual(
    plain(skillDamageBadge({ dps: undefined, perHit: false, disabled: false, calculating: true, locale: "vi" })),
    { value: "…" }
  );

  assert.equal(supportInitials("Martial Tempo"), "MT");
  assert.equal(supportInitials("Elemental Armament III"), "EA");
  assert.equal(supportInitials("!!!"), "?");
});

test("fitSkillNameLayout prioritizes gem name over granted-skill suffix and hides suffix before truncating name", async () => {
  const { fitSkillNameLayout } = await loadTsxHelpers("src/spa/components/BuildSkillPanel.tsx");

  // Plenty of room (e.g. "Wind Dancer" 94px in 173px name slot at W=538): show suffix, gem name never truncated.
  const windDesktop = fitSkillNameLayout({ availableWidth: 173, nameWidth: 94, hasSuffix: true });
  assert.equal(windDesktop.showSuffix, true);
  assert.equal(windDesktop.namePriority, true);
  assert.equal(windDesktop.suffixMaxWidth, 74);

  // Tight room (e.g. "Cast on Critical" 135px in 173px): leftover 33px < 38px -> hide suffix so gem name stays 100% untruncated.
  const cocTight = fitSkillNameLayout({ availableWidth: 173, nameWidth: 135, hasSuffix: true });
  assert.equal(cocTight.showSuffix, false);
  assert.equal(cocTight.namePriority, false);

  // Phone width (e.g. "Cast on Critical" 96px in 125px name slot at W=309): leftover 24px < 38px -> suffix hidden, name gets full 125px.
  const cocPhone = fitSkillNameLayout({ availableWidth: 125, nameWidth: 96, hasSuffix: true });
  assert.equal(cocPhone.showSuffix, false);
  assert.equal(cocPhone.namePriority, false);

  // No suffix: never reserves suffix space.
  assert.deepEqual(
    plain(fitSkillNameLayout({ availableWidth: 173, nameWidth: 90, hasSuffix: false })),
    { showSuffix: false, namePriority: false, suffixMaxWidth: 0 }
  );
});

test("supportSockets defaults to max(2, socketed) capped at 5, respects stepper bounds, saves in .build, and never reaches PoB", async () => {
  const lib = await loadPlannerLib();
  const sup = (id, active = false) => ({ id, skillId: `Support${id}`, note: "", levelStart: "", levelEnd: "", ...(active ? { active: true } : {}) });

  // Defaults when supportSockets is absent: max(2, non-active supports), capped at 5.
  assert.equal(lib.effectiveSupportSockets({ supportSkills: [] }), 2);
  assert.equal(lib.effectiveSupportSockets({ supportSkills: [sup("1")] }), 2);
  assert.equal(lib.effectiveSupportSockets({ supportSkills: [sup("1"), sup("2")] }), 2);
  assert.equal(lib.effectiveSupportSockets({ supportSkills: [sup("1"), sup("2"), sup("3")] }), 3);
  assert.equal(lib.effectiveSupportSockets({ supportSkills: [sup("1"), sup("2"), sup("3"), sup("4"), sup("5"), sup("6")] }), 5);
  // Active triggered gems (e.g. Comet in Cast on Critical) do not count as support sockets.
  assert.equal(lib.effectiveSupportSockets({ supportSkills: [sup("c1", true), sup("c2", true), sup("s1")] }), 2);

  // Explicit stored value is clamped to [max(2, socketed), 5].
  assert.equal(lib.effectiveSupportSockets({ supportSockets: 4, supportSkills: [sup("1")] }), 4);
  assert.equal(lib.effectiveSupportSockets({ supportSockets: 1, supportSkills: [] }), 2);
  assert.equal(lib.effectiveSupportSockets({ supportSockets: 9, supportSkills: [] }), 5);
  assert.equal(lib.effectiveSupportSockets({ supportSockets: 2, supportSkills: [sup("1"), sup("2"), sup("3")] }), 3);

  // Stepper bounds: cannot decrease below max(2, socketed), cannot exceed 5.
  assert.deepEqual(plain(lib.supportSocketStepperBounds({ supportSkills: [] })), {
    current: 2, min: 2, max: 5, canDecrease: false, canIncrease: true
  });
  assert.deepEqual(plain(lib.supportSocketStepperBounds({ supportSockets: 4, supportSkills: [sup("1"), sup("2"), sup("3")] })), {
    current: 4, min: 3, max: 5, canDecrease: true, canIncrease: true
  });
  assert.deepEqual(plain(lib.supportSocketStepperBounds({ supportSockets: 3, supportSkills: [sup("1"), sup("2"), sup("3")] })), {
    current: 3, min: 3, max: 5, canDecrease: false, canIncrease: true
  });
  assert.deepEqual(plain(lib.supportSocketStepperBounds({ supportSockets: 5, supportSkills: [sup("1")] })), {
    current: 5, min: 2, max: 5, canDecrease: true, canIncrease: false
  });

  // Persisted in saved BuildProject and .build export/import round-trip.
  const skill = {
    id: "sk-1",
    skillId: "Metadata/Items/Gems/SkillGemArc",
    note: "",
    levelStart: "",
    levelEnd: "",
    supportSockets: 4,
    supportSkills: [sup("1"), sup("2")]
  };
  const saved = lib.normalizeBuildProject(plain(lib.createBuildProject({ name: "Sockets", author: "", description: "", skills: [skill] })));
  assert.equal(saved.skills[0].supportSockets, 4);

  const exportedRow = lib.buildSkill(skill);
  assert.equal(exportedRow.support_sockets, 4);
  const reimported = lib.skillChoiceFromBuildSkill(plain(exportedRow));
  assert.equal(reimported.supportSockets, 4);

  // Absent in old builds stays undefined (falls back to default at render time).
  const legacy = lib.skillChoiceFromBuildSkill({ id: "Metadata/Items/Gems/SkillGemArc", support_skills: ["SupportA"] });
  assert.equal(legacy.supportSockets, undefined);
  assert.equal(lib.effectiveSupportSockets(legacy), 2);

  // Never sent to PoB calculation request.
  const calcBody = lib.calculationRequestBody({
    payload: { className: "Witch" },
    passives: [],
    inventory: [],
    skills: [skill],
    activeWeaponSet: 1,
    mainSocketGroup: 1
  });
  assert.equal("supportSockets" in calcBody.skills[0], false);
  assert.equal("support_sockets" in calcBody.skills[0], false);
});

test("countChangedConditions counts PoB config inputs differing from default", async () => {
  const { countChangedConditions } = await loadTsxHelpers("src/spa/components/BuildDrawerBar.tsx", {
    "../lib/locale": { formatNumber: (n) => String(n) }
  });

  assert.equal(countChangedConditions(undefined), 0);
  assert.equal(countChangedConditions([]), 0);
  assert.equal(countChangedConditions([
    { name: "enemyIsBoss", kind: "string", value: "Pinnacle" }
  ]), 0, "Pinnacle is PoB default");
  assert.equal(countChangedConditions([
    { name: "enemyIsBoss", kind: "string", value: "Uber" },
    { name: "conditionEnemyShocked", kind: "boolean", value: true },
    { name: "multiplierNearbyEnemies", kind: "number", value: 3 },
    { name: "unknownInput", kind: "boolean", value: true }
  ]), 3);
});

test("Skills panel matches PoE2 base-art cqw proportions, 7.6cqw icon, clickable recesses, and stepper", async () => {
  const [page, panel, detail, styles, html] = await Promise.all([
    readRepoFile("src/spa/pages/BuildPlannerPage.tsx"),
    readRepoFile("src/spa/components/BuildSkillPanel.tsx"),
    readRepoFile("src/spa/components/BuildSkillDetail.tsx"),
    readRepoFile("src/spa/styles/planner-skills.css"),
    readRepoFile("public/index.html")
  ]);

  assert.match(page, /<BuildSkillPanel/);
  assert.doesNotMatch(page, /className="sk-grid"/);
  assert.match(page, /activeWeaponSet=\{activeWeaponSet\}/);
  assert.match(page, /color:\s*record\?\.color/);
  // Adding a support automatically bumps supportSockets when no empty ring is left.
  assert.match(page, /const currentSockets = effectiveSupportSockets\(row\)/);

  // Compact list: SkillNameFit priority, clickable recess button ("Thêm ô support"), effectiveSupportSockets.
  assert.match(panel, /<SkillNameFit/);
  assert.match(panel, /effectiveSupportSockets\(skill\)/);
  assert.match(panel, /className="sk-socket-recess"/);
  assert.match(panel, /Thêm ô support/);
  assert.match(panel, /supportSockets:\s*Math\.min\(MAX_SUPPORT_SOCKETS,\s*socketCount \+ 1\)/);

  // Detail panel: "Số ô support" 2-5 stepper.
  assert.match(detail, /supportSocketStepperBounds\(skill\)/);
  assert.match(detail, /Số ô support/);
  assert.match(detail, /className="sk-socket-stepper"/);

  // Real PoE2 base-art ratios + exact 7.6cqw header icon at left 8.7cqw.
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*52\.2fr\)\s+minmax\(0,\s*47\.8fr\)/);
  assert.match(styles, /padding:\s*0\s+6\.7%/);
  assert.match(styles, /height:\s*max\(44px,\s*9\.52cqw\)/);
  assert.match(styles, /\.sk-row-icon\s*\{[\s\S]*?left:\s*8\.7cqw[\s\S]*?width:\s*max\(32px,\s*7\.6cqw\)[\s\S]*?height:\s*max\(32px,\s*7\.6cqw\)/);
  assert.match(styles, /min-height:\s*max\(48px,\s*13\.1cqw\)/);
  assert.match(styles, /\.sk-row\s*\{[\s\S]*?gap:\s*0/);
  assert.match(styles, /width:\s*calc\(182 \/ 840 \* 100cqw\)/);
  assert.match(styles, /height:\s*max\(22px,\s*calc\(40 \/ 840 \* 100cqw\)\)/);
  assert.match(styles, /width:\s*max\(48px,\s*11\.7cqw\)/);
  assert.match(styles, /width:\s*max\(36px,\s*8\.7cqw\)/);
  assert.match(styles, /grid-template-columns:\s*repeat\(5,\s*14\.1cqw\)/);
  assert.match(styles, /width:\s*90cqw/);
  assert.match(styles, /min-height:\s*max\(34px,\s*5\.6cqw\)/);
  assert.match(styles, /width:\s*max\(74px,\s*17\.4cqw\)/);
  assert.match(styles, /width:\s*max\(46px,\s*11\.0cqw\)/);
  assert.match(styles, /#8888ff/);

  assert.match(html, /\/dist\/app\.css\?v=\d{8}-[\w-]+/);
  assert.match(html, /\/dist\/spa\/assets\/app\.css\?v=\d{8}-[\w-]+/);
  assert.match(html, /\/dist\/spa\/assets\/app\.js\?v=\d{8}-[\w-]+/);
});

test("Build detail popups restore focus reliably across all three modals and nested StatBreakdownDialog", async () => {
  const [page, modal, breakdown, bar, modalCss] = await Promise.all([
    readRepoFile("src/spa/pages/BuildPlannerPage.tsx"),
    readRepoFile("src/spa/components/BuildModal.tsx"),
    readRepoFile("src/spa/components/StatBreakdown.tsx"),
    readRepoFile("src/spa/components/BuildDrawerBar.tsx"),
    readRepoFile("src/spa/styles/planner-modals.css")
  ]);

  // No Import button inside the opened build detail page's header actions.
  const heroActions = page.match(/className="nj-hero-actions"[\s\S]*?<\/header>/);
  assert.ok(heroActions, "hero actions block exists");
  assert.doesNotMatch(heroActions[0], /openPobImport|importBuildFile|copy\.importPob/);

  // All three modals wire their own trigger button ref for return focus; stats clears explainStat on close.
  assert.match(page, /open=\{activeModal === "tree"\}[\s\S]*?returnFocusRef=\{treeBtnRef\}/);
  assert.match(page, /open=\{activeModal === "config"\}[\s\S]*?returnFocusRef=\{configBtnRef\}/);
  assert.match(page, /open=\{activeModal === "stats"\}[\s\S]*?setExplainStat\(null\)[\s\S]*?returnFocusRef=\{statsBtnRef\}/);
  assert.match(page, /activeModal === "tree" \? linkedTreeCard : null/);

  // Shared modal restores focus synchronously in useLayoutEffect cleanup and closes backdrop on click (not mousedown).
  assert.match(modal, /useLayoutEffect\(\(\) => \{[\s\S]*?document\.body\.style\.overflow = "hidden"[\s\S]*?target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(modal, /backdropDownRef\.current && event\.target === event\.currentTarget/);
  assert.match(modal, /event\.key !== "Tab" \|\| disableEscape/);

  // Nested StatBreakdownDialog also restores focus on unmount and stops Escape propagation.
  assert.match(breakdown, /useLayoutEffect\(\(\) => \{[\s\S]*?prevActive\.focus\(\{ preventScroll: true \}\)/);
  assert.match(breakdown, /event\.stopPropagation\(\)/);

  // Page section order: header -> equipment+(stats|inventory tabs) -> compact button row -> skills.
  const idxHero = page.indexOf('className="nj-hero"');
  const idxTop = page.indexOf('className="nj-row nj-row--top"');
  const idxInventory = page.indexOf("<BuildInventoryPanel");
  const idxBar = page.indexOf("<BuildDrawerBar");
  const idxSkills = page.indexOf('className="nj-panel nj-skills"');
  assert.ok(idxHero > 0 && idxHero < idxTop && idxTop < idxInventory && idxInventory < idxBar && idxBar < idxSkills,
    "page order must be header -> equipment+(stats|inventory) -> button bar -> skills");

  assert.match(modalCss, /align-items:\s*start/);
  assert.match(bar, /Cây thụ động/);
  assert.match(bar, /Điều kiện/);
  assert.match(bar, /Chỉ số chi tiết/);
});

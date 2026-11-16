// Luồng kiểm tra Build Planner ↔ Path of Building.
//
// Với mỗi build mẫu trong tests/fixtures/pob-builds/*.json (một PoB code thật):
//   1. "Code":    số PoB đã ghi sẵn trong code (thẻ <PlayerStat>).
//   2. "PoB":     PoB chạy trên máy này với nguyên XML của code (bản PoB có thể khác bản
//                 người chơi dùng, nên cột này cho biết phần lệch do khác phiên bản PoB).
//   3. "Planner": code đi qua đúng đường của trang Build Planner (import -> trạng thái
//                 planner -> body POST /api/builds/calculate -> XML backend) rồi chạy PoB.
// Planner phải khớp cột PoB (cùng một engine); lệch là Planner làm rơi dữ liệu.
// Build có minion còn so chỉ số minion (dòng "Minion: ...", thẻ <MinionStat> của code).
//
// Thêm một lần đổi tuỳ chọn gem (checkGemOptionChange): chọn chế độ / phần kỹ năng /
// kỹ năng minion thứ 2 và corrupt +1 cho kỹ năng chính, sửa y như vậy trong XML gốc
// (như bấm trong PoB) và trong planner (như bấm trên thẻ kỹ năng), rồi so hai kết quả.
//
//   node scripts/check-pob-parity.mjs [--json] [--report-only] [fixture-name ...]
//
// Cần PoB chạy được trên máy: POB_CORE_DIR (thư mục src của PoB) và POB_LUAJIT
// (mặc định: ../pob-core/src và ../pob-core/runtime/pob-luajit-bin/pob-luajit.exe
// do scripts/setup-pob-local.mjs dựng; trên Linux là `luajit`).
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPobXml } from "../src/server/pob-build-xml.mjs";
import { loadSpaLib, plannerCalculationRequest, repoRoot } from "./lib/planner-node.mjs";

export const FIXTURE_DIR = join(repoRoot, "tests", "fixtures", "pob-builds");

/** Stats the check compares, with a Vietnamese label and how far apart they may be. */
export const PARITY_STATS = [
  { stat: "CombinedDPS", label: "DPS kỹ năng chính", rel: 0.01 },
  { stat: "Life", label: "Máu (Life)", rel: 0.005 },
  { stat: "EnergyShield", label: "Khiên năng lượng (ES)", rel: 0.005 },
  { stat: "Mana", label: "Mana", rel: 0.005 },
  { stat: "Spirit", label: "Spirit", rel: 0.005 },
  { stat: "Armour", label: "Giáp (Armour)", rel: 0.01 },
  { stat: "Evasion", label: "Né (Evasion)", rel: 0.01 },
  { stat: "FireResist", label: "Kháng lửa", abs: 0.5 },
  { stat: "ColdResist", label: "Kháng băng", abs: 0.5 },
  { stat: "LightningResist", label: "Kháng sét", abs: 0.5 },
  { stat: "ChaosResist", label: "Kháng hỗn mang", abs: 0.5 },
  { stat: "Str", label: "Sức mạnh (Str)", abs: 0.5 },
  { stat: "Dex", label: "Khéo léo (Dex)", abs: 0.5 },
  { stat: "Int", label: "Trí tuệ (Int)", abs: 0.5 },
  { stat: "TotalEHP", label: "Máu hiệu dụng (EHP)", rel: 0.02 },
  // Minion of the main skill (scripts/pob-calculate.lua -> Minion; <MinionStat> in the code).
  { stat: "Minion.CombinedDPS", label: "Minion: DPS", rel: 0.01 },
  { stat: "Minion.Life", label: "Minion: Life", rel: 0.005 },
  { stat: "Minion.EnergyShield", label: "Minion: ES", rel: 0.005 },
  { stat: "Minion.FireResist", label: "Minion: kháng lửa", abs: 0.5 },
  { stat: "Minion.ChaosResist", label: "Minion: kháng hỗn mang", abs: 0.5 }
];

/** stats["Minion.Life"] -> stats.Minion.Life. */
const statValue = (stats, key) => {
  if (!stats) return undefined;
  if (key in stats) return stats[key];
  const [head, rest] = key.split(".");
  return rest !== undefined && stats[head] && typeof stats[head] === "object" ? stats[head][rest] : undefined;
};

export function readFixtures(names = []) {
  if (!existsSync(FIXTURE_DIR)) return [];
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({ file, ...JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) }))
    .filter((fixture) => !names.length || names.some((name) => fixture.file.includes(name) || fixture.name?.includes(name)));
}

export function pobRuntime(env = process.env) {
  const coreDir = env.POB_CORE_DIR || resolve(repoRoot, "..", "pob-core", "src");
  const winHost = resolve(coreDir, "..", "runtime", "pob-luajit-bin", "pob-luajit.exe");
  const luajit = env.POB_LUAJIT || (existsSync(winHost) ? winHost : "luajit");
  const available = existsSync(join(coreDir, "calculate.lua")) && (luajit === "luajit" ? process.platform !== "win32" : existsSync(luajit));
  return { coreDir, luajit, available };
}

export function runPob(xml, runtime = pobRuntime()) {
  const file = join(tmpdir(), `pob_parity_${process.pid}_${Math.random().toString(36).slice(2, 8)}.xml`);
  writeFileSync(file, xml, "utf8");
  return new Promise((resolvePromise, reject) => {
    execFile(runtime.luajit, ["calculate.lua", file], { cwd: runtime.coreDir, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      try { unlinkSync(file); } catch {}
      if (error) return reject(new Error(stderr || error.message));
      const line = String(stdout).split("\n").find((row) => row.trim().startsWith("{"));
      if (!line) return reject(new Error("PoB không trả JSON"));
      resolvePromise(JSON.parse(line));
    });
  });
}

/** <PlayerStat stat=".." value=".."> rows of the code's own XML; <MinionStat> ones as "Minion.<stat>". */
export function playerStats(xml) {
  const stats = {};
  for (const match of xml.matchAll(/<(Player|Minion)Stat\b[^>]*\bstat="([^"]+)"[^>]*\bvalue="([^"]+)"/g)) {
    const value = Number(match[3]);
    if (Number.isFinite(value)) stats[match[1] === "Minion" ? `Minion.${match[2]}` : match[2]] = value;
  }
  return stats;
}

const within = (spec, a, b) => {
  if (typeof a !== "number" || typeof b !== "number") return a === b;
  if (spec.abs !== undefined) return Math.abs(a - b) <= spec.abs;
  return Math.abs(a - b) <= Math.max(1, Math.abs(a)) * spec.rel;
};

export function compareStats({ code, pob, planner }) {
  return PARITY_STATS.map((spec) => {
    const row = { ...spec, code: statValue(code, spec.stat), pob: statValue(pob, spec.stat), planner: statValue(planner, spec.stat) };
    row.plannerOk = within(spec, row.pob, row.planner);
    row.pobMatchesCode = row.code === undefined || within(spec, row.code, row.pob);
    return row;
  }).filter((row) => row.code !== undefined || row.pob !== undefined || row.planner !== undefined);
}

export async function checkFixture(fixture, runtime = pobRuntime()) {
  const { body, xml } = await plannerCalculationRequest(fixture.code);
  const plannerXml = buildPobXml(body);
  const [pob, planner] = await Promise.all([runPob(xml, runtime), runPob(plannerXml, runtime)]);
  const rows = compareStats({ code: playerStats(xml), pob, planner });
  const option = await checkGemOptionChange({ body, xml, planner, pob }, runtime);
  return { fixture: fixture.name || fixture.file, rows, option, ok: rows.every((row) => row.plannerOk) && (!option || option.ok) };
}

// ── Gem options: the same choice in PoB and in the planner ──────────────────

const setAttr = (tag, key, value) => (new RegExp(`\\s${key}="[^"]*"`).test(tag)
  ? tag.replace(new RegExp(`(\\s${key}=)"[^"]*"`), `$1"${value}"`)
  : tag.replace(/\s*(\/?>)$/, ` ${key}="${value}"$1`));

/**
 * Applies planner pobAttrs to the same <Gem> of the code's own XML, the way PoB's UI
 * stores them: attributes, and <StatSetIndex> children for stat sets.
 * `group` is PoB's group number in the active skill set; the gem is found by skillId.
 */
export function editPobGem(xml, { group, skillId, attrs }) {
  const active = xml.match(/<Skills\b[^>]*\bactiveSkillSet="(\d+)"/)?.[1];
  const setMatch = active ? [...xml.matchAll(/<SkillSet\b[^>]*\bid="(\d+)"[^>]*>[\s\S]*?<\/SkillSet>/g)].find((m) => m[1] === active) : null;
  const start = setMatch ? setMatch.index : xml.indexOf("<Skills");
  const end = setMatch ? start + setMatch[0].length : xml.indexOf("</Skills>");
  const target = [...xml.slice(start, end).matchAll(/<Skill\b[\s\S]*?<\/Skill>/g)][group - 1];
  if (!target) return null;
  const gemMatch = [...target[0].matchAll(/<Gem\b[^>]*?\/?>/g)].find((m) => m[0].includes(` skillId="${skillId}"`));
  if (!gemMatch) return null;
  let tag = gemMatch[0];
  const selfClosing = /\/>$/.test(tag);
  let children = "";
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "statSets") {
      for (const part of value.split(",")) {
        const [id, index] = part.split(":");
        children += `<StatSetIndex grantedEffect="${id}" index="${index}"/>`;
      }
    } else {
      tag = setAttr(tag, key, value);
    }
  }
  if (children) tag = selfClosing ? `${tag.replace(/\s*\/>$/, ">")}${children}</Gem>` : `${tag}${children}`;
  const at = start + target.index + gemMatch.index;
  return xml.slice(0, at) + tag + xml.slice(at + gemMatch[0].length);
}

/**
 * Picks the second stat set / part / minion skill of the main skill (when PoB offers
 * one) and corrupts its gem to +1 level (or back to none), both in the code's XML and
 * in the planner body (src/spa/lib/gemOptions.ts), then compares the two PoB runs.
 */
export async function checkGemOptionChange({ body, xml, planner, pob }, runtime = pobRuntime()) {
  const lib = await loadSpaLib("gemOptions");
  const mainGroup = Number(body.main_socket_group) || 1;
  const group = body.skills?.[mainGroup - 1];
  const codeMain = Number(xml.match(/<Build\b[^>]*\bmainSocketGroup="(\d+)"/)?.[1]) || 1;
  if (!group) return null;
  const option = (planner.GemOptions?.[String(mainGroup)] ?? []).find((row) => row.statSets || row.parts || row.minionSkills);
  const gem = option && option.gem > 1 ? group.support?.[option.gem - 2] : group;
  if (!gem) return null;
  let attrs = gem.pob_attrs ? { ...gem.pob_attrs } : undefined;
  const changes = [];
  if (option?.statSets) changes.push({ kind: "statSet", grantedEffect: option.grantedEffect, value: 2 });
  else if (option?.parts) changes.push({ kind: "part", value: 2 });
  else if (option?.minionSkills) changes.push({ kind: "minionSkill", value: 2 });
  changes.push({ kind: "corrupt", value: lib.corruptChoice(attrs) === "plus" ? "none" : "plus" });
  for (const change of changes) attrs = lib.withGemOption(attrs, change);
  const changed = Object.fromEntries(Object.entries(attrs).filter(([key, value]) => gem.pob_attrs?.[key] !== value));
  const editedXml = editPobGem(xml, { group: codeMain, skillId: gem.pob_skill_id || gem.skill_id, attrs: changed });
  if (!editedXml) return null;
  const editedBody = structuredClone(body);
  const editedGroup = editedBody.skills[mainGroup - 1];
  (option && option.gem > 1 ? editedGroup.support[option.gem - 2] : editedGroup).pob_attrs = attrs;
  const [pobAfter, plannerAfter] = await Promise.all([runPob(editedXml, runtime), runPob(buildPobXml(editedBody), runtime)]);
  const rows = compareStats({ code: {}, pob: pobAfter, planner: plannerAfter });
  // Whether PoB's own numbers moved: a change that moves nothing proves little (the test wants some that do).
  const dps = (stats) => Number(stats?.CombinedDPS || 0) + Number(stats?.Minion?.CombinedDPS || 0);
  const moved = Math.abs(dps(pobAfter) - dps(pob)) > 1e-6;
  return {
    label: changes.map((change) => `${change.kind}=${change.value}`).join(", ") + (option ? ` (${option.name})` : ""),
    rows,
    moved,
    ok: rows.every((row) => row.plannerOk)
  };
}

const fmt = (value) => {
  if (value === undefined) return "-";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  return String(Math.round(value * 10) / 10);
};

export function formatReport(results) {
  const lines = [];
  for (const result of results) {
    lines.push(`\n${result.ok ? "KHỚP" : "LỆCH"}  ${result.fixture}`);
    lines.push(`  ${"Chỉ số".padEnd(24)}${"Code".padStart(14)}${"PoB".padStart(14)}${"Planner".padStart(14)}`);
    for (const row of result.rows) {
      const mark = row.plannerOk ? "  " : "✗ ";
      const drift = row.pobMatchesCode ? "" : "  (PoB máy này khác số trong code)";
      lines.push(`${mark}${row.label.padEnd(24)}${fmt(row.code).padStart(14)}${fmt(row.pob).padStart(14)}${fmt(row.planner).padStart(14)}${drift}`);
    }
  }
  for (const result of results.filter((row) => row.option)) {
    const { option } = result;
    lines.push(`\n${option.ok ? "KHỚP" : "LỆCH"}  ${result.fixture} — đổi tuỳ chọn gem: ${option.label}${option.moved ? "" : "  (PoB không đổi số với lựa chọn này)"}`);
    for (const row of option.rows.filter((r) => !r.plannerOk || /DPS/.test(r.label))) {
      lines.push(`${row.plannerOk ? "  " : "✗ "}${row.label.padEnd(24)}${"".padStart(14)}${fmt(row.pob).padStart(14)}${fmt(row.planner).padStart(14)}`);
    }
  }
  const failed = results.filter((result) => !result.ok).length;
  lines.push(`\n${results.length - failed}/${results.length} build khớp PoB.`);
  return lines.join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const reportOnly = args.includes("--report-only");
  const names = args.filter((arg) => !arg.startsWith("--"));
  const runtime = pobRuntime();
  if (!runtime.available) {
    console.error(`Không tìm thấy PoB để chạy (POB_CORE_DIR=${runtime.coreDir}, POB_LUAJIT=${runtime.luajit}). Xem scripts/setup-pob-local.mjs.`);
    process.exit(2);
  }
  const results = [];
  for (const fixture of readFixtures(names)) {
    try {
      results.push(await checkFixture(fixture, runtime));
    } catch (error) {
      results.push({ fixture: fixture.name || fixture.file, rows: [], ok: false, error: error.message });
      console.error(`${fixture.file}: ${error.message}`);
    }
  }
  console.log(json ? JSON.stringify(results, null, 2) : formatReport(results));
  if (!reportOnly && results.some((result) => !result.ok)) process.exit(1);
}

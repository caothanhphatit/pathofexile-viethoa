// Luồng kiểm tra Build Planner ↔ Path of Building.
//
// Với mỗi build mẫu trong tests/fixtures/pob-builds/*.json (một PoB code thật):
//   1. "Code":    số PoB đã ghi sẵn trong code (thẻ <PlayerStat>).
//   2. "PoB":     PoB chạy trên máy này với nguyên XML của code (bản PoB có thể khác bản
//                 người chơi dùng, nên cột này cho biết phần lệch do khác phiên bản PoB).
//   3. "Planner": code đi qua đúng đường của trang Build Planner (import -> trạng thái
//                 planner -> body POST /api/builds/calculate -> XML backend) rồi chạy PoB.
// Planner phải khớp cột PoB (cùng một engine); lệch là Planner làm rơi dữ liệu.
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
import { plannerCalculationRequest, repoRoot } from "./lib/planner-node.mjs";

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
  { stat: "TotalEHP", label: "Máu hiệu dụng (EHP)", rel: 0.02 }
];

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

/** <PlayerStat stat=".." value=".."> rows of the code's own XML. */
export function playerStats(xml) {
  const stats = {};
  for (const match of xml.matchAll(/<PlayerStat\b[^>]*\bstat="([^"]+)"[^>]*\bvalue="([^"]+)"/g)) {
    const value = Number(match[2]);
    if (Number.isFinite(value)) stats[match[1]] = value;
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
    const row = { ...spec, code: code[spec.stat], pob: pob?.[spec.stat], planner: planner?.[spec.stat] };
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
  return { fixture: fixture.name || fixture.file, rows, ok: rows.every((row) => row.plannerOk) };
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

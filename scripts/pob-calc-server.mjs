// Small HTTP service that runs Path of Building calculations for the website
// backend when the web server cannot run PoB itself (its LuaJIT is too old for
// PoB's syntax). Runs on a machine with a working PoB, normally the Windows PC
// with PoB's own runtime, and is reached from the server through an SSH tunnel.
//
//   POB_CALC_TOKEN=<secret> node scripts/pob-calc-server.mjs
//
// Then on the web server: POB_REMOTE_URL=http://127.0.0.1:<tunnel port>/calculate
// and POB_REMOTE_TOKEN=<same secret> (see src/server/pob-runner.mjs).
//
// Env: POB_CALC_TOKEN (required), POB_CALC_PORT (18766), POB_CALC_HOST
// (127.0.0.1), POB_CORE_DIR / POB_LUAJIT (default: ../pob-core with PoB's
// runtime host), POB_CALCULATE_TIMEOUT_MS (20000), POB_CALC_MAX_CONCURRENT (2).
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPobLocal } from "../src/server/pob-runner.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY = 512 * 1024;

export function calcServerConfig(env = process.env) {
  const coreDir = env.POB_CORE_DIR || resolve(repoRoot, "..", "pob-core", "src");
  const winHost = resolve(coreDir, "..", "runtime", "pob-luajit-bin", "pob-luajit.exe");
  return {
    token: env.POB_CALC_TOKEN || "",
    host: env.POB_CALC_HOST || "127.0.0.1",
    port: Number(env.POB_CALC_PORT || 18766),
    coreDir,
    luajit: env.POB_LUAJIT || (existsSync(winHost) ? winHost : "luajit"),
    timeoutMs: Number(env.POB_CALCULATE_TIMEOUT_MS || 20_000),
    maxConcurrent: Number(env.POB_CALC_MAX_CONCURRENT || 2)
  };
}

const sameSecret = (given, expected) => {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};

export function createCalcServer(config, { run = (xml) => runPobLocal(xml, config) } = {}) {
  let running = 0;
  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      send(res, 200, { ok: true, running, luajit: String(config.luajit || "").split(/[\\/]/).pop() });
      return;
    }
    if (req.method !== "POST" || req.url !== "/calculate") {
      send(res, 404, { ok: false, error: "Not found" });
      return;
    }
    if (!sameSecret(req.headers["x-pob-token"], config.token)) {
      send(res, 401, { ok: false, error: "Bad token" });
      return;
    }
    if (running >= config.maxConcurrent) {
      send(res, 503, { ok: false, error: "Calculator busy, retry shortly" });
      return;
    }
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY && !aborted) {
        aborted = true;
        send(res, 413, { ok: false, error: "Build XML too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (aborted) return;
      const xml = Buffer.concat(chunks).toString("utf8");
      if (!/<PathOfBuilding2?[\s>]/.test(xml)) {
        send(res, 400, { ok: false, error: "Body is not a Path of Building XML" });
        return;
      }
      running += 1;
      const started = Date.now();
      try {
        const data = await run(xml);
        send(res, 200, { ok: true, data });
        console.log(`${new Date().toISOString()} calculated in ${Date.now() - started}ms`);
      } catch (error) {
        send(res, 500, { ok: false, error: error.message || "Calculation failed" });
        console.error(`${new Date().toISOString()} failed: ${error.message}`);
      } finally {
        running -= 1;
      }
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = calcServerConfig();
  if (config.token.length < 24) {
    console.error("Set POB_CALC_TOKEN to a random secret of at least 24 characters.");
    process.exit(1);
  }
  if (!existsSync(resolve(config.coreDir, "calculate.lua"))) {
    console.error(`calculate.lua not found in ${config.coreDir}. Run scripts/setup-pob-local.mjs first.`);
    process.exit(1);
  }
  createCalcServer(config).listen(config.port, config.host, () => {
    console.log(`PoB calculator on http://${config.host}:${config.port} (core ${config.coreDir})`);
  });
}

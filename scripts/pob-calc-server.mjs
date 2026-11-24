// Small HTTP service that runs Path of Building calculations for the website
// backend using a persistent worker pool + priority queue. Runs in the poe-pob
// container (deploy/pob-calc/Dockerfile) or on a Windows dev PC via SSH tunnel.
//
//   POB_CALC_TOKEN=<secret> node scripts/pob-calc-server.mjs
//
// Then on the web server: POB_REMOTE_URL=http://127.0.0.1:<tunnel port>/calculate
// and POB_REMOTE_TOKEN=<same secret> (see src/server/pob-runner.mjs).
//
// Env:
//   POB_CALC_TOKEN (required), POB_CALC_PORT (18766), POB_CALC_HOST (127.0.0.1),
//   POB_CORE_DIR / POB_LUAJIT / POB_CALC_SCRIPT,
//   POB_CALC_WORKERS (2 locally, 4 in image), POB_CALC_PREWARM (0/1),
//   POB_CALC_WORKER_MAX_JOBS (200), POB_CALC_WORKER_MAX_RSS_MB (768),
//   POB_CALC_QUEUE_MAX (32), POB_CALC_QUEUE_WAIT_MS (15000),
//   POB_CALCULATE_TIMEOUT_MS (20000).
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPobPool, pobPoolConfig } from "../src/server/pob-pool.mjs";
import { runPobLocal } from "../src/server/pob-runner.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY = 512 * 1024;

export function calcServerConfig(env = process.env) {
  const coreDir = env.POB_CORE_DIR || resolve(repoRoot, "..", "pob-core", "src");
  const winHost = resolve(coreDir, "..", "runtime", "pob-luajit-bin", "pob-luajit.exe");
  const pool = pobPoolConfig(env);
  return {
    token: env.POB_CALC_TOKEN || "",
    host: env.POB_CALC_HOST || "127.0.0.1",
    port: Number(env.POB_CALC_PORT || 18766),
    coreDir,
    luajit: env.POB_LUAJIT || (existsSync(winHost) ? winHost : "luajit"),
    script: env.POB_CALC_SCRIPT || "calculate.lua",
    maxConcurrent: pool.workers,
    ...pool
  };
}

const sameSecret = (given, expected) => {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};

const requestPriority = (headers) => {
  const raw = String(headers?.["x-pob-priority"] || "").toLowerCase();
  return raw === "background" || raw === "compare" ? "background" : "main";
};

const defaultPoolLogger = (level, event) => {
  const ts = new Date().toISOString();
  const out = level === "error" ? console.error : console.log;
  if (event.event === "pob_job") {
    const status = event.ok ? "ok" : `error=${event.error}`;
    const rss = event.rssMb != null ? ` rss=${event.rssMb}MB` : "";
    out(`${ts} job worker=${event.workerId} priority=${event.priority} wait=${event.queueWaitMs}ms calc=${event.calcMs}ms${rss} ${status}`);
    return;
  }
  out(`${ts} ${event.event} ${JSON.stringify(event)}`);
};

export function createCalcServer(config, { run, pool } = {}) {
  const ownsPool = !run && !pool;
  const activePool = pool || (ownsPool
    ? createPobPool({
        ...config,
        oneShotFallback: runPobLocal,
        logger: defaultPoolLogger
      })
    : null);

  let running = 0;
  const maxConcurrent = config.workers || config.maxConcurrent || 2;
  const luajitName = String(config.luajit || "").split(/[\\/]/).pop();

  const send = (res, status, body, extraHeaders = {}) => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      if (activePool) {
        const h = activePool.health();
        send(res, 200, {
          ok: true,
          running: h.busy,
          busy: h.busy,
          idle: h.idle,
          starting: h.starting,
          queued: h.queued,
          workers: h.workers,
          maxWorkers: h.maxWorkers,
          stats: h.stats,
          luajit: luajitName
        });
      } else {
        send(res, 200, {
          ok: true,
          running,
          busy: running,
          queued: { main: 0, background: 0, total: 0 },
          workers: [],
          maxWorkers: maxConcurrent,
          luajit: luajitName
        });
      }
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
    if (!activePool && running >= maxConcurrent) {
      send(res, 503, { ok: false, error: "Calculator busy, retry shortly" }, { "retry-after": "2" });
      return;
    }

    const priority = requestPriority(req.headers);
    const controller = new AbortController();
    const onDisconnect = () => {
      if (!res.writableEnded && !controller.signal.aborted) controller.abort();
    };
    res.on("close", onDisconnect);
    req.on("aborted", onDisconnect);

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
      if (aborted || controller.signal.aborted) return;
      const xml = Buffer.concat(chunks).toString("utf8");
      if (!/<PathOfBuilding2?[\s>]/.test(xml)) {
        send(res, 400, { ok: false, error: "Body is not a Path of Building XML" });
        return;
      }
      running += 1;
      const started = Date.now();
      try {
        const data = activePool
          ? await activePool.run(xml, { priority, signal: controller.signal })
          : await run(xml, { priority, signal: controller.signal });
        send(res, 200, { ok: true, data });
        if (!activePool) {
          console.log(`${new Date().toISOString()} calculated in ${Date.now() - started}ms priority=${priority}`);
        }
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) {
          console.log(`${new Date().toISOString()} cancelled priority=${priority} after ${Date.now() - started}ms`);
          return;
        }
        if (error?.statusCode === 503) {
          send(res, 503, { ok: false, error: error.message || "Calculator busy, retry shortly" }, { "retry-after": "2" });
          return;
        }
        send(res, 500, { ok: false, error: error.message || "Calculation failed" });
        if (!activePool) {
          console.error(`${new Date().toISOString()} failed: ${error.message}`);
        }
      } finally {
        running -= 1;
        res.off("close", onDisconnect);
        req.off("aborted", onDisconnect);
      }
    });
  });

  server.pobPool = activePool;
  if (ownsPool) {
    server.on("close", () => {
      void activePool.close();
    });
  }
  return server;
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
  const server = createCalcServer(config);
  const shutdown = () => {
    server.close(() => {
      Promise.resolve(server.pobPool?.close()).finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  server.listen(config.port, config.host, () => {
    console.log(
      `PoB calculator on http://${config.host}:${config.port} ` +
      `(core ${config.coreDir}, workers=${config.workers}, prewarm=${config.prewarm ? 1 : 0}, ` +
      `maxJobs=${config.maxJobs}, maxRssMb=${config.maxRssMb}, queueMax=${config.maxQueue})`
    );
  });
}

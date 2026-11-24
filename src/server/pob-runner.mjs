// Runs Path of Building's calculate.lua for one build XML and returns the stats
// object it prints. Two ways to run it:
//
//   local  — persistent LuaJIT worker pool in POB_CORE_DIR (with automatic fallback
//            to one-shot execFile if workers cannot start). Needs a LuaJIT that
//            understands PoB's extended syntax (`a?.b`, `x += 1`, `continue`);
//            the 2017 luajit packaged by Ubuntu does not.
//   remote — POST the XML to another machine that runs the same thing
//            (scripts/pob-calc-server.mjs), e.g. the poe-pob container or a Windows
//            PC reached through an SSH tunnel. Set POB_REMOTE_URL and
//            POB_REMOTE_TOKEN on the caller and POB_CALC_TOKEN on that machine.
import { execFile } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPobPool, pobPoolConfig } from "./pob-pool.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const normalizePriority = (value) => (value === "background" || value === "compare" ? "background" : "main");

/** The JSON line calculate.lua prints among PoB's own log output. */
export function parsePobStdout(stdout) {
  const jsonLine = String(stdout)
    .split("\n")
    .find((line) => line.trim().startsWith("{") && line.trim().endsWith("}"));
  if (!jsonLine) throw new Error("Invalid output from calculation engine");
  return JSON.parse(jsonLine);
}

/**
 * One-shot local PoB execution (spawns a fresh LuaJIT process per call).
 * `script`: the calculate script, relative to coreDir or absolute (default: the
 * calculate.lua installed in coreDir). POB_CALC_SCRIPT points a dev server at another
 * copy, e.g. this checkout's script, without touching the PoB directory.
 */
export function runPobLocal(xml, { coreDir, luajit = "luajit", timeoutMs = 20_000, script = "calculate.lua" } = {}) {
  const file = join(tmpdir(), `pob_temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.xml`);
  writeFileSync(file, xml, "utf8");
  return new Promise((resolvePromise, reject) => {
    execFile(luajit, [script || "calculate.lua", file], { cwd: coreDir, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      try { unlinkSync(file); } catch { /* already gone */ }
      if (error) {
        const timedOut = error.killed || error.signal === "SIGTERM";
        reject(new Error(timedOut ? "Calculation timed out" : (String(stderr).trim() || error.message)));
        return;
      }
      try {
        resolvePromise(parsePobStdout(stdout));
      } catch (parseError) {
        // PoB prints its load errors to stdout and then waits for a key press.
        const hint = String(stdout).match(/Error[^\n]*\n?[^\n]*/)?.[0]?.trim();
        reject(new Error(hint ? `PoB failed to load: ${hint}` : parseError.message));
      }
    });
  });
}

export async function runPobRemote(xml, { url, token, timeoutMs = 25_000, priority = "main", signal, fetchImpl = globalThis.fetch } = {}) {
  if (signal?.aborted) {
    throw Object.assign(new Error("Request cancelled"), { name: "AbortError", code: "ABORT_ERR" });
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (signal) signal.addEventListener("abort", onCallerAbort, { once: true });
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "x-pob-token": token || "",
        "x-pob-priority": normalizePriority(priority)
      },
      body: xml,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const err = new Error(payload?.error || `Remote calculator answered ${response.status}`);
      err.statusCode = response.status;
      throw err;
    }
    return payload.data;
  } catch (error) {
    if (error?.name === "AbortError") {
      if (timedOut) throw new Error("Calculation timed out");
      throw Object.assign(new Error("Request cancelled"), { name: "AbortError", code: "ABORT_ERR" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onCallerAbort);
  }
}

/** Picks remote when POB_REMOTE_URL is set, else a local worker pool; reads the usual env vars. */
export function pobRunnerFromEnv(env = process.env) {
  const timeoutMs = Number(env.POB_CALCULATE_TIMEOUT_MS || 20_000);
  if (env.POB_REMOTE_URL) {
    const options = { url: env.POB_REMOTE_URL, token: env.POB_REMOTE_TOKEN || "", timeoutMs: timeoutMs + 5_000 };
    return {
      mode: "remote",
      run: (xml, runOptions) => runPobRemote(xml, { ...options, ...runOptions })
    };
  }
  const devCoreDir = resolve(REPO_ROOT, "..", "pob-core", "src");
  const coreDir = env.POB_CORE_DIR || (existsSync(devCoreDir) ? devCoreDir : "/root/pob-core/src");
  const devLuajit = resolve(coreDir, "..", "runtime", "pob-luajit-bin", process.platform === "win32" ? "pob-luajit.exe" : "luajit");
  const luajit = env.POB_LUAJIT || (existsSync(devLuajit) ? devLuajit : "luajit");
  const devScript = resolve(REPO_ROOT, "scripts", "pob-calculate.lua");
  const script = env.POB_CALC_SCRIPT || (existsSync(devCoreDir) && !env.POB_CORE_DIR && existsSync(devScript) ? devScript : "calculate.lua");
  const poolCfg = pobPoolConfig(env);
  const pool = createPobPool({
    ...poolCfg,
    coreDir,
    luajit,
    timeoutMs,
    script,
    oneShotFallback: runPobLocal
  });
  return {
    mode: "local",
    run: (xml, runOptions) => pool.run(xml, runOptions),
    health: () => pool.health(),
    close: () => pool.close()
  };
}

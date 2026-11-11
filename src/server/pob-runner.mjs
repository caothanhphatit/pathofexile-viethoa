// Runs Path of Building's calculate.lua for one build XML and returns the stats
// object it prints. Two ways to run it:
//
//   local  — spawn the interpreter in POB_CORE_DIR (the default). Needs a LuaJIT
//            that understands PoB's extended syntax (`a?.b`, `x += 1`, `continue`);
//            the 2017 luajit packaged by Ubuntu does not.
//   remote — POST the XML to another machine that runs the same thing
//            (scripts/pob-calc-server.mjs), e.g. a Windows PC with PoB's own
//            runtime reached through an SSH tunnel. Set POB_REMOTE_URL and
//            POB_REMOTE_TOKEN on the caller and POB_CALC_TOKEN on that machine.
import { execFile } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The JSON line calculate.lua prints among PoB's own log output. */
export function parsePobStdout(stdout) {
  const jsonLine = String(stdout)
    .split("\n")
    .find((line) => line.trim().startsWith("{") && line.trim().endsWith("}"));
  if (!jsonLine) throw new Error("Invalid output from calculation engine");
  return JSON.parse(jsonLine);
}

export function runPobLocal(xml, { coreDir, luajit = "luajit", timeoutMs = 20_000 } = {}) {
  const file = join(tmpdir(), `pob_temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.xml`);
  writeFileSync(file, xml, "utf8");
  return new Promise((resolve, reject) => {
    execFile(luajit, ["calculate.lua", file], { cwd: coreDir, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      try { unlinkSync(file); } catch { /* already gone */ }
      if (error) {
        const timedOut = error.killed || error.signal === "SIGTERM";
        reject(new Error(timedOut ? "Calculation timed out" : (String(stderr).trim() || error.message)));
        return;
      }
      try {
        resolve(parsePobStdout(stdout));
      } catch (parseError) {
        // PoB prints its load errors to stdout and then waits for a key press.
        const hint = String(stdout).match(/Error[^\n]*\n?[^\n]*/)?.[0]?.trim();
        reject(new Error(hint ? `PoB failed to load: ${hint}` : parseError.message));
      }
    });
  });
}

export async function runPobRemote(xml, { url, token, timeoutMs = 25_000, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/xml; charset=utf-8", "x-pob-token": token || "" },
      body: xml,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Remote calculator answered ${response.status}`);
    }
    return payload.data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Calculation timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Picks remote when POB_REMOTE_URL is set, else local; reads the usual env vars. */
export function pobRunnerFromEnv(env = process.env) {
  const timeoutMs = Number(env.POB_CALCULATE_TIMEOUT_MS || 20_000);
  if (env.POB_REMOTE_URL) {
    const options = { url: env.POB_REMOTE_URL, token: env.POB_REMOTE_TOKEN || "", timeoutMs: timeoutMs + 5_000 };
    return { mode: "remote", run: (xml) => runPobRemote(xml, options) };
  }
  const options = { coreDir: env.POB_CORE_DIR || "/root/pob-core/src", luajit: env.POB_LUAJIT || "luajit", timeoutMs };
  return { mode: "local", run: (xml) => runPobLocal(xml, options) };
}

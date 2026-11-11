import assert from "node:assert/strict";
import test from "node:test";

import { createCalcServer } from "../scripts/pob-calc-server.mjs";
import { buildApp } from "../src/server/app.mjs";
import { parsePobStdout, pobRunnerFromEnv, runPobRemote } from "../src/server/pob-runner.mjs";

const TOKEN = "test-token-0123456789abcdef";
const XML = '<?xml version="1.0"?><PathOfBuilding2><Build level="90"/></PathOfBuilding2>';

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

test("calc server checks the token and the body, then returns the stats", async () => {
  const seen = [];
  const server = createCalcServer({ token: TOKEN, maxConcurrent: 2 }, {
    run: async (xml) => { seen.push(xml); return { CombinedDPS: 1234, Life: 5000 }; }
  });
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}`;
  try {
    const post = (path, body, token) => fetch(`${url}${path}`, { method: "POST", headers: { "x-pob-token": token }, body });

    assert.equal((await post("/calculate", XML, "wrong")).status, 401);
    assert.equal((await post("/calculate", XML, "")).status, 401);
    assert.equal((await post("/elsewhere", XML, TOKEN)).status, 404);
    assert.equal((await post("/calculate", "not xml", TOKEN)).status, 400);

    const ok = await post("/calculate", XML, TOKEN);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, data: { CombinedDPS: 1234, Life: 5000 } });
    assert.deepEqual(seen, [XML]);

    const health = await fetch(`${url}/health`).then((r) => r.json());
    assert.equal(health.ok, true);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("remote runner returns the calculator's stats and surfaces its errors", async () => {
  let fail = false;
  const server = createCalcServer({ token: TOKEN, maxConcurrent: 2 }, {
    run: async () => { if (fail) throw new Error("PoB failed to load: boom"); return { CombinedDPS: 99 }; }
  });
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}/calculate`;
  try {
    assert.deepEqual(await runPobRemote(XML, { url, token: TOKEN }), { CombinedDPS: 99 });
    await assert.rejects(runPobRemote(XML, { url, token: "nope" }), /Bad token/);
    fail = true;
    await assert.rejects(runPobRemote(XML, { url, token: TOKEN }), /PoB failed to load: boom/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("runner mode follows POB_REMOTE_URL and PoB's JSON line is picked from its log", () => {
  assert.equal(pobRunnerFromEnv({}).mode, "local");
  assert.equal(pobRunnerFromEnv({ POB_REMOTE_URL: "http://127.0.0.1:20140/calculate", POB_REMOTE_TOKEN: TOKEN }).mode, "remote");
  assert.deepEqual(parsePobStdout('Loading main script...\n{"Life":10}\ndone\n'), { Life: 10 });
  assert.throws(() => parsePobStdout("Error loading main script"), /Invalid output/);
});

test("build calculate route uses the configured runner", async () => {
  const calls = [];
  const app = await buildApp({
    db: null,
    logger: false,
    sessionSecret: "test-session-secret",
    premiumSigner: null,
    pobRunner: { mode: "remote", run: async (xml) => { calls.push(xml); return { CombinedDPS: 4321 }; } }
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/builds/calculate",
      payload: { className: "Ranger", ascendancy: "Deadeye", level: 90, skills: [], inventory_slots: [] }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { ok: true, data: { CombinedDPS: 4321 } });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /<PathOfBuilding2/);
  } finally {
    await app.close();
  }
});

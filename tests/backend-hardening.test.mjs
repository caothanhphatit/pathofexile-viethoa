import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fetchWithRetry, removalLooksSafe } from "../scripts/crawl-guards.mjs";
import { buildApp } from "../src/server/app.mjs";
import { createAuthService, parseCookies } from "../src/server/services/auth-service.mjs";
import { Poe2LogWatcher } from "../src/server/services/poe2-log-watcher.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withEnv = async (vars, fn) => {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("CORS no longer reflects arbitrary origins when ALLOWED_ORIGINS is empty", async () => {
  await withEnv({ ALLOWED_ORIGINS: "", APP_URL: "https://poe.example.vn/some/page", NODE_ENV: "production" }, async () => {
    const app = await buildApp({ db: null, logger: false, sessionSecret: "test-session-secret" });
    try {
      const evil = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } });
      assert.equal(evil.headers["access-control-allow-origin"], undefined);
      const site = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://poe.example.vn" } });
      assert.equal(site.headers["access-control-allow-origin"], "https://poe.example.vn");
      assert.equal(site.headers["access-control-allow-credentials"], "true");
    } finally {
      await app.close();
    }
  });
});

test("a malformed cookie is kept raw instead of throwing", () => {
  assert.deepEqual(parseCookies("bad=%E0%A4%A; ok=a%20b"), { bad: "%E0%A4%A", ok: "a b" });
});

test("a malformed cookie does not turn session lookups into a 500", async () => {
  const app = await buildApp({ db: null, logger: false, sessionSecret: "test-session-secret" });
  try {
    const response = await app.inject({ method: "GET", url: "/api/auth/config", headers: { cookie: "junk=%E0%A4%A" } });
    assert.equal(response.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("an unverified Google email is never used to attach the login to an existing user", async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, " ").trim().toLowerCase();
      queries.push({ q, params });
      if (q.startsWith("select id from users where email")) return { rows: [{ id: "usr_victim" }] };
      if (q.startsWith("select id, email, display_name")) return { rows: [{ id: params[0], email: null, display_name: "x", avatar_url: "" }] };
      return { rows: [] };
    }
  };
  const auth = createAuthService({ env: {}, sessionSecret: "test-session-secret" });
  const user = await auth.upsertAuthUser(db, {
    provider: "google",
    providerUserId: "attacker-sub",
    email: "victim@example.com",
    emailVerified: false,
    displayName: "Attacker"
  });
  assert.notEqual(user.id, "usr_victim");
  assert.ok(!queries.some(({ q }) => q.startsWith("select id from users where email")));
  assert.ok(!queries.some(({ params }) => params.includes("victim@example.com")));

  const verified = await auth.upsertAuthUser(db, {
    provider: "google",
    providerUserId: "owner-sub",
    email: "victim@example.com",
    emailVerified: true,
    displayName: "Owner"
  });
  assert.equal(verified.id, "usr_victim");
});

test("log watcher keeps polling after a read error and recovers on its own", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe2-log-recover-"));
  const logPath = join(dir, "Client.txt");
  const watcher = new Poe2LogWatcher({ path: logPath, pollIntervalMs: 20 });
  try {
    await writeFile(logPath, "2026/05/23 12:00:00 1 [INFO Client] : You have entered Riverbank.\n");
    await watcher.start();
    assert.equal(watcher.status().zoneName, "Riverbank");

    await unlink(logPath);
    await sleep(120);
    assert.ok(watcher.status().error, "the missing file is reported");
    assert.ok(watcher.timer, "polling continues after the error");

    await writeFile(logPath, "2026/05/23 12:05:00 2 [INFO Client] : You have entered Clearfell.\n");
    await sleep(120);
    assert.equal(watcher.status().error, null);
    assert.equal(watcher.status().zoneName, "Clearfell");
  } finally {
    watcher.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("removal guard refuses to retire a large share of active rows", () => {
  assert.equal(removalLooksSafe({ active: 1000, wouldRemove: 5, maxShare: 0.2 }), true);
  assert.equal(removalLooksSafe({ active: 1000, wouldRemove: 400, maxShare: 0.2 }), false);
  assert.equal(removalLooksSafe({ active: 10, wouldRemove: 10, maxShare: 0.2 }), true);
  assert.equal(removalLooksSafe({ active: 1000, wouldRemove: 400, maxShare: 1 }), true);
});

test("fetchWithRetry retries transient failures but not a 404", async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) return { ok: false, status: 503, statusText: "Busy" };
    return { ok: true, status: 200 };
  };
  const response = await fetchWithRetry("https://x", {}, { fetchImpl: flaky, backoffMs: 1 });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);

  let notFoundCalls = 0;
  const missing = async () => {
    notFoundCalls += 1;
    return { ok: false, status: 404, statusText: "Not Found" };
  };
  await assert.rejects(fetchWithRetry("https://x", {}, { fetchImpl: missing, backoffMs: 1 }), /404/);
  assert.equal(notFoundCalls, 1);
});

test("SPA data loader forgets failed script loads so they can be retried", async () => {
  const source = await readFile(new URL("../src/spa/lib/data.ts", import.meta.url), "utf8");
  assert.match(source, /pendingScripts\.delete\(key\)/);
  assert.match(source, /script\.remove\(\)/);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildApp } from "../src/server/app.mjs";
import { isLocalRequest } from "../src/server/local-request.mjs";
import { Poe2LogWatcher } from "../src/server/services/poe2-log-watcher.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Minimal stand-in for the pg pool: just enough of shared_builds for the save route.
const fakeBuildDb = () => {
  const rows = new Map();
  return {
    rows,
    async end() {},
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, " ").trim().toLowerCase();
      if (q.startsWith("create table") || q.startsWith("alter table")) return { rows: [], rowCount: 0 };
      if (q.startsWith("insert into shared_builds")) {
        if (rows.has(params[0])) throw new Error("duplicate key");
        rows.set(params[0], { project_json: JSON.parse(params[1]), edit_token_hash: params[2] });
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith("update shared_builds")) {
        const row = rows.get(params[0]);
        if (!row || !row.edit_token_hash || row.edit_token_hash !== params[2]) return { rows: [], rowCount: 0 };
        row.project_json = JSON.parse(params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith("select project_json from shared_builds")) {
        const row = rows.get(params[0]);
        return { rows: row ? [{ project_json: row.project_json }] : [] };
      }
      return { rows: [], rowCount: 0 };
    }
  };
};

const withApp = async (options, fn) => {
  const app = await buildApp({ logger: false, sessionSecret: "test-session-secret", ...options });
  try {
    await fn(app);
  } finally {
    await app.close();
  }
};

test("isLocalRequest only trusts loopback sockets without forwarding headers", () => {
  const req = (remoteAddress, headers = {}) => ({ raw: { socket: { remoteAddress } }, headers });
  assert.equal(isLocalRequest(req("127.0.0.1")), true);
  assert.equal(isLocalRequest(req("::1")), true);
  assert.equal(isLocalRequest(req("::ffff:127.0.0.1")), true);
  assert.equal(isLocalRequest(req("203.0.113.9")), false);
  assert.equal(isLocalRequest(req("127.0.0.1", { "x-forwarded-for": "203.0.113.9" })), false);
  assert.equal(isLocalRequest(req("127.0.0.1", { forwarded: "for=203.0.113.9" })), false);
});

test("game log watcher routes refuse remote and proxied callers", async () => {
  await withApp({ db: null }, async (app) => {
    for (const [method, url] of [["GET", "/api/leveling/log/status"], ["POST", "/api/leveling/log/config"], ["GET", "/api/leveling/log/events"]]) {
      const remote = await app.inject({ method, url, remoteAddress: "203.0.113.9", payload: method === "POST" ? { path: "/etc/hostname" } : undefined });
      assert.equal(remote.statusCode, 403, `${method} ${url} from a remote address`);
      const proxied = await app.inject({ method, url, headers: { "x-forwarded-for": "203.0.113.9" }, payload: method === "POST" ? { path: "/etc/hostname" } : undefined });
      assert.equal(proxied.statusCode, 403, `${method} ${url} through a proxy`);
    }
    const local = await app.inject({ method: "GET", url: "/api/leveling/log/status" });
    assert.equal(local.statusCode, 200);
  });
});

test("log watcher only opens the game's own log files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe2-log-allow-"));
  const secret = join(dir, "secrets.env");
  const watcher = new Poe2LogWatcher({ path: secret, pollIntervalMs: 60_000 });
  try {
    await writeFile(secret, "DATABASE_URL=postgres://user:pass@db/prod\n");
    await watcher.start();
    assert.equal(watcher.status().watching, false);
    assert.equal(watcher.status().activePath ?? null, null);
    assert.ok(!JSON.stringify(watcher.status()).includes("postgres://"));
  } finally {
    watcher.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("saving a build ignores the client id and needs the edit token to overwrite", async () => {
  const db = fakeBuildDb();
  await withApp({ db }, async (app) => {
    const created = await app.inject({ method: "POST", url: "/api/builds", payload: { id: "victim-build", name: "Mine" } });
    assert.equal(created.statusCode, 201);
    const { id, editToken } = created.json().data;
    assert.notEqual(id, "victim-build");
    assert.ok(editToken.length >= 32);
    assert.equal(db.rows.get(id).edit_token_hash, sha256(editToken));
    assert.equal(db.rows.has("victim-build"), false);

    const noToken = await app.inject({ method: "POST", url: "/api/builds", payload: { id, name: "Hijacked" } });
    assert.equal(noToken.statusCode, 201, "without a token the save creates a separate build");
    assert.notEqual(noToken.json().data.id, id);

    const wrongToken = await app.inject({ method: "POST", url: "/api/builds", headers: { "x-build-edit-token": "guess" }, payload: { id, name: "Hijacked" } });
    assert.equal(wrongToken.statusCode, 403);
    assert.equal(db.rows.get(id).project_json.name, "Mine");

    const owner = await app.inject({ method: "POST", url: "/api/builds", headers: { "x-build-edit-token": editToken }, payload: { id, name: "Mine v2" } });
    assert.equal(owner.statusCode, 200);
    assert.equal(db.rows.get(id).project_json.name, "Mine v2");
  });
});

const get = (port, path) => new Promise((resolve, reject) => {
  const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
    res.resume();
    res.on("end", () => resolve(res.statusCode));
  });
  req.on("error", reject);
  req.end();
});

test("static server answers malformed URLs with 400 and keeps running", async () => {
  const port = 18000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ["scripts/serve-static.mjs", "public", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => String(chunk).includes("Static site") && resolve());
      child.on("exit", (code) => reject(new Error(`serve-static exited early (${code})`)));
      setTimeout(() => reject(new Error("serve-static did not start")), 10_000);
    });
    assert.equal(await get(port, "/%E0%A4%A"), 400);
    assert.equal(await get(port, "/a%00b"), 400);
    assert.equal(await get(port, "/builds"), 200);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill();
  }
});

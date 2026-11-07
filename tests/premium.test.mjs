import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { buildApp } from "../src/server/app.mjs";
import {
  DEVICE_RESET_COOLDOWN_MS,
  TOKEN_TTL_MS,
  createPremiumSigner,
  generatePremiumKey,
  grantPremium,
  issueKey,
  normalizePremiumKey,
  premiumStatus,
  releaseDevice,
  revokeSubscription,
  verifyKey,
  verifyLicenceToken
} from "../src/server/services/premium-service.mjs";

const DAY = 24 * 60 * 60 * 1000;
const DEVICE_A = "device-a-0123456789abcdef";
const DEVICE_B = "device-b-0123456789abcdef";

// Real Postgres (in-process) with the users table and the premium migration applied.
const premiumDb = async () => {
  const pg = new PGlite();
  const sql = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
  await pg.exec((await sql("004_auth_leveling_accounts.sql")).split("create table if not exists auth_accounts")[0]);
  await pg.exec(await sql("013_premium.sql"));
  await pg.query("insert into users (id, email, display_name) values ('usr_a', 'a@example.com', 'A'), ('usr_b', 'b@example.com', 'B')");
  return {
    pg,
    async query(text, params = []) {
      const result = await pg.query(text, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    async end() {
      await pg.close();
    }
  };
};

const testSigner = () => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return createPremiumSigner({ PREMIUM_SIGNING_KEY: Buffer.from(pem).toString("base64") });
};

test("keys have a fixed shape and survive sloppy pasting", () => {
  const key = generatePremiumKey();
  assert.match(key, /^PVH-[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
  assert.equal(normalizePremiumKey(key.toLowerCase().replace(/-/g, " ")), key);
  assert.equal(normalizePremiumKey("PVH-12345"), null);
  assert.equal(normalizePremiumKey(""), null);
});

test("licence tokens verify with the public key and reject tampering or expiry", () => {
  const signer = testSigner();
  const now = Date.now();
  const token = signer.sign({ sub: "usr_a", exp: Math.floor((now + 60_000) / 1000) });
  assert.equal(verifyLicenceToken(token, signer.publicKeyPem, { now }).sub, "usr_a");

  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "usr_b", exp: Math.floor((now + 60_000) / 1000) })).toString("base64url");
  assert.equal(verifyLicenceToken(`${forged}.${signature}`, signer.publicKeyPem, { now }), null);
  assert.equal(verifyLicenceToken(`${body}.${signature}x`, signer.publicKeyPem, { now }), null);
  assert.equal(verifyLicenceToken(token, signer.publicKeyPem, { now: now + 120_000 }), null);
  assert.equal(verifyLicenceToken(token, testSigner().publicKeyPem, { now }), null);
});

test("timed plans stack end to end; lifetime starts now and blocks more timed grants", async () => {
  const db = await premiumDb();
  try {
    const first = await grantPremium(db, { userId: "usr_a", plan: "month" });
    const second = await grantPremium(db, { userId: "usr_a", plan: "custom", days: 10 });
    assert.equal(second.startsAt.getTime(), new Date(first.expiresAt).getTime());
    const status = await premiumStatus(db, "usr_a");
    assert.equal(status.active, true);
    assert.ok(Math.abs(new Date(status.expiresAt).getTime() - (Date.now() + 40 * DAY)) < 60_000);

    await grantPremium(db, { userId: "usr_b", plan: "lifetime" });
    assert.equal((await premiumStatus(db, "usr_b")).expiresAt, null);
    await assert.rejects(grantPremium(db, { userId: "usr_b", plan: "month" }), { code: "already_lifetime" });
    await assert.rejects(grantPremium(db, { userId: "usr_a", plan: "weekly" }), { code: "bad_plan" });
  } finally {
    await db.end();
  }
});

test("a key binds to the first device and refuses every other one", async () => {
  const db = await premiumDb();
  const signer = testSigner();
  try {
    await assert.rejects(issueKey(db, "usr_a"), { code: "premium_required" });
    await grantPremium(db, { userId: "usr_a", plan: "month" });
    const { key } = await issueKey(db, "usr_a");

    const first = await verifyKey(db, signer, { key, deviceId: DEVICE_A, deviceLabel: "PC nhà" });
    const payload = verifyLicenceToken(first.token, signer.publicKeyPem);
    assert.equal(payload.sub, "usr_a");
    assert.ok(payload.exp * 1000 <= Date.now() + TOKEN_TTL_MS + 1000);

    // Same machine again (and with sloppy key formatting) is fine.
    await verifyKey(db, signer, { key: key.toLowerCase(), deviceId: DEVICE_A });
    await assert.rejects(verifyKey(db, signer, { key, deviceId: DEVICE_B }), { code: "device_mismatch", statusCode: 409 });

    const status = await premiumStatus(db, "usr_a");
    assert.equal(status.device.label, "PC nhà");
    assert.equal(status.key.prefix, key.slice(0, 9));
  } finally {
    await db.end();
  }
});

test("two first activations at once still leave exactly one device bound", async () => {
  const db = await premiumDb();
  const signer = testSigner();
  try {
    await grantPremium(db, { userId: "usr_a", plan: "month" });
    const { key } = await issueKey(db, "usr_a");
    const results = await Promise.allSettled([
      verifyKey(db, signer, { key, deviceId: DEVICE_A }),
      verifyKey(db, signer, { key, deviceId: DEVICE_B })
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const { rows } = await db.query("select count(*)::int as n from premium_key_devices where released_at is null");
    assert.equal(rows[0].n, 1);
  } finally {
    await db.end();
  }
});

test("device reset frees the key once per cooldown; admin force ignores it", async () => {
  const db = await premiumDb();
  const signer = testSigner();
  try {
    await grantPremium(db, { userId: "usr_a", plan: "month" });
    const { key } = await issueKey(db, "usr_a");
    await verifyKey(db, signer, { key, deviceId: DEVICE_A });

    await releaseDevice(db, "usr_a");
    await verifyKey(db, signer, { key, deviceId: DEVICE_B });
    await assert.rejects(releaseDevice(db, "usr_a"), { code: "reset_cooldown" });
    await releaseDevice(db, "usr_a", { now: Date.now() + DEVICE_RESET_COOLDOWN_MS + 1000 });
    await verifyKey(db, signer, { key, deviceId: DEVICE_A });
    await releaseDevice(db, "usr_a", { force: true });
    await verifyKey(db, signer, { key, deviceId: DEVICE_B });
  } finally {
    await db.end();
  }
});

test("new keys retire old ones, and revoked or expired premium stops verifying", async () => {
  const db = await premiumDb();
  const signer = testSigner();
  try {
    const sub = await grantPremium(db, { userId: "usr_a", plan: "month" });
    const { key: oldKey } = await issueKey(db, "usr_a");
    await verifyKey(db, signer, { key: oldKey, deviceId: DEVICE_A });
    const { key: newKey } = await issueKey(db, "usr_a");
    await assert.rejects(verifyKey(db, signer, { key: oldKey, deviceId: DEVICE_A }), { code: "unknown_key" });
    // The new key is not tied to the old key's device.
    await verifyKey(db, signer, { key: newKey, deviceId: DEVICE_B });

    await revokeSubscription(db, sub.id);
    await assert.rejects(verifyKey(db, signer, { key: newKey, deviceId: DEVICE_B }), { code: "premium_expired" });

    await db.query("update premium_subscriptions set status = 'active', revoked_at = null, expires_at = now() - interval '1 day' where id = $1", [sub.id]);
    await assert.rejects(verifyKey(db, signer, { key: newKey, deviceId: DEVICE_B }), { code: "premium_expired" });
  } finally {
    await db.end();
  }
});

test("token lifetime never outlasts the premium period", async () => {
  const db = await premiumDb();
  const signer = testSigner();
  try {
    await grantPremium(db, { userId: "usr_a", plan: "custom", days: 2 });
    const { key } = await issueKey(db, "usr_a");
    const { payload } = await verifyKey(db, signer, { key, deviceId: DEVICE_A });
    assert.ok(payload.exp * 1000 <= Date.now() + 2 * DAY + 1000);
  } finally {
    await db.end();
  }
});

test("premium HTTP routes: admin grant, user key, public verify", async () => {
  const db = await premiumDb();
  const signer = testSigner();
  const previous = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = "test-admin-token";
  const app = await buildApp({ db, logger: false, sessionSecret: "test-session-secret", premiumSigner: signer });
  try {
    const noAdmin = await app.inject({ method: "POST", url: "/api/admin/premium/grant", payload: { email: "a@example.com", plan: "year" } });
    assert.equal(noAdmin.statusCode, 401);

    const grant = await app.inject({
      method: "POST",
      url: "/api/admin/premium/grant",
      headers: { authorization: "Bearer test-admin-token" },
      payload: { email: "A@example.com", plan: "year", note: "test" }
    });
    assert.equal(grant.statusCode, 200);
    assert.equal(grant.json().data.status.active, true);

    // Users must be signed in to see or create their key.
    assert.equal((await app.inject({ method: "GET", url: "/api/premium/me" })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/premium/key" })).statusCode, 401);

    const { key } = await issueKey(db, "usr_a");
    const ok = await app.inject({ method: "POST", url: "/api/premium/verify", payload: { key, device_id: DEVICE_A } });
    assert.equal(ok.statusCode, 200);
    assert.equal(verifyLicenceToken(ok.json().data.token, signer.publicKeyPem).sub, "usr_a");

    const other = await app.inject({ method: "POST", url: "/api/premium/verify", payload: { key, device_id: DEVICE_B } });
    assert.equal(other.statusCode, 409);
    assert.equal(other.json().code, "device_mismatch");

    const bad = await app.inject({ method: "POST", url: "/api/premium/verify", payload: { key: "nope", device_id: DEVICE_A } });
    assert.equal(bad.statusCode, 400);

    const publicKey = await app.inject({ method: "GET", url: "/api/premium/public-key" });
    assert.equal(publicKey.json().data.publicKeyPem, signer.publicKeyPem);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = previous;
    await app.close();
  }
});

test("verify answers 503 instead of signing when no signing key is configured", async () => {
  const db = await premiumDb();
  const app = await buildApp({ db, logger: false, sessionSecret: "test-session-secret", premiumSigner: null });
  try {
    const response = await app.inject({ method: "POST", url: "/api/premium/verify", payload: { key: generatePremiumKey(), device_id: DEVICE_A } });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, "signing_unavailable");
  } finally {
    await app.close();
  }
});

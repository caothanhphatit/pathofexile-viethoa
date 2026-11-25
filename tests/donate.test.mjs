import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { buildApp } from "../src/server/app.mjs";
import {
  createIntent,
  donateConfig,
  generateDonateCode,
  intentStatus,
  recordPayment,
  supporters,
  userSupport,
  verifyDonateWebhook
} from "../src/server/services/donate-service.mjs";
import {
  DONATE_CODE_PATTERN,
  cleanDonateText,
  donateTier,
  findDonateCode,
  nextDonateTier,
  normalizeDonateAmount
} from "../src/shared/donate-rules.mjs";
import { crc16, vietQrPayload } from "../src/shared/vietqr.mjs";

const SECRET = "test-donate-secret-0123456789";
const ACCOUNT = "1234567890";
const ENV = {
  DONATE_BANK_BIN: "970422",
  DONATE_BANK_NAME: "MB Bank",
  DONATE_ACCOUNT_NO: ACCOUNT,
  DONATE_ACCOUNT_NAME: "",
  DONATE_WEBHOOK_SECRET: SECRET
};

// Real Postgres (in-process) with users and the donations migration.
const donateDb = async () => {
  const pg = new PGlite();
  const sql = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
  await pg.exec((await sql("004_auth_leveling_accounts.sql")).split("create table if not exists leveling_characters")[0]);
  await pg.exec(await sql("014_donations.sql"));
  await pg.query("insert into users (id, email, display_name) values ('usr_a', 'a@example.com', 'Alice')");
  return {
    pg,
    async query(text, params = []) {
      const result = await pg.query(text, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    async end() {
      if (!pg.closed) await pg.close();
    }
  };
};

const sepayBody = (overrides = {}) => ({
  id: 92704,
  gateway: "MBBank",
  transactionDate: "2026-11-25 17:40:00",
  accountNumber: ACCOUNT,
  code: null,
  content: "",
  transferType: "in",
  transferAmount: 50000,
  accumulated: 1000000,
  subAccount: null,
  referenceCode: "FT26329",
  description: "",
  ...overrides
});

test("VietQR payload follows EMVCo and NAPAS 247", () => {
  // CRC-16/CCITT-FALSE check value.
  assert.equal(crc16("123456789"), "29B1");
  const payload = vietQrPayload({ bin: "970422", account: ACCOUNT, amount: 50000, content: "POE7K2MQX" });
  assert.equal(
    payload.slice(0, -4),
    "00020101021238540010A00000072701240006970422011012345678900208QRIBFTTA53037045405500005802VN62130809POE7K2MQX6304"
  );
  assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)));
  // No amount: reusable QR, no amount field.
  const open = vietQrPayload({ bin: "970422", account: ACCOUNT });
  assert.match(open, /^000201010211/);
  assert.doesNotMatch(open, /5405/);
  // Content keeps printable ASCII only (banking apps reject the rest).
  assert.match(vietQrPayload({ bin: "970422", account: ACCOUNT, content: "POEAB2CD3 ủng hộ" }), /62180814POEAB2CD3 ng h6304/);
  assert.equal(vietQrPayload({ bin: "97042", account: ACCOUNT }), "");
  assert.equal(vietQrPayload({ bin: "970422", account: "12" }), "");
});

test("codes, amounts, tiers and donor text follow the rules", () => {
  for (let i = 0; i < 200; i += 1) assert.match(generateDonateCode(), DONATE_CODE_PATTERN);
  assert.equal(generateDonateCode(() => 0), "POEAAAAAA");

  assert.equal(normalizeDonateAmount("50000"), 50000);
  assert.equal(normalizeDonateAmount(9999), null);
  assert.equal(normalizeDonateAmount("abc"), null);
  assert.equal(normalizeDonateAmount(10000.9), 10000);

  assert.equal(donateTier(19999), null);
  assert.equal(donateTier(20000).id, "magic");
  assert.equal(donateTier(100000).id, "rare");
  assert.equal(donateTier(500000).id, "unique");
  assert.equal(donateTier(2000000).id, "mirror");
  assert.deepEqual({ ...nextDonateTier(50000) }, { id: "rare", label: "Rare", min: 100000, missing: 50000 });
  assert.equal(nextDonateTier(5000000), null);

  assert.equal(cleanDonateText("  Hello\n\tworld​‮!  ", 40), "Hello world !");
  // Cut by characters, not bytes; a trailing space left by the cut is trimmed.
  assert.equal(cleanDonateText("ủng hộ".repeat(20), 10), "ủng hộủng");
  assert.equal(cleanDonateText(null, 10), "");

  // Banks upper-case the content and add their own text around it.
  assert.equal(findDonateCode("ung ho poe7k2mqx ft26329/718806"), "POE7K2MQX");
  assert.equal(findDonateCode("POE 7K2-MQX"), "POE7K2MQX");
  assert.equal(findDonateCode("FOSTAW38GVLFN I24AES7Y/718806"), null);
  assert.equal(findDonateCode(undefined), null);
});

test("config needs a bank, an account and a 6-digit BIN; the holder name is optional", () => {
  assert.equal(donateConfig(ENV).enabled, true);
  assert.equal(donateConfig({ ...ENV, DONATE_BANK_BIN: "MBBank" }).enabled, false);
  assert.equal(donateConfig({ ...ENV, DONATE_ACCOUNT_NO: "" }).enabled, false);
  assert.equal(donateConfig({}).enabled, false);
});

test("webhook accepts SePay's Apikey header and fostaPay's signed headers only", () => {
  const rawBody = JSON.stringify(sepayBody());
  assert.equal(verifyDonateWebhook({ secret: SECRET, headers: { authorization: `Apikey ${SECRET}` }, rawBody }).ok, true);
  assert.equal(verifyDonateWebhook({ secret: SECRET, headers: { authorization: "Apikey wrong" }, rawBody }).statusCode, 401);
  assert.equal(verifyDonateWebhook({ secret: SECRET, headers: {}, rawBody }).statusCode, 401);
  assert.equal(verifyDonateWebhook({ secret: "", headers: { authorization: `Apikey ${SECRET}` }, rawBody }).statusCode, 503);

  const now = Date.now();
  const sign = (ts, body) => `v1=${crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
  const signed = { "x-webhook-secret": SECRET, "x-fostapay-timestamp": String(now), "x-fostapay-signature": sign(now, rawBody) };
  assert.equal(verifyDonateWebhook({ secret: SECRET, headers: signed, rawBody, now }).ok, true);
  assert.equal(verifyDonateWebhook({ secret: SECRET, headers: signed, rawBody: `${rawBody} `, now }).ok, false, "body changed");
  const old = now - 11 * 60 * 1000;
  assert.equal(verifyDonateWebhook({
    secret: SECRET,
    headers: { ...signed, "x-fostapay-timestamp": String(old), "x-fostapay-signature": sign(old, rawBody) },
    rawBody,
    now
  }).ok, false, "stale timestamp");
});

test("a transfer with the code credits the donation once; other transfers are ignored", async () => {
  const db = await donateDb();
  try {
    const intent = await createIntent(db, { user: { id: "usr_a", displayName: "Alice" }, message: "Cảm ơn!", amount: 50000 });
    assert.match(intent.code, DONATE_CODE_PATTERN);
    assert.equal(intent.status, "pending");

    // Fosta AI top-up on the same account: not ours, nothing stored.
    assert.equal(await recordPayment(db, sepayBody({ id: 1, content: "FOSTAW38GVLFN I24AES7Y/718806" }), { accountNo: ACCOUNT }), "ignored");
    // Another account, outgoing money, test bodies.
    assert.equal(await recordPayment(db, sepayBody({ id: 2, content: intent.code, accountNumber: "999" }), { accountNo: ACCOUNT }), "ignored");
    assert.equal(await recordPayment(db, sepayBody({ id: 3, content: intent.code, transferType: "out" }), { accountNo: ACCOUNT }), "ignored");
    assert.equal(await recordPayment(db, { id: "t", amount: 0, source: "fostapay-test" }), "ignored");
    assert.equal((await db.query("select count(*)::int as n from donation_payments")).rows[0].n, 0);

    // The donor changed the amount in the banking app: the amount received counts.
    const body = sepayBody({ id: 10, transferAmount: 70000, content: `MBVCB.123.${intent.code.toLowerCase()} ung ho` });
    assert.equal(await recordPayment(db, body, { accountNo: ACCOUNT }), "paid");
    assert.equal(await recordPayment(db, body, { accountNo: ACCOUNT }), "already_paid", "SePay retry");

    const status = await intentStatus(db, intent.code.toLowerCase());
    assert.equal(status.status, "paid");
    assert.equal(status.amountPaid, 70000);

    // A POE-shaped code nobody created is kept for the owner.
    assert.equal(await recordPayment(db, sepayBody({ id: 11, content: "POEZZZZZZ" }), { accountNo: ACCOUNT }), "no_order");

    const me = await userSupport(db, "usr_a");
    assert.equal(me.total, 70000);
    assert.equal(me.tier, "magic");
    assert.deepEqual(me.next, { tier: "rare", missing: 30000 });
  } finally {
    await db.end();
  }
});

test("the supporter wall hides hidden entries and hidden amounts", async () => {
  const db = await donateDb();
  try {
    const pay = async (input, id) => {
      const intent = await createIntent(db, input);
      await recordPayment(db, sepayBody({ id, transferAmount: input.amount, content: intent.code }), { accountNo: ACCOUNT });
      return intent;
    };
    await pay({ user: { id: "usr_a", displayName: "Alice" }, amount: 100000 }, 1);
    await pay({ user: { id: "usr_a", displayName: "Alice" }, amount: 50000, message: "lần 2" }, 2);
    await pay({ displayName: "Bob", amount: 20000, hideAmount: true }, 3);
    const spam = await pay({ displayName: "spam", message: "xxx", amount: 10000 }, 4);
    await db.query("update donation_intents set hidden = true where code = $1", [spam.code]);
    await createIntent(db, { displayName: "Unpaid", amount: 30000 });

    const wall = await supporters(db);
    assert.equal(wall.donations, 4);
    assert.deepEqual(wall.recent.map((row) => row.name).sort(), ["Alice", "Alice", "Bob"]);
    assert.equal(wall.recent.find((row) => row.name === "Bob").amount, null);
    assert.equal(wall.recent.find((row) => row.message === "lần 2").tier, "rare", "tier uses the donor's total");
    assert.deepEqual(wall.top.map((row) => [row.name, row.total, row.tier]), [["Alice", 150000, "rare"], ["Bob", null, "magic"]]);
  } finally {
    await db.end();
  }
});

test("donate API: create a code, pay through the SePay webhook, read the status", async () => {
  const db = await donateDb();
  const app = await buildApp({ db, logger: false, donateEnv: ENV });
  try {
    const config = await app.inject({ method: "GET", url: "/api/donate/config" });
    assert.equal(config.json().data.enabled, true);
    assert.equal(config.json().data.accountNo, ACCOUNT);

    const bad = await app.inject({ method: "POST", url: "/api/donate/intents", payload: { amount: 5000 } });
    assert.equal(bad.statusCode, 400);

    const created = await app.inject({
      method: "POST",
      url: "/api/donate/intents",
      payload: { amount: 50000, displayName: "<b>Khách</b>", message: "Hay quá" }
    });
    assert.equal(created.statusCode, 200);
    const { code } = created.json().data;

    const payload = JSON.stringify(sepayBody({ id: 777, content: `${code} FT123` }));
    const denied = await app.inject({
      method: "POST",
      url: "/api/donate/webhook",
      headers: { "content-type": "application/json", authorization: "Apikey nope" },
      payload
    });
    assert.equal(denied.statusCode, 401);

    const hook = await app.inject({
      method: "POST",
      url: "/api/donate/webhook",
      headers: { "content-type": "application/json", authorization: `Apikey ${SECRET}` },
      payload
    });
    assert.equal(hook.statusCode, 200);
    assert.deepEqual(hook.json(), { success: true, ok: true, result: "paid" });

    const status = await app.inject({ method: "GET", url: `/api/donate/intents/${code}` });
    assert.equal(status.json().data.status, "paid");
    assert.equal((await app.inject({ method: "GET", url: "/api/donate/intents/POEAAAAAA" })).statusCode, 404);

    // Text is stored as text; the page renders it as text too.
    const wall = (await app.inject({ method: "GET", url: "/api/donate/supporters" })).json().data;
    assert.equal(wall.recent[0].name, "<b>Khách</b>");

    // Without the webhook secret the route refuses.
    const closed = await buildApp({ db, logger: false, donateEnv: { ...ENV, DONATE_WEBHOOK_SECRET: "" } });
    try {
      const refused = await closed.inject({
        method: "POST",
        url: "/api/donate/webhook",
        headers: { "content-type": "application/json", authorization: `Apikey ${SECRET}` },
        payload
      });
      assert.equal(refused.statusCode, 503);
    } finally {
      await closed.close();
    }
  } finally {
    await app.close();
    await db.end();
  }
});

test("donate page wiring: route, header button, QR from our own payload", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [app, routes, page, privacy, nginx] = await Promise.all([
    read("src/spa/App.tsx"),
    read("src/spa/lib/routes.ts"),
    read("src/spa/pages/DonatePage.tsx"),
    read("public/privacy/index.html"),
    read("deploy/nginx/poeviethoa-clean-routes.conf")
  ]);
  assert.match(app, /case "donate":\s*return <DonatePage/);
  assert.match(app, /className=\{route\.key === "donate" \? "donate-button is-active" : "donate-button"\}/);
  assert.match(routes, /path: "\/donate"[\s\S]*aliases: \["\/ung-ho"\]/);
  assert.match(page, /vietQrPayload\(/);
  assert.doesNotMatch(page, /img\.vietqr|vietqr\.app|qr\.sepay/i, "no third-party QR image service");
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
  assert.match(privacy, /\/donate/);
  assert.match(nginx, /location = \/donate \{/);
});

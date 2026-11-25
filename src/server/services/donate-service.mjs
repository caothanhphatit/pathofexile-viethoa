// Donations by bank transfer. Each donation gets a transfer code; SePay reports every
// incoming transfer on the receiving account to our webhook, and the code tells who paid.
// The account is shared with Fosta AI, so transfers without a POE code are not ours.
import crypto from "node:crypto";

import {
  DONATE_CODE_ALPHABET,
  DONATE_CODE_LENGTH,
  DONATE_CODE_PATTERN,
  DONATE_CODE_PREFIX,
  DONATE_MESSAGE_MAX,
  DONATE_NAME_MAX,
  cleanDonateText,
  donateTier,
  findDonateCode,
  nextDonateTier,
  normalizeDonateAmount
} from "../../shared/donate-rules.mjs";

export const WEBHOOK_MAX_AGE_MS = 10 * 60 * 1000;
// Unpaid codes created in the last hour, site-wide: a cheap stop against filling the table.
export const PENDING_INTENTS_PER_HOUR = 300;

const newId = (prefix) => `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;

const fail = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code });

/** Receiving account from env. These values are printed on the QR, so they are not secrets. */
export const donateConfig = (env = process.env) => {
  const bankBin = String(env.DONATE_BANK_BIN || "").trim();
  const bankName = String(env.DONATE_BANK_NAME || "").trim();
  const accountNo = String(env.DONATE_ACCOUNT_NO || "").replace(/\s+/g, "");
  const accountName = String(env.DONATE_ACCOUNT_NAME || "").trim();
  return {
    // The holder's name is only shown on the page; the QR does not need it.
    enabled: Boolean(/^\d{6}$/.test(bankBin) && bankName && accountNo),
    bankBin,
    bankName,
    accountNo,
    accountName
  };
};

export const generateDonateCode = (random = crypto.randomInt) => {
  let code = DONATE_CODE_PREFIX;
  for (let i = 0; i < DONATE_CODE_LENGTH; i += 1) code += DONATE_CODE_ALPHABET[random(DONATE_CODE_ALPHABET.length)];
  return code;
};

const publicIntent = (row) => ({
  code: row.code,
  status: row.status,
  amountExpected: Number(row.amount_expected),
  amountPaid: row.amount_paid === null || row.amount_paid === undefined ? null : Number(row.amount_paid),
  paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null
});

/** Creates a donation and its transfer code. `user` is the signed-in donor or null. */
export const createIntent = async (db, { user = null, displayName, message, amount, hideAmount } = {}, { random } = {}) => {
  const value = normalizeDonateAmount(amount);
  if (value === null) throw fail(400, "Invalid amount", "invalid_amount");
  const name = cleanDonateText(displayName, DONATE_NAME_MAX) || cleanDonateText(user?.displayName, DONATE_NAME_MAX);
  const note = cleanDonateText(message, DONATE_MESSAGE_MAX);

  const recent = await db.query(
    "select count(*)::int as n from donation_intents where status = 'pending' and created_at > now() - interval '1 hour'"
  );
  if ((recent.rows[0]?.n ?? 0) >= PENDING_INTENTS_PER_HOUR) throw fail(429, "Too many requests, try again later", "busy");

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateDonateCode(random);
    const { rows } = await db.query(`
      insert into donation_intents (id, code, user_id, display_name, message, amount_expected, hide_amount)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (code) do nothing
      returning code, status, amount_expected, amount_paid, paid_at
    `, [newId("don"), code, user?.id ?? null, name, note, value, Boolean(hideAmount)]);
    if (rows[0]) return publicIntent(rows[0]);
  }
  throw fail(503, "Could not create a transfer code, try again", "code_collision");
};

/** State of one donation, for the page that waits for the transfer; null when the code is unknown. */
export const intentStatus = async (db, code) => {
  const normalized = String(code || "").toUpperCase();
  if (!DONATE_CODE_PATTERN.test(normalized)) return null;
  const { rows } = await db.query(
    "select code, status, amount_expected, amount_paid, paid_at from donation_intents where code = $1",
    [normalized]
  );
  return rows[0] ? publicIntent(rows[0]) : null;
};

const timingSafeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

/**
 * Checks who is calling the webhook. SePay sends `Authorization: Apikey <key>`. fostaPay (Fosta's
 * own bank-alert reader) sends `x-webhook-secret` plus `x-fostapay-signature: v1=<hex>` =
 * HMAC-SHA256(secret, "<timestamp>.<raw body>") with a timestamp no older than 10 minutes.
 */
export const verifyDonateWebhook = ({ secret, headers = {}, rawBody = "", now = Date.now() } = {}) => {
  if (!secret) return { ok: false, statusCode: 503, error: "Donations webhook is not configured" };
  const authorization = String(headers.authorization ?? "");
  if (/^apikey\s+/i.test(authorization)) {
    return timingSafeEqual(authorization.replace(/^apikey\s+/i, "").trim(), secret)
      ? { ok: true }
      : { ok: false, statusCode: 401, error: "Unauthorized" };
  }
  if (!timingSafeEqual(headers["x-webhook-secret"] ?? "", secret)) return { ok: false, statusCode: 401, error: "Unauthorized" };
  const timestamp = String(headers["x-fostapay-timestamp"] ?? "");
  const ts = Number(timestamp);
  if (!/^\d{10,16}$/.test(timestamp) || Math.abs(now - ts) > WEBHOOK_MAX_AGE_MS) {
    return { ok: false, statusCode: 401, error: "Stale or missing timestamp" };
  }
  const signature = String(headers["x-fostapay-signature"] ?? "");
  const expected = `v1=${crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  if (!timingSafeEqual(signature, expected)) return { ok: false, statusCode: 401, error: "Bad signature" };
  return { ok: true };
};

/**
 * Stores one reported transfer and credits the donation its code names.
 * Result: paid | already_paid | no_order | ignored.
 * The receiving account also takes Fosta AI top-ups: a transfer without a POE code, or to
 * another account, is ignored and nothing about it is stored here.
 */
export const recordPayment = async (db, body = {}, { accountNo = "" } = {}) => {
  const amount = Math.floor(Number(body.transferAmount ?? body.amount));
  if (body.source === "fostapay-test" || (body.transferType && body.transferType !== "in")) return "ignored";
  if (body.id === undefined || body.id === null || body.id === "" || !Number.isFinite(amount) || amount <= 0) return "ignored";
  const reportedAccount = String(body.accountNumber ?? "").replace(/\s+/g, "");
  if (accountNo && reportedAccount && reportedAccount !== accountNo) return "ignored";
  const content = String(body.content ?? "").slice(0, 500);
  const code = findDonateCode(body.code) || findDonateCode(content) || findDonateCode(body.description) || "";
  if (!code) return "ignored";
  // SePay and fostaPay may both report the same transfer under their own ids.
  const paymentId = `${body.source === "fostapay" ? "fostapay" : "sepay"}:${String(body.id).slice(0, 100)}`;

  const inserted = await db.query(`
    insert into donation_payments (payment_id, code, amount, content)
    values ($1, $2, $3, $4)
    on conflict (payment_id) do nothing
    returning payment_id
  `, [paymentId, code, amount, content]);
  if (!inserted.rows[0]) return "already_paid";
  if (!code) return "no_order";

  // A second transfer with the same code adds to the same donation.
  const updated = await db.query(`
    update donation_intents
    set status = 'paid',
        amount_paid = coalesce(amount_paid, 0) + $2,
        paid_at = coalesce(paid_at, now()),
        payment_id = coalesce(payment_id, $3)
    where code = $1
    returning id
  `, [code, amount, paymentId]);
  if (!updated.rows[0]) return "no_order";
  await db.query("update donation_payments set intent_id = $2 where payment_id = $1", [paymentId, updated.rows[0].id]);
  return "paid";
};

const tierId = (total) => donateTier(total)?.id ?? null;

/** Total donated by a signed-in account and the tier it gives. */
export const userSupport = async (db, userId) => {
  const { rows } = await db.query(
    "select coalesce(sum(amount_paid), 0)::bigint as total, count(*)::int as donations from donation_intents where user_id = $1 and status = 'paid'",
    [userId]
  );
  const total = Number(rows[0]?.total ?? 0);
  const next = nextDonateTier(total);
  return {
    total,
    donations: rows[0]?.donations ?? 0,
    tier: tierId(total),
    next: next ? { tier: next.id, missing: next.missing } : null
  };
};

/** The public wall: latest paid donations and the top supporters by total. */
export const supporters = async (db, { recentLimit = 30, topLimit = 10 } = {}) => {
  // One supporter = one account, or one display name for anonymous donations.
  const donorKey = "coalesce('u:' || user_id, 'n:' || lower(display_name))";
  const recent = await db.query(`
    with totals as (
      select ${donorKey} as donor, sum(amount_paid) as total
      from donation_intents where status = 'paid' and not hidden group by 1
    )
    select i.display_name, i.message, i.amount_paid, i.hide_amount, i.paid_at, t.total
    from donation_intents i
    join totals t on t.donor = ${donorKey.replace(/user_id/g, "i.user_id").replace(/display_name/g, "i.display_name")}
    where i.status = 'paid' and not i.hidden
    order by i.paid_at desc
    limit $1
  `, [recentLimit]);
  const top = await db.query(`
    select max(display_name) as display_name, sum(amount_paid) as total, count(*)::int as donations,
           bool_or(hide_amount) as hide_amount
    from donation_intents
    where status = 'paid' and not hidden
    group by ${donorKey}
    order by sum(amount_paid) desc, min(paid_at) asc
    limit $1
  `, [topLimit]);
  const summary = await db.query(
    "select coalesce(sum(amount_paid), 0)::bigint as total, count(*)::int as donations from donation_intents where status = 'paid'"
  );
  return {
    total: Number(summary.rows[0]?.total ?? 0),
    donations: summary.rows[0]?.donations ?? 0,
    recent: recent.rows.map((row) => ({
      name: row.display_name || "",
      message: row.message || "",
      amount: row.hide_amount ? null : Number(row.amount_paid),
      paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
      tier: tierId(Number(row.total))
    })),
    top: top.rows.map((row) => ({
      name: row.display_name || "",
      total: row.hide_amount ? null : Number(row.total),
      donations: row.donations,
      tier: tierId(Number(row.total))
    }))
  };
};

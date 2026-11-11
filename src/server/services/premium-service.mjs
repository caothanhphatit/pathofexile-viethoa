import crypto from "node:crypto";

// Premium on a web account, usable from client apps through a key.
//
//   account ──< premium_subscriptions   paid periods (stack end to end)
//   account ──  premium_keys            one active key; shown to the user once
//   key     ──  premium_key_devices     one active device per key
//
// A client sends key + its own device id to POST /api/premium/verify and gets back a
// short-lived licence token signed with Ed25519. The client checks the signature with
// the public key (GET /api/premium/public-key) and must call verify again before the
// token expires, so revoking a subscription or a key takes effect within TOKEN_TTL.

export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEVICE_RESET_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const PLAN_DAYS = { month: 30, year: 365, lifetime: null };

const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, no I L O U
const DAY_MS = 24 * 60 * 60 * 1000;

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const base64Url = (buffer) => Buffer.from(buffer).toString("base64url");
const newId = (prefix) => `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;

const httpError = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

export const generatePremiumKey = (random = crypto.randomBytes) => {
  const bytes = random(20);
  const chars = [...bytes].map((byte) => KEY_ALPHABET[byte % 32]).join("");
  return `PVH-${chars.match(/.{5}/g).join("-")}`;
};

// Accepts what users paste: any case, spaces, missing dashes, Crockford look-alikes.
export const normalizePremiumKey = (input = "") => {
  const compact = String(input).toUpperCase().replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1");
  const body = compact.startsWith("PVH") ? compact.slice(3) : compact;
  if (body.length !== 20 || [...body].some((ch) => !KEY_ALPHABET.includes(ch))) return null;
  return `PVH-${body.match(/.{5}/g).join("-")}`;
};

export const hashPremiumKey = (key) => sha256(`poevh-premium-key:${key}`);
// Salted per key so the same machine does not produce a linkable hash across accounts.
export const hashDeviceId = (keyId, deviceId) => sha256(`poevh-device:${keyId}:${deviceId}`);

export const isValidDeviceId = (value) =>
  typeof value === "string" && value.length >= 16 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value);

// ── Licence tokens ─────────────────────────────────────────────────────────

// PREMIUM_SIGNING_KEY holds an Ed25519 private key as PKCS#8 PEM, either raw or
// base64-encoded (handy for one-line .env values). Generate one with
//   node scripts/premium-keygen.mjs
export const createPremiumSigner = (env = process.env) => {
  const raw = String(env.PREMIUM_SIGNING_KEY || "").trim();
  if (!raw) return null;
  const pem = raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
  const privateKey = crypto.createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("PREMIUM_SIGNING_KEY must be an Ed25519 key");
  const publicKey = crypto.createPublicKey(privateKey);
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    sign(payload) {
      const body = base64Url(JSON.stringify(payload));
      const signature = crypto.sign(null, Buffer.from(body), privateKey);
      return `${body}.${base64Url(signature)}`;
    }
  };
};

// Reference check for clients and tests: returns the payload, or null when the token
// is malformed, forged or expired.
export const verifyLicenceToken = (token, publicKeyPem, { now = Date.now() } = {}) => {
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra !== undefined) return null;
  try {
    const ok = crypto.verify(null, Buffer.from(body), crypto.createPublicKey(publicKeyPem), Buffer.from(signature, "base64url"));
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
};

// ── Subscriptions ──────────────────────────────────────────────────────────

const ACTIVE_SUBSCRIPTION_SQL = `
  status = 'active' and starts_at <= now() and (expires_at is null or expires_at > now())
`;

// The account's premium window: the latest end of its active periods, or null for lifetime.
export const premiumWindow = async (db, userId) => {
  const { rows } = await db.query(`
    select plan, expires_at
    from premium_subscriptions
    where user_id = $1 and ${ACTIVE_SUBSCRIPTION_SQL}
  `, [userId]);
  if (!rows.length) return { active: false, plan: null, expiresAt: null };
  if (rows.some((row) => row.expires_at === null)) return { active: true, plan: "lifetime", expiresAt: null };
  const latest = rows.reduce((best, row) => (new Date(row.expires_at) > new Date(best.expires_at) ? row : best));
  // Include periods queued after the current one (granted while still active).
  const { rows: queued } = await db.query(`
    select max(expires_at) as expires_at
    from premium_subscriptions
    where user_id = $1 and status = 'active' and expires_at is not null and expires_at > now()
  `, [userId]);
  const expiresAt = queued[0]?.expires_at ? new Date(queued[0].expires_at) : new Date(latest.expires_at);
  return { active: true, plan: latest.plan, expiresAt };
};

// Adds a paid period. A new period starts when the current one ends, so buying a
// month while 10 days are left gives 40 days, not 30.
export const grantPremium = async (db, { userId, plan, days, note = "", source = "admin" }) => {
  if (!userId) throw httpError(400, "missing_user", "userId is required");
  let durationDays;
  if (plan === "custom") {
    durationDays = Number.parseInt(days, 10);
    if (!(durationDays > 0 && durationDays <= 3650)) throw httpError(400, "bad_days", "days must be between 1 and 3650");
  } else if (Object.hasOwn(PLAN_DAYS, plan)) {
    durationDays = PLAN_DAYS[plan];
  } else {
    throw httpError(400, "bad_plan", "plan must be month, year, lifetime or custom");
  }

  const current = await premiumWindow(db, userId);
  if (current.active && current.expiresAt === null && durationDays !== null) {
    throw httpError(409, "already_lifetime", "This account already has lifetime premium");
  }
  // Lifetime starts right away; timed periods queue after the current one.
  const startsAt = durationDays !== null && current.active && current.expiresAt ? current.expiresAt : new Date();
  const expiresAt = durationDays === null ? null : new Date(startsAt.getTime() + durationDays * DAY_MS);
  const id = newId("sub");
  await db.query(`
    insert into premium_subscriptions (id, user_id, plan, starts_at, expires_at, source, note)
    values ($1, $2, $3, $4, $5, $6, $7)
  `, [id, userId, plan, startsAt, expiresAt, String(source).slice(0, 40), String(note).slice(0, 500)]);
  return { id, plan, startsAt, expiresAt };
};

export const revokeSubscription = async (db, subscriptionId) => {
  const { rowCount } = await db.query(`
    update premium_subscriptions set status = 'revoked', revoked_at = now()
    where id = $1 and status = 'active'
  `, [subscriptionId]);
  if (!rowCount) throw httpError(404, "not_found", "No active subscription with that id");
};

// ── Keys and devices ───────────────────────────────────────────────────────

const activeKeyRow = async (db, userId) => {
  const { rows } = await db.query(`
    select id, key_prefix, created_at from premium_keys
    where user_id = $1 and revoked_at is null
  `, [userId]);
  return rows[0] || null;
};

const activeDeviceRow = async (db, keyId) => {
  const { rows } = await db.query(`
    select id, device_hash, device_label, first_seen_at, last_seen_at from premium_key_devices
    where key_id = $1 and released_at is null
  `, [keyId]);
  return rows[0] || null;
};

const lastReleaseAt = async (db, userId) => {
  const { rows } = await db.query(`
    select max(d.released_at) as released_at
    from premium_key_devices d join premium_keys k on k.id = d.key_id
    where k.user_id = $1 and d.released_at is not null
  `, [userId]);
  return rows[0]?.released_at ? new Date(rows[0].released_at) : null;
};

// Issues a fresh key and retires the previous one (its device binding goes with it).
// The plain key is returned here only; the database keeps its hash.
export const issueKey = async (db, userId, { generate = generatePremiumKey } = {}) => {
  const window = await premiumWindow(db, userId);
  if (!window.active) throw httpError(403, "premium_required", "An active premium plan is required to create a key");
  const previous = await activeKeyRow(db, userId);
  if (previous) {
    await db.query("update premium_key_devices set released_at = now() where key_id = $1 and released_at is null", [previous.id]);
    await db.query("update premium_keys set revoked_at = now() where id = $1", [previous.id]);
  }
  const key = generate();
  const id = newId("pkey");
  await db.query(`
    insert into premium_keys (id, user_id, key_hash, key_prefix) values ($1, $2, $3, $4)
  `, [id, userId, hashPremiumKey(key), key.slice(0, 9)]);
  return { id, key };
};

export const premiumStatus = async (db, userId, { now = Date.now() } = {}) => {
  const window = await premiumWindow(db, userId);
  const key = await activeKeyRow(db, userId);
  const device = key ? await activeDeviceRow(db, key.id) : null;
  const released = await lastReleaseAt(db, userId);
  const resetAvailableAt = released ? new Date(released.getTime() + DEVICE_RESET_COOLDOWN_MS) : null;
  return {
    active: window.active,
    plan: window.plan,
    expiresAt: window.expiresAt,
    key: key ? { prefix: key.key_prefix, createdAt: key.created_at } : null,
    device: device ? { label: device.device_label, firstSeenAt: device.first_seen_at, lastSeenAt: device.last_seen_at } : null,
    deviceResetAvailableAt: resetAvailableAt && resetAvailableAt.getTime() > now ? resetAvailableAt : null
  };
};

// Frees the key's device so another machine can activate it. Users may do this once
// per DEVICE_RESET_COOLDOWN; an admin (force) may do it any time.
export const releaseDevice = async (db, userId, { force = false, now = Date.now() } = {}) => {
  const key = await activeKeyRow(db, userId);
  if (!key) throw httpError(404, "no_key", "This account has no active key");
  if (!force) {
    const released = await lastReleaseAt(db, userId);
    if (released && released.getTime() + DEVICE_RESET_COOLDOWN_MS > now) {
      throw httpError(429, "reset_cooldown", `Device can be changed again after ${new Date(released.getTime() + DEVICE_RESET_COOLDOWN_MS).toISOString()}`);
    }
  }
  const { rowCount } = await db.query(
    "update premium_key_devices set released_at = now() where key_id = $1 and released_at is null",
    [key.id]
  );
  if (!rowCount) throw httpError(409, "no_device", "The key is not bound to a device yet");
};

// The endpoint client apps call. Binds the key to the first device that uses it and
// refuses every other device until the binding is released.
export const verifyKey = async (db, signer, { key, deviceId, deviceLabel = "", ip = "" }, { now = Date.now() } = {}) => {
  if (!signer) throw httpError(503, "signing_unavailable", "Licence signing is not configured");
  const normalized = normalizePremiumKey(key);
  if (!normalized) throw httpError(400, "bad_key", "Key format is invalid");
  if (!isValidDeviceId(deviceId)) throw httpError(400, "bad_device", "device_id must be 16-256 printable characters");

  const { rows } = await db.query(`
    select id, user_id from premium_keys where key_hash = $1 and revoked_at is null
  `, [hashPremiumKey(normalized)]);
  const keyRow = rows[0];
  if (!keyRow) throw httpError(401, "unknown_key", "Key not found or revoked");

  const window = await premiumWindow(db, keyRow.user_id);
  if (!window.active) throw httpError(403, "premium_expired", "Premium has expired for this key");

  const deviceHash = hashDeviceId(keyRow.id, deviceId);
  const label = String(deviceLabel || "").slice(0, 80);
  const clientIp = String(ip || "").slice(0, 64);
  let device = await activeDeviceRow(db, keyRow.id);
  if (!device) {
    try {
      await db.query(`
        insert into premium_key_devices (id, key_id, device_hash, device_label, last_ip)
        values ($1, $2, $3, $4, $5)
      `, [newId("pdev"), keyRow.id, deviceHash, label, clientIp]);
    } catch (error) {
      // Two first activations raced; the unique index kept one of them.
      if (error?.code !== "23505") throw error;
    }
    device = await activeDeviceRow(db, keyRow.id);
  }
  if (!device || device.device_hash !== deviceHash) {
    throw httpError(409, "device_mismatch", "This key is already activated on another device");
  }
  await db.query(`
    update premium_key_devices set last_seen_at = now(), last_ip = $2,
      device_label = case when $3 = '' then device_label else $3 end
    where id = $1
  `, [device.id, clientIp, label]);

  const tokenExpiry = Math.min(now + TOKEN_TTL_MS, window.expiresAt ? window.expiresAt.getTime() : Infinity);
  const payload = {
    v: 1,
    sub: keyRow.user_id,
    kid: keyRow.id,
    dev: deviceHash,
    plan: window.plan,
    premium_until: window.expiresAt ? window.expiresAt.toISOString() : null,
    iat: Math.floor(now / 1000),
    exp: Math.floor(tokenExpiry / 1000)
  };
  return { token: signer.sign(payload), payload };
};

// ── Offer (plans and how to pay) ──────────────────────────────────────────

// Shown by client apps and the /premium page. There is no payment gateway yet, so
// the offer carries manual payment instructions; an admin grants the plan after
// the transfer. Override any part with PREMIUM_OFFER_JSON in .env, for example
//   PREMIUM_OFFER_JSON={"plans":[{"id":"month","price":49000}],"payment":{"bank":"MB","account":"0123"}}
export const DEFAULT_PREMIUM_OFFER = Object.freeze({
  currency: "VND",
  plans: [
    { id: "month", name: "1 tháng", days: PLAN_DAYS.month, price: null },
    { id: "year", name: "1 năm", days: PLAN_DAYS.year, price: null },
    { id: "lifetime", name: "Trọn đời", days: null, price: null }
  ],
  payment: {
    method: "Chuyển khoản ngân hàng",
    bank: "",
    account: "",
    holder: "",
    note_template: "POEVH {email} {plan}",
    contact: ""
  },
  steps: [
    "Đăng nhập poeviethoa.net và mở trang Premium.",
    "Chuyển khoản theo gói đã chọn, ghi đúng nội dung chuyển khoản.",
    "Admin kích hoạt gói trong vòng 24 giờ; trang Premium sẽ hiện gói đang dùng.",
    "Bấm \"Tạo key\" trên trang Premium, dán key vào ứng dụng POEVH."
  ]
});

const mergePlans = (defaults, overrides) => {
  if (!Array.isArray(overrides)) return defaults;
  const merged = defaults.map((plan) => ({ ...plan, ...(overrides.find((item) => item?.id === plan.id) || {}) }));
  for (const item of overrides) {
    if (item?.id && !merged.some((plan) => plan.id === item.id)) merged.push({ name: item.id, days: null, price: null, ...item });
  }
  return merged;
};

export const premiumOffer = (env = process.env) => {
  let overrides = {};
  const raw = String(env.PREMIUM_OFFER_JSON || "").trim();
  if (raw) {
    try {
      overrides = JSON.parse(raw) || {};
    } catch {
      throw new Error("PREMIUM_OFFER_JSON is not valid JSON");
    }
  }
  const appUrl = String(env.APP_URL || "").trim().replace(/\/+$/, "");
  return {
    currency: overrides.currency || DEFAULT_PREMIUM_OFFER.currency,
    plans: mergePlans(DEFAULT_PREMIUM_OFFER.plans, overrides.plans),
    payment: { ...DEFAULT_PREMIUM_OFFER.payment, ...(overrides.payment || {}) },
    steps: Array.isArray(overrides.steps) && overrides.steps.length ? overrides.steps : [...DEFAULT_PREMIUM_OFFER.steps],
    page_url: appUrl ? `${appUrl}/premium` : "/premium"
  };
};

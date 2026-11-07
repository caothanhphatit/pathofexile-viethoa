import {
  createPremiumSigner,
  grantPremium,
  issueKey,
  premiumStatus,
  releaseDevice,
  revokeSubscription,
  verifyKey
} from "../services/premium-service.mjs";
import { requireAdmin } from "./admin.mjs";

const requireDb = (app) => {
  if (!app.db) {
    const error = new Error("Database is not configured");
    error.statusCode = 503;
    throw error;
  }
  return app.db;
};

const sendError = (reply, error) => {
  if (!error?.statusCode || error.statusCode >= 500 && !error.code) throw error;
  return reply.status(error.statusCode).send({ ok: false, error: error.message, code: error.code || null });
};

const findUser = async (db, { userId, email }) => {
  const { rows } = userId
    ? await db.query("select id, email, display_name from users where id = $1", [String(userId)])
    : await db.query("select id, email, display_name from users where lower(email) = lower($1)", [String(email || "")]);
  if (!rows[0]) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "user_not_found" });
  return rows[0];
};

export const premiumRoutes = async (app, options = {}) => {
  // Built once; null when PREMIUM_SIGNING_KEY is not set (verify then answers 503).
  const signer = options.premiumSigner !== undefined ? options.premiumSigner : createPremiumSigner();

  // ── Signed-in user ──────────────────────────────────────────────────────

  app.get("/api/premium/me", async (request, reply) => {
    const db = requireDb(app);
    const user = await app.auth.requireUser(db, request);
    try {
      return { ok: true, data: await premiumStatus(db, user.id) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Creates a new key (the old one stops working). The key is only ever in this response.
  app.post("/api/premium/key", async (request, reply) => {
    const db = requireDb(app);
    const user = await app.auth.requireUser(db, request);
    try {
      const { key } = await issueKey(db, user.id);
      reply.header("cache-control", "no-store");
      return { ok: true, data: { key } };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/premium/device/reset", async (request, reply) => {
    const db = requireDb(app);
    const user = await app.auth.requireUser(db, request);
    try {
      await releaseDevice(db, user.id);
      return { ok: true, data: await premiumStatus(db, user.id) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ── Client apps ─────────────────────────────────────────────────────────

  app.get("/api/premium/public-key", async (request, reply) => {
    if (!signer) return reply.status(503).send({ ok: false, error: "Licence signing is not configured", code: "signing_unavailable" });
    reply.header("cache-control", "public, max-age=3600");
    return { ok: true, data: { algorithm: "Ed25519", publicKeyPem: signer.publicKeyPem } };
  });

  // Tight per-IP limit: this endpoint is public and takes guessable input.
  app.post("/api/premium/verify", {
    bodyLimit: 4 * 1024,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const db = requireDb(app);
    const body = request.body || {};
    try {
      const { token, payload } = await verifyKey(db, signer, {
        key: body.key,
        deviceId: body.device_id,
        deviceLabel: body.device_label,
        ip: request.ip
      });
      reply.header("cache-control", "no-store");
      return {
        ok: true,
        data: {
          token,
          plan: payload.plan,
          premium_until: payload.premium_until,
          token_expires_at: new Date(payload.exp * 1000).toISOString()
        }
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ── Admin (ADMIN_API_TOKEN) ─────────────────────────────────────────────

  app.get("/api/admin/premium/user", async (request, reply) => {
    requireAdmin(request);
    const db = requireDb(app);
    try {
      const user = await findUser(db, { userId: request.query.user_id, email: request.query.email });
      const { rows: subscriptions } = await db.query(`
        select id, plan, starts_at, expires_at, status, source, note, created_at, revoked_at
        from premium_subscriptions where user_id = $1 order by created_at desc
      `, [user.id]);
      return { ok: true, data: { user, status: await premiumStatus(db, user.id), subscriptions } };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/admin/premium/grant", async (request, reply) => {
    requireAdmin(request);
    const db = requireDb(app);
    const body = request.body || {};
    try {
      const user = await findUser(db, { userId: body.user_id, email: body.email });
      const subscription = await grantPremium(db, {
        userId: user.id,
        plan: body.plan,
        days: body.days,
        note: body.note,
        source: body.source || "admin"
      });
      return { ok: true, data: { user, subscription, status: await premiumStatus(db, user.id) } };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/admin/premium/revoke", async (request, reply) => {
    requireAdmin(request);
    const db = requireDb(app);
    try {
      await revokeSubscription(db, String(request.body?.subscription_id || ""));
      return { ok: true };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Support action: frees the device right away, ignoring the user's 30-day limit.
  app.post("/api/admin/premium/release-device", async (request, reply) => {
    requireAdmin(request);
    const db = requireDb(app);
    try {
      const user = await findUser(db, { userId: request.body?.user_id, email: request.body?.email });
      await releaseDevice(db, user.id, { force: true });
      return { ok: true, data: await premiumStatus(db, user.id) };
    } catch (error) {
      return sendError(reply, error);
    }
  });
};

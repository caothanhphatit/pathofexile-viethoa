import {
  createIntent,
  donateConfig,
  intentStatus,
  recordPayment,
  supporters,
  userSupport,
  verifyDonateWebhook
} from "../services/donate-service.mjs";

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

export const donateRoutes = async (app, options = {}) => {
  const env = options.env || process.env;

  // Receiving account for the QR (public on the QR itself) and whether codes can be created.
  app.get("/api/donate/config", async () => ({
    ok: true,
    data: { ...donateConfig(env), codes: Boolean(app.db) }
  }));

  app.get("/api/donate/supporters", async () => {
    if (!app.db) return { ok: true, data: { total: 0, donations: 0, recent: [], top: [] } };
    return { ok: true, data: await supporters(app.db) };
  });

  // The signed-in visitor's own total and tier (for the badge next to their name).
  app.get("/api/donate/me", async (request) => {
    const db = requireDb(app);
    const user = await app.auth.requireUser(db, request);
    return { ok: true, data: await userSupport(db, user.id) };
  });

  app.post("/api/donate/intents", {
    bodyLimit: 4 * 1024,
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } }
  }, async (request, reply) => {
    const db = requireDb(app);
    if (!donateConfig(env).enabled) {
      return reply.status(503).send({ ok: false, error: "Donations are not configured", code: "not_configured" });
    }
    const session = await app.auth.sessionFromRequest(db, request);
    const body = request.body && typeof request.body === "object" ? request.body : {};
    try {
      const intent = await createIntent(db, {
        user: session.authenticated ? session.user : null,
        displayName: body.displayName,
        message: body.message,
        amount: body.amount,
        hideAmount: body.hideAmount === true
      });
      reply.header("cache-control", "no-store");
      return { ok: true, data: intent };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/donate/intents/:code", async (request, reply) => {
    const db = requireDb(app);
    const intent = await intentStatus(db, request.params.code);
    if (!intent) return reply.status(404).send({ ok: false, error: "Not found" });
    reply.header("cache-control", "no-store");
    return { ok: true, data: intent };
  });

  // Called by SePay (or fostaPay), never by a browser. Its own scope keeps the raw body,
  // which the signature is computed over.
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
      request.rawBody = body;
      try {
        done(null, body ? JSON.parse(body) : {});
      } catch (error) {
        error.statusCode = 400;
        done(error);
      }
    });

    scope.post("/api/donate/webhook", {
      bodyLimit: 16 * 1024,
      config: { rateLimit: false }
    }, async (request, reply) => {
      const checked = verifyDonateWebhook({
        secret: env.DONATE_WEBHOOK_SECRET || "",
        headers: request.headers,
        rawBody: request.rawBody || ""
      });
      if (!checked.ok) return reply.status(checked.statusCode).send({ success: false, ok: false, error: checked.error });
      const db = requireDb(app);
      const result = await recordPayment(db, request.body && typeof request.body === "object" ? request.body : {}, {
        accountNo: donateConfig(env).accountNo
      });
      if (result !== "ignored") request.log.info({ result, paymentId: request.body?.id }, "donation webhook");
      // SePay retries until it gets 200 with { success: true }; fostaPay reads ok/result.
      return { success: true, ok: true, result };
    });
  });
};

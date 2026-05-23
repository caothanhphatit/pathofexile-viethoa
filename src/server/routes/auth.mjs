const requireDb = (app) => {
  if (!app.db) {
    const error = new Error("Database is not configured");
    error.statusCode = 503;
    throw error;
  }
  return app.db;
};

const googleProfileToAuthProfile = (profile) => ({
  provider: "google",
  providerUserId: profile.sub,
  email: profile.email || "",
  displayName: profile.name || profile.email || profile.sub,
  avatarUrl: profile.picture || "",
  raw: profile
});

export const authRoutes = async (app) => {
  app.get("/api/auth/config", async () => ({
    ok: true,
    data: {
      googleEnabled: app.auth.googleEnabled(),
      devLoginEnabled: app.auth.devLoginEnabled()
    }
  }));

  app.get("/api/auth/session", async (request) => ({
    ok: true,
    data: await app.auth.sessionFromRequest(app.db, request)
  }));

  app.get("/api/auth/google/start", async (request, reply) => {
    if (!app.auth.googleEnabled()) {
      return reply.status(503).send({ ok: false, error: "Google login is not configured" });
    }

    const statePayload = app.auth.createGoogleState(request.query.returnTo);
    app.auth.setGoogleStateCookie(reply, statePayload);
    return reply.redirect(app.auth.googleAuthorizationUrl(statePayload));
  });

  app.get("/api/auth/google/callback", async (request, reply) => {
    if (request.query.error) {
      return reply.redirect(`${app.auth.appUrl}/leveling?auth=cancelled`);
    }
    const code = String(request.query.code || "");
    const state = String(request.query.state || "");
    if (!code || !state) {
      return reply.status(400).send({ ok: false, error: "Missing OAuth code or state" });
    }

    const statePayload = app.auth.verifyGoogleState(request, state);
    const token = await app.auth.exchangeGoogleCode(code, statePayload.verifier);
    const googleProfile = await app.auth.fetchGoogleProfile(token.access_token);
    const user = await app.auth.upsertAuthUser(requireDb(app), googleProfileToAuthProfile(googleProfile));
    const session = await app.auth.createSession(app.db, user.id, request);
    app.auth.setSessionCookie(reply, session);
    app.auth.clearGoogleStateCookie(reply);
    return reply.redirect(`${app.auth.appUrl}${statePayload.returnTo}`);
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await app.auth.destroySession(app.db, request);
    app.auth.clearSessionCookie(reply);
    return { ok: true };
  });

  app.post("/api/auth/dev-login", async (request, reply) => {
    if (!app.auth.devLoginEnabled()) {
      return reply.status(404).send({ ok: false, error: "Not found" });
    }

    const user = await app.auth.upsertDevUser(requireDb(app));
    const session = await app.auth.createSession(app.db, user.id, request);
    app.auth.setSessionCookie(reply, session);
    return {
      ok: true,
      data: await app.auth.sessionFromRequest(app.db, {
        ...request,
        headers: {
          ...request.headers,
          cookie: `poe2_session=${session.token}`
        }
      })
    };
  });
};

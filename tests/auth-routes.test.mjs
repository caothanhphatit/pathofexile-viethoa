import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/server/app.mjs";

test("auth routes expose login config and anonymous session state", async () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;

  const app = await buildApp({
    db: null,
    logger: false,
    sessionSecret: "test-session-secret"
  });

  try {
    const config = await app.inject({ method: "GET", url: "/api/auth/config" });
    assert.equal(config.statusCode, 200);
    assert.deepEqual(JSON.parse(config.body), {
      ok: true,
      data: {
        googleEnabled: false,
        devLoginEnabled: true
      }
    });

    const session = await app.inject({ method: "GET", url: "/api/auth/session" });
    assert.equal(session.statusCode, 200);
    assert.deepEqual(JSON.parse(session.body), {
      ok: true,
      data: {
        authenticated: false,
        user: null,
        providers: []
      }
    });
  } finally {
    await app.close();
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
  }
});

test("Google start route reports a clear error when OAuth is not configured", async () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;

  const app = await buildApp({
    db: null,
    logger: false,
    sessionSecret: "test-session-secret"
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google/start?returnTo=/leveling.html"
    });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), {
      ok: false,
      error: "Google login is not configured"
    });
  } finally {
    await app.close();
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
  }
});

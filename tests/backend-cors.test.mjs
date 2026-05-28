import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/server/app.mjs";

test("backend CORS allows local static dev origins for game log tooling", async () => {
  const previousOrigins = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "http://127.0.0.1:4173";
  const app = await buildApp({ db: null, logger: false, sessionSecret: "test-session-secret" });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/leveling/log/status",
      headers: { origin: "http://127.0.0.1:8022" }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], "http://127.0.0.1:8022");
  } finally {
    if (previousOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previousOrigins;
    await app.close();
  }
});

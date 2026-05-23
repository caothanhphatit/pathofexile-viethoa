import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const hardcodedRemoteDatabaseUrl = /postgres(?:ql)?:\/\/[^:@\s]+:[^@\s]+@(?!localhost\b|127\.0\.0\.1\b|\[::1\])[^\s"'`]+/i;

test("Fastify backend exposes health, public API routes, and token-protected admin routes", async () => {
  const [app, publicRoutes, commentsRoutes, adminRoutes, index] = await Promise.all([
    readText("src/server/app.mjs"),
    readText("src/server/routes/public.mjs"),
    readText("src/server/routes/translation-comments.mjs"),
    readText("src/server/routes/admin.mjs"),
    readText("src/server/index.mjs")
  ]);

  assert.match(app, /Fastify/);
  assert.match(app, /\/health/);
  assert.match(app, /publicRoutes/);
  assert.match(app, /adminRoutes/);
  assert.match(app, /Poe2LogWatcher/);
  assert.match(publicRoutes, /\/api\/items/);
  assert.match(publicRoutes, /\/api\/dictionary/);
  assert.match(publicRoutes, /\/api\/skill-gems/);
  assert.match(publicRoutes, /\/api\/currency/);
  assert.match(publicRoutes, /\/api\/leveling\/log\/status/);
  assert.match(publicRoutes, /\/api\/leveling\/log\/events/);
  assert.match(app, /translationCommentRoutes/);
  assert.match(commentsRoutes, /\/api\/translation-comments/);
  assert.match(adminRoutes, /ADMIN_API_TOKEN/);
  assert.match(adminRoutes, /\/api\/admin\/crawl\/items/);
  assert.match(adminRoutes, /\/api\/admin\/export\/items/);
  assert.match(index, /buildApp/);
  assert.doesNotMatch(`${app}\n${publicRoutes}\n${commentsRoutes}\n${adminRoutes}\n${index}`, hardcodedRemoteDatabaseUrl);
});

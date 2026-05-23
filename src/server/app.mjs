import compress from "@fastify/compress";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";

import { closePool, createPool, databaseUrlFromEnv } from "../db/pool.mjs";
import { adminRoutes } from "./routes/admin.mjs";
import { authRoutes } from "./routes/auth.mjs";
import { levelingAccountRoutes } from "./routes/leveling-account.mjs";
import { publicRoutes } from "./routes/public.mjs";
import { translationCommentRoutes } from "./routes/translation-comments.mjs";
import { createAuthService } from "./services/auth-service.mjs";
import { Poe2LogWatcher } from "./services/poe2-log-watcher.mjs";

export const buildApp = async (options = {}) => {
  const app = Fastify({
    logger: options.logger ?? {
      level: process.env.LOG_LEVEL || "info"
    }
  });

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  await app.register(helmet);
  await app.register(cors, {
    credentials: true,
    origin: allowedOrigins.length ? allowedOrigins : true
  });
  await app.register(compress);

  const db = options.db || (databaseUrlFromEnv() ? createPool() : null);
  const auth = createAuthService({
    env: process.env,
    sessionSecret: options.sessionSecret,
    appUrl: options.appUrl,
    apiUrl: options.apiUrl
  });
  const levelingLogWatcher = options.levelingLogWatcher || new Poe2LogWatcher({
    path: process.env.POE2_CLIENT_LOG_PATH,
    pollIntervalMs: Number(process.env.POE2_LOG_POLL_MS || 1000)
  });
  app.decorate("db", db);
  app.decorate("auth", auth);
  app.decorate("levelingLogWatcher", levelingLogWatcher);

  app.get("/health", async () => ({
    ok: true,
    database: Boolean(app.db),
    service: "poe2-backend"
  }));

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, "request failed");
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.status(statusCode).send({
      ok: false,
      error: statusCode === 500 && process.env.NODE_ENV === "production" ? "Internal server error" : error.message
    });
  });

  await app.register(authRoutes);
  await app.register(levelingAccountRoutes);
  await app.register(translationCommentRoutes);
  await app.register(publicRoutes);
  await app.register(adminRoutes);

  app.addHook("onClose", async () => {
    levelingLogWatcher.stop();
    await closePool(db);
  });

  return app;
};

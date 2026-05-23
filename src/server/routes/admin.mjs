const requireAdmin = (request) => {
  const configured = process.env.ADMIN_API_TOKEN;
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!configured || provided !== configured) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
};

export const adminRoutes = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (request.url.startsWith("/api/admin/")) requireAdmin(request);
  });

  app.post("/api/admin/crawl/items", async () => {
    if (!app.db) {
      const error = new Error("Database is not configured");
      error.statusCode = 503;
      throw error;
    }
    const { crawlItemsToPostgres } = await import("../../../scripts/items/runtime.mjs");
    const result = await crawlItemsToPostgres({ pool: app.db });
    return { ok: true, data: result };
  });

  app.post("/api/admin/export/items", async () => {
    if (!app.db) {
      const error = new Error("Database is not configured");
      error.statusCode = 503;
      throw error;
    }
    const { writeItemsExport } = await import("../../../scripts/items/runtime.mjs");
    const result = await writeItemsExport(app.db);
    return { ok: true, data: result };
  });

  app.post("/api/admin/export/all", async () => ({
    ok: false,
    error: "Use CLI export:all until all domains are migrated to Postgres repositories"
  }));
};

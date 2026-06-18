const requireAdmin = (request) => {
  const configured = process.env.ADMIN_API_TOKEN;
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!configured || provided !== configured) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
};

// Mirrors the requireDb helper used in public.mjs/auth.mjs so the
// "Database is not configured" guard lives in one place per file instead
// of being copy-pasted into every admin route. Returns the live pool.
const requireDb = (app) => {
  if (!app.db) {
    const error = new Error("Database is not configured");
    error.statusCode = 503;
    throw error;
  }
  return app.db;
};

export const adminRoutes = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (request.url.startsWith("/api/admin/")) requireAdmin(request);
  });

  app.post("/api/admin/crawl/items", async () => {
    const db = requireDb(app);
    const { crawlItemsToPostgres } = await import("../../../scripts/items/runtime.mjs");
    const result = await crawlItemsToPostgres({ pool: db });
    return { ok: true, data: result };
  });

  app.post("/api/admin/export/items", async () => {
    const db = requireDb(app);
    const { writeItemsExport } = await import("../../../scripts/items/runtime.mjs");
    const result = await writeItemsExport(db);
    return { ok: true, data: result };
  });

  app.post("/api/admin/crawl/passive-tree", async () => {
    const db = requireDb(app);
    const {
      crawlPassiveTreeData,
      upsertPassiveTreePostgres,
      writePassiveTreeExportPostgres
    } = await import("../../../scripts/passive-tree/runtime.mjs");
    const tree = await crawlPassiveTreeData();
    const summary = await upsertPassiveTreePostgres(db, tree, {
      sourceUrl: tree.source_url,
      sourceRef: tree.source_ref
    });
    const exportData = await writePassiveTreeExportPostgres(db);
    return { ok: true, data: { summary, total: exportData.total, version: exportData.version } };
  });

  app.post("/api/admin/export/passive-tree", async () => {
    const db = requireDb(app);
    const { writePassiveTreeExportPostgres } = await import("../../../scripts/passive-tree/runtime.mjs");
    const result = await writePassiveTreeExportPostgres(db);
    return { ok: true, data: result };
  });

  app.post("/api/admin/export/all", async () => ({
    ok: false,
    error: "Use CLI export:all until all domains are migrated to Postgres repositories"
  }));
};

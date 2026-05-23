const requireDb = (app) => {
  if (!app.db) {
    const error = new Error("Database is not configured");
    error.statusCode = 503;
    throw error;
  }
  return app.db;
};

const paging = (query) => ({
  limit: Math.min(Number(query.limit || 60), 200),
  offset: Math.max(Number(query.offset || 0), 0)
});

export const publicRoutes = async (app) => {
  app.get("/api/leveling/log/status", async () => ({
    ok: true,
    data: app.levelingLogWatcher.status()
  }));

  app.post("/api/leveling/log/config", async (request) => {
    const filePath = request.body?.path || "";
    const status = await app.levelingLogWatcher.configure(filePath);
    return { ok: true, data: status };
  });

  app.get("/api/leveling/log/events", async (request, reply) => {
    const send = (event, data) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const onStatus = (status) => send("status", status);
    const onZone = (status) => send("zone", status);
    const onLogEvent = (event, status) => {
      send("log-event", { event, status });
      send("status", status);
    };

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });

    app.levelingLogWatcher.on("status", onStatus);
    app.levelingLogWatcher.on("zone", onZone);
    app.levelingLogWatcher.on("event", onLogEvent);
    send("status", app.levelingLogWatcher.status());

    request.raw.on("close", () => {
      app.levelingLogWatcher.off("status", onStatus);
      app.levelingLogWatcher.off("zone", onZone);
      app.levelingLogWatcher.off("event", onLogEvent);
    });
  });

  app.get("/api/dictionary", async (request) => {
    const db = requireDb(app);
    const { limit, offset } = paging(request.query);
    const q = String(request.query.q || "").trim();
    const category = String(request.query.category || "").trim();
    const params = [];
    const where = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(term ilike $${params.length} or meaning ilike $${params.length})`);
    }
    if (category) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    params.push(limit, offset);
    const sql = `
      select term, keyword, category, meaning, variants_json, examples_json, source_url, hover_url
      from dictionary_terms
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by term
      limit $${params.length - 1} offset $${params.length}
    `;
    const { rows } = await db.query(sql, params);
    return { ok: true, data: rows };
  });

  app.get("/api/items/menus", async () => {
    const db = requireDb(app);
    const { rows } = await db.query(`
      select key, label, group_label, source_url
      from item_menus
      where status = 'active'
      order by group_label, sort_order, label
    `);
    return { ok: true, data: rows };
  });

  app.get("/api/items", async (request) => {
    const db = requireDb(app);
    const { limit, offset } = paging(request.query);
    const q = String(request.query.q || "").trim();
    const menu = String(request.query.menu || "").trim();
    const status = String(request.query.status || "active").trim();
    const params = [status];
    const where = ["status = $1"];
    if (menu) {
      params.push(menu);
      where.push(`menu_key = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        name ilike $${params.length}
        or exists (
          select 1
          from content_strings cs
          left join content_translations ct on ct.string_id = cs.id
          where cs.entity_type = 'item'
            and cs.entity_id = items.slug
            and (cs.source_text ilike $${params.length} or ct.translated_text ilike $${params.length})
        )
      )`);
    }
    params.push(limit, offset);
    const { rows } = await db.query(`
      select slug, menu_key, menu_label, group_label, name, source_url, icon_url, properties_json,
        requirements_json, mods_json, tooltip_refs_json, updated_at
      from items
      where ${where.join(" and ")}
      order by group_label, menu_label, name
      limit $${params.length - 1} offset $${params.length}
    `, params);
    return { ok: true, data: rows };
  });

  app.get("/api/items/:slug", async (request, reply) => {
    const db = requireDb(app);
    const { rows } = await db.query("select * from items where slug = $1", [request.params.slug]);
    if (!rows[0]) return reply.status(404).send({ ok: false, error: "Item not found" });
    return { ok: true, data: rows[0] };
  });

  app.get("/api/skill-gems", async (request) => {
    const db = requireDb(app);
    const { limit, offset } = paging(request.query);
    const q = String(request.query.q || "").trim();
    const params = [];
    const where = ["g.status = 'active'"];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        g.name ilike $${params.length}
        or exists (
          select 1
          from content_strings cs
          left join content_translations ct on ct.string_id = cs.id
          where cs.entity_type = 'skill_gem'
            and cs.entity_id = g.slug
            and (cs.source_text ilike $${params.length} or ct.translated_text ilike $${params.length})
        )
      )`);
    }
    params.push(limit, offset);
    const { rows } = await db.query(`
      select g.slug, g.name, g.tier, g.color, g.source_url, g.icon_url, g.tags_json
      from skill_gems g
      where ${where.join(" and ")}
      order by coalesce(g.tier, 999), g.name
      limit $${params.length - 1} offset $${params.length}
    `, params);
    return { ok: true, data: rows };
  });

  app.get("/api/currency", async (request) => {
    const db = requireDb(app);
    const { limit, offset } = paging(request.query);
    const subtype = String(request.query.subtype || "").trim();
    const params = [];
    const where = ["status = 'active'"];
    if (subtype) {
      params.push(subtype);
      where.push(`subtype = $${params.length}`);
    }
    params.push(limit, offset);
    const { rows } = await db.query(`
      select slug, name, category, category_label, subtype, subtype_label, source_url, icon_url,
        stack_size, description_en, properties_json, mods_json
      from currency_items
      where ${where.join(" and ")}
      order by category_label, subtype_label, name
      limit $${params.length - 1} offset $${params.length}
    `, params);
    return { ok: true, data: rows };
  });
};

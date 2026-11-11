import { createHash, randomBytes } from "node:crypto";

import { requireLocalRequest } from "../local-request.mjs";
import { buildPobXml } from "../pob-build-xml.mjs";
import { pobRunnerFromEnv } from "../pob-runner.mjs";
import { calculationRowItem, editedItemErrors, itemErrorSummary, projectRowItem } from "../item-validation.mjs";

const newSharedBuildId = () => randomBytes(9).toString("base64url");
const hashEditToken = (token) => createHash("sha256").update(String(token)).digest("hex");

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

const parsePoe2dbImageUrl = (value = "") => {
  const raw = String(value || "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    const error = new Error("Invalid image URL");
    error.statusCode = 400;
    throw error;
  }
  if (url.protocol !== "https:" || url.hostname !== "cdn.poe2db.tw" || !url.pathname.startsWith("/image/")) {
    const error = new Error("Image URL is not allowed");
    error.statusCode = 400;
    throw error;
  }
  return url;
};

const imageContentTypeFromPath = (pathname = "") => {
  if (/\.webp$/i.test(pathname)) return "image/webp";
  if (/\.png$/i.test(pathname)) return "image/png";
  if (/\.jpe?g$/i.test(pathname)) return "image/jpeg";
  if (/\.gif$/i.test(pathname)) return "image/gif";
  if (/\.svg$/i.test(pathname)) return "image/svg+xml";
  return "";
};

export const publicRoutes = async (app, options = {}) => {
  const initDb = app.db;
  if (initDb) {
    try {
      await initDb.query(`
        CREATE TABLE IF NOT EXISTS shared_builds (
          id VARCHAR(255) PRIMARY KEY,
          project_json JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // Only the holder of a build's edit token may overwrite it. Rows saved before
      // this column existed have no token and are therefore read-only.
      await initDb.query("ALTER TABLE shared_builds ADD COLUMN IF NOT EXISTS edit_token_hash TEXT");
    } catch (err) {
      app.log.error(err, "Failed to create shared_builds table");
    }
  }

  app.get("/api/poe2db-image", async (request, reply) => {
    const target = parsePoe2dbImageUrl(request.query?.url);
    const upstreamFetch = app.poe2dbImageFetch || globalThis.fetch;
    if (typeof upstreamFetch !== "function") {
      const error = new Error("Image proxy fetch is not available");
      error.statusCode = 503;
      throw error;
    }

    const upstream = await upstreamFetch(target.href, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        referer: "https://poe2db.tw/us/Items",
        "user-agent": "Mozilla/5.0 POE2 Viet Hoa image proxy"
      }
    });
    if (!upstream.ok) {
      return reply.status(upstream.status === 404 ? 404 : 502).send({ ok: false, error: "Image fetch failed" });
    }

    const contentType = upstream.headers?.get?.("content-type") || imageContentTypeFromPath(target.pathname);
    if (!/^image\//i.test(contentType)) {
      return reply.status(502).send({ ok: false, error: "Upstream did not return an image" });
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    reply.header("cache-control", "public, max-age=604800, immutable");
    reply.header("x-content-type-options", "nosniff");
    return reply.type(contentType).send(body);
  });

  app.get("/api/leveling/log/status", async (request) => {
    requireLocalRequest(request);
    return { ok: true, data: app.levelingLogWatcher.status() };
  });

  app.post("/api/leveling/log/config", async (request) => {
    requireLocalRequest(request);
    const filePath = request.body?.path || "";
    const status = await app.levelingLogWatcher.configure(filePath);
    return { ok: true, data: status };
  });

  app.get("/api/leveling/log/events", async (request, reply) => {
    requireLocalRequest(request);
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

  app.get("/api/passive-tree", async (request) => {
    const db = requireDb(app);
    const { limit, offset } = paging(request.query);
    const q = String(request.query.q || "").trim();
    const type = String(request.query.type || "").trim();
    const ascendancy = String(request.query.ascendancy || "").trim();
    const params = [];
    const where = ["status = 'active'"];
    if (type) {
      params.push(type);
      where.push(`type = $${params.length}`);
    }
    if (ascendancy) {
      params.push(ascendancy);
      where.push(`ascendancy_name = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        name ilike $${params.length}
        or exists (
          select 1
          from content_strings cs
          left join content_translations ct on ct.string_id = cs.id
          where cs.entity_type = 'passive_tree_node'
            and cs.entity_id = passive_tree_nodes.node_id
            and (cs.source_text ilike $${params.length} or ct.translated_text ilike $${params.length})
        )
      )`);
    }
    params.push(limit, offset);
    const { rows } = await db.query(`
      select node_id, tree_version, name, type, group_id, orbit, orbit_index, x, y,
        icon, ascendancy_name, stats_json, recipe_json, updated_at
      from passive_tree_nodes
      where ${where.join(" and ")}
      order by type, name, node_id
      limit $${params.length - 1} offset $${params.length}
    `, params);
    return { ok: true, data: rows };
  });

  // Saving a shared build. The server picks the id and hands back a secret edit token;
  // updating an existing build requires that token (header x-build-edit-token), so
  // knowing a build's share link is not enough to overwrite it.
  app.post("/api/builds", { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const db = requireDb(app);
    const project = request.body;
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      return reply.status(400).send({ ok: false, error: "Missing project data" });
    }
    // Items edited in the planner must follow the game's rules (src/shared/item-mods.mjs).
    const itemProblems = [
      ...editedItemErrors(project.inventory, projectRowItem),
      ...editedItemErrors(project.stash, projectRowItem)
    ];
    if (itemProblems.length) {
      return reply.status(400).send({ ok: false, error: itemErrorSummary(itemProblems), item_errors: itemProblems });
    }
    const editToken = String(request.headers["x-build-edit-token"] || "");
    const requestedId = typeof project.id === "string" ? project.id.trim() : "";
    const isUpdate = Boolean(requestedId && editToken);
    const id = isUpdate ? requestedId : newSharedBuildId();
    const strippedProject = {
      id,
      name: project.name,
      author: project.author,
      description: project.description,
      treeSnapshots: project.treeSnapshots,
      activeTreeId: project.activeTreeId,
      inventory: project.inventory,
      stash: project.stash,
      skills: project.skills,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    };

    if (isUpdate) {
      const result = await db.query(`
        UPDATE shared_builds SET project_json = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND edit_token_hash IS NOT NULL AND edit_token_hash = $3
      `, [id, JSON.stringify(strippedProject), hashEditToken(editToken)]);
      if (!result.rowCount) {
        return reply.status(403).send({ ok: false, error: "Edit token does not match this build" });
      }
      return { ok: true, data: { id } };
    }

    const newToken = randomBytes(24).toString("base64url");
    await db.query(`
      INSERT INTO shared_builds (id, project_json, edit_token_hash, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    `, [id, JSON.stringify(strippedProject), hashEditToken(newToken)]);
    return reply.status(201).send({ ok: true, data: { id, editToken: newToken } });
  });

  app.get("/api/builds/:id", async (request, reply) => {
    const db = requireDb(app);
    const { rows } = await db.query("SELECT project_json FROM shared_builds WHERE id = $1", [request.params.id]);
    if (!rows[0]) {
      return reply.status(404).send({ ok: false, error: "Build not found" });
    }
    return { ok: true, data: rows[0].project_json };
  });

  const calculationCache = new Map();

  // XML building lives in ../pob-build-xml.mjs so tests and the parity check share it.
  const buildXml = buildPobXml;

  // Each calculation spawns a LuaJIT process. Bound how many run at once and
  // how long each may take so a burst of planner requests cannot pile up
  // dozens of interpreters or hang a worker on a pathological build.
  // Runs calculate.lua here (POB_CORE_DIR + POB_LUAJIT) or on another machine
  // (POB_REMOTE_URL), see ../pob-runner.mjs.
  const pobRunner = options.pobRunner || pobRunnerFromEnv();
  const CALCULATE_MAX_CONCURRENT = Number(process.env.POB_CALCULATE_MAX_CONCURRENT || 2);
  const CALCULATE_MAX_QUEUE = Number(process.env.POB_CALCULATE_MAX_QUEUE || 8);
  let calculationsRunning = 0;
  const calculationQueue = [];
  const acquireCalculationSlot = () => new Promise((resolve, reject) => {
    if (calculationsRunning < CALCULATE_MAX_CONCURRENT) {
      calculationsRunning += 1;
      resolve();
      return;
    }
    if (calculationQueue.length >= CALCULATE_MAX_QUEUE) {
      reject(Object.assign(new Error("Calculation service is busy, retry shortly"), { statusCode: 503 }));
      return;
    }
    calculationQueue.push(resolve);
  });
  const releaseCalculationSlot = () => {
    const next = calculationQueue.shift();
    if (next) {
      next();
    } else {
      calculationsRunning -= 1;
    }
  };

  app.post("/api/builds/calculate", { bodyLimit: 512 * 1024 }, async (request, reply) => {
    const buildData = request.body;
    if (!buildData || typeof buildData !== "object") {
      return reply.status(400).send({ ok: false, error: "Missing build data" });
    }
    const itemProblems = editedItemErrors(buildData.inventory_slots, calculationRowItem);
    if (itemProblems.length) {
      return reply.status(400).send({ ok: false, error: itemErrorSummary(itemProblems), item_errors: itemProblems });
    }
    app.log.info({
      className: buildData.className,
      ascendancy: buildData.ascendancy,
      level: buildData.level,
      activeWeaponSet: buildData.activeWeaponSet,
      hasOverrides: !!buildData.attribute_overrides,
      hasConfig: !!buildData.config,
      skillsCount: buildData.skills?.length,
      inventoryCount: buildData.inventory_slots?.length
    }, "build calculate request");

    const xmlContent = buildXml(buildData);
    const hash = createHash("sha256").update(xmlContent).digest("hex");
    if (calculationCache.has(hash)) {
      return { ok: true, data: calculationCache.get(hash) };
    }

    try {
      await acquireCalculationSlot();
    } catch (err) {
      reply.header("retry-after", "2");
      return reply.status(err.statusCode || 503).send({ ok: false, error: err.message });
    }

    try {
      const stats = await pobRunner.run(xmlContent);

      if (calculationCache.size > 500) {
        const firstKey = calculationCache.keys().next().value;
        calculationCache.delete(firstKey);
      }
      calculationCache.set(hash, stats);

      return { ok: true, data: stats };

    } catch (err) {
      app.log.error(err, "Failed to run PoB calculation");
      return reply.status(500).send({ ok: false, error: err.message || "Failed to calculate build stats" });
    } finally {
      releaseCalculationSlot();
    }
  });
};

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

export const publicRoutes = async (app) => {
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

  app.post("/api/builds", async (request, reply) => {
    const db = requireDb(app);
    const project = request.body;
    if (!project || !project.id) {
      return reply.status(400).send({ ok: false, error: "Missing project data" });
    }
    
    const strippedProject = {
      id: project.id,
      name: project.name,
      author: project.author,
      description: project.description,
      treeSnapshots: project.treeSnapshots,
      activeTreeId: project.activeTreeId,
      inventory: project.inventory,
      skills: project.skills,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    };

    await db.query(`
      INSERT INTO shared_builds (id, project_json, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET project_json = $2, updated_at = CURRENT_TIMESTAMP
    `, [project.id, JSON.stringify(strippedProject)]);

    return { ok: true };
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

  const escapeXml = (str) => {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  };

  const mapGemId = (skillId) => {
    if (skillId.startsWith("Metadata/")) {
      return skillId;
    }
    if (skillId.startsWith("Support")) {
      const name = skillId.replace(/^Support/, "");
      return `Metadata/Items/Gems/SupportGem${name}`;
    }
    return `Metadata/Items/Gems/SkillGem${skillId}`;
  };

  const buildXml = (build) => {
    const level = Number(build.level || 90);
    const className = build.className || "Witch";
    const ascendClassName = build.ascendancy || "None";
    const passives = Array.isArray(build.passives) ? build.passives : [];

    const inventory = Array.isArray(build.inventory_slots) ? build.inventory_slots : [];
    const activeWeaponSet = Number(build.activeWeaponSet || 1);

    const items = [];
    const slots = [];
    const sockets = [];
    
    const mapSlotName = (slotId) => {
      const slotMap = {
        Weapon1: "Weapon 1",
        Weapon2: "Weapon 2",
        Helm1: "Helmet",
        BodyArmour1: "Body Armour",
        Gloves1: "Gloves",
        Boots1: "Boots",
        Amulet1: "Amulet",
        Ring1: "Ring 1",
        Ring2: "Ring 2",
        Belt1: "Belt",
        LifeFlask1: "Flask 1",
        ManaFlask1: "Flask 2",
        Charm1: "Charm 1",
        Charm2: "Charm 2",
        Charm3: "Charm 3",
        Trinket1: "Trinket"
      };
      return slotMap[slotId] || null;
    };

    let itemCounter = 1;
    for (const slot of inventory) {
      const slotId = slot.inventory_id;

      if (slotId.startsWith("PassiveJewel:")) {
        const nodeId = slotId.replace(/^PassiveJewel:/, "");
        if (nodeId && !isNaN(nodeId)) {
          const itemId = itemCounter++;
          items.push(`<Item id="${itemId}">\n${escapeXml(slot.raw_text || slot.note)}\n</Item>`);
          sockets.push(`<Socket nodeId="${nodeId}" itemId="${itemId}"/>`);
        }
        continue;
      }

      const slotName = mapSlotName(slotId);
      if (!slotName) continue;

      if (slot.raw_text) {
        const itemId = itemCounter++;
        items.push(`<Item id="${itemId}">\n${escapeXml(slot.raw_text)}\n</Item>`);
        const isActive = slotName.startsWith("Flask") || slotName.startsWith("Charm");
        const activeAttr = isActive ? ' active="true"' : '';
        slots.push(`<Slot name="${slotName}" itemId="${itemId}"${activeAttr}/>`);
      } else if (slot.item_name) {
        const rarity = slot.is_unique ? "Unique" : "Rare";
        const rawLines = [
          `Rarity: ${rarity}`,
          slot.item_name,
          ...(slot.note ? slot.note.split("\n").map(l => l.trim()).filter(Boolean) : [])
        ];
        const rawText = rawLines.join("\n");
        const itemId = itemCounter++;
        items.push(`<Item id="${itemId}">\n${escapeXml(rawText)}\n</Item>`);
        const isActive = slotName.startsWith("Flask") || slotName.startsWith("Charm");
        const activeAttr = isActive ? ' active="true"' : '';
        slots.push(`<Slot name="${slotName}" itemId="${itemId}"${activeAttr}/>`);
      }
    }

    const skills = Array.isArray(build.skills) ? build.skills : [];
    const skillElements = [];

    for (const group of skills) {
      if (!group || !group.skill_id) continue;
      
      const activeGemId = mapGemId(group.skill_id);
      const gems = [
        `<Gem enableGlobal2="false" level="${group.level || 20}" gemId="${activeGemId}" skillId="${group.skill_id}" quality="0" enabled="true"/>`
      ];

      if (Array.isArray(group.support)) {
        for (const support of group.support) {
          if (!support || !support.skill_id) continue;
          const supportGemId = mapGemId(support.skill_id);
          gems.push(`<Gem enableGlobal2="false" level="${support.level || 20}" gemId="${supportGemId}" skillId="${support.skill_id}" quality="0" enabled="true"/>`);
        }
      }

      skillElements.push(`
        <Skill mainActiveSkillCalcs="1" enabled="true" mainActiveSkill="1">
          ${gems.join("\n          ")}
        </Skill>
      `);
    }

    const mapClassId = (cls) => {
      const name = String(cls || "").toLowerCase();
      if (name.includes("witch")) return 1;
      if (name.includes("ranger")) return 2;
      if (name.includes("warrior")) return 6;
      if (name.includes("sorceress") || name.includes("sorcerer")) return 7;
      if (name.includes("huntress")) return 8;
      if (name.includes("mercenary")) return 9;
      if (name.includes("monk")) return 10;
      if (name.includes("druid")) return 11;
      return 1; // Default to Witch
    };

    const mapAscendClassId = (className, ascendancyName) => {
      const cls = String(className || "").toLowerCase();
      const asc = String(ascendancyName || "").toLowerCase();
      if (asc === "none" || !asc) return 0;
      
      if (cls.includes("witch")) {
        if (asc.includes("infernalist")) return 1;
        if (asc.includes("blood")) return 2;
        if (asc.includes("abyssal")) return 4;
        if (asc.includes("lich")) return 3;
      }
      if (cls.includes("ranger")) {
        if (asc.includes("deadeye")) return 1;
        if (asc.includes("pathfinder")) return 2;
      }
      if (cls.includes("warrior")) {
        if (asc.includes("titan")) return 1;
        if (asc.includes("warbringer")) return 2;
        if (asc.includes("smith")) return 3;
      }
      if (cls.includes("sorceress") || cls.includes("sorcerer")) {
        if (asc.includes("stormweaver")) return 1;
        if (asc.includes("chronomancer")) return 2;
        if (asc.includes("disciple")) return 3;
      }
      if (cls.includes("huntress")) {
        if (asc.includes("amazon")) return 1;
        if (asc.includes("spirit")) return 2;
        if (asc.includes("ritualist")) return 3;
      }
      if (cls.includes("mercenary")) {
        if (asc.includes("tactician")) return 1;
        if (asc.includes("witchhunter")) return 2;
        if (asc.includes("gemling")) return 3;
      }
      if (cls.includes("monk")) {
        if (asc.includes("martial")) return 1;
        if (asc.includes("invoker")) return 2;
        if (asc.includes("acolyte")) return 3;
      }
      if (cls.includes("druid")) {
        if (asc.includes("oracle")) return 1;
        if (asc.includes("shaman")) return 2;
      }
      return 0;
    };

    const mapAscendancyInternalId = (className, ascendancyName) => {
      const cls = String(className || "").toLowerCase();
      const asc = String(ascendancyName || "").toLowerCase();
      if (asc === "none" || !asc) return "nil";
      
      if (cls.includes("witch")) {
        if (asc.includes("infernalist")) return "Witch1";
        if (asc.includes("blood")) return "Witch2";
        if (asc.includes("abyssal")) return "Witch3b";
        if (asc.includes("lich")) return "Witch3";
      }
      if (cls.includes("ranger")) {
        if (asc.includes("deadeye")) return "Ranger1";
        if (asc.includes("pathfinder")) return "Ranger3";
      }
      if (cls.includes("warrior")) {
        if (asc.includes("titan")) return "Warrior1";
        if (asc.includes("warbringer")) return "Warrior2";
        if (asc.includes("smith")) return "Warrior3";
      }
      if (cls.includes("sorceress") || cls.includes("sorcerer")) {
        if (asc.includes("stormweaver")) return "Sorceress1";
        if (asc.includes("chronomancer")) return "Sorceress2";
        if (asc.includes("disciple")) return "Sorceress3";
      }
      if (cls.includes("huntress")) {
        if (asc.includes("amazon")) return "Huntress1";
        if (asc.includes("spirit")) return "Huntress2";
        if (asc.includes("ritualist")) return "Huntress3";
      }
      if (cls.includes("mercenary")) {
        if (asc.includes("tactician")) return "Mercenary1";
        if (asc.includes("witchhunter")) return "Mercenary2";
        if (asc.includes("gemling")) return "Mercenary3";
      }
      if (cls.includes("monk")) {
        if (asc.includes("martial")) return "Monk1";
        if (asc.includes("invoker")) return "Monk2";
        if (asc.includes("acolyte")) return "Monk3";
      }
      if (cls.includes("druid")) {
        if (asc.includes("oracle")) return "Druid1";
        if (asc.includes("shaman")) return "Druid2";
      }
      return "nil";
    };

    const cId = mapClassId(className);
    const ascId = mapAscendClassId(className, ascendClassName);
    const ascIntId = mapAscendancyInternalId(className, ascendClassName);

    const mainSocketGroup = build.main_socket_group || "1";
    const attrOverride = build.attribute_overrides;
    const attrOverrideBlock = attrOverride ? `
			<Overrides>
				<AttributeOverride dexNodes="${attrOverride.dexNodes || ""}" intNodes="${attrOverride.intNodes || ""}" strNodes="${attrOverride.strNodes || ""}"/>
			</Overrides>` : "";

    const configBlock = build.config || "";

    return `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
	<Build level="${level}" targetVersion="0_1" className="${className}" ascendClassName="${ascendClassName}" mainActiveSkill="1" viewMode="ITEMS" gentool="1" mainActiveSkillCalcs="1" mainSocketGroup="${mainSocketGroup}">
		<PlayerStat stat="Life" value="1"/>
	</Build>
	<Items>
		${items.join("\n\t\t")}
		<ItemSet useSecondWeaponSet="false" id="1">
			${slots.join("\n\t\t\t")}
		</ItemSet>
	</Items>
	<Skills>
		${skillElements.join("\n")}
	</Skills>
	<Tree activeSpec="1">
		<Spec treeVersion="0_5" nodes="${passives.join(',')}" classId="${cId}" classInternalId="${cId}" ascendClassId="${ascId}" ascendancyInternalId="${ascIntId}">
			<Nodes>${passives.join(',')}</Nodes>${attrOverrideBlock}
			<Sockets>
				${sockets.join("\n\t\t\t")}
			</Sockets>
		</Spec>
	</Tree>
	${configBlock}
</PathOfBuilding2>
`;
  };

  app.post("/api/builds/calculate", async (request, reply) => {
    const buildData = request.body;
    if (!buildData) {
      return reply.status(400).send({ ok: false, error: "Missing build data" });
    }
    console.log("CALCULATE REQUEST PAYLOAD:", JSON.stringify({
      className: buildData.className,
      ascendancy: buildData.ascendancy,
      level: buildData.level,
      activeWeaponSet: buildData.activeWeaponSet,
      hasOverrides: !!buildData.attribute_overrides,
      hasConfig: !!buildData.config,
      skillsCount: buildData.skills?.length,
      inventoryCount: buildData.inventory_slots?.length
    }));

    const { writeFileSync, unlinkSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const { execFile } = await import("child_process");
    const { createHash } = await import("crypto");

    const xmlContent = buildXml(buildData);
    const hash = createHash("md5").update(xmlContent).digest("hex");
    if (calculationCache.has(hash)) {
      return { ok: true, data: calculationCache.get(hash) };
    }

    const tempFileName = `pob_temp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.xml`;
    const tempFilePath = join(tmpdir(), tempFileName);

    try {
      writeFileSync(tempFilePath, xmlContent, "utf8");

      const stdout = await new Promise((resolve, reject) => {
        execFile("luajit", ["calculate.lua", tempFilePath], {
          cwd: "/root/pob-core/src"
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve(stdout);
          }
        });
      });

      const lines = String(stdout).split("\n");
      const jsonLine = lines.find(line => line.trim().startsWith("{") && line.trim().endsWith("}"));
      
      if (!jsonLine) {
        throw new Error("Invalid output from calculation engine");
      }

      const stats = JSON.parse(jsonLine);
      
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
      try {
        unlinkSync(tempFilePath);
      } catch {}
    }
  });
};

import crypto from "node:crypto";

const base64Url = (value) => Buffer.from(value)
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");

const newCharacterId = () => `char_${base64Url(crypto.randomBytes(18))}`;

const publicCharacter = (row) => ({
  id: row.id,
  name: row.name,
  className: row.class_name || "",
  level: row.level,
  source: row.source || "manual",
  logPath: row.log_path || "",
  logStartOffset: Number(row.log_start_offset || 0),
  lastSelectedAt: row.last_selected_at || null,
  createdAt: row.created_at || null,
  updatedAt: row.updated_at || null
});

const readProgress = async (db, characterId) => {
  if (!characterId) return {};
  const { rows } = await db.query(`
    select task_id, completed
    from leveling_character_progress
    where character_id = $1
  `, [characterId]);
  return Object.fromEntries(rows.map((row) => [row.task_id, Boolean(row.completed)]));
};

const readLevelingState = async (db, userId, preferredCharacterId = "") => {
  const charactersResult = await db.query(`
    select id, name, class_name, level, source, log_path, log_start_offset,
      last_selected_at, created_at, updated_at
    from leveling_characters
    where user_id = $1
    order by last_selected_at desc nulls last, updated_at desc
  `, [userId]);

  const characters = charactersResult.rows.map(publicCharacter);
  const activeCharacter = characters.find((character) => character.id === preferredCharacterId) || characters[0] || null;
  const progress = await readProgress(db, activeCharacter?.id);
  return { characters, activeCharacter, progress };
};

const parseLevel = (value) => {
  const level = Number(value);
  return Number.isFinite(level) && level > 0 ? Math.floor(level) : null;
};

const requireCharacterOwner = async (db, userId, characterId) => {
  const { rows } = await db.query(
    "select id from leveling_characters where id = $1 and user_id = $2",
    [characterId, userId]
  );
  if (!rows[0]) {
    const error = new Error("Character not found");
    error.statusCode = 404;
    throw error;
  }
};

export const levelingAccountRoutes = async (app) => {
  app.get("/api/leveling/me", async (request) => {
    const user = await app.auth.requireUser(app.db, request);
    return {
      ok: true,
      data: await readLevelingState(app.db, user.id, request.query.characterId)
    };
  });

  app.post("/api/leveling/characters", async (request) => {
    const user = await app.auth.requireUser(app.db, request);
    const name = String(request.body?.name || "").trim();
    if (!name) {
      const error = new Error("Character name is required");
      error.statusCode = 400;
      throw error;
    }

    const status = app.levelingLogWatcher.status();
    const id = newCharacterId();
    const className = String(request.body?.className || status.characterClass || "").trim();
    const level = parseLevel(request.body?.level ?? status.characterLevel);
    const source = String(request.body?.source || "manual").trim() || "manual";
    const logPath = String(request.body?.logPath ?? status.activePath ?? "");
    const requestedOffset = Number(request.body?.logStartOffset);
    const logStartOffset = Number.isFinite(requestedOffset) && requestedOffset >= 0
      ? Math.floor(requestedOffset)
      : Number(status.bytesRead || 0);

    const { rows } = await app.db.query(`
      insert into leveling_characters (
        id, user_id, name, class_name, level, source, log_path, log_start_offset, last_selected_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, now())
      on conflict (user_id, name) do update set
        class_name = excluded.class_name,
        level = coalesce(excluded.level, leveling_characters.level),
        source = excluded.source,
        log_path = excluded.log_path,
        log_start_offset = excluded.log_start_offset,
        last_selected_at = now(),
        updated_at = now()
      returning id, name, class_name, level, source, log_path, log_start_offset,
        last_selected_at, created_at, updated_at
    `, [id, user.id, name, className, level, source, logPath, logStartOffset]);

    const character = rows[0];
    await app.db.query(`
      insert into leveling_log_cursors (character_id, log_path, byte_offset, file_size)
      values ($1, $2, $3, $3)
      on conflict (character_id) do update set
        log_path = excluded.log_path,
        byte_offset = excluded.byte_offset,
        file_size = excluded.file_size,
        updated_at = now()
    `, [character.id, logPath, logStartOffset]);

    return {
      ok: true,
      data: await readLevelingState(app.db, user.id, character.id)
    };
  });

  app.post("/api/leveling/characters/:id/select", async (request) => {
    const user = await app.auth.requireUser(app.db, request);
    await requireCharacterOwner(app.db, user.id, request.params.id);
    await app.db.query(
      "update leveling_characters set last_selected_at = now(), updated_at = now() where id = $1 and user_id = $2",
      [request.params.id, user.id]
    );
    return {
      ok: true,
      data: await readLevelingState(app.db, user.id, request.params.id)
    };
  });

  app.put("/api/leveling/characters/:id/progress", async (request) => {
    const user = await app.auth.requireUser(app.db, request);
    await requireCharacterOwner(app.db, user.id, request.params.id);
    const taskId = String(request.body?.taskId || "").trim();
    if (!taskId) {
      const error = new Error("Task id is required");
      error.statusCode = 400;
      throw error;
    }

    const completed = Boolean(request.body?.completed);
    const source = String(request.body?.source || "manual").trim() || "manual";
    await app.db.query(`
      insert into leveling_character_progress (character_id, task_id, completed, source, completed_at)
      values ($1, $2, $3, $4, case when $3 then now() else null end)
      on conflict (character_id, task_id) do update set
        completed = excluded.completed,
        source = excluded.source,
        completed_at = excluded.completed_at,
        updated_at = now()
    `, [request.params.id, taskId, completed, source]);

    return {
      ok: true,
      data: {
        characterId: request.params.id,
        taskId,
        completed
      }
    };
  });
};

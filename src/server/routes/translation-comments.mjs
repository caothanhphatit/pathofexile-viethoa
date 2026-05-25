import { z } from "zod";

const entityTypes = ["skill_gem", "currency", "dictionary", "passive_tree_node"];

const requireDb = (app) => {
  if (!app.db) {
    const error = new Error("Database is not configured");
    error.statusCode = 503;
    throw error;
  }
  return app.db;
};

const badRequest = (message = "Invalid request") => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const parseOrThrow = (schema, value) => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw badRequest(result.error.issues[0]?.message || "Invalid request");
};

const commentQuerySchema = z.object({
  entityType: z.enum(entityTypes),
  entityId: z.string().trim().min(1).max(180),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

const createCommentSchema = z.object({
  entityType: z.enum(entityTypes),
  entityId: z.string().trim().min(1).max(180),
  entityName: z.string().trim().min(1).max(220),
  fieldPath: z.string().trim().min(1).max(120).default("summary"),
  sourceText: z.string().trim().max(4000).default(""),
  translatedText: z.string().trim().max(4000).default(""),
  body: z.string().trim().min(2).max(1200),
  pageUrl: z.string().trim().max(1000).default("")
});

const publicComment = (row) => ({
  id: Number(row.id),
  entityType: row.entity_type,
  entityId: row.entity_id,
  entityName: row.entity_name,
  fieldPath: row.field_path,
  sourceText: row.source_text || "",
  translatedText: row.translated_text || "",
  body: row.body,
  createdAt: row.created_at,
  user: {
    displayName: row.display_name || "POE2 user",
    avatarUrl: row.avatar_url || ""
  }
});

export const translationCommentRoutes = async (app) => {
  app.get("/api/translation-comments", async (request) => {
    const db = requireDb(app);
    const query = parseOrThrow(commentQuerySchema, request.query || {});
    const { rows } = await db.query(`
      select c.id, c.entity_type, c.entity_id, c.entity_name, c.field_path,
        c.source_text, c.translated_text, c.body, c.created_at,
        u.display_name, u.avatar_url
      from translation_comments c
      join users u on u.id = c.user_id
      where c.entity_type = $1
        and c.entity_id = $2
        and c.status = 'visible'
      order by c.created_at desc, c.id desc
      limit $3 offset $4
    `, [query.entityType, query.entityId, query.limit, query.offset]);

    return { ok: true, data: rows.map(publicComment) };
  });

  app.post("/api/translation-comments", async (request) => {
    const db = requireDb(app);
    const user = await app.auth.requireUser(db, request);
    const body = parseOrThrow(createCommentSchema, request.body || {});

    const { rows } = await db.query(`
      with inserted as (
        insert into translation_comments (
          entity_type, entity_id, entity_name, field_path, source_text,
          translated_text, body, user_id, page_url
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning *
      )
      select i.id, i.entity_type, i.entity_id, i.entity_name, i.field_path,
        i.source_text, i.translated_text, i.body, i.created_at,
        u.display_name, u.avatar_url
      from inserted i
      join users u on u.id = i.user_id
    `, [
      body.entityType,
      body.entityId,
      body.entityName,
      body.fieldPath,
      body.sourceText,
      body.translatedText,
      body.body,
      user.id,
      body.pageUrl
    ]);

    return { ok: true, data: publicComment(rows[0]) };
  });
};

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { buildApp } from "../src/server/app.mjs";

const hashSession = (token) => crypto.createHash("sha256").update(token).digest("hex");

class TranslationCommentsDb {
  constructor() {
    this.sessionHash = hashSession("session-token");
    this.user = {
      id: "usr_test",
      email: "tester@example.com",
      display_name: "Tester",
      avatar_url: "https://example.com/avatar.png"
    };
    this.comments = [
      {
        id: 1,
        entity_type: "skill_gem",
        entity_id: "Spark",
        entity_name: "Spark",
        field_path: "summary",
        source_text: "Launches sparks",
        translated_text: "Phóng tia lửa",
        body: "Câu này ổn rồi.",
        user_id: "usr_test",
        status: "visible",
        page_url: "/skill-gems?slug=Spark",
        created_at: "2026-05-23T08:00:00.000Z"
      },
      {
        id: 2,
        entity_type: "skill_gem",
        entity_id: "Spark",
        entity_name: "Spark",
        field_path: "summary",
        source_text: "",
        translated_text: "",
        body: "Comment đã ẩn không được public.",
        user_id: "usr_test",
        status: "hidden",
        page_url: "",
        created_at: "2026-05-23T09:00:00.000Z"
      }
    ];
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (compact.includes("from user_sessions s") && compact.includes("join users u")) {
      return { rows: params[0] === this.sessionHash ? [this.user] : [] };
    }
    if (compact.startsWith("update user_sessions")) return { rows: [] };
    if (compact.includes("from auth_accounts")) return { rows: [] };

    if (compact.includes("insert into translation_comments")) {
      const row = {
        id: this.comments.length + 1,
        entity_type: params[0],
        entity_id: params[1],
        entity_name: params[2],
        field_path: params[3],
        source_text: params[4],
        translated_text: params[5],
        body: params[6],
        user_id: params[7],
        status: "visible",
        page_url: params[8],
        created_at: "2026-05-23T10:00:00.000Z",
        display_name: this.user.display_name,
        avatar_url: this.user.avatar_url
      };
      this.comments.push(row);
      return { rows: [row] };
    }

    if (compact.includes("from translation_comments c")) {
      const [entityType, entityId, limit, offset] = params;
      const rows = this.comments
        .filter((comment) => comment.entity_type === entityType && comment.entity_id === entityId && comment.status === "visible")
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
        .slice(offset, offset + limit)
        .map((comment) => ({
          ...comment,
          display_name: this.user.display_name,
          avatar_url: this.user.avatar_url
        }));
      return { rows };
    }

    throw new Error(`Unexpected query: ${sql}`);
  }

  async end() {}
}

test("translation comments are public to read but require login to create", async () => {
  const db = new TranslationCommentsDb();
  const app = await buildApp({ db, logger: false, sessionSecret: "test-session-secret" });

  try {
    const listed = await app.inject({
      method: "GET",
      url: "/api/translation-comments?entityType=skill_gem&entityId=Spark"
    });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(JSON.parse(listed.body), {
      ok: true,
      data: [
        {
          id: 1,
          entityType: "skill_gem",
          entityId: "Spark",
          entityName: "Spark",
          fieldPath: "summary",
          sourceText: "Launches sparks",
          translatedText: "Phóng tia lửa",
          body: "Câu này ổn rồi.",
          createdAt: "2026-05-23T08:00:00.000Z",
          user: {
            displayName: "Tester",
            avatarUrl: "https://example.com/avatar.png"
          }
        }
      ]
    });

    const anonymousPost = await app.inject({
      method: "POST",
      url: "/api/translation-comments",
      payload: {
        entityType: "skill_gem",
        entityId: "Spark",
        entityName: "Spark",
        body: "Nên dịch mượt hơn."
      }
    });
    assert.equal(anonymousPost.statusCode, 401);

    const loggedInPost = await app.inject({
      method: "POST",
      url: "/api/translation-comments",
      headers: { cookie: "poe2_session=session-token" },
      payload: {
        entityType: "skill_gem",
        entityId: "Spark",
        entityName: "Spark",
        fieldPath: "summary",
        sourceText: "Launches sparks",
        translatedText: "Phóng tia lửa",
        body: "Nên giữ Projectile trong câu này.",
        pageUrl: "/skill-gems?slug=Spark"
      }
    });
    assert.equal(loggedInPost.statusCode, 200);
    const created = JSON.parse(loggedInPost.body);
    assert.equal(created.ok, true);
    assert.equal(created.data.body, "Nên giữ Projectile trong câu này.");
    assert.equal(created.data.user.displayName, "Tester");
  } finally {
    await app.close();
  }
});

test("translation comment API rejects invalid entity types", async () => {
  const db = new TranslationCommentsDb();
  const app = await buildApp({ db, logger: false, sessionSecret: "test-session-secret" });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/translation-comments?entityType=item&entityId=Spark"
    });
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).ok, false);
  } finally {
    await app.close();
  }
});

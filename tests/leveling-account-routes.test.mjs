import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { buildApp } from "../src/server/app.mjs";

const hashSession = (token) => crypto.createHash("sha256").update(token).digest("hex");

class MemoryDb {
  constructor() {
    this.user = {
      id: "usr_test",
      email: "test@example.com",
      display_name: "Test User",
      avatar_url: ""
    };
    this.sessionHash = hashSession("session-token");
    this.characters = [];
    this.progress = new Map();
  }

  async query(sql, params = []) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (query.includes("from user_sessions s join users u")) {
      return { rows: params[0] === this.sessionHash ? [this.user] : [] };
    }
    if (query.startsWith("update user_sessions")) return { rows: [] };
    if (query.includes("from auth_accounts")) return { rows: [] };

    if (query.includes("from leveling_characters") && query.includes("where user_id = $1")) {
      return { rows: [...this.characters].sort((a, b) => String(b.last_selected_at || "").localeCompare(String(a.last_selected_at || ""))) };
    }
    if (query.includes("insert into leveling_characters")) {
      const [id, userId, name, className, level, source, logPath, logStartOffset] = params;
      const existing = this.characters.find((character) => character.user_id === userId && character.name === name);
      const row = existing || {
        id,
        user_id: userId,
        created_at: new Date().toISOString()
      };
      Object.assign(row, {
        name,
        class_name: className,
        level,
        source,
        log_path: logPath,
        log_start_offset: logStartOffset,
        last_selected_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      if (!existing) this.characters.push(row);
      return { rows: [row] };
    }
    if (query.includes("insert into leveling_log_cursors")) return { rows: [] };
    if (query.includes("from leveling_character_progress")) {
      const rows = [...this.progress.entries()]
        .filter(([, value]) => value.character_id === params[0])
        .map(([task_id, value]) => ({ task_id, completed: value.completed }));
      return { rows };
    }
    if (query.includes("select id from leveling_characters where id = $1 and user_id = $2")) {
      const row = this.characters.find((character) => character.id === params[0] && character.user_id === params[1]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (query.includes("insert into leveling_character_progress")) {
      const [characterId, taskId, completed, source] = params;
      this.progress.set(taskId, { character_id: characterId, completed, source });
      return { rows: [] };
    }

    throw new Error(`Unhandled query: ${sql}`);
  }

  async end() {}
}

test("leveling account routes require a logged in user", async () => {
  const app = await buildApp({ db: null, logger: false, sessionSecret: "test-session-secret" });

  try {
    const response = await app.inject({ method: "GET", url: "/api/leveling/me" });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(JSON.parse(response.body), {
      ok: false,
      error: "Unauthorized"
    });
  } finally {
    await app.close();
  }
});

test("logged in users can create a leveling character and save task progress", async () => {
  const db = new MemoryDb();
  const app = await buildApp({
    db,
    logger: false,
    sessionSecret: "test-session-secret",
    levelingLogWatcher: {
      status: () => ({
        activePath: "C:\\Games\\Path of Exile 2\\logs\\Client.txt",
        bytesRead: 2048,
        characterName: "aaassssas",
        characterClass: "Huntress",
        characterLevel: 2
      }),
      stop: () => {}
    }
  });

  try {
    const headers = { cookie: "poe2_session=session-token" };
    const created = await app.inject({
      method: "POST",
      url: "/api/leveling/characters",
      headers,
      payload: { name: "aaassssas", className: "Huntress", level: 2 }
    });
    assert.equal(created.statusCode, 200);
    const createdBody = JSON.parse(created.body);
    assert.equal(createdBody.ok, true);
    assert.equal(createdBody.data.activeCharacter.name, "aaassssas");
    assert.equal(createdBody.data.activeCharacter.logStartOffset, 2048);

    const saved = await app.inject({
      method: "PUT",
      url: `/api/leveling/characters/${createdBody.data.activeCharacter.id}/progress`,
      headers,
      payload: { taskId: "riverbank-talk-wounded", completed: true, source: "manual" }
    });
    assert.equal(saved.statusCode, 200);

    const state = await app.inject({ method: "GET", url: "/api/leveling/me", headers });
    assert.equal(state.statusCode, 200);
    assert.deepEqual(JSON.parse(state.body).data.progress, {
      "riverbank-talk-wounded": true
    });

    const imported = await app.inject({
      method: "POST",
      url: "/api/leveling/characters",
      headers,
      payload: {
        name: "GuestImported",
        className: "Witch",
        level: 7,
        source: "guest-import",
        logPath: "D:\\Logs\\Client.txt",
        logStartOffset: 777
      }
    });
    assert.equal(imported.statusCode, 200);
    const importedBody = JSON.parse(imported.body);
    assert.equal(importedBody.data.activeCharacter.name, "GuestImported");
    assert.equal(importedBody.data.activeCharacter.source, "guest-import");
    assert.equal(importedBody.data.activeCharacter.logPath, "D:\\Logs\\Client.txt");
    assert.equal(importedBody.data.activeCharacter.logStartOffset, 777);
  } finally {
    await app.close();
  }
});

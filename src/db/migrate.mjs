import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";

import { closePool, createPool, withTransaction } from "./pool.mjs";

dotenv.config();

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = path.join(rootDir, "migrations");

const checksum = (text) => crypto.createHash("sha256").update(text).digest("hex");

export const listMigrations = async () => {
  const files = await fs.readdir(migrationsDir);
  return files.filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
};

export const migrate = async (pool = createPool()) => {
  const migrations = await listMigrations();
  const applied = [];

  await withTransaction(pool, async (client) => {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    for (const filename of migrations) {
      const fullPath = path.join(migrationsDir, filename);
      const sql = await fs.readFile(fullPath, "utf8");
      const hash = checksum(sql);
      const existing = await client.query("select checksum from schema_migrations where filename = $1", [filename]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== hash) {
          throw new Error(`Migration checksum changed: ${filename}`);
        }
        continue;
      }

      await client.query(sql);
      await client.query(
        "insert into schema_migrations (filename, checksum) values ($1, $2)",
        [filename, hash]
      );
      applied.push(filename);
    }
  });

  return { applied, total: migrations.length };
};

export const isMainModule = (moduleUrl = import.meta.url, argv = process.argv) => {
  if (!argv[1]) return false;
  return moduleUrl === pathToFileURL(path.resolve(argv[1])).href;
};

if (isMainModule()) {
  const pool = createPool();
  try {
    const result = await migrate(pool);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closePool(pool);
  }
}

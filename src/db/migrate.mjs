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

// Non-destructive integrity check: inspects the leading numeric prefixes of
// the migration filenames and reports gaps (e.g. 001,002,004 missing 003) or
// duplicate sequence numbers. This only logs/returns findings — it never
// executes or alters any schema. Run at startup so an out-of-order or missing
// migration is caught before it causes a confusing partial-apply.
export const validateMigrationSequence = (filenames) => {
  const seen = new Map();
  for (const filename of filenames) {
    const seq = Number(filename.match(/^(\d+)_/)?.[1]);
    if (!Number.isNaN(seq)) {
      seen.set(seq, (seen.get(seq) || 0) + 1);
    }
  }
  const numbers = [...seen.keys()].sort((a, b) => a - b);
  const issues = [];
  for (const [seq, count] of seen) {
    if (count > 1) issues.push(`duplicate sequence number ${String(seq).padStart(3, "0")} (${count} files)`);
  }
  for (let i = 1; i < numbers.length; i += 1) {
    const prev = numbers[i - 1];
    const curr = numbers[i];
    for (let missing = prev + 1; missing < curr; missing += 1) {
      issues.push(`missing sequence number ${String(missing).padStart(3, "0")}`);
    }
  }
  if (issues.length) {
    console.warn(`[db:migrate] migration sequence issues detected:\n  - ${issues.join("\n  - ")}`);
  }
  return { ok: issues.length === 0, issues };
};

export const migrate = async (pool = createPool()) => {
  const migrations = await listMigrations();
  validateMigrationSequence(migrations);
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

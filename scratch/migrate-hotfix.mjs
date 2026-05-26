import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { createPool, closePool } from "../src/db/pool.mjs";

dotenv.config();

const checksum = (text) => crypto.createHash("sha256").update(text).digest("hex");

const main = async () => {
  const pool = createPool();
  try {
    const sqlFile = await fs.readFile(path.join("migrations", "001_core_schema.sql"), "utf8");
    const newHash = checksum(sqlFile);
    console.log("New checksum for 001_core_schema.sql:", newHash);

    // 1. Alter table and create index
    console.log("Applying column and index hotfix...");
    await pool.query(`
      ALTER TABLE currency_items ADD COLUMN IF NOT EXISTS related_items_json jsonb not null default '[]'::jsonb;
      CREATE INDEX IF NOT EXISTS idx_currency_items_related_gin ON currency_items using gin(related_items_json);
    `);
    console.log("Columns and indexes verified/created.");

    // 2. Update checksum in schema_migrations
    console.log("Updating schema_migrations checksum...");
    await pool.query(`
      UPDATE schema_migrations
      SET checksum = $1
      WHERE filename = '001_core_schema.sql'
    `, [newHash]);
    console.log("Checksum updated successfully.");

  } catch (err) {
    console.error("Hotfix failed:", err);
  } finally {
    await closePool(pool);
  }
};

main();

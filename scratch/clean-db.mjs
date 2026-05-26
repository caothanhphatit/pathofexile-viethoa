import dotenv from "dotenv";
import { createPool, closePool } from "../src/db/pool.mjs";

dotenv.config();

const main = async () => {
  const pool = createPool();
  try {
    const res = await pool.query("DELETE FROM currency_items WHERE slug = 'Convention_Treasure' OR slug LIKE '%Convention%' OR slug LIKE '%Treasure%'");
    console.log(`Successfully deleted ${res.rowCount} rows related to Convention Treasure.`);
  } catch (err) {
    console.error("Cleanup failed:", err);
  } finally {
    await closePool(pool);
  }
};

main();

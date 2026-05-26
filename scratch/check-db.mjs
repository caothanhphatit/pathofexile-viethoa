import dotenv from "dotenv";
import { createPool, closePool } from "../src/db/pool.mjs";

dotenv.config();

const main = async () => {
  const pool = createPool();
  try {
    const res = await pool.query(`
      select 
        cs.id as string_id,
        cs.entity_id as slug,
        cs.field_path,
        cs.source_text as en,
        ct.translated_text as vi,
        ct.translation_status as status
      from content_strings cs
      left join content_translations ct on ct.string_id = cs.id and ct.locale = 'vi'
      where cs.entity_type = 'currency'
        and cs.entity_id = 'Omen_of_Greater_Exaltation'
      order by cs.field_path
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await closePool(pool);
  }
};

main();

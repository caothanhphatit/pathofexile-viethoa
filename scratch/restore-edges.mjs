import dotenv from 'dotenv';
import { createPool, closePool } from '../src/db/pool.mjs';

dotenv.config();

const pool = createPool();

try {
  const result = await pool.query(`
    update passive_tree_edges
    set status = 'active', updated_at = now()
    where from_node_id in ('50986', '47175', '50459', '44683', '61525', '54447')
       or to_node_id in ('50986', '47175', '50459', '44683', '61525', '54447')
  `);
  console.log(`Successfully restored ${result.rowCount} starting edges to active status in DB.`);
} catch (err) {
  console.error(err);
} finally {
  await closePool(pool);
}

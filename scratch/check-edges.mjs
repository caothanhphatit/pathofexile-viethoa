import dotenv from 'dotenv';
import { createPool, closePool } from '../src/db/pool.mjs';

dotenv.config();

const pool = createPool();

try {
  const { rows } = await pool.query(`
    select * from passive_tree_edges
    where from_node_id in ('50986', '47175', '50459', '44683', '61525', '54447')
       or to_node_id in ('50986', '47175', '50459', '44683', '61525', '54447')
  `);
  console.log(`Found ${rows.length} edges in DB connecting to starting nodes:`, rows);
} catch (err) {
  console.error(err);
} finally {
  await closePool(pool);
}

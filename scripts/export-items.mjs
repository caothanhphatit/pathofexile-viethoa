import dotenv from "dotenv";

import {
  parseCliArgs,
  runWithPool,
  writeItemsExport
} from "./items/runtime.mjs";

dotenv.config();

const args = parseCliArgs();
const exportPath = args.get("out");

try {
  const data = await runWithPool((pool) => writeItemsExport(pool, exportPath));
  console.log(JSON.stringify({
    ok: true,
    total: data.total,
    active_total: data.active_total,
    menus: data.menus.length
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}

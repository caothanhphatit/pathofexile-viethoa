import dotenv from "dotenv";

import {
  EXPORT_PATH,
  runCurrencyWithPostgres,
  writeCurrencyExportPostgres
} from "./currency/runtime.mjs";

dotenv.config();

const data = await runCurrencyWithPostgres((pool) => writeCurrencyExportPostgres(pool));
console.log(JSON.stringify({ database: "postgres", exportPath: EXPORT_PATH, total: data.total, activeTotal: data.active_total }, null, 2));

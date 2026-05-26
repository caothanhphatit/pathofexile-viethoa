import dotenv from "dotenv";

import { closePool, createPool } from "../src/db/pool.mjs";
import { parseCliArgs } from "./game-extract/runtime.mjs";
import {
  exportLatestGgpkLookupPostgres,
  ggpkLookupExportSummary
} from "./game-extract/ggpk-lookup-web-runtime.mjs";

dotenv.config({ quiet: true });

const args = parseCliArgs();

const main = async () => {
  const pool = createPool();
  try {
    const result = await exportLatestGgpkLookupPostgres(pool, {
      extractVersionId: args.get("extract-version-id") || "",
      outputPath: args.get("output") || undefined
    });
    console.log(JSON.stringify(ggpkLookupExportSummary(result), null, 2));
  } finally {
    await closePool(pool);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

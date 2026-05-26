import dotenv from "dotenv";

import { closePool, createPool } from "../src/db/pool.mjs";
import { parseCliArgs } from "./game-extract/runtime.mjs";
import {
  exportLatestGgpkSkillsPostgres,
  ggpkSkillsExportSummary
} from "./game-extract/ggpk-skills-web-runtime.mjs";

dotenv.config({ quiet: true });

const args = parseCliArgs();

const main = async () => {
  const pool = createPool();
  try {
    const result = await exportLatestGgpkSkillsPostgres(pool, {
      extractVersionId: args.get("extract-version-id") || "",
      outputPath: args.get("output") || undefined
    });
    console.log(JSON.stringify(ggpkSkillsExportSummary(result), null, 2));
  } finally {
    await closePool(pool);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

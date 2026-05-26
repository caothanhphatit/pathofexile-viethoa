import dotenv from "dotenv";

import {
  boolArg,
  parseCliArgs,
  runWithPool
} from "./game-extract/runtime.mjs";
import {
  buildGgpkFullSnapshot,
  DEFAULT_GGPK_FULL_CATALOG_DIR,
  ggpkFullImportSummary,
  importGgpkFullSnapshotPostgres
} from "./game-extract/ggpk-normalize-runtime.mjs";

dotenv.config({ quiet: true });

const args = parseCliArgs();

const main = async () => {
  const rawRowTables = (args.get("raw-row-tables") || "")
    .split(",")
    .map((table) => table.trim().toLowerCase())
    .filter(Boolean);
  const snapshot = await buildGgpkFullSnapshot({
    catalogDir: args.get("catalog-dir") || DEFAULT_GGPK_FULL_CATALOG_DIR,
    inventoryPath: args.get("inventory-path") || "",
    rawRowTables
  });

  let database = "skipped";
  if (!boolArg(args.get("no-db"), false) && process.env.POE2_DATABASE_URL) {
    const imported = await runWithPool((pool) => importGgpkFullSnapshotPostgres(pool, snapshot, {
      batchSize: Number(args.get("batch-size") || 1000)
    }));
    database = `imported:${imported.version_id}`;
  }

  console.log(JSON.stringify(ggpkFullImportSummary({ snapshot, database }), null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

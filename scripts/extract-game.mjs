import dotenv from "dotenv";

import {
  boolArg,
  buildExtractSnapshot,
  DEFAULT_OUTPUT_DIR,
  diffSnapshots,
  importSnapshotPostgres,
  loadSnapshotFile,
  outputSummary,
  parseCliArgs,
  preflightGameInstall,
  readFixtureSource,
  readPobUpstreamSource,
  runWithPool,
  writeSnapshotOutput
} from "./game-extract/runtime.mjs";

dotenv.config({ quiet: true });

const args = parseCliArgs();

const main = async () => {
  const fixturePath = args.get("fixture");
  const outputDir = args.get("output-dir") || DEFAULT_OUTPUT_DIR;
  const copyAssets = boolArg(args.get("copy-assets"), Boolean(fixturePath));
  const source = fixturePath
    ? await readFixtureSource({ fixturePath })
    : await readPobUpstreamSource({ pobPath: args.get("pob-path") || undefined });

  const preflight = fixturePath ? null : await preflightGameInstall({
    gamePath: args.get("game-path") || undefined,
    pobPath: args.get("pob-path") || undefined
  });
  const snapshot = await buildExtractSnapshot(source);
  const output = await writeSnapshotOutput(snapshot, { outputDir, copyAssets });
  const diff = args.get("compare")
    ? diffSnapshots(await loadSnapshotFile(args.get("compare")), snapshot)
    : null;

  let database = "skipped";
  if (!args.has("no-db") && process.env.POE2_DATABASE_URL) {
    const imported = await runWithPool((pool) => importSnapshotPostgres(pool, snapshot));
    database = `imported:${imported.version_id}`;
  }

  console.log(JSON.stringify(outputSummary({ snapshot, output, database, diff, preflight }), null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

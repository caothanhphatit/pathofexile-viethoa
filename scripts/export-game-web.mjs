import {
  buildExtractSnapshot,
  DEFAULT_OUTPUT_DIR,
  parseCliArgs,
  readFixtureSource,
  readPobUpstreamSource
} from "./game-extract/runtime.mjs";
import {
  buildWebDataBundle,
  DEFAULT_WEB_OUTPUT_DIR,
  loadSnapshotForWebExport,
  webOutputSummary,
  writeWebDataProducts
} from "./game-extract/web-runtime.mjs";

const args = parseCliArgs();

const buildInputSnapshot = async () => {
  if (args.get("snapshot")) return loadSnapshotForWebExport(args.get("snapshot"));
  if (args.get("fixture")) {
    return buildExtractSnapshot(await readFixtureSource({ fixturePath: args.get("fixture") }));
  }
  if (args.get("pob-path")) {
    return buildExtractSnapshot(await readPobUpstreamSource({ pobPath: args.get("pob-path") }));
  }
  return loadSnapshotForWebExport(`${DEFAULT_OUTPUT_DIR}/latest.json`);
};

const main = async () => {
  const outputDir = args.get("output-dir") || DEFAULT_WEB_OUTPUT_DIR;
  const snapshot = await buildInputSnapshot();
  const bundle = buildWebDataBundle(snapshot);
  const output = await writeWebDataProducts(bundle, { outputDir });

  console.log(JSON.stringify(webOutputSummary({ bundle, output }), null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

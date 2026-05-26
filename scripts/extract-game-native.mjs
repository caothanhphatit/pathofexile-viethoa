import {
  DEFAULT_NATIVE_OUTPUT_DIR,
  parseCliArgs,
  phase2NativeSummary
} from "./game-extract/native-runtime.mjs";

const args = parseCliArgs();

const main = async () => {
  const tables = String(args.get("tables") || "baseitemtypes,skillgems,mods")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const summary = await phase2NativeSummary({
    pobPath: args.get("pob-path") || undefined,
    tableFilter: tables,
    outputDir: args.get("output-dir") || DEFAULT_NATIVE_OUTPUT_DIR
  });
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

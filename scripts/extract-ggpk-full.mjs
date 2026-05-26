import {
  boolArg,
  parseCliArgs
} from "./game-extract/runtime.mjs";
import {
  DEFAULT_FULL_DATC64_OUTPUT_DIR,
  DEFAULT_GGPK_FILE_LIST,
  runFullDatc64Pipeline
} from "./game-extract/ggpk-full-runtime.mjs";
import {
  DEFAULT_OOZ_TOOLS_DIR
} from "./game-extract/ggpk-sweep-runtime.mjs";

const args = parseCliArgs();

const main = async () => {
  const summary = await runFullDatc64Pipeline({
    fileList: args.get("file-list") || DEFAULT_GGPK_FILE_LIST,
    gamePath: args.get("game-path") || undefined,
    ggpkPath: args.get("ggpk-path") || undefined,
    toolsDir: args.get("tools-dir") || DEFAULT_OOZ_TOOLS_DIR,
    outputDir: args.get("output-dir") || DEFAULT_FULL_DATC64_OUTPUT_DIR,
    pobPath: args.get("pob-path") || undefined,
    specPath: args.get("spec-path") || "",
    dryRun: boolArg(args.get("dry-run"), false),
    extract: boolArg(args.get("extract"), false),
    parse: boolArg(args.get("parse"), false),
    parseLimit: Number(args.get("parse-limit") || 0),
    timeoutMs: Number(args.get("timeout-ms") || 0)
  });

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import {
  boolArg,
  parseCliArgs
} from "./game-extract/runtime.mjs";
import {
  DEFAULT_GGPK_SWEEP_OUTPUT_DIR,
  DEFAULT_OOZ_TOOLS_DIR,
  runGgpkSweep
} from "./game-extract/ggpk-sweep-runtime.mjs";

const args = parseCliArgs();

const main = async () => {
  const summary = await runGgpkSweep({
    pobPath: args.get("pob-path") || undefined,
    gamePath: args.get("game-path") || undefined,
    ggpkPath: args.get("ggpk-path") || undefined,
    toolsDir: args.get("tools-dir") || DEFAULT_OOZ_TOOLS_DIR,
    outputDir: args.get("output-dir") || DEFAULT_GGPK_SWEEP_OUTPUT_DIR,
    dryRun: boolArg(args.get("dry-run"), false),
    listFiles: boolArg(args.get("list-files"), false),
    timeoutMs: Number(args.get("timeout-ms") || 0)
  });

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

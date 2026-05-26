import { diffSnapshots, loadSnapshotFile, parseCliArgs } from "./game-extract/runtime.mjs";

const args = parseCliArgs();

const main = async () => {
  const fromPath = args.get("from");
  const toPath = args.get("to");
  if (!fromPath || !toPath) {
    throw new Error("Usage: node scripts/extract-game-diff.mjs --from=<snapshot-a.json> --to=<snapshot-b.json>");
  }
  const diff = diffSnapshots(await loadSnapshotFile(fromPath), await loadSnapshotFile(toPath));
  console.log(JSON.stringify({
    from: diff.from,
    to: diff.to,
    diff_hash: diff.diff_hash,
    summary: diff.summary
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

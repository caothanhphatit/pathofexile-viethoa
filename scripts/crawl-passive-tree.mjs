import dotenv from "dotenv";

import {
  EXPORT_PATH,
  parseCliArgs,
  readPassiveTreeSource,
  runPassiveTreeWithPostgres,
  upsertPassiveTreePostgres,
  writePassiveTreeExportPostgres
} from "./passive-tree/runtime.mjs";
import { normalizePassiveTree } from "./passive-tree/passive-tree-lib.mjs";

dotenv.config();

const args = parseCliArgs();

const main = async () => {
  const options = {
    repo: args.get("repo") || undefined,
    ref: args.get("ref") || undefined,
    treePath: args.get("path") || undefined,
    jsonPath: args.get("json") || undefined
  };
  const { raw, source } = await readPassiveTreeSource(options);
  const tree = normalizePassiveTree(raw, {
    treeVersion: source.version,
    sourceUrl: source.source_url,
    sourceRef: source.ref
  });

  const result = await runPassiveTreeWithPostgres(async (pool) => {
    const summary = await upsertPassiveTreePostgres(pool, tree, {
      sourceUrl: source.source_url,
      sourcePath: source.path,
      sourceRef: source.ref
    });
    const data = await writePassiveTreeExportPostgres(pool);
    return { summary, data, source };
  });

  console.log(JSON.stringify({
    database: "postgres",
    exportPath: EXPORT_PATH,
    source: result.source,
    parsed: tree.nodes.length,
    exported: result.data.total,
    version: result.data.version,
    summary: result.summary
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

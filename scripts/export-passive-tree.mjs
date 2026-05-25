import dotenv from "dotenv";

import {
  EXPORT_PATH,
  parseCliArgs,
  passiveTreeExportPayload,
  readPassiveTreeSource,
  runPassiveTreeWithPostgres,
  writePassiveTreeExportData,
  writePassiveTreeExportPostgres
} from "./passive-tree/runtime.mjs";
import { normalizePassiveTree } from "./passive-tree/passive-tree-lib.mjs";

dotenv.config();

const args = parseCliArgs();
const sourceOptions = {
  repo: args.get("repo") || undefined,
  ref: args.get("ref") || undefined,
  treePath: args.get("path") || undefined,
  jsonPath: args.get("json") || undefined
};

const data = args.has("json") || args.has("path")
  ? await (async () => {
    const { raw, source } = await readPassiveTreeSource(sourceOptions);
    const tree = normalizePassiveTree(raw, {
      treeVersion: source.version,
      sourceUrl: source.source_url,
      sourceRef: source.ref
    });
    return writePassiveTreeExportData(passiveTreeExportPayload(tree, { sourcePath: source.path }));
  })()
  : await runPassiveTreeWithPostgres((pool) => writePassiveTreeExportPostgres(pool));
console.log(JSON.stringify({
  database: args.has("json") || args.has("path") ? "none" : "postgres",
  exportPath: EXPORT_PATH,
  total: data.total,
  version: data.version
}, null, 2));

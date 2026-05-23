import dotenv from "dotenv";

import {
  DEFAULT_ITEMS_SOURCE_URL,
  crawlItemsToPostgres,
  parseCliArgs,
  runWithPool
} from "./items/runtime.mjs";

dotenv.config();

const args = parseCliArgs();
const sourceUrl = args.get("source-url") || DEFAULT_ITEMS_SOURCE_URL;
const htmlPath = args.get("html");
const limitMenus = Number(args.get("limit-menus") || 0);
const concurrency = Number(args.get("concurrency") || 2);
const markRemoved = args.get("mark-removed") === "true";

const log = (event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));

try {
  const result = await runWithPool((pool) => crawlItemsToPostgres({
    pool,
    sourceUrl,
    htmlPath,
    limitMenus,
    concurrency,
    markRemoved,
    onProgress: log
  }));
  log({ event: "crawl:done", result });
} catch (error) {
  log({ event: "crawl:error", error: error.message });
  process.exitCode = 1;
}

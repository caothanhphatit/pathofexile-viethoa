import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const hardcodedRemoteDatabaseUrl = /postgres(?:ql)?:\/\/[^:@\s]+:[^@\s]+@(?!localhost\b|127\.0\.0\.1\b|\[::1\])[^\s"'`]+/i;

test("items crawl and export CLIs are wired to Postgres runtime without secrets", async () => {
  const [crawl, exportItems] = await Promise.all([
    readText("scripts/crawl-items.mjs"),
    readText("scripts/export-items.mjs")
  ]);

  assert.match(crawl, /dotenv\.config/);
  assert.match(crawl, /crawlItemsToPostgres/);
  assert.match(crawl, /runWithPool/);
  assert.match(exportItems, /writeItemsExport/);
  assert.match(exportItems, /runWithPool/);
  assert.doesNotMatch(`${crawl}\n${exportItems}`, hardcodedRemoteDatabaseUrl);
});

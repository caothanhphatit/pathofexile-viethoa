import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  exportSkillGemsPostgres,
  upsertSkillGemsPostgres,
  writeSkillGemExportPostgres
} from "../scripts/skill-gems/runtime.mjs";
import {
  exportCurrenciesPostgres,
  upsertCurrenciesPostgres,
  writeCurrencyExportPostgres
} from "../scripts/currency/runtime.mjs";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const hardcodedRemoteDatabaseUrl = /postgres(?:ql)?:\/\/[^:@\s]+:[^@\s]+@(?!localhost\b|127\.0\.0\.1\b|\[::1\])[^\s"'`]+/i;

test("skill gem and currency runtimes expose PostgreSQL persistence paths", () => {
  assert.equal(typeof upsertSkillGemsPostgres, "function");
  assert.equal(typeof exportSkillGemsPostgres, "function");
  assert.equal(typeof writeSkillGemExportPostgres, "function");
  assert.equal(typeof upsertCurrenciesPostgres, "function");
  assert.equal(typeof exportCurrenciesPostgres, "function");
  assert.equal(typeof writeCurrencyExportPostgres, "function");
});

test("skill gem and currency CLIs require Postgres and do not keep SQLite fallbacks", async () => {
  const [skillRuntime, currencyRuntime, skillCrawl, skillExport, currencyCrawl, currencyExport, packageJson] = await Promise.all([
    readText("scripts/skill-gems/runtime.mjs"),
    readText("scripts/currency/runtime.mjs"),
    readText("scripts/crawl-skill-gems.mjs"),
    readText("scripts/export-skill-gems.mjs"),
    readText("scripts/crawl-currency.mjs"),
    readText("scripts/export-currency.mjs"),
    readText("package.json")
  ]);
  const combined = `${skillRuntime}\n${currencyRuntime}\n${skillCrawl}\n${skillExport}\n${currencyCrawl}\n${currencyExport}`;

  assert.match(combined, /POE2_DATABASE_URL/);
  assert.match(skillCrawl, /upsertSkillGemsPostgres/);
  assert.match(skillExport, /writeSkillGemExportPostgres/);
  assert.match(currencyCrawl, /upsertCurrenciesPostgres/);
  assert.match(currencyExport, /writeCurrencyExportPostgres/);
  assert.doesNotMatch(combined, /sql\.js|poe2\.sqlite|openSkillGemDatabase|openCurrencyDatabase|writeSkillGemDatabase|writeCurrencyDatabase|loadSql/);
  assert.doesNotMatch(packageJson, /"sql\.js"/);
  assert.doesNotMatch(combined, hardcodedRemoteDatabaseUrl);
});

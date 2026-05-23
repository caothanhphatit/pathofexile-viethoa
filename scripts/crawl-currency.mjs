import {
  parseCurrencyPage
} from "./currency-lib.mjs";
import {
  DEFAULT_SOURCE_URL,
  EXPORT_PATH,
  parseCliArgs,
  readCurrencySourceHtml,
  runCurrencyWithPostgres,
  upsertCurrenciesPostgres,
  writeCurrencyExportPostgres
} from "./currency/runtime.mjs";
import dotenv from "dotenv";

dotenv.config();

const args = parseCliArgs();
const sourceUrl = args.get("source") || DEFAULT_SOURCE_URL;
const htmlPath = args.get("html");

const html = await readCurrencySourceHtml({ sourceUrl, htmlPath });
const currencies = parseCurrencyPage(html, sourceUrl);

if (!currencies.length) {
  throw new Error("No currency items found. PoE2DB markup may have changed.");
}

const result = await runCurrencyWithPostgres(async (pool) => {
  const summary = await upsertCurrenciesPostgres(pool, currencies, { sourceUrl });
  const data = await writeCurrencyExportPostgres(pool);
  return { summary, data };
});

console.log(JSON.stringify({
  database: "postgres",
  exportPath: EXPORT_PATH,
  parsed: currencies.length,
  activeInExport: result.data.active_total,
  totalInExport: result.data.total,
  categories: result.data.categories,
  summary: result.summary
}, null, 2));

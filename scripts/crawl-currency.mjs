import {
  parseCurrencyPage,
  parseCurrencyRelatedItems,
  buildBidirectionalCurrencyRelations
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
const shouldCrawlDetails = args.get("details") !== "false";

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "poe2-vietnamese-currency-crawler/1.0"
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.text();
};

const hydrateDetails = async (currencies, { concurrency = 6 } = {}) => {
  if (!shouldCrawlDetails) return currencies;
  const detailCache = new Map();
  let cursor = 0;

  const hydrateOne = async (item) => {
    if (!item.source_url) return item;
    try {
      if (!detailCache.has(item.source_url)) {
        detailCache.set(item.source_url, fetchText(item.source_url).then((html) => {
          return parseCurrencyRelatedItems(html, item.source_url);
        }));
      }
      const related = await detailCache.get(item.source_url);
      return { ...item, related_items: related };
    } catch (err) {
      console.warn(`[Warning] Failed to fetch related items for ${item.name} (${item.source_url}):`, err.message);
      return { ...item, related_items: [] };
    }
  };

  const workers = Array.from({ length: concurrency }, async () => {
    const results = [];
    while (cursor < currencies.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await hydrateOne(currencies[index]);
    }
    return results;
  });

  const chunks = await Promise.all(workers);
  return chunks.flat().filter(Boolean).sort((a, b) => currencies.findIndex((c) => c.slug === a.slug) - currencies.findIndex((c) => c.slug === b.slug));
};

const main = async () => {
  const html = await readCurrencySourceHtml({ sourceUrl, htmlPath });
  const rawCurrencies = parseCurrencyPage(html, sourceUrl);

  if (!rawCurrencies.length) {
    throw new Error("No currency items found. PoE2DB markup may have changed.");
  }

  console.log(`Crawl: Found ${rawCurrencies.length} initial currency items. Starting detail hydration...`);
  const hydratedCurrencies = await hydrateDetails(rawCurrencies);
  const currencies = buildBidirectionalCurrencyRelations(hydratedCurrencies);

  console.log(`Crawl: Hydration completed. Total items after bidirectional expansion: ${currencies.length}`);

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
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

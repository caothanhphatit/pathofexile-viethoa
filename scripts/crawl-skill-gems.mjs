import {
  parseSkillGemDetailPage,
  parseSkillGemsPage
} from "./skill-gems-lib.mjs";
import {
  DEFAULT_SOURCE_URL,
  EXPORT_PATH,
  parseCliArgs,
  readSkillGemSourceHtml,
  runSkillGemWithPostgres,
  upsertSkillGemsPostgres,
  writeSkillGemExportPostgres
} from "./skill-gems/runtime.mjs";
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
      "user-agent": "poe2-vietnamese-skill-gems-crawler/1.0"
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.text();
};

const hydrateDetails = async (gems, { concurrency = 6 } = {}) => {
  if (!shouldCrawlDetails) return gems;
  const detailCache = new Map();
  let cursor = 0;

  const hydrateOne = async (gem) => {
    if (!gem.source_url) return gem;
    if (!detailCache.has(gem.source_url)) {
      detailCache.set(gem.source_url, fetchText(gem.source_url).then(parseSkillGemDetailPage));
    }
    return { ...gem, detail: await detailCache.get(gem.source_url) };
  };

  const workers = Array.from({ length: concurrency }, async () => {
    const results = [];
    while (cursor < gems.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await hydrateOne(gems[index]);
    }
    return results;
  });

  const chunks = await Promise.all(workers);
  return chunks.flat().filter(Boolean).sort((a, b) => gems.findIndex((gem) => gem.slug === a.slug) - gems.findIndex((gem) => gem.slug === b.slug));
};

const main = async () => {
  const html = await readSkillGemSourceHtml({ sourceUrl, htmlPath });
  const gems = await hydrateDetails(parseSkillGemsPage(html, sourceUrl));
  if (!gems.length) throw new Error("No skill gems found. PoE2DB markup may have changed.");

  const result = await runSkillGemWithPostgres(async (pool) => {
    const summary = await upsertSkillGemsPostgres(pool, gems, { sourceUrl });
    const data = await writeSkillGemExportPostgres(pool);
    return { summary, data };
  });

  console.log(JSON.stringify({
    database: "postgres",
    exportPath: EXPORT_PATH,
    parsed: gems.length,
    totalInExport: result.data.total,
    summary: result.summary
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

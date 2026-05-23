import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  buildSkillTagGlossaryTerms,
  buildGlossaryTerms,
  extractKeywordReferences,
  fallbackKeywordMeaning,
  hasDirtyEnglishDescription,
  normalizeGlossaryText,
  parseKeywordHoverHtml,
  translateKeywordDescription
} from "./glossary-lib.mjs";
import { parseSkillGemsPage } from "./skill-gems-lib.mjs";
import { DEFAULT_CURRENCY_SOURCE_URL } from "./currency-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const EXPORT_PATH = path.join(ROOT_DIR, "dictionary-data.js");
const SKILL_SOURCE_URL = "https://poe2db.tw/us/Skill_Gems";

const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "poe2-vietnamese-dictionary-crawler/1.0"
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.text();
};

const loadExistingDictionary = () => {
  if (!fs.existsSync(EXPORT_PATH)) return { categories: {}, terms: [] };
  const source = fs.readFileSync(EXPORT_PATH, "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.POE2_DICTIONARY_TERMS || { categories: {}, terms: [] };
};

const runConcurrent = async (items, worker, { concurrency = 8, label = "items" } = {}) => {
  const results = [];
  let cursor = 0;
  let done = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        console.warn(`[dictionary] skip ${items[index]}: ${error.message}`);
        results[index] = null;
      } finally {
        done += 1;
        if (done % 50 === 0 || done === items.length) {
          console.log(`[dictionary] ${done}/${items.length} ${label}`);
        }
      }
    }
  });

  await Promise.all(workers);
  return results.filter(Boolean);
};

const uniqueBy = (items, keyFn) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const termKey = (term = "") => normalizeGlossaryText(term).toLowerCase();

const mergeExamples = (...groups) => [...new Set(groups.flat().map(normalizeGlossaryText).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, "en"));

const preferGeneratedCategory = (generatedCategory = "", manualCategory = "") => {
  if (!manualCategory) return generatedCategory || "combat";
  if (!generatedCategory) return manualCategory;
  if (generatedCategory === "endgame") return generatedCategory;
  if (manualCategory === "combat" && generatedCategory !== "combat") return generatedCategory;
  if (manualCategory === "item" && ["endgame", "damage", "defense", "resource", "skill"].includes(generatedCategory)) {
    return generatedCategory;
  }
  return manualCategory;
};

const preferCleanMeaning = (term = "", ...candidates) => {
  for (const candidate of candidates.map(normalizeGlossaryText).filter(Boolean)) {
    if (!hasDirtyEnglishDescription(candidate)) return candidate;
  }
  return fallbackKeywordMeaning(term);
};

const mergeWithExistingTerms = (generatedTerms, existingTerms, skillTagKeys = new Set()) => {
  const existingByTerm = new Map(existingTerms.map((term) => [termKey(term.term), term]));
  const generatedKeys = new Set(generatedTerms.map((term) => termKey(term.term)));
  const merged = generatedTerms.map((term) => {
    const manual = existingByTerm.get(termKey(term.term));
    if (!manual) return term;
    const curatedMeaning = translateKeywordDescription(term.term, term.description_en || manual.description_en || "");
    const isGeneratedSkillTag = skillTagKeys.has(termKey(term.term));
    const genericFallback = fallbackKeywordMeaning(term.term);
    const generatedMeaning = curatedMeaning || term.meaning;
    return {
      ...term,
      category: preferGeneratedCategory(term.category, manual.category),
      meaning: preferCleanMeaning(
        term.term,
        generatedMeaning !== genericFallback ? generatedMeaning : "",
        isGeneratedSkillTag ? term.meaning : "",
        term.meaning !== genericFallback ? term.meaning : "",
        manual.meaning,
        generatedMeaning,
        term.meaning
      ),
      keep: isGeneratedSkillTag ? term.keep : manual.keep || term.keep,
      examples: mergeExamples(term.examples || [], manual.examples || [], term.variants || []),
      variants: mergeExamples(term.variants || [], manual.variants || [])
    };
  });

  const generatedVariantKeys = new Set(generatedTerms.flatMap((term) => term.variants || []).map(termKey));
  const manualOnly = existingTerms
    .filter((term) => !generatedKeys.has(termKey(term.term)) && !generatedVariantKeys.has(termKey(term.term)))
    .map((term) => ({
      ...term,
      meaning: preferCleanMeaning(term.term, translateKeywordDescription(term.term, term.description_en || ""), term.meaning),
      keep: term.keep || `${term.term} là keyword/tooltip gốc của PoE2DB, giữ nguyên để đối chiếu modifier và UI trong game.`,
      examples: mergeExamples(term.examples || []),
      variants: mergeExamples(term.variants || [])
    }));
  return [...merged, ...manualOnly].sort((a, b) => a.term.localeCompare(b.term, "en"));
};

const mergeGeneratedTerms = (generatedTerms) => {
  const byTerm = new Map();
  for (const term of generatedTerms) {
    const key = termKey(term.term);
    if (!key) continue;
    const current = byTerm.get(key);
    if (!current) {
      byTerm.set(key, term);
      continue;
    }
    byTerm.set(key, {
      ...current,
      ...term,
      category: term.category || current.category,
      meaning: term.meaning || current.meaning,
      keep: term.keep || current.keep,
      examples: mergeExamples(current.examples || [], term.examples || []),
      variants: mergeExamples(current.variants || [], term.variants || []),
      description_en: term.description_en || current.description_en || "",
      source_url: term.source_url || current.source_url || "",
      hover_url: term.hover_url || current.hover_url || ""
    });
  }
  return [...byTerm.values()].sort((a, b) => a.term.localeCompare(b.term, "en"));
};

const writeDictionaryExport = (dictionary) => {
  fs.writeFileSync(EXPORT_PATH, `window.POE2_DICTIONARY_TERMS = ${JSON.stringify(dictionary, null, 2)};\n`, "utf8");
};

const main = async () => {
  const args = parseCliArgs();
  const shouldCrawlSkillDetails = args.get("details") !== "false";
  const concurrency = Number(args.get("concurrency") || 8);
  const existing = loadExistingDictionary();
  const references = [];

  console.log("[dictionary] fetch currency keywords");
  const currencyHtml = await fetchText(args.get("currency-source") || DEFAULT_CURRENCY_SOURCE_URL);
  references.push(...extractKeywordReferences(currencyHtml, DEFAULT_CURRENCY_SOURCE_URL));

  console.log("[dictionary] fetch skill gem keywords");
  const skillHtml = await fetchText(args.get("skill-source") || SKILL_SOURCE_URL);
  references.push(...extractKeywordReferences(skillHtml, SKILL_SOURCE_URL));
  const gems = parseSkillGemsPage(skillHtml, SKILL_SOURCE_URL);
  const skillTags = [...new Set(gems.flatMap((gem) => gem.tags || []))];

  if (shouldCrawlSkillDetails) {
    const detailUrls = uniqueBy(gems.map((gem) => gem.source_url), (url) => url);
    console.log(`[dictionary] fetch ${detailUrls.length} skill detail pages`);
    const detailRefs = await runConcurrent(detailUrls, async (url) => {
      const html = await fetchText(url);
      return extractKeywordReferences(html, url);
    }, { concurrency, label: "skill detail pages" });
    for (const refGroup of detailRefs) {
      for (const ref of refGroup) references.push(ref);
    }
  }

  const uniqueReferences = uniqueBy(references, (ref) => `${ref.keyword}|${ref.label}|${ref.hover_url}`);
  const hoverUrls = uniqueBy(uniqueReferences.map((ref) => ref.hover_url), (url) => url);
  console.log(`[dictionary] fetch ${hoverUrls.length} keyword tooltip pages`);
  const hoverEntries = await runConcurrent(hoverUrls, async (url) => {
    const html = await fetchText(url);
    return [url, parseKeywordHoverHtml(html)];
  }, { concurrency, label: "keyword tooltips" });
  const hoverByUrl = new Map(hoverEntries.filter(([, hover]) => hover.title || hover.description_en));

  const skillTagTerms = buildSkillTagGlossaryTerms(skillTags);
  const generatedTerms = mergeGeneratedTerms([...buildGlossaryTerms(uniqueReferences, hoverByUrl), ...skillTagTerms]);
  const skillTagKeys = new Set(skillTags.map(termKey));
  const rawTerms = mergeWithExistingTerms(generatedTerms, existing.terms || [], skillTagKeys);
  const BASIC_EXCLUDED_TERMS = new Set([
    "activate", "activated", "activates", "activating",
    "equipment",
    "item", "items",
    "normal", "magic", "rare", "unique",
    "normal item", "magic item", "rare item", "unique item",
    "vendor", "vendors",
    "life", "mana", "flask", "flasks",
    "life flask", "mana flask", "life flasks", "mana flasks",
    "level", "levels", "leveling", "levelled",
    "ground", "limit", "lose", "spread", "total", "type"
  ]);
  const terms = rawTerms.filter((t) => !BASIC_EXCLUDED_TERMS.has(t.term.toLowerCase()));
  const dictionary = {
    categories: {
      combat: "Chiến đấu",
      damage: "Sát thương & ailment",
      resource: "Tài nguyên",
      defense: "Phòng thủ",
      skill: "Skill & minion",
      item: "Trang bị & craft",
      endgame: "Endgame",
      ...(existing.categories || {})
    },
    terms,
    updated_at: new Date().toISOString().slice(0, 10),
    sources: {
      currency: DEFAULT_CURRENCY_SOURCE_URL,
      skill_gems: SKILL_SOURCE_URL,
      keyword_refs: uniqueReferences.length,
      keyword_tooltips: hoverByUrl.size
    }
  };

  writeDictionaryExport(dictionary);
  console.log(JSON.stringify({
    exportPath: EXPORT_PATH,
    terms: dictionary.terms.length,
    keywordRefs: uniqueReferences.length,
    keywordTooltips: hoverByUrl.size
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import fs from "node:fs";
import path from "node:path";

const rootDir = "d:/code1/poe2";
const dictPath = path.join(rootDir, "public/data/dictionary-data.js");
const passivePath = path.join(rootDir, "public/data/passive-tree-data.js");

// 1. Load dictionary terms
const dictContent = fs.readFileSync(dictPath, "utf8");
const dictJson = dictContent.replace("window.POE2_DICTIONARY_TERMS = ", "").replace(/;\s*$/, "");
const dictData = JSON.parse(dictJson);
const dictTerms = new Set(dictData.terms.map(t => t.term.toLowerCase()));

// Some basic English words we want to ignore in the check (mostly numbers, %, formatting)
const ignoreWords = new Set([
  "", "and", "or", "to", "with", "from", "for", "if", "when", "while", "against", "you", "your",
  "a", "an", "the", "in", "of", "on", "at", "by", "is", "are", "be", "been", "was", "were",
  "has", "have", "had", "not", "no", "any", "all", "each", "every", "per", "second", "seconds",
  "meter", "meters", "metres", "metre", "level", "levels", "percent", "tăng", "giảm", "nhận",
  "cấp", "bạn", "kẻ", "địch", "khi", "đứng", "yên", "không", "tức", "thời", "là", "trên",
  "dưới", "dạng", "bằng", "lên", "từ", "cho", "nếu", "trong", "thời", "gian", "hiệu", "ứng",
  "mục", "tiêu", "gần", "đây", "mỗi", "thêm", "sau", "tối", "đa"
]);

// 2. Load passive tree stats
const passiveContent = fs.readFileSync(passivePath, "utf8");
const passiveJson = passiveContent.replace("window.POE2_PASSIVE_TREE = ", "").replace(/;\s*$/, "");
const passiveData = JSON.parse(passiveJson);

const statsList = [];
for (const node of passiveData.nodes) {
  if (node.i18n && node.i18n.stats) {
    for (const stat of node.i18n.stats) {
      statsList.push(stat);
    }
  }
}

console.log(`Loaded ${statsList.length} passive stats.`);

// 3. Scan each stat and extract English words/phrases that are NOT in the dictionary terms
const untranslatedCandidates = new Map();

for (const stat of statsList) {
  const vi = stat.vi;
  const en = stat.en;
  
  // Find English words in the Vietnamese translation.
  // An English word contains only a-z A-Z, maybe hyphens, and is not a Vietnamese word.
  // Vietnamese words have accents or are standard Vietnamese.
  // Let's tokenise by non-alphabetic characters
  const tokens = vi.split(/[^a-zA-Z0-9'-]+/);
  
  for (const token of tokens) {
    const cleanToken = token.trim();
    if (!cleanToken) continue;
    
    // If it has digits, skip
    if (/\d/.test(cleanToken)) continue;
    
    const lower = cleanToken.toLowerCase();
    
    // Check if it's an English word (doesn't contain Vietnamese accented chars, which split would have separated anyway)
    // and is not in our ignore list
    if (ignoreWords.has(lower)) continue;
    
    // Check if it matches a dictionary term (either as a single word or as part of a term)
    let isDictTerm = false;
    for (const term of dictTerms) {
      if (term === lower || term.split(/\s+/).includes(lower)) {
        isDictTerm = true;
        break;
      }
    }
    
    if (!isDictTerm) {
      if (!untranslatedCandidates.has(lower)) {
        untranslatedCandidates.set(lower, { word: cleanToken, count: 0, examples: new Set() });
      }
      const entry = untranslatedCandidates.get(lower);
      entry.count++;
      if (entry.examples.size < 5) {
        entry.examples.add(`EN: "${en}" -> VI: "${vi}"`);
      }
    }
  }
}

const sortedCandidates = Array.from(untranslatedCandidates.values())
  .sort((a, b) => b.count - a.count);

console.log(`Found ${sortedCandidates.length} unique untranslated non-tooltip words.`);

// Write the first 100 candidates to console/file
const report = sortedCandidates.map(c => ({
  word: c.word,
  count: c.count,
  examples: Array.from(c.examples)
}));

fs.writeFileSync(path.join(rootDir, "scratch/untranslated-analysis.json"), JSON.stringify(report, null, 2));
console.log("Analysis written to scratch/untranslated-analysis.json");

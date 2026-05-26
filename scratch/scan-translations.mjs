import fs from "node:fs";
import path from "node:path";

const filePath = "d:/code1/poe2/public/data/passive-tree-data.js";
const content = fs.readFileSync(filePath, "utf-8");

// Since passive-tree-data.js is a JS file (likely assigning or exporting a JSON object),
// let's extract all the "stats" block or we can just parse it by regex.
// Each stat translation is like:
// {
//   "en": "...",
//   "vi": "..."
// }

const matches = [];
const regex = /"en":\s*"([^"]+)",\s*"vi":\s*"([^"]+)"/g;
let match;
while ((match = regex.exec(content)) !== null) {
  const en = match[1];
  const vi = match[2];
  matches.push({ en, vi });
}

console.log(`Found ${matches.length} translated stats.`);

// Let's find stats where the Vietnamese version still has english words that are typical modifiers.
// We can define a list of English words we want to detect.
const englishWords = [
  "damage", "speed", "crit", "critical", "chance", "duration", "rating", "recovery", "recently", "recent",
  "avoid", "leech", "stun", "recharge", "regen", "regeneration", "effect", "reduction", "threshold",
  "increased", "reduced", "more", "less", "exposure", "penetrate", "penetrates", "barrier", "ward",
  "block", "armour", "evasion", "energy shield", "mana", "life", "spirit", "rage", "darkness", "presence",
  "totem", "minion", "ally", "allies", "curse", "ailment", "poison", "bleed", "bleeding", "ignite",
  "shock", "chill", "freeze", "accuracy", "warcry", "projectile", "spell", "attack", "weapon", "melee"
];

// Words that we expect to keep in English (or not):
// Let's just find any words containing only a-z A-Z, longer than 2 characters, and not in Vietnamese dictionary.
// Or we can just check if they contain words in our list.
const results = [];
for (const item of matches) {
  const viLower = item.vi.toLowerCase();
  const enLower = item.en.toLowerCase();
  
  // Find which english keywords are in the Vietnamese translation
  const foundWords = englishWords.filter(word => {
    // Exact word boundary check
    const wordRegex = new RegExp(`\\b${word}\\b`, "i");
    return wordRegex.test(viLower);
  });
  
  if (foundWords.length > 0) {
    results.push({
      en: item.en,
      vi: item.vi,
      found: foundWords
    });
  }
}

console.log(`Found ${results.length} stats with remaining English words.`);

// Let's group by matched words to see patterns
const wordGroups = {};
for (const res of results) {
  for (const w of res.found) {
    if (!wordGroups[w]) wordGroups[w] = [];
    wordGroups[w].push(res);
  }
}

// Print some stats for each word
console.log("\n--- WORD COUNTS ---");
for (const [w, items] of Object.entries(wordGroups).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${w}: ${items.length} occurrences`);
}

// Write the first 5 examples of each word to a file for review
const reportFile = "d:/code1/poe2/scratch/translation-issues.json";
fs.writeFileSync(reportFile, JSON.stringify(wordGroups, null, 2));
console.log(`\nDetailed report written to ${reportFile}`);

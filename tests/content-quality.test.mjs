import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const leakedEnglishPronouns = /\b(it|its|itself)\b/i;

const loadBrowserData = (relativePath, globalName) => {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(join(repoRoot, relativePath), "utf8"), sandbox);
  return sandbox.window[globalName];
};

const collectViStrings = (value, path = "", rows = []) => {
  if (!value || typeof value !== "object") return rows;
  if (typeof value.vi === "string") rows.push([path ? `${path}.vi` : "vi", value.vi]);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectViStrings(entry, `${path}[${index}]`, rows));
    return rows;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "en" || key === "vi" || key === "name") continue;
    collectViStrings(entry, path ? `${path}.${key}` : key, rows);
  }
  return rows;
};

test("exported Vietnamese content does not leak literal English it/its pronouns", () => {
  const sources = [
    ["skill", loadBrowserData("public/data/skill-gems-data.js", "POE2_SKILL_GEMS").gems || []],
    ["currency", loadBrowserData("public/data/currency-data.js", "POE2_CURRENCY").items || []],
    ["items", loadBrowserData("public/data/items-data.js", "POE2_ITEMS").items || []]
  ];
  const dirty = [];

  for (const [sourceName, entries] of sources) {
    for (const entry of entries) {
      for (const [fieldPath, text] of collectViStrings(entry.i18n || {}, "i18n")) {
        if (leakedEnglishPronouns.test(text)) {
          dirty.push(`${sourceName}:${entry.slug || entry.name}.${fieldPath}: ${text}`);
        }
      }
    }
  }

  assert.equal(dirty.length, 0, dirty.slice(0, 30).join("\n"));
});

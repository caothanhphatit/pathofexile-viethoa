import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readRepoFile = (filename) => readFile(join(repoRoot, filename), "utf8");

async function loadTsModule(filename) {
  const source = await readRepoFile(filename);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  const sandbox = { module: { exports: {} }, exports: {} };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox);
  return sandbox.module.exports;
}

test("SPA locale helpers prefer raw English data when EN is active", async () => {
  const locale = await loadTsModule("src/spa/lib/locale.ts");

  assert.equal(locale.normalizeLocale("en-US"), "en");
  assert.equal(locale.localizedText({ vi: "Tăng 15% cơ hội gây Shock", en: "15% increased chance to Shock" }, "raw fallback", "en"), "15% increased chance to Shock");
  assert.equal(locale.localizedText({ vi: "Tăng 15% cơ hội gây Shock", en: "15% increased chance to Shock" }, "raw fallback", "vi"), "Tăng 15% cơ hội gây Shock");
  assert.deepEqual(locale.localizedList([{ vi: "Yêu cầu: Cấp 10", en: "Requires: Level 10" }], ["Requires: Level 10"], "en"), ["Requires: Level 10"]);
  assert.equal(
    locale.dictionaryMeaning({ meaning: "Chỉ số quyết định khả năng đánh trúng.", description_en: "Accuracy is used to hit a target with an Attack." }, "en"),
    "Accuracy is used to hit a target with an Attack."
  );
  assert.equal(
    locale.dictionaryMeaning({ meaning: "Chỉ số quyết định khả năng đánh trúng.", description_en: "Accuracy is used to hit a target with an Attack." }, "vi"),
    "Chỉ số quyết định khả năng đánh trúng."
  );
});

test("passive tree parser switches between translated stats and raw English stats", async () => {
  const treeModule = await loadTsModule("src/spa/passive/tree.ts");
  const raw = {
    nodes: [
      {
        id: "4",
        name: "Shock Chance",
        x: 10,
        y: 20,
        stats: ["15% increased chance to Shock"],
        stats_vi: ["Tăng 15% cơ hội gây Shock"]
      }
    ],
    edges: []
  };

  assert.deepEqual(treeModule.parsePassiveTree(raw, "en").nodes[0].stats, ["15% increased chance to Shock"]);
  assert.deepEqual(treeModule.parsePassiveTree(raw, "vi").nodes[0].stats, ["Tăng 15% cơ hội gây Shock"]);
});

test("SPA route rendering passes locale into data and passive pages", async () => {
  const [app, dataPages, passivePage] = await Promise.all([
    readRepoFile("src/spa/App.tsx"),
    readRepoFile("src/spa/pages/DataListPages.tsx"),
    readRepoFile("src/spa/pages/PassiveTreePage.tsx")
  ]);

  assert.match(app, /renderRoute\(route,\s*locale\)/);
  assert.match(dataPages, /SkillGemsPage\(\{\s*locale\s*\}/);
  assert.match(dataPages, /localizedText\(gem\.i18n\?\.summary,\s*gem\.summary_en,\s*locale\)/);
  assert.match(dataPages, /localizedList\(item\.i18n\?\.properties,\s*item\.properties,\s*locale\)/);
  assert.match(dataPages, /dictionaryMeaning\(term,\s*locale\)/);
  assert.match(passivePage, /parsePassiveTree\(raw,\s*locale\)/);
});

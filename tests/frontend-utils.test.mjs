import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const loadUtils = () => {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(join(repoRoot, "components", "poe-ui-utils.js"), "utf8"), sandbox);
  return sandbox.window.PoeUi;
};

test("frontend data pages share i18n, escaping, and currency helpers", () => {
  const utils = loadUtils();

  assert.equal(utils.escapeHtml(`<Chaos & "Orb">`), "&lt;Chaos &amp; &quot;Orb&quot;&gt;");
  assert.equal(utils.i18nText({ vi: "Tieng Viet", en: "English" }, "Fallback"), "Tieng Viet");
  assert.deepEqual(utils.i18nList([{ en: "A" }, { vi: "B" }], ["fallback A", "fallback B"]), ["A", "B"]);
  assert.equal(utils.truncateText("One two three four five", { maxLength: 14, minBoundary: 4 }), "One two...");
  assert.equal(utils.currencySubtype({ subtype: "crafting-orb", family: "currency" }), "crafting-orb");
  assert.equal(utils.currencySubtypeLabel({ subtype_label: "Crafting Orb" }), "Crafting Orb");
  assert.equal(utils.hasCurrencyDescription({ mods: ["Adds a modifier"] }), true);
  assert.equal(utils.hasCurrencyDescription({ name: "Albino Rhoa Feather", mods: [] }), false);
});

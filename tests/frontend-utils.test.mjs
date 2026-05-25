import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const loadUtils = () => {
  const storage = new Map();
  const listeners = {};
  const sandbox = {
    document: { documentElement: { lang: "vi", dataset: {} } },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    window: {
      addEventListener: (name, callback) => {
        listeners[name] = listeners[name] || [];
        listeners[name].push(callback);
      },
      dispatchEvent: (event) => {
        for (const callback of listeners[event.type] || []) callback(event);
      }
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    Intl
  };
  vm.runInNewContext(readFileSync(join(repoRoot, "public", "components", "poe-ui-utils.js"), "utf8"), sandbox);
  return { utils: sandbox.window.PoeUi, root: sandbox.document.documentElement };
};

test("frontend data pages share i18n, escaping, and currency helpers", () => {
  const { utils } = loadUtils();

  assert.equal(utils.escapeHtml(`<Chaos & "Orb">`), "&lt;Chaos &amp; &quot;Orb&quot;&gt;");
  assert.equal(utils.i18nText({ vi: "Tieng Viet", en: "English" }, "Fallback"), "Tieng Viet");
  assert.deepEqual(utils.i18nList([{ en: "A" }, { vi: "B" }], ["fallback A", "fallback B"]), ["A", "B"]);
  assert.equal(utils.truncateText("One two three four five", { maxLength: 14, minBoundary: 4 }), "One two...");
  assert.equal(utils.currencySubtype({ subtype: "crafting-orb", family: "currency" }), "crafting-orb");
  assert.equal(utils.currencySubtypeLabel({ subtype_label: "Crafting Orb" }), "Crafting Orb");
  assert.equal(utils.hasCurrencyDescription({ mods: ["Adds a modifier"] }), true);
  assert.equal(utils.hasCurrencyDescription({ name: "Albino Rhoa Feather", mods: [] }), false);
});

test("frontend locale helpers let users switch between Vietnamese and English", () => {
  const { utils, root } = loadUtils();
  let changedLocale = "";

  utils.onLocaleChange(({ locale }) => {
    changedLocale = locale;
  });

  assert.equal(utils.currentLocale(), "vi");
  assert.equal(utils.i18nText({ vi: "Tieng Viet", en: "English" }, "Fallback"), "Tieng Viet");

  utils.setLocale("en");

  assert.equal(utils.currentLocale(), "en");
  assert.equal(root.lang, "en");
  assert.equal(root.dataset.locale, "en");
  assert.equal(changedLocale, "en");
  assert.equal(utils.i18nText({ vi: "Tieng Viet", en: "English" }, "Fallback"), "English");
  assert.deepEqual(utils.i18nList([{ vi: "Mot", en: "One" }], []), ["One"]);
  assert.equal(utils.localeText("resetFilters"), "Reset filters");
  assert.equal(utils.formatNumber(1234), "1,234");
});

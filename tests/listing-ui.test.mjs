import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const readProjectFile = (filename) => readFile(join(repoRoot, "public", filename), "utf8");

test("currency listing defaults to crafting orbs and hides items without real descriptions", async () => {
  const html = await readProjectFile("currency.html");
  const detailHtml = await readProjectFile("currency_detail.html");

  assert.match(html, /components\/poe-ui-utils\.js/);
  assert.match(detailHtml, /components\/poe-ui-utils\.js/);
  assert.match(html, /const DEFAULT_SUBTYPE = "crafting-orb"/);
  assert.match(html, /hasCurrencyDescription/);
  assert.match(html, /params\.get\("subtype"\) \|\| params\.get\("family"\) \|\| DEFAULT_SUBTYPE/);
  assert.match(html, /subtypeFilter\.value = DEFAULT_SUBTYPE/);
  assert.match(html, /\(data\.items \|\| \[\]\)\.filter\(\(item\) => item\.status === "active" && hasCurrencyDescription\(item\)\)/);
  assert.doesNotMatch(html, /Currency item dùng để giao dịch, craft, nâng cấp hoặc mở nội dung/);
  assert.match(detailHtml, /rawItem/);
  assert.match(detailHtml, /hasCurrencyDescription\(rawItem\) \? rawItem : null/);
});

test("currency active filters and detail actions use the compact blue treatment", async () => {
  const html = await readProjectFile("currency.html");

  assert.match(html, /currency-cta/);
  assert.doesNotMatch(html, /currency-cta[^"]*\bw-full\b/);
  assert.match(html, /bg-blue-600/);
  assert.match(html, /border-blue-600/);
  assert.match(html, /ring-blue-300\/60/);
});

test("currency subtype switching keeps the grid painted through smooth in-page transitions", async () => {
  const html = await readProjectFile("currency.html");

  assert.match(html, /const runCurrencyRenderTransition/);
  assert.match(html, /document\.startViewTransition/);
  assert.match(html, /currencyGrid\.classList\.add\("is-filtering"\)/);
  assert.match(html, /view-transition-name:\s*currency-grid/);
  assert.match(html, /min-height:\s*min\(68vh,\s*760px\)/);
});

test("currency modal omits duplicated detail modifier lines", async () => {
  const html = await readProjectFile("currency.html");

  assert.doesNotMatch(html, /Dòng thuộc tính/);
  assert.doesNotMatch(html, /cmodalMods/);
  assert.doesNotMatch(html, /localizedMods/);
});

test("currency modal renders bidirectional related items without leaving the modal", async () => {
  const html = await readProjectFile("currency.html");
  const detailHtml = await readProjectFile("currency_detail.html");

  assert.match(html, /cmodalRelatedContainer/);
  assert.match(html, /renderRelatedCurrencyItems/);
  assert.match(html, /data-related-slug/);
  assert.match(html, /openCurrencyModal\(relatedSlug\)/);
  assert.match(detailHtml, /renderRelatedCurrencyItems/);
  assert.match(detailHtml, /related_items/);
});

test("skill gem card detail action sits on the label row instead of the card footer", async () => {
  const html = await readProjectFile("skill_gems.html");
  const detailHtml = await readProjectFile("skill_gem_detail.html");

  assert.match(html, /components\/poe-ui-utils\.js/);
  assert.match(detailHtml, /components\/poe-ui-utils\.js/);
  assert.match(html, /skill-card-label-row/);
  assert.match(html, /skill-card-detail/);
  assert.match(html, /skill-card-label-row[\s\S]*skill-card-detail[\s\S]*<h2/);
  assert.doesNotMatch(html, /<div class="mt-auto pt-5 flex justify-end">\s*<a class="skill-cta/);
});

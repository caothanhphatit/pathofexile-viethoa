import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const levelingHtml = readFileSync(new URL("../public/leveling.html", import.meta.url), "utf8");

test("classic leveling checklist labels completion controls clearly", () => {
  assert.match(levelingHtml, /Đánh dấu task đã xong/);
  assert.match(levelingHtml, /Đánh dấu xong các task bắt buộc trong khu này/);
  assert.match(levelingHtml, /<span>Xong bắt buộc<\/span>/);
  assert.doesNotMatch(levelingHtml, /tick bắt buộc/);
});

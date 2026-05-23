import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { isMainModule } from "../src/db/migrate.mjs";

test("migration CLI main-module check works with Windows file paths", () => {
  const moduleUrl = new URL("../src/db/migrate.mjs", import.meta.url);
  const modulePath = fileURLToPath(moduleUrl);

  assert.equal(isMainModule(moduleUrl.href, ["node", modulePath]), true);
  assert.equal(isMainModule(moduleUrl.href, ["node", "D:\\code1\\poe2\\other.mjs"]), false);
});

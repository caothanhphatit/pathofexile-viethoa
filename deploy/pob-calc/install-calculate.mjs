// Writes scripts/pob-calculate.lua into a PoB src folder with package paths relative to it
// (the same transform setup-pob-local.mjs uses on Windows). Used by the Dockerfile.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { localCalculateScript } from "../../scripts/setup-pob-local.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = process.argv[2];
if (!target) throw new Error("usage: install-calculate.mjs <pob src dir>");
const source = fs.readFileSync(path.join(root, "scripts", "pob-calculate.lua"), "utf8");
fs.writeFileSync(path.join(target, "calculate.lua"), localCalculateScript(source));
console.log(`calculate.lua installed in ${target}`);

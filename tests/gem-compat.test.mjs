import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");

function loadTsModule(relPath, mocks = {}) {
  const full = path.join(ROOT_DIR, relPath);
  const js = ts.transpileModule(fs.readFileSync(full, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText;
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: (spec) => {
      if (mocks[spec]) return mocks[spec];
      throw new Error(`Unexpected require: ${spec}`);
    }
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(js, sandbox);
  return sandbox.module.exports;
}

function loadWindowData(relPath, globalName) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT_DIR, relPath), "utf8"), ctx);
  return ctx.window[globalName];
}

const gemSuggest = loadTsModule("src/spa/lib/gemSuggest.ts");
const gemCompat = loadTsModule("src/spa/lib/gemCompat.ts", { "./gemSuggest": gemSuggest });
const compatData = loadWindowData("public/data/gem-compat-data.js", "POE2_GEM_COMPAT");
const gemsBundle = loadWindowData("public/data/skill-gems-data.js", "POE2_SKILL_GEMS");
const allSupports = gemsBundle.gems.filter((g) => g.gem_type === "support");
const byName = (name) => gemsBundle.gems.find((g) => g.name === name);

test("doesTypeExpressionMatch evaluates PoB postfix AND / OR / NOT expressions", () => {
  const { doesTypeExpressionMatch } = gemCompat;
  // 0 = AND, 1 = OR, 2 = NOT; sample types: 3 = Attack, 4 = Melee, 5 = Triggered
  assert.equal(doesTypeExpressionMatch([3, 4, 0], new Set([3, 4])), true);
  assert.equal(doesTypeExpressionMatch([3, 4, 0], new Set([3])), false);
  assert.equal(doesTypeExpressionMatch([3, 4, 1], new Set([4])), true);
  assert.equal(doesTypeExpressionMatch([3, 5, 2, 0], new Set([3])), true);
  assert.equal(doesTypeExpressionMatch([3, 5, 2, 0], new Set([3, 5])), false);
});

test("canSupportByPobRules accurately distinguishes valid vs invalid supports for Mace Strike, Fireball, and Spear Throw", () => {
  const { canSupportByPobRules } = gemCompat;

  // Mace Strike (melee attack strike)
  assert.equal(canSupportByPobRules("Mace Strike", "Brutality I", compatData), true);
  assert.equal(canSupportByPobRules("Mace Strike", "Armour Explosion", compatData), true);
  assert.equal(canSupportByPobRules("Mace Strike", "Bleed I", compatData), true);
  assert.equal(canSupportByPobRules("Mace Strike", "Rapid Attacks I", compatData), true);
  assert.equal(canSupportByPobRules("Mace Strike", "Spell Echo", compatData), false);
  assert.equal(canSupportByPobRules("Mace Strike", "Unleash", compatData), false);

  // Fireball (projectile spell, Unleashable — NOT Cascadable in PoE2)
  assert.equal(canSupportByPobRules("Fireball", "Unleash", compatData), true);
  assert.equal(canSupportByPobRules("Fireball", "Controlled Destruction", compatData), true);
  assert.equal(canSupportByPobRules("Fireball", "Concentrated Area", compatData), true);
  assert.equal(canSupportByPobRules("Fireball", "Spell Echo", compatData), false);
  assert.equal(canSupportByPobRules("Fireball", "Brink I", compatData), false);
  assert.equal(canSupportByPobRules("Fireball", "Close Combat I", compatData), false);

  // Comet (Cascadable area spell)
  assert.equal(canSupportByPobRules("Comet", "Spell Echo", compatData), true);

  // Spear Throw (projectile attack)
  assert.equal(canSupportByPobRules("Spear Throw", "Brutality I", compatData), true);
  assert.equal(canSupportByPobRules("Spear Throw", "Spell Echo", compatData), false);
});

test("recommendedSupportsForSkill returns official GGG recommendations from GGPK and valid tier buckets", () => {
  const { recommendedSupportsForSkill, supportTierBucket } = gemCompat;

  const maceStrike = byName("Mace Strike");
  const rec = recommendedSupportsForSkill(maceStrike, allSupports, compatData);
  assert.equal(rec.source, "ggpk");
  assert.ok(rec.items.length >= 8, `Expected >= 8 recommended supports for Mace Strike, got ${rec.items.length}`);
  assert.ok(rec.items.some((g) => g.name === "Rapid Attacks I"));
  assert.ok(rec.items.some((g) => g.name === "Bleed I"));

  assert.equal(supportTierBucket(byName("Ambush"), compatData), "1");
  assert.equal(supportTierBucket(byName("Armour Explosion"), compatData), "1");
  assert.equal(supportTierBucket(byName("Abiding Hex"), compatData), "2");
  assert.equal(supportTierBucket(byName("Ahn's Citadel"), compatData), "lineage");
});

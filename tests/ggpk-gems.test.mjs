import assert from "node:assert/strict";
import { test } from "node:test";
import { compareGems, extractGems, plainText } from "../scripts/ggpk/extract-gems.mjs";

// Small synthetic tables shaped like the decoded GGPK rows (foreign keys are row indexes).
const TABLES = {
  ItemClasses: [
    { Id: "Active Skill Gem", Name: "Skill Gems" },
    { Id: "Support Skill Gem", Name: "Support Gems" },
    { Id: "Meta Skill Gem", Name: "" },
    { Id: "Ring", Name: "Rings" }
  ],
  BaseItemTypes: [
    { Id: "Metadata/Items/Gem/SkillGemFireball", Name: "Fireball", ItemClass: 0 },
    { Id: "Metadata/Items/Gems/SupportGemArbitersReach", Name: "Arbiter's Reach", ItemClass: 1 },
    { Id: "Metadata/Items/Gems/SkillGemCastOnShock", Name: "Cast on Shock", ItemClass: 2 },
    { Id: "Metadata/Items/Rings/Ring1", Name: "Iron Ring", ItemClass: 3 },
    { Id: "Metadata/Items/Gems/SkillGemAxeChop", Name: "[DNT-UNUSED] Axe Chop", ItemClass: 0 },
    { Id: "Metadata/Items/Gems/SkillGemSummonBeast", Name: "Companion: {0}", ItemClass: 0 },
    { Id: "Metadata/Items/Gems/SkillGemUnknown1", Name: "Coming Soon", ItemClass: 0 },
    { Id: "Metadata/Items/Gem/SupportGemNadir", Name: "Nadir", ItemClass: 1 }
  ],
  SkillGems: [
    { BaseItemType: 0, GemColour: 3, StrengthRequirementPercent: 0, DexterityRequirementPercent: 0, IntelligenceRequirementPercent: 100, CraftingLevel: 3, Tier: 0, MinLevelReq: 7, GemEffects: [0] },
    { BaseItemType: 1, GemColour: 4, StrengthRequirementPercent: 0, DexterityRequirementPercent: 0, IntelligenceRequirementPercent: 0, CraftingLevel: 0, Tier: 0, MinLevelReq: 65, GemEffects: [1] },
    { BaseItemType: 2, GemColour: 3, StrengthRequirementPercent: 0, DexterityRequirementPercent: 0, IntelligenceRequirementPercent: 100, CraftingLevel: 0, Tier: 0, MinLevelReq: 1, GemEffects: [] },
    { BaseItemType: 4, GemColour: 1, GemEffects: [] },
    { BaseItemType: 5, GemColour: 4, GemEffects: [] },
    { BaseItemType: 6, GemColour: 3, GemEffects: [] },
    { BaseItemType: 7, GemColour: 3, GemEffects: [2] }
  ],
  GemEffects: [
    { Id: "Fireball", GrantedEffect: 0, SupportText: "", SupportName: "", GemTags: [0, 1, 2, 3], AdditionalGrantedEffects: [] },
    { Id: "ArbitersReachSupport", GrantedEffect: 1, SupportText: "Supports [Persistent|Persistent] [Buff] Skills.", SupportName: "", GemTags: [4], AdditionalGrantedEffects: [] },
    { Id: "NadirSupport", GrantedEffect: 1, SupportText: "[DNT-UNUSED] Supports Skills which gain Stages.", SupportName: "", GemTags: [4], AdditionalGrantedEffects: [] }
  ],
  GemTags: [
    { Id: "intelligence", Name: "" },
    { Id: "spell", Name: "[Spell]" },
    { Id: "area", Name: "[AoESkill|AoE]" },
    { Id: "fire", Name: "[Fire]" },
    { Id: "support", Name: "[SupportGem|Support]" }
  ],
  ActiveSkills: [
    { Id: "fireball", DisplayedName: "Fireball", Description: "Launch a large ball of [Fire|Fire]." }
  ],
  GrantedEffects: [
    { Id: "FireballPlayer", IsSupport: false, CastTime: 1200, ActiveSkill: 0, StatSet: 0, AdditionalStatSets: [1], CostTypes: [0] },
    { Id: "ArbitersReachWardPlayer", IsSupport: true, CastTime: 0, ActiveSkill: null, StatSet: 2, AdditionalStatSets: [], CostTypes: [] }
  ],
  GrantedEffectsPerLevel: [
    { GrantedEffect: 0, Level: 2, CostMultiplier: 100, Cooldown: 0, StoredUses: 0, Reservation: 0, CostAmounts: [12] },
    { GrantedEffect: 0, Level: 1, CostMultiplier: 100, Cooldown: 0, StoredUses: 0, Reservation: 0, CostAmounts: [10] },
    { GrantedEffect: 1, Level: 1, CostMultiplier: 100, Cooldown: 4000, StoredUses: 1, Reservation: 30, CostAmounts: [] }
  ],
  GrantedEffectStatSets: [
    { Id: "FireballPlayer", ImplicitStats: [0], ConstantStats: [1], ConstantStatsValues: [120], BaseEffectiveness: 2.6, IncrementalEffectiveness: 0.13 },
    { Id: "FireballRing", ImplicitStats: [], ConstantStats: [], ConstantStatsValues: [], BaseEffectiveness: 1, IncrementalEffectiveness: 0 },
    { Id: "ArbitersReachPlayer", ImplicitStats: [], ConstantStats: [5], ConstantStatsValues: [4000], BaseEffectiveness: 1, IncrementalEffectiveness: 0 }
  ],
  GrantedEffectStatSetsPerLevel: [
    { StatSet: 0, GemLevel: 1, SpellCritChance: 700, AttackCritChance: 0, FloatStats: [2, 3], BaseResolvedValues: [8, 12], FloatStatsValues: [0.8, 1.2], AdditionalStats: [4], AdditionalStatsValues: [5], AdditionalFlags: [0] },
    { StatSet: 1, GemLevel: 1, SpellCritChance: 0, AttackCritChance: 0, FloatStats: [], BaseResolvedValues: [], AdditionalStats: [], AdditionalStatsValues: [], AdditionalFlags: [] }
  ],
  Stats: [
    { Id: "base_is_projectile" },
    { Id: "projectile_maximum_range_override" },
    { Id: "spell_minimum_base_fire_damage" },
    { Id: "spell_maximum_base_fire_damage" },
    { Id: "base_projectile_speed_+%" },
    { Id: "support_mothers_ward_base_duration_ms" },
    { Id: "base_mana_cost" }
  ],
  CostTypes: [
    { Id: "Mana", Stat: 6, FormatText: "{0} Mana", Divisor: 1, PerMinute: false }
  ]
};

const db = {
  rows: (name) => TABLES[name].map((row, _index) => ({ _index, ...row })),
  ref: (name, index) => (index === null || index === undefined ? null : TABLES[name][index] ? { _index: index, ...TABLES[name][index] } : null)
};

test("plainText strips the game's keyword markup", () => {
  assert.equal(plainText("[AoESkill|AoE]"), "AoE");
  assert.equal(plainText("Launch a ball of [Fire|Fire] and [Consume] it"), "Launch a ball of Fire and Consume it");
});

test("extractGems keeps only gem classes and resolves effects, levels and stats", () => {
  const { gems, costTypes } = extractGems(db);
  const byName = new Map(gems.map((gem) => [gem.name, gem]));
  assert.ok(!byName.has("Iron Ring"));
  assert.equal(gems.length, 7);

  const fireball = byName.get("Fireball");
  assert.equal(fireball.id, "Metadata/Items/Gem/SkillGemFireball");
  assert.equal(fireball.gem_type, "skill");
  assert.equal(fireball.color, "blue");
  assert.equal(fireball.tier, 3);
  assert.deepEqual(fireball.requirement_percent, { str: 0, dex: 0, int: 100 });
  assert.deepEqual(fireball.tags, ["Spell", "AoE", "Fire"]);
  assert.equal(fireball.active_skill.name, "Fireball");
  assert.equal(fireball.active_skill.description, "Launch a large ball of Fire.");
  assert.equal(fireball.cast_time_ms, 1200);
  assert.equal(fireball.max_level, 2);
  assert.equal(fireball.excluded, undefined);

  const effect = fireball.effects[0];
  assert.deepEqual(effect.levels, [{ level: 1, cost: { Mana: 10 } }, { level: 2, cost: { Mana: 12 } }]);
  assert.equal(effect.stat_sets.length, 2);
  const set = effect.stat_sets[0];
  assert.deepEqual(set.constant_stats, { projectile_maximum_range_override: 120 });
  assert.deepEqual(set.implicit_stats, ["base_is_projectile"]);
  assert.deepEqual(set.levels[0].stats, {
    spell_minimum_base_fire_damage: 8,
    spell_maximum_base_fire_damage: 12,
    "base_projectile_speed_+%": 5,
    base_is_projectile: 1
  });
  assert.equal(set.levels[0].spell_crit_chance, 700);
  assert.deepEqual(costTypes.Mana, { stat: "base_mana_cost", format: "{0} Mana", divisor: 1, per_minute: false });

  const support = byName.get("Arbiter's Reach");
  assert.equal(support.gem_type, "support");
  assert.equal(support.color, "item");
  assert.equal(support.tier, null);
  assert.equal(support.support_text, "Supports Persistent Buff Skills.");
  assert.equal(support.spirit, 30);
  assert.deepEqual(support.effects[0].levels[0], { level: 1, cooldown_ms: 4000, stored_uses: 1, spirit: 30 });

  const meta = byName.get("Cast on Shock");
  assert.equal(meta.gem_kind, "meta");
  assert.equal(meta.gem_type, "skill");
});

test("extractGems marks DNT, template and placeholder gems as excluded", () => {
  const { gems } = extractGems(db);
  const reason = Object.fromEntries(gems.map((gem) => [gem.name, gem.excluded || ""]));
  assert.equal(reason["[DNT-UNUSED] Axe Chop"], "dnt");
  assert.equal(reason["Companion: {0}"], "ignored-name");
  assert.equal(reason["Coming Soon"], "placeholder");
  assert.equal(reason.Nadir, "dnt");
  assert.equal(reason.Fireball, "");
});

test("compareGems matches by official_id then name and reports disagreements", () => {
  const { gems } = extractGems(db);
  const web = [
    { name: "Fireball", official_id: "Metadata/Items/Gem/SkillGemFireball", gem_type: "skill", color: "blue", tags: ["Spell", "AoE", "Projectile"] },
    { name: "Arbiter's Reach", gem_type: "support", color: "blue", tags: ["Support"] },
    { name: "Nadir", official_id: "Metadata/Items/Gem/SupportGemNadir", gem_type: "support", color: "blue", tags: [] },
    { name: "Ghost Gem", official_id: "Metadata/Items/Gems/Ghost", gem_type: "skill", color: "red", tags: [] }
  ];
  const report = compareGems(gems, web);
  assert.equal(report.counts.matched, 2);
  assert.equal(report.counts.matched_by_id, 1);
  assert.equal(report.counts.matched_by_name, 1);
  assert.deepEqual(report.onlyInGame.map((g) => g.name), ["Cast on Shock"]);
  assert.deepEqual(report.onlyInWeb.map((g) => g.name), ["Ghost Gem"]);
  assert.deepEqual(report.webExcluded.map((g) => g.name), ["Nadir"]);
  assert.deepEqual(report.tagDiffs, [{ name: "Fireball", id: "Metadata/Items/Gem/SkillGemFireball", only_game: ["Fire"], only_web: ["Projectile"] }]);
  assert.deepEqual(report.colourDiffs.map((d) => [d.name, d.game, d.web]), [["Arbiter's Reach", "item", "blue"]]);
  assert.equal(report.typeDiffs.length, 0);
});

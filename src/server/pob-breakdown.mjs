// Stat breakdowns for the Build Planner ("where does this number come from").
//
// The planner adds `analysis: { breakdown: ["Life", ...] }` to a POST
// /api/builds/calculate body. buildPobXml() then puts a
//   <PlannerRequest breakdown="Life,..."/>
// element in the build XML, and the "STAT BREAKDOWN" block of
// scripts/pob-calculate.lua answers it in the same PoB run with, for each stat,
// PoB's own breakdown lines and the modifiers behind it (BASE / INC / MORE, value,
// mod name, and where it comes from: item, passive node, gem, quest, base).

/** Stats the planner can ask PoB to explain (BREAKDOWN_MODS in scripts/pob-calculate.lua). */
export const BREAKDOWN_STATS = [
  "Life", "Mana", "Spirit", "EnergyShield", "Armour", "Evasion",
  "FireResist", "ColdResist", "LightningResist", "ChaosResist",
  "LifeRegenRecovery", "ManaRegenRecovery", "EffectiveMovementSpeedMod", "BlockChance", "EvadeChance",
  "CritChance", "CritMultiplier", "Speed", "HitChance", "CombinedDPS", "TotalDPS", "AverageDamage"
];

/** The <PlannerRequest> element for a body's `analysis`, or "" when it asks for nothing known. */
export function plannerRequestXml(analysis) {
  if (!analysis || typeof analysis !== "object") return "";
  const stats = [...new Set((Array.isArray(analysis.breakdown) ? analysis.breakdown : []).filter((stat) => BREAKDOWN_STATS.includes(stat)))];
  if (!stats.length) return "";
  return `\n\t<PlannerRequest breakdown="${stats.join(",")}"/>`;
}

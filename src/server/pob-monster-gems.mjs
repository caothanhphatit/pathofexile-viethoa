// Which gems pick a monster in Path of Building, without the monster list itself (that
// is pob-monsters.mjs, ~60 KB, loaded when a selector opens).
//
// How PoB stores the choice (Modules/Build.lua, Modules/CalcActiveSkill.lua):
//   - the gem is "Spectre: {0}" (SkillGemSummonSpectre) or "Companion: {0}"
//     (SkillGemSummonBeast); which one is read from the name of its granted effect;
//   - the build keeps a library of monsters under <Build>: <Spectre id=".."/> and
//     <BeastCompanion id=".."/>; the gem's minion list is that library;
//   - the gem's skillMinion attribute picks one of them.
// The planner keeps the pick in the gem's pobAttrs.skillMinion; pob-build-xml.mjs writes
// the library from the imported build plus every picked monster.
import { resolvePobGem } from "./pob-gem-ids.mjs";

/** PoB's two monster gems, as its Gems.lua lists them. */
export const MONSTER_GEMS = {
  spectre: { gemId: "Metadata/Items/Gems/SkillGemSummonSpectre", skillId: "SummonSpectrePlayer", variantId: "SummonSpectre", prefix: "Spectre" },
  beast: { gemId: "Metadata/Items/Gems/SkillGemSummonBeast", skillId: "SummonBeastPlayer", variantId: "SummonBeast", prefix: "Companion" }
};

/**
 * The game's gems that become one of those once a monster is bound: Bind Spectre turns
 * into "Spectre: <monster>", Tame Beast into "Companion: <monster>". PoB has no gem for a
 * Bind Spectre without a monster, so picking a monster on such a card makes it PoB's gem.
 */
const BINDING_GEMS = { skillgembindspectre: "spectre", skillgemtamebeast: "beast" };

const idTail = (id) => String(id || "").split("/").pop().toLowerCase();

/**
 * Which library a gem picks its monster from: "spectre", "beast" or null.
 * `gem` is { pobGemId, skillId, nameSpec } as the planner keeps it.
 */
export const monsterLibraryOf = (gem) => {
  if (!gem) return null;
  for (const id of [gem.pobGemId, gem.skillId]) {
    const tail = idTail(id);
    if (!tail) continue;
    if (tail === idTail(MONSTER_GEMS.spectre.gemId)) return "spectre";
    if (tail === idTail(MONSTER_GEMS.beast.gemId)) return "beast";
    if (BINDING_GEMS[tail]) return BINDING_GEMS[tail];
  }
  // As PoB does: by the name of the gem ("Spectre: ..." / "Companion: ...").
  const name = resolvePobGem(gem.pobGemId || gem.skillId, gem.nameSpec)?.name || String(gem.nameSpec || "");
  if (/^Spectre:/.test(name)) return "spectre";
  if (/^Companion:/.test(name)) return "beast";
  return null;
};

/** "Companion: Elephant Tortoise" when the gem names its monster, else "". */
export const monsterGemTitle = (gem) => {
  const name = String(gem?.nameSpec || "");
  return monsterLibraryOf(gem) && /^(Spectre|Companion): (?!\{)\S/.test(name) ? name : "";
};

// Short lists of gems worth trying in a skill group: supports whose tags and
// description fit the skill (Spell, Fire... and "more damage"), and other skills
// like the current one. The Planner then asks Path of Building how each one
// changes damage, so this list only has to be a good first guess.

export interface GemTagRecord {
  name?: string;
  tags?: string[];
  summary_en?: string;
}

const GENERIC_TAGS = new Set(["support", "lineage", "repeatable", "payoff", "conditional"]);
/** Tags naming what kind of skill a support is for. */
const KIND_TAGS = new Set(["minion", "attack", "melee", "spell", "projectile", "totem", "trap", "mark", "warcry", "curse", "aura", "herald", "companion", "channelling", "grenade", "ammunition", "strike", "slam", "shapeshift", "command"]);
/** Descriptions of supports that raise the skill's damage. */
const DAMAGE_TEXT = /\b(more|increased|boosting|extra)\b[^.]{0,40}\bdamage\b|\bdamage\b[^.]{0,25}\bmore\b|additional level|as extra|penetrat|critical hit/i;
/** Supports that only work on skills the player uses by hand. */
const SELF_CAST_TEXT = /\b(cast|use)\b[^.]{0,10}\byourself\b|leap into the air/i;

const tagSet = (tags: string[] | undefined) => new Set((tags ?? []).map((tag) => tag.toLowerCase()).filter((tag) => !GENERIC_TAGS.has(tag)));

/** Shared meaningful tags between a skill and a gem (0 = nothing in common). */
export function tagOverlap(skillTags: string[] | undefined, gemTags: string[] | undefined): number {
  const skill = tagSet(skillTags);
  let count = 0;
  for (const tag of tagSet(gemTags)) if (skill.has(tag)) count += 1;
  return count;
}

export interface GemCandidateOptions {
  /** Names already in the group. */
  exclude?: Iterable<string>;
  limit?: number;
  /** The skill is triggered by a meta gem (Cast on ...), not used by hand. */
  triggered?: boolean;
}

/** How promising a gem is for the skill; 0 or less = not worth trying. */
export function gemScore(skillTags: string[] | undefined, gem: GemTagRecord, options: Pick<GemCandidateOptions, "triggered"> = {}): number {
  const tags = tagSet(gem.tags);
  const skill = tagSet(skillTags);
  const summary = gem.summary_en ?? "";
  // Supports that work with anything rank below matching ones but are still worth a look.
  let score = tags.size ? tagOverlap(skillTags, gem.tags) : 0.5;
  if (DAMAGE_TEXT.test(summary)) score += 2;
  // "Trigger" supports add a separate triggered effect instead of boosting the skill.
  if (tags.has("trigger") && !skill.has("trigger")) score -= 2;
  // A support made for another kind of skill (minions, attacks, totems...) does not apply.
  score -= [...tags].filter((tag) => KIND_TAGS.has(tag) && !skill.has(tag)).length * 2;
  if (options.triggered && SELF_CAST_TEXT.test(summary)) score -= 3;
  return score;
}

/** Up to `limit` gems most worth trying, best first (ties by name). */
export function gemCandidates<T extends GemTagRecord>(skillTags: string[] | undefined, gems: T[], options: GemCandidateOptions = {}): T[] {
  const exclude = new Set([...(options.exclude ?? [])].map((name) => name.toLowerCase()));
  return gems
    .filter((gem) => gem.name && !exclude.has(gem.name.toLowerCase()))
    .map((gem) => ({ gem, score: gemScore(skillTags, gem, options) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || String(a.gem.name).localeCompare(String(b.gem.name)))
    .slice(0, options.limit ?? 10)
    .map((row) => row.gem);
}

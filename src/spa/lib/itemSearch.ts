// Ranking for the planner's "Tìm đồ" box. A plain substring search put "Wanderer
// Armour" above every wand for the query "wand": a whole word of the name, or the
// item's class ("Wands"), now beats a word that merely starts with the query.

export interface SearchableItem {
  /** The item's name ("Acrid Wand", "Adonia's Ego"). */
  title: string;
  /** Its base type, when the name is not the base (uniques). */
  base?: string;
  /** Its class as the site lists it ("Wands", "Two Hand Maces"). */
  itemClass?: string;
}

const normalize = (value: string | undefined) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

/** "wands" -> "wand", "staves" -> "staff", "maces" -> "mace", "foci" -> "focus". */
const singular = (word: string) => {
  if (word === "staves") return "staff";
  if (word === "quarterstaves") return "quarterstaff";
  if (word === "foci") return "focus";
  if (word.length > 3 && word.endsWith("es") && /(?:sh|ch|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
};

/**
 * How well an item answers a query: 0 the name itself, 1 a whole word of the name or
 * base or the item's class, 2 the name starts with it, 3 a word starts with it,
 * 4 it appears somewhere; null when it does not match. Every word of the query must match.
 */
export function itemSearchRank(item: SearchableItem, query: string): number | null {
  const wanted = normalize(query);
  if (!wanted) return 0;
  const title = normalize(item.title);
  const base = normalize(item.base);
  const itemClass = normalize(item.itemClass);
  if (title === wanted) return 0;
  const words = [...title.split(" "), ...base.split(" ")].filter(Boolean);
  const classWords = itemClass.split(" ").filter(Boolean).map(singular);
  const classLabel = classWords.join(" ");
  let worst = 0;
  for (const part of wanted.split(" ")) {
    const one = singular(part);
    let rank: number;
    if (words.includes(part) || words.includes(one) || classWords.includes(one)) rank = 1;
    else if (title.startsWith(part)) rank = 2;
    else if (words.some((word) => word.startsWith(part))) rank = 3;
    else if (title.includes(part) || base.includes(part) || itemClass.includes(part)) rank = 4;
    else return null;
    worst = Math.max(worst, rank);
  }
  // The whole query names the class ("two hand mace", "body armour").
  if (worst > 1 && classLabel && singular(wanted.split(" ").map(singular).join(" ")) === classLabel) return 1;
  return worst;
}

/** Items matching a query, best first; equal ranks keep the order they came in. */
export function searchItems<T>(items: T[], query: string, describe: (item: T) => SearchableItem, limit = 12): T[] {
  return items
    .map((item, index) => ({ item, index, rank: itemSearchRank(describe(item), query) }))
    .filter((row): row is { item: T; index: number; rank: number } => row.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((row) => row.item);
}

/** How many items match at all (to say what a slot filter is hiding). */
export function countMatches<T>(items: T[], query: string, describe: (item: T) => SearchableItem): number {
  return items.reduce((total, item) => total + (itemSearchRank(describe(item), query) === null ? 0 : 1), 0);
}

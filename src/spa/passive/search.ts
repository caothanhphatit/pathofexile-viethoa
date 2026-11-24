// Finding passive nodes by name or stat text, in Vietnamese or English, with or without
// Vietnamese accents ("sat thuong" finds "sát thương"). Pure (no imports).

export interface SearchableNode {
  id: string;
  name: string;
  type: string;
  stats: string[];
  /** Other text the node can be found by (English stats on a Vietnamese tree, and back). */
  searchText?: string;
  x: number;
  y: number;
}

/** Lower case, no accents, đ -> d, PoE markup ([Key|Label]) and extra spaces removed. */
export function foldSearchText(value: unknown): string {
  return String(value ?? "")
    .replace(/\[([^\]|]*)\|([^\]]*)\]/g, (_m, key: string, label: string) => label || key)
    .replace(/[[\]]/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const typeRank = (type: string) => /keystone/i.test(type) ? 0 : /notable/i.test(type) ? 1 : /jewel/i.test(type) ? 2 : 3;

/**
 * Nodes whose name, type or stats hold every word of the query. Keystones and notables
 * come first, then nodes nearest the tree's centre, so "next" walks the useful ones first.
 */
export function searchTreeNodes<T extends SearchableNode>(nodes: Iterable<T>, query: string): T[] {
  const terms = foldSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return [];
  const found: T[] = [];
  for (const node of nodes) {
    const haystack = foldSearchText([node.name, node.type, ...node.stats, node.searchText ?? ""].join(" "));
    if (terms.every((term) => haystack.includes(term))) found.push(node);
  }
  return found.sort((a, b) => typeRank(a.type) - typeRank(b.type)
    || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The next (step 1) or previous (step -1) match index, wrapping around; -1 when there are none. */
export function stepMatchIndex(current: number, count: number, step: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return step > 0 ? 0 : count - 1;
  return (current + step + count) % count;
}

export const cleanText = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

export const lowerText = (value: unknown) => cleanText(value).toLowerCase();

export function matchesQuery(row: unknown, query: string, fields: string[]): boolean {
  const terms = lowerText(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const source = fields.map((field) => {
    const value = (row as Record<string, unknown>)?.[field];
    return Array.isArray(value) ? value.join(" ") : value;
  }).map(lowerText).join(" ");
  return terms.every((term) => source.includes(term));
}

export function stripMarkup(value: unknown): string {
  return cleanText(value).replace(/<[^>]+>/g, "");
}

export function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

// Undo / redo of passive tree edits (allocate, refund, attribute picks, weapon-set nodes).
// Each entry is the whole edit state before a change, so undo puts back exactly the node
// set a refund took away (a refund also drops every node that hung on the refunded one).
// Pure (no imports) so tests can load it on its own.

export interface TreeEditState {
  /** Allocated node ids, sorted. */
  allocatedIds: string[];
  weaponSets: Record<string, 1 | 2>;
  attributeChoices: Record<string, string>;
}

export interface EditHistory<T> {
  past: T[];
  future: T[];
  limit: number;
}

export const HISTORY_LIMIT = 100;

const sortedRecord = <V>(record: Record<string, V> | null | undefined): Record<string, V> =>
  Object.fromEntries(Object.entries(record ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** The edit state of a tree, in a stable shape (sorted ids and keys). */
export function treeEditState(
  allocatedIds: Iterable<string>,
  weaponSets?: Record<string, 1 | 2> | null,
  attributeChoices?: Record<string, string> | null
): TreeEditState {
  return {
    allocatedIds: [...new Set(allocatedIds)].sort(),
    weaponSets: sortedRecord(weaponSets),
    attributeChoices: sortedRecord(attributeChoices)
  };
}

export function sameTreeEditState(a: TreeEditState, b: TreeEditState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createHistory<T>(limit = HISTORY_LIMIT): EditHistory<T> {
  return { past: [], future: [], limit: Math.max(1, limit) };
}

export const canUndo = (history: EditHistory<unknown>) => history.past.length > 0;
export const canRedo = (history: EditHistory<unknown>) => history.future.length > 0;

/**
 * An edit went from `before` to `after`: `before` becomes the undo step and the redo
 * steps are dropped. An edit that changed nothing leaves the history as it is.
 */
export function recordEdit<T>(history: EditHistory<T>, before: T, after: T, same: (a: T, b: T) => boolean): EditHistory<T> {
  if (same(before, after)) return history;
  const past = [...history.past, before];
  return { past: past.slice(Math.max(0, past.length - history.limit)), future: [], limit: history.limit };
}

/** Back one step from `current`: the state to show and the new history; null when there is none. */
export function undoEdit<T>(history: EditHistory<T>, current: T): { history: EditHistory<T>; state: T } | null {
  if (!history.past.length) return null;
  const state = history.past[history.past.length - 1];
  return { state, history: { past: history.past.slice(0, -1), future: [current, ...history.future], limit: history.limit } };
}

/** Forward one step from `current` (after an undo); null when there is none. */
export function redoEdit<T>(history: EditHistory<T>, current: T): { history: EditHistory<T>; state: T } | null {
  if (!history.future.length) return null;
  const [state, ...future] = history.future;
  return { state, history: { past: [...history.past, current], future, limit: history.limit } };
}

/** Which key press is undo or redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y); null for others. */
export function historyKeyAction(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}

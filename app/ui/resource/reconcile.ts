// Incremental list reconcile — the equivalent of Lens's KubeObjectStore merge.
// A watch delivers one object at a time; rather than re-fetching the whole list
// on every event, upsert/remove that single row by its stable key. Pure and
// non-mutating so it is trivially testable and safe to run in a reducer.
export type WatchEventType = "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK" | "ERROR";

/**
 * Apply one watch event to the current rows, keyed by `keyOf`:
 *   ADDED / MODIFIED → upsert (replace an existing key, else append)
 *   DELETED          → remove the matching key
 *   BOOKMARK / ERROR → no change (returns the same array reference)
 * The input array is never mutated.
 */
export function reconcile<T>(
  rows: readonly T[],
  type: WatchEventType,
  item: T,
  keyOf: (row: T) => string,
): readonly T[] {
  const key = keyOf(item);
  switch (type) {
    case "ADDED":
    case "MODIFIED": {
      const index = rows.findIndex(r => keyOf(r) === key);
      if (index === -1) return [...rows, item];
      const next = rows.slice();
      next[index] = item;
      return next;
    }
    case "DELETED": {
      const next = rows.filter(r => keyOf(r) !== key);
      return next.length === rows.length ? rows : next;
    }
    default:
      return rows;
  }
}

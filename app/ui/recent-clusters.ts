import { useSyncExternalStore } from "react";

/**
 * Recently opened clusters, most recent first.
 *
 * The sidebar carries a Recent group beside its favourites, and the two answer
 * different questions: favourites are what you chose to keep,
 * recents are where you actually were. On a fleet where most clusters are opened
 * once and never pinned, the second is the more useful list.
 *
 * Capped at five. A longer list stops being "recent" and starts being a second,
 * worse copy of the catalogue.
 */
const KEY = "hd-recent-clusters";
const LIMIT = 5;

const listeners = new Set<() => void>();
let cache: readonly string[] = read();

function read(): readonly string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

/** Record a visit. Most recent first, no duplicates, oldest dropped past the cap. */
export function recordRecentCluster(id: string): void {
  if (!id) return;
  const next = [id, ...cache.filter(x => x !== id)].slice(0, LIMIT);
  if (next.length === cache.length && next.every((x, i) => x === cache[i])) return;
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  for (const listener of listeners) listener();
}

/** Drop a cluster from the list — for when its profile is forgotten. */
export function forgetRecentCluster(id: string): void {
  if (!cache.includes(id)) return;
  cache = cache.filter(x => x !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The snapshot is cached by identity so useSyncExternalStore does not see a new
// array on every render and loop.
export function useRecentClusters(): readonly string[] {
  return useSyncExternalStore(
    subscribe,
    () => cache,
    () => cache,
  );
}

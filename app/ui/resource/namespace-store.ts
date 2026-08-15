import { useSyncExternalStore } from "react";

// A cluster-wide namespace selection, shared across every resource list so the
// filter scopes the whole app (Freelens's global NamespaceSelect) rather than
// resetting per page. Persisted so it survives reloads.
const KEY = "hd-namespace-filter";

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

let selected: string[] = load();
let snapshot: ReadonlySet<string> = new Set(selected);
const subscribers = new Set<() => void>();

export function setSelectedNamespaces(next: ReadonlySet<string>): void {
  selected = [...next];
  snapshot = new Set(selected);
  try {
    localStorage.setItem(KEY, JSON.stringify(selected));
  } catch {
    /* non-fatal */
  }
  subscribers.forEach(fn => fn());
}

/** Subscribe a component to the shared namespace selection. */
export function useSelectedNamespaces(): ReadonlySet<string> {
  return useSyncExternalStore(
    cb => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    () => snapshot,
    () => snapshot,
  );
}

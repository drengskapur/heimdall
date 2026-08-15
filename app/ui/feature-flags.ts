import { useSyncExternalStore } from "react";

/**
 * Feature flags for surfaces that are new enough to want an off switch.
 *
 * Deliberately small, and deliberately not a general configuration system. A
 * flag earns its place when a feature is (a) new, and (b) separable at a clean
 * boundary — its own app, its own tab, its own panel — so that turning it off
 * removes it entirely rather than leaving a stub. A flag over something woven
 * through the app would be a way to ship two products at once.
 *
 * Flags default **on**: a feature shipped off by default is a feature nobody
 * sees, and the switch exists so that something noisy or slow can be put away
 * without waiting for a release. `defaultOff` is the exception, for a surface
 * that is not ready to be the first thing someone meets.
 *
 * Only choices that *differ from the default* are stored, so a flag added later
 * needs no migration and a flag reset to its default leaves nothing behind.
 */
export interface FeatureFlag {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Ships off; someone has to turn it on. Omit for the usual on-by-default. */
  readonly defaultOff?: boolean;
}

export const FEATURE_FLAGS: readonly FeatureFlag[] = [
  {
    id: "topology",
    label: "Topology",
    description:
      "An ownership graph of the cluster's workloads, as its own application. Lists every workload and pod, so it is heavier than a table on a large cluster.",
    // Off by default: it is a second application, it walks the whole workload
    // set to draw anything, and a clean install should open on the clusters you
    // came for rather than on a graph you did not ask for.
    defaultOff: true,
  },
  {
    id: "fleet-health",
    label: "Cluster health in the Catalog",
    description:
      "Rolls each cluster's workload health up into its Catalog row. Costs three extra list calls per reachable cluster, so it is the one flag worth turning off on a large fleet.",
  },
  {
    id: "diff",
    label: "Live-versus-applied diff",
    description:
      "A Diff tab on the detail drawer, comparing an object to its kubectl last-applied annotation. Objects applied by other means show nothing to compare.",
  },
];

const KEY = "hd-feature-flags";

const BY_ID = new Map(FEATURE_FLAGS.map(f => [f.id, f]));
/** An id nobody declared is on — the same answer the store gave before. */
const defaultFor = (id: string): boolean => !BY_ID.get(id)?.defaultOff;

/** Only the explicit choices, keyed by id. Absent means "still the default". */
type Choices = Readonly<Record<string, boolean>>;

const listeners = new Set<() => void>();

let choices: Choices = read();
let disabled: ReadonlySet<string> = derive(choices);

function read(): Choices {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // The store used to be an array of disabled ids. Honour one that is still
    // there rather than silently switching someone's features back on.
    if (Array.isArray(raw)) {
      return Object.fromEntries(raw.filter((x): x is string => typeof x === "string").map(id => [id, false]));
    }
    if (raw && typeof raw === "object") {
      return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).filter(([, on]) => typeof on === "boolean"),
      ) as Choices;
    }
    return {};
  } catch {
    return {};
  }
}

/** The disabled set, which is what the UI actually asks for. Derived once per
 *  change so `useSyncExternalStore` sees a stable snapshot identity. */
function derive(from: Choices): ReadonlySet<string> {
  const off = new Set<string>();
  for (const flag of FEATURE_FLAGS) if (!(from[flag.id] ?? defaultFor(flag.id))) off.add(flag.id);
  return off;
}

function write(next: Choices): void {
  choices = next;
  disabled = derive(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A blocked store costs the persistence, not the session.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = (): ReadonlySet<string> => disabled;

export function setFeatureEnabled(id: string, enabled: boolean): void {
  const next = { ...choices };
  // Back to the default is an absence, not an entry: the stored object stays
  // empty for anyone who has not actually changed anything.
  if (enabled === defaultFor(id)) delete next[id];
  else next[id] = enabled;
  write(next);
}

/** Non-reactive read, for code outside React. */
export function isFeatureEnabled(id: string): boolean {
  return choices[id] ?? defaultFor(id);
}

export function useFeatureEnabled(id: string): boolean {
  const off = useSyncExternalStore(subscribe, snapshot, snapshot);
  // `off` only ever holds declared flags, so anything else asks the store.
  return BY_ID.has(id) ? !off.has(id) : isFeatureEnabled(id);
}

/** The whole disabled set, for a component that checks several. */
export function useDisabledFeatures(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

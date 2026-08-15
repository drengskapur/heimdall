import type { IconName } from "@blueprintjs/icons";
import { useSyncExternalStore } from "react";

/**
 * The apps this shell hosts.
 *
 * Clusters is the first one, not the only one. The sidebar is built around
 * exactly this distinction — an APPLICATIONS group listing the apps, and
 * beneath it the objects you opened *inside* them. Apps are 36px
 * entries carrying a star; its files are plain 32px rows. Heimdall's clusters are
 * the objects, so they belong in the lower group, and Clusters-the-app belongs
 * here.
 *
 * Adding the second app is a one-line edit to this array. That is the point of
 * the file: the sidebar renders whatever is in it, so a new app arrives with a
 * name, a glyph and a landing route rather than with sidebar surgery.
 */
export interface HeimdallApp {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  /** The application's colour. It is used twice: at full strength for the glyph
   *  and at 10% alpha for the tile behind it — a wash of the app's own colour
   *  rather than a saturated block. For example `rgba(102, 158, 255, 0.1)`
   *  behind a blue glyph, `rgba(91, 234, 170, 0.1)` behind a green
   *  one, and so on for all five. */
  readonly color: string;
  /** Route page the app lands on. `undefined` means the cluster-less catalog. */
  readonly page?: string;
  /** Feature flag gating this app, if any — see `feature-flags.ts`. An app whose
   *  flag is off disappears from the sidebar and its menu entirely. */
  readonly flag?: string;
  /** One line, shown in the applications dialog. Every app gets a sentence
   *  saying what it is for; a grid of names alone makes you open each one to
   *  find out. */
  readonly description: string;
}

export const APPS: readonly HeimdallApp[] = [
  // The app mark's own gold. Clusters is the Heimdall application, so it takes
  // the Heimdall colour rather than an arbitrary hue.
  {
    id: "clusters",
    name: "Clusters",
    icon: "layout-sorted-clusters",
    color: "#f2c15f",
    description: "Browse and manage the clusters you have connected, and everything running inside them.",
  },
  // The second app, and the reason the registry exists: it arrives as a line
  // here plus a page, with no change to the sidebar that lists it.
  {
    id: "topology",
    name: "Topology",
    icon: "layout-hierarchy",
    color: "#8abbff",
    page: "topology",
    flag: "topology",
    description: "An ownership graph of the active cluster, and what each node has room for.",
  },
];

/**
 * Favourited apps, in the order they were starred.
 *
 * Same shape as the recent-clusters store — a `useSyncExternalStore` triple over
 * one localStorage key — because the sidebar reads both the same way. Uncapped:
 * favourites are a deliberate choice and there will never be many apps, which is
 * the difference between this and the recents list that has to be capped at five.
 */
const KEY = "hd-favourite-apps";

const listeners = new Set<() => void>();
/** Everything, on a fresh profile. The sidebar's APPLICATIONS group lists what
 *  you have favourited, so an unseeded install would show an empty group and no
 *  way into the app from the sidebar at all. */
const DEFAULT = APPS.map(a => a.id);

let cache: readonly string[] = read();

function read(): readonly string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DEFAULT;
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return DEFAULT;
  }
}

function write(next: readonly string[]): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store costs the persistence, not the session — the
    // in-memory cache still drives the render.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = (): readonly string[] => cache;

export function toggleFavouriteApp(id: string): void {
  write(cache.includes(id) ? cache.filter(x => x !== id) : [...cache, id]);
}

export function useFavouriteApps(): readonly string[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * The application a route belongs to.
 *
 * Clusters is the default because it owns every cluster-scoped page; an app with
 * its own `page` claims that route and everything about the shell follows —
 * which tile the header shows, which entry the sidebar marks active, and whether
 * the Clusters app's resource nav is on screen at all.
 */
export function appForPage(page: string | undefined): HeimdallApp {
  const owned = page ? APPS.find(a => a.page && a.page === page) : undefined;
  if (owned) return owned;
  const fallback = APPS[0];
  if (!fallback) throw new Error("APPS must not be empty");
  return fallback;
}

/** True when the route belongs to an app other than Clusters — such a page owns
 *  the whole content area and does not want the cluster's resource nav beside it. */
export function isStandaloneApp(page: string | undefined): boolean {
  return appForPage(page).id !== "clusters";
}

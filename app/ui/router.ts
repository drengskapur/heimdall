import { useSyncExternalStore } from "react";
import { APPS } from "./apps";
import { isFeatureEnabled } from "./feature-flags";

/**
 * The app's location, in the URL.
 *
 * Navigation used to live in a `nav.stack` array inside Shell, which meant the
 * URL never changed: nothing could be linked to or bookmarked, a reload always
 * landed back on Pods, and the browser's own Back/Forward did nothing — which
 * is why the header had to grow a hand-rolled pair of arrows. Putting the
 * location in `history` fixes all four at once and deletes that stack.
 *
 * No router library: the whole location is a cluster and a page, so a route
 * table would be ceremony. This is a store over History + popstate that
 * `useSyncExternalStore` can read.
 *
 * URLs key on the cluster's *name* (`/docker-desktop/pods`) rather than its id,
 * because ids are FNV hashes (`kubeconfig-3f2a91c4`) and would make every link
 * unreadable. Names come from kubeconfig contexts, so a collision needs two
 * contexts of the same name across two files; first match wins, which costs a
 * mis-targeted link in a case that also confuses the sidebar.
 */
export interface Route {
  /** The cluster's name, or "" for a top-level page. */
  readonly cluster: string;
  /**
   * The page id.
   *
   * Inside a cluster this is a nav page — `pods`, `nodes`. With no cluster it is
   * either "" (the cluster list) or a standalone app's own path: `/topology` is
   * `{ cluster: "", page: "topology" }`. An app is not a page of a cluster, so
   * its URL is not nested under one: `/topology`, not `/<cluster>/topology`.
   */
  readonly page: string;
}

/** Apps that own a top-level path of their own, keyed by that path. */
const STANDALONE = new Map(APPS.flatMap(a => (a.page ? [[a.page, a] as const] : [])));

/** Whether a top-level path currently resolves. A flagged-off app does not have
 *  a path at all: turning the feature off has to remove the URL too, or the page
 *  stays reachable by bookmark and by the back button — a half-off switch. */
function standaloneResolves(path: string): boolean {
  const app = STANDALONE.get(path);
  return !!app && (!app.flag || isFeatureEnabled(app.flag));
}

/** Percent-decoding that survives a malformed escape.
 *
 *  `decodeURIComponent` throws URIError on input like "/%" or a sequence cut
 *  short — and `parse` runs at module load, so an unguarded throw takes the
 *  whole application down before it mounts. A link mangled in transit should
 *  resolve to a cluster that does not exist, not to a white screen. Found by
 *  fuzz/route.fuzz.mjs on the input "/%/". */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const CATALOG: Route = { cluster: "", page: "" };
/** Where a cluster URL lands when the path names no page. */
const DEFAULT_PAGE = "pods";

/** The route a path names. Exported for its tests: it and `href` are inverses,
 *  and the pair only stays honest if both are exercised together. */
export function parse(pathname: string): Route {
  const [, first = "", second = ""] = pathname.split("/");
  // Only a *bare* /clusters is the cluster list. Checking the first segment
  // alone made a cluster actually named "clusters" unreachable: /clusters/pods
  // resolved here. `/catalog` is still accepted — it was the path until the page
  // was renamed, and a link someone kept should not 404 into a cluster lookup.
  if (!first || ((first === "clusters" || first === "catalog") && !second)) return CATALOG;
  // A standalone app claims its whole first segment. Checked before the cluster
  // branch, and only when nothing follows it, so a cluster genuinely named
  // "topology" is still reachable at /topology/pods.
  //
  // A switched-off app resolves to the Catalog rather than falling through. It
  // must not fall through: the cluster branch would read the app's own path as
  // a cluster *name* and try to open a cluster called "topology", turning a
  // disabled feature into a failed connection.
  if (!second && STANDALONE.has(first)) return standaloneResolves(first) ? { cluster: "", page: first } : CATALOG;
  return { cluster: decodeSegment(first), page: decodeSegment(second) || DEFAULT_PAGE };
}

/** The path for a route. Kept next to `parse` so the two can't drift. */
export function href(route: Route): string {
  if (route.cluster) return `/${encodeURIComponent(route.cluster)}/${encodeURIComponent(route.page || DEFAULT_PAGE)}`;
  if (route.page && standaloneResolves(route.page)) return `/${encodeURIComponent(route.page)}`;
  return "/clusters";
}

// useSyncExternalStore compares snapshots by identity, so the cached object must
// only be replaced when the route actually changes — otherwise every popstate
// would re-render the whole shell.
let current: Route = typeof location === "undefined" ? CATALOG : parse(location.pathname);
const listeners = new Set<() => void>();

function sync(): void {
  const next = parse(location.pathname);
  if (next.cluster === current.cluster && next.page === current.page) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", sync);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", sync);
  };
}

/** Push a route (or replace, for redirects that shouldn't cost a Back press). */
export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const url = href(route);
  if (url === location.pathname) return;
  // pushState doesn't emit popstate, so sync() is called by hand — and it is
  // what notifies subscribers, exactly once, and only if the route changed.
  history[options.replace ? "replaceState" : "pushState"](null, "", url);
  sync();
}

/** Re-derive the route from the URL and notify if it changed.
 *
 *  Needed because `parse` is not a pure function of the path alone — a feature
 *  flag can make a standalone app's path stop resolving. Nothing else would
 *  notice until the next navigation, which left the app sitting on a URL that
 *  no longer means anything. */
export function resyncRoute(): void {
  sync();
}

/** The route outside React — for callers that must react to a rename, etc. */
export function currentRoute(): Route {
  return current;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}

/** True when running as an installed PWA, where no browser Back button exists. */
export function isStandalone(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches;
}

export { DEFAULT_PAGE };

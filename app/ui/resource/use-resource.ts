import { useCallback, useEffect, useRef, useState } from "react";
import type { KubeObject, ResourceQuery, WatchEvent } from "../../application/ports/kubernetes-gateway";
import { type ActiveCluster, activeCluster } from "../../infrastructure/composition-root";
import { humanizeClusterError } from "../cluster-error";

/** Merge a single watch event into the current rows; return null to fall back to
 *  a full reload (e.g. for kinds without a per-object mapper). */
export type ApplyEvent<T> = (event: WatchEvent<KubeObject>, rows: readonly T[]) => readonly T[] | null;

/** UI-facing load state for any resource list. */
export type ResourceState<T> =
  | { status: "no-cluster" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: T[] };

/**
 * Generic resource loader with **live updates**: resolves the active cluster,
 * runs a use-case `load` for the initial list, then (if `watch` is given)
 * subscribes to the collection and debounce-reloads on ADDED/MODIFIED/DELETED.
 * The UI stays free of transport and wire-format concerns.
 */
export function useResource<T>(
  load: (cluster: ActiveCluster) => Promise<readonly T[]>,
  key: string,
  watch?: ResourceQuery,
  applyEvent?: ApplyEvent<T>,
): { state: ResourceState<T>; reload: () => void } {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(t => t + 1), []);
  // Which resource the current items belong to, so a refresh can be told apart
  // from a switch to another kind.
  const keyRef = useRef(key);
  /** Bumped by every applied watch merge, so an older list can tell it lost. */
  const mergeSeq = useRef(0);
  // Keep the latest applyEvent without re-subscribing the watch each render.
  const applyRef = useRef(applyEvent);
  applyRef.current = applyEvent;

  useEffect(() => {
    const cluster = activeCluster();
    if (!cluster) {
      setState({ status: "no-cluster" });
      return;
    }
    let cancelled = false;
    // Stale-while-revalidate. Every reload used to drop straight back to
    // `loading`, and the watch debounce-reloads on any change the merge cannot
    // apply — so a background refresh blanked the whole table and rebuilt it,
    // once per cluster event. With a spinner that was a flash; with a skeleton
    // it is a visible flicker. Rows already on screen stay there while the
    // refetch runs and are replaced only when the new ones arrive.
    //
    // Guarded on the key, so switching to a *different* resource still shows the
    // loading state rather than the previous resource's rows.
    const sameResource = keyRef.current === key;
    keyRef.current = key;
    setState(prev => (sameResource && prev.status === "ready" ? prev : { status: "loading" }));
    // A watch merge that lands while this list is in flight is *newer* than the
    // list. Applying the list on arrival undid it: create or delete an object,
    // the reload starts, the watch merges the change, then the older list
    // resolves and the new row vanishes (or a deleted one returns) until some
    // later event happened to trigger another reload. `cancelled` never covered
    // this — it only flips when the key or an explicit reload changes.
    const mergedAtStart = mergeSeq.current;
    Promise.resolve(load(cluster))
      .then(items => {
        if (cancelled || mergeSeq.current !== mergedAtStart) return;
        setState({ status: "ready", items: [...items] });
      })
      .catch(err => {
        // Same guard as the success path above, and for the same reason: a
        // transient reload failure — a 403 mid-token-refresh, a network blip —
        // must not replace a table the watch has been keeping correct with a
        // full-page error. If a merge landed while this fetch was in flight,
        // the rows on screen are newer than this failure is informative.
        if (cancelled || mergeSeq.current !== mergedAtStart) return;
        setState({ status: "error", message: humanizeClusterError(err) });
      });
    return () => {
      cancelled = true;
    };
    // `key` identifies the resource; `load` is re-created each render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  // Live updates: watch the collection and debounce-reload on any change.
  useEffect(() => {
    if (!watch) return;
    const cluster = activeCluster();
    if (!cluster) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = cluster.gateway.watch(watch, event => {
      // Incremental merge-by-uid when the descriptor supplies a mapper; else
      // debounce a full reload (the safe default).
      const apply = applyRef.current;
      if (apply) {
        let handled = true;
        setState(prev => {
          if (prev.status !== "ready") {
            handled = false;
            return prev;
          }
          const merged = apply(event, prev.items);
          if (merged == null) {
            handled = false;
            return prev;
          }
          mergeSeq.current += 1;
          return { status: "ready", items: [...merged] };
        });
        if (handled) return;
      }
      clearTimeout(timer);
      timer = setTimeout(reload, 500);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
    // Re-subscribe only when the resource changes; `watch` is stable per `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload]);

  return { state, reload };
}

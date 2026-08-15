import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clusterProfiles, activeCluster as getActiveCluster } from "../../infrastructure/composition-root";
import type { ClusterProfile } from "../../lib/kube-generated";
import { type HeimdallApp, isStandaloneApp } from "../apps";
import { discoverServed, type ResourceRule } from "../capabilities";
import { discoverClusters, profileToCluster } from "../cluster-catalog";
import { humanizeClusterError } from "../cluster-error";
import { ClusterSettingsDialog } from "../cluster-settings";
import { ClusterTerminalView } from "../dock/cluster-terminal-view";
import { Dock } from "../dock/dock";
import { clearDock, ensureTerminal } from "../dock/dock-store";
import { useDisabledFeatures } from "../feature-flags";
import { findLabel } from "../nav-tree";
import { onNavigate, onNavigateObject, openPreferences } from "../navigate";
import { notify } from "../notifications";
import { PasteKubeconfigDialog } from "../paste-kubeconfig";
import { stopAllForwards } from "../port-forwards";
import { PreferencesHost } from "../preferences/preferences-dialog";
import { recordRecentCluster } from "../recent-clusters";
import { setSelectedNamespaces } from "../resource/namespace-store";
import { pageIdForKind } from "../resource/registry";
import { ResourcePage } from "../resource/resource-page";
import { navigate, resyncRoute, useRoute } from "../router";
import { useTheme } from "../use-theme";
import { CatalogView } from "./catalog-view";
import { ClusterStatus } from "./cluster-status";
import { CommandPalette } from "./command-palette";
import { Header } from "./header";
import { HeaderSlotProvider } from "./header-slot";
import { Hotbar } from "./hotbar";
import styles from "./shell.module.css";
import { Sidebar } from "./sidebar";

/**
 * Shell — the persistent root frame: Hotbar · (Header + (Catalog | Sidebar + Outlet)).
 * Clusters are the **real** profiles discovered from the local kubeconfig via the
 * companion; selecting one sets it active so the hexagon (`activeCluster()`) talks
 * to that cluster. The Header is cluster-independent chrome.
 *
 * Where you are lives in the URL (`/<cluster>/<page>`), not in component state —
 * see app/ui/router.ts.
 */
export function Shell() {
  useTheme(); // keep the theme applied + synced with system changes
  const [profiles, setProfiles] = useState<ClusterProfile[]>(() => clusterProfiles.list());
  // The URL is the navigation state — see app/ui/router.ts. The cluster is named
  // in the path, so a deep link survives a reload and the browser's own
  // Back/Forward retrace pages without any stack of our own.
  const route = useRoute();
  const selected = route.page || "pods";
  const standalone = isStandaloneApp(route.page);

  // Turning an app off removes its URL. `parse` already refuses to resolve the
  // path, so the route is the Catalog the moment the flag flips — but the
  // address bar still reads /topology until it is rewritten, and a stale path
  // there is one reload away from being a 404 the user has to back out of.
  // Replace rather than push: a redirect should not cost a Back press.
  const disabledFeatures = useDisabledFeatures();
  // Switching an app off has to re-derive the route, because `parse` reads the
  // flags: without this you stayed on /topology looking at an empty pane, since
  // the route only refreshes on navigation and no navigation had happened.
  useEffect(() => resyncRoute(), [disabledFeatures]);
  useEffect(() => {
    if (!route.cluster && !route.page && location.pathname !== "/clusters") {
      navigate({ cluster: "", page: "" }, { replace: true });
    }
  }, [route.cluster, route.page]);

  const routedProfile = route.cluster ? (profiles.find(p => p.name === route.cluster) ?? null) : null;
  const activeId = routedProfile?.id ?? "";
  const go = useCallback(
    (page: string) => {
      if (route.cluster) navigate({ cluster: route.cluster, page });
    },
    [route.cluster],
  );
  const goCatalog = useCallback(() => navigate({ cluster: "", page: "" }), []);
  // Stable identities for the rail's callbacks. It is memoised, and a memo whose
  // props are rebuilt every render is a memo that never hits — inline arrows here
  // were the whole reason the rail re-rendered on every navigation.
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const clusterRef = useRef(route.cluster);
  clusterRef.current = route.cluster;
  /** Open an app from the registry. Apps are cluster-scoped, so one opened with
   *  no cluster active lands on the Catalog to pick one first. */
  const openApp = useCallback(
    (app: HeimdallApp) => {
      // An app with a page of its own goes to that path, not to a path under the
      // current cluster — the app is not a page of a cluster. Which cluster it
      // runs against is the active one, which is state rather than URL.
      if (!app.page) {
        goCatalog();
        return;
      }
      navigate({ cluster: "", page: app.page });
    },
    [goCatalog],
  );
  const [connecting, setConnecting] = useState(false);
  const [served, setServed] = useState<Set<string> | null>(null);
  const [rules, setRules] = useState<ResourceRule[] | null>(null);
  const [connection, setConnection] = useState<{
    status: "connecting" | "ok" | "error";
    message?: string;
    reconnecting?: boolean;
  }>({ status: "ok" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  // A pending cross-object selection: switch to the kind's page, then its
  // ResourcePage opens the matching row's drawer once loaded.
  const [pendingSelect, setPendingSelect] = useState<{ pageId: string; name: string; namespace?: string } | null>(null);
  // The cluster whose Settings dialog is open (null = closed). Lets the sidebar
  // open settings for the active cluster and the Hotbar cog for any tile.
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  // Memoised: a fresh array each render re-fired the Hotbar's re-seed effect,
  // which set state and wrote localStorage on every single Shell render.
  const clusters = useMemo(() => profiles.map(p => profileToCluster(p, p.id === activeId)), [profiles, activeId]);
  const activeProfile = routedProfile;
  const activeCluster = clusters.find(c => c.id === activeId);
  const inCluster = !!activeProfile && !!activeCluster;
  const title = findLabel(selected);

  // The page name belongs in the document title, not the header: the browser
  // tab, the history entries and the PWA task switcher all read it, and it can
  // change freely without destabilising the chrome.
  useEffect(() => {
    document.title = inCluster
      ? `${title} · ${route.cluster} — Heimdall`
      : route.page
        ? `${findLabel(route.page)} — Heimdall`
        : "Clusters — Heimdall";
  }, [inCluster, title, route.cluster, route.page]);

  // The route is the source of truth, but the hexagon reads the active profile
  // from the store — so a URL change (including a Back press or a deep link on
  // a cold load) has to push the cluster into it.
  useEffect(() => {
    if (routedProfile && clusterProfiles.active()?.id !== routedProfile.id) {
      clusterProfiles.setActive(routedProfile);
    }
  }, [routedProfile]);

  // State, not a ref: the pages that portal into this node have to re-render
  // once it exists, and a ref mutation would not tell them.
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);

  // Read through a ref rather than closed over. `enterCluster` only needs the
  // current page to preserve it across a cluster switch, and depending on it
  // directly would give the callback a new identity on every navigation — which
  // is exactly what stopped the memoised rail from ever skipping a render.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const enterCluster = useCallback((id: string) => {
    const profile = profilesRef.current.find(p => p.id === id);
    if (!profile) return;
    if (profile.authStatus === "unsupported") {
      notify.error(profile.authMessage || "This cluster can't be connected from the browser.");
      return;
    }
    // Recorded here rather than in the sidebar's own click handler, which is
    // where it used to live. Opening a cluster from the catalog therefore never
    // made it recent, so unfavouriting one that had only ever been opened that
    // way removed its last appearance in the sidebar and it vanished.
    recordRecentCluster(profile.id);
    clusterProfiles.setActive(profile);
    navigate({ cluster: profile.name, page: selectedRef.current || "pods" });
  }, []);

  const removeCluster = useCallback(
    (id: string) => {
      clusterProfiles.remove(id);
      setProfiles(clusterProfiles.list());
      if (activeIdRef.current === id) goCatalog();
      notify.info("Cluster removed.");
    },
    [goCatalog],
  );

  /**
   * Discover clusters from the local kubeconfig via the companion.
   *
   * `background: true` marks the automatic first-run probe. It reports nothing:
   * an absent companion is the expected state on a fresh install and the
   * Catalog's empty state already says so, whereas a red error toast on first
   * paint reads as a fault. Only a connect the user actually asked for gets a
   * toast — which is now the sole signal that the companion is unreachable,
   * since the statusbar that carried the passive indicator was removed.
   */
  const connect = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    setConnecting(true);
    try {
      const discovered = await discoverClusters();
      if (!discovered.length) {
        if (!background) notify.info("No clusters found in your kubeconfig.");
        return;
      }
      for (const profile of discovered) clusterProfiles.save(profile);
      setProfiles(clusterProfiles.list());
      if (background) return; // the Catalog filling in is its own feedback
      const ready = discovered.filter(p => p.authStatus !== "unsupported").length;
      notify.success(
        `Discovered ${discovered.length} cluster${discovered.length > 1 ? "s" : ""}${ready < discovered.length ? ` (${ready} connectable)` : ""}.`,
      );
    } catch (error) {
      if (background) return;
      // Discovery goes through the local companion; a raw "Failed to fetch" means
      // it's unreachable — say so and point at where to fix it.
      const raw = error instanceof Error ? error.message : String(error);
      const unreachable =
        /fetch failed|failed to fetch|networkerror|econnrefused|refused|etimedout|enotfound|ehostunreach|load failed/i.test(
          raw,
        );
      notify.error(
        unreachable
          ? "Can't reach the local companion. Make sure it's running, then set its URL and token in Preferences → Cluster proxy."
          : humanizeClusterError(error),
      );
    } finally {
      setConnecting(false);
    }
  }, []);

  // On first mount, auto-discover from the kubeconfig when nothing is stored yet.
  useEffect(() => {
    if (!profiles.length) void connect({ background: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep views (e.g. the Workloads Overview cards) request page changes via the
  // navigate signal; honor them and ensure we're in the cluster view.
  useEffect(
    () =>
      onNavigate(id => {
        go(id);
      }),
    [go],
  );

  // Cross-object navigation (e.g. a Pod's "Controlled By" → its ReplicaSet):
  // resolve the kind to its page, switch to it, and queue the row to open.
  useEffect(
    () =>
      onNavigateObject(target => {
        const pageId = pageIdForKind(target.kind);
        if (!pageId) return;
        go(pageId);
        setPendingSelect({ pageId, name: target.name, namespace: target.namespace });
      }),
    [go],
  );

  // Probe cluster reachability (server version) — drives the connection screen,
  // matching Freelens's cluster-status lifecycle. Also used by Reconnect.
  const probeConnection = useCallback((reconnecting = false) => {
    const cluster = getActiveCluster();
    if (!cluster) return;
    setConnection({ status: "connecting", reconnecting });
    cluster.gateway
      .serverVersion()
      .then(() => setConnection({ status: "ok" }))
      .catch(err => setConnection({ status: "error", message: humanizeClusterError(err) }));
  }, []);

  // Discover the active cluster's served resources so the sidebar reflects what
  // the real cluster exposes. Reset on cluster switch; never hide on failure.
  useEffect(() => {
    setServed(null);
    setRules(null);
    stopAllForwards(); // forwards belong to the previous cluster
    clearDock(); // dock tabs belong to the previous cluster
    setSelectedNamespaces(new Set()); // namespace scope belongs to the previous cluster
    if (!activeId) {
      setConnection({ status: "ok" });
      return;
    }
    const cluster = getActiveCluster();
    if (!cluster) return;
    probeConnection(); // connection lifecycle before showing content
    ensureTerminal(() => <ClusterTerminalView />); // default Terminal tab, like Freelens
    let cancelled = false;
    discoverServed(cluster)
      .then(set => {
        if (!cancelled) setServed(set);
      })
      .catch(() => {
        if (!cancelled) setServed(null);
      });
    // RBAC gating (best-effort; permissive on any failure — never over-hides).
    cluster.gateway
      .canListResources("default")
      .then(r => {
        if (!cancelled) setRules(r);
      })
      .catch(() => {
        if (!cancelled) setRules(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, probeConnection]);

  return (
    <div className={styles.root}>
      {/* Shell layout: the iconbar is a full-height left rail; the top bar and
          everything else live in the column to its right. */}
      <Hotbar
        onOpenSearch={openPalette}
        clusters={clusters}
        active={inCluster ? activeId : ""}
        onSelect={enterCluster}
        onOpenApp={openApp}
        onRemove={removeCluster}
        onSettings={setSettingsId}
      />
      <HeaderSlotProvider value={headerSlot}>
        <div className={styles.rightSide}>
          {/* Inside a cluster only. On the Catalog the bar carried a Cluster menu
            with no cluster to act on and a breadcrumb naming the page above a
            table that is the page — chrome about nothing, over the one view
            that wants the full height. Everything it holds is reachable without
            it: the palette on mod+K and from the sidebar's Search, Preferences
            and About from the sidebar's footer. */}
          {inCluster && (
            <Header
              actionSlotRef={setHeaderSlot}
              onOpenSearch={() => setPaletteOpen(true)}
              onHome={goCatalog}
              onBack={() => history.back()}
              onForward={() => history.forward()}
              onSettings={() => setSettingsId(activeId)}
              onDisconnect={goCatalog}
            />
          )}
          <div className={styles.body}>
            {/* A standalone app owns the page outright: it is not inside a cluster
            in the URL and it is not the cluster list either. It still runs
            against whichever cluster is active, which is why it renders here
            rather than being a route the shell knows nothing about. */}
            {standalone ? (
              <div className={styles.outlet}>
                <div className={styles.outletBody}>
                  <ResourcePage
                    pageId={route.page}
                    selectTarget={null}
                    onSelectionConsumed={() => setPendingSelect(null)}
                  />
                </div>
              </div>
            ) : inCluster && activeCluster ? (
              connection.status !== "ok" ? (
                <div className={styles.outlet}>
                  <div className={styles.outletBody}>
                    <ClusterStatus
                      status={connection.status}
                      clusterName={activeProfile?.name ?? "cluster"}
                      message={connection.message}
                      reconnecting={connection.reconnecting}
                      onReconnect={() => probeConnection(true)}
                      onDisconnect={goCatalog}
                    />
                  </div>
                </div>
              ) : (
                <>
                  {/* The Clusters app's resource nav. An app with its own page owns
                the whole content area — a Topology graph beside a list of Pods
                and Config Maps would be two apps on one screen, which is the
                thing the app registry exists to stop. */}
                  {!standalone && <Sidebar selected={selected} onSelect={go} served={served} rules={rules} />}
                  <div className={styles.outlet}>
                    <div className={styles.outletBody}>
                      <ResourcePage
                        key={activeId}
                        pageId={selected}
                        selectTarget={pendingSelect && pendingSelect.pageId === selected ? pendingSelect : null}
                        onSelectionConsumed={() => setPendingSelect(null)}
                      />
                    </div>
                    <Dock />
                  </div>
                </>
              )
            ) : (
              <div className={styles.outlet}>
                <div className={styles.outletBody}>
                  <CatalogView
                    clusters={clusters}
                    profiles={profiles}
                    connecting={connecting}
                    onEnter={enterCluster}
                    onRemove={removeCluster}
                    onSettings={setSettingsId}
                    onConnect={() => void connect()}
                    onPaste={() => setPasteOpen(true)}
                    onConfigure={openPreferences}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </HeaderSlotProvider>
      <PreferencesHost />
      <PasteKubeconfigDialog
        isOpen={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onAdded={() => setProfiles(clusterProfiles.list())}
      />
      {settingsId && profiles.find(p => p.id === settingsId) && (
        <ClusterSettingsDialog
          profile={profiles.find(p => p.id === settingsId)!}
          isOpen={settingsId != null}
          onClose={() => setSettingsId(null)}
          onSaved={() => setProfiles(clusterProfiles.list())}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onToggle={() => setPaletteOpen(o => !o)}
        onClose={() => setPaletteOpen(false)}
        served={served}
        rules={rules}
        onNavigate={id => {
          go(id);
        }}
      />
    </div>
  );
}

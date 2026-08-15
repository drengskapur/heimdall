import { Button, H1, Icon, Menu, MenuDivider, MenuItem, NonIdealState, Spinner, Tag, Tooltip } from "@blueprintjs/core";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { gatewayFor } from "../../infrastructure/composition-root";
import type { ClusterProfile } from "../../lib/kube-generated";
import { toggleFavouriteApp, useFavouriteApps } from "../apps";
import { humanizeClusterError } from "../cluster-error";
import type { Cluster } from "../clusters";
import { useFeatureEnabled } from "../feature-flags";
import { MenuPopover } from "../menu-popover";
import { HEALTH_PRIORITY, type Health, healthIntent, replicaHealth, worstHealth } from "../resource/health";
import { type Column, ObjectTable } from "../resource/object-table";
import styles from "./catalog-view.module.css";

type CatalogRow = Cluster & { id: string; profile?: ClusterProfile };

/** Live reachability per cluster: undefined = still probing. */
type Probe = { ok: true } | { ok: false; message: string };

// Cache probe results briefly so re-opening the Catalog doesn't re-fetch every
// cluster each time; the Refresh button clears it to force a fresh check.
const PROBE_TTL = 15_000;
const probeCache = new Map<string, { probe: Probe; at: number }>();

function sourceOf(profile?: ClusterProfile): string {
  const path = profile?.sourcePath;
  if (!path) return "kubeconfig";
  return path.split(/[\\/]/).pop() || "kubeconfig";
}

function statusTag(row: CatalogRow, probe?: Probe) {
  if (row.profile?.authStatus === "unsupported") {
    return (
      <Tooltip content={row.profile.authMessage || "Can't connect from the browser."} compact>
        <Tag minimal intent="warning">
          Unsupported
        </Tag>
      </Tooltip>
    );
  }
  if (!probe)
    return (
      <Tag minimal icon={<Spinner size={12} />}>
        Checking…
      </Tag>
    );
  if (probe.ok)
    return (
      <Tag minimal intent="success">
        Connected
      </Tag>
    );
  // A failed fetch surfaces the real reason on hover instead of a fake "Connected".
  return (
    <Tooltip content={probe.message} compact>
      <Tag minimal intent="danger">
        Unreachable
      </Tag>
    </Tooltip>
  );
}

function labelTags(labels?: Record<string, string>) {
  const entries = Object.entries(labels ?? {});
  if (!entries.length) return "—";
  return (
    <span className={styles.labels}>
      {entries.slice(0, 3).map(([k, v]) => (
        <Tag minimal key={k}>
          {k}={v}
        </Tag>
      ))}
      {entries.length > 3 ? `+${entries.length - 3}` : ""}
    </span>
  );
}

/**
 * CatalogView — the landing page. Freelens's Catalog: a table of entities (here,
 * Kubernetes clusters) with Name / Context / Source / Status / Labels and per-row
 * actions (Open / Settings / Delete). Falls back to an empty state when no
 * clusters are known yet.
 *
 * The table is the whole page. There is no module header: the app header's
 * breadcrumb already names the Catalog directly above it, and the controls that
 * strip used to hold now live where they belong — Add cluster in the sidebar's
 * footer, search in the command palette.
 */
export function CatalogView({
  clusters,
  profiles,
  connecting,
  onEnter,
  onRemove,
  onSettings,
  onConnect,
  onPaste,
  onConfigure,
}: {
  clusters: readonly Cluster[];
  profiles: readonly ClusterProfile[];
  connecting?: boolean;
  onEnter: (id: string) => void;
  onRemove: (id: string) => void;
  onSettings: (id: string) => void;
  onConnect: () => void;
  onPaste: () => void;
  onConfigure: () => void;
}) {
  const rows = useMemo<CatalogRow[]>(
    () => clusters.map(c => ({ ...c, profile: profiles.find(p => p.id === c.id) })),
    [clusters, profiles],
  );

  // Live reachability probe per cluster — the Status column reflects a real
  // serverVersion() fetch, and a failure shows the humanized error (not "Connected").
  // Results are cached for PROBE_TTL, then re-probed when the profile list changes.
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const seed: Record<string, Probe> = {};
    const stale: ClusterProfile[] = [];
    for (const p of profiles) {
      if (p.authStatus === "unsupported") continue; // can't connect; skip the fetch
      const cached = probeCache.get(p.id);
      if (cached && now - cached.at < PROBE_TTL) seed[p.id] = cached.probe;
      else stale.push(p);
    }
    setProbes(seed);
    for (const p of stale) {
      const store = (probe: Probe) => {
        probeCache.set(p.id, { probe, at: Date.now() });
        if (!cancelled) setProbes(s => ({ ...s, [p.id]: probe }));
      };
      gatewayFor(p)
        .serverVersion()
        .then(() => store({ ok: true }))
        .catch(err => store({ ok: false, message: humanizeClusterError(err) }));
    }
    return () => {
      cancelled = true;
    };
  }, [profiles]);

  /**
   * Fleet health: each cluster's workloads rolled up into one state.
   *
   * Fleet's contribution is a status that rolls *up*, and it gets it from an
   * agent reporting per cluster. A browser has no agent, so this is the honest
   * approximation — three list calls per reachable cluster, joined by the same
   * health scale everything else uses.
   *
   * Deployments, StatefulSets and DaemonSets only, deliberately: they are the
   * things whose desired count is declared, and they are few. Pods would be the
   * expensive list on every cluster and would mostly restate what their owners
   * already say.
   *
   * Behind a flag because the cost scales with the fleet, which is exactly the
   * case a flag is for.
   */
  const fleetHealthOn = useFeatureEnabled("fleet-health");
  const [fleet, setFleet] = useState<Record<string, Health>>({});
  useEffect(() => {
    if (!fleetHealthOn) {
      setFleet({});
      return;
    }
    let cancelled = false;
    const reachable = profiles.filter(p => probes[p.id]?.ok);
    for (const p of reachable) {
      if (fleet[p.id]) continue; // already known this session
      const gateway = gatewayFor(p);
      Promise.all(
        (["Deployment", "StatefulSet", "DaemonSet"] as const).map(k => gateway.listWorkloads(k).catch(() => [])),
      )
        .then(lists => {
          if (cancelled) return;
          const healths = lists.flat().map(w => replicaHealth(w.ready, w.desired));
          setFleet(f => ({ ...f, [p.id]: worstHealth(healths) }));
        })
        .catch(() => {
          /* one cluster failing must not blank the column for the others */
        });
    }
    return () => {
      cancelled = true;
    };
    // `fleet` is read to skip clusters already fetched; depending on it would
    // re-run the effect on every arrival, so the check is intentionally stale-safe
    // (a duplicate fetch is harmless, a loop is not).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, probes, fleetHealthOn]);

  const favourite = useFavouriteApps().includes("clusters");

  const columns: Column<CatalogRow>[] = [
    {
      id: "name",
      title: "Name",
      sortValue: r => r.name,
      render: r => (
        <span className={styles.nameCell}>
          <span className={styles.avatar} style={{ "--c": r.color } as CSSProperties}>
            {r.short}
          </span>
          {r.name}
        </span>
      ),
    },
    {
      id: "context",
      title: "Context",
      render: r => r.profile?.context ?? "—",
      sortValue: r => r.profile?.context ?? "",
    },
    { id: "source", title: "Source", render: r => sourceOf(r.profile) },
    {
      id: "status",
      title: "Status",
      render: r => statusTag(r, probes[r.id]),
      sortValue: r => {
        const p = probes[r.id];
        return p ? (p.ok ? "1-connected" : "2-unreachable") : "3-checking";
      },
    },
    ...(fleetHealthOn
      ? [
          {
            id: "health",
            title: "Workloads",
            render: (r: CatalogRow) => {
              const h = fleet[r.id];
              if (!probes[r.id]?.ok) return "—";
              if (!h) return <Spinner size={12} />;
              return (
                <Tag minimal intent={healthIntent(h)}>
                  {h}
                </Tag>
              );
            },
            sortValue: (r: CatalogRow) => (fleet[r.id] ? HEALTH_PRIORITY[fleet[r.id]] : 99),
          } satisfies Column<CatalogRow>,
        ]
      : []),
    { id: "labels", title: "Labels", render: r => labelTags(r.profile?.labels) },
  ];

  if (clusters.length === 0) {
    return (
      <div className={styles.empty}>
        <NonIdealState
          icon="layout-sorted-clusters"
          title="Clusters"
          description={
            /* Wrapped in an element of our own so the balance rule has something
               to hold: Blueprint's own class names are off-limits in CSS here
               (tests/ui/blueprint-conventions.test.ts), and CSS cannot read
               `Classes.*`. */
            <span className={styles.emptyText}>
              No clusters yet. Scan your local kubeconfig (via the companion) to connect one.
            </span>
          }
          action={
            <div className={styles.emptyActions}>
              <Button
                intent="primary"
                icon="refresh"
                loading={connecting}
                text="Connect from kubeconfig"
                onClick={onConnect}
              />
              <Button icon="clipboard" text="Paste kubeconfig" onClick={onPaste} />
              <Button variant="minimal" icon="cog" text="Configure companion" onClick={onConfigure} />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* A page title, in the content rather than in chrome, at the listing
          size — 18px semibold on its own row above the table. That is the right
          model for a list of things you own; the 36px greeting is a zero-state
          hero and belongs to a page of cards. See docs/design/chrome-spec.md.

          This is not the module header that was removed twice. That was a strip
          of chrome restating the page's name directly under a breadcrumb that
          already said it; there is no breadcrumb on this page at all now, and
          this is the page saying what it is. */}
      {/* Title and its star on one row, the way a resource name pairs with its
          favourite star. The star is the *app's*, the same bit the
          sidebar's APPLICATIONS group reads — so starring here and starring
          there are one action, and this page is where you would look for it
          when the sidebar row is not in front of you. */}
      <div className={styles.titleRow}>
        <H1 className={styles.title}>Clusters</H1>
        <Tooltip content={favourite ? "Remove from Favorites" : "Add to Favorites"} compact minimal>
          <Button
            className={styles.titleStar}
            variant="minimal"
            /* The glyph as an element, not a name: a minimal Button colours its
               own icon, and the CSS that would override that has to name
               Blueprint's icon class — which this project bans, since CSS cannot
               read the Classes constants. Passing the node sets the colour where
               Blueprint cannot take it back. gold-5, the same as every other
               star in the app. */
            icon={<Icon icon={favourite ? "star" : "star-empty"} color={favourite ? "#fbd065" : undefined} />}
            aria-label={`${favourite ? "Remove" : "Add"} Clusters ${favourite ? "from" : "to"} Favorites`}
            aria-pressed={favourite}
            onClick={() => toggleFavouriteApp("clusters")}
          />
        </Tooltip>
        <span className={styles.titleSpacer} />
        {/* The page's own action, right-aligned on the title row, which is
            where an action that creates one of the things in this list
            belongs. It was in the sidebar's footer,
            which is permanent chrome for something that only applies here. */}
        <MenuPopover
          placement="bottom-end"
          content={
            <Menu>
              <MenuItem
                icon={connecting ? <Spinner size={16} /> : "import"}
                text="Connect from kubeconfig…"
                disabled={connecting}
                onClick={onConnect}
              />
              <MenuItem icon="clipboard" text="Paste kubeconfig…" onClick={onPaste} />
              <MenuDivider />
              <MenuItem icon="cog" text="Configure companion…" onClick={onConfigure} />
            </Menu>
          }
        >
          <Button intent="primary" icon="plus" text="Add cluster" size="small" />
        </MenuPopover>
      </div>
      <div className={styles.body}>
        <ObjectTable
          view={{ columns, rows }}
          onRowClick={r => onEnter(r.id)}
          rowMenu={r => (
            <MenuPopover
              placement="bottom-end"
              content={
                <Menu>
                  <MenuItem icon="log-in" text="Open" onClick={() => onEnter(r.id)} />
                  <MenuItem icon="cog" text="Settings" onClick={() => onSettings(r.id)} />
                  <MenuDivider />
                  <MenuItem icon="trash" intent="danger" text="Delete" onClick={() => onRemove(r.id)} />
                </Menu>
              }
            >
              <Button
                variant="minimal"
                size="small"
                icon="more"
                aria-label="Actions"
                onClick={e => e.stopPropagation()}
              />
            </MenuPopover>
          )}
        />
      </div>
    </div>
  );
}

import type { Intent } from "@blueprintjs/core";
import {
  Alert,
  Button,
  Callout,
  Classes,
  Dialog,
  FormGroup,
  InputGroup,
  Menu,
  MenuDivider,
  MenuItem,
  NonIdealState,
  NumericInput,
  showContextMenu,
  Tag,
  TextArea,
  Tooltip,
} from "@blueprintjs/core";
import { type MouseEvent, type ReactElement, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import type { KubeObject } from "../../application/ports/kubernetes-gateway";
import { type ActiveCluster, activeCluster } from "../../infrastructure/composition-root";
import { Listogram } from "../listogram";
import { MenuPopover } from "../menu-popover";
import { findLabel } from "../nav-tree";
import { notify } from "../notifications";
import { type RelQuery, resolveRelations } from "./relations";
import { TableSkeleton } from "./table-skeleton";

/** What a bulk run reports back: which rows did not make it.
 *
 *  A bulk action used to be a fail-fast `for … await` loop, so the fourth of ten
 *  deletions throwing left three objects gone, six untouched, one error toast
 *  naming only the last failure, and — because the selection was cleared in a
 *  `finally` — no way to retry the ones that failed. */
type BulkOutcome = { readonly failedIds: readonly string[]; readonly reasons: readonly string[] };

const isBulkOutcome = (value: unknown): value is BulkOutcome =>
  typeof value === "object" && value !== null && Array.isArray((value as BulkOutcome).failedIds);

/** Run one mutation per row, letting every row have its turn. */
async function runBulk<T extends { id: string }>(
  rows: readonly T[],
  each: (row: T) => Promise<unknown>,
): Promise<BulkOutcome> {
  const settled = await Promise.allSettled(rows.map(row => each(row)));
  const failedIds: string[] = [];
  const reasons: string[] = [];
  settled.forEach((result, index) => {
    if (result.status !== "rejected") return;
    const row = rows[index];
    if (row) failedIds.push(row.id);
    reasons.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  });
  return { failedIds, reasons };
}

/** A confirm-then-run action (delete, restart, cordon, …). */
type PendingAction = {
  label: string;
  message: string;
  intent: Intent;
  run: (cluster: ActiveCluster) => Promise<unknown>;
  success: string;
  /** The row being acted on, so a destructive action can show what depends on
   *  it before it happens. */
  row?: unknown;
};

import { openDock } from "../dock/dock-store";
import { useFeatureEnabled } from "../feature-flags";
import { HelmChartsPage } from "../helm/helm-charts-view";
import { HelmReleasesPage } from "../helm/helm-releases";
import { HeaderActions } from "../shell/header-slot";
import { TopologyView } from "../topology/topology-view";
import { ClusterOverview } from "./cluster-overview";
import { DetailDrawer } from "./detail-drawer";
import { LogsView } from "./logs-view";
import { setSelectedNamespaces, useSelectedNamespaces } from "./namespace-store";
import { ObjectTable, type Selection } from "./object-table";
import { PortForwardingPage, PortForwardView } from "./port-forward-view";
import { age, type Descriptor, RESOURCES } from "./registry";
import styles from "./resource-page.module.css";
import { rowName } from "./row-name";
import { TerminalView } from "./terminal-view";
import { useResource } from "./use-resource";
import { WorkloadsOverview } from "./workloads-overview";

/** A cross-object selection target: open the drawer for this name/namespace once loaded. */
export interface SelectTarget {
  name: string;
  namespace?: string;
}

/** Renders the resource view for a nav-tree page id, or a placeholder if none is wired yet. */
export function ResourcePage({
  pageId,
  selectTarget,
  onSelectionConsumed,
}: {
  pageId: string;
  selectTarget?: SelectTarget | null;
  onSelectionConsumed?: () => void;
}) {
  if (pageId === "topology") {
    // Gated here as well as in the sidebar: a flag that only hides the entry
    // leaves the page reachable by URL and by the back button, which is a
    // half-off switch.
    return <TopologyGate />;
  }
  if (pageId === "cluster") {
    return <ClusterOverview />;
  }
  if (pageId === "overview") {
    return <WorkloadsOverview />;
  }
  if (pageId === "port-forwarding") {
    return <PortForwardingPage />;
  }
  if (pageId === "releases") {
    return <HelmReleasesPage />;
  }
  if (pageId === "charts") {
    return <HelmChartsPage />;
  }
  if (!RESOURCES[pageId]) {
    return <NonIdealState icon="build" title={findLabel(pageId)} description="This resource view is coming next." />;
  }
  // Remount per page so the loader's state resets — never render a new resource's
  // columns against the previous resource's rows.
  return (
    <ResourceView key={pageId} pageId={pageId} selectTarget={selectTarget} onSelectionConsumed={onSelectionConsumed} />
  );
}

/** One empty array for every not-yet-ready list, so its identity is stable. */
const NO_ITEMS: readonly never[] = [];

function ResourceView({
  pageId,
  selectTarget,
  onSelectionConsumed,
}: {
  pageId: string;
  selectTarget?: SelectTarget | null;
  onSelectionConsumed?: () => void;
}) {
  const descriptor: Descriptor<any> = RESOURCES[pageId];
  const label = findLabel(pageId).toLowerCase();
  const { state, reload } = useResource(
    cluster => descriptor.load(cluster),
    pageId,
    descriptor.watchQuery,
    descriptor.merge,
  );
  const [search, setSearch] = useState("");
  // Namespace selection is cluster-wide (shared store), so it scopes every list.
  const namespaces = useSelectedNamespaces();
  const setNamespaces = setSelectedNamespaces;

  const [selected, setSelected] = useState<any>(null);
  // A full-page custom view (e.g. a CRD row → its instance browser), shown
  // instead of the list until dismissed.
  const [custom, setCustom] = useState<{ node: ReactNode; title: string } | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const [scaling, setScaling] = useState<{ row: any; value: number } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createText, setCreateText] = useState("");
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  const openCreate = () => {
    const q = descriptor.watchQuery;
    setCreateText(
      q
        ? `apiVersion: ${q.apiVersion}\nkind: ${q.kind}\nmetadata:\n  name: new-${q.kind.toLowerCase()}\n  namespace: default\n`
        : "",
    );
    setCreateOpen(true);
  };
  const runCreate = async () => {
    const cluster = activeCluster();
    if (!cluster) return;
    // Split first, as the dock's create tab already did. `parse` handles one
    // document: given two separated by `---` it throws MULTIPLE_DOCS, so a
    // perfectly valid manifest pair was rejected with "Invalid YAML" and the
    // suggested remedy was a library call the user cannot make. It refused the
    // work rather than half-doing it, which is the better of the two failures,
    // but it still refused.
    let objects: Record<string, unknown>[];
    try {
      objects = createText
        .split(/^---\s*$/m)
        .map(part => parse(part) as Record<string, unknown> | null)
        .filter((object): object is Record<string, unknown> => object != null && typeof object === "object");
    } catch (err) {
      return notify.error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!objects.length) return notify.error("Nothing to create — the document is empty.");
    setBusy(true);
    try {
      // Every document gets its turn, as bulk actions do. A fail-fast loop left
      // the documents before the failure applied, the rest untried, and one
      // error message that said nothing about which was which.
      const outcome = await runBulk(
        objects.map((object, index) => ({ id: String(index), object })),
        entry => cluster.resources.apply(entry.object),
      );
      reload();
      const created = objects.length - outcome.failedIds.length;
      if (outcome.failedIds.length) {
        notify.error(
          `Created ${created} of ${objects.length}; document ${Number(outcome.failedIds[0]) + 1} failed — ${outcome.reasons[0] ?? "unknown error"}`,
        );
      } else {
        notify.success(objects.length === 1 ? "Resource created" : `Created ${objects.length} resources`);
        setCreateOpen(false);
      }
    } catch (err) {
      notify.error(`Create failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const runScale = async () => {
    if (!scaling || !descriptor.scale) return;
    const cluster = activeCluster();
    if (!cluster) return setScaling(null);
    setBusy(true);
    try {
      await descriptor.scale.apply(cluster, scaling.row, scaling.value);
      reload();
      notify.success(`Scaled to ${scaling.value} replica${scaling.value === 1 ? "" : "s"}`);
    } catch (err) {
      notify.error(`Scale failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setScaling(null);
    }
  };

  const runPending = async () => {
    if (!pending) return;
    const cluster = activeCluster();
    if (!cluster) return setPending(null);
    setBusy(true);
    let keepSelected: ReadonlySet<string> = new Set();
    try {
      const outcome = await pending.run(cluster);
      setSelected(null);
      reload();
      if (isBulkOutcome(outcome) && outcome.failedIds.length) {
        // Partial success is the common bulk outcome — RBAC on some namespaces,
        // a conflict on one object — and reporting it as a flat failure hid both
        // what worked and what to retry.
        keepSelected = new Set(outcome.failedIds);
        notify.error(`${pending.label}: ${outcome.failedIds.length} failed — ${outcome.reasons[0] ?? "unknown error"}`);
      } else notify.success(pending.success);
    } catch (err) {
      notify.error(`${pending.label} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setPending(null);
      // Only what succeeded leaves the selection, so a retry is one click.
      setChecked(keepSelected);
    }
  };

  /** One menu, used by the row's ⋯ and by the drawer's Actions ▾. The drawer
   *  used to render its own icon-button strip, which both duplicated this list
   *  and silently omitted Logs, Shell, Port Forward and Force Delete. */
  const rowMenuContent = (row: any): ReactElement => {
    const name = rowName(descriptor, row) || "resource";
    const kindLabel = findLabel(pageId).replace(/s$/, "");
    const actionItems = (descriptor.actions ?? [])
      .filter(a => !a.show || a.show(row))
      .map(a => (
        <MenuItem
          key={a.key}
          icon={typeof a.icon === "function" ? a.icon(row) : a.icon}
          intent={a.intent}
          text={a.label(row)}
          onClick={() =>
            setPending({
              label: a.label(row),
              message: a.confirm ? a.confirm(row) : `${a.label(row)} ${kindLabel} ${name}?`,
              intent: a.intent ?? "primary",
              run: c => a.run(c, row),
              success: `${a.label(row)}: ${name}`,
              row,
            })
          }
        />
      ));
    return (
      <Menu>
        <MenuItem icon="eye-open" text="View details" onClick={() => setSelected(row)} />
        {descriptor.logs && <MenuDivider />}
        {descriptor.logs &&
          (() => {
            const p = descriptor.logs(row);
            const key = p.podRef.toKey();
            return (
              <>
                <MenuItem
                  icon="align-left"
                  text="Logs"
                  onClick={() =>
                    openDock({
                      id: `logs:${key}`,
                      kind: "logs",
                      title: `Logs: ${p.podRef.name}`,
                      render: () => <LogsView {...p} />,
                    })
                  }
                />
                <MenuItem
                  icon="console"
                  text="Shell"
                  onClick={() =>
                    openDock({
                      id: `shell:${key}`,
                      kind: "shell",
                      title: `Shell: ${p.podRef.name}`,
                      render: () => <TerminalView {...p} />,
                    })
                  }
                />
                <MenuItem
                  icon="exchange"
                  text="Port Forward"
                  onClick={() =>
                    openDock({
                      id: `forward:${key}`,
                      kind: "forward",
                      title: `Forward: ${p.podRef.name}`,
                      render: () => <PortForwardView podRef={p.podRef} />,
                    })
                  }
                />
              </>
            );
          })()}
        {(actionItems.length > 0 || descriptor.scale) && <MenuDivider />}
        {actionItems}
        {descriptor.scale && (
          <MenuItem
            icon="layers"
            text="Scale…"
            onClick={() => setScaling({ row, value: descriptor.scale!.current(row) })}
          />
        )}
        {descriptor.remove && (
          <MenuItem
            icon="trash"
            intent="danger"
            text="Delete"
            onClick={() =>
              setPending({
                label: "Delete",
                message: `Delete ${kindLabel} ${name}? This cannot be undone.`,
                intent: "danger",
                run: c => descriptor.remove!(c, row),
                success: `Deleted ${name}`,
                row,
              })
            }
          />
        )}
        {descriptor.remove && descriptor.refOf && descriptor.watchQuery && (
          <MenuItem
            icon="delete"
            intent="danger"
            text="Force Delete"
            onClick={() =>
              setPending({
                label: "Force Delete",
                message: `Force delete ${kindLabel} ${name} (grace period 0)? Use only for stuck/terminating objects.`,
                intent: "danger",
                run: c =>
                  c.resources.remove(descriptor.refOf!(row), descriptor.watchQuery!.resource, {
                    gracePeriodSeconds: 0,
                  }),
                success: `Force deleted ${name}`,
                // Force Delete is the more destructive of the two and was the
                // one showing no cascade warning: DeleteImpact renders only when
                // `pending.row` is set, and only ordinary Delete set it.
                row,
              })
            }
          />
        )}
      </Menu>
    );
  };

  const openRowMenu = (row: any, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu({ targetOffset: { left: e.clientX, top: e.clientY }, content: rowMenuContent(row) });
  };

  // Stable identities, deliberately. DetailDrawer's panels key their effects on
  // these callbacks; as inline props they changed on every render, so any watch
  // merge refetched the YAML and reset the editor — destroying unsaved edits
  // mid-typing — and restarted the events fetch and the metrics poller.
  const fetchRaw = useCallback(
    async (row: any) => {
      const cluster = activeCluster();
      if (!cluster || !descriptor.refOf || !descriptor.watchQuery) return null;
      const obj = await cluster.resources.get(descriptor.refOf(row), descriptor.watchQuery.resource);
      return obj?.raw ?? null;
    },
    [descriptor],
  );

  const applyRaw = useCallback(
    async (object: any) => {
      const cluster = activeCluster();
      if (!cluster) return;
      await cluster.resources.apply(object);
      reload();
    },
    [reload],
  );

  const fetchEvents = useCallback(
    async (row: any) => {
      const cluster = activeCluster();
      if (!cluster || !descriptor.refOf) return [];
      const ref = descriptor.refOf(row);
      const objs = await cluster.resources.list({
        apiVersion: "v1",
        kind: "Event",
        resource: "events",
        namespace: ref.namespace,
      });
      return objs
        .map(o => o.raw as any)
        .filter(raw => raw?.involvedObject?.kind === ref.kind && raw?.involvedObject?.name === ref.name)
        .map((raw, i) => ({
          id: String(raw.metadata?.uid ?? i),
          type: String(raw.type ?? "Normal"),
          reason: String(raw.reason ?? ""),
          message: String(raw.message ?? ""),
          count: Number(raw.count ?? 1),
          age: age(raw.lastTimestamp ?? raw.eventTime ?? raw.metadata?.creationTimestamp),
        }));
    },
    [descriptor],
  );

  const rowMenu = (row: any) => (
    <Button variant="minimal" size="small" icon="more" aria-label="Actions" onClick={e => openRowMenu(row, e)} />
  );

  // The drawer's header: one labelled Actions menu rather than a strip of icon
  // buttons — every mutation behind a single labelled control.
  const drawerActions = (row: any): ReactNode => (
    <MenuPopover placement="bottom-end" content={rowMenuContent(row)}>
      <Button size="small" rightIcon="caret-down" text="Actions" />
    </MenuPopover>
  );

  // A shared empty array, not a fresh `[]`. A new literal each render changes
  // the identity every one of the memos below keys on, so while the list is
  // loading or errored they all recomputed on every render — a memo that never
  // hits. `state.items` is already stable once ready.
  const items = state.status === "ready" ? state.items : NO_ITEMS;

  // Cross-object navigation landed here: once rows load, open the drawer for the
  // requested name/namespace, then tell the shell we've consumed the target.
  useEffect(() => {
    if (!selectTarget || state.status !== "ready" || !descriptor.refOf) return;
    const match = items.find(row => {
      const ref = descriptor.refOf!(row);
      return (
        ref.name === selectTarget.name && (selectTarget.namespace == null || ref.namespace === selectTarget.namespace)
      );
    });
    if (match) {
      setSelected(match);
      onSelectionConsumed?.();
      return;
    }
    // No match yet does not mean no match. Following a Controlled By link can
    // arrive while a reload is in flight or before a watch ADDED is applied, and
    // this used to consume the target anyway — the shell cleared it, the row
    // turned up a moment later, and the drawer never opened. `items` is now a
    // dependency so a later arrival still matches, with a grace period so a
    // genuinely absent object says so instead of hanging on forever.
    const giveUp = setTimeout(() => {
      notify.error(`${selectTarget.name} is not in this view.`);
      onSelectionConsumed?.();
    }, 5000);
    return () => clearTimeout(giveUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectTarget, state.status, items]);
  // Rancher's grouped resource list. Off by default — grouping costs a row of
  // chrome per namespace, which is only worth it once the list actually spans
  // several — and remembered per page, since whether a kind is worth grouping
  // is a property of the kind, not of the moment.
  const [groupId, setGroupId] = useState<string>(() => {
    try {
      return localStorage.getItem(`hd-group-${pageId}`) ?? "";
    } catch {
      return "";
    }
  });
  const chooseGroup = (id: string) => {
    setGroupId(id);
    try {
      localStorage.setItem(`hd-group-${pageId}`, id);
    } catch {
      // a blocked store costs the memory of the choice, not the choice
    }
  };

  /**
   * How this list can be grouped.
   *
   * Rancher's table takes a set of group options rather than one key, and Argo's
   * pod view offers node as one of its groupings. Together that is the shape
   * here: namespace comes free for any namespaced kind, and a kind contributes
   * whatever else makes sense for it — Pods add Node, so "what is running where"
   * becomes answerable from the list instead of by sorting a hidden column.
   */
  const groupChoices = useMemo(() => {
    const out: { id: string; label: string; of: (row: any) => string }[] = [];
    if (descriptor.namespaceOf)
      out.push({ id: "namespace", label: "Namespace", of: r => descriptor.namespaceOf!(r) ?? "—" });
    for (const g of descriptor.groupOptions ?? []) out.push({ id: g.id, label: g.label, of: g.of });
    return out;
  }, [descriptor]);
  const activeGroup = groupChoices.find(g => g.id === groupId);

  const allNamespaces = useMemo(() => {
    if (!descriptor.namespaceOf) return [];
    return [...new Set(items.map(descriptor.namespaceOf).filter(Boolean))].sort() as string[];
  }, [items, descriptor]);
  // Counted off `items`, not `filtered`: the point of the facet is to show where
  // objects are, so selecting a namespace must not empty out its neighbours.
  const namespaceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!descriptor.namespaceOf) return counts;
    for (const row of items) {
      const ns = descriptor.namespaceOf(row);
      if (ns) counts.set(ns, (counts.get(ns) ?? 0) + 1);
    }
    return counts;
  }, [items, descriptor]);
  // "Nothing exists" — the query has resolved and returned nothing. Distinct
  // from "nothing matches", and deliberately false while still loading, so the
  // controls do not flicker disabled and back on every page open.
  const emptyList = state.status === "ready" && items.length === 0;
  const filtered = useMemo(
    () =>
      items.filter(row => {
        if (search && !descriptor.text(row).toLowerCase().includes(search.toLowerCase())) return false;
        if (descriptor.namespaceOf && namespaces.size && !namespaces.has(descriptor.namespaceOf(row) ?? ""))
          return false;
        return true;
      }),
    [items, search, namespaces, descriptor],
  );

  const checkedRows = useMemo(() => filtered.filter(r => checked.has(r.id)), [filtered, checked]);

  /**
   * Bulk actions for the current selection, by Rancher's rule.
   *
   * `SortableTable/selection.js` offers an action when *some* selected row
   * supports it, not when every one does — and then runs it over only the rows
   * that do. Offering the intersection instead means one odd row silently
   * removes an action from the other forty; offering the union and failing
   * halfway is worse. This takes Rancher's middle: shown when it applies to
   * something, and the count on the button says to how many.
   */
  const bulkActions = useMemo(
    () =>
      (descriptor.actions ?? [])
        .map(a => ({ action: a, rows: checkedRows.filter(r => !a.show || a.show(r)) }))
        .filter(x => x.rows.length > 0),
    [descriptor.actions, checkedRows],
  );

  const allSelected = filtered.length > 0 && filtered.every(r => checked.has(r.id));
  const selection: Selection | undefined = descriptor.remove
    ? {
        ids: checked,
        allSelected,
        onToggle: (id: string) =>
          setChecked(s => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
        onToggleAll: () => setChecked(allSelected ? new Set() : new Set(filtered.map(r => r.id))),
      }
    : undefined;

  if (state.status === "no-cluster") {
    return (
      <NonIdealState
        icon="layout-sorted-clusters"
        title="No active cluster"
        description="Pick a cluster from the Hotbar to connect."
      />
    );
  }
  // Loading deliberately does *not* return early. It used to, so the toolbar did
  // not exist while the request was in flight and then appeared with the data,
  // shoving the table down the page. Rendering the same frame throughout and
  // swapping only the body is what makes the arrival silent.
  if (state.status === "error") {
    return (
      <NonIdealState
        icon="error"
        title={`Couldn't load ${label}`}
        description={state.message}
        action={<Button text="Retry" onClick={reload} />}
      />
    );
  }

  if (custom) {
    return (
      <div className={styles.page}>
        <div className={styles.toolbar}>
          <Button
            icon="arrow-left"
            variant="minimal"
            size="small"
            text={`Back to ${label}`}
            onClick={() => setCustom(null)}
          />
          <span className={styles.spacer} />
        </div>
        <div className={styles.body}>{custom.node}</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Portalled into the app header. A page's controls belong in the header
          rather than in a strip above the content — which gives the table its
          full pane back and stops
          the chrome changing height between a page that has filters and one
          that does not. */}
      <HeaderActions>
        {/* Only when there is more than one namespace in the list: grouping a
            single group is a header row that says what the filter already says.
            Rancher gates its own group control the same way. */}
        {groupChoices.length > 0 && allNamespaces.length > 1 && (
          <MenuPopover
            placement="bottom-end"
            content={
              <Menu>
                <MenuItem icon={groupId === "" ? "tick" : "blank"} text="No grouping" onClick={() => chooseGroup("")} />
                {groupChoices.map(g => (
                  <MenuItem
                    key={g.id}
                    icon={groupId === g.id ? "tick" : "blank"}
                    text={g.label}
                    onClick={() => chooseGroup(g.id)}
                  />
                ))}
              </Menu>
            }
          >
            <Tooltip
              content={activeGroup ? `Grouped by ${activeGroup.label.toLowerCase()}` : "Group by"}
              compact
              minimal
            >
              <Button
                icon="group-objects"
                size="small"
                variant="minimal"
                active={Boolean(activeGroup)}
                aria-label="Group by"
              />
            </Tooltip>
          </MenuPopover>
        )}
        {allNamespaces.length > 0 && (
          <NamespaceFilter
            namespaces={allNamespaces}
            counts={namespaceCounts}
            total={items.length}
            selected={namespaces}
            onChange={setNamespaces}
          />
        )}
        {/* No count inside the field, and the placeholder is just "Search". The
            count read filtered-of-total, which is a second answer to a question
            the table below is already answering, and it forced the field wide
            enough to hold it. In a 50px chrome row shared with a breadcrumb and
            a menu bar that width is the scarce thing.

            Absent, not disabled, when there is nothing to search: a greyed-out
            field still advertises a capability, and the empty state already
            says there is nothing here.

            The condition is `items`, never `filtered`. A filter hiding
            everything must keep the field — it is the way *out* of that state,
            and removing it would strand the user with a query they can no
            longer see or clear. */}
        {!emptyList && (
          <InputGroup
            className={styles.search}
            /* Sized through the component, not by reaching for its class from
               CSS — the chrome row is 50px and this was drawn for a 42px strip
               with a line to itself. */
            size="small"
            leftIcon="search"
            placeholder="Search"
            value={search}
            onValueChange={setSearch}
            round
          />
        )}
        {descriptor.watchQuery && descriptor.creatable !== false && (
          <Button icon="plus" size="small" text="New" intent="primary" onClick={openCreate} />
        )}
      </HeaderActions>
      {/* Rancher puts its bulk actions in a bar over the table rather than in
          the page's own header, and that is right here too: the bar exists only
          while a selection does, so putting it in permanent chrome would leave
          a hole in the header the rest of the time. */}
      {/* Driven by `checkedRows`, not `checked`. The two diverge the moment a
          search or namespace filter hides a selected row: the bar counted the
          raw id set while every action iterated the filtered rows, so with the
          selection filtered away the bar said "3 selected", Delete removed
          nothing, and the toast still reported three. */}
      {checkedRows.length > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{checkedRows.length} selected</span>
          {bulkActions.map(({ action, rows }) => (
            <Button
              key={action.key}
              size="small"
              variant="minimal"
              intent={action.intent}
              icon={typeof action.icon === "function" ? action.icon(rows[0]) : action.icon}
              text={
                rows.length === checkedRows.length ? action.label(rows[0]) : `${action.label(rows[0])} (${rows.length})`
              }
              onClick={() =>
                setPending({
                  label: action.label(rows[0]),
                  message: `${action.label(rows[0])} ${rows.length} selected ${label}?`,
                  intent: action.intent ?? "primary",
                  run: cluster => runBulk(rows, row => action.run(cluster, row)),
                  success: `${action.label(rows[0])}: ${rows.length} items`,
                })
              }
            />
          ))}
          {descriptor.remove && (
            <Button
              size="small"
              variant="minimal"
              intent="danger"
              icon="trash"
              text="Delete"
              onClick={() =>
                setPending({
                  label: "Delete",
                  message: `Delete ${checkedRows.length} selected ${label}? This cannot be undone.`,
                  intent: "danger",
                  run: cluster => runBulk(checkedRows, row => descriptor.remove!(cluster, row)),
                  success: `Deleted ${checkedRows.length} items`,
                })
              }
            />
          )}
          <span className={styles.spacer} />
          <Button size="small" variant="minimal" text="Clear" onClick={() => setChecked(new Set())} />
        </div>
      )}
      {(search || namespaces.size > 0) && (
        <div className={styles.filters}>
          {search && (
            <Tag minimal onRemove={() => setSearch("")}>
              Search: {search}
            </Tag>
          )}
          {[...namespaces].map(ns => (
            <Tag key={ns} minimal onRemove={() => setNamespaces(new Set([...namespaces].filter(n => n !== ns)))}>
              Namespace: {ns}
            </Tag>
          ))}
          <Button
            variant="minimal"
            size="small"
            text="Reset filters"
            onClick={() => {
              setSearch("");
              setNamespaces(new Set());
            }}
          />
        </div>
      )}
      <div className={styles.body}>
        {state.status === "loading" ? (
          <TableSkeleton columns={descriptor.columns} label={label} />
        ) : items.length === 0 ? (
          /* `allNamespaces` is derived from `items`, so inside this branch it is
             always empty and the old conditional always chose its second arm: an
             empty cluster was reported as "None exist in the selected
             namespaces", blaming a filter the user had not set. Nothing is
             filtered here by definition — `items` is the unfiltered list. */
          /* An empty state should say what to do next rather than naming the
             absence twice. This keeps the title, which is the part that
             says *which* resource is missing, and spends the description on the
             way forward wherever there is one. "None exist in this cluster yet"
             only restated the heading above it. */
          <NonIdealState
            icon="th"
            title={`No ${label}`}
            description={
              descriptor.watchQuery && descriptor.creatable !== false
                ? "Create the first one with New, above."
                : "None exist in this cluster yet."
            }
          />
        ) : filtered.length === 0 ? (
          // Prescriptive rather than merely empty: name the filter that is
          // hiding things and offer to clear it.
          <NonIdealState
            icon="search"
            title="No matches"
            description={`Nothing matches ${[search && `“${search}”`, namespaces.size > 0 && `${namespaces.size} namespace${namespaces.size > 1 ? "s" : ""}`].filter(Boolean).join(" in ")}. Clear the filters to see all ${items.length}.`}
            action={
              <Button
                text="Reset filters"
                onClick={() => {
                  setSearch("");
                  setNamespaces(new Set());
                }}
              />
            }
          />
        ) : (
          <ObjectTable
            view={{ columns: descriptor.columns, rows: filtered }}
            groupBy={activeGroup?.of}
            onRowClick={row =>
              descriptor.openCustom
                ? setCustom({
                    node: descriptor.openCustom(row),
                    title: rowName(descriptor, row),
                  })
                : setSelected(row)
            }
            rowMenu={rowMenu}
            selection={selection}
            defaultSort={descriptor.defaultSort}
            viewId={pageId}
          />
        )}
      </div>
      <DetailDrawer
        title={
          selected ? (
            <>
              {findLabel(pageId)}: {rowName(descriptor, selected)}
            </>
          ) : (
            ""
          )
        }
        row={selected}
        columns={descriptor.columns}
        onClose={() => setSelected(null)}
        actions={drawerActions}
        fetchRaw={descriptor.refOf && descriptor.watchQuery ? fetchRaw : undefined}
        applyRaw={applyRaw}
        fetchEvents={descriptor.refOf ? fetchEvents : undefined}
        renderLogs={
          descriptor.logs
            ? row => {
                const p = descriptor.logs!(row);
                return <LogsView key={p.podRef.toKey()} {...p} />;
              }
            : undefined
        }
        renderShell={
          descriptor.logs
            ? row => {
                const p = descriptor.logs!(row);
                return <TerminalView key={p.podRef.toKey()} {...p} />;
              }
            : undefined
        }
        renderForward={
          descriptor.logs
            ? row => <PortForwardView podRef={descriptor.logs!(row).podRef} />
            : descriptor.serviceForward
              ? row => descriptor.serviceForward!(row)
              : undefined
        }
      />
      <Alert
        isOpen={pending != null}
        intent={pending?.intent ?? "primary"}
        icon={pending?.intent === "danger" ? "trash" : "warning-sign"}
        confirmButtonText={pending?.label ?? "Confirm"}
        cancelButtonText="Cancel"
        loading={busy}
        onCancel={() => setPending(null)}
        onConfirm={runPending}
      >
        {pending && <p>{pending.message}</p>}
        {pending?.intent === "danger" && pending.row != null && <DeleteImpact row={pending.row} fetchRaw={fetchRaw} />}
      </Alert>
      <Dialog isOpen={scaling != null} onClose={() => setScaling(null)} title="Scale" icon="layers">
        <div className={Classes.DIALOG_BODY}>
          <FormGroup label="Desired replicas">
            <NumericInput
              min={0}
              value={scaling?.value ?? 0}
              onValueChange={v => setScaling(s => (s ? { ...s, value: Number.isFinite(v) ? v : 0 } : s))}
              fill
            />
          </FormGroup>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button text="Cancel" onClick={() => setScaling(null)} />
            <Button text="Scale" intent="primary" loading={busy} onClick={runScale} />
          </div>
        </div>
      </Dialog>
      <Dialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Create ${findLabel(pageId).replace(/s$/, "")}`}
        icon="plus"
        style={{ width: 640 }}
      >
        <div className={Classes.DIALOG_BODY}>
          <TextArea
            value={createText}
            onChange={e => setCreateText(e.target.value)}
            fill
            spellCheck={false}
            style={{ minHeight: 340, fontFamily: "monospace", fontSize: 12, whiteSpace: "pre" }}
          />
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button text="Cancel" onClick={() => setCreateOpen(false)} />
            <Button text="Create" intent="primary" icon="plus" loading={busy} onClick={runCreate} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function NamespaceFilter({
  namespaces,
  counts,
  total,
  selected,
  onChange,
}: {
  namespaces: string[];
  /** How many loaded objects sit in each namespace — counted before the
   *  namespace filter is applied, so choosing one does not zero the rest. */
  counts: ReadonlyMap<string, number>;
  total: number;
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const max = Math.max(0, ...namespaces.map(ns => counts.get(ns) ?? 0));
  const toggle = (ns: string) => {
    const next = new Set(selected);
    if (next.has(ns)) next.delete(ns);
    else next.add(ns);
    onChange(next);
  };
  const label = selected.size === 0 ? "All namespaces" : `Namespaces (${selected.size})`;
  return (
    <MenuPopover
      placement="bottom-end"
      content={
        <Menu>
          {/* The total is scaled against itself, not against `max`: it is by
              definition the largest number here, so measuring it against the
              biggest single namespace pushed the bar past its own track. */}
          <MenuItem
            icon={selected.size === 0 ? "tick" : "blank"}
            text="All namespaces"
            labelElement={<Listogram count={total} max={total} />}
            onClick={() => onChange(new Set())}
            shouldDismissPopover={false}
          />
          <MenuDivider />
          {namespaces.map(ns => (
            <MenuItem
              key={ns}
              icon={selected.has(ns) ? "tick" : "blank"}
              text={ns}
              labelElement={<Listogram count={counts.get(ns) ?? 0} max={max} />}
              onClick={() => toggle(ns)}
              shouldDismissPopover={false}
            />
          ))}
        </Menu>
      }
    >
      {/* The label goes on a narrow window, leaving the filter glyph and its
          caret — the icon is unambiguous and the popover states the selection.
          It is 143px of the ~364px a phone gives the whole chrome row. */}
      <Button
        variant="minimal"
        icon="filter"
        endIcon="caret-down"
        aria-label={label}
        text={<span className={styles.nsLabel}>{label}</span>}
      />
    </MenuPopover>
  );
}

/** "Pod" -> "Pods", but "1 Pod". Kubernetes kinds are CamelCase singular nouns,
 *  so an -s suffix is right for every kind in the table. */
function plural(kind: string, count: number): string {
  const spaced = kind.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return count === 1 ? spaced : `${spaced}s`;
}

/** "2 pods and 1 replica set" */
function listPhrase(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

type Impact = { cascade: string[]; dependents: string[] };

/**
 * What a delete actually does, resolved from the relation table.
 *
 * Two different statements, and they must not be confused. **Cascade** is what
 * Kubernetes will also remove by garbage-collecting ownerReferences — a fact,
 * and easy to misjudge for a Deployment whose Pods are two hops away.
 * **Dependents** are objects that keep running but break: nothing removes the
 * Pods mounting a deleted ConfigMap, they just fail on their next restart, far
 * from the action that caused it.
 *
 * Silent while resolving, not only when empty: a pending lookup and "nothing is
 * affected" must not look alike, or a slow list reads as an all-clear.
 */
function DeleteImpact({
  row,
  fetchRaw,
}: {
  row: unknown;
  fetchRaw: (row: any) => Promise<Record<string, unknown> | null>;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImpact(null);
    void (async () => {
      const cluster = activeCluster();
      const raw = await fetchRaw(row).catch(() => null);
      if (!cluster || !raw) return;
      const list = (q: RelQuery) => cluster.resources.list(q).catch(() => [] as KubeObject[]);
      const resolved = await resolveRelations(raw, list, r => r.dependents === true || r.cascade === true).catch(
        () => [],
      );
      if (cancelled) return;
      // Named by kind, not by the relation's title: a title labels the link
      // ("Used By") and reads as nonsense in a sentence ("2 used by").
      const phrase = (r: (typeof resolved)[number]) => `${r.objects.length} ${plural(r.query.kind, r.objects.length)}`;
      setImpact({
        cascade: resolved.filter(r => r.relation.cascade).map(phrase),
        dependents: resolved.filter(r => r.relation.dependents).map(phrase),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [row, fetchRaw]);

  if (!impact || (impact.cascade.length === 0 && impact.dependents.length === 0)) return null;
  return (
    <>
      {impact.cascade.length > 0 && (
        <Callout intent="primary" icon="trash" className={styles.impact}>
          Also removes {listPhrase(impact.cascade)}.
        </Callout>
      )}
      {impact.dependents.length > 0 && (
        <Callout intent="warning" icon="warning-sign" className={styles.impact}>
          Still in use by {listPhrase(impact.dependents)}. Deleting this will not remove them, and they may fail when
          they next restart.
        </Callout>
      )}
    </>
  );
}

/** Topology, unless it is switched off.
 *
 *  There is no "turned off" page to show: the router stops resolving /topology
 *  when the flag is off, so the app has no URL and the Shell redirects to the
 *  Catalog. This renders nothing for the single frame between the flag flipping
 *  and that redirect landing — long enough to matter only because mounting the
 *  view would start fetching a cluster's whole workload set. */
function TopologyGate() {
  return useFeatureEnabled("topology") ? <TopologyView /> : null;
}

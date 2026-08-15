import { Button, Drawer, NonIdealState, Spinner, Tab, Tabs, Tag, TextArea, Tooltip } from "@blueprintjs/core";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { parse, stringify } from "yaml";
import { CopyButton } from "../copy-button";
import { useFeatureEnabled } from "../feature-flags";
import { MetricsPanel } from "../metrics/metrics-chart";
import { type MetricTab, nodeMetricTabs, podMetricTabs, pvcMetricTabs } from "../metrics/metrics-queries";
import { notify } from "../notifications";
import styles from "./detail.module.css";
import { DETAIL_SECTIONS, GenericSpecSections, type JsonSchema, MetaSection } from "./detail-sections";
import { collapseContext, type DiffLine, diffLines, hasChanges, projectOnto, stripServerFields } from "./diff";
import type { Column } from "./object-table";
import { RelatedResources } from "./related-resources";
import { RelationGraph } from "./relation-graph";

/** Ground-truth metric charts for the kinds Freelens shows them on. */
function metricTabsForRaw(raw: Record<string, unknown>): MetricTab[] | null {
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const meta = (raw.metadata ?? {}) as { name?: string; namespace?: string };
  if (!meta.name) return null;
  if (kind === "Pod" && meta.namespace) return podMetricTabs(meta.namespace, meta.name);
  if (kind === "Node") return nodeMetricTabs(meta.name);
  if (kind === "PersistentVolumeClaim" && meta.namespace) return pvcMetricTabs(meta.namespace, meta.name);
  return null;
}

/** A related event shown in the drawer's Events tab. */
export interface DrawerEvent {
  id: string;
  type: string;
  reason: string;
  message: string;
  age: string;
  count: number;
}

/**
 * DetailDrawer — a right-side drawer with two tabs: **Details** (the descriptor's
 * columns as a key/value list) and **YAML** (the object's raw manifest, editable
 * and applyable). A stepping stone toward the richer per-kind detail sections.
 */
export function DetailDrawer<T extends { id: string }>({
  title,
  row,
  columns,
  onClose,
  fetchRaw,
  applyRaw,
  fetchEvents,
  renderLogs,
  renderShell,
  renderForward,
  actions,
  schema,
}: {
  title: ReactNode;
  row: T | null;
  columns: readonly Column<T>[];
  onClose: () => void;
  fetchRaw?: (row: T) => Promise<Record<string, unknown> | null>;
  applyRaw?: (object: Record<string, unknown>) => Promise<void>;
  fetchEvents?: (row: T) => Promise<DrawerEvent[]>;
  /** Renders a Logs tab for the row (pods only). */
  renderLogs?: (row: T) => ReactNode;
  /** Renders a Shell (exec terminal) tab for the row (pods only). */
  renderShell?: (row: T) => ReactNode;
  /** Renders a Forward (port-forward) tab for the row (pods only). */
  renderForward?: (row: T) => ReactNode;
  /** Per-kind action buttons for the header toolbar (scale, delete, restart, …). */
  actions?: (row: T) => ReactNode;
  /** The kind's own OpenAPI schema, when the cluster supplies one (a CRD's
   *  `spec.versions[].schema.openAPIV3Schema`). Gives the generic sections field
   *  order, types and the author's own descriptions. */
  schema?: JsonSchema;
}) {
  // Controlled so the header's Edit button can jump straight to the YAML tab,
  // and so the tab resets to Details each time a new object opens.
  const [tab, setTab] = useState<string>("details");
  const diffEnabled = useFeatureEnabled("diff");
  // Refresh nonce: bump to force the active panel to re-fetch.
  const [nonce, setNonce] = useState(0);
  const rowId = row?.id;
  useEffect(() => {
    setTab("details");
    setNonce(0);
  }, [rowId]);

  const toolbar = row && (
    <div className={styles.headActions}>
      {fetchRaw && (
        <Tooltip content={applyRaw ? "Edit YAML" : "View YAML"} compact minimal>
          {/* A pencil promises an edit the app won't allow when the resource is
              read-only; the tooltip already flips, so the glyph must too. */}
          <Button
            variant="minimal"
            size="small"
            icon={applyRaw ? "edit" : "code"}
            aria-label={applyRaw ? "Edit YAML" : "View YAML"}
            onClick={() => setTab("yaml")}
          />
        </Tooltip>
      )}
      <Tooltip content="Refresh" compact minimal>
        <Button
          variant="minimal"
          size="small"
          icon="refresh"
          aria-label="Refresh"
          onClick={() => setNonce(n => n + 1)}
        />
      </Tooltip>
      {actions?.(row)}
    </div>
  );

  return (
    <Drawer
      isOpen={row != null}
      onClose={onClose}
      size="725px"
      position="right"
      title={
        <div className={styles.head}>
          <span className={styles.headTitle}>{title}</span>
          {toolbar}
        </div>
      }
    >
      {row && (
        <Tabs
          id="detail-tabs"
          className={styles.tabs}
          selectedTabId={tab}
          onChange={id => setTab(String(id))}
          renderActiveTabPanelOnly
        >
          <Tab
            id="details"
            title="Details"
            panel={<DetailsPanel key={nonce} row={row} columns={columns} fetchRaw={fetchRaw} schema={schema} />}
          />
          {renderLogs && <Tab id="logs" title="Logs" panel={<>{renderLogs(row)}</>} />}
          {renderShell && <Tab id="shell" title="Shell" panel={<>{renderShell(row)}</>} />}
          {renderForward && <Tab id="forward" title="Forward" panel={<>{renderForward(row)}</>} />}
          {fetchRaw && (
            <Tab id="graph" title="Graph" panel={<GraphPanel key={nonce} row={row} fetchRaw={fetchRaw} />} />
          )}
          {fetchRaw && (
            <Tab
              id="yaml"
              title="YAML"
              panel={<YamlPanel key={nonce} row={row} fetchRaw={fetchRaw} applyRaw={applyRaw} />}
            />
          )}
          {fetchRaw && diffEnabled && (
            <Tab id="diff" title="Diff" panel={<DiffPanel key={nonce} row={row} fetchRaw={fetchRaw} />} />
          )}
          {fetchEvents && (
            <Tab id="events" title="Events" panel={<EventsPanel key={nonce} row={row} fetchEvents={fetchEvents} />} />
          )}
        </Tabs>
      )}
    </Drawer>
  );
}

/**
 * Details tab: when a raw manifest is available, render the rich per-kind
 * sections (`MetaSection` + `DETAIL_SECTIONS[kind]`); otherwise fall back to
 * echoing the table columns as key/value rows.
 */
function DetailsPanel<T extends { id: string }>({
  row,
  columns,
  fetchRaw,
  schema,
}: {
  row: T;
  columns: readonly Column<T>[];
  fetchRaw?: (row: T) => Promise<Record<string, unknown> | null>;
  schema?: JsonSchema;
}) {
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!fetchRaw) return;
    let cancelled = false;
    setRaw(null);
    fetchRaw(row)
      .then(r => {
        if (!cancelled) setRaw(r);
      })
      .catch(() => {
        if (!cancelled) setRaw(null);
      });
    return () => {
      cancelled = true;
    };
  }, [row, fetchRaw]);

  const kind = raw && typeof raw.kind === "string" ? raw.kind : "";
  // Memoised, and hoisted above the branch so the hook stays unconditional.
  // Rebuilding this array each render gave MetricsPanel a new `tab` object every
  // time, which tore down and restarted its 30s poller and refired every range
  // query on any re-render of the drawer.
  const metricTabs = useMemo(() => (raw ? metricTabsForRaw(raw) : null), [raw]);
  if (raw) {
    return (
      // Two columns, because linked objects were the last thing in a scrolling
      // list: to see what a Deployment owned you scrolled past its metrics, its
      // metadata and every spec section. They get a column beside the object
      // instead, so "what is attached to this" is answered without
      // leaving the answer to "what is this". Each column scrolls on its own, so
      // reading one never moves the other.
      <div className={styles.detailsLayout}>
        <div className={styles.list}>
          {metricTabs && <MetricsPanel tabs={metricTabs} />}
          {MetaSection(raw)}
          {DETAIL_SECTIONS[kind] ? DETAIL_SECTIONS[kind](raw) : GenericSpecSections(raw, schema)}
        </div>
        {/* Collapses when RelatedResources renders nothing, so an object with no
            links keeps the full width instead of an empty 280px gutter. */}
        <aside className={styles.linkedColumn}>
          <RelatedResources raw={raw} />
        </aside>
      </div>
    );
  }
  return (
    <div className={styles.list}>
      {columns.map(c => (
        <div className={styles.row} key={c.id}>
          <div className={styles.key}>{c.title}</div>
          <div className={styles.value}>{c.render(row)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Diff tab: the live object against `kubectl.kubernetes.io/last-applied-
 * configuration`.
 *
 * Argo CD's diff view is the most useful screen in that UI and it reads its
 * desired side from Git. This reads it from the annotation kubectl writes on
 * every apply, so the same question — has anything changed this since it was
 * applied — is answerable without a GitOps source. Objects that were never
 * applied with kubectl carry no annotation, and the tab says so rather than
 * inventing a comparison.
 */
function DiffPanel<T extends { id: string }>({
  row,
  fetchRaw,
}: {
  row: T;
  fetchRaw: (row: T) => Promise<Record<string, unknown> | null>;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "none" }
    | { status: "ok"; lines: DiffLine[] }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchRaw(row)
      .then(raw => {
        if (cancelled) return;
        if (!raw) return setState({ status: "error", message: "Object not found." });
        const meta = raw.metadata as { annotations?: Record<string, string> } | undefined;
        const applied = meta?.annotations?.["kubectl.kubernetes.io/last-applied-configuration"];
        if (!applied) return setState({ status: "none" });
        let desired: unknown;
        try {
          desired = JSON.parse(applied);
        } catch {
          return setState({ status: "error", message: "The last-applied annotation is not valid JSON." });
        }
        // Three normalisations, each earning its place against a real drift
        // that was measured with none of them:
        //  - strip the server-owned fields from both sides;
        //  - project the live object onto the shape the manifest declared, so
        //    Kubernetes' own defaults are not reported as twenty-five additions;
        //  - sort keys, because the applied JSON and the live object order theirs
        //    differently and an unsorted dump reported `apiVersion: apps/v1` as
        //    both a deletion and an addition of the identical text.
        const declared = stripServerFields(desired);
        const live = projectOnto(declared, stripServerFields(raw));
        const yaml = (v: unknown) => stringify(v, { sortMapEntries: true }).split("\n");
        setState({ status: "ok", lines: collapseContext(diffLines(yaml(declared), yaml(live))) });
      })
      .catch(err => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [row, fetchRaw]);

  if (state.status === "loading") return <Spinner size={20} />;
  if (state.status === "error") return <NonIdealState icon="error" title="Cannot diff" description={state.message} />;
  if (state.status === "none") {
    return (
      <NonIdealState
        icon="git-commit"
        title="No applied configuration"
        description="This object has no kubectl last-applied annotation, so there is nothing to compare the live state against."
      />
    );
  }
  if (!hasChanges(state.lines)) {
    return (
      <NonIdealState icon="tick-circle" title="No drift" description="The live object matches what was last applied." />
    );
  }
  return (
    <pre className={styles.diff}>
      {state.lines.map((line, i) =>
        line.kind === "skip" ? (
          <span
            key={i}
            className={styles.diffSkip}
          >{`  ⋯ ${line.count} unchanged ${line.count === 1 ? "line" : "lines"}`}</span>
        ) : (
          <span
            key={i}
            className={line.kind === "add" ? styles.diffAdd : line.kind === "del" ? styles.diffDel : styles.diffSame}
          >
            {`${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "} ${line.text}`}
          </span>
        ),
      )}
    </pre>
  );
}

function YamlPanel<T extends { id: string }>({
  row,
  fetchRaw,
  applyRaw,
}: {
  row: T;
  fetchRaw: (row: T) => Promise<Record<string, unknown> | null>;
  applyRaw?: (object: Record<string, unknown>) => Promise<void>;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetchRaw(row)
      .then(raw => {
        if (cancelled) return;
        if (!raw) return setText("# object not found");
        const meta = raw.metadata as Record<string, unknown> | undefined;
        if (meta) delete meta.managedFields; // drop server-managed noise
        setText(stringify(raw));
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [row, fetchRaw]);

  const save = async () => {
    if (text == null || !applyRaw) return;
    let object: Record<string, unknown>;
    try {
      object = parse(text) as Record<string, unknown>;
    } catch (err) {
      notify.error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setSaving(true);
    try {
      await applyRaw(object);
      notify.success("Applied changes");
    } catch (err) {
      notify.error(`Apply failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <NonIdealState icon="error" title="Couldn't load YAML" description={error} />;
  if (text == null) return <NonIdealState icon={<Spinner />} title="Loading YAML…" />;
  return (
    <div className={styles.yamlPane}>
      <TextArea
        className={styles.editor}
        value={text}
        onChange={e => setText(e.target.value)}
        spellCheck={false}
        fill
      />
      <div className={styles.yamlActions}>
        <CopyButton text={text} title="Copy YAML" size="medium" />
        {applyRaw && <Button text="Save" intent="primary" icon="floppy-disk" loading={saving} onClick={save} />}
      </div>
    </div>
  );
}

type EventsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; events: DrawerEvent[] };

function EventsPanel<T extends { id: string }>({
  row,
  fetchEvents,
}: {
  row: T;
  fetchEvents: (row: T) => Promise<DrawerEvent[]>;
}) {
  const [state, setState] = useState<EventsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchEvents(row)
      .then(events => {
        if (!cancelled) setState({ status: "ready", events });
      })
      .catch(err => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [row, fetchEvents]);

  // The three non-list states share one centred, fixed-height box, so the panel
  // doesn't jump as events resolve and none of them clings to the top.
  const fill = (node: ReactNode) => <div className={styles.panelFill}>{node}</div>;
  if (state.status === "loading") return fill(<NonIdealState icon={<Spinner />} title="Loading events…" />);
  if (state.status === "error")
    return fill(<NonIdealState icon="error" title="Couldn't load events" description={state.message} />);
  if (state.events.length === 0) {
    return fill(
      <NonIdealState icon="timeline-events" title="No events" description="No recent events for this object." />,
    );
  }
  return (
    <div className={styles.events}>
      {state.events.map(e => (
        <div className={styles.event} key={e.id}>
          <Tag minimal intent={e.type === "Warning" ? "warning" : "none"}>
            {e.reason}
          </Tag>
          <div className={styles.eventMsg}>{e.message}</div>
          <div className={styles.eventMeta}>
            {e.count > 1 ? `×${e.count} · ` : ""}
            {e.age}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Graph tab: the object's raw manifest is what the relation table reads, so
 *  this fetches the same way the Details tab does. */
function GraphPanel<T extends { id: string }>({
  row,
  fetchRaw,
}: {
  row: T;
  fetchRaw: (row: T) => Promise<Record<string, unknown> | null>;
}) {
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRaw(null);
    fetchRaw(row)
      .then(r => {
        if (!cancelled) setRaw(r);
      })
      .catch(() => {
        if (!cancelled) setRaw(null);
      });
    return () => {
      cancelled = true;
    };
  }, [row, fetchRaw]);

  if (!raw) return <NonIdealState icon={<Spinner />} title="Loading…" />;
  return <RelationGraph raw={raw} />;
}

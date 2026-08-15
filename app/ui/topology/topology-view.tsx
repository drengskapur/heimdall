import { Button, Icon, NonIdealState, SegmentedControl, Spinner, Tooltip } from "@blueprintjs/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KubeObject } from "../../application/ports/kubernetes-gateway";
import { activeCluster } from "../../infrastructure/composition-root";
import { type Health, healthIntent, podHealth, replicaHealth } from "../resource/health";
import { badgeFontSize, kindBadge, kindIcon } from "../resource/kind-badge";
import { kindColor } from "../resource/kind-color";
import { useSelectedNamespaces } from "../resource/namespace-store";
import { navigate } from "../router";
import { allocationByNode, type NodeAllocation, type NodeInput, type PodInput, requestsOf } from "./node-allocation";
import { buildTopology, NODE_HEIGHT, NODE_WIDTH, type TopoInput } from "./topology-graph";
import styles from "./topology-view.module.css";

/** The kinds the tree is built from. Enough to span the ownership chain that
 *  actually exists — Deployment → ReplicaSet → Pod, and the standalone
 *  controllers that own pods directly — without fetching the whole cluster. */
const SOURCES = [
  { apiVersion: "apps/v1", kind: "Deployment", resource: "deployments" },
  { apiVersion: "apps/v1", kind: "ReplicaSet", resource: "replicasets" },
  { apiVersion: "apps/v1", kind: "StatefulSet", resource: "statefulsets" },
  { apiVersion: "apps/v1", kind: "DaemonSet", resource: "daemonsets" },
  { apiVersion: "batch/v1", kind: "Job", resource: "jobs" },
  { apiVersion: "v1", kind: "Pod", resource: "pods" },
  // Nodes are not part of the ownership tree — nothing owns them and they own
  // nothing — but the Allocation mode needs their allocatable, and fetching once
  // for both modes keeps switching instant.
  { apiVersion: "v1", kind: "Node", resource: "nodes" },
] as const;

type Meta = {
  uid?: string;
  name?: string;
  namespace?: string;
  ownerReferences?: { uid?: string }[];
};

/** Health per kind, reusing the same scale the tables sort by. */
function healthOf(kind: string, raw: Record<string, unknown>): Health {
  const status = (raw.status ?? {}) as Record<string, unknown>;
  const spec = (raw.spec ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  if (kind === "Pod") {
    const phase = typeof status.phase === "string" ? status.phase : "Unknown";
    const statuses = Array.isArray(status.containerStatuses) ? status.containerStatuses : [];
    const unhealthy = statuses.some(c => !!c && typeof c === "object" && (c as { ready?: boolean }).ready === false);
    return podHealth(phase, unhealthy && phase !== "Succeeded");
  }
  if (kind === "DaemonSet") return replicaHealth(num(status.numberReady), num(status.desiredNumberScheduled));
  if (kind === "Job")
    return num(status.succeeded) > 0 ? "Healthy" : num(status.failed) > 0 ? "Degraded" : "Progressing";
  return replicaHealth(num(status.readyReplicas), num(spec.replicas));
}

/**
 * Topology — the cluster's ownership tree, one node per object.
 *
 * Argo CD's resource tree, built from `ownerReferences` rather than from a
 * declared application. Rendered as SVG rather than canvas so every node stays a
 * real DOM element: focusable, hoverable, and reachable by a screen reader,
 * which a canvas would have to reimplement from nothing.
 */
export function TopologyView() {
  const [objects, setObjects] = useState<{ kind: string; raw: Record<string, unknown> }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Distinct from "still loading". Without it the effect below simply returned
  // when there was no cluster, `objects` stayed null, and the spinner span for
  // ever — /topology opened from a link or a reload showed nothing at all.
  const [noCluster, setNoCluster] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<"graph" | "allocation">("graph");
  const namespaces = useSelectedNamespaces();
  // Read at render so the effect below can key on it. The effect used to have an
  // empty dependency list, so it resolved the cluster once at mount: switching
  // clusters left the previous cluster's graph on screen, and a cold load that
  // finished activating a profile after this mounted stayed on "no active
  // cluster" for good. There is no reactive active-cluster store — 36 call
  // sites read `activeCluster()` imperatively — so this re-runs whenever the
  // view re-renders with a different cluster, which covers switching and late
  // activation without inventing one here.
  const activeId = activeCluster()?.profile.id;

  useEffect(() => {
    let cancelled = false;
    setObjects(null);
    setError(null);
    const cluster = activeCluster();
    setNoCluster(!cluster);
    if (!cluster) return;
    Promise.all(
      SOURCES.map(s =>
        cluster.resources
          .list({ apiVersion: s.apiVersion, kind: s.kind, resource: s.resource })
          // One kind the cluster does not serve, or the user cannot list, must
          // not empty the whole graph — it just contributes nothing.
          .catch(() => [] as KubeObject[])
          .then(list => list.map(o => ({ kind: s.kind, raw: o.raw }))),
      ),
    )
      .then(lists => {
        if (!cancelled) setObjects(lists.flat());
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const topology = useMemo(() => {
    if (!objects) return null;
    const input: TopoInput[] = [];
    for (const { kind, raw } of objects) {
      if (kind === "Node") continue; // fetched for Allocation, not part of the tree
      const meta = (raw.metadata ?? {}) as Meta;
      if (!meta.uid) continue;
      // The page's namespace filter applies here too: a topology of every
      // namespace at once is the hairball this view exists to avoid.
      if (namespaces.size > 0 && meta.namespace && !namespaces.has(meta.namespace)) continue;
      input.push({
        uid: meta.uid,
        kind,
        name: meta.name ?? "",
        namespace: meta.namespace,
        ownerUids: (meta.ownerReferences ?? []).map(o => o.uid).filter((u): u is string => !!u),
        health: healthOf(kind, raw),
      });
    }
    return buildTopology(input);
  }, [objects, namespaces]);

  const allocation = useMemo(() => {
    if (!objects) return null;
    const nodes: NodeInput[] = [];
    const pods: PodInput[] = [];
    for (const { kind, raw } of objects) {
      const meta = (raw.metadata ?? {}) as Meta;
      const status = (raw.status ?? {}) as Record<string, unknown>;
      const spec = (raw.spec ?? {}) as Record<string, unknown>;
      if (kind === "Node") {
        const alloc = (status.allocatable ?? {}) as Record<string, string>;
        nodes.push({
          name: meta.name ?? "",
          allocatableCpu: alloc.cpu,
          allocatableMemory: alloc.memory,
          health: healthOf(kind, raw),
        });
      } else if (kind === "Pod") {
        pods.push({
          name: meta.name ?? "",
          nodeName: typeof spec.nodeName === "string" ? spec.nodeName : undefined,
          health: healthOf(kind, raw),
          requests: requestsOf(spec),
          phase: typeof status.phase === "string" ? status.phase : undefined,
        });
      }
    }
    return allocationByNode(nodes, pods);
  }, [objects]);

  if (noCluster) {
    return (
      <NonIdealState
        icon="layout-sorted-clusters"
        title="No active cluster"
        description="Topology draws one cluster at a time. Pick one to see its workloads."
        action={<Button intent="primary" text="Choose a cluster" onClick={() => navigate({ cluster: "", page: "" })} />}
      />
    );
  }
  if (error) return <NonIdealState icon="error" title="Cannot build topology" description={error} />;
  if (!topology) return <Spinner size={24} />;
  if (topology.nodes.length === 0) {
    return (
      <NonIdealState
        icon="layout-hierarchy"
        title="Nothing to show"
        description="No workloads in the selected namespaces."
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.controls}>
        <SegmentedControl
          small
          value={mode}
          onValueChange={v => setMode(v as "graph" | "allocation")}
          options={[
            { label: "Graph", value: "graph" },
            { label: "Allocation", value: "allocation" },
          ]}
        />
        <span className={styles.gap} />
        {mode === "graph" && (
          <>
            <Tooltip content="Zoom out" compact minimal>
              <Button
                icon="zoom-out"
                size="small"
                variant="minimal"
                aria-label="Zoom out"
                onClick={() => setZoom(z => Math.max(0.3, z - 0.15))}
              />
            </Tooltip>
            <Tooltip content="Zoom in" compact minimal>
              <Button
                icon="zoom-in"
                size="small"
                variant="minimal"
                aria-label="Zoom in"
                onClick={() => setZoom(z => Math.min(2, z + 0.15))}
              />
            </Tooltip>
            <Tooltip content="Reset zoom" compact minimal>
              <Button
                icon="zoom-to-fit"
                size="small"
                variant="minimal"
                aria-label="Reset zoom"
                onClick={() => setZoom(1)}
              />
            </Tooltip>
          </>
        )}
        <span className={styles.count}>
          {mode === "graph" ? `${topology.nodes.length} objects` : `${allocation?.length ?? 0} nodes`}
        </span>
      </div>
      {mode === "allocation" && <AllocationTable rows={allocation ?? []} />}
      {mode === "graph" && (
        <div className={styles.canvas}>
          <svg
            role="img"
            aria-label={`Ownership graph of ${topology.nodes.length} objects`}
            width={topology.width * zoom}
            height={topology.height * zoom}
            viewBox={`0 0 ${topology.width} ${topology.height}`}
          >
            <g className={styles.edges}>
              {topology.edges.map(e => {
                const from = topology.nodes.find(n => n.uid === e.from);
                const to = topology.nodes.find(n => n.uid === e.to);
                if (!from || !to) return null;
                const x1 = from.x + NODE_WIDTH;
                const y1 = from.y + NODE_HEIGHT / 2;
                const x2 = to.x;
                const y2 = to.y + NODE_HEIGHT / 2;
                const mid = (x1 + x2) / 2;
                // Orthogonal elbows rather than curves: the tree is about who owns
                // what, and a right angle reads as a branch where a bezier reads as
                // a flow.
                return <path key={`${e.from}>${e.to}`} d={`M${x1},${y1} H${mid} V${y2} H${x2}`} />;
              })}
            </g>
            {topology.nodes.map(n => (
              <TopoNodeShape key={n.uid} node={n} />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

/**
 * Allocation — requests against allocatable, per node, fullest first.
 *
 * Requests rather than usage, deliberately: usage needs a metrics server and
 * answers a different question. The scheduler places pods on requests against
 * allocatable, so this is the number that decides whether the next pod fits.
 */
function AllocationTable({ rows }: { rows: readonly NodeAllocation[] }) {
  if (rows.length === 0) {
    return <NonIdealState icon="server" title="No nodes" description="The cluster reported no nodes." />;
  }
  return (
    <div className={styles.alloc}>
      {rows.map(n => (
        <div key={n.name} className={styles.allocRow}>
          <div className={styles.allocHead}>
            <span className={`${styles.allocDot} ${styles[`intent-${healthIntent(n.rollup)}`] ?? ""}`} aria-hidden />
            <span className={styles.allocName}>{n.name}</span>
            <span className={styles.allocPods}>{n.podCount} pods</span>
          </div>
          <AllocBar label="CPU" ratio={n.cpu.ratio} text={n.cpu.text} />
          <AllocBar label="Memory" ratio={n.memory.ratio} text={n.memory.text} />
        </div>
      ))}
    </div>
  );
}

function AllocBar({ label, ratio, text }: { label: string; ratio: number; text: string }) {
  // Truncated, not rounded, because `kubectl describe node` truncates and this
  // is the number people will hold it against: 950m of 4 is 23.75, which kubectl
  // prints as 23%. Rounding to 24 is arguably more accurate and would have made
  // the two disagree on every node.
  const pct = Math.floor(ratio * 100);
  // Over-committed is a real and common state — the sum of requests can exceed
  // allocatable only if something was force-scheduled, but the bar must not
  // silently clip past 100 and look merely full.
  const over = ratio > 1;
  return (
    <div className={styles.bar}>
      <span className={styles.barLabel}>{label}</span>
      <div
        className={styles.barTrack}
        role="meter"
        aria-label={`${label} requests`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={text}
      >
        <div
          className={`${styles.barFill} ${over ? styles.barOver : ""}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className={styles.barText}>{text}</span>
    </div>
  );
}

function TopoNodeShape({ node }: { node: ReturnType<typeof buildTopology>["nodes"][number] }) {
  const ref = useRef<SVGGElement>(null);
  // The rollup, not the node's own health: a Deployment that is itself fine but
  // has a crash-looping pod under it must not look fine.
  const intent = healthIntent(node.rollup);
  const badge = kindBadge(node.kind);
  const glyph = kindIcon(node.kind);
  const label = `${node.kind} ${node.name}${node.rollup === "Healthy" ? "" : ` — ${node.rollup}`}`;
  return (
    <g
      ref={ref}
      className={styles.node}
      transform={`translate(${node.x},${node.y})`}
      tabIndex={0}
      role="group"
      aria-label={label}
    >
      <title>{label}</title>
      <rect className={styles.box} width={NODE_WIDTH} height={NODE_HEIGHT} rx={4} />
      <rect className={`${styles.health} ${styles[`intent-${intent}`] ?? ""}`} width={4} height={NODE_HEIGHT} rx={2} />
      {/* Argo stamps every node with what it *is* before you read its name, and
          that is what makes its tree legible at a glance. Its glyphs are
          per-kind SVG assets; this is the same idea with kubectl's own short
          name on the kind's colour, which a new CRD gets for free where a
          drawn glyph would need drawing. */}
      <circle className={styles.badge} cx={26} cy={NODE_HEIGHT / 2} r={13} style={{ fill: kindColor(node.kind) }} />
      {glyph ? (
        // A real glyph where the kind has one — the same icon the sidebar uses,
        // so a Pod is the same cube in the nav and on the graph. Inside SVG this
        // has to be a <foreignObject>: Blueprint's Icon renders an HTML <span>
        // wrapping its own <svg>, which cannot be a direct child of an <svg>.
        <foreignObject x={13} y={NODE_HEIGHT / 2 - 8} width={26} height={16}>
          <div className={styles.badgeGlyph}>
            <Icon icon={glyph} size={14} color="#fff" />
          </div>
        </foreignObject>
      ) : (
        // No glyph: Argo's initials, which is how a CRD gets a badge without
        // anyone choosing a picture for it.
        <text
          className={styles.badgeText}
          x={26}
          y={NODE_HEIGHT / 2}
          fontSize={badgeFontSize(badge)}
          dominantBaseline="central"
          textAnchor="middle"
        >
          {badge}
        </text>
      )}
      <text className={styles.kind} x={45} y={16}>
        {node.kind}
      </text>
      <text className={styles.name} x={45} y={30}>
        {node.name.length > 17 ? `${node.name.slice(0, 16)}…` : node.name}
      </text>
    </g>
  );
}

import { Card, Classes, Icon, NonIdealState, Tag } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import type { KubeObject } from "../../application/ports/kubernetes-gateway";
import { activeCluster } from "../../infrastructure/composition-root";
import { humanizeClusterError } from "../cluster-error";
import { ClusterPieCharts } from "../metrics/cluster-pie";
import { MetricsPanel } from "../metrics/metrics-chart";
import { clusterMetricTabs } from "../metrics/metrics-queries";

/** Built once. MetricsPanel's query effect depends on the selected tab's
 *  identity, so calling `clusterMetricTabs()` inline handed it a new object
 *  every render — tearing down the 30s poller and refiring every range query
 *  each time the page re-rendered. The drawer already memoises its equivalent;
 *  this call site was missed. The function takes no arguments, so one module
 *  constant is enough. */
const CLUSTER_METRIC_TABS = clusterMetricTabs();

import { detectPrometheus, type PrometheusService, promQuery } from "../metrics/prometheus";
import styles from "./cluster-overview.module.css";
import { age } from "./registry";

/** Detect an in-cluster Prometheus and show a connected/absent badge. */
function PrometheusBadge() {
  const [state, setState] = useState<{ prom: PrometheusService | null; reachable: boolean } | null>(null);
  useEffect(() => {
    const cluster = activeCluster();
    if (!cluster) return;
    let cancelled = false;
    detectPrometheus(cluster)
      .then(async prom => {
        if (cancelled) return;
        if (!prom) {
          setState({ prom: null, reachable: false });
          return;
        }
        // The query *resolving* is the signal — `r.length >= 0` was always true.
        const reachable = await promQuery(cluster, prom, "up")
          .then(() => true)
          .catch(() => false);
        if (!cancelled) setState({ prom, reachable });
      })
      .catch(() => {
        if (!cancelled) setState({ prom: null, reachable: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!state) return null;
  return state.prom ? (
    <Tag minimal intent={state.reachable ? "success" : "warning"} icon="timeline-line-chart">
      Prometheus: {state.prom.namespace}/{state.prom.name}
      {state.reachable ? "" : " (unreachable)"}
    </Tag>
  ) : (
    <Tag minimal icon="timeline-line-chart">
      Prometheus: not detected
    </Tag>
  );
}

interface Stats {
  version: string;
  nodes: number;
  namespaces: number;
  pods: number;
}

type State =
  | { status: "no-cluster" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stats: Stats };

/** Cluster overview — the default landing page: version + top-level counts. */
export function ClusterOverview() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const cluster = activeCluster();
    if (!cluster) {
      setState({ status: "no-cluster" });
      return;
    }
    let cancelled = false;
    Promise.all([
      cluster.gateway.serverVersion(),
      cluster.nodes.list(),
      cluster.resources.list({ apiVersion: "v1", kind: "Namespace", resource: "namespaces" }),
      cluster.pods.list(),
    ])
      .then(([version, nodes, namespaces, pods]) => {
        if (!cancelled) {
          setState({
            status: "ready",
            stats: { version, nodes: nodes.length, namespaces: namespaces.length, pods: pods.length },
          });
        }
      })
      .catch(err => {
        if (!cancelled) setState({ status: "error", message: humanizeClusterError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "no-cluster") {
    return (
      <NonIdealState
        icon="layout-sorted-clusters"
        title="No active cluster"
        description="Pick a cluster from the Hotbar to connect."
      />
    );
  }
  if (state.status === "error") {
    return <NonIdealState icon="error" title="Couldn't load cluster" description={state.message} />;
  }

  // Loading no longer returns a centred spinner. Only the *numbers* are unknown
  // before the request resolves — the four tiles, their labels, their icons and
  // their positions are all known — so the page draws itself and skeletons the
  // four values. Nothing moves when they arrive, and the page says what it is
  // about while you wait instead of saying only "wait".
  const loading = state.status === "loading";
  const stats = state.status === "ready" ? state.stats : null;
  const tiles: Array<{ label: string; value: string | number | undefined; icon: IconName; tone: string }> = [
    { label: "Kubernetes", value: stats?.version, icon: "tag", tone: styles.blue },
    { label: "Nodes", value: stats?.nodes, icon: "server", tone: styles.violet },
    { label: "Namespaces", value: stats?.namespaces, icon: "projects", tone: styles.teal },
    { label: "Pods", value: stats?.pods, icon: "cube", tone: styles.green },
  ];
  return (
    <div className={styles.page}>
      <div className={styles.tiles}>
        {tiles.map(t => (
          <Card key={t.label} className={styles.tile}>
            <span className={`${styles.tileIcon} ${t.tone}`}>
              <Icon icon={t.icon} size={20} />
            </span>
            <span className={styles.tileText}>
              {loading ? (
                <span className={`${styles.tileValue} ${styles.tileValueSkeleton} ${Classes.SKELETON}`}>&nbsp;</span>
              ) : (
                <span className={styles.tileValue}>{t.value}</span>
              )}
              <span className={styles.tileLabel}>{t.label}</span>
            </span>
          </Card>
        ))}
      </div>
      <section className={`${styles.section} ${styles.metricsSection}`}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Metrics</div>
          <PrometheusBadge />
        </div>
        {/* A reserved, centred box. Metrics resolve after the tiles, and the
            loading spinner, the "unavailable" state, and a rendered chart all
            have different natural heights — without a fixed box the page jumps
            as each one lands. Fixing the height removes that shift and lets the
            empty state sit in the middle instead of clinging to the top. */}
        <div className={styles.metricsBody}>
          <MetricsPanel tabs={CLUSTER_METRIC_TABS} />
          <ClusterPieCharts />
        </div>
      </section>
      <ClusterIssues />
    </div>
  );
}

interface Issue {
  id: string;
  message: string;
  object: string;
  source: string;
  age: string;
}

/** A node condition that indicates a problem (Ready≠True, or a pressure=True). */
function nodeIssues(nodes: KubeObject[]): Issue[] {
  const out: Issue[] = [];
  for (const n of nodes) {
    const name = (n.raw.metadata as { name?: string } | undefined)?.name ?? "node";
    const conditions = ((n.raw.status as { conditions?: unknown[] } | undefined)?.conditions ?? []) as {
      type?: string;
      status?: string;
      reason?: string;
      message?: string;
      lastTransitionTime?: string;
    }[];
    for (const c of conditions) {
      const bad = (c.type === "Ready" && c.status !== "True") || (c.type !== "Ready" && c.status === "True"); // pressure/unavailable conditions are bad when True
      if (bad) {
        out.push({
          id: `${name}-${c.type}`,
          message: c.message || c.reason || `${c.type}=${c.status}`,
          object: `Node/${name}`,
          source: "kubelet",
          age: age(c.lastTransitionTime),
        });
      }
    }
  }
  return out;
}

/** Cluster Issues — warning node conditions + recent Warning events (Freelens's
 *  cluster-overview ClusterIssues table). */
function ClusterIssues() {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  useEffect(() => {
    const cluster = activeCluster();
    if (!cluster) return;
    let cancelled = false;
    Promise.all([
      cluster.resources.list({ apiVersion: "v1", kind: "Node", resource: "nodes" }).catch(() => [] as KubeObject[]),
      cluster.resources.list({ apiVersion: "v1", kind: "Event", resource: "events" }).catch(() => [] as KubeObject[]),
    ])
      .then(([nodes, events]) => {
        if (cancelled) return;
        const eventIssues: Issue[] = events
          .map(
            e =>
              e.raw as {
                type?: string;
                message?: string;
                reason?: string;
                involvedObject?: { kind?: string; name?: string };
                source?: { component?: string };
                lastTimestamp?: string;
                metadata?: { uid?: string };
              },
          )
          .filter(e => e.type === "Warning")
          .map((e, i) => ({
            id: String(e.metadata?.uid ?? i),
            message: e.message || e.reason || "",
            object: e.involvedObject ? `${e.involvedObject.kind}/${e.involvedObject.name}` : "",
            source: e.source?.component ?? "",
            age: age(e.lastTimestamp),
          }));
        setIssues([...nodeIssues(nodes), ...eventIssues]);
      })
      .catch(() => {
        if (!cancelled) setIssues([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (issues === null || issues.length === 0) return null;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Issues</div>
        <Tag minimal intent="warning" icon="warning-sign">
          {issues.length}
        </Tag>
      </div>
      <div className={styles.issues}>
        {issues.map(issue => (
          <div className={styles.issueRow} key={issue.id}>
            <Icon icon="warning-sign" intent="warning" size={14} />
            <span className={styles.issueMsg}>{issue.message}</span>
            <span className={styles.issueObj}>{issue.object}</span>
            <span className={styles.issueAge}>{issue.age}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

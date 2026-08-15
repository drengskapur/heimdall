import { Card, NonIdealState, Spinner } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import { activeCluster } from "../../infrastructure/composition-root";
import styles from "./cluster-pie.module.css";
import { detectPrometheus, type PrometheusService, promQuery } from "./prometheus";
import { ClusterUsage, Gauge } from "./usage";

// Cluster resource breakdown — CPU / Memory / Pods with Usage vs Requests vs
// Limits vs Capacity, from the ground-truth "cluster" Prometheus queries
// (helm-provider). Mirrors Freelens's cluster-overview pie charts.
const RATE = "5m";
const QUERIES = {
  cpuUsage: `sum(rate(node_cpu_seconds_total{mode=~"user|system"}[${RATE}]))`,
  cpuRequests: `sum(kube_pod_container_resource_requests{resource="cpu"})`,
  cpuLimits: `sum(kube_pod_container_resource_limits{resource="cpu"})`,
  cpuCapacity: `sum(kube_node_status_capacity{resource="cpu"})`,
  memUsage: `sum(node_memory_MemTotal_bytes - (node_memory_MemFree_bytes + node_memory_Buffers_bytes + node_memory_Cached_bytes))`,
  memRequests: `sum(kube_pod_container_resource_requests{resource="memory"})`,
  memLimits: `sum(kube_pod_container_resource_limits{resource="memory"})`,
  memCapacity: `sum(kube_node_status_capacity{resource="memory"})`,
  podUsage: `sum({__name__=~"kubelet_running_pod_count|kubelet_running_pods"})`,
  podCapacity: `sum(kube_node_status_capacity{resource="pods"})`,
} as const;

type Values = Record<keyof typeof QUERIES, number>;

type State =
  | { status: "detecting" }
  | { status: "no-prometheus" }
  | { status: "error"; message: string }
  | { status: "ready"; values: Values };

function memUnit(bytes: number): { unit: string; divisor: number } {
  if (bytes >= 2 ** 40) return { unit: "TiB", divisor: 2 ** 40 };
  if (bytes >= 2 ** 30) return { unit: "GiB", divisor: 2 ** 30 };
  if (bytes >= 2 ** 20) return { unit: "MiB", divisor: 2 ** 20 };
  return { unit: "KiB", divisor: 2 ** 10 };
}
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** CPU / Memory / Pods breakdown from Prometheus; falls back to the
 *  metrics-server gauges when no Prometheus is present. */
export function ClusterPieCharts() {
  const [state, setState] = useState<State>({ status: "detecting" });

  useEffect(() => {
    const cluster = activeCluster();
    if (!cluster) {
      setState({ status: "no-prometheus" });
      return;
    }
    let cancelled = false;
    let prom: PrometheusService | null = null;

    const sample = async () => {
      try {
        if (!prom) {
          prom = await detectPrometheus(cluster);
          if (!prom) {
            if (!cancelled) setState({ status: "no-prometheus" });
            return;
          }
        }
        const keys = Object.keys(QUERIES) as (keyof typeof QUERIES)[];
        const results = await Promise.all(
          keys.map(k =>
            promQuery(cluster, prom!, QUERIES[k])
              .then(r => r[0]?.value ?? 0)
              .catch(() => 0),
          ),
        );
        if (cancelled) return;
        const values = Object.fromEntries(keys.map((k, i) => [k, results[i]])) as Values;
        setState({ status: "ready", values });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    };

    void sample();
    const timer = setInterval(sample, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (state.status === "detecting")
    return (
      <div className={styles.center}>
        <Spinner size={24} />
      </div>
    );
  // No Prometheus → fall back to the metrics-server gauges (still useful).
  if (state.status === "no-prometheus") return <ClusterUsage />;
  if (state.status === "error")
    return <NonIdealState icon="error" title="Couldn't load metrics" description={state.message} />;

  const v = state.values;
  const mem = memUnit(Math.max(v.memCapacity, v.memUsage, 1));
  return (
    <div className={styles.grid}>
      <Card className={styles.card}>
        <Gauge label="CPU" used={round(v.cpuUsage, 2)} total={round(v.cpuCapacity, 2)} unit="cores" />
        <div className={styles.legend}>
          <Leg label="Requests" value={`${round(v.cpuRequests, 2)}`} />
          <Leg label="Limits" value={`${round(v.cpuLimits, 2)}`} />
          <Leg label="Capacity" value={`${round(v.cpuCapacity, 2)}`} />
        </div>
      </Card>
      <Card className={styles.card}>
        <Gauge
          label="Memory"
          used={round(v.memUsage / mem.divisor, 1)}
          total={round(v.memCapacity / mem.divisor, 1)}
          unit={mem.unit}
        />
        <div className={styles.legend}>
          <Leg label="Requests" value={`${round(v.memRequests / mem.divisor, 1)} ${mem.unit}`} />
          <Leg label="Limits" value={`${round(v.memLimits / mem.divisor, 1)} ${mem.unit}`} />
          <Leg label="Capacity" value={`${round(v.memCapacity / mem.divisor, 1)} ${mem.unit}`} />
        </div>
      </Card>
      <Card className={styles.card}>
        <Gauge label="Pods" used={Math.round(v.podUsage)} total={Math.round(v.podCapacity)} unit="" />
        <div className={styles.legend}>
          <Leg label="Running" value={`${Math.round(v.podUsage)}`} />
          <Leg label="Capacity" value={`${Math.round(v.podCapacity)}`} />
        </div>
      </Card>
    </div>
  );
}

function Leg({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.leg}>
      <span className={styles.legLabel}>{label}</span>
      <span className={styles.legValue}>{value}</span>
    </div>
  );
}

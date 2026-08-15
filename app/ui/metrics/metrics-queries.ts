// Per-kind PromQL, derived verbatim from Freelens's default (Helm) Prometheus
// provider: `packages/technical-features/prometheus/src/helm-provider.injectable.ts`.
// Each tab lists one or more named series; `unit` picks the chart's formatter.
// We do NOT invent queries — these mirror the ground-truth `getQuery` switch.

export type MetricUnit = "cpu" | "bytes" | "bytesRate";

/** A single plotted series: a legend label + its PromQL expression. */
export interface MetricSeries {
  readonly key: string;
  readonly label: string;
  readonly expr: string;
}

/** A chart tab: a title, its series, and the value unit for the Y axis. */
export interface MetricTab {
  readonly id: string;
  readonly title: string;
  readonly unit: MetricUnit;
  readonly series: readonly MetricSeries[];
}

const RATE = "5m"; // helm provider's rateAccuracy

/** Escape a Kubernetes name for a PromQL regex matcher.
 *
 *  These selectors use `=~`, and Kubernetes names may contain `.` — node names
 *  are usually FQDNs like ip-10-0-1-2.ec2.internal. Interpolated raw, every dot
 *  is a wildcard, so the chart for one node quietly summed in any sibling whose
 *  name differs only at those positions. Verified: the unescaped matcher also
 *  matches ip-10-0-1-2Xec2Xinternal; escaped, it does not. */
export const promQlLiteral = (value: string): string =>
  value.replace(/[\\^$.|?*+()[\]{}]/g, character => `\\${character}`);

/**
 * Pod metrics (category "pods", selector `pod`). `pod` is a name regex — for a
 * single pod pass its exact name. Tabs match Freelens's pod-details:
 * CPU / Memory / Network / Filesystem.
 */
export function podMetricTabs(namespace: string, pod: string): MetricTab[] {
  const scope = `pod=~"${promQlLiteral(pod)}",namespace="${promQlLiteral(namespace)}"`;
  const nonPod = `container!="POD",container!="",image!=""`;
  return [
    {
      id: "cpu",
      title: "CPU",
      unit: "cpu",
      series: [
        {
          key: "usage",
          label: "Usage",
          expr: `sum(rate(container_cpu_usage_seconds_total{${nonPod},${scope}}[${RATE}])) by (pod)`,
        },
        {
          key: "requests",
          label: "Requests",
          expr: `sum(kube_pod_container_resource_requests{${scope},resource="cpu"}) by (pod)`,
        },
        {
          key: "limits",
          label: "Limits",
          expr: `sum(kube_pod_container_resource_limits{${scope},resource="cpu"}) by (pod)`,
        },
      ],
    },
    {
      id: "memory",
      title: "Memory",
      unit: "bytes",
      series: [
        { key: "usage", label: "Usage", expr: `sum(container_memory_working_set_bytes{${nonPod},${scope}}) by (pod)` },
        {
          key: "requests",
          label: "Requests",
          expr: `sum(kube_pod_container_resource_requests{${scope},resource="memory"}) by (pod)`,
        },
        {
          key: "limits",
          label: "Limits",
          expr: `sum(kube_pod_container_resource_limits{${scope},resource="memory"}) by (pod)`,
        },
      ],
    },
    {
      id: "network",
      title: "Network",
      unit: "bytesRate",
      series: [
        {
          key: "receive",
          label: "Receive",
          expr: `sum(rate(container_network_receive_bytes_total{${scope}}[${RATE}])) by (pod)`,
        },
        {
          key: "transmit",
          label: "Transmit",
          expr: `sum(rate(container_network_transmit_bytes_total{${scope}}[${RATE}])) by (pod)`,
        },
      ],
    },
    {
      id: "filesystem",
      title: "Filesystem",
      unit: "bytes",
      series: [{ key: "usage", label: "Usage", expr: `sum(container_fs_usage_bytes{${nonPod},${scope}}) by (pod)` }],
    },
  ];
}

/**
 * Node metrics (category "nodes"). Freelens's node queries aggregate `by (node)`;
 * we add a `node=~"name"` selector so a single node's drawer shows only itself.
 */
export function nodeMetricTabs(node: string): MetricTab[] {
  const n = `node=~"${promQlLiteral(node)}"`;
  const mp = `mountpoint=~"/"`;
  return [
    {
      id: "cpu",
      title: "CPU",
      unit: "cpu",
      series: [
        {
          key: "usage",
          label: "Usage",
          expr: `sum(rate(node_cpu_seconds_total{${n},mode=~"user|system"}[${RATE}])) by (node)`,
        },
        {
          key: "capacity",
          label: "Capacity",
          expr: `sum(kube_node_status_allocatable{${n},resource="cpu"}) by (node)`,
        },
      ],
    },
    {
      id: "memory",
      title: "Memory",
      unit: "bytes",
      series: [
        {
          key: "usage",
          label: "Usage",
          expr: `sum((node_memory_MemTotal_bytes{${n}} - (node_memory_MemFree_bytes{${n}} + node_memory_Buffers_bytes{${n}} + node_memory_Cached_bytes{${n}}))) by (node)`,
        },
        {
          key: "capacity",
          label: "Capacity",
          expr: `sum(kube_node_status_capacity{${n},resource="memory"}) by (node)`,
        },
      ],
    },
    {
      id: "disk",
      title: "Disk",
      unit: "bytes",
      series: [
        {
          key: "usage",
          label: "Usage",
          expr: `sum(node_filesystem_size_bytes{${n},${mp}} - node_filesystem_avail_bytes{${n},${mp}}) by (node)`,
        },
        { key: "size", label: "Size", expr: `sum(node_filesystem_size_bytes{${n},${mp}}) by (node)` },
      ],
    },
  ];
}

/**
 * Cluster-wide metrics (category "cluster", all nodes). Time-series of
 * Usage / Requests / Limits / Capacity for CPU and Memory — mirrors Freelens's
 * cluster overview chart.
 */
export function clusterMetricTabs(): MetricTab[] {
  const n = `.*`;
  return [
    {
      id: "cpu",
      title: "CPU",
      unit: "cpu",
      series: [
        {
          key: "usage",
          label: "Usage",
          expr: `sum(rate(node_cpu_seconds_total{node=~"${n}",mode=~"user|system"}[${RATE}]))`,
        },
        {
          key: "requests",
          label: "Requests",
          expr: `sum(kube_pod_container_resource_requests{node=~"${n}",resource="cpu"})`,
        },
        {
          key: "limits",
          label: "Limits",
          expr: `sum(kube_pod_container_resource_limits{node=~"${n}",resource="cpu"})`,
        },
        { key: "capacity", label: "Capacity", expr: `sum(kube_node_status_capacity{node=~"${n}",resource="cpu"})` },
      ],
    },
    {
      id: "memory",
      title: "Memory",
      unit: "bytes",
      series: [
        {
          key: "usage",
          label: "Usage",
          expr: `sum(node_memory_MemTotal_bytes{node=~"${n}"} - (node_memory_MemFree_bytes{node=~"${n}"} + node_memory_Buffers_bytes{node=~"${n}"} + node_memory_Cached_bytes{node=~"${n}"}))`,
        },
        {
          key: "requests",
          label: "Requests",
          expr: `sum(kube_pod_container_resource_requests{node=~"${n}",resource="memory"})`,
        },
        {
          key: "limits",
          label: "Limits",
          expr: `sum(kube_pod_container_resource_limits{node=~"${n}",resource="memory"})`,
        },
        { key: "capacity", label: "Capacity", expr: `sum(kube_node_status_capacity{node=~"${n}",resource="memory"})` },
      ],
    },
  ];
}

/** PVC metrics (category "pvc"): disk used vs capacity. */
export function pvcMetricTabs(namespace: string, pvc: string): MetricTab[] {
  const scope = `persistentvolumeclaim="${pvc}",namespace="${namespace}"`;
  return [
    {
      id: "disk",
      title: "Disk",
      unit: "bytes",
      series: [
        {
          key: "usage",
          label: "Used",
          expr: `sum(kubelet_volume_stats_used_bytes{${scope}}) by (persistentvolumeclaim, namespace)`,
        },
        {
          key: "capacity",
          label: "Capacity",
          expr: `sum(kubelet_volume_stats_capacity_bytes{${scope}}) by (persistentvolumeclaim, namespace)`,
        },
      ],
    },
  ];
}

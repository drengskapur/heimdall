import type { Intent } from "@blueprintjs/core";
import { Icon, Tag } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import type { ReactNode } from "react";
import type { KubeObject, ResourceQuery } from "../../application/ports/kubernetes-gateway";
import type { ServiceListItem } from "../../application/use-cases/network";
import type { NodeListItem } from "../../application/use-cases/nodes";
import type { PodListItem } from "../../application/use-cases/pods";
import type { WorkloadListItem } from "../../application/use-cases/workloads";
import type { PersistentVolume, PersistentVolumeClaim } from "../../domain/storage/volume";
import { CpuQuantity, MemoryQuantity } from "../../domain/values/quantity";
import type { ResourceRef } from "../../domain/values/resource-ref";
import { type WorkloadKind, WorkloadStatus } from "../../domain/workload/workload";
import type { ActiveCluster } from "../../infrastructure/composition-root";
import { parseHpaMetrics } from "../metrics/hpa";
import { age } from "./age";
import { CustomResourceView } from "./custom-resources";
import {
  HEALTH_PRIORITY,
  type Health,
  healthIntent,
  nodeHealth,
  phaseHealth,
  podHealth,
  replicaHealth,
} from "./health";
import { setSelectedNamespaces } from "./namespace-store";
import type { Column } from "./object-table";
import { ServiceForwardView } from "./port-forward-view";
import { reconcile } from "./reconcile";
import type { ApplyEvent } from "./use-resource";

/** A per-row action (restart, suspend, cordon, …) exposed in the row ⋮ menu. */
export interface RowAction<T> {
  readonly key: string;
  readonly label: (row: T) => string;
  /** Row-dependent like `label`, so an action whose wording flips per row can
   *  flip its glyph too — a suspended CronJob's "Resume" was rendering a pause. */
  readonly icon: IconName | ((row: T) => IconName);
  readonly intent?: Intent;
  /** If present, confirm with this message before running. */
  readonly confirm?: (row: T) => string;
  readonly run: (cluster: ActiveCluster, row: T) => Promise<unknown>;
  /** Hide the action for rows where it doesn't apply. */
  readonly show?: (row: T) => boolean;
}

/** A resource view = its columns + how to load its rows via the active cluster's use-cases. */
export interface Descriptor<T extends { id: string } = { id: string }> {
  readonly columns: readonly Column<T>[];
  readonly load: (cluster: ActiveCluster) => Promise<readonly T[]>;
  /** Initial sort (e.g. Events newest-first), matching Freelens defaults. */
  readonly defaultSort?: { readonly col: string; readonly dir: "asc" | "desc" };
  /** Searchable text for the toolbar filter (name, namespace, status, …). */
  readonly text: (row: T) => string;
  /** Namespace for the namespace filter; omit for cluster-scoped kinds. */
  readonly namespaceOf?: (row: T) => string | undefined;
  /** Delete this row's object; omit to hide the Delete action for the kind. */
  readonly remove?: (cluster: ActiveCluster, row: T) => Promise<void>;
  /** Collection to watch for live updates (ADDED/MODIFIED/DELETED → reload). */
  readonly watchQuery?: ResourceQuery;
  /** Whether the "New" (create-from-YAML) action applies. Defaults to true when
   *  watchable; set false for kinds that aren't user-created (Nodes, Events). */
  readonly creatable?: boolean;
  /** Extra row actions beyond View/Delete. */
  readonly actions?: readonly RowAction<T>[];
  /** Ways to group the list beyond namespace. Rancher's table takes a set of
   *  group options rather than a single key; Argo's pod view offers node as one
   *  of its groupings, and "what is running where" is a question a flat list
   *  cannot answer at all. Namespace is added automatically when the kind is
   *  namespaced, so this is only the extras. */
  readonly groupOptions?: readonly { readonly id: string; readonly label: string; readonly of: (row: T) => string }[];
  /** The k8s identity of a row — used to fetch its raw object (YAML view). */
  readonly refOf?: (row: T) => ResourceRef;
  /** Scaling support (workload controllers): current replicas + apply. */
  readonly scale?: {
    readonly current: (row: T) => number;
    readonly apply: (cluster: ActiveCluster, row: T, replicas: number) => Promise<unknown>;
  };
  /** Open a full-page custom view for a row instead of the detail drawer
   *  (e.g. a CRD row → its instance browser). */
  readonly openCustom?: (row: T) => ReactNode;
  /** Incremental watch-event merge (merge-by-uid); when absent the view
   *  debounce-reloads the whole list on any change. */
  readonly merge?: ApplyEvent<T>;
  /** Pod-log source for a row (adds a Logs tab to the detail drawer). */
  readonly logs?: (row: T) => { podRef: ResourceRef; containers: string[] };
  /** Custom Forward-tab content for non-pod kinds (e.g. a Service resolves to a
   *  backing pod). Used when `logs` is absent. */
  readonly serviceForward?: (row: T) => ReactNode;
}

const WORKLOAD_PLURAL: Record<WorkloadKind, string> = {
  Deployment: "deployments",
  DaemonSet: "daemonsets",
  StatefulSet: "statefulsets",
  ReplicaSet: "replicasets",
  ReplicationController: "replicationcontrollers",
  Job: "jobs",
  CronJob: "cronjobs",
};

export { age };

const tag = (label: string, intent: Intent) => (
  <Tag minimal intent={intent}>
    {label}
  </Tag>
);

/** A status cell whose colour comes from the normalised health scale while the
 *  text stays Kubernetes' own — see health.ts for why the label is not replaced. */
const healthTag = (label: string, health: Health) => tag(label, healthIntent(health));

/** Sort a status column by severity rather than alphabetically. Ascending puts
 *  the worst first, which is the order you want the moment you sort by status. */
const bySeverity = (health: Health) => HEALTH_PRIORITY[health];

/** A namespace cell that, when clicked, scopes the whole app to that namespace
 *  (Freelens's NamespaceSelectBadge). Stops row-click so it doesn't open the drawer. */
function NsCell({ ns }: { ns?: string }) {
  if (!ns) return <>—</>;
  return (
    <a
      role="button"
      tabIndex={0}
      style={{ cursor: "pointer" }}
      onClick={e => {
        e.stopPropagation();
        setSelectedNamespaces(new Set([ns]));
      }}
    >
      {ns}
    </a>
  );
}

// --- Pods ---
type PodRow = PodListItem & { id: string; cpuM?: number; memB?: number };
const pods: Descriptor<PodRow> = {
  columns: [
    {
      id: "warning",
      title: "",
      render: r => (r.hasIssues ? <Icon icon="warning-sign" intent="warning" size={13} /> : null),
    },
    { id: "name", title: "Name", render: r => r.pod.ref.name, sortValue: r => r.pod.ref.name },
    {
      id: "namespace",
      title: "Namespace",
      render: r => <NsCell ns={r.pod.ref.namespace} />,
      sortValue: r => r.pod.ref.namespace ?? "",
    },
    {
      id: "containers",
      title: "Containers",
      render: r => `${r.pod.containerStatuses.filter(c => c.ready).length}/${r.pod.containerStatuses.length}`,
    },
    {
      id: "restarts",
      title: "Restarts",
      align: "end",
      render: r => r.pod.containerStatuses.reduce((n, c) => n + c.restartCount, 0),
      sortValue: r => r.pod.containerStatuses.reduce((n, c) => n + c.restartCount, 0),
    },
    {
      id: "controlledBy",
      title: "Controlled By",
      render: r => (r.pod.owners?.length ? r.pod.owners.map(o => `${o.kind}/${o.name}`).join(", ") : "—"),
      sortValue: r => r.pod.owners?.[0]?.kind ?? "",
    },
    {
      id: "cpu",
      title: "CPU",
      align: "end",
      // Hidden until asked for: these read "—" on every row unless the cluster
      // runs metrics-server, which docker-desktop, kind, k3d and minikube do
      // not. Two permanently empty columns is what a half-built table looks
      // like. One click in the column menu brings them back where they work.
      defaultHidden: true,
      render: r =>
        r.cpuM != null ? (r.cpuM >= 1000 ? `${+(r.cpuM / 1000).toFixed(2)}` : `${Math.round(r.cpuM)}m`) : "—",
      sortValue: r => r.cpuM ?? -1,
    },
    {
      id: "memory",
      title: "Memory",
      align: "end",
      // Empty without metrics-server; see the CPU column above.
      defaultHidden: true,
      render: r => (r.memB != null ? MemoryQuantity.parse(String(r.memB)).format() : "—"),
      sortValue: r => r.memB ?? -1,
    },
    {
      id: "node",
      title: "Node",
      defaultHidden: true,
      render: r => r.pod.nodeName ?? "—",
      sortValue: r => r.pod.nodeName ?? "",
    },
    { id: "ip", title: "IP", defaultHidden: true, render: r => r.pod.podIP ?? "—" },
    {
      id: "qos",
      title: "QoS",
      defaultHidden: true,
      render: r => r.pod.qosClass ?? "—",
      sortValue: r => r.pod.qosClass ?? "",
    },
    {
      id: "age",
      title: "Age",
      align: "end",
      render: r => age(r.pod.createdAt),
      sortValue: r => Date.parse(r.pod.createdAt ?? "") || 0,
    },
    {
      id: "status",
      title: "Status",
      render: r => healthTag(r.status, podHealth(r.status, r.hasIssues)),
      sortValue: r => bySeverity(podHealth(r.status, r.hasIssues)),
    },
  ],
  load: async c => {
    const [items, metrics] = await Promise.all([
      c.pods.list(),
      c.resources.list({ apiVersion: "metrics.k8s.io/v1beta1", kind: "PodMetrics", resource: "pods" }).catch(() => []),
    ]);
    // Sum container usage per pod, keyed by namespace/name.
    const usage = new Map<string, { cpuM: number; memB: number }>();
    for (const m of metrics) {
      const containers = Array.isArray((m.raw as { containers?: unknown[] })?.containers)
        ? (m.raw as { containers: { usage?: Usage }[] }).containers
        : [];
      let cpuM = 0,
        memB = 0;
      for (const con of containers) {
        cpuM += CpuQuantity.parse(con.usage?.cpu).toMillicores();
        memB += MemoryQuantity.parse(con.usage?.memory).bytes;
      }
      usage.set(`${m.ref.namespace ?? ""}/${m.ref.name}`, { cpuM, memB });
    }
    return items.map(i => {
      const u = usage.get(`${i.pod.ref.namespace ?? ""}/${i.pod.ref.name}`);
      return { ...i, id: i.pod.ref.toKey(), cpuM: u?.cpuM, memB: u?.memB };
    });
  },
  text: r => `${r.pod.ref.name} ${r.pod.ref.namespace ?? ""} ${r.status}`,
  groupOptions: [{ id: "node", label: "Node", of: r => r.pod.nodeName ?? "Unscheduled" }],
  namespaceOf: r => r.pod.ref.namespace,
  remove: (c, r) => c.resources.remove(r.pod.ref, "pods"),
  watchQuery: { apiVersion: "v1", kind: "Pod", resource: "pods" },
  refOf: r => r.pod.ref,
  // Names come from the spec first, with status folded in. A pod that is
  // Pending or ContainerCreating has its spec containers but no statuses yet —
  // exactly when someone opens logs to find out why — and reading statuses
  // alone gave that pod an empty container picker.
  logs: r => ({
    podRef: r.pod.ref,
    containers: [...new Set([...r.pod.containers.map(c => c.name), ...r.pod.containerStatuses.map(c => c.name)])],
  }),
};

// --- Nodes ---
type Usage = { cpu?: string; memory?: string };
type NodeRow = NodeListItem & { id: string; usage?: Usage };
const nodes: Descriptor<NodeRow> = {
  columns: [
    { id: "name", title: "Name", render: r => r.node.ref.name, sortValue: r => r.node.ref.name },
    {
      id: "cpu",
      title: "CPU",
      align: "end",
      // Empty without metrics-server; see the CPU column above.
      defaultHidden: true,
      render: r => (r.usage?.cpu ? CpuQuantity.parse(r.usage.cpu).format() : "—"),
      sortValue: r => (r.usage?.cpu ? CpuQuantity.parse(r.usage.cpu).toMillicores() : -1),
    },
    {
      id: "memory",
      title: "Memory",
      align: "end",
      // Empty without metrics-server; see the CPU column above.
      defaultHidden: true,
      render: r => (r.usage?.memory ? MemoryQuantity.parse(r.usage.memory).format() : "—"),
      sortValue: r => (r.usage?.memory ? MemoryQuantity.parse(r.usage.memory).bytes : -1),
    },
    { id: "roles", title: "Roles", render: r => r.roles, sortValue: r => r.roles },
    { id: "version", title: "Version", render: r => r.node.kubeletVersion ?? "—" },
    {
      id: "internalIP",
      title: "Internal IP",
      defaultHidden: true,
      render: r => r.node.addresses?.find(a => a.type === "InternalIP")?.address ?? "—",
    },
    {
      id: "conditions",
      title: "Conditions",
      defaultHidden: true,
      render: r =>
        r.node.conditions
          ?.filter(c => c.status === "True")
          .map(c => c.type)
          .join(", ") || "—",
    },
    {
      id: "age",
      title: "Age",
      align: "end",
      render: r => age(r.node.createdAt),
      sortValue: r => Date.parse(r.node.createdAt ?? "") || 0,
    },
    {
      id: "status",
      title: "Status",
      render: r => healthTag(r.status, nodeHealth(r.ready, r.status)),
      sortValue: r => bySeverity(nodeHealth(r.ready, r.status)),
    },
  ],
  load: async c => {
    const [items, metrics] = await Promise.all([
      c.nodes.list(),
      c.resources
        .list({ apiVersion: "metrics.k8s.io/v1beta1", kind: "NodeMetrics", resource: "nodes" })
        .catch(() => []),
    ]);
    const usageByName = new Map(metrics.map(m => [m.ref.name, (m.raw as { usage?: Usage } | undefined)?.usage]));
    return items.map(i => ({ ...i, id: i.node.ref.toKey(), usage: usageByName.get(i.node.ref.name) }));
  },
  text: r => `${r.node.ref.name} ${r.roles} ${r.status}`,
  watchQuery: { apiVersion: "v1", kind: "Node", resource: "nodes" },
  creatable: false,
  actions: [
    {
      key: "cordon",
      label: r => (r.node.schedulable ? "Cordon" : "Uncordon"),
      icon: "disable",
      confirm: r =>
        `${r.node.schedulable ? "Cordon (mark unschedulable)" : "Uncordon (mark schedulable)"} node ${r.node.ref.name}?`,
      run: (c, r) => c.gateway.setNodeSchedulable(r.node.ref, !r.node.schedulable),
    },
  ],
  refOf: r => r.node.ref,
};

// --- Workload controllers (one descriptor factory covers all kinds) ---
type WorkloadRow = WorkloadListItem & { id: string; raw?: Record<string, unknown> };

// Read a nested path off a workload row's raw object (for kind-specific columns).
const wpick = (r: WorkloadRow, ...path: string[]): unknown =>
  path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), r.raw);
/** A workload path narrowed to text. `String(wpick(...))` renders an object as
 *  "[object Object]"; `wnum` has always narrowed the number case, and this is the
 *  same guard for the string case. */
const wstr = (r: WorkloadRow, ...path: string[]): string => {
  const v = wpick(r, ...path);
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
};
const wnum = (r: WorkloadRow, ...path: string[]): number => {
  const v = wpick(r, ...path);
  return typeof v === "number" ? v : 0;
};
const wcount = (r: WorkloadRow, ...path: string[]): number => {
  const v = wpick(r, ...path);
  return Array.isArray(v) ? v.length : 0;
};

const wName: Column<WorkloadRow> = {
  id: "name",
  title: "Name",
  render: r => r.workload.ref.name,
  sortValue: r => r.workload.ref.name,
};
const wNs: Column<WorkloadRow> = {
  id: "namespace",
  title: "Namespace",
  render: r => <NsCell ns={r.workload.ref.namespace} />,
  sortValue: r => r.workload.ref.namespace ?? "",
};
const wAge: Column<WorkloadRow> = {
  id: "age",
  title: "Age",
  align: "end",
  render: r => age(r.workload.createdAt),
  sortValue: r => Date.parse(r.workload.createdAt ?? "") || 0,
};
const numCol = (id: string, title: string, ...path: string[]): Column<WorkloadRow> => ({
  id,
  title,
  align: "end",
  render: r => String(wnum(r, ...path)),
  sortValue: r => wnum(r, ...path),
});

/**
 * Status for a replicated workload, on the normalised health scale.
 *
 * These kinds showed Ready and Desired as two numbers and nothing that said
 * whether the pair was good. Reading "2" beside "3" is the same judgement every
 * time and the table can make it: 0 of 3 is Degraded, 2 of 3 is Progressing,
 * 3 of 3 is Healthy, and 0 of 0 is Suspended rather than either.
 *
 * Unlike the Pod and volume columns, the health word *is* the label here.
 * Kubernetes gives a Deployment no single phase to preserve, so there is nothing
 * more specific to show — the rule is to keep Kubernetes' own word where it has
 * one, not to avoid the health vocabulary everywhere.
 */
const healthCol = (readyPath: string[], desiredPath: string[]): Column<WorkloadRow> => {
  const health = (r: WorkloadRow) => replicaHealth(wnum(r, ...readyPath), wnum(r, ...desiredPath));
  return {
    id: "status",
    title: "Status",
    render: r => {
      const h = health(r);
      return healthTag(h, h);
    },
    sortValue: r => bySeverity(health(r)),
  };
};

/** True-status condition types (e.g. "Available, Progressing") — Freelens Conditions column. */
function conditionsText(r: WorkloadRow): string {
  const conds = wpick(r, "status", "conditions");
  if (!Array.isArray(conds)) return "—";
  const on = conds
    .filter(
      (c): c is { type: string; status: string } =>
        !!c && typeof c === "object" && (c as { status?: string }).status === "True",
    )
    .map(c => c.type);
  return on.length ? on.join(", ") : "—";
}
function nodeSelectorText(r: WorkloadRow): string {
  const sel = wpick(r, "spec", "template", "spec", "nodeSelector");
  if (!sel || typeof sel !== "object") return "—";
  const entries = Object.entries(sel as Record<string, unknown>);
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(", ") : "—";
}
function jobDuration(r: WorkloadRow): string {
  const start = wpick(r, "status", "startTime"),
    end = wpick(r, "status", "completionTime");
  if (typeof start !== "string") return "—";
  const from = Date.parse(start),
    to = typeof end === "string" ? Date.parse(end) : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "—";
  const s = Math.max(0, Math.round((to - from) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}
const resumedTag = (r: WorkloadRow) =>
  tag(wpick(r, "spec", "suspend") ? "Suspended" : "Resumed", wpick(r, "spec", "suspend") ? "warning" : "success");

/** Kind-specific columns, exactly matching each Freelens `renderTableHeader`. */
const WORKLOAD_COLUMNS: Record<WorkloadKind, Column<WorkloadRow>[]> = {
  Deployment: [
    wName,
    wNs,
    healthCol(["status", "readyReplicas"], ["spec", "replicas"]),
    numCol("ready", "Ready", "status", "readyReplicas"),
    numCol("desired", "Desired", "spec", "replicas"),
    numCol("updated", "Updated", "status", "updatedReplicas"),
    numCol("available", "Available", "status", "availableReplicas"),
    wAge,
    // Secondary: Status already summarises the rollout, and this is the column
    // that pushed a workload table past a 1280px laptop.
    { id: "conditions", title: "Conditions", defaultHidden: true, render: conditionsText },
  ],
  DaemonSet: [
    wName,
    wNs,
    healthCol(["status", "numberReady"], ["status", "desiredNumberScheduled"]),
    numCol("desired", "Desired", "status", "desiredNumberScheduled"),
    numCol("current", "Current", "status", "currentNumberScheduled"),
    numCol("ready", "Ready", "status", "numberReady"),
    numCol("updated", "Updated", "status", "updatedNumberScheduled"),
    numCol("available", "Available", "status", "numberAvailable"),
    // Usually empty, and wide when it is not — a follow-up question rather than
    // something to scan a list by.
    { id: "nodeSelector", title: "Node Selector", defaultHidden: true, render: nodeSelectorText },
    wAge,
  ],
  StatefulSet: [
    wName,
    wNs,
    healthCol(["status", "readyReplicas"], ["spec", "replicas"]),
    numCol("ready", "Ready", "status", "readyReplicas"),
    numCol("desired", "Desired", "spec", "replicas"),
    wAge,
  ],
  ReplicaSet: [
    wName,
    wNs,
    healthCol(["status", "readyReplicas"], ["spec", "replicas"]),
    numCol("desired", "Desired", "spec", "replicas"),
    numCol("current", "Current", "status", "availableReplicas"),
    numCol("ready", "Ready", "status", "readyReplicas"),
    wAge,
  ],
  ReplicationController: [
    wName,
    wNs,
    healthCol(["status", "readyReplicas"], ["spec", "replicas"]),
    numCol("desired", "Desired", "spec", "replicas"),
    numCol("current", "Current", "status", "availableReplicas"),
    numCol("ready", "Ready", "status", "readyReplicas"),
    wAge,
  ],
  Job: [
    wName,
    wNs,
    { id: "resumed", title: "Resumed", render: resumedTag },
    {
      id: "status",
      title: "Status",
      // `ready` is a count of succeeded pods, not a boolean. Testing it for
      // truthiness called a Job with 1 of 10 completions "Complete", and a Job
      // that had terminally failed with none succeeded "Running". The domain
      // already answers this — `desired > 0 && ready >= desired` — and the
      // comment on that module says status logic lives in one tested place.
      render: r => {
        const complete = WorkloadStatus.isReady(r.workload);
        const failed = !complete && wnum(r, "status", "failed") > 0 && r.workload.ready === 0;
        if (failed) return healthTag("Failed", "Degraded");
        return healthTag(complete ? "Complete" : "Running", complete ? "Healthy" : "Progressing");
      },
      sortValue: r => bySeverity(WorkloadStatus.isReady(r.workload) ? "Healthy" : "Progressing"),
    },
    numCol("succeeded", "Succeeded", "status", "succeeded"),
    numCol("completions", "Completions", "spec", "completions"),
    numCol("parallelism", "Parallelism", "spec", "parallelism"),
    { id: "duration", title: "Duration", align: "end", render: jobDuration },
    wAge,
  ],
  CronJob: [
    wName,
    wNs,
    { id: "schedule", title: "Schedule", render: r => wstr(r, "spec", "schedule") || "—" },
    { id: "timezone", title: "Timezone", render: r => wstr(r, "spec", "timeZone") || "—" },
    { id: "resumed", title: "Resumed", render: resumedTag },
    { id: "active", title: "Active", align: "end", render: r => String(wcount(r, "status", "active")) },
    {
      id: "lastSchedule",
      title: "Last schedule",
      align: "end",
      render: r =>
        age(
          typeof wpick(r, "status", "lastScheduleTime") === "string"
            ? (wpick(r, "status", "lastScheduleTime") as string)
            : undefined,
        ),
    },
    wAge,
  ],
};
const RESTARTABLE = new Set<WorkloadKind>(["Deployment", "DaemonSet", "StatefulSet"]);
const SCALABLE = new Set<WorkloadKind>(["Deployment", "StatefulSet", "ReplicaSet", "ReplicationController"]);
function workloadActions(kind: WorkloadKind): RowAction<WorkloadRow>[] {
  const actions: RowAction<WorkloadRow>[] = [];
  if (RESTARTABLE.has(kind)) {
    actions.push({
      key: "restart",
      label: () => "Restart",
      // Not "refresh": that glyph means re-fetch-this-view elsewhere in the app,
      // and this action rolls every pod in the workload. "reset" reads as
      // restart-the-thing rather than reload-the-data.
      icon: "reset",
      confirm: r => `Restart ${kind} ${r.workload.ref.name}? Its pods will be rolled.`,
      run: (c, r) => c.gateway.restartWorkload(r.workload.ref),
    });
  }
  if (kind === "CronJob") {
    actions.push({
      key: "trigger",
      label: () => "Trigger",
      // "Fire now", freeing `play` below to mean resume-the-schedule; the two
      // actions sit in the same menu and must not share a glyph.
      icon: "flash",
      confirm: r => `Trigger CronJob ${r.workload.ref.name} now? A Job will be created from its template.`,
      run: (c, r) => c.gateway.triggerCronJob(r.workload.ref),
    });
    actions.push({
      key: "suspend",
      label: r => (r.workload.suspended ? "Resume" : "Suspend"),
      icon: r => (r.workload.suspended ? "play" : "pause"),
      confirm: r => `${r.workload.suspended ? "Resume" : "Suspend"} CronJob ${r.workload.ref.name}?`,
      run: (c, r) => c.gateway.setWorkloadSuspended(r.workload.ref, !r.workload.suspended),
    });
  }
  return actions;
}
function workload(kind: WorkloadKind): Descriptor<WorkloadRow> {
  const query: ResourceQuery = {
    apiVersion: kind === "Job" || kind === "CronJob" ? "batch/v1" : kind === "ReplicationController" ? "v1" : "apps/v1",
    kind,
    resource: WORKLOAD_PLURAL[kind],
  };
  return {
    columns: WORKLOAD_COLUMNS[kind],
    // Load the domain list (tested status logic) + the raw objects (kind-specific
    // columns) and merge by ref.
    load: async c => {
      const [items, raws] = await Promise.all([c.workloads.list(kind), c.resources.list(query).catch(() => [])]);
      const rawByKey = new Map(raws.map(o => [o.ref.toKey(), o.raw]));
      return items.map(i => ({ ...i, id: i.workload.ref.toKey(), raw: rawByKey.get(i.workload.ref.toKey()) }));
    },
    text: r => `${r.workload.ref.name} ${r.workload.ref.namespace ?? ""}`,
    namespaceOf: r => r.workload.ref.namespace,
    remove: (c, r) => c.resources.remove(r.workload.ref, WORKLOAD_PLURAL[kind]),
    watchQuery: query,
    actions: workloadActions(kind),
    refOf: r => r.workload.ref,
    ...(SCALABLE.has(kind)
      ? {
          scale: {
            current: (r: WorkloadRow) => r.workload.desired,
            apply: (c, r, n) => c.gateway.scaleWorkload(r.workload.ref, n),
          },
        }
      : {}),
  };
}

// --- Services ---
type ServiceRow = ServiceListItem & { id: string };
const services: Descriptor<ServiceRow> = {
  columns: [
    { id: "name", title: "Name", render: r => r.service.ref.name, sortValue: r => r.service.ref.name },
    {
      id: "namespace",
      title: "Namespace",
      render: r => <NsCell ns={r.service.ref.namespace} />,
      sortValue: r => r.service.ref.namespace ?? "",
    },
    { id: "type", title: "Type", render: r => r.service.type, sortValue: r => r.service.type },
    { id: "clusterIP", title: "Cluster IP", render: r => r.service.clusterIP ?? "—" },
    {
      id: "externalIP",
      title: "External IP",
      render: r => {
        const ext = [...r.service.externalIPs, ...r.service.loadBalancerIngress].filter(Boolean);
        return ext.length ? ext.join(", ") : "—";
      },
    },
    { id: "ports", title: "Ports", render: r => r.ports || "—" },
    { id: "age", title: "Age", align: "end", render: r => age(r.service.createdAt) },
    {
      id: "status",
      title: "Status",
      render: r => {
        const h = serviceHealth(r);
        return healthTag(h === "Progressing" ? "Pending" : "Active", h);
      },
      sortValue: r => bySeverity(serviceHealth(r)),
    },
  ],
  load: async c => (await c.services.list()).map(i => ({ ...i, id: i.service.ref.toKey() })),
  text: r => `${r.service.ref.name} ${r.service.ref.namespace ?? ""} ${r.service.type}`,
  namespaceOf: r => r.service.ref.namespace,
  remove: (c, r) => c.resources.remove(r.service.ref, "services"),
  watchQuery: { apiVersion: "v1", kind: "Service", resource: "services" },
  refOf: r => r.service.ref,
  serviceForward: r => <ServiceForwardView serviceRef={r.service.ref} />,
};

/** A LoadBalancer with no ingress address yet is coming up, not broken. */
const serviceHealth = (r: { service: { type: string; loadBalancerIngress: readonly unknown[] } }): Health =>
  r.service.type === "LoadBalancer" && r.service.loadBalancerIngress.length === 0 ? "Progressing" : "Healthy";

// --- Persistent Volume Claims ---
type PvcRow = { claim: PersistentVolumeClaim; bound: boolean; id: string };
const pvcs: Descriptor<PvcRow> = {
  columns: [
    { id: "name", title: "Name", render: r => r.claim.ref.name },
    { id: "namespace", title: "Namespace", render: r => r.claim.ref.namespace ?? "—" },
    { id: "storageClass", title: "Storage Class", render: r => r.claim.storageClass ?? "—" },
    { id: "capacity", title: "Capacity", render: r => r.claim.capacity ?? "—" },
    { id: "age", title: "Age", align: "end", render: r => age(r.claim.createdAt) },
    {
      id: "status",
      title: "Status",
      render: r => healthTag(r.claim.phase ?? "—", phaseHealth(r.claim.phase)),
      sortValue: r => bySeverity(phaseHealth(r.claim.phase)),
    },
  ],
  load: async c => (await c.storage.listClaims()).map(i => ({ ...i, id: i.claim.ref.toKey() })),
  text: r => `${r.claim.ref.name} ${r.claim.ref.namespace ?? ""} ${r.claim.phase ?? ""}`,
  namespaceOf: r => r.claim.ref.namespace,
  remove: (c, r) => c.resources.remove(r.claim.ref, "persistentvolumeclaims"),
  watchQuery: { apiVersion: "v1", kind: "PersistentVolumeClaim", resource: "persistentvolumeclaims" },
  refOf: r => r.claim.ref,
};

// --- Persistent Volumes ---
type PvRow = { volume: PersistentVolume; bound: boolean; id: string };
const pvs: Descriptor<PvRow> = {
  columns: [
    { id: "name", title: "Name", render: r => r.volume.ref.name },
    { id: "capacity", title: "Capacity", render: r => r.volume.capacity ?? "—" },
    { id: "storageClass", title: "Storage Class", render: r => r.volume.storageClass ?? "—" },
    { id: "reclaim", title: "Reclaim Policy", render: r => r.volume.reclaimPolicy ?? "—" },
    { id: "claim", title: "Claim", render: r => r.volume.claim ?? "—" },
    { id: "age", title: "Age", align: "end", render: r => age(r.volume.createdAt) },
    {
      id: "status",
      title: "Status",
      render: r => healthTag(r.volume.phase ?? "—", phaseHealth(r.volume.phase)),
      sortValue: r => bySeverity(phaseHealth(r.volume.phase)),
    },
  ],
  load: async c => (await c.storage.listVolumes()).map(i => ({ ...i, id: i.volume.ref.toKey() })),
  text: r => `${r.volume.ref.name} ${r.volume.storageClass ?? ""} ${r.volume.phase ?? ""}`,
  remove: (c, r) => c.resources.remove(r.volume.ref, "persistentvolumes"),
  watchQuery: { apiVersion: "v1", kind: "PersistentVolume", resource: "persistentvolumes" },
  refOf: r => r.volume.ref,
};

// --- Generic kinds (CRUD-only, via the generic gateway → KubeObject{ref,raw}) ---
type KubeRow = KubeObject & { id: string };
const created = (r: KubeRow): string | undefined =>
  (r.raw?.metadata as { creationTimestamp?: string } | undefined)?.creationTimestamp;
const field = (r: KubeRow, ...path: string[]): unknown =>
  path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), r.raw);

function generic(
  query: ResourceQuery,
  opts: {
    namespaced?: boolean;
    extra?: Column<KubeRow>[];
    creatable?: boolean;
    defaultSort?: Descriptor["defaultSort"];
    /** Ids of the built-in columns (name, namespace, age) to hide by default.
     *  They stay in the column menu — this only decides what the table opens
     *  with, for a kind where one of them carries nothing worth the width. */
    hideByDefault?: readonly string[];
  } = {},
): Descriptor<KubeRow> {
  const namespaced = opts.namespaced ?? true;
  const hidden = new Set(opts.hideByDefault ?? []);
  const columns: Column<KubeRow>[] = [
    {
      id: "name",
      title: "Name",
      defaultHidden: hidden.has("name"),
      render: r => r.ref.name,
      sortValue: r => r.ref.name,
    },
    ...(namespaced
      ? [
          {
            id: "namespace",
            title: "Namespace",
            render: (r: KubeRow) => <NsCell ns={r.ref.namespace} />,
            sortValue: (r: KubeRow) => r.ref.namespace ?? "",
          },
        ]
      : []),
    ...(opts.extra ?? []),
    {
      id: "age",
      title: "Age",
      align: "end",
      defaultHidden: hidden.has("age"),
      render: r => age(created(r)),
      sortValue: r => Date.parse(created(r) ?? "") || 0,
    },
  ];
  const base: Descriptor<KubeRow> = {
    columns,
    load: async c => (await c.resources.list(query)).map(o => ({ ...o, id: o.ref.toKey() })),
    text: r => `${r.ref.name} ${r.ref.namespace ?? ""}`,
    remove: (c, r) => c.resources.remove(r.ref, query.resource),
    watchQuery: query,
    creatable: opts.creatable,
    defaultSort: opts.defaultSort,
    refOf: r => r.ref,
    // Generic rows *are* KubeObjects, so a watch event maps to a row directly —
    // merge it by uid instead of reloading the whole collection.
    merge: (event, rows) =>
      event.type === "ADDED" || event.type === "MODIFIED" || event.type === "DELETED"
        ? reconcile(rows, event.type, { ...event.object, id: event.object.ref.toKey() }, r => r.id)
        : rows,
  };
  return namespaced ? { ...base, namespaceOf: r => r.ref.namespace } : base;
}

/** A cell value as text. Only scalars are rendered: everything else becomes the
 *  em dash rather than "[object Object]", which is what `String(v)` produced for
 *  any object that reached here off an unschematised path. */
const str = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "—";
/** Joined key names (ConfigMap/Secret Keys column, like Freelens). */
const keyNames = (v: unknown): string =>
  v && typeof v === "object" && Object.keys(v).length ? Object.keys(v).join(", ") : "—";
/** Up to three label chips + an overflow count (Namespaces Labels column). */
function labelsCell(v: unknown): ReactNode {
  if (!v || typeof v !== "object") return "—";
  const entries = Object.entries(v as Record<string, string>);
  if (!entries.length) return "—";
  return (
    <>
      {entries.slice(0, 3).map(([k, val]) => (
        <Tag minimal key={k} style={{ marginRight: 4 }}>
          {k}={val}
        </Tag>
      ))}
      {entries.length > 3 ? `+${entries.length - 3}` : ""}
    </>
  );
}
/** Ingress load-balancer addresses from status. */
const ingressLbs = (r: KubeRow): string => {
  const ing = field(r, "status", "loadBalancer", "ingress") as { ip?: string; hostname?: string }[] | undefined;
  const vals = ing?.map(i => i.ip || i.hostname).filter(Boolean) ?? [];
  return vals.length ? vals.join(", ") : "—";
};
/** Ingress rule hosts from spec. */
const ingressRules = (r: KubeRow): string => {
  const rules = field(r, "spec", "rules") as { host?: string }[] | undefined;
  const hosts = rules?.map(x => x.host || "*") ?? [];
  return hosts.length ? hosts.join(", ") : "—";
};

/** Registry keyed by nav-tree page id → descriptor. Adding a resource = one entry.
 *
 *  The `any` is deliberate and cannot be narrowed. `Descriptor<T>` is invariant in
 *  T — it both produces rows (`load`) and consumes them (`text`, `remove`) — so no
 *  single instantiation accepts every descriptor: `Descriptor<{ id: string }>`
 *  rejects all 36 of them. Expressing "some T, chosen per entry" needs existential
 *  types, which TypeScript does not have. The page is picked by a URL segment at
 *  runtime anyway, so the row type is genuinely unknown until then; safety comes
 *  from each descriptor being internally well-typed at its definition. */
export const RESOURCES: Record<string, Descriptor<any>> = {
  pods,
  nodes,
  deployments: workload("Deployment"),
  "daemon-sets": workload("DaemonSet"),
  "stateful-sets": workload("StatefulSet"),
  "replica-sets": workload("ReplicaSet"),
  "replication-controllers": workload("ReplicationController"),
  jobs: workload("Job"),
  "cron-jobs": workload("CronJob"),
  services,
  "persistent-volume-claims": pvcs,
  "persistent-volumes": pvs,

  // Generic CRUD-only kinds
  namespaces: generic(
    { apiVersion: "v1", kind: "Namespace", resource: "namespaces" },
    {
      namespaced: false,
      extra: [
        { id: "labels", title: "Labels", render: r => labelsCell(field(r, "metadata", "labels")) },
        { id: "status", title: "Status", render: r => str(field(r, "status", "phase")) },
      ],
    },
  ),
  events: generic(
    { apiVersion: "v1", kind: "Event", resource: "events" },
    {
      creatable: false,
      defaultSort: { col: "lastSeen", dir: "desc" },
      // An event's name is its object's name with a hash appended, and Age says
      // the same thing as Last Seen. Together they cost ~200px, which is what
      // pushed Message — the only reason anyone opens this page — off the right
      // edge. `kubectl get events` shows neither.
      hideByDefault: ["name", "age"],
      extra: [
        {
          id: "type",
          title: "Type",
          sortValue: r => str(field(r, "type")),
          render: r => {
            const t = str(field(r, "type"));
            return t === "—" ? (
              t
            ) : (
              <Tag minimal intent={/warn|error|fail/i.test(t) ? "warning" : "none"}>
                {t}
              </Tag>
            );
          },
        },
        { id: "reason", title: "Reason", render: r => str(field(r, "reason")) },
        {
          id: "count",
          title: "Count",
          align: "end",
          sortValue: r => Number(field(r, "count") ?? 1),
          render: r => str(field(r, "count") ?? "1"),
        },
        {
          id: "object",
          title: "Object",
          render: r => {
            const io = field(r, "involvedObject") as { kind?: string; name?: string } | undefined;
            return io?.kind ? `${io.kind}/${io.name ?? ""}` : "—";
          },
        },
        {
          id: "source",
          title: "Source",
          // Which component reported it is a follow-up question, and it is the
          // last 192px standing between Message and a 1280px laptop.
          defaultHidden: true,
          render: r => {
            const src = field(r, "source") as { component?: string; host?: string } | undefined;
            return src?.component ? `${src.component}${src.host ? `, ${src.host}` : ""}` : "—";
          },
        },
        { id: "message", title: "Message", render: r => str(field(r, "message")) },
        {
          id: "lastSeen",
          title: "Last Seen",
          align: "end",
          sortValue: r => Date.parse(str(field(r, "lastTimestamp"))) || 0,
          render: r => age(str(field(r, "lastTimestamp")) === "—" ? undefined : String(field(r, "lastTimestamp"))),
        },
      ],
    },
  ),
  "config-maps": generic(
    { apiVersion: "v1", kind: "ConfigMap", resource: "configmaps" },
    {
      extra: [{ id: "keys", title: "Keys", render: r => keyNames(field(r, "data")) }],
    },
  ),
  secrets: generic(
    { apiVersion: "v1", kind: "Secret", resource: "secrets" },
    {
      extra: [
        { id: "keys", title: "Keys", render: r => keyNames(field(r, "data")) },
        { id: "type", title: "Type", render: r => str(field(r, "type")) },
      ],
    },
  ),
  "resource-quotas": generic({ apiVersion: "v1", kind: "ResourceQuota", resource: "resourcequotas" }),
  endpoints: generic({ apiVersion: "v1", kind: "Endpoints", resource: "endpoints" }),
  ingresses: generic(
    { apiVersion: "networking.k8s.io/v1", kind: "Ingress", resource: "ingresses" },
    {
      extra: [
        { id: "loadbalancers", title: "LoadBalancers", render: r => ingressLbs(r) },
        { id: "rules", title: "Rules", render: r => ingressRules(r) },
      ],
    },
  ),
  "ingress-classes": generic(
    { apiVersion: "networking.k8s.io/v1", kind: "IngressClass", resource: "ingressclasses" },
    { namespaced: false },
  ),
  "network-policies": generic({
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    resource: "networkpolicies",
  }),
  "storage-classes": generic(
    { apiVersion: "storage.k8s.io/v1", kind: "StorageClass", resource: "storageclasses" },
    {
      namespaced: false,
      extra: [{ id: "provisioner", title: "Provisioner", render: r => str(field(r, "provisioner")) }],
    },
  ),
  "service-accounts": generic({ apiVersion: "v1", kind: "ServiceAccount", resource: "serviceaccounts" }),
  roles: generic({ apiVersion: "rbac.authorization.k8s.io/v1", kind: "Role", resource: "roles" }),
  "role-bindings": generic({
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    resource: "rolebindings",
  }),
  "cluster-roles": generic(
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", resource: "clusterroles" },
    { namespaced: false },
  ),
  "cluster-role-bindings": generic(
    { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding", resource: "clusterrolebindings" },
    { namespaced: false },
  ),
  "limit-ranges": generic({ apiVersion: "v1", kind: "LimitRange", resource: "limitranges" }),
  "horizontal-pod-autoscalers": generic(
    { apiVersion: "autoscaling/v2", kind: "HorizontalPodAutoscaler", resource: "horizontalpodautoscalers" },
    {
      extra: [
        {
          id: "targets",
          title: "Targets",
          render: r => {
            const m = parseHpaMetrics(r.raw);
            return m.length ? m.map(x => `${x.current}/${x.target}`).join(", ") : "—";
          },
        },
        { id: "min", title: "Min", align: "end", render: r => str(field(r, "spec", "minReplicas")) },
        { id: "max", title: "Max", align: "end", render: r => str(field(r, "spec", "maxReplicas")) },
        { id: "replicas", title: "Replicas", align: "end", render: r => str(field(r, "status", "currentReplicas")) },
      ],
    },
  ),
  "pod-disruption-budgets": generic({
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    resource: "poddisruptionbudgets",
  }),
  "priority-classes": generic(
    { apiVersion: "scheduling.k8s.io/v1", kind: "PriorityClass", resource: "priorityclasses" },
    {
      namespaced: false,
      extra: [{ id: "value", title: "Value", align: "end", render: r => str(field(r, "value")) }],
    },
  ),
  "runtime-classes": generic(
    { apiVersion: "node.k8s.io/v1", kind: "RuntimeClass", resource: "runtimeclasses" },
    {
      namespaced: false,
      extra: [{ id: "handler", title: "Handler", render: r => str(field(r, "handler")) }],
    },
  ),
  leases: generic(
    { apiVersion: "coordination.k8s.io/v1", kind: "Lease", resource: "leases" },
    {
      extra: [{ id: "holder", title: "Holder", render: r => str(field(r, "spec", "holderIdentity")) }],
    },
  ),
  "mutating-webhook-configs": generic(
    {
      apiVersion: "admissionregistration.k8s.io/v1",
      kind: "MutatingWebhookConfiguration",
      resource: "mutatingwebhookconfigurations",
    },
    {
      namespaced: false,
      extra: [
        {
          id: "webhooks",
          title: "Webhooks",
          align: "end",
          render: r => (field(r, "webhooks") as unknown[] | undefined)?.length ?? 0,
        },
      ],
    },
  ),
  "validating-webhook-configs": generic(
    {
      apiVersion: "admissionregistration.k8s.io/v1",
      kind: "ValidatingWebhookConfiguration",
      resource: "validatingwebhookconfigurations",
    },
    {
      namespaced: false,
      extra: [
        {
          id: "webhooks",
          title: "Webhooks",
          align: "end",
          render: r => (field(r, "webhooks") as unknown[] | undefined)?.length ?? 0,
        },
      ],
    },
  ),
  definitions: {
    ...generic(
      {
        apiVersion: "apiextensions.k8s.io/v1",
        kind: "CustomResourceDefinition",
        resource: "customresourcedefinitions",
      },
      {
        namespaced: false,
        extra: [
          { id: "group", title: "Group", render: r => str(field(r, "spec", "group")) },
          { id: "kind", title: "Kind", render: r => str(field(r, "spec", "names", "kind")) },
          { id: "scope", title: "Scope", render: r => str(field(r, "spec", "scope")) },
        ],
      },
    ),
    // Clicking a CRD row browses its instances rather than opening the drawer.
    openCustom: (r: KubeRow) => <CustomResourceView crd={r.raw} />,
  },
};

/** Reverse lookup: a Kubernetes kind → its nav-tree page id (for cross-object
 *  navigation, e.g. a Pod's owning ReplicaSet → the Replica Sets page). */
export function pageIdForKind(kind: string): string | undefined {
  for (const [pageId, descriptor] of Object.entries(RESOURCES)) {
    if (descriptor.watchQuery?.kind === kind) return pageId;
  }
  return undefined;
}

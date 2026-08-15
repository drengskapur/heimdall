// Maps a Kubernetes workload-controller object (any kind, any vendored version)
// into the Workload domain entity, normalising each kind's bespoke status counts
// into a common desired/ready pair.
import { ResourceRef } from "../../domain/values/resource-ref";
import type { Workload, WorkloadKind } from "../../domain/workload/workload";
import type { WireWorkload } from "../../lib/kube-generated"; // generated union of the workload-controller schemas

// The workload spec/status fields this mapper normalises. A single generated
// type can't describe "any workload kind" (each kind's status counts differ and
// some conflict — Job.status.active is a number, CronJob's is an object list),
// so the *input* contract is the generated `WireWorkload` union while the
// normaliser reads through this documented subset.
interface WorkloadSpecFields {
  replicas?: number;
  completions?: number;
  suspend?: boolean;
  schedule?: string;
}
interface WorkloadStatusFields {
  replicas?: number;
  readyReplicas?: number;
  availableReplicas?: number;
  desiredNumberScheduled?: number;
  numberReady?: number;
  succeeded?: number;
  active?: number | unknown[];
}

function counts(
  kind: WorkloadKind,
  spec: WorkloadSpecFields,
  status: WorkloadStatusFields,
): { desired: number; ready: number } {
  switch (kind) {
    case "DaemonSet":
      return { desired: status.desiredNumberScheduled ?? 0, ready: status.numberReady ?? 0 };
    case "Job":
      return { desired: spec.completions ?? 1, ready: status.succeeded ?? 0 };
    case "CronJob":
      return { desired: 0, ready: Array.isArray(status.active) ? status.active.length : Number(status.active ?? 0) };
    default: // Deployment / ReplicaSet / ReplicationController / StatefulSet
      return { desired: spec.replicas ?? 0, ready: status.readyReplicas ?? 0 };
  }
}

export function toWorkloadDomain(wire: WireWorkload): Workload {
  const meta = wire.metadata || {};
  const spec = (wire.spec ?? {}) as WorkloadSpecFields;
  const status = (wire.status ?? {}) as WorkloadStatusFields;
  const kind = (wire.kind || "Deployment") as WorkloadKind;
  const { desired, ready } = counts(kind, spec, status);
  return {
    ref: ResourceRef.of({
      apiVersion: wire.apiVersion || "apps/v1",
      kind,
      name: meta.name || "",
      namespace: meta.namespace,
      uid: meta.uid,
    }),
    kind,
    desired,
    ready,
    suspended: Boolean(spec.suspend),
    schedule: spec.schedule,
    createdAt: meta.creationTimestamp,
  };
}

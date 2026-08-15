// Pod domain entity and the pod-health domain service. Pure domain logic ported
// from the presentation layer so it can be unit-tested and reused independent of
// the Kubernetes wire format (adapters map DTOs into these shapes).

import { ConditionStatus, ContainerStateKind } from "../shared";
import { ResourceRef } from "../values/resource-ref";

// Pod phase widens the well-known set (the API can return other strings).
export type PodPhase = "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown" | (string & {});
export type { ContainerStateKind };

export interface ContainerState {
  kind: ContainerStateKind;
  reason?: string;
  exitCode?: number;
}

export interface PodContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state: ContainerState;
}

export interface PodContainerSpec {
  name: string;
  /** Init containers with restartPolicy "Always" are sidecars and count toward readiness. */
  init?: boolean;
  restartPolicy?: string;
}

export interface PodCondition {
  type: string;
  status: string;
}

export interface Pod {
  ref: ResourceRef;
  phase?: PodPhase;
  reason?: string;
  deletionTimestamp?: string;
  finalizers?: string[];
  containers: PodContainerSpec[];
  containerStatuses: PodContainerStatus[];
  conditions: PodCondition[];
  readinessGates: string[];
  createdAt?: string;
  /** Node the pod is scheduled on (list "Node" column). */
  nodeName?: string;
  /** Assigned pod IP (list "IP" column). */
  podIP?: string;
  /** QoS class: Guaranteed / Burstable / BestEffort (list "QoS" column). */
  qosClass?: string;
  /** Owning controllers (list "Controlled By" column). */
  owners?: { kind: string; name: string }[];
}

const TERMINAL_UNHEALTHY = new Set(["Failed", "Pending", "Unknown"]);

/** Derives pod health/status the way kubectl and Lens do. */
export const PodHealth = {
  statusMessage(pod: Pod): string {
    if (pod.reason === "Evicted") return "Evicted";
    if (pod.deletionTimestamp) {
      if (pod.containerStatuses.some(s => s.state.kind === "running" || s.state.kind === "waiting"))
        return "Terminating";
      if (pod.finalizers?.length) return "Finalizing";
    }
    return pod.phase || "Waiting";
  },

  hasIssues(pod: Pod): boolean {
    if (!pod.phase) return true;
    if (pod.phase === "Succeeded") return false;
    if (TERMINAL_UNHEALTHY.has(pod.phase)) return true;
    if (
      pod.containerStatuses.some(
        s => s.state.kind === ContainerStateKind.Waiting && s.state.reason === "CrashLoopBackOff",
      )
    )
      return true;
    if (pod.conditions.some(c => c.type === "Ready" && c.status === ConditionStatus.True)) return false;

    const statuses = new Map(pod.containerStatuses.map(s => [s.name, s]));
    const required = [
      ...pod.containers.filter(c => c.init && c.restartPolicy === "Always"),
      ...pod.containers.filter(c => !c.init),
    ];
    if (
      required.some(c => {
        const status = statuses.get(c.name);
        return !status || (!status.ready && status.state.exitCode !== 0);
      })
    )
      return true;

    const conditionStatus = new Map(pod.conditions.map(c => [c.type, c.status]));
    return pod.readinessGates.some(gate => conditionStatus.get(gate) !== ConditionStatus.True);
  },
};

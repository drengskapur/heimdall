// Workload domain entity and status service. Normalises the many controller
// kinds (Deployment/ReplicaSet/StatefulSet/DaemonSet/Job/CronJob) into a common
// desired/ready view so status logic lives in one tested place.
import type { ResourceRef } from "../values/resource-ref";

export type WorkloadKind =
  | "Deployment"
  | "ReplicaSet"
  | "ReplicationController"
  | "StatefulSet"
  | "DaemonSet"
  | "Job"
  | "CronJob";

export interface Workload {
  ref: ResourceRef;
  kind: WorkloadKind;
  /** Desired instance count (replicas / desiredNumberScheduled / completions). */
  desired: number;
  /** Ready instance count (readyReplicas / numberReady / succeeded). */
  ready: number;
  suspended: boolean;
  /** CronJob schedule, when applicable. */
  schedule?: string;
  createdAt?: string;
}

export const WorkloadStatus = {
  /** "1/1" style summary used in list views. */
  readySummary(workload: Workload): string {
    return `${workload.ready}/${workload.desired}`;
  },

  isReady(workload: Workload): boolean {
    if (workload.suspended) return false;
    return workload.desired > 0 && workload.ready >= workload.desired;
  },

  /** A workload that wants instances but has none ready is unhealthy. */
  hasIssues(workload: Workload): boolean {
    if (workload.suspended) return false;
    // Stryker disable next-line ConditionalExpression,EqualityOperator: both are
    // equivalent here. Weakening `> 0` to `>= 0` or to `true` only changes the
    // answer when `desired` is negative, and a replica count cannot be.
    return workload.desired > 0 && workload.ready < workload.desired;
  },
};

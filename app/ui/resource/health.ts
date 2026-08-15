import type { Intent } from "@blueprintjs/core";

/**
 * A normalised health scale, from Argo CD.
 *
 * `ui/src/app/shared/models.ts` defines six codes and — the part that makes them
 * useful — an explicit priority over them. The ordering is what lets a parent's
 * health be `min(children)` and a status column sort by *how bad* rather than
 * alphabetically, which is the question you are actually asking when you sort a
 * list of workloads by status.
 *
 * Heimdall derived status per kind with a different ad-hoc rule each time: Pods
 * compared against the string "Running", Nodes against a `ready` boolean, PVs
 * against a phase, Services against whether a load balancer had an address. Each
 * produced a colour and none produced an order.
 *
 * One deliberate difference from Argo. Argo *replaces* a resource's own status
 * with the health code and shows "Degraded"; here the code sits behind the
 * label and the label stays Kubernetes'. `CrashLoopBackOff` says strictly more
 * than `Degraded`, and a Kubernetes viewer that hides it to show a six-value
 * abstraction has thrown away the useful half. The code drives colour and sort;
 * the phase stays the text.
 */
export type Health = "Missing" | "Degraded" | "Unknown" | "Progressing" | "Suspended" | "Healthy";

/** Argo's `HealthPriority`, verbatim: worst first, so ascending sort = worst first. */
export const HEALTH_PRIORITY: Record<Health, number> = {
  Missing: 0,
  Degraded: 1,
  Unknown: 2,
  Progressing: 3,
  Suspended: 4,
  Healthy: 5,
};

/** Blueprint intent per code. Suspended is deliberately `none`: paused is not a
 *  problem, and colouring it warning makes a deliberate state look like a fault. */
export function healthIntent(health: Health): Intent {
  switch (health) {
    case "Healthy":
      return "success";
    case "Progressing":
      return "primary";
    case "Degraded":
    case "Missing":
      return "danger";
    case "Suspended":
      return "none";
    default:
      return "warning";
  }
}

/** The lowest health among children — a rollup, as Argo computes for an app. */
export function worstHealth(healths: readonly Health[]): Health {
  let worst: Health = "Healthy";
  for (const h of healths) if (HEALTH_PRIORITY[h] < HEALTH_PRIORITY[worst]) worst = h;
  return worst;
}

/**
 * A pod's health from its displayed phase/reason.
 *
 * `hasIssues` already means "a container is not behaving" (restarts, waiting
 * reasons), and it outranks the phase: a pod can be `Running` while a container
 * crash-loops inside it, which is the case the phase alone gets wrong.
 */
export function podHealth(status: string, hasIssues: boolean): Health {
  if (hasIssues) return "Degraded";
  switch (status) {
    case "Running":
    case "Succeeded":
      return "Healthy";
    case "Pending":
    case "ContainerCreating":
    case "PodInitializing":
      return "Progressing";
    case "Failed":
      return "Degraded";
    case "Terminating":
      return "Progressing";
    default:
      return "Unknown";
  }
}

export function nodeHealth(ready: boolean, status: string): Health {
  if (status === "SchedulingDisabled") return "Suspended";
  return ready ? "Healthy" : "Degraded";
}

/** Bound/Available/Pending/… on a PersistentVolume or its claim. */
export function phaseHealth(phase?: string): Health {
  switch (phase) {
    case "Bound":
    case "Available":
      return "Healthy";
    case "Pending":
      return "Progressing";
    case "Released":
      return "Suspended";
    case "Failed":
      return "Degraded";
    case undefined:
      return "Unknown";
    default:
      return "Unknown";
  }
}

/**
 * A replicated workload's health.
 *
 * `desired === 0` is Suspended rather than Healthy — a Deployment scaled to zero
 * is neither working nor broken, and calling it healthy hides a scale-down that
 * was not meant to happen. Argo treats a suspended resource the same way.
 */
export function replicaHealth(ready: number, desired: number): Health {
  if (desired === 0) return "Suspended";
  if (ready === 0) return "Degraded";
  return ready >= desired ? "Healthy" : "Progressing";
}

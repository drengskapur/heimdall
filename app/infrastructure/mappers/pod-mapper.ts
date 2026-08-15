// Maps a Kubernetes Pod object (wire format, any vendored version) into the Pod
// domain entity. This is the anti-corruption boundary: the fully-optional,
// version-specific DTO shape is normalised into the domain's intention-revealing
// model here, and nowhere else.
import { ResourceRef } from "../../domain/values/resource-ref";
import type { ContainerState, ContainerStateKind, Pod, PodContainerStatus } from "../../domain/workload/pod";
// The seam is typed against the generated Kubernetes Pod schema (deep-partial,
// since the API server may omit fields); the mapper stays defensive.
import type { WirePod } from "../../lib/kube-generated";

type WireContainerStatus = NonNullable<NonNullable<WirePod["status"]>["containerStatuses"]>[number];

function toState(status: WireContainerStatus): ContainerState {
  const state = status.state || {};
  let kind: ContainerStateKind = "unknown";
  if (state.running) kind = "running";
  else if (state.waiting) kind = "waiting";
  else if (state.terminated) kind = "terminated";
  else if (status.ready) kind = "running";
  return { kind, reason: state.waiting?.reason ?? state.terminated?.reason, exitCode: state.terminated?.exitCode };
}

function toContainerStatus(status: WireContainerStatus): PodContainerStatus {
  return {
    name: status.name || "",
    ready: Boolean(status.ready),
    restartCount: status.restartCount ?? 0,
    state: toState(status),
  };
}

export function toPodDomain(wire: WirePod): Pod {
  const meta = wire.metadata || {};
  const spec = wire.spec || {};
  const status = wire.status || {};
  return {
    ref: ResourceRef.of({
      apiVersion: "v1",
      kind: "Pod",
      name: meta.name || "",
      namespace: meta.namespace,
      uid: meta.uid,
    }),
    phase: status.phase,
    reason: status.reason,
    deletionTimestamp: meta.deletionTimestamp,
    finalizers: meta.finalizers,
    createdAt: meta.creationTimestamp,
    containers: [
      ...(spec.initContainers || []).map(c => ({ name: c.name || "", init: true, restartPolicy: c.restartPolicy })),
      ...(spec.containers || []).map(c => ({ name: c.name || "", init: false, restartPolicy: c.restartPolicy })),
    ],
    containerStatuses: [
      ...(status.containerStatuses || []),
      ...(status.initContainerStatuses || []),
      ...(status.ephemeralContainerStatuses || []),
    ].map(toContainerStatus),
    conditions: (status.conditions || []).map(c => ({ type: c.type || "", status: c.status || "" })),
    readinessGates: spec.readinessGates?.map(g => g.conditionType || "").filter(Boolean) ?? [],
    nodeName: spec.nodeName,
    podIP: status.podIP,
    qosClass: status.qosClass,
    owners: (meta.ownerReferences || []).map(o => ({ kind: o.kind || "", name: o.name || "" })),
  };
}

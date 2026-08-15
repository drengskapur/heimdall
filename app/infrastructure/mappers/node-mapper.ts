// Maps a Kubernetes Node object into the Node domain entity. Roles are derived
// from the node-role.kubernetes.io/<role> labels, matching kubectl.

import type { Node } from "../../domain/node/node";
import { ResourceRef } from "../../domain/values/resource-ref";
import type { WireNode } from "../../lib/kube-generated"; // generated k8s Node schema at the seam

const ROLE_LABEL = "node-role.kubernetes.io/";

export function toNodeDomain(wire: WireNode): Node {
  const meta = wire.metadata || {};
  const labels = meta.labels || {};
  const roles = Object.keys(labels)
    .filter(key => key.startsWith(ROLE_LABEL))
    .map(key => key.slice(ROLE_LABEL.length))
    .filter(Boolean);
  return {
    ref: ResourceRef.of({ apiVersion: "v1", kind: "Node", name: meta.name || "", uid: meta.uid }),
    roles,
    schedulable: !wire.spec?.unschedulable,
    kubeletVersion: wire.status?.nodeInfo?.kubeletVersion,
    conditions: (wire.status?.conditions || []).map(c => ({ type: c.type || "", status: c.status || "" })),
    addresses: (wire.status?.addresses || []).map(a => ({ type: a.type || "", address: a.address || "" })),
    createdAt: meta.creationTimestamp,
  };
}

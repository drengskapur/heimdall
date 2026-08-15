// Node domain entity and status service. Derives readiness, roles and
// schedulability the way kubectl/Lens present them.

import { ConditionStatus } from "../shared";
import type { ResourceRef } from "../values/resource-ref";

export interface NodeCondition {
  type: string;
  status: string;
}

export interface NodeAddress {
  type: string;
  address: string;
}

export interface Node {
  ref: ResourceRef;
  roles: string[];
  schedulable: boolean;
  kubeletVersion?: string;
  conditions: NodeCondition[];
  addresses: NodeAddress[];
  createdAt?: string;
}

export const NodeStatus = {
  isReady(node: Node): boolean {
    return node.conditions.some(c => c.type === "Ready" && c.status === ConditionStatus.True);
  },

  /** "Ready", "NotReady", or "SchedulingDisabled" — the list-view status text. */
  statusText(node: Node): string {
    if (!node.schedulable) return "SchedulingDisabled";
    return NodeStatus.isReady(node) ? "Ready" : "NotReady";
  },

  roleLabel(node: Node): string {
    return node.roles.length ? node.roles.join(", ") : "<none>";
  },

  address(node: Node, type: string): string {
    return node.addresses.find(a => a.type === type)?.address ?? "";
  },

  internalIP(node: Node): string {
    return NodeStatus.address(node, "InternalIP");
  },
  externalIP(node: Node): string {
    return NodeStatus.address(node, "ExternalIP");
  },

  /** The space-joined condition types, as the list view's condition column shows. */
  conditionText(node: Node): string {
    return node.conditions.map(c => c.type).join(" ");
  },
};

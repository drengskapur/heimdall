// Application use-cases for nodes: combine the gateway with NodeStatus.

import { type Node, NodeStatus } from "../../domain/node/node";
import type { KubernetesGateway } from "../ports/kubernetes-gateway";

export interface NodeListItem {
  node: Node;
  status: string;
  roles: string;
  ready: boolean;
}

export class NodeUseCases {
  constructor(private readonly gateway: KubernetesGateway) {}

  async list(): Promise<NodeListItem[]> {
    const nodes = await this.gateway.listNodes();
    return nodes.map(node => ({
      node,
      status: NodeStatus.statusText(node),
      roles: NodeStatus.roleLabel(node),
      ready: NodeStatus.isReady(node),
    }));
  }
}

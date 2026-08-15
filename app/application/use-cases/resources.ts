// Generic resource use-cases for the many CRUD-only kinds that carry no derived
// behaviour worth a bespoke aggregate (ConfigMaps, Secrets, ServiceAccounts,
// RBAC, events, network policies, storage classes, CRDs, …). They flow through
// the gateway's generic KubeObject operations. Kinds with real domain logic
// (Pod, Workload, Node, Service, PersistentVolume…) get dedicated use-cases.

import { ResourceRef } from "../../domain/values/resource-ref";
import type { DeleteOptions, KubeObject, KubernetesGateway, ResourceQuery } from "../ports/kubernetes-gateway";

export class ResourceUseCases {
  constructor(private readonly gateway: KubernetesGateway) {}

  list(query: ResourceQuery): Promise<KubeObject[]> {
    return this.gateway.list(query);
  }

  get(ref: ResourceRef, resource: string): Promise<KubeObject | null> {
    return this.gateway.get(ref, resource);
  }

  /** Create or update from a manifest (used by the YAML editor). */
  apply(manifest: Record<string, unknown>): Promise<KubeObject> {
    return this.gateway.apply(manifest);
  }

  remove(ref: ResourceRef, resource: string, options?: DeleteOptions): Promise<void> {
    return this.gateway.remove(ref, resource, options);
  }
}

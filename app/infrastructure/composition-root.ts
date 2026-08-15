// Composition root: the single place that wires driven adapters into the
// application's ports and use-cases. The UI resolves collaborators from here
// instead of constructing infrastructure directly, keeping the hexagon's
// dependencies pointing inward.

import type { HelmGateway } from "../application/ports/helm-gateway";
import type { KubernetesGateway } from "../application/ports/kubernetes-gateway";
import { ServiceUseCases } from "../application/use-cases/network";
import { NodeUseCases } from "../application/use-cases/nodes";
import { PodUseCases } from "../application/use-cases/pods";
import { ResourceUseCases } from "../application/use-cases/resources";
import { StorageUseCases } from "../application/use-cases/storage";
import { WorkloadUseCases } from "../application/use-cases/workloads";
import type { ClusterProfile } from "../lib/kube-generated";
import { CompanionHelmGateway } from "./helm/helm-gateway";
import { KubeGateway } from "./kubernetes/gateway";
import { BrowserClusterProfileRepository } from "./storage/profile-repository";

export const clusterProfiles = new BrowserClusterProfileRepository();

/** Build a gateway bound to a specific cluster connection. */
export function gatewayFor(profile: ClusterProfile): KubernetesGateway {
  return new KubeGateway(profile);
}

/** Build a Helm gateway for a cluster connection (the Helm bounded context). */
export function helmFor(profile: ClusterProfile): HelmGateway {
  return new CompanionHelmGateway(profile);
}

/** Use-cases for the currently active cluster, or null when disconnected. */
export interface ActiveCluster {
  gateway: KubernetesGateway;
  pods: PodUseCases;
  workloads: WorkloadUseCases;
  nodes: NodeUseCases;
  services: ServiceUseCases;
  storage: StorageUseCases;
  /** Generic CRUD for kinds without a bespoke aggregate. */
  resources: ResourceUseCases;
  /** Helm releases (the Helm bounded context). */
  helm: HelmGateway;
  profile: ClusterProfile;
}

export function activeCluster(): ActiveCluster | null {
  const profile = clusterProfiles.active();
  if (!profile) return null;
  const gateway = gatewayFor(profile);
  return {
    gateway,
    pods: new PodUseCases(gateway),
    workloads: new WorkloadUseCases(gateway),
    nodes: new NodeUseCases(gateway),
    services: new ServiceUseCases(gateway),
    storage: new StorageUseCases(gateway),
    resources: new ResourceUseCases(gateway),
    helm: helmFor(profile),
    profile,
  };
}

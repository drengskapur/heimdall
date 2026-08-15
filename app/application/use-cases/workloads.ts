// Application use-cases for workload controllers. Combine the KubernetesGateway
// port with the WorkloadStatus domain service.

import { type Workload, type WorkloadKind, WorkloadStatus } from "../../domain/workload/workload";
import type { KubernetesGateway } from "../ports/kubernetes-gateway";

export interface WorkloadListItem {
  workload: Workload;
  ready: string;
  isReady: boolean;
  hasIssues: boolean;
}

export class WorkloadUseCases {
  constructor(private readonly gateway: KubernetesGateway) {}

  async list(kind: WorkloadKind, namespace?: string): Promise<WorkloadListItem[]> {
    const workloads = await this.gateway.listWorkloads(kind, namespace);
    return workloads.map(workload => ({
      workload,
      ready: WorkloadStatus.readySummary(workload),
      isReady: WorkloadStatus.isReady(workload),
      hasIssues: WorkloadStatus.hasIssues(workload),
    }));
  }
}

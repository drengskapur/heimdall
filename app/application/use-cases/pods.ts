// Application use-cases for pods. They orchestrate the KubernetesGateway port and
// the PodHealth domain service; they hold no transport or wire-format knowledge.

import type { ResourceRef } from "../../domain/values/resource-ref";
import { type Pod, PodHealth } from "../../domain/workload/pod";
import type { ExecSession, KubernetesGateway, LogOptions, StreamCallbacks } from "../ports/kubernetes-gateway";

export interface PodListItem {
  pod: Pod;
  status: string;
  hasIssues: boolean;
}

export class PodUseCases {
  constructor(private readonly gateway: KubernetesGateway) {}

  /** List pods with their derived health/status decided by the domain. */
  async list(namespace?: string): Promise<PodListItem[]> {
    const pods = await this.gateway.listPods(namespace);
    return pods.map(pod => ({ pod, status: PodHealth.statusMessage(pod), hasIssues: PodHealth.hasIssues(pod) }));
  }

  readLogs(ref: ResourceRef, options: LogOptions = {}): Promise<string> {
    return this.gateway.readLogs(ref, options);
  }

  streamLogs(ref: ResourceRef, options: LogOptions, onChunk: (text: string) => void) {
    return this.gateway.streamLogs(ref, options, onChunk);
  }

  shell(ref: ResourceRef, callbacks: StreamCallbacks, command = ["/bin/sh"]): ExecSession {
    return this.gateway.exec(ref, command, callbacks);
  }
}

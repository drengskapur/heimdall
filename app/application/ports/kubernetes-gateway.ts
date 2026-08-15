// Primary driven port: everything the application needs from a Kubernetes
// cluster, expressed independently of transport (worker vs companion) and of the
// wire format. Adapters in app/infrastructure implement this; use-cases depend
// only on this interface.

import type { CustomResourceType } from "../../domain/custom-resource/custom-resource-type";
import type { Service } from "../../domain/network/service";
import type { Node } from "../../domain/node/node";
import type { PersistentVolume, PersistentVolumeClaim } from "../../domain/storage/volume";
import type { ResourceRef } from "../../domain/values/resource-ref";
import type { Pod } from "../../domain/workload/pod";
import type { Workload, WorkloadKind } from "../../domain/workload/workload";

/** A generic cluster object for the many kinds not yet promoted to rich domain
 *  entities. Adapters still map metadata/identity; the raw body is preserved. */
export interface KubeObject {
  ref: ResourceRef;
  raw: Record<string, unknown>;
}

export interface ResourceQuery {
  apiVersion: string;
  kind: string;
  /** Plural resource name, e.g. "pods". */
  resource: string;
  namespace?: string;
}

/** Delete tuning: force-delete uses gracePeriodSeconds 0 (Freelens "Force Delete"). */
export interface DeleteOptions {
  gracePeriodSeconds?: number;
  propagationPolicy?: "Foreground" | "Background" | "Orphan";
}

export interface LogOptions {
  container?: string;
  follow?: boolean;
  timestamps?: boolean;
  previous?: boolean;
  tailLines?: number;
  sinceSeconds?: number;
}

export type Unsubscribe = () => void;

export interface WatchEvent<T> {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: T;
}

export interface StreamCallbacks {
  onReady?: () => void;
  onStdout: (text: string) => void;
  onStderr?: (text: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

export interface ExecSession {
  send(text: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface PortForwardCallbacks {
  onReady?: (details: { localPort?: number }) => void;
  onData: (data: Uint8Array) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

export interface PortForwardSession {
  send(data: string | Uint8Array): void;
  close(): void;
}

/** A rule from a SelfSubjectRulesReview: which verbs the user has on which
 *  group/resource (used to gate the sidebar on RBAC). */
export interface ResourceRule {
  readonly verbs: string[];
  readonly apiGroups?: string[];
  readonly resources?: string[];
}

/** A resource kind the cluster actually serves (from API discovery). */
export interface ServedResource {
  readonly apiVersion: string; // "v1" | "apps/v1" | "networking.k8s.io/v1" …
  readonly resource: string; // plural, e.g. "deployments"
  readonly kind: string;
  readonly namespaced: boolean;
}

/** The Kubernetes gateway port. Reads/writes generic objects; specialised reads
 *  (pods) return rich domain entities. */
export interface KubernetesGateway {
  serverVersion(): Promise<string>;
  /** Discover the resource kinds this cluster serves (for sidebar gating). */
  discoverResources(): Promise<ServedResource[]>;
  /** SelfSubjectRulesReview for a namespace → the user's list permissions; null
   *  when the review is incomplete (treat as permissive). */
  canListResources(namespace: string): Promise<ResourceRule[] | null>;
  /** GET through the apiserver service proxy (e.g. to query an in-cluster
   *  Prometheus): /api/v1/namespaces/{ns}/services/{name}:{port}/proxy{path}. */
  serviceProxyGet<T>(namespace: string, name: string, port: number, path: string): Promise<T>;
  listPods(namespace?: string): Promise<Pod[]>;
  listWorkloads(kind: WorkloadKind, namespace?: string): Promise<Workload[]>;
  listNodes(): Promise<Node[]>;
  listServices(namespace?: string): Promise<Service[]>;
  listPersistentVolumeClaims(namespace?: string): Promise<PersistentVolumeClaim[]>;
  listPersistentVolumes(): Promise<PersistentVolume[]>;
  list(query: ResourceQuery): Promise<KubeObject[]>;
  /** List a "basic" kind (Event, Ingress, NetworkPolicy, …) whose group/version
   *  the adapter resolves from the kind. */
  listBasic(kind: string, namespace?: string): Promise<KubeObject[]>;
  // Dynamically-defined resources, addressed by their CustomResourceType.
  listCustom(type: CustomResourceType, namespace?: string): Promise<KubeObject[]>;
  applyCustom(type: CustomResourceType, object: Record<string, unknown>): Promise<KubeObject>;
  removeCustom(type: CustomResourceType, object: Record<string, unknown>): Promise<void>;
  // Workload and node actions. Mutations return the updated object.
  getWorkloadScale(ref: ResourceRef): Promise<number>;
  scaleWorkload(ref: ResourceRef, replicas: number): Promise<KubeObject>;
  restartWorkload(ref: ResourceRef): Promise<KubeObject>;
  setWorkloadSuspended(ref: ResourceRef, suspended: boolean): Promise<KubeObject>;
  setNodeSchedulable(ref: ResourceRef, schedulable: boolean): Promise<KubeObject>;
  /** Manually run a CronJob now (create a Job from its jobTemplate). */
  triggerCronJob(ref: ResourceRef): Promise<KubeObject>;
  /** Request a bound token for a ServiceAccount (TokenRequest subresource). */
  requestServiceAccountToken(
    ref: ResourceRef,
    expirationSeconds?: number,
  ): Promise<{ token: string; expirationTimestamp?: string }>;
  get(ref: ResourceRef, resource: string): Promise<KubeObject | null>;
  apply(object: Record<string, unknown>): Promise<KubeObject>;
  remove(ref: ResourceRef, resource: string, options?: DeleteOptions): Promise<void>;
  watch(query: ResourceQuery, onEvent: (event: WatchEvent<KubeObject>) => void): Unsubscribe;
  readLogs(ref: ResourceRef, options: LogOptions): Promise<string>;
  streamLogs(ref: ResourceRef, options: LogOptions, onChunk: (text: string) => void): Unsubscribe;
  exec(ref: ResourceRef, command: string[], callbacks: StreamCallbacks, container?: string): ExecSession;
  portForward(ref: ResourceRef, port: number, callbacks: PortForwardCallbacks): PortForwardSession;
}

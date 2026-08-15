// Driven adapter: implements the KubernetesGateway port on top of the existing
// transport in app/lib/kubernetes (which already routes bearer-token clusters
// through the /api/kube worker and client-certificate clusters through the
// companion). DTOs are mapped into domain shapes at this boundary.
import type {
  DeleteOptions,
  ExecSession,
  KubeObject,
  KubernetesGateway,
  LogOptions,
  PortForwardCallbacks,
  PortForwardSession,
  ResourceQuery,
  ResourceRule,
  ServedResource,
  StreamCallbacks,
  Unsubscribe,
  WatchEvent,
} from "../../application/ports/kubernetes-gateway";
import type { CustomResourceType } from "../../domain/custom-resource/custom-resource-type";
import type { Service } from "../../domain/network/service";
import type { Node } from "../../domain/node/node";
import type { PersistentVolume, PersistentVolumeClaim } from "../../domain/storage/volume";
import { ResourceRef } from "../../domain/values/resource-ref";
import type { Pod } from "../../domain/workload/pod";
import type { Workload, WorkloadKind } from "../../domain/workload/workload";
import type { ClusterProfile } from "../../lib/kube-generated";
import {
  applyKubeResource,
  createBatchJob,
  deleteKubeResource,
  discoverClusterCapabilities,
  listNodes as fetchNodes,
  listPods as fetchPods,
  listPersistentVolumeClaims as fetchPvcs,
  listPersistentVolumes as fetchPvs,
  listServices as fetchServices,
  followPodLogs,
  getWorkloadScale as getWorkloadScaleTransport,
  kubeRequest,
  listBasicResources,
  listDeployments,
  listWorkloadControllers,
  openPodExec,
  openPodPortForward,
  podLogs,
  requestServiceAccountToken as requestTokenTransport,
  restartWorkload as restartWorkloadTransport,
  scaleWorkload as scaleWorkloadTransport,
  selfSubjectRules,
  serviceProxyGet,
  setBatchWorkloadSuspended,
  setNodeSchedulable as setNodeSchedulableTransport,
  watchResource,
} from "../../lib/kubernetes";
import { toNodeDomain } from "../mappers/node-mapper";
import { toPodDomain } from "../mappers/pod-mapper";
import { toServiceDomain } from "../mappers/service-mapper";
import { toPvcDomain, toPvDomain } from "../mappers/volume-mapper";
import { toWorkloadDomain } from "../mappers/workload-mapper";

interface WireObject {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string; uid?: string; resourceVersion?: string };
}
interface WireList {
  items?: WireObject[];
}

const collectionPath = (q: Pick<ResourceQuery, "apiVersion" | "resource" | "namespace">) => {
  const base = q.apiVersion === "v1" ? "/api/v1" : `/apis/${q.apiVersion}`;
  const ns = q.namespace ? `namespaces/${encodeURIComponent(q.namespace)}/` : "";
  return `${base}/${ns}${q.resource}`;
};

const singularKind = (kind: string) => kind.replace(/List$/, "");

function toKubeObject(wire: WireObject, fallbackKind: string, fallbackApiVersion: string): KubeObject {
  const meta = wire.metadata || {};
  return {
    ref: ResourceRef.of({
      apiVersion: wire.apiVersion || fallbackApiVersion,
      kind: singularKind(wire.kind || fallbackKind),
      name: meta.name || "",
      namespace: meta.namespace,
      uid: meta.uid,
    }),
    raw: wire as Record<string, unknown>,
  };
}

/** A minimal Pod-shaped object for the transport helpers that key off namespace/name. */
const asWirePod = (ref: ResourceRef) =>
  ({ metadata: { namespace: ref.namespace, name: ref.name } }) as unknown as import("../../lib/kubernetes").Pod;

/** A minimal object carrying the identity the workload/node action helpers need
 *  (apiVersion/kind/metadata drive the resource path). */
const refToWorkload = (ref: ResourceRef) =>
  ({
    apiVersion: ref.apiVersion,
    kind: ref.kind,
    metadata: { name: ref.name, namespace: ref.namespace },
  }) as unknown as import("../../lib/kubernetes").KubeMutableObject;

export class KubeGateway implements KubernetesGateway {
  constructor(private readonly profile: ClusterProfile) {}

  async serverVersion(): Promise<string> {
    const version = await kubeRequest<{ gitVersion?: string; major?: string; minor?: string }>(
      this.profile,
      "/version",
    );
    return version.gitVersion || `${version.major}.${version.minor}`;
  }

  async discoverResources(): Promise<ServedResource[]> {
    const caps = await discoverClusterCapabilities(this.profile);
    const served: ServedResource[] = [];
    for (const list of caps.resourceLists) {
      for (const r of list.resources) {
        if (r.name.includes("/")) continue; // skip subresources (pods/log, …)
        served.push({ apiVersion: list.groupVersion, resource: r.name, kind: r.kind, namespaced: r.namespaced });
      }
    }
    return served;
  }

  canListResources(namespace: string): Promise<ResourceRule[] | null> {
    return selfSubjectRules(this.profile, namespace);
  }

  serviceProxyGet<T>(namespace: string, name: string, port: number, path: string): Promise<T> {
    return serviceProxyGet<T>(this.profile, namespace, name, port, path);
  }

  async listPods(namespace?: string): Promise<Pod[]> {
    const list = await fetchPods(this.profile, namespace || "");
    return (list.items || []).map(item => toPodDomain(item as never));
  }

  async listWorkloads(kind: WorkloadKind, namespace?: string): Promise<Workload[]> {
    if (kind === "Deployment") {
      const list = await listDeployments(this.profile, namespace || "");
      return (list.items || []).map(item => toWorkloadDomain({ ...(item as object), kind: "Deployment" }));
    }
    const list = await listWorkloadControllers(this.profile, kind, namespace || "");
    return (list.items || []).map(item => toWorkloadDomain({ ...(item as object), kind }));
  }

  async listNodes(): Promise<Node[]> {
    const list = await fetchNodes(this.profile);
    return (list.items || []).map(item => toNodeDomain(item as never));
  }

  async listServices(namespace?: string): Promise<Service[]> {
    const list = await fetchServices(this.profile, namespace || "");
    return (list.items || []).map(item => toServiceDomain(item as never));
  }

  async listPersistentVolumeClaims(namespace?: string): Promise<PersistentVolumeClaim[]> {
    const list = await fetchPvcs(this.profile, namespace || "");
    return (list.items || []).map(item => toPvcDomain(item as never));
  }

  async listPersistentVolumes(): Promise<PersistentVolume[]> {
    const list = await fetchPvs(this.profile);
    return (list.items || []).map(item => toPvDomain(item as never));
  }

  async list(query: ResourceQuery): Promise<KubeObject[]> {
    const list = await kubeRequest<WireList>(this.profile, collectionPath(query));
    return (list.items || []).map(item => toKubeObject(item, query.kind, query.apiVersion));
  }

  async listBasic(kind: string, namespace?: string): Promise<KubeObject[]> {
    const list = await listBasicResources(this.profile, kind as never, namespace || "");
    return (list.items || []).map(item =>
      toKubeObject(item as WireObject, kind, (item as WireObject).apiVersion || "v1"),
    );
  }

  async listCustom(type: CustomResourceType, namespace?: string): Promise<KubeObject[]> {
    const list = await kubeRequest<WireList>(this.profile, type.collectionPath(namespace));
    return (list.items || []).map(item => toKubeObject(item, type.kind, type.apiVersion));
  }

  async applyCustom(type: CustomResourceType, object: Record<string, unknown>): Promise<KubeObject> {
    const meta = (object.metadata as { name?: string; namespace?: string } | undefined) || {};
    if (!meta.name) throw new Error("Custom resource requires metadata.name");
    // Server-side apply, matching the app's field-manager conventions.
    const path = `${type.collectionPath(meta.namespace)}/${encodeURIComponent(meta.name)}?fieldManager=heimdall&force=true&fieldValidation=Strict`;
    const applied = await kubeRequest<WireObject>(this.profile, path, {
      method: "PATCH",
      headers: { "content-type": "application/apply-patch+yaml" },
      body: JSON.stringify({ body: object }),
    });
    return toKubeObject(applied, type.kind, type.apiVersion);
  }

  async removeCustom(type: CustomResourceType, object: Record<string, unknown>): Promise<void> {
    const meta = (object.metadata as { name?: string; namespace?: string } | undefined) || {};
    const path = `${type.collectionPath(meta.namespace)}/${encodeURIComponent(meta.name || "")}`;
    await kubeRequest(this.profile, path, {
      method: "DELETE",
      body: JSON.stringify({ body: { apiVersion: "v1", kind: "DeleteOptions", propagationPolicy: "Foreground" } }),
    });
  }

  async getWorkloadScale(ref: ResourceRef): Promise<number> {
    const scale = await getWorkloadScaleTransport(this.profile, refToWorkload(ref));
    return scale.spec?.replicas ?? 0;
  }

  async scaleWorkload(ref: ResourceRef, replicas: number): Promise<KubeObject> {
    const updated = await scaleWorkloadTransport(this.profile, refToWorkload(ref), replicas);
    return toKubeObject(updated, ref.kind, ref.apiVersion);
  }

  async restartWorkload(ref: ResourceRef): Promise<KubeObject> {
    const updated = await restartWorkloadTransport(this.profile, refToWorkload(ref));
    return toKubeObject(updated, ref.kind, ref.apiVersion);
  }

  async setWorkloadSuspended(ref: ResourceRef, suspended: boolean): Promise<KubeObject> {
    const updated = await setBatchWorkloadSuspended(
      this.profile,
      ref.kind as "Job" | "CronJob",
      ref.namespace || "",
      ref.name,
      suspended,
    );
    return toKubeObject(updated, ref.kind, ref.apiVersion);
  }

  async setNodeSchedulable(ref: ResourceRef, schedulable: boolean): Promise<KubeObject> {
    const updated = await setNodeSchedulableTransport(this.profile, refToWorkload(ref) as never, schedulable);
    return toKubeObject(updated, ref.kind, ref.apiVersion);
  }

  async triggerCronJob(ref: ResourceRef): Promise<KubeObject> {
    // List items often omit apiVersion (the ref then defaults to apps/v1), so
    // fetch the CronJob at its real group explicitly.
    const cronRef = ResourceRef.of({
      apiVersion: "batch/v1",
      kind: "CronJob",
      name: ref.name,
      namespace: ref.namespace,
    });
    const cronjob = await this.get(cronRef, "cronjobs");
    const jobSpec = (cronjob?.raw as { spec?: { jobTemplate?: { spec?: unknown } } } | undefined)?.spec?.jobTemplate
      ?.spec;
    if (!jobSpec) throw new Error(`CronJob ${ref.name} has no jobTemplate`);
    const namespace = ref.namespace || "default";
    const name = `${ref.name}-manual-${Date.now().toString(36)}`.slice(0, 63);
    const job = {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name, namespace, annotations: { "cronjob.kubernetes.io/instantiate": "manual" } },
      spec: jobSpec,
    } as unknown as import("../../lib/kubernetes").KubeMutableObject;
    const created = await createBatchJob(this.profile, namespace, name, job);
    return toKubeObject(created, "Job", "batch/v1");
  }

  async requestServiceAccountToken(
    ref: ResourceRef,
    expirationSeconds = 3600,
  ): Promise<{ token: string; expirationTimestamp?: string }> {
    const result = await requestTokenTransport(this.profile, ref.namespace || "default", ref.name, expirationSeconds);
    return { token: result.status?.token || "", expirationTimestamp: result.status?.expirationTimestamp };
  }

  async get(ref: ResourceRef, resource: string): Promise<KubeObject | null> {
    const path = `${collectionPath({ apiVersion: ref.apiVersion, resource, namespace: ref.namespace })}/${encodeURIComponent(ref.name)}`;
    const wire = await kubeRequest<WireObject>(this.profile, path).catch(() => null);
    return wire ? toKubeObject(wire, ref.kind, ref.apiVersion) : null;
  }

  async apply(object: Record<string, unknown>): Promise<KubeObject> {
    const applied = (await applyKubeResource(this.profile, object as never)) as WireObject;
    return toKubeObject(applied, "", "v1");
  }

  async remove(ref: ResourceRef, _resource?: string, options?: DeleteOptions): Promise<void> {
    await deleteKubeResource(
      this.profile,
      {
        apiVersion: ref.apiVersion,
        kind: ref.kind,
        metadata: { name: ref.name, namespace: ref.namespace },
      },
      options,
    );
  }

  watch(query: ResourceQuery, onEvent: (event: WatchEvent<KubeObject>) => void): Unsubscribe {
    // Real streaming watch (resourceVersion tracking + reconnect) mapped to domain
    // KubeObject events at the boundary.
    return watchResource<WireObject>(this.profile, collectionPath(query), event => {
      if (event.type !== "ADDED" && event.type !== "MODIFIED" && event.type !== "DELETED") return;
      onEvent({ type: event.type, object: toKubeObject(event.object, query.kind, query.apiVersion) });
    });
  }

  readLogs(ref: ResourceRef, options: LogOptions): Promise<string> {
    return podLogs(this.profile, asWirePod(ref), options.container, options);
  }

  streamLogs(ref: ResourceRef, options: LogOptions, onChunk: (text: string) => void): Unsubscribe {
    return followPodLogs(this.profile, asWirePod(ref), options.container || "", onChunk, options);
  }

  exec(ref: ResourceRef, command: string[], callbacks: StreamCallbacks, container = ""): ExecSession {
    // Empty container lets the API server pick the pod's default container.
    return openPodExec(this.profile, asWirePod(ref), container, callbacks, command);
  }

  portForward(ref: ResourceRef, port: number, callbacks: PortForwardCallbacks): PortForwardSession {
    // The companion path reports the assigned local port; the bearer path streams
    // through the browser and has none. Propagate it when present.
    return openPodPortForward(this.profile, asWirePod(ref), port, {
      onReady: details => callbacks.onReady?.({ localPort: details?.localPort }),
      onData: callbacks.onData,
      onError: callbacks.onError,
      onClose: callbacks.onClose,
    });
  }
}

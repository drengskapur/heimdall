// Ergonomic aliases over the OpenAPI-generated types in app/lib/generated/.
//
// The generated files (from openapi/app.openapi.json and the vendored Kubernetes
// spec) are the source of truth; this module gives their schemas the names and
// required-field ergonomics the app consumes. Regenerate with `npm run codegen`.
import type { components as AppComponents } from "./generated/app-api";
// Kubernetes types default to the latest vendored version; version-aware adapters
// select a specific minor from ./generated/kubernetes (the registry).
import type { components as K8sLatest } from "./generated/kubernetes/latest";

type AppSchemas = AppComponents["schemas"];
export type K8sSchemas = K8sLatest["schemas"];

/** A wire-format view of a generated schema: recursively partial, because the API
 *  server may legitimately omit any field. DTO→domain mappers accept these at the
 *  boundary, so the generated OpenAPI schemas are the stable contract at the seam
 *  while the mappers stay defensive. */
export type Wire<T> = T extends (infer U)[] ? Wire<U>[] : T extends object ? { [K in keyof T]?: Wire<T[K]> } : T;

// --- Kubernetes wire DTOs at the mapper seam (from the vendored k8s OpenAPI) ---
export type WirePod = Wire<K8sSchemas["io.k8s.api.core.v1.Pod"]>;
export type WireNode = Wire<K8sSchemas["io.k8s.api.core.v1.Node"]>;
export type WireService = Wire<K8sSchemas["io.k8s.api.core.v1.Service"]>;
export type WirePersistentVolumeClaim = Wire<K8sSchemas["io.k8s.api.core.v1.PersistentVolumeClaim"]>;
export type WirePersistentVolume = Wire<K8sSchemas["io.k8s.api.core.v1.PersistentVolume"]>;
export type WireCustomResourceDefinition = Wire<
  K8sSchemas["io.k8s.apiextensions-apiserver.pkg.apis.apiextensions.v1.CustomResourceDefinition"]
>;

// Workload controllers — one generated wire DTO per kind; the workload mapper
// normalises any of them into the Workload domain entity.
export type WireDeployment = Wire<K8sSchemas["io.k8s.api.apps.v1.Deployment"]>;
export type WireDaemonSet = Wire<K8sSchemas["io.k8s.api.apps.v1.DaemonSet"]>;
export type WireStatefulSet = Wire<K8sSchemas["io.k8s.api.apps.v1.StatefulSet"]>;
export type WireReplicaSet = Wire<K8sSchemas["io.k8s.api.apps.v1.ReplicaSet"]>;
export type WireReplicationController = Wire<K8sSchemas["io.k8s.api.core.v1.ReplicationController"]>;
export type WireJob = Wire<K8sSchemas["io.k8s.api.batch.v1.Job"]>;
export type WireCronJob = Wire<K8sSchemas["io.k8s.api.batch.v1.CronJob"]>;
export type WireWorkload =
  | WireDeployment
  | WireDaemonSet
  | WireStatefulSet
  | WireReplicaSet
  | WireReplicationController
  | WireJob
  | WireCronJob;

// --- app-owned interfaces (generated from openapi/app.openapi.json) ---------
export type ClusterProfile = AppSchemas["ClusterProfile"];
export type PodLogsQuery = AppSchemas["PodLogsQuery"];
export type KubeProxyRequest = AppSchemas["KubeProxyRequest"];
export type KubeStreamConfig = AppSchemas["KubeStreamConfig"];

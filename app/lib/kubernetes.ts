// App-owned data-model interfaces are generated from openapi/app.openapi.json.
import type { ClusterProfile, KubeProxyRequest, KubeStreamConfig, PodLogsQuery } from "./kube-generated";
import { companionPreferences } from "./proxy";

export type { ClusterProfile, PodLogsQuery };

export interface ObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  generation?: number;
  managedFields?: unknown[];
  selfLink?: string;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  finalizers?: string[];
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: Array<{
    apiVersion?: string;
    kind: string;
    name: string;
    uid: string;
    controller?: boolean;
    blockOwnerDeletion?: boolean;
  }>;
}
export interface ContainerStateTerminated {
  exitCode: number;
  reason?: string;
  message?: string;
  signal?: number;
  startedAt?: string;
  finishedAt?: string;
  containerID?: string;
}
export interface ContainerState {
  waiting?: { reason?: string; message?: string };
  running?: { startedAt?: string };
  terminated?: ContainerStateTerminated;
}
export interface ContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state?: ContainerState;
  lastState?: ContainerState;
  image?: string;
  imageID?: string;
  containerID?: string;
  started?: boolean;
}
export interface PodContainerPort {
  name?: string;
  containerPort: number;
  protocol?: string;
  hostIP?: string;
  hostPort?: number;
}
export interface PodContainer {
  name: string;
  image: string;
  imagePullPolicy?: string;
  restartPolicy?: string;
  ports?: PodContainerPort[];
  env?: Array<{
    name: string;
    value?: string;
    valueFrom?: Record<string, Record<string, string | number | boolean | undefined>>;
  }>;
  envFrom?: Array<{
    prefix?: string;
    configMapRef?: { name?: string; optional?: boolean };
    secretRef?: { name?: string; optional?: boolean };
  }>;
  volumeMounts?: Array<{ name: string; mountPath: string; subPath?: string; readOnly?: boolean }>;
  command?: string[];
  args?: string[];
  resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
  livenessProbe?: Record<string, unknown>;
  readinessProbe?: Record<string, unknown>;
  startupProbe?: Record<string, unknown>;
  resizePolicy?: Array<{ resourceName: string; restartPolicy: string }>;
  targetContainerName?: string;
}
export interface PodVolume {
  name: string;
  [kind: string]: unknown;
}
export interface PodToleration {
  key?: string;
  operator?: string;
  value?: string;
  effect?: string;
  tolerationSeconds?: number;
}
export interface Pod {
  [key: string]: unknown;
  apiVersion: "v1";
  kind: "Pod";
  metadata: ObjectMeta;
  spec: {
    nodeName?: string;
    schedulerName?: string;
    serviceAccountName?: string;
    priority?: number;
    priorityClassName?: string;
    runtimeClassName?: string;
    terminationGracePeriodSeconds?: number;
    nodeSelector?: Record<string, string>;
    affinity?: Record<string, unknown>;
    tolerations?: PodToleration[];
    readinessGates?: Array<{ conditionType: string }>;
    containers: PodContainer[];
    initContainers?: PodContainer[];
    ephemeralContainers?: PodContainer[];
    volumes?: PodVolume[];
    imagePullSecrets?: Array<{ name: string }>;
  };
  status?: {
    phase?: string;
    reason?: string;
    message?: string;
    podIP?: string;
    podIPs?: Array<{ ip: string }>;
    hostIP?: string;
    hostIPs?: Array<{ ip: string }>;
    qosClass?: string;
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
      lastTransitionTime?: string;
    }>;
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
    ephemeralContainerStatuses?: ContainerStatus[];
  };
}
export interface PodList {
  apiVersion: "v1";
  kind: "PodList";
  metadata: { resourceVersion?: string };
  items: Pod[];
}
export interface Deployment {
  [key: string]: unknown;
  apiVersion: "apps/v1";
  kind: "Deployment";
  metadata: ObjectMeta;
  spec: {
    replicas?: number;
    selector: { matchLabels?: Record<string, string> };
    template: {
      metadata?: { labels?: Record<string, string> };
      spec: { containers: Array<{ name: string; image: string }> };
    };
  };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    updatedReplicas?: number;
    unavailableReplicas?: number;
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
  };
}
export interface DeploymentList {
  apiVersion: "apps/v1";
  kind: "DeploymentList";
  metadata: { resourceVersion?: string };
  items: Deployment[];
}
export interface Node {
  apiVersion: "v1";
  kind: "Node";
  metadata: ObjectMeta & { labels?: Record<string, string> };
  spec: {
    unschedulable?: boolean;
    podCIDR?: string;
    podCIDRs?: string[];
    providerID?: string;
    taints?: Array<{ key: string; value?: string; effect?: string; timeAdded?: string }>;
  };
  status?: {
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
    nodeInfo?: {
      kubeletVersion?: string;
      kubeProxyVersion?: string;
      containerRuntimeVersion?: string;
      operatingSystem?: string;
      architecture?: string;
      osImage?: string;
      kernelVersion?: string;
      machineID?: string;
      systemUUID?: string;
      bootID?: string;
    };
    addresses?: Array<{ type: string; address: string }>;
    conditions?: Array<{
      type: string;
      status: string;
      reason?: string;
      message?: string;
      lastHeartbeatTime?: string;
      lastTransitionTime?: string;
    }>;
  };
}
export interface NodeList {
  apiVersion: "v1";
  kind: "NodeList";
  metadata: { resourceVersion?: string };
  items: Node[];
}
export interface ServicePort {
  name?: string;
  protocol?: "TCP" | "UDP" | "SCTP";
  appProtocol?: string;
  port: number;
  targetPort?: number | string;
  nodePort?: number;
}
export interface ServiceCondition {
  lastTransitionTime?: string;
  reason?: string;
  status?: string;
  type?: string;
  message?: string;
}
export interface Service {
  [key: string]: unknown;
  apiVersion: "v1";
  kind: "Service";
  metadata: ObjectMeta;
  spec: {
    type?: "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName";
    clusterIP?: string;
    clusterIPs?: string[];
    externalIPs?: string[];
    externalName?: string;
    selector?: Record<string, string>;
    ports?: ServicePort[];
    sessionAffinity?: "ClientIP" | "None";
    sessionAffinityConfig?: { clientIP?: { timeoutSeconds?: number } };
    internalTrafficPolicy?: "Cluster" | "Local";
    externalTrafficPolicy?: "Cluster" | "Local";
    trafficDistribution?: "PreferClose" | "PreferSameZone" | "PreferSameNode";
    topologyKeys?: string[];
    publishNotReadyAddresses?: boolean;
    ipFamilies?: Array<"IPv4" | "IPv6" | "">;
    ipFamilyPolicy?: string;
    allocateLoadBalancerNodePorts?: boolean;
    loadBalancerIP?: string;
    loadBalancerClass?: string;
    healthCheckNodePort?: number;
  };
  status?: {
    loadBalancer?: {
      ingress?: Array<{
        ip?: string;
        hostname?: string;
        ipMode?: "VIP" | "Proxy";
        ports?: Array<{ port?: number; protocol?: "TCP" | "UDP" | "SCTP"; error?: string }>;
      }>;
      conditions?: ServiceCondition[];
    };
  };
}
export interface ServiceList {
  apiVersion: "v1";
  kind: "ServiceList";
  metadata: { resourceVersion?: string };
  items: Service[];
}
export interface WorkloadController {
  [key: string]: unknown;
  apiVersion: string;
  kind: "DaemonSet" | "StatefulSet" | "ReplicaSet" | "ReplicationController" | "Job" | "CronJob";
  metadata: ObjectMeta;
  spec: {
    replicas?: number;
    parallelism?: number;
    completions?: number;
    suspend?: boolean;
    schedule?: string;
    selector?: { matchLabels?: Record<string, string> } | Record<string, string>;
    template?: { spec?: { containers?: Array<{ name: string; image: string }> } };
    jobTemplate?: { spec?: { template?: { spec?: { containers?: Array<{ name: string; image: string }> } } } };
  };
  status?: {
    desiredNumberScheduled?: number;
    numberReady?: number;
    currentNumberScheduled?: number;
    currentReplicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    replicas?: number;
    succeeded?: number;
    failed?: number;
    active?: number;
    lastScheduleTime?: string;
  };
}
export interface WorkloadControllerList {
  apiVersion: string;
  kind: string;
  metadata: { resourceVersion?: string };
  items: WorkloadController[];
}
export interface Secret {
  apiVersion: "v1";
  kind: "Secret";
  metadata: ObjectMeta;
  type?: string;
  data?: Record<string, string>;
  stringData?: Record<string, string>;
}
export interface PersistentVolumeClaim {
  apiVersion: "v1";
  kind: "PersistentVolumeClaim";
  metadata: ObjectMeta;
  spec: {
    accessModes?: string[];
    resources?: { requests?: Record<string, string> };
    storageClassName?: string;
    volumeName?: string;
    volumeMode?: string;
  };
  status?: { phase?: string; capacity?: Record<string, string>; accessModes?: string[] };
}
export interface PersistentVolume {
  apiVersion: "v1";
  kind: "PersistentVolume";
  metadata: ObjectMeta;
  spec: {
    capacity?: Record<string, string>;
    accessModes?: string[];
    persistentVolumeReclaimPolicy?: string;
    storageClassName?: string;
    claimRef?: { namespace?: string; name?: string };
    volumeMode?: string;
  };
  status?: { phase?: string; reason?: string };
}
export interface KubeList<T> {
  apiVersion: string;
  kind: string;
  metadata: { resourceVersion?: string };
  items: T[];
}
export interface BasicKubeResource {
  apiVersion: string;
  kind:
    | "Event"
    | "Ingress"
    | "IngressClass"
    | "NetworkPolicy"
    | "Endpoints"
    | "EndpointSlice"
    | "ResourceQuota"
    | "LimitRange"
    | "HorizontalPodAutoscaler"
    | "VerticalPodAutoscaler"
    | "PodDisruptionBudget"
    | "PodSecurityPolicy"
    | "PriorityClass"
    | "Lease"
    | "RuntimeClass"
    | "MutatingWebhookConfiguration"
    | "ValidatingWebhookConfiguration"
    | "ValidatingAdmissionPolicy"
    | "ValidatingAdmissionPolicyBinding";
  metadata: ObjectMeta;
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  involvedObject?: { kind?: string; namespace?: string; name?: string; uid?: string };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  subsets?: unknown[];
  addressType?: string;
  endpoints?: unknown[];
  ports?: unknown[];
  value?: number;
  globalDefault?: boolean;
  description?: string;
  holderIdentity?: string;
  renewTime?: string;
  handler?: string;
  webhooks?: unknown[];
}
export interface HelmRelease {
  name: string;
  namespace: string;
  version: number;
  info?: {
    status?: string;
    description?: string;
    first_deployed?: string;
    last_deployed?: string;
    deleted?: string;
    notes?: string;
  };
  chart?: { metadata?: { name?: string; version?: string; appVersion?: string; description?: string } };
  config?: Record<string, unknown>;
  manifest?: string;
  hooks?: unknown[];
}
export type WatchEvent<T> = { type: "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK" | "ERROR"; object: T };
export interface KubeMutableObject {
  apiVersion: string;
  kind: string;
  metadata: ObjectMeta;
  [key: string]: unknown;
}
export interface KubernetesVersion {
  major: string;
  minor: string;
  gitVersion: string;
  gitCommit?: string;
  platform?: string;
}
export interface APIResource {
  name: string;
  singularName?: string;
  namespaced: boolean;
  kind: string;
  verbs: string[];
  shortNames?: string[];
  categories?: string[];
}
export interface APIResourceList {
  groupVersion: string;
  resources: APIResource[];
}
export interface APIGroupList {
  groups: Array<{
    name: string;
    preferredVersion?: { groupVersion: string; version: string };
    versions: Array<{ groupVersion: string; version: string }>;
  }>;
}
export interface ClusterCapabilities {
  version: KubernetesVersion;
  resourceLists: APIResourceList[];
  resources: number;
  groups: number;
}

const profileKey = "heimdall.cluster-profile",
  profilesKey = "heimdall.cluster-profiles";
export function loadClusterProfile(): ClusterProfile | null {
  try {
    return JSON.parse(sessionStorage.getItem(profileKey) || "null");
  } catch {
    return null;
  }
}
export function listClusterProfiles(): ClusterProfile[] {
  try {
    return JSON.parse(sessionStorage.getItem(profilesKey) || "[]");
  } catch {
    return [];
  }
}
export function saveClusterProfile(profile: ClusterProfile) {
  sessionStorage.setItem(profileKey, JSON.stringify(profile));
  const profiles = listClusterProfiles(),
    // By id alone. Matching on `server` too collapsed every context that shares
    // an API server — different user, different default namespace, same
    // cluster, which is the ordinary shape of a kubeconfig — into one entry, so
    // saving the second silently replaced the first *including its
    // credentials*, and later connects used whichever was written last.
    index = profiles.findIndex(item => item.id === profile.id);
  if (index < 0) profiles.push(profile);
  else profiles[index] = profile;
  sessionStorage.setItem(profilesKey, JSON.stringify(profiles));
}
export function clearClusterProfile() {
  sessionStorage.removeItem(profileKey);
}
export function removeClusterProfile(id: string) {
  const profiles = listClusterProfiles().filter(profile => profile.id !== id);
  sessionStorage.setItem(profilesKey, JSON.stringify(profiles));
  if (loadClusterProfile()?.id === id) clearClusterProfile();
}
export function clusterAuthorization(profile: ClusterProfile) {
  return profile.authorization || `Bearer ${profile.token}`;
}
type ResolvedClusterCredential = {
  authorization?: string;
  clientCertificateData?: string;
  clientKeyData?: string;
  expires: number;
};
/** Whether TLS verification is skipped for this cluster.
 *
 *  `kubeFetch` has always folded in the `allowUntrusted` companion preference,
 *  but the four streaming sites read `profile.insecureSkipTlsVerify` alone — so
 *  a cluster reachable only because the user ticked "allow untrusted" listed and
 *  fetched fine and then failed the moment they opened a shell, logs follow or a
 *  port-forward. One resolution, used by both. */
export function skipsTlsVerification(profile: ClusterProfile): boolean {
  return Boolean(profile.insecureSkipTlsVerify || companionPreferences().allowUntrusted);
}

const credentialCache = new Map<string, ResolvedClusterCredential>();
/** Plugin runs already in progress, keyed by profile.
 *
 *  The cache was only written after a run finished, so concurrent callers all
 *  missed and all spawned the plugin. First paint alone issues several requests
 *  at once — `discoverClusterCapabilities` is a `Promise.all` over /version,
 *  /api/v1 and /apis, and more group reads follow — so an exec-auth profile ran
 *  `aws eks get-token` or `kubelogin` that many times simultaneously, racing on
 *  their own token caches, tripping rate limits, or prompting once per call. */
const credentialInFlight = new Map<string, Promise<ResolvedClusterCredential>>();
export async function resolveClusterCredential(profile: ClusterProfile): Promise<ResolvedClusterCredential> {
  if (profile.authorization || profile.token)
    return { authorization: clusterAuthorization(profile), expires: Infinity };
  if (profile.clientCertificateData && profile.clientKeyData)
    return {
      clientCertificateData: profile.clientCertificateData,
      clientKeyData: profile.clientKeyData,
      expires: Infinity,
    };
  const cached = credentialCache.get(profile.id);
  if (cached && cached.expires > Date.now() + 30_000) return cached;
  if (!profile.execCredential) throw new Error(profile.authMessage || "Cluster credentials are unavailable");
  const running = credentialInFlight.get(profile.id);
  if (running) return running;
  const attempt = runCredentialPlugin(profile);
  credentialInFlight.set(profile.id, attempt);
  try {
    return await attempt;
  } finally {
    credentialInFlight.delete(profile.id);
  }
}

async function runCredentialPlugin(profile: ClusterProfile): Promise<ResolvedClusterCredential> {
  const { executeCredentialPlugin } = await import("./local-shell"),
    credential = await executeCredentialPlugin(profile.execCredential!),
    status = credential.status;
  if (!status?.token && !status?.clientCertificateData) throw new Error("Credential plugin returned no credentials");
  const expiration = status.expirationTimestamp ? Date.parse(status.expirationTimestamp) : Date.now() + 5 * 60_000,
    resolved = {
      ...(status.token
        ? { authorization: `Bearer ${status.token}` }
        : { clientCertificateData: status.clientCertificateData, clientKeyData: status.clientKeyData }),
      expires: Number.isFinite(expiration) ? expiration : Date.now() + 5 * 60_000,
    };
  credentialCache.set(profile.id, resolved);
  return resolved;
}
export async function kubeFetch(
  profile: ClusterProfile,
  path: string,
  options: { method?: string; body?: unknown; raw?: boolean; contentType?: string; signal?: AbortSignal } = {},
) {
  const credential = await resolveClusterCredential(profile),
    preferences = companionPreferences(),
    proxyUrl = profile.preferences?.httpsProxy || profile.proxyUrl || preferences.httpProxy || undefined,
    insecureSkipTlsVerify = Boolean(profile.insecureSkipTlsVerify || preferences.allowUntrusted),
    companionConfigured = Boolean(preferences.companionUrl && preferences.companionToken),
    payload = {
      server: profile.server,
      path,
      method: options.method || ("body" in options ? "POST" : "GET"),
      body: options.body,
      raw: options.raw,
      contentType: options.contentType,
      authorization: credential.authorization,
      certificateAuthorityData: profile.certificateAuthorityData,
      clientCertificateData: credential.clientCertificateData,
      clientKeyData: credential.clientKeyData,
      insecureSkipTlsVerify,
      proxyUrl,
    };
  if (
    credential.clientCertificateData ||
    (companionConfigured && (profile.certificateAuthorityData || proxyUrl || insecureSkipTlsVerify))
  ) {
    const { companionKubeFetch } = await import("./local-shell");
    return companionKubeFetch(payload, options.signal);
  }
  return fetch("/api/kube", {
    method: "POST",
    signal: options.signal,
    headers: {
      "content-type": "application/json",
      "x-kube-server": profile.server,
      authorization: credential.authorization!,
    },
    body: JSON.stringify({
      path,
      method: (options.method || ("body" in options ? "POST" : "GET")) as KubeProxyRequest["method"],
      body: options.body,
      raw: options.raw,
      contentType: options.contentType,
      certificateAuthorityData: profile.certificateAuthorityData,
      insecureSkipTlsVerify,
    } satisfies KubeProxyRequest),
  });
}
export async function kubeRequest<T>(profile: ClusterProfile, path: string, init: RequestInit = {}): Promise<T> {
  let supplied: unknown = undefined;
  if (typeof init.body === "string")
    try {
      supplied = JSON.parse(init.body);
    } catch {
      // Not forwarded — `supplied` is spread as kubeFetch *options*, so a string
      // that is not a JSON object contributes nothing and the request goes out
      // without a body. Every caller passes the `{ body, method, … }` envelope,
      // so this is unreachable today; it is a swallowed programming error rather
      // than a supported input, and the earlier comment here claimed the
      // opposite.
    }
  const headers = new Headers(init.headers),
    response = await kubeFetch(profile, path, {
      method: init.method || "GET",
      contentType: headers.get("content-type") || undefined,
      ...(supplied && typeof supplied === "object" ? supplied : {}),
    });
  if (!response.ok) throw new Error((await response.text()) || `Kubernetes request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
const request = kubeRequest;
export function listPods(profile: ClusterProfile, namespace = "") {
  return request<PodList>(profile, `/api/v1/${namespace ? `namespaces/${encodeURIComponent(namespace)}/` : ""}pods`);
}
export async function discoverClusterCapabilities(profile: ClusterProfile): Promise<ClusterCapabilities> {
  const [version, core, groups] = await Promise.all([
    request<KubernetesVersion>(profile, "/version"),
    request<APIResourceList>(profile, "/api/v1"),
    request<APIGroupList>(profile, "/apis"),
  ]);
  const groupVersions = groups.groups
      .map(group => group.preferredVersion?.groupVersion || group.versions[0]?.groupVersion)
      .filter((value): value is string => !!value),
    additional = await Promise.all(
      groupVersions.map(groupVersion =>
        request<APIResourceList>(profile, `/apis/${groupVersion}`).catch(() => ({ groupVersion, resources: [] })),
      ),
    );
  const resourceLists = [core, ...additional];
  return {
    version,
    resourceLists,
    resources: resourceLists.reduce((total, list) => total + list.resources.length, 0),
    groups: groups.groups.length + 1,
  };
}
export interface ResourceRule {
  verbs: string[];
  apiGroups?: string[];
  resources?: string[];
}
export async function selfSubjectRules(profile: ClusterProfile, namespace: string): Promise<ResourceRule[] | null> {
  const review = await request<{ status?: { resourceRules?: ResourceRule[]; incomplete?: boolean } }>(
    profile,
    "/apis/authorization.k8s.io/v1/selfsubjectrulesreviews",
    {
      method: "POST",
      body: JSON.stringify({
        body: { apiVersion: "authorization.k8s.io/v1", kind: "SelfSubjectRulesReview", spec: { namespace } },
      }),
    },
  );
  if (review.status?.incomplete) return null;
  return review.status?.resourceRules ?? [];
}
export function serviceProxyGet<T>(
  profile: ClusterProfile,
  namespace: string,
  name: string,
  port: number,
  path: string,
) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return request<T>(
    profile,
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${encodeURIComponent(name)}:${port}/proxy${suffix}`,
  );
}
export function listDeployments(profile: ClusterProfile, namespace = "") {
  return request<DeploymentList>(
    profile,
    `/apis/apps/v1/${namespace ? `namespaces/${encodeURIComponent(namespace)}/` : ""}deployments`,
  );
}
export function scaleWorkload<T extends KubeMutableObject>(profile: ClusterProfile, workload: T, replicas: number) {
  return request<T>(profile, `${kubeResourcePath(workload)}/scale`, {
    method: "PATCH",
    headers: { "content-type": "application/merge-patch+json" },
    body: JSON.stringify({ body: { spec: { replicas } } }),
  });
}
export function getWorkloadScale(
  profile: ClusterProfile,
  workload: Pick<KubeMutableObject, "apiVersion" | "kind" | "metadata">,
) {
  return request<{
    apiVersion: string;
    kind: "Scale";
    metadata: ObjectMeta;
    spec: { replicas: number };
    status?: { replicas?: number };
  }>(profile, `${kubeResourcePath(workload)}/scale`);
}
export function restartWorkload<T extends KubeMutableObject>(profile: ClusterProfile, workload: T) {
  return request<T>(profile, kubeResourcePath(workload), {
    method: "PATCH",
    headers: { "content-type": "application/merge-patch+json" },
    body: JSON.stringify({
      body: {
        spec: {
          template: { metadata: { annotations: { "kubectl.kubernetes.io/restartedAt": new Date().toISOString() } } },
        },
      },
    }),
  });
}
export function listNodes(profile: ClusterProfile) {
  return request<NodeList>(profile, "/api/v1/nodes");
}
export function setNodeSchedulable(profile: ClusterProfile, node: Node, schedulable: boolean) {
  return request<Node>(profile, `/api/v1/nodes/${encodeURIComponent(node.metadata.name)}`, {
    method: "PATCH",
    headers: { "content-type": "application/merge-patch+json" },
    body: JSON.stringify({ body: { spec: { unschedulable: !schedulable } } }),
  });
}
export function listServices(profile: ClusterProfile, namespace = "") {
  return request<ServiceList>(
    profile,
    `/api/v1/${namespace ? `namespaces/${encodeURIComponent(namespace)}/` : ""}services`,
  );
}
export function listWorkloadControllers(profile: ClusterProfile, kind: WorkloadController["kind"], namespace = "") {
  const plural: { [K in WorkloadController["kind"]]: string } = {
    DaemonSet: "daemonsets",
    StatefulSet: "statefulsets",
    ReplicaSet: "replicasets",
    ReplicationController: "replicationcontrollers",
    Job: "jobs",
    CronJob: "cronjobs",
  };
  if (kind === "ReplicationController")
    return request<WorkloadControllerList>(
      profile,
      `/api/v1/${namespace ? `namespaces/${encodeURIComponent(namespace)}/` : ""}${plural[kind]}`,
    );
  const group = kind === "Job" || kind === "CronJob" ? "batch/v1" : "apps/v1";
  return request<WorkloadControllerList>(
    profile,
    `/apis/${group}/${namespace ? `namespaces/${encodeURIComponent(namespace)}/` : ""}${plural[kind]}`,
  );
}
export function setBatchWorkloadSuspended(
  profile: ClusterProfile,
  kind: "Job" | "CronJob",
  namespace: string,
  name: string,
  suspend: boolean,
) {
  const plural = kind === "Job" ? "jobs" : "cronjobs";
  return request<WorkloadController>(
    profile,
    `/apis/batch/v1/namespaces/${encodeURIComponent(namespace || "default")}/${plural}/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/merge-patch+json" },
      body: JSON.stringify({ body: { spec: { suspend } } }),
    },
  );
}
export function createBatchJob<T extends KubeMutableObject>(
  profile: ClusterProfile,
  namespace: string,
  name: string,
  object: T,
) {
  const job = {
    ...object,
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { ...object.metadata, name, namespace: namespace || "default" },
  };
  return request<T>(profile, `/apis/batch/v1/namespaces/${encodeURIComponent(namespace || "default")}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: job }),
  });
}
export function listPersistentVolumeClaims(profile: ClusterProfile, namespace = "") {
  return request<KubeList<PersistentVolumeClaim>>(
    profile,
    `/api/v1/${namespace ? `namespaces/${encodeURIComponent(namespace)}/` : ""}persistentvolumeclaims`,
  );
}
export function listPersistentVolumes(profile: ClusterProfile) {
  return request<KubeList<PersistentVolume>>(profile, "/api/v1/persistentvolumes");
}
export interface ServiceAccountTokenRequest {
  apiVersion: "authentication.k8s.io/v1";
  kind: "TokenRequest";
  spec: { audiences: string[]; expirationSeconds: number };
  status?: { token?: string; expirationTimestamp?: string };
}
export function requestServiceAccountToken(
  profile: ClusterProfile,
  namespace: string,
  name: string,
  expirationSeconds = 3600,
) {
  const object: ServiceAccountTokenRequest = {
    apiVersion: "authentication.k8s.io/v1",
    kind: "TokenRequest",
    spec: { audiences: ["https://kubernetes.default.svc"], expirationSeconds },
  };
  return request<ServiceAccountTokenRequest>(
    profile,
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/serviceaccounts/${encodeURIComponent(name)}/token`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: object }) },
  );
}
export function listBasicResources(profile: ClusterProfile, kind: BasicKubeResource["kind"], namespace = "") {
  const config: { [K in BasicKubeResource["kind"]]: { base: string; plural: string; namespaced?: boolean } } = {
      Event: { base: "/api/v1", plural: "events" },
      Ingress: { base: "/apis/networking.k8s.io/v1", plural: "ingresses" },
      IngressClass: { base: "/apis/networking.k8s.io/v1", plural: "ingressclasses", namespaced: false },
      NetworkPolicy: { base: "/apis/networking.k8s.io/v1", plural: "networkpolicies" },
      Endpoints: { base: "/api/v1", plural: "endpoints" },
      EndpointSlice: { base: "/apis/discovery.k8s.io/v1", plural: "endpointslices" },
      ResourceQuota: { base: "/api/v1", plural: "resourcequotas" },
      LimitRange: { base: "/api/v1", plural: "limitranges" },
      HorizontalPodAutoscaler: { base: "/apis/autoscaling/v2", plural: "horizontalpodautoscalers" },
      VerticalPodAutoscaler: { base: "/apis/autoscaling.k8s.io/v1", plural: "verticalpodautoscalers" },
      PodDisruptionBudget: { base: "/apis/policy/v1", plural: "poddisruptionbudgets" },
      PodSecurityPolicy: { base: "/apis/policy/v1beta1", plural: "podsecuritypolicies", namespaced: false },
      PriorityClass: { base: "/apis/scheduling.k8s.io/v1", plural: "priorityclasses", namespaced: false },
      Lease: { base: "/apis/coordination.k8s.io/v1", plural: "leases" },
      RuntimeClass: { base: "/apis/node.k8s.io/v1", plural: "runtimeclasses", namespaced: false },
      MutatingWebhookConfiguration: {
        base: "/apis/admissionregistration.k8s.io/v1",
        plural: "mutatingwebhookconfigurations",
        namespaced: false,
      },
      ValidatingWebhookConfiguration: {
        base: "/apis/admissionregistration.k8s.io/v1",
        plural: "validatingwebhookconfigurations",
        namespaced: false,
      },
      ValidatingAdmissionPolicy: {
        base: "/apis/admissionregistration.k8s.io/v1",
        plural: "validatingadmissionpolicies",
        namespaced: false,
      },
      ValidatingAdmissionPolicyBinding: {
        base: "/apis/admissionregistration.k8s.io/v1",
        plural: "validatingadmissionpolicybindings",
        namespaced: false,
      },
    },
    entry = config[kind],
    scope = entry.namespaced === false ? "" : namespace ? `namespaces/${encodeURIComponent(namespace)}/` : "";
  return request<KubeList<BasicKubeResource>>(profile, `${entry.base}/${scope}${entry.plural}`);
}
const resourcePlurals: Record<string, string> = {
  Endpoints: "endpoints",
  Ingress: "ingresses",
  IngressClass: "ingressclasses",
  PodSecurityPolicy: "podsecuritypolicies",
  NetworkPolicy: "networkpolicies",
  EndpointSlice: "endpointslices",
  ResourceQuota: "resourcequotas",
  LimitRange: "limitranges",
  HorizontalPodAutoscaler: "horizontalpodautoscalers",
  VerticalPodAutoscaler: "verticalpodautoscalers",
  PodDisruptionBudget: "poddisruptionbudgets",
  PriorityClass: "priorityclasses",
  Lease: "leases",
  RuntimeClass: "runtimeclasses",
  MutatingWebhookConfiguration: "mutatingwebhookconfigurations",
  ValidatingWebhookConfiguration: "validatingwebhookconfigurations",
  ValidatingAdmissionPolicy: "validatingadmissionpolicies",
  ValidatingAdmissionPolicyBinding: "validatingadmissionpolicybindings",
  StorageClass: "storageclasses",
  CustomResourceDefinition: "customresourcedefinitions",
  ClusterRole: "clusterroles",
  ClusterRoleBinding: "clusterrolebindings",
  RoleBinding: "rolebindings",
  ServiceAccount: "serviceaccounts",
  ConfigMap: "configmaps",
  Secret: "secrets",
  PersistentVolumeClaim: "persistentvolumeclaims",
  PersistentVolume: "persistentvolumes",
  Namespace: "namespaces",
  Pod: "pods",
  Service: "services",
  Deployment: "deployments",
  DaemonSet: "daemonsets",
  StatefulSet: "statefulsets",
  ReplicaSet: "replicasets",
  ReplicationController: "replicationcontrollers",
  CronJob: "cronjobs",
};
export function kubeResourcePath(
  object: Pick<KubeMutableObject, "apiVersion" | "kind" | "metadata">,
  includeName = true,
) {
  const base = object.apiVersion === "v1" ? "/api/v1" : `/apis/${object.apiVersion}`,
    plural = resourcePlurals[object.kind] || `${object.kind.toLowerCase()}s`,
    scope = object.metadata.namespace ? `/namespaces/${encodeURIComponent(object.metadata.namespace)}` : "",
    name = includeName && object.metadata.name ? `/${encodeURIComponent(object.metadata.name)}` : "";
  return `${base}${scope}/${plural}${name}`;
}
export function applyKubeResource<T extends KubeMutableObject>(profile: ClusterProfile, object: T) {
  if (!object.apiVersion || !object.kind || !object.metadata?.name)
    throw new Error("Resource requires apiVersion, kind, and metadata.name");
  return request<T>(profile, `${kubeResourcePath(object)}?fieldManager=heimdall&force=true&fieldValidation=Strict`, {
    method: "PATCH",
    headers: { "content-type": "application/apply-patch+yaml" },
    body: JSON.stringify({ body: object }),
  });
}
export function deleteKubeResource(
  profile: ClusterProfile,
  object: Pick<KubeMutableObject, "apiVersion" | "kind" | "metadata">,
  options?: { gracePeriodSeconds?: number; propagationPolicy?: string },
) {
  const body: Record<string, unknown> = {
    apiVersion: "v1",
    kind: "DeleteOptions",
    propagationPolicy: options?.propagationPolicy ?? "Foreground",
  };
  if (options?.gracePeriodSeconds != null) body.gracePeriodSeconds = options.gracePeriodSeconds;
  return request(profile, kubeResourcePath(object), { method: "DELETE", body: JSON.stringify({ body }) });
}
export async function listHelmReleaseHistory(profile: ClusterProfile, namespace = "") {
  const selector = encodeURIComponent("owner=helm");
  const secrets = await request<KubeList<Secret>>(
      profile,
      `/api/v1/${namespace ? `namespaces/${encodeURIComponent(namespace)}/` : ""}secrets?labelSelector=${selector}`,
    ),
    // allSettled, not all: a single unreadable release secret — truncated,
    // written by a different Helm version, gzip that will not inflate — used to
    // reject the whole batch and take release listing, history and rollback
    // down for the entire cluster. One bad row is worth skipping, not the view.
    settled = await Promise.allSettled(
      secrets.items
        .filter(secret => secret.type === "helm.sh/release.v1" && secret.data?.release)
        .map(decodeHelmRelease),
    ),
    releases = settled.flatMap(result => (result.status === "fulfilled" ? [result.value] : []));
  return releases.sort(
    (a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name) || b.version - a.version,
  );
}
export async function listHelmReleases(profile: ClusterProfile, namespace = "") {
  const history = await listHelmReleaseHistory(profile, namespace),
    latest = new Map<string, HelmRelease>();
  for (const release of history) {
    const id = `${release.namespace}/${release.name}`,
      current = latest.get(id);
    if (!current || release.version > current.version) latest.set(id, release);
  }
  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name) || a.namespace.localeCompare(b.namespace));
}
export async function decodeHelmRelease(secret: Secret): Promise<HelmRelease> {
  const encoded = secret.data?.release;
  if (!encoded) throw new Error(`Helm release secret ${secret.metadata.name} has no release payload`);
  try {
    const inner = atob(encoded),
      compressed = Uint8Array.from(atob(inner), char => char.charCodeAt(0));
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
    const release = JSON.parse(await new Response(stream).text()) as HelmRelease;
    release.namespace ||= secret.metadata.namespace || "default";
    return release;
  } catch (error) {
    throw new Error(
      `Unable to decode Helm release ${secret.metadata.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function streamingRequest(profile: ClusterProfile, path: string, signal: AbortSignal) {
  const response = await kubeFetch(profile, path, { raw: true, signal });
  if (!response.ok) {
    // Keep the status on the error: a watch has to tell "your resourceVersion
    // expired, re-list" (410) apart from every other failure, and the body alone
    // makes that a string match.
    const error: Error & { status?: number } = new Error(await response.text());
    error.status = response.status;
    throw error;
  }
  if (!response.body) throw new Error("Streaming response has no body");
  return response.body;
}
/** Whether a watch failure is "your resourceVersion is too old" rather than a
 *  real error. The status is authoritative; the message check covers relays that
 *  surface the Status body without preserving the code. */
export function isExpiredWatch(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { status?: number }).status === 410) return true;
  const message = (error as { message?: string }).message ?? "";
  return /too old resource version|"code":\s*410|"reason":\s*"Expired"/.test(message);
}

// Generic streaming watch over any collection path, with resourceVersion tracking
// and reconnect. Returns an unsubscribe function.
export function watchResource<T extends { metadata?: { resourceVersion?: string } }>(
  profile: ClusterProfile,
  collectionPath: string,
  onEvent: (event: WatchEvent<T>) => void,
  onError?: (error: unknown) => void,
) {
  const controller = new AbortController();
  void (async () => {
    let resourceVersion = "";
    while (!controller.signal.aborted) {
      try {
        const query = new URLSearchParams({ watch: "1", allowWatchBookmarks: "true", timeoutSeconds: "30" });
        if (resourceVersion) query.set("resourceVersion", resourceVersion);
        const path = `${collectionPath}?${query}`;
        const reader = (await streamingRequest(profile, path, controller.signal))
          .pipeThrough(new TextDecoderStream())
          .getReader();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as WatchEvent<T>;
            if (event.type === "ERROR") {
              // The apiserver reports an expired version as an ERROR frame as
              // well as a 410, and this branch used to fall through to the
              // generic handling: `resourceVersion` kept its stale value and the
              // next connect asked for it again.
              resourceVersion = "";
              onEvent(event);
              throw new Error("Watch reset by the server");
            }
            const version = event.object?.metadata?.resourceVersion;
            if (version) resourceVersion = version;
            onEvent(event);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          // 410 Gone means the tracked version has aged out of the server's
          // watch cache. Reconnecting with it again can only fail the same way,
          // which is what turned an expired watch into a silent once-a-second
          // loop with the table frozen on stale rows. Dropping it re-lists.
          if (isExpiredWatch(error)) resourceVersion = "";
          else onError?.(error);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  })();
  return () => controller.abort();
}
function podLogsQuery(container: string | undefined, options: PodLogsQuery = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...options, container }))
    if (value !== undefined && value !== false) query.set(key, String(value));
  return query;
}
export function followPodLogs(
  profile: ClusterProfile,
  pod: Pod,
  container: string,
  onChunk: (text: string) => void,
  options: PodLogsQuery = {},
) {
  const controller = new AbortController();
  void (async () => {
    try {
      const query = podLogsQuery(container, { ...options, follow: true, timestamps: true });
      const path = `/api/v1/namespaces/${encodeURIComponent(pod.metadata.namespace || "default")}/pods/${encodeURIComponent(pod.metadata.name)}/log?${query}`;
      const reader = (await streamingRequest(profile, path, controller.signal))
        .pipeThrough(new TextDecoderStream())
        .getReader();
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          // A follow that ends is not the same as a follow that is still
          // running, and this used to look identical: the loop returned, the
          // unsubscribe stayed live, and the view sat there apparently attached
          // with no further lines. The apiserver closes these routinely — idle
          // timeouts, a proxy at 30s, a node restart — so say so rather than
          // going quiet. Not auto-reconnected: re-following replays from the
          // start and would duplicate everything already on screen.
          if (!controller.signal.aborted) onChunk("\n[stream ended] Reopen logs to continue following.");
          break;
        }
        onChunk(value);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        onChunk(`\n[stream error] ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
  return () => controller.abort();
}

export interface ExecSession {
  send(text: string): void;
  resize(width: number, height: number): void;
  close(): void;
}
type AsyncExecSession = {
  send(text: string): void | Promise<void>;
  resize(width: number, height: number): void | Promise<void>;
  close(): void | Promise<void>;
};
function openBearerPodExec(
  profile: ClusterProfile,
  pod: Pod,
  container: string,
  authorization: string,
  callbacks: {
    onReady?: () => void;
    onStdout: (text: string) => void;
    onStderr?: (text: string) => void;
    onError?: (message: string) => void;
    onClose?: () => void;
  },
  command: string[],
  mode: "exec" | "attach" = "exec",
): ExecSession {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:",
    socket = new WebSocket(`${protocol}//${location.host}/api/kube-stream`);
  socket.binaryType = "arraybuffer";
  const encoder = new TextEncoder(),
    decoder = new TextDecoder();
  const effectiveMode = command[0] === "__attach__" ? "attach" : mode,
    query = new URLSearchParams({ container, stdin: "true", stdout: "true", stderr: "true", tty: "true" });
  if (effectiveMode === "exec") for (const part of command) query.append("command", part);
  const path = `/api/v1/namespaces/${encodeURIComponent(pod.metadata.namespace || "default")}/pods/${encodeURIComponent(pod.metadata.name)}/${effectiveMode}?${query}`;
  socket.addEventListener("open", () =>
    socket.send(
      JSON.stringify({
        server: profile.server,
        authorization,
        path,
        protocols: ["v5.channel.k8s.io", "v4.channel.k8s.io"],
        certificateAuthorityData: profile.certificateAuthorityData,
        insecureSkipTlsVerify: skipsTlsVerification(profile),
      } satisfies KubeStreamConfig),
    ),
  );
  socket.addEventListener("message", async event => {
    if (typeof event.data === "string") {
      // The relay does not promise every text frame is JSON — it forwards plain
      // text on some failures, which is why the port-forward handler below has
      // always had this guard. Without it `JSON.parse` throws inside an `async`
      // listener, which is an unhandled rejection rather than an error anyone
      // sees: no callback fires and the terminal simply stops responding.
      try {
        const message = JSON.parse(event.data) as { type: string; message?: string };
        if (message.type === "ready") callbacks.onReady?.();
        else if (message.type === "error") callbacks.onError?.(message.message || "Exec failed");
      } catch {
        callbacks.onError?.(event.data);
      }
      return;
    }
    const bytes = new Uint8Array(
        event.data instanceof ArrayBuffer ? event.data : await (event.data as Blob).arrayBuffer(),
      ),
      text = decoder.decode(bytes.subarray(1));
    if (bytes[0] === 1) callbacks.onStdout(text);
    else if (bytes[0] === 2) callbacks.onStderr?.(text);
    else if (bytes[0] === 3) callbacks.onError?.(text);
  });
  socket.addEventListener("close", () => callbacks.onClose?.());
  socket.addEventListener("error", () => callbacks.onError?.("WebSocket transport failed"));
  const channel = (id: number, data: Uint8Array) => {
    const framed = new Uint8Array(data.length + 1);
    framed[0] = id;
    framed.set(data, 1);
    if (socket.readyState === WebSocket.OPEN) socket.send(framed);
  };
  return {
    send: text => channel(0, encoder.encode(text)),
    resize: (width, height) => channel(4, encoder.encode(JSON.stringify({ Width: width, Height: height }))),
    close: () => socket.close(1000, "Terminal closed"),
  };
}
export function openPodExec(
  profile: ClusterProfile,
  pod: Pod,
  container: string,
  callbacks: {
    onReady?: () => void;
    onStdout: (text: string) => void;
    onStderr?: (text: string) => void;
    onError?: (message: string) => void;
    onClose?: () => void;
  },
  command = ["/bin/sh"],
): ExecSession {
  let session: AsyncExecSession | undefined,
    closed = false,
    pending: string[] = [],
    size: [number, number] | undefined;
  void resolveClusterCredential(profile)
    .then(async credential => {
      if (credential.clientCertificateData) {
        const { openCompanionKubeExec } = await import("./local-shell");
        session = await openCompanionKubeExec(
          {
            server: profile.server,
            namespace: pod.metadata.namespace || "default",
            pod: pod.metadata.name,
            container,
            command,
            certificateAuthorityData: profile.certificateAuthorityData,
            clientCertificateData: credential.clientCertificateData,
            clientKeyData: credential.clientKeyData,
            insecureSkipTlsVerify: skipsTlsVerification(profile),
          },
          callbacks,
        );
      } else session = openBearerPodExec(profile, pod, container, credential.authorization!, callbacks, command);
      if (closed) {
        void session.close();
        return;
      }
      for (const text of pending) void session.send(text);
      pending = [];
      if (size) void session.resize(...size);
    })
    .catch(error => callbacks.onError?.(error instanceof Error ? error.message : String(error)));
  return {
    send: text => {
      if (session) void session.send(text);
      else pending.push(text);
    },
    resize: (width, height) => {
      size = [width, height];
      if (session) void session.resize(width, height);
    },
    close: () => {
      closed = true;
      if (session) void session.close();
    },
  };
}
export interface PortForwardSession {
  send(data: string | Uint8Array): void;
  close(): void;
}
export interface PortForwardCallbacks {
  onReady?: (details?: { localPort?: number }) => void;
  onData: (data: Uint8Array) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}
function openBearerPodPortForward(
  profile: ClusterProfile,
  pod: Pod,
  port: number,
  authorization: string,
  callbacks: PortForwardCallbacks,
): PortForwardSession {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:",
    socket = new WebSocket(`${scheme}//${location.host}/api/kube-stream`);
  socket.binaryType = "arraybuffer";
  const encoder = new TextEncoder(),
    decoder = new TextDecoder();
  const path = `/api/v1/namespaces/${encodeURIComponent(pod.metadata.namespace || "default")}/pods/${encodeURIComponent(pod.metadata.name)}/portforward?ports=${port}`;
  socket.addEventListener("open", () =>
    socket.send(
      JSON.stringify({
        server: profile.server,
        authorization,
        path,
        protocols: ["v4.channel.k8s.io"],
        certificateAuthorityData: profile.certificateAuthorityData,
        insecureSkipTlsVerify: skipsTlsVerification(profile),
      } satisfies KubeStreamConfig),
    ),
  );
  socket.addEventListener("message", async event => {
    if (typeof event.data === "string") {
      try {
        const message = JSON.parse(event.data) as { type: string; message?: string };
        if (message.type === "ready") callbacks.onReady?.();
        else if (message.type === "error") callbacks.onError?.(message.message || "Port forward failed");
      } catch {
        callbacks.onError?.(event.data);
      }
      return;
    }
    const bytes = new Uint8Array(
      event.data instanceof ArrayBuffer ? event.data : await (event.data as Blob).arrayBuffer(),
    );
    if (bytes[0] === 0) callbacks.onData(bytes.slice(1));
    else if (bytes[0] === 1) callbacks.onError?.(decoder.decode(bytes.subarray(1)));
  });
  socket.addEventListener("close", () => callbacks.onClose?.());
  socket.addEventListener("error", () => callbacks.onError?.("WebSocket transport failed"));
  return {
    send: data => {
      if (socket.readyState !== WebSocket.OPEN) throw new Error("Port forward is not connected");
      const payload = typeof data === "string" ? encoder.encode(data) : data,
        framed = new Uint8Array(payload.length + 1);
      framed[0] = 0;
      framed.set(payload, 1);
      socket.send(framed);
    },
    close: () => socket.close(1000, "Port forward stopped"),
  };
}
export function openPodPortForward(
  profile: ClusterProfile,
  pod: Pod,
  port: number,
  callbacks: PortForwardCallbacks,
): PortForwardSession {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Pod port must be between 1 and 65535");
  let session: { send(data: string | Uint8Array): void | Promise<void>; close(): void | Promise<void> } | undefined,
    closed = false,
    pending: Array<string | Uint8Array> = [];
  void resolveClusterCredential(profile)
    .then(async credential => {
      if (credential.clientCertificateData) {
        const { openCompanionPortForward } = await import("./local-shell");
        session = await openCompanionPortForward(
          {
            server: profile.server,
            namespace: pod.metadata.namespace || "default",
            pod: pod.metadata.name,
            port,
            certificateAuthorityData: profile.certificateAuthorityData,
            clientCertificateData: credential.clientCertificateData,
            clientKeyData: credential.clientKeyData,
            insecureSkipTlsVerify: skipsTlsVerification(profile),
          },
          callbacks,
        );
      } else session = openBearerPodPortForward(profile, pod, port, credential.authorization!, callbacks);
      if (closed) {
        void session.close();
        return;
      }
      for (const data of pending) void session.send(data);
      pending = [];
    })
    .catch(error => callbacks.onError?.(error instanceof Error ? error.message : String(error)));
  return {
    send: data => {
      if (session) void session.send(data);
      else pending.push(data);
    },
    close: () => {
      closed = true;
      if (session) void session.close();
    },
  };
}
export async function podLogs(profile: ClusterProfile, pod: Pod, container?: string, options: PodLogsQuery = {}) {
  const query = podLogsQuery(container, { timestamps: true, ...options }),
    path = `/api/v1/namespaces/${encodeURIComponent(pod.metadata.namespace || "default")}/pods/${encodeURIComponent(pod.metadata.name)}/log?${query}`,
    response = await kubeFetch(profile, path, { raw: true });
  if (!response.ok) throw new Error(await response.text());
  return response.text();
}

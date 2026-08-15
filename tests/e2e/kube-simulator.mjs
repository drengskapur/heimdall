// In-memory Kubernetes API simulator for E2E — no Docker/k3d required.
//
// Implements enough of the Kubernetes API for the PWA to connect and exercise
// real functionality: discovery, list/get/create/update/delete, watch streams,
// pod logs, SelfSubjectAccessReview, the metrics.k8s.io aggregated API, and the
// exec/attach/portforward streaming subresources over WebSocket (the same
// channel.k8s.io protocol the PWA speaks through the /api/kube-stream worker).
// State is mutable, so create/delete tests actually change subsequent lists.
//
//   node tests/e2e/kube-simulator.mjs            # http://127.0.0.1:7444, token "e2e"
//   HEIMDALL_SIM_PORT=9000 HEIMDALL_SIM_TOKEN=x node tests/e2e/kube-simulator.mjs
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const host = process.env.HEIMDALL_SIM_HOST || "127.0.0.1";
const port = Number(process.env.HEIMDALL_SIM_PORT || 7444);
const token = process.env.HEIMDALL_SIM_TOKEN || "e2e";
const now = () => new Date().toISOString();

// --- resource catalog: [plural, kind, namespaced, apiVersion] -------------
const coreResources = [
  ["pods", "Pod", true],
  ["namespaces", "Namespace", false],
  ["nodes", "Node", false],
  ["services", "Service", true],
  ["endpoints", "Endpoints", true],
  ["events", "Event", true],
  ["configmaps", "ConfigMap", true],
  ["secrets", "Secret", true],
  ["serviceaccounts", "ServiceAccount", true],
  ["persistentvolumes", "PersistentVolume", false],
  ["persistentvolumeclaims", "PersistentVolumeClaim", true],
  ["resourcequotas", "ResourceQuota", true],
  ["limitranges", "LimitRange", true],
  ["replicationcontrollers", "ReplicationController", true],
];
const groups = {
  "apps/v1": [
    ["deployments", "Deployment", true],
    ["daemonsets", "DaemonSet", true],
    ["statefulsets", "StatefulSet", true],
    ["replicasets", "ReplicaSet", true],
  ],
  "batch/v1": [
    ["jobs", "Job", true],
    ["cronjobs", "CronJob", true],
  ],
  "networking.k8s.io/v1": [
    ["ingresses", "Ingress", true],
    ["ingressclasses", "IngressClass", false],
    ["networkpolicies", "NetworkPolicy", true],
  ],
  "rbac.authorization.k8s.io/v1": [
    ["roles", "Role", true],
    ["rolebindings", "RoleBinding", true],
    ["clusterroles", "ClusterRole", false],
    ["clusterrolebindings", "ClusterRoleBinding", false],
  ],
  "storage.k8s.io/v1": [["storageclasses", "StorageClass", false]],
  "apiextensions.k8s.io/v1": [["customresourcedefinitions", "CustomResourceDefinition", false]],
  "autoscaling/v1": [["horizontalpodautoscalers", "HorizontalPodAutoscaler", true]],
  "policy/v1": [["poddisruptionbudgets", "PodDisruptionBudget", true]],
  "scheduling.k8s.io/v1": [["priorityclasses", "PriorityClass", false]],
  "node.k8s.io/v1": [["runtimeclasses", "RuntimeClass", false]],
  "coordination.k8s.io/v1": [["leases", "Lease", true]],
  "discovery.k8s.io/v1": [["endpointslices", "EndpointSlice", true]],
  "admissionregistration.k8s.io/v1": [
    ["mutatingwebhookconfigurations", "MutatingWebhookConfiguration", false],
    ["validatingwebhookconfigurations", "ValidatingWebhookConfiguration", false],
  ],
  "authorization.k8s.io/v1": [
    ["selfsubjectaccessreviews", "SelfSubjectAccessReview", false],
    ["selfsubjectrulesreviews", "SelfSubjectRulesReview", false],
  ],
};
// metrics.k8s.io is an aggregated API served specially (see handler); it must not
// enter kindByResource or it would shadow the core pods/nodes collections.
const metricsGroupVersion = "metrics.k8s.io/v1beta1";
const kindByResource = new Map();
const apiVersionByResource = new Map();
for (const [name, kind, ns] of coreResources) {
  kindByResource.set(name, { kind, namespaced: ns, apiVersion: "v1" });
  apiVersionByResource.set(name, "v1");
}
for (const [gv, list] of Object.entries(groups))
  for (const [name, kind, ns] of list) {
    kindByResource.set(name, { kind, namespaced: ns, apiVersion: gv });
    apiVersionByResource.set(name, gv);
  }

// --- mutable store: resource -> Map(key -> object) ------------------------
let version = 100;
const store = new Map();
const keyOf = (ns, name) => `${ns || ""}/${name}`;
function bucket(resource) {
  if (!store.has(resource)) store.set(resource, new Map());
  return store.get(resource);
}
function seed(resource, obj) {
  const meta = kindByResource.get(resource);
  obj.apiVersion ||= meta.apiVersion;
  obj.kind ||= meta.kind;
  obj.metadata = {
    uid: `${resource}-${obj.metadata.name}`,
    resourceVersion: String(++version),
    creationTimestamp: "2026-07-31T12:00:00Z",
    ...obj.metadata,
  };
  bucket(resource).set(keyOf(obj.metadata.namespace, obj.metadata.name), obj);
}
["default", "kube-system", "kube-public"].forEach(name =>
  seed("namespaces", { metadata: { name }, status: { phase: "Active" } }),
);
seed("nodes", {
  metadata: { name: "sim-control-plane", labels: { "node-role.kubernetes.io/control-plane": "" } },
  status: {
    conditions: [{ type: "Ready", status: "True" }],
    nodeInfo: { kubeletVersion: "v1.36.0", operatingSystem: "linux", architecture: "amd64" },
    capacity: { cpu: "4", memory: "8Gi", pods: "110" },
  },
});
["coredns-abc", "local-path-provisioner-xyz", "metrics-server-123"].forEach((name, i) =>
  seed("pods", {
    metadata: { name, namespace: "kube-system", labels: { app: name.split("-")[0] } },
    spec: {
      nodeName: "sim-control-plane",
      containers: [
        {
          name: "main",
          image: "registry.k8s.io/app:latest",
          ports: [{ name: "http", containerPort: 8080, protocol: "TCP" }],
        },
      ],
    },
    status: {
      phase: "Running",
      podIP: `10.42.0.${i + 2}`,
      containerStatuses: [{ name: "main", ready: true, restartCount: 0, state: { running: { startedAt: now() } } }],
    },
  }),
);
seed("deployments", {
  metadata: { name: "coredns", namespace: "kube-system", labels: { app: "coredns" } },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: "coredns" } },
    template: {
      metadata: { labels: { app: "coredns" } },
      spec: { containers: [{ name: "coredns", image: "coredns:1.11" }] },
    },
  },
  status: {
    replicas: 1,
    readyReplicas: 1,
    availableReplicas: 1,
    updatedReplicas: 1,
    conditions: [{ type: "Available", status: "True" }],
  },
});

// One representative object per remaining type so every list/detail view renders
// against real data shapes (empty views can hide shape-dependent crashes).
const pod = { metadata: { labels: { app: "example" } }, spec: { containers: [{ name: "main", image: "nginx:1.27" }] } };
seed("daemonsets", {
  metadata: { name: "sim-agent", namespace: "kube-system", labels: { app: "sim-agent" } },
  spec: { selector: { matchLabels: { app: "sim-agent" } }, template: pod },
  status: { currentNumberScheduled: 1, numberReady: 1, desiredNumberScheduled: 1, numberAvailable: 1 },
});
seed("statefulsets", {
  metadata: { name: "sim-db", namespace: "default", labels: { app: "sim-db" } },
  spec: { serviceName: "sim-db", replicas: 1, selector: { matchLabels: { app: "sim-db" } }, template: pod },
  status: { replicas: 1, readyReplicas: 1, currentReplicas: 1, updatedReplicas: 1 },
});
seed("replicasets", {
  metadata: {
    name: "coredns-5d78c9",
    namespace: "kube-system",
    labels: { app: "coredns" },
    ownerReferences: [{ apiVersion: "apps/v1", kind: "Deployment", name: "coredns", uid: "deployments-coredns" }],
  },
  spec: { replicas: 1, selector: { matchLabels: { app: "coredns" } }, template: pod },
  status: { replicas: 1, readyReplicas: 1, availableReplicas: 1 },
});
seed("replicationcontrollers", {
  metadata: { name: "legacy-rc", namespace: "default" },
  spec: { replicas: 1, selector: { app: "legacy" }, template: pod },
  status: { replicas: 1, readyReplicas: 1, availableReplicas: 1 },
});
seed("jobs", {
  metadata: { name: "sim-job", namespace: "default", labels: { job: "sim" } },
  spec: { completions: 1, parallelism: 1, template: pod },
  status: {
    succeeded: 1,
    conditions: [{ type: "Complete", status: "True" }],
    startTime: "2026-07-31T12:00:00Z",
    completionTime: "2026-07-31T12:01:00Z",
  },
});
seed("cronjobs", {
  metadata: { name: "sim-cron", namespace: "default" },
  spec: { schedule: "*/5 * * * *", suspend: false, jobTemplate: { spec: { template: pod } } },
  status: { active: [], lastScheduleTime: "2026-07-31T12:00:00Z" },
});
seed("services", {
  metadata: { name: "kube-dns", namespace: "kube-system", labels: { app: "coredns" } },
  spec: {
    type: "ClusterIP",
    clusterIP: "10.43.0.10",
    selector: { app: "coredns" },
    ports: [{ name: "dns", port: 53, protocol: "UDP", targetPort: 53 }],
  },
  status: { loadBalancer: {} },
});
seed("endpoints", {
  metadata: { name: "kube-dns", namespace: "kube-system" },
  subsets: [{ addresses: [{ ip: "10.42.0.2" }], ports: [{ name: "dns", port: 53, protocol: "UDP" }] }],
});
seed("configmaps", {
  metadata: { name: "coredns", namespace: "kube-system" },
  data: { Corefile: ".:53 {\n  forward . /etc/resolv.conf\n}\n" },
});
seed("secrets", { metadata: { name: "sim-token", namespace: "default" }, type: "Opaque", data: { token: "ZTJl" } });
seed("serviceaccounts", { metadata: { name: "default", namespace: "default" } });
seed("persistentvolumes", {
  metadata: { name: "sim-pv" },
  spec: {
    capacity: { storage: "1Gi" },
    accessModes: ["ReadWriteOnce"],
    storageClassName: "standard",
    claimRef: { namespace: "default", name: "sim-pvc" },
  },
  status: { phase: "Bound" },
});
seed("persistentvolumeclaims", {
  metadata: { name: "sim-pvc", namespace: "default" },
  spec: {
    accessModes: ["ReadWriteOnce"],
    resources: { requests: { storage: "1Gi" } },
    storageClassName: "standard",
    volumeName: "sim-pv",
  },
  status: { phase: "Bound", capacity: { storage: "1Gi" } },
});
seed("resourcequotas", {
  metadata: { name: "sim-quota", namespace: "default" },
  spec: { hard: { pods: "10" } },
  status: { hard: { pods: "10" }, used: { pods: "1" } },
});
seed("limitranges", {
  metadata: { name: "sim-limits", namespace: "default" },
  spec: { limits: [{ type: "Container", default: { cpu: "500m" }, defaultRequest: { cpu: "100m" } }] },
});
seed("events", {
  metadata: { name: "sim-event.1", namespace: "default" },
  involvedObject: { kind: "Pod", name: "coredns-abc", namespace: "kube-system" },
  reason: "Started",
  message: "Started container main",
  type: "Normal",
  count: 1,
  source: { component: "kubelet" },
  firstTimestamp: "2026-07-31T12:00:00Z",
  lastTimestamp: "2026-07-31T12:00:00Z",
});
seed("ingresses", {
  metadata: { name: "sim-ingress", namespace: "default" },
  spec: {
    rules: [
      {
        host: "sim.local",
        http: {
          paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "kube-dns", port: { number: 80 } } } }],
        },
      },
    ],
  },
  status: { loadBalancer: { ingress: [{ ip: "10.43.0.20" }] } },
});
seed("ingressclasses", { metadata: { name: "nginx" }, spec: { controller: "k8s.io/ingress-nginx" } });
seed("networkpolicies", {
  metadata: { name: "sim-netpol", namespace: "default" },
  spec: { podSelector: { matchLabels: { app: "example" } }, policyTypes: ["Ingress"] },
});
seed("storageclasses", {
  metadata: { name: "standard", annotations: { "storageclass.kubernetes.io/is-default-class": "true" } },
  provisioner: "rancher.io/local-path",
  reclaimPolicy: "Delete",
  volumeBindingMode: "WaitForFirstConsumer",
});
seed("roles", {
  metadata: { name: "sim-role", namespace: "default" },
  rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
});
seed("rolebindings", {
  metadata: { name: "sim-rolebinding", namespace: "default" },
  roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "sim-role" },
  subjects: [{ kind: "ServiceAccount", name: "default", namespace: "default" }],
});
seed("clusterroles", {
  metadata: { name: "sim-clusterrole" },
  rules: [{ apiGroups: [""], resources: ["nodes"], verbs: ["get", "list"] }],
});
seed("clusterrolebindings", {
  metadata: { name: "sim-clusterrolebinding" },
  roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "sim-clusterrole" },
  subjects: [{ kind: "ServiceAccount", name: "default", namespace: "kube-system" }],
});

// Extra example objects so the common views aren't single-row, and coverage for
// the remaining config/policy/CRD kinds the catalog supports.
["nginx-7c9-a", "nginx-7c9-b", "redis-0"].forEach((name, i) =>
  seed("pods", {
    metadata: { name, namespace: "default", labels: { app: name.split("-")[0] } },
    spec: {
      nodeName: "sim-control-plane",
      containers: [{ name: "app", image: name.startsWith("redis") ? "redis:7" : "nginx:1.27" }],
    },
    status: {
      phase: "Running",
      podIP: `10.42.1.${i + 2}`,
      containerStatuses: [{ name: "app", ready: true, restartCount: i, state: { running: { startedAt: now() } } }],
    },
  }),
);
seed("deployments", {
  metadata: { name: "nginx", namespace: "default", labels: { app: "nginx" } },
  spec: {
    replicas: 3,
    selector: { matchLabels: { app: "nginx" } },
    template: {
      metadata: { labels: { app: "nginx" } },
      spec: { containers: [{ name: "nginx", image: "nginx:1.27" }] },
    },
  },
  status: {
    replicas: 3,
    readyReplicas: 3,
    availableReplicas: 3,
    updatedReplicas: 3,
    conditions: [{ type: "Available", status: "True" }],
  },
});
seed("deployments", {
  metadata: { name: "redis", namespace: "default", labels: { app: "redis" } },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: "redis" } },
    template: { metadata: { labels: { app: "redis" } }, spec: { containers: [{ name: "redis", image: "redis:7" }] } },
  },
  status: {
    replicas: 1,
    readyReplicas: 0,
    availableReplicas: 0,
    updatedReplicas: 1,
    conditions: [{ type: "Available", status: "False" }],
  },
});
seed("services", {
  metadata: { name: "nginx", namespace: "default", labels: { app: "nginx" } },
  spec: {
    type: "LoadBalancer",
    clusterIP: "10.43.0.50",
    selector: { app: "nginx" },
    ports: [{ name: "http", port: 80, protocol: "TCP", targetPort: 80, nodePort: 30080 }],
  },
  status: { loadBalancer: { ingress: [{ ip: "192.168.1.100" }] } },
});
seed("configmaps", {
  metadata: { name: "app-config", namespace: "default" },
  data: { "log.level": "info", "feature.x": "true" },
});
seed("secrets", {
  metadata: { name: "tls-cert", namespace: "default" },
  type: "kubernetes.io/tls",
  data: { "tls.crt": "LS0t", "tls.key": "LS0t" },
});
seed("serviceaccounts", { metadata: { name: "deployer", namespace: "default" } });
seed("horizontalpodautoscalers", {
  metadata: { name: "nginx", namespace: "default" },
  spec: {
    scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "nginx" },
    minReplicas: 1,
    maxReplicas: 5,
    targetCPUUtilizationPercentage: 80,
  },
  status: { currentReplicas: 3, desiredReplicas: 3, currentCPUUtilizationPercentage: 42 },
});
seed("poddisruptionbudgets", {
  metadata: { name: "nginx-pdb", namespace: "default" },
  spec: { minAvailable: 1, selector: { matchLabels: { app: "nginx" } } },
  status: { currentHealthy: 3, desiredHealthy: 1, expectedPods: 3, disruptionsAllowed: 2 },
});
seed("priorityclasses", {
  metadata: { name: "high-priority" },
  value: 1000000,
  globalDefault: false,
  description: "For critical pods",
});
seed("runtimeclasses", { metadata: { name: "gvisor" }, handler: "runsc" });
seed("leases", {
  metadata: { name: "kube-scheduler", namespace: "kube-system" },
  spec: { holderIdentity: "sim-control-plane", leaseDurationSeconds: 15, renewTime: now() },
});
seed("customresourcedefinitions", {
  metadata: { name: "widgets.example.com" },
  spec: {
    group: "example.com",
    scope: "Namespaced",
    names: { plural: "widgets", singular: "widget", kind: "Widget" },
    versions: [{ name: "v1", served: true, storage: true }],
  },
  status: { acceptedNames: { plural: "widgets", kind: "Widget" }, storedVersions: ["v1"] },
});
seed("customresourcedefinitions", {
  metadata: { name: "gadgets.example.com" },
  spec: {
    group: "example.com",
    scope: "Cluster",
    names: { plural: "gadgets", singular: "gadget", kind: "Gadget" },
    versions: [{ name: "v1alpha1", served: true, storage: true }],
  },
  status: { storedVersions: ["v1alpha1"] },
});
seed("mutatingwebhookconfigurations", {
  metadata: { name: "sim-mutating" },
  webhooks: [{ name: "mutate.example.com" }],
});
seed("validatingwebhookconfigurations", {
  metadata: { name: "sim-validating" },
  webhooks: [{ name: "validate.example.com" }],
});

const list = (resource, namespace) => {
  const items = [...bucket(resource).values()].filter(o => !namespace || o.metadata.namespace === namespace);
  const meta = kindByResource.get(resource);
  return {
    apiVersion: meta.apiVersion,
    kind: `${meta.kind}List`,
    metadata: { resourceVersion: String(version) },
    items,
  };
};

// Live watch fan-out: open watch streams register here; every mutation below
// broadcasts an ADDED/MODIFIED/DELETED line to matching watchers (like a real
// apiserver), so clients get live updates instead of only the initial snapshot.
const watchers = new Set();
function broadcast(resource, type, object) {
  const line = JSON.stringify({ type, object }) + "\n";
  for (const w of watchers) {
    if (w.resource !== resource) continue;
    if (w.namespace && object?.metadata?.namespace !== w.namespace) continue;
    try {
      w.res.write(line);
    } catch {
      /* client gone */
    }
  }
}

// --- http helpers ---------------------------------------------------------
const send = (res, status, body) => {
  const p = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(p) });
  res.end(p);
};
const status = (res, code, reason, message) =>
  send(res, code, { apiVersion: "v1", kind: "Status", status: "Failure", reason, message, code });
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
const apiResourceList = (gv, resources) => ({
  kind: "APIResourceList",
  apiVersion: "v1",
  groupVersion: gv,
  resources: resources.map(([name, kind, ns]) => ({
    name,
    singularName: "",
    namespaced: ns,
    kind,
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"],
  })),
});

function parsePath(pathname) {
  let m = /^\/api\/v1\/(?:namespaces\/([^/]+)\/)?([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(pathname);
  if (m) return { apiVersion: "v1", namespace: m[1], resource: m[2], name: m[3], subresource: m[4] };
  m = /^\/apis\/([^/]+)\/([^/]+)\/(?:namespaces\/([^/]+)\/)?([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(pathname);
  if (m) return { apiVersion: `${m[1]}/${m[2]}`, namespace: m[3], resource: m[4], name: m[5], subresource: m[6] };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${host}:${port}`),
      { pathname } = url;
    // auth (accept the configured bearer token; allow health/version unauthenticated)
    if (!["/healthz", "/livez", "/readyz", "/version"].includes(pathname)) {
      const supplied = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (token && supplied !== token) return status(res, 401, "Unauthorized", "invalid bearer token");
    }
    if (["/healthz", "/livez", "/readyz"].includes(pathname)) {
      res.writeHead(200);
      return res.end("ok\n");
    }
    if (pathname === "/version")
      return send(res, 200, { major: "1", minor: "36", gitVersion: "v1.36.0", platform: "linux/amd64" });
    if (pathname === "/api")
      return send(res, 200, {
        kind: "APIVersions",
        apiVersion: "v1",
        versions: ["v1"],
        serverAddressByClientCIDRs: [],
      });
    if (pathname === "/apis")
      return send(res, 200, {
        kind: "APIGroupList",
        apiVersion: "v1",
        groups: [...new Set([...Object.keys(groups), metricsGroupVersion].map(gv => gv.split("/")[0]))].map(name => {
          const gv = [...Object.keys(groups), metricsGroupVersion].find(g => g.startsWith(`${name}/`));
          return {
            name,
            versions: [{ groupVersion: gv, version: gv.split("/")[1] }],
            preferredVersion: { groupVersion: gv, version: gv.split("/")[1] },
          };
        }),
      });
    if (pathname === "/api/v1") return send(res, 200, apiResourceList("v1", coreResources));
    const disc = /^\/apis\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (disc && `${disc[1]}/${disc[2]}` === metricsGroupVersion)
      return send(
        res,
        200,
        apiResourceList(metricsGroupVersion, [
          ["pods", "PodMetrics", true],
          ["nodes", "NodeMetrics", false],
        ]),
      );
    if (disc && groups[`${disc[1]}/${disc[2]}`])
      return send(res, 200, apiResourceList(`${disc[1]}/${disc[2]}`, groups[`${disc[1]}/${disc[2]}`]));
    if (pathname === "/openapi/v2")
      return send(res, 200, { swagger: "2.0", info: { title: "sim", version: "v1.36.0" }, paths: {}, definitions: {} });

    const parsed = parsePath(pathname);

    // metrics.k8s.io aggregated API — synthesize PodMetrics/NodeMetrics from live objects.
    if (parsed && parsed.apiVersion === metricsGroupVersion) {
      if (parsed.resource === "pods") {
        const items = list("pods", parsed.namespace).items.map(pod => ({
          apiVersion: metricsGroupVersion,
          kind: "PodMetrics",
          metadata: {
            name: pod.metadata.name,
            namespace: pod.metadata.namespace,
            uid: pod.metadata.uid,
            creationTimestamp: pod.metadata.creationTimestamp,
            labels: pod.metadata.labels,
          },
          timestamp: now(),
          window: "30s",
          containers: (pod.spec?.containers || [{ name: "main" }]).map(c => ({
            name: c.name,
            usage: { cpu: "2m", memory: "24Mi" },
          })),
        }));
        return send(res, 200, {
          apiVersion: metricsGroupVersion,
          kind: "PodMetricsList",
          metadata: { resourceVersion: String(version) },
          items,
        });
      }
      if (parsed.resource === "nodes") {
        const items = list("nodes").items.map(node => ({
          apiVersion: metricsGroupVersion,
          kind: "NodeMetrics",
          metadata: { name: node.metadata.name, creationTimestamp: node.metadata.creationTimestamp },
          timestamp: now(),
          window: "30s",
          usage: { cpu: "180m", memory: "1200Mi" },
        }));
        return send(res, 200, {
          apiVersion: metricsGroupVersion,
          kind: "NodeMetricsList",
          metadata: { resourceVersion: String(version) },
          items,
        });
      }
    }

    if (!parsed || !kindByResource.has(parsed.resource))
      return send(res, 200, { apiVersion: "v1", kind: "List", metadata: {}, items: [] });
    const meta = kindByResource.get(parsed.resource);

    // access reviews
    if (req.method === "POST" && parsed.resource === "selfsubjectaccessreviews")
      return send(res, 201, {
        apiVersion: "authorization.k8s.io/v1",
        kind: "SelfSubjectAccessReview",
        status: { allowed: true },
      });
    if (req.method === "POST" && parsed.resource === "selfsubjectrulesreviews")
      return send(res, 201, {
        apiVersion: "authorization.k8s.io/v1",
        kind: "SelfSubjectRulesReview",
        status: {
          resourceRules: [{ verbs: ["*"], apiGroups: ["*"], resources: ["*"] }],
          nonResourceRules: [{ verbs: ["*"], nonResourceURLs: ["*"] }],
          incomplete: false,
        },
      });

    // pod logs
    if (req.method === "GET" && parsed.subresource === "log") {
      const body =
        ["2026-07-31T12:00:00Z sim log line 1", "2026-07-31T12:00:01Z ready", "2026-07-31T12:00:02Z serving"].join(
          "\n",
        ) + "\n";
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end(body);
    }

    // watch stream
    if (req.method === "GET" && (url.searchParams.get("watch") === "true" || url.searchParams.get("watch") === "1")) {
      res.writeHead(200, {
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        "cache-control": "no-store",
      });
      for (const item of list(parsed.resource, parsed.namespace).items)
        res.write(`${JSON.stringify({ type: "ADDED", object: item })}\n`);
      const watcher = { resource: parsed.resource, namespace: parsed.namespace, res };
      watchers.add(watcher);
      const beat = setInterval(() => res.write("\n"), 15_000);
      req.on("close", () => {
        clearInterval(beat);
        watchers.delete(watcher);
      });
      return;
    }

    const b = bucket(parsed.resource);
    if (req.method === "GET") {
      if (!parsed.name) return send(res, 200, list(parsed.resource, parsed.namespace));
      const found = b.get(keyOf(parsed.namespace, parsed.name));
      return found
        ? send(res, 200, found)
        : status(res, 404, "NotFound", `${parsed.resource} ${parsed.name} not found`);
    }
    if (req.method === "POST") {
      const obj = await readBody(req);
      obj.apiVersion ||= meta.apiVersion;
      obj.kind ||= meta.kind;
      obj.metadata = {
        ...obj.metadata,
        namespace: meta.namespaced ? obj.metadata?.namespace || parsed.namespace || "default" : undefined,
        uid: `${parsed.resource}-${obj.metadata?.name}-${++version}`,
        resourceVersion: String(version),
        creationTimestamp: now(),
      };
      if (parsed.resource === "namespaces") obj.status = { phase: "Active" };
      b.set(keyOf(obj.metadata.namespace, obj.metadata.name), obj);
      broadcast(parsed.resource, "ADDED", obj);
      return send(res, 201, obj);
    }
    if (req.method === "PUT" || req.method === "PATCH") {
      const key = keyOf(parsed.namespace, parsed.name),
        current = b.get(key) || { metadata: { name: parsed.name, namespace: parsed.namespace } };
      const patch = await readBody(req),
        merged = {
          ...current,
          ...patch,
          metadata: { ...current.metadata, ...patch.metadata, resourceVersion: String(++version) },
        };
      b.set(key, merged);
      broadcast(parsed.resource, "MODIFIED", merged);
      return send(res, 200, merged);
    }
    if (req.method === "DELETE") {
      const key = keyOf(parsed.namespace, parsed.name);
      if (!b.has(key)) return status(res, 404, "NotFound", `${parsed.resource} ${parsed.name} not found`);
      const removed = b.get(key);
      b.delete(key);
      broadcast(parsed.resource, "DELETED", removed);
      return send(res, 200, { ...removed, status: "Success" });
    }
    return status(res, 405, "MethodNotAllowed", `${req.method} not allowed`);
  } catch (error) {
    return status(res, 500, "InternalError", error?.message || String(error));
  }
});

// --- streaming subresources: exec / attach / portforward -------------------
// The PWA opens a WebSocket to the /api/kube-stream worker, which upgrades an
// upstream WebSocket to these paths speaking the channel.k8s.io framing:
// each binary frame is [channelByte, ...payload]. For exec, channel 1 is
// stdout, 2 stderr, 3 error (server->client); channel 0 is stdin, 4 resize
// (client->server). For port-forward, channel 0 carries data both ways.
//
// Verified by tests/e2e/streaming.test.mjs. The full browser path is only
// exercisable on a runtime with native binary WebSocket relaying (Cloudflare
// Workers' WebSocketPair); vinext's Node runtime stringifies binary frames, so
// the streaming test connects to these endpoints directly.
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: protocols => {
    for (const p of ["v5.channel.k8s.io", "v4.channel.k8s.io", "channel.k8s.io"]) if (protocols.has(p)) return p;
    return protocols.values().next().value || false;
  },
});
const frame = (channel, payload) =>
  Buffer.concat([Buffer.from([channel]), Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8")]);
function handleExec(ws, url) {
  const container = url.searchParams.get("container") || "main";
  const podName = decodeURIComponent(url.pathname.match(/\/pods\/([^/]+)\//)?.[1] || "sim");
  const prompt = "/ # ";
  ws.send(frame(1, `Simulated shell for ${podName} (${container})\n`));
  ws.send(frame(1, prompt));
  let line = "";
  ws.on("message", raw => {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (!buf.length) return;
    const channel = buf[0],
      text = buf.subarray(1).toString("utf8");
    if (channel !== 0) return; // 4 = resize, ignore
    ws.send(frame(1, text)); // tty echo
    line += text;
    if (/[\r\n]/.test(text)) {
      const cmd = line.replace(/[\r\n]+/g, "").trim();
      line = "";
      let out;
      if (cmd === "") out = "";
      else if (cmd === "whoami") out = "root\n";
      else if (cmd === "hostname") out = `${podName}\n`;
      else if (cmd === "pwd") out = "/\n";
      else if (cmd.startsWith("echo ")) out = `${cmd.slice(5)}\n`;
      else if (cmd === "exit") {
        ws.send(frame(1, "\n"));
        ws.close(1000, "exit");
        return;
      } else out = `sh: ${cmd}: not found\n`;
      ws.send(frame(1, `\n${out}${prompt}`));
    }
  });
}
function handlePortForward(ws) {
  // Echo whatever the client sends on the data channel, so a port-forward test
  // can round-trip bytes through the tunnel.
  ws.on("message", raw => {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (buf.length && buf[0] === 0) ws.send(frame(0, buf.subarray(1)));
  });
}
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${host}:${port}`);
  if (req.headers["authorization"] !== `Bearer ${token}`) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  const isExec = /\/(exec|attach)$/.test(url.pathname);
  const isPortForward = /\/portforward$/.test(url.pathname);
  if (!isExec && !isPortForward) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => (isExec ? handleExec(ws, url) : handlePortForward(ws)));
});

// Optionally write a kubeconfig pointing at the simulator so the E2E harness can
// derive a PWA profile the same way it does for k3d.
if (process.env.HEIMDALL_SIM_KUBECONFIG) {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const kubeconfig = `apiVersion: v1\nkind: Config\nclusters:\n- name: heimdall-sim\n  cluster:\n    server: http://${host}:${port}\ncontexts:\n- name: heimdall-sim\n  context:\n    cluster: heimdall-sim\n    user: heimdall-sim\ncurrent-context: heimdall-sim\nusers:\n- name: heimdall-sim\n  user:\n    token: ${token}\n`;
  mkdirSync(dirname(process.env.HEIMDALL_SIM_KUBECONFIG), { recursive: true });
  writeFileSync(process.env.HEIMDALL_SIM_KUBECONFIG, kubeconfig, "utf8");
}
server.listen(port, host, () => console.log(JSON.stringify({ ready: true, url: `http://${host}:${port}`, token })));

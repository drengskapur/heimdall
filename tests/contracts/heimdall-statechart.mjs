const grouped = (group, labels) => labels.map(label => ({ group, label }));
const slug = value => value.toLowerCase().replaceAll(" ", "-");

export const navigationStates = [
  { label: "Nodes" },
  ...grouped("Workloads", [
    "Overview",
    "Pods",
    "Deployments",
    "Daemon Sets",
    "Stateful Sets",
    "Replica Sets",
    "Replication Controllers",
    "Jobs",
    "Cron Jobs",
  ]),
  ...grouped("Config", [
    "ConfigMaps",
    "Secrets",
    "Resource Quotas",
    "Limit Ranges",
    "Horizontal Pod Autoscalers",
    "Vertical Pod Autoscalers",
    "Pod Disruption Budgets",
    "Pod Security Policies",
    "Priority Classes",
    "Leases",
    "Runtime Classes",
    "Mutating Webhook Configurations",
    "Validating Webhook Configurations",
    "Validating Admission Policies",
    "Validating Admission Policy Bindings",
  ]),
  ...grouped("Network", [
    "Services",
    "Ingresses",
    "Ingress Classes",
    "Network Policies",
    "Endpoints",
    "Endpoint Slices",
  ]),
  ...grouped("Storage", ["Persistent Volume Claims", "Persistent Volumes", "Storage Classes"]),
  { label: "Namespaces" },
  { label: "Events" },
  ...grouped("Helm", ["Charts", "Releases"]),
  ...grouped("Access Control", [
    "Roles",
    "Cluster Roles",
    "Role Bindings",
    "Cluster Role Bindings",
    "Service Accounts",
  ]),
  { group: "Custom Resources", label: "Custom Resource Definitions" },
].map(state => ({
  ...state,
  id: `ui.navigation.${slug([state.group, state.label].filter(Boolean).join("."))}`,
  testId: `link-for-sidebar-item-${
    state.group === "Workloads" && state.label === "Overview"
      ? "workloads-overview"
      : state.group === "Helm"
        ? `helm-${slug(state.label)}`
        : state.label === "Replication Controllers"
          ? "replication-controller"
          : slug(state.label)
  }`,
  groupTestId: state.group
    ? `link-for-sidebar-item-${state.group === "Access Control" ? "user-management" : slug(state.group)}`
    : undefined,
  oracle: {
    activeClass: "active",
    mainVisible: true,
    headingMounted: true,
    controlsIdentified: true,
    runtimeErrors: [],
  },
}));

export const preferenceStates = ["App", "Proxy", "Kubernetes", "Editor", "Terminal", "Extensions"].map(label => ({
  id: `ui.preferences.${slug(label)}`,
  label,
  route: `/preferences/${slug(label)}`,
  oracle: { dialog: "Preferences", activeClass: "active", title: label, controlsIdentified: true, runtimeErrors: [] },
}));

export const overlayStates = [
  ["namespace-menu-open", "namespace menu", "tests/visual/hidden-states.spec.ts"],
  ["search-tooltip", "search tooltip", "tests/visual/hidden-states.spec.ts"],
  ["pod-row-menu-open", "pod row menu", "tests/visual/hidden-states.spec.ts"],
  ["pod-details-open", "pod details drawer", "tests/visual/hidden-states.spec.ts"],
  ["dock-new-tab-menu-open", "dock new tab menu", "tests/visual/hidden-states.spec.ts"],
  ["dock-open", "open dock", "tests/visual/hidden-states.spec.ts"],
  ["sidebar-cluster-menu-open", "sidebar cluster menu", "tests/visual/hidden-states.spec.ts"],
  ["create-resource-dialog-open", "create resource dialog", "tests/visual/hidden-states.spec.ts"],
  ["preferences-dialog-open", "preferences dialog", "tests/visual/hidden-states.spec.ts"],
  ["connect-dialog-open", "connect dialog", "tests/visual/hidden-states.spec.ts"],
  ["shadow-root-mounted", "open and closed shadow roots", "tests/visual/hidden-states.spec.ts"],
].map(([name, label, testRef]) => ({
  id: `ui.overlay.${name}`,
  label,
  base: "ui.navigation.workloads.pods",
  testRef,
  oracle: {
    mounted: true,
    visible: name !== "shadow-root-mounted",
    topLayerCaptured: true,
    shadowRootsCaptured: true,
    runtimeErrors: [],
  },
}));

export const backendContractStates = [
  {
    id: "backend.worker.router-ready",
    request: {
      path: "/api/router-contract/demo?source=statechart",
      method: "POST",
      headers: { "x-kube-server": "cluster-state" },
      data: { ready: true },
    },
    response: { status: 200, json: { name: "demo", payload: { ready: true }, query: { source: "statechart" } } },
  },
  {
    id: "backend.worker.no-content",
    request: { path: "/api/router-contract/no-content", method: "DELETE" },
    response: { status: 204 },
  },
  {
    id: "backend.worker.validated-ready",
    request: {
      path: "/api/router-contract/validated",
      method: "POST",
      headers: { "x-kube-server": "cluster-state" },
      data: { value: "ready" },
    },
    response: { status: 200, json: { value: "ready" } },
  },
  {
    id: "backend.kube.method-rejected",
    request: { path: "/api/kube", method: "GET" },
    response: { status: 405, text: "Method not allowed" },
  },
  {
    id: "backend.kube.cluster-missing",
    request: { path: "/api/kube", method: "POST", data: { path: "/version" } },
    response: { status: 400, text: "Missing cluster server or authorization" },
  },
  {
    id: "backend.kube.server-invalid",
    request: {
      path: "/api/kube",
      method: "POST",
      headers: { "x-kube-server": "not-a-url", authorization: "Bearer state" },
      data: { path: "/version" },
    },
    response: { status: 400, text: "Invalid cluster server" },
  },
  {
    id: "backend.kube.insecure-rejected",
    request: {
      path: "/api/kube",
      method: "POST",
      headers: { "x-kube-server": "http://cluster.example", authorization: "Bearer state" },
      data: { path: "/version" },
    },
    response: { status: 400, text: "Cluster API must use HTTPS" },
  },
  {
    id: "backend.kube.path-rejected",
    request: {
      path: "/api/kube",
      method: "POST",
      headers: { "x-kube-server": "https://cluster.example", authorization: "Bearer state" },
      data: { path: "/admin" },
    },
    response: { status: 400, text: "Invalid Kubernetes API path" },
  },
];

const uiStates = [
  { id: "ui.booting", oracle: { iframeVisible: false, ariaBusy: true } },
  { id: "ui.ready", oracle: { iframeVisible: true, ariaBusy: false, fouc: false } },
  ...navigationStates,
  ...preferenceStates,
  ...overlayStates,
];
const backendStates = [
  { id: "backend.booting", oracle: { acceptsRequests: false } },
  { id: "backend.ready", oracle: { acceptsRequests: true } },
  ...backendContractStates.map(state => ({ id: state.id, oracle: state.response })),
];

export const heimdallStatechart = {
  id: "heimdall-full-stack",
  type: "parallel",
  regions: {
    ui: {
      initial: "ui.booting",
      states: uiStates,
      transitions: [
        { from: "ui.booting", event: "PORTAL_STYLES_AND_FONTS_READY", to: "ui.ready" },
        ...navigationStates.map(state => ({ from: "ui.ready", event: `NAVIGATE:${state.label}`, to: state.id })),
        ...preferenceStates.map(state => ({
          from: "ui.ready",
          event: `OPEN_PREFERENCES:${state.label}`,
          to: state.id,
        })),
        ...overlayStates.map(state => ({ from: state.base, event: `OPEN:${state.label}`, to: state.id })),
        ...overlayStates.map(state => ({ from: state.id, event: "CLOSE", to: state.base })),
      ],
    },
    backend: {
      initial: "backend.booting",
      states: backendStates,
      transitions: [
        { from: "backend.booting", event: "WORKER_READY", to: "backend.ready" },
        ...backendContractStates.map(state => ({ from: "backend.ready", event: `REQUEST:${state.id}`, to: state.id })),
        ...backendContractStates.map(state => ({ from: state.id, event: "REQUEST_SETTLED", to: "backend.ready" })),
      ],
    },
  },
};

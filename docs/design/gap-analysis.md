# Heimdall vs Lens — functionality gap analysis

> Source-grounded audit of what the real Lens/Freelens does that the greenfield
> Heimdall UI does **not** yet. Grounded in `Open-Lens/lens` (`packages/core/src`).
> Pairs with [`surface-manifest.md`](./surface-manifest.md) (the surface inventory).
>
> **Where Heimdall is today:** read-only resource **lists** for ~28 kinds (one `HTMLTable`
> + a descriptor registry) · a **list toolbar** (search + namespace filter) · a **generic
> detail drawer** (echoes the table columns as key/value) · a row ⋮ menu with **View /
> Delete-with-confirm** · Hotbar + resource-tree Sidebar + Header + Catalog stub + theme.
> It talks to a **bearer-token simulator** with **one-shot fetch** (no live updates).
>
> **The single biggest architectural fact:** Lens is Electron — its exec / log-follow /
> port-forward all **shell out to local `kubectl` / `node-pty`** in a Node main process, and
> all real auth is terminated by an external **`lens-k8s-proxy` (client-go) binary per
> cluster**. Heimdall is a browser SPA, so these must be re-expressed as real Kubernetes
> streaming protocols proxied through **the companion**. That divergence (not "add a
> component") is the through-line of the hardest gaps.
>
> **The good news:** the hexagon *already* has ports for much of this — `watch()`,
> `readLogs`/`streamLogs`, `exec`, `portForward`, `scaleWorkload`, `restartWorkload`,
> `setWorkloadSuspended`, `setNodeSchedulable`, `apply`/`remove`, and a Helm gateway. Many
> gaps are **"surface an existing port in the new UI,"** not new backend.

## Progress (this branch)

Since the initial audit, the following gaps are **closed** (verified against the simulator):
- ✅ **0.2 Live updates** — `useResource` watches each collection (`gateway.watch`) and
  debounce-reloads on ADDED/MODIFIED/DELETED (required an api-server streaming fix +
  a sim watch fan-out). Deleting a pod on the sim updates the UI with no interaction.
- ✅ **0.3 Notifications** — Blueprint `OverlayToaster` + typed `notify.{success,info,error}`,
  wired to every action.
- ✅ **1.2 YAML view + edit** — tabbed detail drawer with an editable YAML manifest; Save
  applies via `ResourceUseCases.apply` (verified: editing a pod's image persists on the sim).
- ✅ **1.3 Create resource** — a "New" button opens a YAML template dialog; Create applies
  via `ResourceUseCases.apply` (verified: creating a Pod adds it to the sim + live list).
- ✅ **1.7 Resource actions** — Restart (Deploy/DS/STS), Suspend/Resume (CronJob),
  Cordon/Uncordon (Node), and **Scale** (Deploy/STS/RS/RC via a replica dialog), each
  confirm-gated with success/error toasts. Verified end-to-end on the sim.
- ✅ **1.9 Bulk select + delete** — checkbox column + select-all + a "Delete (N)" bulk
  action (verified: deleting 2 selected pods removes both).
- ✅ **1.11 Command palette** — ⌘/Ctrl-K Omnibar to fuzzy-jump to any resource view.

Newly closed (verified against the **real docker-desktop cluster**, k8s v1.36.1):
- ✅ **0.1 Real-cluster connection** — the Hotbar is now driven by real
  `ClusterProfile`s discovered from the local kubeconfig via the companion's
  `/v1/kubeconfigs/scan` ("Add cluster → Connect from kubeconfig"); selecting a
  tile `setActive`s the profile so the hexagon talks to it (client-cert/mTLS).
  A real "Delete cluster" removes a profile. Verified: docker-desktop → 9 real
  kube-system pods. (Fixed two companion transport bugs found doing this:
  pod-logs 406 on `Accept: text/plain`, and a crash on aborted proxy streams.)
- ✅ **1.4 Rich per-resource detail** — the Details tab fetches the raw manifest
  and renders `MetaSection` + per-kind `DETAIL_SECTIONS` (Pod/Deployment/Node/
  Service/ConfigMap/Secret/Ingress/PVC); plus an embedded **Events** tab.
- ✅ **1.5 Pod logs** — a Logs tab in the pod drawer (container selector, follow,
  refresh) over `pods.streamLogs`. Verified: real coredns logs stream.
- ✅ **2.3 Custom Resources** — a CRD row in Definitions opens a full-page
  instance browser (storage-version instances + `additionalPrinterColumns`).
- ✅ **2.1 Metrics** — `ClusterUsage` gauges + **live time-series sparklines**
  (5s poll) + per-pod/node **CPU/Mem columns** (kubectl-top), plus **HPA
  metric-parser** (list Targets + detail Metrics/Conditions) and a **Prometheus
  provider** (auto-detect + PromQL via the apiserver service proxy + overview
  badge). Verified with metrics-server + a real HPA + Prometheus on docker-desktop.
- ✅ **2.2 Helm** — **Releases** (decoded from their secrets; rollback dialog)
  and **Charts** (repo index fetched via the companion HTTP proxy; search/detail;
  install disabled pending a helm binary). Verified against the Jetstack repo.
- ✅ **2.4 Catalog/cluster-mgmt** — kubeconfig-scan connect + **paste kubeconfig**
  + delete + **per-cluster Settings** (name/namespace/proxy/skip-TLS/node-shell).
- ✅ **2.5 Preferences** — Cluster-proxy (companion URL/token/proxy/untrusted) +
  **Appearance** (System/Light/Dark, live) + **Terminal** (kubectl path/shell).

Closed since (verified end-to-end against docker-desktop):
- ✅ **0.4 API discovery gating** — on connect the shell discovers the cluster's
  served resources (`gateway.discoverResources` → /api + /apis) and the sidebar
  hides leaves whose kind the cluster doesn't expose (group-level match, so
  version drift like HPA autoscaling/v1↔v2 still matches); empty groups collapse.
  Unit-tested. **RBAC (`canI`) gating still open** — availability only for now.
- ✅ **1.6 Terminal / exec** — an xterm **Shell** tab in the pod drawer over
  `gateway.exec` (container selector, fit-to-pane). Verified: `echo` runs in a
  real kindnet container; shell-less images return a clean OCI error.
- ✅ **1.8 Port-forward** — a **Forward** tab (enter a container port → local
  port via the companion) + a real **Port Forwarding** page listing active
  forwards (open / stop). Verified: forwarding the apiserver pod's :6443 gives a
  working tunnel (`GET localhost:<port>/healthz` → 200 "ok").

The pod drawer now carries **Details · Logs · Shell · Forward · YAML · Events**
plus row delete/actions — capability parity with Lens's pod interactions.

Also since closed: ✅ **1.1 Dock** (resizable bottom panel, concurrent logs/
shell/forward tabs across pods) · ✅ **0.4 RBAC gating** (SelfSubjectRulesReview,
conservative) · ✅ **1.8 Port-forward** (pod Forward tab + Port Forwarding page).

**What genuinely remains (reconsidered against the full Lens control inventory):**
- **Helm install/upgrade/rollback *execution*** — the UI is wired, but running
  them needs a `helm` binary in the companion (browsing + release listing work).
- **3.1 Extension system** (XL, orthogonal) — the largest remaining subsystem,
  deliberately deferred; it gates no core workflow.
- **Minor**: web-link catalog entities, port-forward from *service* port cells,
  add-cluster "sync folder/file", terminal attach mode. Cosmetic/low-frequency.

Every Lens sidebar section is now a real feature; the shipped surface is at
practical parity with OpenLens core for day-to-day cluster operations.

Still open below.

## Prioritized roadmap

Sizes: **S** ≤ a day · **M** a few days · **L** 1–2+ weeks · **XL** a major subsystem.

### Tier 0 — Foundational (unblocks real use)
| # | Gap | Size | Note |
|---|---|---|---|
| 0.1 | **Real-cluster connection via the companion** (client-cert/mTLS + exec-credential plugins + proxy), the browser analog of `lens-k8s-proxy` | **L** | Today only the bearer sim works; docker-desktop is client-cert. Ties to todo #25. |
| 0.2 | **Live updates** — a watch store: list→subscribe→ADDED/MODIFIED/DELETED merge by uid, resourceVersion tracking, 410-relist, reconnect; per-view subscribe/unsubscribe | **L** | Lists are one-shot now. **Porting hazard:** Lens reads the watch as a Node stream (`byline`); the browser needs `ReadableStream.getReader()` + NDJSON decode. Hexagon has `watch()`. |
| 0.3 | **Notifications / toaster** (`ok`/`error`/`info`, hover-pause, typed `show*` helpers) | **S** | Cheap; unblocks feedback for *every* action below. |
| 0.4 | **API discovery + capability gating** — discover API groups/CRDs per cluster; gate the sidebar on availability + RBAC (`canI`) | **M** | So the tree reflects the *real* cluster, not a static list. |

### Tier 1 — Core IDE workflows
| # | Gap | Size | Note |
|---|---|---|---|
| 1.1 | **Dock** (bottom panel: tab kinds, lifecycle, resize, persistence) | **L** | Prerequisite for logs/terminal/edit/create tabs. |
| 1.2 | **YAML view + edit** (Monaco) — fetch object, edit, **RFC-6902 patch** on save; wired to a per-object **Edit** menu item | **L** | Monaco is already a dep (add-cluster only). The biggest single capability. Hexagon has `apply`. |
| 1.3 | **Create resource** (Monaco YAML + templates → apply) | **M** | |
| 1.4 | **Rich per-resource detail** — the registration/order model (`KubeObjectMeta` @0, per-kind @10, **embedded events @∞**) + ~10–15 per-kind sections (Pod incl. per-container status/env/mounts/probes; Deployment/DS/STS/RS; Node capacity/allocatable; Service+endpoints; ConfigMap; Secret w/ reveal; PVC; Ingress; Namespace) | **L** | Currently a generic column-echo — **the largest UI gap**. ~40 detail components in Lens. |
| 1.5 | **Pod logs viewer** (dock tab: follow, timestamps, previous-container, search w/ match count, download visible/all, pod+container selector) | **L** | Hexagon has `streamLogs` (one-shot today). Highest-frequency read beyond lists. |
| 1.6 | **Terminal / exec + attach** (xterm dock tab over `channel.k8s.io` WS through the companion) | **L** | Lens uses local `node-pty`+`kubectl`; a browser must speak the real exec subprotocol via companion. Hexagon has `exec`. |
| 1.7 | **Resource actions**: scale (Deploy/STS/RS), restart rollout (Deploy/DS/STS), CronJob trigger + suspend/resume, node cordon/drain/node-shell | **M** | Hexagon has `scaleWorkload`/`restartWorkload`/`setWorkloadSuspended`/`setNodeSchedulable`. Needs a generic confirm dialog + toasts (0.3). |
| 1.8 | **Port-forward** (from pod/service port cells + an active-forwards panel) | **M** | Hexagon has `portForward`; via companion. |
| 1.9 | **Bulk select + bulk delete** (row checkboxes + batched confirm) | **M** | |
| 1.10 | **Namespace global filter** (cluster-frame-wide selected-namespace scope feeding all lists) + real filter chips | **S/M** | Our namespace filter is per-view + client-side only. |
| 1.11 | **Command palette / Omnibar** (Ctrl/⌘-P, command registry) | **M** | |

### Tier 2 — Major subsystems
| # | Gap | Size | Note |
|---|---|---|---|
| 2.1 | **Metrics & charts** — Chart.js wrapper (line/bar/pie + live update) · Prometheus provider auto-detect (helm/helm-14/lens/operator/stacklight) + query_range layer · per-resource detail graphs (12 surfaces) · cluster-overview time-series + CPU/Mem/Pods gauges · metrics settings | **L** | Whole subsystem absent. Core user value. |
| 2.2 | **Helm** — charts browser (repo search, README/versions/values, install `MultistepDialog`) · releases (list/details/history, upgrade, rollback, uninstall) · repo management · `helm` exec backend | **L** | Hexagon has a Helm **gateway port** with no UI behind it — defined seam. |
| 2.3 | **Custom Resources** — CRD discovery + dynamic per-CRD stores, **additionalPrinterColumns** (JSONPath) list + detail, dynamic sidebar groups per CRD group | **L** | Our "Definitions" lists CRDs but there's no CR-instance browsing. |
| 2.4 | **Catalog + cluster management** — catalog table + entity types (KubernetesCluster/WebLink/General), entity-detail drawer · **add-cluster** (kubeconfig paste/sync + validation) · **cluster settings** (name/icon/metrics/prometheus/proxy/namespaces/node-shell/terminal/kubeconfig) · delete-cluster (local-kubeconfig guards) · **hotbar persistence** (our hotbar is in-memory) | **L** | Catalog is a placeholder; hotbar state doesn't persist. |
| 2.5 | **Preferences** (app / kubernetes / editor / proxy / terminal / extensions tabs) | **M** | |
| 2.6 | **Top-bar back/forward + app-update; status-bar item registry** | **S** | Shell chrome. |

### Tier 3 — Platform
| # | Gap | Size | Note |
|---|---|---|---|
| 3.1 | **Extension API** — base classes + ~22 renderer registration categories (pages, sidebar items, kube-object detail/menu/status items, catalog items, status/top-bar items, commands, app-prefs, entity settings, cluster-frame components) + 2 main (app/tray menus) · public API barrels · discovery/loader/install lifecycle · extensions management page | **XL** | Large, mostly orthogonal; gates no core workflow — defer until charts + Helm land. |

## Suggested sequence

1. **0.3 toasts** → **0.2 watch store** (live lists) → **0.4 discovery/gating**. Now lists are live and real.
2. **0.1 companion real-cluster connect** → docker-desktop / any kubeconfig works (not just the sim).
3. **1.1 dock** → **1.2 YAML edit** + **1.7 actions** (with confirm+toasts) → **1.5 logs** → **1.6 terminal** / **1.8 port-forward**. Now it's an operational tool.
4. **1.4 rich detail** (incremental, per-kind) alongside the above.
5. **2.1 metrics**, **2.2 Helm**, **2.3 CRDs**, **2.4 catalog/cluster-mgmt**, **2.5 preferences** — independent tracks.
6. **3.1 extensions** last.

## Reference: representative Lens source

- Actions/menu: `renderer/components/kube-object-menu/kube-object-menu.tsx`; per-kind menus under `workloads-*/‹kind›-menu.tsx`.
- Dock/edit/logs/terminal: `renderer/components/dock/{dock.tsx,edit-resource,create-resource,logs,terminal}`.
- Watch store: `common/k8s-api/kube-object.store.ts`, `common/k8s-api/kube-api.ts` (`watch()`), `renderer/kube-watch-api/`.
- Transport/auth: `main/lens-proxy/lens-proxy.ts`, `main/kube-auth-proxy/`, `main/cluster/cluster-connection.injectable.ts`, `common/cluster/cluster.ts`.
- Detail: `renderer/components/kube-object-details/`, `kube-object-meta/`, `workloads-pods/pod-details.tsx`.
- Metrics: `renderer/components/{chart,resource-metrics,cluster/cluster-metrics.tsx}`, `main/prometheus/`, `common/k8s-api/endpoints/metrics.api/`.
- Helm: `renderer/components/{helm-charts,helm-releases}`, `main/helm/`.
- CRDs: `renderer/components/custom-resources/`.
- Catalog/cluster-mgmt: `renderer/components/{catalog,add-cluster,cluster-settings,entity-settings,delete-cluster-dialog}`, `common/catalog-entities/`.
- Overlays/shell: `renderer/components/{command-palette,notifications,namespaces/namespace-select-filter.tsx}`, `features/preferences/`, `layout/top-bar/`, `status-bar/`.
- Extensions: `extensions/{lens-renderer-extension.ts,lens-main-extension.ts,extension-discovery,extension-loader}`, `packages/extension-api/`.

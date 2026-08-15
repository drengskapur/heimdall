# Heimdall ↔ Freelens surface re-audit (ground-truth)

Every entry is derived from the Freelens open-source renderer
(`freelensapp/freelens`, `packages/core/src/renderer/components/...`), never
invention. It was originally cross-checked against captured DOM contracts as
well; those captures and the harness that produced them are gone, so the
renderer source is now the single reference.

Status: ✅ faithful · ⚠️ partial · ❌ missing/invented.

---

## 1. Top bar — `layout/top-bar/top-bar.tsx` ✅
Structure: `[winMenu(☰) · home · back · forward · «flex» · window-buttons]`, 40px.
- Hamburger = **application menu**: `winMenu` → `emitOpenAppMenuAsContextMenu`
  (File/Edit/View/Help → Add Cluster, Preferences, Catalog, Back, Forward,
  Command Palette…, Reload, Extensions, Documentation, Support, Licenses).
- home / back / forward = `navigation-to-home|back|forward` items.
- window-buttons = Electron-only (N/A for PWA).
Heimdall: menu·home·back·forward + app-menu items (Command palette, Catalog,
Preferences, Reload, Documentation, About). ✅

## 2. Hotbar — `hotbar/*` (DOM `HotbarMenu`, 75px) ⚠️
- Cells (40px): welcome-entity (home + settings badge), catalog-entity
  (view_list + settings badge), then per-cluster cells; drag-orderable.
- `HotbarSelector` pager at bottom: ◀ index-badge ▶.
Heimdall: 56px rail, cluster cells + `+`; **missing** gear/settings badges,
welcome/catalog entities, pager. ⚠️

## 3. Sidebar — `layout/sidebar.tsx`, `sidebar-cluster.tsx`, `sidebar-item.tsx` ⚠️
- `SidebarCluster` (61px): avatar + name + `arrow_drop_down` (cluster actions). ✅
- `SidebarItem`: `NavLink`, `isActive`, expandable (`children` → `subMenu`,
  `expandIcon`), and a **favorite/pin toggle** (`toggleFavorite`, `pinIcon`).
- **Favorites** item (star) at top. ❌ in Heimdall.
- `ResizingAnchor` — drag to resize the sidebar. ❌ in Heimdall.
Heimdall: cluster header ✅, nav items + expand ✅; **missing** Favorites,
per-item pin, resize. ⚠️

## 4. Group tabs — `layout/tab-layout.tsx` + `tabs/tabs.tsx` ✅
`TabLayout > Tabs.center` (34px), `Tab.active` = `layoutTabsActiveColor` text +
3px `--primary` underline. Heimdall: idiomatic Blueprint `<Tabs animate>`,
centered. ✅

## 5. Resource list — `item-object-list/*`, per-kind `*.tsx` ⚠️/❌
- Toolbar: title (h5) + "N items" info-panel + `NamespaceSelect` (multi) +
  `SearchInput` + hide-details toggle. Heimdall: count + namespace filter +
  search + New. ⚠️ (details toggle differs; New only on creatable kinds).
- `TableHead`: checkbox + per-column `TableCell` with **sort `arrow_drop_down`**
  and a **`resize-handle`**. Heimdall: sortable on header click, **no** resize
  handles / sort-arrow affordance. ⚠️
- **Per-kind columns** (from each `*.tsx` `renderTableHeader`). Example —
  Deployments (`workloads-deployments/deployments.tsx`): Name · Namespace ·
  Replicas(hidden) · **Ready · Desired · Updated · Available** · Age ·
  **Conditions**. Heimdall workload factory shows Name · Namespace · **Pods** ·
  Age · **Status** for every workload. ❌ columns differ per kind — each kind
  needs its own column set.

## 6. Detail drawer — `kube-object-details.tsx` + per-kind `*-details.tsx` ✅
- Shared **MetaSection** now matches `KubeObjectMeta`: Created (+age), Name,
  Namespace, UID, Resource Version, Labels, Annotations, Finalizers, Deleted,
  Controlled By.
- Per-kind sections for **~35 kinds** (fields taken from each `*-details.tsx`):
  Pod (status + scheduler/SA/priority/runtime/grace/node-selector, container
  requests/limits), Deployment, DaemonSet, StatefulSet, ReplicaSet,
  ReplicationController, Job, CronJob, Node, Service (affinity/cluster-IPs/
  external-IPs/families/traffic-policy), Endpoints, Ingress, IngressClass,
  NetworkPolicy, ConfigMap, Secret, ResourceQuota, LimitRange, HPA,
  PriorityClass, RuntimeClass, Lease, Mutating/Validating WebhookConfiguration,
  PVC, PV, StorageClass, ServiceAccount, Role/ClusterRole,
  RoleBinding/ClusterRoleBinding, Namespace, Event, CRD.
- Still generic (acceptable): related-resource cross-links (e.g. a Deployment's
  ReplicaSets/Pods) and inline metric charts — larger features, not per-kind text.

## 7. Dock — `dock/*` ⚠️
- Persistent bar; default **Terminal** tab is **pinned** (uncloseable). Heimdall:
  persistent bar ✅, default Terminal ✅ but **not pinned** (closable). ⚠️
- `+` = create menu (**Terminal**, **Create resource**, …), not just new
  terminal. ❌
- Tab kinds: terminal, create-resource, edit-resource, install-chart,
  upgrade-chart, pod-logs. Heimdall: logs/shell/forward/edit + terminal;
  **no** create-resource / install-chart / upgrade-chart dock tabs. ⚠️
- **Fullscreen** toggle + resize. Heimdall: resize ✅, **no fullscreen**. ⚠️
- Keyboard: Shift+Esc close, Ctrl/Cmd+W close tab, Ctrl+./, switch. ❌
- Tabs renamable (double-click). ❌
- Terminal: shell over the cluster kubeconfig (+ node-shell mode). Heimdall:
  companion local shell w/ `KUBECONFIG`. ✅ (no node-shell mode).

## 8. Status bar — `status-bar/status-bar.tsx` ✅/➖
`leftSide` / `rightSide` host registered `StatusBarItems` (extensions populate).
Empty by default. Heimdall: present, empty. ✅ (nothing to add without extensions).

---

## Backlog — status (all resolved, verified against the in-memory simulator)
1. ✅ **Per-kind table columns** — Deployment/DaemonSet/StatefulSet/ReplicaSet/
   ReplicationController/Job/CronJob each render their exact Freelens columns.
2. ✅ **Dock** — default Terminal pinned; `+` create menu (Terminal / Create
   resource); Create-resource YAML tab; fullscreen; Shift+Esc / Ctrl+W / Ctrl+.,
   shortcuts.
3. ✅ **Sidebar** — drag-to-resize (trailing edge); Favorites section + per-item
   star pins, persisted.
4. ✅ **Table** — resizable columns (drag handle per header, persisted); sortable
   headers already showed a sort caret.
5. ✅ **Hotbar** — cluster tiles already carry a gear badge, connection LED,
   context menu (remove/delete), drag-reorder, and a hotbar pager.
6. ✅ **Per-kind detail bodies** — Pod/Deployment/Node/Service/ConfigMap/Secret/
   Ingress/PVC/HPA already bespoke; added DaemonSet/StatefulSet/ReplicaSet/Job/
   CronJob.
7. ✅ **Connection lifecycle** — reachability probe → ClusterStatus screen
   (Connecting / Can't connect + Reconnect + Catalog), matching cluster-status.tsx.

Deferred as cosmetic-only: exact hotbar width (56 vs 75px) and the two special
welcome/catalog hotbar entities (a PWA has one Catalog button instead).

---

## Parity completion pass (ground-truth audit → fixes)

A three-surface audit against the cloned Freelens source drove these:

**Metrics / charts** (from `technical-features/prometheus/helm-provider`)
- Range-query client + tabbed time-series chart (CPU/Memory/Network/Filesystem).
- Wired into Pod / Node / PVC drawers and the cluster overview (time-series +
  CPU/Memory/Pods Usage·Requests·Limits·Capacity breakdown, metrics-server fallback).

**Detail drawers** — 725px width (was 360). Header toolbar (Edit→YAML, Refresh,
Scale/Delete). Related-resource sections (Deployment→ReplicaSets/Pods, Node→Pods,
Service→Endpoints, workloads→Pods, PVC→Pods). Full ConfigMap data; Pod
Tolerations/Volumes; Ingress TLS/LB/class/default-backend.

**Lists** — column-visibility ⋮ menu + `defaultHidden`; Pods warning/Controlled-By
+ node/ip/qos (hidden); Services External-IP/Status; Nodes Internal-IP/Conditions
(hidden); Ingress LoadBalancers/Rules; Events Source/Last-Seen + newest-first;
Namespace Labels; ConfigMap/Secret key names; live age tick; clickable namespace
cells; removable filter chips; Force-Delete (gracePeriodSeconds 0).

**Shell** — cluster-wide namespace filter (shared store); cluster Issues table;
hotbar cog→settings + dead pager hidden; top-bar Fullscreen + PWA
window-controls-overlay; Preferences dialog mounted (was a no-op).

**Helm** — release details drawer (Values/Resources/Notes/History) + Upgrade.

**Follow-up (previously deferred, now done)** — dock tab rename (double-click);
PV NFS/CSI/HostPath/Local/FlexVolume source; **cross-object navigable links**
(Controlled By / Node / related rows open the target object's drawer via a
kind→page resolver + queued selection); **ManagedFields** (field managers listed
in Metadata); **ServiceAccount token/secret discovery** (annotated token Secrets +
referenced secrets/imagePullSecrets, as links).

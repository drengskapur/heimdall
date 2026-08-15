# Heimdall surface manifest

> The authoritative inventory of **every surface** the greenfield Heimdall UI must
> provide for feature parity with Lens/Freelens, grounded in the real
> [`Open-Lens/lens`](https://github.com/Open-Lens/lens) source. Pairs with
> [`legacy-blueprint-parity.md`](./legacy-blueprint-parity.md) (the component→Blueprint
> mapping) and [`chrome-spec.md`](./chrome-spec.md) (the shell's design system).
>
> Legend: ✅ built · 🟡 partial · ⬜ not started. Paths are under `packages/core/src` in the Lens repo.

## 0. Architecture: two frames → one keep-alive tree

Lens splits into a **root frame** (`renderer/components/cluster-manager/cluster-manager.tsx`)
that owns the cluster-independent chrome — **TopBar + Hotbar + StatusBar** — and a
**cached `<iframe>` per connected cluster** (`cluster-frame-handler.ts`) whose inner React
app mounts **Sidebar + Dock + cluster pages**. One route registry is partitioned by a
`clusterFrame:boolean` flag (`common/front-end-routing/front-end-route-injection-token.ts`).
Cluster frames are **created once and hidden (not unmounted)** on switch, so terminals,
scroll, and watches survive.

**How Heimdall adapts it (single-tree PWA):** we don't use iframes. Instead:
- Header · Hotbar · Statusbar are shell-level chrome, rendered once, outside the cluster view. ✅
- The cluster view (Sidebar + Outlet) mounts only when a cluster is active; Catalog replaces it otherwise. ✅
- **Keep-alive is a real requirement:** per-cluster view state (open dock tabs, terminals, scroll, in-flight watches) must be preserved across cluster switches — deliberately, since we lose the iframe isolation that gave it for free. ⬜ (state currently resets on switch)
- Routing must keep a **global vs cluster** partition + reactive `isEnabled`/`isVisible` per entry. 🟡 (state-based today; no URL router yet)

## 1. Shell regions

| Region | Lens source | Heimdall | Notes |
| --- | --- | --- | --- |
| **Hotbar** (far-left rail) | `components/hotbar/*`, `features/hotbar/**` | ✅ | see §2 |
| **TopBar** | `components/layout/top-bar/*`, `top-bar-items/*` | 🟡 Header | ordered **injection registry** (order 10/20/30/40/50…900), `isShown` computeds; real items: context-menu (Win/Linux), home, back, forward, **update-app button**, window-controls (Win/Linux). No sidebar-toggle exists. OS drag-region + mac traffic-light padding. Ours is a Blueprint `Navbar` (brand + cluster + search + theme + cog + bell). |
| **Sidebar** (resource nav) | `components/layout/sidebar.tsx`, `sidebar-items.injectable.ts` | ✅ | see §3 |
| **Outlet** (page content) | route components in cluster frame | 🟡 | placeholder; real pages = resource lists (§5) |
| **In-page sub-tabs** | `layout/tab-layout.tsx`, `SiblingsInTabLayout` | ⬜ | grouped-resource tab strip (e.g. Workloads overview tabs) via `clusterPageMenus` siblings + default redirect |
| **Dock** (bottom panel) | `components/dock/*` | ⬜ | see §7 |
| **StatusBar** | `components/status-bar/*` | 🟡 | **empty in core — 100% extension-populated**; left/right split, right side reverse-ordered, bar-wide status color. Ours shows cluster + tagline. |

## 2. Hotbar (favorites rail) — spec

Source: `components/hotbar/{hotbar-menu,hotbar-cell,hotbar-icon,hotbar-entity-icon,hotbar-selector}.tsx`,
`features/hotbar/storage/common/{hotbar,types,state}.ts`.

| Aspect | Behavior | Heimdall |
| --- | --- | --- |
| Cells | **exactly 12 sparse slots** (`defaultHotbarCells=12`); `null` = empty (valid drop target); remove leaves a hole (no compaction); add → first free slot, else "too many items" toast | ✅ ([clusters.ts](../../app/ui/clusters.ts), [hotbar.tsx](../../app/ui/shell/hotbar.tsx)) |
| Entities | any catalog entity (cluster / weblink / general), not just clusters | 🟡 clusters only |
| Multiple hotbars | several **named** hotbars; pager `‹ N ›` shows the active hotbar's **1-based ordinal** (not a cell page); prev/next **wrap around**; badge click opens a switch command | ✅ (pager + wrap); ⬜ (add/rename/remove hotbar via command palette) |
| Reorder | drag-and-drop (`react-beautiful-dnd`), empty cells as drop targets, `restack` shifts toward nearest empty | 🟡 native HTML5 drag (swap); no shift-to-nearest yet |
| Add / remove | pin from catalog / sidebar-cluster / cell menu (`toggleEntity`) | ✅ (＋ menu + cell "Remove from Hotbar") |
| Cell composition | `Avatar` (colorHash `name(-source)` → color + initials) · **green LED** iff cluster CONNECTED · category **kind badge** · settings sub-icon · tooltip `name (source)` · active outline | ✅ (initials + color + LED + cog badge + active ring) |
| Auto-hide | Preferences "Automatically hide Hotbar" | ⬜ |

## 3. Sidebar (resource navigation) — spec

Source: `components/layout/{sidebar,sidebar-item,sidebar-cluster}.tsx`, `sidebar-items.injectable.ts`,
`layout/extension-sidebar-item-registrator.injectable.tsx`.

- **Not** a static tree — an **ordered registration hierarchy**: `{ id, parentId, title, onClick, getIcon?, isActive?, isVisible?, orderNumber }`; assembled by `parentId`, filtered by `isVisible`, sorted by `orderNumber` per level. ✅ modelled as data in [nav-tree.ts](../../app/ui/nav-tree.ts) (🟡 not yet a live registration token / extension slot).
- Group vs single item is **behavioral**: a **group** has `onClick:noop` and toggles expand; a **single item** navigates. Group `isActive` = **OR of children**. ✅
- **Expand state persisted** per node (`sidebar-storage`). ✅ (`localStorage` `hd-sidebar-expanded`).
- Groups auto-hide when no visible children (e.g. Custom Resources). ⬜
- **Cluster header** (`sidebar-cluster.tsx`): avatar + name + dropdown = hotbar add/remove toggle + entity context-menu + cross-frame navigate + loading placeholder. 🟡 (avatar + name + caret; dropdown menu ⬜).
- Real group order: Cluster 10, Nodes 20, Workloads 20, Config 40, Network 50, Storage 60, Namespaces 70, Events 80, Helm 90, Access Control 100, Custom Resources 110. ✅

### The full navigation tree (§3 data)

```
Cluster · Nodes
Workloads ▸ Overview · Pods · Deployments · Daemon Sets · Stateful Sets · Replica Sets ·
            Replication Controllers · Jobs · Cron Jobs
Config    ▸ Config Maps · Secrets · Resource Quotas · Limit Ranges · Horizontal Pod Autoscalers ·
            Pod Disruption Budgets · Priority Classes · Runtime Classes · Leases ·
            Mutating Webhook Configs · Validating Webhook Configs
Network   ▸ Services · Endpoints · Ingresses · Ingress Classes · Network Policies · Port Forwarding
Storage   ▸ Persistent Volume Claims · Persistent Volumes · Storage Classes
Namespaces · Events
Helm      ▸ Charts · Releases
Access Control ▸ Service Accounts · Cluster Roles · Roles · Cluster Role Bindings · Role Bindings · Pod Security Policies
Custom Resources ▸ Definitions · …(dynamic per-CRD)
```

## 4. Entry / catalog surfaces (root frame)

Source: `components/{catalog,catalog-entities,welcome,add-cluster,cluster-manager,kubeconfig-dialog}`,
`common/catalog/*`, `common/catalog-entities/*`, `features/weblinks/**`.

| Surface | Reality (corrects earlier assumptions) | Heimdall |
| --- | --- | --- |
| **Catalog** | a **configurable table** (`ItemListLayout`, 36px rows, per-`tableId` column config), **not a grid**. Category tabs sidebar (`CatalogMenu`: "Browse" + Categories w/ icons+badges). Columns Name/Source/Labels/Status (Browse adds Kind). Search filters `source=`, labels, `status.phase`. | 🟡 placeholder NonIdealState |
| **Entity model** | `CatalogEntity`/`CatalogCategory` abstraction; category registry (group→kind, `getEntityForData`); entity registry (IPC rehydrate, `activeEntity`, `onRun`/`onBeforeRun`). 3 built-ins: **KubernetesCluster, WebLink, GeneralEntity**. | ⬜ |
| **`+` add menu** | extensible **SpeedDial**; cluster category → "Add from kubeconfig" / "Sync file(s)" / "Sync folder(s)"; weblink → "Add web link". | ⬜ |
| **Entity context menu** | list kebab + drawer toolbar: "View Details", entity `onContextMenuOpen` items (cluster Settings/Connect/Disconnect; weblink Delete-with-confirm), hotbar toggle. | 🟡 (hotbar cell menu only) |
| **Entity details drawer** | avatar "click to open", Name/Kind/Source/Status/Labels rows, extension panels; single-click-to-run when no drawer open. | ⬜ |
| **Welcome** | **banner carousel** (`react-material-ui-carousel`, autoplay, logo fallback) + static intro JSX + **menu-item list** ("Browse Clusters in Catalog" + `extension.welcomeMenus`) — **not markdown**. | ⬜ |
| **Add cluster** | full-page `SettingLayout` with a **Monaco YAML paste** + debounced per-context validation — **not** a modal FileInput. `KubeConfigDialog` is a read-only viewer/exporter (copy/download). File/folder import is via the `+` "Sync kubeconfig" OS path-picker. | ⬜ |
| **Cluster lifecycle** | `LensKubernetesClusterStatus` = deleting/connecting/connected/disconnected; runtime `online/accessible/ready/disconnected/available`; `ClusterStatus` connecting/error/reconnect splash + "Manage Proxy Settings"; connection-update IPC stream; activation via request-tokens. | ⬜ |
| **Weblinks** | entity + category, two-step **command-palette** add, persistent `lens-weblink-store` (+migrations), URL verification → available/unavailable, delete-with-confirm. | ⬜ |
| **General entities** | catalog items that route to app pages (Preferences/Extensions) via `watchForGeneralEntityNavigation`. | ⬜ |

## 5. Resource list / detail core (the heart)

Source: `components/{item-object-list,kube-object-list-layout,kube-object-details,kube-object-menu,kube-object-meta,drawer,table,virtual-list}`, `packages/list-layout`.

- **List** (`ItemListLayout` → `KubeObjectListLayout`): header (title + `N items` / `Filtered: shown/total`), filters row, `Table`, footer. Search = case-insensitive substring over `searchFilters`. Namespace selector injected iff `store.api.isNamespaced`. Row click → detail; trailing `KubeObjectMenu`. 🟡 — a generic `ObjectTable` (`HTMLTable`) + a **descriptor registry** ([app/ui/resource/registry.tsx](../../app/ui/resource/registry.tsx)) is live for **~28 kinds** (Pods, Nodes, all 7 workloads, Services, PVC/PV via typed use-cases; Namespaces, Events, ConfigMaps, Secrets, Ingresses, RBAC, etc. via the generic `KubeObject` factory) against the simulator. ✅ **list toolbar** (item count + `shown/total` filtered indicator + case-insensitive search + namespace multi-filter popover) and ✅ a **Cluster overview** landing page. ✅ **per-column show/hide** (the ⋮ menu, persisted per view) and ✅ **column resize** (drag a header's trailing edge, persisted). Still ⬜: virtualization, URL-synced sort.
- **Columns**: `{ id, priority, header, content, sortingCallBack?, searchFilter? }` injectables — merged from **general-by-kind** (`kubeObjectListLayoutColumnInjectionToken`) + **per-resource specific** columns, priority-sorted; URL-synced sort; per-column show/hide menu persisted by `tableId`; `copyClassNameFromHeadCells`. 🟡 — show/hide and resize are live and persisted (`hd-cols-<view>`, `hd-col-widths`), and a column can start hidden via `defaultHidden`. Still ⬜: injectable per-kind columns, priority ordering, URL-synced sort.
- **Virtualization**: `react-window VariableSizeList` + `AutoSizer`, variable row heights, overscan ramp 1→10, `resetAfterIndex`, scroll-to-selected. **On by default.** ⬜
- **Detail drawer** (`KubeObjectDetails` + `Drawer`): resizable (persisted width, min 300 / max 90vw, dbl-click reset), Escape/click-outside close, per-route scroll restore, copy-title. Body = injected detail sections (`KubeObjectDetailRegistration` by kind+apiVersion+priority). 🟡 — a generic `DetailDrawer` (Blueprint `Drawer`) opens on row click and renders the descriptor's columns as a key/value list ([app/ui/resource/detail-drawer.tsx](../../app/ui/resource/detail-drawer.tsx)). Still ⬜: resize/persist width, per-kind `KubeObjectMeta` + spec sections, YAML view.
- **`DrawerItem` pattern**: key/value rows with `hidden` guards; `DrawerItemLabels` (badge lists); `DrawerTitle`/`DrawerParamToggler` (collapsible). Shared `KubeObjectMeta` block: Created/Name/Namespace/UID/Link/ResourceVersion/Labels/Annotations/Finalizers/**Controlled By** (owner-ref links). ⬜
- **Row/object menu** (`KubeObjectMenu`): Edit/Delete **auto-derived** from `store.patch`/`store.remove`; Edit → Monaco **dock tab** (`createEditResourceTab`); Delete → `withConfirmation` (cluster-scoped message) + `hideDetails()`; extension items per kind (Logs/Shell/Scale/port-forward). 🟡 — a trailing ⋮ menu (`showContextMenu`) offers **View details** + **Delete-with-confirm** (Blueprint `Alert` → `ResourceUseCases.remove`), verified against the simulator. Still ⬜: Edit-YAML (needs Monaco/dock), Logs/Shell/Scale, extension items.
- **Bulk actions**: per-row checkboxes + select-all; `AddRemoveButtons` remove FAB gated on selection; confirm lists up to 5 names + "and N more". ⬜

## 6. Overlays

| Overlay | Reality | Heimdall |
| --- | --- | --- |
| **Command palette** | trigger **Shift+Ctrl/Cmd+P** (not Ctrl+K); a `Select`-based Omnibar over registered commands filtered by `isActive(context)`; cross-frame via IPC | ⬜ |
| **Notifications** | `ok/error/info`; auto-hide timers (error = sticky, `showShortInfo`=5s); **hover pauses**; id de-dupe; `Error`/`JsonApiErrorParsed` handling; bottom-right stack | ⬜ |
| **Dialog / ConfirmDialog** | portal, Escape/click-outside (unless pinned), auto-close on navigation; ConfirmDialog singleton with async-OK spinner | ⬜ |
| **Namespace filter** | multi-`Select` (`isMulti`, `closeMenuOnSelect=false`); placeholder "All namespaces" / "Namespace(s): …"; feeds `selectedFilterNamespaces` | ⬜ |
| **Tooltips** | Blueprint `Tooltip` | ✅ (hotbar) |

## 7. Dock (bottom, tabbed)

Source: `components/dock/{dock,dock-tabs,dock-tab}.tsx`, `dock/dock/store.ts`.

- Tab kinds: **`terminal, create-resource, edit-resource, install-chart, upgrade-chart, pod-logs`** (pod-shell = a `terminal` tab spawned with a command). ⬜
- Persisted `{height, tabs, selectedTabId, isOpen}`; auto-numbered titles; **pinned tabs unclosable**; per-kind data clearers + **startup validators** (auto-close stale tabs); `closeAll/Others/ToRight` context menu. ⬜
- Resize via `ResizingAnchor` (drag below min **collapses**); `fullSize` mode; wheel-scroll tab strip; focus-scoped keys `Ctrl+.`/`Ctrl+,`/`Shift+Esc`/`Ctrl+W`. ⬜
- Toolbar `+` menu = **Terminal session** + **Create resource** only. ⬜

## 8. Shared primitives

`StatusBrick` (per-replica/container strips), `Badge` (overflow→expand), `Avatar` (seeded color + initials),
`KubeObjectStatusIcon` (INFO/WARNING/CRITICAL aggregation + grouped tooltip), `ResourceMetrics`
(radio tab switcher + Chart.js), `MarkdownViewer` (marked + DOMPurify), `MonacoEditor` (yaml/json),
`Table`, `Tabs`, `Wizard`/`WizardStep`/`Stepper` (async-next spinner), `Select`, `List`, `MenuActions`,
`AddRemoveButtons`. All ⬜ except where reused above.

## 9. Preferences / entity settings

- **Preferences** — full-page `SettingLayout`: **App · Proxy · Kubernetes · Editor · Terminal · Extensions**. ⬜ (verified live in the original)
- **Entity/cluster settings** — a tabbed `SettingLayout` grouped by `group`, populated by injected `entitySetting` registrations (apiVersion/kind/source), reached from the entity context menu. Cluster "General" = name + icon + kubeconfig; plus metrics / namespaces / node-shell / proxy / terminal. ⬜

## 10. Keep-integrations (no Blueprint equivalent)

Monaco (YAML/JSON edit) · xterm.js (terminal/logs) · Chart.js (metrics) · marked + DOMPurify (markdown).
These are retained wholesale; Blueprint supplies only the surrounding chrome.

---

### Build order (recommendation)

1. ✅ **Shell + Hotbar + Sidebar tree + theme (light/dark)** (done).
2. 🟡 **Resource list** = one `ObjectTable` + per-resource descriptors, wired to the use-cases (Pods/Nodes/Workloads live against the simulator). Next: virtualization, then the remaining kinds (Services, Storage, Config, Network, RBAC — each is one registry entry).
3. **Detail drawer** + `DrawerItem`/`KubeObjectMeta` + row menu (edit/delete).
4. **Namespace filter + search + filter chips**.
5. **Dock** (terminal + edit-resource) — brings Monaco + xterm back.
6. **Catalog + entity model + add-cluster** (entry flow).
7. **Command palette · notifications · dialogs**.
8. **Settings/preferences**, then **weblinks / general entities / extension slots**.

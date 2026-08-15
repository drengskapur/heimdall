# Legacy → BlueprintJS parity map

> Maps every legacy Freelens-port surface to a **BlueprintJS** component/pattern so the
> greenfield UI keeps **feature parity**. `core` = `@blueprintjs/core`; `table`/`select`/
> `datetime` = the sibling packages. **Keep** = a non-Blueprint integration we retain.
>
> **See also [`surface-manifest.md`](./surface-manifest.md)** — the source-grounded inventory
> of every surface (from the real `Open-Lens/lens` source), the two-frame architecture, and
> the build-status tracker. This file is the component→Blueprint cheat-sheet; the manifest is
> the roadmap.

## Shell & layout
| Legacy | Blueprint | Parity notes |
| --- | --- | --- |
| `shell` / `layout` / `cluster-frame(-portal)` | `Navbar` + our `Shell` (Flex layout) | one frame; no per-view chrome |
| `hotbar` / `sidebar-icon` / `favorites` | **Rail** = vertical `Button`+`Tooltip` group | Module launcher / favorites |
| `sidebar` (cluster nav) | `Menu`/`MenuItem` or `Tree` | expandable groups → `Tree` if nesting needed |
| `dock-host` / `dock-components` / `dock-resource` / `terminal-tab` | `Tabs` + a resizable bottom panel + `ResizeSensor` | dock tabs; **panel resize is custom** |
| `workspace-overlay` | `Overlay2` / `Dialog` | |
| `tabs` / `tabs-wizard` | `Tabs` / `MultistepDialog` | |
| `tree-view` | `Tree` | expand/select/icons built-in |
| status bar | custom bar (`Text`, `Tag`, `Icon`) | |

## Resource tables (the core)
| Legacy | Blueprint | Parity notes |
| --- | --- | --- |
| `item-list-layout` / `kube-list` / `table` / `virtual-list` | **`Table2`** (`@blueprintjs/table`) | sort, resize, select, **virtualized** — all built-in |
| `pods-view`/`node`/`service`/`pvc`/`secret`/`config-map`/`crd`/`job`/`cronjob`/`endpoint(-slice)`/`ingress`/`network-policy`/`replication-controller`/`lease`/`hpa`/`vpa`/`runtime-class`/`storage`/`rbac`/`service-account`/webhooks/`validating-admission-policy*`/`pod-security-policy` | one `Table2` + a **column descriptor per resource** | 40+ views collapse to 1 table + N descriptors |
| `controller-workload` / `pod-workload` / `pod-list` | `Table2` (variant descriptor) | |
| `workloads-overview` | `Card` + `Section` + charts | overview tiles |
| `status-brick` | `Tag` (intent-colored) | status pill |
| ⚠️ **column chooser / show-hide columns** | *not built-in* | custom `Popover`+`Checkbox` menu |

## Details & properties
| Legacy | Blueprint | Parity notes |
| --- | --- | --- |
| `kube-object-details` / `pod-details` / `drawer` | `Drawer` + `Tabs` + `Section`/`SectionCard` | tabbed detail |
| `kube-object-conditions` | `HTMLTable` + `Tag` | conditions grid |
| `kube-object-links` | `AnchorButton` / owner links | |
| ⚠️ **key/value "DrawerItem" list** | *no DescriptionList* | custom 2-col grid (small component) |

## Filter · search · scope · palette
| Legacy | Blueprint | Parity notes |
| --- | --- | --- |
| `namespace` select-filter | **`MultiSelect`** (`@blueprintjs/select`) | multi-namespace scope |
| search box | `InputGroup` (leftIcon=search) | |
| `catalog-command` (command palette) | **`Omnibar`** (`@blueprintjs/select`) | Ctrl+K palette |
| label/status filters | `Popover` + `Menu`/`Checkbox`, `Tag` chips | |

## Dialogs · forms · wizards
| Legacy | Blueprint | Parity notes |
| --- | --- | --- |
| `dialog` | `Dialog` | |
| `add-secret-dialog` / `kubeconfig-dialog` | `Dialog` + `FormGroup` fields | |
| `delete-cluster-dialog` (confirm) | **`Alert`** (`intent=danger`) | confirm-destroy |
| `install-chart` / `upgrade-chart` | `MultistepDialog` | wizard |
| `input` / `form-controls` | `FormGroup` + `InputGroup`/`HTMLSelect`/`Switch`/`NumericInput`/`TextArea`/`SegmentedControl` | |
| `resource-limits` / `policy-scheduling` | `FormGroup` + `NumericInput`/`TagInput` | |
| `file-picker` | `FileInput` | |

## Menus & actions
| Legacy | Blueprint | Parity notes |
| --- | --- | --- |
| `menu` / `menu-actions` | `Menu` + `Popover` | |
| `node-pod-menu` / row actions | `ContextMenu` + `Menu` | right-click + `⋮` button |

## Feedback & overlays
| Legacy | Blueprint | Parity notes |
| --- | --- | --- |
| notifications | **`OverlayToaster`** | toasts |
| loading | `Spinner` / `ProgressBar` / `Table2` loading | |
| empty views | `NonIdealState` | |
| `avatar-controls-licenses` | ⚠️ *no Avatar* → `Icon`/custom | |

## Metrics & charts (keep integrations)
| Legacy | Blueprint | Parity notes |
| --- | --- | --- |
| `chart` / `node-metrics` / `resource-metrics` / `cluster-metrics` | **Keep Chart.js** in a `Card`; `ProgressBar` for gauges | |

## Terminal · logs · editor (keep integrations)
| Legacy | Blueprint | Parity notes |
| --- | --- | --- |
| `terminal` / `standalone-terminal` / `terminal-tab` | **Keep xterm.js** in a dock `Tabs` panel | |
| `log` / `port-forward` | xterm/text panel in the dock | |
| `monaco-editor` | **Keep Monaco** (YAML edit) — no Blueprint editor | |
| `welcome-markdown` | **Keep marked** rendered into a `Card` | |

## Catalog · preferences · extensions
| Legacy | Blueprint | Parity notes |
| --- | --- | --- |
| `catalog-ui` / `catalog-actions` | `Table2` (clusters) or `Card` grid + `Button` | |
| `cluster-settings` / `cluster-metrics` | `Drawer`/`Dialog` + `FormGroup` + charts | |
| `preferences` / `helm-preferences` | `Drawer` + `Tabs` + `FormGroup` (or `PanelStack2`) | |
| `extension-management` / `extension-components` / `extension-surfaces` | `Table2` + `Menu` + extension slots | |

## Primitives
| Legacy | Blueprint |
| --- | --- |
| `icon` | `Icon` |
| `input` | `InputGroup` |
| `form-controls` | `FormGroup` + controls |
| `primitive`/`display-primitives`/`renderer-primitives`/`ui-utility` | `Text`/`Card`/`Divider`/`Callout`/`Code`/`Blockquote` |
| `pwa-register` / `renderer-infrastructure` | not UI — keep |

## Feature-parity watch-list (Blueprint gaps → build small components)
1. **Column chooser** (show/hide/reorder table columns) — `Popover` + `Checkbox` menu.
2. **DescriptionList / DrawerItem** (key–value details) — 2-col grid component.
3. **Resizable dock panel** — `ResizeSensor` + drag handle.
4. **Avatar** — `Icon`/initials chip.
5. **Virtualized tree** (huge CRD trees) — `Tree` + windowing if needed.
6. **Markdown / YAML / charts / terminal** — keep marked / Monaco / Chart.js / xterm (integrations, not chrome).

Everything else has a direct Blueprint component. The k8s-specific **columns, actions, and
data** stay ours (wired through Ports); Blueprint supplies the shells.

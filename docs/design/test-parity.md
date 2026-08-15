# Test & feature parity vs. Lens/OpenLens

> Grounded in the cloned `Open-Lens/lens` suite (**280 test files**) categorized by
> applicability to Heimdall's browser SPA (React + Blueprint + hexagon + companion,
> **not** Electron). Pairs with [`gap-analysis.md`](./gap-analysis.md).

## The denominator, honestly

| Bucket | Lens files | Applies to us? |
|---|---|---|
| **D — Electron / DI / extension-host / native** | ~130–140 (½ the suite) | **No.** Main-process, IPC channels, `@ogre-tools/injectable` DI, extension discovery/loader/marketplace, app-paths, tray/menu/window, auto-update, webpack, kubeconfig-sync daemon. A browser SPA has none of these. |
| **A — pure domain/logic** | ~45–50 | **Yes** — the first-priority equivalents. |
| **B — UI behavior** | ~70–80 | Yes, selectively (many are Blueprint-component interactions). |
| **C — API / transport** | ~14–18 | Yes; exec/port-forward are net-new (Lens tests those in Electron main). |

So "full parity with 280 tests" is the wrong target — **~half is architecturally N/A**. The right target is Buckets A/B/C.

## Where we already have equivalents (verified)

Our suite (109 cases) already covers the highest-ranked domain logic:

| Lens subject | Our equivalent |
|---|---|
| `Pod.hasIssues()` — CrashLoopBackOff / phase / readiness gates / sidecar init | `app/domain/workload/pod.test.ts` (15 cases) |
| `age()` / duration units | `app/domain/values/age.test.ts` |
| memory/cpu unit conversion (Ki/Mi/Gi, cores/milli) | `app/domain/values/quantity.test.ts` |
| `KubeObject.getId()` uid→fallback | `app/domain/values/resource-ref.test.ts` |
| `Crd.getVersion()` served/stored/legacy | `app/domain/custom-resource/custom-resource-type.test.ts` |
| `Node.isMasterNode` / `getRoleLabels` | `app/infrastructure/mappers/node-mapper.test.ts` |
| DTO→domain mapping (pod/node/service/volume/workload/crd) | `app/infrastructure/mappers/*.test.ts` (6 files) |
| kubeconfig parse → profile (browser-specific) | `tests/ui/cluster-catalog.test.ts` (10 cases, net-new) |
| sidebar API-discovery gating (`canListResource`-adjacent) | `tests/ui/capabilities.test.ts` |
| gateway CRUD/path building | `tests/integration/gateway.integration.test.ts` |

## What the survey uncovered — real gaps (feature + test)

Ranked by user impact:

### Features — status
1. ✅ **Table column sorting** (Lens `getSorted`) — sortable headers (asc→desc→off), stable, numeric-aware, natural collation. `getSorted` unit-tested; wired across pods/nodes/workloads/services + generic kinds.
2. ✅ **Log search** (Lens `search-store`) — find box, match count, next/prev, highlight, scroll-to-match. `findMatches`/`stepMatch` unit-tested.
3. ✅ **RBAC gating** (`SelfSubjectRulesReview`) — sidebar + palette gate on the user's *list* permissions; conservative (permissive on null/incomplete/error). `canList` unit-tested; review verified against docker-desktop.
4. ✅ **Metrics** — with metrics-server installed on docker-desktop: ClusterUsage CPU/Mem gauges + **live time-series sparklines** (5s poll), and per-pod/node **CPU/Memory columns** (kubectl-top style), sortable. Verified against real metrics (coredns 2m/13.7Mi). *Remaining:* HPA `metric-parser` (v2/v2beta*) + a Prometheus provider layer.
5. ✅ **Store merge-by-uid** (Lens `KubeObjectStore` reconcile) — the ~20 generic kinds now merge watch events by uid via a pure, unit-tested `reconcile`; typed kinds keep the debounce-reload fallback.

### Tests added since (pure logic the survey pinpointed)
- ✅ CRD printer-column JSONPath (`json-path.test.ts`: dot paths, `[i]` indices, `[*]`→first, never-throws).
- ✅ Table `getSorted` (`sort.test.ts`: numeric, natural collation, stable, non-mutating).
- ✅ Log search (`log-search.test.ts`: case-insensitive spans, non-overlapping repeats, wrap-around).
- ✅ RBAC `canList` (`capabilities.test.ts`: wildcards, group/resource grants, get-only ≠ list, permissive-null).
- ✅ kubeconfig `parseKubeconfig` (`cluster-catalog.test.ts`: inline-cert/token/exec → ready, file-cert → unsupported, multi-context).
- ✅ Dock store (`dock-store.test.ts`: open/focus/close, height clamp, stable snapshot).

**Test count: 109 → 147.**

### Net-new (no Lens antecedent — companion transport)
- Port-forward lifecycle over the companion (open → local port → stop → error).
- exec/attach channel framing (stdin/stdout/stderr/resize) — verified manually against docker-desktop.

## Skipped with justification (Bucket D)
Extension host/loader/marketplace, IPC/messaging framework, DI container wiring, Electron tray/menu/window/app-paths, auto-update, webpack, kubeconfig-sync daemon. These test infrastructure Heimdall does not contain.

# Architecture

The application is structured as a **hexagon** (ports and adapters) with DDD
tactical patterns. The guiding rule is that **dependencies point inward**: the
domain has no knowledge of React, HTTP, WebSockets, or Kubernetes wire formats.
Outer layers depend on inner layers, never the reverse.

```
        ┌─────────────────────────────────────────────┐
        │  UI  (app/ui)                                │
        │  React views — consume use-cases             │
        │   ┌───────────────────────────────────────┐  │
        │   │ Application (app/application)          │  │
        │   │  ports (interfaces) + use-cases        │  │
        │   │   ┌─────────────────────────────────┐  │  │
        │   │   │ Domain (app/domain)             │  │  │
        │   │   │  value objects, entities,       │  │  │
        │   │   │  domain services — pure, no I/O │  │  │
        │   │   └─────────────────────────────────┘  │  │
        │   └───────────────────────────────────────┘  │
        │  Infrastructure (app/infrastructure)         │
        │  adapters implement ports; DTO↔domain mappers│
        └─────────────────────────────────────────────┘
                 ▲                         │
                 │ implements ports        │ typed against
                 │                         ▼
        server/api-server.mjs      app/lib/generated/ (from OpenAPI)
```

## Layers

### Domain — [`app/domain`](../app/domain)

Pure business types with no I/O. Organized by subdomain:

- `shared/` — building blocks (`result.ts`, `building-blocks.ts`, `guard.ts`,
  `kubernetes.ts`) shared across subdomains.
- `values/` — value objects: `quantity.ts` (`CpuQuantity`/`MemoryQuantity`),
  `resource-ref.ts` (`ResourceRef`), `age.ts`.
- `workload/` — `pod.ts` (`PodHealth`), `workload.ts` (`WorkloadStatus`).
- `node/`, `network/`, `storage/`, `custom-resource/`, `helm/` — one file per
  aggregate (`NodeStatus`, `ServiceView`, `VolumeStatus`, `CustomResourceType`,
  `HelmRelease`).

### Application — [`app/application`](../app/application)

Orchestrates the domain and declares the boundaries the outside world must
satisfy:

- `ports/` — interfaces the infrastructure implements:
  `kubernetes-gateway.ts`, `helm-gateway.ts`, `repositories.ts`.
- `use-cases/` — task-oriented operations (`pods.ts`, `workloads.ts`, `nodes.ts`,
  `network.ts`, `storage.ts`, `resources.ts`) that depend only on ports and the
  domain.

### Infrastructure — [`app/infrastructure`](../app/infrastructure)

Adapters that fulfil the ports, plus the wiring:

- `kubernetes/gateway.ts`, `helm/helm-gateway.ts` — adapters over the transport
  in `app/lib`.
- `mappers/` — translate Kubernetes DTOs (typed via generated `Wire*` types) into
  domain shapes at the boundary.
- `storage/profile-repository.ts` — cluster-profile persistence.
- `composition-root.ts` — the single place where concrete adapters are
  constructed and handed to use-cases (`gatewayFor`, `helmFor`).

### UI — [`app/ui`](../app/ui)

React views consume use-cases through the composition root. All cluster and Helm
I/O flows through `gatewayFor(profile)` / `helmFor(profile)` — components never
call the transport directly.

## Generated types at the seams

The wire boundary is typed from OpenAPI rather than by hand:

- [`openapi/app.openapi.json`](../openapi) — app-owned interfaces (cluster
  profiles, preferences, metrics, proxy/stream configs).
- `openapi/kubernetes/` — vendored Kubernetes OpenAPI, one document per version
  (v1.31–1.36).
- `npm run codegen` compiles both to TypeScript under `app/lib/generated/`
  (git-ignored, rebuilt by the `prepare` hook). [`app/lib/kube-generated.ts`](../app/lib/kube-generated.ts)
  is the ergonomic bridge (`Wire<T>`, per-kind aliases).

A `tsc` gate ([`tsconfig.json`](../tsconfig.json),
`npm run typecheck`) holds the domain, application, infrastructure, server, and
generated bridge at **zero** type errors, so the contract at the seams stays
stable.

## Transport & backend

The browser cannot open raw sockets to a cluster, so the SPA talks to a local
Node API server ([`server/api-server.mjs`](../server/api-server.mjs)):

- `/api/kube` — HTTP proxy (bearer / client-cert, TLS-aware via `undici`).
- `/api/kube-stream` — WebSocket relay (`ws`) for exec / attach / port-forward /
  watch, fixing binary streaming that a plain HTTP proxy can't carry.
- `/api/prometheus`, `/api/helm-chart`, `/api/helm-repository` — metrics and Helm
  proxies.

## Testing correspondence

Each layer has a matching test level:

- Domain / application / infrastructure — unit tests (`npm test`).
- Ports — application tests against a fake gateway.
- Adapters — integration tests against an in-memory Kubernetes simulator.
- Streaming framing — `tests/e2e/streaming.test.mjs`.
- End-to-end — Playwright against the simulator (`npm run test:e2e:sim`).
- Domain + mappers — Stryker mutation testing (`npm run test:mutation`).

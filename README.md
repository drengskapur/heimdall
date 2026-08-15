# Heimdall

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/drengskapur/heimdall/badge)](https://scorecard.dev/viewer/?uri=github.com/drengskapur/heimdall)
[![test](https://github.com/drengskapur/heimdall/actions/workflows/test.yml/badge.svg)](https://github.com/drengskapur/heimdall/actions/workflows/test.yml)
[![CodeQL](https://github.com/drengskapur/heimdall/actions/workflows/codeql.yml/badge.svg)](https://github.com/drengskapur/heimdall/actions/workflows/codeql.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Heimdall** is an installable, offline-first [Progressive Web App](https://web.dev/progressive-web-apps/)
Kubernetes IDE, derived from [Freelens](https://github.com/freelensapp/freelens)
(itself an OpenLens fork). Its resource model, views and behaviour come from Freelens;
its **chrome does not** — the shell is its own design system, specified in
[`docs/design/chrome-spec.md`](docs/design/chrome-spec.md).

> **Status: work in progress.** The shell, routing and a large set of resource
> views render against real clusters. Resource coverage is still short of
> upstream Freelens; the chrome is deliberately *not* Freelens-shaped.

## Highlights

- **Offline-first PWA** — installable, with a service worker (`public/sw.js`)
  that precaches the app shell and serves it offline (network-first, cache
  fallback). Registered on load by [`app/ui/main.tsx`](app/ui/main.tsx).
- **A chrome of its own** — a dark rail, a flat 50px header, and a recessed
  active nav row, over a surface ramp of one gray per step (`black` →
  `dark-gray-1` → `dark-gray-2`). Every value is a Blueprint palette token, so
  the chrome follows a theme flip. Dark is the default; light is fully
  supported.
- **Deep-linkable** — the location lives in the URL (`/<cluster>/<page>`, e.g.
  `/docker-desktop/pods`), so a view can be bookmarked or shared, a reload keeps
  your place, and the browser's own Back/Forward work. See
  [`app/ui/router.ts`](app/ui/router.ts).
- **Kubernetes resource views** — sidebar, dock/terminal, command palette,
  drawers, and dozens of resource views (Pods, Deployments, Services, Ingresses,
  CRDs, Helm releases, RBAC, events, …).
- **Custom resources are first-class** — a CRD's `additionalPrinterColumns`
  drive its table, and its `openAPIV3Schema` drives the detail view: field types
  format the values and the author's own `description`s become field docs. No
  per-CRD code.
- **Hexagonal core** — a framework-agnostic domain (`app/domain`), application
  ports and use-cases (`app/application`), and infrastructure adapters
  (`app/infrastructure`), with the transport/HTTP boundary typed against
  types generated from OpenAPI. See [Architecture](#architecture).
- **Real cluster access via a companion** — a browser can't run `kubectl` or
  reach a cluster API directly, so a local [API server](#running-the-app) proxies
  cluster HTTP/WebSocket traffic and an optional [companion](#companion-server)
  provides authenticated kubectl, shell/exec, and downloads.

## Prerequisites

- Node.js `>= 22.13.0` (see [`.nvmrc`](.nvmrc))

## Running the app

```bash
npm install
npm run dev
```

`npm run dev` starts two processes ([`scripts/dev-spa.mjs`](scripts/dev-spa.mjs)):

- the **Vite dev server** (React 19 SPA) with hot-module reload, and
- the **Node API server** ([`server/api-server.mjs`](server/api-server.mjs)) on
  port `3011`, which Vite proxies `/api/*` to.

Then open the printed local URL. To install as a PWA, use your browser's
"Install app" action.

The API server is a small Node backend that bridges the browser to a cluster:

| Endpoint | Purpose |
| --- | --- |
| `/api/kube` | Kubernetes HTTP proxy (bearer / client-cert, TLS-aware) |
| `/api/kube-stream` | WebSocket relay for exec / attach / port-forward / watch |
| `/api/prometheus` | Metrics proxy |
| `/api/helm-chart`, `/api/helm-repository` | Helm chart/repo proxy |

### Production build

```bash
npm run build    # generates OpenAPI types, then builds the SPA into dist/
npm start        # serves dist/ and the /api backend (server/api-server.mjs)
```

The build is a static SPA in `dist/`; any static host can serve it, with the Node
API server (or the companion) providing cluster connectivity.

## Companion server

For capabilities a browser sandbox can't provide — running `kubectl`, spawning a
shell, downloading binaries — a small local Node service exposes an authenticated,
origin-checked HTTP API:

```bash
npm run companion
```

Configuration (environment variables):

| Variable | Default | Purpose |
| --- | --- | --- |
| `HEIMDALL_COMPANION_HOST` | `127.0.0.1` | Bind address (loopback only by default) |
| `HEIMDALL_COMPANION_PORT` | `38431` | Listen port |
| `HEIMDALL_COMPANION_TOKEN` | random per start | Bearer token the PWA must present |
| `HEIMDALL_COMPANION_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed CORS origins |
| `HEIMDALL_COMPANION_DATA` | `~/.heimdall/kubectl` | Downloaded `kubectl` location |

Requests are authenticated with a bearer token and constrained to an allowlisted
set of origins; it binds to loopback by default.

## Architecture

The application follows a hexagonal (ports-and-adapters) structure with DDD
tactical patterns. Dependencies point inward: the domain knows nothing about
React, HTTP, or Kubernetes wire formats.

| Layer | Path | Responsibility |
| --- | --- | --- |
| Domain | [`app/domain`](app/domain) | Pure value objects, entities, and domain services (no I/O) |
| Application | [`app/application`](app/application) | Ports (interfaces) and use-cases orchestrating the domain |
| Infrastructure | [`app/infrastructure`](app/infrastructure) | Adapters implementing the ports; DTO↔domain mappers; composition root |
| UI | [`app/ui`](app/ui) | React views that consume use-cases |

Types at the seams (HTTP payloads, adapters, mappers) are **generated from
OpenAPI**: an app-owned schema plus vendored Kubernetes OpenAPI (v1.31–1.36) are
compiled to TypeScript by `npm run codegen`. A `tsc` gate
(`npm run typecheck`) holds the whole repository — UI included — at zero type
errors. See [`docs/architecture.md`](docs/architecture.md).

## Testing

Layered suites, fastest first:

| Command | Level |
| --- | --- |
| `npm test` | Unit — domain / application / infrastructure, plus integration and streaming (no browser) |
| `npm run typecheck` | `tsc` over the whole repository, held at zero errors |
| `npm run test:integration` | Adapters + transport + mappers against an in-memory simulator |
| `npm run test:e2e:sim` | Playwright end-to-end against the Kubernetes simulator |
| `npm run test:a11y` | axe-core WCAG A/AA sweep over the main surfaces, light and dark |
| `npm run test:mutation` | Stryker mutation testing over the domain and mappers |
| `npm run fuzz` | Coverage-guided fuzzing over the parsers that take input the app does not control |
| `npm run gate:release` | Formatting, lint, types, unit, build, accessibility, end-to-end, offline — cheapest first, stopping at the first failure |

## Project layout

| Path | Contents |
| --- | --- |
| `app/domain`, `app/application`, `app/infrastructure` | Hexagonal core (see [Architecture](#architecture)) |
| `app/ui` | React UI (shell, resource views, drawers, dock, Topology) |
| `app/lib` | Cluster transport, kubeconfig, Helm, and the generated type bridge |
| `server/` | Node API server (`/api/*` proxy + streaming + static serving) |
| `companion/` | Local companion server (kubectl / shell / downloads) |
| `openapi/` | App-owned schema + vendored Kubernetes OpenAPI; codegen source of truth |
| `scripts/` | Codegen, dev servers, accessibility, statechart, and the release gate |
| `docs/` | Architecture notes and design records |
| `tests/` | Node and Playwright test suites |
| `public/` | PWA manifest, service worker, icons, static assets |

## Tech stack

React 19 + [Vite 8](https://vite.dev/) (single-page app; no server-side
rendering), [Blueprint 6](https://blueprintjs.com/) for components and theming,
xterm.js for the terminal, and OpenAPI codegen for typed cluster access — the
schemas are compiled to TypeScript, so the checking happens at build time rather
than in the browser.
State is React's own — stores are `useSyncExternalStore` over a plain module,
with no state library. The backend is a small Node server with two runtime
dependencies: `undici` for HTTP and `ws` for WebSocket streaming.

## Releases and provenance

Each release carries the built SPA (`heimdall-<tag>-dist.tar.gz`), its CycloneDX
SBOM, `SHA256SUMS`, and a signed build-provenance attestation. The archive is
built reproducibly — fixed mtime, ownership and member order — so the digest the
attestation covers is one you can reproduce rather than one you have to trust.

Verify a download before running it:

```bash
gh attestation verify heimdall-<tag>-dist.tar.gz --repo drengskapur/heimdall
```

That checks, against Sigstore's transparency log, that the archive was built by
this repository's release workflow from the commit it claims. The same
attestation is attached as `….intoto.jsonl` for tooling that consumes in-toto
statements directly.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers local development, the test suites, and
the conventions — most usefully, that the domain layer imports no React, HTTP or
Kubernetes wire types, and that `app/lib/generated/` comes from OpenAPI rather
than from hand. [SUPPORT.md](SUPPORT.md) says where questions, bugs and feature
requests each go. Behaviour in the project's spaces is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

The single most useful thing in a bug report is whether the problem reproduces
against the built-in simulator (`npm run test:e2e:sim`) — if it does, it is
reproducible for a maintainer without access to your cluster.

## Security

Report a vulnerability privately through the Security tab, or read
[SECURITY.md](SECURITY.md) for what is in scope and what to expect. Please do not
open a public issue for a security problem.

## License

Licensed under the [Apache License 2.0](LICENSE). This project is a derivative
port of [Freelens](https://github.com/freelensapp/freelens) and, upstream of it,
[OpenLens](https://github.com/lensapp/lens), which are MIT-licensed; their
copyright and permission notices are preserved in [NOTICE](NOTICE). "Lens" is a
trademark of Mirantis, Inc.; this is an independent, unaffiliated port.

The packages bundled into the application carry their own permissive licenses,
reproduced in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), and the shipped
dependency tree is enumerated as a CycloneDX bill of materials in
[`sbom.cdx.json`](sbom.cdx.json). Both are generated from the installed tree, so
`npm test` fails if either falls out of date.

## Acknowledgements

UI, behavior, and structure are derived from
[Freelens](https://github.com/freelensapp/freelens) and, upstream of it,
[OpenLens](https://github.com/lensapp/lens). This project is an independent port
for research and offline use.

# Contributing

Thanks for your interest in Heimdall. This guide covers local development, the
test suites, and the conventions the project follows.

> **Licensing note.** Heimdall is licensed under the [Apache License 2.0](LICENSE).
> Contributions are accepted under those terms. Upstream attribution lives in
> [NOTICE](NOTICE); if you port code from Freelens or OpenLens, say so in the pull
> request so the attribution stays accurate.

## Prerequisites

- Node.js `>= 22.13.0` (a `.nvmrc` pins the major; `nvm use` will pick it up)

## Getting started

```bash
npm install        # also runs codegen via the prepare hook
npm run dev        # Vite dev server + Node API server
```

`npm install` generates the OpenAPI-derived types into `app/lib/generated/`
(git-ignored). If you change anything under `openapi/`, rerun `npm run codegen`.

## Architecture

The code is a hexagon (ports and adapters) with DDD tactical patterns —
`app/domain` (pure) → `app/application` (ports + use-cases) → `app/infrastructure`
(adapters + mappers), with the UI in `app/ui`. Read
[`docs/architecture.md`](docs/architecture.md) before making structural changes,
and keep dependencies pointing inward: the domain must not import React, HTTP, or
Kubernetes wire types.

Types at the transport/adapter/mapper seams are **generated from OpenAPI** — treat
them as the stable contract. Don't hand-edit `app/lib/generated/`.

## Tests & checks

Run the fast suite and the type gate before opening a PR:

```bash
npm test           # domain + application + infrastructure + integration + streaming
npm run typecheck  # enforced tsc gate over the hexagon, server, and generated seams
npm run lint
```

Heavier, optional suites:

| Command | What it covers |
| --- | --- |
| `npm run test:e2e:sim` | Playwright end-to-end vs. the Kubernetes simulator |
| `npm run test:mutation` | Stryker mutation testing over the domain and mappers |
| `npm run fuzz` | Coverage-guided fuzzing over the parsers that take untrusted input |

The typecheck gate (`npm run typecheck`, the whole repository) is held at **zero errors** and runs
in CI — keep it green.

## Conventions

- Match the style of the surrounding code (naming, comment density, idioms).
- Keep cluster/Helm I/O behind the composition root (`gatewayFor` / `helmFor`);
  UI code should not call the transport directly.
- New domain behavior should come with unit tests; new adapters with integration
  tests.
- Commit messages follow a `type(scope): summary` convention (see `git log`).

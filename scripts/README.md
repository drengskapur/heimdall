# Scripts

Command-line tooling for this project, grouped by purpose. Most are exposed as
`npm run` scripts (shown in parentheses); a couple are helpers invoked by others.

## Development

| Script | npm | Purpose |
| --- | --- | --- |
| `dev-spa.mjs` | `dev` | Start the Vite dev server and the Node API server together. |
| `dev-all.mjs` | `dev:all` | As above, plus the companion server. |
| `companion-dev.mjs` | `companion:dev` | Run the companion with a fixed token and dev origins, for a reproducible local setup. |

## Codegen

| Script | npm | Purpose |
| --- | --- | --- |
| `generate-openapi-types.mjs` | `codegen` | Generate TypeScript from the OpenAPI sources of truth into `app/lib/generated/`. Run by the `prepare` hook. |
| `fetch-kube-openapi.mjs` | `codegen:fetch-kube` | Vendor the official Kubernetes OpenAPI (swagger 2.0) for each supported minor version and convert it. |
| `generate-statechart.mjs` | `statechart:generate` | Regenerate `docs/heimdall-executable-statechart.md` from `tests/contracts/heimdall-statechart.mjs`. `--check` fails instead of writing, which is how `test:statechart` keeps the document from drifting. |
| `generate-third-party-notices.mjs` | `licenses:generate` | Regenerate `THIRD-PARTY-NOTICES.md` from the dependencies the bundle ships. `--check` fails instead of writing, which is how `test:licenses` keeps attribution from drifting after an install. |
| `generate-sbom.mjs` | `sbom:generate` | Regenerate `sbom.cdx.json`, a CycloneDX bill of materials for the shipped dependency tree. `--check` fails instead of writing, which is how `test:sbom` keeps it from drifting. |

## Tests and gates

| Script | npm | Purpose |
| --- | --- | --- |
| `run-e2e-sim.mjs` | `test:e2e:sim` | Run the cluster E2E suite against the in-memory Kubernetes simulator. |
| `run-e2e-spa.mjs` | `test:e2e:spa` | Build the SPA, then run the E2E suite against it served by the Node API server. |
| `a11y.mjs` | `test:a11y` | axe-core WCAG A/AA sweep over the main surfaces, light and dark. Starts its own dev server if one is not already listening, and stops it afterwards. |
| `fuzz.mjs` | `fuzz` | Run the Jazzer.js targets in [`../fuzz`](../fuzz). Compiles the code under test first — Jazzer's instrumenting loader displaces tsx, so the target has to be JavaScript by the time it is loaded. |
| `quality-gate.mjs` | `gate:release` | The release gate: every check that has to pass before a version ships, cheapest first, stopping at the first failure. |

## Reporting

| Script | npm | Purpose |
| --- | --- | --- |
| `enumerate-api-coverage.mjs` | `coverage`, `coverage:md` | Report which Kubernetes API surfaces the app covers; `coverage:md` writes `docs/design/api-coverage.md`. |
| `encoding-audit.mjs` | — | Audit source files for encoding issues. |

## Shared

| Path | Purpose |
| --- | --- |
| `lib/interface-contracts.mjs` | Interface-contract helpers shared by the codegen scripts. |

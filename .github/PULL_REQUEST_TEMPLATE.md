<!--
Title this pull request as a Conventional Commit — `fix(topology): ...`,
`feat(resource): ...`, `docs: ...`. release-please reads the merged commit to
decide the next version and to write the changelog, so the title is not
cosmetic.
-->

## What this changes

<!-- What behaviour is different afterwards, and why. -->

## How it was verified

<!--
Not "tests pass" — what you actually ran, and what it showed. If it is a
rendering change, say what you looked at. If it is a fix, say how you
reproduced the bug first; a fix nobody watched fail is a fix nobody has
evidence for.
-->

- [ ] `npm test` (unit, integration, streaming, statechart, licenses, SBOM)
- [ ] `npm run typecheck`
- [ ] `npm run gate:release` for anything touching the UI, the build, or CI

## Checklist

- [ ] Conventional Commit title
- [ ] No `bp6-` class literals in CSS — use the Blueprint tokens (enforced by `tests/ui/blueprint-conventions.test.ts`)
- [ ] Dependencies still point inward: `app/domain` imports no React, HTTP, or Kubernetes wire types
- [ ] `app/lib/generated/` not hand-edited — change the OpenAPI source and rerun `npm run codegen`
- [ ] If a dependency was added or removed: `npm run licenses:generate && npm run sbom:generate`
- [ ] If code was ported from Freelens or OpenLens, noted here so [NOTICE](../NOTICE) stays accurate

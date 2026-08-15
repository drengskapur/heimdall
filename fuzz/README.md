# Fuzz targets

Coverage-guided fuzzing with [Jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js)
over the functions that take input this application does not control.

The unit tests cover the inputs we thought of. These cover the ones we did not:
a Helm chart archive from a third-party repository, a quantity string from a
cluster's API, a path from the address bar, an object from an API server running
a version we have never seen.

```bash
npm run fuzz              # every target, a short run each — what CI does
npm run fuzz:tar          # one target, until you stop it
```

## What each target guards

| Target | Input, and where it comes from |
| --- | --- |
| `tar-archive` | The bytes of a `.tgz` Helm chart, downloaded from whatever repository the user added. The only target here whose input is fully attacker-controlled. |
| `quantity` | `128Mi`, `1.5`, `250m` — resource strings from the Kubernetes API. |
| `route` | A URL path, which anyone can type or link to. |
| `mappers` | Wire objects from an API server. Every field is optional in the schema, so the shapes are effectively unbounded. |

## The rule these targets encode

A parser may **reject** anything — that is its job, and a thrown `Error` with a
message is a pass. What it may not do is fail in a way its caller cannot handle:
a `TypeError` from dereferencing something absent, a `RangeError` from an
out-of-bounds read, an unbounded allocation, or a hang.

So each target catches the deliberate rejections and lets everything else
escape, which is what Jazzer reports as a finding.

## Reproducing a finding

Jazzer writes the offending input to `crash-<sha1>` in the working directory.
Re-run that single case with:

```bash
npx jazzer fuzz/<target>.fuzz.mjs crash-<sha1>
```

Add it to the unit tests before fixing it, so the case stays covered once the
fuzzer moves on.

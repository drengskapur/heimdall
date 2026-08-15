# Support

Heimdall is maintained by a small team, in the open. Here is where each kind of
question goes.

## Questions and help

Open a [discussion](https://github.com/drengskapur/heimdall/discussions) for
usage questions, "is this supposed to work like this", and ideas you want to
talk through before writing code.

## Bugs

Open a [bug report](https://github.com/drengskapur/heimdall/issues/new?template=bug.yml).
The two things that decide how fast a bug gets fixed are the Kubernetes version
and whether it reproduces against the built-in simulator:

```bash
npm run test:e2e:sim
```

If it reproduces there, it is reproducible for us too, and that is most of the
work. If it only happens against your cluster, the resource YAML that triggers
it — with anything sensitive removed — is the next best thing.

## Feature requests

Open a [feature request](https://github.com/drengskapur/heimdall/issues/new?template=feature.yml).
Heimdall is a port and does not yet match Freelens surface for surface, so
"Freelens does X and Heimdall does not" is a useful and welcome report.

## Security

Do **not** open a public issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md), which routes private reports.

## What is not supported

- Anything about your cluster itself, your cloud provider, or `kubectl`. Heimdall
  reads a cluster; it does not administer one.
- Older Kubernetes than the versions listed in the README. The types are
  generated from vendored OpenAPI, so an unlisted version is not merely untested
  — its API shape is not present at all.

## Response times

There is no SLA. This is not a commercial product, and pretending otherwise
would just set an expectation that gets broken. Issues are read; a fix depends on
severity and on how reproducible the report is.

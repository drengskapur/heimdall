# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it through GitHub's private vulnerability reporting, on the
[Security tab](https://github.com/drengskapur/heimdall/security/advisories/new)
of this repository. That opens a private advisory visible only to you and the
maintainers.

If that is unavailable to you, email **security@drengskapur.com** instead.

You should expect:

| | |
| --- | --- |
| First response | within 3 working days |
| Assessment and severity | within 10 working days |
| Fix or documented mitigation | before the advisory is published |

Please include what you need to make the problem reproducible: the version or
commit, the configuration, and the steps. A proof of concept helps and is never
required.

We will credit you in the advisory unless you would rather we did not.

## Supported versions

The project is pre-1.0. Only the latest release receives fixes; there are no
maintained release branches yet. This section will change when 1.0 ships.

| Version | Supported |
| --- | --- |
| latest release | yes |
| anything older | no |

## What is in scope

Heimdall is a browser application that talks to a Kubernetes cluster, plus two
small local Node services. The parts worth attacking, and what we consider a
vulnerability:

- **The companion** (`companion/`) runs `kubectl`, spawns shells and downloads
  binaries. It binds loopback and requires a bearer token. Anything that reaches
  those capabilities without the token, escapes the origin allowlist, or escapes
  the intended working directory, is in scope.
- **The API server** (`server/`) proxies cluster HTTP and WebSocket traffic.
  Anything that lets one caller reach another's cluster, leak a credential, or
  smuggle a request through the proxy is in scope.
- **The web application** (`app/`) handles cluster credentials and renders
  cluster-controlled data. Script injection from object names, labels or logs,
  and credential leakage into storage or URLs, are in scope.
- **The service worker** caches application assets. Cache poisoning that
  survives a reload is in scope.

## What is not in scope

- The companion being reachable by other processes on the same machine. It binds
  loopback and authenticates with a token; a local attacker who can read your
  process environment has already won.
- Anything requiring a malicious kubeconfig that the user added themselves.
  Adding a cluster is an act of trust in that cluster.
- Denial of service against your own cluster through the UI. The application
  can only do what your credentials permit.
- Vulnerabilities in Kubernetes itself — report those to
  [Kubernetes](https://kubernetes.io/docs/reference/issues-security/security/).

## Handling

Fixes are developed in a private fork, released together with a GitHub Security
Advisory and a CVE where one applies, and backported to the latest release. The
advisory names the affected versions, the fix, and any mitigation available to
someone who cannot upgrade immediately.

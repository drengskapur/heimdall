import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { parseKubeconfig, profileToCluster } from "../../app/ui/cluster-catalog";

const b64 = (s: string) => Buffer.from(s).toString("base64");

function kubeconfig(overrides: Record<string, unknown> = {}) {
  return stringify({
    apiVersion: "v1",
    kind: "Config",
    "current-context": "ctx",
    clusters: [
      {
        name: "c1",
        cluster: {
          server: "https://127.0.0.1:6443",
          "certificate-authority-data": b64("CA"),
          ...(overrides.cluster as object),
        },
      },
    ],
    users: [
      { name: "u1", user: overrides.user ?? { "client-certificate-data": b64("CERT"), "client-key-data": b64("KEY") } },
    ],
    contexts: [{ name: "ctx", context: { cluster: "c1", user: "u1", namespace: "team-a" } }],
  });
}

test("parseKubeconfig: inline client-cert context becomes a ready profile", () => {
  const [p] = parseKubeconfig(kubeconfig());
  assert.equal(p.id, "ctx");
  assert.equal(p.name, "ctx");
  assert.equal(p.server, "https://127.0.0.1:6443");
  assert.equal(p.namespace, "team-a");
  assert.equal(p.authStatus, "ready");
  assert.equal(p.clientCertificateData, b64("CERT"));
  assert.equal(p.clientKeyData, b64("KEY"));
  assert.equal(p.certificateAuthorityData, b64("CA"));
});

test("parseKubeconfig: a bearer-token context is ready", () => {
  const [p] = parseKubeconfig(kubeconfig({ user: { token: "abc123" } }));
  assert.equal(p.authStatus, "ready");
  assert.equal(p.token, "abc123");
});

test("parseKubeconfig: an exec-credential context is ready", () => {
  const [p] = parseKubeconfig(kubeconfig({ user: { exec: { command: "aws", args: ["eks", "get-token"] } } }));
  assert.equal(p.authStatus, "ready");
  assert.equal(p.execCredential?.command, "aws");
  assert.deepEqual(p.execCredential?.args, ["eks", "get-token"]);
});

test("parseKubeconfig: file-based certs are surfaced as unsupported (can't read in a browser)", () => {
  const [p] = parseKubeconfig(
    kubeconfig({
      user: { "client-certificate": "/home/me/.minikube/client.crt", "client-key": "/home/me/.minikube/client.key" },
    }),
  );
  assert.equal(p.authStatus, "unsupported");
  assert.match(p.authMessage ?? "", /file-based/i);
});

test("parseKubeconfig: no usable credentials → unsupported", () => {
  const [p] = parseKubeconfig(kubeconfig({ user: {} }));
  assert.equal(p.authStatus, "unsupported");
});

test("parseKubeconfig: insecure-skip-tls-verify and proxy-url carry through", () => {
  const [p] = parseKubeconfig(
    kubeconfig({ cluster: { "insecure-skip-tls-verify": true, "proxy-url": "socks5://localhost:1080" } }),
  );
  assert.equal(p.insecureSkipTlsVerify, true);
  assert.equal(p.proxyUrl, "socks5://localhost:1080");
});

test("parseKubeconfig: a context missing its cluster/server is skipped", () => {
  const cfg = stringify({
    apiVersion: "v1",
    kind: "Config",
    clusters: [],
    users: [{ name: "u1", user: { token: "t" } }],
    contexts: [{ name: "ctx", context: { cluster: "missing", user: "u1" } }],
  });
  assert.deepEqual(parseKubeconfig(cfg), []);
});

test("parseKubeconfig: malformed YAML returns no profiles (never throws)", () => {
  assert.deepEqual(parseKubeconfig("::: not yaml :::\n\tbad"), []);
});

test("parseKubeconfig: multiple contexts each become a profile", () => {
  const cfg = stringify({
    apiVersion: "v1",
    kind: "Config",
    clusters: [
      { name: "c1", cluster: { server: "https://a:6443" } },
      { name: "c2", cluster: { server: "https://b:6443" } },
    ],
    users: [
      { name: "u1", user: { token: "t1" } },
      { name: "u2", user: { token: "t2" } },
    ],
    contexts: [
      { name: "prod", context: { cluster: "c1", user: "u1" } },
      { name: "dev", context: { cluster: "c2", user: "u2" } },
    ],
  });
  const profiles = parseKubeconfig(cfg);
  assert.deepEqual(profiles.map(p => p.id).sort(), ["dev", "prod"]);
  assert.equal(profiles.find(p => p.id === "prod")?.namespace, "default"); // defaults when unset
});

test("profileToCluster: derives initials, a deterministic color, and connected flag", () => {
  const c1 = profileToCluster({ id: "docker-desktop", name: "docker-desktop", server: "s", token: "" }, true);
  assert.equal(c1.short, "DD");
  assert.equal(c1.connected, true);
  assert.match(c1.color, /^#[0-9a-f]{6}$/i);
  // deterministic: same id → same color
  const c2 = profileToCluster({ id: "docker-desktop", name: "docker-desktop", server: "s", token: "" }, false);
  assert.equal(c1.color, c2.color);
  assert.equal(c2.connected, false);
});

test("profileToCluster: numbered environments get distinct initials", () => {
  // The rail's tiles are monochrome, so the letters are what tells clusters
  // apart. First-letters-only reduced both of these to "DDU".
  const short = (name: string) => profileToCluster({ id: name, name, server: "s", token: "" }).short;
  assert.notEqual(short("dev-us-east1"), short("dev-us-east2"));
  assert.equal(short("dev-us-east1"), "DU1");
  assert.equal(short("dev-us-east2"), "DU2");
  // Names without a number keep the old three-initial behaviour.
  assert.equal(short("docker-desktop"), "DD");
  assert.equal(short("prod-eu-west"), "PEW");
});

// Integration level: exercises the real KubeGateway adapter + kubeFetch transport
// + DTO->domain mappers against the in-memory Kubernetes simulator, without a
// browser. kubeFetch posts to the relative "/api/kube" worker route; here we
// intercept that in-process and forward to the simulator exactly as the worker
// would, so the whole infrastructure path (minus the UI) is covered.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { ResourceRef } from "../../app/domain/values/resource-ref";
import { KubeGateway } from "../../app/infrastructure/kubernetes/gateway";
import type { ClusterProfile } from "../../app/lib/kube-generated";

const PORT = 7455;
const SERVER = `http://127.0.0.1:${PORT}`;
const TOKEN = "e2e";
const profile = {
  id: "sim",
  name: "sim",
  server: SERVER,
  token: TOKEN,
  authorization: `Bearer ${TOKEN}`,
} as ClusterProfile;

let simulator: ChildProcess;
const realFetch = globalThis.fetch.bind(globalThis);

// Mimic the /api/kube worker: forward the JSON-encoded request to x-kube-server.
async function workerProxy(init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  const server = headers.get("x-kube-server")!;
  const authorization = headers.get("authorization")!;
  const { path, method, body, raw } = JSON.parse(String(init.body));
  const upstream = await realFetch(`${server}${path}`, {
    method: method || "GET",
    headers: { authorization, "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  void raw;
  return upstream;
}

before(async () => {
  simulator = spawn(process.execPath, ["tests/e2e/kube-simulator.mjs"], {
    env: { ...process.env, HEIMDALL_SIM_PORT: String(PORT), HEIMDALL_SIM_TOKEN: TOKEN },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    try {
      if ((await realFetch(`${SERVER}/healthz`)).ok) break;
    } catch {
      /* retry */
    }
    await new Promise(r => setTimeout(r, 250));
  }
  // Intercept the worker route; pass everything else through.
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input === "/api/kube") return workerProxy(init || {});
    return realFetch(input, init);
  };
});

after(() => {
  globalThis.fetch = realFetch;
  simulator?.kill();
});

test("serverVersion reads the cluster version", async () => {
  const gateway = new KubeGateway(profile);
  assert.match(await gateway.serverVersion(), /^v?1\./);
});

test("listPods maps wire pods into domain pods with health inputs", async () => {
  const pods = await new KubeGateway(profile).listPods();
  assert.ok(pods.length >= 1);
  const coredns = pods.find(p => p.ref.name.startsWith("coredns"));
  assert.ok(coredns, "coredns pod present");
  assert.equal(coredns.ref.kind, "Pod");
  assert.equal(coredns.phase, "Running");
  assert.ok(coredns.containers.length >= 1);
});

test("listWorkloads / listNodes / listServices return domain shapes", async () => {
  const gateway = new KubeGateway(profile);
  const deployments = await gateway.listWorkloads("Deployment");
  assert.ok(deployments.some(w => w.ref.kind === "Deployment"));
  const nodes = await gateway.listNodes();
  assert.ok(nodes.some(n => n.roles.includes("control-plane")));
  const services = await gateway.listServices();
  assert.ok(services.some(s => s.ports.length >= 1));
});

test("generic list + get round-trip", async () => {
  const gateway = new KubeGateway(profile);
  const namespaces = await gateway.list({ apiVersion: "v1", kind: "Namespace", resource: "namespaces" });
  assert.ok(namespaces.some(o => o.ref.name === "kube-system"));
  const one = await gateway.get(ResourceRef.of({ apiVersion: "v1", kind: "Namespace", name: "default" }), "namespaces");
  assert.equal(one?.ref.name, "default");
});

test("apply then remove a namespace through the adapter", async () => {
  const gateway = new KubeGateway(profile);
  const name = "int-test-ns";
  const created = await gateway.apply({ apiVersion: "v1", kind: "Namespace", metadata: { name } });
  assert.equal(created.ref.name, name);
  const found = await gateway.get(ResourceRef.of({ apiVersion: "v1", kind: "Namespace", name }), "namespaces");
  assert.equal(found?.ref.name, name);
  await gateway.remove(ResourceRef.of({ apiVersion: "v1", kind: "Namespace", name }));
  const gone = await gateway.get(ResourceRef.of({ apiVersion: "v1", kind: "Namespace", name }), "namespaces");
  assert.equal(gone, null);
});

test("pod metrics list flows through the metrics.k8s.io path", async () => {
  const items = await new KubeGateway(profile).list({
    apiVersion: "metrics.k8s.io/v1beta1",
    kind: "PodMetrics",
    resource: "pods",
  });
  assert.ok(items.length >= 1);
});

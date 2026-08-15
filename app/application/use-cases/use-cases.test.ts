// Integration tests for the application layer, exercised through a fake
// KubernetesGateway (a test double for the driven port). This demonstrates the
// hexagon's payoff: use-cases are tested with no infrastructure — no transport,
// no wire format — only the port contract and the domain.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ResourceRef } from "../../domain/values/resource-ref";
import type { KubernetesGateway } from "../ports/kubernetes-gateway";
import { ServiceUseCases } from "./network";
import { NodeUseCases } from "./nodes";
import { PodUseCases } from "./pods";
import { ResourceUseCases } from "./resources";
import { StorageUseCases } from "./storage";
import { WorkloadUseCases } from "./workloads";

function fakeGateway(overrides: Partial<KubernetesGateway>): KubernetesGateway {
  const notImplemented = () => {
    throw new Error("not implemented in fake");
  };
  return {
    serverVersion: async () => "v1.36.0",
    discoverResources: async () => [],
    canListResources: async () => null,
    serviceProxyGet: async () => ({}) as never,
    triggerCronJob: async () => ({}) as never,
    listPods: async () => [],
    listWorkloads: async () => [],
    listNodes: async () => [],
    listServices: async () => [],
    listPersistentVolumeClaims: async () => [],
    listPersistentVolumes: async () => [],
    list: notImplemented,
    listBasic: notImplemented,
    get: notImplemented,
    apply: notImplemented,
    listCustom: notImplemented,
    applyCustom: notImplemented,
    removeCustom: notImplemented,
    getWorkloadScale: notImplemented,
    scaleWorkload: notImplemented,
    restartWorkload: notImplemented,
    setWorkloadSuspended: notImplemented,
    setNodeSchedulable: notImplemented,
    requestServiceAccountToken: notImplemented,
    remove: notImplemented,
    watch: notImplemented,
    readLogs: notImplemented,
    streamLogs: notImplemented,
    exec: notImplemented,
    portForward: notImplemented,
    ...overrides,
  };
}

const ref = (kind: string, name: string, namespace?: string) =>
  ResourceRef.of({ apiVersion: "v1", kind, name, namespace });

test("PodUseCases.list derives status and health from the domain", async () => {
  const pods = new PodUseCases(
    fakeGateway({
      listPods: async () => [
        {
          ref: ref("Pod", "ok", "default"),
          phase: "Running",
          containers: [{ name: "m" }],
          containerStatuses: [{ name: "m", ready: true, restartCount: 0, state: { kind: "running" } }],
          conditions: [{ type: "Ready", status: "True" }],
          readinessGates: [],
        },
        {
          ref: ref("Pod", "bad", "default"),
          phase: "Failed",
          containers: [],
          containerStatuses: [],
          conditions: [],
          readinessGates: [],
        },
      ],
    }),
  );
  const items = await pods.list("default");
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map(i => i.status),
    ["Running", "Failed"],
  );
  assert.deepEqual(
    items.map(i => i.hasIssues),
    [false, true],
  );
});

test("WorkloadUseCases.list summarises readiness", async () => {
  const workloads = new WorkloadUseCases(
    fakeGateway({
      listWorkloads: async () => [
        { ref: ref("Deployment", "web"), kind: "Deployment", desired: 3, ready: 2, suspended: false },
      ],
    }),
  );
  const [item] = await workloads.list("Deployment");
  assert.equal(item.ready, "2/3");
  assert.equal(item.hasIssues, true);
});

test("NodeUseCases.list reports status text and roles", async () => {
  const nodes = new NodeUseCases(
    fakeGateway({
      listNodes: async () => [
        {
          ref: ref("Node", "cp"),
          roles: ["control-plane"],
          schedulable: true,
          conditions: [{ type: "Ready", status: "True" }],
          addresses: [],
        },
      ],
    }),
  );
  const [item] = await nodes.list();
  assert.equal(item.status, "Ready");
  assert.equal(item.roles, "control-plane");
});

test("ServiceUseCases.list summarises ports and headlessness", async () => {
  const services = new ServiceUseCases(
    fakeGateway({
      listServices: async () => [
        {
          ref: ref("Service", "dns", "kube-system"),
          type: "ClusterIP",
          clusterIP: "10.0.0.10",
          ports: [{ port: 53, protocol: "UDP" }],
          selector: {},
          externalIPs: [],
          loadBalancerIngress: [],
        },
      ],
    }),
  );
  const [item] = await services.list("kube-system");
  assert.equal(item.ports, "53/UDP");
  assert.equal(item.headless, false);
  assert.deepEqual(item.endpoints, []);
});

test("StorageUseCases reports binding for claims and volumes", async () => {
  const storage = new StorageUseCases(
    fakeGateway({
      listPersistentVolumeClaims: async () => [
        { ref: ref("PersistentVolumeClaim", "bound", "default"), phase: "Bound", accessModes: [] },
        { ref: ref("PersistentVolumeClaim", "pending", "default"), phase: "Pending", accessModes: [] },
      ],
      listPersistentVolumes: async () => [{ ref: ref("PersistentVolume", "pv"), phase: "Available", accessModes: [] }],
    }),
  );
  const claims = await storage.listClaims("default");
  assert.deepEqual(
    claims.map(c => c.bound),
    [true, false],
  );
  const volumes = await storage.listVolumes();
  assert.equal(volumes[0].bound, false);
});

test("ResourceUseCases delegates generic CRUD to the gateway", async () => {
  const calls: string[] = [];
  const uc = new ResourceUseCases(
    fakeGateway({
      list: async (q: { kind: string }) => {
        calls.push(`list:${q.kind}`);
        return [{ ref: ref("ConfigMap", "cm", "default"), raw: {} }];
      },
      get: async () => {
        calls.push("get");
        return { ref: ref("ConfigMap", "cm", "default"), raw: {} };
      },
      apply: async () => {
        calls.push("apply");
        return { ref: ref("ConfigMap", "cm", "default"), raw: {} };
      },
      remove: async () => {
        calls.push("remove");
      },
    }),
  );
  const items = await uc.list({ apiVersion: "v1", kind: "ConfigMap", resource: "configmaps", namespace: "default" });
  assert.equal(items.length, 1);
  await uc.get(ref("ConfigMap", "cm", "default"), "configmaps");
  await uc.apply({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "cm" } });
  await uc.remove(ref("ConfigMap", "cm", "default"), "configmaps");
  assert.deepEqual(calls, ["list:ConfigMap", "get", "apply", "remove"]);
});

test("PodUseCases delegates logs and shell to the gateway", async () => {
  let logsArgs: unknown;
  let execArgs: unknown;
  const pods = new PodUseCases(
    fakeGateway({
      readLogs: async (r: unknown, o: unknown) => {
        logsArgs = { r, o };
        return "line\n";
      },
      exec: (r: unknown, cmd: unknown) => {
        execArgs = { r, cmd };
        return { send() {}, resize() {}, close() {} };
      },
    }),
  );
  const podRef = ref("Pod", "p", "default");
  assert.equal(await pods.readLogs(podRef, { container: "main" }), "line\n");
  assert.deepEqual((logsArgs as { o: unknown }).o, { container: "main" });
  pods.shell(podRef, { onStdout() {} });
  assert.deepEqual((execArgs as { cmd: string[] }).cmd, ["/bin/sh"]);
});

test("PodUseCases.streamLogs hands the chunk callback straight to the gateway", () => {
  // Delegation only, but an undelegated method is a silently dead log stream —
  // and the body could be emptied without any other test noticing.
  let seen: { r: unknown; o: unknown } | undefined;
  const chunks: string[] = [];
  const pods = new PodUseCases(
    fakeGateway({
      streamLogs: (r: unknown, o: unknown, onChunk: (t: string) => void) => {
        seen = { r, o };
        onChunk("hello");
        return () => {};
      },
    }),
  );
  const podRef = ref("Pod", "p", "default");
  const stop = pods.streamLogs(podRef, { container: "main" }, t => chunks.push(t));
  assert.deepEqual(chunks, ["hello"]);
  assert.deepEqual((seen as { o: unknown }).o, { container: "main" });
  assert.equal(typeof stop, "function");
});

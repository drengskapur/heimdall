import assert from "node:assert/strict";
import { test } from "node:test";
import { PodHealth } from "../../domain/workload/pod";
import { toPodDomain } from "./pod-mapper";

test("maps a running pod DTO into a healthy domain pod", () => {
  const pod = toPodDomain({
    metadata: { name: "coredns-abc", namespace: "kube-system", uid: "u1", creationTimestamp: "2026-01-01T00:00:00Z" },
    spec: { containers: [{ name: "main" }] },
    status: {
      phase: "Running",
      conditions: [{ type: "Ready", status: "True" }],
      containerStatuses: [{ name: "main", ready: true, restartCount: 0, state: { running: {} } }],
    },
  });
  assert.equal(pod.ref.name, "coredns-abc");
  assert.equal(pod.ref.namespace, "kube-system");
  assert.equal(pod.containers.length, 1);
  assert.equal(pod.containerStatuses[0].state.kind, "running");
  assert.equal(PodHealth.hasIssues(pod), false);
});

test("maps init containers and a crash-looping status", () => {
  const pod = toPodDomain({
    metadata: { name: "p", namespace: "default" },
    spec: { initContainers: [{ name: "init", restartPolicy: "Always" }], containers: [{ name: "main" }] },
    status: {
      phase: "Running",
      containerStatuses: [
        { name: "main", ready: false, restartCount: 9, state: { waiting: { reason: "CrashLoopBackOff" } } },
      ],
    },
  });
  assert.equal(pod.containers.filter(c => c.init).length, 1);
  assert.equal(pod.containerStatuses[0].state.reason, "CrashLoopBackOff");
  assert.equal(PodHealth.hasIssues(pod), true);
});

test("maps identity and lifecycle fields", () => {
  const pod = toPodDomain({
    metadata: {
      name: "p",
      namespace: "ns",
      uid: "u9",
      creationTimestamp: "2026-01-01T00:00:00Z",
      deletionTimestamp: "2026-01-02T00:00:00Z",
      finalizers: ["kubernetes"],
    },
    spec: { containers: [{ name: "main" }] },
    status: { phase: "Running", reason: "Evicted" },
  });
  assert.equal(pod.ref.uid, "u9");
  assert.equal(pod.ref.namespace, "ns");
  assert.equal(pod.createdAt, "2026-01-01T00:00:00Z");
  assert.equal(pod.deletionTimestamp, "2026-01-02T00:00:00Z");
  assert.deepEqual(pod.finalizers, ["kubernetes"]);
  assert.equal(pod.reason, "Evicted");
});

test("maps container restartCount, readiness gates, and terminated exit code", () => {
  const pod = toPodDomain({
    spec: { containers: [{ name: "main" }], readinessGates: [{ conditionType: "www.example.com/gate" }] },
    metadata: { name: "p" },
    status: {
      phase: "Running",
      containerStatuses: [
        { name: "main", ready: false, restartCount: 4, state: { terminated: { exitCode: 137, reason: "OOMKilled" } } },
      ],
    },
  });
  assert.deepEqual(pod.readinessGates, ["www.example.com/gate"]);
  assert.equal(pod.containerStatuses[0].restartCount, 4);
  assert.equal(pod.containerStatuses[0].state.kind, "terminated");
  assert.equal(pod.containerStatuses[0].state.exitCode, 137);
  assert.equal(pod.containerStatuses[0].state.reason, "OOMKilled");
});

test("handles an empty/partial DTO without throwing", () => {
  const pod = toPodDomain({ metadata: { name: "x" } });
  assert.equal(pod.containers.length, 0);
  assert.equal(pod.containerStatuses.length, 0);
  assert.equal(pod.conditions.length, 0);
  assert.equal(pod.readinessGates.length, 0);
  assert.equal(pod.phase, undefined);
  assert.equal(PodHealth.hasIssues(pod), true); // no phase -> unhealthy
});

test("defaults missing names/types to empty strings", () => {
  const pod = toPodDomain({
    metadata: { name: "x" },
    spec: { containers: [{}] },
    status: { phase: "Running", containerStatuses: [{ ready: true, state: {} }], conditions: [{}] },
  });
  assert.equal(pod.containers[0].name, "");
  assert.equal(pod.containerStatuses[0].name, "");
  assert.equal(pod.containerStatuses[0].restartCount, 0);
  assert.equal(pod.containerStatuses[0].state.kind, "running", "ready with empty state → running");
  assert.equal(pod.conditions[0].type, "");
  assert.equal(pod.conditions[0].status, "");
});

test("a container status with no recognizable state and not ready is unknown", () => {
  const pod = toPodDomain({
    metadata: { name: "x" },
    spec: { containers: [{ name: "m" }] },
    status: { phase: "Pending", containerStatuses: [{ name: "m", ready: false, state: {} }] },
  });
  assert.equal(pod.containerStatuses[0].state.kind, "unknown");
});

// A mapper's job is every field, not the interesting ones. Mutation testing
// found that init containers, readiness gates, owner references and the state
// kinds were all mapped but never asserted, so breaking any of them was free.
test("maps every field of a fully populated pod", () => {
  const pod = toPodDomain({
    metadata: {
      name: "web-0",
      namespace: "shop",
      uid: "uid-1",
      creationTimestamp: "2026-01-01T00:00:00Z",
      deletionTimestamp: "2026-01-02T00:00:00Z",
      finalizers: ["kubernetes.io/pvc-protection"],
      ownerReferences: [{ kind: "StatefulSet", name: "web", apiVersion: "apps/v1", uid: "o1" }],
    },
    spec: {
      nodeName: "node-a",
      initContainers: [{ name: "migrate", restartPolicy: "Always" }],
      containers: [{ name: "app" }],
      readinessGates: [{ conditionType: "example.com/gate" }],
    },
    status: {
      phase: "Running",
      reason: "SomeReason",
      podIP: "10.1.2.3",
      qosClass: "Burstable",
      conditions: [{ type: "Ready", status: "True" }],
      containerStatuses: [
        { name: "app", ready: true, restartCount: 2, state: { running: { startedAt: "2026-01-01T00:00:00Z" } } },
      ],
      initContainerStatuses: [
        { name: "migrate", ready: false, restartCount: 1, state: { terminated: { exitCode: 0, reason: "Completed" } } },
      ],
      ephemeralContainerStatuses: [
        { name: "debug", ready: false, restartCount: 0, state: { waiting: { reason: "ContainerCreating" } } },
      ],
    },
  });

  // Identity. The apiVersion is fixed by the mapper, not read from the wire.
  assert.equal(pod.ref.apiVersion, "v1");
  assert.equal(pod.ref.kind, "Pod");
  assert.equal(pod.ref.name, "web-0");
  assert.equal(pod.ref.namespace, "shop");

  assert.deepEqual(pod.containers, [
    { name: "migrate", init: true, restartPolicy: "Always" },
    { name: "app", init: false, restartPolicy: undefined },
  ]);

  // Regular, then init, then ephemeral — and each state kind distinguished.
  assert.deepEqual(
    pod.containerStatuses.map(s => [s.name, s.ready, s.restartCount, s.state.kind]),
    [
      ["app", true, 2, "running"],
      ["migrate", false, 1, "terminated"],
      ["debug", false, 0, "waiting"],
    ],
  );
  assert.equal(pod.containerStatuses[1]?.state.exitCode, 0);
  assert.equal(pod.containerStatuses[1]?.state.reason, "Completed");
  assert.equal(pod.containerStatuses[2]?.state.reason, "ContainerCreating");

  assert.deepEqual(pod.readinessGates, ["example.com/gate"]);
  assert.deepEqual(pod.owners, [{ kind: "StatefulSet", name: "web" }]);
  assert.deepEqual(pod.conditions, [{ type: "Ready", status: "True" }]);
  assert.deepEqual(pod.finalizers, ["kubernetes.io/pvc-protection"]);
  assert.equal(pod.nodeName, "node-a");
  assert.equal(pod.podIP, "10.1.2.3");
  assert.equal(pod.qosClass, "Burstable");
  assert.equal(pod.phase, "Running");
  assert.equal(pod.reason, "SomeReason");
  assert.equal(pod.createdAt, "2026-01-01T00:00:00Z");
  assert.equal(pod.deletionTimestamp, "2026-01-02T00:00:00Z");
});

test("absent collections map to empty ones, and nameless entries to empty strings", () => {
  const bare = toPodDomain({ metadata: { name: "p" }, spec: {}, status: {} });
  assert.deepEqual(bare.owners, []);
  assert.deepEqual(bare.readinessGates, []);
  assert.deepEqual(bare.containers, []);

  // A pod with no name is refused rather than given a placeholder: the ref is
  // the object's identity, and an identity that was made up is worse than none.
  assert.throws(() => toPodDomain({ metadata: {}, spec: {}, status: {} }), /name/i);

  const nameless = toPodDomain({
    metadata: {
      name: "p",
      ownerReferences: [{ kind: undefined, name: undefined }],
    },
    spec: {
      initContainers: [{ name: undefined }],
      // A gate with no conditionType is dropped rather than mapped to "".
      readinessGates: [{ conditionType: undefined }, { conditionType: "kept" }],
    },
    status: {},
  });
  assert.deepEqual(nameless.containers, [{ name: "", init: true, restartPolicy: undefined }]);
  assert.deepEqual(nameless.owners, [{ kind: "", name: "" }]);
  assert.deepEqual(nameless.readinessGates, ["kept"]);
});

test("a running container that is not ready is still running", () => {
  // The `ready` flag is only a fallback for a container with no recognisable
  // state. An explicit running state outranks it, which only shows when the two
  // disagree — a container up but failing its readiness probe.
  const pod = toPodDomain({
    metadata: { name: "p" },
    spec: { containers: [{ name: "app" }] },
    status: {
      containerStatuses: [{ name: "app", ready: false, restartCount: 0, state: { running: {} } }],
    },
  });
  assert.equal(pod.containerStatuses[0]?.state.kind, "running");
  assert.equal(pod.containerStatuses[0]?.ready, false);
});

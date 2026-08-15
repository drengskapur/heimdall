import assert from "node:assert/strict";
import { test } from "node:test";
import { allocationByNode, type NodeInput, type PodInput, requestsOf } from "../../app/ui/topology/node-allocation.ts";

const node = (name: string, cpu?: string, mem?: string): NodeInput => ({
  name,
  allocatableCpu: cpu,
  allocatableMemory: mem,
  health: "Healthy",
});

const pod = (
  name: string,
  nodeName: string,
  cpu?: string,
  memory?: string,
  extra: Partial<PodInput> = {},
): PodInput => ({
  name,
  nodeName,
  health: "Healthy",
  requests: [{ cpu, memory }],
  ...extra,
});

test("requests sum across the pods on a node", () => {
  const [a] = allocationByNode([node("a", "4", "8Gi")], [pod("p1", "a", "500m", "1Gi"), pod("p2", "a", "1", "2Gi")]);
  assert.equal(a.cpu.requested, 1500);
  assert.equal(a.podCount, 2);
  assert.equal(a.cpu.ratio, 1500 / 4000);
  assert.equal(a.memory.ratio, 3 / 8);
});

test("requests sum across the containers in a pod", () => {
  const twoContainers: PodInput = {
    name: "sidecar-pod",
    nodeName: "a",
    health: "Healthy",
    requests: [{ cpu: "250m" }, { cpu: "250m" }],
  };
  const [a] = allocationByNode([node("a", "1")], [twoContainers]);
  assert.equal(a.cpu.requested, 500);
});

test("finished pods hold nothing and are not counted", () => {
  const [a] = allocationByNode(
    [node("a", "4")],
    [
      pod("done", "a", "2", undefined, { phase: "Succeeded" }),
      pod("failed", "a", "1", undefined, { phase: "Failed" }),
      pod("live", "a", "500m"),
    ],
  );
  assert.equal(a.cpu.requested, 500);
  assert.equal(a.podCount, 1);
});

test("an unscheduled pod belongs to no node", () => {
  const [a] = allocationByNode(
    [node("a", "4")],
    [{ name: "pending", health: "Progressing", requests: [{ cpu: "1" }] }],
  );
  assert.equal(a.podCount, 0);
  assert.equal(a.cpu.requested, 0);
});

test("a pod with no requests contributes nothing but still counts as scheduled", () => {
  const [a] = allocationByNode([node("a", "4")], [pod("best-effort", "a")]);
  assert.equal(a.cpu.requested, 0);
  assert.equal(a.podCount, 1);
});

test("an unknown allocatable reports zero rather than a full bar", () => {
  // An unmeasurable node must not look full, and must not look empty-and-fine.
  const [a] = allocationByNode([node("a")], [pod("p", "a", "1")]);
  assert.equal(a.cpu.allocatable, 0);
  assert.equal(a.cpu.ratio, 0);
  assert.match(a.cpu.text, /\?$/);
});

test("health rolls up from the pods on the node", () => {
  const [a] = allocationByNode(
    [node("a", "4")],
    [pod("ok", "a", "1"), { name: "bad", nodeName: "a", health: "Degraded", requests: [] }],
  );
  assert.equal(a.health, "Healthy");
  assert.equal(a.rollup, "Degraded");
});

test("the fullest node sorts first, by whichever resource is tighter", () => {
  const result = allocationByNode(
    [node("roomy", "8", "8Gi"), node("tight-mem", "8", "1Gi"), node("tight-cpu", "1", "8Gi")],
    [pod("a", "roomy", "1", "1Gi"), pod("b", "tight-mem", "1", "900Mi"), pod("c", "tight-cpu", "900m", "1Gi")],
  );
  // tight-cpu is at 0.9 of its CPU, tight-mem at ~0.88 of its memory, roomy 0.125.
  assert.deepEqual(
    result.map(r => r.name),
    ["tight-cpu", "tight-mem", "roomy"],
  );
});

test("nodes with nothing on them still appear", () => {
  const result = allocationByNode([node("empty", "4", "8Gi")], []);
  assert.equal(result.length, 1);
  assert.equal(result[0].podCount, 0);
  assert.equal(result[0].cpu.ratio, 0);
});

test("requestsOf reads each container's requests and tolerates absent ones", () => {
  assert.deepEqual(
    requestsOf({
      containers: [{ resources: { requests: { cpu: "100m", memory: "64Mi" } } }, { name: "no-resources" }],
    }),
    [
      { cpu: "100m", memory: "64Mi" },
      { cpu: undefined, memory: undefined },
    ],
  );
  assert.deepEqual(requestsOf({}), []);
  assert.deepEqual(requestsOf(undefined), []);
  assert.deepEqual(requestsOf({ containers: "not-an-array" }), []);
});

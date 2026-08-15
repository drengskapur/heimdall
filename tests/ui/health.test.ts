import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HEALTH_PRIORITY,
  type Health,
  healthIntent,
  nodeHealth,
  phaseHealth,
  podHealth,
  replicaHealth,
  worstHealth,
} from "../../app/ui/resource/health.ts";

test("the priority order is Argo's, worst first", () => {
  const codes: Health[] = ["Missing", "Degraded", "Unknown", "Progressing", "Suspended", "Healthy"];
  const priorities = codes.map(c => HEALTH_PRIORITY[c]);
  assert.deepEqual(priorities, [0, 1, 2, 3, 4, 5]);
  // The point of the ordering: sorting ascending puts the worst rows on top.
  const sorted = [...codes].reverse().sort((a, b) => HEALTH_PRIORITY[a] - HEALTH_PRIORITY[b]);
  assert.deepEqual(sorted, codes);
});

test("a rollup takes the worst child, not the most common", () => {
  assert.equal(worstHealth(["Healthy", "Healthy", "Degraded"]), "Degraded");
  assert.equal(worstHealth(["Progressing", "Suspended"]), "Progressing");
  assert.equal(worstHealth(["Healthy", "Healthy"]), "Healthy");
  // No children is not a problem — an empty group is healthy, not unknown.
  assert.equal(worstHealth([]), "Healthy");
});

test("a container issue outranks a Running phase", () => {
  // The case a phase alone gets wrong: the pod is Running while something
  // inside it crash-loops.
  assert.equal(podHealth("Running", true), "Degraded");
  assert.equal(podHealth("Running", false), "Healthy");
  assert.equal(podHealth("Succeeded", false), "Healthy");
  assert.equal(podHealth("Pending", false), "Progressing");
  assert.equal(podHealth("Failed", false), "Degraded");
  assert.equal(podHealth("SomethingNew", false), "Unknown");
});

test("a cordoned node is suspended, not broken", () => {
  assert.equal(nodeHealth(false, "SchedulingDisabled"), "Suspended");
  assert.equal(nodeHealth(true, "Ready"), "Healthy");
  assert.equal(nodeHealth(false, "NotReady"), "Degraded");
});

test("volume phases map onto the scale", () => {
  assert.equal(phaseHealth("Bound"), "Healthy");
  assert.equal(phaseHealth("Available"), "Healthy");
  assert.equal(phaseHealth("Pending"), "Progressing");
  assert.equal(phaseHealth("Released"), "Suspended");
  assert.equal(phaseHealth("Failed"), "Degraded");
  assert.equal(phaseHealth(undefined), "Unknown");
});

test("scaled to zero is suspended, and no replicas ready is degraded", () => {
  // Not Healthy: calling a scale-to-zero healthy hides a scale-down that was
  // not meant to happen.
  assert.equal(replicaHealth(0, 0), "Suspended");
  assert.equal(replicaHealth(0, 3), "Degraded");
  assert.equal(replicaHealth(1, 3), "Progressing");
  assert.equal(replicaHealth(3, 3), "Healthy");
  // More ready than desired happens mid-rollout and is not a fault.
  assert.equal(replicaHealth(4, 3), "Healthy");
});

test("suspended is not coloured as a fault", () => {
  assert.equal(healthIntent("Suspended"), "none");
  assert.equal(healthIntent("Healthy"), "success");
  assert.equal(healthIntent("Progressing"), "primary");
  assert.equal(healthIntent("Degraded"), "danger");
  assert.equal(healthIntent("Missing"), "danger");
  assert.equal(healthIntent("Unknown"), "warning");
});

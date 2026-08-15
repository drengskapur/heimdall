import assert from "node:assert/strict";
import { test } from "node:test";
import { ResourceRef } from "../values/resource-ref";
import { type Workload, WorkloadStatus } from "./workload";

// WorkloadStatus had no test of its own — it was only exercised through its
// mapper, which meant the suspension short-circuits were never the reason for
// any answer. Mutation testing found both of them deletable.

const workload = (overrides: Partial<Workload> = {}): Workload => ({
  ref: ResourceRef.of({ apiVersion: "apps/v1", kind: "Deployment", name: "web", namespace: "shop" }),
  kind: "Deployment",
  desired: 1,
  ready: 1,
  suspended: false,
  ...overrides,
});

test("a suspended workload is neither ready nor a problem", () => {
  // Fully rolled out but suspended: without the short-circuit this reads ready.
  assert.equal(WorkloadStatus.isReady(workload({ kind: "CronJob", desired: 2, ready: 2, suspended: true })), false);
  // Nothing ready but suspended: without it, this reads unhealthy. A paused
  // CronJob is doing exactly what was asked of it.
  assert.equal(WorkloadStatus.hasIssues(workload({ kind: "CronJob", desired: 2, ready: 0, suspended: true })), false);
});

test("readiness needs every replica, not merely some", () => {
  const partial = workload({ desired: 3, ready: 2 });
  assert.equal(WorkloadStatus.isReady(partial), false);
  assert.equal(WorkloadStatus.hasIssues(partial), true);

  const complete = workload({ desired: 3, ready: 3 });
  assert.equal(WorkloadStatus.isReady(complete), true);
  assert.equal(WorkloadStatus.hasIssues(complete), false);
});

test("a workload that wants nothing is neither ready nor unhealthy", () => {
  // Scaled to zero on purpose: there is nothing to be ready, and nothing wrong.
  const scaledToZero = workload({ desired: 0, ready: 0 });
  assert.equal(WorkloadStatus.isReady(scaledToZero), false);
  assert.equal(WorkloadStatus.hasIssues(scaledToZero), false);
});

test("the ready summary is ready over desired", () => {
  assert.equal(WorkloadStatus.readySummary(workload({ desired: 3, ready: 2 })), "2/3");
  assert.equal(WorkloadStatus.readySummary(workload({ desired: 0, ready: 0 })), "0/0");
});

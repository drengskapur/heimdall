import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkloadStatus } from "../../domain/workload/workload";
import { toWorkloadDomain } from "./workload-mapper";

test("Deployment counts come from replicas/readyReplicas", () => {
  const w = toWorkloadDomain({
    kind: "Deployment",
    apiVersion: "apps/v1",
    metadata: { name: "coredns", namespace: "kube-system" },
    spec: { replicas: 2 },
    status: { replicas: 2, readyReplicas: 2 },
  });
  assert.equal(WorkloadStatus.readySummary(w), "2/2");
  assert.equal(WorkloadStatus.isReady(w), true);
  assert.equal(WorkloadStatus.hasIssues(w), false);
});

test("DaemonSet uses scheduled/ready counts", () => {
  const w = toWorkloadDomain({
    kind: "DaemonSet",
    metadata: { name: "agent" },
    status: { desiredNumberScheduled: 3, numberReady: 1 },
  });
  assert.equal(WorkloadStatus.readySummary(w), "1/3");
  assert.equal(WorkloadStatus.hasIssues(w), true);
});

test("Job uses completions/succeeded", () => {
  const w = toWorkloadDomain({
    kind: "Job",
    metadata: { name: "j" },
    spec: { completions: 1 },
    status: { succeeded: 1 },
  });
  assert.equal(WorkloadStatus.readySummary(w), "1/1");
  assert.equal(WorkloadStatus.isReady(w), true);
});

test("maps ref identity, createdAt, and StatefulSet/ReplicationController counts", () => {
  const ss = toWorkloadDomain({
    kind: "StatefulSet",
    apiVersion: "apps/v1",
    metadata: { name: "db", namespace: "data", uid: "u1", creationTimestamp: "2026-01-01T00:00:00Z" },
    spec: { replicas: 3 },
    status: { readyReplicas: 3 },
  });
  assert.equal(ss.ref.kind, "StatefulSet");
  assert.equal(ss.ref.namespace, "data");
  assert.equal(ss.ref.uid, "u1");
  assert.equal(ss.createdAt, "2026-01-01T00:00:00Z");
  assert.equal(WorkloadStatus.readySummary(ss), "3/3");
  const rc = toWorkloadDomain({
    kind: "ReplicationController",
    metadata: { name: "rc" },
    spec: { replicas: 2 },
    status: { readyReplicas: 1 },
  });
  assert.equal(WorkloadStatus.readySummary(rc), "1/2");
});

test("bare workload defaults counts to zero and apiVersion to apps/v1", () => {
  const w = toWorkloadDomain({ kind: "Deployment", metadata: { name: "d" } });
  assert.equal(w.desired, 0);
  assert.equal(w.ready, 0);
  assert.equal(w.suspended, false);
  assert.equal(w.ref.apiVersion, "apps/v1");
});

test("Job defaults completions to 1 when unspecified", () => {
  const w = toWorkloadDomain({ kind: "Job", metadata: { name: "j" }, status: { succeeded: 1 } });
  assert.equal(WorkloadStatus.readySummary(w), "1/1", "no spec.completions → desired 1");
});

test("CronJob active count handles a numeric fallback", () => {
  const w = toWorkloadDomain({ kind: "CronJob", metadata: { name: "c" }, status: { active: 2 } });
  assert.equal(w.ready, 2);
});

test("zero-desired workload is neither ready nor an issue", () => {
  const w = toWorkloadDomain({ kind: "Deployment", metadata: { name: "d" }, spec: { replicas: 0 }, status: {} });
  assert.equal(WorkloadStatus.isReady(w), false);
  assert.equal(WorkloadStatus.hasIssues(w), false);
});

test("suspended CronJob is not ready but not an issue", () => {
  const w = toWorkloadDomain({
    kind: "CronJob",
    metadata: { name: "c" },
    spec: { suspend: true, schedule: "*/5 * * * *" },
    status: { active: [] },
  });
  assert.equal(w.suspended, true);
  assert.equal(w.schedule, "*/5 * * * *");
  assert.equal(WorkloadStatus.isReady(w), false);
  assert.equal(WorkloadStatus.hasIssues(w), false);
});

test("a workload without a name is refused rather than given a placeholder", () => {
  // The ref is the object's identity; inventing one would make an unnamed
  // workload look like a real, addressable object.
  assert.throws(() => toWorkloadDomain({ kind: "Deployment", metadata: {} }), /name/i);
});

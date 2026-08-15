import assert from "node:assert/strict";
import { test } from "node:test";
import { ResourceRef } from "../values/resource-ref";
import { type Pod, PodHealth } from "./pod";

const basePod = (overrides: Partial<Pod> = {}): Pod => ({
  ref: ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "p", namespace: "default" }),
  phase: "Running",
  containers: [{ name: "main" }],
  containerStatuses: [{ name: "main", ready: true, restartCount: 0, state: { kind: "running" } }],
  conditions: [{ type: "Ready", status: "True" }],
  readinessGates: [],
  ...overrides,
});

test("healthy running pod has no issues", () => {
  assert.equal(PodHealth.hasIssues(basePod()), false);
  assert.equal(PodHealth.statusMessage(basePod()), "Running");
});

test("succeeded pod is healthy", () => {
  assert.equal(PodHealth.hasIssues(basePod({ phase: "Succeeded", conditions: [] })), false);
});

test("failed / pending / unknown phases are unhealthy", () => {
  for (const phase of ["Failed", "Pending", "Unknown"]) {
    assert.equal(PodHealth.hasIssues(basePod({ phase, conditions: [] })), true, phase);
  }
});

test("CrashLoopBackOff is unhealthy even when a phase looks ok", () => {
  const pod = basePod({
    conditions: [],
    containerStatuses: [
      { name: "main", ready: false, restartCount: 5, state: { kind: "waiting", reason: "CrashLoopBackOff" } },
    ],
  });
  assert.equal(PodHealth.hasIssues(pod), true);
});

test("evicted and terminating status messages", () => {
  assert.equal(PodHealth.statusMessage(basePod({ reason: "Evicted" })), "Evicted");
  const terminating = basePod({ deletionTimestamp: "2026-01-01T00:00:00Z" });
  assert.equal(PodHealth.statusMessage(terminating), "Terminating");
  const finalizing = basePod({
    deletionTimestamp: "2026-01-01T00:00:00Z",
    finalizers: ["kubernetes"],
    containerStatuses: [{ name: "main", ready: false, restartCount: 0, state: { kind: "terminated", exitCode: 0 } }],
  });
  assert.equal(PodHealth.statusMessage(finalizing), "Finalizing");
});

test("a sidecar init container (restartPolicy Always) that isn't ready is unhealthy", () => {
  const pod = basePod({
    conditions: [],
    containers: [{ name: "sidecar", init: true, restartPolicy: "Always" }, { name: "main" }],
    containerStatuses: [
      { name: "sidecar", ready: false, restartCount: 0, state: { kind: "waiting" } },
      { name: "main", ready: true, restartCount: 0, state: { kind: "running" } },
    ],
  });
  assert.equal(PodHealth.hasIssues(pod), true);
});

test("a plain (non-sidecar) init container does not gate readiness", () => {
  const pod = basePod({
    conditions: [],
    containers: [{ name: "setup", init: true }, { name: "main" }],
    containerStatuses: [{ name: "main", ready: true, restartCount: 0, state: { kind: "running" } }],
  });
  assert.equal(PodHealth.hasIssues(pod), false);
});

test("a terminated container with exit code 0 is not an issue", () => {
  const pod = basePod({
    conditions: [],
    containerStatuses: [{ name: "main", ready: false, restartCount: 0, state: { kind: "terminated", exitCode: 0 } }],
  });
  assert.equal(PodHealth.hasIssues(pod), false);
});

test("unready readiness gate makes a pod unhealthy", () => {
  const pod = basePod({ conditions: [{ type: "Ready", status: "False" }], readinessGates: ["www.example.com/gate"] });
  assert.equal(PodHealth.hasIssues(pod), true);
});

test("a satisfied readiness gate keeps the pod healthy", () => {
  const pod = basePod({
    conditions: [{ type: "www.example.com/gate", status: "True" }],
    readinessGates: ["www.example.com/gate"],
  });
  assert.equal(PodHealth.hasIssues(pod), false);
});

test("a required container with no status at all is unhealthy", () => {
  const pod = basePod({ conditions: [], containers: [{ name: "main" }], containerStatuses: [] });
  assert.equal(PodHealth.hasIssues(pod), true);
});

test("no phase is unhealthy; statusMessage falls back to Waiting", () => {
  const pod = basePod({ phase: undefined });
  assert.equal(PodHealth.hasIssues(pod), true);
  assert.equal(PodHealth.statusMessage(pod), "Waiting");
});

test("statusMessage: terminating triggered by a waiting container", () => {
  const pod = basePod({
    deletionTimestamp: "2026-01-01T00:00:00Z",
    containerStatuses: [
      { name: "main", ready: false, restartCount: 0, state: { kind: "waiting", reason: "ContainerCreating" } },
    ],
  });
  assert.equal(PodHealth.statusMessage(pod), "Terminating");
});

test("statusMessage: deleting with only terminated containers and no finalizers shows the phase", () => {
  const pod = basePod({
    phase: "Running",
    deletionTimestamp: "2026-01-01T00:00:00Z",
    finalizers: [],
    containerStatuses: [{ name: "main", ready: false, restartCount: 0, state: { kind: "terminated", exitCode: 0 } }],
  });
  assert.equal(PodHealth.statusMessage(pod), "Running");
});

// The tests below isolate a single branch each. Mutation testing showed the
// earlier ones asserted the right answer while reaching it down a different
// path — a pod that crash-loops is also a pod with an unready container, so
// breaking the CrashLoopBackOff check changed nothing anyone was measuring.

test("CrashLoopBackOff outranks a Ready condition, and nothing else about the pod does", () => {
  // Ready=True would return healthy on the next line, so this pod is unhealthy
  // *only* because of the crash loop. Weakening that check flips the answer.
  const pod = basePod({
    conditions: [{ type: "Ready", status: "True" }],
    containerStatuses: [
      { name: "main", ready: true, restartCount: 5, state: { kind: "waiting", reason: "CrashLoopBackOff" } },
    ],
  });
  assert.equal(PodHealth.hasIssues(pod), true);
});

test("a container waiting for some other reason is not a crash loop", () => {
  // ContainerCreating is waiting, but waiting is not the fault — only the pair
  // of kind *and* reason is.
  const pod = basePod({
    conditions: [{ type: "Ready", status: "True" }],
    containerStatuses: [
      { name: "main", ready: true, restartCount: 0, state: { kind: "waiting", reason: "ContainerCreating" } },
    ],
  });
  assert.equal(PodHealth.hasIssues(pod), false);
});

test("one crash-looping container out of several is enough", () => {
  const pod = basePod({
    conditions: [{ type: "Ready", status: "True" }],
    containers: [{ name: "main" }, { name: "sidecar" }],
    containerStatuses: [
      { name: "main", ready: true, restartCount: 0, state: { kind: "running" } },
      { name: "sidecar", ready: true, restartCount: 9, state: { kind: "waiting", reason: "CrashLoopBackOff" } },
    ],
  });
  assert.equal(PodHealth.hasIssues(pod), true);
});

test("only a Ready condition clears a pod, not any condition that happens to be True", () => {
  // Initialized=True is True, and means nothing about readiness. Matching on the
  // status alone would call an unready pod healthy.
  const pod = basePod({
    conditions: [{ type: "Initialized", status: "True" }],
    containerStatuses: [{ name: "main", ready: false, restartCount: 0, state: { kind: "running" } }],
  });
  assert.equal(PodHealth.hasIssues(pod), true);
});

test("Succeeded short-circuits every later check, including readiness gates", () => {
  // A completed pod keeps an unsatisfied gate — which would read as unhealthy if
  // the phase were not answered first.
  const pod = basePod({
    phase: "Succeeded",
    conditions: [],
    readinessGates: ["example.com/gate"],
    containerStatuses: [{ name: "main", ready: false, restartCount: 0, state: { kind: "terminated", exitCode: 0 } }],
  });
  assert.equal(PodHealth.hasIssues(pod), false);
});

test("a Ready condition clears a pod whose container reports unready", () => {
  // The Ready condition is the pod-level verdict and it wins: without that early
  // return the unready container below would be read as a fault.
  const pod = basePod({
    conditions: [{ type: "Ready", status: "True" }],
    containerStatuses: [{ name: "main", ready: false, restartCount: 0, state: { kind: "running" } }],
  });
  assert.equal(PodHealth.hasIssues(pod), false);
});

test("statusMessage: one container still alive is enough to be Terminating", () => {
  // Deleting a pod stops its containers one at a time, so a mixed state is the
  // normal case rather than the edge one.
  const pod = basePod({
    deletionTimestamp: "2026-01-01T00:00:00Z",
    containers: [{ name: "main" }, { name: "sidecar" }],
    containerStatuses: [
      { name: "main", ready: false, restartCount: 0, state: { kind: "terminated", exitCode: 0 } },
      { name: "sidecar", ready: true, restartCount: 0, state: { kind: "running" } },
    ],
  });
  assert.equal(PodHealth.statusMessage(pod), "Terminating");
});

test("statusMessage: a deleting pod with no finalizers field at all shows the phase", () => {
  // `finalizers` is optional, so the absent case — not the empty-array case — is
  // what the optional chain is there for.
  const pod = basePod({
    phase: "Running",
    deletionTimestamp: "2026-01-01T00:00:00Z",
    containerStatuses: [{ name: "main", ready: false, restartCount: 0, state: { kind: "terminated", exitCode: 0 } }],
  });
  assert.equal(pod.finalizers, undefined);
  assert.equal(PodHealth.statusMessage(pod), "Running");
});

test("a terminated container is not crash-looping, whatever reason it carries", () => {
  // The mapper copies `reason` from either the waiting or the terminated state,
  // so a terminated container reporting CrashLoopBackOff is representable. Only
  // the pair of state *and* reason means the pod is looping right now.
  const pod = basePod({
    conditions: [{ type: "Ready", status: "True" }],
    containerStatuses: [
      { name: "main", ready: true, restartCount: 3, state: { kind: "terminated", reason: "CrashLoopBackOff" } },
    ],
  });
  assert.equal(PodHealth.hasIssues(pod), false);
});

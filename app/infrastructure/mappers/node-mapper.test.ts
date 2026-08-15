import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeStatus } from "../../domain/node/node";
import { toNodeDomain } from "./node-mapper";

test("derives roles from node-role labels and readiness", () => {
  const node = toNodeDomain({
    metadata: { name: "cp", labels: { "node-role.kubernetes.io/control-plane": "", "kubernetes.io/os": "linux" } },
    status: { nodeInfo: { kubeletVersion: "v1.36.0" }, conditions: [{ type: "Ready", status: "True" }] },
  });
  assert.deepEqual(node.roles, ["control-plane"]);
  assert.equal(node.kubeletVersion, "v1.36.0");
  assert.equal(NodeStatus.isReady(node), true);
  assert.equal(NodeStatus.statusText(node), "Ready");
});

test("cordoned node reports SchedulingDisabled; roleless node is <none>", () => {
  const node = toNodeDomain({
    metadata: { name: "w" },
    spec: { unschedulable: true },
    status: { conditions: [{ type: "Ready", status: "True" }] },
  });
  assert.equal(NodeStatus.statusText(node), "SchedulingDisabled");
  assert.equal(NodeStatus.roleLabel(node), "<none>");
});

test("not-ready node", () => {
  const node = toNodeDomain({ metadata: { name: "w" }, status: { conditions: [{ type: "Ready", status: "False" }] } });
  assert.equal(NodeStatus.statusText(node), "NotReady");
});

test("bare node (no spec/status/labels) defaults safely and is schedulable", () => {
  const node = toNodeDomain({ metadata: { name: "bare" } });
  assert.deepEqual(node.roles, []);
  assert.deepEqual(node.addresses, []);
  assert.deepEqual(node.conditions, []);
  assert.equal(node.schedulable, true, "no spec.unschedulable → schedulable");
  assert.equal(node.kubeletVersion, undefined);
  assert.equal(NodeStatus.statusText(node), "NotReady", "no Ready condition → NotReady");
  assert.equal(NodeStatus.internalIP(node), "");
});

test("derives addresses and condition text", () => {
  const node = toNodeDomain({
    metadata: { name: "cp" },
    status: {
      addresses: [
        { type: "InternalIP", address: "10.0.0.5" },
        { type: "ExternalIP", address: "203.0.113.9" },
      ],
      conditions: [
        { type: "MemoryPressure", status: "False" },
        { type: "Ready", status: "True" },
      ],
    },
  });
  assert.equal(NodeStatus.internalIP(node), "10.0.0.5");
  assert.equal(NodeStatus.externalIP(node), "203.0.113.9");
  assert.equal(NodeStatus.conditionText(node), "MemoryPressure Ready");
});

// The condition and address fallbacks were mapped but never read back, so any
// value would have done.

test("nameless conditions and addresses map to empty strings, not to anything else", () => {
  const node = toNodeDomain({
    metadata: { name: "n1" },
    status: {
      conditions: [{ type: undefined, status: undefined }],
      addresses: [{ type: undefined, address: undefined }],
    },
  });
  assert.deepEqual(node.conditions, [{ type: "", status: "" }]);
  assert.deepEqual(node.addresses, [{ type: "", address: "" }]);
});

test("a role label with nothing after the prefix is not a role", () => {
  // `node-role.kubernetes.io/` on its own yields an empty slice, which would
  // otherwise show up as a blank role in the list.
  const node = toNodeDomain({
    metadata: {
      name: "n1",
      labels: { "node-role.kubernetes.io/": "", "node-role.kubernetes.io/worker": "", other: "x" },
    },
  });
  assert.deepEqual(node.roles, ["worker"]);
});

test("a node without a name is refused rather than given a placeholder", () => {
  assert.throws(() => toNodeDomain({ metadata: {} }), /name/i);
});

test("a long non-role label is not mistaken for a role", () => {
  // Roles come from a prefix, and the slice that strips it would happily strip
  // the same number of characters off any label. A short one is filtered out by
  // accident because the remainder is empty; a long one is not.
  const node = toNodeDomain({
    metadata: {
      name: "n1",
      labels: {
        "node-role.kubernetes.io/control-plane": "",
        "node.kubernetes.io/instance-type": "m5.large",
        "topology.kubernetes.io/region": "us-east-1",
      },
    },
  });
  assert.deepEqual(node.roles, ["control-plane"]);
});

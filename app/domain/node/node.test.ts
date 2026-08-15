import assert from "node:assert/strict";
import { test } from "node:test";
import { ResourceRef } from "../values/resource-ref";
import { type Node, NodeStatus } from "./node";

// NodeStatus was only ever exercised through the mapper, which meant its own
// rules were tested incidentally. Mutation testing found the gap that leaves:
// the condition *type* was never load-bearing in any assertion.

const node = (overrides: Partial<Node> = {}): Node => ({
  ref: ResourceRef.of({ apiVersion: "v1", kind: "Node", name: "n" }),
  roles: [],
  schedulable: true,
  conditions: [{ type: "Ready", status: "True" }],
  addresses: [],
  ...overrides,
});

test("readiness is the Ready condition, not whichever condition happens to be True", () => {
  // The one that mattered: a node under memory pressure reports MemoryPressure
  // True and no Ready at all. Matching on the status alone calls it ready.
  const pressured = node({ conditions: [{ type: "MemoryPressure", status: "True" }] });
  assert.equal(NodeStatus.isReady(pressured), false);
  assert.equal(NodeStatus.statusText(pressured), "NotReady");

  assert.equal(NodeStatus.isReady(node()), true);
  assert.equal(NodeStatus.isReady(node({ conditions: [{ type: "Ready", status: "False" }] })), false);
  assert.equal(NodeStatus.isReady(node({ conditions: [] })), false);
});

test("an unschedulable node reports SchedulingDisabled whatever its readiness", () => {
  assert.equal(NodeStatus.statusText(node({ schedulable: false })), "SchedulingDisabled");
  assert.equal(
    NodeStatus.statusText(node({ schedulable: false, conditions: [{ type: "Ready", status: "False" }] })),
    "SchedulingDisabled",
  );
});

test("roles are joined with a separator, and an empty list reads <none>", () => {
  // Two roles, because one role cannot tell a separator from no separator.
  assert.equal(NodeStatus.roleLabel(node({ roles: ["control-plane", "worker"] })), "control-plane, worker");
  assert.equal(NodeStatus.roleLabel(node({ roles: ["worker"] })), "worker");
  assert.equal(NodeStatus.roleLabel(node({ roles: [] })), "<none>");
});

test("an address is looked up by type, and a missing one is empty rather than undefined", () => {
  const addressed = node({
    addresses: [
      { type: "InternalIP", address: "10.0.0.5" },
      { type: "Hostname", address: "n1" },
    ],
  });
  assert.equal(NodeStatus.address(addressed, "InternalIP"), "10.0.0.5");
  assert.equal(NodeStatus.address(addressed, "Hostname"), "n1");
  assert.equal(NodeStatus.address(addressed, "ExternalIP"), "");
});

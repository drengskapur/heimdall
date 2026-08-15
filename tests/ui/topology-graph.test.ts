import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTopology, ROW_HEIGHT, type TopoInput } from "../../app/ui/topology/topology-graph.ts";

const node = (uid: string, kind: string, owner?: string, health: TopoInput["health"] = "Healthy"): TopoInput => ({
  uid,
  kind,
  name: uid,
  health,
  ownerUids: owner ? [owner] : [],
});

const find = (t: ReturnType<typeof buildTopology>, uid: string) => t.nodes.find(n => n.uid === uid)!;

test("depth follows the owner chain", () => {
  const t = buildTopology([node("deploy", "Deployment"), node("rs", "ReplicaSet", "deploy"), node("pod", "Pod", "rs")]);
  assert.equal(find(t, "deploy").depth, 0);
  assert.equal(find(t, "rs").depth, 1);
  assert.equal(find(t, "pod").depth, 2);
  assert.deepEqual(
    t.edges.map(e => `${e.from}>${e.to}`),
    ["deploy>rs", "rs>pod"],
  );
});

test("an owner outside the set makes the child a root, not a dangling edge", () => {
  // The partial-fetch case: pods loaded without their ReplicaSets.
  const t = buildTopology([node("pod-a", "Pod", "missing-rs"), node("pod-b", "Pod", "missing-rs")]);
  assert.equal(find(t, "pod-a").depth, 0);
  assert.equal(find(t, "pod-b").depth, 0);
  assert.equal(t.edges.length, 0);
});

test("a parent centres on its children", () => {
  const t = buildTopology([
    node("rs", "ReplicaSet"),
    node("p1", "Pod", "rs"),
    node("p2", "Pod", "rs"),
    node("p3", "Pod", "rs"),
  ]);
  const [p1, p3, rs] = [find(t, "p1"), find(t, "p3"), find(t, "rs")];
  assert.equal(rs.y, (p1.y + p3.y) / 2);
  // And the leaves are on consecutive rows.
  assert.equal(find(t, "p2").y - p1.y, ROW_HEIGHT);
});

test("health rolls up to the worst in the subtree", () => {
  const t = buildTopology([
    node("deploy", "Deployment", undefined, "Healthy"),
    node("rs", "ReplicaSet", "deploy", "Healthy"),
    node("ok", "Pod", "rs", "Healthy"),
    node("bad", "Pod", "rs", "Degraded"),
  ]);
  // The Deployment is Healthy in itself; the tree under it is not, and the
  // rollup is what a collapsed branch has to be able to say.
  assert.equal(find(t, "deploy").health, "Healthy");
  assert.equal(find(t, "deploy").rollup, "Degraded");
  assert.equal(find(t, "rs").rollup, "Degraded");
  assert.equal(find(t, "ok").rollup, "Healthy");
});

test("child counts are recorded", () => {
  const t = buildTopology([node("rs", "ReplicaSet"), node("p1", "Pod", "rs"), node("p2", "Pod", "rs")]);
  assert.equal(find(t, "rs").childCount, 2);
  assert.equal(find(t, "p1").childCount, 0);
});

test("a self-referencing or cyclic owner does not hang the layout", () => {
  const cyclic: TopoInput[] = [
    { uid: "a", kind: "X", name: "a", health: "Healthy", ownerUids: ["b"] },
    { uid: "b", kind: "X", name: "b", health: "Healthy", ownerUids: ["a"] },
    { uid: "self", kind: "X", name: "self", health: "Healthy", ownerUids: ["self"] },
  ];
  const t = buildTopology(cyclic);
  assert.equal(t.nodes.length, 3);
  // `self` names itself, which is ignored, so it is a root.
  assert.equal(find(t, "self").depth, 0);
});

test("the same input always lays out the same way, whatever order it arrives in", () => {
  const objects = [
    node("deploy", "Deployment"),
    node("rs", "ReplicaSet", "deploy"),
    node("b", "Pod", "rs"),
    node("a", "Pod", "rs"),
  ];
  const forward = buildTopology(objects);
  const reversed = buildTopology([...objects].reverse());
  assert.deepEqual(
    forward.nodes.map(n => `${n.uid}@${n.x},${n.y}`),
    reversed.nodes.map(n => `${n.uid}@${n.x},${n.y}`),
  );
});

test("the canvas grows to fit the deepest chain and the widest fan-out", () => {
  const flat = buildTopology([node("a", "Pod"), node("b", "Pod"), node("c", "Pod")]);
  const deep = buildTopology([node("a", "Deployment"), node("b", "ReplicaSet", "a"), node("c", "Pod", "b")]);
  assert.ok(flat.height > deep.height, "three roots stack taller than a chain of three");
  assert.ok(deep.width > flat.width, "a chain of three is wider than three roots");
});

test("an empty input produces an empty, non-zero canvas", () => {
  const t = buildTopology([]);
  assert.deepEqual(t.nodes, []);
  assert.deepEqual(t.edges, []);
  assert.ok(t.height > 0);
});

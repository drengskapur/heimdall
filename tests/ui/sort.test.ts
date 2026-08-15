import assert from "node:assert/strict";
import { test } from "node:test";
import { getSorted } from "../../app/ui/resource/sort";

const rows = [
  { id: "a", name: "pod-10", restarts: 2 },
  { id: "b", name: "pod-2", restarts: 10 },
  { id: "c", name: "pod-1", restarts: 2 },
];

test("getSorted sorts numbers numerically asc and desc", () => {
  const asc = getSorted(rows, r => r.restarts, "asc").map(r => r.restarts);
  assert.deepEqual(asc, [2, 2, 10]);
  const desc = getSorted(rows, r => r.restarts, "desc").map(r => r.restarts);
  assert.deepEqual(desc, [10, 2, 2]);
});

test("getSorted uses natural/numeric string collation (pod-2 before pod-10)", () => {
  const asc = getSorted(rows, r => r.name, "asc").map(r => r.name);
  assert.deepEqual(asc, ["pod-1", "pod-2", "pod-10"]);
});

test("getSorted is stable — equal keys keep original order", () => {
  // rows a and c both have restarts=2; a comes before c in the input.
  const asc = getSorted(rows, r => r.restarts, "asc");
  const twos = asc.filter(r => r.restarts === 2).map(r => r.id);
  assert.deepEqual(twos, ["a", "c"]);
});

test("getSorted does not mutate the input array", () => {
  const input = [...rows];
  const snapshot = input.map(r => r.id);
  getSorted(input, r => r.name, "desc");
  assert.deepEqual(
    input.map(r => r.id),
    snapshot,
  );
});

test("getSorted handles empty and single-element inputs", () => {
  assert.deepEqual(
    getSorted([], (r: { x: number }) => r.x, "asc"),
    [],
  );
  const one = [{ id: "x", v: 1 }];
  assert.deepEqual(
    getSorted(one, r => r.v, "asc"),
    one,
  );
});

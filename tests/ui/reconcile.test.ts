import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcile } from "../../app/ui/resource/reconcile";

interface Row {
  id: string;
  v: number;
}
const key = (r: Row) => r.id;
const rows: Row[] = [
  { id: "a", v: 1 },
  { id: "b", v: 2 },
];

test("ADDED appends a new row", () => {
  const next = reconcile(rows, "ADDED", { id: "c", v: 3 }, key);
  assert.deepEqual(
    next.map(r => r.id),
    ["a", "b", "c"],
  );
});

test("ADDED of an existing key upserts (no duplicate)", () => {
  const next = reconcile(rows, "ADDED", { id: "a", v: 9 }, key);
  assert.equal(next.length, 2);
  assert.equal(next.find(r => r.id === "a")?.v, 9);
});

test("MODIFIED replaces the matching row in place", () => {
  const next = reconcile(rows, "MODIFIED", { id: "b", v: 20 }, key);
  assert.deepEqual(
    next.map(r => r.v),
    [1, 20],
  );
});

test("MODIFIED of an unknown key appends it (out-of-order events are safe)", () => {
  const next = reconcile(rows, "MODIFIED", { id: "z", v: 26 }, key);
  assert.deepEqual(
    next.map(r => r.id),
    ["a", "b", "z"],
  );
});

test("DELETED removes the matching row", () => {
  const next = reconcile(rows, "DELETED", { id: "a", v: 0 }, key);
  assert.deepEqual(
    next.map(r => r.id),
    ["b"],
  );
});

test("DELETED of a missing key returns the same array reference (no churn)", () => {
  const next = reconcile(rows, "DELETED", { id: "missing", v: 0 }, key);
  assert.equal(next, rows);
});

test("BOOKMARK / ERROR events don't change the list", () => {
  assert.equal(reconcile(rows, "BOOKMARK", { id: "a", v: 1 }, key), rows);
  assert.equal(reconcile(rows, "ERROR", { id: "a", v: 1 }, key), rows);
});

test("reconcile never mutates the input array", () => {
  const input = [...rows];
  const snapshot = input.map(r => r.id);
  reconcile(input, "ADDED", { id: "x", v: 1 }, key);
  reconcile(input, "DELETED", { id: "a", v: 1 }, key);
  assert.deepEqual(
    input.map(r => r.id),
    snapshot,
  );
});

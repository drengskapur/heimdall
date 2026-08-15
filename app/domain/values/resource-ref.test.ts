import assert from "node:assert/strict";
import { test } from "node:test";
import { ResourceRef } from "./resource-ref";

test("requires kind and name", () => {
  assert.throws(() => ResourceRef.of({ apiVersion: "v1", kind: "", name: "x" }), /kind/);
  assert.throws(() => ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "" }), /name/);
});

test("requires an apiVersion, and derives group/namespaced from it", () => {
  // It used to default to "v1". Nothing relied on that, and it quietly turned a
  // missing group into a claim of core/v1 — wrong for anything outside it.
  assert.throws(() => ResourceRef.of({ apiVersion: "", kind: "Pod", name: "p" }), /apiVersion/);

  const core = ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "p", namespace: "default" });
  assert.equal(core.apiVersion, "v1");
  assert.equal(core.group, "");
  assert.equal(core.namespaced, true);
  const grouped = ResourceRef.of({ apiVersion: "apps/v1", kind: "Deployment", name: "d" });
  assert.equal(grouped.group, "apps");
  assert.equal(grouped.namespaced, false);
});

test("equals prefers uid, falls back to kind+name+namespace", () => {
  const a = ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "p", namespace: "default", uid: "u1" });
  const b = ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "renamed", namespace: "other", uid: "u1" });
  assert.equal(a.equals(b), true, "same uid → equal regardless of name/namespace");
  const c = ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "p", namespace: "default", uid: "u2" });
  assert.equal(a.equals(c), false, "different uid → not equal");
  const noUid1 = ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "p", namespace: "default" });
  const noUid2 = ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "p", namespace: "default" });
  assert.equal(noUid1.equals(noUid2), true, "no uid → identity by kind/name/namespace");
  const noUid3 = ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "p", namespace: "kube-system" });
  assert.equal(noUid1.equals(noUid3), false, "different namespace → not equal");
});

test("toKey identifies the object, with or without a uid", () => {
  // The regression: a ref from an endpoint address has no uid, one from a listed
  // object does, and both must key the same or a Service-started port-forward is
  // invisible on its pod.
  const withUid = ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "p", namespace: "ns", uid: "u1" });
  const withoutUid = ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "p", namespace: "ns" });
  assert.equal(withUid.toKey(), withoutUid.toKey());
  assert.equal(withUid.toKey(), "Pod/ns/p");
  assert.equal(ResourceRef.of({ apiVersion: "v1", kind: "Node", name: "n" }).toKey(), "Node//n");
  // The old "namespace-name" scheme collided on the delimiter.
  assert.notEqual(
    ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "foo", namespace: "a-b" }).toKey(),
    ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "b-foo", namespace: "a" }).toKey(),
  );
  // Different kinds sharing a name stay distinct.
  assert.notEqual(
    ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "x", namespace: "ns" }).toKey(),
    ResourceRef.of({ apiVersion: "v1", kind: "Service", name: "x", namespace: "ns" }).toKey(),
  );
});

test("toString is kind/[namespace/]name", () => {
  assert.equal(ResourceRef.of({ apiVersion: "v1", kind: "Pod", name: "p", namespace: "ns" }).toString(), "Pod/ns/p");
  assert.equal(ResourceRef.of({ apiVersion: "v1", kind: "Node", name: "n" }).toString(), "Node/n");
});

// Equality has two modes and three fields, and only the agreeing cases were
// covered — so most of the comparison could be deleted without a test noticing.
test("equality falls back to kind/name/namespace unless BOTH refs carry a uid", () => {
  const base = { apiVersion: "v1", kind: "Pod", name: "p", namespace: "default" };
  const withUid = ResourceRef.of({ ...base, uid: "u1" });
  const withoutUid = ResourceRef.of(base);

  // One uid is not enough to compare by uid; the fields decide instead.
  assert.equal(withUid.equals(withoutUid), true);
  assert.equal(withoutUid.equals(withUid), true);

  // Both present and different: the uids decide, and the fields do not save it.
  assert.equal(withUid.equals(ResourceRef.of({ ...base, uid: "u2" })), false);
});

test("each of kind, name and namespace can break equality on its own", () => {
  const base = { apiVersion: "v1", kind: "Pod", name: "p", namespace: "default" };
  const ref = ResourceRef.of(base);
  assert.equal(ref.equals(ResourceRef.of({ ...base, kind: "Service" })), false);
  assert.equal(ref.equals(ResourceRef.of({ ...base, name: "other" })), false);
  assert.equal(ref.equals(ResourceRef.of({ ...base, namespace: "other" })), false);
  assert.equal(ref.equals(ResourceRef.of({ ...base })), true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { toCustomResourceType } from "./custom-resource-mapper";

test("selects the storage version and builds the collection path", () => {
  const type = toCustomResourceType({
    spec: {
      group: "example.com",
      scope: "Namespaced",
      names: { plural: "widgets", kind: "Widget" },
      versions: [
        { name: "v1alpha1", served: true, storage: false },
        { name: "v1", served: true, storage: true },
      ],
    },
  });
  assert.equal(type.apiVersion, "example.com/v1");
  assert.equal(type.namespaced, true);
  assert.equal(type.collectionPath("team-a"), "/apis/example.com/v1/namespaces/team-a/widgets");
  assert.equal(type.collectionPath(), "/apis/example.com/v1/widgets");
});

test("falls back to a served version when none is marked storage", () => {
  const type = toCustomResourceType({
    spec: {
      group: "g",
      scope: "Namespaced",
      names: { plural: "ws", kind: "W" },
      versions: [{ name: "v2", served: true, storage: false }],
    },
  });
  assert.equal(type.version, "v2");
});

test("falls back to the first version when none served or storage", () => {
  const type = toCustomResourceType({
    spec: { group: "g", scope: "Cluster", names: { plural: "ws", kind: "W" }, versions: [{ name: "v0" }] },
  });
  assert.equal(type.version, "v0");
});

test("missing group yields an empty group; missing names throws via the value object", () => {
  const type = toCustomResourceType({
    spec: { names: { plural: "ws", kind: "W" }, versions: [{ name: "v1", storage: true }] },
  });
  assert.equal(type.group, "");
  assert.equal(type.apiVersion, "v1"); // empty group → apiVersion is just the version
  assert.throws(
    () =>
      toCustomResourceType({ spec: { group: "g", names: { kind: "W" }, versions: [{ name: "v1", storage: true }] } }),
    /plural/,
  );
});

test("cluster-scoped CRD ignores namespace in the path", () => {
  const type = toCustomResourceType({
    spec: {
      group: "example.com",
      scope: "Cluster",
      names: { plural: "clusterwidgets", kind: "ClusterWidget" },
      versions: [{ name: "v1", served: true, storage: true }],
    },
  });
  assert.equal(type.namespaced, false);
  assert.equal(type.collectionPath("ignored"), "/apis/example.com/v1/clusterwidgets");
});

// The version-selection chain has four steps and only the first was covered.

test("version selection prefers storage, then served, then the first listed", () => {
  const served = toCustomResourceType({
    spec: {
      group: "example.com",
      names: { plural: "widgets", kind: "Widget" },
      scope: "Namespaced",
      versions: [{ name: "v1alpha1", served: true, storage: false }],
    },
  });
  assert.equal(served.version, "v1alpha1");

  const neither = toCustomResourceType({
    spec: {
      group: "example.com",
      names: { plural: "widgets", kind: "Widget" },
      scope: "Namespaced",
      versions: [{ name: "v1beta1", served: false, storage: false }],
    },
  });
  assert.equal(neither.version, "v1beta1");
});

test("a CRD with no usable version is refused, and missing names map to empty strings", () => {
  // No spec means no version, and the domain type will not accept one without.
  // The mapper still has to reach that point without dereferencing an absent
  // `spec.versions` or `spec.names` on the way.
  assert.throws(() => toCustomResourceType({}), /version/i);
  assert.throws(() => toCustomResourceType({ spec: { versions: [] } }), /version/i);

  // Each empty field is rejected by name, and the `?.` on `spec.names` is what
  // turns an absent names block into that message rather than a TypeError.
  const versioned = { group: "example.com", versions: [{ name: "v1", storage: true }] };
  assert.throws(() => toCustomResourceType({ spec: versioned }), /plural must not be empty/);
  assert.throws(
    () => toCustomResourceType({ spec: { ...versioned, names: { plural: "widgets" } } }),
    /kind must not be empty/,
  );
});

test("the served version is chosen even when it is not the first listed", () => {
  // With a single version, "served" and "first" are the same answer, so the
  // served lookup has to be shown picking a version the fallback would not.
  const type = toCustomResourceType({
    spec: {
      group: "example.com",
      names: { plural: "widgets", kind: "Widget" },
      scope: "Namespaced",
      versions: [
        { name: "v1beta1", served: false, storage: false },
        { name: "v1", served: true, storage: false },
      ],
    },
  });
  assert.equal(type.version, "v1");
});

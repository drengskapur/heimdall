import assert from "node:assert/strict";
import { test } from "node:test";
import { CustomResourceType } from "./custom-resource-type";

test("apiVersion is group/version, or just version for the empty group", () => {
  assert.equal(
    CustomResourceType.of({ group: "example.com", version: "v1", plural: "widgets", kind: "Widget", namespaced: true })
      .apiVersion,
    "example.com/v1",
  );
  assert.equal(
    CustomResourceType.of({ group: "", version: "v1", plural: "widgets", kind: "Widget", namespaced: false })
      .apiVersion,
    "v1",
  );
});

test("collectionPath includes the namespace only when namespaced and given", () => {
  const namespaced = CustomResourceType.of({
    group: "example.com",
    version: "v1",
    plural: "widgets",
    kind: "Widget",
    namespaced: true,
  });
  assert.equal(namespaced.collectionPath("team"), "/apis/example.com/v1/namespaces/team/widgets");
  assert.equal(
    namespaced.collectionPath(),
    "/apis/example.com/v1/widgets",
    "no namespace arg → collection across namespaces",
  );
  const clusterScoped = CustomResourceType.of({
    group: "example.com",
    version: "v1",
    plural: "clusterwidgets",
    kind: "ClusterWidget",
    namespaced: false,
  });
  assert.equal(
    clusterScoped.collectionPath("ignored"),
    "/apis/example.com/v1/clusterwidgets",
    "cluster-scoped ignores namespace",
  );
});

test("encodes namespace in the path", () => {
  const type = CustomResourceType.of({
    group: "example.com",
    version: "v1",
    plural: "widgets",
    kind: "Widget",
    namespaced: true,
  });
  assert.equal(type.collectionPath("a b"), "/apis/example.com/v1/namespaces/a%20b/widgets");
});

test("rejects missing version/plural/kind", () => {
  assert.throws(
    () => CustomResourceType.of({ group: "g", version: "", plural: "p", kind: "K", namespaced: true }),
    /version/,
  );
  assert.throws(
    () => CustomResourceType.of({ group: "g", version: "v1", plural: "", kind: "K", namespaced: true }),
    /plural/,
  );
  assert.throws(
    () => CustomResourceType.of({ group: "g", version: "v1", plural: "p", kind: "", namespaced: true }),
    /kind/,
  );
});

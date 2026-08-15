import assert from "node:assert/strict";
import { test } from "node:test";
import { canList, groupOf, servedHas } from "../../app/ui/capabilities";

test("groupOf strips the version, core group is empty", () => {
  assert.equal(groupOf("v1"), "");
  assert.equal(groupOf("apps/v1"), "apps");
  assert.equal(groupOf("networking.k8s.io/v1"), "networking.k8s.io");
  assert.equal(groupOf("autoscaling/v2"), "autoscaling");
});

test("servedHas returns true for any query when the set is null (undiscovered)", () => {
  assert.equal(servedHas(null, "v1", "pods"), true);
  assert.equal(servedHas(null, "made.up/v9", "widgets"), true);
});

test("servedHas matches at the group level (version-agnostic)", () => {
  // Cluster serves HPA under autoscaling/v2; our descriptor declares v1.
  const served = new Set(["/pods", "apps/deployments", "autoscaling/horizontalpodautoscalers"]);
  assert.equal(servedHas(served, "v1", "pods"), true);
  assert.equal(servedHas(served, "apps/v1", "deployments"), true);
  assert.equal(
    servedHas(served, "autoscaling/v1", "horizontalpodautoscalers"),
    true,
    "v1 descriptor should match a v2-served kind",
  );
});

test("servedHas hides kinds the cluster does not expose", () => {
  const served = new Set(["/pods", "apps/deployments"]);
  assert.equal(servedHas(served, "policy/v1", "poddisruptionbudgets"), false);
  assert.equal(servedHas(served, "metrics.k8s.io/v1beta1", "nodes"), false);
});

test("canList is permissive when rules are null (unchecked / incomplete / errored)", () => {
  assert.equal(canList(null, "v1", "pods"), true);
  assert.equal(canList(null, "policy/v1", "poddisruptionbudgets"), true);
});

test("canList honors a full wildcard rule (cluster-admin)", () => {
  const rules = [{ verbs: ["*"], apiGroups: ["*"], resources: ["*"] }];
  assert.equal(canList(rules, "v1", "pods"), true);
  assert.equal(canList(rules, "apps/v1", "deployments"), true);
});

test("canList matches a specific group+resource+list grant", () => {
  const rules = [
    { verbs: ["get", "list", "watch"], apiGroups: [""], resources: ["pods"] },
    { verbs: ["list"], apiGroups: ["apps"], resources: ["deployments"] },
  ];
  assert.equal(canList(rules, "v1", "pods"), true);
  assert.equal(canList(rules, "apps/v1", "deployments"), true);
  // no rule grants secrets or nodes → hidden
  assert.equal(canList(rules, "v1", "secrets"), false);
  assert.equal(canList(rules, "v1", "nodes"), false);
});

test("canList requires a list/* verb (get-only does not grant list)", () => {
  const rules = [{ verbs: ["get"], apiGroups: [""], resources: ["pods"] }];
  assert.equal(canList(rules, "v1", "pods"), false);
});

test("canList honors a group wildcard with a specific resource", () => {
  const rules = [{ verbs: ["list"], apiGroups: ["*"], resources: ["pods"] }];
  assert.equal(canList(rules, "v1", "pods"), true);
  assert.equal(canList(rules, "v1", "services"), false);
});

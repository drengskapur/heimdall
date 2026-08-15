import assert from "node:assert/strict";
import { test } from "node:test";
import { badgeFontSize, kindBadge, kindIcon } from "../../app/ui/resource/kind-badge.ts";

test("known kinds get kubectl's own short name", () => {
  // These are the ones a Kubernetes user reads without translating.
  assert.equal(kindBadge("Deployment"), "deploy");
  assert.equal(kindBadge("ReplicaSet"), "rs");
  assert.equal(kindBadge("StatefulSet"), "sts");
  assert.equal(kindBadge("DaemonSet"), "ds");
  assert.equal(kindBadge("Service"), "svc");
  assert.equal(kindBadge("ConfigMap"), "cm");
  assert.equal(kindBadge("Ingress"), "ing");
  assert.equal(kindBadge("PersistentVolumeClaim"), "pvc");
  assert.equal(kindBadge("Pod"), "pod");
});

test("an unknown kind falls back to its capitals, which is Argo's rule", () => {
  // The point of the rule: it produces what a person would have abbreviated to.
  assert.equal(kindBadge("MyOperatorConfig"), "moc");
  assert.equal(kindBadge("SealedSecret"), "ss");
  assert.equal(kindBadge("VirtualService"), "vs");
});

test("initials are capped so a long CRD name cannot overflow its badge", () => {
  assert.equal(kindBadge("AVeryLongCustomResourceKind"), "avlc");
  assert.ok(kindBadge("AVeryLongCustomResourceKind").length <= 4);
});

test("digits count as initials, since API kinds carry versions", () => {
  assert.equal(kindBadge("S3Bucket"), "s3b");
});

test("a kind with no capitals still gets a badge rather than an empty one", () => {
  assert.equal(kindBadge("weirdlowercasekind"), "wei");
  assert.notEqual(kindBadge("weirdlowercasekind"), "");
});

test("every badge is short enough to render", () => {
  const kinds = [
    "Deployment",
    "CustomResourceDefinition",
    "HorizontalPodAutoscaler",
    "ClusterRoleBinding",
    "MyOperatorConfig",
  ];
  for (const k of kinds) assert.ok(kindBadge(k).length <= 6, `${k} → ${kindBadge(k)}`);
});

test("the font shrinks as the badge lengthens, so all of them fit one box", () => {
  assert.ok(badgeFontSize("rs") > badgeFontSize("deploy"));
  assert.ok(badgeFontSize("deploy") >= badgeFontSize("cronjob"));
  // And the longest still has a usable size.
  assert.ok(badgeFontSize("cronjob") >= 7);
});

test("the common kinds have a glyph, so the badge is a picture not a word", () => {
  for (const k of [
    "Pod",
    "Deployment",
    "ReplicaSet",
    "StatefulSet",
    "DaemonSet",
    "Service",
    "ConfigMap",
    "Secret",
    "Node",
  ]) {
    assert.ok(kindIcon(k), `${k} should have a glyph`);
  }
});

test("the glyphs agree with the ones the sidebar already uses", () => {
  // The app must not disagree with itself about what a Pod looks like: these are
  // the same icons nav-tree gives the matching pages.
  assert.equal(kindIcon("Pod"), "cube");
  assert.equal(kindIcon("Deployment"), "cubes");
  assert.equal(kindIcon("DaemonSet"), "layers");
  assert.equal(kindIcon("ReplicaSet"), "duplicate");
  assert.equal(kindIcon("Service"), "globe-network");
  assert.equal(kindIcon("Secret"), "key");
  assert.equal(kindIcon("PersistentVolumeClaim"), "floppy-disk");
});

test("an unknown kind has no glyph, so it falls through to the initials", () => {
  assert.equal(kindIcon("MyOperatorConfig"), undefined);
  // …and the initials path still produces something usable for it.
  assert.equal(kindBadge("MyOperatorConfig"), "moc");
});

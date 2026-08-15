import assert from "node:assert/strict";
import { test } from "node:test";
import { collapseContext, diffLines, hasChanges, projectOnto, stripServerFields } from "../../app/ui/resource/diff.ts";

const kinds = (lines: ReturnType<typeof diffLines>) => lines.map(l => (l.kind === "skip" ? `skip${l.count}` : l.kind));

test("identical input produces no changes", () => {
  const d = diffLines(["a", "b", "c"], ["a", "b", "c"]);
  assert.deepEqual(kinds(d), ["same", "same", "same"]);
  assert.equal(hasChanges(d), false);
});

test("a changed line is one deletion and one addition, in place", () => {
  const d = diffLines(["a", "b", "c"], ["a", "B", "c"]);
  assert.deepEqual(kinds(d), ["same", "del", "add", "same"]);
  assert.equal(hasChanges(d), true);
});

test("a moved block is not reported as a rewrite of everything after it", () => {
  // The case a greedy line-by-line walk gets wrong: it would mark every
  // subsequent line changed. LCS keeps the common run.
  const d = diffLines(["x", "a", "b", "c"], ["a", "b", "c", "x"]);
  assert.equal(d.filter(l => l.kind === "same").length, 3);
});

test("insertions and deletions at the ends are handled", () => {
  assert.deepEqual(kinds(diffLines([], ["a", "b"])), ["add", "add"]);
  assert.deepEqual(kinds(diffLines(["a", "b"], [])), ["del", "del"]);
  assert.deepEqual(kinds(diffLines([], [])), []);
});

test("context collapses to a skip marker that accounts for every line", () => {
  const before = Array.from({ length: 20 }, (_, i) => `line${i}`);
  const after = [...before];
  after[10] = "changed";
  const collapsed = collapseContext(diffLines(before, after), 3);
  // 3 context either side of the del/add pair, everything else collapsed.
  assert.deepEqual(kinds(collapsed), ["skip7", "same", "same", "same", "del", "add", "same", "same", "same", "skip6"]);
  // The skips have to account for exactly the lines that were dropped.
  const shown = collapsed.filter(l => l.kind !== "skip").length;
  const skipped = collapsed.reduce((n, l) => n + (l.kind === "skip" ? l.count : 0), 0);
  assert.equal(shown + skipped, diffLines(before, after).length);
});

test("a diff with no changes collapses to a single skip", () => {
  const same = Array.from({ length: 12 }, (_, i) => `l${i}`);
  assert.deepEqual(kinds(collapseContext(diffLines(same, same), 3)), ["skip12"]);
});

test("server-owned fields are stripped from both sides", () => {
  const live = {
    apiVersion: "apps/v1",
    metadata: {
      name: "web",
      resourceVersion: "12345",
      uid: "abc",
      generation: 4,
      creationTimestamp: "2026-01-01T00:00:00Z",
      managedFields: [{ manager: "kubectl" }],
      annotations: { "kubectl.kubernetes.io/last-applied-configuration": "{}", team: "infra" },
    },
    spec: { replicas: 3 },
    status: { readyReplicas: 3 },
  };
  const stripped = stripServerFields(live) as Record<string, any>;
  assert.equal(stripped.status, undefined);
  assert.equal(stripped.metadata.managedFields, undefined);
  assert.equal(stripped.metadata.resourceVersion, undefined);
  assert.equal(stripped.metadata.uid, undefined);
  assert.equal(stripped.metadata.generation, undefined);
  assert.equal(stripped.metadata.creationTimestamp, undefined);
  // A real annotation survives; the applied-configuration one does not.
  assert.deepEqual(stripped.metadata.annotations, { team: "infra" });
  // The parts that describe intent are untouched.
  assert.equal(stripped.metadata.name, "web");
  assert.deepEqual(stripped.spec, { replicas: 3 });
  // And the input is not mutated.
  assert.equal(live.status.readyReplicas, 3);
  assert.equal(live.metadata.resourceVersion, "12345");
});

test("an annotations map left empty by stripping is removed entirely", () => {
  const stripped = stripServerFields({
    metadata: { name: "x", annotations: { "kubectl.kubernetes.io/last-applied-configuration": "{}" } },
  }) as Record<string, any>;
  assert.equal(stripped.metadata.annotations, undefined);
  assert.equal(stripped.metadata.name, "x");
});

test("stripping tolerates objects missing the paths entirely", () => {
  assert.deepEqual(stripServerFields({ spec: {} }), { spec: {} });
  assert.deepEqual(stripServerFields({}), {});
});

test("projection keeps only what the manifest declared", () => {
  const declared = { spec: { replicas: 1, template: { spec: { containers: [{ name: "app", image: "v1" }] } } } };
  const live = {
    spec: {
      replicas: 3,
      strategy: { type: "RollingUpdate" },
      revisionHistoryLimit: 10,
      template: {
        spec: {
          containers: [{ name: "app", image: "v1", imagePullPolicy: "IfNotPresent", resources: {} }],
          dnsPolicy: "ClusterFirst",
        },
      },
    },
  };
  // The drift survives; the twenty-five lines of Kubernetes defaults do not.
  assert.deepEqual(projectOnto(declared, live), {
    spec: { replicas: 3, template: { spec: { containers: [{ name: "app", image: "v1" }] } } },
  });
});

test("projection tolerates a field the live object no longer has", () => {
  assert.deepEqual(projectOnto({ a: 1, gone: 2 }, { a: 5 }), { a: 5 });
});

test("projection does not invent array elements the server appended", () => {
  const out = projectOnto({ xs: [{ n: 1 }] }, { xs: [{ n: 9, extra: true }, { n: 2 }] }) as { xs: unknown[] };
  assert.deepEqual(out, { xs: [{ n: 9 }] });
});

test("projection passes scalars and mismatched types through unchanged", () => {
  assert.equal(projectOnto(1, 2), 2);
  assert.deepEqual(projectOnto({ a: 1 }, "not-an-object"), "not-an-object");
  assert.deepEqual(projectOnto([1], "not-an-array"), "not-an-array");
});

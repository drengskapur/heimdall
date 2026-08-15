import assert from "node:assert/strict";
import { test } from "node:test";
import type { KubeObject } from "../../app/application/ports/kubernetes-gateway";
import { RELATIONS, type RelQuery, relationsFor, resolveRelations } from "../../app/ui/resource/relations";

// The relation table is pure data over pure predicates, so it can be exercised
// without a cluster: `resolveRelations` takes its own `list`, and these tests
// pass a stub that answers from fixtures keyed by resource name.

const obj = (raw: Record<string, unknown>): KubeObject => ({ raw, ref: null as never });

const pod = (name: string, extra: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) =>
  obj({ kind: "Pod", metadata: { name, namespace: "default", uid: `uid-${name}`, ...meta }, spec: extra });

/** A `list` that answers from a fixture map and records what was asked for. */
function stubList(fixtures: Record<string, KubeObject[]>) {
  const asked: RelQuery[] = [];
  const list = async (q: RelQuery) => {
    asked.push(q);
    return fixtures[q.resource] ?? [];
  };
  return { list, asked };
}

const titles = (r: { relation: { title: string } }[]) => r.map(x => x.relation.title);

test("a controller finds Pods it owns", async () => {
  const raw = { kind: "StatefulSet", metadata: { name: "web", namespace: "default", uid: "ss-1" } };
  const owned = pod("web-0", {}, { ownerReferences: [{ uid: "ss-1" }] });
  const stranger = pod("other");
  const { list } = stubList({ pods: [owned, stranger] });

  const [group] = await resolveRelations(raw, list);
  assert.equal(group.relation.title, "Pods");
  assert.deepEqual(
    group.objects.map(o => (o.raw.metadata as { name: string }).name),
    ["web-0"],
  );
});

test("a controller falls back to its selector for Pods that lost their owner", async () => {
  const raw = {
    kind: "StatefulSet",
    metadata: { name: "web", namespace: "default", uid: "ss-1" },
    spec: { selector: { matchLabels: { app: "web" } } },
  };
  const adopted = pod("web-0", {}, { labels: { app: "web" } }); // no ownerReferences
  const unrelated = pod("other", {}, { labels: { app: "other" } });
  const { list } = stubList({ pods: [adopted, unrelated] });

  const [group] = await resolveRelations(raw, list);
  assert.deepEqual(
    group.objects.map(o => (o.raw.metadata as { name: string }).name),
    ["web-0"],
  );
});

test("a Deployment reaches its Pods through its ReplicaSets, not directly", async () => {
  const raw = { kind: "Deployment", metadata: { name: "api", namespace: "default", uid: "dep-1" } };
  const rs = obj({
    metadata: { name: "api-abc", namespace: "default", uid: "rs-1", ownerReferences: [{ uid: "dep-1" }] },
  });
  const strayRs = obj({ metadata: { name: "other", namespace: "default", uid: "rs-2" } });
  const owned = pod("api-abc-1", {}, { ownerReferences: [{ uid: "rs-1" }] });
  // Owned by the *Deployment* directly, which is not how Deployments work — it
  // must not be picked up by the two-hop relation.
  const bogus = pod("api-direct", {}, { ownerReferences: [{ uid: "dep-1" }] });
  const { list } = stubList({ replicasets: [rs, strayRs], pods: [owned, bogus] });

  const resolved = await resolveRelations(raw, list);
  assert.deepEqual(titles(resolved).sort(), ["Pods", "Replica Sets"]);
  const pods = resolved.find(r => r.relation.title === "Pods")!;
  assert.deepEqual(
    pods.objects.map(o => (o.raw.metadata as { name: string }).name),
    ["api-abc-1"],
  );
});

test("a two-hop relation resolves to nothing when the first hop is empty", async () => {
  const raw = { kind: "Deployment", metadata: { name: "api", namespace: "default", uid: "dep-1" } };
  const orphan = pod("api-abc-1", {}, { ownerReferences: [{ uid: "rs-1" }] });
  const { list, asked } = stubList({ replicasets: [], pods: [orphan] });

  const resolved = await resolveRelations(raw, list);
  assert.deepEqual(resolved, []);
  // And it must not have bothered listing pods once the hop came back empty.
  assert.ok(!asked.some(q => q.resource === "pods"));
});

test("a Node matches Pods by spec.nodeName, cluster-wide", async () => {
  const raw = { kind: "Node", metadata: { name: "node-a" } };
  const here = pod("p1", { nodeName: "node-a" });
  const elsewhere = pod("p2", { nodeName: "node-b" });
  const { list, asked } = stubList({ pods: [here, elsewhere] });

  const [group] = await resolveRelations(raw, list);
  assert.deepEqual(
    group.objects.map(o => (o.raw.metadata as { name: string }).name),
    ["p1"],
  );
  assert.equal(asked[0].namespace, undefined, "a Node is cluster-scoped, so its Pods span namespaces");
});

test("a Pod finds a ConfigMap mounted as a volume and one referenced by envFrom", async () => {
  const raw = {
    kind: "Pod",
    metadata: { name: "p", namespace: "default" },
    spec: {
      volumes: [{ configMap: { name: "mounted" } }],
      containers: [{ envFrom: [{ configMapRef: { name: "env-ref" } }] }],
    },
  };
  const cms = ["mounted", "env-ref", "unused"].map(n => obj({ metadata: { name: n, namespace: "default" } }));
  const { list } = stubList({ configmaps: cms });

  const resolved = await resolveRelations(raw, list, r => r.title === "Config Maps");
  assert.deepEqual(resolved[0].objects.map(o => (o.raw.metadata as { name: string }).name).sort(), [
    "env-ref",
    "mounted",
  ]);
});

test("an RBAC binding matches a subject in another namespace", async () => {
  // Regression: subjects carry their own namespace, and it routinely differs
  // from the binding's — a kube-public binding granting to a kube-system
  // account found nothing while this was scoped to the binding's namespace.
  const raw = {
    kind: "RoleBinding",
    metadata: { name: "b", namespace: "kube-public" },
    roleRef: { kind: "Role", name: "r" },
    subjects: [{ kind: "ServiceAccount", name: "signer", namespace: "kube-system" }],
  };
  const target = obj({ metadata: { name: "signer", namespace: "kube-system" } });
  const sameNameWrongNs = obj({ metadata: { name: "signer", namespace: "default" } });
  const { list, asked } = stubList({ serviceaccounts: [target, sameNameWrongNs] });

  const resolved = await resolveRelations(raw, list, r => r.title === "Service Accounts");
  assert.equal(resolved.length, 1);
  assert.deepEqual(
    resolved[0].objects.map(o => (o.raw.metadata as { namespace: string }).namespace),
    ["kube-system"],
  );
  assert.equal(
    asked.find(q => q.resource === "serviceaccounts")?.namespace,
    undefined,
    "subjects can live anywhere, so the lookup must not be namespace-scoped",
  );
});

test("an empty NetworkPolicy podSelector selects every Pod in the namespace", async () => {
  const raw = {
    kind: "NetworkPolicy",
    metadata: { name: "np", namespace: "default" },
    spec: { podSelector: { matchLabels: {} } },
  };
  const { list } = stubList({ pods: [pod("a"), pod("b")] });

  const [group] = await resolveRelations(raw, list);
  assert.equal(group.objects.length, 2);
});

test("a relation is skipped when its query needs a namespace the object lacks", async () => {
  const raw = { kind: "Service", metadata: { name: "svc" }, spec: { selector: { app: "x" } } };
  const { list, asked } = stubList({ pods: [pod("a", {}, { labels: { app: "x" } })] });

  assert.deepEqual(await resolveRelations(raw, list), []);
  assert.deepEqual(asked, []);
});

test("one failing relation does not take the others down", async () => {
  const raw = { kind: "Deployment", metadata: { name: "api", namespace: "default", uid: "dep-1" } };
  const rs = obj({ metadata: { name: "api-abc", uid: "rs-1", ownerReferences: [{ uid: "dep-1" }] } });
  const list = async (q: RelQuery) => {
    if (q.resource === "horizontalpodautoscalers") throw new Error("forbidden");
    return q.resource === "replicasets" ? [rs] : [];
  };

  // The caller is what catches per-query failures, mirroring how the UI passes
  // a `list` that swallows them; the resolver must not convert one rejection
  // into a total loss.
  const safe = async (q: RelQuery) => list(q).catch(() => [] as KubeObject[]);
  const resolved = await resolveRelations(raw, safe);
  assert.deepEqual(titles(resolved), ["Replica Sets"]);
});

test("relationsFor selects only the kinds a relation declares", () => {
  assert.ok(relationsFor("Deployment").length > 0);
  assert.deepEqual(relationsFor("NoSuchKind"), []);
  for (const r of relationsFor("Pod")) assert.ok(r.from.includes("Pod"));
});

test("delete-impact flags stay meaningful: cascade is ownership, dependents are not", () => {
  const cascading = RELATIONS.filter(r => r.cascade);
  const dependent = RELATIONS.filter(r => r.dependents);
  assert.ok(cascading.length > 0 && dependent.length > 0);

  // A relation must not claim both: "deleting this also removes them" and
  // "these survive but break" are contradictory statements about the same edge.
  for (const r of RELATIONS) assert.ok(!(r.cascade && r.dependents), `${r.from}/${r.title} claims both`);

  // Cascade only ever describes objects Kubernetes garbage-collects, which is
  // to say children of the kinds that own things.
  for (const r of cascading) {
    assert.ok(
      r.from.every(k =>
        ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "ReplicationController", "CronJob"].includes(k),
      ),
      `${r.from}/${r.title} claims cascade but its source owns nothing`,
    );
  }
});

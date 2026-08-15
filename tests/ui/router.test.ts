import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// A minimal localStorage, because the feature-flag store the router consults
// reads one at module load and the unit tier has no DOM.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { setFeatureEnabled } = await import("../../app/ui/feature-flags.ts");
const { parse, href } = await import("../../app/ui/router.ts");

beforeEach(() => {
  store.clear();
  setFeatureEnabled("topology", true);
});

test("a cluster path is a cluster and a page", () => {
  assert.deepEqual(parse("/docker-desktop/pods"), { cluster: "docker-desktop", page: "pods" });
  // No page named means the default one, not an empty page.
  assert.deepEqual(parse("/docker-desktop"), { cluster: "docker-desktop", page: "pods" });
});

test("the catalog answers to both its current and its former path", () => {
  const catalog = { cluster: "", page: "" };
  assert.deepEqual(parse("/"), catalog);
  assert.deepEqual(parse("/clusters"), catalog);
  assert.deepEqual(parse("/catalog"), catalog);
  // But only when bare: a cluster genuinely named "clusters" stays reachable.
  assert.deepEqual(parse("/clusters/pods"), { cluster: "clusters", page: "pods" });
});

test("an enabled app owns its top-level path", () => {
  assert.deepEqual(parse("/topology"), { cluster: "", page: "topology" });
  assert.equal(href({ cluster: "", page: "topology" }), "/topology");
  // Only when nothing follows it — a cluster named "topology" is still reachable.
  assert.deepEqual(parse("/topology/pods"), { cluster: "topology", page: "pods" });
});

test("turning an app off removes its URL, it does not merely hide the page", () => {
  setFeatureEnabled("topology", false);
  // The path stops resolving: a bookmark or a Back press lands on the Catalog
  // rather than on a page explaining that the feature is off.
  assert.deepEqual(parse("/topology"), { cluster: "", page: "" });
  // And nothing can link to it, so the switch cannot leak back in through a
  // stale href.
  assert.equal(href({ cluster: "", page: "topology" }), "/clusters");
  // The cluster of the same name is unaffected — the flag gates the app, not
  // every path that happens to share its word.
  assert.deepEqual(parse("/topology/pods"), { cluster: "topology", page: "pods" });
});

test("a malformed percent-escape resolves instead of throwing", () => {
  // decodeURIComponent throws URIError on these, and parse runs at module load —
  // so before this, a link mangled in transit meant the app never mounted.
  // Found by fuzz/route.fuzz.mjs.
  assert.deepEqual(parse("/%"), { cluster: "%", page: "pods" });
  assert.deepEqual(parse("/%zz/pods"), { cluster: "%zz", page: "pods" });
  assert.deepEqual(parse("/ok/%E0%A4%A"), { cluster: "ok", page: "%E0%A4%A" });
  // A well-formed escape still decodes.
  assert.deepEqual(parse("/my%20cluster/pods"), { cluster: "my cluster", page: "pods" });
});

import { test } from "node:test";
import fc from "fast-check";

// Property-based tests: the example tests cover the inputs we thought of, these
// cover the shape of the input space. Each one states an invariant that should
// hold for *every* value, and fast-check spends a few hundred tries trying to
// find the one where it does not — then shrinks it to the smallest case.
//
// The first property here is the one that matters: it is the invariant the
// router violated for "/%", where a malformed escape threw URIError at module
// load and the application never mounted.

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { href, parse } = await import("../../app/ui/router.ts");
const { worstHealth, HEALTH_PRIORITY } = await import("../../app/ui/resource/health.ts");
const { buildTopology } = await import("../../app/ui/topology/topology-graph.ts");
const { profileToCluster } = await import("../../app/ui/cluster-catalog.ts");

test("parse is total: no string, however malformed, makes it throw", () => {
  fc.assert(
    fc.property(fc.string(), path => {
      const route = parse(path.startsWith("/") ? path : `/${path}`);
      return typeof route.cluster === "string" && typeof route.page === "string";
    }),
    { numRuns: 1000 },
  );
});

test("parse and href are inverses for any route href can express", () => {
  // The two are written next to each other precisely so they cannot drift; this
  // is that claim, checked rather than asserted.
  const segment = fc.string({ minLength: 1 }).filter(s => !s.includes("/") && s.trim().length > 0);
  fc.assert(
    fc.property(segment, segment, (cluster, page) => {
      const round = parse(href({ cluster, page }));
      return round.cluster === cluster && round.page === page;
    }),
    { numRuns: 500 },
  );
});

test("worstHealth returns the worst of its inputs, and nothing else", () => {
  const health = fc.constantFrom(...(Object.keys(HEALTH_PRIORITY) as (keyof typeof HEALTH_PRIORITY)[]));
  fc.assert(
    fc.property(fc.array(health, { minLength: 1 }), healths => {
      const worst = worstHealth(healths);
      // It is one of the inputs...
      if (!healths.includes(worst)) return false;
      // ...and nothing in the list is worse than it.
      return healths.every(h => HEALTH_PRIORITY[h] >= HEALTH_PRIORITY[worst]);
    }),
    { numRuns: 500 },
  );
});

test("adding a healthy child never changes a rollup", () => {
  const health = fc.constantFrom(...(Object.keys(HEALTH_PRIORITY) as (keyof typeof HEALTH_PRIORITY)[]));
  fc.assert(
    fc.property(
      fc.array(health, { minLength: 1 }),
      healths => worstHealth([...healths, "Healthy"]) === worstHealth(healths),
    ),
    { numRuns: 300 },
  );
});

test("a topology graph never invents, drops or orphans a node", () => {
  const object = fc.record({
    uid: fc.string({ minLength: 1, maxLength: 6 }),
    kind: fc.constantFrom("Pod", "ReplicaSet", "Deployment", "DaemonSet"),
    name: fc.string({ minLength: 1, maxLength: 8 }),
    health: fc.constantFrom("Healthy", "Degraded", "Progressing", "Suspended", "Unknown", "Missing"),
  });
  fc.assert(
    fc.property(
      fc.uniqueArray(object, { selector: o => o.uid, maxLength: 25 }),
      fc.array(fc.nat(), { maxLength: 25 }),
      (objects, owners) => {
        // Point each object at some other object by index, so the owner graph is
        // arbitrary — including the cycles a malformed cluster could produce.
        const input = objects.map((o, i) => ({
          ...o,
          ownerUids: objects.length > 1 && owners[i] !== undefined ? [objects[owners[i] % objects.length].uid] : [],
        }));
        const topo = buildTopology(input);

        if (topo.nodes.length !== input.length) return false;
        const uids = new Set(topo.nodes.map(n => n.uid));
        if (uids.size !== input.length) return false;
        // Every edge joins two nodes that exist, and no node owns itself.
        return topo.edges.every(e => uids.has(e.from) && uids.has(e.to) && e.from !== e.to);
      },
    ),
    { numRuns: 300 },
  );
});

test("cluster initials are always renderable: 1 to 3 uppercase characters", () => {
  // The rail draws these into a fixed 24px tile, so an empty or overlong string
  // is a visual break rather than a wrong value.
  fc.assert(
    fc.property(
      fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
      name => {
        const { short } = profileToCluster({ id: name, name, server: "s", token: "" });
        return typeof short === "string" && short.length >= 1 && short.length <= 3 && short === short.toUpperCase();
      },
    ),
    { numRuns: 500 },
  );
});

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// A minimal localStorage, because the store reads one at module load and the
// unit tier has no DOM.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { FEATURE_FLAGS, isFeatureEnabled, setFeatureEnabled } = await import("../../app/ui/feature-flags.ts");

const KEY = "hd-feature-flags";
const flag = (id: string) => FEATURE_FLAGS.find(f => f.id === id)!;

beforeEach(() => {
  store.clear();
  for (const f of FEATURE_FLAGS) setFeatureEnabled(f.id, !f.defaultOff);
  store.clear();
});

test("an untouched store is the shipped state: on, except where declared off", () => {
  for (const f of FEATURE_FLAGS) assert.equal(isFeatureEnabled(f.id), !f.defaultOff, f.id);
  // Topology ships off — it is a second application that walks the whole
  // workload set, not something a clean install should open with.
  assert.equal(flag("topology").defaultOff, true);
  assert.equal(isFeatureEnabled("topology"), false);
  assert.equal(isFeatureEnabled("diff"), true);
});

test("only choices that differ from the default are stored", () => {
  // Nothing has been changed, so nothing is written.
  setFeatureEnabled("diff", true);
  assert.deepEqual(JSON.parse(store.get(KEY) ?? "{}"), {});
  setFeatureEnabled("diff", false);
  assert.deepEqual(JSON.parse(store.get(KEY)!), { diff: false });
  // Turning an off-by-default flag on is just as much a deviation.
  setFeatureEnabled("topology", true);
  assert.deepEqual(JSON.parse(store.get(KEY)!), { diff: false, topology: true });
  // An id the store has never heard of is on.
  assert.equal(isFeatureEnabled("some-future-flag"), true);
});

test("returning a flag to its default leaves nothing behind", () => {
  setFeatureEnabled("topology", true);
  assert.equal(isFeatureEnabled("topology"), true);
  setFeatureEnabled("topology", false);
  assert.equal(isFeatureEnabled("topology"), false);
  assert.deepEqual(JSON.parse(store.get(KEY)!), {});
});

test("a flag turned off and on again round-trips", () => {
  assert.equal(isFeatureEnabled("diff"), true);
  setFeatureEnabled("diff", false);
  assert.equal(isFeatureEnabled("diff"), false);
  setFeatureEnabled("diff", true);
  assert.equal(isFeatureEnabled("diff"), true);
});

test("flags are independent", () => {
  setFeatureEnabled("fleet-health", false);
  assert.equal(isFeatureEnabled("fleet-health"), false);
  assert.equal(isFeatureEnabled("diff"), true);
});

test("every declared flag has a label and a description", () => {
  for (const f of FEATURE_FLAGS) {
    assert.ok(f.label.length > 0, `${f.id} label`);
    // The description is what a user reads before switching something; a flag
    // without one is a switch with no stated consequence.
    assert.ok(f.description.length > 20, `${f.id} description`);
  }
});

test("a store written in the old shape — an array of disabled ids — still counts", async () => {
  // The array form shipped first. Reading it as "nothing is set" would quietly
  // switch someone's features back on, which is the one thing a flag must not do.
  store.clear();
  store.set(KEY, JSON.stringify(["diff"]));
  const fresh = await import(`../../app/ui/feature-flags.ts?legacy=${Date.now()}`);
  assert.equal(fresh.isFeatureEnabled("diff"), false);
  // And a flag absent from the old array keeps its own default, not "on".
  assert.equal(fresh.isFeatureEnabled("topology"), false);
  assert.equal(fresh.isFeatureEnabled("fleet-health"), true);
});

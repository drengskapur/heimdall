import assert from "node:assert/strict";
import test from "node:test";
import {
  backendContractStates,
  heimdallStatechart,
  navigationStates,
  overlayStates,
  preferenceStates,
} from "./contracts/heimdall-statechart.mjs";

test("the full-stack statechart is exhaustive, reachable, and executable", () => {
  assert.equal(heimdallStatechart.type, "parallel");
  assert.equal(navigationStates.length, 44);
  assert.equal(preferenceStates.length, 6);
  assert.equal(overlayStates.length, 11);
  assert.equal(backendContractStates.length, 8);

  for (const region of Object.values(heimdallStatechart.regions)) {
    const ids = region.states.map(state => state.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes(region.initial));
    assert.ok(region.states.every(state => state.oracle && Object.keys(state.oracle).length > 0));
    assert.ok(region.transitions.every(transition => ids.includes(transition.from) && ids.includes(transition.to)));
    const reachable = new Set([region.initial]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const transition of region.transitions) {
        if (reachable.has(transition.from) && !reachable.has(transition.to)) {
          reachable.add(transition.to);
          changed = true;
        }
      }
    }
    assert.deepEqual(
      [...ids].filter(id => !reachable.has(id)),
      [],
    );
  }
});

test("every declared state maps to a real test oracle", () => {
  assert.ok(navigationStates.every(state => state.testId && state.oracle.activeClass === "active"));
  assert.ok(preferenceStates.every(state => state.route && state.oracle.dialog === "Preferences"));
  assert.ok(overlayStates.every(state => state.testRef.endsWith("hidden-states.spec.ts")));
  assert.ok(
    backendContractStates.every(state => state.request.path.startsWith("/") && Number.isInteger(state.response.status)),
  );
});

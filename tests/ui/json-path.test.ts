import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonPath, renderValue } from "../../app/ui/resource/json-path";

const obj = {
  metadata: { name: "widget-1" },
  spec: { replicas: 3, containers: [{ image: "nginx" }, { image: "redis" }] },
  status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
};

test("jsonPath walks dot paths (leading dot optional)", () => {
  assert.equal(jsonPath(obj, ".status.phase"), "Running");
  assert.equal(jsonPath(obj, "spec.replicas"), 3);
  assert.equal(jsonPath(obj, ".metadata.name"), "widget-1");
});

test("jsonPath resolves array indices", () => {
  assert.equal(jsonPath(obj, ".status.conditions[0].type"), "Ready");
  assert.equal(jsonPath(obj, ".spec.containers[1].image"), "redis");
});

test("jsonPath treats [*] as the first element (Lens printer-column behavior)", () => {
  assert.equal(jsonPath(obj, ".spec.containers[*].image"), "nginx");
});

test("jsonPath returns undefined for missing or mismatched segments (never throws)", () => {
  assert.equal(jsonPath(obj, ".spec.missing.deep"), undefined);
  assert.equal(jsonPath(obj, ".metadata.name.nope"), undefined);
  assert.equal(jsonPath(obj, ".status.conditions[9].type"), undefined);
});

test("jsonPath with empty path returns the whole object", () => {
  assert.equal(jsonPath(obj, ""), obj);
  assert.equal(jsonPath(obj, "."), obj);
});

test("renderValue: nullish → dash, objects → JSON, primitives → string", () => {
  assert.equal(renderValue(undefined), "—");
  assert.equal(renderValue(null), "—");
  assert.equal(renderValue(3), "3");
  assert.equal(renderValue(true), "true");
  assert.equal(renderValue({ a: 1 }), '{"a":1}');
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHpaMetrics } from "../../app/ui/metrics/hpa";

test("v2 Resource utilization metric → percent current/target", () => {
  const hpa = {
    spec: {
      metrics: [
        { type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 50 } } },
      ],
    },
    status: { currentMetrics: [{ type: "Resource", resource: { name: "cpu", current: { averageUtilization: 37 } } }] },
  };
  assert.deepEqual(parseHpaMetrics(hpa), [{ name: "cpu", current: "37%", target: "50%" }]);
});

test("v2 Resource metric with no current yet → dash", () => {
  const hpa = {
    spec: { metrics: [{ type: "Resource", resource: { name: "cpu", target: { averageUtilization: 50 } } }] },
    status: { currentMetrics: null },
  };
  assert.deepEqual(parseHpaMetrics(hpa), [{ name: "cpu", current: "—", target: "50%" }]);
});

test("v2 Pods averageValue metric", () => {
  const hpa = {
    spec: {
      metrics: [{ type: "Pods", pods: { metric: { name: "packets-per-second" }, target: { averageValue: "1k" } } }],
    },
    status: {
      currentMetrics: [
        { type: "Pods", pods: { metric: { name: "packets-per-second" }, current: { averageValue: "800" } } },
      ],
    },
  };
  assert.deepEqual(parseHpaMetrics(hpa), [{ name: "packets-per-second", current: "800", target: "1k" }]);
});

test("v2 External value metric", () => {
  const hpa = {
    spec: { metrics: [{ type: "External", external: { metric: { name: "queue_depth" }, target: { value: "30" } } }] },
    status: {
      currentMetrics: [{ type: "External", external: { metric: { name: "queue_depth" }, current: { value: "12" } } }],
    },
  };
  assert.deepEqual(parseHpaMetrics(hpa), [{ name: "queue_depth", current: "12", target: "30" }]);
});

test("v2beta1 flat targetAverageUtilization shape", () => {
  const hpa = {
    spec: { metrics: [{ type: "Resource", resource: { name: "cpu", targetAverageUtilization: 80 } }] },
    status: { currentMetrics: [{ type: "Resource", resource: { name: "cpu", currentAverageUtilization: 65 } }] },
  };
  assert.deepEqual(parseHpaMetrics(hpa), [{ name: "cpu", current: "65%", target: "80%" }]);
});

test("multiple metrics are all parsed", () => {
  const hpa = {
    spec: {
      metrics: [
        { type: "Resource", resource: { name: "cpu", target: { averageUtilization: 50 } } },
        { type: "Resource", resource: { name: "memory", target: { averageValue: "500Mi" } } },
      ],
    },
    status: { currentMetrics: [] },
  };
  const out = parseHpaMetrics(hpa);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map(m => m.name),
    ["cpu", "memory"],
  );
  assert.equal(out[1].target, "500Mi");
});

test("no spec metrics → empty (never throws on a bare object)", () => {
  assert.deepEqual(parseHpaMetrics({}), []);
  assert.deepEqual(parseHpaMetrics(null), []);
});

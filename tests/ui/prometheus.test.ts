import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesPrometheus, parseInstant } from "../../app/ui/metrics/prometheus";

test("matchesPrometheus accepts the standard server names", () => {
  assert.equal(matchesPrometheus("prometheus"), true);
  assert.equal(matchesPrometheus("prometheus-server"), true);
  assert.equal(matchesPrometheus("prometheus-k8s"), true);
  assert.equal(matchesPrometheus("prometheus-operated"), true);
});

test("matchesPrometheus accepts by well-known labels", () => {
  assert.equal(matchesPrometheus("my-metrics", { "app.kubernetes.io/name": "prometheus" }), true);
  assert.equal(matchesPrometheus("x", { app: "prometheus" }), true);
});

test("matchesPrometheus excludes the ecosystem sidecars", () => {
  assert.equal(matchesPrometheus("prometheus-node-exporter"), false);
  assert.equal(matchesPrometheus("prometheus-alertmanager"), false);
  assert.equal(matchesPrometheus("prometheus-pushgateway"), false);
  assert.equal(matchesPrometheus("prometheus-kube-state-metrics"), false);
  assert.equal(matchesPrometheus("prometheus-operator"), false);
});

test("matchesPrometheus rejects unrelated services", () => {
  assert.equal(matchesPrometheus("nginx"), false);
  assert.equal(matchesPrometheus("kubernetes", { app: "kube" }), false);
});

test("parseInstant extracts metric labels + numeric values from a vector", () => {
  const resp = {
    status: "success",
    data: {
      resultType: "vector",
      result: [
        { metric: { __name__: "up", job: "prometheus" }, value: [1699999999, "1"] },
        { metric: { __name__: "up", job: "node" }, value: [1699999999, "0"] },
      ],
    },
  };
  const out = parseInstant(resp);
  assert.equal(out.length, 2);
  assert.equal(out[0].value, 1);
  assert.equal(out[0].metric.job, "prometheus");
  assert.equal(out[1].value, 0);
});

test("parseInstant tolerates empty / malformed responses", () => {
  assert.deepEqual(parseInstant({}), []);
  assert.deepEqual(parseInstant({ data: { result: [{ metric: {}, value: [0, "NaN"] }] } }), []);
  assert.deepEqual(parseInstant(null), []);
});

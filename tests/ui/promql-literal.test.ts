import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeMetricTabs, podMetricTabs, promQlLiteral } from "../../app/ui/metrics/metrics-queries";

// The metric selectors use PromQL's `=~`, which is a regex match, and Kubernetes
// names may contain `.`. Node names in particular are usually FQDNs. Interpolated
// raw, every dot is a wildcard, so one node's chart quietly summed in any sibling
// whose name differed only at those positions — a wrong number rendered as
// confidently as a right one.

/** Prometheus anchors `=~` at both ends; this is the matcher it builds. */
const asMatcher = (selector: string) => new RegExp(`^(?:${selector})$`);

test("a dotted name matches only itself", () => {
  const node = "ip-10-0-1-2.ec2.internal";
  const sibling = "ip-10-0-1-2Xec2Xinternal";
  assert.equal(asMatcher(node).test(sibling), true, "unescaped: the bug");
  assert.equal(asMatcher(promQlLiteral(node)).test(sibling), false);
  assert.equal(asMatcher(promQlLiteral(node)).test(node), true, "still matches the real node");
});

test("regex metacharacters are neutralised", () => {
  for (const [raw, hostile] of [
    [".*", "anything-at-all"],
    ["a|b", "b"],
    ["pod-(1)", "pod-1"],
  ] as const) {
    assert.equal(asMatcher(raw).test(hostile), true, `unescaped ${raw} over-matches`);
    assert.equal(asMatcher(promQlLiteral(raw)).test(hostile), false, `escaped ${raw} must not`);
  }
});

test("the escaping is applied where the queries are built", () => {
  const pod = podMetricTabs("kube-system", "coredns-1.2.3")[0];
  assert.ok(pod, "podMetricTabs returns tabs");
  assert.match(JSON.stringify(pod), /coredns-1\\\\\.2\\\\\.3/, "pod name is escaped in the query");

  const node = nodeMetricTabs("ip-10-0-1-2.ec2.internal")[0];
  assert.ok(node, "nodeMetricTabs returns tabs");
  assert.match(JSON.stringify(node), /ip-10-0-1-2\\\\\.ec2\\\\\.internal/, "node name is escaped in the query");
});

test("an ordinary name is left alone", () => {
  assert.equal(promQlLiteral("nginx-7d9f8"), "nginx-7d9f8");
  assert.equal(promQlLiteral("kube-system"), "kube-system");
});

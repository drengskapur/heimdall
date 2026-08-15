import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChartIndex } from "../../app/ui/helm/helm-charts";

const index = `apiVersion: v1
entries:
  nginx:
    - name: nginx
      version: "15.1.0"
      appVersion: "1.25.0"
      description: A web server
      home: https://nginx.org
    - name: nginx
      version: "15.0.0"
      appVersion: "1.24.0"
      description: A web server
  redis:
    - name: redis
      version: "18.2.0"
      appVersion: "7.2"
      deprecated: true
`;

test("parseChartIndex returns one chart per entry with the latest version first", () => {
  const charts = parseChartIndex(index, "https://example.com/charts");
  assert.equal(charts.length, 2);
  const nginx = charts.find(c => c.name === "nginx")!;
  assert.equal(nginx.version, "15.1.0");
  assert.equal(nginx.appVersion, "1.25.0");
  assert.equal(nginx.repo, "https://example.com/charts");
  assert.equal(nginx.versions.length, 2);
  assert.deepEqual(
    nginx.versions.map(v => v.version),
    ["15.1.0", "15.0.0"],
  );
});

test("parseChartIndex sorts versions with natural/numeric collation", () => {
  const y = `entries:\n  app:\n    - {name: app, version: "1.9.0"}\n    - {name: app, version: "1.10.0"}\n    - {name: app, version: "1.2.0"}\n`;
  const [chart] = parseChartIndex(y, "r");
  assert.deepEqual(
    chart.versions.map(v => v.version),
    ["1.10.0", "1.9.0", "1.2.0"],
  );
});

test("parseChartIndex surfaces deprecation from the latest version", () => {
  const charts = parseChartIndex(index, "r");
  assert.equal(charts.find(c => c.name === "redis")!.deprecated, true);
});

test("parseChartIndex charts are sorted by name", () => {
  assert.deepEqual(
    parseChartIndex(index, "r").map(c => c.name),
    ["nginx", "redis"],
  );
});

test("parseChartIndex captures the first chart .tgz URL (needed for install)", () => {
  const y = `entries:
  app:
    - name: app
      version: "2.0.0"
      urls:
        - https://example.com/charts/app-2.0.0.tgz
        - oci://mirror/app-2.0.0
    - name: app
      version: "1.0.0"
`;
  const [chart] = parseChartIndex(y, "r");
  assert.equal(chart.versions[0].url, "https://example.com/charts/app-2.0.0.tgz");
  assert.equal(chart.versions[1].url, undefined); // no urls → undefined, not a crash
});

test("parseChartIndex tolerates malformed / empty input (never throws)", () => {
  assert.deepEqual(parseChartIndex("::: not yaml", "r"), []);
  assert.deepEqual(parseChartIndex("apiVersion: v1", "r"), []);
  assert.deepEqual(parseChartIndex("entries:\n  broken:\n    - {}\n", "r"), []); // no version → dropped
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { type HelmRelease, HelmReleaseView } from "./helm-release";

const release = (overrides: Partial<HelmRelease> = {}): HelmRelease => ({
  name: "web",
  namespace: "default",
  version: 3,
  info: { status: "deployed" },
  chart: { metadata: { name: "nginx", version: "1.2.3" } },
  ...overrides,
});

test("status reads info.status, defaulting to unknown", () => {
  assert.equal(HelmReleaseView.status(release()), "deployed");
  assert.equal(HelmReleaseView.status(release({ info: {} })), "unknown");
  assert.equal(HelmReleaseView.status(release({ info: undefined })), "unknown");
});

test("chartName joins chart name and version", () => {
  assert.equal(HelmReleaseView.chartName(release()), "nginx-1.2.3");
  assert.equal(HelmReleaseView.chartName(release({ chart: { metadata: { name: "redis" } } })), "redis");
  assert.equal(HelmReleaseView.chartName(release({ chart: undefined })), "");
});

test("a chart with no metadata yields an empty name rather than throwing", () => {
  // `metadata` is optional on the wire, and the chain has to survive its
  // absence — dropping either `?.` turns a partial release into a crash.
  assert.equal(HelmReleaseView.chartName({ name: "r", chart: {} } as never), "");
  assert.equal(HelmReleaseView.chartName({ name: "r" } as never), "");
  assert.equal(
    HelmReleaseView.chartName({ name: "r", chart: { metadata: { name: "nginx", version: "1.2.3" } } } as never),
    "nginx-1.2.3",
  );
  // Only one half present: no stray separator.
  assert.equal(HelmReleaseView.chartName({ name: "r", chart: { metadata: { name: "nginx" } } } as never), "nginx");
});

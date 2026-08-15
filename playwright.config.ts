import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// End-to-end tests that drive the PWA against a Kubernetes cluster through the
// local worker / companion.
//
// Two backends are supported:
//   * k3d (CI job `e2e`)      — a real single-node cluster; the companion is
//     started by the CI job and reaches it over the kubeconfig server URL.
//   * simulator (`e2e-sim`)   — an in-memory Kubernetes API served by
//     tests/e2e/kube-simulator.mjs; no Docker required. Enabled by setting
//     HEIMDALL_E2E_SIMULATOR=1, which starts the simulator as a second web
//     server and points the tests at the kubeconfig it writes.
const useSimulator = process.env.HEIMDALL_E2E_SIMULATOR === "1";
const simKubeconfig = resolve(process.cwd(), ".e2e/sim-kubeconfig.yaml");

if (useSimulator) {
  // The spec reads its kubeconfig from this env var at import time; the simulator
  // web server (below) writes the file before it starts listening.
  process.env.HEIMDALL_E2E_KUBECONFIG = simKubeconfig;
}

const devServer = {
  // The Vite SPA dev runner: serves the app on :3000 and proxies /api (incl. the
  // /api/kube-stream WebSocket) to the Node API server.
  command: "node scripts/dev-spa.mjs",
  url: "http://localhost:3000",
  reuseExistingServer: true,
  timeout: 180_000,
  env: { HEIMDALL_SPA_PORT: "3000" },
};

const simulatorServer = {
  command: "node tests/e2e/kube-simulator.mjs",
  url: "http://127.0.0.1:7444/healthz",
  reuseExistingServer: true,
  timeout: 30_000,
  env: {
    HEIMDALL_SIM_PORT: "7444",
    HEIMDALL_SIM_TOKEN: "e2e",
    HEIMDALL_SIM_KUBECONFIG: simKubeconfig,
  },
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1426, height: 891 },
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: useSimulator ? [devServer, simulatorServer] : [devServer],
});

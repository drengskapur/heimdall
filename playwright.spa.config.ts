import { defineConfig } from "@playwright/test";

// The *built* SPA, served by the Node API server exactly as it ships — as
// opposed to playwright.config.ts, which drives the Vite dev server.
//
// This config is what scripts/run-e2e-spa.mjs has always invoked; the file
// itself was missing, so `npm run test:e2e:spa` failed before it started a
// browser. It exists now because the PWA behaviour it covers cannot be tested
// against a dev server: the service worker precaches `/assets/*`, which only
// exist in a production build.
//
// Its own port, so it never contends with the dev-server e2e run (3011) or the
// accessibility sweep (3012).
const PORT = 3055;

export default defineConfig({
  testDir: "./tests/spa",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1280, height: 800 } },
  webServer: {
    command: "node server/api-server.mjs",
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 60_000,
    env: { HEIMDALL_API_PORT: String(PORT), HEIMDALL_SPA_DIR: "dist" },
  },
});

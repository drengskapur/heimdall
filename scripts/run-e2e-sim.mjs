// Portable launcher for the simulator-backed E2E run. Sets the toggle the
// Playwright config reads, then delegates to `playwright test`. Works the same
// on Windows and Linux CI without needing cross-env.
import { spawnSync } from "node:child_process";

process.env.HEIMDALL_E2E_SIMULATOR = "1";
process.env.HEIMDALL_COMPANION_TOKEN = process.env.HEIMDALL_COMPANION_TOKEN || "";

const result = spawnSync("npx", ["playwright", "test", "--config", "playwright.config.ts", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);

// Builds the Vite SPA, then runs the cluster E2E against it (served by the Node
// API server), proving the vinext-free build renders and connects.
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
process.env.HEIMDALL_COMPANION_TOKEN = process.env.HEIMDALL_COMPANION_TOKEN || "";

execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "vite.config.ts"], {
  cwd: root,
  stdio: "inherit",
});

const result = spawnSync(
  "npx",
  ["playwright", "test", "--config", "playwright.spa.config.ts", ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit", shell: true, env: process.env },
);
process.exit(result.status ?? 1);

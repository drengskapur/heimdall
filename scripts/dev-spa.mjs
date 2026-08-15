// Dev runner for the SPA: starts the Node API server (backend) and the Vite dev
// server (frontend, which proxies /api + the /api/kube-stream WebSocket to it).
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const children = [];
const run = (name, args, env) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  child.on("exit", code => {
    for (const c of children) if (c !== child) c.kill();
    process.exit(code ?? 0);
  });
  children.push(child);
};

// The API port is honoured from the environment rather than fixed, so two dev
// runners can coexist. It used to be hardcoded, which meant every consumer of
// `npm run dev` bound 3011: the accessibility sweep and the e2e runner both
// start one, they run back to back in the release gate, and the second failed
// with EADDRINUSE whenever the first had not finished letting go.
run("api", ["server/api-server.mjs"], {
  HEIMDALL_API_PORT: process.env.HEIMDALL_API_PORT ?? "3011",
  HEIMDALL_SPA_DIR: "dist",
});
run("vite", ["node_modules/vite/bin/vite.js", "--config", "vite.config.ts"], {});

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const c of children) c.kill();
    process.exit(0);
  });

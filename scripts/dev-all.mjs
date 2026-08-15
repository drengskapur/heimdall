// One-command dev: starts the local companion (fixed dev token + CORS origins)
// AND the Vite UI dev server on :5199, so you never have the app up without its
// companion. Ctrl-C stops both.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const children = [];
const run = (args, env) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  child.on("exit", code => {
    for (const c of children) if (c !== child) c.kill();
    process.exit(code ?? 0);
  });
  children.push(child);
};

run(["scripts/companion-dev.mjs"], {});
run(["node_modules/vite/bin/vite.js", "--config", "vite.config.ts", "--port", "5199", "--strictPort"], {});

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const c of children) c.kill();
    process.exit(0);
  });

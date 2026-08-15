#!/usr/bin/env node
/**
 * The release gate: every check that has to pass before a version ships.
 *
 * It used to run the Freelens parity harness — exact-UI screenshots, the
 * all-surfaces sweep, a side-by-side fidelity report and an interface-contract
 * diff. All of that measured `app/components`, which no longer exists, so six of
 * its seven jobs referenced files that had been deleted and the gate could not
 * run at all.
 *
 * What replaces it is the suite that covers the app that actually ships, in the
 * order that fails cheapest first: formatting and types before anything is
 * built, unit tests before a browser is started, and the two browser suites last
 * because they cost a minute each.
 *
 * `test:a11y` and `test:e2e:sim` are deliberately *not* run concurrently with
 * each other: both bind port 5199, and the e2e runner starts its own server.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const jobs = [
  { name: "format", args: ["run", "format:check"] },
  { name: "lint", args: ["run", "lint"] },
  { name: "typecheck", args: ["run", "typecheck"] },
  { name: "unit + integration", args: ["test"] },
  { name: "production build", args: ["run", "build"] },
  { name: "accessibility", args: ["run", "test:a11y"] },
  { name: "end-to-end", args: ["run", "test:e2e:sim"] },
  // Last because it rebuilds: the offline guarantee can only be checked against
  // a production build, since the service worker precaches hashed /assets/*.
  { name: "offline (built SPA)", args: ["run", "test:e2e:spa"] },
];

function run(job) {
  return new Promise(resolve => {
    const started = performance.now();
    const child = spawn(npm, job.args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    child.on("close", code => resolve({ ...job, code, ms: performance.now() - started }));
  });
}

const results = [];
for (const job of jobs) {
  process.stdout.write(`\n──  ${job.name}\n`);
  const result = await run(job);
  results.push(result);
  // Stop at the first failure: the later jobs are the slow ones, and a red
  // typecheck tells you nothing new after you have also watched e2e fail.
  if (result.code !== 0) break;
}

process.stdout.write("\n");
for (const r of results) {
  process.stdout.write(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.name.padEnd(20)} ${(r.ms / 1000).toFixed(1)}s\n`);
}
const failed = results.filter(r => r.code !== 0);
const skipped = jobs.length - results.length;
if (skipped > 0) process.stdout.write(`      ${skipped} not run\n`);
process.exit(failed.length === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Runs the Jazzer.js fuzz targets in fuzz/.
 *
 * Compiles first: Jazzer installs its own instrumenting module loader, which
 * displaces tsx, so the code under test has to already be JavaScript by the time
 * Jazzer sees it. tsconfig.fuzz.json emits CommonJS into .fuzz-build for that
 * reason, and this writes the package.json that marks the directory as such.
 *
 *   node scripts/fuzz.mjs                 every target, a short run each
 *   node scripts/fuzz.mjs --runs 200000   longer
 *   node scripts/fuzz.mjs tar-archive     one target, by name
 *
 * A finding leaves a `crash-<sha1>` file in the working directory; re-run that
 * single input with `npx jazzer fuzz/<target>.fuzz.mjs crash-<sha1>`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const runsFlag = args.indexOf("--runs");
const runs = runsFlag === -1 ? 25_000 : Number(args[runsFlag + 1]);
const named = args.filter((a, i) => !a.startsWith("--") && i !== runsFlag + 1);

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (cmd, cmdArgs) =>
  spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });

process.stdout.write("compiling the code under test\n");
const built = run(npx, ["tsc", "-p", "tsconfig.fuzz.json"]);
if (built.status !== 0) process.exit(built.status ?? 1);
writeFileSync(path.join(root, ".fuzz-build", "package.json"), '{"type":"commonjs"}\n');

const targets = readdirSync(path.join(root, "fuzz"))
  .filter(f => f.endsWith(".fuzz.mjs"))
  .map(f => f.replace(".fuzz.mjs", ""))
  .filter(name => named.length === 0 || named.includes(name));

if (targets.length === 0) {
  process.stderr.write(`no such target. available: ${readdirSync(path.join(root, "fuzz")).join(", ")}\n`);
  process.exit(1);
}

const failed = [];
for (const target of targets) {
  // Each target keeps its own corpus, so a run starts from what previous runs
  // found interesting rather than from nothing. The tar target in particular is
  // useless without one: a header is 512 bytes, and random input never gets
  // there — seeding it took its coverage from 6 branches to 43.
  const corpus = path.join(root, "fuzz", "corpus", target);
  if (!existsSync(corpus)) mkdirSync(corpus, { recursive: true });

  process.stdout.write(`\n── ${target} (${runs.toLocaleString()} runs)\n`);
  const result = run(npx, ["jazzer", `fuzz/${target}.fuzz.mjs`, corpus, "--sync", "--", `-runs=${runs}`]);
  if (result.status !== 0) failed.push(target);
}

process.stdout.write("\n");
for (const target of targets) process.stdout.write(`${failed.includes(target) ? "FAIL" : "PASS"}  ${target}\n`);
if (failed.length > 0) {
  process.stdout.write(
    "\nA crash- file in the working directory holds the input. Add it to the unit\ntests before fixing, so the case stays covered once the fuzzer moves on.\n",
  );
}
process.exit(failed.length === 0 ? 0 : 1);

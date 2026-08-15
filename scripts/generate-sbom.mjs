import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Generate sbom.cdx.json — a CycloneDX software bill of materials for what the
 * application ships.
 *
 * A consumer of a built SPA cannot see what went into the bundle. The SBOM is
 * the machine-readable answer: 58 components with their versions, licenses and
 * package URLs, which is what a vulnerability scanner needs to tell someone
 * whether a newly disclosed CVE reaches them.
 *
 * Scope is `--omit dev`, matching THIRD-PARTY-NOTICES.md: build and test tools
 * are not distributed and do not belong in a bill of materials for the artifact.
 *
 * Two flags are load-bearing:
 *
 * `--output-reproducible` drops the timestamp and serial number. They change on
 * every run, so with them the file could never be diffed and `--check` below
 * would fail constantly — turning a drift gate into noise everyone learns to
 * ignore.
 *
 * `--ignore-npm-errors` is needed because `npm ls` exits non-zero over one stale
 * transitive peer range: react-popper@2.3.0, reached through @blueprintjs/core,
 * still declares `react: ^16.8.0 || ^17 || ^18`. Blueprint itself supports
 * `18 || 19` and the suite passes on React 19; the range is upstream lag, not a
 * conflict here. Without the flag the generator refuses to emit anything, so
 * this trades an unfixable warning for an SBOM that exists.
 */

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "sbom.cdx.json");

const args = [
  // From the lockfile, not from node_modules. The installed tree is
  // platform-dependent: @pkgjs/parseargs is optional and lands on Windows but
  // not on a Linux runner, so a document generated here could never match one
  // generated there — CI said exactly that once the check learned to print its
  // diff. The lockfile is the same bytes for everyone, which is the only basis
  // on which a committed artifact can be checked for drift.
  "--package-lock-only",
  "--omit",
  "dev",
  "--spec-version",
  "1.6",
  "--output-format",
  "json",
  "--output-reproducible",
  "--ignore-npm-errors",
];

/** Run the generator to a given path and return what it wrote. */
function generate(target) {
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, "node_modules", "@cyclonedx", "cyclonedx-npm", "bin", "cyclonedx-npm-cli.js"),
      ...args,
      "--output-file",
      target,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  return result;
}

/** Drop the record of *what generated this*, keeping the record of what is in it.
 *
 *  `metadata.tools` names the generating npm, and npm's version is a property of
 *  the machine: 10.8.3 here, something else on a CI runner with the same Node
 *  major. Committing a document that embeds it makes the drift check unpassable
 *  anywhere but the machine that last ran it — CI went red for exactly that, and
 *  a check that cannot pass is worse than no check. Nothing about the shipped
 *  dependency set is lost; the tool entry describes the generator, not the
 *  product. */
function normalise(json) {
  const document = JSON.parse(json);
  delete document.metadata?.tools;
  // `cdx:npm:package:path` is where npm happened to hoist the package in this
  // install — "node_modules/x" or "node_modules/y/node_modules/x" depending on
  // the resolver's mood and its version. That is a fact about the tree on disk,
  // not about what ships, and it moves between npm versions exactly as the tool
  // record does.
  for (const component of document.components ?? []) {
    component.properties = (component.properties ?? []).filter(p => p.name !== "cdx:npm:package:path");
    if (!component.properties.length) delete component.properties;
  }
  return `${JSON.stringify(document, null, 2)}
`;
}

/** The same document with this project's own version neutralised.
 *
 *  Used only for comparison, never for what is written. The version appears in
 *  metadata.component, in its purl, and as a prefix on every dependency's
 *  bom-ref, so release-please bumping package.json makes the committed file
 *  differ from a freshly generated one in fifty-odd places — none of which say
 *  anything about the dependency set this file exists to describe. Without this
 *  the check would fail on every single release, which is the fastest way to
 *  train people to ignore it. A real dependency change still differs. */
export function versionAgnostic(text) {
  // Two shapes, and the first attempt only handled one. Most occurrences are
  // "name@version" — the root bom-ref, its purl, and the prefix on every
  // dependency's bom-ref — which a plain string substitution covers. But
  // metadata.component also carries a bare `version` field with no name
  // attached, and that single line kept the check failing on every release
  // while the diff pointed at lines the comparison had already forgiven.
  //
  // Working on the parsed document handles the bare field directly, and the
  // substitution on the re-serialised text handles the rest. No regex, so no
  // escaping to get wrong — an earlier version built one and over-escaped it
  // into matching a literal backslash, replacing nothing.
  const document = JSON.parse(text);
  const component = document.metadata?.component;
  if (!component?.name || !component.version) return text;
  const { name, version } = component;
  component.version = "VERSION";
  return JSON.stringify(document, null, 2).split(`${name}@${version}`).join(`${name}@VERSION`);
}

/** The first places two documents diverge, so a failure explains itself.
 *
 *  The earlier version of this check said only "out of date", which sent me
 *  guessing at what a CI runner had produced differently. */
function firstDifferences(expected, actual, limit = 6) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i++) {
    if (a[i] === b[i]) continue;
    out.push(`    line ${i + 1}: committed=${JSON.stringify(a[i] ?? null)} generated=${JSON.stringify(b[i] ?? null)}`);
  }
  return out.join("\n");
}

const check = process.argv.includes("--check");
const target = check ? resolve(root, "sbom.cdx.check.json") : output;

generate(target);

const raw = await readFile(target, "utf8").catch(() => null);
const produced = raw === null ? null : normalise(raw);
if (produced === null) {
  console.error("The SBOM generator produced no output. Run `npm ci` and try again.");
  process.exit(1);
}

const count = JSON.parse(produced).components?.length ?? 0;

if (check) {
  await rm(target);
  const existing = await readFile(output, "utf8").catch(() => null);
  if (versionAgnostic(existing ?? "") !== versionAgnostic(produced)) {
    if (existing === null) console.error("sbom.cdx.json is missing. Run: npm run sbom:generate");
    else {
      console.error("sbom.cdx.json is out of date with the installed dependencies. Run: npm run sbom:generate");
      console.error("  first differences:");
      // The *normalised* texts, which is what the comparison uses. Diffing the
      // raw ones showed the neutralised version lines first and buried the real
      // cause past the limit — it sent me chasing a difference that the check
      // had already forgiven.
      console.error(firstDifferences(versionAgnostic(existing), versionAgnostic(produced)));
    }
    process.exitCode = 1;
  } else {
    console.log(`sbom.cdx.json is current (${count} components).`);
  }
} else {
  await writeFile(output, produced);
  console.log(`Wrote sbom.cdx.json (${count} components).`);
}

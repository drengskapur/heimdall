import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// Imported from the build script itself: this function is easy to get subtly
// wrong, and already was once.
import { versionAgnostic } from "../../scripts/generate-sbom.mjs";

// The SBOM records the project's own version in metadata.component, in its purl,
// and as a prefix on every dependency bom-ref. release-please bumps that version
// on every release, so without this the drift check fails on each one — for
// reasons that say nothing about the dependency set the file describes.
//
// A first attempt built a regex and over-escaped it into matching a literal
// backslash, so it replaced nothing while appearing to work: the local check
// passed only because `--package-lock-only` reads the version from the lockfile,
// and the simulation had edited package.json. Hence a test of the function
// itself rather than of a scenario that can be faked.

const sbom = readFileSync(new URL("../../sbom.cdx.json", import.meta.url), "utf8");
const currentVersion = /"bom-ref":\s*"[^"@]+@([^"|]+)"/.exec(sbom)?.[1];

test("the committed SBOM carries a real version to neutralise", () => {
  assert.ok(currentVersion, "root bom-ref should name a version");
  assert.match(currentVersion, /^\d+\.\d+\.\d+/);
});

/** The document as a regenerated one would look after a release: the version
 *  changes in `metadata.component` *and* in every "name@version", because both
 *  come from the same package.json. Bumping only one produces a document that
 *  the generator could never emit, which is what an earlier version of these
 *  tests did — and it failed against a fix that works on the real thing. */
const asRelease = (text: string, to: string) => {
  const document = JSON.parse(text);
  const { name, version } = document.metadata.component;
  document.metadata.component.version = to;
  return JSON.stringify(document, null, 2).split(`${name}@${version}`).join(`${name}@${to}`);
};

test("a release bump alone compares equal", () => {
  const released = asRelease(sbom, "99.0.0");
  assert.notEqual(sbom, released, "the simulated bump must actually change the text");
  assert.equal(versionAgnostic(sbom), versionAgnostic(released));
});

test("the bare metadata.component.version is neutralised too", () => {
  // The shape the first fix missed. Every other occurrence is "name@version";
  // this is a lone field with no name attached, and that single line kept the
  // check red on the 0.8.1 release PR while the diff pointed elsewhere.
  assert.equal(JSON.parse(versionAgnostic(sbom)).metadata.component.version, "VERSION");
});

test("a real dependency change still differs", () => {
  const changed = sbom.replace('"version": "7.29.7"', '"version": "1.2.3"');
  assert.notEqual(sbom, changed, "the fixture should contain that dependency version");
  assert.notEqual(versionAgnostic(sbom), versionAgnostic(changed));
});

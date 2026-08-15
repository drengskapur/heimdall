import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Biome validates biome.json against the schema version named in `$schema`, and
// treats a mismatch with the running CLI as a diagnostic. Locally that surfaced
// as an info and exit 0; on the CI runner the same mismatch was an error and
// exit 1, so bumping @biomejs/biome without touching the URL turned the build
// red on a machine other than the one that made the change. The two are a pair,
// and nothing but this connects them.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("biome.json's schema version matches the installed Biome", () => {
  const installed = (JSON.parse(read("../../package.json")) as { devDependencies: Record<string, string> })
    .devDependencies["@biomejs/biome"];
  assert.ok(installed, "@biomejs/biome is a devDependency");

  const declared = /biomejs\.dev\/schemas\/([^/]+)\/schema\.json/.exec(read("../../biome.json"))?.[1];
  assert.ok(declared, "biome.json names a schema version");

  assert.equal(
    declared,
    installed.replace(/^[^\d]*/, ""),
    "bump the $schema URL in biome.json to match @biomejs/biome in package.json",
  );
});

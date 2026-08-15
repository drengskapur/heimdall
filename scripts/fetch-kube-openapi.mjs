// Vendors the official Kubernetes OpenAPI (swagger 2.0) for every minor version
// listed in openapi/kubernetes/versions.json (or the versions passed on the CLI).
// Only the raw swagger is written — it is the committed source of truth. The
// OpenAPI 3 conversion and TypeScript generation happen in `npm run codegen`.
//
//   node scripts/fetch-kube-openapi.mjs             # all versions in versions.json
//   node scripts/fetch-kube-openapi.mjs 1.36 1.37   # specific minors (also records them)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dir = join(root, "openapi/kubernetes");
const manifestPath = join(dir, "versions.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const requested = process.argv.slice(2);
const versions = requested.length ? requested : manifest.versions;
mkdirSync(dir, { recursive: true });

for (const minor of versions) {
  const url = `https://raw.githubusercontent.com/kubernetes/kubernetes/release-${minor}/api/openapi-spec/swagger.json`;
  process.stdout.write(`fetching k8s ${minor} — ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch Kubernetes swagger for ${minor}: ${res.status}`);
  writeFileSync(join(dir, `swagger-v${minor}.json`), await res.text());
}

// Record any newly requested versions in the manifest, keeping it sorted.
if (requested.length) {
  const merged = [...new Set([...manifest.versions, ...requested])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, versions: merged }, null, 2) + "\n");
}
process.stdout.write(`vendored ${versions.length} version(s). Run \`npm run codegen\` to regenerate types.\n`);

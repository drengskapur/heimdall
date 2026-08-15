// Enumerate the full API surface (Kubernetes + app-level) and cross-reference it
// against what the Heimdall UI actually implements, then emit a coverage report.
//
//   node scripts/enumerate-api-coverage.mjs            # human summary to stdout
//   node scripts/enumerate-api-coverage.mjs --json     # machine-readable JSON
//   node scripts/enumerate-api-coverage.mjs --md > docs/design/api-coverage.md
//
// Sources of truth:
//   * openapi/kubernetes/openapi-v1.36.json   — every servable k8s resource (from `paths`)
//   * openapi/app.openapi.json                — the app's own transport interfaces
//   * app/ui/resource/registry.tsx            — which k8s kinds the UI wires (RESOURCES)
//   * app/lib/generated/app-api.ts            — which app operations are typed/generated

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KUBE_SPEC = join(root, "openapi/kubernetes/openapi-v1.36.json");
const APP_SPEC = join(root, "openapi/app.openapi.json");
const REGISTRY = join(root, "app/ui/resource/registry.tsx");

const read = p => readFileSync(p, "utf8");
const json = p => JSON.parse(read(p));

// --- 1. Every servable Kubernetes resource, from the OpenAPI `paths` -------
// A "resource" is a distinct (group, version, plural) that supports `list`.
// The list operation carries `x-kubernetes-action: list` + the GVK + the path
// tells us the plural and whether it is namespaced.
// Rank an API version so we can collapse a kind served under several versions
// (v1 / v1beta1 / v1alpha1) down to its most-stable one, like `kubectl
// api-resources` shows a single row per resource. GA beats beta beats alpha;
// within a tier the higher number wins.
function versionRank(v) {
  const m = /^v(\d+)(?:(alpha|beta)(\d+))?$/.exec(v);
  if (!m) return -1;
  const major = Number(m[1]);
  const tier = m[2] === "alpha" ? 0 : m[2] === "beta" ? 1 : 2;
  const minor = m[3] ? Number(m[3]) : 0;
  return tier * 1_000_000 + major * 1_000 + minor;
}

function enumerateKubeResources() {
  const spec = json(KUBE_SPEC);
  const byKind = new Map(); // group/kind -> record (best version kept)
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const op of Object.values(ops)) {
      if (!op || typeof op !== "object") continue;
      if (op["x-kubernetes-action"] !== "list") continue;
      const gvk = op["x-kubernetes-group-version-kind"];
      if (!gvk) continue;
      // plural = the trailing static path segment of the list path.
      const segs = path.split("/").filter(Boolean);
      const plural = segs[segs.length - 1];
      if (plural.startsWith("{")) continue; // safety
      const namespaced = path.includes("/namespaces/{namespace}/");
      const key = `${gvk.group}/${gvk.kind}`;
      const prev = byKind.get(key);
      const cand = {
        group: gvk.group,
        version: gvk.version,
        kind: gvk.kind,
        plural,
        namespaced,
        versions: new Set([gvk.version]),
      };
      if (!prev) {
        byKind.set(key, cand);
      } else {
        prev.versions.add(gvk.version);
        prev.namespaced = prev.namespaced || namespaced;
        // Keep the most stable version's plural/version label.
        if (versionRank(gvk.version) > versionRank(prev.version)) {
          prev.version = gvk.version;
          prev.plural = plural;
        }
      }
    }
  }
  return [...byKind.values()]
    .map(r => ({ ...r, versions: [...r.versions].sort((a, b) => versionRank(b) - versionRank(a)) }))
    .sort((a, b) => (a.group || "core").localeCompare(b.group || "core") || a.kind.localeCompare(b.kind));
}

// --- 2. Which kinds the UI registry wires ---------------------------------
// Parse every `kind: "X"` token that appears in a ResourceQuery/watchQuery, plus
// the typed descriptors declared by their gateway kind. This is deliberately
// text-based so the report stays in lockstep with the registry source.
function enumerateImplementedKinds() {
  const src = read(REGISTRY);
  const kinds = new Set();
  // Literal `kind: "X"` in a ResourceQuery/watchQuery (typed + generic descriptors).
  for (const m of src.matchAll(/kind:\s*"([A-Za-z]+)"/g)) kinds.add(m[1]);
  // Workload descriptors are declared as `workload("Deployment")` — the kind is
  // the call argument, not a literal `kind:` in the source.
  for (const m of src.matchAll(/workload\("([A-Za-z]+)"\)/g)) kinds.add(m[1]);
  // Typed descriptors reference their kind via the domain, not a literal `kind:`
  // in a query — but every one of ours also has a watchQuery with `kind:`, so the
  // regex above already covers pods/nodes/services/pvc/pv/workloads. Assert the
  // page-id count for a sanity signal.
  const pageIds = [...src.matchAll(/^\s{2}"?([a-z][a-z0-9-]*)"?:\s/gm)].map(m => m[1]);
  return { kinds, pageCount: new Set(pageIds).size };
}

// --- 3. App-level API operations ------------------------------------------
function enumerateAppApi() {
  const spec = json(APP_SPEC);
  const ops = [];
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op || typeof op !== "object" || !op.operationId) continue;
      ops.push({
        path,
        method: method.toUpperCase(),
        operationId: op.operationId,
        summary: op.summary || op.description || "",
      });
    }
  }
  // Is each operation actually generated into app-api.ts?
  const generated = read(join(root, "app/lib/generated/app-api.ts"));
  for (const op of ops) op.generated = generated.includes(`"${op.operationId}"`);
  return ops;
}

// --- 4. Typed-seam coverage: which mappers consume generated OpenAPI types --
// "Generated & used" means the DTO→domain mapper imports a `Wire*` alias from
// lib/kube-generated (itself sourced from the vendored spec) rather than a
// hand-written interface. This is the interface-stability dimension.
function enumerateTypedSeams() {
  const dir = join(root, "app/infrastructure/mappers");
  const { readdirSync } = require("node:fs");
  const seams = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith("-mapper.ts") || f.endsWith(".test.ts")) continue;
    const src = read(join(dir, f));
    seams.push({ mapper: f, generated: src.includes("kube-generated") });
  }
  return seams.sort((a, b) => a.mapper.localeCompare(b.mapper));
}

// --- Assemble -------------------------------------------------------------
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const seams = enumerateTypedSeams();
const kube = enumerateKubeResources();
const { kinds: implKinds, pageCount } = enumerateImplementedKinds();
const app = enumerateAppApi();

// Kinds that are structural/sub-resources, not "browsable" list views. We still
// report them but bucket them separately so the headline % reflects real kinds.
const NON_BROWSABLE = new Set([
  "APIGroup",
  "APIVersions",
  "APIResourceList",
  "Status",
  "WatchEvent",
  "DeleteOptions",
  "Scale",
  "Binding",
  "TokenRequest",
  "TokenReview",
  "SubjectAccessReview",
  "SelfSubjectAccessReview",
  "SelfSubjectRulesReview",
  "LocalSubjectAccessReview",
  "SelfSubjectReview",
  "Eviction",
  "NodeProxyOptions",
  "PodProxyOptions",
  "ServiceProxyOptions",
  "PodAttachOptions",
  "PodExecOptions",
  "PodPortForwardOptions",
  "ComponentStatus",
]);

// The kinds Lens/Heimdall actually surfaces as dedicated sidebar views (from the
// cloned Open-Lens renderer/components registration). This is the *honest*
// denominator for "parity": the raw OpenAPI has ~68 listable kinds, but Lens only
// curates ~37 into its sidebar — the rest are reachable only via generic CRD /
// API-discovery browsing. Kinds here that are absent from v1.36 (VerticalPodAutoscaler
// is a CRD; PodSecurityPolicy was removed in 1.25) simply won't appear in `browsable`.
const LENS_SIDEBAR_KINDS = new Set([
  "Pod",
  "Deployment",
  "DaemonSet",
  "StatefulSet",
  "ReplicaSet",
  "ReplicationController",
  "Job",
  "CronJob",
  "ConfigMap",
  "Secret",
  "ResourceQuota",
  "LimitRange",
  "HorizontalPodAutoscaler",
  "PodDisruptionBudget",
  "PriorityClass",
  "RuntimeClass",
  "Lease",
  "MutatingWebhookConfiguration",
  "ValidatingWebhookConfiguration",
  "Service",
  "Endpoints",
  "Ingress",
  "IngressClass",
  "NetworkPolicy",
  "StorageClass",
  "PersistentVolumeClaim",
  "PersistentVolume",
  "ServiceAccount",
  "Role",
  "ClusterRole",
  "RoleBinding",
  "ClusterRoleBinding",
  "Node",
  "Namespace",
  "Event",
  "CustomResourceDefinition",
]);

const browsable = kube.filter(r => !NON_BROWSABLE.has(r.kind));
for (const r of browsable) {
  r.implemented = implKinds.has(r.kind);
  r.lens = LENS_SIDEBAR_KINDS.has(r.kind);
}
// Parity = of the Lens-surfaced kinds that exist in v1.36, how many we implement.
const lensInSpec = browsable.filter(r => r.lens);
const lensDone = lensInSpec.filter(r => r.implemented);

const implemented = browsable.filter(r => r.implemented);
const missing = browsable.filter(r => !r.implemented);

// Group coverage
const groups = new Map();
for (const r of browsable) {
  const g = r.group || "core";
  if (!groups.has(g)) groups.set(g, { total: 0, done: 0, missing: [] });
  const e = groups.get(g);
  e.total++;
  if (r.implemented) e.done++;
  else e.missing.push(r.kind);
}

const pct = (n, d) => (d === 0 ? "0" : ((100 * n) / d).toFixed(0));

// --- Output ---------------------------------------------------------------
if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        kube: { total: browsable.length, implemented: implemented.length, resources: browsable },
        app,
        groups: Object.fromEntries(groups),
      },
      null,
      2,
    ),
  );
} else if (process.argv.includes("--md")) {
  const L = [];
  L.push("# API coverage — Heimdall vs. the Kubernetes + app API surface");
  L.push("");
  L.push("> Generated by `scripts/enumerate-api-coverage.mjs` from the vendored");
  L.push("> OpenAPI specs (k8s v1.36 + `openapi/app.openapi.json`) cross-referenced");
  L.push("> against `app/ui/resource/registry.tsx`. Re-run: `npm run coverage`.");
  L.push("");
  L.push("## Headline");
  L.push("");
  L.push(
    `- **Lens sidebar parity:** ${lensDone.length} / ${lensInSpec.length} of the kinds Lens curates into its sidebar (that exist in v1.36) — **${pct(lensDone.length, lensInSpec.length)}%**. This is the parity number that matters.`,
  );
  L.push(
    `- **Raw Kubernetes surface:** ${implemented.length} / ${browsable.length} listable kinds (${pct(implemented.length, browsable.length)}%). The remainder are API-discovery / CRD-only kinds Lens doesn't surface as sidebar views either.`,
  );
  L.push(`- **UI registry pages:** ${pageCount}`);
  L.push(`- **App-level operations:** ${app.filter(o => o.generated).length} / ${app.length} generated & typed`);
  L.push(
    `- **Typed mapper seams:** ${seams.filter(s => s.generated).length} / ${seams.length} consume generated OpenAPI types`,
  );
  L.push("");
  L.push("## Kubernetes coverage by API group");
  L.push("");
  L.push("| Group | Implemented | Total | % | Missing kinds |");
  L.push("|---|---|---|---|---|");
  for (const [g, e] of [...groups].sort((a, b) => b[1].total - a[1].total)) {
    L.push(`| \`${g}\` | ${e.done} | ${e.total} | ${pct(e.done, e.total)}% | ${e.missing.join(", ") || "—"} |`);
  }
  L.push("");
  L.push(`## Implemented kinds (${implemented.length})`);
  L.push("");
  L.push(implemented.map(r => `\`${r.kind}\``).join(" · "));
  L.push("");
  L.push(`## Not yet implemented (${missing.length})`);
  L.push("");
  L.push("| Kind | Group | Version | Plural | Scope |");
  L.push("|---|---|---|---|---|");
  for (const r of missing) {
    L.push(
      `| ${r.kind} | \`${r.group || "core"}\` | ${r.version} | ${r.plural} | ${r.namespaced ? "ns" : "cluster"} |`,
    );
  }
  L.push("");
  L.push(`## App-level API (${app.length} operations)`);
  L.push("");
  L.push("| Op | Method | Path | Generated | Summary |");
  L.push("|---|---|---|---|---|");
  for (const o of app) {
    L.push(
      `| \`${o.operationId}\` | ${o.method} | \`${o.path}\` | ${o.generated ? "✅" : "❌"} | ${o.summary.replace(/\|/g, "\\|").slice(0, 80)} |`,
    );
  }
  L.push("");
  L.push("## DTO→domain mapper seams (interface stability)");
  L.push("");
  L.push("> ✅ = the mapper consumes a generated `Wire*` type from the vendored");
  L.push("> OpenAPI spec; ❌ = hand-written interface (drift risk).");
  L.push("");
  L.push("| Mapper | Generated types |");
  L.push("|---|---|");
  for (const s of seams) L.push(`| \`${s.mapper}\` | ${s.generated ? "✅" : "❌"} |`);
  L.push("");
  console.log(L.join("\n"));
} else {
  console.log(
    `Lens sidebar parity:  ${lensDone.length}/${lensInSpec.length} (${pct(lensDone.length, lensInSpec.length)}%)  <- the parity number`,
  );
  console.log(
    `Raw k8s surface:      ${implemented.length}/${browsable.length} (${pct(implemented.length, browsable.length)}%)`,
  );
  console.log(`UI registry pages:    ${pageCount}`);
  console.log(`App-level operations: ${app.filter(o => o.generated).length}/${app.length} generated\n`);
  console.log("By group:");
  for (const [g, e] of [...groups].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `  ${g.padEnd(34)} ${String(e.done).padStart(2)}/${String(e.total).padStart(2)}  ${e.missing.join(", ")}`,
    );
  }
  console.log(`\nMissing (${missing.length}): ${missing.map(r => r.kind).join(", ")}`);
  console.log(`\nApp API:`);
  for (const o of app)
    console.log(`  ${o.generated ? "✅" : "❌"} ${o.method.padEnd(6)} ${o.operationId.padEnd(18)} ${o.path}`);
  console.log(`\nMapper seams (generated types): ${seams.filter(s => s.generated).length}/${seams.length}`);
  for (const s of seams) console.log(`  ${s.generated ? "✅" : "❌"} ${s.mapper}`);
}

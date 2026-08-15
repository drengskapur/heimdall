// Minimal JSONPath for CRD additionalPrinterColumns (Lens's
// convertKubectlJsonPathToNodeJsonPath + safeJSONPathValue, scoped to what
// printer columns actually use). Supports dot paths with optional array
// indices: `.status.phase`, `.spec.replicas`, `.status.conditions[0].type`,
// `.spec.containers[*].image` ([*] → first element, matching Lens). Any missing
// or type-mismatched segment yields undefined — it never throws.
export function jsonPath(raw: unknown, path: string): unknown {
  const clean = path.replace(/^\./, "");
  if (clean === "") return raw;
  let cursor: unknown = raw;
  for (const segment of clean.split(".")) {
    if (!segment) continue;
    const match = /^([^[\]]*)((?:\[[^\]]*\])*)$/.exec(segment);
    const key = match?.[1] ?? segment;
    if (key) {
      if (cursor == null || typeof cursor !== "object") return undefined;
      cursor = (cursor as Record<string, unknown>)[key];
    }
    for (const idx of match?.[2] ? [...match[2].matchAll(/\[([^\]]*)\]/g)].map(m => m[1]) : []) {
      if (!Array.isArray(cursor)) return undefined;
      const i = idx === "*" ? 0 : Number(idx);
      cursor = cursor[Number.isFinite(i) ? i : 0];
    }
  }
  return cursor;
}

/** Render a printer-column value: "—" for nullish, compact JSON for objects. */
export function renderValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

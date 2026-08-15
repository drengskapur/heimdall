// HorizontalPodAutoscaler metric parsing — the equivalent of Lens's HPA
// metric-parser. Joins each spec metric (the target) with the matching
// status.currentMetrics entry (the current value) into a readable
// "current / target" pair, across the autoscaling v2 / v2beta2 / v2beta1
// shapes. Reads defensively and never throws.
export interface HpaMetric {
  readonly name: string;
  readonly current: string;
  readonly target: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function get(obj: unknown, ...path: string[]): unknown {
  let cur = obj;
  for (const k of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function str(v: unknown): string | undefined {
  if (typeof v === "string" && v) return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/** A metric's "value" from either a target or current block, across API versions. */
function value(block: unknown, kind: string): string {
  const b = get(block, kind); // e.g. block.resource / block.pods / block.object / block.external
  // v2 / v2beta2: nested target{} or current{}
  const util = num(get(b, "target", "averageUtilization")) ?? num(get(b, "current", "averageUtilization"));
  if (util !== undefined) return `${util}%`;
  const avg = str(get(b, "target", "averageValue")) ?? str(get(b, "current", "averageValue"));
  if (avg !== undefined) return avg;
  const val = str(get(b, "target", "value")) ?? str(get(b, "current", "value"));
  if (val !== undefined) return val;
  // v2beta1: flat fields on the metric block
  const flatUtil = num(get(b, "targetAverageUtilization")) ?? num(get(b, "currentAverageUtilization"));
  if (flatUtil !== undefined) return `${flatUtil}%`;
  const flatAvg = str(get(b, "targetAverageValue")) ?? str(get(b, "currentAverageValue"));
  if (flatAvg !== undefined) return flatAvg;
  const flatVal = str(get(b, "targetValue")) ?? str(get(b, "currentValue"));
  return flatVal ?? "—";
}

/** Human name for a metric entry (the resource / custom-metric / object it targets). */
function metricName(entry: unknown): { kind: string; name: string } {
  const type = str(get(entry, "type"))?.toLowerCase();
  if (type === "resource" || get(entry, "resource"))
    return { kind: "resource", name: str(get(entry, "resource", "name")) ?? "resource" };
  if (type === "containerresource" || get(entry, "containerResource")) {
    return {
      kind: "containerResource",
      name: `${str(get(entry, "containerResource", "container")) ?? "?"}/${str(get(entry, "containerResource", "name")) ?? "resource"}`,
    };
  }
  if (type === "pods" || get(entry, "pods"))
    return {
      kind: "pods",
      name: str(get(entry, "pods", "metric", "name")) ?? str(get(entry, "pods", "metricName")) ?? "pods",
    };
  if (type === "object" || get(entry, "object"))
    return {
      kind: "object",
      name: str(get(entry, "object", "metric", "name")) ?? str(get(entry, "object", "metricName")) ?? "object",
    };
  if (type === "external" || get(entry, "external"))
    return {
      kind: "external",
      name: str(get(entry, "external", "metric", "name")) ?? str(get(entry, "external", "metricName")) ?? "external",
    };
  return { kind: "resource", name: "metric" };
}

/** Parse an HPA raw object into per-metric current/target pairs. */
export function parseHpaMetrics(raw: unknown): HpaMetric[] {
  const specMetrics = get(raw, "spec", "metrics");
  const currentMetrics = get(raw, "status", "currentMetrics");
  const specs = Array.isArray(specMetrics) ? specMetrics : [];
  const currents = Array.isArray(currentMetrics) ? currentMetrics : [];
  return specs.map(spec => {
    const { kind, name } = metricName(spec);
    const cur = currents.find(c => {
      const cm = metricName(c);
      return cm.kind === kind && cm.name === name;
    });
    return {
      name,
      target: value(spec, kind),
      current: cur ? value(cur, kind) : "—",
    };
  });
}

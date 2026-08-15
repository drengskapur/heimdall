// Prometheus provider — auto-detect an in-cluster Prometheus and query it
// through the apiserver service proxy (Lens's prometheus provider, minus the
// Electron). Detection matches the service by the well-known name/label
// patterns across the usual namespaces; queries hit /api/v1/query[_range] via
// the gateway's service proxy. Pure matchers/parsers are unit-tested.

import type { KubeObject } from "../../application/ports/kubernetes-gateway";
import type { ActiveCluster } from "../../infrastructure/composition-root";

export interface PrometheusService {
  readonly namespace: string;
  readonly name: string;
  readonly port: number;
}

/** Namespaces Prometheus is conventionally installed into (Lens's provider set). */
export const PROMETHEUS_NAMESPACES = ["monitoring", "prometheus", "lens-metrics", "kube-system", "observability"];

const EXCLUDE = /(node-exporter|alertmanager|pushgateway|operator|kube-state-metrics|blackbox|adapter)/i;

/** Does this service look like a Prometheus server? Matches the standard
 *  name/labels while excluding the ecosystem sidecars that also carry
 *  "prometheus" in their labels. */
export function matchesPrometheus(name: string, labels: Record<string, string> = {}): boolean {
  if (EXCLUDE.test(name)) return false;
  const nameHit = /^prometheus(-server|-k8s|-operated)?$/i.test(name) || name.toLowerCase() === "prometheus";
  const labelHit =
    labels["app.kubernetes.io/name"] === "prometheus" ||
    labels["app"] === "prometheus" ||
    labels["app.kubernetes.io/component"] === "prometheus";
  return nameHit || (labelHit && !EXCLUDE.test(labels["app.kubernetes.io/component"] ?? ""));
}

/** First port of a Service's raw object (defaults to 9090). */
function servicePort(raw: unknown): number {
  const ports = (raw as { spec?: { ports?: { port?: number }[] } })?.spec?.ports;
  return Array.isArray(ports) && typeof ports[0]?.port === "number" ? ports[0].port : 9090;
}

/** Scan the candidate namespaces for a Prometheus service. */
export async function detectPrometheus(cluster: ActiveCluster): Promise<PrometheusService | null> {
  for (const namespace of PROMETHEUS_NAMESPACES) {
    let services: KubeObject[];
    try {
      services = await cluster.resources.list({ apiVersion: "v1", kind: "Service", resource: "services", namespace });
    } catch {
      continue;
    }
    for (const svc of services) {
      const labels = (svc.raw as { metadata?: { labels?: Record<string, string> } })?.metadata?.labels ?? {};
      if (matchesPrometheus(svc.ref.name, labels)) {
        return { namespace, name: svc.ref.name, port: servicePort(svc.raw) };
      }
    }
  }
  return null;
}

// --- Result parsing (pure) -------------------------------------------------
export interface PromResult {
  readonly metric: Record<string, string>;
  readonly value: number;
}

/** Parse a Prometheus instant-query ("vector") response into typed samples. */
export function parseInstant(json: unknown): PromResult[] {
  const result = (json as { data?: { resultType?: string; result?: unknown[] } })?.data?.result;
  if (!Array.isArray(result)) return [];
  return result.flatMap(r => {
    const metric = (r as { metric?: Record<string, string> }).metric ?? {};
    const pair = (r as { value?: [number, string] }).value;
    const n = pair ? Number(pair[1]) : NaN;
    return Number.isFinite(n) ? [{ metric, value: n }] : [];
  });
}

/** Run an instant PromQL query via the service proxy. */
export async function promQuery(cluster: ActiveCluster, prom: PrometheusService, expr: string): Promise<PromResult[]> {
  const json = await cluster.gateway.serviceProxyGet<unknown>(
    prom.namespace,
    prom.name,
    prom.port,
    `/api/v1/query?query=${encodeURIComponent(expr)}`,
  );
  return parseInstant(json);
}

// --- Range queries (time-series for charts) --------------------------------
/** One time-series: its label set + [unix-seconds, value] samples. */
export interface PromSeries {
  readonly metric: Record<string, string>;
  readonly points: [number, number][];
}

/** Parse a Prometheus range-query ("matrix") response into typed series. */
export function parseRange(json: unknown): PromSeries[] {
  const result = (json as { data?: { result?: unknown[] } })?.data?.result;
  if (!Array.isArray(result)) return [];
  return result.map(r => {
    const metric = (r as { metric?: Record<string, string> }).metric ?? {};
    const values = (r as { values?: [number, string][] }).values ?? [];
    const points = values.flatMap(([ts, v]): [number, number][] => {
      const n = Number(v);
      return Number.isFinite(n) ? [[Number(ts), n]] : [];
    });
    return { metric, points };
  });
}

/** Run a range PromQL query via the service proxy (start/end unix-seconds, step seconds). */
export async function promQueryRange(
  cluster: ActiveCluster,
  prom: PrometheusService,
  expr: string,
  start: number,
  end: number,
  step: number,
): Promise<PromSeries[]> {
  const path = `/api/v1/query_range?query=${encodeURIComponent(expr)}&start=${start}&end=${end}&step=${step}`;
  const json = await cluster.gateway.serviceProxyGet<unknown>(prom.namespace, prom.name, prom.port, path);
  return parseRange(json);
}

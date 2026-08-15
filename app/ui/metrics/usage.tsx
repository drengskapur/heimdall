import { Card, Classes, NonIdealState, Spinner } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import type { KubeObject } from "../../application/ports/kubernetes-gateway";
import { activeCluster } from "../../infrastructure/composition-root";
import { humanizeClusterError } from "../cluster-error";
import styles from "./usage.module.css";

// ---------------------------------------------------------------------------
// Quantity parsers (Kubernetes resource.Quantity → base units)
// ---------------------------------------------------------------------------

/** Parse a CPU quantity to cores. Handles `250m` (milli), `1500u` (micro),
 *  `<n>n` (nano), and a plain number of cores (`4`, `1`). */
function parseCpu(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const s = value.trim();
  if (s === "") return 0;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  if (s.endsWith("m")) return n / 1e3; // millicores
  if (s.endsWith("u")) return n / 1e6; // microcores
  if (s.endsWith("n")) return n / 1e9; // nanocores
  return n; // plain cores
}

const BINARY_SUFFIX: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};

const DECIMAL_SUFFIX: Record<string, number> = {
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

/** Parse a memory quantity to bytes. Handles binary (`Ki`/`Mi`/`Gi`/`Ti`/…),
 *  decimal (`k`/`M`/`G`/…) suffixes, and plain bytes. */
function parseMemory(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const s = value.trim();
  if (s === "") return 0;
  const match = /^([0-9.]+)\s*([A-Za-z]*)$/.exec(s);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (!Number.isFinite(num)) return 0;
  const suffix = match[2];
  if (suffix === "") return num;
  if (suffix in BINARY_SUFFIX) return num * BINARY_SUFFIX[suffix];
  if (suffix in DECIMAL_SUFFIX) return num * DECIMAL_SUFFIX[suffix];
  return num;
}

/** Safely read a nested path off an untyped raw object. */
function pick(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur !== null && typeof cur === "object" && key in cur) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Choose a display unit + divisor for a memory magnitude (bytes). */
function memoryUnit(bytes: number): { unit: string; divisor: number } {
  if (bytes >= 2 ** 40) return { unit: "TiB", divisor: 2 ** 40 };
  if (bytes >= 2 ** 30) return { unit: "GiB", divisor: 2 ** 30 };
  if (bytes >= 2 ** 20) return { unit: "MiB", divisor: 2 ** 20 };
  if (bytes >= 2 ** 10) return { unit: "KiB", divisor: 2 ** 10 };
  return { unit: "B", divisor: 1 };
}

// ---------------------------------------------------------------------------
// Gauge — SVG donut/arc showing used/total with a percentage.
// ---------------------------------------------------------------------------

export interface GaugeProps {
  label: string;
  used: number;
  total: number;
  unit: string;
}

const GAUGE_SIZE = 120;
const GAUGE_STROKE = 12;
const GAUGE_RADIUS = (GAUGE_SIZE - GAUGE_STROKE) / 2;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

export function Gauge({ label, used, total, unit }: GaugeProps) {
  const ratio = total > 0 ? used / total : 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  const percent = Math.round(ratio * 100);
  const intentClass = ratio > 0.9 ? styles.danger : ratio >= 0.7 ? styles.warning : styles.success;
  const center = GAUGE_SIZE / 2;
  const dashOffset = GAUGE_CIRCUMFERENCE * (1 - clamped);

  return (
    <>
      <svg
        className={`${styles.gauge} ${intentClass}`}
        width={GAUGE_SIZE}
        height={GAUGE_SIZE}
        viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`}
        role="img"
        aria-label={`${label}: ${percent}% of ${total} ${unit}`}
      >
        <circle className={styles.gaugeTrack} cx={center} cy={center} r={GAUGE_RADIUS} strokeWidth={GAUGE_STROKE} />
        <circle
          className={styles.gaugeArc}
          cx={center}
          cy={center}
          r={GAUGE_RADIUS}
          strokeWidth={GAUGE_STROKE}
          strokeDasharray={GAUGE_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
        />
        <text className={styles.gaugePercent} x={center} y={center} textAnchor="middle" dominantBaseline="central">
          {percent}%
        </text>
      </svg>
      <div className={styles.label}>{label}</div>
      <div className={styles.detail}>
        {formatNumber(used)} / {formatNumber(total)} {unit}
      </div>
    </>
  );
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Whole numbers stay whole; otherwise one decimal.
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------------------------------------------------------------------------
// Sparkline — small auto-scaled SVG polyline.
// ---------------------------------------------------------------------------

export interface SparklineProps {
  points: number[];
  height?: number;
}

/** A responsive sparkline: fills its container width (viewBox 0..100) with a
 *  trend line over a soft area fill. Auto-scaled to the sample min/max. */
export function Sparkline({ points, height = 36 }: SparklineProps) {
  if (points.length === 0) return null;
  const W = 100,
    pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const usableW = W - pad * 2;
  const usableH = height - pad * 2;
  const stepX = points.length > 1 ? usableW / (points.length - 1) : 0;
  const xy = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (p - min) / range) * usableH;
    return [x, y] as const;
  });
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const lastX = xy[xy.length - 1][0].toFixed(1);
  const area = `${pad},${height - pad} ${line} ${lastX},${height - pad}`;

  return (
    <svg
      className={styles.sparkSvg}
      viewBox={`0 0 ${W} ${height}`}
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label="trend"
    >
      <polygon className={styles.sparkArea} points={area} />
      <polyline className={styles.sparkLine} points={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ClusterUsage — panel of node CPU/Memory gauges from capacity + metrics.
// ---------------------------------------------------------------------------

interface Usage {
  cpuUsed: number; // cores
  cpuTotal: number; // cores
  memUsed: number; // bytes
  memTotal: number; // bytes
}

type State =
  | { status: "no-cluster" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "no-metrics" }
  | { status: "ready"; usage: Usage };

function sumCapacityCpu(nodes: KubeObject[]): number {
  return nodes.reduce((acc, n) => acc + parseCpu(pick(n.raw, ["status", "capacity", "cpu"])), 0);
}

function sumCapacityMemory(nodes: KubeObject[]): number {
  return nodes.reduce((acc, n) => acc + parseMemory(pick(n.raw, ["status", "capacity", "memory"])), 0);
}

function sumUsageCpu(metrics: KubeObject[]): number {
  return metrics.reduce((acc, m) => acc + parseCpu(pick(m.raw, ["usage", "cpu"])), 0);
}

function sumUsageMemory(metrics: KubeObject[]): number {
  return metrics.reduce((acc, m) => acc + parseMemory(pick(m.raw, ["usage", "memory"])), 0);
}

/** Cluster resource usage — CPU + Memory gauges (used vs node capacity). */
export function ClusterUsage() {
  const [state, setState] = useState<State>({ status: "loading" });
  // Rolling percentage history for the sparklines (last ~40 samples).
  const [history, setHistory] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] });

  useEffect(() => {
    const cluster = activeCluster();
    if (!cluster) {
      setState({ status: "no-cluster" });
      return;
    }
    let cancelled = false;

    const sample = async () => {
      try {
        const nodes = await cluster.resources.list({ apiVersion: "v1", kind: "Node", resource: "nodes" });
        // Tolerate a missing/unavailable metrics API (metrics-server absent).
        const metrics = await cluster.resources
          .list({ apiVersion: "metrics.k8s.io/v1beta1", kind: "NodeMetrics", resource: "nodes" })
          .catch(() => [] as KubeObject[]);
        if (cancelled) return;
        if (metrics.length === 0) {
          setState({ status: "no-metrics" });
          return;
        }
        const usage = {
          cpuUsed: sumUsageCpu(metrics),
          cpuTotal: sumCapacityCpu(nodes),
          memUsed: sumUsageMemory(metrics),
          memTotal: sumCapacityMemory(nodes),
        };
        setState({ status: "ready", usage });
        setHistory(h => ({
          cpu: [...h.cpu, usage.cpuTotal ? (usage.cpuUsed / usage.cpuTotal) * 100 : 0].slice(-40),
          mem: [...h.mem, usage.memTotal ? (usage.memUsed / usage.memTotal) * 100 : 0].slice(-40),
        }));
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: humanizeClusterError(err) });
      }
    };

    void sample();
    const timer = setInterval(sample, 5000); // live: refresh every 5s
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (state.status === "no-cluster") {
    return (
      <NonIdealState
        icon="layout-sorted-clusters"
        title="No active cluster"
        description="Pick a cluster from the Hotbar to connect."
      />
    );
  }
  if (state.status === "loading") {
    return <NonIdealState icon={<Spinner />} title="Loading metrics…" />;
  }
  if (state.status === "error") {
    return <NonIdealState icon="error" title="Couldn't load usage" description={state.message} />;
  }
  if (state.status === "no-metrics") {
    // One muted line, not a full non-ideal state. Most clusters a local viewer
    // is pointed at have no metrics-server, so this is the ordinary case rather
    // than an exception — and rendering it at the size of a real failure left a
    // 300px block of nothing dominating the page it appears on.
    return (
      <div className={Classes.TEXT_MUTED}>
        No metrics. Install <code>metrics-server</code> for live CPU and memory.
      </div>
    );
  }

  const { usage } = state;
  const mem = memoryUnit(Math.max(usage.memTotal, usage.memUsed));

  return (
    <div className={styles.grid}>
      <Card className={styles.card}>
        <Gauge label="CPU" used={round(usage.cpuUsed, 2)} total={round(usage.cpuTotal, 2)} unit="cores" />
        <div className={styles.spark}>
          {history.cpu.length > 1 ? <Sparkline points={history.cpu} /> : <div className={styles.sparkPlaceholder} />}
        </div>
      </Card>
      <Card className={styles.card}>
        <Gauge
          label="Memory"
          used={round(usage.memUsed / mem.divisor, 1)}
          total={round(usage.memTotal / mem.divisor, 1)}
          unit={mem.unit}
        />
        <div className={styles.spark}>
          {history.mem.length > 1 ? <Sparkline points={history.mem} /> : <div className={styles.sparkPlaceholder} />}
        </div>
      </Card>
    </div>
  );
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

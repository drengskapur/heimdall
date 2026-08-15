import { NonIdealState, Spinner } from "@blueprintjs/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { activeCluster } from "../../infrastructure/composition-root";
import { humanizeClusterError } from "../cluster-error";
import styles from "./metrics-chart.module.css";
import type { MetricSeries, MetricTab, MetricUnit } from "./metrics-queries";
import { detectPrometheus, type PrometheusService, promQueryRange } from "./prometheus";

// ---------------------------------------------------------------------------
// Value formatting (Y-axis + legend), by unit.
// ---------------------------------------------------------------------------
const BYTE_STEPS: [string, number][] = [
  ["TiB", 2 ** 40],
  ["GiB", 2 ** 30],
  ["MiB", 2 ** 20],
  ["KiB", 2 ** 10],
  ["B", 1],
];

function unitScale(unit: MetricUnit, max: number): { div: number; suffix: string } {
  if (unit === "cpu") return { div: 1, suffix: "" };
  const [suf, div] = BYTE_STEPS.find(([, d]) => max >= d) ?? ["B", 1];
  return { div, suffix: unit === "bytesRate" ? `${suf}/s` : suf };
}

function fmtTick(unit: MetricUnit, v: number, div: number, suffix: string): string {
  if (unit === "cpu") return v >= 1 ? v.toFixed(1) : v.toFixed(3);
  const s = v / div;
  return `${s >= 10 ? s.toFixed(0) : s.toFixed(1)} ${suffix}`.trim();
}

function fmtTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Colors keyed by series role (theme-aware primary + fixed accents).
const SERIES_COLOR: Record<string, string> = {
  usage: "var(--bp-intent-primary-rest)",
  used: "var(--bp-intent-primary-rest)",
  receive: "var(--bp-intent-primary-rest)",
  transmit: "#e8a33d",
  requests: "#e8a33d",
  limits: "#d33f49",
  capacity: "#8a9ba8",
  size: "#8a9ba8",
};
const AREA_KEYS = new Set(["usage", "used", "receive"]);

interface Plotted extends MetricSeries {
  points: [number, number][];
}

// ---------------------------------------------------------------------------
// Container-width hook — lets the SVG render at real pixel width (crisp axes).
// ---------------------------------------------------------------------------
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setW(entries[0].contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---------------------------------------------------------------------------
// TimeSeriesChart — SVG area/line chart with axes + legend.
// ---------------------------------------------------------------------------
const H = 190,
  PAD_L = 56,
  PAD_R = 12,
  PAD_T = 10,
  PAD_B = 26;

function TimeSeriesChart({ series, unit }: { series: Plotted[]; unit: MetricUnit }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const W = Math.max(width, 240);

  const all = series.flatMap(s => s.points);
  const times = all.map(p => p[0]);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const rawMax = Math.max(0, ...all.map(p => p[1]));
  const yMax = rawMax > 0 ? rawMax * 1.1 : 1;
  const { div, suffix } = unitScale(unit, yMax);

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xAt = (ts: number) => (tMax === tMin ? PAD_L : PAD_L + ((ts - tMin) / (tMax - tMin)) * innerW);
  const yAt = (v: number) => PAD_T + (1 - v / yMax) * innerH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * yMax);
  const xTickCount = 4;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => tMin + ((tMax - tMin) * i) / xTickCount);

  const toPath = (pts: [number, number][]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(p[0]).toFixed(1)},${yAt(p[1]).toFixed(1)}`).join(" ");

  return (
    <div className={styles.chartWrap} ref={ref}>
      <svg width={W} height={H} role="img" aria-label="metric chart">
        {/* horizontal grid + y labels */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line className={styles.grid} x1={PAD_L} x2={W - PAD_R} y1={yAt(v)} y2={yAt(v)} />
            <text className={styles.axisLabel} x={PAD_L - 6} y={yAt(v)} textAnchor="end" dominantBaseline="central">
              {fmtTick(unit, v, div, suffix)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xTicks.map((ts, i) => (
          <text key={i} className={styles.axisLabel} x={xAt(ts)} y={H - 8} textAnchor="middle">
            {fmtTime(ts)}
          </text>
        ))}
        {/* series */}
        {series.map(s => {
          if (s.points.length === 0) return null;
          const color = SERIES_COLOR[s.key] ?? "var(--bp-intent-primary-rest)";
          const isArea = AREA_KEYS.has(s.key);
          const path = toPath(s.points);
          const areaPath = `${path} L${xAt(s.points[s.points.length - 1][0]).toFixed(1)},${yAt(0)} L${xAt(s.points[0][0]).toFixed(1)},${yAt(0)} Z`;
          const dashed = s.key === "limits" || s.key === "capacity" || s.key === "size";
          return (
            <g key={s.key}>
              {isArea && <path d={areaPath} fill={color} opacity={0.14} />}
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray={dashed ? "4 3" : undefined}
              />
            </g>
          );
        })}
      </svg>
      <div className={styles.legend}>
        {series.map(s => (
          <span key={s.key} className={styles.legendItem}>
            <span
              className={styles.swatch}
              style={{ background: SERIES_COLOR[s.key] ?? "var(--bp-intent-primary-rest)" }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricsPanel — tab switcher + chart, backed by a detected Prometheus.
// ---------------------------------------------------------------------------
type PanelState =
  | { status: "loading" }
  | { status: "no-metrics" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "ready"; series: Plotted[] };

/**
 * MetricsPanel — the time-series charts shown at the top of a detail drawer
 * (and reusable elsewhere). Detects an in-cluster Prometheus, then runs the
 * ground-truth range queries for the active tab over the last hour. Renders
 * nothing intrusive when metrics aren't available.
 */
export function MetricsPanel({ tabs }: { tabs: readonly MetricTab[] }) {
  const [tabId, setTabId] = useState(tabs[0]?.id ?? "");
  // undefined = still detecting; null = none found; service = found.
  const [prom, setProm] = useState<PrometheusService | null | undefined>(undefined);
  const [state, setState] = useState<PanelState>({ status: "loading" });

  useEffect(() => {
    const cluster = activeCluster();
    if (!cluster) {
      setProm(null);
      return;
    }
    let cancelled = false;
    detectPrometheus(cluster)
      .then(p => {
        if (!cancelled) setProm(p);
      })
      .catch(() => {
        if (!cancelled) setProm(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tab = tabs.find(t => t.id === tabId) ?? tabs[0];
  useEffect(() => {
    if (prom === undefined) return; // still detecting
    if (prom === null) {
      setState({ status: "no-metrics" });
      return;
    }
    const cluster = activeCluster();
    if (!cluster || !tab) return;
    let cancelled = false;

    const run = async () => {
      const end = Math.floor(Date.now() / 1000);
      const start = end - 3600;
      try {
        const results = await Promise.all(tab.series.map(s => promQueryRange(cluster, prom, s.expr, start, end, 60)));
        if (cancelled) return;
        const series: Plotted[] = tab.series.map((s, i) => ({ ...s, points: results[i][0]?.points ?? [] }));
        setState(series.every(s => s.points.length === 0) ? { status: "empty" } : { status: "ready", series });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: humanizeClusterError(err) });
      }
    };

    setState(s => (s.status === "ready" ? s : { status: "loading" }));
    void run();
    const timer = setInterval(run, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [prom, tab]);

  // When no Prometheus is available, stay quiet — the drawer still shows details.
  if (prom === null || state.status === "no-metrics") return null;

  return (
    <div className={styles.panel}>
      {tabs.length > 1 && (
        <div className={styles.tabBar} role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === tab?.id}
              className={t.id === tab?.id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setTabId(t.id)}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}
      {state.status === "loading" && (
        <div className={styles.chartMsg}>
          <Spinner size={20} />
        </div>
      )}
      {state.status === "empty" && (
        <div className={styles.chartMsg}>
          <NonIdealState
            icon="timeline-line-chart"
            title="No data"
            description="Prometheus returned no samples for this metric."
            iconSize={20}
          />
        </div>
      )}
      {state.status === "error" && (
        <div className={styles.chartMsg}>
          <NonIdealState icon="error" title="Metrics error" description={state.message} iconSize={20} />
        </div>
      )}
      {state.status === "ready" && <TimeSeriesChart series={state.series} unit={tab?.unit ?? "bytes"} />}
    </div>
  );
}

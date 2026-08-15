import type { Intent } from "@blueprintjs/core";
import { Card, Classes, NonIdealState, Spinner, Tag } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import type { WorkloadListItem } from "../../application/use-cases/workloads";
import type { WorkloadKind } from "../../domain/workload/workload";
import { activeCluster } from "../../infrastructure/composition-root";
import { navigateTo } from "../navigate";
import { HEALTH_PRIORITY, type Health, podHealth, replicaHealth } from "./health";
import { age } from "./registry";
import styles from "./workloads-overview.module.css";

/**
 * One workload type's health tally.
 *
 * A roll-up in Fleet's sense: a parent summarising its children *by state*
 * rather than counting the bad ones. The difference shows in the caption — "3
 * progressing" and "3 degraded" were both "3 with issues" before, and only one
 * of them is a reason to stop what you are doing.
 */
interface Tally {
  readonly key: string; // nav-tree page id to navigate to
  readonly label: string;
  readonly total: number;
  readonly issues: number;
  /** How many of each health code, worst first when read through HEALTH_PRIORITY. */
  readonly byHealth: Readonly<Partial<Record<Health, number>>>;
}

/** Count a list of health codes into a breakdown. */
function tallyHealth(healths: readonly Health[]): { issues: number; byHealth: Partial<Record<Health, number>> } {
  const byHealth: Partial<Record<Health, number>> = {};
  for (const h of healths) byHealth[h] = (byHealth[h] ?? 0) + 1;
  // Suspended is not an issue: a thing scaled to zero on purpose is not a fault,
  // and counting it as one made every idle CronJob look broken.
  const issues = healths.filter(h => h !== "Healthy" && h !== "Suspended").length;
  return { issues, byHealth };
}

/** The workload kinds shown as status donuts, in Lens sidebar order. Each maps
 *  to its nav-tree page id so clicking a card opens that list. */
const KINDS: ReadonlyArray<{ kind: WorkloadKind; key: string; label: string }> = [
  { kind: "Deployment", key: "deployments", label: "Deployments" },
  { kind: "DaemonSet", key: "daemon-sets", label: "Daemon Sets" },
  { kind: "StatefulSet", key: "stateful-sets", label: "Stateful Sets" },
  { kind: "ReplicaSet", key: "replica-sets", label: "Replica Sets" },
  { kind: "ReplicationController", key: "replication-controllers", label: "Replication Controllers" },
  { kind: "Job", key: "jobs", label: "Jobs" },
  { kind: "CronJob", key: "cron-jobs", label: "Cron Jobs" },
];

interface EventRow {
  id: string;
  type: string;
  reason: string;
  message: string;
  object: string;
  age: string;
  ts: number;
}

type State =
  | { status: "no-cluster" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; tallies: Tally[]; events: EventRow[] };

/** Workloads → Overview: a status donut per workload type (healthy vs issues)
 *  plus the most recent cluster events — mirrors Lens's Workloads overview. */
export function WorkloadsOverview() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const cluster = activeCluster();
    if (!cluster) {
      setState({ status: "no-cluster" });
      return;
    }
    let cancelled = false;
    const settle = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
    Promise.all([
      settle(cluster.pods.list(), []),
      ...KINDS.map(k => settle(cluster.workloads.list(k.kind), [])),
      settle(cluster.resources.list({ apiVersion: "v1", kind: "Event", resource: "events" }), []),
    ])
      .then(results => {
        if (cancelled) return;
        const pods = results[0];
        const workloadLists = results.slice(1, 1 + KINDS.length) as WorkloadListItem[][];
        const eventObjs = results[1 + KINDS.length] as Array<{ raw: unknown }>;

        const tallies: Tally[] = [
          {
            key: "pods",
            label: "Pods",
            total: pods.length,
            ...tallyHealth(pods.map(p => podHealth(p.status, p.hasIssues))),
          },
          ...KINDS.map((k, i) => {
            const list = workloadLists[i];
            return {
              key: k.key,
              label: k.label,
              total: list.length,
              // ready/desired straight off the domain model, through the same
              // function the tables use — this was the last place computing
              // health its own way.
              // `w.ready` is the formatted "3/3"; the numbers are on the workload.
              ...tallyHealth(list.map(w => replicaHealth(w.workload.ready, w.workload.desired))),
            };
          }),
        ];

        const events = eventObjs
          .map((o, i) => {
            const raw = o.raw as {
              type?: string;
              reason?: string;
              message?: string;
              involvedObject?: { kind?: string; name?: string };
              lastTimestamp?: string;
              eventTime?: string;
              metadata?: { uid?: string; creationTimestamp?: string };
            };
            const iso = raw.lastTimestamp ?? raw.eventTime ?? raw.metadata?.creationTimestamp;
            const io = raw.involvedObject;
            return {
              id: String(raw.metadata?.uid ?? i),
              type: String(raw.type ?? "Normal"),
              reason: String(raw.reason ?? ""),
              message: String(raw.message ?? ""),
              object: io?.kind ? `${io.kind}/${io.name ?? ""}` : "—",
              age: age(iso),
              ts: iso ? Date.parse(iso) || 0 : 0,
            };
          })
          .sort((a, b) => b.ts - a.ts)
          .slice(0, 25);

        setState({ status: "ready", tallies, events });
      })
      .catch(err => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
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
    return <NonIdealState icon={<Spinner />} title="Loading workloads…" />;
  }
  if (state.status === "error") {
    return <NonIdealState icon="error" title="Couldn't load workloads" description={state.message} />;
  }

  return (
    <div className={styles.page}>
      <div className={styles.grid}>
        {state.tallies.map(t => (
          <StatusCard key={t.key} tally={t} />
        ))}
      </div>
      <EventsPanel events={state.events} />
    </div>
  );
}

/** The worst state present, named. "3 degraded" and "3 progressing" are
 *  different situations and both used to read "3 with issues". */
function caption(tally: Tally): string {
  if (tally.total === 0) return "none";
  const worst = (Object.keys(tally.byHealth) as Health[])
    .filter(h => h !== "Healthy" && (tally.byHealth[h] ?? 0) > 0)
    .sort((a, b) => HEALTH_PRIORITY[a] - HEALTH_PRIORITY[b])[0];
  if (!worst) return "all healthy";
  return `${tally.byHealth[worst]} ${worst.toLowerCase()}`;
}

function StatusCard({ tally }: { tally: Tally }) {
  const healthy = Math.max(0, tally.total - tally.issues);
  return (
    <Card interactive className={styles.card} onClick={() => navigateTo(tally.key)}>
      <Donut healthy={healthy} issues={tally.issues} total={tally.total} />
      <div className={styles.cardLabel}>{tally.label}</div>
      <div className={`${styles.cardSub} ${Classes.TEXT_MUTED}`}>{caption(tally)}</div>
    </Card>
  );
}

/** A pure-SVG status donut: green healthy arc + red issues arc, count in center.
 *  No chart library — matches the app's inline-SVG approach (Sparkline). */
function Donut({ healthy, issues, total }: { healthy: number; issues: number; total: number }) {
  const size = 72,
    stroke = 8,
    r = (size - stroke) / 2,
    c = 2 * Math.PI * r,
    cx = size / 2;
  const frac = total > 0 ? healthy / total : 0;
  const issuesFrac = total > 0 ? issues / total : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={styles.donut}
      role="img"
      aria-label={`${healthy} healthy, ${issues} with issues`}
    >
      <circle cx={cx} cy={cx} r={r} fill="none" strokeWidth={stroke} className={styles.track} />
      {total > 0 && issues > 0 && (
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className={styles.issues}
          strokeDasharray={`${issuesFrac * c} ${c}`}
          strokeDashoffset={-frac * c}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      )}
      {total > 0 && healthy > 0 && (
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className={styles.healthy}
          strokeDasharray={`${frac * c} ${c}`}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      )}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className={styles.donutText}>
        {total}
      </text>
    </svg>
  );
}

function EventsPanel({ events }: { events: EventRow[] }) {
  const intentFor = (type: string): Intent => (/warn|error|fail/i.test(type) ? "warning" : "none");
  return (
    <div className={styles.events}>
      <div className={styles.eventsTitle}>Recent events</div>
      {events.length === 0 ? (
        <div className={`${styles.eventsEmpty} ${Classes.TEXT_MUTED}`}>No recent events.</div>
      ) : (
        <table className={styles.eventsTable}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Reason</th>
              <th>Object</th>
              <th>Message</th>
              <th className={styles.ageCol}>Age</th>
            </tr>
          </thead>
          <tbody>
            {events.map(e => (
              <tr key={e.id}>
                <td>
                  <Tag minimal intent={intentFor(e.type)}>
                    {e.type}
                  </Tag>
                </td>
                <td>{e.reason}</td>
                <td className={styles.objectCol}>{e.object}</td>
                <td className={styles.messageCol} title={e.message}>
                  {e.message}
                </td>
                <td className={styles.ageCol}>{e.age}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

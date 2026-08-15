import { Classes } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import type { KubeObject } from "../../application/ports/kubernetes-gateway";
import { activeCluster } from "../../infrastructure/composition-root";
import { navigateToObject } from "../navigate";
import { age } from "./age";
import styles from "./detail.module.css";
import { metaOf, type RelQuery, resolveRelations } from "./relations";

// ---------------------------------------------------------------------------
// The "Linked objects" panel. Which objects are related to which is declared as
// data in relations.ts; this file only resolves those declarations and renders
// the result.
// ---------------------------------------------------------------------------

interface RelRow {
  id: string;
  name: string;
  namespace?: string;
  /** Kind of the related object, for click-through navigation. */
  kind?: string;
  /** Pod phase or a short status string, drives the leading dot color. */
  status?: string;
  detail?: string;
  age: string;
}

/** A display row for one related object. The kind comes from the relation's own
 *  query, not the object: list responses routinely omit apiVersion/kind. */
function rowFor(o: KubeObject, kind: string): RelRow {
  const m = metaOf(o);
  const status = (o.raw.status ?? {}) as {
    phase?: string;
    replicas?: number;
    readyReplicas?: number;
    conditions?: { type?: string; status?: string }[];
  };
  const ready = status.conditions?.find(c => c.type === "Ready")?.status;
  return {
    id: String(m.uid ?? m.name),
    name: m.name ?? "",
    namespace: m.namespace,
    kind,
    status: status.phase ?? (ready === "True" ? "Ready" : ready === "False" ? "Failed" : undefined),
    detail: detailFor(o, kind, status),
    age: age(m.creationTimestamp),
  };
}

/** The one-line hint beside a related object — whatever is most useful per kind. */
function detailFor(
  o: KubeObject,
  kind: string,
  status: { replicas?: number; readyReplicas?: number },
): string | undefined {
  switch (kind) {
    case "Pod":
      return (o.raw.spec as { nodeName?: string } | undefined)?.nodeName;
    case "ReplicaSet":
      return `${status.readyReplicas ?? 0}/${status.replicas ?? 0} ready`;
    case "Secret":
      return typeof o.raw.type === "string" ? o.raw.type : undefined;
    case "Service":
      return (o.raw.spec as { clusterIP?: string } | undefined)?.clusterIP;
    case "PersistentVolume":
    case "PersistentVolumeClaim":
      return (o.raw.spec as { storageClassName?: string } | undefined)?.storageClassName;
    default:
      return undefined;
  }
}

type Group = { title: string; rows: RelRow[] };

/** Resolve this object's relations (see relations.ts) into display groups. */
async function loadRelated(raw: Record<string, unknown>): Promise<Group[]> {
  const cluster = activeCluster();
  if (!cluster) return [];
  const list = (q: RelQuery) => cluster.resources.list(q).catch(() => [] as KubeObject[]);
  const resolved = await resolveRelations(raw, list);
  return resolved.map(({ relation, query, objects }) => ({
    title: relation.title,
    rows: objects.map(o => rowFor(o, query.kind)),
  }));
}

const PHASE_CLASS: Record<string, string> = {
  Running: styles.dotOk,
  Ready: styles.dotOk,
  Succeeded: styles.dotInfo,
  Pending: styles.dotWarn,
  Failed: styles.dotError,
  Unknown: styles.dotWarn,
};

/** Related-resource sections for the current drawer object (async-loaded). */
export function RelatedResources({ raw }: { raw: Record<string, unknown> }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    loadRelated(raw)
      .then(g => {
        if (!cancelled) setGroups(g);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [raw]);

  // A skeleton of the panel rather than a spinner in a box. This column is now
  // a fixed part of the details view, so a spinner here is a hole in the layout
  // that fills with something a different size; the placeholder is the panel.
  if (groups === null) {
    return (
      <section className={styles.relPanel} aria-hidden>
        <div className={styles.relPanelHead}>Linked objects</div>
        {[0, 1].map(section => (
          <div className={styles.relSection} key={section}>
            <div className={styles.relTitle}>
              <span className={`${styles.relSkeleton} ${Classes.SKELETON}`} style={{ width: "40%" }}>
                &nbsp;
              </span>
            </div>
            {[0, 1, 2].map(row => (
              <div className={styles.relRow} key={row}>
                <span
                  className={`${styles.relSkeleton} ${Classes.SKELETON}`}
                  style={{ width: `${[78, 56, 68][row]}%` }}
                >
                  &nbsp;
                </span>
              </div>
            ))}
          </div>
        ))}
      </section>
    );
  }
  if (groups.length === 0) return null;

  // A named panel, not a trailing run of sections. Linked objects get
  // their own titled surface beside the object rather than appending them to the
  // bottom of its properties — measured at 4px radius with a shadow ring instead
  // of a border. See docs/design/chrome-spec.md.
  return (
    <section className={styles.relPanel}>
      <div className={styles.relPanelHead}>Linked objects</div>
      {groups.map(group => (
        <div className={styles.relSection} key={group.title}>
          <div className={styles.relTitle}>{group.title}</div>
          {group.rows.map(row => (
            <div className={styles.relRow} key={row.id}>
              <span
                className={`${styles.relDot} ${row.status ? (PHASE_CLASS[row.status] ?? styles.dotIdle) : styles.dotIdle}`}
              />
              {row.kind ? (
                // A <button>, not an <a role="button"> without href: the latter
                // is focusable but never activates on Enter or Space.
                <button
                  type="button"
                  className={styles.relName}
                  onClick={() => navigateToObject({ kind: row.kind!, name: row.name, namespace: row.namespace })}
                >
                  {row.name}
                </button>
              ) : (
                <span className={styles.relName}>{row.name}</span>
              )}
              <span className={styles.relMeta}>
                {row.detail}
                {row.detail && row.age ? " · " : ""}
                {row.age}
              </span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

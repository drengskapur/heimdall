import { Icon, NonIdealState, Spinner } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import type { KubeObject } from "../../application/ports/kubernetes-gateway";
import { activeCluster } from "../../infrastructure/composition-root";
import { navigateToObject } from "../navigate";
import { kindIcon } from "./kind-badge";
import { kindColor } from "./kind-color";
import styles from "./relation-graph.module.css";
import { metaOf, type RelQuery, resolveRelations } from "./relations";

/**
 * The object's neighbourhood, drawn.
 *
 * The Details panel already lists linked objects; a picture adds one thing a
 * list cannot — the shape of the fan-out, so "this Deployment owns one
 * ReplicaSet owning six Pods" is read rather than counted.
 *
 * Layout is deterministic, not simulated: each relation takes an angular
 * sector and its objects spread evenly within it. A force simulation would
 * animate, need a tick loop, and land somewhere different each open; for a
 * single object's neighbourhood there is nothing to discover that a fixed
 * arrangement hides.
 */

const WIDTH = 620;
const HEIGHT = 420;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const RADIUS = 150;
/** Beyond this per relation the ring turns into a hairball, so the rest are
 *  summarised in a single node instead. */
const MAX_PER_RELATION = 8;

interface Node {
  key: string;
  label: string;
  /** The untruncated name, when `label` had to be cut. */
  full?: string;
  sub?: string;
  x: number;
  y: number;
  /** Absent for the "+N more" summary, which is not a navigable object. */
  target?: { kind: string; name: string; namespace?: string };
}

interface Graph {
  centre: { label: string; kind: string };
  nodes: Node[];
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function build(
  raw: Record<string, unknown>,
  resolved: { relation: { title: string }; query: RelQuery; objects: KubeObject[] }[],
): Graph {
  const meta = (raw.metadata ?? {}) as { name?: string };
  const centre = { label: meta.name ?? "", kind: typeof raw.kind === "string" ? raw.kind : "" };
  const nodes: Node[] = [];

  // One angular sector per relation, so groups read as groups. Starting at
  // -90° puts the first sector at the top rather than the right.
  const sectors = resolved.length;
  resolved.forEach((group, gi) => {
    const shown = group.objects.slice(0, MAX_PER_RELATION);
    const overflow = group.objects.length - shown.length;
    const count = shown.length + (overflow > 0 ? 1 : 0);
    const sectorSize = (Math.PI * 2) / sectors;
    const sectorStart = -Math.PI / 2 + gi * sectorSize;

    for (let i = 0; i < count; i++) {
      // Inset from the sector's edges so adjacent groups stay visually distinct.
      const t = count === 1 ? 0.5 : (i + 0.5) / count;
      const angle = sectorStart + sectorSize * (0.12 + t * 0.76);
      const x = CX + Math.cos(angle) * RADIUS;
      const y = CY + Math.sin(angle) * RADIUS;
      const object = shown[i];

      if (!object) {
        nodes.push({
          key: `${group.relation.title}-more`,
          label: `+${overflow} more`,
          sub: group.relation.title,
          x,
          y,
        });
        continue;
      }
      const m = metaOf(object);
      const name = m.name ?? "";
      const label = truncate(name, 22);
      nodes.push({
        key: `${group.relation.title}-${m.uid ?? m.name ?? i}`,
        label,
        full: label === name ? undefined : name,
        sub: group.relation.title,
        x,
        y,
        target: { kind: group.query.kind, name: m.name ?? "", namespace: m.namespace },
      });
    }
  });

  return { centre, nodes };
}

export function RelationGraph({ raw }: { raw: Record<string, unknown> }) {
  const [graph, setGraph] = useState<Graph | null | "empty">(null);

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    void (async () => {
      const cluster = activeCluster();
      if (!cluster) return;
      const list = (q: RelQuery) => cluster.resources.list(q).catch(() => [] as KubeObject[]);
      const resolved = await resolveRelations(raw, list).catch(() => []);
      if (cancelled) return;
      setGraph(resolved.length === 0 ? "empty" : build(raw, resolved));
    })();
    return () => {
      cancelled = true;
    };
  }, [raw]);

  if (graph === null) return <NonIdealState icon={<Spinner />} title="Loading graph…" />;
  if (graph === "empty") {
    return (
      <NonIdealState icon="graph" title="Nothing linked" description="This object has no related objects to draw." />
    );
  }

  // Keyed on the object's *kind*, not on `n.sub` — that is the relation title
  // ("Config Maps"), a different vocabulary from the centre's kind ("Pod"), and
  // it would never match the fixed colour slots, which are singular kind names.
  // The relation is already printed under every node, so colouring by kind adds
  // a second axis instead of restating the first.
  const kinds = [...new Set([graph.centre.kind, ...graph.nodes.map(n => n.target?.kind ?? "")].filter(Boolean))];

  return (
    <div className={styles.wrap}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${graph.centre.kind} ${graph.centre.label} and its ${graph.nodes.length} linked objects`}
      >
        {/* Edges first so nodes paint over them. */}
        <g className={styles.edges}>
          {graph.nodes.map(n => (
            <line key={n.key} x1={CX} y1={CY} x2={n.x} y2={n.y} />
          ))}
        </g>

        <g className={styles.centre}>
          <circle cx={CX} cy={CY} r={13} style={{ fill: kindColor(graph.centre.kind) }} />
          {kindIcon(graph.centre.kind) && (
            <foreignObject x={CX - 8} y={CY - 8} width={16} height={16} className={styles.glyph}>
              <div className={styles.glyphBox}>
                <Icon icon={kindIcon(graph.centre.kind)} size={14} color="#fff" />
              </div>
            </foreignObject>
          )}
          {graph.centre.label.length > 28 && <title>{graph.centre.label}</title>}
          <text
            x={CX}
            y={CY - 18}
            textAnchor="middle"
            className={graph.centre.label.length > 28 ? styles.truncated : undefined}
          >
            {truncate(graph.centre.label, 28)}
          </text>
          <text x={CX} y={CY + 26} textAnchor="middle" className={styles.kind}>
            {graph.centre.kind}
          </text>
        </g>

        {graph.nodes.map(n => {
          const anchor = n.x < CX - 12 ? "end" : n.x > CX + 12 ? "start" : "middle";
          // Clear of the disc, which is 11px now rather than the 5px dot this
          // 10px offset was chosen for — at 10 the label started inside its own
          // node. 17 is the radius plus a gap.
          const dx = anchor === "end" ? -17 : anchor === "start" ? 17 : 0;
          const body = (
            <>
              {/* An inline style, not a `fill` attribute: presentation attributes lose
                  to any stylesheet rule, so `.node circle { fill }` silently won
                  and every node stayed grey. The "+N more" summary is skipped —
                  it is not an object and must keep its hollow dashed circle. */}
              <circle
                cx={n.x}
                cy={n.y}
                r={n.target ? 11 : 5}
                style={n.target ? { fill: kindColor(n.target.kind) } : undefined}
              />
              {/* The kind's own glyph, the same one the sidebar and the topology
                  graph use. This graph shows *mixed* kinds around one object —
                  a Service beside a ConfigMap beside a Pod — which is exactly
                  where a picture beats a colour that has to be looked up. The
                  dot grew from 5px to 11px to hold it; the "+N more" summary
                  keeps its small hollow circle, being no kind at all.
                  A foreignObject because Blueprint's Icon is HTML. */}
              {n.target && kindIcon(n.target.kind) && (
                <foreignObject x={n.x - 7} y={n.y - 7} width={14} height={14} className={styles.glyph}>
                  <div className={styles.glyphBox}>
                    <Icon icon={kindIcon(n.target.kind)} size={12} color="#fff" />
                  </div>
                </foreignObject>
              )}
              {/* A tooltip is offered only where text is actually clipped, and
                  marked with `cursor: help`. A graph label is
                  hard-truncated to 22 characters, so without this the rest of
                  the name is simply unavailable. */}
              {n.full && <title>{n.full}</title>}
              {/* A node directly above or below the centre has nowhere to put
                  its label sideways, so it is centred on the node — which was
                  survivable when the node was a 5px dot and is not now that it
                  is an 11px disc carrying a glyph. Those labels drop below it
                  instead; the sideways ones are unchanged. */}
              <text
                x={n.x + dx}
                y={n.y + (anchor === "middle" ? 26 : 4)}
                textAnchor={anchor}
                className={n.full ? styles.truncated : undefined}
              >
                {n.label}
              </text>
              {n.sub && (
                <text
                  x={n.x + dx}
                  y={n.y + (anchor === "middle" ? 39 : 17)}
                  textAnchor={anchor}
                  className={styles.kind}
                >
                  {n.sub}
                </text>
              )}
            </>
          );
          return n.target ? (
            <g
              key={n.key}
              className={styles.node}
              role="button"
              tabIndex={0}
              aria-label={`${n.sub}: ${n.label}`}
              onClick={() => navigateToObject(n.target!)}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigateToObject(n.target!);
                }
              }}
            >
              {body}
            </g>
          ) : (
            <g key={n.key} className={styles.more}>
              {body}
            </g>
          );
        })}
      </svg>
      {/* Colour needs decoding, so the graph carries a legend: a small
          resting-elevation card in the corner, one row
          per kind actually present. Built from the drawn nodes rather than from a
          fixed list, so it never names a kind that is not on screen. */}
      {kinds.length > 1 && (
        <ul className={styles.legend}>
          {kinds.map(kind => (
            <li key={kind} className={styles.legendRow}>
              <span className={styles.swatch} style={{ background: kindColor(kind) }} aria-hidden />
              {kind}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

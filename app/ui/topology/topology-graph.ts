import { type Health, worstHealth } from "../resource/health";

/**
 * The ownership forest behind the Topology app.
 *
 * Argo CD's `application-resource-tree` is the most recognisable thing in that
 * UI: every resource in an application laid out left to right, parents joined to
 * the children they own, each node carrying its health. It reads an Application's
 * declared resource list; the same tree is derivable here from `ownerReferences`,
 * which is how Kubernetes records the relationship anyway — a Deployment owns a
 * ReplicaSet owns a Pod, and each says so in its own metadata.
 *
 * Kept pure and separate from the view because a layout is arithmetic and worth
 * testing as arithmetic. The view does fetching, panning and painting.
 */

/** What the app feeds in: one entry per Kubernetes object. */
export interface TopoInput {
  readonly uid: string;
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string;
  /** `metadata.ownerReferences[].uid`. Owners outside the set are ignored. */
  readonly ownerUids?: readonly string[];
  readonly health: Health;
}

export interface TopoNode extends TopoInput {
  /** Column: 0 for a root, one more than its owner otherwise. */
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  /** Worst health in this node's subtree, itself included — Argo's rollup, so a
   *  collapsed or distant branch still shows that something under it is wrong. */
  readonly rollup: Health;
  readonly childCount: number;
}

export interface TopoEdge {
  readonly from: string;
  readonly to: string;
}

export interface Topology {
  readonly nodes: readonly TopoNode[];
  readonly edges: readonly TopoEdge[];
  readonly width: number;
  readonly height: number;
}

export const COLUMN_WIDTH = 220;
export const ROW_HEIGHT = 56;
export const NODE_WIDTH = 170;
export const NODE_HEIGHT = 40;
const MARGIN = 24;

/**
 * Build the forest.
 *
 * Depth comes from the owner chain, and an owner that is not in the input set is
 * treated as absent — a Pod whose ReplicaSet was not loaded is a root rather
 * than a dangling edge, which is what makes the graph safe to build from a
 * partial fetch.
 *
 * Rows are assigned depth-first: each leaf takes the next free row, and a parent
 * centres on its children. That is the classic tidy-tree placement and it is why
 * a Deployment sits level with the middle of its pods instead of at the top of
 * them.
 */
export function buildTopology(input: readonly TopoInput[]): Topology {
  const byUid = new Map(input.map(o => [o.uid, o]));
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();

  for (const o of input) {
    // First owner that is actually present. Kubernetes allows several; the
    // controller reference is the one that matters and it is almost always the
    // only one loaded.
    const owner = (o.ownerUids ?? []).find(uid => uid !== o.uid && byUid.has(uid));
    if (!owner) continue;
    parentOf.set(o.uid, owner);
    const siblings = childrenOf.get(owner);
    if (siblings) siblings.push(o.uid);
    else childrenOf.set(owner, [o.uid]);
  }

  // A cycle cannot happen in valid ownerReferences, but a malformed object
  // should not hang the UI — walking with a seen-set turns it into a root.
  const depthOf = (uid: string): number => {
    let depth = 0;
    const seen = new Set<string>([uid]);
    let cur = parentOf.get(uid);
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      depth++;
      cur = parentOf.get(cur);
    }
    return depth;
  };

  const roots = input.filter(o => !parentOf.has(o.uid)).map(o => o.uid);
  // Stable output for a stable input: unordered fetches must not reshuffle the
  // graph between refreshes.
  const sortKey = (uid: string) => {
    const o = byUid.get(uid)!;
    return `${o.kind}/${o.name}`;
  };
  roots.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  for (const list of childrenOf.values()) list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const rowOf = new Map<string, number>();
  const rollupOf = new Map<string, Health>();
  let nextRow = 0;

  const place = (uid: string): { row: number; rollup: Health } => {
    const kids = childrenOf.get(uid) ?? [];
    const self = byUid.get(uid)!.health;
    if (kids.length === 0) {
      const row = nextRow++;
      rowOf.set(uid, row);
      rollupOf.set(uid, self);
      return { row, rollup: self };
    }
    const placed = kids.map(place);
    const row = (placed[0].row + placed[placed.length - 1].row) / 2;
    const rollup = worstHealth([self, ...placed.map(p => p.rollup)]);
    rowOf.set(uid, row);
    rollupOf.set(uid, rollup);
    return { row, rollup };
  };
  for (const root of roots) place(root);

  const nodes: TopoNode[] = input.map(o => {
    const depth = depthOf(o.uid);
    return {
      ...o,
      depth,
      x: MARGIN + depth * COLUMN_WIDTH,
      y: MARGIN + (rowOf.get(o.uid) ?? 0) * ROW_HEIGHT,
      rollup: rollupOf.get(o.uid) ?? o.health,
      childCount: (childrenOf.get(o.uid) ?? []).length,
    };
  });
  nodes.sort((a, b) => a.depth - b.depth || a.y - b.y);

  const edges: TopoEdge[] = [];
  for (const [child, parent] of parentOf) edges.push({ from: parent, to: child });
  edges.sort((a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`));

  const maxDepth = nodes.reduce((n, x) => Math.max(n, x.depth), 0);
  return {
    nodes,
    edges,
    width: MARGIN * 2 + maxDepth * COLUMN_WIDTH + NODE_WIDTH,
    height: MARGIN * 2 + Math.max(nextRow, 1) * ROW_HEIGHT,
  };
}

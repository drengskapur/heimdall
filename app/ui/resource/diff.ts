/**
 * Live-versus-applied diff.
 *
 * Argo CD's `application-resources-diff` shows a resource's live state against
 * its desired state, which is the single most useful thing in that UI. It gets
 * the desired side from Git, which this app does not have.
 *
 * It does have the next best source: `kubectl.kubernetes.io/last-applied-
 * configuration`, the annotation kubectl writes on every apply. Diffing the live
 * object against it answers "has anything changed this since it was applied" —
 * a HorizontalPodAutoscaler rewriting replicas, a mutating webhook injecting a
 * sidecar, someone's `kubectl edit` at 2am — without needing a GitOps source at
 * all. Objects created by other means simply have no annotation and no tab.
 */

/** Fields the server owns. Present live, absent from the applied manifest, and
 *  noise in every diff — so they are removed from both sides rather than shown
 *  as hundreds of additions. */
const SERVER_FIELDS: readonly (readonly string[])[] = [
  ["status"],
  ["metadata", "managedFields"],
  ["metadata", "resourceVersion"],
  ["metadata", "uid"],
  ["metadata", "generation"],
  ["metadata", "creationTimestamp"],
  ["metadata", "selfLink"],
  ["metadata", "annotations", "kubectl.kubernetes.io/last-applied-configuration"],
  ["metadata", "annotations", "deployment.kubernetes.io/revision"],
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A deep copy with the server-owned fields removed. Does not mutate its input. */
export function stripServerFields(obj: unknown): unknown {
  const copy: unknown = structuredClone(obj);
  for (const path of SERVER_FIELDS) {
    let node: unknown = copy;
    for (let i = 0; i < path.length - 1 && isRecord(node); i++) node = node[path[i]];
    if (isRecord(node)) delete node[path[path.length - 1]];
  }
  // An annotations map emptied by the above is itself noise.
  if (isRecord(copy) && isRecord(copy.metadata) && isRecord(copy.metadata.annotations)) {
    if (Object.keys(copy.metadata.annotations).length === 0) delete copy.metadata.annotations;
  }
  return copy;
}

export type DiffLine =
  | { readonly kind: "same" | "add" | "del"; readonly text: string }
  /** A collapsed run of unchanged lines. */
  | { readonly kind: "skip"; readonly count: number };

/**
 * Line diff by longest common subsequence.
 *
 * The table is O(n·m), which is fine for manifests — a large one is a few
 * hundred lines — and gives a minimal edit script rather than the ragged output
 * a greedy line-by-line walk produces when a block moves.
 */
export function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  // lcs[i][j] = length of the longest common subsequence of before[i:] / after[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: "same", text: before[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "del", text: before[i] });
      i++;
    } else {
      out.push({ kind: "add", text: after[j] });
      j++;
    }
  }
  for (; i < n; i++) out.push({ kind: "del", text: before[i] });
  for (; j < m; j++) out.push({ kind: "add", text: after[j] });
  return out;
}

/**
 * Collapse long runs of unchanged lines, keeping `context` on each side of a
 * change — git's unified-diff convention, and the reason a diff of a 300-line
 * manifest with one changed field is readable at all.
 */
export function collapseContext(lines: readonly DiffLine[], context = 3): DiffLine[] {
  const changed = lines.map(l => l.kind === "add" || l.kind === "del");
  const keep = lines.map((_, i) => {
    for (let d = -context; d <= context; d++) if (changed[i + d]) return true;
    return false;
  });

  const out: DiffLine[] = [];
  let run = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      if (run > 0) {
        out.push({ kind: "skip", count: run });
        run = 0;
      }
      out.push(lines[i]);
    } else {
      run++;
    }
  }
  if (run > 0) out.push({ kind: "skip", count: run });
  return out;
}

/**
 * A copy of `live` containing only the keys that `shape` declares, recursively.
 *
 * Without this the diff is unreadable, and measuring a real drift showed why: a
 * Deployment applied with six fields came back with `terminationMessagePath`,
 * `imagePullPolicy`, `dnsPolicy`, `schedulerName`, `strategy`,
 * `revisionHistoryLimit` and a dozen more that Kubernetes defaults in — 25 lines
 * of additions around the one line that had actually changed.
 *
 * Those defaults are not drift. The question this tab answers is "did anything
 * change what I declared", so the comparison is scoped to what was declared.
 *
 * The cost is stated rather than hidden: a field you never declared and a
 * webhook injected — a sidecar container, an added label — will not appear here.
 * The YAML tab beside it shows the object whole.
 */
export function projectOnto(shape: unknown, live: unknown): unknown {
  if (Array.isArray(shape)) {
    if (!Array.isArray(live)) return live;
    // By index: an applied list and a live list line up positionally, and this
    // keeps an element the server appended out of the comparison.
    return shape.map((item, i) => (i < live.length ? projectOnto(item, live[i]) : undefined));
  }
  if (isRecord(shape)) {
    if (!isRecord(live)) return live;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) if (key in live) out[key] = projectOnto(shape[key], live[key]);
    return out;
  }
  return live;
}

/** True when the two sides differ at all — cheaper than rendering to find out. */
export function hasChanges(lines: readonly DiffLine[]): boolean {
  return lines.some(l => l.kind === "add" || l.kind === "del");
}

// Stable, non-mutating column sort — the equivalent of Lens's `getSorted`.
// Numeric values compare numerically; everything else compares as strings with
// natural/numeric collation (so "pod-2" < "pod-10"). Equal keys keep their
// original order (stable), and the input array is never mutated.
export type SortDir = "asc" | "desc";

export function getSorted<T>(rows: readonly T[], value: (row: T) => string | number, dir: SortDir): T[] {
  const indexed = rows.map((row, index) => ({ row, index, key: value(row) }));
  indexed.sort((a, b) => {
    let cmp: number;
    if (typeof a.key === "number" && typeof b.key === "number") {
      cmp = a.key - b.key;
    } else {
      cmp = String(a.key).localeCompare(String(b.key), undefined, { numeric: true, sensitivity: "base" });
    }
    return cmp !== 0 ? (dir === "asc" ? cmp : -cmp) : a.index - b.index;
  });
  return indexed.map(e => e.row);
}

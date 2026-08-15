import { Classes, HTMLTable } from "@blueprintjs/core";
// The real table's stylesheet, on purpose: the skeleton has to inherit the same
// 30px header, 42px rows and 20px leading inset, or it would shift the page the
// moment real data replaced it — which is the reflow it exists to prevent.
import styles from "./object-table.module.css";

/**
 * The shape of the table, before the table.
 *
 * A centred spinner says "wait" and nothing else: it does not say how much is
 * coming or where it will sit, and the page jumps when the answer arrives. A
 * skeleton announces the layout before the data lands.
 *
 * Blueprint already ships the treatment, so this adds no colours of its own:
 * `Classes.SKELETON` is `rgba(211,216,222,.2)` at 2px radius, animated 1s linear
 * infinite alternate between that and `rgba(95,107,124,.2)` — a slow glow rather
 * than a sweeping shimmer, and it forces `color: transparent`, which is why each
 * bar needs a non-breaking space to give it height.
 *
 * Column headers are drawn for real rather than skeletonised. They are known
 * before the request resolves, they are the part that tells you what you are
 * waiting for, and skeletonising them would hide information already in hand.
 */

/** Deterministic per cell, so bar widths look like data instead of a grid of
 *  identical blocks — and do not reshuffle on every render the way Math.random
 *  would. */
function width(row: number, col: number): string {
  const n = (row * 7 + col * 13) % 5;
  return `${[86, 62, 74, 45, 92][n]}%`;
}

export function TableSkeleton({
  columns,
  label,
  rows = 8,
}: {
  columns: readonly { id: string; title: string }[];
  /** Plural resource name, for the status message. */
  label: string;
  rows?: number;
}) {
  return (
    <div className={styles.wrap}>
      {/* One spoken message instead of a grid of empty cells: the table is
          decorative until it holds data. */}
      <span className={Classes.TEXT_MUTED} role="status" style={{ position: "absolute", left: -9999 }}>
        {`Loading ${label}…`}
      </span>
      <HTMLTable className={styles.table} compact aria-hidden>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.id}>{column.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {columns.map((column, col) => (
                <td key={column.id}>
                  <span className={`${styles.skeletonBar} ${Classes.SKELETON}`} style={{ width: width(row, col) }}>
                    &nbsp;
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  );
}

import styles from "./listogram.module.css";

/**
 * A count and a proportional bar, for a facet row.
 *
 * Every filter value is a row of *label · count · bar* rather than a bare
 * label. The difference in use is
 * larger than it sounds: a plain list of namespaces tells you what exists, while
 * this tells you where the objects actually are — which is the question you had
 * when you opened the filter.
 *
 * Spec (docs/design/chrome-spec.md): 22px row, 14px/22px label,
 * a muted count, and a 50×12 track whose fill is blue-3 at 4px radius. The track
 * itself is transparent there — the bar is drawn on nothing rather than in a
 * groove — so it is transparent here too.
 *
 * `max` is the largest count in the set, not the total, so the widest bar always
 * reaches the full 50px and the others read against it. A non-zero count clamps
 * to 2% so that one object out of five hundred is still a visible sliver rather
 * than nothing at all — the difference between "none" and "few" is the one this
 * control most needs to show.
 */
export function Listogram({ count, max }: { count: number; max: number }) {
  const pct = max > 0 && count > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
  return (
    <span className={styles.wrap}>
      <span className={styles.count}>{count}</span>
      {/* The bar restates the count, so it is decoration to a screen reader. */}
      <span className={styles.track} aria-hidden>
        <span className={styles.bar} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

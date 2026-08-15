import { Button, Checkbox, Classes, HTMLTable, Icon, Menu, MenuItem } from "@blueprintjs/core";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MenuPopover } from "../menu-popover";
import styles from "./object-table.module.css";
import { getSorted, type SortDir } from "./sort";

// Per-view column visibility persists (like Freelens's configurable tables).
function loadHidden(
  viewId: string | undefined,
  columns: readonly { id: string; defaultHidden?: boolean }[],
): Set<string> {
  if (viewId) {
    try {
      const v = JSON.parse(localStorage.getItem(`hd-cols-${viewId}`) ?? "null");
      if (Array.isArray(v)) return new Set(v as string[]);
    } catch {
      /* fall through to defaults */
    }
  }
  return new Set(columns.filter(c => c.defaultHidden).map(c => c.id));
}

// Column widths persist globally by column id (so resizing "name" is consistent
// across kinds), matching Freelens's resizable TableHead cells.
const COLW_KEY = "hd-col-widths";
function loadColWidths(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(COLW_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Row-selection wiring for bulk actions. */
export interface Selection {
  readonly ids: ReadonlySet<string>;
  readonly allSelected: boolean;
  readonly onToggle: (id: string) => void;
  readonly onToggleAll: () => void;
}

const HEADER_TEXT = `${Classes.TEXT_SMALL} ${Classes.TEXT_MUTED}`;

/**
 * An empty cell rendered as absence rather than as a value.
 *
 * The table writes a muted italic "No value" where a property is
 * unset, and the reason it reads better is not the wording — it is that absence
 * is styled differently from data, so a column of blanks does not look like a
 * column of contents. Forty-odd renderers here already agree on an em dash for
 * the same thing and it was drawn at full strength, indistinguishable from a
 * real value.
 *
 * Applied here rather than at those forty sites: it is a presentation rule, this
 * is the presentation layer, and several of the renderers are string-returning
 * helpers that could not produce a styled node without changing their type. Not
 * italic — italic is what makes a *word* read as a note, and an em dash does not
 * slant into anything.
 */
const EMPTY = "—";
function emptyOr(rendered: ReactNode): ReactNode {
  return rendered === EMPTY ? <span className={Classes.TEXT_MUTED}>{EMPTY}</span> : rendered;
}

/** A single column of a resource view: a header title + a per-row cell renderer. */
export interface Column<T> {
  readonly id: string;
  readonly title: string;
  readonly render: (row: T) => ReactNode;
  /** Right-align numeric columns, etc. */
  readonly align?: "start" | "end";
  /** Comparable value for this column; when present, its header is sortable. */
  readonly sortValue?: (row: T) => string | number;
  /** Hidden by default (shown via the column ⋮ menu), like Freelens defaults. */
  readonly defaultHidden?: boolean;
}

/** A resource view = its columns + its rows. One table renders every resource kind. */
export interface ResourceView<T> {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
}

/**
 * ObjectTable — the single resource list. Every k8s resource collapses to this
 * table plus a per-kind column descriptor (see `registry.tsx`).
 */
export function ObjectTable<T extends { id: string }>({
  view,
  groupBy,
  onRowClick,
  rowMenu,
  selection,
  defaultSort,
  viewId,
}: {
  view: ResourceView<T>;
  /** Group rows under collapsible headers, Rancher-style. Returns the group a
   *  row belongs to; undefined disables grouping entirely. */
  groupBy?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Trailing per-row actions cell (e.g. a ⋮ menu). Its clicks don't trigger the row click. */
  rowMenu?: (row: T) => ReactNode;
  /** Leading checkbox column for bulk selection. */
  selection?: Selection;
  /** Initial sort column + direction (e.g. Events newest-first). */
  defaultSort?: { col: string; dir: SortDir };
  /** Stable id for persisting this view's column visibility + enabling the ⋮ menu. */
  viewId?: string;
}) {
  const [sort, setSort] = useState<{ col: string; dir: SortDir } | null>(defaultSort ?? null);

  // Tick every 30s so relative "Age" cells stay current (Freelens's live durations).
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  // Column visibility (⋮ menu), persisted per view; seeded from defaultHidden.
  const [hidden, setHidden] = useState<Set<string>>(() => loadHidden(viewId, view.columns));
  const toggleCol = (id: string) =>
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (viewId) {
        try {
          localStorage.setItem(`hd-cols-${viewId}`, JSON.stringify([...next]));
        } catch {
          /* non-fatal */
        }
      }
      return next;
    });
  const columns = view.columns.filter(c => !hidden.has(c.id));

  // Column resize: drag a header's trailing edge to set that column's width.
  const [colWidths, setColWidths] = useState<Record<string, number>>(loadColWidths);
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  const dragRef = useRef<{ colId: string; startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = Math.max(60, Math.round(d.startW + (e.clientX - d.startX)));
      setColWidths(prev => ({ ...prev, [d.colId]: w }));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(COLW_KEY, JSON.stringify(colWidthsRef.current));
      } catch {
        /* non-fatal */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  const startColDrag = (e: React.MouseEvent, colId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement;
    dragRef.current = { colId, startX: e.clientX, startW: th?.offsetWidth ?? 120 };
    document.body.style.userSelect = "none";
  };
  const widthStyle = (colId: string): CSSProperties | undefined => {
    const w = colWidths[colId];
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
  };

  const sortedRows = useMemo(() => {
    if (!sort) return view.rows;
    const column = view.columns.find(c => c.id === sort.col);
    return column?.sortValue ? getSorted(view.rows, column.sortValue, sort.dir) : view.rows;
  }, [view.rows, view.columns, sort]);

  const showActions = Boolean(rowMenu) || Boolean(viewId);

  // Collapsed groups by key. Rancher's grouped table keeps the sort *inside*
  // each group rather than sorting the groups' contents independently, which is
  // what falling out of `sortedRows` in order gives for free.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const groups = useMemo(() => {
    if (!groupBy) return null;
    const out: { key: string; rows: T[] }[] = [];
    const index = new Map<string, { key: string; rows: T[] }>();
    for (const row of sortedRows) {
      const key = groupBy(row) || "—";
      const existing = index.get(key);
      if (existing) existing.rows.push(row);
      else {
        const entry = { key, rows: [row] };
        index.set(key, entry);
        out.push(entry);
      }
    }
    return out;
  }, [groupBy, sortedRows]);
  // +1 for the checkbox column, +1 for the actions column, when present.
  const span = columns.length + (selection ? 1 : 0) + (showActions ? 1 : 0);
  const columnMenu = viewId ? (
    <MenuPopover
      placement="bottom-end"
      content={
        <Menu>
          {view.columns.map(c => (
            <MenuItem
              key={c.id}
              icon={hidden.has(c.id) ? "blank" : "small-tick"}
              text={c.title || c.id}
              shouldDismissPopover={false}
              onClick={() => toggleCol(c.id)}
            />
          ))}
        </Menu>
      }
    >
      <Button variant="minimal" size="small" icon="list-columns" aria-label="Columns" />
    </MenuPopover>
  ) : null;

  // Click cycles a sortable header asc → desc → unsorted.
  const onSort = (colId: string) =>
    setSort(prev =>
      prev?.col !== colId ? { col: colId, dir: "asc" } : prev.dir === "asc" ? { col: colId, dir: "desc" } : null,
    );

  return (
    <div className={styles.wrap}>
      <HTMLTable className={styles.table} interactive compact>
        <thead>
          <tr>
            {selection && (
              <th className={styles.check}>
                <Checkbox
                  checked={selection.allSelected}
                  onChange={selection.onToggleAll}
                  aria-label="Select all rows"
                />
              </th>
            )}
            {columns.map(c => {
              const active = sort?.col === c.id;
              const base = `${styles.th} ${c.align === "end" ? `${HEADER_TEXT} ${styles.end}` : HEADER_TEXT}`;
              const handle = <span className={styles.colResize} onMouseDown={e => startColDrag(e, c.id)} aria-hidden />;
              return c.sortValue ? (
                // Keyboard-operable and announced: the header was click-only,
                // with no aria-sort for a screen reader to report.
                <th
                  key={c.id}
                  style={widthStyle(c.id)}
                  className={`${base} ${styles.sortable}`}
                  tabIndex={0}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  onClick={() => onSort(c.id)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSort(c.id);
                    }
                  }}
                >
                  {c.title}
                  <Icon
                    className={styles.sortIcon}
                    icon={active ? (sort.dir === "asc" ? "chevron-up" : "chevron-down") : "double-caret-vertical"}
                    size={12}
                  />
                  {handle}
                </th>
              ) : (
                <th key={c.id} style={widthStyle(c.id)} className={base}>
                  {c.title}
                  {handle}
                </th>
              );
            })}
            {showActions && <th className={styles.menu}>{columnMenu}</th>}
          </tr>
        </thead>
        <tbody>
          {(groups ?? [{ key: "", rows: sortedRows }]).flatMap(group => [
            ...(groups
              ? [
                  <tr key={`group-${group.key}`} className={styles.groupRow}>
                    <td colSpan={span}>
                      <button
                        type="button"
                        className={styles.groupToggle}
                        aria-expanded={!collapsed.has(group.key)}
                        onClick={() =>
                          setCollapsed(prev => {
                            const next = new Set(prev);
                            if (next.has(group.key)) next.delete(group.key);
                            else next.add(group.key);
                            return next;
                          })
                        }
                      >
                        <Icon icon={collapsed.has(group.key) ? "chevron-right" : "chevron-down"} size={12} />
                        <span className={styles.groupName}>{group.key}</span>
                        <span className={styles.groupCount}>{group.rows.length}</span>
                      </button>
                    </td>
                  </tr>,
                ]
              : []),
            ...(groups && collapsed.has(group.key) ? [] : group.rows).map(row => (
              <tr
                key={row.id}
                className={onRowClick ? styles.clickable : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {selection && (
                  <td className={styles.check} onClick={e => e.stopPropagation()}>
                    <Checkbox
                      checked={selection.ids.has(row.id)}
                      onChange={() => selection.onToggle(row.id)}
                      aria-label="Select row"
                    />
                  </td>
                )}
                {columns.map(c => (
                  <td
                    key={c.id}
                    style={widthStyle(c.id)}
                    className={
                      `${colWidths[c.id] ? styles.clip : ""} ${c.align === "end" ? styles.end : ""}`.trim() || undefined
                    }
                  >
                    {emptyOr(c.render(row))}
                  </td>
                ))}
                {showActions && (
                  <td className={styles.menu} onClick={e => e.stopPropagation()}>
                    {rowMenu?.(row)}
                  </td>
                )}
              </tr>
            )),
          ])}
        </tbody>
      </HTMLTable>
    </div>
  );
}

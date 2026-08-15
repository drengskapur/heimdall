import { Collapse, Icon } from "@blueprintjs/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canList, type ResourceRule, servedHas } from "../capabilities";
import { findIcon, findLabel, NAV_TREE } from "../nav-tree";
import { RESOURCES } from "../resource/registry";
import styles from "./sidebar.module.css";

/** A nav page is available when it has no descriptor/query (a feature page like
 *  Overview / Helm / Port Forwarding), or the cluster both serves its kind and
 *  the user is allowed to list it. */
function pageAvailable(pageId: string, served: Set<string> | null, rules: ResourceRule[] | null): boolean {
  const query = RESOURCES[pageId]?.watchQuery;
  if (!query) return true;
  return servedHas(served, query.apiVersion, query.resource) && canList(rules, query.apiVersion, query.resource);
}

/** Only a page that lives inside a section can be favourited. The ungrouped
 *  block (Cluster, Nodes, Namespaces, Events) is already the first thing in the
 *  sidebar, so promoting one to Favourites would move it from the top to the
 *  top. Filtering reads rather than just hiding the control, so anything pinned
 *  before this rule existed disappears from Favourites instead of becoming an
 *  entry with no way to unpin it. */
const FAVOURITABLE = new Set(NAV_TREE.flatMap(node => node.children?.map(child => child.id) ?? []));

const EXPAND_KEY = "hd-sidebar-expanded";
const WIDTH_KEY = "hd-sidebar-width";

function loadExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(EXPAND_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** The spec's sidebar width. The rendered width is always this inline
 *  style (a drag can override it), so this is the single source of truth — the
 *  stylesheet deliberately sets no width. See docs/design/chrome-spec.md. */
const DEFAULT_WIDTH = 230;

function loadWidth(): number {
  const n = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(n) && n >= 180 && n <= 520 ? n : DEFAULT_WIDTH;
}

const FAVORITES_KEY = "hd-sidebar-favorites";
function loadFavorites(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface Props {
  selected: string;
  onSelect: (id: string) => void;
  /** Resources the cluster serves (`${group}/${resource}`); null = show all. */
  served: Set<string> | null;
  /** The user's list permissions (SelfSubjectRulesReview); null = permissive. */
  rules: ResourceRule[] | null;
}

/**
 * Sidebar — the cluster's resource navigation. Mirrors Lens's registration
 * hierarchy: single items vs expandable groups, group-active = any child active,
 * expand state persisted per node.
 */
export function Sidebar({ selected, onSelect, served, rules }: Props) {
  /**
   * Which pages this cluster and this user can actually reach, as a set.
   *
   * `pageAvailable` calls `canList`, which scans every SelfSubjectRulesReview
   * rule and, inside each, its verbs, its apiGroups and its resources. It was
   * being called once per nav node on every render — roughly sixty nodes times
   * however many rules the cluster returns — and the sidebar re-renders on every
   * navigation. React's own profiler put Sidebar at 65–106ms per click, which is
   * the whole of the delay before a clicked item looked selected.
   *
   * Computed once per capability change instead, and the render does set lookups.
   */
  const available = useMemo(() => {
    const ids = new Set<string>();
    for (const node of NAV_TREE) {
      if (pageAvailable(node.id, served, rules)) ids.add(node.id);
      for (const child of node.children ?? []) if (pageAvailable(child.id, served, rules)) ids.add(child.id);
    }
    return ids;
  }, [served, rules]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    workloads: true,
    ...loadExpanded(),
  }));

  const toggle = useCallback((id: string) => {
    setExpanded(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(EXPAND_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — non-fatal */
      }
      return next;
    });
  }, []);

  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, []);
  const isFav = (id: string) => favorites.includes(id);
  // A real button, not a clickable <Icon>: the span had no focus and no key
  // handler, so favourites were unreachable from the keyboard entirely.
  const pin = (id: string) => (
    <button
      type="button"
      className={isFav(id) ? `${styles.pin} ${styles.pinned}` : styles.pin}
      aria-label={isFav(id) ? `Remove ${findLabel(id)} from Favorites` : `Add ${findLabel(id)} to Favorites`}
      aria-pressed={isFav(id)}
      onClick={e => {
        e.stopPropagation();
        toggleFavorite(id);
      }}
    >
      <Icon icon={isFav(id) ? "star" : "star-empty"} />
    </button>
  );

  // Drag-to-resize (Freelens's ResizingAnchor on the sidebar's trailing edge).
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [width, setWidth] = useState(loadWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !rootRef.current) return;
      const left = rootRef.current.getBoundingClientRect().left;
      setWidth(Math.max(180, Math.min(520, e.clientX - left)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(WIDTH_KEY, String(widthRef.current));
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

  return (
    <div ref={rootRef} className={styles.sidebar} style={{ width }}>
      {/* No cluster row here. It named the cluster a third time — the header's
          breadcrumb says it, the workspace sidebar's badge and label say it —
          and a chevron on a name that never changes while you are inside the
          cluster is a menu disguised as a title. Its two real actions, Settings
          and Disconnect, moved to the header's Cluster menu, which is where the
          rest of the cluster-scoped commands already are. */}
      {/* Named, because the header's breadcrumb is a navigation landmark too and
          two unlabelled ones are indistinguishable to anyone listing landmarks. */}
      <nav className={styles.nav} aria-label="Cluster resources">
        {favorites.filter(id => FAVOURITABLE.has(id) && available.has(id)).length > 0 && (
          <div>
            <div className={styles.sectionStatic}>
              <span className={styles.sectionLabel}>Favorites</span>
            </div>
            {favorites
              .filter(id => FAVOURITABLE.has(id) && available.has(id))
              .map(id => (
                <div key={`fav-${id}`} className={selected === id ? `${styles.row} ${styles.rowActive}` : styles.row}>
                  <button className={styles.child} onClick={() => onSelect(id)}>
                    <Icon icon={findIcon(id)} />
                    <span className={styles.label}>{findLabel(id)}</span>
                  </button>
                  {pin(id)}
                </div>
              ))}
          </div>
        )}
        {NAV_TREE.map((node, i) => {
          // A rule between the ungrouped block and the first section: the
          // section header alone is a weak enough boundary that the two blocks
          // ran together.
          const startsSections = !!node.children && !NAV_TREE[i - 1]?.children;
          if (!node.children) {
            if (!available.has(node.id)) return null;
            const active = selected === node.id;
            return (
              <div key={node.id} className={active ? `${styles.row} ${styles.rowActive}` : styles.row}>
                {/* No pin. Cluster, Nodes, Namespaces and Events are the
                    ungrouped block at the very top of the sidebar — favouriting
                    one would move it from the top to… the top, above a heading
                    saying it is a favourite. Only pages that live inside a
                    collapsed section are worth promoting out of it. */}
                <button className={styles.item} onClick={() => onSelect(node.id)}>
                  <Icon icon={node.icon} />
                  <span className={styles.label}>{node.label}</span>
                </button>
              </div>
            );
          }

          const children = node.children.filter(c => available.has(c.id));
          if (children.length === 0) return null;
          const isOpen = !!expanded[node.id];
          const groupActive = children.some(c => c.id === selected);
          return (
            <div key={node.id}>
              {startsSections && <div className={styles.blockDivider} />}
              {/* Wrapped like every other row, so hover and active paint in one
                  place — this one just has no pin beside its button. */}
              <div className={groupActive && !isOpen ? `${styles.row} ${styles.rowActive}` : styles.row}>
                {/* A section header, not another entry: groups are labelled
                    in 12px muted caps and reserves the iconed row for things you
                    can open. The caret stays because these still collapse. */}
                <button className={styles.section} onClick={() => toggle(node.id)}>
                  <span className={styles.sectionLabel}>{node.label}</span>
                  <Icon icon={isOpen ? "chevron-up" : "chevron-down"} className={styles.caret} size={12} />
                </button>
              </div>
              <Collapse isOpen={isOpen}>
                {children.map(child => {
                  const active = selected === child.id;
                  return (
                    <div key={child.id} className={active ? `${styles.row} ${styles.rowActive}` : styles.row}>
                      <button className={styles.child} onClick={() => onSelect(child.id)}>
                        <Icon icon={child.icon} />
                        <span className={styles.label}>{child.label}</span>
                      </button>
                      {pin(child.id)}
                    </div>
                  );
                })}
              </Collapse>
            </div>
          );
        })}
      </nav>
      <div
        className={styles.resize}
        onMouseDown={() => {
          draggingRef.current = true;
          document.body.style.userSelect = "none";
        }}
        aria-hidden
      />
    </div>
  );
}

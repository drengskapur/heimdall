import { Button, Classes, Icon, Menu, MenuDivider, MenuItem, showContextMenu, Tooltip } from "@blueprintjs/core";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { memo, useEffect, useState } from "react";
import { APPS, appForPage, type HeimdallApp, toggleFavouriteApp, useFavouriteApps } from "../apps";
import { AppsDialog } from "../apps-dialog";
import { type Cluster, type Hotbar as HotbarModel, slots } from "../clusters";
import { useDisabledFeatures } from "../feature-flags";
import { MenuPopover } from "../menu-popover";
import { openPreferences } from "../navigate";
import { forgetRecentCluster, useRecentClusters } from "../recent-clusters";
import { useRoute } from "../router";
import styles from "./hotbar.module.css";
import { NotificationsButton } from "./notifications-button";

// Hotbars persist so multiple named hotbars survive reloads (Freelens's hotbars).
const HOTBARS_KEY = "hd-hotbars";
/* Collapsed by default. The expanded sidebar is 230px, and this app already
   spends 230px on the cluster's resource nav, so two expanded columns would be
   460px of chrome on a 1280 viewport. Collapsed is the rail; expanded is for
   when you are choosing a cluster rather than working in one. */
const EXPANDED_KEY = "hd-rail-expanded";
function loadHotbars(): HotbarModel[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(HOTBARS_KEY) ?? "null");
    return Array.isArray(v) && v.length ? (v as HotbarModel[]) : null;
  } catch {
    return null;
  }
}
function saveHotbars(hotbars: HotbarModel[]): void {
  try {
    localStorage.setItem(HOTBARS_KEY, JSON.stringify(hotbars));
  } catch {
    /* non-fatal */
  }
}

interface Props {
  /** The real clusters discovered from the kubeconfig. */
  clusters: readonly Cluster[];
  /** The cluster whose view is active (empty when on the Catalog). */
  active: string;
  onSelect: (clusterId: string) => void;
  /** Open an application from the registry. */
  onOpenApp: (app: HeimdallApp) => void;
  /** Open the command palette — a destination in the sidebar. */
  onOpenSearch: () => void;
  /** Scan the local kubeconfig via the companion for more clusters. */
  /** Permanently forget a cluster profile. */
  onRemove: (clusterId: string) => void;
  /** Open the cluster settings dialog for a specific cluster (the tile cog). */
  onSettings?: (clusterId: string) => void;
}

/**
 * Hotbar — the far-left favorites rail. Fixed 12 sparse slots per hotbar, holds
 * pinned clusters; supports drag-reorder, add/remove, and paging between multiple
 * named hotbars (the number = the active hotbar's 1-based ordinal). Tiles are the
 * real clusters discovered from the local kubeconfig via the companion.
 */
/**
 * Memoised: the rail shows clusters, favourites and the app list, none of which
 * change when you move between pages inside a cluster — yet React's profiler had
 * it re-rendering for 28ms on every navigation, purely because the shell above it
 * re-rendered. Its callbacks are given stable identities at the call site so this
 * actually bites.
 */
export const Hotbar = memo(function Hotbar({
  clusters,
  active,
  onSelect,
  onOpenApp,
  onOpenSearch,
  onRemove,
  onSettings,
}: Props) {
  const route = useRoute();
  const byId = (id: string | null): Cluster | undefined => (id ? clusters.find(c => c.id === id) : undefined);

  const [hotbars, setHotbars] = useState<HotbarModel[]>(
    () => loadHotbars() ?? [{ id: "default", name: "Default", items: slots(clusters.map(c => c.id)) }],
  );
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(EXPANDED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleExpanded = () =>
    setExpanded(v => {
      const next = !v;
      try {
        localStorage.setItem(EXPANDED_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  const recent = useRecentClusters();
  // Every path into a cluster records the visit, so Recent reflects where you
  // actually went rather than only what you clicked in this one list.
  // Recording lives in the shell's enterCluster, so every route into a cluster
  // counts as a visit — not only the ones that start in this sidebar.
  const select = (id: string) => onSelect(id);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Persist hotbars whenever they change.
  useEffect(() => {
    saveHotbars(hotbars);
  }, [hotbars]);
  // Keep the active page in range if hotbars shrink.
  useEffect(() => {
    setPage(p => Math.min(p, hotbars.length - 1));
  }, [hotbars.length]);

  // Re-seed the default hotbar whenever the discovered cluster set changes, while
  // preserving any tiles the user still has pinned.
  useEffect(() => {
    setHotbars(hs => {
      const known = new Set(clusters.map(c => c.id));
      const pinned = new Set(hs.flatMap(h => h.items).filter((id): id is string => !!id && known.has(id)));
      const missing = clusters.map(c => c.id).filter(id => !pinned.has(id));
      const first = hs[0] ?? { id: "default", name: "Default", items: slots([]) };
      const items = first.items.map(id => (id && known.has(id) ? id : null));
      for (const id of missing) {
        const free = items.indexOf(null);
        if (free >= 0) items[free] = id;
      }
      // Bail out when nothing moved. The updater used to return a fresh array
      // unconditionally, so every run set state — which re-rendered and, via the
      // persist effect, rewrote localStorage.
      const unchanged = items.length === first.items.length && items.every((id, i) => id === first.items[i]);
      if (unchanged) return hs;
      return [{ ...first, items }, ...hs.slice(1)];
    });
  }, [clusters]);

  const hotbar = hotbars[page] ?? hotbars[0];
  const setItems = (items: (string | null)[]) => setHotbars(hs => hs.map((h, i) => (i === page ? { ...h, items } : h)));

  const remove = (idx: number) => {
    const items = [...hotbar.items];
    items[idx] = null;
    setItems(items);
  };
  const addFirstFree = (clusterId: string) => {
    const items = [...hotbar.items];
    if (items.includes(clusterId)) return;
    const free = items.indexOf(null);
    if (free === -1) return; // hotbar full — Lens shows a "too many items" toast
    items[free] = clusterId;
    setItems(items);
  };
  // Multiple named hotbars (Freelens's HotbarSelector): add, switch, remove.
  const addHotbar = () => {
    setHotbars(hs => {
      const next = [
        ...hs,
        {
          id: `hb-${hs.length}-${hs.reduce((n, h) => n + h.items.length, 0)}-${hs.map(h => h.id).join("").length}`,
          name: `Hotbar ${hs.length + 1}`,
          items: slots([]),
        },
      ];
      return next;
    });
    setPage(hotbars.length);
  };
  const removeHotbar = (idx: number) => {
    if (hotbars.length <= 1) return;
    setHotbars(hs => hs.filter((_, i) => i !== idx));
    setPage(p => (p >= idx && p > 0 ? p - 1 : p));
  };
  const prevPage = () => setPage(p => (p - 1 + hotbars.length) % hotbars.length);
  const nextPage = () => setPage(p => (p + 1) % hotbars.length);
  const move = (from: number, to: number) => {
    if (from === to) return;
    const items = [...hotbar.items];
    [items[from], items[to]] = [items[to], items[from]]; // swap (sparse-safe)
    setItems(items);
  };
  const endDrag = (to: number) => {
    if (dragFrom != null) move(dragFrom, to);
    setDragFrom(null);
    setOverIdx(null);
  };

  const unpinned = clusters.filter(c => !hotbar.items.includes(c.id));

  const pinnedClusters = hotbar.items
    .filter((id): id is string => !!id)
    .map(id => byId(id))
    .filter((c): c is Cluster => !!c);
  // Recent lists what you actually opened, pinned or not. It briefly excluded
  // anything already in Favourites, which on a one-cluster fleet meant Recent
  // could never appear at all — and the duplication that exclusion was aimed at
  // was really the active recess painting two rows, which is fixed at its
  // source. An item legitimately appears under both groups.
  const recentClusters = recent.map(id => byId(id)).filter((c): c is Cluster => !!c);

  const [appsOpen, setAppsOpen] = useState(false);
  const disabledFeatures = useDisabledFeatures();
  // An app whose flag is off is gone, not greyed: the point of the switch is to
  // put the surface away, and a disabled row is still a row.
  const apps = APPS.filter(a => !a.flag || !disabledFeatures.has(a.flag));
  const favouriteApps = useFavouriteApps();
  // One menu, both states. A pivot would normally open a full listing page;
  // with a single app that page would be a list of one, so this stays a menu
  // until there are enough apps for the listing to earn its own route.
  // Everything you have opened, whether or not it is pinned — so unfavouriting
  // never removes a cluster's last route back to it.
  const recentMenu = (
    <Menu>
      {recentClusters.length === 0 ? (
        <li className={styles.emptyMenu}>No recent clusters</li>
      ) : (
        recentClusters.map(c => (
          <MenuItem key={c.id} icon="layout-sorted-clusters" text={c.name} onClick={() => select(c.id)} />
        ))
      )}
    </Menu>
  );

  // One lookup, shared with the header and the shell — three places deciding
  // independently which app you are in is three chances to disagree.
  const activeApp = appForPage(route.page).id;

  if (expanded) {
    const entry = (cluster: Cluster, favourite: boolean) => (
      <div key={cluster.id} className={`${styles.wsRow} ${active === cluster.id ? styles.wsRowActive : ""}`}>
        <button
          type="button"
          className={`${styles.wsEntry} ${favourite ? styles.wsEntryFav : ""}`}
          onClick={() => select(cluster.id)}
        >
          {/* The cluster's own initials, not a glyph. One icon on every row is
              a column of identical marks that says "cluster" three times and
              never says *which* cluster — the reason the collapsed rail already
              keeps its letters, and what the catalog's name column already
              shows. This is that same badge at 16px, so a cluster looks like
              itself in all three places. Connection state rides on the dot at
              its corner rather than adding a second mark beside the name. */}
          <span className={styles.wsAvatar} style={{ "--c": cluster.color } as CSSProperties} aria-hidden>
            {cluster.short}
            {cluster.connected && <span className={styles.wsAvatarOn} />}
          </span>
          <span className={styles.wsName}>{cluster.name}</span>
        </button>
        {/* Gold when pinned, matching the sidebar's favourites. Unpinning is
            the only action here; adding is done from the
            Clusters group below. */}
        {favourite && (
          <button
            type="button"
            className={styles.wsStar}
            aria-label={`Remove ${cluster.name} from Favorites`}
            onClick={() => remove(hotbar.items.indexOf(cluster.id))}
          >
            <Icon icon="star" size={16} />
          </button>
        )}
      </div>
    );

    const group = (title: string, items: Cluster[], favourite: boolean, viewAll?: () => void, action?: ReactNode) =>
      items.length === 0 && !action ? null : (
        <div key={title}>
          <div className={styles.wsGroupHeader}>
            <span className={styles.wsGroupTitle}>{title}</span>
            {/* Hover-revealed, as every group header's action is. */}
            {viewAll && (
              <button type="button" className={styles.viewAll} onClick={viewAll}>
                View all
              </button>
            )}
            {action}
          </div>
          {items.map(c => entry(c, favourite))}
        </div>
      );

    /**
     * Pin a cluster to Favourites.
     *
     * On the group header rather than in the footer, which is where it used to
     * be as part of "Add cluster". A footer entry is permanent chrome; this
     * applies to one group and appears with it, which is where a group action
     * belongs — off the header it acts on.
     *
     * It has to live in this component because the hotbar's contents are its
     * own state — the Clusters table cannot offer the action without that state
     * being lifted, which is a larger change than the control is worth.
     */
    const pinAction = unpinned.length > 0 && (
      <MenuPopover
        placement="right-start"
        content={
          <Menu>
            {unpinned.map(c => (
              <MenuItem key={c.id} icon="layout-sorted-clusters" text={c.name} onClick={() => addFirstFree(c.id)} />
            ))}
          </Menu>
        }
      >
        <button type="button" className={styles.viewAll} aria-label="Add a cluster to Favorites">
          <Icon icon="plus" size={12} />
        </button>
      </MenuPopover>
    );

    return (
      <div className={`${styles.hotbar} ${styles.expanded} ${Classes.DARK}`}>
        {/* No logo here. Expanded, it sat directly above a Catalog entry that
            does the same job — the duplication that already retired the second
            Home button and the group tab bar. Collapsed, the mark is the only
            way back to the Catalog and stays. */}
        <div className={styles.railHeader}>
          <Button variant="minimal" icon="menu-closed" aria-label="Collapse sidebar" onClick={toggleExpanded} />
        </div>
        <div className={styles.divider} />

        <div className={styles.wsScroll}>
          {/* Destinations first, then groups. Notifications belongs here
              rather than in the header, which then carries no bell at all. */}
          {/* No Clusters destination here. The APPLICATIONS group below has a
              Clusters row that goes to the same place, and one thing in a column
              twice is what the CLUSTERS group header was removed for. */}
          <button type="button" className={styles.wsEntry} onClick={onOpenSearch}>
            <Icon icon="search" size={16} />
            <span className={styles.wsName}>Search…</span>
          </button>
          <NotificationsButton variant="entry" className={styles.wsEntry} placement="right-start" />
          {/* A pivot to the whole set, in its own block between the
              destinations and the groups. The group below lists what you keep;
              this reaches everything, which is the difference that stops
              mattering only while there is one app. */}
          <div className={styles.divider} />
          <button type="button" className={styles.wsEntry} onClick={() => setAppsOpen(true)}>
            <Icon icon="layout-grid" size={16} />
            <span className={styles.wsName}>Applications</span>
          </button>
          {/* Recent is a button with a popover, not a link. An entry is an
              anchor when it navigates somewhere and a role="button" popover
              target when it does not; the difference is whether there is a page
              to go to, and a recents list is the popover itself. */}
          <MenuPopover placement="right-start" content={recentMenu}>
            <button type="button" className={styles.wsEntry}>
              <Icon icon="history" size={16} />
              <span className={styles.wsName}>Recent</span>
            </button>
          </MenuPopover>

          {/* APPLICATIONS, then the clusters. This split is what makes a second
              app cheap: applications in one group at 36px with a star, and the
              objects you opened inside them in the groups below at 32px.
              Clusters are the
              objects. Clusters-the-app is the application, and it is listed here
              rather than assumed, so the day there are two of them the sidebar
              already says which one you are in. */}
          <div className={styles.divider} />
          {favouriteApps.length > 0 && (
            <div className={styles.wsGroupHeader}>
              <span className={styles.wsGroupTitle}>Applications</span>
              {/* View all, because the group is not the full set: every entry
                in it carries a filled star. The group is what you favourited;
                everything else is one click away. */}
              <button type="button" className={styles.viewAll} onClick={() => setAppsOpen(true)}>
                View all
              </button>
            </div>
          )}
          {favouriteApps
            .map(id => apps.find(a => a.id === id))
            .filter((a): a is HeimdallApp => !!a)
            .map(app => {
              return (
                <div key={app.id} className={`${styles.wsRow} ${app.id === activeApp ? styles.wsRowActive : ""}`}>
                  <button
                    type="button"
                    className={`${styles.wsEntry} ${styles.wsEntryFav}`}
                    onClick={() => onOpenApp(app)}
                  >
                    {/* A 24px tile holding a 16px glyph, not a 16px glyph alone.
                      Application icons are 24 against the 16 object rows use,
                      which is the whole reason an application row is 36px where
                      a resource row is 32 — the tile is what says this is an app
                      and not one more thing inside
                      one. Measured: 24px box, 4px radius, the glyph 16px and
                      centred. */}
                    <span className={styles.wsAppIcon} style={{ "--c": app.color } as CSSProperties} aria-hidden>
                      <Icon icon={app.icon} size={16} />
                    </span>
                    <span className={styles.wsName}>{app.name}</span>
                  </button>
                  {/* Always filled, always visible. Everything in this group is
                    a favourite, so the star is not a toggle you go looking for
                    — it is the mark that says why the row is here, and pressing
                    it takes the row away. Full opacity on every entry. */}
                  <button
                    type="button"
                    className={styles.wsStar}
                    aria-label={`Remove ${app.name} from Favorites`}
                    aria-pressed
                    onClick={() => toggleFavouriteApp(app.id)}
                  >
                    <Icon icon="star" size={16} />
                  </button>
                </div>
              );
            })}
          {/* Favourites is the only group of clusters. Recents are reached
              through the pivot above — a Recent button with a popover, and no
              RECENT group under it. Having both was the same list twice in one
              column, and an exhaustive group under them would be a third. */}
          {group("Favorites", pinnedClusters, true, undefined, pinAction)}
        </div>

        <AppsDialog isOpen={appsOpen} onClose={() => setAppsOpen(false)} onOpen={onOpenApp} />

        {/* Preferences only. Add cluster moved to the Clusters page's title
            row, where the page's own action belongs; About lives in the
            header's Help menu. A footer of three
            utilities, two of which had homes elsewhere, was spending the
            sidebar's most permanent space on them. */}
        <div className={styles.wsFooter}>
          <button type="button" className={styles.wsEntry} onClick={openPreferences}>
            <Icon icon="cog" size={16} />
            <span className={styles.wsName}>Preferences</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    // Classes.DARK makes the iconbar a self-contained dark zone (Blueprint's own
    // dark theme → light icons on the dark rail) whatever the app theme is.
    <div className={`${styles.hotbar} ${Classes.DARK}`}>
      {/* No brand mark, and the one control this row holds is the expand toggle
          — the same slot the expanded sidebar puts its collapse toggle in, so
          the two states swap in place rather than moving the control. */}
      <div className={styles.railHeader}>
        {/* A plain row, not a Blueprint <Button>. An icon-only Button carries
            `margin: 0 -7px` on its lone icon, which pulled the glyph to x=10
            while every entry below it sat at 17 — the one control in the header
            was the only thing off the rail's grid. Styled as a .tile it is the
            same object as the rows it sits above. */}
        <Tooltip content="Expand sidebar" placement="right" compact minimal>
          <button type="button" className={styles.tile} aria-label="Expand sidebar" onClick={toggleExpanded}>
            <Icon icon="menu-open" size={16} />
          </button>
        </Tooltip>
      </div>
      <div className={styles.divider} />

      <div className={styles.cells}>
        {/* The same destinations the expanded sidebar lists, icon-only:
            collapsing keeps every entry and drops the labels. */}
        <Tooltip content="Search…" placement="right" compact minimal>
          <button type="button" className={styles.tile} aria-label="Search" onClick={onOpenSearch}>
            <Icon icon="search" size={16} />
          </button>
        </Tooltip>
        <NotificationsButton variant="entry" showLabel={false} placement="right-start" className={styles.tile} />
        <div className={styles.divider} />
        {/* The collapsed rail keeps every entry and drops the labels, so the
            Applications pivot is here too rather than only when widened. */}
        <Tooltip content="Applications" placement="right" compact minimal>
          <button type="button" className={styles.tile} aria-label="Applications" onClick={() => setAppsOpen(true)}>
            <Icon icon="layout-grid" size={16} />
          </button>
        </Tooltip>
        <MenuPopover placement="right-start" content={recentMenu}>
          <button type="button" className={styles.tile} aria-label="Recent">
            <Icon icon="history" size={16} />
          </button>
        </MenuPopover>
        <div className={styles.divider} />
        {/* The APPLICATIONS group, collapsed. Its header is gone — every group
            header drops at this width and the 21px divider carries the break —
            but the row itself stays, and stays 36px with its 24px tile. App
            rows are the only ones
            still at 36, and their tiles are still 24px at x=13 inside the same
            16px slot every other row's glyph occupies. */}
        {apps.map(app => (
          <Tooltip key={app.id} content={app.name} placement="right" compact minimal>
            <button
              type="button"
              className={`${styles.tile} ${styles.tileApp} ${app.id === activeApp ? styles.tileActive : ""}`}
              aria-label={app.name}
              onClick={() => onOpenApp(app)}
            >
              <span className={styles.wsAppIcon} style={{ "--c": app.color } as CSSProperties} aria-hidden>
                <Icon icon={app.icon} size={16} />
              </span>
            </button>
          </Tooltip>
        ))}
        {/* Only when the group below it has something in it. A divider is a
            separator, and with nothing pinned this one closed the rail on a
            rule with no group after it. */}
        {(hotbar.items.some(id => byId(id)) || dragFrom != null) && <div className={styles.divider} />}
        {hotbar.items.map((id, idx) => {
          const cluster = byId(id);
          if (!cluster) {
            // Empty slots are drop targets only while dragging — no permanent grid
            // of placeholder boxes cluttering the rail (Freelens shows none at rest).
            if (dragFrom == null) return null;
            return (
              <div
                key={idx}
                className={overIdx === idx ? `${styles.slot} ${styles.slotOver}` : styles.slot}
                onDragOver={e => {
                  e.preventDefault();
                  setOverIdx(idx);
                }}
                onDragLeave={() => setOverIdx(o => (o === idx ? null : o))}
                onDrop={() => endDrag(idx)}
                aria-hidden
              />
            );
          }
          const isActive = active === cluster.id;
          // Opened imperatively rather than with <ContextMenu>, which reads the
          // dark theme off the DOM and passes it *after* its popoverProps spread
          // — so a caller cannot ask for the light menu the rest of the app now
          // uses. showContextMenu defaults isDarkTheme to false, and is already
          // how the resource table opens its row menus.
          const openTileMenu = (e: ReactMouseEvent) => {
            e.preventDefault();
            showContextMenu({
              targetOffset: { left: e.clientX, top: e.clientY },
              content: (
                <Menu>
                  {onSettings && <MenuItem icon="cog" text="Settings" onClick={() => onSettings(cluster.id)} />}
                  <MenuItem icon="unpin" text="Remove from Hotbar" onClick={() => remove(idx)} />
                  <MenuDivider />
                  <MenuItem
                    icon="trash"
                    intent="danger"
                    text="Delete cluster"
                    onClick={() => {
                      forgetRecentCluster(cluster.id);
                      onRemove(cluster.id);
                    }}
                  />
                </Menu>
              ),
            });
          };
          return (
            <Tooltip key={idx} content={cluster.name} placement="right" compact minimal>
              <div className={styles.tileWrap} onContextMenu={openTileMenu}>
                <button
                  className={isActive ? `${styles.tile} ${styles.tileActive}` : styles.tile}
                  style={{ "--tile-color": cluster.color } as CSSProperties}
                  aria-label={cluster.name}
                  draggable
                  onDragStart={() => setDragFrom(idx)}
                  // `dragend` fires on the source however the drag finishes,
                  // including the ways `drop` never does — released outside any
                  // target, or cancelled with Escape. Without it `dragFrom`
                  // stayed set and the empty-slot placeholders it gates stayed
                  // on screen for good.
                  onDragEnd={() => {
                    setDragFrom(null);
                    setOverIdx(null);
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    setOverIdx(idx);
                  }}
                  onDrop={() => endDrag(idx)}
                  onClick={() => onSelect(cluster.id)}
                >
                  {/* The same badge the expanded sidebar and the catalog
                        show, not bare initials with a separate dot beside them.
                        The icon is identical in both states — collapsing drops
                        labels, not identity. */}
                  <span className={styles.wsAvatar} style={{ "--c": cluster.color } as CSSProperties} aria-hidden>
                    {cluster.short}
                    {cluster.connected && <span className={styles.wsAvatarOn} />}
                  </span>
                </button>
                {onSettings && (
                  <button
                    className={styles.badge}
                    aria-label={`${cluster.name} settings`}
                    title="Settings"
                    onClick={e => {
                      e.stopPropagation();
                      onSettings(cluster.id);
                    }}
                  >
                    <Icon icon="cog" size={9} />
                  </button>
                )}
              </div>
            </Tooltip>
          );
        })}
      </div>

      <AppsDialog isOpen={appsOpen} onClose={() => setAppsOpen(false)} onOpen={onOpenApp} />

      <div className={styles.railFooter}>
        <Tooltip content="Preferences" placement="right" compact minimal>
          <button type="button" className={styles.tile} aria-label="Preferences" onClick={openPreferences}>
            <Icon icon="cog" size={16} />
          </button>
        </Tooltip>

        {/* HotbarSelector — a compact index that opens a menu to switch / add /
            remove hotbars. Hidden entirely with a single hotbar, which is the
            normal case: a lone "1" beneath the utilities is an ordinal for a set
            of one, and it was the only thing in the rail not on the 49x32 row.
            The same reasoning already kept the prev/next arrows away. Adding a
            second hotbar is available from this control once it appears, and
            switcher. Creating one moves into the Add cluster menu below, so the
            feature stays reachable instead of being sealed behind a control
            that only exists once you already have two. */}
        {hotbars.length > 1 && (
          <div className={styles.pager}>
            {hotbars.length > 1 && (
              <Button
                variant="minimal"
                size="small"
                icon="chevron-left"
                aria-label="Previous hotbar"
                onClick={prevPage}
              />
            )}
            <MenuPopover
              placement="right"
              content={
                <Menu>
                  {hotbars.map((h, i) => (
                    <MenuItem
                      key={h.id}
                      icon={i === page ? "tick" : "blank"}
                      text={h.name}
                      onClick={() => setPage(i)}
                    />
                  ))}
                  <MenuDivider />
                  <MenuItem icon="plus" text="Add hotbar" onClick={addHotbar} />
                  {hotbars.length > 1 && (
                    <MenuItem
                      icon="trash"
                      intent="danger"
                      text={`Remove “${hotbar.name}”`}
                      onClick={() => removeHotbar(page)}
                    />
                  )}
                </Menu>
              }
            >
              <Tooltip content={`${hotbar.name} — switch / add hotbars`} placement="right" compact minimal>
                <button className={styles.page} aria-label={`Hotbar ${page + 1} of ${hotbars.length}`}>
                  {page + 1}
                </button>
              </Tooltip>
            </MenuPopover>
            {hotbars.length > 1 && (
              <Button variant="minimal" size="small" icon="chevron-right" aria-label="Next hotbar" onClick={nextPage} />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

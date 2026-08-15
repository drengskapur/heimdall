import {
  Alignment,
  Button,
  Icon,
  KeyComboTag,
  Menu,
  MenuDivider,
  MenuItem,
  Navbar,
  NavbarGroup,
} from "@blueprintjs/core";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { appForPage } from "../apps";
import { MenuPopover } from "../menu-popover";
import { findLabel, groupOf } from "../nav-tree";
import { isStandalone, navigate, useRoute } from "../router";
import styles from "./header.module.css";

const REPO = "https://github.com/drengskapur/heimdall";

interface HeaderProps {
  onOpenSearch: () => void;
  onHome: () => void;
  onBack: () => void;
  onForward: () => void;
  /** Cluster-scoped, so absent outside one — the bar only renders inside a
   *  cluster, but the menu items still guard rather than assume. */
  onSettings?: () => void;
  onDisconnect?: () => void;
  /** Receives the element pages portal their own actions into. */
  actionSlotRef?: (node: HTMLDivElement | null) => void;
}

/** Toggle browser fullscreen — the web-platform equivalent of "maximize". */
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}

/**
 * Header — persistent chrome, and deliberately stable: navigation controls on
 * the left, utilities on the right (notifications · app menu), nothing that
 * changes as you move around. No wordmark — the rail's logo square carries the
 * identity — and no Home button, since that square is Home.
 *
 * The bar is double-click-to-maximize (Freelens's `toggleMaximizeWindow`). A
 * browser tab can't min/max/close itself, so when Heimdall is *installed* as a
 * PWA the OS draws real window controls via window-controls-overlay; fullscreen
 * otherwise lives in the app menu.
 */
export function Header({
  onOpenSearch,
  onHome,
  onBack,
  onForward,
  onSettings,
  onDisconnect,
  actionSlotRef,
}: HeaderProps) {
  // Display mode doesn't change within a session, so this is read once.
  const [standalone] = useState(isStandalone);
  const route = useRoute();
  // The tile names the app you are *in*, so it changes with the route rather
  // than always announcing Clusters.
  const app = appForPage(route.page);
  // cluster › section › page. The section is present only for pages that live
  // inside one, so ungrouped pages read `cluster › Nodes` rather than inventing
  // a level.
  const group = route.cluster ? groupOf(route.page) : undefined;
  // Hand-rolled rather than Blueprint's <Breadcrumbs>, which renders a spacer
  // <div> as a direct child of its <ol> — invalid list markup that axe flags
  // SERIOUS, and the same stray element that made `li:last-child` never match
  // the current crumb. Three items need no overflow machinery anyway.
  // The trail starts at the app's own landing page, so a cluster reads as what
  // it is — one of the things that list contains. Without it the first crumb was
  // the cluster itself, which said where you were and offered no way up.
  const path = route.cluster
    ? [
        { key: "clusters", text: "Clusters", go: onHome },
        { key: "cluster", text: route.cluster, go: () => navigate({ cluster: route.cluster, page: "cluster" }) },
        ...(group ? [{ key: group.id, text: group.label }] : []),
      ]
    : [];
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return (
    <Navbar className={styles.topBar} onDoubleClick={toggleFullscreen}>
      <NavbarGroup align={Alignment.START} className={styles.items}>
        {/* The application's tile, anchoring the left edge. 50x50, flush where
            the sidebar ends, and square rather than rounded — at header scale
            it is a block of the app's
            colour, not a chip. Same 10% wash as the sidebar's 24px tile, so the
            app is the same object in both places at two sizes. */}
        <span className={styles.appTile} style={{ "--c": app.color } as CSSProperties} aria-hidden>
          <Icon icon={app.icon} size={24} />
        </span>
        {/* A breadcrumb, not a title. The earlier decision here was to show
            nothing, on the grounds that a label changing every navigation reads
            as unstable and the sidebar's active row already says where you are.
            That argument holds for a bare page title and it is revisited rather
            than ignored: what a breadcrumb adds is the *cluster*, in the content
            area, next to the thing you are about to act on. Until now the
            cluster's name appeared only in the left chrome, and acting on the
            wrong cluster is the expensive mistake this app can make.

            Blueprint's Breadcrumbs is built on OverflowList, so the trail
            collapses from the left instead of pushing the utilities off the
            right. The page title still lives in document.title for the tab and
            the task switcher. */}
        {/* Two rows inside the one 50px chrome row: the breadcrumb at 24 and
            the menu at 44 both fit the same 50px header the sidebar aligns to.
            Stacking them keeps that alignment instead of growing the chrome. */}
        <span className={styles.headerStack}>
          {/* Only inside a cluster. On the Catalog the trail had exactly one
              item — the word "Catalog" — which is a module header by another
              name: a label restating the page directly above a table that is
              the page. What the trail is for is saying *which cluster* you are
              about to act on, and outside one there is no such thing to say. */}
          {route.cluster && (
            <nav className={styles.crumbs} aria-label="Breadcrumb">
              <ol>
                {/* The navigable crumbs carry no glyph. The 50px application
                    tile immediately to the left carries this exact mark, so a
                    12px copy of it 60px away was the same symbol twice in one
                    row. A crumb icon would have to mean something different
                    from the app tile to earn its place, and there is no such
                    thing here: a cluster's parent is the catalog, not a
                    folder. */}
                {path.map(crumb => (
                  <li key={crumb.key}>
                    {crumb.go ? (
                      <button type="button" className={styles.crumbLink} onClick={crumb.go}>
                        {crumb.text}
                      </button>
                    ) : (
                      <span className={styles.crumbPath}>{crumb.text}</span>
                    )}
                  </li>
                ))}
                {/* The last item is a different kind of thing: the trail is a
                    muted, navigable *path* and the final element is the subject
                    itself — a separate, full-strength element rather than one
                    more crumb. */}
                <li>
                  <span className={styles.crumbCurrent} aria-current="page">
                    {findLabel(route.page)}
                  </span>
                </li>
              </ol>
            </nav>
          )}
          {/* Named menus rather than one hamburger: a labelled menu says what
            is inside it before you open it. Grouped by the question being asked
            rather than by where the code lives. */}
          <span className={styles.menuBar}>
            {/* `minimal` drops the popover's arrow. A bar menu does not need
              one: an arrow points at the control that opened the menu, which a
              labelled button in a menu bar already makes obvious. Other
              popovers keep theirs, so this
              is set per call rather than in MenuPopover.

              The animation is Blueprint's *minimal* at 100ms — a plain opacity
              fade on cubic-bezier(0.4, 1, 0.75, 0.9). The default is a 300ms
              scale, which made these grow out of the button rather than simply
              appear. */}
            <MenuPopover
              arrow={false}
              animation="minimal"
              transitionDuration={100}
              placement="bottom-end"
              content={
                <Menu>
                  {/* KeyCombo, not a hardcoded string. It renders the platform's own modifier —
                    ⌘ on a Mac, Ctrl elsewhere — where "⌘/Ctrl-K" showed both to
                    everyone and was right for nobody. */}
                  <MenuItem
                    icon="search"
                    text="Command palette…"
                    labelElement={<KeyComboTag combo="mod+k" minimal />}
                    onClick={onOpenSearch}
                  />
                  <MenuItem icon="home" text="Clusters" onClick={onHome} />
                  {/* Inherited from the resource sidebar's cluster row, which used
                    to be the only way to reach them. */}
                  {onSettings && <MenuItem icon="cog" text="Settings" onClick={onSettings} />}
                  {onDisconnect && <MenuDivider />}
                  {onDisconnect && <MenuItem icon="log-out" text="Disconnect" intent="danger" onClick={onDisconnect} />}
                </Menu>
              }
            >
              <Button variant="minimal" size="small" text="Cluster" endIcon="caret-down" />
            </MenuPopover>
            <MenuPopover
              arrow={false}
              animation="minimal"
              transitionDuration={100}
              placement="bottom-end"
              content={
                <Menu>
                  {/* KeyComboTag, not a hardcoded string: it renders the platform's
                    own modifier — ⌘ on a Mac, Ctrl elsewhere — where "⌘/Ctrl-K"
                    showed both to everyone and was right for nobody. */}
                  <MenuItem
                    icon="search"
                    text="Command palette…"
                    labelElement={<KeyComboTag combo="mod+k" minimal />}
                    onClick={onOpenSearch}
                  />
                  <MenuDivider />
                  {/* Stateful, and the same glyph pair the dock uses for the same
                    concept — the header previously showed a third icon that
                    never changed when active. */}
                  <MenuItem
                    icon={isFullscreen ? "minimize" : "maximize"}
                    text={isFullscreen ? "Exit full screen" : "Enter full screen"}
                    onClick={toggleFullscreen}
                  />
                  <MenuItem icon="refresh" text="Reload" onClick={() => window.location.reload()} />
                </Menu>
              }
            >
              <Button variant="minimal" size="small" text="View" endIcon="caret-down" />
            </MenuPopover>
            <MenuPopover
              arrow={false}
              animation="minimal"
              transitionDuration={100}
              placement="bottom-end"
              content={
                <Menu>
                  <MenuItem
                    icon="document"
                    text="Documentation"
                    onClick={() => window.open(`${REPO}/wiki`, "_blank", "noreferrer")}
                  />
                  <MenuItem
                    icon="info-sign"
                    text="About Heimdall"
                    onClick={() => window.open(REPO, "_blank", "noreferrer")}
                  />
                </Menu>
              }
            >
              <Button variant="minimal" size="small" text="Help" endIcon="caret-down" />
            </MenuPopover>
          </span>
        </span>
        {/* Only when installed. In a browser tab the toolbar's own Back and
            Forward drive the same history, so a second pair is duplicate
            chrome; a standalone window has no toolbar and needs these. The
            History API can't report whether a step exists, so they don't
            disable — the browser's own buttons behave the same way. */}
        {standalone && (
          <>
            <Button variant="minimal" icon="arrow-left" aria-label="Back" title="Back" onClick={onBack} />
            <Button variant="minimal" icon="arrow-right" aria-label="Forward" title="Forward" onClick={onForward} />
          </>
        )}
        {/* Immediately right of the block, not at the far edge: the rule hangs
            off the *left* border of whatever sits beside the header's left
            column, so it closes that column rather than framing the utilities.
            Full height, 1px, rgba(17,20,24,.15) — the same hairline
            as its menu dividers and panel rings. */}
        <span className={styles.headerDivider} aria-hidden />
      </NavbarGroup>
      {/* The bell moved to the sidebar; the header carries none. What is left
          here is the menu bar. */}
      {/* The page's own controls land here — filters, search, New. Keeping a
          page's actions in the header buys the content area back: a table now
          starts at the top of its pane instead of 42px down behind a bar of its
          own. */}
      <NavbarGroup align={Alignment.END} className={styles.items}>
        <div ref={actionSlotRef} className={styles.actions} />
      </NavbarGroup>
    </Navbar>
  );
}

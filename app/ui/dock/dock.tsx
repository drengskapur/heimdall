import { Button, Icon, Menu, MenuItem } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MenuPopover } from "../menu-popover";
import { ClusterTerminalView } from "./cluster-terminal-view";
import { CreateResourceView } from "./create-resource-view";
import styles from "./dock.module.css";
import {
  closeDockItem,
  type DockKind,
  dockState,
  newCreateResource,
  newTerminal,
  renameDock,
  setDockActive,
  setDockHeight,
  subscribe,
  toggleDock,
  toggleFullscreen,
} from "./dock-store";

const KIND_ICON: Record<DockKind, IconName> = {
  logs: "align-left",
  shell: "console",
  forward: "exchange",
  edit: "edit",
  terminal: "desktop",
  create: "plus",
};

/**
 * Dock — the always-present resizable bottom panel, matching the Freelens dock:
 * a persistent tab bar (default pinned Terminal), a create menu (Terminal /
 * Create resource), fullscreen + collapse, and keyboard shortcuts (Shift+Esc
 * close, Ctrl/Cmd+W close tab, Ctrl+./, switch tab). The panel body only mounts
 * when expanded.
 */
export function Dock() {
  const state = useSyncExternalStore(subscribe, dockState, dockState);
  const draggingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Inline tab rename (double-click), Freelens-style.
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const commitRename = () => {
    if (editing) renameDock(editing.id, editing.value);
    setEditing(null);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current) setDockHeight(window.innerHeight - e.clientY);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Keyboard shortcuts, active only while focus is inside the dock (as in Freelens).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rootRef.current?.contains(document.activeElement)) return;
      const s = dockState();
      if (e.shiftKey && e.code === "Escape") {
        toggleDock();
      } else if (e.ctrlKey && (e.code === "Period" || e.code === "Comma")) {
        const i = s.items.findIndex(t => t.id === s.activeId);
        const next = i + (e.code === "Period" ? 1 : -1);
        if (next >= 0 && next < s.items.length) setDockActive(s.items[next].id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const active = state.items.find(i => i.id === state.activeId) ?? state.items[0];
  const bodyHeight = state.fullscreen ? "calc(100vh - 160px)" : state.height;

  return (
    <div ref={rootRef} className={styles.dock} style={{ height: state.open ? bodyHeight : undefined }} tabIndex={-1}>
      <div
        className={styles.resize}
        onMouseDown={() => {
          draggingRef.current = true;
          document.body.style.userSelect = "none";
        }}
        aria-hidden
      />
      <div className={styles.tabs}>
        {state.items.map(item => (
          <div
            key={item.id}
            className={item.id === active?.id && state.open ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setDockActive(item.id)}
          >
            <Icon icon={KIND_ICON[item.kind]} size={12} />
            {editing?.id === item.id ? (
              <input
                className={styles.tabRename}
                autoFocus
                value={editing.value}
                onClick={e => e.stopPropagation()}
                onChange={e => setEditing({ id: item.id, value: e.target.value })}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === "Enter") commitRename();
                  else if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <span
                className={styles.tabTitle}
                onDoubleClick={e => {
                  e.stopPropagation();
                  setEditing({ id: item.id, value: item.customTitle ?? item.title });
                }}
              >
                {item.customTitle ?? item.title}
              </span>
            )}
            {!item.pinned && (
              <Button
                variant="minimal"
                size="small"
                icon="small-cross"
                aria-label="Close tab"
                onClick={e => {
                  e.stopPropagation();
                  closeDockItem(item.id);
                }}
              />
            )}
          </div>
        ))}
        <MenuPopover
          placement="top-start"
          content={
            <Menu>
              <MenuItem icon="console" text="Terminal" onClick={() => newTerminal(() => <ClusterTerminalView />)} />
              <MenuItem
                icon="plus"
                text="Create resource"
                onClick={() => newCreateResource(() => <CreateResourceView />)}
              />
            </Menu>
          }
        >
          <Button variant="minimal" size="small" icon="plus" aria-label="New tab" title="New tab" />
        </MenuPopover>
        <span className={styles.spacer} />
        <Button
          variant="minimal"
          size="small"
          icon={state.fullscreen ? "minimize" : "maximize"}
          aria-label={state.fullscreen ? "Restore dock" : "Fullscreen dock"}
          title={state.fullscreen ? "Restore" : "Fullscreen"}
          onClick={toggleFullscreen}
        />
        <Button
          variant="minimal"
          size="small"
          icon={state.open ? "chevron-down" : "chevron-up"}
          aria-label="Toggle dock"
          onClick={toggleDock}
        />
      </div>
      {/* Every open item stays mounted; only the active one is shown. Rendering
          just the active item with key={id} remounted on each tab switch, which
          disposed the terminal and closed its exec/shell session, and threw away
          a Logs buffer — switching away from a tab destroyed its contents. */}
      {state.open &&
        state.items.map(item => (
          <div key={item.id} className={styles.body} hidden={item.id !== active?.id}>
            {item.render()}
          </div>
        ))}
    </div>
  );
}

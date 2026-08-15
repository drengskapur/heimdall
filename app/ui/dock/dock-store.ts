// The Dock: a resizable bottom panel that hosts logs / shell / port-forward /
// edit as concurrent tabs across many pods at once — Lens's dock, the UX layer
// over the same views the pod drawer uses. A tiny module store holds the open
// items so any surface (a pod row menu, the drawer) can open one.
import type { ReactNode } from "react";

export type DockKind = "logs" | "shell" | "forward" | "edit" | "terminal" | "create";

export interface DockItem {
  readonly id: string; // stable per (kind, pod) so re-opening focuses the existing tab
  readonly kind: DockKind;
  readonly title: string;
  readonly render: () => ReactNode;
  /** Pinned tabs (the default Terminal) can't be closed — as in Freelens. */
  readonly pinned?: boolean;
  /** User-renamed title (double-click a tab), overrides `title` when set. */
  readonly customTitle?: string;
}

interface DockState {
  readonly items: readonly DockItem[];
  readonly activeId: string | null;
  readonly open: boolean;
  readonly fullscreen: boolean;
  readonly height: number;
}

let items: DockItem[] = [];
let activeId: string | null = null;
let open = false;
let fullscreen = false;
let height = 300;

// useSyncExternalStore requires a stable snapshot between changes.
let snapshot: DockState = { items, activeId, open, fullscreen, height };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { items, activeId, open, fullscreen, height };
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dockState(): DockState {
  return snapshot;
}

/** Rename a dock tab (Freelens double-click-to-rename). Empty clears the override. */
export function renameDock(id: string, title: string): void {
  const trimmed = title.trim();
  items = items.map(i => (i.id === id ? { ...i, customTitle: trimmed || undefined } : i));
  emit();
}

/** Open (or focus) a dock item and reveal the panel. */
export function openDock(item: DockItem): void {
  if (!items.some(i => i.id === item.id)) items = [...items, item];
  activeId = item.id;
  open = true;
  emit();
}

let terminalSeq = 0;

/** Open a new cluster Terminal tab and reveal the panel. */
export function newTerminal(render: () => ReactNode): void {
  const n = ++terminalSeq;
  const id = `terminal:${n}`;
  items = [...items, { id, kind: "terminal", title: n > 1 ? `Terminal ${n}` : "Terminal", render }];
  activeId = id;
  open = true;
  emit();
}

let createSeq = 0;

/** Open a "Create resource" tab (YAML editor) and reveal the panel. */
export function newCreateResource(render: () => ReactNode): void {
  const n = ++createSeq;
  const id = `create:${n}`;
  items = [...items, { id, kind: "create", title: n > 1 ? `Create resource ${n}` : "Create resource", render }];
  activeId = id;
  open = true;
  emit();
}

/** Ensure a default Terminal tab exists (shown in the always-visible bar) without
 *  forcing the panel open — the terminal only connects once the dock is expanded.
 *  The default Terminal is pinned (uncloseable), as in Freelens. */
export function ensureTerminal(render: () => ReactNode): void {
  if (items.some(i => i.kind === "terminal")) return;
  const id = `terminal:${++terminalSeq}`;
  items = [{ id, kind: "terminal", title: "Terminal", render, pinned: true }, ...items];
  activeId ??= id;
  emit();
}

export function setDockActive(id: string): void {
  activeId = id;
  open = true;
  emit();
}

export function closeDockItem(id: string): void {
  if (items.find(i => i.id === id)?.pinned) return; // pinned tabs can't be closed
  items = items.filter(i => i.id !== id);
  if (activeId === id) activeId = items.at(-1)?.id ?? null;
  if (items.length === 0) {
    open = false;
    fullscreen = false;
  }
  emit();
}

/** Collapse/expand the panel without discarding its tabs. */
export function toggleDock(): void {
  open = items.length > 0 ? !open : false;
  if (!open) fullscreen = false;
  emit();
}

/** Maximize the panel to (near) full height, or restore. */
export function toggleFullscreen(): void {
  fullscreen = !fullscreen;
  if (fullscreen) open = true;
  emit();
}

export function setDockHeight(next: number): void {
  height = Math.max(140, Math.min(720, Math.round(next)));
  emit();
}

/** Drop everything — called on cluster switch (dock items belong to a cluster). */
export function clearDock(): void {
  items = [];
  activeId = null;
  open = false;
  fullscreen = false;
  terminalSeq = 0;
  emit();
}

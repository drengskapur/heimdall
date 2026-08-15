import { OverlayToaster, type Toaster, type ToastProps } from "@blueprintjs/core";

// Lazily-created singleton toaster (Blueprint v6: OverlayToaster.create → Promise<Toaster>).
let toasterPromise: Promise<Toaster> | undefined;
function toaster(): Promise<Toaster> {
  toasterPromise ??= OverlayToaster.create({ position: "top" });
  return toasterPromise;
}

// Dedupe identical toasts: pollers (metrics, discovery) can fail every tick with
// the same message, and sticky error toasts (timeout 0) would otherwise stack
// endlessly. Suppress a repeat of the same message within this window. Keying by
// message also collapses a re-shown toast onto its existing key so it refreshes
// in place rather than piling up.
const DEDUPE_MS = 8000;
const lastShown = new Map<string, number>();

function show(props: ToastProps): void {
  const key = typeof props.message === "string" ? props.message : "";
  if (key) {
    const now = Date.now();
    const prev = lastShown.get(key);
    if (prev !== undefined && now - prev < DEDUPE_MS) return;
    // Drop entries that can no longer suppress anything. Keyed by message text,
    // this map otherwise grew for the life of the tab — every distinct error a
    // poller ever produced, kept forever to answer a question with an 8-second
    // horizon.
    for (const [seen, at] of lastShown) if (now - at >= DEDUPE_MS) lastShown.delete(seen);
    lastShown.set(key, now);
    // Reuse the key as the toast id so an identical toast replaces its
    // predecessor in place instead of stacking.
    void toaster().then(t => t.show(props, key));
    return;
  }
  void toaster().then(t => t.show(props));
}

// --- Notification history (backs the header bell) --------------------------
export type NotificationIntent = "success" | "primary" | "danger";
export interface NotificationRecord {
  readonly id: number;
  readonly message: string;
  readonly intent: NotificationIntent;
}

let history: NotificationRecord[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function record(message: string, intent: NotificationIntent): void {
  // Collapse consecutive identical entries so a failing poller doesn't flood
  // the bell with the same line.
  if (history[0]?.message === message && history[0]?.intent === intent) return;
  history = [{ id: ++seq, message, intent }, ...history].slice(0, 50);
  for (const l of listeners) l();
}

export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notificationHistory(): readonly NotificationRecord[] {
  return history;
}
export function clearNotifications(): void {
  history = [];
  for (const l of listeners) l();
}

/** Typed toast helpers — feedback for actions. Errors are sticky (timeout 0). */
export const notify = {
  success: (message: string) => {
    record(message, "success");
    show({ message, intent: "success", icon: "tick-circle" });
  },
  info: (message: string) => {
    record(message, "primary");
    show({ message, intent: "primary", icon: "info-sign" });
  },
  error: (message: string) => {
    record(message, "danger");
    show({ message, intent: "danger", icon: "error", timeout: 0 });
  },
};

// A tiny cross-component navigation signal. The Shell owns the selected page as
// React state; deep views (e.g. the Workloads Overview status cards) request a
// page change by dispatching this event, which the Shell listens for. Keeps the
// nav wiring decoupled without threading a callback through every view.
const EVENT = "heimdall:navigate";

/** Request the Shell switch to a nav-tree page id (e.g. "deployments"). */
export function navigateTo(pageId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pageId }));
}

/** Subscribe to navigation requests; returns an unsubscribe. */
export function onNavigate(handler: (pageId: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

const OBJECT_EVENT = "heimdall:navigate-object";

/** A cross-object navigation target (e.g. a Pod's "Controlled By" → its ReplicaSet). */
export interface ObjectTarget {
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string;
}

/** Request the Shell open a specific object's details (switches page + selects it). */
export function navigateToObject(target: ObjectTarget): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OBJECT_EVENT, { detail: target }));
}

/** Subscribe to object-navigation requests; returns an unsubscribe. */
export function onNavigateObject(handler: (target: ObjectTarget) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ObjectTarget>).detail);
  window.addEventListener(OBJECT_EVENT, listener);
  return () => window.removeEventListener(OBJECT_EVENT, listener);
}

const PREFS_EVENT = "heimdall:open-preferences";

/** Request the Preferences dialog be opened (e.g. from the empty Catalog). */
export function openPreferences(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PREFS_EVENT));
}

/** Subscribe to Preferences-open requests; returns an unsubscribe. */
export function onOpenPreferences(handler: () => void): () => void {
  window.addEventListener(PREFS_EVENT, handler);
  return () => window.removeEventListener(PREFS_EVENT, handler);
}

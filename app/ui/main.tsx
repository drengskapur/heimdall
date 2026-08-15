import { FocusStyleManager, OverlaysProvider } from "@blueprintjs/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/select/lib/css/blueprint-select.css";
import "@blueprintjs/table/lib/css/table.css";
import "./theme.css";

import { Shell } from "./shell/shell";
import { applyTheme, getInitialTheme } from "./use-theme";

// One-time rebrand migration: copy any legacy `freelens.*` storage keys to
// their `heimdall.*` equivalents so an existing session keeps its cluster
// profiles / preferences after the rename.
function migrateBrandedStorage(): void {
  for (const store of [localStorage, sessionStorage]) {
    try {
      for (const key of Object.keys(store)) {
        if (!key.startsWith("freelens.")) continue;
        const target = `heimdall.${key.slice("freelens.".length)}`;
        const value = store.getItem(key);
        if (value != null && store.getItem(target) == null) store.setItem(target, value);
      }
    } catch {
      /* storage unavailable — non-fatal */
    }
  }
}
migrateBrandedStorage();

FocusStyleManager.onlyShowFocusOnTabs();
// Apply the startup theme before first paint so there's no flash of the wrong theme.
applyTheme(getInitialTheme());

/**
 * Register the offline service worker.
 *
 * This is what makes the app installable and offline-first: the manifest
 * declares installability, but without an active worker there is no runtime
 * cache and no offline fallback. Deferred to `load` so it never competes with
 * first paint, and a no-op where service workers are unavailable.
 *
 * It lives in the entry rather than in a component. It was a `<PwaRegister />`
 * mounted by the *other* entry, which is why deleting that entry silently took
 * the offline capability with it — a side effect with no UI has no business
 * being a component whose mounting something else has to remember.
 */
function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Non-fatal: the app still works online. */
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OverlaysProvider>
      <Shell />
    </OverlaysProvider>
  </StrictMode>,
);

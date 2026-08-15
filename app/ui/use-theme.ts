import { Classes } from "@blueprintjs/core";
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export type ThemeChoice = "light" | "dark" | "system";

const KEY = "hd-theme";
const listeners = new Set<() => void>();

function osTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** The user's saved choice. Defaults to "dark", not "system" — anything driving
 *  the theme from outside (tests, tooling) has to set this rather than rely on
 *  `prefers-color-scheme`, which a stored choice ignores. */
export function getThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* storage unavailable */
  }
  return "dark"; // the chrome is designed dark-first; light stays fully supported
}

/** Resolve a choice to a concrete theme. */
export function resolveTheme(choice: ThemeChoice = getThemeChoice()): Theme {
  return choice === "system" ? osTheme() : choice;
}

/** Startup theme (back-compat name used by main.tsx before first paint). */
export function getInitialTheme(): Theme {
  return resolveTheme();
}

/** Apply a theme to the document (Blueprint dark class + native color-scheme).
 *  The class goes on BOTH <html> and <body>: <html> matches the pre-paint inline
 *  script in index.html (no background FOUC), while <body> is required for
 *  Blueprint's dark text/component tokens — Blueprint sets `body { color }`
 *  directly, so an <html>-only class leaves dark text on a dark background.
 *
 *  `data-theme` is the app's own signal, mirroring the same state. Our
 *  stylesheets key off it rather than Blueprint's class, because the class name
 *  is Blueprint's to change — the convention (enforced by
 *  tests/ui/blueprint-conventions.test.ts) is that `bp*-` strings never appear
 *  in our code or CSS, only via `Classes.*`, which CSS can't reference. */
export function applyTheme(theme: Theme): void {
  const dark = theme === "dark";
  document.documentElement.classList.toggle(Classes.DARK, dark);
  document.body?.classList.toggle(Classes.DARK, dark);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/** Persist a choice, apply it, and notify all subscribers (header + preferences). */
export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* storage unavailable */
  }
  applyTheme(resolveTheme(choice));
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const mq = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
  const onOs = () => {
    if (getThemeChoice() === "system") {
      applyTheme(resolveTheme());
      listener();
    }
  };
  mq?.addEventListener?.("change", onOs);
  return () => {
    listeners.delete(listener);
    mq?.removeEventListener?.("change", onOs);
  };
}

/** Stateful theme, shared across the app via a tiny store so the header toggle
 *  and the Preferences select stay in sync. */
export function useTheme(): {
  theme: Theme;
  choice: ThemeChoice;
  toggle: () => void;
  setChoice: (c: ThemeChoice) => void;
} {
  const choice = useSyncExternalStore(subscribe, getThemeChoice, getThemeChoice);
  return {
    theme: resolveTheme(choice),
    choice,
    toggle: () => setThemeChoice(resolveTheme(choice) === "dark" ? "light" : "dark"),
    setChoice: setThemeChoice,
  };
}

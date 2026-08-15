/**
 * The log viewer's persisted preferences.
 *
 * Reads and writes the same slot the dock's log tabs already use —
 * `heimdall.preferences.logViewerPreferences` — so wrapping is one setting
 * across both viewers rather than two that disagree. The dock's own accessors
 * are module-private in `app/lib/dock.ts`; this matches their shape and
 * their default rather than introducing a second key.
 *
 * Wrapping defaults to on, which is the dock's existing default. A log line is
 * prose of unknown length, and the alternative is scrolling sideways to read the
 * end of a stack trace and then back again to read the next line.
 */
const KEY = "heimdall.preferences";

interface LogPreferences {
  showTimestamps: boolean;
  showWordWrap: boolean;
}

const DEFAULTS: LogPreferences = { showTimestamps: false, showWordWrap: true };

export function logPreferences(): LogPreferences {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || "{}") as { logViewerPreferences?: Partial<LogPreferences> };
    return { ...DEFAULTS, ...all.logViewerPreferences };
  } catch {
    return DEFAULTS;
  }
}

export function setLogPreference<K extends keyof LogPreferences>(name: K, value: LogPreferences[K]): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, unknown>;
    localStorage.setItem(KEY, JSON.stringify({ ...all, logViewerPreferences: { ...logPreferences(), [name]: value } }));
  } catch {
    /* storage unavailable — the toggle still works for this session */
  }
}

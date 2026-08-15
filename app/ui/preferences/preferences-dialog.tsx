import { Button, Callout, FormGroup, H3, HTMLSelect, InputGroup, Switch } from "@blueprintjs/core";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_COMPANION_URL } from "../../lib/proxy";
import { CopyButton } from "../copy-button";
import { FEATURE_FLAGS, setFeatureEnabled, useDisabledFeatures } from "../feature-flags";
import { onOpenPreferences } from "../navigate";
import { notify } from "../notifications";
import { type ThemeChoice, useTheme } from "../use-theme";
import styles from "./preferences-dialog.module.css";

const KEY = "heimdall.preferences";

interface Prefs {
  companionUrl?: string;
  companionToken?: string;
  httpProxy?: string;
  allowUntrusted?: boolean;
  kubectlPath?: string;
  terminalShell?: string;
  [k: string]: unknown;
}

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Prefs;
  } catch {
    return {};
  }
}
function savePrefs(next: Prefs): void {
  localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...next }));
}

type SectionId = "proxy" | "appearance" | "terminal" | "features";
const SECTIONS: { id: SectionId; title: string }[] = [
  { id: "proxy", title: "Cluster proxy" },
  { id: "appearance", title: "Appearance" },
  { id: "terminal", title: "Terminal" },
  { id: "features", title: "Features" },
];

/**
 * Headless Preferences host: mounts the Preferences window and opens it on the
 * `open-preferences` signal (fired by the header's app menu and the empty
 * Catalog). Render this once in the Shell — without it, "Preferences" is a no-op.
 */
export function PreferencesHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenPreferences(() => setOpen(true)), []);
  return <PreferencesDialog isOpen={open} onClose={() => setOpen(false)} />;
}

/**
 * Preferences — a centred window over a dimmed app, with a section list on the
 * left and a content column on the right. It was a full-page takeover, copied
 * from Freelens's preferences *route*. A dialog keeps the cluster you were
 * looking at visible behind it.
 */
function PreferencesDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const initial = loadPrefs();
  const [section, setSection] = useState<SectionId>("proxy");
  const disabledFeatures = useDisabledFeatures();
  // Switching sections keeps the scroll container's offset, so arriving at a
  // short section from halfway down a long one landed mid-content — the pane
  // looked like it had jumped. Reset to the top on every change.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [section]);
  const [companionUrl, setCompanionUrl] = useState(initial.companionUrl ?? DEFAULT_COMPANION_URL);
  const [companionToken, setCompanionToken] = useState(initial.companionToken ?? "");
  const [httpProxy, setHttpProxy] = useState(initial.httpProxy ?? "");
  const [allowUntrusted, setAllowUntrusted] = useState(Boolean(initial.allowUntrusted));
  const [kubectlPath, setKubectlPath] = useState(initial.kubectlPath ?? "");
  const [terminalShell, setTerminalShell] = useState(initial.terminalShell ?? "");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const { choice, setChoice } = useTheme();

  // Close on Escape, like Freelens's preferences page.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const testConnection = async () => {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch(`${companionUrl.replace(/\/$/, "")}/v1/health`, {
        headers: companionToken ? { authorization: `Bearer ${companionToken}` } : {},
      });
      if (!res.ok) throw new Error(`Companion returned ${res.status}`);
      const body = (await res.json()) as { name?: string; version?: number };
      setTest({ ok: true, message: `Connected to ${body.name ?? "companion"} (v${body.version ?? "?"}).` });
    } catch (error) {
      setTest({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    savePrefs({
      companionUrl: companionUrl.trim(),
      companionToken: companionToken.trim(),
      httpProxy: httpProxy.trim() || undefined,
      allowUntrusted,
      kubectlPath: kubectlPath.trim() || undefined,
      terminalShell: terminalShell.trim() || undefined,
    });
    notify.success("Preferences saved.");
    onClose();
  };

  return (
    // A centred window rather than a full-page takeover: a dialog over a
    // dimmed app keeps the cluster you were looking at visible behind it.
    // Clicking the backdrop closes, as
    // Escape already did.
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.topbar}>
          <H3 className={styles.pageTitle}>Preferences</H3>
          <Button variant="minimal" icon="cross" aria-label="Close preferences" onClick={onClose} />
        </div>
        <div className={styles.body}>
          <nav className={styles.nav}>
            {SECTIONS.map(s => (
              <button
                key={s.id}
                className={s.id === section ? `${styles.navItem} ${styles.navActive}` : styles.navItem}
                onClick={() => setSection(s.id)}
              >
                {s.title}
              </button>
            ))}
          </nav>
          <div className={styles.content} ref={contentRef}>
            <div className={styles.column}>
              {section === "proxy" && (
                <>
                  <Callout intent="primary" icon="info-sign" className={styles.intro}>
                    Heimdall reaches client-certificate clusters through the local companion. Set its URL and token here
                    — then use <strong>Add cluster → Connect from kubeconfig</strong>.
                  </Callout>
                  <FormGroup label="Companion URL" labelInfo="(required)">
                    <InputGroup
                      value={companionUrl}
                      onValueChange={setCompanionUrl}
                      placeholder={DEFAULT_COMPANION_URL}
                      rightElement={companionUrl ? <CopyButton text={companionUrl} /> : undefined}
                    />
                  </FormGroup>
                  <FormGroup label="Companion token" labelInfo="(required)">
                    <InputGroup
                      type="password"
                      value={companionToken}
                      onValueChange={setCompanionToken}
                      placeholder="Bearer token"
                      rightElement={companionToken ? <CopyButton text={companionToken} /> : undefined}
                    />
                  </FormGroup>
                  <FormGroup label="HTTP proxy" labelInfo="(optional)">
                    <InputGroup value={httpProxy} onValueChange={setHttpProxy} placeholder="http://proxy:8080" />
                  </FormGroup>
                  <Switch
                    checked={allowUntrusted}
                    label="Allow untrusted TLS certificates"
                    onChange={e => setAllowUntrusted(e.currentTarget.checked)}
                  />
                  <div className={styles.testRow}>
                    <Button icon="signal-search" text="Test connection" loading={testing} onClick={testConnection} />
                    {test && (
                      <Callout
                        intent={test.ok ? "success" : "danger"}
                        icon={test.ok ? "tick" : "error"}
                        className={styles.testResult}
                      >
                        {test.message}
                      </Callout>
                    )}
                  </div>
                </>
              )}
              {/* Applied on toggle, not on Save. That follows the theme control
                above, which also writes to its own store immediately — Save
                covers the proxy and terminal fields, which are text the user is
                part-way through typing and genuinely need a commit point. A flag
                is one bit and its effect is the confirmation. */}
              {section === "features" && (
                <>
                  <Callout intent="primary" icon="info-sign" className={styles.intro}>
                    Newer surfaces, each separable enough to be switched cleanly: turning one off removes it rather than
                    disabling it in place. Each takes effect immediately — Save below is for the connection settings,
                    not for these.
                  </Callout>
                  {FEATURE_FLAGS.map(f => (
                    <FormGroup key={f.id} helperText={f.description}>
                      <Switch
                        checked={!disabledFeatures.has(f.id)}
                        label={f.label}
                        onChange={e => setFeatureEnabled(f.id, e.currentTarget.checked)}
                      />
                    </FormGroup>
                  ))}
                </>
              )}
              {section === "appearance" && (
                <FormGroup label="Theme" helperText="“System” follows your OS light/dark setting.">
                  <HTMLSelect
                    value={choice}
                    onChange={e => setChoice(e.currentTarget.value as ThemeChoice)}
                    options={[
                      { label: "System", value: "system" },
                      { label: "Light", value: "light" },
                      { label: "Dark", value: "dark" },
                    ]}
                  />
                </FormGroup>
              )}
              {section === "terminal" && (
                <>
                  <Callout intent="primary" icon="info-sign" className={styles.intro}>
                    Used by the companion for pod <strong>exec/shell</strong> and the local terminal.
                  </Callout>
                  <FormGroup label="kubectl path" labelInfo="(optional)" helperText="Defaults to `kubectl` on PATH.">
                    <InputGroup value={kubectlPath} onValueChange={setKubectlPath} placeholder="kubectl" />
                  </FormGroup>
                  <FormGroup
                    label="Terminal shell"
                    labelInfo="(optional)"
                    helperText="e.g. /bin/zsh or powershell.exe."
                  >
                    <InputGroup value={terminalShell} onValueChange={setTerminalShell} placeholder="(system default)" />
                  </FormGroup>
                </>
              )}
              <div className={styles.actions}>
                <Button text="Cancel" onClick={onClose} />
                <Button text="Save" intent="primary" onClick={save} disabled={!companionUrl.trim()} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

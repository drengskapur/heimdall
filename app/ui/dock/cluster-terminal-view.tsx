import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { activeCluster } from "../../infrastructure/composition-root";
// Type-only, so it is erased and pulls nothing into this chunk. The value
// import is dynamic below: a static one here defeated the dynamic imports
// everywhere else (Vite warns INEFFECTIVE_DYNAMIC_IMPORT) and dragged the whole
// companion transport into the initial bundle.
import type { LocalShellSession } from "../../lib/local-shell";
import "@xterm/xterm/css/xterm.css";
import styles from "../resource/terminal-view.module.css";

/**
 * Cluster Terminal — a local shell (via the companion's session API) with the
 * active cluster's kubeconfig exported as KUBECONFIG, so `kubectl` targets the
 * cluster. This is the Dock's default "Terminal" tab, matching Freelens. The
 * companion spawns the shell without a PTY, so we echo input locally.
 */
export function ClusterTerminalView() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const cluster = activeCluster();
    if (!cluster) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "Menlo, Monaco, Consolas, 'DejaVu Sans Mono', 'Courier New', monospace",
      lineHeight: 1.2,
      cursorBlink: true,
      convertEol: true,
      theme: { background: "#1c2127", foreground: "#e5e8eb", cursor: "#e5e8eb" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);

    let session: LocalShellSession | undefined;
    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      try {
        fit.fit();
        void session?.resize(term.cols, term.rows);
      } catch {
        /* mid-teardown */
      }
    };
    const raf = requestAnimationFrame(resize);
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // No "starting…" banner: the shell's own prompt is the readiness signal, and
    // the line only survived as noise in the scrollback above it.
    let closed = false;
    void import("../../lib/local-shell")
      .then(({ openLocalShell }) =>
        openLocalShell(
          {
            onReady: () => {
              term.focus();
              resize();
            },
            onStdout: text => term.write(text),
            onStderr: text => term.write(text),
            onError: message => term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`),
            onClose: () => term.write("\r\n\x1b[90m[session closed]\x1b[0m\r\n"),
          },
          { cluster: cluster.profile },
        ),
      )
      .then(s => {
        if (closed) {
          void s.close();
          return;
        }
        session = s;
      })
      .catch(err => term.write(`\r\n\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`));

    // The companion shell has no PTY, so it neither echoes input nor maps CR→LF —
    // do both locally.
    const onData = term.onData(data => {
      void session?.send(data.replace(/\r/g, "\n"));
      for (const ch of data) {
        if (ch === "\r") term.write("\r\n");
        else if (ch === "\x7f") term.write("\b \b");
        else if (ch >= " ") term.write(ch);
      }
    });

    return () => {
      closed = true;
      cancelAnimationFrame(raf);
      onData.dispose();
      observer.disconnect();
      try {
        void session?.close();
      } catch {
        /* already closed */
      }
      term.dispose();
    };
  }, []);

  return (
    <div className={styles.wrap}>
      <div ref={hostRef} className={styles.term} />
    </div>
  );
}

import { HTMLSelect } from "@blueprintjs/core";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type { ExecSession } from "../../application/ports/kubernetes-gateway";
import type { ResourceRef } from "../../domain/values/resource-ref";
import { activeCluster } from "../../infrastructure/composition-root";
import "@xterm/xterm/css/xterm.css";
import styles from "./terminal-view.module.css";

export interface TerminalViewProps {
  podRef: ResourceRef;
  containers: string[];
}

/**
 * Interactive pod shell: an xterm terminal wired to an exec session over the
 * hexagon (`activeCluster().gateway.exec`). For client-cert clusters the session
 * runs through the companion (kubectl exec); for bearer clusters it speaks the
 * channel.k8s.io WebSocket subprotocol. No transport knowledge lives here.
 */
export function TerminalView({ podRef, containers }: TerminalViewProps) {
  const [selected, setSelected] = useState<string>(containers[0] ?? "");
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const cluster = activeCluster();
    if (!cluster) return;

    const term = new Terminal({
      fontSize: 13,
      // xterm renders to a canvas and needs a concrete font family — a CSS
      // variable (var(--…)) does not resolve here and renders garbled.
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

    // Only fit once the host actually has dimensions — fitting a 0-sized
    // container (dock not laid out yet) produces a garbled terminal.
    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      try {
        fit.fit();
        session?.resize(term.cols, term.rows);
      } catch {
        /* mid-teardown */
      }
    };
    // First layout pass, then keep it fitted as the pane resizes.
    const raf = requestAnimationFrame(resize);
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // Client-cert clusters exec through the companion's `kubectl exec -i`, which
    // has no PTY and so does not echo input; echo it locally. Bearer clusters use
    // the exec WebSocket with tty=true (server echoes) — don't double-echo there.
    const localEcho = Boolean(cluster.profile.clientCertificateData);

    term.write(`Connecting to ${podRef.name}${selected ? ` · ${selected}` : ""}…\r\n`);
    const session: ExecSession = cluster.gateway.exec(
      podRef,
      // Pick the best available shell without spamming "not found": `command -v`
      // probes silently and `exec` replaces the process only on the one that
      // exists. Minimal images (distroless-ish) fall through to plain sh.
      [
        "/bin/sh",
        "-c",
        'clear 2>/dev/null; for s in bash ash sh; do command -v "$s" >/dev/null 2>&1 && exec "$s"; done',
      ],
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
      selected || undefined,
    );
    const onData = term.onData(data => {
      // xterm emits "\r" on Enter. A real TTY driver maps CR→LF (icrnl); the
      // companion's `kubectl exec -i` has no TTY, so the shell never sees a line
      // terminator unless we translate it to "\n" ourselves.
      session?.send(localEcho ? data.replace(/\r/g, "\n") : data);
      if (!localEcho) return;
      // Local echo, since a no-PTY shell doesn't echo input.
      for (const ch of data) {
        if (ch === "\r") term.write("\r\n");
        else if (ch === "\x7f") term.write("\b \b");
        else if (ch >= " ") term.write(ch);
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      onData.dispose();
      observer.disconnect();
      try {
        session?.close();
      } catch {
        /* already closed */
      }
      term.dispose();
    };
  }, [podRef, selected]);

  return (
    <div className={styles.wrap}>
      {containers.length > 1 && (
        <div className={styles.bar}>
          <HTMLSelect
            value={selected}
            onChange={e => setSelected(e.currentTarget.value)}
            options={containers.map(c => ({ label: c, value: c }))}
            minimal
          />
        </div>
      )}
      <div ref={hostRef} className={styles.term} />
    </div>
  );
}

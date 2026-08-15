import {
  Button,
  ButtonGroup,
  Classes,
  HTMLSelect,
  InputGroup,
  NonIdealState,
  Spinner,
  Switch,
} from "@blueprintjs/core";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResourceRef } from "../../domain/values/resource-ref";
import { activeCluster } from "../../infrastructure/composition-root";
import { logPreferences, setLogPreference } from "./log-preferences";
import { findMatches, stepMatch } from "./log-search";
import styles from "./logs-view.module.css";

/** Render log text with search matches wrapped in <mark>; the active one is tagged. */
function highlight(text: string, query: string, active: number): ReactNode {
  const matches = findMatches(text, query);
  if (matches.length === 0) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  matches.forEach((m, i) => {
    if (m.start > last) parts.push(text.slice(last, m.start));
    parts.push(
      <mark key={i} data-match={i} className={i === active ? styles.activeMatch : styles.match}>
        {text.slice(m.start, m.end)}
      </mark>,
    );
    last = m.end;
  });
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export interface LogsViewProps {
  podRef: ResourceRef;
  containers: string[];
}

type LoadState =
  | { status: "no-cluster" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

/**
 * Pod logs viewer: fetches (and optionally follows) container logs for a pod and
 * renders them in a scrollable monospace code block. Consumes the hexagon via
 * `activeCluster()?.pods` — no transport knowledge lives here.
 */
export function LogsView({ podRef, containers }: LogsViewProps) {
  const [selected, setSelected] = useState<string>(containers[0] ?? "");
  const [logs, setLogs] = useState<string>("");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [follow, setFollow] = useState<boolean>(false);
  // Persisted, and shared with the dock's log tabs so the two viewers agree.
  const [wrap, setWrap] = useState<boolean>(() => logPreferences().showWordWrap);

  // Holds the active streamLogs teardown so we can unsubscribe on unmount,
  // container change, or when Follow is toggled off.
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const teardownStream = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  }, []);

  const fetchLogs = useCallback(() => {
    const cluster = activeCluster();
    if (!cluster) {
      setState({ status: "no-cluster" });
      return () => {};
    }
    let cancelled = false;
    setState({ status: "loading" });
    cluster.pods
      .readLogs(podRef, { container: selected || undefined })
      .then(text => {
        if (!cancelled) {
          setLogs(text);
          setState({ status: "ready" });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [podRef, selected]);

  // Static fetch when not following. Re-runs on container change.
  useEffect(() => {
    if (follow) return;
    return fetchLogs();
  }, [fetchLogs, follow]);

  // Follow mode: seed the buffer then append streamed chunks.
  useEffect(() => {
    if (!follow) {
      teardownStream();
      return;
    }
    const cluster = activeCluster();
    if (!cluster) {
      setState({ status: "no-cluster" });
      return;
    }
    setLogs("");
    setState({ status: "ready" });
    const unsubscribe = cluster.pods.streamLogs(podRef, { container: selected || undefined, follow: true }, chunk =>
      setLogs(prev => prev + chunk),
    );
    unsubscribeRef.current = unsubscribe;
    return () => {
      teardownStream();
    };
  }, [podRef, selected, follow, teardownStream]);

  // --- Search within the logs ---
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matchCount = useMemo(() => findMatches(logs, query).length, [logs, query]);
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Auto-scroll to the tail as new content arrives (unless searching).
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = preRef.current;
    if (el && !query) el.scrollTop = el.scrollHeight;
  }, [logs, query]);

  // Scroll the active match into view.
  useEffect(() => {
    if (!query || matchCount === 0) return;
    preRef.current?.querySelector(`[data-match="${active}"]`)?.scrollIntoView({ block: "center" });
  }, [active, query, matchCount]);

  const step = (delta: 1 | -1) => setActive(a => stepMatch(a, matchCount, delta));

  if (state.status === "no-cluster") {
    return (
      <NonIdealState
        icon="layout-sorted-clusters"
        title="No active cluster"
        description="Pick a cluster from the Hotbar to connect."
      />
    );
  }

  const showContainerSelect = containers.length > 1;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {showContainerSelect && (
          <HTMLSelect
            value={selected}
            onChange={e => setSelected(e.currentTarget.value)}
            options={containers}
            aria-label="Container"
          />
        )}
        <Switch
          className={styles.follow}
          checked={follow}
          label="Follow"
          onChange={e => setFollow(e.currentTarget.checked)}
        />
        {/* A long log line ran off the right edge and could only be read by
            scrolling sideways and back again for the next one — worst exactly
            where it matters, on a stack trace. */}
        <Switch
          className={styles.follow}
          checked={wrap}
          label="Wrap"
          onChange={e => {
            const next = e.currentTarget.checked;
            setWrap(next);
            setLogPreference("showWordWrap", next);
          }}
        />
        <Button
          icon="refresh"
          text="Refresh"
          variant="minimal"
          size="small"
          disabled={follow || state.status === "loading"}
          onClick={fetchLogs}
        />
        <span className={styles.spacer} />
        <InputGroup
          className={styles.search}
          leftIcon="search"
          placeholder="Find…"
          value={query}
          onValueChange={setQuery}
          onKeyDown={e => {
            if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
          }}
          rightElement={
            query ? (
              <span className={`${Classes.TEXT_MUTED} ${styles.count}`}>
                {matchCount ? `${active + 1}/${matchCount}` : "0"}
              </span>
            ) : undefined
          }
          small
        />
        {query && (
          <ButtonGroup>
            <Button
              icon="chevron-up"
              variant="minimal"
              size="small"
              disabled={matchCount === 0}
              onClick={() => step(-1)}
              aria-label="Previous match"
            />
            <Button
              icon="chevron-down"
              variant="minimal"
              size="small"
              disabled={matchCount === 0}
              onClick={() => step(1)}
              aria-label="Next match"
            />
          </ButtonGroup>
        )}
      </div>

      <div className={styles.body}>
        {state.status === "loading" ? (
          <NonIdealState icon={<Spinner />} title="Loading logs…" />
        ) : state.status === "error" ? (
          <NonIdealState icon="error" title="Couldn't load logs" description={state.message} />
        ) : logs.length === 0 ? (
          <NonIdealState icon="align-left" title="No logs" description="This container has produced no output." />
        ) : (
          <pre ref={preRef} className={`${Classes.CODE_BLOCK} ${styles.logs} ${wrap ? styles.wrap : ""}`}>
            {highlight(logs, query, active)}
          </pre>
        )}
      </div>
    </div>
  );
}

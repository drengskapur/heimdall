import { Button, HTMLSelect, InputGroup, NonIdealState, Spinner, Tag } from "@blueprintjs/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ResourceRef } from "../../domain/values/resource-ref";
import { activeCluster } from "../../infrastructure/composition-root";
import { notify } from "../notifications";
import {
  type Forward,
  listForwards,
  startForward,
  startServiceForward,
  stopForward,
  subscribe,
} from "../port-forwards";
import styles from "./port-forward-view.module.css";

/** Subscribe a component to the active-forwards store. */
export function useForwards(): readonly Forward[] {
  return useSyncExternalStore(subscribe, listForwards, listForwards);
}

const statusIntent = (s: Forward["status"]) =>
  s === "active" ? "success" : s === "error" ? "danger" : s === "closed" ? "none" : "warning";

/** One active forward, shown in both the pod drawer tab and the page. */
export function ForwardRow({ forward, showPod = false }: { forward: Forward; showPod?: boolean }) {
  const url = forward.localPort ? `http://localhost:${forward.localPort}` : undefined;
  return (
    <div className={styles.row}>
      <Tag minimal intent={statusIntent(forward.status)}>
        {forward.status}
      </Tag>
      <span className={styles.route}>
        {showPod && (
          <span className={styles.pod}>
            {forward.origin
              ? `${forward.namespace}/svc/${forward.origin.name} `
              : `${forward.namespace}/${forward.podName} `}
          </span>
        )}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            localhost:{forward.localPort}
          </a>
        ) : (
          "localhost:—"
        )}
        {" → :"}
        {forward.origin ? forward.origin.port : forward.podPort}
      </span>
      {forward.message && <span className={styles.error}>{forward.message}</span>}
      <span className={styles.spacer} />
      {url && (
        <Button
          variant="minimal"
          size="small"
          icon="share"
          title="Open"
          onClick={() => window.open(url, "_blank", "noreferrer")}
        />
      )}
      <Button
        variant="minimal"
        size="small"
        icon="stop"
        intent="danger"
        title="Stop"
        onClick={() => stopForward(forward.id)}
      />
    </div>
  );
}

/** Pod drawer "Forward" tab: start a forward for a container port, list this
 *  pod's active forwards. */
export function PortForwardView({ podRef }: { podRef: ResourceRef }) {
  const [port, setPort] = useState("");
  const mine = useForwards().filter(f => f.podRef.toKey() === podRef.toKey());
  const start = () => {
    const p = Number(port);
    if (Number.isInteger(p) && p > 0 && p < 65536) {
      startForward(podRef, p);
      setPort("");
    }
  };
  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <InputGroup
          type="number"
          placeholder="Container port (e.g. 8080)"
          value={port}
          onValueChange={setPort}
          onKeyDown={e => {
            if (e.key === "Enter") start();
          }}
        />
        <Button intent="primary" icon="exchange" text="Forward" onClick={start} disabled={!port} />
      </div>
      <div className={styles.list}>
        {mine.length === 0 ? (
          <div className={styles.empty}>No active forwards for this pod.</div>
        ) : (
          mine.map(f => <ForwardRow key={f.id} forward={f} />)
        )}
      </div>
    </div>
  );
}

interface ServicePort {
  port: number;
  name?: string;
}

/** Service drawer "Forward" tab: pick one of the service's ports and forward it.
 *  The service is resolved to a ready backing pod + target port via Endpoints. */
export function ServiceForwardView({ serviceRef }: { serviceRef: ResourceRef }) {
  const [ports, setPorts] = useState<ServicePort[] | null>(null);
  const [selected, setSelected] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const mine = useForwards().filter(
    f =>
      f.origin?.kind === "Service" &&
      f.origin.name === serviceRef.name &&
      f.namespace === (serviceRef.namespace ?? "default"),
  );

  useEffect(() => {
    const cluster = activeCluster();
    if (!cluster) {
      setPorts([]);
      return;
    }
    let cancelled = false;
    cluster.resources
      .get(serviceRef, "services")
      .then(obj => {
        const spec = (obj?.raw as { spec?: { ports?: Array<{ port?: number; name?: string }> } } | undefined)?.spec;
        const list = (spec?.ports ?? [])
          .map(p => ({ port: Number(p.port), name: p.name }))
          .filter(p => Number.isInteger(p.port) && p.port > 0);
        if (!cancelled) {
          setPorts(list);
          setSelected(list[0]?.port ?? 0);
        }
      })
      .catch(() => {
        if (!cancelled) setPorts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceRef]);

  const start = async () => {
    const chosen = ports?.find(p => p.port === selected);
    if (!chosen) return;
    setBusy(true);
    try {
      await startServiceForward(serviceRef, chosen.port, chosen.name);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (ports === null)
    return (
      <div className={styles.wrap}>
        <Spinner size={24} />
      </div>
    );

  return (
    <div className={styles.wrap}>
      {ports.length === 0 ? (
        <div className={styles.empty}>This service exposes no ports.</div>
      ) : (
        <div className={styles.controls}>
          <HTMLSelect
            value={selected}
            onChange={e => setSelected(Number(e.currentTarget.value))}
            options={ports.map(p => ({ label: p.name ? `${p.port} (${p.name})` : String(p.port), value: p.port }))}
          />
          <Button intent="primary" icon="exchange" text="Forward" loading={busy} onClick={start} />
        </div>
      )}
      <div className={styles.list}>
        {mine.length === 0 ? (
          <div className={styles.empty}>No active forwards for this service.</div>
        ) : (
          mine.map(f => <ForwardRow key={f.id} forward={f} />)
        )}
      </div>
    </div>
  );
}

/** The Network → Port Forwarding page: every active forward, cluster-wide. */
export function PortForwardingPage() {
  const forwards = useForwards();
  if (forwards.length === 0) {
    return (
      <NonIdealState
        icon="exchange"
        title="No port forwards"
        description="Open a pod or service, then use its Forward tab to forward a port to localhost."
      />
    );
  }
  return (
    <div className={styles.list}>
      {forwards.map(f => (
        <ForwardRow key={f.id} forward={f} showPod />
      ))}
    </div>
  );
}

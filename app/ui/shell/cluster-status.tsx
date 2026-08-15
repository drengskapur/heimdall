import { Button, NonIdealState, Spinner } from "@blueprintjs/core";

/**
 * ClusterStatus — the cluster connection screen, matching Freelens's
 * `cluster-status.tsx`: while a cluster is connecting it shows a spinner; if the
 * connection fails it shows the error and a **Reconnect** button (plus a way back
 * to the Catalog). Rendered in place of the cluster content until connected.
 */
export function ClusterStatus({
  status,
  clusterName,
  message,
  reconnecting,
  onReconnect,
  onDisconnect,
}: {
  status: "connecting" | "error";
  clusterName: string;
  message?: string;
  reconnecting?: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  if (status === "connecting") {
    return (
      <NonIdealState
        icon={<Spinner />}
        title={`${reconnecting ? "Reconnecting to" : "Connecting to"} ${clusterName}…`}
      />
    );
  }
  return (
    <NonIdealState
      icon="offline"
      title={`Can't connect to ${clusterName}`}
      description={message ?? "The cluster is unreachable."}
      action={
        <div style={{ display: "flex", gap: 8 }}>
          <Button intent="primary" icon="refresh" text="Reconnect" loading={reconnecting} onClick={onReconnect} />
          <Button icon="home" text="Clusters" onClick={onDisconnect} />
        </div>
      }
    />
  );
}

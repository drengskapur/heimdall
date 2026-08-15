import { Button, H6, Intent, Tag, Tooltip } from "@blueprintjs/core";
import type { ReactNode } from "react";
import { useState } from "react";
import { CopyButton } from "../copy-button";
import { parseHpaMetrics } from "../metrics/hpa";
import { navigateToObject } from "../navigate";
import styles from "./detail-sections.module.css";

/** A clickable reference to another object (Controlled By, Node, …) that opens
 *  its details via cross-object navigation. */
function ObjectLink({
  kind,
  name,
  namespace,
  label,
}: {
  kind: string;
  name?: string;
  namespace?: string;
  label?: string;
}) {
  if (!name) return <>—</>;
  return (
    <Tag minimal interactive onClick={() => navigateToObject({ kind, name, namespace })}>
      {label ?? (kind ? `${kind}/${name}` : name)}
    </Tag>
  );
}

/**
 * Rich per-kind detail sections rendered from an object's raw manifest.
 *
 * `DETAIL_SECTIONS[kind]?.(raw)` yields kind-specific sections (containers,
 * ports, addresses, …); `MetaSection(raw)` yields the shared metadata block
 * (created / labels / annotations / owner refs) used by every kind. Both read
 * defensively from `raw` and omit fields that are missing, so a partial or
 * unexpected manifest degrades to "render what's there" rather than throwing.
 */
export const DETAIL_SECTIONS: Record<string, (raw: Record<string, unknown>) => ReactNode> = {
  Pod: podSection,
  Deployment: deploymentSection,
  DaemonSet: daemonSetSection,
  StatefulSet: statefulSetSection,
  ReplicaSet: replicaSetSection,
  Job: jobSection,
  CronJob: cronJobSection,
  Node: nodeSection,
  Service: serviceSection,
  ConfigMap: configMapSection,
  Secret: raw => <SecretSection raw={raw} />,
  Ingress: ingressSection,
  PersistentVolumeClaim: pvcSection,
  PersistentVolume: pvSection,
  StorageClass: storageClassSection,
  HorizontalPodAutoscaler: hpaSection,
  ReplicationController: replicationControllerSection,
  Namespace: namespaceSection,
  ServiceAccount: serviceAccountSection,
  Endpoints: endpointsSection,
  NetworkPolicy: networkPolicySection,
  ResourceQuota: resourceQuotaSection,
  LimitRange: limitRangeSection,
  PriorityClass: priorityClassSection,
  RuntimeClass: runtimeClassSection,
  Lease: leaseSection,
  Role: roleSection,
  ClusterRole: roleSection,
  RoleBinding: roleBindingSection,
  ClusterRoleBinding: roleBindingSection,
  Event: eventSection,
  CustomResourceDefinition: crdSection,
  IngressClass: ingressClassSection,
  MutatingWebhookConfiguration: webhookConfigSection,
  ValidatingWebhookConfiguration: webhookConfigSection,
};

// ---------------------------------------------------------------------------
// Defensive raw-object readers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Coerce a leaf value to a non-empty display string, else undefined. */
function str(v: unknown): string | undefined {
  if (typeof v === "string") return v.length > 0 ? v : undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

/** Safe nested lookup: `get(raw, "status", "podIP")`. */
function get(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function intentForPhase(phase: string): Intent {
  if (["Running", "Bound", "Active", "Succeeded", "Available"].includes(phase)) return Intent.SUCCESS;
  if (["Failed", "Lost", "Unknown", "Terminating", "Evicted"].includes(phase)) return Intent.DANGER;
  if (["Pending", "ContainerCreating"].includes(phase)) return Intent.WARNING;
  return Intent.NONE;
}

// ---------------------------------------------------------------------------
// Layout helpers (DrawerItem-style key/value rows + titled sections)
// ---------------------------------------------------------------------------

/** A single key/value row. Renders nothing when `children` is empty. */
export function Item({ label, children }: { label: ReactNode; children: ReactNode }) {
  if (children == null || children === false || children === "") return null;
  if (Array.isArray(children) && children.length === 0) return null;
  // Offer a hover copy button for plain scalar values (UID, IPs, versions, …).
  const copyable = typeof children === "string" || typeof children === "number" ? String(children) : undefined;
  return (
    <div className={styles.item}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>
        <span className={styles.valueText}>{children}</span>
        {copyable && (
          <span className={styles.copy}>
            <CopyButton text={copyable} />
          </span>
        )}
      </div>
    </div>
  );
}

/** A titled group: an `<H6>` header over a body of `Item`s. */
export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <H6 className={styles.sectionTitle}>{title}</H6>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  );
}

/** Wrapping row of Tags. */
function Tags({ children }: { children: ReactNode }) {
  return <div className={styles.tags}>{children}</div>;
}

/** Render a string→string map (labels/annotations) as `key=value` Tags. */
function mapTags(map: Record<string, unknown>, keyOnly = false): ReactNode {
  const entries = Object.entries(map);
  if (entries.length === 0) return null;
  return (
    <Tags>
      {entries.map(([k, v]) => {
        const value = str(v) ?? "";
        const text = keyOnly ? k : `${k}=${truncate(value, 40)}`;
        return (
          <Tag minimal key={k} title={`${k}=${value}`}>
            {text}
          </Tag>
        );
      })}
    </Tags>
  );
}

/** Render `status.conditions[]` as intent-colored Tags. */
function conditionTags(conditions: unknown[]): ReactNode {
  const tags = conditions
    .map((c, i) => {
      const type = str(get(c, "type"));
      if (!type) return null;
      const st = str(get(c, "status"));
      return (
        <Tag
          minimal
          intent={st === "True" ? Intent.SUCCESS : st === "False" ? Intent.NONE : Intent.WARNING}
          key={i}
          title={`${type}=${st ?? "?"}`}
        >
          {type}
        </Tag>
      );
    })
    .filter(Boolean);
  return tags.length > 0 ? <Tags>{tags}</Tags> : null;
}

// ---------------------------------------------------------------------------
// Shared metadata section
// ---------------------------------------------------------------------------

function metaAge(iso?: string): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  const d = Math.floor(s / 86400),
    h = Math.floor(s / 3600),
    m = Math.floor(s / 60);
  return d > 0 ? `${d}d` : h > 0 ? `${h}h` : m > 0 ? `${m}m` : `${Math.floor(s)}s`;
}

/** Shared metadata block shown at the top of every detail drawer — matches
 *  Freelens's KubeObjectMeta (Created/Name/Namespace/UID/Resource Version/
 *  Labels/Annotations/Finalizers/Controlled By). */
export function MetaSection(raw: Record<string, unknown>): ReactNode {
  const meta = isRecord(raw.metadata) ? raw.metadata : {};
  const created = str(meta.creationTimestamp);
  const name = str(meta.name);
  const namespace = str(meta.namespace);
  const uid = str(meta.uid);
  const resourceVersion = str(meta.resourceVersion);
  const labels = isRecord(meta.labels) ? meta.labels : undefined;
  const annotations = isRecord(meta.annotations) ? meta.annotations : undefined;
  const finalizers = asArray(meta.finalizers).map(String).filter(Boolean);
  const owners = asArray(meta.ownerReferences);
  const deleted = str(meta.deletionTimestamp);
  const managers = [
    ...new Set(
      asArray(meta.managedFields)
        .map(m => str(get(m, "manager")))
        .filter(Boolean),
    ),
  ] as string[];
  return (
    <Section title="Metadata">
      {created && <Item label="Created">{`${created}${metaAge(created) ? ` (${metaAge(created)} ago)` : ""}`}</Item>}
      {deleted && <Item label="Deleted">{deleted}</Item>}
      {name && <Item label="Name">{name}</Item>}
      {namespace && <Item label="Namespace">{namespace}</Item>}
      {uid && <Item label="UID">{uid}</Item>}
      {resourceVersion && <Item label="Resource Version">{resourceVersion}</Item>}
      {labels && <Item label="Labels">{mapTags(labels)}</Item>}
      {annotations && <Item label="Annotations">{mapTags(annotations, true)}</Item>}
      {finalizers.length > 0 && (
        <Item label="Finalizers">
          <Tags>
            {finalizers.map((f, i) => (
              <Tag minimal key={i}>
                {f}
              </Tag>
            ))}
          </Tags>
        </Item>
      )}
      {managers.length > 0 && (
        <Item label="Managed Fields">
          <Tags>
            {managers.map((m, i) => (
              <Tag minimal key={i}>
                {m}
              </Tag>
            ))}
          </Tags>
        </Item>
      )}
      {owners.length > 0 && (
        <Item label="Controlled By">
          <Tags>
            {owners.map((o, i) => (
              <ObjectLink key={i} kind={str(get(o, "kind")) ?? ""} name={str(get(o, "name"))} namespace={namespace} />
            ))}
          </Tags>
        </Item>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Pod
// ---------------------------------------------------------------------------

function podSection(raw: Record<string, unknown>): ReactNode {
  const phase = str(get(raw, "status", "phase"));
  const conditions = asArray(get(raw, "status", "conditions"));
  const containers = asArray(get(raw, "spec", "containers"));
  const statuses = asArray(get(raw, "status", "containerStatuses"));
  const statusByName = new Map<string, unknown>();
  for (const s of statuses) {
    const name = str(get(s, "name"));
    if (name) statusByName.set(name, s);
  }
  return (
    <>
      <Section title="Status">
        <Item label="Phase">
          {phase && (
            <Tag minimal intent={intentForPhase(phase)}>
              {phase}
            </Tag>
          )}
        </Item>
        <Item label="Scheduler">{str(get(raw, "spec", "schedulerName"))}</Item>
        <Item label="Node">
          {get(raw, "spec", "nodeName") != null ? (
            <ObjectLink
              kind="Node"
              name={str(get(raw, "spec", "nodeName"))}
              label={str(get(raw, "spec", "nodeName"))}
            />
          ) : undefined}
        </Item>
        <Item label="Host IP">{str(get(raw, "status", "hostIP"))}</Item>
        <Item label="Pod IP">{str(get(raw, "status", "podIP"))}</Item>
        <Item label="Service Account">
          {str(get(raw, "spec", "serviceAccountName")) ?? str(get(raw, "spec", "serviceAccount"))}
        </Item>
        <Item label="Priority Class">{str(get(raw, "spec", "priorityClassName"))}</Item>
        <Item label="QoS Class">{str(get(raw, "status", "qosClass"))}</Item>
        <Item label="Runtime Class">{str(get(raw, "spec", "runtimeClassName"))}</Item>
        <Item label="Termination Grace Period">{str(get(raw, "spec", "terminationGracePeriodSeconds"))}</Item>
        {isRecord(get(raw, "spec", "nodeSelector")) && (
          <Item label="Node Selector">{mapTags(get(raw, "spec", "nodeSelector") as Record<string, unknown>)}</Item>
        )}
        {conditions.length > 0 && <Item label="Conditions">{conditionTags(conditions)}</Item>}
      </Section>
      {asArray(get(raw, "spec", "tolerations")).length > 0 && (
        <Section title="Tolerations">
          <Item label="Tolerations">
            <Tags>
              {asArray(get(raw, "spec", "tolerations")).map((t, i) => {
                const parts = [
                  str(get(t, "key")),
                  str(get(t, "operator")),
                  str(get(t, "value")),
                  str(get(t, "effect")),
                ].filter(Boolean);
                return (
                  <Tag minimal key={i}>
                    {parts.join(" ") || "—"}
                  </Tag>
                );
              })}
            </Tags>
          </Item>
        </Section>
      )}
      {containers.map((c, i) => {
        const name = str(get(c, "name")) ?? `container-${i}`;
        const cs = statusByName.get(name);
        const ready = get(cs, "ready") === true;
        const restarts = str(get(cs, "restartCount"));
        const ports = asArray(get(c, "ports"));
        const env = asArray(get(c, "env"));
        return (
          <Section title={`Container: ${name}`} key={name}>
            <Item label="Image">{str(get(c, "image"))}</Item>
            {cs != null && (
              <Item label="Ready">
                <Tag minimal intent={ready ? Intent.SUCCESS : Intent.WARNING}>
                  {ready ? "Ready" : "Not ready"}
                </Tag>
              </Item>
            )}
            <Item label="Restarts">{restarts}</Item>
            {isRecord(get(c, "resources", "requests")) && (
              <Item label="Requests">{mapTags(get(c, "resources", "requests") as Record<string, unknown>)}</Item>
            )}
            {isRecord(get(c, "resources", "limits")) && (
              <Item label="Limits">{mapTags(get(c, "resources", "limits") as Record<string, unknown>)}</Item>
            )}
            {ports.length > 0 && (
              <Item label="Ports">
                <Tags>
                  {ports.map((p, pi) => {
                    const port = str(get(p, "containerPort"));
                    const proto = str(get(p, "protocol")) ?? "TCP";
                    return (
                      <Tag minimal key={pi}>
                        {port}/{proto}
                      </Tag>
                    );
                  })}
                </Tags>
              </Item>
            )}
            {env.length > 0 && (
              <Item label="Env">
                <Tags>
                  {env.map((e, ei) => {
                    const envName = str(get(e, "name"));
                    return envName ? (
                      <Tag minimal key={ei}>
                        {envName}
                      </Tag>
                    ) : null;
                  })}
                </Tags>
              </Item>
            )}
          </Section>
        );
      })}
      {asArray(get(raw, "spec", "volumes")).length > 0 && (
        <Section title="Volumes">
          {asArray(get(raw, "spec", "volumes")).map((v, i) => {
            const name = str(get(v, "name")) ?? `volume-${i}`;
            const type = Object.keys(v as Record<string, unknown>).find(k => k !== "name") ?? "—";
            return (
              <Item label={name} key={i}>
                {type}
              </Item>
            );
          })}
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

function deploymentSection(raw: Record<string, unknown>): ReactNode {
  const conditions = asArray(get(raw, "status", "conditions"));
  const matchLabels = get(raw, "spec", "selector", "matchLabels");
  return (
    <Section title="Deployment">
      <Item label="Replicas">{str(get(raw, "spec", "replicas"))}</Item>
      <Item label="Ready">{str(get(raw, "status", "readyReplicas"))}</Item>
      <Item label="Available">{str(get(raw, "status", "availableReplicas"))}</Item>
      <Item label="Updated">{str(get(raw, "status", "updatedReplicas"))}</Item>
      <Item label="Strategy">{str(get(raw, "spec", "strategy", "type"))}</Item>
      {isRecord(matchLabels) && <Item label="Selector">{mapTags(matchLabels)}</Item>}
      {conditions.length > 0 && <Item label="Conditions">{conditionTags(conditions)}</Item>}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Other workload controllers (DaemonSet / StatefulSet / ReplicaSet / Job / CronJob)
// ---------------------------------------------------------------------------

function daemonSetSection(raw: Record<string, unknown>): ReactNode {
  const sel = get(raw, "spec", "selector", "matchLabels");
  const nodeSel = get(raw, "spec", "template", "spec", "nodeSelector");
  return (
    <Section title="Daemon Set">
      <Item label="Desired">{str(get(raw, "status", "desiredNumberScheduled")) ?? "0"}</Item>
      <Item label="Current">{str(get(raw, "status", "currentNumberScheduled")) ?? "0"}</Item>
      <Item label="Ready">{str(get(raw, "status", "numberReady")) ?? "0"}</Item>
      <Item label="Updated">{str(get(raw, "status", "updatedNumberScheduled")) ?? "0"}</Item>
      <Item label="Available">{str(get(raw, "status", "numberAvailable")) ?? "0"}</Item>
      {isRecord(nodeSel) && <Item label="Node Selector">{mapTags(nodeSel)}</Item>}
      {isRecord(sel) && <Item label="Selector">{mapTags(sel)}</Item>}
    </Section>
  );
}

function statefulSetSection(raw: Record<string, unknown>): ReactNode {
  const sel = get(raw, "spec", "selector", "matchLabels");
  return (
    <Section title="Stateful Set">
      <Item label="Replicas">{str(get(raw, "spec", "replicas")) ?? "0"}</Item>
      <Item label="Ready">{str(get(raw, "status", "readyReplicas")) ?? "0"}</Item>
      <Item label="Current">{str(get(raw, "status", "currentReplicas")) ?? "0"}</Item>
      <Item label="Updated">{str(get(raw, "status", "updatedReplicas")) ?? "0"}</Item>
      <Item label="Service">{str(get(raw, "spec", "serviceName")) ?? "—"}</Item>
      {isRecord(sel) && <Item label="Selector">{mapTags(sel)}</Item>}
    </Section>
  );
}

function replicaSetSection(raw: Record<string, unknown>): ReactNode {
  const sel = get(raw, "spec", "selector", "matchLabels");
  return (
    <Section title="Replica Set">
      <Item label="Desired">{str(get(raw, "spec", "replicas")) ?? "0"}</Item>
      <Item label="Current">{str(get(raw, "status", "replicas")) ?? "0"}</Item>
      <Item label="Ready">{str(get(raw, "status", "readyReplicas")) ?? "0"}</Item>
      <Item label="Available">{str(get(raw, "status", "availableReplicas")) ?? "0"}</Item>
      {isRecord(sel) && <Item label="Selector">{mapTags(sel)}</Item>}
    </Section>
  );
}

function jobSection(raw: Record<string, unknown>): ReactNode {
  const sel = get(raw, "spec", "selector", "matchLabels");
  return (
    <Section title="Job">
      <Item label="Completions">{str(get(raw, "spec", "completions")) ?? "—"}</Item>
      <Item label="Parallelism">{str(get(raw, "spec", "parallelism")) ?? "—"}</Item>
      <Item label="Succeeded">{str(get(raw, "status", "succeeded")) ?? "0"}</Item>
      <Item label="Failed">{str(get(raw, "status", "failed")) ?? "0"}</Item>
      <Item label="Suspended">{get(raw, "spec", "suspend") ? "Yes" : "No"}</Item>
      {isRecord(sel) && <Item label="Selector">{mapTags(sel)}</Item>}
    </Section>
  );
}

function cronJobSection(raw: Record<string, unknown>): ReactNode {
  return (
    <Section title="Cron Job">
      <Item label="Schedule">{str(get(raw, "spec", "schedule")) ?? "—"}</Item>
      <Item label="Timezone">{str(get(raw, "spec", "timeZone")) ?? "—"}</Item>
      <Item label="Concurrency">{str(get(raw, "spec", "concurrencyPolicy")) ?? "—"}</Item>
      <Item label="Suspended">{get(raw, "spec", "suspend") ? "Yes" : "No"}</Item>
      <Item label="Active">{String(asArray(get(raw, "status", "active")).length)}</Item>
      <Item label="Last schedule">{str(get(raw, "status", "lastScheduleTime")) ?? "—"}</Item>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// HorizontalPodAutoscaler
// ---------------------------------------------------------------------------

function hpaSection(raw: Record<string, unknown>): ReactNode {
  const target = get(raw, "spec", "scaleTargetRef");
  const metrics = parseHpaMetrics(raw);
  const conditions = asArray(get(raw, "status", "conditions"));
  return (
    <>
      <Section title="Autoscaler">
        {isRecord(target) && (
          <Item label="Scale target">{`${str(get(target, "kind")) ?? ""}/${str(get(target, "name")) ?? ""}`}</Item>
        )}
        <Item label="Min replicas">{str(get(raw, "spec", "minReplicas")) ?? "1"}</Item>
        <Item label="Max replicas">{str(get(raw, "spec", "maxReplicas"))}</Item>
        <Item label="Current replicas">{str(get(raw, "status", "currentReplicas")) ?? "0"}</Item>
        <Item label="Desired replicas">{str(get(raw, "status", "desiredReplicas")) ?? "0"}</Item>
      </Section>
      {metrics.length > 0 && (
        <Section title="Metrics">
          {metrics.map((m, i) => (
            <Item label={m.name} key={i}>{`${m.current} / ${m.target}`}</Item>
          ))}
        </Section>
      )}
      {conditions.length > 0 && (
        <Section title="Conditions">
          <Item label="">{conditionTags(conditions)}</Item>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

function nodeSection(raw: Record<string, unknown>): ReactNode {
  const addresses = asArray(get(raw, "status", "addresses"));
  const capacity = get(raw, "status", "capacity");
  const allocatable = get(raw, "status", "allocatable");
  const conditions = asArray(get(raw, "status", "conditions"));
  const resourceKeys = ["cpu", "memory", "pods", "ephemeral-storage"];
  return (
    <>
      {addresses.length > 0 && (
        <Section title="Addresses">
          {addresses.map((a, i) => {
            const type = str(get(a, "type")) ?? `address-${i}`;
            return (
              <Item label={type} key={i}>
                {str(get(a, "address"))}
              </Item>
            );
          })}
        </Section>
      )}
      <Section title="System Info">
        <Item label="Kubelet">{str(get(raw, "status", "nodeInfo", "kubeletVersion"))}</Item>
        <Item label="OS Image">{str(get(raw, "status", "nodeInfo", "osImage"))}</Item>
        <Item label="Kernel">{str(get(raw, "status", "nodeInfo", "kernelVersion"))}</Item>
        <Item label="Container Runtime">{str(get(raw, "status", "nodeInfo", "containerRuntimeVersion"))}</Item>
        <Item label="Architecture">{str(get(raw, "status", "nodeInfo", "architecture"))}</Item>
      </Section>
      {(isRecord(capacity) || isRecord(allocatable)) && (
        <Section title="Capacity">
          {resourceKeys.map(key => {
            const cap = str(get(capacity, key));
            const alloc = str(get(allocatable, key));
            if (cap == null && alloc == null) return null;
            return (
              <Item label={key} key={key}>
                {alloc != null && cap != null ? `${alloc} / ${cap}` : (alloc ?? cap)}
              </Item>
            );
          })}
        </Section>
      )}
      {conditions.length > 0 && (
        <Section title="Conditions">
          <Item label="Conditions">{conditionTags(conditions)}</Item>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function serviceSection(raw: Record<string, unknown>): ReactNode {
  const ports = asArray(get(raw, "spec", "ports"));
  const selector = get(raw, "spec", "selector");
  const clusterIPs = asArray(get(raw, "spec", "clusterIPs"))
    .map(String)
    .filter(Boolean);
  const externalIPs = asArray(get(raw, "spec", "externalIPs"))
    .map(String)
    .filter(Boolean);
  const ipFamilies = asArray(get(raw, "spec", "ipFamilies"))
    .map(String)
    .filter(Boolean);
  return (
    <Section title="Service">
      {isRecord(selector) && <Item label="Selector">{mapTags(selector)}</Item>}
      <Item label="Type">{str(get(raw, "spec", "type"))}</Item>
      <Item label="Session Affinity">{str(get(raw, "spec", "sessionAffinity"))}</Item>
      <Item label="Cluster IP">{str(get(raw, "spec", "clusterIP"))}</Item>
      {clusterIPs.length > 0 && (
        <Item label="Cluster IPs">
          <Tags>
            {clusterIPs.map((ip, i) => (
              <Tag minimal key={i}>
                {ip}
              </Tag>
            ))}
          </Tags>
        </Item>
      )}
      {externalIPs.length > 0 && (
        <Item label="External IPs">
          <Tags>
            {externalIPs.map((ip, i) => (
              <Tag minimal key={i}>
                {ip}
              </Tag>
            ))}
          </Tags>
        </Item>
      )}
      <Item label="Load Balancer IP">{str(get(raw, "spec", "loadBalancerIP"))}</Item>
      <Item label="External Traffic Policy">{str(get(raw, "spec", "externalTrafficPolicy"))}</Item>
      <Item label="IP Family Policy">{str(get(raw, "spec", "ipFamilyPolicy"))}</Item>
      {ipFamilies.length > 0 && (
        <Item label="IP Families">
          <Tags>
            {ipFamilies.map((f, i) => (
              <Tag minimal key={i}>
                {f}
              </Tag>
            ))}
          </Tags>
        </Item>
      )}
      {ports.length > 0 && (
        <Item label="Ports">
          <Tags>
            {ports.map((p, i) => {
              const port = str(get(p, "port"));
              const target = str(get(p, "targetPort"));
              const proto = str(get(p, "protocol")) ?? "TCP";
              const nodePort = str(get(p, "nodePort"));
              const label = `${port}${target != null ? `:${target}` : ""}/${proto}${nodePort != null ? ` (node ${nodePort})` : ""}`;
              return (
                <Tag minimal key={i}>
                  {label}
                </Tag>
              );
            })}
          </Tags>
        </Item>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// ConfigMap
// ---------------------------------------------------------------------------

function configMapSection(raw: Record<string, unknown>): ReactNode {
  const data = isRecord(raw.data) ? raw.data : undefined;
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <Section title="Data">
      {Object.entries(data).map(([k, v]) => (
        <Item label={k} key={k}>
          <pre className={styles.dataBlock}>{str(v)}</pre>
        </Item>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Secret (per-key reveal/hide, base64-decoded on reveal)
// ---------------------------------------------------------------------------

function decodeBase64(value: string): string {
  try {
    return atob(value);
  } catch {
    return value;
  }
}

function SecretKeyRow({ name, value }: { name: string; value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <Item label={name}>
      <div className={styles.secretRow}>
        <code className={styles.code}>{revealed ? truncate(decodeBase64(value), 200) : "••••••••"}</code>
        {/* Copies the full decoded value, not the truncated display text and not
            the base64 — that is what a secret is actually wanted for. Available
            without revealing, so the value need not be put on screen to be used.
            (Item's own hover-copy only applies to plain scalar children, so a
            row like this one would otherwise have no copy affordance at all.) */}
        <CopyButton text={decodeBase64(value)} title={`Copy ${name}`} />
        <Tooltip content={revealed ? "Hide" : "Reveal"} compact minimal>
          <Button
            variant="minimal"
            size="small"
            icon={revealed ? "eye-off" : "eye-open"}
            aria-label={revealed ? `Hide ${name}` : `Reveal ${name}`}
            onClick={() => setRevealed(r => !r)}
          />
        </Tooltip>
      </div>
    </Item>
  );
}

function SecretSection({ raw }: { raw: Record<string, unknown> }): ReactNode {
  const data = isRecord(raw.data) ? raw.data : {};
  const keys = Object.keys(data);
  return (
    <Section title="Secret">
      <Item label="Type">{str(raw.type)}</Item>
      {keys.map(k => (
        <SecretKeyRow key={k} name={k} value={str(data[k]) ?? ""} />
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Ingress
// ---------------------------------------------------------------------------

function ingressSection(raw: Record<string, unknown>): ReactNode {
  const rules = asArray(get(raw, "spec", "rules"));
  const tls = asArray(get(raw, "spec", "tls"));
  const lbIngress = asArray(get(raw, "status", "loadBalancer", "ingress"));
  const defaultBackend = get(raw, "spec", "defaultBackend", "service", "name");
  const hasSummary = tls.length > 0 || lbIngress.length > 0 || defaultBackend != null;
  return (
    <>
      {hasSummary && (
        <Section title="Ingress">
          {get(raw, "spec", "ingressClassName") != null && (
            <Item label="Ingress Class">{str(get(raw, "spec", "ingressClassName"))}</Item>
          )}
          {defaultBackend != null && <Item label="Default Backend">{str(defaultBackend)}</Item>}
          {tls.length > 0 && (
            <Item label="TLS">
              <Tags>
                {tls.map((t, i) => {
                  const secret = str(get(t, "secretName"));
                  const hosts = asArray(get(t, "hosts"))
                    .map(h => str(h))
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <Tag minimal key={i}>
                      {[secret, hosts].filter(Boolean).join(" · ") || "—"}
                    </Tag>
                  );
                })}
              </Tags>
            </Item>
          )}
          {lbIngress.length > 0 && (
            <Item label="Load Balancer">
              <Tags>
                {lbIngress.map((p, i) => {
                  const addr = str(get(p, "ip")) ?? str(get(p, "hostname"));
                  return addr ? (
                    <Tag minimal key={i}>
                      {addr}
                    </Tag>
                  ) : null;
                })}
              </Tags>
            </Item>
          )}
        </Section>
      )}
      {rules.map((rule, i) => {
        const host = str(get(rule, "host")) ?? "*";
        const paths = asArray(get(rule, "http", "paths"));
        return (
          <Section title={`Rule: ${host}`} key={i}>
            {paths.map((p, pi) => {
              const path = str(get(p, "path")) ?? "/";
              const svc = str(get(p, "backend", "service", "name")) ?? str(get(p, "backend", "serviceName"));
              const port =
                str(get(p, "backend", "service", "port", "number")) ??
                str(get(p, "backend", "service", "port", "name")) ??
                str(get(p, "backend", "servicePort"));
              return (
                <Item label={path} key={pi}>
                  {[svc, port].filter(Boolean).join(":")}
                </Item>
              );
            })}
          </Section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// PersistentVolumeClaim
// ---------------------------------------------------------------------------

function pvcSection(raw: Record<string, unknown>): ReactNode {
  const phase = str(get(raw, "status", "phase"));
  const accessModes = asArray(get(raw, "spec", "accessModes"));
  return (
    <Section title="PersistentVolumeClaim">
      <Item label="Status">
        {phase && (
          <Tag minimal intent={intentForPhase(phase)}>
            {phase}
          </Tag>
        )}
      </Item>
      <Item label="Storage">{str(get(raw, "spec", "resources", "requests", "storage"))}</Item>
      <Item label="Storage Class">{str(get(raw, "spec", "storageClassName"))}</Item>
      {accessModes.length > 0 && (
        <Item label="Access Modes">
          <Tags>
            {accessModes.map((m, i) => {
              const mode = str(m);
              return mode ? (
                <Tag minimal key={i}>
                  {mode}
                </Tag>
              ) : null;
            })}
          </Tags>
        </Item>
      )}
      <Item label="Volume">{str(get(raw, "spec", "volumeName"))}</Item>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Additional kinds (ground-truth fields from freelensapp/freelens *-details.tsx)
// ---------------------------------------------------------------------------

function tagList(values: unknown[]): ReactNode {
  const items = values.map(String).filter(Boolean);
  return items.length ? (
    <Tags>
      {items.map((v, i) => (
        <Tag minimal key={i}>
          {v}
        </Tag>
      ))}
    </Tags>
  ) : undefined;
}

function namespaceSection(raw: Record<string, unknown>): ReactNode {
  const phase = str(get(raw, "status", "phase"));
  return (
    <Section title="Namespace">
      <Item label="Status">
        {phase && (
          <Tag minimal intent={phase === "Active" ? Intent.SUCCESS : Intent.WARNING}>
            {phase}
          </Tag>
        )}
      </Item>
    </Section>
  );
}

function replicationControllerSection(raw: Record<string, unknown>): ReactNode {
  const sel = get(raw, "spec", "selector");
  return (
    <Section title="Replication Controller">
      <Item label="Replicas">{str(get(raw, "spec", "replicas")) ?? "0"}</Item>
      <Item label="Ready">{str(get(raw, "status", "readyReplicas")) ?? "0"}</Item>
      <Item label="Available">{str(get(raw, "status", "availableReplicas")) ?? "0"}</Item>
      {isRecord(sel) && <Item label="Selector">{mapTags(sel)}</Item>}
    </Section>
  );
}

function pvSection(raw: Record<string, unknown>): ReactNode {
  const claim = get(raw, "spec", "claimRef");
  return (
    <Section title="Persistent Volume">
      <Item label="Capacity">{str(get(raw, "spec", "capacity", "storage"))}</Item>
      <Item label="Access Modes">{tagList(asArray(get(raw, "spec", "accessModes")))}</Item>
      <Item label="Reclaim Policy">{str(get(raw, "spec", "persistentVolumeReclaimPolicy"))}</Item>
      <Item label="Storage Class">{str(get(raw, "spec", "storageClassName"))}</Item>
      <Item label="Volume Mode">{str(get(raw, "spec", "volumeMode"))}</Item>
      <Item label="Status">{str(get(raw, "status", "phase"))}</Item>
      {isRecord(claim) && (
        <Item label="Claim">{`${str(get(claim, "namespace")) ?? ""}/${str(get(claim, "name")) ?? ""}`}</Item>
      )}
      {isRecord(get(raw, "spec", "nfs")) && (
        <Item label="NFS">{`${str(get(raw, "spec", "nfs", "server"))}:${str(get(raw, "spec", "nfs", "path"))}`}</Item>
      )}
      {isRecord(get(raw, "spec", "csi")) && <Item label="CSI Driver">{str(get(raw, "spec", "csi", "driver"))}</Item>}
      {isRecord(get(raw, "spec", "csi")) && (
        <Item label="Volume Handle">{str(get(raw, "spec", "csi", "volumeHandle"))}</Item>
      )}
      {isRecord(get(raw, "spec", "hostPath")) && (
        <Item label="Host Path">{str(get(raw, "spec", "hostPath", "path"))}</Item>
      )}
      {isRecord(get(raw, "spec", "local")) && <Item label="Local Path">{str(get(raw, "spec", "local", "path"))}</Item>}
      {isRecord(get(raw, "spec", "flexVolume")) && (
        <Item label="FlexVolume Driver">{str(get(raw, "spec", "flexVolume", "driver"))}</Item>
      )}
    </Section>
  );
}

function storageClassSection(raw: Record<string, unknown>): ReactNode {
  const expand = get(raw, "allowVolumeExpansion");
  const params = isRecord(raw.parameters) ? raw.parameters : undefined;
  return (
    <Section title="Storage Class">
      <Item label="Provisioner">{str(get(raw, "provisioner"))}</Item>
      <Item label="Reclaim Policy">{str(get(raw, "reclaimPolicy"))}</Item>
      <Item label="Volume Binding Mode">{str(get(raw, "volumeBindingMode"))}</Item>
      <Item label="Allow Volume Expansion">{expand === true ? "Yes" : expand === false ? "No" : undefined}</Item>
      <Item label="Mount Options">{tagList(asArray(get(raw, "mountOptions")))}</Item>
      {params && <Item label="Parameters">{mapTags(params)}</Item>}
    </Section>
  );
}

function serviceAccountSection(raw: Record<string, unknown>): ReactNode {
  const secrets = asArray(get(raw, "secrets"))
    .map(s => str(get(s, "name")))
    .filter(Boolean) as string[];
  const pull = asArray(get(raw, "imagePullSecrets"))
    .map(s => str(get(s, "name")))
    .filter(Boolean) as string[];
  return (
    <Section title="Service Account">
      <Item label="Secrets">{tagList(secrets)}</Item>
      <Item label="Image Pull Secrets">{tagList(pull)}</Item>
      <Item label="Automount Token">{get(raw, "automountServiceAccountToken") === false ? "No" : "Yes"}</Item>
    </Section>
  );
}

function endpointsSection(raw: Record<string, unknown>): ReactNode {
  const subsets = asArray(get(raw, "subsets"));
  if (subsets.length === 0) return null;
  return (
    <Section title="Endpoints">
      {subsets.map((sub, i) => {
        const addrs = asArray(get(sub, "addresses"))
          .map(a => str(get(a, "ip")))
          .filter(Boolean) as string[];
        const ports = asArray(get(sub, "ports")).map(p => `${str(get(p, "port"))}/${str(get(p, "protocol")) ?? "TCP"}`);
        return (
          <div key={i}>
            <Item label="Addresses">{tagList(addrs)}</Item>
            <Item label="Ports">{tagList(ports)}</Item>
          </div>
        );
      })}
    </Section>
  );
}

function networkPolicySection(raw: Record<string, unknown>): ReactNode {
  const types = asArray(get(raw, "spec", "policyTypes"));
  const sel = get(raw, "spec", "podSelector", "matchLabels");
  return (
    <Section title="Network Policy">
      <Item label="Policy Types">{tagList(types)}</Item>
      <Item label="Pod Selector">{isRecord(sel) && Object.keys(sel).length ? mapTags(sel) : "(all pods)"}</Item>
    </Section>
  );
}

function resourceQuotaSection(raw: Record<string, unknown>): ReactNode {
  const hard = isRecord(get(raw, "status", "hard"))
    ? (get(raw, "status", "hard") as Record<string, unknown>)
    : isRecord(get(raw, "spec", "hard"))
      ? (get(raw, "spec", "hard") as Record<string, unknown>)
      : undefined;
  const used = isRecord(get(raw, "status", "used"))
    ? (get(raw, "status", "used") as Record<string, unknown>)
    : undefined;
  if (!hard) return null;
  return (
    <Section title="Quotas">
      {Object.entries(hard).map(([k, v]) => (
        <Item label={k} key={k}>{`${str(used?.[k]) ?? "0"} / ${String(v)}`}</Item>
      ))}
    </Section>
  );
}

function limitRangeSection(raw: Record<string, unknown>): ReactNode {
  const limits = asArray(get(raw, "spec", "limits"));
  if (limits.length === 0) return null;
  return (
    <Section title="Limits">
      {limits.map((l, i) => {
        const parts: string[] = [];
        for (const k of ["default", "defaultRequest", "max", "min"]) {
          const m = get(l, k);
          if (isRecord(m))
            parts.push(
              `${k}: ${Object.entries(m)
                .map(([kk, vv]) => `${kk}=${vv}`)
                .join(", ")}`,
            );
        }
        return (
          <Item label={str(get(l, "type")) ?? `limit-${i}`} key={i}>
            {parts.join(" · ") || "—"}
          </Item>
        );
      })}
    </Section>
  );
}

function priorityClassSection(raw: Record<string, unknown>): ReactNode {
  return (
    <Section title="Priority Class">
      <Item label="Value">{str(get(raw, "value"))}</Item>
      <Item label="Global Default">{get(raw, "globalDefault") === true ? "Yes" : "No"}</Item>
      <Item label="Preemption Policy">{str(get(raw, "preemptionPolicy"))}</Item>
      <Item label="Description">{str(get(raw, "description"))}</Item>
    </Section>
  );
}

function runtimeClassSection(raw: Record<string, unknown>): ReactNode {
  return (
    <Section title="Runtime Class">
      <Item label="Handler">{str(get(raw, "handler"))}</Item>
    </Section>
  );
}

function leaseSection(raw: Record<string, unknown>): ReactNode {
  return (
    <Section title="Lease">
      <Item label="Holder Identity">{str(get(raw, "spec", "holderIdentity"))}</Item>
      <Item label="Lease Duration Seconds">{str(get(raw, "spec", "leaseDurationSeconds"))}</Item>
      <Item label="Lease Transitions">{str(get(raw, "spec", "leaseTransitions"))}</Item>
      <Item label="Acquire Time">{str(get(raw, "spec", "acquireTime"))}</Item>
      <Item label="Renew Time">{str(get(raw, "spec", "renewTime"))}</Item>
    </Section>
  );
}

function roleSection(raw: Record<string, unknown>): ReactNode {
  const rules = asArray(get(raw, "rules"));
  if (rules.length === 0) return null;
  return (
    <Section title="Rules">
      {rules.map((r, i) => {
        const groups = asArray(get(r, "apiGroups")).map(String);
        return (
          <div key={i}>
            <Item label="API Groups">{groups.length ? groups.map(g => g || "core").join(", ") : "core"}</Item>
            <Item label="Resources">{asArray(get(r, "resources")).map(String).join(", ") || "—"}</Item>
            <Item label="Verbs">{tagList(asArray(get(r, "verbs")))}</Item>
          </div>
        );
      })}
    </Section>
  );
}

function roleBindingSection(raw: Record<string, unknown>): ReactNode {
  const roleRef = get(raw, "roleRef");
  const subjects = asArray(get(raw, "subjects"));
  return (
    <Section title="Binding">
      {isRecord(roleRef) && (
        <Item label="Role Ref">{`${str(get(roleRef, "kind")) ?? ""}/${str(get(roleRef, "name")) ?? ""}`}</Item>
      )}
      {subjects.length > 0 && (
        <Item label="Subjects">
          <Tags>
            {subjects.map((s, i) => (
              <Tag minimal key={i}>{`${str(get(s, "kind")) ?? ""}/${str(get(s, "name")) ?? ""}`}</Tag>
            ))}
          </Tags>
        </Item>
      )}
    </Section>
  );
}

function eventSection(raw: Record<string, unknown>): ReactNode {
  const source = get(raw, "source");
  const io = get(raw, "involvedObject");
  const type = str(get(raw, "type"));
  return (
    <Section title="Event">
      <Item label="Type">
        {type && (
          <Tag minimal intent={/warn|error|fail/i.test(type) ? Intent.WARNING : Intent.NONE}>
            {type}
          </Tag>
        )}
      </Item>
      <Item label="Reason">{str(get(raw, "reason"))}</Item>
      <Item label="Message">{str(get(raw, "message"))}</Item>
      <Item label="Source">
        {isRecord(source)
          ? `${str(get(source, "component")) ?? ""}${str(get(source, "host")) ? ` @ ${str(get(source, "host"))}` : ""}`
          : undefined}
      </Item>
      <Item label="Count">{str(get(raw, "count"))}</Item>
      <Item label="First Seen">{str(get(raw, "firstTimestamp"))}</Item>
      <Item label="Last Seen">{str(get(raw, "lastTimestamp"))}</Item>
      <Item label="Object">
        {isRecord(io) ? `${str(get(io, "kind")) ?? ""}/${str(get(io, "name")) ?? ""}` : undefined}
      </Item>
    </Section>
  );
}

function crdSection(raw: Record<string, unknown>): ReactNode {
  const versions = asArray(get(raw, "spec", "versions"))
    .map(v => str(get(v, "name")))
    .filter(Boolean) as string[];
  const stored = asArray(get(raw, "status", "storedVersions"));
  return (
    <Section title="Custom Resource Definition">
      <Item label="Group">{str(get(raw, "spec", "group"))}</Item>
      <Item label="Scope">{str(get(raw, "spec", "scope"))}</Item>
      <Item label="Kind">{str(get(raw, "spec", "names", "kind"))}</Item>
      <Item label="Plural">{str(get(raw, "spec", "names", "plural"))}</Item>
      <Item label="Singular">{str(get(raw, "spec", "names", "singular"))}</Item>
      <Item label="Versions">{tagList(versions)}</Item>
      <Item label="Stored Versions">{tagList(stored)}</Item>
    </Section>
  );
}

function ingressClassSection(raw: Record<string, unknown>): ReactNode {
  return (
    <Section title="Ingress Class">
      <Item label="Controller">{str(get(raw, "spec", "controller"))}</Item>
    </Section>
  );
}

function webhookConfigSection(raw: Record<string, unknown>): ReactNode {
  const webhooks = asArray(get(raw, "webhooks"));
  if (webhooks.length === 0) return null;
  return (
    <Section title="Webhooks">
      {webhooks.map((w, i) => {
        const svc = get(w, "clientConfig", "service");
        return (
          <div key={i}>
            <Item label="Name">{str(get(w, "name"))}</Item>
            {isRecord(svc) && (
              <Item label="Service">{`${str(get(svc, "namespace")) ?? ""}/${str(get(svc, "name")) ?? ""}`}</Item>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Generic fallback — for kinds with no bespoke section (every CRD, and any
// built-in kind not yet covered).
// ---------------------------------------------------------------------------

/** The slice of JSON Schema a CRD gives us (`spec.versions[].schema.openAPIV3Schema`).
 *  Only the parts that change how a value is displayed. */
export interface JsonSchema {
  type?: string;
  format?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
}

/** Field order: schema-declared fields first, then anything the object carries
 *  that the schema doesn't declare — CRDs may set
 *  x-kubernetes-preserve-unknown-fields, and an undeclared field is still real.
 *
 *  Note this cannot recover the CRD author's ordering: the API server returns
 *  `properties` alphabetically (Go marshals maps with sorted keys), so the
 *  authored order is already gone by the time we see it. The grouping is the
 *  point — declared before undeclared — not the sequence within each group. */
function orderedKeys(value: Record<string, unknown>, schema?: JsonSchema): string[] {
  const declared = schema?.properties ? Object.keys(schema.properties) : [];
  const present = new Set(Object.keys(value));
  const ordered = declared.filter(k => present.has(k));
  for (const k of present) if (!ordered.includes(k)) ordered.push(k);
  return ordered;
}

/** A leaf rendered as text; objects and arrays are summarised rather than dumped.
 *  A schema, when present, decides the formatting: a date-time reads as an age,
 *  a boolean as Yes/No, a quantity keeps its unit. */
function leaf(value: unknown, prop?: JsonSchema): string | undefined {
  if (prop?.format === "date-time" && typeof value === "string") {
    const rel = metaAge(value);
    return rel ? `${value} (${rel} ago)` : value;
  }
  if (prop?.type === "boolean" && typeof value === "boolean") return value ? "Yes" : "No";
  if (value == null || value === "") return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return value.every(v => typeof v !== "object" || v === null)
      ? value.map(String).join(", ")
      : `${value.length} item${value.length > 1 ? "s" : ""}`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    return keys.length ? `{ ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }` : undefined;
  }
  return undefined;
}

/** "camelCaseKey" -> "Camel case key", so generated labels read like the
 *  hand-written ones rather than like field names. */
function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Renders an object's own `spec` and `status` as key/value rows.
 *
 * Used when `DETAIL_SECTIONS` has no entry for the kind — which is every custom
 * resource, since a CRD's kind is the cluster's to define and cannot be
 * hand-coded here. Without it a custom resource's Details tab showed only its
 * metadata, hiding the entire object.
 *
 * Deliberately shallow: nested objects and arrays are summarised, not expanded.
 * The YAML tab is the place to read a whole tree, and a recursive dump would
 * bury the handful of fields that matter.
 */
export function GenericSpecSections(raw: Record<string, unknown>, schema?: JsonSchema): ReactNode {
  const sections: { key: string; value: Record<string, unknown>; sub: JsonSchema | undefined }[] = [];
  for (const key of ["spec", "status"] as const) {
    const value = raw[key];
    if (isRecord(value)) sections.push({ key, value, sub: schema?.properties?.[key] });
  }
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map(({ key, value, sub }) => {
        const rows: { k: string; prop: JsonSchema | undefined; text: string }[] = [];
        for (const k of orderedKeys(value, sub)) {
          const prop = sub?.properties?.[k];
          const text = leaf(value[k], prop);
          if (text !== undefined) rows.push({ k, prop, text });
        }
        if (rows.length === 0) return null;
        return (
          <Section title={humanize(key)} key={key}>
            {rows.map(({ k, prop, text }) => (
              <Item label={<PropLabel name={k} prop={prop} />} key={k}>
                {text}
              </Item>
            ))}
          </Section>
        );
      })}
    </>
  );
}

/** A field label, carrying the schema's own `description` as its tooltip when the
 *  CRD supplies one — the field docs its author already wrote. */
function PropLabel({ name, prop }: { name: string; prop?: JsonSchema }) {
  const label = humanize(name);
  if (!prop?.description) return <>{label}</>;
  return (
    <Tooltip content={<span className={styles.propDoc}>{prop.description}</span>} compact placement="top-start">
      <span className={styles.documented}>{label}</span>
    </Tooltip>
  );
}

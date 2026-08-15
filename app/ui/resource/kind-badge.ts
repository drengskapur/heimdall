import type { IconName } from "@blueprintjs/icons";

/**
 * A picture, or failing that a short label, per Kubernetes kind.
 *
 * Argo CD gives every kind a small icon — `application-resource-tree` is
 * legible at a glance because each node is stamped with what it *is* before you
 * read its name. Its `resourceIcons` map points each kind at an SVG asset
 * (`Deployment` → `deploy.svg`, `ReplicaSet` → `rs.svg`), and its abbreviations
 * are the ones kubectl already uses, so `deploy`, `rs`, `sts`, `svc`, `cm`, `ing`
 * are all names a Kubernetes user reads without translating.
 *
 * The abbreviations are ported; the SVGs are not — they are Argo's artwork, and
 * a set of hand-drawn glyphs per kind is a maintenance liability here anyway,
 * where a new CRD should get a sensible badge without anyone drawing one. So the
 * badge is the abbreviation itself on the kind's colour.
 *
 * The fallback is the genuinely clever part of Argo's version and is copied
 * exactly: for an unknown kind, strip the lowercase letters and use what is
 * left. `CustomResourceDefinition` becomes `CRD`, `MyOperatorConfig` becomes
 * `MOC` — which is what a person would have abbreviated it to anyway.
 */

/**
 * The glyph for a kind.
 *
 * Argo draws a per-kind picture and that is what makes its tree readable without
 * reading — you see a Deployment before you parse the word. Its pictures are SVG
 * assets; ours are Blueprint icons, and specifically **the ones the sidebar
 * already uses for the same kinds**, so a Pod is the same cube in the nav, on
 * the graph and anywhere else it is drawn. Inventing a second set here would
 * have meant the app disagreeing with itself about what a Pod looks like.
 *
 * A kind with no entry falls through to the initials badge below, which is how a
 * CRD gets something sensible without anyone choosing a glyph for it.
 */
const GLYPH: Readonly<Record<string, IconName>> = {
  ClusterRole: "shield",
  ClusterRoleBinding: "link",
  ConfigMap: "properties",
  CronJob: "time",
  CustomResourceDefinition: "diagram-tree",
  DaemonSet: "layers",
  Deployment: "cubes",
  Endpoint: "link",
  EndpointSlice: "link",
  Endpoints: "link",
  HorizontalPodAutoscaler: "layers",
  Ingress: "log-in",
  IngressClass: "tag",
  Job: "play",
  Lease: "stopwatch",
  LimitRange: "heat-grid",
  Namespace: "projects",
  NetworkPolicy: "shield",
  Node: "server",
  PersistentVolume: "database",
  PersistentVolumeClaim: "floppy-disk",
  Pod: "cube",
  PodDisruptionBudget: "shield",
  PriorityClass: "numbered-list",
  ReplicaSet: "duplicate",
  ReplicationController: "duplicate",
  ResourceQuota: "filter-list",
  Role: "shield",
  RoleBinding: "link",
  RuntimeClass: "cog",
  Secret: "key",
  Service: "globe-network",
  ServiceAccount: "person",
  StatefulSet: "database",
  StorageClass: "tag",
};

/** The icon for a kind, or `undefined` when it has none and the initials
 *  fallback should be drawn instead. */
export function kindIcon(kind: string): IconName | undefined {
  return GLYPH[kind];
}

/** kubectl's own short names, which is where Argo's asset names come from. */
const SHORT: Readonly<Record<string, string>> = {
  ClusterRole: "crole",
  ClusterRoleBinding: "crb",
  ConfigMap: "cm",
  CronJob: "cronjob",
  CustomResourceDefinition: "crd",
  DaemonSet: "ds",
  Deployment: "deploy",
  Endpoint: "ep",
  EndpointSlice: "ep",
  Endpoints: "ep",
  HorizontalPodAutoscaler: "hpa",
  Ingress: "ing",
  Job: "job",
  LimitRange: "limits",
  Namespace: "ns",
  NetworkPolicy: "netpol",
  Node: "node",
  PersistentVolume: "pv",
  PersistentVolumeClaim: "pvc",
  Pod: "pod",
  PodDisruptionBudget: "pdb",
  ReplicaSet: "rs",
  ReplicationController: "rc",
  ResourceQuota: "quota",
  Role: "role",
  RoleBinding: "rb",
  Secret: "secret",
  Service: "svc",
  ServiceAccount: "sa",
  StatefulSet: "sts",
  StorageClass: "sc",
};

/**
 * The badge text for a kind.
 *
 * Known kinds get kubectl's short name; anything else gets Argo's initials rule.
 * A kind with no uppercase at all — which should not happen, but a CRD author
 * can write one — falls back to its first three characters rather than to an
 * empty badge.
 */
export function kindBadge(kind: string): string {
  const known = SHORT[kind];
  if (known) return known;
  const initials = kind.replace(/[^A-Z0-9]/g, "");
  if (initials.length > 0) return initials.slice(0, 4).toLowerCase();
  return kind.slice(0, 3).toLowerCase();
}

/**
 * Font size for a badge of a given length.
 *
 * Argo shrinks its initials past two characters for the same reason: `crb` and
 * `deploy` have to sit in the same box, and a fixed size either overflows the
 * long ones or wastes the short ones.
 */
export function badgeFontSize(text: string): number {
  if (text.length <= 3) return 10;
  if (text.length <= 5) return 8.5;
  return 7.5;
}

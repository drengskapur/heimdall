import type { KubeObject } from "../../application/ports/kubernetes-gateway";

/**
 * The object graph, as data.
 *
 * Kubernetes objects are already related to one another in a small number of
 * fixed ways — an `ownerReferences` entry, a label selector, a field naming
 * another object, an annotation. What differs between kinds is only *which*
 * mechanism applies and *what* to look in, which makes the relationships a
 * table rather than code. This replaces a `switch (kind)` in which each of seven
 * cases re-implemented listing, matching and row-building by hand — and in which
 * a Pod, the kind with the most relationships of all, had none at all.
 *
 * Deliberately not a general graph engine: every relation is one hop, or two via
 * `through`, which is all Kubernetes ownership actually needs (a Deployment
 * reaches its Pods only through its ReplicaSets).
 */

export interface RelQuery {
  apiVersion: string;
  kind: string;
  resource: string;
  namespace?: string;
}

/** The object whose relations are being resolved. */
export interface RelCtx {
  kind: string;
  name: string;
  namespace?: string;
  uid?: string;
  raw: Record<string, unknown>;
}

export interface Relation {
  /** Kinds this relation hangs off. */
  readonly from: readonly string[];
  /** Group heading in the panel. */
  readonly title: string;
  /** What to list; null skips the relation (e.g. a namespace we don't have). */
  readonly list: (ctx: RelCtx) => RelQuery | null;
  /** Which of the listed objects are related. `via` carries the uids matched by
   *  `through`, and is empty when a relation declares no first hop. */
  readonly where: (o: KubeObject, ctx: RelCtx, via: ReadonlySet<string>) => boolean;
  /** An optional first hop whose matched objects' uids are passed as `via`. */
  readonly through?: {
    readonly list: (ctx: RelCtx) => RelQuery | null;
    readonly where: (o: KubeObject, ctx: RelCtx) => boolean;
  };
  /** The listed objects *depend on* the context object — deleting it would
   *  break them. Only true where the breakage is a surprise: a controller's own
   *  Pods are garbage-collected by design and are not flagged, whereas the Pods
   *  mounting a ConfigMap have no idea it is about to vanish. */
  readonly dependents?: boolean;
  /** Deleting the context object deletes these too, via Kubernetes' own
   *  garbage collection of ownerReferences. Not a warning — a statement of what
   *  the delete actually covers, which is easy to misjudge for a Deployment
   *  whose Pods are two hops away. */
  readonly cascade?: boolean;
}

// --- readers -----------------------------------------------------------------

type Meta = {
  name?: string;
  namespace?: string;
  uid?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: { uid?: string; kind?: string; name?: string }[];
  creationTimestamp?: string;
};

export const metaOf = (o: KubeObject): Meta => o.raw.metadata ?? {};

function at(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Every key/value in `selector` present on `labels`. */
function labelsMatch(labels: Record<string, string> | undefined, selector: Record<string, string>): boolean {
  if (!labels) return false;
  return Object.entries(selector).every(([k, v]) => labels[k] === v);
}

// --- matchers ----------------------------------------------------------------

/** `o` carries an ownerReference to the context object. */
const ownedBy = (o: KubeObject, ctx: RelCtx): boolean =>
  !!ctx.uid && !!metaOf(o).ownerReferences?.some(r => r.uid === ctx.uid);

/** `o` carries an ownerReference to any object matched by the `through` hop. */
const ownedByVia = (o: KubeObject, _ctx: RelCtx, via: ReadonlySet<string>): boolean =>
  !!metaOf(o).ownerReferences?.some(r => r.uid && via.has(r.uid));

/** `o`'s labels satisfy the context object's `spec.selector.matchLabels`. */
const selectedBy = (o: KubeObject, ctx: RelCtx): boolean => {
  const selector = at(ctx.raw, "spec", "selector", "matchLabels") as Record<string, string> | undefined;
  return !!selector && Object.keys(selector).length > 0 && labelsMatch(metaOf(o).labels, selector);
};

/** Names referenced from a Pod spec's volumes, for a given volume field. */
function podVolumeNames(pod: KubeObject, field: string, nameKey: string): string[] {
  const volumes = (at(pod.raw, "spec", "volumes") as unknown[] | undefined) ?? [];
  return volumes.map(v => at(v, field, nameKey)).filter((n): n is string => typeof n === "string");
}

/** Names a Pod spec references via env/envFrom for ConfigMaps or Secrets. */
function podEnvNames(
  pod: KubeObject,
  refKey: "configMapRef" | "secretRef",
  keyRefKey: "configMapKeyRef" | "secretKeyRef",
): string[] {
  const containers = [
    ...((at(pod.raw, "spec", "containers") as unknown[] | undefined) ?? []),
    ...((at(pod.raw, "spec", "initContainers") as unknown[] | undefined) ?? []),
  ];
  const names: string[] = [];
  for (const c of containers) {
    for (const ef of (at(c, "envFrom") as unknown[] | undefined) ?? []) {
      const n = at(ef, refKey, "name");
      if (typeof n === "string") names.push(n);
    }
    for (const e of (at(c, "env") as unknown[] | undefined) ?? []) {
      const n = at(e, "valueFrom", keyRefKey, "name");
      if (typeof n === "string") names.push(n);
    }
  }
  return names;
}

// --- queries -----------------------------------------------------------------

const podsIn = (ns?: string): RelQuery => ({ apiVersion: "v1", kind: "Pod", resource: "pods", namespace: ns });
const inNs = (ctx: RelCtx, q: (ns: string) => RelQuery): RelQuery | null => (ctx.namespace ? q(ctx.namespace) : null);

// --- the table ---------------------------------------------------------------

const WORKLOAD_KINDS = ["StatefulSet", "DaemonSet", "ReplicaSet", "Job", "ReplicationController"] as const;

export const RELATIONS: readonly Relation[] = [
  // A Deployment owns ReplicaSets, which own the Pods — the only two-hop case.
  {
    from: ["Deployment"],
    title: "Replica Sets",
    cascade: true,
    list: ctx =>
      inNs(ctx, ns => ({ apiVersion: "apps/v1", kind: "ReplicaSet", resource: "replicasets", namespace: ns })),
    where: ownedBy,
  },
  {
    from: ["Deployment"],
    title: "Pods",
    cascade: true,
    through: {
      list: ctx =>
        inNs(ctx, ns => ({ apiVersion: "apps/v1", kind: "ReplicaSet", resource: "replicasets", namespace: ns })),
      where: ownedBy,
    },
    list: ctx => inNs(ctx, ns => podsIn(ns)),
    where: ownedByVia,
  },

  // Controllers own their Pods directly; a selector is the fallback for objects
  // whose children lost their ownerReferences (adopted or hand-made pods).
  {
    from: WORKLOAD_KINDS,
    title: "Pods",
    cascade: true,
    list: ctx => inNs(ctx, ns => podsIn(ns)),
    where: (o, ctx) => ownedBy(o, ctx) || selectedBy(o, ctx),
  },

  // A Node is cluster-scoped, so its Pods come from every namespace.
  {
    from: ["Node"],
    title: "Pods",
    list: () => podsIn(),
    where: (o, ctx) => at(o.raw, "spec", "nodeName") === ctx.name,
  },

  // Services select their Pods by label (spec.selector is a flat map here, not
  // the matchLabels form controllers use).
  {
    from: ["Service"],
    title: "Pods",
    list: ctx => inNs(ctx, ns => podsIn(ns)),
    where: (o, ctx) => {
      const selector = at(ctx.raw, "spec", "selector") as Record<string, string> | undefined;
      return !!selector && Object.keys(selector).length > 0 && labelsMatch(metaOf(o).labels, selector);
    },
  },

  // A PVC is bound to one PV, and mounted by any number of Pods.
  {
    from: ["PersistentVolumeClaim"],
    title: "Mounted By",
    dependents: true,
    list: ctx => inNs(ctx, ns => podsIn(ns)),
    where: (o, ctx) => podVolumeNames(o, "persistentVolumeClaim", "claimName").includes(ctx.name),
  },
  {
    from: ["PersistentVolumeClaim"],
    title: "Volume",
    list: () => ({ apiVersion: "v1", kind: "PersistentVolume", resource: "persistentvolumes" }),
    where: (o, ctx) => metaOf(o).name === at(ctx.raw, "spec", "volumeName"),
  },

  // A ServiceAccount's tokens are Secrets annotated with its name.
  {
    from: ["ServiceAccount"],
    title: "Tokens",
    list: ctx => inNs(ctx, ns => ({ apiVersion: "v1", kind: "Secret", resource: "secrets", namespace: ns })),
    where: (o, ctx) =>
      metaOf(o).annotations?.["kubernetes.io/service-account.name"] === ctx.name &&
      o.raw.type === "kubernetes.io/service-account-token",
  },

  // An Ingress routes to Services named in its rules (and its default backend).
  {
    from: ["Ingress"],
    title: "Services",
    list: ctx => inNs(ctx, ns => ({ apiVersion: "v1", kind: "Service", resource: "services", namespace: ns })),
    where: (o, ctx) => ingressServiceNames(ctx.raw).includes(metaOf(o).name ?? ""),
  },

  // --- Pod relations. A Pod has more of these than any other kind, and had
  // none before this table existed.
  {
    from: ["Pod"],
    title: "Node",
    list: () => ({ apiVersion: "v1", kind: "Node", resource: "nodes" }),
    where: (o, ctx) => metaOf(o).name === at(ctx.raw, "spec", "nodeName"),
  },
  {
    from: ["Pod"],
    title: "Config Maps",
    list: ctx => inNs(ctx, ns => ({ apiVersion: "v1", kind: "ConfigMap", resource: "configmaps", namespace: ns })),
    where: (o, ctx) => {
      const name = metaOf(o).name ?? "";
      const pod = { raw: ctx.raw } as KubeObject;
      return (
        podVolumeNames(pod, "configMap", "name").includes(name) ||
        podEnvNames(pod, "configMapRef", "configMapKeyRef").includes(name)
      );
    },
  },
  {
    from: ["Pod"],
    title: "Secrets",
    list: ctx => inNs(ctx, ns => ({ apiVersion: "v1", kind: "Secret", resource: "secrets", namespace: ns })),
    where: (o, ctx) => {
      const name = metaOf(o).name ?? "";
      const pod = { raw: ctx.raw } as KubeObject;
      return (
        podVolumeNames(pod, "secret", "secretName").includes(name) ||
        podEnvNames(pod, "secretRef", "secretKeyRef").includes(name)
      );
    },
  },
  {
    from: ["Pod"],
    title: "Volume Claims",
    list: ctx =>
      inNs(ctx, ns => ({
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        resource: "persistentvolumeclaims",
        namespace: ns,
      })),
    where: (o, ctx) => {
      const pod = { raw: ctx.raw } as KubeObject;
      return podVolumeNames(pod, "persistentVolumeClaim", "claimName").includes(metaOf(o).name ?? "");
    },
  },

  // ConfigMaps and Secrets, from the other direction: who consumes me?
  {
    from: ["ConfigMap"],
    title: "Used By",
    dependents: true,
    list: ctx => inNs(ctx, ns => podsIn(ns)),
    where: (o, ctx) =>
      podVolumeNames(o, "configMap", "name").includes(ctx.name) ||
      podEnvNames(o, "configMapRef", "configMapKeyRef").includes(ctx.name),
  },
  {
    from: ["Secret"],
    title: "Used By",
    dependents: true,
    list: ctx => inNs(ctx, ns => podsIn(ns)),
    where: (o, ctx) =>
      podVolumeNames(o, "secret", "secretName").includes(ctx.name) ||
      podEnvNames(o, "secretRef", "secretKeyRef").includes(ctx.name),
  },

  // --- Jobs and schedules ---
  {
    from: ["CronJob"],
    title: "Jobs",
    cascade: true,
    list: ctx => inNs(ctx, ns => ({ apiVersion: "batch/v1", kind: "Job", resource: "jobs", namespace: ns })),
    where: ownedBy,
  },
  {
    from: ["Job"],
    title: "Cron Job",
    list: ctx => inNs(ctx, ns => ({ apiVersion: "batch/v1", kind: "CronJob", resource: "cronjobs", namespace: ns })),
    where: (o, ctx) => {
      const owners = (ctx.raw.metadata as Meta | undefined)?.ownerReferences ?? [];
      return owners.some(r => r.uid === metaOf(o).uid);
    },
  },

  // --- Autoscaling, from both ends ---
  {
    from: ["HorizontalPodAutoscaler"],
    title: "Scale Target",
    list: ctx => refQuery(at(ctx.raw, "spec", "scaleTargetRef", "kind"), ctx.namespace),
    where: (o, ctx) => metaOf(o).name === at(ctx.raw, "spec", "scaleTargetRef", "name"),
  },
  {
    from: ["Deployment", "StatefulSet", "ReplicaSet", "ReplicationController"],
    title: "Autoscalers",
    list: ctx =>
      inNs(ctx, ns => ({
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        resource: "horizontalpodautoscalers",
        namespace: ns,
      })),
    where: (o, ctx) =>
      at(o.raw, "spec", "scaleTargetRef", "kind") === ctx.kind &&
      at(o.raw, "spec", "scaleTargetRef", "name") === ctx.name,
  },

  // --- A NetworkPolicy selects via its own podSelector, not spec.selector ---
  {
    from: ["NetworkPolicy"],
    title: "Pods",
    list: ctx => inNs(ctx, ns => podsIn(ns)),
    where: (o, ctx) => {
      const selector = at(ctx.raw, "spec", "podSelector", "matchLabels") as Record<string, string> | undefined;
      if (!selector) return false;
      // An empty podSelector is legal and means every pod in the namespace.
      return Object.keys(selector).length === 0 || labelsMatch(metaOf(o).labels, selector);
    },
  },

  // --- Identity ---
  {
    from: ["Pod"],
    title: "Service Account",
    list: ctx =>
      inNs(ctx, ns => ({ apiVersion: "v1", kind: "ServiceAccount", resource: "serviceaccounts", namespace: ns })),
    where: (o, ctx) =>
      metaOf(o).name === (at(ctx.raw, "spec", "serviceAccountName") ?? at(ctx.raw, "spec", "serviceAccount")),
  },
  {
    from: ["ServiceAccount"],
    title: "Pods",
    dependents: true,
    list: ctx => inNs(ctx, ns => podsIn(ns)),
    where: (o, ctx) => (at(o.raw, "spec", "serviceAccountName") ?? at(o.raw, "spec", "serviceAccount")) === ctx.name,
  },

  // --- RBAC: a binding names one role and a list of subjects ---
  {
    from: ["RoleBinding", "ClusterRoleBinding"],
    title: "Role",
    list: ctx => refQuery(at(ctx.raw, "roleRef", "kind"), ctx.namespace),
    where: (o, ctx) => metaOf(o).name === at(ctx.raw, "roleRef", "name"),
  },
  {
    from: ["RoleBinding", "ClusterRoleBinding"],
    title: "Service Accounts",
    // Cluster-wide, not the binding's namespace: an RBAC subject carries its own
    // namespace and routinely differs from the binding's (kube-public's
    // bootstrap-signer binding grants to a kube-system account), and a
    // ClusterRoleBinding has no namespace of its own at all.
    list: () => ({ apiVersion: "v1", kind: "ServiceAccount", resource: "serviceaccounts" }),
    where: (o, ctx) => {
      const subjects = (at(ctx.raw, "subjects") as unknown[] | undefined) ?? [];
      const m = metaOf(o);
      return subjects.some(
        su =>
          at(su, "kind") === "ServiceAccount" &&
          at(su, "name") === m.name &&
          (at(su, "namespace") ?? ctx.namespace) === m.namespace,
      );
    },
  },

  // --- Storage, from both ends ---
  {
    from: ["StorageClass"],
    title: "Volume Claims",
    dependents: true,
    list: () => ({ apiVersion: "v1", kind: "PersistentVolumeClaim", resource: "persistentvolumeclaims" }),
    where: (o, ctx) => at(o.raw, "spec", "storageClassName") === ctx.name,
  },
  {
    from: ["PersistentVolume"],
    title: "Claim",
    list: () => ({ apiVersion: "v1", kind: "PersistentVolumeClaim", resource: "persistentvolumeclaims" }),
    where: (o, ctx) => {
      const claim = at(ctx.raw, "spec", "claimRef") as { name?: string; namespace?: string } | undefined;
      const m = metaOf(o);
      return !!claim && m.name === claim.name && m.namespace === claim.namespace;
    },
  },
];

/** Plural resource names for the kinds a `*Ref` field can point at. Kubernetes
 *  refs carry a kind, but listing needs the plural, and there is no rule that
 *  derives one from the other. */
const RESOURCE_OF: Record<string, { apiVersion: string; resource: string }> = {
  Deployment: { apiVersion: "apps/v1", resource: "deployments" },
  StatefulSet: { apiVersion: "apps/v1", resource: "statefulsets" },
  ReplicaSet: { apiVersion: "apps/v1", resource: "replicasets" },
  DaemonSet: { apiVersion: "apps/v1", resource: "daemonsets" },
  ReplicationController: { apiVersion: "v1", resource: "replicationcontrollers" },
  Role: { apiVersion: "rbac.authorization.k8s.io/v1", resource: "roles" },
  ClusterRole: { apiVersion: "rbac.authorization.k8s.io/v1", resource: "clusterroles" },
};

/** Query for the object a `{ kind, name }` reference points at, if we know how
 *  to list that kind. */
function refQuery(kind: unknown, namespace?: string): RelQuery | null {
  if (typeof kind !== "string") return null;
  const known = RESOURCE_OF[kind];
  return known ? { apiVersion: known.apiVersion, kind, resource: known.resource, namespace } : null;
}

/** Service names an Ingress routes to, across its rules and default backend. */
function ingressServiceNames(raw: Record<string, unknown>): string[] {
  const names: string[] = [];
  const def = at(raw, "spec", "defaultBackend", "service", "name");
  if (typeof def === "string") names.push(def);
  for (const rule of (at(raw, "spec", "rules") as unknown[] | undefined) ?? []) {
    for (const path of (at(rule, "http", "paths") as unknown[] | undefined) ?? []) {
      const n = at(path, "backend", "service", "name");
      if (typeof n === "string") names.push(n);
    }
  }
  return names;
}

/** The relations that apply to a kind. */
export function relationsFor(kind: string): readonly Relation[] {
  return RELATIONS.filter(r => r.from.includes(kind));
}

/**
 * Resolve the relations declared for an object's kind.
 *
 * Takes its own `list` rather than reaching for the active cluster, so the same
 * resolution serves the drawer's panel and the pre-delete impact check without
 * either owning the transport. Relations run concurrently and each failure is
 * contained: a kind the cluster does not serve, or one RBAC forbids listing,
 * drops that relation rather than the whole result.
 */
export async function resolveRelations(
  raw: Record<string, unknown>,
  list: (query: RelQuery) => Promise<KubeObject[]>,
  filter?: (relation: Relation) => boolean,
): Promise<{ relation: Relation; query: RelQuery; objects: KubeObject[] }[]> {
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const m = (raw.metadata ?? {}) as Meta;
  const ctx: RelCtx = { kind, name: m.name ?? "", namespace: m.namespace, uid: m.uid, raw };
  const applicable = relationsFor(kind).filter(r => !filter || filter(r));

  const settled = await Promise.all(
    applicable.map(async relation => {
      const query = relation.list(ctx);
      if (!query) return null;

      let via: ReadonlySet<string> = EMPTY_UIDS;
      if (relation.through) {
        const hop = relation.through.list(ctx);
        if (!hop) return null;
        const hops = await list(hop);
        via = new Set(
          hops
            .filter(o => relation.through!.where(o, ctx))
            .map(o => metaOf(o).uid)
            .filter((uid): uid is string => !!uid),
        );
        if (via.size === 0) return null;
      }

      const objects = (await list(query)).filter(o => relation.where(o, ctx, via));
      return objects.length ? { relation, query, objects } : null;
    }),
  );
  return settled.filter((r): r is { relation: Relation; query: RelQuery; objects: KubeObject[] } => r !== null);
}

const EMPTY_UIDS: ReadonlySet<string> = new Set();

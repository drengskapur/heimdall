import type { IconName } from "@blueprintjs/icons";
import { APPS } from "./apps";

/** A leaf page within a group (or a standalone top-level page). */
export interface NavLeaf {
  readonly id: string;
  readonly label: string;
  /** Every entry carries a glyph — the rail is a column of
   *  bare labels under an iconed header does not read as the same list. */
  readonly icon: IconName;
}

/**
 * A top-level navigation node. With `children` it is an expandable **group**
 * (Workloads, Config, …); without, it is a single **item** (Cluster, Nodes, …).
 * Order mirrors the real Lens sidebar registration order.
 */
export interface NavNode {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly children?: readonly NavLeaf[];
}

const leaf = (label: string, icon: IconName): NavLeaf => ({
  id: label.toLowerCase().replace(/\s+/g, "-"),
  label,
  icon,
});

export const NAV_TREE: readonly NavNode[] = [
  // Ungrouped pages first, as one block, then every section. Interleaving them
  // was survivable while a group looked like an item, but now that sections
  // carry headers an un-headed row trailing a section's entries reads as part of
  // it — Namespaces and Events appeared to belong to Storage. The shape the
  // spec calls for: a block of plain entries, then headed sections.
  { id: "cluster", label: "Cluster", icon: "dashboard" },
  { id: "nodes", label: "Nodes", icon: "server" },
  { id: "namespaces", label: "Namespaces", icon: "projects" },
  { id: "events", label: "Events", icon: "timeline-events" },
  {
    id: "workloads",
    label: "Workloads",
    icon: "cubes",
    children: [
      leaf("Overview", "dashboard"),
      leaf("Pods", "cube"),
      leaf("Deployments", "cubes"),
      leaf("Daemon Sets", "layers"),
      leaf("Stateful Sets", "database"),
      leaf("Replica Sets", "duplicate"),
      leaf("Replication Controllers", "duplicate"),
      leaf("Jobs", "play"),
      leaf("Cron Jobs", "time"),
    ],
  },
  {
    id: "config",
    label: "Config",
    icon: "properties",
    children: [
      leaf("Config Maps", "properties"),
      leaf("Secrets", "key"),
      leaf("Resource Quotas", "filter-list"),
      leaf("Limit Ranges", "heat-grid"),
      leaf("Horizontal Pod Autoscalers", "layers"),
      leaf("Pod Disruption Budgets", "shield"),
      leaf("Priority Classes", "numbered-list"),
      leaf("Runtime Classes", "cog"),
      leaf("Leases", "stopwatch"),
      leaf("Mutating Webhook Configs", "random"),
      leaf("Validating Webhook Configs", "confirm"),
    ],
  },
  {
    id: "network",
    label: "Network",
    icon: "globe-network",
    children: [
      leaf("Services", "globe-network"),
      leaf("Endpoints", "link"),
      leaf("Ingresses", "log-in"),
      leaf("Ingress Classes", "tag"),
      leaf("Network Policies", "shield"),
      leaf("Port Forwarding", "exchange"),
    ],
  },
  {
    id: "storage",
    label: "Storage",
    icon: "database",
    children: [
      leaf("Persistent Volume Claims", "floppy-disk"),
      leaf("Persistent Volumes", "database"),
      leaf("Storage Classes", "tag"),
    ],
  },
  {
    id: "helm",
    label: "Helm",
    icon: "package",
    children: [leaf("Charts", "package"), leaf("Releases", "cloud-download")],
  },
  {
    id: "access-control",
    label: "Access Control",
    icon: "shield",
    children: [
      leaf("Service Accounts", "person"),
      leaf("Cluster Roles", "shield"),
      leaf("Roles", "shield"),
      leaf("Cluster Role Bindings", "link"),
      leaf("Role Bindings", "link"),
    ],
  },
  {
    id: "custom-resources",
    label: "Custom Resources",
    icon: "diagram-tree",
    children: [leaf("Definitions", "diagram-tree")],
  },
];

/** The group (top-level node with children) that a leaf id belongs to, if any.
 *  Freelens renders a group's members as tabs across the top of the content. */
export function groupOf(id: string): NavNode | undefined {
  return NAV_TREE.find(node => node.children?.some(child => child.id === id));
}

/** Resolve a nav id to its glyph — a leaf's own, or a node's. */
export function findIcon(id: string): IconName {
  for (const node of NAV_TREE) {
    if (node.id === id) return node.icon;
    const child = node.children?.find(c => c.id === id);
    if (child) return child.icon;
  }
  return "document";
}

/** Resolve a nav id (leaf or node) to its human label. */
export function findLabel(id: string): string {
  for (const node of NAV_TREE) {
    if (node.id === id) return node.label;
    const child = node.children?.find(c => c.id === id);
    if (child) return child.label;
  }
  // A standalone app's page is not in this tree — the tree is the Clusters app's
  // own nav — so its name comes from the registry. Without this the breadcrumb
  // and the document title fell through to the raw route id and read "topology"
  // in lower case.
  const app = APPS.find(a => a.page === id);
  if (app) return app.name;
  return id;
}

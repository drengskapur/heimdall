// API-discovery gating: which resource kinds the *active* cluster serves. On
// connect we discover the cluster's served resources and hide sidebar leaves
// whose kind the cluster doesn't expose (a cluster without the metrics or policy
// APIs, say), so the tree reflects the real cluster — Lens's capability-gating,
// minus the Electron.
//
// This module is intentionally pure (no registry / React imports) so the
// matching logic is unit-testable; the sidebar does the descriptor lookup.

import type { ResourceRule } from "../application/ports/kubernetes-gateway";
import type { ActiveCluster } from "../infrastructure/composition-root";

export type { ResourceRule };

/** The group portion of an apiVersion ("apps/v1" → "apps", "v1" → ""). */
export function groupOf(apiVersion: string): string {
  return apiVersion.includes("/") ? apiVersion.split("/")[0] : "";
}

/**
 * Discover the resources the cluster serves, as a set of `${group}/${resource}`
 * keys. Group-level (version-agnostic) so a kind served under a different
 * version than our descriptor declares (HPA autoscaling/v1 vs v2) still matches.
 */
export async function discoverServed(cluster: ActiveCluster): Promise<Set<string>> {
  const served = await cluster.gateway.discoverResources();
  return new Set(served.map(r => `${groupOf(r.apiVersion)}/${r.resource}`));
}

/**
 * Does the served set expose this (apiVersion, resource)? A null set (not yet
 * discovered, or discovery failed) returns true — never hide on uncertainty.
 */
export function servedHas(served: Set<string> | null, apiVersion: string, resource: string): boolean {
  if (!served) return true;
  return served.has(`${groupOf(apiVersion)}/${resource}`);
}

/**
 * May the user *list* this resource, per the SelfSubjectRulesReview rules?
 * Conservative by design: null rules (not checked / review incomplete / errored)
 * → permissive `true`; `*` wildcards match anything. This only ever *subtracts*
 * from the served set, and only when we're confident — matching Lens's
 * "API rejection is permissive" stance so RBAC never wrongly hides a page.
 */
export function canList(rules: readonly ResourceRule[] | null, apiVersion: string, resource: string): boolean {
  if (!rules) return true;
  const group = groupOf(apiVersion);
  return rules.some(rule => {
    const verbOk = rule.verbs.some(v => v === "*" || v === "list");
    const groupOk = (rule.apiGroups ?? []).some(g => g === "*" || g === group);
    const resourceOk = (rule.resources ?? []).some(r => r === "*" || r === resource);
    return verbOk && groupOk && resourceOk;
  });
}

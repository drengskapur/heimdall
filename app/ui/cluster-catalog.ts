// Discover real clusters from the local kubeconfig via the companion, and map
// them to Hotbar tiles. This replaces the previous hardcoded fake cluster list:
// the companion's /v1/kubeconfigs/scan reads ~/.kube (and $KUBECONFIG), we parse
// each context into a ClusterProfile the transport already understands.
import { parse } from "yaml";
import type { ClusterProfile } from "../lib/kube-generated";
import type { Cluster } from "./clusters";

// --- kubeconfig YAML shape (only the fields we consume) --------------------
interface RawKubeconfig {
  clusters?: Array<{ name?: string; cluster?: Record<string, unknown> }>;
  users?: Array<{ name?: string; user?: Record<string, unknown> }>;
  contexts?: Array<{ name?: string; context?: { cluster?: string; user?: string; namespace?: string } }>;
  "current-context"?: string;
}

const s = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Parse one kubeconfig document into a ClusterProfile per context. */
export function parseKubeconfig(content: string, sourcePath = ""): ClusterProfile[] {
  let doc: RawKubeconfig;
  try {
    doc = parse(content) as RawKubeconfig;
  } catch {
    return [];
  }
  if (!doc || !Array.isArray(doc.contexts)) return [];
  const clusters = new Map((doc.clusters ?? []).map(c => [c.name ?? "", c.cluster ?? {}]));
  const users = new Map((doc.users ?? []).map(u => [u.name ?? "", u.user ?? {}]));
  const profiles: ClusterProfile[] = [];
  for (const ctx of doc.contexts) {
    const name = s(ctx.name);
    const ref = ctx.context ?? {};
    const cluster = clusters.get(ref.cluster ?? "");
    const user = users.get(ref.user ?? "") ?? {};
    const server = cluster && s(cluster.server);
    if (!name || !server) continue;

    // Resolve credentials. Inline data works in the browser; file-path creds
    // (client-certificate / certificate-authority) cannot be read here, so we
    // surface them as unsupported rather than silently failing on connect.
    const clientCertificateData = s(user["client-certificate-data"]);
    const clientKeyData = s(user["client-key-data"]);
    const token = s(user.token);
    const exec = user.exec as
      | { command?: string; args?: string[]; env?: Array<{ name: string; value: string }>; apiVersion?: string }
      | undefined;
    const hasFileCreds = Boolean(user["client-certificate"] || user["client-key"]);

    let authStatus: ClusterProfile["authStatus"] = "ready";
    let authMessage: string | undefined;
    if (clientCertificateData && clientKeyData) {
      // ready via companion mTLS
    } else if (token) {
      // ready via bearer
    } else if (exec?.command) {
      // ready via exec-credential plugin (companion runs it)
    } else if (hasFileCreds) {
      authStatus = "unsupported";
      authMessage =
        "This context uses file-based certificates; connect it from a terminal or paste inline credentials.";
    } else {
      authStatus = "unsupported";
      authMessage = "No usable credentials found for this context.";
    }

    profiles.push({
      id: name,
      name,
      server,
      token: token ?? "",
      context: name,
      cluster: s(ref.cluster),
      user: s(ref.user),
      namespace: s(ref.namespace) ?? "default",
      certificateAuthorityData: s(cluster?.["certificate-authority-data"]),
      insecureSkipTlsVerify: Boolean(cluster?.["insecure-skip-tls-verify"]),
      proxyUrl: s(cluster?.["proxy-url"]),
      ...(clientCertificateData && clientKeyData ? { clientCertificateData, clientKeyData } : {}),
      ...(exec?.command
        ? { execCredential: { command: exec.command, args: exec.args, env: exec.env, apiVersion: exec.apiVersion } }
        : {}),
      authStatus,
      authMessage,
      sourcePath,
      syncManaged: true,
    });
  }
  return profiles;
}

/** Scan the local kubeconfig(s) via the companion → deduped ClusterProfiles. */
export async function discoverClusters(): Promise<ClusterProfile[]> {
  // Lazy-load the companion transport (kept out of the initial bundle, matching
  // how lib/kubernetes dynamically imports it).
  const { scanKubeconfigs } = await import("../lib/local-shell");
  const scan = await scanKubeconfigs();
  const byId = new Map<string, ClusterProfile>();
  for (const item of scan.items) {
    for (const profile of parseKubeconfig(item.content, item.path)) {
      // First writer wins, but a "ready" profile supersedes an "unsupported" dup.
      const prev = byId.get(profile.id);
      if (!prev || (prev.authStatus !== "ready" && profile.authStatus === "ready")) byId.set(profile.id, profile);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// --- Hotbar tile mapping ---------------------------------------------------
const TILE_COLORS = ["#29a634", "#2d72d2", "#d1980b", "#c22762", "#9179f2", "#00a396", "#db2c6f", "#7961db"];

/** Deterministic 2–3 char initials from a cluster name. */
/**
 * 2–3 character tile initials.
 *
 * A trailing digit wins the last slot, because environments are routinely named
 * by number — `dev-us-east1` and `dev-us-east2` both reduced to "DUE" on first
 * letters alone, leaving two clusters indistinguishable on a rail where the
 * tiles are deliberately monochrome and the letters carry the identity.
 */
function initials(name: string): string {
  const parts = name.split(/[-_.\s]+/).filter(Boolean);
  const trailingDigit = /(\d)\D*$/.exec(name)?.[1];
  if (parts.length >= 2) {
    const head = parts[0][0] + parts[1][0];
    return (head + (trailingDigit ?? parts[2]?.[0] ?? "")).slice(0, 3).toUpperCase();
  }
  return (
    name
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 3)
      .toUpperCase() || "K8S"
  );
}

/** Deterministic tile color from the cluster id. */
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TILE_COLORS[hash % TILE_COLORS.length];
}

export function profileToCluster(profile: ClusterProfile, connected = false): Cluster {
  return { id: profile.id, name: profile.name, short: initials(profile.name), color: colorFor(profile.id), connected };
}

// Derive a Heimdall PWA cluster profile + localStorage state from a kubeconfig,
// so E2E tests can point the PWA at a real cluster (k3d) through the companion.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export function profileFromKubeconfig(kubeconfigPath, { contextName } = {}) {
  const config = parseYaml(readFileSync(kubeconfigPath, "utf8"));
  const currentContext = contextName || config["current-context"];
  const context = (config.contexts || []).find(c => c.name === currentContext)?.context;
  if (!context) throw new Error(`context ${currentContext} not found in ${kubeconfigPath}`);
  const cluster = (config.clusters || []).find(c => c.name === context.cluster)?.cluster;
  const user = (config.users || []).find(u => u.name === context.user)?.user;
  if (!cluster) throw new Error(`cluster ${context.cluster} not found`);
  const server = String(cluster.server).replace(/\/$/, "");
  const id = createHash("sha256").update(`${currentContext}:${server}`).digest("hex").slice(0, 32);
  return {
    id,
    name: currentContext,
    server,
    token: user?.token || "",
    authorization: user?.token ? `Bearer ${user.token}` : undefined,
    certificateAuthorityData: cluster["certificate-authority-data"],
    clientCertificateData: user?.["client-certificate-data"],
    clientKeyData: user?.["client-key-data"],
    namespace: context.namespace || "",
    context: currentContext,
    cluster: context.cluster,
    user: context.user || "",
    insecureSkipTlsVerify: Boolean(cluster["insecure-skip-tls-verify"]),
    authStatus: "ready",
  };
}

// A storageState builder lived here and was never called by anything. It also
// put the cluster profiles in localStorage, where the app has never read them —
// app/lib/kubernetes.ts keeps profiles in sessionStorage — so any test that had
// adopted it would have come up unconnected. The specs seed storage themselves
// in an init script, which is the form that works.

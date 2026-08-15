// Helm operations that run *inside* the cluster.
//
// A browser cannot execute helm, and shipping cluster credentials to a hosted
// backend to do it would defeat the point of this app. So an operation is a
// short-lived Job: a Secret carries a scoped kubeconfig, an `alpine/helm` pod
// runs the command, its log becomes the result, and both objects are deleted in
// a `finally` whatever happened.
//
// This module also held an unreachable second implementation of chart discovery
// — `HelmChartManager`, `discoverHelmCharts`, localStorage-backed repository
// lists — duplicating what `app/ui/helm/helm-charts.ts` actually does. Nothing
// imported any of it.

import { type ClusterProfile, kubeFetch, resolveClusterCredential } from "./kubernetes";

export type HelmOperation =
  | {
      kind: "install" | "upgrade";
      release: string;
      namespace: string;
      chart: string;
      version?: string;
      values?: string;
    }
  | { kind: "rollback"; release: string; namespace: string; revision: number }
  | { kind: "uninstall"; release: string; namespace: string };

async function kube<T>(profile: ClusterProfile, path: string, method = "GET", body?: unknown, raw = false): Promise<T> {
  const response = await kubeFetch(profile, path, { method, body, raw });
  if (!response.ok) throw new Error((await response.text()) || `Kubernetes request failed: ${response.status}`);
  return (raw ? await response.text() : await response.json()) as T;
}
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function runHelmOperation(
  profile: ClusterProfile,
  operation: HelmOperation,
  onStatus?: (message: string) => void,
): Promise<string> {
  const namespace = operation.namespace || "default",
    id = `heimdall-helm-${crypto.randomUUID().slice(0, 8)}`,
    secretPath = `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`,
    jobPath = `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs`;
  const credential = await resolveClusterCredential(profile);
  const userAuth =
    credential.clientCertificateData && credential.clientKeyData
      ? `    client-certificate-data: ${credential.clientCertificateData}\n    client-key-data: ${credential.clientKeyData}\n`
      : `    token: ${JSON.stringify((credential.authorization || `Bearer ${profile.token || ""}`).replace(/^Bearer\s+/i, ""))}\n`;
  const kubeconfig = `apiVersion: v1\nkind: Config\nclusters:\n- name: cluster\n  cluster:\n    server: https://kubernetes.default.svc\n    insecure-skip-tls-verify: true\nusers:\n- name: user\n  user:\n${userAuth}contexts:\n- name: context\n  context:\n    cluster: cluster\n    user: user\n    namespace: ${JSON.stringify(namespace)}\ncurrent-context: context\n`;
  const args = ["--kubeconfig", "/heimdall/kubeconfig"];
  if (operation.kind === "install" || operation.kind === "upgrade") {
    args.push(
      "upgrade",
      "--install",
      operation.release,
      operation.chart,
      "--namespace",
      namespace,
      "--create-namespace",
      "--wait",
      "--timeout",
      "10m",
    );
    if (operation.version) args.push("--version", operation.version);
    if (operation.values?.trim()) args.push("--values", "/heimdall/values.yaml");
  } else if (operation.kind === "rollback")
    args.push(
      "rollback",
      operation.release,
      String(operation.revision),
      "--namespace",
      namespace,
      "--wait",
      "--timeout",
      "10m",
    );
  else args.push("uninstall", operation.release, "--namespace", namespace, "--wait", "--timeout", "10m");
  const secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: id, namespace },
      type: "Opaque",
      stringData: { kubeconfig, "values.yaml": "values" in operation ? operation.values || "{}" : "{}" },
    },
    job = {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: id, namespace, labels: { "app.kubernetes.io/managed-by": "heimdall" } },
      spec: {
        ttlSecondsAfterFinished: 300,
        backoffLimit: 0,
        template: {
          metadata: { labels: { "job-name": id } },
          spec: {
            restartPolicy: "Never",
            containers: [
              {
                name: "helm",
                image: "alpine/helm:3.17.3",
                args,
                volumeMounts: [{ name: "credentials", mountPath: "/heimdall", readOnly: true }],
              },
            ],
            volumes: [{ name: "credentials", secret: { secretName: id } }],
          },
        },
      },
    };
  try {
    onStatus?.("Creating secure Helm runner…");
    await kube(profile, secretPath, "POST", secret);
    const created = await kube<{ metadata?: { uid?: string } }>(profile, jobPath, "POST", job);
    // Make the Job own the Secret. The `finally` below deletes both, but it only
    // runs while this page lives: a closed tab or a crash mid-operation left a
    // Secret holding the user's cluster credential in the namespace for good,
    // readable by anyone with secret access there. `ttlSecondsAfterFinished`
    // covers the Job alone. With an ownerReference the garbage collector takes
    // the Secret with it, whether or not anything here gets to run.
    if (created.metadata?.uid)
      await kube(profile, `${secretPath}/${id}`, "PATCH", {
        metadata: {
          ownerReferences: [
            { apiVersion: "batch/v1", kind: "Job", name: id, uid: created.metadata.uid, blockOwnerDeletion: false },
          ],
        },
      }).catch(() => {
        // Best effort: the finally still deletes it on the happy path.
      });
    onStatus?.("Waiting for Helm…");
    for (let attempt = 0; attempt < 600; attempt++) {
      const current = await kube<{
        status?: { succeeded?: number; failed?: number; conditions?: Array<{ type: string; message?: string }> };
      }>(profile, `${jobPath}/${id}`);
      if (current.status?.succeeded) {
        const pods = await kube<{ items: Array<{ metadata: { name: string } }> }>(
          profile,
          `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=job-name%3D${id}`,
        );
        const pod = pods.items[0]?.metadata.name;
        return pod
          ? await kube<string>(
              profile,
              `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log`,
              "GET",
              undefined,
              true,
            )
          : "Helm operation completed";
      }
      if (current.status?.failed) {
        const failedPods = await kube<{ items: Array<{ metadata: { name: string } }> }>(
          profile,
          `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=job-name%3D${id}`,
        ).catch(() => ({ items: [] as Array<{ metadata: { name: string } }> }));
        const failedPod = failedPods.items[0]?.metadata.name;
        const logs = failedPod
          ? await kube<string>(
              profile,
              `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(failedPod)}/log`,
              "GET",
              undefined,
              true,
            ).catch(() => "")
          : "";
        throw new Error(
          (logs || "").trim() ||
            current.status.conditions
              ?.map(condition => condition.message)
              .filter(Boolean)
              .join("; ") ||
            "Helm runner failed",
        );
      }
      await delay(1000);
    }
    throw new Error("Helm operation timed out");
  } finally {
    onStatus?.("Cleaning up Helm runner…");
    await Promise.allSettled([
      kube(profile, `${jobPath}/${id}`, "DELETE", {
        apiVersion: "v1",
        kind: "DeleteOptions",
        propagationPolicy: "Foreground",
      }),
      kube(profile, `${secretPath}/${id}`, "DELETE", { apiVersion: "v1", kind: "DeleteOptions" }),
    ]);
  }
}

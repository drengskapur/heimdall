import type { ClusterProfile } from "./kubernetes";
import { companionPreferences as preferences } from "./proxy";

export interface TemporaryKubeconfig {
  id: string;
  path: string;
  createdAt: string;
  reused: boolean;
}
async function request(path: string, init: RequestInit = {}) {
  const prefs = preferences();
  if (!prefs.companionUrl || !prefs.companionToken)
    throw new Error("Configure the local companion URL and token in Terminal preferences");
  const response = await fetch(`${prefs.companionUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${prefs.companionToken}`, "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(result.error || `Companion request failed: ${response.status}`);
  }
  return response;
}
export class KubeconfigManager {
  private temporary?: TemporaryKubeconfig;
  constructor(private readonly cluster: ClusterProfile) {}
  get path() {
    return this.temporary?.path || null;
  }
  async ensurePath() {
    const response = await request("/v1/kubeconfigs/temporary", {
      method: "POST",
      body: JSON.stringify({
        id: this.temporary?.id,
        server: this.cluster.server,
        authorization: this.cluster.authorization || (this.cluster.token && `Bearer ${this.cluster.token}`),
        token: this.cluster.token,
        execCredential: this.cluster.execCredential,
        clientCertificateData: this.cluster.clientCertificateData,
        clientKeyData: this.cluster.clientKeyData,
        certificateAuthorityData: this.cluster.certificateAuthorityData,
        insecureSkipTlsVerify: this.cluster.insecureSkipTlsVerify,
        proxyUrl: this.cluster.proxyUrl,
        namespace: this.cluster.preferences?.defaultNamespace || this.cluster.namespace || "default",
        context: this.cluster.context || this.cluster.name,
      }),
    });
    this.temporary = (await response.json()) as TemporaryKubeconfig;
    return this.temporary.path;
  }
  async clear() {
    if (!this.temporary) return;
    const id = this.temporary.id;
    this.temporary = undefined;
    await request(`/v1/kubeconfigs/temporary/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
  }
}

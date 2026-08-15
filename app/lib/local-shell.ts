import { KubeconfigManager } from "./kubeconfig-manager";
import type { ClusterProfile } from "./kubernetes";
import { companionPreferences as preferences } from "./proxy";

/** Base64 for a byte array of any size.
 *
 *  `btoa(String.fromCharCode(...bytes))` spreads every byte as a separate
 *  argument, and engines cap argument count somewhere around 100k — so a large
 *  frame through a forwarded port threw RangeError and killed the session
 *  rather than transferring. Chunked so the spread stays small. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export interface LocalShellSession {
  send(text: string): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  close(): Promise<void>;
}
function endpoint(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}
export async function executeCredentialPlugin(exec: {
  command: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
}) {
  const prefs = preferences(),
    base = prefs.companionUrl,
    token = prefs.companionToken;
  if (!base || !token) throw new Error("Configure the local companion URL and token in Terminal preferences");
  const response = await fetch(endpoint(base, "/v1/credentials/exec"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(exec),
  });
  const result = (await response.json().catch(() => ({ error: response.statusText }))) as {
    error?: string;
    status?: { token?: string; clientCertificateData?: string; clientKeyData?: string; expirationTimestamp?: string };
  };
  if (!response.ok) throw new Error(result.error || `Credential plugin failed: ${response.status}`);
  return result;
}
export interface ScannedKubeconfig {
  path: string;
  root: string;
  content: string;
  size: number;
  mtimeMs: number;
}
export interface KubeconfigScan {
  roots: string[];
  items: ScannedKubeconfig[];
  errors: Array<{ path: string; error: string }>;
  revision: string;
}
/** Ask the companion to read the local kubeconfig sources (~/.kube, $KUBECONFIG). */
export async function scanKubeconfigs(paths?: string[]): Promise<KubeconfigScan> {
  const prefs = preferences(),
    base = prefs.companionUrl,
    token = prefs.companionToken;
  if (!base || !token) throw new Error("Configure the local companion URL and token in Terminal preferences");
  const response = await fetch(endpoint(base, "/v1/kubeconfigs/scan"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(paths ? { paths } : {}),
  });
  const result = (await response.json().catch(() => ({ error: response.statusText }))) as KubeconfigScan & {
    error?: string;
  };
  if (!response.ok)
    throw new Error((result as { error?: string }).error || `Kubeconfig scan failed: ${response.status}`);
  return result;
}
export async function companionKubeFetch(config: Record<string, unknown>, signal?: AbortSignal) {
  const prefs = preferences(),
    base = prefs.companionUrl,
    token = prefs.companionToken;
  if (!base || !token) throw new Error("Configure the local companion URL and token in Terminal preferences");
  return fetch(endpoint(base, "/v1/kube/proxy"), {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(config),
  });
}
export async function openCompanionKubeExec(
  config: Record<string, unknown>,
  callbacks: {
    onReady?: () => void;
    onStdout: (text: string) => void;
    onStderr?: (text: string) => void;
    onError?: (message: string) => void;
    onClose?: () => void;
  },
): Promise<LocalShellSession> {
  const prefs = preferences(),
    base = prefs.companionUrl,
    token = prefs.companionToken;
  if (!base || !token) throw new Error("Configure the local companion URL and token in Terminal preferences");
  config = { kubectlPath: prefs.kubectlPath || undefined, ...config };
  const request = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(endpoint(base, path), {
        ...init,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
      });
      if (!response.ok)
        throw new Error(
          ((await response.json().catch(() => ({ error: response.statusText }))) as { error?: string }).error ||
            `Companion request failed: ${response.status}`,
        );
      return response;
    },
    created = await request("/v1/kube/exec", { method: "POST", body: JSON.stringify(config) }),
    details = (await created.json()) as { id: string };
  callbacks.onReady?.();
  const controller = new AbortController();
  let sequence = 0;
  void (async () => {
    try {
      while (!controller.signal.aborted) {
        const response = await request(`/v1/sessions/${details.id}/output?after=${sequence}&wait=25000`, {
            signal: controller.signal,
          }),
          payload = (await response.json()) as {
            items: Array<{ sequence: number; stream: "stdout" | "stderr"; data: string }>;
            state: string;
          };
        for (const item of payload.items) {
          sequence = Math.max(sequence, item.sequence);
          if (item.stream === "stderr") callbacks.onStderr?.(item.data);
          else callbacks.onStdout(item.data);
        }
        if (payload.state !== "running") {
          callbacks.onClose?.();
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) callbacks.onError?.(error instanceof Error ? error.message : String(error));
    }
  })();
  return {
    send: async text => {
      await request(`/v1/sessions/${details.id}/input`, { method: "POST", body: JSON.stringify({ data: text }) });
    },
    resize: async (width, height) => {
      await request(`/v1/sessions/${details.id}/resize`, { method: "PATCH", body: JSON.stringify({ width, height }) });
    },
    close: async () => {
      controller.abort();
      await request(`/v1/sessions/${details.id}`, { method: "DELETE" }).catch(() => undefined);
    },
  };
}
export async function openCompanionPortForward(
  config: Record<string, unknown>,
  callbacks: {
    onReady?: (details: { localPort: number }) => void;
    onData: (data: Uint8Array) => void;
    onError?: (message: string) => void;
    onClose?: () => void;
  },
) {
  const prefs = preferences(),
    base = prefs.companionUrl,
    token = prefs.companionToken;
  if (!base || !token) throw new Error("Configure the local companion URL and token in Terminal preferences");
  config = { kubectlPath: prefs.kubectlPath || undefined, ...config };
  const request = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(endpoint(base, path), {
        ...init,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
      });
      if (!response.ok)
        throw new Error(
          ((await response.json().catch(() => ({ error: response.statusText }))) as { error?: string }).error ||
            `Companion request failed: ${response.status}`,
        );
      return response;
    },
    created = await request("/v1/kube/port-forward", { method: "POST", body: JSON.stringify(config) }),
    details = (await created.json()) as { id: string };
  const controller = new AbortController();
  let ready = false,
    sequence = 0;
  void (async () => {
    try {
      while (!controller.signal.aborted) {
        const response = await request(`/v1/sessions/${details.id}/output?after=${sequence}&wait=25000`, {
            signal: controller.signal,
          }),
          payload = (await response.json()) as {
            items: Array<{ sequence: number; stream: string; data: string }>;
            state: string;
            localPort?: number;
          };
        for (const item of payload.items) {
          sequence = Math.max(sequence, item.sequence);
          if (item.stream === "stderr" && !item.data.includes("Forwarding from")) callbacks.onError?.(item.data);
        }
        if (payload.localPort && !ready) {
          ready = true;
          callbacks.onReady?.({ localPort: payload.localPort });
        }
        if (payload.state !== "running") {
          callbacks.onClose?.();
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) callbacks.onError?.(error instanceof Error ? error.message : String(error));
    }
  })();
  return {
    send: async (data: string | Uint8Array) => {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data,
        response = await request(`/v1/sessions/${details.id}/data`, {
          method: "POST",
          body: JSON.stringify({ data: toBase64(bytes) }),
        }),
        payload = (await response.json()) as { data: string };
      callbacks.onData(Uint8Array.from(atob(payload.data), character => character.charCodeAt(0)));
    },
    close: async () => {
      controller.abort();
      await request(`/v1/sessions/${details.id}`, { method: "DELETE" }).catch(() => undefined);
    },
  };
}
export async function openLocalShell(
  callbacks: {
    onReady?: (details: { id: string; pid: number }) => void;
    onStdout: (text: string) => void;
    onStderr?: (text: string) => void;
    onError?: (message: string) => void;
    onClose?: () => void;
  },
  options: {
    shell?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    cluster?: ClusterProfile;
  } = {},
): Promise<LocalShellSession> {
  const prefs = preferences(),
    base = prefs.companionUrl,
    token = prefs.companionToken;
  if (!base || !token) throw new Error("Configure the local companion URL and token in Terminal preferences");
  const manager = options.cluster ? new KubeconfigManager(options.cluster) : undefined,
    sessionOptions = { shell: options.shell, args: options.args, cwd: options.cwd };
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(endpoint(base, path), {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    });
    if (!response.ok)
      throw new Error(
        ((await response.json().catch(() => ({ error: response.statusText }))) as { error?: string }).error ||
          `Companion request failed: ${response.status}`,
      );
    return response;
  };
  try {
    const kubeconfig = await manager?.ensurePath(),
      environment = { ...options.env, ...(kubeconfig ? { KUBECONFIG: kubeconfig } : {}) },
      created = await request("/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
          ...sessionOptions,
          env: environment,
          shell: options.shell || prefs.terminalShell || undefined,
        }),
      }),
      details = (await created.json()) as { id: string; pid: number };
    callbacks.onReady?.(details);
    const controller = new AbortController();
    let sequence = 0;
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          const response = await request(`/v1/sessions/${details.id}/output?after=${sequence}&wait=25000`, {
              signal: controller.signal,
            }),
            payload = (await response.json()) as {
              items: Array<{ sequence: number; stream: "stdout" | "stderr"; data: string }>;
              state: string;
            };
          for (const item of payload.items) {
            sequence = Math.max(sequence, item.sequence);
            if (item.stream === "stderr") callbacks.onStderr?.(item.data);
            else callbacks.onStdout(item.data);
          }
          if (payload.state !== "running") {
            await manager?.clear();
            callbacks.onClose?.();
            break;
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) callbacks.onError?.(error instanceof Error ? error.message : String(error));
      } finally {
        // The temporary kubeconfig holds the user's bearer token or client key
        // on disk. Clearing it only on the clean exit path meant a companion
        // that died, or a dropped connection, left the credential behind: the
        // poll threw, onError fired, and nothing deleted the file.
        await manager?.clear();
      }
    })();
    return {
      send: async text => {
        await request(`/v1/sessions/${details.id}/input`, { method: "POST", body: JSON.stringify({ data: text }) });
      },
      resize: async (width, height) => {
        await request(`/v1/sessions/${details.id}/resize`, {
          method: "PATCH",
          body: JSON.stringify({ width, height }),
        });
      },
      close: async () => {
        controller.abort();
        await request(`/v1/sessions/${details.id}`, { method: "DELETE" }).catch(() => undefined);
        await manager?.clear();
      },
    };
  } catch (error) {
    await manager?.clear();
    throw error;
  }
}

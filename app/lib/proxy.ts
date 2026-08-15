export interface ProxyPreferences {
  companionUrl?: string;
  companionToken?: string;
  httpProxy?: string;
  allowUntrusted?: boolean;
}
export interface CompanionHttpInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyBase64?: string;
  contentType?: string;
  proxyUrl?: string;
  insecureSkipTlsVerify?: boolean;
  certificateAuthorityData?: string;
  clientCertificateData?: string;
  clientKeyData?: string;
  timeoutMs?: number;
}

/** The companion's conventional local address; used when the user hasn't set one
 *  so a fresh browser only needs the token to connect. */
export const DEFAULT_COMPANION_URL = "http://127.0.0.1:38431";

/** The fixed token `scripts/companion-dev.mjs` bakes in. Defaulting to it in a
 *  dev build makes `npm run dev` + `npm run companion:dev` work with no manual
 *  setup — otherwise a fresh browser can reach the companion but every call
 *  401s, which surfaces as "no clusters found". Dev only: a production build
 *  falls through to undefined so the token must be configured explicitly. */
export const DEV_COMPANION_TOKEN = "heimdall-dev";

/** True only under the Vite dev server. Guarded because these modules are also
 *  loaded by the plain-node test runner, where `import.meta.env` is absent. */
const IS_DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

export interface CompanionPreferences extends ProxyPreferences {
  terminalShell?: string;
  kubectlPath?: string;
  kubeconfigSyncPaths?: string;
}

/** The one reader for the companion's stored settings, applying the URL and
 *  (dev-only) token defaults. Every companion caller goes through this so the
 *  defaults can't drift between call sites. */
export function companionPreferences(): CompanionPreferences {
  const fallbacks = {
    companionUrl: DEFAULT_COMPANION_URL,
    companionToken: IS_DEV ? DEV_COMPANION_TOKEN : undefined,
  };
  if (typeof localStorage === "undefined") return fallbacks;
  try {
    const stored = JSON.parse(localStorage.getItem("heimdall.preferences") || "{}") as CompanionPreferences;
    return {
      ...stored,
      companionUrl: stored.companionUrl || fallbacks.companionUrl,
      companionToken: stored.companionToken || fallbacks.companionToken,
    };
  } catch {
    return fallbacks;
  }
}
function endpoint(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}
export async function companionHttpFetch(input: CompanionHttpInput, signal?: AbortSignal) {
  const prefs = companionPreferences();
  if (!prefs.companionUrl || !prefs.companionToken)
    throw new Error("Configure the local companion URL and token in Terminal preferences");
  return fetch(endpoint(prefs.companionUrl, "/v1/http/fetch"), {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${prefs.companionToken}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

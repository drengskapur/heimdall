// Turn low-level transport failures into a message a human can act on. When the
// cluster's API server (or the companion) is unreachable, the raw error is an
// opaque `fetch failed` / `Failed to fetch` / `ECONNREFUSED` — surface a clear
// "can't reach the cluster" instead.
const UNREACHABLE =
  /fetch failed|failed to fetch|networkerror|ECONNREFUSED|actively refused|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|network ?error|load failed/i;
const COMPANION = /companion (url|request|token)|configure the local companion/i;

export function humanizeClusterError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (COMPANION.test(raw)) {
    return "Can't reach the local companion. Open Preferences → Cluster proxy and check its URL and token.";
  }
  if (UNREACHABLE.test(raw)) {
    return "Can't reach the cluster. Check that it's running and reachable, then retry.";
  }
  return raw || "Something went wrong.";
}

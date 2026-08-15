// Standalone Node API server for the SPA build. Ports the Cloudflare Worker's
// /api/* proxies to plain Node (node:http + ws), and — unlike the worker on
// vinext's Node runtime — relays exec/attach/port-forward WebSocket frames with
// correct binary handling via the standard `ws` library. It also serves the
// built static SPA with an index.html fallback for client-side routes.
//
//   HEIMDALL_API_PORT   (default 3000)
//   HEIMDALL_SPA_DIR    (default ./dist) — the Vite SPA build output

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { WebSocket, WebSocketServer } from "ws";

const PORT = Number(process.env.HEIMDALL_API_PORT || 3000);
const SPA_DIR = resolve(process.env.HEIMDALL_SPA_DIR || "dist");
// Loopback by default. Nothing here authenticates: /api/kube proxies to whatever
// `x-kube-server` names, and that is allowed to be http://127.0.0.1 so a local
// cluster works — so on 0.0.0.0 any host that can reach the port can use this
// process to reach services bound to *its* loopback. Set HEIMDALL_API_HOST
// explicitly (0.0.0.0 in a container) when that exposure is intended.
const HOST = process.env.HEIMDALL_API_HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

const isHttpsOrLocal = u => u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1";
const isKubePath = p =>
  // The bare forms are the discovery roots — `discoverClusterCapabilities` asks
  // for "/apis" to enumerate API groups — and requiring the trailing slash
  // rejected them with 400, so group discovery never ran for a bearer-token
  // cluster going through this proxy. The companion already allowed both.
  p === "/api" ||
  p === "/apis" ||
  p.startsWith("/api/") ||
  p.startsWith("/apis/") ||
  p === "/version" ||
  p.startsWith("/openapi/") ||
  p === "/healthz" ||
  p === "/livez" ||
  p === "/readyz";

/** Build an undici Agent honouring per-cluster TLS (CA / insecure). */
// One dispatcher per distinct TLS shape. Building an Agent per request leaked a
// dispatcher and its sockets on every list, get and watch against a cluster with
// a CA or insecure verification — enough traffic and the process runs out of
// file descriptors. The set of shapes is bounded by the clusters in use.
const tlsAgents = new Map();
const MAX_TLS_AGENTS = 32;

function tlsAgent({ certificateAuthorityData, insecureSkipTlsVerify }) {
  const tls = {};
  if (insecureSkipTlsVerify) tls.rejectUnauthorized = false;
  if (certificateAuthorityData) tls.ca = Buffer.from(certificateAuthorityData, "base64").toString("utf8");
  if (!Object.keys(tls).length) return undefined;
  const key = `${insecureSkipTlsVerify ? "insecure" : "verify"}:${certificateAuthorityData || ""}`;
  let agent = tlsAgents.get(key);
  if (!agent) {
    agent = new Agent({ connect: tls });
    tlsAgents.set(key, agent);
    // Bounded, because the key contains request-supplied CA data: without a cap,
    // varying that field grows the map and its sockets without limit. A handful
    // of distinct TLS shapes is all a real deployment has; the oldest is closed
    // rather than merely dropped, so its sockets go with it.
    while (tlsAgents.size > MAX_TLS_AGENTS) {
      const oldest = tlsAgents.keys().next();
      if (oldest.done) break;
      void tlsAgents.get(oldest.value)?.close?.();
      tlsAgents.delete(oldest.value);
    }
  }
  return agent;
}

/** Largest request body accepted. Generous for a Kubernetes manifest or a set
 *  of Helm values, and small enough that a single request cannot exhaust the
 *  heap — the body was previously buffered with no ceiling at all. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};

// --- /api/kube — single Kubernetes REST call proxy -------------------------
async function handleKube(req, res) {
  if (req.method !== "POST") return send(res, 405, "Method not allowed");
  const server = req.headers["x-kube-server"];
  const authorization = req.headers["authorization"];
  if (!server || !authorization) return send(res, 400, "Missing cluster server or authorization");
  let base;
  try {
    base = new URL(server);
  } catch {
    return send(res, 400, "Invalid cluster server");
  }
  if (!isHttpsOrLocal(base)) return send(res, 400, "Cluster API must use HTTPS");
  const payload = JSON.parse((await readBody(req)) || "{}");
  if (!payload.path || !isKubePath(payload.path)) return send(res, 400, "Invalid Kubernetes API path");
  const target = new URL(payload.path, base);
  if (target.origin !== base.origin) return send(res, 400, "Invalid Kubernetes API origin");
  const upstream = await undiciFetch(target, {
    method: payload.method || (payload.body === undefined ? "GET" : "POST"),
    headers: {
      authorization,
      accept: payload.raw ? "text/plain" : "application/json",
      ...(payload.body === undefined ? {} : { "content-type": payload.contentType || "application/json" }),
    },
    body:
      payload.body === undefined
        ? undefined
        : payload.contentType === "application/x-www-form-urlencoded"
          ? new URLSearchParams(payload.body)
          : JSON.stringify(payload.body),
    dispatcher: tlsAgent({
      certificateAuthorityData: payload.certificateAuthorityData,
      insecureSkipTlsVerify: payload.insecureSkipTlsVerify,
    }),
  });
  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || (payload.raw ? "text/plain" : "application/json"),
    "cache-control": "no-store",
  });
  // Pipe (don't buffer) so long-running watch/log streams reach the client
  // incrementally — `arrayBuffer()` would never resolve for an open watch.
  //
  // pipeline, not pipe: `.pipe()` forwards no errors, so a client that walks
  // away mid-watch left the upstream Readable to emit 'error' with nothing
  // listening, and an unhandled 'error' event takes the whole process down.
  // A browser tab closing during a watch is routine, so this crashed the API
  // server in normal use. The WebSocket path below already guards its upstream.
  if (upstream.body) {
    try {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch {
      // Client aborted, or the upstream stream broke: nothing left to send.
      res.destroy();
    }
  } else res.end();
}

// --- /api/prometheus — metrics query proxy ---------------------------------
async function handlePrometheus(req, res) {
  if (req.method !== "POST") return send(res, 405, "Method not allowed");
  const configured = req.headers["x-prometheus-url"];
  if (!configured) return send(res, 400, "Missing Prometheus URL");
  let base;
  try {
    base = new URL(configured);
  } catch {
    return send(res, 400, "Invalid Prometheus URL");
  }
  if (!isHttpsOrLocal(base)) return send(res, 400, "Prometheus must use HTTPS");
  const payload = JSON.parse((await readBody(req)) || "{}");
  if (!["query", "query_range"].includes(payload.endpoint)) return send(res, 400, "Invalid Prometheus endpoint");
  const prefix = (payload.prefix || "").replace(/^\/+|\/+$/g, "");
  const target = new URL(
    `${prefix ? `${prefix}/` : ""}api/v1/${payload.endpoint}`,
    base.href.endsWith("/") ? base : new URL(`${base.href}/`),
  );
  if (target.origin !== base.origin) return send(res, 400, "Invalid Prometheus origin");
  const params = new URLSearchParams(payload.params || {});
  const method = payload.method === "GET" ? "GET" : "POST";
  if (method === "GET") target.search = params.toString();
  const auth = req.headers["x-prometheus-authorization"];
  const upstream = await undiciFetch(target, {
    method,
    headers: {
      ...(auth ? { authorization: auth } : {}),
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? params : undefined,
  });
  res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

// --- /api/helm-chart + /api/helm-repository — proxies with a small cache ----
//
// "Small" is now enforced. The cache is keyed by chart and repository URL, both
// of which come from the request, so an unbounded Map grows for as long as
// someone keeps asking for URLs it has not seen — each entry holding a whole
// chart body. Map iterates in insertion order, which makes eviction of the
// oldest key a one-liner.
const CHART_MAX_BYTES = 32 * 1024 * 1024;

/** Answer without reading the upstream body, releasing its socket.
 *
 *  Returning early left the body unconsumed and uncancelled, so undici held the
 *  connection until GC noticed — a socket leak on exactly the paths that happen
 *  repeatedly, a 404 repo URL or an oversized chart. */
function discardBody(upstream, respond) {
  void upstream.body?.cancel?.();
  return respond();
}

/** Buffer a response body, aborting once it passes `max` bytes. */
async function readCapped(response, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) throw new Error("Response body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const helmCache = new Map();
const HELM_CACHE_MAX_BYTES = 64 * 1024 * 1024;
// Matches the `max-age=300` these responses advertise. Without it a long-lived
// server kept serving the first index.yaml it ever fetched, so newly published
// chart versions never appeared while the client was told the data was five
// minutes fresh at most.
const HELM_CACHE_TTL_MS = 5 * 60 * 1000;
let helmCacheBytes = 0;

function cacheHelm(key, body) {
  // Never admit a body big enough to evict most of the cache by itself.
  if (body.length > HELM_CACHE_MAX_BYTES / 2) return;
  const existing = helmCache.get(key);
  if (existing) helmCacheBytes -= existing.body.length;
  helmCache.set(key, { body, at: Date.now() });
  helmCacheBytes += body.length;
  while (helmCacheBytes > HELM_CACHE_MAX_BYTES) {
    const oldest = helmCache.keys().next();
    if (oldest.done) break;
    helmCacheBytes -= helmCache.get(oldest.value).body.length;
    helmCache.delete(oldest.value);
  }
}

/** A cached body, or undefined once it is older than the TTL. */
function cachedHelm(key) {
  const entry = helmCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > HELM_CACHE_TTL_MS) {
    helmCacheBytes -= entry.body.length;
    helmCache.delete(key);
    return undefined;
  }
  return entry.body;
}
async function handleHelmChart(req, res) {
  if (req.method !== "POST") return send(res, 405, "Method not allowed");
  const { url } = JSON.parse((await readBody(req)) || "{}");
  let chart;
  try {
    chart = new URL(url || "");
  } catch {
    return send(res, 400, "Invalid Helm chart URL");
  }
  if (!isHttpsOrLocal(chart)) return send(res, 400, "Helm chart must use HTTPS");
  if (chart.username || chart.password) return send(res, 400, "Credentials must be supplied separately");
  const key = chart.toString();
  const cachedChart = cachedHelm(key);
  if (cachedChart)
    return send(res, 200, cachedChart, { "content-type": "application/gzip", "x-heimdall-cache": "hit" });
  const upstream = await undiciFetch(key, { headers: { accept: "application/gzip, application/octet-stream" } });
  if (!upstream.ok)
    return discardBody(upstream, () => send(res, upstream.status, `Helm chart download rejected: ${upstream.status}`));
  if (Number(upstream.headers.get("content-length") || 0) > CHART_MAX_BYTES)
    return discardBody(upstream, () => send(res, 413, "Helm chart exceeds the 32 MiB download limit"));
  // Content-Length is a claim, not a guarantee: it can be absent (chunked) or
  // simply wrong, and `arrayBuffer()` would then buffer whatever arrives.
  let body;
  try {
    body = await readCapped(upstream, CHART_MAX_BYTES);
  } catch {
    return send(res, 413, "Helm chart exceeds the 32 MiB download limit");
  }
  cacheHelm(key, body);
  send(res, 200, body, {
    "content-type": upstream.headers.get("content-type") || "application/gzip",
    "cache-control": "public, max-age=300",
  });
}
async function handleHelmRepository(req, res) {
  if (req.method !== "POST") return send(res, 405, "Method not allowed");
  const { url, username, password } = JSON.parse((await readBody(req)) || "{}");
  let repo;
  try {
    repo = new URL(url || "");
  } catch {
    return send(res, 400, "Invalid Helm repository URL");
  }
  if (!isHttpsOrLocal(repo)) return send(res, 400, "Helm repository must use HTTPS");
  if (repo.username || repo.password) return send(res, 400, "Credentials must be supplied separately");
  const indexUrl = new URL(
    repo.pathname.endsWith("index.yaml") ? repo.pathname : `${repo.pathname.replace(/\/$/, "")}/index.yaml`,
    repo,
  );
  const authorization =
    username || password ? `Basic ${Buffer.from(`${username || ""}:${password || ""}`).toString("base64")}` : undefined;
  const key = indexUrl.toString();
  const cachedIndex = authorization ? undefined : cachedHelm(key);
  if (cachedIndex)
    return send(res, 200, cachedIndex, { "content-type": "application/yaml", "x-heimdall-cache": "hit" });
  const upstream = await undiciFetch(indexUrl, {
    headers: { accept: "application/yaml, text/yaml, text/plain", ...(authorization ? { authorization } : {}) },
  });
  if (!upstream.ok)
    return discardBody(upstream, () => send(res, upstream.status, `Helm repository rejected: ${upstream.status}`));
  const body = Buffer.from(await upstream.arrayBuffer());
  if (!authorization) cacheHelm(key, body);
  send(res, 200, body, {
    "content-type": "application/yaml",
    "cache-control": authorization ? "no-store" : "public, max-age=300",
  });
}

// --- static SPA with index.html fallback -----------------------------------
async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const candidate = resolve(join(SPA_DIR, urlPath === "/" ? "/index.html" : urlPath));
  // `relative`, not `startsWith`: a prefix test lets a path escape into any
  // sibling directory whose name merely begins with SPA_DIR. With SPA_DIR of
  // /srv/heimdall/dist, both "/../dist-backup/secrets" and its percent-encoded
  // form "/%2e%2e/dist-backup/secrets" normalise to /srv/heimdall/dist-backup
  // — which passes a prefix check and is served.
  const within = relative(SPA_DIR, candidate);
  if (within !== "" && (within.startsWith("..") || within.startsWith(sep))) return send(res, 403, "Forbidden");
  try {
    // One read, not a `stat` then a read. The two-call form asks about one
    // path and then opens another — whatever the name resolves to the second
    // time — and the `isFile()` it checked is subsumed by the read anyway: a
    // directory fails with EISDIR and takes the same SPA fallback a missing
    // file does. Fewer syscalls, less code, and no window in between.
    const body = await readFile(candidate);
    return send(res, 200, body, {
      "content-type": MIME[extname(candidate)] || "application/octet-stream",
    });
  } catch {
    /* fall through to SPA index */
  }
  try {
    return send(res, 200, await readFile(join(SPA_DIR, "index.html")), { "content-type": "text/html; charset=utf-8" });
  } catch {
    return send(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/api/kube") return await handleKube(req, res);
    if (pathname === "/api/prometheus") return await handlePrometheus(req, res);
    if (pathname === "/api/helm-chart") return await handleHelmChart(req, res);
    if (pathname === "/api/helm-repository") return await handleHelmRepository(req, res);
    return await serveStatic(req, res);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    send(res, error?.statusCode || 500, String(error?.message || error));
  }
});

// --- /api/kube-stream — exec / attach / port-forward WebSocket relay --------
// The browser opens a WS, sends a JSON config first, then channel.k8s.io binary
// frames. We relay to the cluster's streaming subresource with correct binary
// framing (the fix vs. the Cloudflare-only worker path).
/** A close reason inside ws's 123-*byte* control-frame limit.
 *
 *  Slicing to 120 characters was not enough: 120 emoji is 240 bytes, ws throws,
 *  and the catch downgraded a clean close into a TCP reset. Truncating bytes can
 *  land mid-character, so a trailing replacement char is dropped. */
function closeReason(reason) {
  const text = reason?.toString?.() || "";
  if (Buffer.byteLength(text) <= 123) return text;
  const cut = Buffer.from(text, "utf8").subarray(0, 123).toString("utf8");
  return cut.endsWith("�") ? cut.slice(0, -1) : cut;
}

const wss = new WebSocketServer({ server, path: "/api/kube-stream" });
wss.on("connection", client => {
  let upstream = null;
  const queue = [];
  client.on("message", (data, isBinary) => {
    // `upstream` exists from the moment it is constructed, but stays CONNECTING
    // until the cluster completes its handshake, and ws's send() *throws* in
    // that state. The throw escapes this listener and takes the process down.
    // The window is ordinary use, not a race worth ignoring: the browser socket
    // is already open, so a single keystroke in an exec terminal lands here
    // before the relay is ready. Anything arriving early joins the same queue
    // the pre-config frames use.
    if (upstream) {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      else queue.push({ data, isBinary });
      return;
    }
    if (isBinary) {
      queue.push({ data, isBinary: true });
      return;
    }
    let config;
    try {
      config = JSON.parse(data.toString());
    } catch {
      client.close(1008, "First message must be JSON config");
      return;
    }
    try {
      const authorization = config.authorization || (config.token ? `Bearer ${config.token}` : "");
      if (!config.server || !authorization || !config.path) throw new Error("Missing stream configuration");
      const base = new URL(config.server);
      if (!isHttpsOrLocal(base)) throw new Error("Cluster API must use HTTPS");
      if (!(config.path.startsWith("/api/") || config.path.startsWith("/apis/")))
        throw new Error("Invalid Kubernetes stream path");
      const target = new URL(config.path, base);
      if (target.origin !== base.origin) throw new Error("Invalid Kubernetes stream origin");
      const wsUrl = target.toString().replace(/^http/, "ws");
      // ws takes TLS options (ca / rejectUnauthorized) directly on the options object.
      upstream = new WebSocket(wsUrl, config.protocols || ["v5.channel.k8s.io", "v4.channel.k8s.io"], {
        headers: { authorization },
        ...(config.insecureSkipTlsVerify ? { rejectUnauthorized: false } : {}),
        ...(config.certificateAuthorityData
          ? { ca: Buffer.from(config.certificateAuthorityData, "base64").toString("utf8") }
          : {}),
      });
      upstream.on("open", () => {
        client.send(JSON.stringify({ type: "ready", protocol: upstream.protocol || "v5.channel.k8s.io" }));
        for (const frame of queue) upstream.send(frame.data, { binary: frame.isBinary });
        queue.length = 0;
      });
      upstream.on("message", (data, isBinary) => client.send(data, { binary: isBinary }));
      upstream.on("close", (code, reason) => {
        // 1004, 1005 and 1006 are "never sent on the wire" codes and ws throws
        // if you try — and 1006 is exactly what it reports when the cluster's
        // TCP connection drops, the ordinary way a stream dies. The old range
        // check let all three through, so a dropped exec session took the
        // server with it. A reason over 123 bytes throws for the same reason.
        const sendable = code >= 1000 && code <= 4999 && code !== 1004 && code !== 1005 && code !== 1006;
        try {
          client.close(sendable ? code : 1000, closeReason(reason));
        } catch {
          client.terminate();
        }
      });
      upstream.on("error", () => {
        try {
          client.close(1011, "Upstream stream failed");
        } catch {
          /* closed */
        }
      });
    } catch (error) {
      client.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }));
      client.close(1008, "Invalid stream configuration");
    }
  });
  client.on("close", () => upstream?.close());
  // Without a listener, ws emits `error` on the EventEmitter and Node rethrows
  // it as an uncaught exception — a malformed client frame would kill the
  // server. The upstream socket already has one; this side did not.
  client.on("error", () => upstream?.close());
});

server.listen(PORT, HOST, () => console.log(JSON.stringify({ ready: true, host: HOST, port: PORT, spaDir: SPA_DIR })));

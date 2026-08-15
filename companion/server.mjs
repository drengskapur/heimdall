import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect as connectTcp } from "node:net";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import { respondJson } from "./http-responses.mjs";

const { O_RDONLY, O_NONBLOCK } = fsConstants;

const env = name => process.env[`HEIMDALL_COMPANION_${name}`];
const host = env("HOST") || "127.0.0.1",
  port = Number(env("PORT") || 38431),
  token = env("TOKEN") || randomBytes(32).toString("hex"),
  allowedOrigins = new Set(
    (env("ORIGINS") || "http://localhost:3000,http://127.0.0.1:3000").split(",").map(value => value.trim()),
  ),
  sessions = new Map();
const defaultShell =
    process.platform === "win32" ? process.env.ComSpec || "powershell.exe" : process.env.SHELL || "/bin/sh",
  defaultArgs = process.platform === "win32" && /powershell/i.test(defaultShell) ? ["-NoLogo"] : [];
const kubectlInstalls = new Map(),
  temporaryKubeconfigs = new Map(),
  kubectlDirectory = env("DATA") || join(homedir(), ".heimdall", "kubectl");
const dispatchers = new Map(),
  forbiddenForwardHeaders = new Set([
    "connection",
    "content-length",
    "cookie",
    "host",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
function authorized(request) {
  const supplied = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!supplied) return false;
  const left = Buffer.from(supplied),
    right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}
function headers(request, extra = {}) {
  const origin = request.headers.origin;
  return {
    "cache-control": "no-store",
    "content-type": "application/json",
    ...(origin && allowedOrigins.has(origin)
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-headers": "authorization, content-type",
          "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
          vary: "origin",
        }
      : {}),
    ...extra,
  };
}
function send(response, request, status, body, extra) {
  respondJson(response, body === undefined ? "" : body, status, headers(request, extra));
}
async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error("Request body is too large");
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
/** How long a finished session stays readable before it is dropped.
 *
 *  It cannot be dropped at exit: the client polls for the last of the output and
 *  the exit code after the child is gone. But it was only ever removed by an
 *  explicit DELETE, so a process that ended on its own left its entry — and its
 *  whole buffered output — in `sessions` for the life of the companion. */
const CLOSED_SESSION_TTL_MS = 5 * 60 * 1000;

function finish(session, code, signal) {
  session.state = "closed";
  session.exitCode = code;
  session.signal = signal;
  session.waiters.splice(0).forEach(resolve => resolve());
  const timer = setTimeout(() => sessions.delete(session.id), CLOSED_SESSION_TTL_MS);
  // Do not hold the process open purely to expire a dead session.
  timer.unref?.();
}
function push(session, stream, data) {
  // Decoded through a per-stream StringDecoder rather than `data.toString()`:
  // a multi-byte character split across two `data` events — routine for CJK or
  // an emoji in a log line — decoded to U+FFFD on each half, and the client
  // stored the damage permanently. The decoder holds the partial sequence until
  // its remaining bytes arrive.
  const text = session.decoders[stream].write(data),
    forward = text.match(/Forwarding from (?:127\.0\.0\.1|\[::1\]):(\d+)/);
  if (forward) session.localPort = Number(forward[1]);
  session.sequence++;
  session.output.push({ sequence: session.sequence, stream, data: text });
  if (session.output.length > 2000) session.output.splice(0, session.output.length - 2000);
  session.waiters.splice(0).forEach(resolve => resolve());
}
/** Spawn, deleting the temporary kubeconfig if the spawn itself throws.
 *
 *  `spawn` fails synchronously on a malformed argument — a non-string namespace
 *  or container reaching it as an object is enough. That happened before
 *  `registerProcess` ran, so nothing ever called `kubeconfig.cleanup` and a file
 *  holding a bearer token or client key stayed in the system temp directory. */
function spawnOrClean(command, args, options, kubeconfig) {
  try {
    return spawn(command, args, options);
  } catch (error) {
    kubeconfig.cleanup();
    throw error;
  }
}

function registerProcess(child, cleanup = () => {}) {
  const id = randomUUID(),
    session = {
      id,
      child,
      state: "running",
      sequence: 0,
      output: [],
      waiters: [],
      exitCode: null,
      signal: null,
      cleanup,
    };
  session.decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
  sessions.set(id, session);
  // A child can stop reading while still alive — `kubectl exec -i` whose remote
  // command exits, a finished shell pipeline. The next write to that stdin
  // raises EPIPE as an async error event, and an unhandled one on a stream kills
  // the companion. The failure needs no reporting: the child exiting is what the
  // caller actually observes.
  child.stdin?.on("error", () => {});
  child.stdout.on("data", data => push(session, "stdout", data));
  child.stderr.on("data", data => push(session, "stderr", data));
  child.on("error", error => {
    push(session, "stderr", Buffer.from(`${error.message}\n`));
    finish(session, 1, null);
    cleanup();
  });
  child.on("exit", (code, signal) => {
    finish(session, code, signal);
    cleanup();
  });
  return session;
}
function runCredential(input) {
  return new Promise((resolve, reject) => {
    if (typeof input.command !== "string" || !input.command) throw new Error("Credential command is required");
    const args = Array.isArray(input.args) && input.args.every(value => typeof value === "string") ? input.args : [],
      environment = { ...process.env };
    for (const entry of Array.isArray(input.env) ? input.env : [])
      if (entry && typeof entry.name === "string" && typeof entry.value === "string")
        environment[entry.name] = entry.value;
    const child = spawn(input.command, args, {
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }),
      stdout = [],
      stderr = [];
    let size = 0,
      settled = false;
    // One way out, used by every path. `settled` and `clearTimeout` used to live
    // only in the exit handler, so a timeout, an oversized response or a spawn
    // error rejected and then left the timer armed: up to two minutes later it
    // fired again, killed a process that had already gone, and rejected an
    // already-settled promise. A plugin that ignores SIGTERM was simply
    // orphaned.
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        child.kill();
        reject(error);
      } else resolve(value);
    };
    const timeout = setTimeout(
      () => settle(new Error("Credential plugin timed out")),
      Math.min(Number(input.timeoutMs) || 30000, 120000),
    );
    child.stdout.on("data", chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) settle(new Error("Credential plugin output is too large"));
      else stdout.push(chunk);
    });
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", error => settle(error));
    child.on("exit", code => {
      if (settled) return;
      if (code !== 0) {
        settle(new Error(Buffer.concat(stderr).toString("utf8").trim() || `Credential plugin exited with ${code}`));
        return;
      }
      try {
        const credential = JSON.parse(Buffer.concat(stdout).toString("utf8"));
        if (!credential?.status?.token && !credential?.status?.clientCertificateData)
          throw new Error("Credential plugin returned no credentials");
        settle(null, credential);
      } catch (error) {
        settle(error);
      }
    });
  });
}
function decodeData(value) {
  if (typeof value !== "string" || !value) return undefined;
  return Buffer.from(value, "base64");
}
function validatedProxyUrl(value) {
  if (!value) return undefined;
  const proxy = new URL(String(value));
  if (!["http:", "https:"].includes(proxy.protocol)) throw new Error("Proxy URL must use HTTP or HTTPS");
  return proxy.toString();
}
function noProxyMatch(target, value) {
  const port = target.port || (target.protocol === "https:" ? "443" : "80"),
    hostname = target.hostname.toLowerCase();
  return String(value || "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
    .some(entry => {
      if (entry === "*") return true;
      const separator = entry.lastIndexOf(":");
      let host = entry,
        requestedPort = "";
      if (separator > 0 && !entry.endsWith("]") && /^\d+$/.test(entry.slice(separator + 1))) {
        host = entry.slice(0, separator);
        requestedPort = entry.slice(separator + 1);
      }
      host = host.replace(/^\[|\]$/g, "");
      if (requestedPort && requestedPort !== port) return false;
      if (host.startsWith("*.")) host = host.slice(1);
      return hostname === host.replace(/^\./, "") || (host.startsWith(".") && hostname.endsWith(host));
    });
}
function resolveProxyUrl(target, explicit) {
  if (explicit) return validatedProxyUrl(explicit);
  if (noProxyMatch(target, process.env.NO_PROXY || process.env.no_proxy)) return undefined;
  const environment =
    target.protocol === "https:"
      ? process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy
      : process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  return validatedProxyUrl(environment);
}
function proxyDirective(target, explicit) {
  const proxyUrl = resolveProxyUrl(target, explicit);
  if (!proxyUrl) return { proxy: "DIRECT" };
  const proxy = new URL(proxyUrl);
  return { proxy: `PROXY ${proxy.hostname}:${proxy.port || (proxy.protocol === "https:" ? 443 : 80)}`, proxyUrl };
}
function dispatcherFor(input, target) {
  const proxyUrl = resolveProxyUrl(target, input.proxyUrl),
    tls = {
      ca: decodeData(input.certificateAuthorityData),
      cert: decodeData(input.clientCertificateData),
      key: decodeData(input.clientKeyData),
      rejectUnauthorized: !input.insecureSkipTlsVerify,
    },
    key = createHash("sha256")
      .update(
        JSON.stringify({
          proxyUrl,
          ca: input.certificateAuthorityData,
          cert: input.clientCertificateData,
          key: input.clientKeyData,
          insecure: input.insecureSkipTlsVerify,
        }),
      )
      .digest("hex");
  if (!dispatchers.has(key))
    dispatchers.set(key, proxyUrl ? new ProxyAgent({ uri: proxyUrl, requestTls: tls }) : new Agent({ connect: tls }));
  return dispatchers.get(key);
}
function forwardedHeaders(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input))
    if (typeof value === "string" && !forbiddenForwardHeaders.has(key.toLowerCase())) result[key] = value;
  return result;
}
function requestBody(input) {
  if (typeof input.bodyBase64 === "string") return Buffer.from(input.bodyBase64, "base64");
  if (input.body === undefined) return undefined;
  if (typeof input.body === "string") return input.body;
  if (input.contentType === "application/x-www-form-urlencoded") return new URLSearchParams(input.body).toString();
  return JSON.stringify(input.body);
}
/** A signal that bounds how long the upstream may take to *respond*, not how
 *  long it may stream.
 *
 *  This used to be a flat `AbortSignal.timeout`, which covers the whole
 *  exchange including the body. Everything long-lived that the companion
 *  proxies — a watch, follow-logs — was therefore cut off after 30 seconds by
 *  default and 120 at the very most, no matter what the caller asked for. Users
 *  saw logs stop with "This operation was aborted" and watches restart on a
 *  loop.
 *
 *  The deadline now applies until the response headers arrive; after that the
 *  only thing that aborts the upstream is the client hanging up, which is the
 *  condition that actually means nobody wants the bytes. */
function streamSignal(request, headersTimeoutMs) {
  const controller = new AbortController();
  const onClose = () => controller.abort();
  request.once("close", onClose);
  const timer = setTimeout(() => controller.abort(), headersTimeoutMs);
  return Object.assign(controller.signal, {
    heimdallSettle() {
      clearTimeout(timer);
    },
  });
}

async function pipeFetch(request, response, target, input, defaults = {}) {
  const signal = streamSignal(request, Math.min(Math.max(Number(input.timeoutMs) || 30000, 1000), 120000));
  const upstream = await undiciFetch(target, {
      method: input.method || defaults.method || "GET",
      headers: {
        ...defaults.headers,
        ...forwardedHeaders(input.headers),
        ...(input.authorization ? { authorization: input.authorization } : {}),
        ...(input.body === undefined && input.bodyBase64 === undefined
          ? {}
          : { "content-type": input.contentType || "application/json" }),
      },
      body: requestBody(input),
      dispatcher: dispatcherFor(input, target),
      redirect: "manual",
      signal,
    }),
    extra = {
      "cache-control": "no-store",
      "content-type": upstream.headers.get("content-type") || defaults.contentType || "application/octet-stream",
    };
  // Headers are in: the deadline has done its job and must not reach the body.
  signal.heimdallSettle();
  for (const name of ["etag", "last-modified", "location"])
    if (upstream.headers.has(name)) extra[name] = upstream.headers.get(name);
  response.writeHead(upstream.status, headers(request, extra));
  if (upstream.body) {
    const readable = Readable.fromWeb(upstream.body);
    // Both directions can already be torn down by the time the other notices:
    // destroying a stream that is closed throws, and there is nothing to report
    // because the disconnect is the thing we are reacting to.
    readable.on("error", () => {
      try {
        response.destroy();
      } catch {
        // already destroyed
      }
    });
    response.on("close", () => {
      try {
        readable.destroy();
      } catch {
        // already destroyed
      }
    });
    readable.pipe(response);
  } else response.end();
}
async function proxyHttp(request, response, input) {
  const target = new URL(input.url || "");
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password)
    throw new Error("Invalid HTTP target URL");
  await pipeFetch(request, response, target, input);
}
async function proxyKubernetes(request, response, input) {
  const base = new URL(input.server || "");
  if (base.protocol !== "https:") throw new Error("Companion Kubernetes proxy requires HTTPS");
  if (
    typeof input.path !== "string" ||
    !(
      input.path === "/version" ||
      input.path === "/api" ||
      input.path === "/apis" ||
      input.path === "/openapi/v3" ||
      input.path.startsWith("/openapi/v3/") ||
      input.path.startsWith("/api/") ||
      input.path.startsWith("/apis/")
    )
  )
    throw new Error("Invalid Kubernetes API path");
  const target = new URL(input.path, base);
  if (target.origin !== base.origin) throw new Error("Invalid Kubernetes API origin");
  await pipeFetch(request, response, target, input, {
    headers: { accept: input.raw ? "*/*" : "application/json" },
    contentType: input.raw ? "text/plain" : "application/json",
  });
}
function kubeconfigUser(input) {
  if (input.execCredential?.command) return { exec: input.execCredential };
  if (input.clientCertificateData && input.clientKeyData)
    return { "client-certificate-data": input.clientCertificateData, "client-key-data": input.clientKeyData };
  const authorization = String(input.authorization || "");
  if (/^Bearer\s+/i.test(authorization)) return { token: authorization.replace(/^Bearer\s+/i, "") };
  if (/^Basic\s+/i.test(authorization)) {
    const decoded = Buffer.from(authorization.replace(/^Basic\s+/i, ""), "base64").toString("utf8"),
      separator = decoded.indexOf(":");
    return {
      username: separator < 0 ? decoded : decoded.slice(0, separator),
      password: separator < 0 ? "" : decoded.slice(separator + 1),
    };
  }
  if (input.token) return { token: input.token };
  throw new Error("Kubeconfig credentials are required");
}
function createKubeconfig(input) {
  if (typeof input.server !== "string" || !input.server.startsWith("https://"))
    throw new Error("Kubernetes API must use HTTPS");
  const user = kubeconfigUser(input),
    directory = mkdtempSync(join(tmpdir(), "heimdall-companion-")),
    path = join(directory, "config.json"),
    context = String(input.context || "context"),
    config = {
      apiVersion: "v1",
      kind: "Config",
      clusters: [
        {
          name: "cluster",
          cluster: {
            server: input.server,
            "certificate-authority-data": input.certificateAuthorityData,
            "insecure-skip-tls-verify": Boolean(input.insecureSkipTlsVerify),
            ...(input.proxyUrl ? { "proxy-url": input.proxyUrl } : {}),
          },
        },
      ],
      users: [{ name: "user", user }],
      contexts: [
        { name: context, context: { cluster: "cluster", user: "user", namespace: input.namespace || "default" } },
      ],
      "current-context": context,
    };
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
function ensureTemporaryKubeconfig(input) {
  const requested = typeof input.id === "string" ? temporaryKubeconfigs.get(input.id) : undefined;
  if (requested && existsSync(requested.path))
    return { id: requested.id, path: requested.path, createdAt: requested.createdAt, reused: true };
  if (requested) {
    requested.cleanup();
    temporaryKubeconfigs.delete(requested.id);
  }
  const created = createKubeconfig(input),
    entry = { id: randomUUID(), path: created.path, createdAt: new Date().toISOString(), cleanup: created.cleanup };
  temporaryKubeconfigs.set(entry.id, entry);
  return { id: entry.id, path: entry.path, createdAt: entry.createdAt, reused: false };
}
function clearTemporaryKubeconfig(id) {
  const entry = temporaryKubeconfigs.get(id);
  if (!entry) return false;
  entry.cleanup();
  temporaryKubeconfigs.delete(id);
  return true;
}
function openKubeExec(input) {
  if (typeof input.server !== "string" || !input.server.startsWith("https://"))
    throw new Error("Kubernetes API must use HTTPS");
  if (typeof input.pod !== "string" || !input.pod) throw new Error("Pod is required");
  const kubeconfig = createKubeconfig(input),
    args = [
      "--kubeconfig",
      kubeconfig.path,
      "exec",
      "-i",
      "-n",
      input.namespace || "default",
      input.pod,
      ...(input.container ? ["-c", input.container] : []),
      "--",
      ...(Array.isArray(input.command) && input.command.length ? input.command : ["/bin/sh"]),
    ],
    child = spawnOrClean(
      input.kubectlPath || "kubectl",
      args,
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      kubeconfig,
    );
  return registerProcess(child, kubeconfig.cleanup);
}
function openKubePortForward(input) {
  if (typeof input.server !== "string" || !input.server.startsWith("https://"))
    throw new Error("Kubernetes API must use HTTPS");
  const name = String(input.name || input.pod || ""),
    kind = String(input.kind || "pod").toLowerCase(),
    address = String(input.address || "127.0.0.1").replace(/\s+/g, "");
  if (!name) throw new Error("Resource name is required");
  if (!/^[a-z0-9.-]+$/.test(kind)) throw new Error("Resource kind is invalid");
  if (!address || !/^[a-z0-9.:,[\]-]+$/i.test(address)) throw new Error("Forward address is invalid");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
    throw new Error("Resource port must be between 1 and 65535");
  const forwardPort =
      Number.isInteger(input.forwardPort) && input.forwardPort >= 0 && input.forwardPort <= 65535
        ? input.forwardPort
        : "",
    kubeconfig = createKubeconfig(input),
    args = [
      "--kubeconfig",
      kubeconfig.path,
      "port-forward",
      "--address",
      address,
      "-n",
      input.namespace || "default",
      `${kind}/${name}`,
      `${forwardPort}:${input.port}`,
    ],
    child = spawnOrClean(
      input.kubectlPath || "kubectl",
      args,
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      kubeconfig,
    );
  return registerProcess(child, kubeconfig.cleanup);
}
function exchangePortForward(session, data) {
  return new Promise((resolve, reject) => {
    if (!session.localPort) throw new Error("Port forward is not ready");
    const socket = connectTcp({ host: "127.0.0.1", port: session.localPort }),
      chunks = [];
    let timer;
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(Buffer.concat(chunks));
    };
    socket.on("connect", () => socket.write(data));
    socket.on("data", chunk => {
      chunks.push(chunk);
      clearTimeout(timer);
      timer = setTimeout(finish, 100);
    });
    socket.on("end", finish);
    socket.on("error", reject);
    timer = setTimeout(finish, 5000);
  });
}
const ignoredKubeconfigNames = new Set([".DS_Store", "cache", "desktop.ini", "kubectx", "kubens", "Thumbs.db"]);
function ignoredKubeconfig(name) {
  return (
    ignoredKubeconfigNames.has(name) ||
    /^\._|^\.#|^~/.test(name) ||
    /\.(?:bak|lock|sw[onp])$/.test(name) ||
    name.endsWith("#") ||
    name.endsWith("~")
  );
}
function expandUserPath(value) {
  const path = String(value || "").trim();
  // Both separators, on every platform. Windows only accepted `~\`, so the
  // universally typed `~/.kube/config` resolved against the companion's cwd and
  // silently missed the file — in a kubeconfig scan that looks like "no
  // clusters found" rather than an error.
  return path === "~"
    ? homedir()
    : path.startsWith("~/") || path.startsWith("~\\")
      ? join(homedir(), path.slice(2))
      : resolve(path);
}
function requiredPath(value) {
  const path = String(value || "").trim();
  if (!path) throw new Error("Path is required");
  return expandUserPath(path);
}
function safeMutationPath(value) {
  const path = requiredPath(value),
    root = parse(path).root;
  if (path === root || path === homedir()) throw new Error("Refusing to mutate a broad filesystem root");
  return path;
}
function fileType(stats) {
  return stats.isFile() ? "file" : stats.isDirectory() ? "folder" : stats.isSymbolicLink() ? "symlink" : "unknown";
}
function statPayload(path, useLstat = false) {
  const resolvedPath = requiredPath(path),
    stats = (useLstat ? lstatSync : statSync)(resolvedPath);
  return {
    path: resolvedPath,
    type: fileType(stats),
    size: stats.size,
    mode: stats.mode,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    birthtimeMs: stats.birthtimeMs,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymbolicLink: stats.isSymbolicLink(),
  };
}
function readDirectory(path, withFileTypes = false) {
  const resolvedPath = requiredPath(path),
    stats = statSync(resolvedPath);
  if (!stats.isDirectory()) throw new Error("Path is not a directory");
  const values = readdirSync(resolvedPath, { withFileTypes: true });
  if (values.length > 2048) throw new Error("Directory contains too many entries");
  const entries = values
    .map(entry =>
      withFileTypes
        ? {
            name: entry.name,
            type: entry.isFile()
              ? "file"
              : entry.isDirectory()
                ? "folder"
                : entry.isSymbolicLink()
                  ? "symlink"
                  : "unknown",
          }
        : entry.name,
    )
    .sort((left, right) =>
      (typeof left === "string" ? left : left.name).localeCompare(typeof right === "string" ? right : right.name),
    );
  return { path: resolvedPath, entries };
}
/** Read a file through one descriptor, so the size guard describes the bytes
 *  the caller actually gets.
 *
 *  `statSync(path)` followed by `readFileSync(path)` resolves the name twice,
 *  and the second lookup can land somewhere else — the guard then measures one
 *  file while the read drains another, which is how a limit gets walked past
 *  by swapping a small file for a large one (or for a symlink to `/dev/zero`)
 *  in between. `fstatSync` on an open descriptor asks about the same inode the
 *  read is about to consume, so there is no interval to win. */
function readThroughDescriptor(resolvedPath, { encoding = "utf8", maximum = 8 * 1024 * 1024, subject = "File" } = {}) {
  // O_NONBLOCK because opening now precedes the is-it-a-file test that used to
  // precede the open: a read-open of a FIFO blocks until someone writes, so a
  // named pipe left at ~/.kube/config would hang the scan rather than be
  // rejected by the fstat below. The flag is a no-op for regular files, and
  // absent on Windows, which has no filesystem FIFOs to begin with.
  const fd = openSync(resolvedPath, O_RDONLY | (O_NONBLOCK ?? 0));
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw new Error("Path is not a file");
    if (stats.size > maximum) throw new Error(`${subject} exceeds ${Math.round(maximum / 1024 / 1024)} MiB limit`);
    return { content: readFileSync(fd, encoding), size: stats.size, mtimeMs: stats.mtimeMs };
  } finally {
    closeSync(fd);
  }
}
function readTextFile(path) {
  const resolvedPath = requiredPath(path);
  return { path: resolvedPath, ...readThroughDescriptor(resolvedPath) };
}
function readBinaryFile(path) {
  const resolvedPath = requiredPath(path),
    { content, size, mtimeMs } = readThroughDescriptor(resolvedPath, { encoding: null });
  return { path: resolvedPath, contentBase64: content.toString("base64"), size, mtimeMs };
}
function writeFile(input) {
  const path = safeMutationPath(input.path),
    content =
      typeof input.contentBase64 === "string"
        ? Buffer.from(input.contentBase64, "base64")
        : String(input.content ?? "");
  if (Buffer.byteLength(content) > 8 * 1024 * 1024) throw new Error("File exceeds 8 MiB limit");
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  writeFileSync(path, content, { mode: Number.isInteger(input.mode) ? input.mode : 0o644 });
  return statPayload(path);
}
function ensureDirectory(path) {
  const resolvedPath = safeMutationPath(path);
  mkdirSync(resolvedPath, { recursive: true, mode: 0o755 });
  return statPayload(resolvedPath);
}
function copyPath(input) {
  const source = requiredPath(input.source),
    destination = safeMutationPath(input.destination);
  if (!existsSync(source)) throw new Error("Source path does not exist");
  mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
  cpSync(source, destination, {
    recursive: true,
    force: input.overwrite !== false,
    errorOnExist: input.overwrite === false,
  });
  return statPayload(destination, true);
}
function removePath(path, recursive = true) {
  const resolvedPath = safeMutationPath(path);
  rmSync(resolvedPath, { recursive: Boolean(recursive), force: true });
  return { path: resolvedPath, removed: !existsSync(resolvedPath) };
}
function unlinkPath(path) {
  const resolvedPath = safeMutationPath(path);
  unlinkSync(resolvedPath);
  return { path: resolvedPath, removed: !existsSync(resolvedPath) };
}
async function handleFilesystemRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
  if (!url.pathname.startsWith("/v1/fs/") || request.method === "OPTIONS") return false;
  if (!authorized(request)) {
    send(response, request, 401, { error: "Unauthorized" });
    return true;
  }
  if (request.method !== "POST") {
    send(response, request, 405, { error: "Method not allowed" });
    return true;
  }
  const input = await body(request);
  switch (url.pathname) {
    case "/v1/fs/stat":
      try {
        const result = statPayload(input.path);
        send(response, request, 200, input.details ? result : { path: result.path, type: result.type });
      } catch {
        send(response, request, 200, {
          path: String(input.path || ""),
          type: "unknown",
          ...(input.details ? { isFile: false, isDirectory: false, isSymbolicLink: false } : {}),
        });
      }
      return true;
    case "/v1/fs/lstat":
      send(response, request, 200, statPayload(input.path, true));
      return true;
    case "/v1/fs/path-exists": {
      const path = requiredPath(input.path);
      send(response, request, 200, { path, exists: existsSync(path) });
      return true;
    }
    case "/v1/fs/read-directory":
      send(response, request, 200, readDirectory(input.path, Boolean(input.withFileTypes)));
      return true;
    case "/v1/fs/read-file":
      send(response, request, 200, readTextFile(input.path));
      return true;
    case "/v1/fs/read-file-binary":
      send(response, request, 200, readBinaryFile(input.path));
      return true;
    case "/v1/fs/write-file":
      send(response, request, 200, writeFile(input));
      return true;
    case "/v1/fs/ensure-directory":
      send(response, request, 200, ensureDirectory(input.path));
      return true;
    case "/v1/fs/copy":
      send(response, request, 200, copyPath(input));
      return true;
    case "/v1/fs/remove":
      send(response, request, 200, removePath(input.path, input.recursive));
      return true;
    case "/v1/fs/unlink":
      send(response, request, 200, unlinkPath(input.path));
      return true;
    default:
      send(response, request, 404, { error: "Filesystem endpoint not found" });
      return true;
  }
}
function createServer(listener) {
  return createHttpServer(async (request, response) => {
    try {
      if (await handleFilesystemRequest(request, response)) return;
      await listener(request, response);
    } catch (error) {
      send(response, request, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
function scanKubeconfigs(input = {}) {
  const supplied = Array.isArray(input.paths) ? input.paths : [],
    environment = (process.env.KUBECONFIG || "").split(delimiter).filter(Boolean),
    roots = [...(input.includeDefault === false ? [] : [join(homedir(), ".kube")]), ...environment, ...supplied];
  if (roots.length > 64) throw new Error("At most 64 kubeconfig sources may be synchronized");
  const unique = [...new Set(roots.filter(value => typeof value === "string" && value.trim()).map(expandUserPath))],
    items = [],
    errors = [];
  let total = 0;
  const read = (path, root, maximum) => {
    try {
      const file = readThroughDescriptor(path, { maximum, subject: "Kubeconfig" });
      total += file.size;
      if (total > 64 * 1024 * 1024) throw new Error("Combined kubeconfig sources exceed 64 MiB");
      items.push({ path, root, ...file });
    } catch (error) {
      errors.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  };
  for (const root of unique) {
    try {
      const stats = statSync(root);
      if (stats.isDirectory()) {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
          // `isFile()` on a Dirent describes the entry itself, so a symlink
          // answers false — and a symlinked ~/.kube/config is what kubectx,
          // chezmoi and Nix all produce. Skipping it looked like "no clusters
          // found". statSync follows the link; a broken one throws and is
          // skipped, which is the same outcome as before for that case.
          if (ignoredKubeconfig(entry.name)) continue;
          try {
            if (!statSync(join(root, entry.name)).isFile()) continue;
          } catch {
            continue;
          }
          read(join(root, entry.name), root, 2 * 1024 * 1024);
        }
      } else read(root, root, 32 * 1024 * 1024);
    } catch (error) {
      if (error?.code !== "ENOENT")
        errors.push({ path: root, error: error instanceof Error ? error.message : String(error) });
    }
  }
  items.sort((a, b) => a.path.localeCompare(b.path));
  const revision = createHash("sha256")
    .update(items.map(item => `${item.path}\0${item.size}\0${item.mtimeMs}`).join("\n"))
    .digest("hex");
  return { roots: unique, items, errors, revision };
}
function checkKubectl(path) {
  return new Promise(resolve => {
    const bare = typeof path === "string" && !isAbsolute(path) && !path.includes("/") && !path.includes("\\");
    if (!path || (!bare && !existsSync(path))) {
      resolve({ valid: false, path, error: "Binary does not exist" });
      return;
    }
    const child = spawn(path, ["version", "--client", "--output", "json"], { windowsHide: true }),
      stdout = [],
      stderr = [];
    child.stdout.on("data", data => stdout.push(data));
    child.stderr.on("data", data => stderr.push(data));
    child.on("error", error => resolve({ valid: false, path, error: error.message }));
    child.on("exit", code => {
      try {
        const info = JSON.parse(Buffer.concat(stdout).toString("utf8"));
        resolve({
          valid: code === 0,
          path,
          version:
            info.clientVersion?.gitVersion ||
            (info.clientVersion?.major && `${info.clientVersion.major}.${info.clientVersion.minor}`),
          info,
        });
      } catch {
        resolve({
          valid: false,
          path,
          error: Buffer.concat(stderr).toString("utf8").trim() || `kubectl exited with ${code}`,
        });
      }
    });
  });
}
async function ensureKubectl(input) {
  const requested = String(input.version || "").replace(/^v/, "");
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(requested)) throw new Error("A Kubernetes semantic version is required");
  const [major, minor, patch] = requested.split(".");
  let stable = `v${requested}`;
  if (!patch) {
    const stableResponse = await fetch(`https://dl.k8s.io/release/stable-${major}.${minor}.txt`);
    if (!stableResponse.ok) throw new Error(`Unable to resolve kubectl version: ${stableResponse.status}`);
    stable = (await stableResponse.text()).trim();
  }
  if (!/^v\d+\.\d+\.\d+$/.test(stable)) throw new Error("Unable to resolve kubectl version");
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux",
    arch = process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "386" : "amd64",
    binary = process.platform === "win32" ? "kubectl.exe" : "kubectl",
    directory = join(kubectlDirectory, stable.slice(1)),
    destination = join(directory, binary),
    existing = await checkKubectl(destination);
  if (existing.valid) return { ...existing, downloaded: false };
  if (kubectlInstalls.has(destination)) return kubectlInstalls.get(destination);
  const operation = (async () => {
    mkdirSync(directory, { recursive: true });
    const url = `https://dl.k8s.io/release/${stable}/bin/${platform}/${arch}/${binary}`,
      [response, checksumResponse] = await Promise.all([fetch(url), fetch(`${url}.sha256`)]);
    if (!response.ok || !checksumResponse.ok) throw new Error(`kubectl download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 150 * 1024 * 1024) throw new Error("kubectl binary is unexpectedly large");
    const expected = (await checksumResponse.text()).trim().split(/\s+/)[0].toLowerCase(),
      actual = createHash("sha256").update(bytes).digest("hex");
    if (!expected || actual !== expected) throw new Error("kubectl checksum verification failed");
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, bytes, { mode: 0o755 });
      if (process.platform !== "win32") chmodSync(temporary, 0o755);
      rmSync(destination, { force: true });
      renameSync(temporary, destination);
    } finally {
      rmSync(temporary, { force: true });
    }
    const checked = await checkKubectl(destination);
    if (!checked.valid) {
      rmSync(destination, { force: true });
      throw new Error(checked.error || "Downloaded kubectl did not run");
    }
    return { ...checked, downloaded: true, url, sha256: actual };
  })().finally(() => kubectlInstalls.delete(destination));
  kubectlInstalls.set(destination, operation);
  return operation;
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || host}`),
      parts = url.pathname.split("/").filter(Boolean);
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers(request));
      response.end();
      return;
    }
    if (url.pathname === "/v1/health") {
      // No `shell` here: this endpoint answers before the auth check, and the
      // host's shell path is not something an unauthenticated caller needs. Its
      // only consumer (Preferences -> Test connection) reads name and version.
      send(response, request, 200, { name: "heimdall-companion", version: 1 });
      return;
    }
    if (!authorized(request)) {
      send(response, request, 401, { error: "Unauthorized" });
      return;
    }
    if (url.pathname === "/v1/proxy/resolve" && request.method === "POST") {
      const input = await body(request),
        target = new URL(input.url || "");
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("Invalid proxy target URL");
      send(response, request, 200, proxyDirective(target, input.proxyUrl));
      return;
    }
    if (url.pathname === "/v1/http/fetch" && request.method === "POST") {
      await proxyHttp(request, response, await body(request));
      return;
    }
    // `/v1/fs/*` is served entirely by handleFilesystemRequest above, whose
    // default branch answers 404 and returns true — so it claims every path
    // under that prefix. Three duplicate handlers used to sit here, unreachable,
    // and the shadowed `/v1/fs/stat` did not expand `~`, so anyone debugging a
    // tilde bug would have found and "fixed" the copy that never runs.
    if (url.pathname === "/v1/kubeconfigs/scan" && request.method === "POST") {
      send(response, request, 200, scanKubeconfigs(await body(request)));
      return;
    }
    if (url.pathname === "/v1/kubeconfigs/temporary" && request.method === "POST") {
      send(response, request, 200, ensureTemporaryKubeconfig(await body(request)));
      return;
    }
    if (
      parts[0] === "v1" &&
      parts[1] === "kubeconfigs" &&
      parts[2] === "temporary" &&
      parts[3] &&
      request.method === "DELETE"
    ) {
      send(response, request, clearTemporaryKubeconfig(parts[3]) ? 204 : 404);
      return;
    }
    if (url.pathname === "/v1/kubectl/check" && request.method === "POST") {
      const input = await body(request);
      send(response, request, 200, await checkKubectl(input.path || "kubectl"));
      return;
    }
    if (url.pathname === "/v1/kubectl/ensure" && request.method === "POST") {
      send(response, request, 200, await ensureKubectl(await body(request)));
      return;
    }
    if (url.pathname === "/v1/kube/proxy" && request.method === "POST") {
      await proxyKubernetes(request, response, await body(request));
      return;
    }
    if (url.pathname === "/v1/kube/exec" && request.method === "POST") {
      const session = openKubeExec(await body(request));
      send(response, request, 201, { id: session.id, pid: session.child.pid });
      return;
    }
    if (url.pathname === "/v1/kube/port-forward" && request.method === "POST") {
      const session = openKubePortForward(await body(request));
      send(response, request, 201, { id: session.id, pid: session.child.pid });
      return;
    }
    if (url.pathname === "/v1/credentials/exec" && request.method === "POST") {
      send(response, request, 200, await runCredential(await body(request)));
      return;
    }
    if (url.pathname === "/v1/sessions" && request.method === "POST") {
      const input = await body(request),
        shell = typeof input.shell === "string" && input.shell ? input.shell : defaultShell,
        args =
          Array.isArray(input.args) && input.args.every(value => typeof value === "string") ? input.args : defaultArgs,
        cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd(),
        environment = { ...process.env, ...(input.env && typeof input.env === "object" ? input.env : {}) },
        session = registerProcess(
          spawn(shell, args, { cwd, env: environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }),
        );
      send(response, request, 201, { id: session.id, pid: session.child.pid, shell, args, cwd });
      return;
    }
    if (parts[0] === "v1" && parts[1] === "sessions" && parts[2]) {
      const session = sessions.get(parts[2]);
      if (!session) {
        send(response, request, 404, { error: "Session not found" });
        return;
      }
      if (parts[3] === "output" && request.method === "GET") {
        const after = Number(url.searchParams.get("after") || 0),
          wait = Math.min(Number(url.searchParams.get("wait") || 0), 30000);
        if (!session.output.some(item => item.sequence > after) && session.state === "running" && wait > 0)
          await new Promise(resolve => {
            // The waiter has to come out of the list on *both* paths. Only the
            // push path removed it, so every idle long-poll that timed out left
            // its closure behind and the list grew for the life of the session.
            const waiter = () => {
              clearTimeout(timer);
              const at = session.waiters.indexOf(waiter);
              if (at >= 0) session.waiters.splice(at, 1);
              resolve();
            };
            const timer = setTimeout(waiter, wait);
            session.waiters.push(waiter);
          });
        send(response, request, 200, {
          items: session.output.filter(item => item.sequence > after),
          state: session.state,
          exitCode: session.exitCode,
          signal: session.signal,
          localPort: session.localPort,
        });
        return;
      }
      if (parts[3] === "input" && request.method === "POST") {
        const input = await body(request);
        if (session.state !== "running") {
          send(response, request, 409, { error: "Session is closed" });
          return;
        }
        session.child.stdin.write(String(input.data || ""));
        send(response, request, 202, { accepted: true });
        return;
      }
      if (parts[3] === "data" && request.method === "POST") {
        const input = await body(request),
          result = await exchangePortForward(session, Buffer.from(input.data || "", "base64"));
        send(response, request, 200, { data: result.toString("base64") });
        return;
      }
      if (parts[3] === "resize" && request.method === "PATCH") {
        send(response, request, 204);
        return;
      }
      if (request.method === "DELETE") {
        session.child.kill();
        session.cleanup?.();
        sessions.delete(session.id);
        send(response, request, 204);
        return;
      }
    }
    send(response, request, 404, { error: "Not found" });
  } catch (error) {
    send(response, request, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});
server.listen(port, host, () => {
  console.log(`Heimdall companion listening on http://${host}:${port}`);
  // Only echo a token this process invented, and only once. When the operator
  // supplied HEIMDALL_COMPANION_TOKEN they already have it, and printing it
  // again just copies a credential that grants shell and filesystem access into
  // journald, the container log, and CI output.
  if (env("TOKEN")) console.log("HEIMDALL_COMPANION_TOKEN=<from environment>");
  else console.log(`HEIMDALL_COMPANION_TOKEN=${token}`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const session of sessions.values()) {
      session.child.kill();
      // Exec and port-forward stash their temp kubeconfig's cleanup here, and
      // it is a different map from `temporaryKubeconfigs`. Killing the child
      // and exiting left those files — each holding a bearer token or a client
      // key — in the system temp directory. `process.exit` also raced the
      // child's own exit handler, so the cleanup usually never ran.
      try {
        session.cleanup?.();
      } catch {
        // Best effort: keep shutting down.
      }
    }
    for (const kubeconfig of temporaryKubeconfigs.values()) kubeconfig.cleanup();
    server.close(() => process.exit(0));
  });
}

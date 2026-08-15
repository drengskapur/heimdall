// A tiny module-level store of active pod port-forwards, shared between the pod
// drawer's Forward tab (which starts them) and the Port Forwarding page (which
// lists/stops them). Forwards run through the hexagon
// (`activeCluster().gateway.portForward`) — for client-cert clusters that is the
// companion's `kubectl port-forward`, which assigns a local port.

import type { PortForwardSession } from "../application/ports/kubernetes-gateway";
import { ResourceRef } from "../domain/values/resource-ref";
import { activeCluster } from "../infrastructure/composition-root";

export interface Forward {
  readonly id: string;
  readonly podRef: ResourceRef;
  readonly podName: string;
  readonly namespace: string;
  readonly podPort: number;
  /** When forwarding a higher-level object (e.g. a Service), what the user
   *  asked for — shown instead of the resolved pod. */
  readonly origin?: { readonly kind: string; readonly name: string; readonly port: number };
  localPort?: number;
  status: "starting" | "active" | "error" | "closed";
  message?: string;
  session?: PortForwardSession;
}

let forwards: Forward[] = [];
const listeners = new Set<() => void>();
let counter = 0;

function emit() {
  const snapshot = forwards;
  for (const l of listeners) l();
  return snapshot;
}

/** Subscribe to store changes; returns an unsubscribe. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current active/starting forwards (newest first). */
export function listForwards(): readonly Forward[] {
  return forwards;
}

/** Start forwarding a pod port. Returns the forward id. */
export function startForward(podRef: ResourceRef, podPort: number, origin?: Forward["origin"]): string {
  const cluster = activeCluster();
  const id = `pf-${++counter}`;
  const forward: Forward = {
    id,
    podRef,
    podName: podRef.name,
    namespace: podRef.namespace ?? "default",
    podPort,
    origin,
    status: "starting",
  };
  forwards = [forward, ...forwards];
  emit();
  if (!cluster) {
    update(id, { status: "error", message: "No active cluster" });
    return id;
  }
  try {
    const session = cluster.gateway.portForward(podRef, podPort, {
      onReady: details => update(id, { status: "active", localPort: details.localPort }),
      onData: () => {},
      onError: message => update(id, { status: "error", message }),
      onClose: () => update(id, { status: "closed" }),
    });
    update(id, { session });
  } catch (error) {
    update(id, { status: "error", message: error instanceof Error ? error.message : String(error) });
  }
  return id;
}

interface EndpointSubset {
  addresses?: Array<{ targetRef?: { kind?: string; name?: string; namespace?: string } }>;
  ports?: Array<{ name?: string; port?: number }>;
}

/** A `discovery.k8s.io/v1` EndpointSlice, the modern backing for a Service. */
interface EndpointSlice {
  metadata?: { labels?: Record<string, string> };
  addressType?: string;
  ports?: Array<{ name?: string; port?: number }>;
  endpoints?: Array<{
    conditions?: { ready?: boolean };
    targetRef?: { kind?: string; name?: string; namespace?: string };
  }>;
}

/** One backing pod and the ports its slice/subset publishes. */
interface Backend {
  readonly pod: { name: string; namespace?: string };
  readonly ports: ReadonlyArray<{ name?: string; port?: number }>;
}

/** Forward a Service by resolving it to a ready backing pod + target port via
 *  its Endpoints (kubectl `port-forward svc/…` semantics), then forwarding that
 *  pod port. Resolves to the new forward's id, or throws if no ready endpoint. */
export async function startServiceForward(
  serviceRef: ResourceRef,
  servicePort: number,
  portName?: string,
): Promise<string> {
  const cluster = activeCluster();
  if (!cluster) throw new Error("No active cluster");
  // EndpointSlices first, Endpoints second.
  //
  // Endpoints is deprecated as of Kubernetes 1.33. It is still populated today —
  // checked against a live 1.36 cluster, where kube-dns has both — because the
  // control plane keeps writing mirror objects for compatibility. But that
  // mirroring is what is going away, and it already stops for Services with more
  // than 1000 endpoints, where the mirror is truncated rather than absent. Slices
  // are also the better source regardless: readiness is an explicit
  // `conditions.ready` per endpoint, where Endpoints encodes it structurally by
  // splitting addresses across two arrays.
  const backends =
    (await backendsFromSlices(cluster, serviceRef)) ?? (await backendsFromEndpoints(cluster, serviceRef));

  // An EndpointPort carries the *target* port — the container's — not the
  // service's. Matching it against `servicePort` therefore only works when the
  // two happen to coincide, and the old `?? ports[0]` fallback silently picked
  // the first endpoint port whenever they did not: a Service exposing 80 with
  // targetPort 8080, backed by a pod publishing [9090, 8080], forwarded 9090
  // and looked like it had worked.
  //
  // Kubernetes does guarantee the names line up — a multi-port Service must name
  // every port, and each EndpointPort takes the matching ServicePort's name — so
  // the name is the key. The service's own `targetPort` is the fallback when it
  // is numeric, and beyond that this refuses to guess.
  const service = await cluster.resources.get(serviceRef, "services").catch(() => null);
  const servicePorts =
    (
      service?.raw as
        | { spec?: { ports?: { name?: string; port?: number; targetPort?: number | string }[] } }
        | undefined
    )?.spec?.ports ?? [];
  const matchedServicePort = servicePorts.find(p => p.port === servicePort);
  const wantName = portName ?? matchedServicePort?.name;
  const wantTarget = typeof matchedServicePort?.targetPort === "number" ? matchedServicePort.targetPort : undefined;

  for (const backend of backends) {
    const ports = backend.ports;
    const epPort =
      (wantName ? ports.find(p => p.name === wantName) : undefined) ??
      (wantTarget !== undefined ? ports.find(p => p.port === wantTarget) : undefined) ??
      (ports.length === 1 ? ports[0] : undefined);
    if (epPort?.port == null) {
      throw new Error(
        `Could not tell which pod port backs ${serviceRef.name}:${servicePort} — the endpoints expose ` +
          `${ports.map(p => p.name ?? p.port).join(", ") || "none"}. Forward the pod directly.`,
      );
    }
    const podRef = ResourceRef.of({
      apiVersion: "v1",
      kind: "Pod",
      name: backend.pod.name,
      namespace: backend.pod.namespace || serviceRef.namespace,
    });
    return startForward(podRef, Number(epPort.port), { kind: "Service", name: serviceRef.name, port: servicePort });
  }
  throw new Error("No ready endpoints for this service (are its pods running?)");
}

/** Stop and remove a forward. */
export function stopForward(id: string): void {
  const forward = forwards.find(f => f.id === id);
  try {
    forward?.session?.close();
  } catch {
    /* already closed */
  }
  forwards = forwards.filter(f => f.id !== id);
  emit();
}

/** Stop every forward — called on cluster switch (forwards belong to a cluster). */
export function stopAllForwards(): void {
  for (const forward of forwards) {
    try {
      forward.session?.close();
    } catch {
      /* already closed */
    }
  }
  forwards = [];
  emit();
}

function update(id: string, patch: Partial<Forward>): void {
  forwards = forwards.map(f => (f.id === id ? { ...f, ...patch } : f));
  emit();
}

/** Ready pod backends from the Service's EndpointSlices, or null if none exist.
 *
 *  Null rather than an empty list is the distinction that matters: "this cluster
 *  serves no slices for the service" means fall back to Endpoints, whereas "the
 *  slices exist and list no ready pods" is an answer. */
async function backendsFromSlices(
  cluster: NonNullable<ReturnType<typeof activeCluster>>,
  serviceRef: ResourceRef,
): Promise<Backend[] | null> {
  const objects = await cluster.resources
    .list({
      apiVersion: "discovery.k8s.io/v1",
      kind: "EndpointSlice",
      resource: "endpointslices",
      namespace: serviceRef.namespace,
    })
    // No discovery API, or no RBAC for it: fall back rather than fail.
    .catch(() => null);
  if (!objects) return null;
  // The query has no label selector, so the owning Service is matched here.
  const slices = objects
    .map(o => o.raw as EndpointSlice)
    .filter(slice => slice.metadata?.labels?.["kubernetes.io/service-name"] === serviceRef.name);
  if (!slices.length) return null;
  const backends: Backend[] = [];
  for (const slice of slices) {
    // IPv6 and FQDN slices describe the same pods; forwarding is by pod name, so
    // one address family is enough and IPv4 is the one every cluster has.
    if (slice.addressType && slice.addressType !== "IPv4") continue;
    for (const endpoint of slice.endpoints ?? []) {
      if (endpoint.conditions?.ready === false) continue;
      if (endpoint.targetRef?.kind !== "Pod" || !endpoint.targetRef.name) continue;
      backends.push({
        pod: { name: endpoint.targetRef.name, namespace: endpoint.targetRef.namespace },
        ports: slice.ports ?? [],
      });
    }
  }
  return backends;
}

/** The same, from the legacy Endpoints object. */
async function backendsFromEndpoints(
  cluster: NonNullable<ReturnType<typeof activeCluster>>,
  serviceRef: ResourceRef,
): Promise<Backend[]> {
  const epRef = ResourceRef.of({
    apiVersion: "v1",
    kind: "Endpoints",
    name: serviceRef.name,
    namespace: serviceRef.namespace,
  });
  const endpoints = await cluster.resources.get(epRef, "endpoints").catch(() => null);
  const subsets = (endpoints?.raw as { subsets?: EndpointSubset[] } | undefined)?.subsets ?? [];
  const backends: Backend[] = [];
  for (const subset of subsets) {
    // Only `addresses` — `notReadyAddresses` is the other array, and that is how
    // Endpoints expresses what slices say with `conditions.ready`.
    for (const address of subset.addresses ?? []) {
      if (address?.targetRef?.kind !== "Pod" || !address.targetRef.name) continue;
      backends.push({
        pod: { name: address.targetRef.name, namespace: address.targetRef.namespace },
        ports: subset.ports ?? [],
      });
    }
  }
  return backends;
}

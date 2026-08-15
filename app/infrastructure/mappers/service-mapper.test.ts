import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceView } from "../../domain/network/service";
import { toServiceDomain } from "./service-mapper";

test("maps a ClusterIP service with ports and selector", () => {
  const svc = toServiceDomain({
    metadata: { name: "kube-dns", namespace: "kube-system" },
    spec: {
      type: "ClusterIP",
      clusterIP: "10.43.0.10",
      selector: { app: "coredns" },
      ports: [{ name: "dns", port: 53, protocol: "UDP" }],
    },
  });
  assert.equal(svc.type, "ClusterIP");
  assert.equal(ServiceView.isHeadless(svc), false);
  assert.equal(ServiceView.portsSummary(svc), "53/UDP");
  assert.deepEqual(svc.selector, { app: "coredns" });
});

test("maps ref, clusterIP, external IPs, and port protocol default", () => {
  const svc = toServiceDomain({
    metadata: { name: "web", namespace: "apps", uid: "u2", creationTimestamp: "2026-01-01T00:00:00Z" },
    spec: {
      type: "NodePort",
      clusterIP: "10.0.0.5",
      externalIPs: ["1.2.3.4"],
      ports: [{ port: 8080, nodePort: 31000 }],
    },
  });
  assert.equal(svc.ref.namespace, "apps");
  assert.equal(svc.ref.uid, "u2");
  assert.equal(svc.clusterIP, "10.0.0.5");
  assert.deepEqual(svc.externalIPs, ["1.2.3.4"]);
  assert.equal(svc.ports[0].protocol, "TCP", "protocol defaults to TCP");
  assert.equal(svc.ports[0].nodePort, 31000);
  assert.equal(svc.createdAt, "2026-01-01T00:00:00Z");
  assert.deepEqual(ServiceView.externalEndpoints(svc), ["1.2.3.4"]);
});

test("maps targetPort and defaults missing port number to 0", () => {
  const svc = toServiceDomain({ metadata: { name: "s" }, spec: { ports: [{ targetPort: "http" }] } });
  assert.equal(svc.ports[0].port, 0);
  assert.equal(svc.ports[0].targetPort, "http");
  assert.equal(svc.ports[0].protocol, "TCP");
  assert.equal(svc.type, "ClusterIP", "missing type defaults to ClusterIP");
  assert.deepEqual(svc.selector, {}, "missing selector → empty object");
});

test("portsSummary joins multiple ports and omits nodePort when absent", () => {
  const svc = toServiceDomain({
    metadata: { name: "multi" },
    spec: {
      ports: [
        { port: 80, protocol: "TCP" },
        { port: 443, protocol: "TCP", nodePort: 30443 },
      ],
    },
  });
  assert.equal(ServiceView.portsSummary(svc), "80/TCP, 443:30443/TCP");
});

test("load-balancer endpoints include hostnames", () => {
  const lb = toServiceDomain({
    metadata: { name: "web" },
    spec: { type: "LoadBalancer" },
    status: { loadBalancer: { ingress: [{ hostname: "lb.example.com" }] } },
  });
  assert.deepEqual(ServiceView.externalEndpoints(lb), ["lb.example.com"]);
});

test("detects headless services and load-balancer endpoints", () => {
  assert.equal(
    ServiceView.isHeadless(toServiceDomain({ metadata: { name: "headless" }, spec: { clusterIP: "None" } })),
    true,
  );
  const lb = toServiceDomain({
    metadata: { name: "web" },
    spec: { type: "LoadBalancer", ports: [{ port: 80, protocol: "TCP", nodePort: 30080 }] },
    status: { loadBalancer: { ingress: [{ ip: "203.0.113.4" }] } },
  });
  assert.equal(ServiceView.portsSummary(lb), "80:30080/TCP");
  assert.deepEqual(ServiceView.externalEndpoints(lb), ["203.0.113.4"]);
});

// The load-balancer chain and the port defaults were never asserted.

test("load-balancer ingress takes ip or hostname, and drops entries with neither", () => {
  const service = toServiceDomain({
    metadata: { name: "web" },
    spec: { type: "LoadBalancer" },
    status: { loadBalancer: { ingress: [{ ip: "1.2.3.4" }, { hostname: "lb.example.com" }, {}] } },
  });
  assert.deepEqual(service.loadBalancerIngress, ["1.2.3.4", "lb.example.com"]);

  // Every step of the chain can be the one that is missing: no status, a status
  // with no loadBalancer, and — the case that actually dereferences — a
  // loadBalancer that has not been assigned an ingress yet.
  assert.deepEqual(toServiceDomain({ metadata: { name: "web" } }).loadBalancerIngress, []);
  assert.deepEqual(toServiceDomain({ metadata: { name: "web" }, status: {} }).loadBalancerIngress, []);
  assert.deepEqual(
    toServiceDomain({ metadata: { name: "web" }, status: { loadBalancer: {} } }).loadBalancerIngress,
    [],
  );
});

test("ports default their protocol and port number", () => {
  const service = toServiceDomain({
    metadata: { name: "web" },
    spec: { ports: [{ name: undefined, port: undefined, protocol: undefined }] },
  });
  assert.deepEqual(service.ports, [
    { name: undefined, port: 0, protocol: "TCP", targetPort: undefined, nodePort: undefined },
  ]);
  assert.deepEqual(toServiceDomain({ metadata: { name: "web" }, spec: {} }).ports, []);
});

test("a service without a name is refused rather than given a placeholder", () => {
  assert.throws(() => toServiceDomain({ metadata: {} }), /name/i);
});

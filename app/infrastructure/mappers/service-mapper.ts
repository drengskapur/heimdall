// Maps a Kubernetes Service object into the Service domain entity.

import type { Service } from "../../domain/network/service";
import { ResourceRef } from "../../domain/values/resource-ref";
import type { WireService } from "../../lib/kube-generated"; // generated k8s Service schema at the seam

export function toServiceDomain(wire: WireService): Service {
  const meta = wire.metadata || {};
  const spec = wire.spec || {};
  return {
    ref: ResourceRef.of({
      apiVersion: "v1",
      kind: "Service",
      name: meta.name || "",
      namespace: meta.namespace,
      uid: meta.uid,
    }),
    type: spec.type || "ClusterIP",
    clusterIP: spec.clusterIP,
    ports: (spec.ports || []).map(p => ({
      name: p.name,
      port: p.port ?? 0,
      protocol: p.protocol || "TCP",
      targetPort: p.targetPort,
      nodePort: p.nodePort,
    })),
    selector: (spec.selector as Record<string, string>) || {},
    externalIPs: spec.externalIPs || [],
    loadBalancerIngress: wire.status?.loadBalancer?.ingress?.map(i => i.ip || i.hostname || "").filter(Boolean) ?? [],
    createdAt: meta.creationTimestamp,
  };
}

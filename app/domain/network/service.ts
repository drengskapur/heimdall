// Service domain entity and service. Captures the derived views Lens shows: the
// service type, whether it is headless, a port summary, and external endpoints.
import type { ResourceRef } from "../values/resource-ref";

export type ServiceType = "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName" | (string & {});

export interface ServicePort {
  name?: string;
  port: number;
  protocol: string;
  targetPort?: number | string;
  nodePort?: number;
}

export interface Service {
  ref: ResourceRef;
  type: ServiceType;
  clusterIP?: string;
  ports: ServicePort[];
  selector: Record<string, string>;
  externalIPs: string[];
  loadBalancerIngress: string[];
  createdAt?: string;
}

export const ServiceView = {
  /** clusterIP "None" denotes a headless service. */
  isHeadless(service: Service): boolean {
    return service.clusterIP === "None";
  },

  portsSummary(service: Service): string {
    return service.ports.map(p => `${p.port}${p.nodePort ? `:${p.nodePort}` : ""}/${p.protocol}`).join(", ");
  },

  /** External IPs plus any load-balancer ingress addresses. */
  externalEndpoints(service: Service): string[] {
    return [...service.externalIPs, ...service.loadBalancerIngress];
  },
};

// Application use-cases for network resources.

import { type Service, ServiceView } from "../../domain/network/service";
import type { KubernetesGateway } from "../ports/kubernetes-gateway";

export interface ServiceListItem {
  service: Service;
  ports: string;
  endpoints: string[];
  headless: boolean;
}

export class ServiceUseCases {
  constructor(private readonly gateway: KubernetesGateway) {}

  async list(namespace?: string): Promise<ServiceListItem[]> {
    const services = await this.gateway.listServices(namespace);
    return services.map(service => ({
      service,
      ports: ServiceView.portsSummary(service),
      endpoints: ServiceView.externalEndpoints(service),
      headless: ServiceView.isHeadless(service),
    }));
  }
}

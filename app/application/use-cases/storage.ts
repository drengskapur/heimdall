// Application use-cases for persistent storage.

import { type PersistentVolume, type PersistentVolumeClaim, VolumeStatus } from "../../domain/storage/volume";
import type { KubernetesGateway } from "../ports/kubernetes-gateway";

export class StorageUseCases {
  constructor(private readonly gateway: KubernetesGateway) {}

  async listClaims(namespace?: string): Promise<Array<{ claim: PersistentVolumeClaim; bound: boolean }>> {
    const claims = await this.gateway.listPersistentVolumeClaims(namespace);
    return claims.map(claim => ({ claim, bound: VolumeStatus.isBound(claim) }));
  }

  async listVolumes(): Promise<Array<{ volume: PersistentVolume; bound: boolean }>> {
    const volumes = await this.gateway.listPersistentVolumes();
    return volumes.map(volume => ({ volume, bound: VolumeStatus.isBound(volume) }));
  }
}

// Persistent storage domain: PersistentVolumeClaim and PersistentVolume, with the
// binding/phase views the UI presents.
import type { ResourceRef } from "../values/resource-ref";

export type VolumePhase = "Pending" | "Bound" | "Available" | "Released" | "Failed" | "Lost" | (string & {});

export interface PersistentVolumeClaim {
  ref: ResourceRef;
  phase?: VolumePhase;
  storageClass?: string;
  volumeName?: string;
  capacity?: string;
  accessModes: string[];
  createdAt?: string;
}

export interface PersistentVolume {
  ref: ResourceRef;
  phase?: VolumePhase;
  storageClass?: string;
  capacity?: string;
  reclaimPolicy?: string;
  claim?: string;
  accessModes: string[];
  createdAt?: string;
}

export const VolumeStatus = {
  isBound(volume: { phase?: VolumePhase }): boolean {
    return volume.phase === "Bound";
  },
};

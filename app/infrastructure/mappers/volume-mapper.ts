// Maps Kubernetes PersistentVolumeClaim / PersistentVolume objects into the
// storage domain entities.

import type { PersistentVolume, PersistentVolumeClaim } from "../../domain/storage/volume";
import { ResourceRef } from "../../domain/values/resource-ref";
// Generated k8s PVC/PV schemas at the seam.
import type { WirePersistentVolume as WirePv, WirePersistentVolumeClaim as WirePvc } from "../../lib/kube-generated";

export function toPvcDomain(wire: WirePvc): PersistentVolumeClaim {
  const meta = wire.metadata || {};
  return {
    ref: ResourceRef.of({
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      name: meta.name || "",
      namespace: meta.namespace,
      uid: meta.uid,
    }),
    phase: wire.status?.phase,
    storageClass: wire.spec?.storageClassName,
    volumeName: wire.spec?.volumeName,
    capacity: wire.status?.capacity?.storage ?? wire.spec?.resources?.requests?.storage,
    accessModes: wire.spec?.accessModes || [],
    createdAt: meta.creationTimestamp,
  };
}

export function toPvDomain(wire: WirePv): PersistentVolume {
  const meta = wire.metadata || {};
  const claim = wire.spec?.claimRef;
  return {
    ref: ResourceRef.of({ apiVersion: "v1", kind: "PersistentVolume", name: meta.name || "", uid: meta.uid }),
    phase: wire.status?.phase,
    storageClass: wire.spec?.storageClassName,
    capacity: wire.spec?.capacity?.storage,
    reclaimPolicy: wire.spec?.persistentVolumeReclaimPolicy,
    claim: claim ? [claim.namespace, claim.name].filter(Boolean).join("/") : undefined,
    accessModes: wire.spec?.accessModes || [],
    createdAt: meta.creationTimestamp,
  };
}

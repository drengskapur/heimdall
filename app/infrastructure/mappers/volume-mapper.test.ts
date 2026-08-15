import assert from "node:assert/strict";
import { test } from "node:test";
import { VolumeStatus } from "../../domain/storage/volume";
import { toPvcDomain, toPvDomain } from "./volume-mapper";

test("maps a bound PVC with capacity and storage class", () => {
  const pvc = toPvcDomain({
    metadata: { name: "data", namespace: "default" },
    spec: {
      storageClassName: "standard",
      volumeName: "pv-1",
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: "1Gi" } },
    },
    status: { phase: "Bound", capacity: { storage: "1Gi" } },
  });
  assert.equal(pvc.storageClass, "standard");
  assert.equal(pvc.capacity, "1Gi");
  assert.equal(VolumeStatus.isBound(pvc), true);
});

test("PVC falls back to requested storage and maps access modes + ref", () => {
  const pvc = toPvcDomain({
    metadata: { name: "data", namespace: "team", uid: "u3", creationTimestamp: "2026-01-01T00:00:00Z" },
    spec: { storageClassName: "fast", accessModes: ["ReadWriteMany"], resources: { requests: { storage: "5Gi" } } },
    status: { phase: "Pending" },
  });
  assert.equal(pvc.ref.namespace, "team");
  assert.equal(pvc.ref.uid, "u3");
  assert.equal(pvc.capacity, "5Gi", "no status capacity → falls back to requested");
  assert.deepEqual(pvc.accessModes, ["ReadWriteMany"]);
  assert.equal(pvc.createdAt, "2026-01-01T00:00:00Z");
  assert.equal(VolumeStatus.isBound(pvc), false);
});

test("PVC with no spec/status falls back to safe defaults", () => {
  const pvc = toPvcDomain({ metadata: { name: "bare" } });
  assert.deepEqual(pvc.accessModes, []);
  assert.equal(pvc.capacity, undefined);
  assert.equal(pvc.phase, undefined);
  assert.equal(pvc.storageClass, undefined);
  assert.equal(pvc.volumeName, undefined);
});

test("PV with no spec/status falls back to safe defaults", () => {
  const pv = toPvDomain({ metadata: { name: "bare" } });
  assert.deepEqual(pv.accessModes, []);
  assert.equal(pv.capacity, undefined);
  assert.equal(pv.reclaimPolicy, undefined);
  assert.equal(pv.claim, undefined);
  assert.equal(pv.phase, undefined);
});

test("PV without a claim leaves claim undefined", () => {
  const pv = toPvDomain({
    metadata: { name: "pv-2" },
    spec: { capacity: { storage: "2Gi" }, accessModes: ["ReadWriteOnce"] },
    status: { phase: "Available" },
  });
  assert.equal(pv.claim, undefined);
  assert.equal(pv.capacity, "2Gi");
  assert.deepEqual(pv.accessModes, ["ReadWriteOnce"]);
  assert.equal(VolumeStatus.isBound(pv), false);
});

test("maps a PV with reclaim policy and bound claim", () => {
  const pv = toPvDomain({
    metadata: { name: "pv-1" },
    spec: {
      capacity: { storage: "1Gi" },
      persistentVolumeReclaimPolicy: "Delete",
      storageClassName: "standard",
      claimRef: { namespace: "default", name: "data" },
    },
    status: { phase: "Bound" },
  });
  assert.equal(pv.reclaimPolicy, "Delete");
  assert.equal(pv.claim, "default/data");
  assert.equal(VolumeStatus.isBound(pv), true);
});

// Mutation testing showed the name fallbacks and the capacity chain were never
// exercised: a claim always arrived with a name and a status.

test("a claim falls back to its requested size when the bound capacity is absent", () => {
  const requested = toPvcDomain({
    metadata: { name: "data", namespace: "shop" },
    spec: { resources: { requests: { storage: "8Gi" } } },
  });
  assert.equal(requested.capacity, "8Gi");

  // A spec with no resources at all must not throw on the way through.
  const neither = toPvcDomain({ metadata: { name: "data" }, spec: {} });
  assert.equal(neither.capacity, undefined);
  const noRequests = toPvcDomain({ metadata: { name: "data" }, spec: { resources: {} } });
  assert.equal(noRequests.capacity, undefined);

  // Bound capacity wins over the request when both are present.
  const bound = toPvcDomain({
    metadata: { name: "data" },
    spec: { resources: { requests: { storage: "8Gi" } } },
    status: { capacity: { storage: "10Gi" } },
  });
  assert.equal(bound.capacity, "10Gi");
});

test("a volume without a name is refused rather than given a placeholder", () => {
  assert.throws(() => toPvcDomain({ metadata: {} }), /name/i);
  assert.throws(() => toPvDomain({ metadata: {} }), /name/i);
});

test("a persistent volume without capacity does not dereference it", () => {
  const pv = toPvDomain({ metadata: { name: "pv-1" }, spec: { storageClassName: "standard" } });
  assert.equal(pv.capacity, undefined);
  assert.equal(pv.storageClass, "standard");
});

test("a claim reference without a namespace does not gain a leading slash", () => {
  const bound = toPvDomain({
    metadata: { name: "pv-1" },
    spec: { claimRef: { namespace: "shop", name: "data" } },
  });
  assert.equal(bound.claim, "shop/data");

  const clusterScoped = toPvDomain({ metadata: { name: "pv-2" }, spec: { claimRef: { name: "data" } } });
  assert.equal(clusterScoped.claim, "data");
});

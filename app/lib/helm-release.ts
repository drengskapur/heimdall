// Helm release operations that go through the cluster rather than the companion:
// reading a release's revision history, and rolling back to one of them.
//
// This module used to carry a direct port of Lens's Electron internals — IPC
// channel descriptors (`getHelmReleaseChannel`), its `Result<T>` envelope with
// `callWasSuccessful`, `KubeJsonApiData`, a MobX-shaped `ObservableValue`, and a
// `ReleaseDetailsModel` with an injected-dependencies record. None of it was
// reachable: this is a browser SPA with a hexagonal core, so releases are
// modelled in `app/domain/helm` and transported by
// `app/infrastructure/helm/helm-gateway.ts`. The two functions below were the
// only things anything imported.

import { runHelmOperation } from "./helm";
import { type ClusterProfile, listHelmReleaseHistory } from "./kubernetes";

/** One entry of `helm history` for a release. */
export interface HelmReleaseRevision {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

export type RequestHelmReleaseHistory = (name: string, namespace: string) => Promise<HelmReleaseRevision[]>;

/** Revisions of one release, newest first.
 *
 *  Helm stores every release in a namespace under the same secret prefix, so the
 *  cluster call returns the whole namespace's history and the name filter has to
 *  happen here. */
export function createRequestHelmReleaseHistory(profile: ClusterProfile): RequestHelmReleaseHistory {
  return async (name, namespace) =>
    (await listHelmReleaseHistory(profile, namespace))
      .filter(item => item.name === name)
      .map(item => ({
        revision: item.version,
        updated: item.info?.last_deployed || "",
        status: item.info?.status || "",
        chart: [item.chart?.metadata?.name, item.chart?.metadata?.version].filter(Boolean).join("-"),
        app_version: item.chart?.metadata?.appVersion || "",
        description: item.info?.description || "",
      }))
      .sort((a, b) => b.revision - a.revision);
}

export type RollbackRelease = (name: string, namespace: string, revision: number) => Promise<void>;

export function createRollbackRelease(profile: ClusterProfile): RollbackRelease {
  return async (name, namespace, revision) => {
    await runHelmOperation(profile, { kind: "rollback", release: name, namespace, revision });
  };
}

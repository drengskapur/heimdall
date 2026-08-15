// Driven port for the Helm bounded context. Kept separate from KubernetesGateway
// because Helm is its own subdomain (releases, revisions, rollback), not a
// Kubernetes resource.
import type { HelmRelease, HelmReleaseRevision } from "../../domain/helm/helm-release";

/** A chart install/upgrade request (runs helm as an in-cluster Job). */
export interface HelmInstall {
  readonly release: string;
  readonly namespace: string;
  readonly chart: string; // repo/chart, or a chart .tgz URL
  readonly version?: string;
  readonly values?: string; // YAML
}

export interface HelmGateway {
  listReleases(namespace?: string): Promise<HelmRelease[]>;
  releaseHistory(name: string, namespace: string): Promise<HelmReleaseRevision[]>;
  rollback(name: string, namespace: string, revision: number): Promise<void>;
  /** Install (or upgrade) a chart — helm upgrade --install via an in-cluster Job. */
  install(args: HelmInstall): Promise<string>;
  /** Uninstall a release. */
  uninstall(release: string, namespace: string): Promise<string>;
}

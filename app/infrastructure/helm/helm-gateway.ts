// Driven adapter for the Helm bounded context, implemented over the existing
// Helm transport (companion-backed helm operations).
import type { HelmGateway, HelmInstall } from "../../application/ports/helm-gateway";
import type { HelmRelease, HelmReleaseRevision } from "../../domain/helm/helm-release";
import { runHelmOperation } from "../../lib/helm";
import { createRequestHelmReleaseHistory, createRollbackRelease } from "../../lib/helm-release";
import type { ClusterProfile } from "../../lib/kube-generated";
import { listHelmReleases } from "../../lib/kubernetes";

export class CompanionHelmGateway implements HelmGateway {
  constructor(private readonly profile: ClusterProfile) {}

  async listReleases(namespace?: string): Promise<HelmRelease[]> {
    return await listHelmReleases(this.profile, namespace || "");
  }

  releaseHistory(name: string, namespace: string): Promise<HelmReleaseRevision[]> {
    return createRequestHelmReleaseHistory(this.profile)(name, namespace);
  }

  rollback(name: string, namespace: string, revision: number): Promise<void> {
    return createRollbackRelease(this.profile)(name, namespace, revision);
  }

  install(args: HelmInstall): Promise<string> {
    return runHelmOperation(this.profile, {
      kind: "install",
      release: args.release,
      namespace: args.namespace,
      chart: args.chart,
      version: args.version,
      values: args.values,
    });
  }

  uninstall(release: string, namespace: string): Promise<string> {
    return runHelmOperation(this.profile, { kind: "uninstall", release, namespace });
  }
}

// Helm is a distinct bounded context (package management) layered over Kubernetes.
// Its domain model is the decoded release and its revision history.

export interface HelmReleaseInfo {
  status?: string;
  description?: string;
  first_deployed?: string;
  last_deployed?: string;
  deleted?: string;
  notes?: string;
}

export interface HelmChartMetadata {
  name?: string;
  version?: string;
  appVersion?: string;
  description?: string;
}

export interface HelmRelease {
  name: string;
  namespace: string;
  version: number;
  info?: HelmReleaseInfo;
  chart?: { metadata?: HelmChartMetadata };
  config?: Record<string, unknown>;
  manifest?: string;
  hooks?: unknown[];
}

/** A single revision in a release's history. */
export interface HelmReleaseRevision {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

export const HelmReleaseView = {
  status(release: HelmRelease): string {
    return release.info?.status ?? "unknown";
  },
  chartName(release: HelmRelease): string {
    return [release.chart?.metadata?.name, release.chart?.metadata?.version].filter(Boolean).join("-");
  },
};

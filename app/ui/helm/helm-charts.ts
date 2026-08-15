// Helm chart browsing — fetch a chart repository's index.yaml through the
// companion's HTTP proxy (avoids browser CORS) and parse it into a chart list.
// Install/upgrade needs a helm binary in the companion; browsing does not.
import { parse } from "yaml";
import { companionHttpFetch } from "../../lib/proxy";

export interface HelmChartVersion {
  readonly version: string;
  readonly appVersion?: string;
  readonly created?: string;
  readonly description?: string;
  readonly home?: string;
  readonly deprecated?: boolean;
  readonly url?: string; // chart .tgz URL (for install)
}

export interface HelmChart {
  readonly name: string;
  readonly repo: string;
  readonly description?: string;
  readonly appVersion?: string;
  readonly version: string; // latest
  readonly home?: string;
  readonly deprecated?: boolean;
  readonly versions: HelmChartVersion[];
}

interface RawEntry {
  name?: string;
  version?: string;
  appVersion?: string;
  description?: string;
  created?: string;
  home?: string;
  deprecated?: boolean;
  urls?: unknown;
}

const firstUrl = (urls: unknown): string | undefined =>
  Array.isArray(urls) ? urls.map(s).find((u): u is string => !!u) : undefined;

const s = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Parse a Helm repo index.yaml into a chart list (latest version per chart,
 *  with the full version history). Pure + defensive — never throws. */
export function parseChartIndex(yaml: string, repo: string): HelmChart[] {
  let doc: { entries?: Record<string, RawEntry[]> };
  try {
    doc = parse(yaml) as { entries?: Record<string, RawEntry[]> };
  } catch {
    return [];
  }
  const entries = doc?.entries;
  if (!entries || typeof entries !== "object") return [];
  const charts: HelmChart[] = [];
  for (const [name, raw] of Object.entries(entries)) {
    const list = Array.isArray(raw) ? raw : [];
    const versions: HelmChartVersion[] = list
      .filter(v => s(v.version))
      .map(v => ({
        version: v.version!,
        appVersion: s(v.appVersion),
        created: s(v.created),
        description: s(v.description),
        home: s(v.home),
        deprecated: Boolean(v.deprecated),
        url: firstUrl(v.urls),
      }))
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    if (versions.length === 0) continue;
    const latest = versions[0];
    charts.push({
      name,
      repo,
      description: latest.description,
      appVersion: latest.appVersion,
      version: latest.version,
      home: latest.home,
      deprecated: latest.deprecated,
      versions,
    });
  }
  return charts.sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch + parse a repo's charts via the companion HTTP proxy. */
export async function fetchCharts(repoUrl: string): Promise<HelmChart[]> {
  const url = `${repoUrl.replace(/\/$/, "")}/index.yaml`;
  const res = await companionHttpFetch({ url });
  if (!res.ok) throw new Error(`Repo returned ${res.status}`);
  return parseChartIndex(await res.text(), repoUrl);
}

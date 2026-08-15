import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Drawer,
  DrawerSize,
  FormGroup,
  HTMLSelect,
  InputGroup,
  NonIdealState,
  Spinner,
  Tag,
  TextArea,
  Tooltip,
} from "@blueprintjs/core";
import { useEffect, useMemo, useState } from "react";
import { activeCluster as getActiveCluster } from "../../infrastructure/composition-root";
import { notify } from "../notifications";
import { type Column, ObjectTable } from "../resource/object-table";
import { fetchCharts, type HelmChart, type HelmChartVersion } from "./helm-charts";
import styles from "./helm-charts-view.module.css";

const REPOS = [
  // charts.bitnami.com 302s to repo.broadcom.com since the Broadcom acquisition.
  // The companion fetches with `redirect: "manual"` on purpose (it won't chase a
  // redirect to an arbitrary host), so a stale URL surfaces as "Failed to fetch"
  // rather than following. Point at the current location directly.
  { label: "Bitnami", url: "https://repo.broadcom.com/bitnami-files" },
  { label: "Jetstack (cert-manager)", url: "https://charts.jetstack.io" },
  { label: "Ingress-NGINX", url: "https://kubernetes.github.io/ingress-nginx" },
  { label: "Prometheus Community", url: "https://prometheus-community.github.io/helm-charts" },
];

type ChartRow = HelmChart & { id: string };

/** Network → Helm → Charts: browse a chart repository's index (via the companion
 *  HTTP proxy). Install requires a helm binary in the companion. */
export function HelmChartsPage() {
  const [repo, setRepo] = useState(REPOS[1].url); // jetstack: small, fast index
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; charts?: ChartRow[]; message?: string }>({
    status: "loading",
  });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ChartRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchCharts(repo)
      .then(charts => {
        if (!cancelled) setState({ status: "ready", charts: charts.map(c => ({ ...c, id: `${c.repo}/${c.name}` })) });
      })
      .catch(err => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const filtered = useMemo(() => {
    const charts = state.charts ?? [];
    const q = search.trim().toLowerCase();
    return q ? charts.filter(c => `${c.name} ${c.description ?? ""}`.toLowerCase().includes(q)) : charts;
  }, [state.charts, search]);

  const columns: Column<ChartRow>[] = [
    { id: "name", title: "Name", render: c => c.name, sortValue: c => c.name },
    { id: "version", title: "Version", render: c => c.version, sortValue: c => c.version },
    { id: "appVersion", title: "App version", render: c => c.appVersion ?? "—" },
    {
      id: "description",
      title: "Description",
      render: c => <span className={styles.desc}>{c.description ?? "—"}</span>,
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <HTMLSelect
          value={repo}
          onChange={e => setRepo(e.currentTarget.value)}
          options={REPOS.map(r => ({ label: r.label, value: r.url }))}
        />
        <span className={styles.spacer} />
        <InputGroup
          leftIcon="search"
          placeholder="Search charts…"
          value={search}
          onValueChange={setSearch}
          round
          className={styles.search}
        />
      </div>
      <div className={styles.body}>
        {state.status === "loading" ? (
          <NonIdealState icon={<Spinner />} title="Loading charts…" description={repo} />
        ) : state.status === "error" ? (
          <NonIdealState icon="error" title="Couldn't load repository" description={state.message} />
        ) : filtered.length === 0 ? (
          <NonIdealState icon="search" title="No charts" description="No charts match your search." />
        ) : (
          <ObjectTable view={{ columns, rows: filtered }} onRowClick={setSelected} />
        )}
      </div>
      <ChartDrawer chart={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ChartDrawer({ chart, onClose }: { chart: ChartRow | null; onClose: () => void }) {
  const [installing, setInstalling] = useState(false);
  const installable = chart?.versions.some(v => v.url) ?? false;
  return (
    <Drawer
      isOpen={chart != null}
      onClose={onClose}
      size={DrawerSize.SMALL}
      position="right"
      title={chart ? `${chart.name}` : ""}
    >
      {chart && (
        <div className={styles.detail}>
          {chart.deprecated && (
            <Tag intent="warning" minimal>
              deprecated
            </Tag>
          )}
          <p className={styles.detailDesc}>{chart.description ?? "No description."}</p>
          <div className={styles.detailRow}>
            <span className={styles.k}>Repository</span>
            <span>{chart.repo}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.k}>Latest</span>
            <span>
              {chart.version}
              {chart.appVersion ? ` (app ${chart.appVersion})` : ""}
            </span>
          </div>
          {chart.home && (
            <div className={styles.detailRow}>
              <span className={styles.k}>Home</span>
              <a href={chart.home} target="_blank" rel="noreferrer">
                {chart.home}
              </a>
            </div>
          )}
          <div className={styles.detailRow}>
            <span className={styles.k}>Versions</span>
            <span>
              {chart.versions
                .slice(0, 12)
                .map(v => v.version)
                .join(", ")}
              {chart.versions.length > 12 ? "…" : ""}
            </span>
          </div>
          <Tooltip
            content={
              installable
                ? "Install this chart as an in-cluster helm Job."
                : "This repository doesn't publish chart URLs, so install isn't available."
            }
            placement="top"
          >
            <Button
              icon="cloud-download"
              text="Install…"
              intent="primary"
              disabled={!installable}
              onClick={() => setInstalling(true)}
            />
          </Tooltip>
          {installing && <InstallDialog chart={chart} onClose={() => setInstalling(false)} onDone={onClose} />}
        </div>
      )}
    </Drawer>
  );
}

/** Install a chart via helm running as an in-cluster Job. The chart ref is the
 *  selected version's published .tgz URL (no `helm repo add` needed in-Job). */
function InstallDialog({ chart, onClose, onDone }: { chart: ChartRow; onClose: () => void; onDone: () => void }) {
  const versions = chart.versions.filter((v): v is HelmChartVersion & { url: string } => !!v.url);
  const [version, setVersion] = useState(versions[0]?.version ?? "");
  const [release, setRelease] = useState(chart.name);
  const [namespace, setNamespace] = useState("default");
  const [values, setValues] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = versions.find(v => v.version === version) ?? versions[0];

  const run = async () => {
    const cluster = getActiveCluster();
    if (!cluster || !chosen) return;
    if (!release.trim() || !namespace.trim()) {
      notify.error("Release name and namespace are required.");
      return;
    }
    setBusy(true);
    notify.info(`Installing ${chart.name} as a helm Job… this can take a minute.`);
    try {
      await cluster.helm.install({
        release: release.trim(),
        namespace: namespace.trim(),
        chart: chosen.url,
        version: chosen.version,
        values: values.trim() || undefined,
      });
      notify.success(`Installed ${release} in ${namespace}.`);
      onClose();
      onDone();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen onClose={busy ? undefined : onClose} title={`Install ${chart.name}`} icon="cloud-download">
      <DialogBody>
        <FormGroup label="Release name">
          <InputGroup value={release} onValueChange={setRelease} disabled={busy} />
        </FormGroup>
        <FormGroup label="Namespace">
          <InputGroup value={namespace} onValueChange={setNamespace} disabled={busy} />
        </FormGroup>
        <FormGroup label="Version">
          <HTMLSelect
            value={version}
            onChange={e => setVersion(e.currentTarget.value)}
            disabled={busy}
            options={versions.map(v => ({
              label: `${v.version}${v.appVersion ? ` (app ${v.appVersion})` : ""}`,
              value: v.version,
            }))}
            fill
          />
        </FormGroup>
        <FormGroup label="Values (YAML)" helperText="Optional overrides passed as --values.">
          <TextArea
            value={values}
            onChange={e => setValues(e.currentTarget.value)}
            disabled={busy}
            fill
            rows={6}
            placeholder={"# key: value"}
            style={{ fontFamily: "var(--font-mono, monospace)" }}
          />
        </FormGroup>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button text="Cancel" onClick={onClose} disabled={busy} />
            <Button
              text="Install"
              intent="primary"
              icon="cloud-download"
              onClick={run}
              loading={busy}
              disabled={!chosen}
            />
          </>
        }
      />
    </Dialog>
  );
}

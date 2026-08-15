import type { Intent } from "@blueprintjs/core";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Drawer,
  FormGroup,
  HTMLSelect,
  HTMLTable,
  NonIdealState,
  Spinner,
  Tab,
  Tabs,
  Tag,
  TextArea,
  Tooltip,
} from "@blueprintjs/core";
import { useEffect, useState } from "react";
import { parse, stringify } from "yaml";
import type { HelmRelease, HelmReleaseRevision } from "../../domain/helm/helm-release";
import { HelmReleaseView } from "../../domain/helm/helm-release";
import { activeCluster } from "../../infrastructure/composition-root";
import { CopyButton } from "../copy-button";
import { notify } from "../notifications";
import { type Column, ObjectTable } from "../resource/object-table";
import { age } from "../resource/registry";
import { useResource } from "../resource/use-resource";
import styles from "./helm-releases.module.css";

type HelmRow = HelmRelease & { id: string };

const statusIntent = (s: string): Intent =>
  /deployed/i.test(s)
    ? "success"
    : /fail|error/i.test(s)
      ? "danger"
      : /pending|uninstalling/i.test(s)
        ? "warning"
        : "none";

/** Network → Helm → Releases: list Helm releases (decoded from their secrets)
 *  with a rollback action. Read + rollback use the Helm gateway. */
export function HelmReleasesPage() {
  const { state, reload } = useResource<HelmRow>(
    async cluster => (await cluster.helm.listReleases()).map(r => ({ ...r, id: `${r.namespace}/${r.name}` })),
    "helm-releases",
  );
  const [rollback, setRollback] = useState<HelmRow | null>(null);
  const [uninstall, setUninstall] = useState<HelmRow | null>(null);
  const [upgrade, setUpgrade] = useState<HelmRow | null>(null);
  const [selected, setSelected] = useState<HelmRow | null>(null);

  const columns: Column<HelmRow>[] = [
    { id: "name", title: "Name", render: r => r.name, sortValue: r => r.name },
    { id: "namespace", title: "Namespace", render: r => r.namespace, sortValue: r => r.namespace },
    {
      id: "chart",
      title: "Chart",
      render: r => HelmReleaseView.chartName(r),
      sortValue: r => HelmReleaseView.chartName(r),
    },
    { id: "appVersion", title: "App version", render: r => r.chart?.metadata?.appVersion ?? "—" },
    { id: "revision", title: "Revision", align: "end", render: r => r.version, sortValue: r => r.version },
    {
      id: "updated",
      title: "Updated",
      align: "end",
      render: r => age(r.info?.last_deployed),
      sortValue: r => Date.parse(r.info?.last_deployed ?? "") || 0,
    },
    {
      id: "status",
      title: "Status",
      render: r => (
        <Tag minimal intent={statusIntent(HelmReleaseView.status(r))}>
          {HelmReleaseView.status(r)}
        </Tag>
      ),
      sortValue: r => HelmReleaseView.status(r),
    },
  ];

  if (state.status === "no-cluster")
    return (
      <NonIdealState
        icon="layout-sorted-clusters"
        title="No active cluster"
        description="Pick a cluster from the Hotbar."
      />
    );
  if (state.status === "loading") return <NonIdealState icon={<Spinner />} title="Loading releases…" />;
  if (state.status === "error")
    return (
      <NonIdealState
        icon="error"
        title="Couldn't load releases"
        description={state.message}
        action={<Button text="Retry" onClick={reload} />}
      />
    );
  if (state.items.length === 0)
    return (
      <NonIdealState
        icon="package"
        title="No Helm releases"
        description="Nothing installed via Helm in this cluster."
      />
    );

  return (
    <div className={styles.page}>
      <ObjectTable
        view={{ columns, rows: state.items }}
        onRowClick={setSelected}
        rowMenu={row => (
          <>
            <Tooltip content="Upgrade" compact minimal>
              <Button
                variant="minimal"
                size="small"
                icon="cloud-upload"
                aria-label="Upgrade"
                onClick={() => setUpgrade(row)}
              />
            </Tooltip>
            <Tooltip content="Rollback" compact minimal>
              <Button
                variant="minimal"
                size="small"
                icon="history"
                aria-label="Rollback"
                disabled={row.version <= 1}
                onClick={() => setRollback(row)}
              />
            </Tooltip>
            <Tooltip content="Uninstall" compact minimal>
              <Button
                variant="minimal"
                size="small"
                intent="danger"
                icon="trash"
                aria-label="Uninstall"
                onClick={() => setUninstall(row)}
              />
            </Tooltip>
          </>
        )}
      />
      <ReleaseDetailsDrawer
        release={selected}
        onClose={() => setSelected(null)}
        onUpgrade={r => {
          setSelected(null);
          setUpgrade(r);
        }}
        onRollback={r => {
          setSelected(null);
          setRollback(r);
        }}
        onUninstall={r => {
          setSelected(null);
          setUninstall(r);
        }}
      />
      {rollback && <RollbackDialog release={rollback} onClose={() => setRollback(null)} onDone={reload} />}
      {uninstall && <UninstallDialog release={uninstall} onClose={() => setUninstall(null)} onDone={reload} />}
      {upgrade && <UpgradeDialog release={upgrade} onClose={() => setUpgrade(null)} onDone={reload} />}
    </div>
  );
}

/** Rendered-manifest resource (kind + name) parsed out of the release manifest. */
function parseManifestResources(manifest: string | undefined): { kind: string; name: string }[] {
  if (!manifest) return [];
  return manifest.split(/^---$/m).flatMap(doc => {
    const t = doc.trim();
    if (!t) return [];
    try {
      const o = parse(t) as { kind?: string; metadata?: { name?: string } } | null;
      return o?.kind ? [{ kind: o.kind, name: o.metadata?.name ?? "" }] : [];
    } catch {
      return [];
    }
  });
}

/** Read view: a release's chart/status, values, rendered resources, notes, history. */
function ReleaseDetailsDrawer({
  release,
  onClose,
  onUpgrade,
  onRollback,
  onUninstall,
}: {
  release: HelmRow | null;
  onClose: () => void;
  onUpgrade: (r: HelmRow) => void;
  onRollback: (r: HelmRow) => void;
  onUninstall: (r: HelmRow) => void;
}) {
  const [history, setHistory] = useState<HelmReleaseRevision[] | null>(null);
  useEffect(() => {
    if (!release) return;
    const cluster = activeCluster();
    if (!cluster) return;
    let cancelled = false;
    setHistory(null);
    cluster.helm
      .releaseHistory(release.name, release.namespace)
      .then(h => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [release]);

  const resources = parseManifestResources(release?.manifest);
  const values = release?.config && Object.keys(release.config).length ? stringify(release.config) : "";
  const notes = release?.info?.notes ?? "";

  const header = release && (
    <div className={styles.head}>
      <span className={styles.headTitle}>{release.name}</span>
      <div className={styles.headActions}>
        <Tooltip content="Upgrade" compact minimal>
          <Button
            variant="minimal"
            size="small"
            icon="cloud-upload"
            aria-label="Upgrade"
            onClick={() => onUpgrade(release)}
          />
        </Tooltip>
        <Tooltip content="Rollback" compact minimal>
          <Button
            variant="minimal"
            size="small"
            icon="history"
            aria-label="Rollback"
            disabled={release.version <= 1}
            onClick={() => onRollback(release)}
          />
        </Tooltip>
        <Tooltip content="Uninstall" compact minimal>
          <Button
            variant="minimal"
            size="small"
            intent="danger"
            icon="trash"
            aria-label="Uninstall"
            onClick={() => onUninstall(release)}
          />
        </Tooltip>
      </div>
    </div>
  );

  return (
    <Drawer isOpen={release != null} onClose={onClose} size="725px" position="right" title={header}>
      {release && (
        <Tabs id="helm-release-tabs" className={styles.drawerTabs} renderActiveTabPanelOnly>
          <Tab
            id="details"
            title="Details"
            panel={
              <div className={styles.kv}>
                <Row k="Chart" v={HelmReleaseView.chartName(release)} />
                <Row k="App version" v={release.chart?.metadata?.appVersion ?? "—"} />
                <Row k="Revision" v={String(release.version)} />
                <Row
                  k="Status"
                  v={
                    <Tag minimal intent={statusIntent(HelmReleaseView.status(release))}>
                      {HelmReleaseView.status(release)}
                    </Tag>
                  }
                />
                <Row k="Namespace" v={release.namespace} />
                <Row k="Last deployed" v={release.info?.last_deployed ? age(release.info.last_deployed) : "—"} />
                <Row k="First deployed" v={release.info?.first_deployed ? age(release.info.first_deployed) : "—"} />
                {release.chart?.metadata?.description && <Row k="Description" v={release.chart.metadata.description} />}
              </div>
            }
          />
          <Tab
            id="values"
            title="Values"
            panel={
              values ? (
                <div className={styles.copyable}>
                  <div className={styles.copyBar}>
                    <CopyButton text={values} title="Copy values" />
                  </div>
                  <pre className={styles.pre}>{values}</pre>
                </div>
              ) : (
                <NonIdealState
                  icon="settings"
                  title="No overrides"
                  description="This release uses the chart defaults."
                />
              )
            }
          />
          <Tab
            id="resources"
            title={`Resources${resources.length ? ` (${resources.length})` : ""}`}
            panel={
              resources.length ? (
                <HTMLTable compact className={styles.resTable}>
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resources.map((r, i) => (
                      <tr key={i}>
                        <td>{r.kind}</td>
                        <td>{r.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </HTMLTable>
              ) : (
                <NonIdealState icon="cube" title="No resources" description="The release manifest is empty." />
              )
            }
          />
          <Tab
            id="notes"
            title="Notes"
            panel={
              notes ? (
                <div className={styles.copyable}>
                  <div className={styles.copyBar}>
                    <CopyButton text={notes} title="Copy notes" />
                  </div>
                  <pre className={styles.pre}>{notes}</pre>
                </div>
              ) : (
                <NonIdealState icon="document" title="No notes" description="This chart shipped no NOTES.txt." />
              )
            }
          />
          <Tab
            id="history"
            title="History"
            panel={
              history == null ? (
                <Spinner size={24} />
              ) : history.length === 0 ? (
                <NonIdealState icon="history" title="No history" />
              ) : (
                <HTMLTable compact className={styles.resTable}>
                  <thead>
                    <tr>
                      <th>Rev</th>
                      <th>Chart</th>
                      <th>Status</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history
                      .slice()
                      .reverse()
                      .map(h => (
                        <tr key={h.revision}>
                          <td>{h.revision}</td>
                          <td>{h.chart}</td>
                          <td>{h.status}</td>
                          <td>{h.updated ? age(h.updated) : "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </HTMLTable>
              )
            }
          />
        </Tabs>
      )}
    </Drawer>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className={styles.kvRow}>
      <div className={styles.kvKey}>{k}</div>
      <div className={styles.kvVal}>{v}</div>
    </div>
  );
}

/**
 * Upgrade a release: `helm upgrade --install` via the Helm gateway with edited
 * values. The chart reference defaults to the release's chart name — supply a
 * resolvable chart ref (repo URL/.tgz or `repo/chart`) if the default can't be
 * pulled in-cluster.
 */
function UpgradeDialog({ release, onClose, onDone }: { release: HelmRow; onClose: () => void; onDone: () => void }) {
  const [chart, setChart] = useState(release.chart?.metadata?.name ?? "");
  const [version, setVersion] = useState(release.chart?.metadata?.version ?? "");
  const [values, setValues] = useState(
    release.config && Object.keys(release.config).length ? stringify(release.config) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const cluster = activeCluster();
    if (!cluster) return;
    setBusy(true);
    setError(null);
    notify.info(`Upgrading ${release.name} as a helm Job… this can take a minute.`);
    try {
      await cluster.helm.install({
        release: release.name,
        namespace: release.namespace,
        chart: chart.trim(),
        version: version.trim() || undefined,
        values: values.trim() || undefined,
      });
      notify.success(`Upgraded ${release.name}.`);
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen
      onClose={busy ? undefined : onClose}
      title={`Upgrade ${release.name}`}
      icon="cloud-upload"
      style={{ width: 640 }}
    >
      <DialogBody>
        {error && <p className={styles.error}>{error}</p>}
        <FormGroup
          label="Chart reference"
          helperText="Repo URL, .tgz URL, or repo/chart — the source helm should upgrade from."
        >
          <TextArea value={chart} onChange={e => setChart(e.currentTarget.value)} disabled={busy} fill rows={1} />
        </FormGroup>
        <FormGroup label="Version" labelInfo="(optional)">
          <TextArea value={version} onChange={e => setVersion(e.currentTarget.value)} disabled={busy} fill rows={1} />
        </FormGroup>
        <FormGroup label="Values (YAML)" helperText="Pre-filled with the current release values.">
          <TextArea
            value={values}
            onChange={e => setValues(e.currentTarget.value)}
            disabled={busy}
            fill
            rows={8}
            style={{ fontFamily: "var(--font-mono, monospace)" }}
          />
        </FormGroup>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button text="Cancel" onClick={onClose} disabled={busy} />
            <Button
              text="Upgrade"
              intent="primary"
              icon="cloud-upload"
              loading={busy}
              disabled={!chart.trim()}
              onClick={run}
            />
          </>
        }
      />
    </Dialog>
  );
}

function UninstallDialog({ release, onClose, onDone }: { release: HelmRow; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const cluster = activeCluster();
    if (!cluster) return;
    setBusy(true);
    setError(null);
    notify.info(`Uninstalling ${release.name} as a helm Job… this can take a minute.`);
    try {
      await cluster.helm.uninstall(release.name, release.namespace);
      notify.success(`Uninstalled ${release.name} from ${release.namespace}.`);
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen onClose={busy ? undefined : onClose} title={`Uninstall ${release.name}`} icon="trash">
      <DialogBody>
        {error && <p className={styles.error}>{error}</p>}
        <p>
          Uninstall release <strong>{release.name}</strong> from namespace <strong>{release.namespace}</strong>? This
          removes all of its Kubernetes resources.
        </p>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button text="Cancel" onClick={onClose} disabled={busy} />
            <Button text="Uninstall" intent="danger" icon="trash" loading={busy} onClick={run} />
          </>
        }
      />
    </Dialog>
  );
}

function RollbackDialog({ release, onClose, onDone }: { release: HelmRow; onClose: () => void; onDone: () => void }) {
  const [history, setHistory] = useState<HelmReleaseRevision[] | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cluster = activeCluster();
    if (!cluster) return;
    let cancelled = false;
    cluster.helm
      .releaseHistory(release.name, release.namespace)
      .then(h => {
        if (cancelled) return;
        setHistory(h);
        // `.find`, not `.at(-1)`: history is sorted newest-first, so the last
        // element of the filtered list is the *oldest* revision. A release at
        // revision 5 defaulted its rollback to revision 1 — four versions back,
        // pre-selected, in a destructive dialog.
        setRevision(h.find(r => r.revision < release.version)?.revision ?? null);
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [release]);

  const run = async () => {
    const cluster = activeCluster();
    if (!cluster || revision == null) return;
    setBusy(true);
    try {
      await cluster.helm.rollback(release.name, release.namespace, revision);
      notify.success(`Rolled ${release.name} back to revision ${revision}`);
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen onClose={onClose} title={`Rollback ${release.name}`} icon="history">
      <DialogBody>
        {error && <p className={styles.error}>{error}</p>}
        {history == null ? (
          <Spinner size={24} />
        ) : (
          <HTMLSelect
            fill
            value={revision ?? undefined}
            onChange={e => setRevision(Number(e.currentTarget.value))}
            options={history
              .filter(r => r.revision < release.version)
              .map(r => ({ label: `Revision ${r.revision} — ${r.chart} (${r.status})`, value: r.revision }))}
          />
        )}
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button text="Cancel" onClick={onClose} />
            <Button text="Rollback" intent="primary" loading={busy} disabled={revision == null} onClick={run} />
          </>
        }
      />
    </Dialog>
  );
}

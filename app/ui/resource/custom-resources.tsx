import { Alert, Button, H3, Menu, MenuItem, NonIdealState, Spinner } from "@blueprintjs/core";
import { useCallback, useState } from "react";
import { ResourceRef } from "../../domain/values/resource-ref";
import { activeCluster } from "../../infrastructure/composition-root";
import { MenuPopover } from "../menu-popover";
import { notify } from "../notifications";
import { age } from "./age";
import styles from "./custom-resources.module.css";
import { DetailDrawer, type DrawerEvent } from "./detail-drawer";
import type { JsonSchema } from "./detail-sections";
import { jsonPath, renderValue } from "./json-path";
import { type Column, ObjectTable } from "./object-table";
import { useResource } from "./use-resource";

/** An `additionalPrinterColumns` entry from a CRD version. */
interface PrinterColumn {
  name: string;
  jsonPath: string;
  type?: string;
}

/** One `spec.versions[]` entry of a CustomResourceDefinition. */
interface CrdVersion {
  name: string;
  storage?: boolean;
  served?: boolean;
  additionalPrinterColumns?: PrinterColumn[];
  schema?: { openAPIV3Schema?: JsonSchema };
}

/** A CRD instance row: the raw object plus a stable id for the table. */
type CrdRow = { id: string; raw: Record<string, unknown> };

/** Safe nested read over an unknown tree (returns undefined off the path). */
function pluck(obj: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>(
    (o, k) => (o != null && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

/** The same read, narrowed to text, for the many places that render one.
 *
 *  `String(pluck(...))` was the idiom here, and it prints "[object Object]" the
 *  moment the path holds anything that is not a scalar. Nothing guarantees it
 *  is: these read arbitrary custom resources, where `metadata.name` is a string
 *  by convention rather than by any schema this code has checked. The number
 *  case already had this treatment in `wnum`; the string case did not, and the
 *  same omission on a different path is what put "[object Object]" in the Pods
 *  row menu.
 *
 *  Returns "" off the path or on a non-scalar, so callers keep using `||` to
 *  supply their own fallback. */
function pstr(obj: unknown, ...keys: string[]): string {
  return scalar(pluck(obj, ...keys));
}

/** A value rendered as text only when it is safely renderable as text. */
function scalar(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/**
 * CustomResourceView — browses the instances of a single CustomResourceDefinition.
 *
 * Picks the CRD's storage version (falling back to a served version, then the
 * first), lists every instance across namespaces via the generic resource port,
 * and renders Name / Namespace (Namespaced scope only) / one column per
 * `additionalPrinterColumns` entry / Age.
 */
export function CustomResourceView({ crd }: { crd: Record<string, unknown> }) {
  const versions = (pluck(crd, "spec", "versions") as CrdVersion[] | undefined) ?? [];
  const version = versions.find(v => v.storage) ?? versions.find(v => v.served) ?? versions[0];

  const group = pstr(crd, "spec", "group");
  const plural = pstr(crd, "spec", "names", "plural");
  const kind = pstr(crd, "spec", "names", "kind") || "Custom Resource";
  const namespaced = pluck(crd, "spec", "scope") === "Namespaced";
  const printerColumns = version?.additionalPrinterColumns ?? [];

  const apiVersion = group ? `${group}/${version?.name ?? ""}` : (version?.name ?? "");
  const key = `crd:${apiVersion}:${kind}`;

  const { state, reload } = useResource<CrdRow>(async cluster => {
    if (!version) return [];
    const objects = await cluster.resources.list({ apiVersion, kind, resource: plural });
    return objects.map(o => {
      const name = pstr(o.raw, "metadata", "name") || o.ref.name;
      const uid = pluck(o.raw, "metadata", "uid");
      return { id: scalar(uid) || name, raw: o.raw };
    });
  }, key);

  // A CRD instance used to be a dead end: the table rendered, but a row opened
  // nothing — no YAML, no events, no delete — while every built-in kind gets all
  // of that from ResourcePage. The schema is the cluster's, so the drawer is the
  // one place a custom resource can be inspected at all.
  const [selected, setSelected] = useState<CrdRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CrdRow | null>(null);

  const refOf = useCallback(
    (row: CrdRow) =>
      ResourceRef.of({
        apiVersion,
        kind,
        name: pstr(row.raw, "metadata", "name"),
        namespace: namespaced ? pstr(row.raw, "metadata", "namespace") || undefined : undefined,
        uid: pstr(row.raw, "metadata", "uid") || undefined,
      }),
    [apiVersion, kind, namespaced],
  );

  // Stable identities: the drawer's panels key their effects on these.
  const fetchRaw = useCallback(
    async (row: CrdRow) => {
      const cluster = activeCluster();
      if (!cluster) return row.raw;
      const obj = await cluster.resources.get(refOf(row), plural).catch(() => null);
      return obj?.raw ?? row.raw;
    },
    [refOf, plural],
  );

  const applyRaw = useCallback(
    async (object: Record<string, unknown>) => {
      const cluster = activeCluster();
      if (!cluster) return;
      await cluster.resources.apply(object);
      reload();
    },
    [reload],
  );

  const fetchEvents = useCallback(
    async (row: CrdRow): Promise<DrawerEvent[]> => {
      const cluster = activeCluster();
      if (!cluster) return [];
      const ref = refOf(row);
      const objs = await cluster.resources.list({
        apiVersion: "v1",
        kind: "Event",
        resource: "events",
        namespace: ref.namespace,
      });
      return objs
        .map(o => o.raw)
        .filter(raw => {
          const involved = pluck(raw, "involvedObject") as { kind?: string; name?: string } | undefined;
          return involved?.kind === ref.kind && involved?.name === ref.name;
        })
        .map((raw, i) => ({
          id: pstr(raw, "metadata", "uid") || String(i),
          type: scalar(raw.type) || "Normal",
          reason: scalar(raw.reason),
          message: scalar(raw.message),
          count: Number(raw.count ?? 1),
          age: age(scalar(raw.lastTimestamp) || pstr(raw, "metadata", "creationTimestamp") || undefined),
        }));
    },
    [refOf],
  );

  const columns: Column<CrdRow>[] = [
    { id: "name", title: "Name", render: r => pstr(r.raw, "metadata", "name") || "—" },
    ...(namespaced
      ? [
          {
            id: "namespace",
            title: "Namespace",
            render: (r: CrdRow) => pstr(r.raw, "metadata", "namespace") || "—",
          },
        ]
      : []),
    ...printerColumns.map(
      (pc, i): Column<CrdRow> => ({
        id: `printer:${i}:${pc.name}`,
        title: pc.name,
        align: pc.type === "integer" || pc.type === "number" ? "end" : "start",
        render: r => renderValue(jsonPath(r.raw, pc.jsonPath)),
      }),
    ),
    {
      id: "age",
      title: "Age",
      align: "end",
      render: r => age(pstr(r.raw, "metadata", "creationTimestamp") || undefined),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <H3 className={styles.heading}>{kind}</H3>
      </div>
      <div className={styles.body}>
        {!version ? (
          <NonIdealState
            icon="error"
            title="Invalid definition"
            description="This CustomResourceDefinition declares no versions."
          />
        ) : state.status === "no-cluster" ? (
          <NonIdealState
            icon="layout-sorted-clusters"
            title="No active cluster"
            description="Pick a cluster from the Hotbar to connect."
          />
        ) : state.status === "loading" ? (
          <NonIdealState icon={<Spinner />} title={`Loading ${kind}…`} />
        ) : state.status === "error" ? (
          <NonIdealState
            icon="error"
            title={`Couldn't load ${kind}`}
            description={state.message}
            action={<Button text="Retry" onClick={reload} />}
          />
        ) : state.items.length === 0 ? (
          <NonIdealState icon="th" title={`No ${kind} instances`} description="Nothing in scope." />
        ) : (
          <ObjectTable view={{ columns, rows: state.items }} onRowClick={setSelected} />
        )}
      </div>
      <DetailDrawer
        title={`${kind}: ${selected ? pstr(selected.raw, "metadata", "name") : ""}`}
        row={selected}
        columns={columns}
        onClose={() => setSelected(null)}
        fetchRaw={fetchRaw}
        applyRaw={applyRaw}
        fetchEvents={fetchEvents}
        schema={version?.schema?.openAPIV3Schema}
        actions={row => (
          <MenuPopover
            placement="bottom-end"
            content={
              <Menu>
                <MenuItem icon="trash" intent="danger" text="Delete" onClick={() => setPendingDelete(row)} />
              </Menu>
            }
          >
            <Button size="small" rightIcon="caret-down" text="Actions" />
          </MenuPopover>
        )}
      />
      <Alert
        isOpen={pendingDelete != null}
        intent="danger"
        confirmButtonText="Delete"
        cancelButtonText="Cancel"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const row = pendingDelete;
          setPendingDelete(null);
          if (!row) return;
          const cluster = activeCluster();
          if (!cluster) return;
          const name = pstr(row.raw, "metadata", "name");
          void cluster.resources
            .remove(refOf(row), plural)
            .then(() => {
              notify.success(`Deleted ${name}`);
              setSelected(null);
              reload();
            })
            .catch(e => notify.error(e instanceof Error ? e.message : String(e)));
        }}
      >
        Delete {kind} {pendingDelete ? pstr(pendingDelete.raw, "metadata", "name") : ""}? This cannot be undone.
      </Alert>
    </div>
  );
}

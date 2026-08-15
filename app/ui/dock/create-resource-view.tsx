import { Button, TextArea } from "@blueprintjs/core";
import { useState } from "react";
import { parse } from "yaml";
import { activeCluster } from "../../infrastructure/composition-root";
import { notify } from "../notifications";
import styles from "./create-resource-view.module.css";

const TEMPLATE = `apiVersion: v1
kind: ConfigMap
metadata:
  name: example
  namespace: default
data:
  key: value
`;

/**
 * Create resource — the Dock's YAML editor for applying any resource, matching
 * Freelens's create-resource dock tab (kind-agnostic apply via the cluster).
 * Supports multiple docs separated by `---`.
 */
export function CreateResourceView() {
  const [text, setText] = useState(TEMPLATE);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const cluster = activeCluster();
    if (!cluster) return;
    let docs: Record<string, unknown>[];
    try {
      docs = text
        .split(/^---\s*$/m)
        .map(d => d.trim())
        .filter(Boolean)
        .map(d => parse(d) as Record<string, unknown>);
    } catch (err) {
      return notify.error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (docs.length === 0) return notify.error("Nothing to create.");
    setBusy(true);
    try {
      for (const doc of docs) await cluster.resources.apply(doc);
      notify.success(`Created ${docs.length} resource${docs.length === 1 ? "" : "s"}.`);
    } catch (err) {
      notify.error(`Create failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <TextArea
        value={text}
        onChange={e => setText(e.target.value)}
        fill
        spellCheck={false}
        className={styles.editor}
      />
      <div className={styles.actions}>
        <Button intent="primary" icon="plus" text="Create" loading={busy} onClick={create} />
      </div>
    </div>
  );
}

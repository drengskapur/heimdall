import { Button, Callout, Dialog, DialogBody, DialogFooter, TextArea } from "@blueprintjs/core";
import { useMemo, useState } from "react";
import { clusterProfiles } from "../infrastructure/composition-root";
import { parseKubeconfig } from "./cluster-catalog";
import { notify } from "./notifications";
import styles from "./paste-kubeconfig.module.css";

/**
 * Add clusters by pasting raw kubeconfig YAML — the browser analog of Lens's
 * add-cluster editor, complementing "Connect from kubeconfig" (companion scan).
 * Reuses the same `parseKubeconfig` (inline-cert/token/exec → ready profiles).
 */
export function PasteKubeconfigDialog({
  isOpen,
  onClose,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? parseKubeconfig(text) : []), [text]);
  const ready = parsed.filter(p => p.authStatus !== "unsupported");

  const add = () => {
    if (parsed.length === 0) return;
    for (const profile of parsed) clusterProfiles.save(profile);
    notify.success(
      `Added ${parsed.length} cluster${parsed.length > 1 ? "s" : ""}${ready.length < parsed.length ? ` (${ready.length} connectable)` : ""}.`,
    );
    onAdded();
    setText("");
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Add clusters from kubeconfig"
      icon="import"
      className={styles.dialog}
    >
      <DialogBody>
        <Callout intent="primary" icon="info-sign" className={styles.intro}>
          Paste a kubeconfig. Contexts with inline certs, a token, or an exec plugin become connectable profiles;
          file-path certs are added as unsupported (connect them via a terminal instead).
        </Callout>
        <TextArea
          className={styles.editor}
          value={text}
          onChange={e => setText(e.currentTarget.value)}
          placeholder={"apiVersion: v1\nkind: Config\nclusters:\n- name: my-cluster\n  cluster:\n    server: https://…"}
          fill
        />
        {text.trim() && (
          <Callout intent={parsed.length ? "success" : "warning"} className={styles.preview}>
            {parsed.length
              ? `${parsed.length} context${parsed.length > 1 ? "s" : ""} found${ready.length < parsed.length ? ` · ${ready.length} connectable` : ""}: ${parsed.map(p => p.name).join(", ")}`
              : "No valid contexts found."}
          </Callout>
        )}
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button text="Cancel" onClick={onClose} />
            <Button
              text={`Add ${parsed.length || ""} cluster${parsed.length === 1 ? "" : "s"}`}
              intent="primary"
              onClick={add}
              disabled={parsed.length === 0}
            />
          </>
        }
      />
    </Dialog>
  );
}

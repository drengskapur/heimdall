import { Button, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup, Switch, Tab, Tabs } from "@blueprintjs/core";
import { useState } from "react";
import { clusterProfiles } from "../infrastructure/composition-root";
import type { ClusterProfile } from "../lib/kube-generated";
import styles from "./cluster-settings.module.css";
import { notify } from "./notifications";
import { currentRoute, navigate } from "./router";

/**
 * Per-cluster settings — edits the active ClusterProfile's display name and the
 * `preferences` the transport actually consumes (default namespace, HTTPS proxy,
 * node-shell image, allow-untrusted-TLS). Persists via the profile repository.
 */
export function ClusterSettingsDialog({
  profile,
  isOpen,
  onClose,
  onSaved,
}: {
  profile: ClusterProfile;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const prefs = profile.preferences ?? {};
  const [name, setName] = useState(profile.name);
  const [defaultNamespace, setDefaultNamespace] = useState(prefs.defaultNamespace ?? "");
  const [httpsProxy, setHttpsProxy] = useState(prefs.httpsProxy ?? "");
  const [nodeShellImage, setNodeShellImage] = useState(prefs.nodeShellImage ?? "");
  const [insecure, setInsecure] = useState(Boolean(profile.insecureSkipTlsVerify));

  const save = () => {
    const updated: ClusterProfile = {
      ...profile,
      name: name.trim() || profile.name,
      insecureSkipTlsVerify: insecure,
      preferences: {
        ...prefs,
        defaultNamespace: defaultNamespace.trim() || undefined,
        httpsProxy: httpsProxy.trim() || undefined,
        nodeShellImage: nodeShellImage.trim() || undefined,
      },
    };
    clusterProfiles.save(updated);
    // The URL keys on the cluster's name, so a rename has to move the route with
    // it — otherwise saving settings for the cluster you are *in* leaves the
    // path pointing at a name that no longer resolves, and you get bounced to
    // the Catalog. `replace` because a rename isn't a place you navigate back to.
    if (updated.name !== profile.name) {
      const route = currentRoute();
      if (route.cluster === profile.name) navigate({ ...route, cluster: updated.name }, { replace: true });
    }
    notify.success("Cluster settings saved.");
    onSaved();
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={`Settings — ${profile.name}`} icon="cog" className={styles.dialog}>
      <DialogBody>
        <Tabs id="cluster-settings-tabs" vertical>
          <Tab
            id="general"
            title="General"
            panel={
              <div className={styles.panel}>
                <FormGroup label="Cluster name">
                  <InputGroup value={name} onValueChange={setName} placeholder={profile.name} />
                </FormGroup>
                <FormGroup label="Default namespace" labelInfo="(optional)">
                  <InputGroup value={defaultNamespace} onValueChange={setDefaultNamespace} placeholder="default" />
                </FormGroup>
                <FormGroup label="Server" helperText="The API server this profile connects to.">
                  <InputGroup value={profile.server} readOnly />
                </FormGroup>
              </div>
            }
          />
          <Tab
            id="proxy"
            title="Proxy"
            panel={
              <div className={styles.panel}>
                <FormGroup
                  label="HTTPS proxy"
                  labelInfo="(optional)"
                  helperText="Route this cluster's API traffic through a proxy."
                >
                  <InputGroup value={httpsProxy} onValueChange={setHttpsProxy} placeholder="http://proxy:8080" />
                </FormGroup>
                <Switch
                  checked={insecure}
                  label="Skip TLS verification for this cluster"
                  onChange={e => setInsecure(e.currentTarget.checked)}
                />
              </div>
            }
          />
          <Tab
            id="node-shell"
            title="Node Shell"
            panel={
              <div className={styles.panel}>
                <FormGroup
                  label="Node shell image"
                  labelInfo="(optional)"
                  helperText="Image used for node-shell pods (default alpine)."
                >
                  <InputGroup value={nodeShellImage} onValueChange={setNodeShellImage} placeholder="alpine:3.20" />
                </FormGroup>
              </div>
            }
          />
        </Tabs>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button text="Cancel" onClick={onClose} />
            <Button text="Save" intent="primary" onClick={save} />
          </>
        }
      />
    </Dialog>
  );
}

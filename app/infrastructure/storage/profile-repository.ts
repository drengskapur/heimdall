// Driven adapter for persistence, backed by the existing browser-storage
// helpers: cluster profiles live in sessionStorage.
import type { ClusterProfileRepository } from "../../application/ports/repositories";
import type { ClusterProfile } from "../../lib/kube-generated";
import {
  clearClusterProfile,
  listClusterProfiles,
  loadClusterProfile,
  removeClusterProfile,
  saveClusterProfile,
} from "../../lib/kubernetes";

export class BrowserClusterProfileRepository implements ClusterProfileRepository {
  list(): ClusterProfile[] {
    return listClusterProfiles();
  }
  active(): ClusterProfile | null {
    return loadClusterProfile();
  }
  save(profile: ClusterProfile): void {
    saveClusterProfile(profile);
  }
  setActive(profile: ClusterProfile | null): void {
    if (profile) saveClusterProfile(profile);
    else clearClusterProfile();
  }
  remove(id: string): void {
    // Note: saveClusterProfiles() *merges*, so it can't delete — use the
    // dedicated remover, which rewrites the list and clears the active profile
    // when it was the one removed.
    removeClusterProfile(id);
  }
}

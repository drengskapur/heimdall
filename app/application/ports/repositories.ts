// Driven ports for persistence. The application depends on this interface; the
// infrastructure layer provides the sessionStorage-backed adapter.
import type { ClusterProfile } from "../../lib/kube-generated";

export interface ClusterProfileRepository {
  list(): ClusterProfile[];
  active(): ClusterProfile | null;
  save(profile: ClusterProfile): void;
  setActive(profile: ClusterProfile | null): void;
  remove(id: string): void;
}

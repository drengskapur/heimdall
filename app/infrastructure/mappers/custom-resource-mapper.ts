// Maps a CustomResourceDefinition wire object to the CustomResourceType domain
// descriptor, selecting the version the API server stores/serves.
import { CustomResourceType } from "../../domain/custom-resource/custom-resource-type";
import type { WireCustomResourceDefinition as WireCrd } from "../../lib/kube-generated"; // generated CRD schema at the seam

export function toCustomResourceType(crd: WireCrd): CustomResourceType {
  const spec = crd.spec || {};
  // Stryker disable next-line ArrayDeclaration: equivalent. Replacing the empty
  // default with a non-empty one puts a string where a version object is
  // expected, so `.name` is undefined either way and the empty-version guard in
  // CustomResourceType.of rejects both alike.
  const versions = spec.versions || [];
  const version = versions.find(v => v.storage)?.name || versions.find(v => v.served)?.name || versions[0]?.name || "";
  return CustomResourceType.of({
    group: spec.group || "",
    version,
    plural: spec.names?.plural || "",
    kind: spec.names?.kind || "",
    namespaced: spec.scope === "Namespaced",
  });
}

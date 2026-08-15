// A custom resource *type* — the identity of a dynamically-defined Kubernetes
// resource, distilled from its CustomResourceDefinition. The domain and ports
// speak in terms of this descriptor rather than the full CRD wire object.
import { Guard } from "../shared/guard";
import { isErr } from "../shared/result";

export interface CustomResourceTypeProps {
  group: string;
  version: string;
  plural: string;
  kind: string;
  namespaced: boolean;
}

export class CustomResourceType {
  readonly group: string;
  readonly version: string;
  readonly plural: string;
  readonly kind: string;
  readonly namespaced: boolean;

  private constructor(props: CustomResourceTypeProps) {
    this.group = props.group;
    this.version = props.version;
    this.plural = props.plural;
    this.kind = props.kind;
    this.namespaced = props.namespaced;
  }

  static of(props: CustomResourceTypeProps): CustomResourceType {
    for (const [value, name] of [
      [props.version, "version"],
      [props.plural, "plural"],
      [props.kind, "kind"],
    ] as const) {
      const guard = Guard.againstEmpty(value, name);
      if (isErr(guard)) throw new Error(`CustomResourceType: ${guard.error}`);
    }
    return new CustomResourceType(props);
  }

  /** group/version, or just the version for the core-like empty group. */
  get apiVersion(): string {
    return this.group ? `${this.group}/${this.version}` : this.version;
  }

  /** The collection path segment, e.g. /apis/example.com/v1/widgets. */
  collectionPath(namespace?: string): string {
    const scope = this.namespaced && namespace ? `/namespaces/${encodeURIComponent(namespace)}` : "";
    return `/apis/${this.group}/${this.version}${scope}/${this.plural}`;
  }
}

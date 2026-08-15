// Identity value object for a Kubernetes object: its group/version/kind and
// namespace/name (with uid when known). Two refs are equal when they denote the
// same object. Pure — no infrastructure.

export interface ResourceRefProps {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  uid?: string;
}

export class ResourceRef {
  readonly apiVersion: string;
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string;
  readonly uid?: string;

  private constructor(props: ResourceRefProps) {
    if (!props.apiVersion) throw new Error("ResourceRef requires an apiVersion");
    if (!props.kind) throw new Error("ResourceRef requires a kind");
    if (!props.name) throw new Error("ResourceRef requires a name");
    // Validated rather than defaulted to "v1". The default was never reached —
    // every caller passes a concrete group — and it silently turned a missing
    // apiVersion into a claim of core/v1, which for an apps/v1 object is wrong
    // in a way nothing would notice.
    this.apiVersion = props.apiVersion;
    this.kind = props.kind;
    this.name = props.name;
    this.namespace = props.namespace || undefined;
    this.uid = props.uid || undefined;
  }

  static of(props: ResourceRefProps): ResourceRef {
    return new ResourceRef(props);
  }

  /** The API group (empty string for the core group). */
  get group(): string {
    return this.apiVersion.includes("/") ? this.apiVersion.split("/")[0] : "";
  }
  get namespaced(): boolean {
    return this.namespace !== undefined;
  }

  /** Prefer uid identity; fall back to namespace/name when uid is absent. */
  equals(other: ResourceRef): boolean {
    if (this.uid && other.uid) return this.uid === other.uid;
    return this.kind === other.kind && this.name === other.name && this.namespace === other.namespace;
  }

  /** A stable identity key: the same object always yields the same key.
   *
   *  Not the uid. A ref built from an endpoint address or an owner reference has
   *  no uid while one built from a listed object does, so keying on uid gave a
   *  single pod two different keys — which is why a port-forward started from a
   *  Service never appeared on that pod's Forward tab, the two sides comparing
   *  "default-web-0" against a uid.
   *
   *  Slash-separated because the old `namespace-name` fallback also collided:
   *  namespace "a-b" with name "foo" and namespace "a" with name "b-foo" both
   *  produced "a-b-foo". `equals` still prefers uid when both sides have one. */
  toKey(): string {
    return `${this.kind}/${this.namespace || ""}/${this.name}`;
  }
  toString(): string {
    return `${this.kind}/${[this.namespace, this.name].filter(Boolean).join("/")}`;
  }
}

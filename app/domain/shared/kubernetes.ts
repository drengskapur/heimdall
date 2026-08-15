// Well-known Kubernetes domain vocabulary — const enums-as-objects (the idiomatic
// TS form, tree-shakeable and union-typed) so the domain avoids magic strings.

export const PodPhase = {
  Pending: "Pending",
  Running: "Running",
  Succeeded: "Succeeded",
  Failed: "Failed",
  Unknown: "Unknown",
} as const;
export type PodPhase = (typeof PodPhase)[keyof typeof PodPhase];

export const ContainerStateKind = {
  Running: "running",
  Waiting: "waiting",
  Terminated: "terminated",
  Unknown: "unknown",
} as const;
export type ContainerStateKind = (typeof ContainerStateKind)[keyof typeof ContainerStateKind];

export const ApiVerb = {
  Get: "get",
  List: "list",
  Watch: "watch",
  Create: "create",
  Update: "update",
  Patch: "patch",
  Delete: "delete",
} as const;
export type ApiVerb = (typeof ApiVerb)[keyof typeof ApiVerb];

export const ConditionStatus = {
  True: "True",
  False: "False",
  Unknown: "Unknown",
} as const;
export type ConditionStatus = (typeof ConditionStatus)[keyof typeof ConditionStatus];

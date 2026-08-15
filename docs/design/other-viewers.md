# What Rancher, Fleet and Argo CD do that Heimdall does not

Read from source, shallow clones of `rancher/dashboard`, `rancher/fleet` and
`argoproj/argo-cd`. This is a shortlist of what is worth taking and — more
usefully — what is not, with the reason in each case.

## Adopted

### Group by namespace (Rancher)

`shell/components/SortableTable/grouping.js`. Rancher's table takes a `groupBy`
key and folds `pagedRows` into `[{key, ref, rows}]`, preserving the order rows
arrived in — so the sort applies *within* each group for free rather than each
group being sorted separately.

Ported to `ObjectTable` as an optional `groupBy` accessor with collapsible
headers. Two decisions Rancher's version informed:

- **The group header is sticky under the column header** (`top: 30px`). The
  reason to group is knowing which namespace the row under the pointer belongs
  to; a header that scrolls away answers that only at the top of each group.
- **Gated on more than one group.** Rancher gates its own group control the same
  way. Grouping a single group is a header row restating the filter.

### A normalised health model (Argo)

`HealthStatusCode` is `Unknown | Progressing | Healthy | Suspended | Degraded |
Missing` with an explicit `HealthPriority` map — `Missing: 0` through
`Healthy: 5`. The ordering is the substance: it lets a parent's health be
`min(children)` and a status column sort by *how bad* rather than
alphabetically.

Heimdall derived status per kind in `registry.tsx` with a different ad-hoc rule
each time — Pods compared against the string `"Running"`, Nodes against a `ready`
boolean, volumes against a phase, Services against whether a load balancer had an
address. Each produced a colour; none produced an order. `health.ts` maps all of
them onto the one scale.

**One deliberate difference from Argo.** Argo replaces a resource's own status
with the health code and shows "Degraded". Here the code sits *behind* the label
and the label stays Kubernetes': `CrashLoopBackOff` says strictly more than
`Degraded`, and a Kubernetes viewer that hides it to show a six-value abstraction
has thrown away the useful half. The code drives colour and sort order; the phase
stays the text.

Two judgements worth stating, both tested:

- **A container issue outranks a `Running` phase.** A pod can be Running while a
  container crash-loops inside it, which is exactly the case the phase alone gets
  wrong.
- **Scaled to zero is Suspended, not Healthy.** Calling it healthy hides a
  scale-down that was not meant to happen. Argo treats suspension the same way,
  and `Suspended` is deliberately coloured `none` — paused is not a fault.

### A live-versus-applied diff (Argo)

`application-resources-diff` is the most useful screen in Argo's UI, and it
reads its desired side from Git. This app has no Git — but it has the annotation
kubectl writes on every apply, `kubectl.kubernetes.io/last-applied-
configuration`, which is a desired state by another route. Diffing the live
object against it answers "has anything changed this since it was applied": an
HPA rewriting replicas, a webhook injecting a sidecar, someone's `kubectl edit`
at 2am.

A unified diff rather than Argo's side-by-side, because a drawer does not have
the width for two columns and a changed field should read as an adjacent pair
rather than something to hunt for across a gap. Line diff by LCS, so a moved
block is not reported as a rewrite of everything after it, and git's
three-lines-of-context collapsing.

**Three normalisations, each one earned by a real drift measured without it.**
Applying a Deployment at `replicas: 1` and scaling it to 3 produced a 41-line
diff of which one line was the answer:

- **Strip the server-owned fields** — `status`, `managedFields`,
  `resourceVersion`, `uid`, `generation`, `creationTimestamp`.
- **Sort keys.** The applied JSON and the live object order theirs differently,
  and an unsorted dump reported `apiVersion: apps/v1` as *both* a deletion and an
  addition of the identical text.
- **Project the live object onto the shape the manifest declared.** Kubernetes
  defaults in `terminationMessagePath`, `imagePullPolicy`, `dnsPolicy`,
  `schedulerName`, `strategy`, `revisionHistoryLimit` and a dozen more; those are
  not drift, and they were 25 of the 41 lines.

With all three the same drift renders in 10 lines: the `replicas` pair, three
lines of context, and two collapse markers. The cost of the third is stated
rather than hidden — a field you never declared and a webhook injected will not
appear here. The YAML tab beside it shows the object whole.

### The resource tree, as its own app (Argo)

`application-resource-tree` is the most recognisable screen in Argo: every
resource laid out left to right, parents joined to what they own, each node
carrying its health. Argo reads its list from a declared Application. The same
tree is derivable from `ownerReferences`, which is where Kubernetes records the
relationship anyway — a Deployment owns a ReplicaSet owns a Pod, each saying so
in its own metadata.

It ships as **Topology**, the second entry in the app registry, which is what
that registry existed for: a name, a glyph, a colour and a page, with no change
to the sidebar that lists it.

Decisions worth recording:

- **Layout is a pure module with its own tests.** A tidy tree is arithmetic —
  depth from the owner chain, leaves on consecutive rows, a parent centred on its
  children — and it is worth testing as arithmetic rather than by looking at it.
- **An owner outside the fetched set makes the child a root**, not a dangling
  edge. That is what makes the graph safe to build from a partial fetch.
- **Health rolls up.** A node shows the worst health in its subtree, so a
  Deployment that is itself fine but has a crash-looping pod under it does not
  look fine. This is what `worstHealth` was written for.
- **SVG, not canvas**, so every node stays a real DOM element — focusable,
  hoverable, and reachable by a screen reader, none of which a canvas gives back
  without reimplementing it.
- **Orthogonal elbows, not curves.** The tree is about who owns what; a right
  angle reads as a branch where a bezier reads as a flow.
- **A 4px health bar on the leading edge, not a tinted node.** The fill has to
  stay the surface colour for the label on it to keep its contrast.

## Considered, and why not

### Rancher's `PaginatedResourceTable`

Server-side paging against Rancher's Steve proxy. Heimdall lists from the
Kubernetes API directly and holds the result in memory; pagination would add a
round trip per page for lists that are already fully local.

### A bulk-action bar (Rancher)

`SortableTable/selection.js` offers an action when *some* selected row supports
it and runs it over only those rows. The intersection would let one odd row
remove an action from the other forty; the union would offer something that
fails halfway. Ported with the count on the button — "Restart (3)" when three of
five qualify.

### Node allocation (Argo's pod view)

`application-pod-view` groups pods by node, and the question that grouping
exists to answer is which node is full. I first recorded this as blocked on
metrics, **and that was wrong**: metrics answer *usage*, and the scheduler does
not schedule on usage. It schedules on **requests against allocatable**, both of
which are plain fields on objects already being fetched — exactly what `kubectl
describe node` prints under "Allocated resources". It needs no metrics server and
works on a cluster that has none.

Shipped as a second mode in the Topology app. Three judgements, all tested:

- **`status.allocatable`, not `capacity`.** Capacity ignores what the kubelet
  reserves and would overstate every node.
- **Succeeded and Failed pods are excluded.** Their containers hold nothing, and
  counting them shows a node as full of things that have stopped.
- **An unknown allocatable reports 0%, not a full bar.** An unmeasurable node
  must look neither healthy nor broken.

Percentages are **truncated, not rounded**, because `kubectl` truncates and this
is the number people will hold it against: 950m of 4 is 23.75, which kubectl
prints as 23%. Rounding to 24 would have made the two disagree on every node.
Verified against `kubectl describe node`: 950m (23%), 290Mi (7%), identical.

### Roll-up by state, not by fault count (Fleet)

Fleet has no UI of its own to port — its screens live in `rancher/dashboard`.
What it contributes is a shape: a status that rolls *up*, each level summarising
its children **by state** rather than counting the bad ones.

The Workloads overview was the place that needed it. Its cards counted "3 with
issues", which said the same thing for three workloads mid-rollout and three
that had failed outright — and only one of those is a reason to stop what you
are doing. They now name the worst state present: "3 progressing", "3 degraded".

It also retired the last hand-rolled health computation in the app. The tally
had its own `hasIssues` notion; it now goes through `replicaHealth` and
`podHealth` like everything else, which is what makes `Suspended` stop counting
as a fault — a CronJob scaled to zero on purpose was showing as an issue.

### Empty cells styled as absence

Its object table writes a muted italic *No value* where a property is unset. The
wording is not what makes it read better — it is that absence is styled
differently from data, so a column of blanks does not look like a column of
contents. Forty-odd renderers here already agreed on an em dash and drew it at
full strength.

Applied in the cell renderer rather than at those forty sites: it is a
presentation rule and that is the presentation layer, and several of the
renderers are string-returning helpers that could not produce a styled node
without changing their type. Not italic — italic is what makes a *word* read as
a note, and an em dash does not slant into anything.

### Cross-cluster roll-up (Fleet), behind a flag

The second half of Fleet's idea: a status rolled up across *several* clusters.
Fleet gets it from an agent reporting per cluster; a browser has no agent, so
this is the honest approximation — three list calls per reachable cluster,
joined by the same health scale, surfaced as a **Workloads** column in the
Catalog.

Scoped deliberately. Deployments, StatefulSets and DaemonSets only: they are the
things whose desired count is *declared*, and they are few. Pods would be the
expensive list on every cluster and would mostly restate what their owners
already say.

**This is the flag the flag system was for.** Its cost scales with the fleet
rather than being constant, so it is the one feature where "turn it off" is a
real answer rather than a preference — and the boundary is a single column plus a
single effect.

## Still open

Nothing from the three viewers.

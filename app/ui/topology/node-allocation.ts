import { CpuQuantity, MemoryQuantity } from "../../domain/values/quantity";
import { type Health, worstHealth } from "../resource/health";

/**
 * Per-node allocation: what the pods on a node have *requested* against what the
 * node has to give.
 *
 * Argo's pod view groups pods by node, and the question that grouping exists to
 * answer is which node is full. I first recorded this as blocked on metrics and
 * that was wrong: metrics answer *usage*, and the scheduler does not schedule on
 * usage. It schedules on requests against allocatable, both of which are plain
 * fields on objects already being fetched — which is exactly what `kubectl
 * describe node` prints under "Allocated resources".
 *
 * So this needs no metrics server, and works on a cluster that has none.
 *
 * Pure, and separate from the view, for the same reason the layout is: summing
 * quantities and dividing is arithmetic and belongs where it can be tested as
 * arithmetic.
 */

export interface NodeInput {
  readonly name: string;
  /** `status.allocatable` — what the scheduler may hand out, which is capacity
   *  minus whatever the kubelet reserves. Capacity would overstate every node. */
  readonly allocatableCpu?: string;
  readonly allocatableMemory?: string;
  readonly health: Health;
}

export interface PodInput {
  readonly name: string;
  readonly nodeName?: string;
  readonly health: Health;
  /** One entry per container, already summed from `resources.requests`. */
  readonly requests: readonly { readonly cpu?: string; readonly memory?: string }[];
  /** Terminal pods hold no resources and must not be counted. */
  readonly phase?: string;
}

export interface NodeAllocation {
  readonly name: string;
  readonly health: Health;
  /** Worst health among the node itself and everything scheduled on it. */
  readonly rollup: Health;
  readonly podCount: number;
  readonly cpu: {
    readonly requested: number;
    readonly allocatable: number;
    readonly ratio: number;
    readonly text: string;
  };
  readonly memory: {
    readonly requested: number;
    readonly allocatable: number;
    readonly ratio: number;
    readonly text: string;
  };
}

/** Succeeded and Failed pods are finished: their containers hold nothing, and
 *  counting them would show a node as full of things that have stopped. */
const TERMINAL = new Set(["Succeeded", "Failed"]);

function ratio(requested: number, allocatable: number): number {
  // An unknown allocatable is reported as 0 rather than as a full bar — an
  // unmeasurable node must not look like a healthy one or like a broken one.
  return allocatable > 0 ? requested / allocatable : 0;
}

export function allocationByNode(nodes: readonly NodeInput[], pods: readonly PodInput[]): NodeAllocation[] {
  const scheduled = new Map<string, PodInput[]>();
  for (const pod of pods) {
    if (!pod.nodeName || TERMINAL.has(pod.phase ?? "")) continue;
    const list = scheduled.get(pod.nodeName);
    if (list) list.push(pod);
    else scheduled.set(pod.nodeName, [pod]);
  }

  return (
    nodes
      .map(node => {
        const on = scheduled.get(node.name) ?? [];
        let millicores = 0;
        let bytes = 0;
        for (const pod of on) {
          for (const c of pod.requests) {
            if (c.cpu) millicores += CpuQuantity.parse(c.cpu).toMillicores();
            if (c.memory) bytes += MemoryQuantity.parse(c.memory).bytes;
          }
        }
        const cpuAllocatable = node.allocatableCpu ? CpuQuantity.parse(node.allocatableCpu).toMillicores() : 0;
        const memAllocatable = node.allocatableMemory ? MemoryQuantity.parse(node.allocatableMemory).bytes : 0;
        return {
          name: node.name,
          health: node.health,
          rollup: worstHealth([node.health, ...on.map(p => p.health)]),
          podCount: on.length,
          cpu: {
            requested: millicores,
            allocatable: cpuAllocatable,
            ratio: ratio(millicores, cpuAllocatable),
            text: `${CpuQuantity.parse(millicores / 1000).format()} / ${cpuAllocatable ? CpuQuantity.parse(cpuAllocatable / 1000).format() : "?"}`,
          },
          memory: {
            requested: bytes,
            allocatable: memAllocatable,
            ratio: ratio(bytes, memAllocatable),
            text: `${MemoryQuantity.parse(bytes).format()} / ${memAllocatable ? MemoryQuantity.parse(memAllocatable).format() : "?"}`,
          },
        };
      })
      // Fullest first: the reason to open this view is to find the node that is
      // out of room, and sorting by name would bury it.
      .sort(
        (a, b) =>
          Math.max(b.cpu.ratio, b.memory.ratio) - Math.max(a.cpu.ratio, a.memory.ratio) || a.name.localeCompare(b.name),
      )
  );
}

/** Requests summed per container from a pod's raw spec. */
export function requestsOf(spec: unknown): { cpu?: string; memory?: string }[] {
  if (!spec || typeof spec !== "object") return [];
  const containers = (spec as { containers?: unknown }).containers;
  if (!Array.isArray(containers)) return [];
  return containers.map(c => {
    const requests = (c as { resources?: { requests?: Record<string, string> } })?.resources?.requests ?? {};
    return { cpu: requests.cpu, memory: requests.memory };
  });
}

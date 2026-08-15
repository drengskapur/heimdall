/**
 * A stable colour per Kubernetes kind, for the relation graph.
 *
 * A lineage graph that colours its nodes by resource type, and pairs that with
 * a legend, is legible at a glance. Heimdall's graph drew every linked object
 * in the same colour, so a
 * Pod, a Service and a ConfigMap were distinguishable only by reading the small
 * label under each one.
 *
 * This is a deliberate exception to the one-hue discipline the chrome follows.
 * Chrome is quiet so that data can carry colour; a graph *is* data. The colour
 * is also never the only signal — every node keeps its kind printed beneath it,
 * so nothing is lost to anyone who cannot separate the hues.
 *
 * Values are Blueprint's extended palette at the 3 step, which is the range that
 * holds up on both the light and the dark surface. Named tokens with a hex
 * fallback, because the extended families are not all guaranteed to be defined.
 */
const PALETTE = [
  "var(--bp-palette-blue-3, #2d72d2)",
  "var(--bp-palette-green-3, #238551)",
  "var(--bp-palette-orange-3, #c87619)",
  "var(--bp-palette-violet-3, #9179f2)",
  "var(--bp-palette-turquoise-3, #00a396)",
  "var(--bp-palette-rose-3, #db2c6f)",
  "var(--bp-palette-cerulean-3, #147eb3)",
  "var(--bp-palette-gold-3, #d1980b)",
  "var(--bp-palette-indigo-3, #7961db)",
  "var(--bp-palette-forest-3, #29a634)",
  "var(--bp-palette-vermilion-3, #d33d17)",
  "var(--bp-palette-sepia-3, #946638)",
] as const;

/**
 * The kinds a cluster view meets most often get a fixed slot, so a Pod is the
 * same colour on every graph rather than shifting with whatever else happens to
 * be linked. Everything else hashes into the same palette.
 */
const FIXED: Readonly<Record<string, number>> = {
  Pod: 0,
  Deployment: 1,
  Service: 2,
  ConfigMap: 3,
  Secret: 5,
  Node: 4,
  Namespace: 6,
  ReplicaSet: 8,
  StatefulSet: 9,
  DaemonSet: 10,
  Job: 7,
  CronJob: 11,
};

/** FNV-1a, so an unlisted kind lands somewhere stable rather than by order. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function kindColor(kind: string): string {
  if (!kind) return PALETTE[0];
  const fixed = FIXED[kind];
  const index = fixed ?? hash(kind) % PALETTE.length;
  return PALETTE[index];
}

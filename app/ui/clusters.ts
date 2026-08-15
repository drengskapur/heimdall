/**
 * Catalog entities that can be pinned to the Hotbar. In real Lens a hotbar item
 * may be any catalog entity (cluster, web link, general); here we model clusters.
 */
export interface Cluster {
  readonly id: string;
  readonly name: string;
  /** 2–3 char avatar initials. */
  readonly short: string;
  /** Avatar background (deterministic in Lens; explicit here). */
  readonly color: string;
  /** Drives the green "connected" LED on the tile. */
  readonly connected?: boolean;
}

/** Number of cells per hotbar (matches Lens `defaultHotbarCells`). */
export const HOTBAR_CELLS = 12;

/**
 * A hotbar is a fixed-length **sparse** array of exactly {@link HOTBAR_CELLS} slots;
 * `null` = an empty slot (a valid drop target). Removing leaves a hole (no compaction).
 */
export interface Hotbar {
  readonly id: string;
  readonly name: string;
  readonly items: readonly (string | null)[];
}

/** Pad/truncate a list of cluster ids into a fixed-length sparse slot array. */
export const slots = (ids: (string | null)[]): (string | null)[] => {
  const cells = ids.slice(0, HOTBAR_CELLS);
  while (cells.length < HOTBAR_CELLS) cells.push(null);
  return cells;
};

/**
 * graph-layout.ts
 *
 * Pure functions for persisting and restoring D3 force simulation node positions.
 *
 * Layout persistence improves UX by making the graph look the same each time
 * the panel is opened, rather than re-running the layout from random starting
 * positions. Positions are stored per-vault in the plugin's settings JSON.
 *
 * No D3 imports — the GraphNode interface from graph-builder.ts already carries
 * x/y/fx/fy as optional fields, and that is all this module needs.
 *
 * Storage format (in api.saveSettings):
 * {
 *   "layouts": {
 *     "<vaultId>": {
 *       "vaultId": "...",
 *       "savedAt": 1234567890,
 *       "positions": { "/path/note.md": { "x": 42, "y": 100 } }
 *     }
 *   }
 * }
 */

import type { GraphNode } from "./graph-builder";

// ── Interfaces ────────────────────────────────────────────────────────────────

/**
 * Serialised layout for one vault, stored inside plugin settings.
 *
 * The `positions` map keys are node ids (absolute paths). The values hold the
 * last known x/y for each node. For pinned nodes (fx/fy set), the pinned coords
 * are saved so the pin is restored on reload.
 */
export interface PersistedLayout {
  /** The vault id this layout belongs to. Used to reject cross-vault loads. */
  vaultId: string;
  /** Unix timestamp (ms) when this layout was saved. */
  savedAt: number;
  /** Node id → last known position. */
  positions: Record<string, { x: number; y: number }>;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Extract the current x/y positions from a D3 simulation node array and
 * return a PersistedLayout ready to be stored in plugin settings.
 *
 * Pinned nodes (those with fx/fy set to a number) are serialised using their
 * pinned coordinates so the pin is restored when the layout is applied on
 * the next panel open.
 *
 * Nodes that have no position yet (x/y both undefined — this can happen if
 * the simulation has not ticked yet) are omitted from the layout.
 *
 * @param vaultId - The id of the active vault.
 * @param nodes   - Current D3 simulation node array (positions may be mutated
 *                  by the simulation; read at the moment this function is called).
 * @returns A PersistedLayout ready for storage.
 */
export function serializeLayout(vaultId: string, nodes: GraphNode[]): PersistedLayout {
  const positions: Record<string, { x: number; y: number }> = {};

  for (const node of nodes) {
    // Pinned nodes: use fx/fy (the pinned position) rather than x/y (the
    // simulation's current drag position, which may differ slightly).
    const x = typeof node.fx === "number" ? node.fx : node.x;
    const y = typeof node.fy === "number" ? node.fy : node.y;

    if (typeof x === "number" && typeof y === "number") {
      positions[node.id] = { x, y };
    }
    // Nodes with undefined positions are skipped — they will get random
    // starting positions when applyPersistedLayout is called next time.
  }

  return {
    vaultId,
    savedAt: Date.now(),
    positions,
  };
}

/**
 * Apply persisted positions to a node array before the D3 simulation starts.
 *
 * Nodes whose id is found in the layout's positions map get their x/y set to
 * the persisted values. This makes the simulation start from the saved layout
 * rather than from random positions, giving the user a visually stable graph.
 *
 * New nodes (not in the layout) get random x/y values drawn from the range
 * [-200, +200]. The simulation will find their equilibrium position from there.
 *
 * Note: This function mutates the nodes array in place (D3 simulation objects
 * are mutable by design; D3 itself mutates x/y/vx/vy during ticks).
 *
 * @param nodes  - Node array to initialise (mutated in place).
 * @param layout - The persisted layout to restore from.
 * @returns The same nodes array (mutated), for fluent call chaining.
 */
export function applyPersistedLayout(nodes: GraphNode[], layout: PersistedLayout): GraphNode[] {
  for (const node of nodes) {
    const saved = layout.positions[node.id];
    if (saved) {
      node.x = saved.x;
      node.y = saved.y;
    } else {
      // New node not in the layout: start at a random position so the
      // simulation can find a good place for it among the existing nodes.
      // Range [-200, +200] keeps the node near the graph centre.
      node.x = Math.random() * 400 - 200;
      node.y = Math.random() * 400 - 200;
    }
  }
  return nodes;
}

/**
 * Return true when the layout is non-null, belongs to the given vault, and
 * contains at least one persisted position.
 *
 * The vaultId check prevents accidentally applying a layout from a previously
 * active vault after the user switches vaults (EC-36).
 *
 * @param layout  - The persisted layout to validate, or null if none exists.
 * @param vaultId - The currently active vault's id.
 * @returns True when the layout is valid and applicable.
 */
export function isLayoutValid(layout: PersistedLayout | null, vaultId: string): boolean {
  if (!layout) return false;
  if (layout.vaultId !== vaultId) return false;
  return Object.keys(layout.positions).length > 0;
}

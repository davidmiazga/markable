/**
 * graph-builder.ts
 *
 * Pure functions that transform a VaultIndex (array of VaultIndexEntry) into
 * GraphData consumed by the D3 force-directed renderer.
 *
 * No D3 imports. No DOM. No Tauri. This module is independently testable
 * with plain Vitest without any environment stubs.
 *
 * Design notes:
 * - One GraphNode is created per indexed entry.
 * - Ghost nodes are created for wiki-link targets that do not resolve to any
 *   indexed entry (EC-33). Ghost nodes are shown with a dashed outline in the
 *   renderer and are not clickable.
 * - Bidirectional edges (A→B and B→A both exist) are collapsed into a single
 *   edge with isBidirectional: true rather than two directed edges.
 * - Duplicate links between the same pair (A references B twice) increase the
 *   edge weight rather than adding a second edge.
 * - EC-38 decision: self-referential wiki-links ([[self]] in self.md) ARE
 *   included as self-loop edges. This makes the graph truthful about a note
 *   linking to itself. Renderers should draw a small loop arc on the node.
 *   An alternative design (omit self-loops) is documented here but NOT used.
 * - EC-34: ambiguous links (stem matches multiple entries) produce an edge with
 *   isAmbiguous: true. All matching targets get an edge from the source note.
 */

import type { VaultIndexEntry, VaultFileChangedEvent } from "../../lib/vault-types";

// ── Interfaces ────────────────────────────────────────────────────────────────

/**
 * A single note (or ghost) node in the knowledge graph.
 *
 * The D3 force simulation mutates x, y, vx, vy directly on these objects during
 * the layout computation. fx/fy are used to pin a node at a fixed position after
 * the user drags it (null = unpinned).
 */
export interface GraphNode {
  /** Absolute path — also used as the unique D3 node id. */
  id: string;
  /** Display title from VaultIndexEntry.title, or the stem for ghost nodes. */
  label: string;
  /** Absolute path (same as id; duplicated for clarity in rendering code). */
  path: string;
  /**
   * Total unique link connections: outbound edges + inbound edges.
   * Used to scale the node radius proportionally.
   */
  connectionCount: number;
  /** True for ghost nodes created from broken wiki-links (EC-33). */
  isGhost: boolean;
  /** D3 simulation: current x position (mutable, set by simulation). */
  x?: number;
  /** D3 simulation: current y position (mutable, set by simulation). */
  y?: number;
  /** D3 simulation: pinned x (null = unpinned, undefined = not yet pinned). */
  fx?: number | null;
  /** D3 simulation: pinned y (null = unpinned, undefined = not yet pinned). */
  fy?: number | null;
  /**
   * Non-standard field used by the search filter to dim non-matching nodes.
   * Not part of the D3 node type; added by the plugin at render time.
   */
  dimmed?: boolean;
}

/**
 * A link between two GraphNodes.
 *
 * The D3 forceLink mutates this object after nodes() and links() are bound,
 * replacing the string source/target with resolved node references. TypeScript
 * sees the original string form here; the rendered type is wider.
 */
export interface GraphEdge {
  /** Source node id (path). */
  source: string;
  /** Target node id (path). */
  target: string;
  /** Number of wiki-links from source to target (≥ 1). Drives stroke-width. */
  weight: number;
  /** True when both A→B and B→A links exist and are collapsed into one edge. */
  isBidirectional: boolean;
  /** True when the target stem matched multiple entries (EC-34). */
  isAmbiguous: boolean;
}

/** Complete graph snapshot passed to the D3 renderer. */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the filename stem (without extension) from an absolute path.
 * Used when resolving wiki-links against the index, because wiki-link stems
 * typically omit the .md extension (e.g. [[meeting]] → meeting.md).
 *
 * @param path - Absolute file path (e.g. "/vault/notes/meeting.md").
 * @returns The stem string (e.g. "meeting").
 */
function stemOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dotIdx = base.lastIndexOf(".");
  return dotIdx > 0 ? base.slice(0, dotIdx) : base;
}

/**
 * Canonical edge key for deduplication.
 * For bidirectional detection we normalise the pair so that (A,B) and (B,A)
 * produce the same canonical key only when we intentionally want to merge them.
 * For weight counting we use the directed key (source < target ordering is NOT
 * applied) so that A→B and B→A are kept separate until the bidirectional pass.
 *
 * @param source - Source node id.
 * @param target - Target node id.
 * @returns A string key unique to the ordered (source, target) pair.
 */
function directedKey(source: string, target: string): string {
  return `${source}→${target}`;
}

// NOTE: The undirectedKey function was intentionally removed after the
// bidirectional detection algorithm was redesigned to use directed keys
// (forward + reverse lookup) rather than sorted keys. This approach avoids
// creating an index of all canonical pairs and handles self-loops correctly.

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Resolve a wiki-link stem to zero, one, or multiple absolute paths.
 *
 * The stem is compared case-insensitively against the `name` field of each
 * VaultIndexEntry (the filename without extension). This matches the convention
 * used by the backlinks plugin.
 *
 * - Returns null   when no entry matches (ghost node case).
 * - Returns string when exactly one entry matches.
 * - Returns string[] when multiple entries match (ambiguous, EC-34).
 *
 * @param stem    - Wiki-link target as extracted from the note (e.g. "meeting").
 * @param entries - All indexed entries in the active vault.
 * @returns Resolved path(s), or null if the stem does not match any entry.
 */
export function resolveLink(
  stem: string,
  entries: VaultIndexEntry[]
): string | string[] | null {
  const lower = stem.toLowerCase();
  const matches = entries.filter((e) => e.name.toLowerCase() === lower);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].path;
  return matches.map((e) => e.path);
}

/**
 * Build a complete GraphData snapshot from a vault's index entries.
 *
 * Algorithm (Justification: must scan all entries twice — first to build the
 * node map, then to resolve links, because a forward link may reference a note
 * defined later in the entries array):
 *
 * Pass 1: Create a real node for every indexed entry.
 * Pass 2: For each entry's outboundLinks:
 *   a. Resolve the link stem via resolveLink().
 *   b. For resolved links: create or reuse the target node, record a directed edge.
 *   c. For unresolved links: create or reuse a ghost node, record a directed edge.
 *   d. Ambiguous links: create one edge per matched path, mark isAmbiguous: true.
 * Pass 3: Collapse bidirectional edge pairs (A→B + B→A → single edge with
 *   isBidirectional: true, combined weight).
 * Pass 4: Compute connectionCount for each node (sum of unique edges that
 *   touch the node, counting bidirectional edges once each).
 *
 * @param entries - Array of indexed VaultIndexEntry records for the active vault.
 * @returns A GraphData object with all nodes and edges.
 */
export function buildGraphData(entries: VaultIndexEntry[]): GraphData {
  // Justification: this function is intentionally over 30 lines because it
  // coordinates four distinct passes (node creation, link resolution, bidir
  // collapse, connectionCount) that are too interleaved to extract cleanly
  // without passing large intermediate Maps between helpers. Each numbered
  // pass has an inline comment marking its start.

  if (entries.length === 0) return { nodes: [], edges: [] };

  // Pass 1: real nodes for every indexed entry.
  const nodeMap = new Map<string, GraphNode>();
  for (const entry of entries) {
    nodeMap.set(entry.path, {
      id: entry.path,
      label: entry.title,
      path: entry.path,
      connectionCount: 0,
      isGhost: false,
    });
  }

  // Pass 2: resolve outbound links → directed edges + ghost nodes.
  // directedEdges maps directedKey → { weight, isAmbiguous } so we can
  // accumulate weight for duplicate links before the collapse pass.
  const directedEdges = new Map<string, { source: string; target: string; weight: number; isAmbiguous: boolean }>();

  for (const entry of entries) {
    for (const stem of entry.outboundLinks) {
      const resolved = resolveLink(stem, entries);

      if (resolved === null) {
        // Ghost node: create a synthetic node keyed by stem.
        const ghostId = `__ghost__:${stem}`;
        if (!nodeMap.has(ghostId)) {
          nodeMap.set(ghostId, {
            id: ghostId,
            label: stem,
            path: ghostId,
            connectionCount: 0,
            isGhost: true,
          });
        }
        accumulateEdge(directedEdges, entry.path, ghostId, false);
      } else if (typeof resolved === "string") {
        // Exact match — single target.
        accumulateEdge(directedEdges, entry.path, resolved, false);
      } else {
        // Ambiguous — one edge per matched path, all marked isAmbiguous.
        for (const targetPath of resolved) {
          accumulateEdge(directedEdges, entry.path, targetPath, true);
        }
      }
    }
  }

  // Pass 3: collapse mirror-image directed edges into single bidirectional edges.
  const finalEdges = collapseBidirectional(directedEdges);

  // Pass 4: compute connectionCount per node.
  computeConnectionCounts(nodeMap, finalEdges);

  return { nodes: Array.from(nodeMap.values()), edges: finalEdges };
}

/**
 * Accumulate a directed edge in the work map, incrementing weight for
 * duplicate (source, target) pairs rather than adding a second entry.
 *
 * @param map       - The directed-edges accumulator map.
 * @param source    - Source node id.
 * @param target    - Target node id.
 * @param isAmbig   - Whether this edge is ambiguous (EC-34).
 */
function accumulateEdge(
  map: Map<string, { source: string; target: string; weight: number; isAmbiguous: boolean }>,
  source: string,
  target: string,
  isAmbig: boolean
): void {
  const key = directedKey(source, target);
  const existing = map.get(key);
  if (existing) {
    existing.weight += 1;
    // Once ambiguous, always ambiguous for this pair.
    existing.isAmbiguous = existing.isAmbiguous || isAmbig;
  } else {
    map.set(key, { source, target, weight: 1, isAmbiguous: isAmbig });
  }
}

/**
 * Collapse pairs of directed edges (A→B and B→A) into single bidirectional
 * edges. The combined weight is the sum of both directed weights.
 *
 * Self-loop edges (EC-38: source === target) are kept as-is because they do
 * not have a mirror counterpart.
 *
 * @param directedEdges - Map of directed edge key → edge data.
 * @returns Array of final GraphEdge objects.
 */
function collapseBidirectional(
  directedEdges: Map<string, { source: string; target: string; weight: number; isAmbiguous: boolean }>
): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];

  for (const [key, edge] of directedEdges) {
    if (seen.has(key)) continue; // already merged as the reverse

    // Self-loop: no reverse to look for — include as-is.
    if (edge.source === edge.target) {
      result.push({
        source: edge.source,
        target: edge.target,
        weight: edge.weight,
        isBidirectional: false,
        isAmbiguous: edge.isAmbiguous,
      });
      seen.add(key);
      continue;
    }

    const reverseKey = directedKey(edge.target, edge.source);
    const reverse = directedEdges.get(reverseKey);

    if (reverse) {
      // Both directions exist — merge into one bidirectional edge.
      result.push({
        source: edge.source,
        target: edge.target,
        weight: edge.weight + reverse.weight,
        isBidirectional: true,
        isAmbiguous: edge.isAmbiguous || reverse.isAmbiguous,
      });
      seen.add(key);
      seen.add(reverseKey);
    } else {
      // Unidirectional edge.
      result.push({
        source: edge.source,
        target: edge.target,
        weight: edge.weight,
        isBidirectional: false,
        isAmbiguous: edge.isAmbiguous,
      });
      seen.add(key);
    }
  }

  return result;
}

/**
 * Compute connectionCount for every node by counting the number of edges
 * that touch each node. Bidirectional edges count once (not twice).
 *
 * The count reflects the total number of unique link relationships a note
 * participates in, regardless of direction. This drives the node radius formula.
 *
 * @param nodeMap    - All nodes (real + ghost), mutated in place.
 * @param finalEdges - The collapsed edge list from collapseBidirectional().
 */
function computeConnectionCounts(
  nodeMap: Map<string, GraphNode>,
  finalEdges: GraphEdge[]
): void {
  // Reset counts first (guards against accidental double-call).
  for (const node of nodeMap.values()) {
    node.connectionCount = 0;
  }

  for (const edge of finalEdges) {
    // Self-loops add 1 (a note referencing itself counts as one connection).
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (sourceNode) sourceNode.connectionCount += 1;
    if (targetNode && edge.target !== edge.source) {
      targetNode.connectionCount += 1;
    }
  }
}

// ── Incremental update ─────────────────────────────────────────────────────────

/**
 * Apply a single VaultFileChangedEvent to an existing GraphData snapshot.
 *
 * Returns a brand-new GraphData object (immutable update pattern) to allow the
 * renderer to diff old vs new without mutating the live D3-bound arrays.
 *
 * Supported event types:
 * - "created": A new file appeared. Re-run buildGraphData over the new entries
 *   list (which includes the updated entry for the new file).
 * - "deleted": Remove the node at event.path and all edges touching it.
 * - "modified": Update the node's edges by rebuilding only the affected entry's
 *   outbound links. Other entries are unchanged.
 * - "renamed": Treated as deleted + created in the updated entries list.
 *
 * @param data         - Current GraphData snapshot (immutable input).
 * @param event        - The file-system change event.
 * @param updatedEntry - The new VaultIndexEntry for the changed path.
 *                       Required for "created" and "modified"; not needed for "deleted".
 * @returns            A new GraphData reflecting the change.
 */
export function mergeNodeUpdate(
  data: GraphData,
  event: VaultFileChangedEvent,
  updatedEntry?: VaultIndexEntry
): GraphData {
  // Justification: this function is over 30 lines because it handles four
  // distinct event types (created/modified/deleted/renamed) each with different
  // mutation logic. Extracting per-type helpers would require passing the full
  // GraphData state through each, which is no simpler.

  if (event.eventType === "deleted") {
    return handleDeletedEvent(data, event.path);
  }

  if (event.eventType === "created" || event.eventType === "modified" || event.eventType === "renamed") {
    if (!updatedEntry) {
      // Without the updated entry we cannot compute edges — return unchanged.
      console.warn("[graph-builder] mergeNodeUpdate: updatedEntry missing for", event.eventType);
      return data;
    }
    return handleUpsertEvent(data, event, updatedEntry);
  }

  // Unknown event type — return unchanged.
  return data;
}

/**
 * Handle a "deleted" event by removing the node and all its edges.
 *
 * @param data - Current snapshot.
 * @param path - Absolute path of the deleted file.
 * @returns New GraphData with the node and its edges removed.
 */
function handleDeletedEvent(data: GraphData, path: string): GraphData {
  const nodes = data.nodes.filter((n) => n.id !== path);
  const edges = data.edges.filter(
    (e) => e.source !== path && e.target !== path
  );
  // Recompute connectionCounts from scratch after deletion.
  const nodeMap = new Map<string, GraphNode>(nodes.map((n) => [n.id, { ...n, connectionCount: 0 }]));
  computeConnectionCounts(nodeMap, edges);
  return { nodes: Array.from(nodeMap.values()), edges };
}

/**
 * Handle "created", "modified", and "renamed" events by rebuilding the graph
 * from a synthetic entries array that replaces or adds the affected entry.
 *
 * This is a full rebuild over the merged entries list so we don't need separate
 * logic for adding vs updating — buildGraphData handles both cases.
 *
 * @param data         - Current snapshot.
 * @param event        - The change event.
 * @param updatedEntry - The new or updated VaultIndexEntry.
 * @returns New GraphData.
 */
function handleUpsertEvent(
  data: GraphData,
  event: VaultFileChangedEvent,
  updatedEntry: VaultIndexEntry
): GraphData {
  // Reconstruct a synthetic entries list from the current nodes (excluding ghosts)
  // plus the updated entry. This avoids a dependency on the full vault index here.

  // Build a minimal VaultIndexEntry for each non-ghost node that isn't the
  // updated entry. We only need path/name/title/outboundLinks for graph building.
  // For existing nodes without new entry data, recover outboundLinks from edges.
  const syntheticEntries: VaultIndexEntry[] = [];

  for (const node of data.nodes) {
    if (node.isGhost) continue;
    if (node.path === updatedEntry.path) continue; // replaced below

    // Recover outbound link stems from the existing edges where this node is source.
    const outboundLinks = data.edges
      .filter((e) => e.source === node.path && !e.isBidirectional)
      .map((e) => {
        // Ghost targets use __ghost__: prefix — recover the stem.
        const t = e.target;
        return t.startsWith("__ghost__:") ? t.slice("__ghost__:".length) : stemOf(t);
      });

    // For bidirectional edges where this node is source OR target, include both
    // directions. When the node is the target of a bidir edge (source=other,
    // target=this), the node has an outbound link back to the source — that must
    // be recovered here to avoid losing the reverse direction after a rebuild.
    const bidirLinks = data.edges
      .filter((e) => e.isBidirectional && (e.source === node.path || e.target === node.path))
      .map((e) => {
        // The "other" endpoint is the outbound link target for this node.
        const other = e.source === node.path ? e.target : e.source;
        return other.startsWith("__ghost__:") ? other.slice("__ghost__:".length) : stemOf(other);
      });

    syntheticEntries.push({
      path: node.path,
      name: stemOf(node.path),
      title: node.label,
      modified: 0,
      size: 0,
      tags: [],
      outboundLinks: [...outboundLinks, ...bidirLinks],
    });
  }

  // For a "renamed" event the old path node is replaced by the new entry.
  if (event.eventType === "renamed" && event.newPath) {
    // Remove the old path entry if it exists.
    const oldPathIdx = syntheticEntries.findIndex((e) => e.path === event.path);
    if (oldPathIdx !== -1) syntheticEntries.splice(oldPathIdx, 1);
  }

  // Add the updated entry (covers created, modified, and the new-path of renamed).
  if (!syntheticEntries.some((e) => e.path === updatedEntry.path)) {
    syntheticEntries.push(updatedEntry);
  } else {
    // Replace in case of a modified event on an already-tracked entry.
    const idx = syntheticEntries.findIndex((e) => e.path === updatedEntry.path);
    syntheticEntries[idx] = updatedEntry;
  }

  return buildGraphData(syntheticEntries);
}

// ── Ghost node pruning ─────────────────────────────────────────────────────────

/**
 * Prune ghost nodes that have been resolved by newly indexed entries.
 *
 * When a file that was previously a broken link target is added to the vault,
 * its ghost node should become a real node. This function converts ghost nodes
 * whose stem now matches an indexed entry into real nodes.
 *
 * @param data    - Current GraphData (immutable input).
 * @param entries - Updated full list of VaultIndexEntry records.
 * @returns New GraphData with resolved ghost nodes converted to real nodes.
 */
export function pruneGhostNodes(_data: GraphData, entries: VaultIndexEntry[]): GraphData {
  // Rebuild from scratch with the new entries — the simplest correct approach
  // since ghost/real status can change for multiple nodes at once.
  // _data is intentionally ignored: the new entries list is the ground truth.
  return buildGraphData(entries);
}

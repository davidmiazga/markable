---
title: "PKM Step 03 — Knowledge Graph (D3 Force-Directed Panel)"
last-updated: "2026-04-24"
review-cadence-days: 14
status: active
---

# Step 03 — Knowledge Graph

## Goal

Implement the Knowledge Graph sidebar panel: a D3 force-directed SVG graph of notes and wiki-link connections in the active vault. Includes all specified interactions (click/hover/drag/zoom/pan/search), layout persistence per vault, incremental updates on index changes, and empty states.

**Prerequisite**: Steps 01, 02a, 02b complete. `vault-manager.ts` is available with a working `onIndexUpdated` event bus.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/plugins/knowledge-graph/knowledge-graph.plugin.ts` | IIFE plugin: D3 graph panel, all interaction handlers, panel lifecycle |
| `src/plugins/knowledge-graph/graph-builder.ts` | Pure functions: buildGraphData, mergeNodeUpdate, pruneGhostNodes |
| `src/plugins/knowledge-graph/graph-layout.ts` | Layout persistence: serialize, deserialize, apply to simulation nodes |
| `src/plugins/knowledge-graph/knowledge-graph.css` | Graph panel visual styles, SVG node/edge classes, tooltip |

---

## Files to Modify

| File | Change |
|---|---|
| `src/plugins/index.ts` (or plugin registry) | Register `knowledge-graph` as a core plugin. |
| `src-tauri/src/commands/plugins.rs` (copy_core_plugins) | Add `knowledge-graph.plugin.js` to expected plugin list. |

---

## Dependencies to Add

```bash
npm install d3-force d3-selection d3-zoom d3-drag
npm install --save-dev @types/d3-force @types/d3-selection @types/d3-zoom @types/d3-drag
```

These are selective D3 sub-packages. Do NOT install the monolithic `d3` package — it would add ~270 KB to the bundle. The four sub-packages total approximately ~100 KB minified.

---

## `graph-builder.ts` — Pure Functions

No D3 imports. No DOM. No Tauri. Takes `VaultIndexEntry[]` and returns plain data.

```typescript
export interface GraphNode {
  id: string;               // Absolute path (unique)
  label: string;            // title from VaultIndexEntry
  path: string;             // Absolute path
  connectionCount: number;  // inbound + outbound links
  isGhost: boolean;         // true for broken-link targets not in index
  // D3 simulation positions (mutable, set by simulation)
  x?: number;
  y?: number;
  fx?: number | null;       // pinned x (null = unpinned)
  fy?: number | null;       // pinned y (null = unpinned)
}

export interface GraphEdge {
  source: string;           // node id (path)
  target: string;           // node id (path)
  weight: number;           // number of links between source and target
  isBidirectional: boolean; // true when both A→B and B→A links exist
  isAmbiguous: boolean;     // true when target matches multiple notes (EC-34)
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Build graph data from vault index entries.
 * One node per indexed note.
 * Ghost nodes created for broken links (wiki-links to non-indexed paths, EC-33).
 * Bidirectional edges collapsed to single edge with isBidirectional: true.
 * Duplicate links between same pair counted in weight, not as multiple edges.
 * Self-links: include as self-loop edge OR omit — document the choice in code (EC-38).
 */
export function buildGraphData(entries: VaultIndexEntry[]): GraphData;

/**
 * Apply a single VaultFileChangedEvent to existing GraphData.
 * Returns a new GraphData (immutable update).
 * Used by the incremental update path (FR-03.8).
 */
export function mergeNodeUpdate(
  data: GraphData,
  event: VaultFileChangedEvent,
  updatedEntry?: VaultIndexEntry
): GraphData;

/**
 * Resolve wiki-link target stem to a node id (absolute path).
 * If the stem matches exactly one entry by name: return that entry's path.
 * If it matches zero entries: return null (ghost node case).
 * If it matches multiple entries: return all paths (ambiguous, EC-34).
 */
export function resolveLink(
  stem: string,
  entries: VaultIndexEntry[]
): string | string[] | null;
```

**EC-38 decision** (document in code): self-referential wiki-links (`[[self]]` in `self.md`) are included as self-loop edges in the graph data. The rendering step draws a small loop arc on the node. This is the documented choice; an alternative (omit self-loops) is acceptable but must be documented.

---

## `graph-layout.ts` — Pure Functions

```typescript
export interface PersistedLayout {
  vaultId: string;
  savedAt: number;         // Unix timestamp ms
  positions: Record<string, { x: number; y: number }>;
  // key = node id (path); value = last known position
}

/**
 * Extract positions from simulation nodes and return a PersistedLayout.
 */
export function serializeLayout(
  vaultId: string,
  nodes: GraphNode[]
): PersistedLayout;

/**
 * Apply persisted positions to nodes before starting the simulation.
 * Nodes with a persisted position get their x/y set to the persisted values.
 * New nodes (not in persisted layout) get random positions (simulation will place them).
 * Returns the mutated nodes array (not a copy — nodes are D3 simulation objects).
 */
export function applyPersistedLayout(
  nodes: GraphNode[],
  layout: PersistedLayout
): GraphNode[];

/**
 * True if the persisted layout is valid for the given vault and has positions.
 */
export function isLayoutValid(layout: PersistedLayout | null, vaultId: string): boolean;
```

Layout persistence storage: in plugin settings via `api.saveSettings`:
```json
{
  "layouts": {
    "<vaultId>": {
      "vaultId": "...",
      "savedAt": 1234567890,
      "positions": { "/path/note.md": { "x": 42, "y": 100 } }
    }
  }
}
```

Layout is saved: (a) after simulation stabilises (force magnitude below threshold), (b) on panel hide (partial layout saved), (c) on node drag-end.

Layout is loaded: when the panel opens for an active vault. If no layout exists, simulation starts from random positions.

---

## `knowledge-graph.plugin.ts` — Structure

### Plugin lifecycle

**`onEnable(api)`**:
1. `api.loadSettings()` for graph-specific settings (node size range, label zoom threshold).
2. `api.registerSidebarPanel(descriptor)`.
3. Subscribe to `vaultManager.onVaultChanged()` → full graph rebuild.
4. Subscribe to `vaultManager.onIndexUpdated()` → incremental graph update.

**`onDisable(api)`**:
1. `api.unregisterSidebarPanel("knowledge-graph")`.
2. Pause simulation.
3. Save layout via `api.saveSettings()`.
4. Unsubscribe from vault-manager events.

**`SidebarPanelDescriptor`**:
```typescript
{
  id: "knowledge-graph",
  title: "Graph",
  side: "right",
  defaultWidth: 300,
  render(container) { initGraph(container); },
  destroy(container) { teardownGraph(container); },
  headerActions: [
    { icon: "⟳", title: "Refresh", onClick: () => rebuildGraph() },
    { icon: "⚙", title: "Graph settings", onClick: () => openGraphSettings() },
  ],
}
```

### Panel DOM structure

```html
<div class="graph-panel">
  <div class="graph-controls">
    <input class="graph-search" placeholder="Search notes…" type="search" />
    <div class="graph-zoom-controls">
      <button class="graph-zoom-in">+</button>
      <button class="graph-zoom-out">−</button>
      <button class="graph-zoom-fit">Fit</button>
    </div>
  </div>
  <div class="graph-container">
    <svg class="graph-svg" width="100%" height="100%">
      <g class="graph-g">       <!-- zoom/pan transform applied here -->
        <g class="edges-g"></g>
        <g class="nodes-g"></g>
        <g class="labels-g"></g>
      </g>
    </svg>
    <div class="graph-tooltip" style="display:none"></div>
    <div class="graph-loading" style="display:none">Building graph…</div>
    <div class="graph-empty" style="display:none">No connections yet. Add [[wiki-links]] to connect notes.</div>
    <div class="graph-empty-vault" style="display:none">Activate a vault to see the graph.</div>
  </div>
</div>
```

---

## D3 Rendering

### Setup

```typescript
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { drag } from "d3-drag";
```

### Forces

```typescript
const simulation = forceSimulation(nodes)
  .force("charge", forceManyBody().strength(-120))
  .force("link", forceLink(edges)
    .id((d: GraphNode) => d.id)
    .distance(80)
    .strength(0.5))
  .force("center", forceCenter(width / 2, height / 2))
  .force("collide", forceCollide().radius((d: GraphNode) => nodeRadius(d) + 4));
```

### Node radius

```typescript
function nodeRadius(node: GraphNode): number {
  const MIN_R = 5;
  const MAX_R = 18;
  // Proportional to sqrt(connectionCount) — avoids hub nodes dominating.
  return Math.max(MIN_R, Math.min(MAX_R, MIN_R + Math.sqrt(node.connectionCount) * 2));
}
```

### Node appearance

- Fill: `var(--accent-color)` for normal nodes. `rgba(128,128,128,0.3)` for ghost nodes.
- Stroke: none by default. `var(--accent-color)` with thicker stroke for selected node (`.node-selected`).
- Ghost nodes: dashed stroke (achieved via `stroke-dasharray`), no fill (fill: transparent).

### Edge appearance

- Normal edges: `stroke: var(--graph-edge-color, rgba(128,128,128,0.5))`, `stroke-width: 1`.
- Bidirectional: `stroke-width: 2` + double arrow marker.
- Ghost edges (to ghost nodes): `stroke-dasharray: 4,2`, dimmed.
- Ambiguous edges (EC-34): `stroke: var(--graph-ambiguous-edge, orange)`.
- Edge weight → thickness: `stroke-width: 1 + Math.log(edge.weight)`.

### SVG markers for arrows

Define `<defs>` with `<marker>` elements for arrow heads. One marker for directed edges, one for bidirectional (arrowhead on both ends).

### Labels

Labels are `<text>` elements inside `<g class="labels-g">` positioned at `node.x, node.y + nodeRadius + 12`.

Label visibility is controlled by zoom level. When the D3 zoom transform scale `k < 0.6`, labels are hidden (`display: none`) to avoid overlap on zoomed-out view (threshold configurable in graph settings).

### Zoom and pan

```typescript
const zoomHandler = zoom<SVGSVGElement, unknown>()
  .scaleExtent([0.1, 4])
  .on("zoom", (event) => {
    graphG.attr("transform", event.transform);
    // Hide labels below zoom threshold
    labelsG.style("display", event.transform.k < labelZoomThreshold ? "none" : "");
  });

svg.call(zoomHandler);

// Double-click background: fit all nodes
svg.on("dblclick.zoom", () => {
  svg.transition().duration(400).call(zoomHandler.transform, zoomIdentity);
});
```

### Node drag

```typescript
const dragHandler = drag<SVGCircleElement, GraphNode>()
  .on("start", (event, d) => {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  })
  .on("drag", (event, d) => {
    d.fx = event.x;
    d.fy = event.y;
  })
  .on("end", (event, d) => {
    if (!event.active) simulation.alphaTarget(0);
    // Node stays pinned (fx/fy remain set). User must click the pinned node to unpin.
    saveLayoutDebounced();
  });
```

Clicking a pinned node (where `node.fx !== null`) sets `node.fx = null; node.fy = null` to unpin.

### Node click

```typescript
node.on("click", (event, d) => {
  event.stopPropagation(); // prevent background click handler
  if (d.isGhost) return;   // ghost nodes not interactive
  __MARKABLE_TAB_MANAGER__.openFile(d.path);
  // Update selected ring
  select(".node-selected").classed("node-selected", false);
  select(event.currentTarget).classed("node-selected", true);
});
```

### Node hover tooltip

```typescript
node.on("mouseenter", (event, d) => {
  const tooltip = container.querySelector(".graph-tooltip") as HTMLElement;
  tooltip.innerHTML = `
    <strong>${escapeHtml(d.label)}</strong>
    <span>${d.connectionCount} connection${d.connectionCount !== 1 ? "s" : ""}</span>
    ${d.isGhost ? "<em>Broken link</em>" : ""}
  `;
  positionTooltip(tooltip, event.clientX, event.clientY, container);
  tooltip.style.display = "block";
});

node.on("mouseleave", () => {
  container.querySelector<HTMLElement>(".graph-tooltip")!.style.display = "none";
});
```

Note: tooltip must not include first-line content in Phase 1 (requires a file read). The `title` from the index is sufficient.

`positionTooltip`: positions the tooltip at `(clientX + 12, clientY - 8)`, then checks if it would overflow the panel's right or bottom edges and adjusts leftward/upward.

### Simulation lifecycle

- Panel shown (`onShow` or `render`): start simulation; set `alphaDecay(0.02)` for smoother layout.
- Panel hidden (`onHide`): `simulation.stop()`. Save partial layout.
- Simulation `on("tick")`: update node/edge/label positions.
- Simulation `on("end")`: simulation stabilised. Save final layout.
- 5-second time cap (FR-03.3): after 5 seconds, call `simulation.stop()` if still running.

### Search filter

```typescript
graphSearch.addEventListener("input", debounce(() => {
  const query = graphSearch.value.trim().toLowerCase();
  // Fuzzy match against node labels
  nodes.each((d) => {
    const matches = !query || fuzzyMatch(d.label.toLowerCase(), query);
    d.dimmed = !matches;
  });
  node.style("opacity", (d) => d.dimmed ? 0.2 : 1);
  label.style("opacity", (d) => d.dimmed ? 0 : 1);
  edge.style("opacity", (d) =>
    (d.source as GraphNode).dimmed || (d.target as GraphNode).dimmed ? 0.1 : 0.6
  );
}, 150));
```

Search does NOT remove nodes — it dims non-matching ones (FR-03 / Section 5.5).

---

## Incremental Graph Update (FR-03.8)

Subscribe to `vaultManager.onIndexUpdated()`. On each event:

1. Call `mergeNodeUpdate(graphData, event, updatedEntry)` to get new `GraphData`.
2. Diff old vs new: find added/removed/updated nodes and edges.
3. For added nodes: append new `<circle>` and `<text>` elements; restart simulation with low alpha (do not reset positions of existing nodes).
4. For removed nodes: remove their SVG elements; remove connected edges.
5. For updated nodes (wiki-links changed): update edge set; re-bind data; restart simulation.
6. Save layout after update settles (debounced 2 seconds).

Full rebuild is triggered only on vault switch or manual refresh.

---

## Performance Guard (R-03 / FR-03.11)

After the initial render but before the simulation is started, measure the container width/height. If there are more than 500 nodes, log a warning and reduce initial simulation alpha:

```typescript
if (nodes.length > 300) {
  simulation.alphaDecay(0.05); // faster convergence, less precision
}
```

At each simulation tick, track elapsed time. If elapsed > 3000ms and simulation has not converged, call `simulation.stop()` and use the current layout (FR-03.3).

To measure fps during interactive dragging: use `requestAnimationFrame` timing. If fps drops below 30 for 3 consecutive frames during drag, reduce `forceManyBody` strength by half for the duration of the drag. Restore on `dragend`.

---

## CSS (`knowledge-graph.css`)

```css
.graph-panel { display: flex; flex-direction: column; height: 100%; }
.graph-controls { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--border-color); }
.graph-search { flex: 1; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 4px; padding: 4px 8px; font: var(--ui-font); }
.graph-zoom-controls { display: flex; gap: 2px; }
.graph-zoom-controls button { background: var(--button-bg); border: 1px solid var(--border-color); border-radius: 3px; width: 24px; height: 24px; cursor: pointer; }
.graph-container { flex: 1; position: relative; overflow: hidden; }
.graph-svg { width: 100%; height: 100%; }

/* SVG styles (applied via JS style() or class-based) */
/* Note: CSS custom properties DO work in SVG when set on :root */
.graph-node { cursor: pointer; }
.graph-node-ghost { cursor: default; }
.node-selected { stroke: var(--accent-color); stroke-width: 2.5; }
.graph-edge { pointer-events: none; }
.graph-label { font-size: 11px; font-family: var(--ui-font); fill: var(--text-color); pointer-events: none; }

.graph-tooltip {
  position: absolute;
  background: var(--tooltip-bg, var(--menu-bg));
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px 12px;
  font: 12px var(--ui-font);
  pointer-events: none;
  z-index: 100;
  max-width: 200px;
  color: var(--text-color);
}

.graph-loading, .graph-empty, .graph-empty-vault {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  color: var(--muted-text);
  font: var(--ui-font);
}
```

No hardcoded hex. No hardcoded font stacks.

---

## Test Requirements (`tests/plugins/knowledge-graph/knowledge-graph.test.ts`)

Minimum 40 tests. `graph-builder.ts` and `graph-layout.ts` are pure and cover the majority.

### `buildGraphData` (pure, min 15)

1. Empty entries → `{ nodes: [], edges: [] }`.
2. Single note, no links → one node, no edges.
3. Two notes, A links B → one edge `{ source: A, target: B }`.
4. A links B and B links A → one edge with `isBidirectional: true`.
5. A links B twice (two `[[B]]` occurrences) → edge with `weight: 2`.
6. A links non-existent C → ghost node for C + edge to ghost.
7. Ghost node: `isGhost: true`, not interactive.
8. Connection count: A has links to B and C, plus B links back to A → A.connectionCount = 3.
9. Ambiguous link: `[[meeting]]` matches both `/research/meeting.md` and `/work/meeting.md` → `isAmbiguous: true` on edge.
10. Self-loop: A links `[[A]]` → self-loop edge included (or explicitly omitted — must be documented).
11. `mergeNodeUpdate` "created" event → new node added, no existing nodes removed.
12. `mergeNodeUpdate` "deleted" event → node removed, connected edges removed.
13. `mergeNodeUpdate` "modified" event → node's edges updated.
14. `pruneGhostNodes`: ghost node that is now resolved → ghost flag removed, node updated.
15. Multiple vault entries with same filename stem → `resolveLink` returns multiple (ambiguous).

### `graph-layout.ts` (pure, min 8)

16. `serializeLayout`: extracts x/y from nodes.
17. `applyPersistedLayout`: nodes with persisted positions get their x/y set.
18. `applyPersistedLayout`: new node (not in layout) gets random x/y (not NaN).
19. `isLayoutValid`: null layout → false.
20. `isLayoutValid`: valid layout for wrong vaultId → false.
21. `isLayoutValid`: valid layout for correct vaultId with positions → true.
22. Round-trip: serialize then apply → same positions.
23. `serializeLayout`: pinned nodes (fx/fy set) → positions include pinned coords.

### Integration / DOM tests (min 17)

24. Panel registers with id "knowledge-graph" and side "right".
25. Panel shows empty-vault state when no active vault.
26. Panel shows empty-connections state when vault has < 2 notes (FR-03.9).
27. Panel shows loading overlay while graph is building.
28. Graph container has `<svg>` element after render.
29. SVG has correct number of `<circle>` elements matching node count.
30. SVG has correct number of edge `<line>` or `<path>` elements.
31. Node click calls `__MARKABLE_TAB_MANAGER__.openFile`.
32. Ghost node click does NOT call `openFile`.
33. Node gets `.node-selected` class on click.
34. Previous selected node loses `.node-selected` on next node click.
35. Search input dims non-matching nodes.
36. Search cleared → all nodes at full opacity.
37. `onVaultChanged` triggers full graph rebuild.
38. `onIndexUpdated` triggers incremental update (new node appears without full rebuild).
39. Panel hidden → simulation paused.
40. Panel shown after being hidden → simulation resumes.

EC-36: vault switch while panel open → graph rebuilds for new vault (covered by test 37).
EC-37: panel closed before simulation converges → partial layout saved.
EC-39: 0 edges → graph renders (nodes spaced by repulsion), no crash, "No connections" notice.
EC-41: click node while graph is zoomed/panned → correct file opened, zoom not reset.
EC-42: excluded files not in graph (ghost edges from indexed notes) → tested via buildGraphData with ghost node case.

---

## Acceptance Criteria

1. `npm run build:plugins` succeeds with no TypeScript errors.
2. `npx vitest run tests/plugins/knowledge-graph/` passes all tests (min 40).
3. The Knowledge Graph panel appears in the right sidebar when the plugin is enabled.
4. With an active vault, nodes appear as circles and edges appear as lines.
5. Node size is visually proportional to connection count.
6. Clicking a node opens the correct note in the editor.
7. Hovering a node shows a tooltip with the note's title and connection count.
8. Dragging a node pins it at the dragged position.
9. Clicking a pinned node unpins it.
10. Scrolling/pinching zooms the graph.
11. Dragging the background pans the graph.
12. Double-clicking the background resets zoom/pan to fit all nodes.
13. Search input dims non-matching nodes (does not remove them).
14. Layout is persisted: reopening the panel shows nodes in the same positions.
15. Vault switch: graph rebuilds for the new vault (brief loading indicator shown).
16. Performance gate: 500-node vault graph reaches stable layout within 3 seconds on test hardware.
17. Ghost nodes (broken links) are visually distinct (dashed outline, dimmed fill).
18. Zero-note vault or < 2 notes: "No connections yet" empty state.

---

## Edge Cases Covered

- EC-33: broken wiki-link → ghost node shown.
- EC-34: ambiguous wiki-link (multiple same-stem files) → both nodes shown, edge colored orange with tooltip.
- EC-36: vault switch while panel open → graph rebuilt for new vault.
- EC-37: panel closed before simulation converges → partial layout saved.
- EC-38: self-referential wiki-link → self-loop edge rendered (or omitted, documented).
- EC-39: 0 edges → nodes rendered, "No connections" notice in panel header.
- EC-40: malformed front matter → note still appears as a node (index already handles this).
- EC-41: click node while graph is zoomed → correct file opened, zoom unchanged.
- EC-42: files excluded by cap → not in graph; wiki-links to excluded files rendered as ghost nodes.

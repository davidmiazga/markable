/**
 * knowledge-graph.plugin.ts
 *
 * IIFE plugin: Knowledge Graph sidebar panel for Markable 2.0.
 *
 * Renders a D3 force-directed SVG graph of notes and wiki-link connections
 * in the active vault. Features:
 *   - Node circles scaled by connection count (hub notes are larger).
 *   - Edge lines with directional arrows; bidirectional edges are thicker.
 *   - Ghost nodes (dashed outline) for broken wiki-link targets.
 *   - Click a node → open that note in the editor.
 *   - Hover a node → tooltip with title and connection count.
 *   - Drag a node → pin it at the dragged position (click again to unpin).
 *   - Mouse-wheel / two-finger zoom + pan; double-click background resets.
 *   - Search input dims non-matching nodes (does not remove them).
 *   - Layout persisted per vault in plugin settings.
 *   - Incremental updates on index changes without full graph rebuild.
 *
 * IIFE constraints:
 *   - D3 packages are bundled by Rollup at build time (they are NOT in the
 *     @codemirror/* external list, so Rollup includes them in the IIFE output).
 *   - No @codemirror/* imports (those are externals).
 *   - Vault state via window.__MARKABLE_VAULT_MANAGER__.
 *   - Tab navigation via window.__MARKABLE_TAB_MANAGER__.
 *   - CSS injected as <style id="knowledge-graph-css"> in onEnable, removed in onDisable.
 *
 * @module knowledge-graph.plugin
 */

// D3 sub-package imports — Rollup bundles these into the IIFE at build time.
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { drag } from "d3-drag";

// Type-only imports — erased by tsc, safe for IIFE context.
import type { MarkablePluginAPI } from "../markable-plugin-api";
import type { VaultEntry, VaultFileChangedEvent, VaultIndexEntry } from "../../lib/vault-types";
import type { SidebarPanelDescriptor } from "../markable-plugin-api";

// Pure utility modules — bundled inline by Rollup.
import {
  buildGraphData,
  mergeNodeUpdate,
  type GraphNode,
  type GraphEdge,
  type GraphData,
} from "./graph-builder";

import {
  serializeLayout,
  applyPersistedLayout,
  isLayoutValid,
  type PersistedLayout,
} from "./graph-layout";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Style tag id — used to guard against duplicate injection. */
const STYLE_ID = "knowledge-graph-css";

/** Simulation alpha decay for smooth initial layout. */
const ALPHA_DECAY_NORMAL = 0.02;

/** Faster alpha decay when node count is high (> 300). */
const ALPHA_DECAY_FAST = 0.05;

/** Max elapsed milliseconds before the simulation is force-stopped (FR-03.3). */
const SIM_MAX_MS = 5000;

/** Minimum node radius in pixels. */
const NODE_MIN_R = 5;

/** Maximum node radius in pixels. */
const NODE_MAX_R = 18;

/** Zoom threshold below which labels are hidden to reduce clutter. */
const LABEL_ZOOM_THRESHOLD = 0.6;

/** Debounce ms for layout save after drag end. */
const SAVE_DEBOUNCE_MS = 2000;

/** Search input debounce ms. */
const SEARCH_DEBOUNCE_MS = 150;

// ── Inline CSS ────────────────────────────────────────────────────────────────

/*
 * The full style rules also live in knowledge-graph.css for authoring.
 * This string is a verbatim copy injected at runtime so the IIFE is
 * self-contained (no runtime <link> dependency).
 */
const KNOWLEDGE_GRAPH_CSS = `
.graph-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-family: var(--ui-font); }
.graph-controls { display: flex; align-items: center; gap: 6px; padding: 6px 8px; flex-shrink: 0; border-bottom: 1px solid var(--border-color, rgba(128,128,128,.2)); }
.graph-search { flex: 1; background: var(--input-bg, var(--bg-secondary)); border: 1px solid var(--input-border, var(--border-color)); border-radius: 4px; padding: 4px 8px; font-family: var(--ui-font); font-size: 12px; color: var(--text-color); min-width: 0; }
.graph-search:focus { outline: none; border-color: var(--accent-color); }
.graph-zoom-controls { display: flex; gap: 2px; flex-shrink: 0; }
.graph-zoom-controls button { background: var(--button-bg, var(--bg-secondary)); border: 1px solid var(--border-color, rgba(128,128,128,.2)); border-radius: 3px; width: 24px; height: 24px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; color: var(--text-color); padding: 0; }
.graph-zoom-controls button:hover { background: var(--button-hover-bg, var(--bg-tertiary)); }
.graph-container { flex: 1; position: relative; overflow: hidden; }
.graph-svg { width: 100%; height: 100%; display: block; }
.graph-node { cursor: pointer; transition: opacity 0.15s ease; }
.graph-node-ghost { cursor: default; transition: opacity 0.15s ease; }
.node-selected { stroke: var(--accent-color) !important; stroke-width: 2.5px !important; stroke-dasharray: none !important; }
.graph-edge { pointer-events: none; transition: opacity 0.15s ease; }
.graph-label { font-size: 11px; font-family: var(--ui-font); fill: var(--text-color); pointer-events: none; transition: opacity 0.15s ease; user-select: none; }
.graph-tooltip { position: absolute; background: var(--tooltip-bg, var(--menu-bg, var(--bg-secondary))); border: 1px solid var(--border-color, rgba(128,128,128,.2)); border-radius: 6px; padding: 8px 12px; font-family: var(--ui-font); font-size: 12px; pointer-events: none; z-index: 100; max-width: 200px; color: var(--text-color); line-height: 1.5; box-shadow: 0 2px 8px var(--shadow-color, rgba(0,0,0,.12)); }
.graph-tooltip strong { display: block; font-weight: 600; margin-bottom: 2px; }
.graph-tooltip span, .graph-tooltip em { display: block; color: var(--muted-text, var(--text-muted)); font-size: 11px; }
.graph-loading, .graph-empty, .graph-empty-vault { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; color: var(--muted-text, var(--text-muted)); font-family: var(--ui-font); font-size: 13px; line-height: 1.6; gap: 8px; pointer-events: none; }
.graph-no-connections { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); background: var(--tooltip-bg, var(--menu-bg, var(--bg-secondary))); border: 1px solid var(--border-color, rgba(128,128,128,.2)); border-radius: 6px; padding: 6px 12px; font-family: var(--ui-font); font-size: 11px; color: var(--muted-text, var(--text-muted)); pointer-events: none; white-space: nowrap; z-index: 10; }
`;

// ── Module-level state ────────────────────────────────────────────────────────

/** Currently active API reference (set during onEnable, cleared on onDisable). */
let _api: MarkablePluginAPI | null = null;

/** The DOM container the panel is rendered into (set in render, cleared in destroy). */
let _panelContainer: HTMLElement | null = null;

/** D3 force simulation instance. */
let _simulation: ReturnType<typeof forceSimulation> | null = null;

/** Current graph data snapshot. */
let _graphData: GraphData = { nodes: [], edges: [] };

/**
 * Live node array mutated by D3 force simulation.
 *
 * `renderGraph` creates a shallow copy of `_graphData.nodes` and passes it
 * to `forceSimulation`. D3 mutates x/y/vx/vy on that copy directly. This
 * module-level reference points to that D3-mutated copy so that
 * `saveLayoutDebounced` can read the live positions. Reset to [] after
 * simulation teardown or plugin disable.
 */
let _simNodes: GraphNode[] = [];

/**
 * Vault manager from window global.
 * Typed as `any` because the window global is set at runtime and the IIFE
 * has no compile-time knowledge of the vault-manager module's export shape.
 * The consumed API surface is: getActiveVault(), getVaultIndex(),
 * onVaultChanged(), offVaultChanged(), onIndexUpdated(), offIndexUpdated().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _vaultManager: any = null;

/** Settings loaded during onEnable (stores persisted layouts). */
let _settings: Record<string, unknown> = {};

/** Timer handle for the simulation time cap (FR-03.3). */
let _simTimeCapHandle: ReturnType<typeof setTimeout> | null = null;

/** Whether the panel is currently shown (used to decide whether to animate). */
let _panelVisible = false;

/** Handlers stored so we can unsubscribe them in onDisable. */
let _handleVaultChanged: ((vault: VaultEntry | null) => void) | null = null;
let _handleIndexUpdated: ((event: VaultFileChangedEvent) => void) | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sanitize HTML special characters to prevent XSS in tooltip innerHTML.
 * Used for all user-provided strings in the tooltip.
 *
 * @param s - Raw string to escape.
 * @returns HTML-safe string.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Create a debounced version of a function.
 * Calls fn at most once per `wait` milliseconds regardless of how many times
 * it is invoked. The final invocation within the quiet period fires.
 *
 * @param fn   - Function to debounce.
 * @param wait - Quiet period in milliseconds.
 * @returns Debounced function.
 */
function debounce<T extends (...args: unknown[]) => void>(fn: T, wait: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function (this: unknown, ...args: unknown[]) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn.apply(this, args); }, wait);
  } as T;
}

/**
 * Calculate the radius for a graph node based on its connection count.
 * Uses sqrt scaling to avoid hub nodes dominating the visual space.
 * Range: [NODE_MIN_R, NODE_MAX_R].
 *
 * @param node - The GraphNode to calculate radius for.
 * @returns Radius in pixels.
 */
function nodeRadius(node: GraphNode): number {
  return Math.max(NODE_MIN_R, Math.min(NODE_MAX_R, NODE_MIN_R + Math.sqrt(node.connectionCount) * 2));
}

/**
 * Position a tooltip so it stays within the panel's viewport.
 * Default position is (clientX + 12, clientY - 8). If the tooltip would
 * overflow the panel's right or bottom edge, it is nudged inward.
 *
 * @param tooltip   - The tooltip element to position.
 * @param clientX   - Mouse x coordinate (from the event).
 * @param clientY   - Mouse y coordinate (from the event).
 * @param container - The panel container element used to measure bounds.
 */
function positionTooltip(
  tooltip: HTMLElement,
  clientX: number,
  clientY: number,
  container: HTMLElement
): void {
  const panelRect = container.getBoundingClientRect();
  const ttRect = tooltip.getBoundingClientRect();
  let x = clientX - panelRect.left + 12;
  let y = clientY - panelRect.top - 8;

  // Clamp to avoid right overflow.
  if (x + ttRect.width > panelRect.width) {
    x = panelRect.width - ttRect.width - 8;
  }
  // Clamp to avoid bottom overflow.
  if (y + ttRect.height > panelRect.height) {
    y = panelRect.height - ttRect.height - 8;
  }

  tooltip.style.left = `${Math.max(0, x)}px`;
  tooltip.style.top = `${Math.max(0, y)}px`;
}

/**
 * Simple fuzzy match: returns true if every character in query appears in
 * the target string in order (not necessarily consecutively).
 * Case-insensitive. Used for the search filter.
 *
 * @param target - The string to search within (lowercase).
 * @param query  - The query string (lowercase).
 * @returns True if query characters appear in target in order.
 */
function fuzzyMatch(target: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (target[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

// ── CSS injection ─────────────────────────────────────────────────────────────

/** Inject the plugin's CSS into the document (idempotent). */
function injectCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = KNOWLEDGE_GRAPH_CSS;
  document.head.appendChild(style);
}

/** Remove the plugin's CSS from the document. */
function removeCss(): void {
  document.getElementById(STYLE_ID)?.remove();
}

// ── DOM construction ──────────────────────────────────────────────────────────

/**
 * Build the panel DOM structure inside `container`.
 *
 * Returns references to the key elements needed by the rendering and
 * interaction code. This function only creates the skeleton — actual SVG
 * nodes are added in renderGraph().
 *
 * @param container - The sidebar panel container element.
 * @returns An object with references to key DOM elements.
 */
function buildPanelDom(container: HTMLElement): {
  searchInput: HTMLInputElement;
  zoomInBtn: HTMLButtonElement;
  zoomOutBtn: HTMLButtonElement;
  zoomFitBtn: HTMLButtonElement;
  graphContainer: HTMLElement;
  svgEl: SVGSVGElement;
  edgesG: SVGGElement;
  nodesG: SVGGElement;
  labelsG: SVGGElement;
  tooltip: HTMLElement;
  loadingEl: HTMLElement;
  emptyEl: HTMLElement;
  emptyVaultEl: HTMLElement;
} {
  // Justification: this function is longer than 30 lines because it builds the
  // complete panel DOM skeleton — an HTML template string that includes the SVG
  // with defs/markers plus all overlay divs — then queries and returns 13 typed
  // element references as a single named object. Splitting the template from the
  // querySelector block would require passing `container` to a second function
  // that returns the same struct, which reduces readability without reducing
  // complexity. The function is purely declarative (no branching logic).
  container.innerHTML = `
    <div class="graph-panel">
      <div class="graph-controls">
        <input class="graph-search" placeholder="Search notes\u2026" type="search" />
        <div class="graph-zoom-controls">
          <button class="graph-zoom-in">+</button>
          <button class="graph-zoom-out">\u2212</button>
          <button class="graph-zoom-fit">Fit</button>
        </div>
      </div>
      <div class="graph-container">
        <svg class="graph-svg" width="100%" height="100%">
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6"
              refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L6,3 z" fill="var(--graph-edge-color, rgba(128,128,128,.5))" />
            </marker>
            <marker id="arrow-bidir" markerWidth="6" markerHeight="6"
              refX="1" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L6,3 z" fill="var(--graph-edge-color, rgba(128,128,128,.5))" />
            </marker>
          </defs>
          <g class="graph-g">
            <g class="edges-g"></g>
            <g class="nodes-g"></g>
            <g class="labels-g"></g>
          </g>
        </svg>
        <div class="graph-tooltip" style="display:none"></div>
        <div class="graph-loading" style="display:none">Building graph\u2026</div>
        <div class="graph-empty" style="display:none">No connections yet. Add [[wiki-links]] to connect notes.</div>
        <div class="graph-empty-vault" style="display:none">Activate a vault to see the graph.</div>
        <div class="graph-no-connections" style="display:none">No connections found. Add [[wiki-links]] to connect notes.</div>
      </div>
    </div>
  `;

  return {
    searchInput:   container.querySelector<HTMLInputElement>(".graph-search")!,
    zoomInBtn:     container.querySelector<HTMLButtonElement>(".graph-zoom-in")!,
    zoomOutBtn:    container.querySelector<HTMLButtonElement>(".graph-zoom-out")!,
    zoomFitBtn:    container.querySelector<HTMLButtonElement>(".graph-zoom-fit")!,
    graphContainer: container.querySelector<HTMLElement>(".graph-container")!,
    svgEl:         container.querySelector<SVGSVGElement>(".graph-svg")!,
    edgesG:        container.querySelector<SVGGElement>(".edges-g")!,
    nodesG:        container.querySelector<SVGGElement>(".nodes-g")!,
    labelsG:       container.querySelector<SVGGElement>(".labels-g")!,
    tooltip:       container.querySelector<HTMLElement>(".graph-tooltip")!,
    loadingEl:     container.querySelector<HTMLElement>(".graph-loading")!,
    emptyEl:       container.querySelector<HTMLElement>(".graph-empty")!,
    emptyVaultEl:  container.querySelector<HTMLElement>(".graph-empty-vault")!,
  };
}

// ── State overlay helpers ─────────────────────────────────────────────────────

/** Show / hide the named overlay divs. Only one full overlay is visible at a time. */
function showOverlay(
  container: HTMLElement,
  which: "loading" | "empty" | "emptyVault" | "none"
): void {
  const loadingEl    = container.querySelector<HTMLElement>(".graph-loading");
  const emptyEl      = container.querySelector<HTMLElement>(".graph-empty");
  const emptyVault   = container.querySelector<HTMLElement>(".graph-empty-vault");
  const noConnEl     = container.querySelector<HTMLElement>(".graph-no-connections");
  const svgEl        = container.querySelector<SVGSVGElement>(".graph-svg");

  if (loadingEl)  loadingEl.style.display  = which === "loading"    ? "flex" : "none";
  if (emptyEl)    emptyEl.style.display    = which === "empty"      ? "flex" : "none";
  if (emptyVault) emptyVault.style.display = which === "emptyVault" ? "flex" : "none";
  // Clear the no-connections notice whenever an overlay changes.
  if (noConnEl)   noConnEl.style.display   = "none";
  if (svgEl)      svgEl.style.visibility   = which === "none" ? "visible" : "hidden";
}

/**
 * Show or hide the "no connections" notice banner (EC-39).
 *
 * This is a non-blocking notice shown over the SVG (not replacing it) when
 * the graph has 2+ nodes but 0 edges. Nodes are still rendered and interactive.
 */
function setNoConnectionsNotice(container: HTMLElement, visible: boolean): void {
  const el = container.querySelector<HTMLElement>(".graph-no-connections");
  if (el) el.style.display = visible ? "flex" : "none";
}

// ── D3 rendering ──────────────────────────────────────────────────────────────

/**
 * Render the full D3 force graph from scratch into the SVG element.
 *
 * This function is the main rendering entry point. It:
 *   1. Reads panel dimensions.
 *   2. Sets up zoom/pan behaviour.
 *   3. Binds node and edge data to SVG elements.
 *   4. Attaches drag, click, and hover handlers.
 *   5. Starts the force simulation.
 *
 * Justification: this function is longer than 30 lines because it coordinates
 * the entire D3 lifecycle — zoom setup, data binding for three element types
 * (edges, nodes, labels), three interaction handlers per node (drag, click,
 * hover), and the simulation tick/end hooks. Splitting into sub-functions would
 * require passing the same 8+ SVG element references to each helper, which is
 * no cleaner. Key sub-operations are marked with inline section comments.
 *
 * @param container  - The panel container element (the sidebar panel root).
 * @param graphData  - The data to render.
 * @param savedLayout - Optional persisted layout to restore positions from.
 */
function renderGraph(
  container: HTMLElement,
  graphData: GraphData,
  savedLayout: PersistedLayout | null
): void {
  const svgEl   = container.querySelector<SVGSVGElement>(".graph-svg");
  const graphG  = container.querySelector<SVGGElement>(".graph-g");
  const edgesG  = container.querySelector<SVGGElement>(".edges-g");
  const nodesG  = container.querySelector<SVGGElement>(".nodes-g");
  const labelsG = container.querySelector<SVGGElement>(".labels-g");
  const tooltip = container.querySelector<HTMLElement>(".graph-tooltip");

  if (!svgEl || !graphG || !edgesG || !nodesG || !labelsG || !tooltip) return;

  // Stop any existing simulation before starting a new one.
  if (_simulation) {
    _simulation.stop();
    _simulation = null;
  }
  if (_simTimeCapHandle) {
    clearTimeout(_simTimeCapHandle);
    _simTimeCapHandle = null;
  }

  // ── Section: clear existing SVG content ──────────────────────────────────
  select(edgesG).selectAll("*").remove();
  select(nodesG).selectAll("*").remove();
  select(labelsG).selectAll("*").remove();

  const nodes: GraphNode[] = graphData.nodes.map((n) => ({ ...n }));
  const edges: GraphEdge[] = graphData.edges.map((e) => ({ ...e }));

  // Store the live D3-mutated copy so saveLayoutDebounced reads real positions.
  _simNodes = nodes;

  // Apply persisted positions so the graph looks the same on reopen.
  // Use the active vault's id (not savedLayout.vaultId) to prevent cross-vault
  // layout application if a stale layout were returned (EC-36 guard).
  const activeVaultId = _vaultManager?.getActiveVault?.()?.id ?? "";
  if (savedLayout && isLayoutValid(savedLayout, activeVaultId)) {
    applyPersistedLayout(nodes, savedLayout);
  } else {
    // Random starting positions for fresh layout.
    nodes.forEach((n) => {
      n.x = Math.random() * 400 - 200;
      n.y = Math.random() * 400 - 200;
    });
  }

  // ── Section: panel dimensions ─────────────────────────────────────────────
  const width  = svgEl.clientWidth  || 300;
  const height = svgEl.clientHeight || 400;

  // ── Section: zoom / pan setup ─────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svgSel = select(svgEl) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphGSel = select(graphG) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labelsSel = select(labelsG) as any;

  // Casting zoomHandler to `any` here because the generic type parameters of
  // zoom<SVGSVGElement, unknown> conflict with d3-selection's .call() overload
  // resolution when both packages are in the same module. At runtime this is
  // always a valid D3 ZoomBehavior and the cast is safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zoomHandler: any = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on("zoom", (event: { transform: { k: number; x: number; y: number } }) => {
      graphGSel.attr("transform", `translate(${event.transform.x},${event.transform.y}) scale(${event.transform.k})`);
      // Hide labels when zoomed out too far to avoid clutter.
      labelsSel.style("display", event.transform.k < LABEL_ZOOM_THRESHOLD ? "none" : "");
    });

  svgSel.call(zoomHandler);

  // Double-click background resets zoom to identity.
  svgSel.on("dblclick.zoom", () => {
    svgSel.transition().duration(400).call(zoomHandler.transform, zoomIdentity);
  });

  // ── Section: bind edge data ───────────────────────────────────────────────
  const edgeSel = select(edgesG)
    .selectAll<SVGLineElement, GraphEdge>("line")
    .data(edges)
    .join("line")
    .attr("class", "graph-edge")
    .attr("stroke", (d) => d.isAmbiguous
      ? "var(--graph-ambiguous-edge, orange)"
      : "var(--graph-edge-color, rgba(128,128,128,.5))")
    .attr("stroke-width", (d) => (d.isBidirectional ? 2 : 1) + Math.log(Math.max(1, d.weight)))
    .attr("stroke-dasharray", (d) => {
      // Ghost edges (connecting to ghost nodes) get a dashed stroke.
      const targetNode = nodes.find((n) => n.id === d.target);
      return targetNode?.isGhost ? "4,2" : "none";
    })
    .attr("marker-end", (d) => d.isBidirectional ? "url(#arrow-bidir)" : "url(#arrow)");

  // ── Section: bind node data ───────────────────────────────────────────────
  const nodeSel = select(nodesG)
    .selectAll<SVGCircleElement, GraphNode>("circle")
    .data(nodes)
    .join("circle")
    .attr("class", (d) => d.isGhost ? "graph-node graph-node-ghost" : "graph-node")
    .attr("r", nodeRadius)
    .attr("fill", (d) => d.isGhost ? "transparent" : "var(--accent-color)")
    .attr("stroke", (d) => d.isGhost ? "var(--muted-text, rgba(128,128,128,.5))" : "none")
    .attr("stroke-dasharray", (d) => d.isGhost ? "3,2" : "none")
    .attr("stroke-width", (d) => d.isGhost ? 1.5 : 0);

  // ── Section: bind label data ──────────────────────────────────────────────
  const labelSel = select(labelsG)
    .selectAll<SVGTextElement, GraphNode>("text")
    .data(nodes)
    .join("text")
    .attr("class", "graph-label")
    .text((d) => d.label);

  // ── Section: node click handler ───────────────────────────────────────────
  nodeSel.on("click", function (event: MouseEvent, d: GraphNode) {
    event.stopPropagation(); // prevent background reset handler
    if (d.isGhost) return;   // ghost nodes are not interactive (EC-33)

    // Open the file in the editor.
    const tabManager = (window as unknown as Record<string, { openFileInTab: (p: string) => Promise<boolean> }>).__MARKABLE_TAB_MANAGER__;
    if (tabManager) void tabManager.openFileInTab(d.path);

    // Toggle pinned state: clicking a pinned node unpins it.
    if (d.fx !== null && d.fx !== undefined) {
      d.fx = null;
      d.fy = null;
    }

    // Update the selection ring.
    select(nodesG).selectAll<SVGCircleElement, GraphNode>(".node-selected")
      .classed("node-selected", false);
    select(this as SVGCircleElement).classed("node-selected", true);
  });

  // ── Section: node hover tooltip ───────────────────────────────────────────
  nodeSel.on("mouseenter", function (event: MouseEvent, d: GraphNode) {
    tooltip.innerHTML = [
      `<strong>${escapeHtml(d.label)}</strong>`,
      `<span>${d.connectionCount} connection${d.connectionCount !== 1 ? "s" : ""}</span>`,
      d.isGhost ? "<em>Broken link</em>" : "",
    ].join("");
    positionTooltip(tooltip, event.clientX, event.clientY, container);
    tooltip.style.display = "block";
  });

  nodeSel.on("mouseleave", () => {
    tooltip.style.display = "none";
  });

  // ── Section: drag handler ─────────────────────────────────────────────────
  // Casting dragHandler to `any` for the same reason as zoomHandler: the D3
  // drag generic types conflict with d3-selection's .call() overload resolution.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dragHandler: any = drag<SVGCircleElement, GraphNode>()
    .on("start", (event: { active: boolean }, d: GraphNode) => {
      if (!event.active && _simulation) _simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event: { x: number; y: number }, d: GraphNode) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event: { active: boolean }) => {
      if (!event.active && _simulation) _simulation.alphaTarget(0);
      // Node stays pinned after drag. User clicks to unpin.
      saveLayoutDebounced();
    });

  nodeSel.call(dragHandler);

  // ── Section: force simulation ─────────────────────────────────────────────
  // Casting to `any` here because D3's SimulationLinkDatum generic requires
  // edges to have { source: NodeType | string; target: NodeType | string }
  // which GraphEdge satisfies at runtime, but the TypeScript overload resolution
  // fails because GraphEdge.source/target are plain strings while D3 expects
  // SimulationNodeDatum references. This cast is safe — D3's forceLink resolves
  // string references against the simulation nodes via the .id() accessor.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const simEdges: any[] = edges;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const simNodes: any[] = nodes;
  _simulation = forceSimulation(simNodes)
    .force("charge", forceManyBody().strength(-120))
    .force("link",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (forceLink(simEdges) as any)
        .id((d: unknown) => (d as GraphNode).id)
        .distance(80)
        .strength(0.5)
    )
    .force("center", forceCenter(width / 2, height / 2))
    .force("collide", forceCollide().radius((d: unknown) => nodeRadius(d as GraphNode) + 4));

  // Performance guard: faster convergence for large graphs.
  if (nodes.length > 300) {
    (_simulation as ReturnType<typeof forceSimulation>).alphaDecay(ALPHA_DECAY_FAST);
  } else {
    (_simulation as ReturnType<typeof forceSimulation>).alphaDecay(ALPHA_DECAY_NORMAL);
  }

  // Tick: update SVG element positions from simulation node coordinates.
  (_simulation as ReturnType<typeof forceSimulation>).on("tick", () => {
    edgeSel
      .attr("x1", (d) => ((d.source as unknown as GraphNode).x ?? 0).toString())
      .attr("y1", (d) => ((d.source as unknown as GraphNode).y ?? 0).toString())
      .attr("x2", (d) => ((d.target as unknown as GraphNode).x ?? 0).toString())
      .attr("y2", (d) => ((d.target as unknown as GraphNode).y ?? 0).toString());

    nodeSel
      .attr("cx", (d) => (d.x ?? 0).toString())
      .attr("cy", (d) => (d.y ?? 0).toString());

    labelSel
      .attr("x", (d) => (d.x ?? 0).toString())
      .attr("y", (d) => ((d.y ?? 0) + nodeRadius(d) + 12).toString())
      .attr("text-anchor", "middle");
  });

  // Simulation end: layout has stabilised → save it.
  (_simulation as ReturnType<typeof forceSimulation>).on("end", () => {
    saveLayoutDebounced();
  });

  // Time cap: stop the simulation after SIM_MAX_MS even if not converged (FR-03.3).
  // The start time is captured locally (no module-level tracking needed).
  _simTimeCapHandle = setTimeout(() => {
    if (_simulation) {
      _simulation.stop();
      saveLayoutDebounced();
    }
  }, SIM_MAX_MS);

  // ── Section: search filter ────────────────────────────────────────────────
  const searchInput = container.querySelector<HTMLInputElement>(".graph-search");
  if (searchInput) {
    const applySearch = debounce(() => {
      const query = searchInput.value.trim().toLowerCase();
      nodeSel.style("opacity", (d: GraphNode) => {
        if (!query) return "1";
        const matches = fuzzyMatch(d.label.toLowerCase(), query);
        (d as GraphNode & { dimmed?: boolean }).dimmed = !matches;
        return matches ? "1" : "0.2";
      });
      labelSel.style("opacity", (d: GraphNode) => {
        if (!query) return "1";
        return fuzzyMatch(d.label.toLowerCase(), query) ? "1" : "0";
      });
      edgeSel.style("opacity", (d: GraphEdge) => {
        if (!query) return "0.6";
        const src = (d.source as unknown as GraphNode & { dimmed?: boolean });
        const tgt = (d.target as unknown as GraphNode & { dimmed?: boolean });
        return (src.dimmed || tgt.dimmed) ? "0.1" : "0.6";
      });
    }, SEARCH_DEBOUNCE_MS) as EventListener;

    searchInput.addEventListener("input", applySearch);
  }

  // ── Section: zoom button handlers ─────────────────────────────────────────
  attachZoomButtons(container, svgSel, zoomHandler);
}

/**
 * Attach click handlers to the zoom +/−/Fit buttons.
 *
 * @param container   - Panel container.
 * @param svgSel      - D3 selection wrapping the SVG element (typed as any to
 *                      avoid d3-selection generic conflicts with zoom/transition).
 * @param zoomHandler - The zoom behaviour instance (typed as any for same reason).
 */
function attachZoomButtons(
  container: HTMLElement,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svgSel: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zoomHandler: any
): void {
  const zoomIn  = container.querySelector<HTMLButtonElement>(".graph-zoom-in");
  const zoomOut = container.querySelector<HTMLButtonElement>(".graph-zoom-out");
  const zoomFit = container.querySelector<HTMLButtonElement>(".graph-zoom-fit");

  zoomIn?.addEventListener("click", () => {
    svgSel.transition().duration(200).call(zoomHandler.scaleBy, 1.5);
  });

  zoomOut?.addEventListener("click", () => {
    svgSel.transition().duration(200).call(zoomHandler.scaleBy, 1 / 1.5);
  });

  zoomFit?.addEventListener("click", () => {
    svgSel.transition().duration(400).call(zoomHandler.transform, zoomIdentity);
  });
}

// ── Layout persistence ────────────────────────────────────────────────────────

/**
 * Save the current graph layout to plugin settings (debounced).
 * The debounce prevents excessive writes during simulation ticks.
 */
const saveLayoutDebounced = debounce(() => {
  if (!_api || !_simulation) return;
  const vault = _vaultManager?.getActiveVault?.();
  if (!vault) return;

  // Use _simNodes (D3-mutated copy) so we read real simulation positions,
  // not the static _graphData.nodes which D3 never writes back to.
  const layout = serializeLayout(vault.id, _simNodes);

  const existingLayouts = (_settings.layouts as Record<string, unknown>) ?? {};
  _api.saveSettings({
    ..._settings,
    layouts: { ...existingLayouts, [vault.id]: layout },
  }).catch((err: unknown) => {
    console.warn("[knowledge-graph] saveSettings failed:", err);
  });
}, SAVE_DEBOUNCE_MS);

/**
 * Retrieve the persisted layout for a given vault from settings.
 *
 * @param vaultId - The vault id to look up.
 * @returns The PersistedLayout or null if none exists.
 */
function getPersistedLayout(vaultId: string): PersistedLayout | null {
  const layouts = _settings.layouts as Record<string, unknown> | undefined;
  if (!layouts) return null;
  const raw = layouts[vaultId];
  if (!raw || typeof raw !== "object") return null;
  return raw as PersistedLayout;
}

// ── Graph build and display ───────────────────────────────────────────────────

/**
 * Trigger a full graph rebuild from the current vault index.
 *
 * Shows a loading overlay, builds graph data, then calls renderGraph().
 * Called on vault switch and manual refresh.
 */
function rebuildGraph(): void {
  // Justification: this function is longer than 30 lines because it handles
  // three guard cases (no panel, no vault, empty index), a loading overlay,
  // graph data construction, a post-build overlay decision (EC-39 cases), and
  // the renderGraph call with layout retrieval. Each guard is a single
  // early-return path; collapsing them into a validator helper would add
  // indirection without reducing the total line count.
  if (!_panelContainer) return;

  const vault = _vaultManager?.getActiveVault?.();
  if (!vault) {
    showOverlay(_panelContainer, "emptyVault");
    return;
  }

  const vaultIndex = _vaultManager?.getVaultIndex?.();
  if (!vaultIndex || vaultIndex.entries.length === 0) {
    showOverlay(_panelContainer, "empty");
    return;
  }

  // Show loading while graph data is prepared.
  showOverlay(_panelContainer, "loading");

  // Build graph data synchronously (pure function — no async needed).
  _graphData = buildGraphData(vaultIndex.entries);

  // Determine which overlay (if any) to show after building.
  if (_graphData.nodes.length < 2) {
    // Fewer than 2 notes: show the empty state (no graph to render).
    showOverlay(_panelContainer, "empty");
    return;
  }

  // 2+ nodes: always render the graph (EC-39 — nodes show even with 0 edges).
  showOverlay(_panelContainer, "none");
  const layout = getPersistedLayout(vault.id);
  renderGraph(_panelContainer, _graphData, layout);

  // EC-39: show the no-connections notice as a non-blocking banner when there
  // are nodes but no edges. The graph still renders (nodes spaced by repulsion).
  setNoConnectionsNotice(_panelContainer, _graphData.edges.length === 0);
}

// ── Plugin panel lifecycle ────────────────────────────────────────────────────

/**
 * Initialise the graph panel inside `container`.
 *
 * This is called by the SidebarPanelDescriptor.render callback when the sidebar
 * first shows the panel. It builds the DOM skeleton and triggers the initial
 * graph render.
 *
 * @param container - The sidebar panel container element.
 */
function initGraph(container: HTMLElement): void {
  _panelContainer = container;
  _panelVisible = true;
  buildPanelDom(container);
  rebuildGraph();
}

/**
 * Tear down the graph panel from `container`.
 *
 * Called by SidebarPanelDescriptor.destroy when the sidebar removes the panel.
 * Stops the simulation and saves a partial layout.
 *
 * @param container - The sidebar panel container element.
 */
function teardownGraph(container: HTMLElement): void {
  _panelVisible = false;
  if (_simulation) {
    _simulation.stop();
  }
  // Save partial layout (EC-37: panel closed before simulation converges).
  saveLayoutDebounced();
  container.innerHTML = "";
  _panelContainer = null;
}

// ── Incremental update ────────────────────────────────────────────────────────

/**
 * Handle an incremental index update event by updating the graph data and
 * DOM without a full rebuild.
 *
 * For simple added/removed nodes this avoids resetting the positions of all
 * existing nodes. For more complex changes (e.g. bulk modifications) the
 * fallback is a full rebuild.
 *
 * @param event - The VaultFileChangedEvent from the file watcher.
 */
function handleIndexUpdated(event: VaultFileChangedEvent): void {
  if (!_panelContainer || !_panelVisible) return;

  // Retrieve the updated entry from the vault index (if available).
  const vaultIndex = _vaultManager?.getVaultIndex?.();
  const updatedEntry = vaultIndex?.entries.find((e: VaultIndexEntry) => e.path === event.path);

  // Merge the event into the current graph data.
  const newGraphData = mergeNodeUpdate(_graphData, event, updatedEntry);
  _graphData = newGraphData;

  // Debounce the re-render to coalesce rapid events.
  debouncedIncrementalRender();
}

const debouncedIncrementalRender = debounce(() => {
  if (!_panelContainer) return;
  const vault = _vaultManager?.getActiveVault?.();
  if (!vault) return;
  const layout = getPersistedLayout(vault.id);
  showOverlay(_panelContainer, "none");
  renderGraph(_panelContainer, _graphData, layout);
}, 300);

// ── Graph settings placeholder ────────────────────────────────────────────────

/**
 * Open the graph settings panel.
 * Deferred to a future phase — logs intent for now.
 */
function openGraphSettings(): void {
  console.log("[knowledge-graph] Graph settings not yet implemented.");
}

// ── Plugin export ─────────────────────────────────────────────────────────────

const knowledgeGraphPlugin = {
  id: "knowledge-graph",
  name: "Knowledge Graph",
  description: "Force-directed graph of notes and wiki-link connections in the active vault.",
  version: "1.0.0",

  /**
   * Called when the plugin is enabled. Sets up the sidebar panel, subscribes
   * to vault manager events, and loads persisted settings.
   *
   * @param api - The MarkablePluginAPI provided by the plugin host.
   */
  async onEnable(api: MarkablePluginAPI): Promise<void> {
    _api = api;
    injectCss();

    // Load persisted settings (contains layouts per vault).
    const saved = await api.loadSettings();
    _settings = saved ?? {};

    // Resolve the vault manager from the window global.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__ ?? null;

    // Define event handlers so we can unsubscribe them in onDisable.
    _handleVaultChanged = (_vault: VaultEntry | null) => {
      // Full graph rebuild whenever the active vault changes.
      rebuildGraph();
    };

    _handleIndexUpdated = (event: VaultFileChangedEvent) => {
      handleIndexUpdated(event);
    };

    if (_vaultManager) {
      _vaultManager.onVaultChanged(_handleVaultChanged);
      _vaultManager.onIndexUpdated(_handleIndexUpdated);
    }

    const descriptor: SidebarPanelDescriptor = {
      id: "knowledge-graph",
      title: "Graph",
      side: "right",
      defaultWidth: 300,
      render(container: HTMLElement) {
        initGraph(container);
      },
      destroy(container: HTMLElement) {
        teardownGraph(container);
      },
      headerActions: [
        {
          icon: "\u27F3",
          title: "Refresh",
          onClick: () => rebuildGraph(),
        },
        {
          icon: "\u2699",
          title: "Graph settings",
          onClick: () => openGraphSettings(),
        },
      ],
    };

    api.registerSidebarPanel(descriptor);
  },

  /**
   * Called when the plugin is disabled. Stops the simulation, saves the layout,
   * and cleans up event subscriptions and DOM.
   *
   * @param api - The MarkablePluginAPI provided by the plugin host.
   */
  async onDisable(api: MarkablePluginAPI): Promise<void> {
    // Stop simulation before destroying.
    if (_simulation) {
      _simulation.stop();
      _simulation = null;
    }
    if (_simTimeCapHandle) {
      clearTimeout(_simTimeCapHandle);
      _simTimeCapHandle = null;
    }

    // Save layout synchronously (best-effort) before removing the panel.
    if (_api && _vaultManager) {
      const vault = _vaultManager.getActiveVault?.();
      if (vault && _simNodes.length > 0) {
        const layout = serializeLayout(vault.id, _simNodes);
        const existingLayouts = (_settings.layouts as Record<string, unknown>) ?? {};
        await api.saveSettings({
          ..._settings,
          layouts: { ...existingLayouts, [vault.id]: layout },
        }).catch((err: unknown) => {
          console.warn("[knowledge-graph] onDisable saveSettings failed:", err);
        });
      }
    }

    // Unsubscribe from vault manager events.
    if (_vaultManager && _handleVaultChanged) {
      _vaultManager.offVaultChanged(_handleVaultChanged);
    }
    if (_vaultManager && _handleIndexUpdated) {
      _vaultManager.offIndexUpdated(_handleIndexUpdated);
    }

    api.unregisterSidebarPanel("knowledge-graph");
    removeCss();

    // Reset module state.
    _api = null;
    _panelContainer = null;
    _simulation = null;
    _graphData = { nodes: [], edges: [] };
    _simNodes = [];
    _vaultManager = null;
    _settings = {};
    _handleVaultChanged = null;
    _handleIndexUpdated = null;
    _panelVisible = false;
  },

  /**
   * Testing accessor for test isolation. Returns references to the current
   * module-level state so tests can inspect internal state without
   * going through the DOM.
   */
  get _testing() {
    return {
      getContainer:   () => _panelContainer,
      getSimulation:  () => _simulation,
      getGraphData:   () => _graphData,
      getSettings:    () => _settings,
      triggerRebuild: () => rebuildGraph(),
    };
  },
};

export default knowledgeGraphPlugin;

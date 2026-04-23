/**
 * Diagrams Plugin — IIFE entry point (FC2 #9).
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/diagrams.js
 *
 * Renders ```mermaid fenced code blocks as SVG diagrams using Mermaid.js.
 * Implements the Typora-style live preview contract: raw Mermaid source is
 * hidden when the cursor is away from the block and shown when the cursor
 * enters it. Identical cursor-on-reveal contract to the Math plugin (FC2 #8).
 *
 * Architecture: docs/specs/diagrams/00_index.md
 *
 * IIFE self-containment rules:
 *   - Mermaid is bundled into the IIFE (not external). Strategy A (FR-09).
 *   - No app-internal module imports at runtime.
 *   - CM6 accessed via window globals only (__CM_VIEW__, __CM_STATE__, __CM_LANGUAGE__).
 *   - CSS injected via <style> tags in onEnable, removed in onDisable.
 *   - Plugin exports `export default` a UnifiedPlugin object.
 */

import mermaid from "mermaid";

// Type-only imports — erased at compile time, safe in IIFE context.
import type { DecorationSet, WidgetType as WidgetTypeClass } from "@codemirror/view";
import type { Transaction, EditorState } from "@codemirror/state";
import type { MarkablePluginAPI } from "../markable-plugin-api";
import { buildSelectRow, buildNumberRow, buildToggleRow } from "../../settings/settings-fields";

// ── CM6 globals access ────────────────────────────────────────────────────────
//
// All @codemirror/* runtime values come from window globals set by cm-globals.ts.
// The destructure runs at IIFE evaluation time. By contract, cm-globals.ts has
// already executed before any plugin IIFE is evaluated (plugin loader ordering).

/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  WidgetType,
  Decoration,
  EditorView: _EditorView,
} = (window as any).__CM_VIEW__ as typeof import("@codemirror/view");

const {
  StateField,
  StateEffect,
  RangeSetBuilder,
} = (window as any).__CM_STATE__ as typeof import("@codemirror/state");

const {
  syntaxTree,
} = (window as any).__CM_LANGUAGE__ as typeof import("@codemirror/language");
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Plugin settings type ──────────────────────────────────────────────────────

interface DiagramsSettings {
  /** Mermaid theme override. "auto" uses dark/light detection from the active app theme. */
  mermaidTheme: "auto" | "dark" | "default" | "neutral" | "forest";
  /** Maximum SVG container width in pixels. Wide diagrams scroll horizontally. */
  maxRenderWidth: number;
  /** When true, error placeholder shows the raw Mermaid source in a <pre> block. */
  showErrorSource: boolean;
}

const DEFAULT_SETTINGS: DiagramsSettings = {
  mermaidTheme: "auto",
  maxRenderWidth: 900,
  showErrorSource: true,
};

// ── Settings helpers ──────────────────────────────────────────────────────────

/**
 * Merge raw settings returned by `api.loadSettings()` with the defaults.
 *
 * This is a pure function — it has no side effects and does not read module
 * state. Extracting it makes the first-run null path unit-testable (EC-23, CRITICAL-01).
 *
 * Merge rules:
 *   - If `raw` is null (EC-23: first run, no saved file), all defaults are returned.
 *   - Unknown keys in `raw` are silently ignored (forward compatibility).
 *   - Keys whose runtime types do not match the expected type are also ignored —
 *     only well-typed values overwrite the defaults.
 *
 * @param raw - The value returned by `api.loadSettings()`. May be null or any shape.
 * @returns A fully-populated DiagramsSettings with all defaults filled in.
 */
export function loadAndMergeSettings(raw: unknown): DiagramsSettings {
  const merged: DiagramsSettings = { ...DEFAULT_SETTINGS };

  // null means no settings file exists yet (first run / EC-23).
  // Return defaults unchanged.
  if (raw === null || typeof raw !== "object") {
    return merged;
  }

  const r = raw as Record<string, unknown>;

  // mermaidTheme: must be one of the allowed string literals.
  if (
    typeof r.mermaidTheme === "string" &&
    ["auto", "dark", "default", "neutral", "forest"].includes(r.mermaidTheme)
  ) {
    merged.mermaidTheme = r.mermaidTheme as DiagramsSettings["mermaidTheme"];
  }

  // maxRenderWidth: must be a number in the valid range [200, 4000] (MEDIUM-02).
  if (typeof r.maxRenderWidth === "number" && r.maxRenderWidth >= 200 && r.maxRenderWidth <= 4000) {
    merged.maxRenderWidth = r.maxRenderWidth;
  }

  // showErrorSource: must be a boolean.
  if (typeof r.showErrorSource === "boolean") {
    merged.showErrorSource = r.showErrorSource;
  }

  return merged;
}

// ── Module-level state ────────────────────────────────────────────────────────

/** Currently loaded settings. Populated in onEnable. */
let _settings: DiagramsSettings = { ...DEFAULT_SETTINGS };

/** The active StateField instance. Null between enable cycles. */
let _diagramsField: ReturnType<typeof StateField.define> | null = null;

/** Theme-change MutationObserver. Null when plugin is disabled. */
let _themeObserver: MutationObserver | null = null;

/**
 * Tracks the last Mermaid theme passed to mermaid.initialize(). Empty string = never initialized.
 * Module-private — mutated only by reinitIfNeeded() and onDisable().
 */
let _initializedTheme = "";

/**
 * Reset the initialized-theme tracker to the given value.
 *
 * Exported exclusively for test use so tests can simulate a fresh enable cycle
 * (EC-12 MEDIUM-01) or inject a known theme string for eq() comparison tests
 * (EC-10 MEDIUM-03) without bypassing the ES module namespace getter restriction.
 *
 * Production code must never call this function.
 *
 * @param value - The theme string to set. Pass "" to simulate onDisable() reset.
 */
export function _setInitializedThemeForTest(value: string): void {
  _initializedTheme = value;
}

/** Module-level counter for generating unique Mermaid render IDs. Incremented per widget instance. */
let _renderCounter = 0;

/** Reference to the current MarkablePluginAPI. Set in onEnable, cleared in onDisable. */
let _currentApi: MarkablePluginAPI | null = null;

// ── CSS injection helpers ─────────────────────────────────────────────────────

const PLUGIN_CSS_ELEMENT_ID = "__markable_diagrams_plugin_css__";

/**
 * Inject plugin CSS into document <head>.
 * Idempotent — guarded by element id (EC-12).
 *
 * CSS design notes:
 *   - .cm-mermaid-block: display block, horizontally scrollable, horizontally centered.
 *   - No background-color on .cm-mermaid-block — Mermaid's SVG sets its own background (OQ-05).
 *   - .cm-mermaid-loading: shows a subtle loading indicator while async render completes (NFR-01).
 *   - .cm-mermaid-error: error placeholder, theme-compatible via CSS variable (FR-05.2).
 */
export function injectPluginCSS(): void {
  if (document.getElementById(PLUGIN_CSS_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = PLUGIN_CSS_ELEMENT_ID;
  style.textContent = `
/* ── Diagrams Plugin CSS ──────────────────────────────────────────────────── */

/* SVG container — block-level, horizontally centered, scrollable for wide diagrams */
.cm-mermaid-block {
  display: block;
  position: relative; /* needed for the edit button overlay */
  max-width: var(--mermaid-max-width, 900px);
  margin: 0.75em auto;
  overflow-x: auto;
  /* No background-color: Mermaid's SVG sets its own via its theme (OQ-05) */
}

/* Edit-source button — shown on hover, top-right corner */
.cm-mermaid-edit-btn {
  position: absolute;
  top: 6px;
  right: 8px;
  opacity: 0;
  transition: opacity 0.15s ease;
  background: var(--accent-color, #0070f3);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.72em;
  font-family: var(--ui-font, system-ui, sans-serif);
  cursor: pointer;
  line-height: 1.6;
  pointer-events: auto;
  user-select: none;
}

.cm-mermaid-block:hover .cm-mermaid-edit-btn {
  opacity: 1;
}

/* SVG element itself — constrain width, allow natural height */
.cm-mermaid-block svg {
  display: block;
  max-width: 100%;
  height: auto;
}

/* Loading placeholder — shown while async render completes (NFR-01) */
.cm-mermaid-loading::before {
  content: "Rendering diagram…";
  display: block;
  padding: 0.5em 1em;
  color: var(--mermaid-loading-color, rgba(128, 128, 128, 0.6));
  font-style: italic;
  font-size: 0.85em;
}

/* Error placeholder — theme-compatible via CSS variable (FR-05.2) */
.cm-mermaid-error {
  display: block;
  padding: 0.5em 1em;
  border: 1px dashed var(--mermaid-error-color, #c0392b);
  border-radius: 4px;
  color: var(--mermaid-error-color, #c0392b);
  cursor: help; /* Signals actionable info on hover (FR-05.3) */
  margin: 0.5em 0;
}

.cm-mermaid-error-label {
  font-weight: 600;
  font-size: 0.9em;
}

.cm-mermaid-error pre {
  margin: 0.4em 0 0;
  font-size: 0.8em;
  white-space: pre-wrap;
  word-break: break-word;
  opacity: 0.8;
}
`;
  document.head.appendChild(style);
}

/**
 * Remove the injected plugin CSS style tag.
 * Called from onDisable. Safe when tag does not exist.
 */
export function removePluginCSS(): void {
  document.getElementById(PLUGIN_CSS_ELEMENT_ID)?.remove();
}

// ── Lezer FencedCode detection ────────────────────────────────────────────────

/**
 * A single mermaid fenced code block found in the document.
 * `from` is the start of the opening fence line.
 * `to` is the character position after the last character of the closing fence line.
 * `source` is the raw Mermaid content between the fences (not including fence lines).
 */
export interface DiagramBlock {
  from: number;
  to: number;
  source: string;
}

/**
 * Walk the Lezer syntax tree and return all mermaid FencedCode blocks.
 *
 * Detection strategy (AD-05):
 *   - Iterates FencedCode nodes from the Lezer tree.
 *   - For each FencedCode, walks its children to find a CodeInfo child.
 *   - Reads CodeInfo text; if it equals "mermaid" (case-insensitive), records the block.
 *   - The `from` offset is the FencedCode node's `from` (start of opening fence).
 *   - The `to` offset is the FencedCode node's `to` (end of closing fence).
 *   - The `source` is read from the CodeText child node (the content between fences).
 *     If no CodeText child exists (empty block, EC-01/EC-02), source is "".
 *   - An unclosed fence produces no FencedCode node in Lezer (EC-03) — handled naturally.
 *   - Mermaid blocks inside blockquotes ARE included — Lezer iterates nested FencedCode
 *     nodes regardless of blockquote nesting (EC-08).
 *
 * @param state - The current CM6 EditorState.
 * @returns Array of DiagramBlock objects sorted ascending by `from`.
 */
export function scanDiagramBlocks(state: EditorState): DiagramBlock[] {
  const results: DiagramBlock[] = [];

  syntaxTree(state).iterate({
    enter(node: { name: string; from: number; to: number; node: { cursor: () => { firstChild: () => boolean; name: string; from: number; to: number; nextSibling: () => boolean } } }) {
      if (node.name !== "FencedCode") return;

      // Walk FencedCode children to find CodeInfo and CodeText.
      let langTag = "";
      let source = "";

      const cursor = node.node.cursor();
      if (cursor.firstChild()) {
        do {
          if (cursor.name === "CodeInfo") {
            langTag = state.doc.sliceString(cursor.from, cursor.to).trim().toLowerCase();
          }
          if (cursor.name === "CodeText") {
            // CodeText includes the trailing newline before the closing fence.
            // Trim to get clean Mermaid source.
            source = state.doc.sliceString(cursor.from, cursor.to).trim();
          }
        } while (cursor.nextSibling());
      }

      if (langTag !== "mermaid") {
        // Not a mermaid block — continue iterating sibling nodes.
        return;
      }

      results.push({
        from: node.from,
        to: node.to,
        source,
      });

      // Return false to stop descending into this FencedCode's children —
      // we have already walked them manually above.
      return false;
    },
  });

  // Safety sort — Lezer iterates left-to-right so results are normally already sorted,
  // but RangeSetBuilder requires strictly ascending `from` order (FR-02.1).
  results.sort((a, b) => a.from - b.from);
  return results;
}

/**
 * Return true if the selection overlaps the given document range.
 *
 * Formula: selFrom < to && selTo >= from
 *   - Handles collapsed cursors (anchor === head) and multi-character selections.
 *   - Normalises anchor/head so reversed selections work correctly.
 *   - Cursor exactly at `from` (on the opening fence) counts as inside.
 *   - Cursor exactly at `to` (after the closing fence) counts as outside.
 *
 * @param selectionAnchor - state.selection.main.anchor
 * @param selectionHead   - state.selection.main.head
 * @param from            - Inclusive start of the fenced block range.
 * @param to              - Exclusive end of the fenced block range.
 */
export function isCursorInsideRange(
  selectionAnchor: number,
  selectionHead: number,
  from: number,
  to: number,
): boolean {
  const selFrom = Math.min(selectionAnchor, selectionHead);
  const selTo   = Math.max(selectionAnchor, selectionHead);
  return selFrom < to && selTo >= from;
}

/**
 * Build a DecorationSet replacing all out-of-cursor mermaid blocks with widgets.
 *
 * Called by the StateField's create() and update() methods.
 *
 * Source-mode guard (AD-04, FR-06): returns Decoration.none immediately if
 * __MARKABLE_PREVIEW_ENABLED__ is falsy. No Lezer tree walk occurs in source mode.
 *
 * Cursor overlap (FR-02.5): if the selection touches a block's [from, to) range,
 * the decoration is suppressed and the raw fenced text is visible for editing.
 *
 * @param state - The current CM6 EditorState.
 * @returns DecorationSet with Decoration.replace({ block: true }) for each visible diagram.
 */
export function buildDiagramDecorations(state: EditorState): DecorationSet {
  // Source-mode guard (AD-04): no widgets in raw/source mode.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  if (!(window as any).__MARKABLE_PREVIEW_ENABLED__) return Decoration.none;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const blocks = scanDiagramBlocks(state);
  if (blocks.length === 0) return Decoration.none; // EC-20: fast path

  const sel = state.selection.main;
  const builder = new RangeSetBuilder<ReturnType<typeof Decoration.replace>>();

  for (const block of blocks) {
    // Suppress decoration when cursor overlaps this block (FR-02.5).
    if (isCursorInsideRange(sel.anchor, sel.head, block.from, block.to)) {
      continue;
    }

    // MermaidWidget replaces the entire fenced block with the rendered SVG widget.
    const widget = new MermaidWidget(block.source, block.from);
    const deco = Decoration.replace({ widget, block: true });
    builder.add(block.from, block.to, deco);
  }

  return builder.finish();
}

// ── MermaidWidget ─────────────────────────────────────────────────────────────

/**
 * CM6 WidgetType for a mermaid fenced code block.
 *
 * Implements the deferred-DOM async render pattern (AD-07, OQ-04):
 *   toDOM() returns a placeholder <div> synchronously (CM6 sync requirement).
 *   An async Promise chain then calls mermaid.render() and mutates the
 *   placeholder's innerHTML when the render resolves.
 *
 * This DOM mutation occurs outside CM6's transaction model, which is
 * intentional and safe for display-only widgets. CM6 does not track widget-
 * internal DOM content after initial placement.
 *
 * eq() compares source strings AND the initialized Mermaid theme so CM6 can
 * reuse the existing DOM node when the mermaid source and theme have not changed
 * (e.g. cursor moves in and out without editing). Same source + same theme =
 * same SVG output = no re-render needed (FR-04.4, EC-14).
 * When the theme changes, eq() returns false, forcing toDOM() to re-render
 * with the new theme (EC-10).
 *
 * ignoreEvent() returns false so mouse clicks pass through to CM6, moving
 * the cursor into the block range and triggering source reveal (FR-04.5).
 *
 * Unique IDs (AD-08, EC-19): each MermaidWidget instance uses a fresh render ID
 * derived from the module-level _renderCounter. The counter increments in the
 * constructor so IDs are unique across all widget instances in a document.
 * IDs never reuse values across enable cycles — the counter is never reset.
 * This makes ID collision (EC-19) practically impossible.
 *
 * XSS safety (NFR-08): Mermaid 11.x uses securityLevel: "strict" by default,
 * which sanitizes SVG output and removes any embedded <script> elements.
 * The plugin sets securityLevel explicitly in mermaid.initialize() (step_07)
 * as a belt-and-suspenders guard. EC-15 is handled by Mermaid itself.
 */
export class MermaidWidget extends (WidgetType as typeof WidgetTypeClass) {
  /** Raw Mermaid source passed to mermaid.render(). */
  readonly source: string;
  /** The Mermaid theme active when this widget was created. Used in eq() to detect theme changes. */
  readonly theme: string;
  /**
   * Document position of the opening fence character.
   * Used by the edit button to move the cursor into the block.
   * Intentionally excluded from eq() — a position-only change (e.g. text
   * inserted before the block) must not force an SVG re-render.
   */
  readonly from: number;
  /** Unique render element ID for this widget instance. */
  private readonly renderId: string;

  constructor(source: string, from: number) {
    super();
    this.source = source;
    this.from = from;
    // Capture the current initialized theme so eq() can detect theme changes (EC-10).
    this.theme = _initializedTheme;
    // Increment before assignment so IDs start at 1 (never 0).
    _renderCounter++;
    this.renderId = `mermaid-widget-${_renderCounter}`;
  }

  /**
   * Equality check. CM6 calls this when it has an existing DOM node for a
   * widget at the same document position and considers reusing it.
   *
   * Two widgets are equal iff their source strings AND theme strings are identical.
   * When the user edits the mermaid source, eq() returns false — CM6 calls toDOM()
   * to create a fresh node and re-renders the SVG (EC-13).
   * When the theme changes, the new widget captures a different theme string,
   * so eq() returns false, forcing a re-render with the new theme (EC-10).
   * When the cursor enters and exits without editing or theme change, eq() returns
   * true — CM6 reuses the existing DOM node, skipping the async render (EC-14).
   */
  eq(other: MermaidWidget): boolean {
    return other.source === this.source && other.theme === this.theme;
  }

  /**
   * Create the DOM element for this widget.
   *
   * Returns a placeholder <div> immediately (synchronous — CM6 requirement).
   * The placeholder has class "cm-mermaid-block cm-mermaid-loading" which
   * displays a "Rendering diagram…" indicator via CSS ::before (NFR-01).
   *
   * An async Promise chain immediately fires to call mermaid.render():
   *   - On success: the returned SVG string is injected into the placeholder
   *     via innerHTML and the loading class is removed.
   *   - On failure: the placeholder is populated with an error element (FR-05).
   *
   * Tab-switch safety (EC-22): if the user switches tabs while the render is
   * in flight, the Promise still resolves and mutates the placeholder div.
   * If the div has been detached from the DOM (tab no longer active), the
   * mutation is harmless — no error is thrown, no crash occurs.
   *
   * Very large diagram (EC-05): Mermaid may take longer than 300ms for complex
   * diagrams. The loading placeholder is shown immediately (within one frame)
   * so the user sees feedback. NFR-01 timing goal applies to simple diagrams;
   * complex ones exceed it by design.
   */
  toDOM(): HTMLElement {
    const placeholder = document.createElement("div");
    placeholder.className = "cm-mermaid-block cm-mermaid-loading";

    // Apply max-width from current settings as a CSS custom property on the element.
    // This overrides the CSS variable default set in the stylesheet (step_03).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const maxWidth = (_settings as any).maxRenderWidth ?? DEFAULT_SETTINGS.maxRenderWidth;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    placeholder.style.setProperty("--mermaid-max-width", `${maxWidth}px`);

    // Dedicated slot for the SVG output. Using a child div (not placeholder.innerHTML)
    // ensures the edit button — appended as a sibling — survives the async render.
    const svgSlot = document.createElement("div");
    placeholder.appendChild(svgSlot);

    // Edit button — appears on hover, moves cursor into the source block.
    // Using mousedown (not click) so the editor receives focus before the
    // dispatch, preventing a race between blur and cursor placement.
    const editBtn = document.createElement("button");
    editBtn.className = "cm-mermaid-edit-btn";
    editBtn.textContent = "Edit source";
    editBtn.title = "Click to edit the Mermaid source";
    editBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const view = (window as any).__MARKABLE_EDITOR_VIEW__;
      /* eslint-enable @typescript-eslint/no-explicit-any */
      if (view) {
        // Place cursor at the start of the block — isCursorInsideRange will
        // match and the decoration is removed, revealing the raw source.
        view.dispatch({ selection: { anchor: this.from } });
        view.focus();
      }
    });
    placeholder.appendChild(editBtn);

    // Fire the async render immediately. The Promise runs in the microtask queue.
    // toDOM() returns the placeholder synchronously before the Promise settles.
    void this._renderAsync(placeholder, svgSlot);

    return placeholder;
  }

  /**
   * Perform the async Mermaid render and mutate the SVG slot div.
   *
   * Renders into `svgSlot` (a child of `container`) rather than `container`
   * itself, so that the edit button appended as a sibling is not wiped by the
   * innerHTML assignment.
   *
   * @param container - The outer .cm-mermaid-block div (loading class lives here).
   * @param svgSlot   - The inner div where the SVG string is injected.
   */
  private async _renderAsync(container: HTMLElement, svgSlot: HTMLElement): Promise<void> {
    // Guard: if source is empty (EC-01, EC-02), show an error state immediately.
    // Mermaid returns an empty/invalid SVG for empty source; skip the render call.
    if (!this.source.trim()) {
      this._showError(container, this.source, "Empty diagram source");
      return;
    }

    try {
      // mermaid.render() returns Promise<{ svg: string; bindFunctions?: (el: Element) => void }>.
      // We use only the svg string.
      const { svg } = await mermaid.render(this.renderId, this.source);

      // Inject SVG into the slot, not the container — preserves the edit button sibling.
      // innerHTML is safe here: Mermaid's securityLevel: "strict" sanitizes the output (NFR-08, EC-15).
      container.classList.remove("cm-mermaid-loading");
      svgSlot.innerHTML = svg;
    } catch (err) {
      // Mermaid rejected the render — invalid syntax or unsupported diagram type (EC-04).
      const message = err instanceof Error ? err.message : String(err);
      this._showError(container, this.source, message);
    }
  }

  /**
   * Populate the placeholder with an error display (FR-05).
   *
   * Called when mermaid.render() throws or when source is empty.
   * Removes the loading class and adds the error class.
   * The raw source is shown in a <pre> block when showErrorSource is true (FR-08.1).
   *
   * @param placeholder - The container div to populate.
   * @param source      - Raw Mermaid source (shown in <pre> if showErrorSource is true).
   * @param message     - Error message text to display.
   */
  private _showError(placeholder: HTMLElement, source: string, message: string): void {
    placeholder.classList.remove("cm-mermaid-loading");
    placeholder.classList.add("cm-mermaid-error");

    const label = document.createElement("span");
    label.className = "cm-mermaid-error-label";
    label.textContent = `Diagram error: ${message}`;
    placeholder.appendChild(label);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const showSource = (_settings as any).showErrorSource ?? DEFAULT_SETTINGS.showErrorSource;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (showSource && source) {
      const pre = document.createElement("pre");
      // textContent for XSS safety — do not use innerHTML for user source.
      pre.textContent = source;
      placeholder.appendChild(pre);
    }
  }

  /**
   * Allow mouse events to pass through to CM6.
   * Returning false lets clicks move the cursor into the block's document range,
   * which triggers the StateField to remove the decoration and reveal raw source.
   */
  ignoreEvent(): boolean {
    return false;
  }
}

// ── StateField ────────────────────────────────────────────────────────────────

/**
 * A custom StateEffect used to signal theme changes to the StateField.
 *
 * When the Mermaid theme changes (step_07), this effect is dispatched on the
 * editor to force the StateField's update() to recompute all decorations with
 * the new theme. The effect carries no payload — its presence is the signal.
 *
 * Defined here (near the StateField factory) so both the StateField factory
 * and the theme-change dispatcher can reference it.
 */
export const themeChangedEffect = StateEffect.define<null>();

/**
 * Create a fresh CM6 StateField<DecorationSet> for diagram decorations.
 *
 * Factory pattern (AD-06): called inside onEnable, not at module level.
 * Each enable cycle gets a new StateField with a new internal slot ID.
 * This prevents slot ID leakage across disable/re-enable cycles (EC-12).
 *
 * Recomputation triggers (FR-02.3):
 *   - tr.docChanged: document content changed (user typed, pasted, etc.)
 *   - tr.selection:  cursor or selection moved (reveal/hide decoration)
 *   - tr.effects containing themeChangedEffect: Mermaid theme changed (step_07)
 *
 * Transactions with none of these signals are returned unchanged (performance
 * optimization: skips O(N) Lezer tree walk for non-impacting transactions).
 */
function createDiagramsField(): ReturnType<typeof StateField.define> {
  return StateField.define<DecorationSet>({
    /**
     * Called once when the field is installed into the editor.
     * Builds the initial DecorationSet from the current document state.
     */
    create(state: EditorState): DecorationSet {
      return buildDiagramDecorations(state);
    },

    /**
     * Called on every CM6 transaction. Recomputes only when needed.
     *
     * The `themeChangedEffect` check ensures that a theme change dispatched
     * from reinitIfNeeded() triggers a full recompute even if the document
     * and selection are unchanged (EC-10).
     *
     * The `treeChanged` check handles Lezer incremental parse completions:
     * the async Markdown parser dispatches transactions that do NOT set
     * `docChanged` or `selection`, but DO update the syntax tree. Without
     * this check, diagrams in large documents would not render on initial
     * load (the parse tree was incomplete at the time of the first update).
     */
    update(value: DecorationSet, tr: Transaction): DecorationSet {
      const hasThemeEffect = tr.effects.some((e) => e.is(themeChangedEffect));
      const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
      if (!tr.docChanged && !tr.selection && !hasThemeEffect && !treeChanged) {
        return value; // Reuse existing decorations
      }
      return buildDiagramDecorations(tr.state);
    },

    /**
     * Wire the field's DecorationSet to CM6's internal decoration pipeline.
     * EditorView.decorations.from(field) is the CM6-idiomatic way to register
     * a StateField as a decoration provider.
     */
    provide(field) {
      return _EditorView.decorations.from(field);
    },
  });
}

// ── Theme detection ───────────────────────────────────────────────────────────

/**
 * Determine the appropriate Mermaid theme string based on the current app theme.
 *
 * Strategy (FR-07.2, OQ-05):
 *   1. If _settings.mermaidTheme is not "auto", use that value directly.
 *   2. For "auto": inspect the CSS custom property --color-scheme on :root.
 *      Markable's themes set this to "dark" or "light". If the property is
 *      "dark", return Mermaid's "dark" theme. Otherwise return "default".
 *   3. Fallback: read the computed background-color of document.body using
 *      getComputedStyle. If the perceived luminance is below 0.5, the theme
 *      is dark. This covers custom themes that may not set --color-scheme.
 *
 * Returns one of Mermaid's valid theme strings: "dark", "default", "neutral",
 * "forest", or "base".
 */
export function resolveMermaidTheme(): string {
  // Non-auto: user has explicitly chosen a Mermaid theme.
  if (_settings.mermaidTheme !== "auto") {
    return _settings.mermaidTheme;
  }

  // Strategy 1: Check --color-scheme CSS variable (set by Markable themes).
  const colorScheme = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-scheme")
    .trim();
  if (colorScheme === "dark") return "dark";
  if (colorScheme === "light") return "default";

  // Strategy 2: Luminance of document.body background-color.
  // getComputedStyle returns "rgb(R, G, B)" or "rgba(R, G, B, A)".
  const bg = getComputedStyle(document.body).backgroundColor;
  const match = bg.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    // sRGB relative luminance approximation (WCAG formula, simplified).
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (luminance < 0.5) return "dark";
  }

  // Default: light theme.
  return "default";
}

/**
 * Call mermaid.initialize() if the resolved theme differs from the last
 * initialized theme (OQ-03). This avoids redundant re-initialization when
 * the user moves the cursor or edits non-mermaid content.
 *
 * mermaid.initialize() is idempotent and can be called multiple times in the
 * same JS context. Each call updates Mermaid's internal config. The new config
 * applies to subsequent mermaid.render() calls.
 *
 * securityLevel: "strict" is always set as a belt-and-suspenders XSS guard
 * (NFR-08, EC-15), regardless of the theme.
 *
 * @returns true if initialization was performed (theme changed), false if skipped.
 */
export function reinitIfNeeded(): boolean {
  const theme = resolveMermaidTheme();
  if (theme === _initializedTheme) return false;

  // Resolve the app's UI font so Mermaid diagrams match the theme typography.
  // --ui-font is defined on :root by all Markable themes; fall back to Inter
  // then the system sans-serif stack if the variable is not set.
  const uiFont = getComputedStyle(document.documentElement)
    .getPropertyValue("--ui-font")
    .trim() || "Inter, system-ui, -apple-system, sans-serif";

  mermaid.initialize({
    startOnLoad: false,
    // Cast to the Mermaid v11 theme union type. resolveMermaidTheme() only returns
    // values that are valid Mermaid themes ("dark", "default", "neutral", "forest").
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    theme: theme as any,
    // securityLevel: "strict" strips <script> tags from SVG output (NFR-08, EC-15).
    securityLevel: "strict",
    themeVariables: {
      fontFamily: uiFont,
    },
  });

  _initializedTheme = theme;
  return true;
}

/**
 * Force a StateField recompute by dispatching a themeChangedEffect transaction.
 *
 * After mermaid.initialize() is called with a new theme, existing widget DOM
 * nodes contain SVG with the old theme colors. To trigger re-render, the
 * StateField must recompute — which causes CM6 to call toDOM() again for all
 * visible widgets. Because MermaidWidget.eq() includes the theme string in its
 * comparison, new widgets (with the new theme captured in their constructor)
 * will not match existing old-theme widgets, forcing toDOM() to run.
 *
 * If no editor view is available (null — plugin not yet fully initialized),
 * this call is a no-op. The theme will be applied on the next StateField
 * recompute triggered by doc or selection changes.
 */
function dispatchThemeEffect(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const view = (window as any).__MARKABLE_EDITOR_VIEW__;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (view) {
    view.dispatch({ effects: [themeChangedEffect.of(null)] });
  }
}

// ── Settings persistence ──────────────────────────────────────────────────────

/**
 * Save current _settings to disk via the plugin API.
 *
 * Logs and swallows any save error — the in-memory settings remain active
 * for the session even if the disk write fails (EC-24, FR-08.1).
 *
 * Exported exclusively for unit-test use so EC-24 (save-failure resilience)
 * can be verified in isolation: a test can pass a mock API whose saveSettings()
 * rejects, call this function, and assert neither an exception propagates nor
 * _settings is cleared. Production callers use _currentApi internally.
 *
 * @param api - The MarkablePluginAPI from the current enable cycle.
 */
export function saveSettings(api: MarkablePluginAPI): void {
  api.saveSettings({ ..._settings }).catch((err: unknown) => {
    console.warn("[diagrams] Failed to save settings:", err);
  });
}

// ── Theme observer ────────────────────────────────────────────────────────────

/**
 * Create and start the MutationObserver that watches for theme changes on
 * document.body and document.documentElement.
 *
 * Extracted from onEnable so that observer setup logic is independently readable
 * and onEnable stays within the 30-line limit (HIGH-01).
 *
 * The observer calls reinitIfNeeded() on each mutation. When the theme actually
 * changes, it also dispatches a themeChangedEffect to force the StateField to
 * recompute all diagram decorations with the new Mermaid theme (EC-10).
 *
 * Returns the created MutationObserver so onDisable can disconnect it.
 */
function startThemeObserver(): MutationObserver {
  const observer = new MutationObserver(() => {
    const changed = reinitIfNeeded();
    if (changed) {
      dispatchThemeEffect();
    }
  });

  // Observe document.body for theme class and data-attribute changes.
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-color-scheme"],
  });

  // Also observe :root for CSS variable changes that themes may apply there.
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });

  return observer;
}

// ── Plugin lifecycle ──────────────────────────────────────────────────────────

/**
 * Called by the plugin loader when the Diagrams plugin is enabled.
 *
 * Responsibilities (in order):
 *   1. Load and merge persisted settings (EC-23: null on first run → defaults).
 *   2. Inject plugin CSS.
 *   3. Initialize Mermaid with the current theme.
 *   4. Install a fresh StateField for this enable cycle (AD-06).
 *   5. Start a MutationObserver to detect theme changes (EC-10).
 */
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  _currentApi = api;

  // Load persisted settings via the pure merge helper (EC-23: null → defaults).
  _settings = loadAndMergeSettings(await api.loadSettings());

  injectPluginCSS();

  // Initialize Mermaid with the current theme (step_07).
  reinitIfNeeded();

  // Fresh StateField instance for this enable cycle avoids slot-ID leakage (AD-06).
  _diagramsField = createDiagramsField();
  api.addExtensions([_diagramsField]);

  // Signal to live-preview.ts that mermaid FencedCode blocks should be skipped —
  // same pattern as __MARKABLE_MEDIA_PREVIEW_ACTIVE__ for images. Without this flag,
  // live-preview applies fence-mark replace decorations that conflict with the diagrams
  // StateField's block replacement, preventing initial render.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).__MARKABLE_DIAGRAMS_ACTIVE__ = true;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Watch for theme changes so diagrams re-render when the user switches themes (EC-10).
  _themeObserver = startThemeObserver();
}

function onDisable(api: MarkablePluginAPI): void {
  _currentApi = null;

  // Clear the live-preview skip flag so mermaid blocks render as regular code blocks.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).__MARKABLE_DIAGRAMS_ACTIVE__ = false;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  api.removeExtensions();
  removePluginCSS();

  // Disconnect the MutationObserver so no stale callbacks fire after disable.
  if (_themeObserver) {
    _themeObserver.disconnect();
    _themeObserver = null;
  }

  _diagramsField = null;
  _initializedTheme = "";
}

// ── Settings row builders ─────────────────────────────────────────────────────
//
// Each function creates one settings row for renderDetailExtra().
// Extracting them keeps renderDetailExtra() under 30 lines (HIGH-02).
// Using direct element references avoids CSS selector fragility (LOW-02).

/**
 * Build the Mermaid theme selector row.
 *
 * Creates a <div class="plugin-detail-setting-row"> containing a <label> and
 * a <select> with the five theme options. Sets the current value from _settings
 * and attaches a change listener that updates _settings, re-initializes Mermaid
 * if the theme changed, dispatches a themeChangedEffect, and saves settings.
 */
function buildThemeRow(): HTMLElement {
  return buildSelectRow(
    "Diagram theme",
    _settings.mermaidTheme,
    [
      ["auto",    "Auto (follows app theme)"],
      ["default", "Default (light)"],
      ["dark",    "Dark"],
      ["neutral", "Neutral"],
      ["forest",  "Forest"],
    ],
    (value) => {
      _settings.mermaidTheme = value as DiagramsSettings["mermaidTheme"];
      const changed = reinitIfNeeded();
      if (changed) dispatchThemeEffect();
      if (_currentApi) saveSettings(_currentApi);
    },
  );
}

/**
 * Build the max render width input row.
 *
 * Validation range is [200, 4000] — matches the HTML min/max attributes and the
 * JS guard, preventing inconsistency between the HTML hint and the actual check
 * (MEDIUM-02). Values below 200 are silently rejected (the input reverts on blur).
 *
 * On valid change: updates _settings, saves, and immediately applies the CSS
 * variable to all existing .cm-mermaid-block elements (cosmetic, no StateField
 * recompute needed).
 */
function buildWidthRow(): HTMLElement {
  return buildNumberRow(
    "Max render width (px)",
    _settings.maxRenderWidth,
    { min: 200, max: 4000, step: 50, width: "80px" },
    (value) => {
      const v = Math.round(value);
      if (v >= 200 && v <= 4000) {
        _settings.maxRenderWidth = v;
        if (_currentApi) saveSettings(_currentApi);
        document.querySelectorAll<HTMLElement>(".cm-mermaid-block").forEach((el) => {
          el.style.setProperty("--mermaid-max-width", `${v}px`);
        });
      }
    },
  );
}

/**
 * Build the "show error source" checkbox row.
 *
 * When checked, error placeholders include the raw Mermaid source in a <pre>
 * block so the user can inspect and fix their diagram syntax (FR-05.2, FR-08.1).
 */
function buildErrorSourceRow(): HTMLElement {
  return buildToggleRow({
    label: "Show diagram source in error messages",
    checked: _settings.showErrorSource,
    onChange: (checked) => {
      _settings.showErrorSource = checked;
      if (_currentApi) saveSettings(_currentApi);
    },
  });
}

// ── Plugin export ─────────────────────────────────────────────────────────────

export default {
  id: "diagrams",
  name: "Mermaid Diagrams",
  version: "1.0.0",
  description: "Render Mermaid diagrams in live preview mode",
  detail:
    "Renders ```mermaid fenced code blocks as SVG diagrams in live preview mode. " +
    "Supports flowcharts, sequence diagrams, Gantt charts, class diagrams, state diagrams, " +
    "ER diagrams, pie charts, mindmaps, timelines, and more. " +
    "Raw Mermaid source is shown when your cursor is inside the block; " +
    "the rendered SVG appears when your cursor moves away. " +
    "Diagram theme adapts automatically to the active Markable theme (dark/light).",
  onEnable,
  onDisable,

  /**
   * Settings UI rendered in the Plugins Panel detail view (FR-08.3).
   *
   * Composes three setting rows built by dedicated helper functions:
   *   1. `buildThemeRow()`      — Mermaid theme selector
   *   2. `buildWidthRow()`      — Max render width numeric input
   *   3. `buildErrorSourceRow()` — Show error source checkbox
   *
   * Each helper is self-contained: it creates the row element, populates it
   * with the current setting value, and attaches the change listener.
   * Extracting them keeps each function under 30 lines (HIGH-02).
   *
   * Called every time the detail view is opened. The container is freshly
   * created on each call — no cleanup needed.
   *
   * @param container - The element to append settings rows into.
   */
  renderDetailExtra(container: HTMLElement): void {
    container.appendChild(buildThemeRow());
    container.appendChild(buildWidthRow());
    container.appendChild(buildErrorSourceRow());
  },
};

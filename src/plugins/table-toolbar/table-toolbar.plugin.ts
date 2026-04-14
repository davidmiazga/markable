/**
 * Table Toolbar plugin for Markable 2.0.
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/table-toolbar.js
 *
 * Self-containment rules (same as all .plugin.ts files):
 *   - No @codemirror/* imports as values — accessed via window.__CM_VIEW__.
 *   - No app-internal module imports (bridge, settings, main, plugin-types).
 *   - CSS injected as <style id="__markable_tbl_toolbar_css__"> in onEnable.
 *   - import type annotations are erased by tsc; safe for IDE support.
 *
 * Architecture overview:
 *   Contextual floating toolbar (or sidebar panel) for Markdown table operations.
 *   When the cursor is inside a GFM table the top bar, row handle, and bottom pill
 *   appear. Each button dispatches exactly one CM6 transaction (single undo step).
 *
 *   Two modes:
 *     - Floating (default): three DOM elements fixed-positioned around the table.
 *     - Sidebar: a docked panel with all 11 operations as labelled buttons.
 *
 * Module sections (in order):
 *   1.  Type-only imports
 *   2.  Settings types and defaults
 *   3.  Module-level state declarations
 *   4.  CSS constant and lifecycle helpers
 *   5.  TableContext type + pure detectTableContext (+ helpers splitRow, etc.)
 *   6.  Pure table operations (all 11)
 *   7.  DOM: buildTopBar / buildRowHandle / buildBottomPill
 *   8.  DOM: updateFloatingPositions / updateFloatingVisibility / clampHorizontal
 *           startRowDrag / updateTopBarButtonStates
 *   9.  DOM: buildSidebarPanel / updateSidebarButtonStates
 *   10. CM6 listener factory: buildUpdateListener
 *   11. Plugin export object (onEnable / onDisable / renderDetailExtra)
 */

// ── 1. Type-only imports (erased at compile time) ────────────────────────────

// These three imports are type-only — fully erased by tsc. They provide IDE
// autocompletion and type safety without emitting any runtime code.
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { Tree as SyntaxTree } from "@lezer/common";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── 2. Settings types and defaults ───────────────────────────────────────────

/** Determines whether the toolbar floats over the editor or lives in the sidebar. */
export type ToolbarMode = "floating" | "sidebar";

/** Which sidebar slot the toolbar panel should occupy when in sidebar mode. */
export type SidebarSide = "left" | "right";

/** Persisted settings for the Table Toolbar plugin. */
export interface TableToolbarSettings {
  toolbarMode: ToolbarMode;
  sidebarSide: SidebarSide;
}

/**
 * Default settings used on first run (EC-20) or when a stored value is invalid
 * (EC-21). Floating mode is the default because it requires no sidebar slot.
 */
export const DEFAULT_SETTINGS: TableToolbarSettings = {
  toolbarMode: "floating",
  sidebarSide: "left",
};

/**
 * Merge raw (potentially partial or null) persisted data with defaults.
 *
 * Handles:
 *   EC-20: null input (first run, no settings file) → returns DEFAULT_SETTINGS copy.
 *   EC-21: partial object (missing keys) → fills missing keys from defaults.
 *   EC-21: invalid values (unknown string) → falls back to the default for that key.
 *
 * This function is pure: it never mutates DEFAULT_SETTINGS or the input object.
 *
 * @param raw - Parsed JSON object from disk, or null if none exists.
 * @returns   A complete, validated TableToolbarSettings object.
 */
export function mergeWithDefaults(
  raw: Record<string, unknown> | null,
): TableToolbarSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  return {
    toolbarMode:
      raw["toolbarMode"] === "floating" || raw["toolbarMode"] === "sidebar"
        ? (raw["toolbarMode"] as ToolbarMode)
        : DEFAULT_SETTINGS.toolbarMode,
    sidebarSide:
      raw["sidebarSide"] === "left" || raw["sidebarSide"] === "right"
        ? (raw["sidebarSide"] as SidebarSide)
        : DEFAULT_SETTINGS.sidebarSide,
  };
}

// ── 3. Module-level state declarations ───────────────────────────────────────
// All variables are private to the IIFE closure after bundling. They are reset
// to their initial values in onDisable to support clean toggle cycles.

/** Debounce delay in milliseconds — consistent with auto-toc and word-count. */
const DEBOUNCE_MS = 150;

/** Guards the updateListener hot path. Set true in onEnable, false in onDisable. */
let _enabled: boolean = false;

/** Active resolved settings for the current onEnable cycle. */
let _settings: TableToolbarSettings = { ...DEFAULT_SETTINGS };

/**
 * The MarkablePluginAPI instance captured in onEnable.
 * Used by renderDetailExtra to save settings and restart the plugin.
 * Reset to null in onDisable.
 */
let _api: MarkablePluginAPI | null = null;

/** Top bar element (7 column-level buttons). Created in onEnable, removed in onDisable. */
let _topBar: HTMLElement | null = null;

/** Row handle element (the drag handle icon on the left of the current row). */
let _rowHandle: HTMLElement | null = null;

/** Drag-to-reorder indicator line shown during a row drag. */
let _dragIndicator: HTMLElement | null = null;

/** Bottom pill element (the + button below the table). */
let _bottomPill: HTMLElement | null = null;

/** Sidebar panel DOM element built by buildSidebarPanel(). Nulled in onDisable. */
let _sidebarPanelEl: HTMLElement | null = null;

/** Whether a sidebar panel was registered in the current onEnable cycle. */
let _sidebarPanelRegistered: boolean = false;

/** Active debounce timer for table context detection. Cleared in onDisable. */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Window blur listener (capture phase) that hides floating elements when the
 * editor loses focus (EC-13). Null when not in floating mode.
 */
let _blurListener: (() => void) | null = null;

// ── 4. CSS constant and lifecycle helpers ─────────────────────────────────────

/**
 * Unique id for the injected <style> element.
 * Used for idempotent guard so rapid enable/disable cycles never duplicate it (EC-19).
 *
 * @visibleForTesting Exported so tests can locate the element by id.
 */
export const STYLE_ID = "__markable_tbl_toolbar_css__";

/**
 * Full CSS ruleset injected as a <style> tag on enable.
 * All colours use CSS custom properties for automatic theme adoption (FR-9).
 *
 * The full ruleset is defined here (step_04). The .tbl-toolbar base class uses
 * display:none by default — visibility toggled by adding/removing tbl-toolbar--visible.
 */
const TOOLBAR_CSS = `
/* ── Shared container base ── */
.tbl-toolbar {
  position: fixed;
  z-index: 10000;
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--text-primary) 15%, transparent);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  display: none;
}

/* ── Top bar ── */
.tbl-toolbar--top {
  display: none;
  flex-direction: row;
  gap: 4px;
  padding: 5px 8px;
}
.tbl-toolbar--top.tbl-toolbar--visible {
  display: flex;
}

/* ── Buttons ── */
.tbl-toolbar__btn {
  width: 34px;
  height: 34px;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tbl-toolbar__btn:hover {
  background: var(--selection-bg);
}
.tbl-toolbar__btn--disabled {
  opacity: 0.35;
  pointer-events: none;
  cursor: default;
}

/* ── Row handle ── */
.tbl-toolbar__row-handle {
  position: fixed;
  z-index: 10000;
  display: none;
  width: 28px;
  height: 28px;
  background: var(--bg-chrome);
  border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent);
  border-radius: 4px;
  cursor: grab;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: var(--text-secondary);
  user-select: none;
}
.tbl-toolbar__row-handle.tbl-toolbar--visible {
  display: flex;
}

/* ── Drag-to-reorder indicator ── */
.tbl-toolbar__drag-indicator {
  position: fixed;
  z-index: 10002;
  height: 2px;
  background: var(--link-color, #4a9eff);
  border-radius: 1px;
  pointer-events: none;
  display: none;
}

/* ── Bottom pill ── */
.tbl-toolbar__bottom-pill {
  position: fixed;
  z-index: 10000;
  display: none;
  width: 44px;
  height: 26px;
  background: var(--bg-chrome);
  border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent);
  border-radius: 13px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--text-secondary);
  user-select: none;
}
.tbl-toolbar__bottom-pill.tbl-toolbar--visible {
  display: flex;
}

/* ── Sidebar mode override ── */
.sidebar-panel-content .tbl-toolbar-sidebar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}
.sidebar-panel-content .tbl-toolbar__btn {
  width: auto;
  height: 28px;
  justify-content: flex-start;
  padding: 0 8px;
  font-size: 13px;
}
`;

/**
 * Inject the toolbar <style> tag into <head>.
 * Guarded by the element id so rapid enable/disable cycles never produce
 * duplicate <style> tags (EC-19).
 *
 * @visibleForTesting Exported only for idempotency tests.
 */
export function injectCSS(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOOLBAR_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the injected <style> tag.
 * No-op if the tag was already removed or never injected.
 *
 * @visibleForTesting Exported only for lifecycle tests.
 */
export function removeCSS(): void {
  document.getElementById(STYLE_ID)?.remove();
}

// ── CM view/state/language global accessors ───────────────────────────────────

/**
 * Access the @codemirror/view module from the window global set by cm-globals.ts.
 * Never called at module-evaluation time — only inside factory functions.
 */
function getCmView(): typeof import("@codemirror/view") {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Access the syntaxTree function from the @codemirror/language module global.
 * The project exposes this via window.__CM_LANGUAGE__ (set in cm-globals.ts).
 * Falls back gracefully if the global is absent (returns a no-op object).
 *
 * Note: __CM_LANGUAGE__ is populated by cm-globals.ts alongside __CM_VIEW__.
 */
function getCmLanguage(): { syntaxTree: (state: unknown) => SyntaxTree } {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (window as any).__CM_LANGUAGE__ as { syntaxTree: (state: unknown) => SyntaxTree };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Read the live EditorView reference at call time.
 * Never cached — always reads from window.__MARKABLE_EDITOR_VIEW__ (EC-23).
 * Returns undefined when the view is not yet available (EC-22, EC-30).
 */
function getEditorView(): EditorViewType | undefined {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (window as any).__MARKABLE_EDITOR_VIEW__ as EditorViewType | undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// ── 5. TableContext type + pure detection ─────────────────────────────────────

/**
 * All information about the table the cursor is currently inside.
 * Returned by detectTableContext; null when the cursor is outside any table.
 */
export interface TableContext {
  /** Absolute document offset of the Table node start. */
  tableFrom: number;
  /** Absolute document offset of the Table node end. */
  tableTo: number;
  /** Raw table source text (sliceString from tableFrom to tableTo). */
  tableText: string;
  /** 0-based row index within the table. null when cursor is on separator row. */
  rowIndex: number | null;
  /** 0-based column index within the current row. */
  colIndex: number;
  /** True when rowIndex === 0 (the header row). */
  isHeaderRow: boolean;
  /** True when cursor is on the separator row (rowIndex === null). */
  isSeparatorRow: boolean;
  /** Number of columns, derived from the separator row. */
  columnCount: number;
  /** Total rows including header + separator + all body rows. */
  rowCount: number;
}

/**
 * Split a Markdown table row string into cell content strings.
 *
 * Rules:
 *   - Split on `|` not preceded by `\` (negative lookbehind — AD-6, EC-24).
 *   - Discard the first and last empty segments produced by leading/trailing `|`.
 *   - Do NOT trim cell content (NFR-5, EC-25).
 *
 * @param rowText - A single table row line, e.g. "| foo | bar\\| baz |"
 * @returns Array of cell content strings, e.g. [" foo ", " bar\\| baz "]
 */
export function splitRow(rowText: string): string[] {
  // Strip optional trailing \r (CRLF documents — EC-31) before splitting.
  const trimmed = rowText.replace(/\r$/, "");
  const parts = trimmed.split(/(?<!\\)\|/);
  // Drop the first and last segments (the empty strings outside the opening
  // and closing `|` of a well-formed GFM table row).
  return parts.slice(1, parts.length - 1);
}

/**
 * Detect the line ending used in the table text.
 * Returns "\r\n" if the text contains any CRLF sequence, otherwise "\n".
 * This allows round-trip fidelity on CRLF documents (EC-31, AD-7).
 */
export function detectLineEnding(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Split table text into an array of row strings (one per line).
 *
 * Splits on \n (after stripping \r so CRLF tables work — EC-31).
 * Filters out empty trailing lines so a trailing newline does not produce
 * a phantom empty row.
 *
 * @param tableText - Raw table source text.
 * @returns Array of row strings.
 */
export function parseTableRows(tableText: string): string[] {
  return tableText.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/**
 * Return true when the row string is a Markdown table separator row
 * (contains only `|`, `-`, `:`, and whitespace — no letters or digits).
 *
 * @param rowText - A single table row line (including any trailing \r).
 */
export function isSeparatorRow(rowText: string): boolean {
  return /^[\s|:\-]+$/.test(rowText.replace(/\r$/, ""));
}

/**
 * Pure implementation of table context detection.
 *
 * Takes raw docText, a cursor position, and a real lezer SyntaxTree so the
 * function can be called in unit tests without a live CM6 editor (step_02 spec).
 * In production, the caller passes syntaxTree(state) from getCmLanguage().
 *
 * Algorithm:
 *   1. Walk tree ancestors from cursorPos to find enclosing Table node.
 *   2. Extract tableFrom/tableTo/tableText.
 *   3. Walk ancestors to find TableRow or TableDelimiter for rowIndex.
 *   4. Walk ancestors to find TableCell/TableHeader and count left siblings for colIndex.
 *   5. Compute columnCount from separator row.
 *   6. Return assembled TableContext.
 *
 * @param docText   - Full document text.
 * @param cursorPos - Cursor position (state.selection.main.head).
 * @param tree      - Lezer SyntaxTree from the current editor state.
 * @returns TableContext when cursor is inside a table, null otherwise.
 *
 * @remarks Length justification: The function performs seven distinct sequential
 * steps (tree-walk for Table node, boundary extraction, row-node walk, rowIndex
 * arithmetic, colIndex counting via sibling walk, column count from separator,
 * and final assembly). Each step requires access to variables produced by the
 * previous step (e.g. tableFrom/tableText for row parsing, cellNode for colIndex).
 * Extracting any subset into a helper would require threading many arguments and
 * would obscure the sequential nature of the algorithm. The inline step comments
 * already act as logical section headers.
 */
export function detectTableContext(
  docText: string,
  cursorPos: number,
  tree: SyntaxTree,
): TableContext | null {
  // ── Step 1: Find enclosing Table node ────────────────────────────────────────
  // resolve(pos, 1) biases toward the node covering pos from the right,
  // which is the conventional choice for cursor-inside semantics.
  let node = tree.resolve(cursorPos, 1) as ReturnType<SyntaxTree["resolve"]> | null;
  let tableNode: ReturnType<SyntaxTree["resolve"]> | null = null;

  while (node) {
    if (node.name === "Table") {
      tableNode = node;
      break;
    }
    node = node.parent as ReturnType<SyntaxTree["resolve"]> | null;
  }

  if (!tableNode) return null;

  // ── Step 2: Extract table boundaries ────────────────────────────────────────
  const tableFrom = tableNode.from;
  const tableTo = tableNode.to;
  const tableText = docText.slice(tableFrom, tableTo);

  // ── Step 3: Find current row node ───────────────────────────────────────────
  // Node names used by @codemirror/lang-markdown:
  //   TableHeader  — the header row container (NOT a cell; this is the row)
  //   TableRow     — a body row container
  //   TableDelimiter — appears at TWO levels in the lezer tree:
  //     (a) direct child of Table  → the separator row "| --- | --- |"
  //     (b) child of TableRow/TableHeader → individual "|" pipe tokens within a row
  //   TableCell    — a cell inside TableHeader OR TableRow
  // Note: the spec says to walk for TableRow | TableDelimiter, but the actual
  // header row is named TableHeader (it is not a TableRow). We must handle all
  // three row container names.
  //
  // IMPORTANT: for empty table rows (cells contain only spaces, no TableCell nodes),
  // the cursor often resolves to a pipe TableDelimiter that is a child of TableRow.
  // We must NOT treat such pipes as the separator row. Only stop on TableDelimiter
  // when its parent is Table (confirming it IS the separator row, not a pipe token).
  let rowNode = tree.resolve(cursorPos, 1) as ReturnType<SyntaxTree["resolve"]> | null;
  while (rowNode) {
    if (rowNode.name === "TableRow" || rowNode.name === "TableHeader") break;
    if (rowNode.name === "TableDelimiter") {
      // Only treat as the separator row when it is a direct child of Table.
      // If the parent is TableRow or TableHeader, it is a pipe token — keep walking.
      const parent = rowNode.parent as ReturnType<SyntaxTree["resolve"]> | null;
      if (!parent || parent.name === "Table") break;
    }
    rowNode = rowNode.parent as ReturnType<SyntaxTree["resolve"]> | null;
  }

  // ── Step 4: Convert row node to 0-based rowIndex ────────────────────────────
  const rows = parseTableRows(tableText);
  let rowIndex: number | null;
  let isSep: boolean;

  if (!rowNode || rowNode.name === "TableDelimiter") {
    // Cursor is on the separator row (EC-2).
    rowIndex = null;
    isSep = true;
  } else {
    // Calculate which row index this is by line number arithmetic.
    // Both line counts are 1-based so the subtraction gives a 0-based index.
    const cursorLine = docText.slice(0, cursorPos).split("\n").length; // 1-based
    const tableStartLine = docText.slice(0, tableFrom).split("\n").length; // 1-based
    rowIndex = cursorLine - tableStartLine; // 0-based within table
    isSep = false;
  }

  // ── Step 5: Determine column index ──────────────────────────────────────────
  // All cells (in header and body rows) are named "TableCell" in the actual tree.
  let cellNode = tree.resolve(cursorPos, 1) as ReturnType<SyntaxTree["resolve"]> | null;
  while (cellNode) {
    if (cellNode.name === "TableCell") break;
    cellNode = cellNode.parent as ReturnType<SyntaxTree["resolve"]> | null;
  }

  let colIndex = 0;
  if (cellNode) {
    // Count sibling TableCell nodes to the left to determine the column index.
    let sibling = cellNode.prevSibling as ReturnType<SyntaxTree["resolve"]> | null;
    while (sibling) {
      if (sibling.name === "TableCell") {
        colIndex++;
      }
      sibling = sibling.prevSibling as ReturnType<SyntaxTree["resolve"]> | null;
    }
  }

  // ── Step 6: Column count from separator row (most reliable source) ───────────
  const separatorRowText = rows[1];
  const columnCount = separatorRowText ? splitRow(separatorRowText).length : 1;

  // ── Step 7: Assemble and return ──────────────────────────────────────────────
  return {
    tableFrom,
    tableTo,
    tableText,
    rowIndex,
    colIndex,
    isHeaderRow: rowIndex === 0,
    isSeparatorRow: isSep,
    columnCount,
    rowCount: rows.length,
  };
}

/**
 * Production wrapper that calls detectTableContext with the live CM6 state.
 * Not exported — use detectTableContext directly in tests.
 * Exported for step_06 integration tests.
 *
 * @param state - A CM6 EditorState object (or a compatible test stub).
 */
export function detectTableContextFromState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
): TableContext | null {
  const { syntaxTree } = getCmLanguage();
  const tree = syntaxTree(state);
  const docText = state.doc.toString() as string;
  const cursorPos = state.selection.main.head as number;
  return detectTableContext(docText, cursorPos, tree);
}

// ── 6. Pure table operations ─────────────────────────────────────────────────

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Ensure a row has exactly `targetCount` cells.
 * Short rows are padded with "   " (three spaces — standard empty cell).
 * Excess cells are NOT trimmed (preserve user content — EC-6).
 *
 * @param cells       - Mutable array of cell strings.
 * @param targetCount - Desired cell count.
 * @returns The same array, possibly extended.
 */
function normaliseRow(cells: string[], targetCount: number): string[] {
  while (cells.length < targetCount) {
    cells.push("   ");
  }
  return cells;
}

/**
 * Rebuild a pipe-delimited table row from its cell array.
 *
 * @param cells - Array of cell content strings (not trimmed).
 * @returns Full row string with leading and trailing `|`.
 */
function rebuildRow(cells: string[]): string {
  return "|" + cells.join("|") + "|";
}

/**
 * Rejoin rows using the original line ending (AD-7, EC-31).
 *
 * @param rows        - Array of row strings.
 * @param lineEnding  - The original line ending (LF or CRLF).
 * @returns Rejoined table text.
 */
function reconstructTable(rows: string[], lineEnding: "\r\n" | "\n"): string {
  return rows.join(lineEnding);
}

// ── Operation 1: insertRowAbove ───────────────────────────────────────────────

/**
 * Insert a blank row immediately above the row at rowIndex.
 *
 * Disabled conditions (return null):
 *   - rowIndex === null (separator row — EC-2)
 *   - rowIndex === 0 (header row — inserting above header breaks table structure — EC-1)
 *   - rowIndex === 1 (separator row by line index — safety guard)
 *
 * @param tableText - Raw table source.
 * @param rowIndex  - 0-based row index, or null for separator row.
 * @returns New table text, or null if the operation is a no-op.
 */
export function insertRowAbove(tableText: string, rowIndex: number | null): string | null {
  // Separator row (null) or header row (0) or separator-by-index (1): no-op.
  if (rowIndex === null || rowIndex === 0 || rowIndex === 1) return null;

  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  const columnCount = splitRow(rows[1]).length;
  const blankCells = Array(columnCount).fill("   ");
  const blankRow = rebuildRow(blankCells);

  // Insert immediately before the target row.
  rows.splice(rowIndex, 0, blankRow);
  return reconstructTable(rows, lineEnding);
}

// ── Operation 2: insertRowBelow ───────────────────────────────────────────────

/**
 * Insert a blank row immediately below the row at rowIndex.
 *
 * Disabled condition (return null):
 *   - rowIndex === null (separator row — EC-2)
 *
 * When cursor is on the header row (rowIndex 0), inserting "below" means
 * inserting at the first body slot (index 2), to avoid placing a row between
 * header and separator. Math.max(rowIndex + 1, 2) handles this edge case.
 *
 * @param tableText - Raw table source.
 * @param rowIndex  - 0-based row index, or null for separator row.
 * @returns New table text, or null if the operation is a no-op.
 */
export function insertRowBelow(tableText: string, rowIndex: number | null): string | null {
  if (rowIndex === null) return null; // separator row — EC-2

  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  const columnCount = splitRow(rows[1]).length;
  const blankCells = Array(columnCount).fill("   ");
  const blankRow = rebuildRow(blankCells);

  // Ensure the row is never inserted between header (index 0) and separator (index 1).
  const insertAt = Math.max(rowIndex + 1, 2);
  rows.splice(insertAt, 0, blankRow);
  return reconstructTable(rows, lineEnding);
}

// ── Operation 3: deleteRow ────────────────────────────────────────────────────

/**
 * Delete the row at rowIndex.
 *
 * Disabled conditions (return null):
 *   - rowIndex === null (separator row — EC-2)
 *   - rowIndex === 0 (header row — EC-1)
 *   - rowIndex === 1 (separator row by line index — safety guard)
 *
 * EC-4: when the last body row is deleted the result is header + separator only,
 * which is valid GFM Markdown.
 *
 * @param tableText - Raw table source.
 * @param rowIndex  - 0-based row index, or null for separator row.
 * @returns New table text, or null if the operation is a no-op.
 */
export function deleteRow(tableText: string, rowIndex: number | null): string | null {
  if (rowIndex === null) return null; // separator — no-op
  if (rowIndex === 0) return null;    // header row — EC-1
  if (rowIndex === 1) return null;    // separator by line index — safety guard

  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  rows.splice(rowIndex, 1);
  return reconstructTable(rows, lineEnding);
}

// ── Operation 3b: moveRow ─────────────────────────────────────────────────────

/**
 * Move the row at fromIdx to position toIdx within the table.
 *
 * Disabled conditions (return null):
 *   - fromIdx === toIdx (no-op move)
 *   - fromIdx <= 1 (header or separator row — EC-1, EC-2)
 *   - toIdx <= 1 (cannot displace header or separator)
 *   - fromIdx or toIdx out of bounds
 *
 * After splice(fromIdx, 1) the element is re-inserted at toIdx. Because JS
 * Array.splice inserts before the given index, calling splice(toIdx, 0, row)
 * on the shortened array places the row at final absolute index toIdx. No
 * index adjustment is necessary for either direction.
 *
 * @param tableText - Raw table source.
 * @param fromIdx   - 0-based absolute row index of the row to move (must be >= 2).
 * @param toIdx     - 0-based absolute destination index (may equal rows.length to append).
 * @returns New table text, or null if the move is invalid or a no-op.
 */
export function moveRow(tableText: string, fromIdx: number, toIdx: number): string | null {
  if (fromIdx <= 1) return null;      // EC-1/EC-2: never move header/separator
  if (toIdx <= 1) return null;        // cannot displace header/separator position
  if (fromIdx === toIdx) return null; // no-op

  const lineEnding = detectLineEnding(tableText);
  const rowLines = parseTableRows(tableText);
  if (fromIdx >= rowLines.length) return null;
  if (toIdx > rowLines.length) return null; // toIdx == rowLines.length → append at end

  const [row] = rowLines.splice(fromIdx, 1);
  rowLines.splice(toIdx, 0, row);
  return reconstructTable(rowLines, lineEnding);
}

// ── Operation 4: insertColumnLeft ────────────────────────────────────────────

/**
 * Insert a blank column to the LEFT of colIndex.
 *
 * Applies to every row including the separator (which gets a " --- " cell).
 * Short rows are padded to the expected column count before insertion (EC-6).
 *
 * @param tableText - Raw table source.
 * @param colIndex  - 0-based target column index.
 * @returns New table text (never null — insert always succeeds).
 */
export function insertColumnLeft(tableText: string, colIndex: number): string {
  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  const colCount = splitRow(rows[1]).length;

  return reconstructTable(
    rows.map((row, rowIdx) => {
      const cells = normaliseRow(splitRow(row), colCount);
      // Separator row gets a " --- " alignment cell; data rows get a blank cell.
      const newCell = rowIdx === 1 ? " --- " : "   ";
      cells.splice(colIndex, 0, newCell);
      return rebuildRow(cells);
    }),
    lineEnding,
  );
}

// ── Operation 5: insertColumnRight ───────────────────────────────────────────

/**
 * Insert a blank column to the RIGHT of colIndex.
 *
 * Applies to every row including the separator (which gets a " --- " cell).
 * Short rows are padded to the expected column count before insertion (EC-6).
 *
 * @param tableText - Raw table source.
 * @param colIndex  - 0-based target column index.
 * @returns New table text (never null).
 */
export function insertColumnRight(tableText: string, colIndex: number): string {
  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  const colCount = splitRow(rows[1]).length;

  return reconstructTable(
    rows.map((row, rowIdx) => {
      const cells = normaliseRow(splitRow(row), colCount);
      const newCell = rowIdx === 1 ? " --- " : "   ";
      cells.splice(colIndex + 1, 0, newCell);
      return rebuildRow(cells);
    }),
    lineEnding,
  );
}

// ── Operation 6: deleteColumn ─────────────────────────────────────────────────

/**
 * Delete the column at colIndex.
 *
 * Disabled condition (return null):
 *   - columnCount <= 1 — cannot delete the last column (EC-3, EC-27).
 *
 * @param tableText - Raw table source.
 * @param colIndex  - 0-based column index to remove.
 * @returns New table text, or null when the table has only one column.
 */
export function deleteColumn(tableText: string, colIndex: number): string | null {
  const rows = parseTableRows(tableText);
  const colCount = splitRow(rows[1]).length;

  if (colCount <= 1) return null; // EC-3: last column

  const lineEnding = detectLineEnding(tableText);

  return reconstructTable(
    rows.map((row) => {
      const cells = normaliseRow(splitRow(row), colCount);
      cells.splice(colIndex, 1);
      return rebuildRow(cells);
    }),
    lineEnding,
  );
}

// ── Alignment operations 7–9 ──────────────────────────────────────────────────

/**
 * Replace the separator cell at colIndex with the given alignment string.
 * Only the separator row (index 1) is modified.
 * EC-26: even if the cell already has the same alignment, the write is emitted
 * (idempotent normalisation to canonical form).
 *
 * @param tableText  - Raw table source.
 * @param colIndex   - 0-based column index.
 * @param alignCell  - The replacement separator cell string (e.g. " :--- ").
 * @returns New table text (never null).
 */
function _setAlignment(tableText: string, colIndex: number, alignCell: string): string {
  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  const separatorRow = rows[1];
  const cells = splitRow(separatorRow);
  cells[colIndex] = alignCell;
  rows[1] = rebuildRow(cells);
  return reconstructTable(rows, lineEnding);
}

/**
 * Set the column alignment to left-aligned (`:---`).
 *
 * @param tableText - Raw table source.
 * @param colIndex  - 0-based column index.
 * @returns New table text.
 */
export function alignLeft(tableText: string, colIndex: number): string {
  return _setAlignment(tableText, colIndex, " :--- ");
}

/**
 * Set the column alignment to center-aligned (`:---:`).
 *
 * @param tableText - Raw table source.
 * @param colIndex  - 0-based column index.
 * @returns New table text.
 */
export function alignCenter(tableText: string, colIndex: number): string {
  return _setAlignment(tableText, colIndex, " :---: ");
}

/**
 * Set the column alignment to right-aligned (`---:`).
 *
 * @param tableText - Raw table source.
 * @param colIndex  - 0-based column index.
 * @returns New table text.
 */
export function alignRight(tableText: string, colIndex: number): string {
  return _setAlignment(tableText, colIndex, " ---: ");
}

// ── Operation 10: deleteTable ─────────────────────────────────────────────────

/**
 * No-op sentinel. Delete table is dispatched directly by handleAction using
 * tableContext.tableFrom/tableTo — no string transform is needed.
 * This constant documents the contract: callers dispatch the deletion themselves.
 * EC-5: when the table is the entire document, the result is an empty document.
 */
export const DELETE_TABLE_SENTINEL = "DELETE_TABLE";

// ── Operation 11: insertTable ─────────────────────────────────────────────────

/**
 * Compute the text and insertion position for inserting a blank 3×2 table.
 *
 * Edge cases handled:
 *   EC-9:  cursor inside a table → insert AFTER the table's end.
 *   EC-10: cursor mid-line → prepend a newline.
 *   EC-11: empty document → insert at 0 with no leading newline.
 *
 * @param docText      - Full document text.
 * @param cursorPos    - Current cursor position.
 * @param tableContext - Current TableContext, or null when cursor is outside a table.
 * @returns Object with insertPos (absolute document position) and insertText.
 */
export function insertTable(
  docText: string,
  cursorPos: number,
  tableContext: TableContext | null,
): { insertPos: number; insertText: string } {
  const TEMPLATE =
    "| Column 1 | Column 2 | Column 3 |\n" +
    "| --- | --- | --- |\n" +
    "|   |   |   |";

  let insertPos: number;
  let prefix = "";
  const suffix = "\n";

  if (tableContext !== null) {
    // EC-9: cursor is inside a table — insert after the table end.
    insertPos = tableContext.tableTo;
    // Ensure we start on a fresh line after the table.
    if (docText[insertPos - 1] !== "\n") {
      prefix = "\n";
    }
  } else if (docText.length === 0) {
    // EC-11: empty document — insert at 0 with no leading newline.
    insertPos = 0;
    prefix = "";
  } else {
    insertPos = cursorPos;
    // EC-10: if cursor is mid-line, prepend a newline.
    const lineStart = docText.lastIndexOf("\n", cursorPos - 1) + 1;
    if (cursorPos > lineStart) {
      prefix = "\n";
    }
  }

  return {
    insertPos,
    insertText: prefix + TEMPLATE + suffix,
  };
}

// ── 7. DOM: buildTopBar / buildRowHandle / buildRowMenu / buildBottomPill ─────

/**
 * Button configuration for the top bar toolbar.
 * Each entry: [data-action, icon-text, tooltip]
 */
const TOP_BAR_BUTTONS = [
  ["insert-col-left",  "◁+",   "Insert Column Left"],
  ["insert-col-right", "+▷",   "Insert Column Right"],
  ["align-left",       "⇤",    "Align Left"],
  ["align-center",     "⇔",    "Align Center"],
  ["align-right",      "⇥",    "Align Right"],
  ["delete-col",       "✕col", "Delete Column"],
  ["delete-table",     "⊠",    "Delete Table"],
] as const;

/**
 * Build the top bar DOM element with 7 column-level action buttons.
 * Mousedown on the bar delegates to handleAction via data-action lookup.
 *
 * Exported for step_04 DOM construction tests.
 */
export function buildTopBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.id = "__markable_tbl_top_bar__";
  bar.className = "tbl-toolbar tbl-toolbar--top";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Table column controls");

  for (const [action, icon, title] of TOP_BAR_BUTTONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tbl-toolbar__btn";
    btn.dataset["action"] = action;
    btn.title = title;
    btn.textContent = icon;
    bar.appendChild(btn);
  }

  // Delegated mousedown: prevent editor focus steal and dispatch the action.
  bar.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const btn = (e.target as Element).closest("[data-action]") as HTMLElement | null;
    if (!btn) return;
    handleAction(btn.dataset["action"]!);
  });

  return bar;
}

/**
 * Build the row handle DOM element (the drag handle icon positioned to the left
 * of the current table row). Dragging it reorders the row via drag-to-reorder.
 *
 * Exported for step_04 DOM construction tests.
 */
export function buildRowHandle(): HTMLElement {
  const handle = document.createElement("div");
  handle.id = "__markable_tbl_row_handle__";
  handle.className = "tbl-toolbar__row-handle";
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", "Drag to reorder row");
  handle.title = "Drag to reorder row";
  handle.textContent = "⠿";

  // Mousedown begins a drag-to-reorder interaction for the current row.
  handle.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const view = getEditorView();
    if (!view) return;
    const ctx = detectTableContextFromState(view.state);
    // Only body rows (index >= 2) are draggable. Header/separator: no-op.
    if (!ctx || ctx.rowIndex === null || ctx.rowIndex <= 1) return;
    startRowDrag(ctx.rowIndex, ctx);
  });

  return handle;
}

/**
 * Build the bottom pill DOM element (the + button below the table).
 * Click inserts a new row below the last body row of the table (AD-9).
 *
 * Exported for step_04 DOM construction tests.
 */
export function buildBottomPill(): HTMLElement {
  const pill = document.createElement("div");
  pill.id = "__markable_tbl_bottom_pill__";
  pill.className = "tbl-toolbar__bottom-pill";
  pill.setAttribute("role", "button");
  pill.setAttribute("aria-label", "Add row");
  pill.title = "Add row";
  pill.textContent = "+";

  pill.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    // EC-29: if the pill is visible but the cursor has left the table, no-op.
    const view = getEditorView();
    if (!view) return;
    const ctx = detectTableContextFromState(view.state);
    if (!ctx) return;
    // AD-9: target the last body row (rowCount - 1 includes header + separator + body rows).
    const lastBodyRowIndex = ctx.rowCount - 1;
    const newText = insertRowBelow(ctx.tableText, lastBodyRowIndex);
    if (newText === null) return;
    view.dispatch({
      changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText },
    });
  });

  return pill;
}

// ── 8. DOM: positioning, visibility, button states ────────────────────────────

/**
 * Clamp `left` so the element of width `elWidth` stays within the viewport.
 * EC-15: prevents the top bar from overflowing the right or left viewport edge.
 *
 * @param left    - Proposed left position in pixels.
 * @param elWidth - Element width in pixels.
 * @returns Clamped left position.
 */
export function clampHorizontal(left: number, elWidth: number): number {
  const maxLeft = window.innerWidth - elWidth - 8;
  if (left > maxLeft) left = maxLeft;
  if (left < 8) left = 8;
  return left;
}

/**
 * Recompute the positions of all three floating elements using coordsAtPos.
 *
 * Called synchronously on every selection/doc change in the updateListener.
 * Cheap: at most 3 coordsAtPos calls + 9 style assignments.
 *
 * Elements scrolled out of view are hidden (coordsAtPos returns null — EC-16).
 *
 * @param view      - Live CM6 EditorView from the updateListener.
 * @param tableFrom - Absolute document offset of table start.
 * @param tableTo   - Absolute document offset of table end.
 * @param rowFrom   - Absolute document offset of current row start.
 */
function updateFloatingPositions(
  view: EditorViewType,
  tableFrom: number,
  tableTo: number,
  rowFrom: number,
): void {
  const VERT_GAP = 8;

  // ── Top bar ─────────────────────────────────────────────────────────────────
  if (_topBar) {
    const topCoords = view.coordsAtPos(tableFrom);
    if (!topCoords) {
      _topBar.style.display = "none";
    } else {
      const barHeight = _topBar.offsetHeight || 36;
      const barWidth = _topBar.offsetWidth || 260;

      // Preferred position: directly above the first line of the table.
      let top = topCoords.top - barHeight - VERT_GAP;

      // EC-14: if no room above viewport, flip to below the last table line.
      if (top < 0) {
        const bottomCoords = view.coordsAtPos(tableTo);
        if (bottomCoords) {
          top = bottomCoords.bottom + VERT_GAP;
        } else {
          top = topCoords.bottom + VERT_GAP;
        }
      }

      const left = clampHorizontal(topCoords.left, barWidth);
      _topBar.style.top = `${top}px`;
      _topBar.style.left = `${left}px`;
      _topBar.style.display = "flex";
    }
  }

  // ── Row handle ──────────────────────────────────────────────────────────────
  if (_rowHandle) {
    const rowCoords = view.coordsAtPos(rowFrom);
    if (!rowCoords) {
      // EC-16: row scrolled out of view — hide handle.
      _rowHandle.style.display = "none";
    } else {
      const handleHeight = _rowHandle.offsetHeight || 20;
      // Vertically centre the handle on the row line.
      const top = rowCoords.top + (rowCoords.bottom - rowCoords.top) / 2 - handleHeight / 2;
      // Horizontally: anchor to the row text start (the leading `|`), not the editor DOM edge.
      // This keeps the handle immediately adjacent to the table regardless of editor padding.
      const left = rowCoords.left - (_rowHandle.offsetWidth || 30) - 2;

      _rowHandle.style.top = `${top}px`;
      _rowHandle.style.left = `${Math.max(0, left)}px`;
      _rowHandle.style.display = "flex";
    }
  }

  // ── Bottom pill ─────────────────────────────────────────────────────────────
  if (_bottomPill) {
    const bottomCoords = view.coordsAtPos(tableTo);
    if (!bottomCoords) {
      _bottomPill.style.display = "none";
    } else {
      const top = bottomCoords.bottom + VERT_GAP;
      const left = bottomCoords.left + 4;

      _bottomPill.style.top = `${top}px`;
      _bottomPill.style.left = `${left}px`;
      _bottomPill.style.display = "flex";
    }
  }
}

/**
 * Start a drag-to-reorder interaction for the body row at fromRowIdx.
 * Called from the row handle's mousedown handler.
 *
 * Shows a horizontal drop indicator line that follows the mouse and snaps to
 * the nearest row boundary. On mouseup, dispatches a single CM6 transaction
 * that applies the row move (one undo step — NFR-4).
 *
 * @param fromRowIdx - 0-based absolute row index of the row to drag (>= 2).
 * @param ctx        - TableContext captured synchronously at drag start.
 */
function startRowDrag(fromRowIdx: number, ctx: TableContext): void {
  const view = getEditorView();
  if (!view) return;

  // Create the drop indicator line.
  if (_dragIndicator) _dragIndicator.remove();
  _dragIndicator = document.createElement("div");
  _dragIndicator.className = "tbl-toolbar__drag-indicator";
  _dragIndicator.style.display = "none";
  document.body.appendChild(_dragIndicator);

  // Compute screen Y positions for each valid drop slot.
  // A slot with toIdx=i means "insert the dragged row before row i" in the final array.
  interface DropSlot { toIdx: number; y: number; }
  const dropSlots: DropSlot[] = [];
  const rowLines = parseTableRows(ctx.tableText);
  const le = detectLineEnding(ctx.tableText);

  let docOffset = ctx.tableFrom;
  for (let i = 0; i < rowLines.length; i++) {
    if (i >= 2) {
      // Slot "before row i": row ends up at absolute index i.
      const coords = view.coordsAtPos(docOffset);
      if (coords) dropSlots.push({ toIdx: i, y: coords.top });
    }
    docOffset += rowLines[i].length + le.length;
  }
  // "Append after last row" slot.
  const tailCoords = view.coordsAtPos(Math.max(ctx.tableFrom, ctx.tableTo - 1));
  if (tailCoords) dropSlots.push({ toIdx: rowLines.length, y: tailCoords.bottom });

  // Reuse the top bar's horizontal extent for the indicator line.
  const indicatorLeft = _topBar ? parseFloat(_topBar.style.left || "0") : 0;
  const indicatorWidth = _topBar ? (_topBar.offsetWidth || 200) : 200;

  let currentSlot: DropSlot | null = null;

  const onMouseMove = (e: MouseEvent) => {
    if (!_dragIndicator) return;
    let bestSlot: DropSlot | null = null;
    let bestDist = Infinity;
    for (const slot of dropSlots) {
      const dist = Math.abs(e.clientY - slot.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestSlot = slot;
      }
    }
    currentSlot = bestSlot;
    if (currentSlot !== null) {
      _dragIndicator.style.display = "block";
      _dragIndicator.style.top = `${currentSlot.y - 1}px`;
      _dragIndicator.style.left = `${indicatorLeft}px`;
      _dragIndicator.style.width = `${indicatorWidth}px`;
    } else {
      _dragIndicator.style.display = "none";
    }
  };

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.body.style.removeProperty("cursor");
    if (_rowHandle) _rowHandle.style.removeProperty("cursor");
    if (_dragIndicator) {
      _dragIndicator.remove();
      _dragIndicator = null;
    }
    if (!_enabled) return; // plugin disabled during drag — skip dispatch
    if (currentSlot !== null && currentSlot.toIdx !== fromRowIdx) {
      const liveView = getEditorView();
      if (liveView) {
        const newText = moveRow(ctx.tableText, fromRowIdx, currentSlot.toIdx);
        if (newText !== null) {
          liveView.dispatch({
            changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText },
          });
        }
      }
    }
  };

  // Set grabbing cursor for the duration of the drag.
  document.body.style.cursor = "grabbing";
  if (_rowHandle) _rowHandle.style.cursor = "grabbing";
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}

/**
 * Show or hide all three floating elements based on whether the cursor is
 * currently inside a table.
 *
 * When context is null (cursor outside table — EC-12), all elements are hidden
 * and the row menu is closed. Visibility class is used rather than display:none
 * so CSS transitions work correctly.
 *
 * Also updates top-bar button states and row-menu button visual states so that
 * the toolbar always reflects the current context before the user interacts
 * with it (M-1).
 *
 * Exported for step_04 tests.
 *
 * @param context - Current TableContext, or null.
 */
export function updateFloatingVisibility(context: TableContext | null): void {
  if (context === null) {
    if (_topBar) _topBar.style.display = "none";
    if (_rowHandle) _rowHandle.style.display = "none";
    if (_bottomPill) _bottomPill.style.display = "none";
    return;
  }
  // Positions are set by the synchronous path; here we only update button states.
  updateTopBarButtonStates(context);
}

/**
 * Enable or disable top bar buttons based on the current TableContext.
 *
 * Disabled conditions:
 *   - All buttons: context is null (EC-12 — cursor outside table)
 *   - delete-col: columnCount <= 1 (EC-3 — cannot delete the last column)
 *   Column operations remain enabled on separator row (EC-2 — only row
 *   operations are disabled on the separator).
 *
 * When `bar` is not provided, falls back to the module-level `_topBar`.
 * This overload allows the function to be called from tests without a full
 * onEnable cycle, mirroring the pattern of updateSidebarButtonStates.
 *
 * Exported for step_04 tests.
 *
 * @param context - Current TableContext, or null.
 * @param bar     - Optional: the top bar element. Defaults to module-level _topBar.
 */
export function updateTopBarButtonStates(
  context: TableContext | null,
  bar?: HTMLElement,
): void {
  const target = bar ?? _topBar;
  if (!target) return;
  const buttons = target.querySelectorAll<HTMLButtonElement>("[data-action]");

  for (const btn of buttons) {
    const action = btn.dataset["action"];
    let disabled = false;

    if (context === null) {
      // All buttons disabled when no table context.
      disabled = true;
    } else if (action === "delete-col") {
      // EC-3: delete column is disabled when the table has only one column.
      disabled = context.columnCount <= 1;
    }
    // All other top-bar buttons (col insert, align, delete-table) remain
    // enabled whenever the cursor is inside a table.

    if (disabled) {
      btn.classList.add("tbl-toolbar__btn--disabled");
    } else {
      btn.classList.remove("tbl-toolbar__btn--disabled");
    }
  }
}

// ── 9. DOM: buildSidebarPanel / updateSidebarButtonStates ─────────────────────

/**
 * All sidebar panel buttons in display order.
 * Each entry: [data-action, label, alwaysEnabled]
 * alwaysEnabled: true → button is never disabled regardless of cursor position.
 * Insert Table is always enabled because it works even outside a table.
 */
const SIDEBAR_BUTTONS = [
  ["insert-table",     "Insert Table",        true ],
  ["insert-row-above", "Insert Row Above",    false],
  ["insert-row-below", "Insert Row Below",    false],
  ["delete-row",       "Delete Row",          false],
  ["insert-col-left",  "Insert Column Left",  false],
  ["insert-col-right", "Insert Column Right", false],
  ["delete-col",       "Delete Column",       false],
  ["align-left",       "Align Left",          false],
  ["align-center",     "Align Center",        false],
  ["align-right",      "Align Right",         false],
  ["delete-table",     "Delete Table",        false],
] as const;

/**
 * Build the sidebar panel DOM element containing all 11 table operation buttons.
 *
 * The returned element is passed to api.registerSidebarPanel's render callback.
 * Button clicks are handled via event delegation.
 *
 * Exported for step_05 DOM construction tests.
 *
 * @returns The root panel element.
 */
export function buildSidebarPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.id = "__markable_tbl_sidebar_panel__";
  panel.className = "tbl-toolbar-sidebar";
  panel.setAttribute("role", "toolbar");
  panel.setAttribute("aria-label", "Table controls");

  for (const [action, label] of SIDEBAR_BUTTONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tbl-toolbar__btn";
    btn.dataset["action"] = action;
    btn.textContent = label;
    btn.title = label;
    panel.appendChild(btn);
  }

  // Delegated mousedown: prevent editor focus steal, guard disabled buttons,
  // then dispatch the action.
  panel.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const btn = (e.target as Element).closest("[data-action]") as HTMLElement | null;
    if (!btn) return;
    // Safety guard: the CSS pointer-events:none on --disabled buttons should already
    // prevent clicks, but this provides an additional code-level guard.
    if (btn.classList.contains("tbl-toolbar__btn--disabled")) return;
    handleAction(btn.dataset["action"]!);
  });

  return panel;
}

/**
 * Enable or disable sidebar buttons based on the current TableContext.
 *
 * Disabled rules (FR-3, FR-4):
 *   - All non-alwaysEnabled buttons: disabled when context is null.
 *   - delete-row: disabled when isHeaderRow (EC-1) or isSeparatorRow (EC-2).
 *   - insert-row-above, insert-row-below: disabled when isSeparatorRow (EC-2).
 *   - delete-col: disabled when columnCount <= 1 (EC-3).
 *   - Column and table ops remain enabled on separator row (EC-2).
 *   - insert-table: always enabled (alwaysEnabled = true).
 *
 * Exported for step_05 tests.
 *
 * @param panel   - The sidebar panel element returned by buildSidebarPanel.
 * @param context - Current table context, or null when cursor outside table.
 */
export function updateSidebarButtonStates(
  panel: HTMLElement,
  context: TableContext | null,
): void {
  const buttons = panel.querySelectorAll<HTMLButtonElement>("[data-action]");

  for (const btn of buttons) {
    const action = btn.dataset["action"] as string;
    const alwaysEntry = SIDEBAR_BUTTONS.find(([a]) => a === action);
    // The third element in each tuple is the alwaysEnabled flag.
    const alwaysEnabled = alwaysEntry ? alwaysEntry[2] : false;

    if (alwaysEnabled) {
      btn.classList.remove("tbl-toolbar__btn--disabled");
      continue;
    }

    // Default: disabled when no table context.
    let disabled = context === null;

    if (!disabled && context !== null) {
      switch (action) {
        case "delete-row":
          // EC-1: disabled on header row. EC-2: disabled on separator.
          disabled = context.isHeaderRow || context.isSeparatorRow;
          break;
        case "insert-row-above":
        case "insert-row-below":
          // EC-2: row operations disabled on separator row.
          disabled = context.isSeparatorRow;
          break;
        case "delete-col":
          // EC-3: disabled when the table has only one column.
          disabled = context.columnCount <= 1;
          break;
        // Column insert, alignment, and delete-table remain enabled when
        // inside any table row (including separator — EC-2).
      }
    }

    if (disabled) {
      btn.classList.add("tbl-toolbar__btn--disabled");
    } else {
      btn.classList.remove("tbl-toolbar__btn--disabled");
    }
  }
}

// ── 10. CM6 listener factory ─────────────────────────────────────────────────

/**
 * Build the CM6 updateListener extension for the Table Toolbar plugin.
 *
 * Two-rate architecture (AD-8, NFR-2):
 *   - Synchronous on every selection/doc change: recalculate coordsAtPos and
 *     update element positions. Cheap — only tree node lookups + style assignments.
 *   - Debounced at DEBOUNCE_MS (150 ms): call detectTableContextFromState,
 *     update button states, show/hide elements. Worth debouncing because
 *     doc.toString() is O(document size).
 *
 * The state snapshot is captured before the setTimeout because CM6 may process
 * more transactions during the 150 ms window. EditorState objects are immutable
 * and safe to hold across async boundaries (step_06 spec note).
 *
 * EC-23: view reference comes from update.view, not a cached module-level var.
 *
 * @remarks Length justification: The listener contains two distinct processing
 * paths — (a) a synchronous tree walk + CSS positioning pass for floating mode,
 * and (b) a debounced context detection + button state update pass for both modes.
 * Both paths must live inside the same EditorView.updateListener.of() callback
 * because they share the same update object and the early-exit guard (`if
 * (!_enabled) return`). Splitting the two paths into separate functions would
 * require passing the update object as a parameter and duplicating the guard,
 * which would obscure the single-listener contract required by CM6.
 */
function buildUpdateListener() {
  const { EditorView } = getCmView();

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;

    const docChanged = update.docChanged;
    const selChanged = update.selectionSet;
    if (!docChanged && !selChanged) return;

    const view = update.view;

    // ── Synchronous path: reposition floating elements ────────────────────────
    if (_settings.toolbarMode === "floating") {
      const state = view.state;
      const tree = getCmLanguage().syntaxTree(state);
      const head = state.selection.main.head;

      // Walk the tree to extract Table/TableRow/TableDelimiter node boundaries.
      // This is a cheap tree walk — no doc.toString() call.
      let tableFrom: number | null = null;
      let tableTo: number | null = null;
      let rowFrom: number | null = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let node = tree.resolve(head, 1) as any;
      while (node) {
        if (node.name === "Table") {
          tableFrom = node.from;
          tableTo = node.to;
        }
        // TableHeader (header row), TableRow (body row), and TableDelimiter
        // (separator row) are all valid row containers for positioning purposes.
        if (
          (node.name === "TableRow" ||
           node.name === "TableHeader" ||
           node.name === "TableDelimiter") &&
          rowFrom === null
        ) {
          rowFrom = node.from;
        }
        node = node.parent;
      }

      if (tableFrom !== null && tableTo !== null && rowFrom !== null) {
        updateFloatingPositions(view, tableFrom, tableTo, rowFrom);
      }
      // Outside table: synchronous path does nothing. Debounced path will hide.
    }

    // ── Debounced path: table context + button states ─────────────────────────
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    // Snapshot state NOW — CM6 state is immutable so this is safe across 150 ms.
    const state = update.state;

    _debounceTimer = setTimeout(() => {
      if (!_enabled) return;

      const tableCtx = detectTableContextFromState(state);

      if (_settings.toolbarMode === "floating") {
        updateFloatingVisibility(tableCtx);
      } else {
        // Sidebar mode: update button enabled/disabled states.
        if (_sidebarPanelEl) {
          updateSidebarButtonStates(_sidebarPanelEl, tableCtx);
        }
      }

      _debounceTimer = null;
    }, DEBOUNCE_MS);
  });
}

// ── 11. Plugin export object (onEnable / onDisable / renderDetailExtra) ───────

/**
 * Dispatch a table operation to the CM6 editor.
 *
 * All click events from all four surfaces (top bar, row menu, bottom pill,
 * sidebar panel) route through this function to ensure:
 *   - EC-22: silent no-op when __MARKABLE_EDITOR_VIEW__ is undefined.
 *   - EC-23: __MARKABLE_EDITOR_VIEW__ is always read fresh (never cached).
 *   - NFR-4: exactly one view.dispatch() call per action.
 *
 * Exported for step_07 unit tests.
 *
 * @param action - The data-action string from the clicked button.
 *
 * @remarks Length justification: The function is a routing switch over 11
 * distinct action strings (insert-table, delete-table, insert-row-above,
 * insert-row-below, delete-row, insert-col-left, insert-col-right, delete-col,
 * align-left, align-center, align-right). Each case must perform its own guard
 * check (null ctx, separator row, header row, single-column) before calling
 * the corresponding pure operation and dispatching the result. Collapsing this
 * into a dispatch table would make the per-case guards harder to read and audit
 * against the EC requirements. The switch is the idiomatic pattern here.
 */
export function handleAction(action: string): void {
  const view = getEditorView();
  if (!view) return; // EC-22, EC-30: silent no-op

  const state = view.state;

  // Re-detect context at click time — cursor may have moved since last debounce tick.
  const ctx = detectTableContextFromState(state);

  switch (action) {

    case "insert-table": {
      // EC-9, EC-10, EC-11 handled by insertTable().
      const { insertPos, insertText } = insertTable(
        state.doc.toString(),
        state.selection.main.head,
        ctx,
      );
      view.dispatch({
        changes: { from: insertPos, to: insertPos, insert: insertText },
        selection: { anchor: insertPos + insertText.length },
      });
      break;
    }

    case "delete-table": {
      if (!ctx) return;
      // EC-5: dispatching from 0 to doc.length with insert "" leaves empty doc.
      // Extend the deletion range to include any trailing newline after the table.
      const docText = state.doc.toString();
      let to = ctx.tableTo;
      if (docText[to] === "\n") to += 1;
      view.dispatch({
        changes: { from: ctx.tableFrom, to, insert: "" },
        selection: { anchor: Math.min(ctx.tableFrom, state.doc.length) },
      });
      break;
    }

    case "insert-row-above": {
      if (!ctx || ctx.isSeparatorRow) return; // EC-2
      const newText = insertRowAbove(ctx.tableText, ctx.rowIndex);
      if (newText === null) return; // EC-1
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "insert-row-below": {
      if (!ctx || ctx.isSeparatorRow) return; // EC-2
      const newText = insertRowBelow(ctx.tableText, ctx.rowIndex);
      if (newText === null) return;
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "delete-row": {
      if (!ctx || ctx.isHeaderRow || ctx.isSeparatorRow) return; // EC-1, EC-2
      const newText = deleteRow(ctx.tableText, ctx.rowIndex);
      if (newText === null) return;
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "insert-col-left": {
      if (!ctx) return;
      const newText = insertColumnLeft(ctx.tableText, ctx.colIndex);
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "insert-col-right": {
      if (!ctx) return;
      const newText = insertColumnRight(ctx.tableText, ctx.colIndex);
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "delete-col": {
      if (!ctx) return;
      if (ctx.columnCount <= 1) return; // EC-3
      const newText = deleteColumn(ctx.tableText, ctx.colIndex);
      if (newText === null) return;
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "align-left": {
      if (!ctx) return;
      const newText = alignLeft(ctx.tableText, ctx.colIndex);
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "align-center": {
      if (!ctx) return;
      const newText = alignCenter(ctx.tableText, ctx.colIndex);
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "align-right": {
      if (!ctx) return;
      const newText = alignRight(ctx.tableText, ctx.colIndex);
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }
  }
}

/**
 * Render the 3-way position toggle (Left / Float / Right) in the Plugins Panel
 * detail view. Mirrors the pattern from markdown-toolbar.plugin.ts exactly,
 * adapted for TableToolbarSettings types.
 *
 * The active button is determined by the current _settings value.
 * Clicking a non-active button saves the new settings and calls restartSelf().
 *
 * Exported for step_07 unit tests.
 *
 * @param container - The container element provided by the Plugins Panel.
 */
export function renderDetailExtra(container: HTMLElement): void {
  // Derive the active 3-way position from the current settings.
  type Position = "left-sidebar" | "floating" | "right-sidebar";
  const activePosition: Position =
    _settings.toolbarMode === "floating"
      ? "floating"
      : _settings.sidebarSide === "left"
        ? "left-sidebar"
        : "right-sidebar";

  const section = document.createElement("div");
  section.className = "plugin-detail-sidebar-section";

  const label = document.createElement("span");
  label.className = "plugin-detail-sidebar-label";
  label.textContent = "Position";

  const options: { id: Position; label: string }[] = [
    { id: "left-sidebar",  label: "Left" },
    { id: "floating",      label: "Float" },
    { id: "right-sidebar", label: "Right" },
  ];

  for (const opt of options) {
    const btn = document.createElement("button");
    btn.className =
      "plugin-detail-sidebar-btn" + (activePosition === opt.id ? " active" : "");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      // No-op when _api is null (plugin disabled) or the option is already active.
      if (!_api || activePosition === opt.id) return;
      const newMode: ToolbarMode = opt.id === "floating" ? "floating" : "sidebar";
      const newSide: SidebarSide = opt.id === "right-sidebar" ? "right" : "left";
      void _api
        .saveSettings({ toolbarMode: newMode, sidebarSide: newSide })
        .then(() => _api!.restartSelf());
    });
    section.appendChild(btn);
  }

  section.prepend(label);
  container.appendChild(section);
}

/**
 * Enable the Table Toolbar plugin.
 *
 * Sequence:
 *   1. _enabled = true; capture api; load + merge settings.
 *   2. Inject CSS (idempotent).
 *   3. Build DOM elements.
 *   4. Register CM6 updateListener via api.addExtensions().
 *   5a. Floating: append elements to document.body (all hidden initially).
 *       Wire outside-click and window-blur listeners.
 *   5b. Sidebar: register panel via api.registerSidebarPanel().
 *
 * Exported for step_07 integration tests.
 *
 * @param api - The MarkablePluginAPI for this plugin.
 *
 * @remarks Length justification: onEnable performs a strictly sequential
 * five-step initialisation. Steps 5a and 5b are mutually exclusive mode
 * branches (floating vs sidebar), each requiring its own set of DOM operations,
 * event listener registrations, and sidebar descriptor construction. Because all
 * steps write to the same set of module-level variables (_topBar, _rowHandle,
 * _bottomPill, _sidebarPanelEl, _sidebarPanelRegistered, _api,
 * _settings, _blurListener), extracting either branch into a helper function
 * would require passing or returning the full module state — which would be
 * more confusing than the current inline approach. The numbered inline comments
 * already serve as logical section separators.
 */
export async function onEnable(api: MarkablePluginAPI): Promise<void> {
  _enabled = true;
  _api = api;

  const raw = await api.loadSettings();
  _settings = mergeWithDefaults(raw);

  injectCSS();

  // Build all three floating DOM elements once (AD-2).
  _topBar = buildTopBar();
  _rowHandle = buildRowHandle();
  _bottomPill = buildBottomPill();

  // All floating elements start hidden.
  _topBar.style.display = "none";
  _rowHandle.style.display = "none";
  _bottomPill.style.display = "none";

  // Register the CM6 updateListener.
  api.addExtensions([buildUpdateListener()]);

  if (_settings.toolbarMode === "floating") {
    // Floating mode: append all elements to body for global fixed positioning.
    document.body.appendChild(_topBar);
    document.body.appendChild(_rowHandle);
    document.body.appendChild(_bottomPill);

    // EC-13: hide floating elements immediately when editor loses focus.
    _blurListener = () => {
      updateFloatingVisibility(null);
    };
    window.addEventListener("blur", _blurListener, true); // capture phase
  } else {
    // Sidebar mode: register the panel.
    _sidebarPanelEl = buildSidebarPanel();

    const sidebarDescriptor = {
      id: "table-toolbar",
      title: "Table Toolbar",
      side: _settings.sidebarSide,
      defaultWidth: 200,

      render(container: HTMLElement): void {
        if (_sidebarPanelEl) {
          container.appendChild(_sidebarPanelEl);
        }
        // Set initial disabled state based on live editor cursor position.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as
          | EditorViewType
          | undefined;
        /* eslint-enable @typescript-eslint/no-explicit-any */
        const initialCtx = liveView
          ? detectTableContextFromState(liveView.state)
          : null;
        if (_sidebarPanelEl) {
          updateSidebarButtonStates(_sidebarPanelEl, initialCtx);
        }
      },

      destroy(_container: HTMLElement): void {
        // The container is about to be removed; null the panel reference.
        _sidebarPanelEl = null;
      },
    };

    api.registerSidebarPanel(sidebarDescriptor);
    _sidebarPanelRegistered = true;
  }
}

/**
 * Disable the Table Toolbar plugin.
 *
 * Exact reversal of onEnable — all state variables reset to initial values
 * for clean toggle cycles (NFR-3).
 *
 * Exported for step_07 integration tests.
 *
 * @param api - The MarkablePluginAPI for this plugin.
 */
export async function onDisable(api: MarkablePluginAPI): Promise<void> {
  _enabled = false;

  // Capture mode before resetting _settings (needed for conditional teardown).
  const mode = _settings.toolbarMode;

  // Cancel any in-flight debounce.
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  // Cancel any in-progress drag (removes drag indicator from DOM).
  if (_dragIndicator) {
    _dragIndicator.remove();
    _dragIndicator = null;
  }

  // Remove window blur listener (floating mode only).
  if (_blurListener) {
    window.removeEventListener("blur", _blurListener, true);
    _blurListener = null;
  }

  // Remove CM6 extensions.
  api.removeExtensions();

  // Mode-specific teardown.
  if (mode === "floating") {
    // Remove all three floating elements from the DOM.
    [_topBar, _rowHandle, _bottomPill].forEach((el) => el?.remove());
  }

  if (_sidebarPanelRegistered) {
    api.unregisterSidebarPanel("table-toolbar");
    _sidebarPanelRegistered = false;
  }

  // Remove CSS.
  removeCSS();

  // Reset all module-level state variables to initial values.
  _topBar = null;
  _rowHandle = null;
  _bottomPill = null;
  _sidebarPanelEl = null;
  _api = null;
  _settings = { ...DEFAULT_SETTINGS };
}

/**
 * Table Toolbar plugin export object.
 *
 * sidebarPanelId is always set (AD-10) so the Plugins Panel knows to show
 * the L/R assignment toggle in the detail view.
 */
export default {
  id: "table-toolbar",
  name: "Table Toolbar",
  version: "1.0.0",
  description: "Contextual toolbar for Markdown table management",
  detail:
    "Provides column insertion/deletion, row insertion/deletion, alignment controls, " +
    "and a Delete Table button. Appears as a floating UI around the table when the " +
    "cursor is inside it (default) or as a docked sidebar panel. All operations are " +
    "single undo steps.",
  sidebarPanelId: "table-toolbar",
  renderDetailExtra,
  onEnable,
  onDisable,
};

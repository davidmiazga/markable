/**
 * List Style Switching — rewrites all markers in a list block to a target style.
 *
 * This module provides `switchListStyle()` which dispatches a single CM6
 * transaction to convert every marker in the block containing the cursor.
 * The pure transformation logic lives in `computeStyleSwitchChanges()` so
 * it can be unit-tested without a CM6 runtime.
 *
 * Engine functions are imported from `list-engine.ts` (never modified).
 *
 * Also exports `listStyleIndicator()` (Step 3) — a CM6 updateListener factory
 * that writes the inferred list style name into a status bar DOM element, and
 * `computeListStyleLabel()` — its pure, testable core.
 */

import { EditorView } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import {
  type ListStyle,
  detectListLine,
  findListBlockRange,
  inferListStyle,
  markerTypeForDepth,
  generateMarker,
} from "./list-engine";

// ----------------------------------------------------------------
// Public types
// ----------------------------------------------------------------

/**
 * Describes a single marker replacement within a list block.
 * `lineIndex` is the 0-based index in the document lines array.
 */
export interface MarkerChange {
  lineIndex: number;
  oldMarker: string;
  newMarker: string;
}

/**
 * Result of computing style-switch changes for a list block.
 * Contains all marker replacements plus the block boundaries.
 */
export interface StyleSwitchResult {
  changes: MarkerChange[];
  blockStart: number;
  blockEnd: number;
}

// ----------------------------------------------------------------
// Pure transformation logic (no CM6 dependency)
// ----------------------------------------------------------------

/**
 * Compute the marker replacements needed to switch a list block to a
 * target style.
 *
 * This is a pure function: it takes document lines as plain strings and
 * returns descriptors. The CM6-dependent `switchListStyle()` wrapper
 * calls this and maps the result to editor transactions.
 *
 * @param lines - Every line in the document, 0-indexed.
 * @param cursorLineIndex - 0-based index of the line under the cursor.
 * @param targetStyle - The list style to switch to.
 * @returns Marker change descriptors and block boundaries, or null if
 *          the cursor is not on a list line (EC-1, EC-16).
 */
export function computeStyleSwitchChanges(
  lines: string[],
  cursorLineIndex: number,
  targetStyle: ListStyle,
): StyleSwitchResult | null {
  // Bail early on empty documents or out-of-bounds cursor (EC-16)
  const block = findListBlockRange(lines, cursorLineIndex);
  if (!block) return null;

  const changes: MarkerChange[] = [];

  /*
   * Ordinal tracking: each depth maintains a running count that increments
   * for every list line at that depth. When we encounter a line at depth N,
   * we truncate the array to N+1 so all deeper counters are reset. This
   * ensures sub-lists restart numbering when the parent depth continues.
   */
  const ordinals: number[] = [];

  for (let i = block.start; i <= block.end; i++) {
    const info = detectListLine(lines[i]);

    // Comment lines and non-list lines inside the block are skipped (EC-6, EC-18)
    if (!info) continue;

    const depth = info.depth;

    // Truncate to reset deeper ordinals when returning to a shallower depth
    ordinals.length = depth + 1;
    if (ordinals[depth] === undefined) ordinals[depth] = 0;
    ordinals[depth]++;

    const markerType = markerTypeForDepth(targetStyle, depth);

    /*
     * For decimal-outline style, parentChain carries the ordinals of all
     * ancestor depths so that markers read "2.1.1." etc. For other styles
     * parentChain is undefined and ignored by generateMarker.
     */
    const parentChain =
      targetStyle === "decimal" ? ordinals.slice(0, depth) : undefined;

    const newMarker = generateMarker(markerType, ordinals[depth], parentChain);

    changes.push({
      lineIndex: i,
      oldMarker: info.marker,
      newMarker,
    });
  }

  // If every line in the block was a comment, there are no changes (EC-18 edge)
  if (changes.length === 0) return null;

  return { changes, blockStart: block.start, blockEnd: block.end };
}

// ----------------------------------------------------------------
// CM6 integration — dispatches a single transaction (NFR-1)
// ----------------------------------------------------------------

/**
 * Rewrite all list markers in the block containing the cursor to the
 * target style.
 *
 * Returns true if a rewrite was performed, false if the cursor is not
 * on a list line. Dispatches a single CM6 transaction so Cmd-Z undoes
 * the entire rewrite in one step (NFR-1).
 *
 * @param view - The CM6 EditorView instance.
 * @param targetStyle - One of the four supported list styles.
 */
export function switchListStyle(
  view: EditorView,
  targetStyle: ListStyle,
): boolean {
  const doc = view.state.doc;
  const cursorPos = view.state.selection.main.head;
  const cursorLine = doc.lineAt(cursorPos);
  const cursorLineIndex = cursorLine.number - 1; // convert 1-based to 0-based

  // Build the document lines array (same pattern as list-keybindings.ts)
  const lines: string[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    lines.push(doc.line(i).text);
  }

  const result = computeStyleSwitchChanges(lines, cursorLineIndex, targetStyle);
  if (!result) return false;

  /*
   * Store cursor's content offset before the transaction so we can restore
   * it after markers change width. "Content offset" is the distance from
   * the end of the marker to the cursor position on the cursor's own line.
   */
  const cursorInfo = detectListLine(cursorLine.text);
  let contentOffset = 0;
  if (cursorInfo) {
    const markerEnd =
      cursorLine.from + cursorInfo.indent.length + cursorInfo.marker.length;
    contentOffset = Math.max(0, cursorPos - markerEnd);
  }

  // Build CM6 change specs from the pure result
  const cmChanges = result.changes.map((change) => {
    const lineObj = doc.line(change.lineIndex + 1); // 1-based line number
    const info = detectListLine(lineObj.text)!;
    const markerFrom = lineObj.from + info.indent.length;
    const markerTo = markerFrom + info.marker.length;
    return { from: markerFrom, to: markerTo, insert: change.newMarker };
  });

  // Compute the new cursor position in post-change coordinates.
  // Changes on lines BEFORE the cursor shift all subsequent positions,
  // so we accumulate the length delta from preceding-line changes.
  const cursorChange = result.changes.find(
    (c) => c.lineIndex === cursorLineIndex,
  );
  let precedingDelta = 0;
  for (const change of result.changes) {
    if (change.lineIndex >= cursorLineIndex) break;
    const lineObj = doc.line(change.lineIndex + 1);
    const info = detectListLine(lineObj.text)!;
    precedingDelta += change.newMarker.length - info.marker.length;
  }
  let newCursorPos = cursorPos + precedingDelta;
  if (cursorChange && cursorInfo) {
    const newMarkerEnd =
      cursorLine.from +
      precedingDelta +
      cursorInfo.indent.length +
      cursorChange.newMarker.length;
    newCursorPos = newMarkerEnd + contentOffset;
    // Clamp to line end (accounting for preceding + local marker delta)
    const localDelta =
      cursorChange.newMarker.length - cursorInfo.marker.length;
    const lineEnd = cursorLine.to + precedingDelta + localDelta;
    if (newCursorPos > lineEnd) newCursorPos = lineEnd;
  }

  view.dispatch({
    changes: cmChanges,
    selection: { anchor: newCursorPos },
  });

  return true;
}

// ----------------------------------------------------------------
// Keybinding handlers — one per style (Step 2 will wire these into
// formatKeymap, but they are exported here for co-location with the
// core logic they depend on).
// ----------------------------------------------------------------

/**
 * Keybinding handler: switch current list block to alphanumeric style.
 * Bound to Ctrl-r. Returns false if cursor is not on a list line.
 */
export function switchToAlphanumeric(view: EditorView): boolean {
  return switchListStyle(view, "alphanumeric");
}

/**
 * Keybinding handler: switch current list block to decimal-outline style.
 * Bound to Ctrl-n. Returns false if cursor is not on a list line.
 */
export function switchToDecimal(view: EditorView): boolean {
  return switchListStyle(view, "decimal");
}

/**
 * Keybinding handler: switch current list block to steps style.
 * Bound to Ctrl-l. Returns false if cursor is not on a list line.
 */
export function switchToSteps(view: EditorView): boolean {
  return switchListStyle(view, "steps");
}

/**
 * Keybinding handler: switch current list block to standard style.
 * Accessible via Format > List Style > Standard menu item.
 * Returns false if cursor is not on a list line.
 */
export function switchToStandard(view: EditorView): boolean {
  return switchListStyle(view, "standard");
}

// ----------------------------------------------------------------
// Status bar indicator — pure logic (Step 3)
// ----------------------------------------------------------------

/**
 * Human-readable display names for each list style.
 * Used by the status bar indicator (FR-3.1).
 */
const DISPLAY_NAMES: Record<ListStyle, string> = {
  standard: "Standard",
  alphanumeric: "Alphanumeric",
  decimal: "Decimal",
  steps: "Steps",
};

/**
 * Compute the status bar label for the list style at a given cursor position.
 *
 * This is a pure function with no CM6 or DOM dependency, making it fully
 * testable in isolation. The CM6 wrapper `listStyleIndicator()` calls this
 * and writes the result into the status bar DOM element.
 *
 * @param lines          - Every line in the document, 0-indexed.
 * @param cursorLineIndex - 0-based index of the line under the cursor.
 * @param fallbackStyle  - The fallback style from settings, used when
 *                          `inferListStyle` cannot determine the style
 *                          from markers or comment overrides alone.
 * @returns The display name (e.g. "Standard", "Steps") if the cursor is
 *          inside a list block, or an empty string if not.
 */
export function computeListStyleLabel(
  lines: string[],
  cursorLineIndex: number,
  fallbackStyle: ListStyle,
): string {
  // Bail early on empty documents or out-of-bounds cursor (EC-16)
  const block = findListBlockRange(lines, cursorLineIndex);
  if (!block) return "";

  // Extract the block lines for style inference
  const blockLines = lines.slice(block.start, block.end + 1);

  // The preceding line (if any) may contain a comment override (EC-12)
  const precedingLine = block.start > 0 ? lines[block.start - 1] : null;

  const style = inferListStyle(blockLines, precedingLine, fallbackStyle);
  return DISPLAY_NAMES[style];
}

// ----------------------------------------------------------------
// Status bar indicator — CM6 updateListener wrapper (Step 3)
// ----------------------------------------------------------------

/**
 * Menu items for the list style dropdown popup. Each entry maps a style
 * to its display label and keybinding hint (shown right-aligned in the menu).
 */
const STYLE_MENU_ITEMS: { style: ListStyle; label: string; shortcut: string }[] = [
  { style: "standard",    label: "Standard",                shortcut: "" },
  { style: "alphanumeric", label: "Alphanumeric (I. A. 1.)", shortcut: "^R" },
  { style: "decimal",     label: "Decimal (1.1.)",           shortcut: "^N" },
  { style: "steps",       label: "Steps (1. a. -)",          shortcut: "^L" },
];

/** CSS for the list style status bar indicator and its dropdown popup. */
const LIST_INDICATOR_CSS = `
  .list-style-indicator {
    cursor: pointer;
    padding: 0 6px;
    border-radius: 3px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 11px;
    line-height: 20px;
    white-space: nowrap;
    color: var(--text-secondary);
    transition: background-color 0.15s;
  }
  .list-style-indicator:hover {
    background-color: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }
  .list-style-indicator:empty { display: none; }

  .list-style-popup {
    position: fixed;
    background: var(--bg-secondary, #2a2a2a);
    border: 1px solid var(--border-color, #444);
    border-radius: 6px;
    padding: 4px 0;
    min-width: 220px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 9999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 12px;
    color: var(--text-primary, #eee);
  }
  .list-style-popup-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 12px;
    cursor: pointer;
    border-radius: 0;
  }
  .list-style-popup-item:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .list-style-popup-item.active {
    color: var(--accent-color, #5ba0d0);
  }
  .list-style-popup-shortcut {
    color: var(--text-secondary, #888);
    font-size: 11px;
    margin-left: 24px;
  }
`;

const LIST_INDICATOR_STYLE_ID = "__markable_list_indicator_css__";

/** Inject the indicator CSS once. */
function injectIndicatorCSS(): void {
  if (document.getElementById(LIST_INDICATOR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = LIST_INDICATOR_STYLE_ID;
  style.textContent = LIST_INDICATOR_CSS;
  document.head.appendChild(style);
}

/** Remove the indicator CSS. */
function removeIndicatorCSS(): void {
  document.getElementById(LIST_INDICATOR_STYLE_ID)?.remove();
}

/**
 * Create the clickable status bar indicator element and its dropdown popup.
 *
 * The indicator shows the current list style name (e.g. "Alphanumeric").
 * Clicking it opens a popup menu with all 4 styles + keybinding hints.
 * Selecting a style calls `switchListStyle` on the current editor view.
 *
 * @param getView - Callback returning the current EditorView (for dispatching).
 */
export function createListStyleIndicator(
  getView: () => EditorView | null,
): HTMLElement {
  injectIndicatorCSS();

  const el = document.createElement("span");
  el.className = "list-style-indicator";

  let popup: HTMLElement | null = null;

  function closePopup(): void {
    if (popup) {
      popup.remove();
      popup = null;
      document.removeEventListener("mousedown", onOutsideClick);
    }
  }

  function onOutsideClick(e: MouseEvent): void {
    if (popup && !popup.contains(e.target as Node) && e.target !== el) {
      closePopup();
    }
  }

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popup) { closePopup(); return; }

    const currentLabel = el.textContent || "";
    popup = document.createElement("div");
    popup.className = "list-style-popup";

    for (const item of STYLE_MENU_ITEMS) {
      const row = document.createElement("div");
      row.className = "list-style-popup-item";
      if (DISPLAY_NAMES[item.style] === currentLabel) {
        row.classList.add("active");
      }

      const labelSpan = document.createElement("span");
      labelSpan.textContent = item.label;
      row.appendChild(labelSpan);

      if (item.shortcut) {
        const shortcutSpan = document.createElement("span");
        shortcutSpan.className = "list-style-popup-shortcut";
        shortcutSpan.textContent = item.shortcut;
        row.appendChild(shortcutSpan);
      }

      row.addEventListener("click", () => {
        closePopup();
        const view = getView();
        if (view) {
          switchListStyle(view, item.style);
          view.focus();
        }
      });

      popup.appendChild(row);
    }

    // Position above the indicator
    const rect = el.getBoundingClientRect();
    popup.style.left = `${rect.left}px`;
    popup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    document.body.appendChild(popup);

    // Clamp if popup overflows left edge
    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth - 8) {
      popup.style.left = `${window.innerWidth - popupRect.width - 8}px`;
    }

    document.addEventListener("mousedown", onOutsideClick);
  });

  return el;
}

/** Remove indicator CSS on cleanup. */
export function cleanupListStyleIndicator(): void {
  removeIndicatorCSS();
}

/**
 * Create a CM6 updateListener that writes the inferred list style name
 * to the provided DOM element. Clears the element when the cursor is not
 * inside a list block.
 *
 * The listener fires only on meaningful events (docChanged or selectionSet)
 * to avoid unnecessary work on cursor blinks or focus changes (NFR-4).
 *
 * @param targetEl      - The status bar zone element to write text into.
 * @param getFallback   - A callback that returns the current fallback
 *                         list style from settings. Passed as a callback
 *                         (not a direct value) so the listener always reads
 *                         the latest persisted setting without capturing
 *                         a stale snapshot.
 */
export function listStyleIndicator(
  targetEl: HTMLElement,
  getFallback: () => ListStyle,
): ReturnType<typeof EditorView.updateListener.of> {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    // NFR-4: bail early on non-semantic updates (cursor blink, focus, etc.)
    if (!update.docChanged && !update.selectionSet) return;

    const state = update.state;
    const cursorLine = state.doc.lineAt(state.selection.main.head);
    const lineIndex = cursorLine.number - 1; // convert 1-based CM6 to 0-based

    // Build the full lines array from the document. This is O(n) in document
    // size but acceptable for typical Markdown files (see step_03 spec,
    // "Performance (NFR-4)" section for rationale).
    const lines: string[] = [];
    for (let i = 1; i <= state.doc.lines; i++) {
      lines.push(state.doc.line(i).text);
    }

    const label = computeListStyleLabel(lines, lineIndex, getFallback());
    targetEl.textContent = label;
  });
}

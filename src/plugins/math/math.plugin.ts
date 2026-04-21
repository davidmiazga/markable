/**
 * Math LaTeX Rendering Plugin — IIFE entry point (FC2 #8).
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/math.js
 *
 * Renders inline $...$ and display $$...$$ LaTeX expressions using KaTeX.
 * Implements the Typora-style live preview contract: raw LaTeX is hidden when
 * the cursor is away from an expression and shown when the cursor enters it.
 *
 * Architecture: docs/specs/math/00_index.md
 *
 * IIFE self-containment rules (see docs/specs/math/step_05_plugin_scaffold.md):
 *   - KaTeX is bundled into the IIFE (not external). Only @codemirror/* is external.
 *   - katex-css.ts is a pre-generated module exporting base64-inlined font CSS.
 *   - No app-internal module imports at runtime.
 *   - CM6 accessed via window.__CM_STATE__ and window.__CM_VIEW__ globals.
 *   - CSS injected via <style> tags in onEnable, removed in onDisable.
 *   - Plugin exports `export default` a UnifiedPlugin object.
 */

import katex from "katex";
import { KATEX_CSS } from "./katex-css";

// Type-only imports — erased at compile time, safe in IIFE context.
import type { DecorationSet, WidgetType as WidgetTypeClass } from "@codemirror/view";
import type { Transaction, EditorState } from "@codemirror/state";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── CM6 globals access ────────────────────────────────────────────────────────
//
// All @codemirror/* runtime values come from window globals set by cm-globals.ts
// (main.ts import). This prevents per-plugin copies of CM6 that would create
// separate StateField slot-ID namespaces, making extensions invisible to the editor.
//
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
  RangeSetBuilder,
} = (window as any).__CM_STATE__ as typeof import("@codemirror/state");
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single math expression found in the document.
 *
 * `from` and `to` are character offsets into the original document string,
 * matching the values CM6's `doc.toString()` produces (LF-only line endings).
 *
 * `from` is the index of the opening `$` (or first `$` of `$$`).
 * `to`   is the index AFTER the closing `$` (or after the second `$` of closing `$$`).
 * This matches CM6's exclusive-end convention for decoration ranges.
 *
 * `latex` is the content between the delimiters, with leading/trailing whitespace
 * preserved (KaTeX handles it gracefully; trimming is the renderer's concern).
 *
 * `display` is true for `$$...$$` blocks, false for `$...$` inline.
 */
export interface MathRange {
  from: number;
  to: number;
  latex: string;
  display: boolean;
}

// ── Math Scanner ──────────────────────────────────────────────────────────────

/**
 * Scan the entire document string and return all valid math ranges.
 *
 * This is a pure function with zero side effects and no dependencies on the
 * DOM or CM6 globals. It is exported so tests can call it directly.
 *
 * Algorithm (four phases):
 *   Phase 1 — Mark code regions (fenced blocks, inline code spans) as excluded.
 *   Phase 2 — Find block math ($$...$$) in excluded-aware line scan.
 *   Phase 3 — Find inline math ($...$) in excluded-aware character scan.
 *   Phase 4 — Sort all found ranges by `from` and return.
 *
 * Time complexity: O(N) where N is document length. Acceptable for notes
 * use case (<10,000 lines). No incremental optimization is applied.
 *
 * @param text - The full document as a string (LF line endings, as from CM6's doc.toString()).
 * @returns    - Array of MathRange objects sorted ascending by `from`.
 */
export function scanMathRanges(text: string): MathRange[] {
  if (text.length === 0) return [];

  const len = text.length;

  // ── Phase 1: Mark excluded regions ────────────────────────────────────────
  //
  // Build a boolean mask. `excluded[i] === true` means position i is inside a
  // code region and must not be treated as a math delimiter.

  const excluded = new Uint8Array(len); // 0 = normal, 1 = excluded

  /**
   * Mark all positions in the half-open range [start, end) as excluded.
   * Clamps to valid document bounds to avoid out-of-range writes.
   *
   * @param start - First position to mark (inclusive).
   * @param end   - Position after the last one to mark (exclusive).
   */
  function markExcluded(start: number, end: number): void {
    const s = Math.max(0, start);
    const e = Math.min(len, end);
    for (let i = s; i < e; i++) excluded[i] = 1;
  }

  // Mark fenced code blocks — both backtick (```) and tilde (~~~) variants.
  // A fence opener is a line whose trimmed content starts with 3+ backticks
  // or 3+ tildes. The mark covers from the opener's first fence char through
  // the closer's last fence char (inclusive both lines).
  //
  // CommonMark rule: nesting not supported. An opener that finds no closer
  // masks to the end of the document.

  for (const fenceChar of ["`", "~"]) {
    let searchFrom = 0;
    while (searchFrom < len) {
      // Find the next potential fence opener — a line beginning with 3+ fenceChars
      const openerLineStart = searchFrom;

      // Walk to the start of the next line beginning
      let lineStart = openerLineStart;
      while (lineStart < len) {
        // Skip optional leading spaces (up to 3 per CommonMark, but we allow
        // any leading whitespace for robustness).
        let col = lineStart;
        while (col < len && (text[col] === " " || text[col] === "\t")) col++;

        // Count consecutive fence characters
        let fenceLen = 0;
        while (col + fenceLen < len && text[col + fenceLen] === fenceChar) fenceLen++;

        if (fenceLen >= 3) {
          // This is a fence opener (or closer). Record the position of the first fence char.
          const openerFenceStart = col;

          // Find where this line ends (exclude the \n itself from the search below)
          let lineEnd = col + fenceLen;
          while (lineEnd < len && text[lineEnd] !== "\n") lineEnd++;
          // lineEnd is now the \n position or end of document

          // Search for the matching closer: a line with exactly the same fence character
          // (3+ of them) and nothing else (after optional leading whitespace).
          let closerStart = lineEnd + 1; // Start of the line after the opener
          let found = false;

          while (closerStart <= len) {
            // Find end of this candidate closer line
            let candCol = closerStart;
            while (candCol < len && (text[candCol] === " " || text[candCol] === "\t")) candCol++;

            let closerFenceLen = 0;
            while (candCol + closerFenceLen < len && text[candCol + closerFenceLen] === fenceChar) {
              closerFenceLen++;
            }

            // The closer line's content after the fence characters must be empty (or whitespace)
            let afterFence = candCol + closerFenceLen;
            while (afterFence < len && text[afterFence] === " ") afterFence++;

            if (
              closerFenceLen >= 3 &&
              (afterFence >= len || text[afterFence] === "\n")
            ) {
              // Found a valid closer. The excluded region spans from openerFenceStart
              // through the end of the closer line (the last fence char).
              const closerFenceEnd = candCol + closerFenceLen; // exclusive
              markExcluded(openerFenceStart, closerFenceEnd);
              // Advance outer search past this closer line
              searchFrom = closerFenceEnd + 1;
              found = true;
              break;
            }

            // Advance to next line
            let nextLine = closerStart;
            while (nextLine < len && text[nextLine] !== "\n") nextLine++;
            if (nextLine >= len) break;
            closerStart = nextLine + 1;
          }

          if (!found) {
            // Unclosed fence — mask from opener fence start to end of document
            markExcluded(openerFenceStart, len);
            searchFrom = len; // Stop searching for more fences of this type
          }

          // Advance outer position: if lineStart didn't move, searchFrom already passed it.
          // Setting lineStart = searchFrom and continuing prevents the outer-while from
          // spinning at the same position after the inner fence-search loop updates searchFrom.
          lineStart = searchFrom;
          continue;
        }

        // Not a fence line — advance to the next line
        let nextLine = lineStart;
        while (nextLine < len && text[nextLine] !== "\n") nextLine++;
        lineStart = nextLine < len ? nextLine + 1 : len;
      }

      // If we didn't advance searchFrom in this iteration, advance by one line to avoid loop
      if (lineStart <= searchFrom) break;
      searchFrom = lineStart;
    }
  }

  // Mark inline code spans — backtick runs outside already-excluded regions.
  // A run of N backticks opens a code span; it closes at the next run of exactly N backticks.
  // Unclosed spans are NOT marked (unclosed inline code is treated as literal text).

  let ci = 0;
  while (ci < len) {
    if (excluded[ci]) { ci++; continue; }
    if (text[ci] !== "`") { ci++; continue; }

    // Count the length of this backtick run
    const runStart = ci;
    let runLen = 0;
    while (ci + runLen < len && text[ci + runLen] === "`") runLen++;
    const openEnd = ci + runLen;

    // Search forward for a matching closer (exactly runLen backticks)
    let searchPos = openEnd;
    let foundClose = false;
    while (searchPos < len) {
      if (excluded[searchPos]) { searchPos++; continue; }
      if (text[searchPos] !== "`") { searchPos++; continue; }

      // Count this backtick run
      let closeLen = 0;
      while (searchPos + closeLen < len && text[searchPos + closeLen] === "`") closeLen++;

      if (closeLen === runLen) {
        // Matching closer found — mark the entire span as excluded
        markExcluded(runStart, searchPos + closeLen);
        ci = searchPos + closeLen;
        foundClose = true;
        break;
      } else {
        // Wrong length backtick run — skip past it and continue
        searchPos += closeLen;
      }
    }

    if (!foundClose) {
      // No matching closer — skip past the opener run (do not mark as excluded)
      ci = openEnd;
    }
  }

  // ── Phase 2: Find block math ($$...$$) ────────────────────────────────────
  //
  // Walk line by line. A valid block-open delimiter is a line whose trimmed
  // content is exactly "$$" with neither character in an excluded region.
  // The block content is everything between the newline after the opener and
  // the newline before the closer. A block with no matching closer produces
  // no MathRange.

  const results: MathRange[] = [];

  // Build an array of line start positions for quick line iteration
  const lineStarts: number[] = [0];
  for (let i = 0; i < len; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  const lineCount = lineStarts.length;

  /**
   * Return the trimmed content of line `lineIdx` (without the trailing \n).
   */
  // @ts-ignore TS6133: retained for future use
  function getLineTrimmed(lineIdx: number): string {
    const start = lineStarts[lineIdx];
    const end = lineIdx + 1 < lineCount ? lineStarts[lineIdx + 1] - 1 : len;
    return text.slice(start, end).trimEnd();
  }

  /**
   * Return true if the line at `lineIdx` is a valid `$$` delimiter:
   *   - Trimmed content is exactly "$$"
   *   - Neither `$` character is in an excluded region
   *
   * Permits any leading whitespace before $$ — more permissive than CommonMark's
   * 3-space indent limit, but avoids false negatives for indented lists or nested
   * block structures where the user may indent their math delimiters.
   */
  function isBlockDelimiterLine(lineIdx: number): boolean {
    const lineStart = lineStarts[lineIdx];
    // Find where the content starts (skip leading whitespace)
    let col = lineStart;
    while (col < len && (text[col] === " " || text[col] === "\t")) col++;

    // Check for exactly "$$" with nothing else on the line
    if (col + 1 >= len) return false; // Not enough chars
    if (text[col] !== "$" || text[col + 1] !== "$") return false;

    // Check that after the $$ comes either end-of-line or end-of-doc
    const afterDollar = col + 2;
    if (afterDollar < len && text[afterDollar] !== "\n") return false;

    // Neither $ can be excluded
    if (excluded[col] || excluded[col + 1]) return false;

    return true;
  }

  let lineIdx = 0;
  while (lineIdx < lineCount) {
    if (!isBlockDelimiterLine(lineIdx)) {
      lineIdx++;
      continue;
    }

    // Found an opener. Record the position of the first $ on this line.
    const openerLineStart = lineStarts[lineIdx];
    let openerCol = openerLineStart;
    while (openerCol < len && (text[openerCol] === " " || text[openerCol] === "\t")) openerCol++;
    const blockFrom = openerCol; // index of first $ on opener line

    // Search subsequent lines for the matching closer
    let contentStart = lineIdx + 1 < lineCount ? lineStarts[lineIdx + 1] : len;
    let closerLineIdx = lineIdx + 1;
    let foundCloser = false;

    while (closerLineIdx < lineCount) {
      if (isBlockDelimiterLine(closerLineIdx)) {
        // Found the closer. Compute to = position after the second $ of closing line.
        const closerLineStart = lineStarts[closerLineIdx];
        let closerCol = closerLineStart;
        while (closerCol < len && (text[closerCol] === " " || text[closerCol] === "\t")) closerCol++;
        const blockTo = closerCol + 2; // exclusive: just past the second $

        // latex is the text between the opener line's \n and the closer line
        // (the content between the two delimiter lines).
        // contentStart = first char of the line after the opener
        // closerLineStart = first char of the closer line
        const latex = text.slice(contentStart, closerLineStart);

        results.push({ from: blockFrom, to: blockTo, display: true, latex });

        // Mark the entire block range as excluded so Phase 3 doesn't process it
        markExcluded(blockFrom, blockTo);

        // Advance past the closer line
        lineIdx = closerLineIdx + 1;
        foundCloser = true;
        break;
      }
      closerLineIdx++;
    }

    if (!foundCloser) {
      // No closing delimiter — EC-19: produce no range, skip to next line
      lineIdx++;
    }
  }

  // ── Phase 3: Find inline math ($...$) ─────────────────────────────────────
  //
  // Walk character by character. At each non-excluded `$`:
  //   - Skip if preceded by `\` (escaped dollar — EC-13)
  //   - Skip if the next char is also `$` (to avoid treating `$$` as inline openers)
  //   - Search forward on the SAME LINE ONLY for the matching closing `$`
  //   - Require non-empty content (EC-6)

  let i = 0;
  while (i < len) {
    if (excluded[i] || text[i] !== "$") { i++; continue; }

    // Check for escaped dollar: `\$`
    if (i > 0 && text[i - 1] === "\\") { i++; continue; }

    // Check if the next character is also `$` — this is the start of `$$`
    // which is either a block delimiter (already handled in Phase 2) or
    // an adjacent pair that should not open inline math (EC-6, EC-17).
    if (i + 1 < len && text[i + 1] === "$") {
      // Skip both dollar signs to prevent partial inline matching
      i += 2;
      continue;
    }

    // This is a potential inline opener. Search forward on the same line only.
    const openPos = i;
    let j = i + 1;

    // Find the end of this line
    let lineEndPos = j;
    while (lineEndPos < len && text[lineEndPos] !== "\n") lineEndPos++;

    // Search within [j, lineEndPos) for the closing `$`
    let foundClose = false;
    while (j < lineEndPos) {
      if (excluded[j]) { j++; continue; }
      if (text[j] !== "$") { j++; continue; }

      // Potential closing $: check if escaped
      if (text[j - 1] === "\\") { j++; continue; }

      // Check if the closing $ is the start of a $$ pair
      // (do not close inline with `$$`)
      if (j + 1 < len && text[j + 1] === "$") { j += 2; continue; }

      // Valid closing $ found. Content is text[openPos+1 .. j).
      const latex = text.slice(openPos + 1, j);

      // Require non-empty content (EC-6)
      if (latex.length > 0) {
        const inlineFrom = openPos;
        const inlineTo = j + 1; // exclusive: past the closing $
        results.push({ from: inlineFrom, to: inlineTo, display: false, latex });
        markExcluded(inlineFrom, inlineTo);
        i = inlineTo;
        foundClose = true;
      }
      // If empty content ($$), do not register — skip past the closing $
      break;
    }

    if (!foundClose) {
      // No closing $ on this line — advance past this opener
      i++;
    }
  }

  // ── Phase 4: Sort and return ───────────────────────────────────────────────
  //
  // Ranges must be in ascending order of `from` for RangeSetBuilder (CM6 requirement).
  // Block math is found by line order so it is already sorted. Inline math is also
  // found in document order. Sorting is a safety net for any edge case.

  results.sort((a, b) => a.from - b.from);
  return results;
}

// ── CSS injection helpers ─────────────────────────────────────────────────────

/** Style tag id for the KaTeX CSS (with base64-inlined fonts). */
const CSS_ELEMENT_ID = "__markable_math_css__";

/**
 * Inject KaTeX CSS (with base64-encoded woff2 fonts) into document <head>.
 *
 * Idempotent: guarded by element id so repeated calls (e.g. after plugin
 * re-enable) do not create duplicate style tags (EC-23).
 */
export function injectCSS(): void {
  if (document.getElementById(CSS_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ELEMENT_ID;
  style.textContent = KATEX_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the injected KaTeX CSS style tag.
 *
 * Called from onDisable (EC-23). Safe to call when the tag does not exist
 * — the optional chaining on `?.remove()` prevents errors.
 */
export function removeCSS(): void {
  document.getElementById(CSS_ELEMENT_ID)?.remove();
}

/** Style tag id for the plugin-specific UI CSS (widget layout, error colors). */
const PLUGIN_CSS_ELEMENT_ID = "__markable_math_plugin_css__";

/**
 * Inject plugin-specific CSS: widget layout and error placeholder styles.
 *
 * Kept separate from the KaTeX CSS so the two can be removed independently
 * and so the plugin CSS is clearly distinguishable for debugging.
 *
 * Idempotent (EC-23).
 */
export function injectPluginCSS(): void {
  if (document.getElementById(PLUGIN_CSS_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = PLUGIN_CSS_ELEMENT_ID;
  style.textContent = [
    /* Inline math widget wrapper — keeps math vertically centered with text */
    ".cm-math-inline { display: inline-block; vertical-align: middle; }",
    /* Block math widget wrapper — centered, scrollable for wide equations */
    ".cm-math-block  { display: block; text-align: center; margin: 0.5em 0; overflow-x: auto; }",
    /* Error state — uses CSS variable for theme compatibility (FR-5.4).
     * The `cursor: help` hint signals to the user that hovering shows the raw LaTeX. */
    ".cm-math-error  { color: var(--math-error-color, #c0392b); font-style: italic; font-size: 0.9em; cursor: help; }",
  ].join("\n");
  document.head.appendChild(style);
}

/**
 * Remove the plugin-specific CSS style tag.
 *
 * Called from onDisable (EC-23). Safe when the tag does not exist.
 */
export function removePluginCSS(): void {
  document.getElementById(PLUGIN_CSS_ELEMENT_ID)?.remove();
}

// ── Error placeholder helper ──────────────────────────────────────────────────

/**
 * Populate `container` with an error placeholder when KaTeX rendering fails.
 *
 * Uses a distinct visual via CSS variable for theme compatibility (FR-5.4).
 * The `title` attribute shows the raw LaTeX on hover so the user can identify
 * what expression failed (FR-5.2).
 *
 * @param container - The <span> or <div> element to populate.
 * @param latex     - The raw LaTeX source (shown as tooltip via title attribute).
 * @param isBlock   - true if this is a block (display) expression, false for inline.
 */
export function renderMathError(
  container: HTMLElement,
  latex: string,
  isBlock: boolean,
): void {
  container.className = isBlock
    ? "cm-math-error cm-math-block"
    : "cm-math-error cm-math-inline";
  container.textContent = "Math error";
  container.title = latex;
}

// ── KaTeX Widget classes ──────────────────────────────────────────────────────
//
// Both widgets extend WidgetType from the window.__CM_VIEW__ global (not from
// a direct @codemirror/view import). TypeScript sees WidgetType as the runtime
// class value obtained from the global, which makes `extends WidgetType` valid.

/**
 * CM6 WidgetType for inline math ($...$).
 *
 * Replaces the entire $...$ source range with a KaTeX-rendered <span>.
 * eq() compares latex source strings so CM6 can reuse the DOM node when the
 * cursor moves without changing the expression content (FR-4.6).
 *
 * `ignoreEvent()` returns false so mouse clicks on the widget move the cursor
 * into the expression, revealing the raw LaTeX (Typora-style behavior).
 */
export class InlineMathWidget extends (WidgetType as typeof WidgetTypeClass) {
  constructor(readonly latex: string) {
    super();
  }

  /**
   * Equality check used by CM6 to decide whether to reuse an existing DOM node.
   * When the LaTeX source string is identical the rendered output is identical.
   *
   * @param other - Another InlineMathWidget to compare against.
   */
  eq(other: InlineMathWidget): boolean {
    return other.latex === this.latex;
  }

  /**
   * Create the DOM element for this widget.
   *
   * Returns a <span class="cm-math-inline"> containing KaTeX HTML output.
   * On KaTeX error, falls back to renderMathError (error placeholder) rather
   * than leaving the span empty or crashing (FR-5.1, EC-9).
   */
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-math-inline";
    try {
      span.innerHTML = katex.renderToString(this.latex, {
        displayMode: false,
        // throwOnError: false makes KaTeX render an error message inside the HTML
        // rather than throwing. We still wrap in try/catch for completely
        // unrecoverable errors (e.g. memory issues with very large input — EC-16).
        throwOnError: false,
        output: "html",
      });
    } catch (_err) {
      // Fallback: render an identifiable error placeholder with the raw LaTeX in title
      renderMathError(span, this.latex, false);
    }
    return span;
  }

  /**
   * Allow the editor to handle mouse events on this widget (do not swallow them).
   * Returning false lets clicks move the cursor into the widget's document position,
   * which triggers the StateField to hide the decoration and show the raw LaTeX.
   */
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * CM6 WidgetType for display math ($$...$$).
 *
 * The decoration that uses this widget must set `block: true` — see
 * buildMathDecorations(). Renders in KaTeX display mode (centered, larger operators).
 *
 * @see InlineMathWidget for detailed comments on the shared pattern.
 */
export class BlockMathWidget extends (WidgetType as typeof WidgetTypeClass) {
  constructor(readonly latex: string) {
    super();
  }

  /** Equality check — reuse DOM node when LaTeX source is identical. */
  eq(other: BlockMathWidget): boolean {
    return other.latex === this.latex;
  }

  /**
   * Create the DOM element for this widget.
   *
   * Returns a <div class="cm-math-block"> containing KaTeX display-mode HTML.
   * On error, falls back to renderMathError (EC-10).
   */
  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-math-block";
    try {
      div.innerHTML = katex.renderToString(this.latex, {
        displayMode: true,
        throwOnError: false,
        output: "html",
      });
    } catch (_err) {
      renderMathError(div, this.latex, true);
    }
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// ── StateField helpers ────────────────────────────────────────────────────────

/**
 * Return true if the cursor (or selection) overlaps the given math range.
 *
 * "Overlapping" means any position within [anchor, head] (in either order)
 * touches the range [from, to). The definition covers:
 *   - Collapsed cursor inside the range (both ends between from and to).
 *   - Selection that partially intersects the range from either side.
 *   - Selection that entirely spans the range.
 *
 * "Inclusive" on the opening delimiter: cursor exactly at `from` (on the
 * opening `$`) counts as inside (EC-1). "Inclusive" on the closing delimiter:
 * cursor at `to - 1` (on the closing `$`) counts as inside (EC-2). Cursor
 * exactly at `to` (after the closing `$`) counts as OUTSIDE — the expression
 * is rendered as a widget.
 *
 * Unified formula: selFrom < to && selTo >= from
 *   - Handles both collapsed cursors and selections (works for reversed too,
 *     because we normalise with Math.min/max).
 *   - For a collapsed cursor at position P: selFrom = selTo = P.
 *     Inside condition: P < to && P >= from.
 *
 * @param selectionAnchor - state.selection.main.anchor
 * @param selectionHead   - state.selection.main.head
 * @param from            - Inclusive start of the math range.
 * @param to              - Exclusive end of the math range.
 */
export function isCursorInsideRange(
  selectionAnchor: number,
  selectionHead: number,
  from: number,
  to: number,
): boolean {
  // Normalise anchor/head so selFrom ≤ selTo regardless of selection direction
  const selFrom = Math.min(selectionAnchor, selectionHead);
  const selTo   = Math.max(selectionAnchor, selectionHead);
  // Overlap check: selection and range share at least one character position.
  // Because `to` is exclusive, the condition is selFrom < to && selTo >= from.
  return selFrom < to && selTo >= from;
}

/**
 * Build a complete DecorationSet for the given editor state.
 *
 * Called by the StateField's `create` and `update` methods. This is the
 * core render decision function: for each MathRange, decide whether to
 * show the KaTeX widget (cursor away) or the raw source (cursor inside).
 *
 * Uses RangeSetBuilder which requires ranges in ascending order of `from`.
 * scanMathRanges() guarantees this via its Phase 4 sort.
 *
 * @param state - The current CM6 EditorState.
 * @returns     - A DecorationSet with replace decorations for all out-of-cursor math ranges.
 */
export function buildMathDecorations(state: EditorState): DecorationSet {
  // Never decorate in source/raw mode — widgets must not appear when live preview is off.
  if (!(window as any).__MARKABLE_PREVIEW_ENABLED__) return Decoration.none;

  const text   = state.doc.toString();
  const ranges = scanMathRanges(text);
  const sel    = state.selection.main;

  // RangeSetBuilder accumulates replace decorations in sorted order.
  // Type cast is needed because the builder's generic is over the decoration subtype.
  const builder = new RangeSetBuilder<ReturnType<typeof Decoration.replace>>();

  for (const range of ranges) {
    // If the cursor (or any part of the selection) is inside this math range,
    // skip the decoration so the raw LaTeX source is visible for editing.
    if (isCursorInsideRange(sel.anchor, sel.head, range.from, range.to)) {
      continue;
    }

    // Choose the appropriate widget based on expression type
    const widget = range.display
      ? new BlockMathWidget(range.latex)
      : new InlineMathWidget(range.latex);

    // `block: true` is required for block decorations in CM6 (D-1 design decision).
    // Without it, multi-line $$...$$ blocks would render incorrectly.
    const deco = range.display
      ? Decoration.replace({ widget, block: true })
      : Decoration.replace({ widget });

    builder.add(range.from, range.to, deco);
  }

  return builder.finish();
}

// ── StateField factory ────────────────────────────────────────────────────────

/**
 * Create the CM6 StateField that maintains the DecorationSet for all math expressions.
 *
 * This is a factory (not a module-level constant) so that onEnable can construct
 * a fresh StateField on each enable cycle. A fresh field has no residual state
 * from a previous enable/disable cycle (EC-15).
 *
 * Recomputes decorations on every transaction where:
 *   - The document changed (`tr.docChanged`), OR
 *   - The selection changed (`tr.selection` is truthy).
 *
 * The `provide` callback wires the field to CM6's internal decoration rendering
 * pipeline via `EditorView.decorations.from(field)` — same pattern as the YAML
 * pane and other StateField-based plugins.
 *
 * @returns A fully configured StateField<DecorationSet>.
 */
function createMathField(): ReturnType<typeof StateField.define> {
  return StateField.define<DecorationSet>({
    /**
     * Called once when the field is first installed into the editor.
     * Builds the initial DecorationSet from the current document state.
     */
    create(state: EditorState): DecorationSet {
      return buildMathDecorations(state);
    },

    /**
     * Called on every transaction. Recomputes decorations only when the
     * document or selection changed — skipping unchanged transactions avoids
     * redundant O(N) scans on cursor-only moves that don't touch math.
     *
     * Note: `tr.selection` is a SelectionUpdate (truthy) when selection changed.
     * This is the StateField equivalent of ViewPlugin's `update.selectionSet`.
     */
    update(value: DecorationSet, tr: Transaction): DecorationSet {
      if (!tr.docChanged && !tr.selection) {
        return value; // Reuse existing decorations — no change
      }
      return buildMathDecorations(tr.state);
    },

    /**
     * Wire the field's value (DecorationSet) to the editor's decoration rendering.
     * This is the CM6-idiomatic way to register a StateField as a decoration provider.
     */
    provide(field) {
      return _EditorView.decorations.from(field);
    },
  });
}

// ── Module-level state ────────────────────────────────────────────────────────

/**
 * The currently active StateField instance.
 *
 * Set in onEnable (fresh instance each enable cycle — EC-15).
 * Cleared to null in onDisable.
 *
 * The reference is kept here only for documentation clarity — api.removeExtensions()
 * removes all extensions by plugin id, so the field reference itself is not passed
 * to the remove call.
 */
let _mathField: ReturnType<typeof StateField.define> | null = null;

// ── Future settings (reserved — FR-7.2) ──────────────────────────────────────
//
// When user-configurable settings are added, the structure will be:
//
// interface MathPluginSettings {
//   /** KaTeX macro dictionary. Key: macro name (e.g. "\\R"), value: LaTeX expansion. */
//   macros?: Record<string, string>;
//   /** Whether to center display math. Default: true (KaTeX default). */
//   displayCenter?: boolean;
// }
//
// onEnable would call api.loadSettings() and pass macros to katex.renderToString options.
// No settings UI or persistence is implemented in Phase 1.

// ── Plugin lifecycle ──────────────────────────────────────────────────────────

/**
 * Plugin enable sequence (FR-6.3):
 *   1. Inject KaTeX CSS with base64-inlined woff2 fonts (idempotent — EC-23).
 *   2. Inject plugin UI CSS for widget layout and error colors.
 *   3. Construct a fresh mathField StateField (fresh per enable cycle — EC-15).
 *   4. Register the field via api.addExtensions([_mathField]).
 *
 * @param api - The MarkablePluginAPI injected by the plugin manager.
 */
function onEnable(api: MarkablePluginAPI): void {
  injectCSS();
  injectPluginCSS();
  _mathField = createMathField();
  api.addExtensions([_mathField]);
}

/**
 * Plugin disable sequence (FR-6.4):
 *   1. api.removeExtensions() — removes the mathField from the shared Compartment.
 *      After this call, no math decorations exist; raw LaTeX is visible (EC-14).
 *   2. Remove both injected CSS style tags so no KaTeX styles remain in the DOM.
 *   3. Clear the _mathField reference (no residual state — EC-15).
 *
 * @param api - The MarkablePluginAPI injected by the plugin manager.
 */
function onDisable(api: MarkablePluginAPI): void {
  api.removeExtensions();
  removeCSS();
  removePluginCSS();
  _mathField = null;
}

// ── Plugin export ─────────────────────────────────────────────────────────────

/**
 * The UnifiedPlugin descriptor for the Math plugin.
 *
 * This object is the return value of the IIFE and is validated by the plugin
 * loader (validatePlugin in plugin-loader.ts). All required fields are present.
 */
export default {
  id: "math",
  name: "Math",
  version: "1.0.0",
  description: "Render LaTeX math expressions using KaTeX",
  detail:
    "Renders inline $...$ and display $$...$$ LaTeX expressions as typeset mathematics " +
    "in live preview mode. Raw LaTeX is shown when your cursor is inside the expression " +
    "and hidden with the rendered output when the cursor moves away. " +
    "Powered by KaTeX — fast, synchronous, offline-capable.",
  onEnable,
  onDisable,
};

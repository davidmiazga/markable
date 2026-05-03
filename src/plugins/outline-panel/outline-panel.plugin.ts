/**
 * IIFE entry point for the Outline Panel core plugin.
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/outline-panel.js
 *
 * Self-containment rules:
 *   - No @codemirror/* imports as values — accessed via window.__CM_VIEW__
 *     and window.__CM_LANGUAGE__.
 *   - No app-internal module imports (bridge, settings, main, plugin-types).
 *   - CSS injected as <style id="__markable_outline_panel_css__"> in onEnable.
 *   - import type annotations are erased by tsc; safe for IDE support.
 *
 * Architecture overview:
 *   The plugin registers a CM6 updateListener (debounced at 150 ms) that scans
 *   ATX headings from the active document, computes their fold ranges, and
 *   rebuilds the sidebar panel DOM. Clicking a heading label navigates to it.
 *   Clicking a chevron toggles the fold state for that heading's section via
 *   CM6's foldEffect / unfoldEffect.
 *
 * Step 01 scope: heading tree rendering, navigation, active highlight.
 * Step 02 scope: fold infrastructure, bidirectional sync, foldService.
 */

// Type-only imports — erased by tsc, no runtime code emitted.
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── Exported types ─────────────────────────────────────────────────────────────

/**
 * Represents a single ATX heading extracted from the document text.
 *
 * Exported so that tests can import this type alongside scanHeadings()
 * and computeFoldRange() without depending on any runtime CM6 or DOM code.
 * Shape is intentionally identical to auto-toc's HeadingEntry.
 */
export interface HeadingEntry {
  /** ATX heading level: 1 = H1 … 6 = H6. */
  level: number;
  /** Raw heading text after the "# " sequence. May be empty string for "# ". */
  text: string;
  /**
   * Absolute character offset of the line's first character within the document.
   * Matches CM6's doc.line(n).from because both use LF-only line counting.
   */
  lineFrom: number;
  /** 1-based line number within the document. */
  lineNumber: number;
}

/**
 * The fold range for a heading's section.
 *
 * CM6 foldEffect expects { from, to } where:
 *   from — character position of the '\n' at the end of the heading line
 *           (CM6 treats this as "end of visible line").
 *   to   — exclusive end of the hidden range (position after last non-blank char).
 *
 * Exported so that tests can assert on computeFoldRange() output directly.
 */
export interface FoldRange {
  /** Character position of the '\n' ending the heading line. */
  from: number;
  /** Exclusive end position of the section body (after last non-blank char). */
  to: number;
}

// ── Module-level state ─────────────────────────────────────────────────────────
// All variables are private to the IIFE closure after bundling.
// Every variable is reset in onDisable() to support clean toggle cycles.

/** Debounce delay in milliseconds — mirrors the auto-toc and word-count plugins. */
const DEBOUNCE_MS = 150;

/**
 * Live EditorView reference captured on each updateListener invocation.
 * Null until the first transaction fires after onEnable.
 */
let _view: EditorViewType | null = null;

/** Guards the updateListener hot path. Set true in onEnable, false in onDisable. */
let _enabled = false;

/** Active debounce timer. Cleared before each new schedule and in onDisable. */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Most recent scanHeadings() result. Cached so that selection-only changes
 * and fold-only changes can skip re-scanning the full document.
 */
let _lastEntries: HeadingEntry[] = [];

/**
 * Fold ranges parallel to _lastEntries. Index i corresponds to _lastEntries[i].
 * null means the heading's section has no non-blank body and is not collapsible.
 * Recomputed whenever the document changes; otherwise reused.
 */
let _lastFoldRanges: (FoldRange | null)[] = [];

/**
 * The .outline-list div inside the sidebar panel content container.
 * Null when the plugin is disabled or the render() callback has not fired yet.
 * Set by render(); nulled by destroy().
 */
let _outlineList: HTMLElement | null = null;

// ── CM6 globals accessors ──────────────────────────────────────────────────────

/**
 * Lazily retrieve the @codemirror/view module from the window.__CM_VIEW__ global.
 *
 * NOT called at module-evaluation time so test files can import pure functions
 * without needing a real browser window (no window.__CM_VIEW__ in Vitest).
 *
 * @returns The @codemirror/view module from the shared CM6 instance.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function getCmView(): typeof import("@codemirror/view") {
  return (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
}

/**
 * Lazily retrieve the @codemirror/language module from window.__CM_LANGUAGE__.
 *
 * Exposes foldEffect, unfoldEffect, foldedRanges, foldService, and codeFolding.
 * These are assigned by cm-globals.ts before any plugin IIFE runs.
 *
 * @returns The @codemirror/language module from the shared CM6 instance.
 */
function getCmLanguage(): typeof import("@codemirror/language") {
  return (window as any).__CM_LANGUAGE__ as typeof import("@codemirror/language");
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Pure functions (exported for testability) ──────────────────────────────────

/**
 * Scan a Markdown document string and return all ATX headings in document order.
 *
 * Pure function — no CM6, no DOM. Exported for direct use in unit tests.
 *
 * @note Length: the loop body handles code-fence tracking, offset accumulation,
 * and heading detection as a single linear scan. Splitting into smaller helpers
 * would require passing accumulated state (fenceMarker, lineStart) through
 * additional parameters, adding indirection with no clarity benefit.
 *
 * Rules (CommonMark ATX headings):
 *   - Exactly 1–6 `#` characters at line start followed by a literal space.
 *   - Everything after "# " is stored verbatim as heading text.
 *   - Lines with 7+ `#` are NOT headings.
 *   - Headings inside fenced code blocks (``` or ~~~) are excluded.
 *   - ``` and ~~~ fences can only be closed by the same marker type (CommonMark).
 *
 * @param docText - Full document text with LF line endings (CM6 internal format).
 * @returns       Array of HeadingEntry objects in document order.
 */
export function scanHeadings(docText: string): HeadingEntry[] {
  const result: HeadingEntry[] = [];

  // Tracks the fence marker currently open ("```" | "~~~" | null = not in fence).
  // CommonMark: a ``` fence can only be closed by ```, and ~~~ only by ~~~.
  let fenceMarker: "```" | "~~~" | null = null;

  // Accumulated character offset for the start of the current line.
  // Matches CM6's doc.line(n).from because both treat \n as line separator.
  let lineStart = 0;

  // 1-based counter for the lineNumber field.
  let lineNumber = 1;

  // ATX heading regex: 1–6 hash chars at line start, one space, then any text.
  // match[1] = hash sequence, match[2] = heading text (may be "").
  const HEADING_RE = /^(#{1,6}) (.*)/;

  const lines = docText.split("\n");

  for (const line of lines) {
    const trimmed = line.trimStart();

    // Detect code fence open/close using marker-type tracking so that ~~~ cannot
    // close a ``` fence and vice versa (CommonMark §4.5 fence-matching rule).
    const lineMarker = trimmed.startsWith("```")
      ? "```"
      : trimmed.startsWith("~~~")
        ? "~~~"
        : null;

    if (lineMarker !== null) {
      if (fenceMarker === null) {
        // Opening a new code fence.
        fenceMarker = lineMarker;
      } else if (lineMarker === fenceMarker) {
        // Closing the open fence with the matching marker type.
        fenceMarker = null;
      }
      // A non-matching marker inside an open fence is regular content — skip.
      lineStart += line.length + 1; // +1 for the \n separator
      lineNumber++;
      continue;
    }

    // Only test for headings when we are outside any code fence.
    if (fenceMarker === null) {
      const match = HEADING_RE.exec(line);
      if (match) {
        result.push({
          level: match[1].length,
          text: match[2], // Verbatim — no inline Markdown stripping.
          lineFrom: lineStart,
          lineNumber,
        });
      }
    }

    lineStart += line.length + 1; // +1 for the \n separator
    lineNumber++;
  }

  return result;
}

/**
 * Determine which heading is "active" for the given cursor position.
 *
 * The active heading is the last one whose lineFrom is ≤ cursorPos.
 * Returns -1 when the cursor is above all headings (EC-3).
 *
 * O(n) on headings, not document size. Bails early once entries exceed cursor.
 *
 * @param entries   - Heading entries in document order (from scanHeadings).
 * @param cursorPos - Current cursor character offset in the document.
 * @returns         Index into entries of the active heading, or -1 if none.
 */
export function findActiveIndex(entries: HeadingEntry[], cursorPos: number): number {
  let active = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].lineFrom <= cursorPos) {
      active = i;
    } else {
      // Entries are in document order. Once we pass the cursor, no later
      // entry can be active — bail early rather than scanning to the end.
      break;
    }
  }
  return active;
}

/**
 * Compute the fold range for the section owned by entries[index].
 *
 * A section spans from the end of the heading line to the end of the last
 * non-blank body line. The section ends when the next heading at the same
 * or higher level is encountered (i.e. nextLevel <= currentLevel).
 *
 * Returns null when:
 *   - The heading is on the last line with no trailing newline (no body possible).
 *   - The entire body consists only of blank/whitespace lines (not collapsible).
 *   - The computed from >= to (defensive EC-12 guard — unreachable by current algorithm).
 *
 * @note Length: the body-line walk must accumulate absolute offsets while scanning
 * for the last non-blank line. Both concerns (offset tracking + blank detection)
 * share a single iteration; splitting them would require two passes or an extra
 * intermediate array.
 *
 * @param entries  - All heading entries for the document (from scanHeadings).
 * @param index    - Index of the target heading within entries.
 * @param docText  - Full document text (same string passed to scanHeadings).
 * @returns        FoldRange or null if the section is not collapsible.
 */
export function computeFoldRange(
  entries: HeadingEntry[],
  index: number,
  docText: string,
): FoldRange | null {
  const entry = entries[index];
  const currentLevel = entry.level;

  // Walk forward in entries to find the next heading at the same or higher level.
  // "Same or higher level" means the heading number ≤ currentLevel (e.g. H2 ≤ H2,
  // H1 ≤ H2). When found, the body stops at that heading's line start.
  let sectionEndPos = docText.length; // Default: section runs to end of document.
  for (let j = index + 1; j < entries.length; j++) {
    if (entries[j].level <= currentLevel) {
      sectionEndPos = entries[j].lineFrom;
      break;
    }
  }

  // Locate the '\n' that ends the heading line. This character position is the
  // fold range 'from' — CM6 folds everything from here to 'to' (exclusive).
  const headingLineEnd = docText.indexOf("\n", entry.lineFrom);
  if (headingLineEnd === -1) {
    // Heading is on the last line with no trailing newline.
    // There is no body text, so no fold is possible.
    return null;
  }
  const foldFrom = headingLineEnd;

  // Extract the body text (everything between the heading line's \n and sectionEndPos).
  const bodyText = docText.slice(headingLineEnd + 1, sectionEndPos);

  // Walk body lines to find the last non-blank line's ending position.
  // cumulativeOffset tracks the absolute document position of each line's first char.
  const bodyLines = bodyText.split("\n");
  let lastNonBlankOffset = -1;
  let cumulativeOffset = headingLineEnd + 1; // First char of the first body line.

  for (const line of bodyLines) {
    if (line.trim() !== "") {
      // Position of the last character on this line (exclusive of \n).
      lastNonBlankOffset = cumulativeOffset + line.length - 1;
    }
    cumulativeOffset += line.length + 1; // +1 for \n
  }

  if (lastNonBlankOffset === -1) {
    // All body lines are blank — the section is not collapsible.
    return null;
  }

  // foldTo is exclusive (CM6 convention), so +1 past the last non-blank char.
  const foldTo = lastNonBlankOffset + 1;

  // EC-12 defensive guard: a zero-length or inverted fold range is a no-op in
  // CM6 and indicates a logic error. Return null rather than dispatching it.
  // This condition is unreachable by the current algorithm (when lastNonBlankOffset
  // != -1, foldTo >= foldFrom + 2 always holds). Retained as insurance against
  // future algorithm changes that could break that invariant silently.
  if (foldFrom >= foldTo) {
    return null;
  }

  return { from: foldFrom, to: foldTo };
}

// ── Internal helper ────────────────────────────────────────────────────────────

/**
 * Check whether a CM6 fold range starting at `pos` is currently folded.
 *
 * Uses RangeSet.between() which invokes the callback for every stored range
 * that overlaps the point [pos, pos]. This is O(log n) on the number of folds.
 *
 * The `foldedSet` type is the return value of foldedRanges(state) — a CM6
 * RangeSet<FoldMarker>. Typed as `any` here because importing the full generic
 * type would require @codemirror/language as a value import.
 *
 * @param foldedSet - RangeSet from foldedRanges(state).
 * @param pos       - Document position to test (typically FoldRange.from).
 * @returns         true if a fold range covers or starts at pos.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function isFolded(foldedSet: any, pos: number): boolean {
  let found = false;
  foldedSet.between(pos, pos, () => {
    found = true;
  });
  return found;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── CSS constant ───────────────────────────────────────────────────────────────

/**
 * Content-area CSS injected as a <style> tag in onEnable and removed in
 * onDisable. All class names are prefixed "outline-" (NFR-5) to avoid
 * collisions with the auto-toc "toc-" namespace.
 *
 * Colours use CSS variables so the panel automatically adopts the active theme.
 * Font sizes are fixed in px and are independent of the editor zoom level.
 *
 * Chevron visibility strategy:
 *   - Base rule hides all chevrons (non-collapsible sections have no button).
 *   - "outline-chevron-visible" overrides to show collapsible-section chevrons.
 *   - "outline-chevron-collapsed" rotates the visible chevron to point right.
 */
const OUTLINE_CONTENT_CSS = `
.outline-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
}

.outline-row {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 2px 8px 2px 0;
}

.outline-chevron {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: transform 0.15s ease;
  /* Base rule: hidden. Overridden by outline-chevron-visible for collapsible sections. */
  visibility: hidden;
  /* Default expanded state: ▶ rotated 90° = pointing down (▼) */
  transform: rotate(90deg);
}

.outline-chevron-visible {
  visibility: visible;
}

/* Collapsed: ▶ at 0° = pointing right (▶). Animates from 90° to 0°. */
.outline-chevron-collapsed {
  transform: rotate(0deg);
}

.outline-label {
  flex: 1;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  text-align: left;
  font-family: var(--ui-font);
  font-size: 12px;
  line-height: 1.4;
  padding: 2px 8px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

.outline-label:hover {
  background: var(--code-bg);
}

.outline-label-active {
  color: var(--text-primary);
  border-left: 2px solid var(--link-color);
  background: var(--selection-bg);
}

.outline-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-family: var(--ui-font);
  font-size: 12px;
  color: var(--text-secondary);
  pointer-events: none;
  user-select: none;
}

/* ── Inline fold glyph in the editor content area ─────────────────────────── */

/* The ▶ triangle sits in the left margin of heading lines. Negative margin-left
   pulls it out of the text flow so heading text is not displaced. Rotates 90° to
   point down when expanded, returns to 0° (right) when collapsed. */
.cm-content .outline-fold-glyph {
  display: inline-block;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  color: var(--text-secondary, #888);
  opacity: 0.55;
  transform: rotate(90deg); /* expanded → pointing down */
  transform-origin: center center;
  transition: transform 0.6s ease, opacity 0.15s ease;
  vertical-align: middle;
  margin-top: -12px;
  margin-left: -21px;
  margin-right: 6px; /* margin keeps spacing outside the transform box */
}

.cm-content .outline-fold-glyph:hover {
  opacity: 1;
  color: var(--text-primary, #ccc);
}

.cm-content .outline-fold-glyph.is-collapsed {
  transform: rotate(0deg); /* collapsed → pointing right */
}
`;

// ── CSS lifecycle helpers ──────────────────────────────────────────────────────

/**
 * Inject (or update) the content-area <style> tag in <head>.
 *
 * Always overwrites textContent so that a stale tag from a previous plugin
 * load (before a sync) always gets the latest CSS on the next enable.
 */
function injectCSS(): void {
  const STYLE_ID = "__markable_outline_panel_css__";
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = OUTLINE_CONTENT_CSS;
}

/**
 * Remove the content-area <style> tag injected by injectCSS().
 * No-op if the tag is absent (e.g. onDisable called before onEnable completed).
 */
function removeCSS(): void {
  document.getElementById("__markable_outline_panel_css__")?.remove();
}

// ── DOM render helper ──────────────────────────────────────────────────────────

/**
 * Replace the entire contents of .outline-list with the current heading tree.
 *
 * Called on every debounce tick. Uses innerHTML = "" to discard all existing
 * child nodes and their inline event listeners atomically — no explicit
 * removeEventListener needed because the old nodes are discarded entirely.
 *
 * Four-parameter signature (step 02). The foldRanges and foldedSet parameters
 * enable chevron state computation at render time.
 *
 * @note Length: each heading row requires two sibling DOM elements (chevron +
 * label), two event listeners, and indent/state computation. Splitting into
 * per-row helpers would pass four parameters per call with no clarity gain.
 *
 * @param entries    - Current heading list from scanHeadings().
 * @param foldRanges - Fold range for each entry (null = not collapsible). Parallel array.
 * @param foldedSet  - Current foldedRanges() RangeSet, or null if CM6 language unavailable.
 * @param activeIdx  - Index of the heading showing the active style, or -1 for none.
 */
function rebuildOutline(
  entries: HeadingEntry[],
  foldRanges: (FoldRange | null)[],
  /* eslint-disable @typescript-eslint/no-explicit-any */
  foldedSet: any,
  /* eslint-enable @typescript-eslint/no-explicit-any */
  activeIdx: number,
): void {
  if (!_outlineList) return;

  // Clear previous DOM and inline listeners in a single operation.
  _outlineList.innerHTML = "";

  if (entries.length === 0) {
    // Empty state: centered "No headings" message (EC-1, EC-17).
    const empty = document.createElement("div");
    empty.className = "outline-empty";
    empty.textContent = "No headings";
    _outlineList.appendChild(empty);
    return;
  }

  // Cache the EditorView reference once per rebuild call (avoids repeated window lookups).
  const { EditorView } = getCmView();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const foldRange = foldRanges[i] ?? null;

    // Determine fold state for this heading's section.
    const isCollapsible = foldRange !== null;
    // isFolded is only meaningful when the section is collapsible and the fold set exists.
    const isCurrentlyFolded =
      isCollapsible && foldedSet !== null && isFolded(foldedSet, foldRange!.from);

    // ── Row container ──
    const row = document.createElement("div");
    row.className = "outline-row";

    // ── Chevron button ──
    // Hidden for non-collapsible sections; visible and interactive otherwise.
    const chev = document.createElement("button");
    chev.className = "outline-chevron";
    chev.textContent = "▶";

    if (isCollapsible) {
      chev.classList.add("outline-chevron-visible");
      chev.setAttribute(
        "aria-label",
        isCurrentlyFolded ? "Expand section" : "Collapse section",
      );
      if (isCurrentlyFolded) {
        chev.classList.add("outline-chevron-collapsed");
      }

      // Capture foldRange for this iteration's closure.
      // The click handler reads the live fold state at click time (not at render time)
      // so it always reflects the most recent editor state.
      const capturedFoldRange = foldRange!;
      chev.addEventListener("click", (e) => {
        // Stop propagation so the row does not also fire the label navigation handler.
        e.stopPropagation();
        if (!_view) return;

        const {
          foldEffect,
          unfoldEffect,
          foldedRanges: getFoldedRanges,
        } = getCmLanguage();
        const currentFoldedSet = getFoldedRanges(_view.state);

        if (isFolded(currentFoldedSet, capturedFoldRange.from)) {
          // Section is currently folded — dispatch unfold.
          _view.dispatch({
            effects: unfoldEffect.of({ from: capturedFoldRange.from, to: capturedFoldRange.to }),
          });
        } else {
          // Section is currently expanded — dispatch fold.
          _view.dispatch({
            effects: foldEffect.of({
              from: capturedFoldRange.from,
              to: capturedFoldRange.to,
            }),
          });
        }
      });
    } else {
      // Non-collapsible: aria-hidden so screen readers skip the invisible button.
      chev.setAttribute("aria-hidden", "true");
    }

    // ── Label button (heading text, navigation target) ──
    const btn = document.createElement("button");
    btn.className = "outline-label";

    if (i === activeIdx) {
      btn.classList.add("outline-label-active");
    }

    // Indentation: H1 = 8px base, each additional level adds 12px.
    btn.style.paddingLeft = `${(entry.level - 1) * 12 + 8}px`;

    // EC-6: empty heading text gets a non-breaking space so the button has
    // visible height and remains clickable.
    btn.textContent = entry.text || "\u00A0";

    // Capture per-iteration values for the click closure.
    const lineFrom = entry.lineFrom;
    const capturedFoldRange = foldRange; // may be null for non-collapsible headings

    btn.addEventListener("click", () => {
      if (!_view) return;

      const { unfoldEffect, foldedRanges: getFoldedRanges } = getCmLanguage();

      // EC-5: if the target section is currently folded, unfold it before
      // navigating so the cursor lands on a visible heading line.
      if (capturedFoldRange !== null) {
        const currentFoldedSet = getFoldedRanges(_view.state);
        if (isFolded(currentFoldedSet, capturedFoldRange.from)) {
          _view.dispatch({
            effects: unfoldEffect.of({ from: capturedFoldRange.from, to: capturedFoldRange.to }),
          });
        }
      }

      // Move cursor to the heading line and scroll it to vertical centre.
      _view.dispatch({
        selection: { anchor: lineFrom },
        effects: EditorView.scrollIntoView(lineFrom, { y: "center" }),
      });
      // Focus the editor so the user can type immediately.
      _view.focus();
    });

    row.appendChild(chev);
    row.appendChild(btn);
    _outlineList.appendChild(row);
  }
}

// ── CM6 extension factories ────────────────────────────────────────────────────

/**
 * Build the CM6 updateListener extension for the Outline Panel.
 *
 * Factory pattern (not module-level constant) so getCmView() / getCmLanguage()
 * are called only inside onEnable(), never at module-evaluation time. This
 * keeps test files importable without a browser environment.
 *
 * Behaviour:
 *   - Captures the latest _view on every update.
 *   - Fires on doc change, selection change, or fold state change.
 *   - Debounces at DEBOUNCE_MS to avoid redundant DOM rebuilds.
 *   - Re-uses _lastEntries and _lastFoldRanges when only selection/fold changed.
 *   - Snapshots doc text and fold state BEFORE the setTimeout delay.
 *
 * @note Length: the listener body snapshot/debounce/re-render pipeline is a
 * single logical unit. The doc-changed branch and the fold/selection-only branch
 * share the debounce path; splitting them would duplicate the setTimeout logic.
 *
 * @returns A CM6 Extension (EditorView.updateListener instance).
 */
function buildOutlineUpdateListener() {
  const { EditorView } = getCmView();
  const { foldedRanges: getFoldedRanges } = getCmLanguage();

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;

    // Always capture the latest view — cheap assignment, always safe.
    _view = update.view;

    const docChanged = update.docChanged;
    const selChanged = update.selectionSet;

    // FR-12 / AD-3: fold state change detection via RangeSet reference identity.
    // foldedRanges() returns the same RangeSet object when nothing changed (O(1)).
    const foldStateChanged =
      getFoldedRanges(update.state) !== getFoldedRanges(update.startState);

    if (!docChanged && !selChanged && !foldStateChanged) return;

    // Cancel any pending debounce before scheduling a new one.
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    // Snapshot immutable values from the current EditorState BEFORE the async delay.
    // CM6 EditorState is immutable so these snapshots remain valid after the tick.
    const docText = docChanged ? update.state.doc.toString() : null;
    const cursorPos = update.state.selection.main.head;
    const foldedSet = getFoldedRanges(update.state);

    _debounceTimer = setTimeout(() => {
      // Guard: the plugin may have been disabled during the debounce window (EC-11).
      if (!_enabled) return;

      if (docText !== null) {
        // Document content changed — rescan from scratch.
        _lastEntries = scanHeadings(docText);
        // Recompute fold ranges because heading positions may have shifted.
        const text = docText;
        _lastFoldRanges = _lastEntries.map((_, i) =>
          computeFoldRange(_lastEntries, i, text),
        );
      }
      // If only selection or fold state changed, _lastEntries and _lastFoldRanges
      // are reused from the previous document scan.

      const activeIdx = findActiveIndex(_lastEntries, cursorPos);
      rebuildOutline(_lastEntries, _lastFoldRanges, foldedSet, activeIdx);
    }, DEBOUNCE_MS);
  });
}

/**
 * Build the CM6 ViewPlugin that renders an inline fold triangle (▶) at the
 * start of each collapsible heading line in the editor content area.
 *
 * The triangle points down (rotated 90°) when expanded and right (0°) when
 * collapsed, with a 0.15 s CSS transition between states.
 *
 * Clicking the triangle dispatches foldEffect / unfoldEffect directly on the
 * view. The plugin re-builds its decoration set whenever the document or the
 * fold state changes.
 *
 * @note Length: the function defines a WidgetType subclass and a ViewPlugin
 * class inline because both depend on CM6 globals that must be accessed at
 * onEnable time (AD-6). Splitting them into separate factory functions would
 * require threading the same globals through additional parameters.
 *
 * @returns A CM6 Extension (ViewPlugin instance with decorations).
 */
function buildFoldGlyphPlugin() {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { ViewPlugin, Decoration, WidgetType } = getCmView() as any;
  const { foldEffect, unfoldEffect, foldedRanges: getFoldedRanges } = getCmLanguage();

  class FoldGlyphWidget extends WidgetType {
    constructor(
      readonly folded: boolean,
      readonly foldFrom: number,
      readonly foldTo: number,
    ) { super(); }

    eq(other: FoldGlyphWidget): boolean {
      return this.folded === other.folded && this.foldFrom === other.foldFrom;
    }

    toDOM(view: any): HTMLElement {
      const span = document.createElement("span");
      span.className = "outline-fold-glyph" + (this.folded ? " is-collapsed" : "");
      span.setAttribute("aria-label", this.folded ? "Expand section" : "Collapse section");
      span.textContent = "▶";
      const { foldFrom, foldTo } = this;
      span.addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault(); // keep focus in editor without cursor jump
        e.stopPropagation();
        const foldedNow = isFolded(getFoldedRanges(view.state), foldFrom);
        view.dispatch({
          effects: foldedNow
            ? unfoldEffect.of({ from: foldFrom, to: foldTo })
            : foldEffect.of({ from: foldFrom, to: foldTo }),
        });
      });
      return span;
    }

    ignoreEvent(e: Event): boolean {
      return e.type === "mousedown";
    }
  }

  return ViewPlugin.fromClass(
    class OutlineFoldGlyphPlugin {
      decorations: any;
      private entries: HeadingEntry[] = [];
      private foldRanges: (FoldRange | null)[] = [];

      constructor(view: any) {
        this.syncDoc(view.state.doc.toString());
        this.decorations = this.buildDecorations(view.state);
      }

      update(update: any) {
        const foldChanged =
          getFoldedRanges(update.state) !== getFoldedRanges(update.startState);
        if (update.docChanged || foldChanged) {
          if (update.docChanged) this.syncDoc(update.state.doc.toString());
          this.decorations = this.buildDecorations(update.state);
        }
      }

      syncDoc(docText: string) {
        this.entries = scanHeadings(docText);
        this.foldRanges = this.entries.map((_, i) =>
          computeFoldRange(this.entries, i, docText),
        );
      }

      buildDecorations(state: any): any {
        const foldedSet = getFoldedRanges(state);
        const widgets: any[] = [];
        for (let i = 0; i < this.entries.length; i++) {
          const fr = this.foldRanges[i];
          if (!fr) continue; // non-collapsible heading gets no glyph
          widgets.push(
            Decoration.widget({
              widget: new FoldGlyphWidget(
                isFolded(foldedSet, fr.from),
                fr.from,
                fr.to,
              ),
              side: -1,
            }).range(this.entries[i].lineFrom),
          );
        }
        return widgets.length ? Decoration.set(widgets) : Decoration.none;
      }
    },
    { decorations: (v: any) => v.decorations },
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Build the CM6 foldService extension for the Outline Panel.
 *
 * foldService is a CM6 Facet that CodeMirror queries when it needs to know
 * the fold range for a given line (e.g. for the fold gutter widget). Returning
 * null from the service means "no fold available here" (EC-14).
 *
 * The service reads _lastEntries and _lastFoldRanges at call time — these are
 * kept up to date by the updateListener. Because CM6 invokes the service
 * reactively (when needed), this lazy read is correct.
 *
 * @returns A CM6 Extension (foldService Facet instance).
 */
function buildFoldService() {
  const { foldService } = getCmLanguage();

  return foldService.of((_state, lineStart) => {
    // Find the heading entry whose lineFrom matches lineStart.
    // If none found, this line is not a heading — no fold available (EC-14).
    const idx = _lastEntries.findIndex((e) => e.lineFrom === lineStart);
    if (idx === -1) return null;

    // If the heading has no collapsible section, return null (EC-14).
    const foldRange = _lastFoldRanges[idx];
    if (!foldRange) return null;

    return { from: foldRange.from, to: foldRange.to };
  });
}

// ── Plugin export ──────────────────────────────────────────────────────────────

/**
 * Outline Panel plugin export object.
 *
 * onEnable sequence:
 *   1. Smoke-test __CM_LANGUAGE__ exports (EC-13). Abort with console.error on failure.
 *   2. Set _enabled flag.
 *   3. Inject content CSS <style> tag (idempotent).
 *   4. Register CM6 extensions: updateListener + foldService + codeFolding().
 *   5. Register sidebar panel via api.registerSidebarPanel(). The render()
 *      callback creates .outline-list DOM and triggers the initial build.
 *
 * onDisable sequence (exact reversal of onEnable):
 *   1. Clear _enabled flag.
 *   2. Cancel any pending debounce.
 *   3. Remove CM6 extensions via api.removeExtensions().
 *   4. Unregister sidebar panel (SidebarManager calls destroy() before DOM removal).
 *   5. Remove content CSS <style> tag.
 *   6. Reset all module-level state to initial values.
 *
 * @note Length: onEnable and onDisable are intentionally inline. Each step
 * depends on objects created by the previous step (extensions array, panel id),
 * and the spec (00_index.md AD-6) requires all CM6 globals to be accessed here,
 * not at module-evaluation time. Extracting sub-steps would require returning
 * values across function boundaries for no readability gain.
 */
export default {
  id: "outline-panel",
  name: "Outline Panel",
  version: "1.0.0",
  description: "Live heading outline with section folding",
  /**
   * Declares the sidebar panel id registered by this plugin.
   * Read by the Plugins Panel detail view for the sidebar assignment toggle.
   */
  sidebarPanelId: "outline-panel",
  detail:
    "Shows a live H1–H6 heading tree for the active document. Click any heading to navigate. Click the chevron to collapse or expand a section in the editor.",

  onEnable(api: MarkablePluginAPI): void {
    // EC-13: guard against missing __CM_LANGUAGE__ prerequisite.
    // If the global is absent or incomplete, log a diagnostic and abort.
    try {
      const cmLang = getCmLanguage();
      if (
        typeof cmLang.foldEffect === "undefined" ||
        typeof cmLang.unfoldEffect === "undefined" ||
        typeof cmLang.foldedRanges === "undefined" ||
        typeof cmLang.foldService === "undefined" ||
        typeof cmLang.codeFolding === "undefined"
      ) {
        throw new TypeError("Required fold exports missing from __CM_LANGUAGE__");
      }
    } catch (err) {
      console.error(
        "Outline Panel: @codemirror/language not available as window global. " +
          "Ensure cm-globals.ts exports __CM_LANGUAGE__.",
        err,
      );
      return; // Do NOT partially enable — avoids broken state.
    }

    _enabled = true;
    injectCSS();

    // Register CM6 extensions:
    //   1. updateListener    — detects doc/selection/fold changes and rebuilds the panel.
    //   2. foldService       — teaches CM6 the fold range for each heading line.
    //   3. buildFoldGlyphPlugin() — inline ▶ triangle in the content area per heading.
    api.addExtensions([
      buildOutlineUpdateListener(),
      buildFoldService(),
      buildFoldGlyphPlugin(),
    ]);

    api.registerSidebarPanel({
      id: "outline-panel",
      title: "Outline",
      side: "right",
      defaultWidth: 220,

      render(container: HTMLElement): void {
        // Create and attach the scrollable list container.
        const list = document.createElement("div");
        list.className = "outline-list";
        container.appendChild(list);
        _outlineList = list;

        // Perform the initial outline build using the live editor view.
        // If __MARKABLE_EDITOR_VIEW__ is absent, render the empty state — the
        // updateListener will populate the panel on the first transaction.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as
          | EditorViewType
          | undefined;
        /* eslint-enable @typescript-eslint/no-explicit-any */

        if (liveView) {
          _view = liveView;
          const docText = liveView.state.doc.toString();
          _lastEntries = scanHeadings(docText);
          _lastFoldRanges = _lastEntries.map((_, i) =>
            computeFoldRange(_lastEntries, i, docText),
          );
          const { foldedRanges: getFoldedRanges } = getCmLanguage();
          const foldedSet = getFoldedRanges(liveView.state);
          const activeIdx = findActiveIndex(
            _lastEntries,
            liveView.state.selection.main.head,
          );
          rebuildOutline(_lastEntries, _lastFoldRanges, foldedSet, activeIdx);
        } else {
          rebuildOutline([], [], null, -1);
        }
      },

      destroy(_container: HTMLElement): void {
        // Cancel any in-flight debounce to prevent a stale rebuild after the
        // panel DOM has already been removed.
        if (_debounceTimer) {
          clearTimeout(_debounceTimer);
          _debounceTimer = null;
        }
        // Null the list reference; the container DOM is removed by the
        // infrastructure after this callback returns.
        _outlineList = null;
      },
    });
  },

  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;

    // Cancel any in-flight debounce to prevent a rebuild after the state has
    // been torn down.
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    // Remove all CM6 extensions from the editor's Compartment.
    // Must run before unregisterSidebarPanel so no further rebuilds can fire
    // after _outlineList is nulled by the destroy() callback.
    api.removeExtensions();

    // Unregister the sidebar panel. SidebarManager calls destroy() before
    // removing the DOM, which nulls _outlineList before this function returns.
    api.unregisterSidebarPanel("outline-panel");

    // Remove the injected content CSS.
    removeCSS();

    // Reset all module-level state so the next onEnable call starts clean.
    _view = null;
    _lastEntries = [];
    _lastFoldRanges = [];
    // _outlineList is already nulled by the destroy() callback above.
  },
};

/**
 * Markdown Toolbar plugin for Markable 2.0.
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/markdown-toolbar.js
 *
 * Self-containment rules (same as all .plugin.ts files):
 *   - No @codemirror/* imports as values — accessed via window.__CM_VIEW__.
 *   - No app-internal module imports (bridge, settings, main, plugin-types).
 *   - CSS injected as <style id="__markable_md_toolbar_css__"> in onEnable.
 *   - import type annotations are erased by tsc; safe for IDE support.
 *
 * Architecture overview:
 *   Provides a 10-button formatting toolbar for common inline Markdown styles.
 *   Available in two modes:
 *     - Floating: a bubble that appears above the selection.
 *     - Sidebar: a docked panel always visible in the sidebar.
 *
 *   Format application/removal uses pure functions (computeWrap, computeUnwrap,
 *   computeErase) that return plain ChangeSet data — no CM6 dependency in those
 *   functions. The CM6 updateListener (step_06) drives positioning and active-
 *   state highlighting. All state is reset in onDisable for clean toggle cycles.
 *
 * Module sections (in order):
 *   1.  Type-only imports
 *   2.  Settings types and defaults
 *   3.  Module-level state declarations
 *   4.  CSS constant and lifecycle helpers
 *   5.  Format registry (FORMATS)
 *   6.  Pure: detectFormats
 *   7.  Pure: computeWrap / computeUnwrap / computeErase
 *   8.  Async: resolveUrl
 *   9.  DOM: buildToolbarDOM
 *   10. DOM: updateActiveButtons / updateDisabledState / updatePosition
 *   11. CM6 listener factory: buildUpdateListener
 *   12. Plugin export object
 */

// ── 1. Type-only imports (erased at compile time) ────────────────────────────

// These are type-only imports so they are completely erased by tsc.
// No runtime code is emitted for these lines.
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── 2. Settings types and defaults ───────────────────────────────────────────

/** Determines whether the toolbar floats over the editor or lives in the sidebar. */
export type ToolbarMode = "floating" | "sidebar";

/** Which sidebar slot the toolbar panel should occupy when in sidebar mode. */
export type SidebarSide = "left" | "right";

/** Persisted settings for the Markdown Toolbar plugin. */
export interface ToolbarSettings {
  toolbarMode: ToolbarMode;
  sidebarSide: SidebarSide;
}

/**
 * Default settings used on first run (EC-18) or when a stored value is invalid
 * (EC-19). Floating mode is the default because it requires no sidebar slot.
 */
export const DEFAULT_SETTINGS: ToolbarSettings = {
  toolbarMode: "floating",
  sidebarSide: "left",
};

/**
 * Merge raw (potentially partial or null) persisted data with defaults.
 *
 * Handles:
 *   EC-18: null input (first run, no settings file) → returns DEFAULT_SETTINGS copy.
 *   EC-19: partial object (missing keys) → fills missing keys from defaults.
 *   EC-19: invalid values (unknown string) → falls back to the default for that key.
 *
 * This function is a pure function: it never mutates DEFAULT_SETTINGS or the
 * input object. Callers can safely call it multiple times with the same input.
 *
 * @param raw - Parsed JSON object from disk, or null if none exists.
 * @returns   A complete, validated ToolbarSettings object.
 */
export function mergeWithDefaults(
  raw: Record<string, unknown> | null,
): ToolbarSettings {
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
// to their initial values in onDisable to support clean toggle cycles (NFR-3).

/** Debounce delay in milliseconds — consistent with auto-toc and word-count. */
const DEBOUNCE_MS = 150;

/** Guards the updateListener hot path. Set true in onEnable, false in onDisable. */
let _enabled: boolean = false;

/**
 * In-flight guard for link/image button double-clicks.
 *
 * resolveUrl() is async (may await navigator.clipboard.readText() or show a
 * prompt). If the user double-clicks a link/image button before the first
 * invocation resolves, a second handleButtonClick would begin, causing two
 * concurrent prompt dialogs or two overlapping dispatches. This flag is set to
 * true at the start of any link/image button click and reset to false when the
 * async work completes. Reset in onDisable as part of clean teardown.
 */
let _clickInFlight: boolean = false;

/** Active resolved settings for the current onEnable cycle. */
let _settings: ToolbarSettings = { ...DEFAULT_SETTINGS };

/**
 * Live EditorView reference captured on each updateListener invocation.
 * Null until the first update fires after onEnable.
 *
 * Written by buildUpdateListener on every transaction. Used by handleButtonClick
 * as a fallback when window.__MARKABLE_EDITOR_VIEW__ is stale (e.g. during tab
 * switch). Reset to null in onDisable for clean toggle cycles.
 */
let _view: EditorViewType | null = null;

/**
 * The root toolbar DOM element. Created in onEnable, removed/nulled in onDisable.
 * Appended to document.body (floating) or sidebar container (sidebar mode).
 */
let _toolbarEl: HTMLElement | null = null;

/**
 * NodeList of all 10 toolbar buttons. Stored for O(1) iteration in the update
 * path instead of repeated querySelectorAll calls.
 */
let _buttons: NodeListOf<HTMLButtonElement> | null = null;

/** Active debounce timer for active-state detection. Cleared in onDisable. */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Whether a sidebar panel was registered in the current onEnable cycle.
 * Guards the unregisterSidebarPanel call in onDisable (EC-17) so it is only
 * called when there is actually a panel to remove.
 */
let _sidebarPanelRegistered: boolean = false;

// ── 4. CSS constant and lifecycle helpers ─────────────────────────────────────

/**
 * All toolbar CSS rules, injected as a <style> tag in onEnable.
 *
 * Design decisions:
 *   - All colours use CSS variables for automatic theme adoption.
 *   - Floating mode: position: fixed, z-index: 10000 to float above editor content.
 *   - Sidebar override: .sidebar-panel-content .md-toolbar reverts to static layout.
 *   - The sidebar-panel-content class is the actual class assigned by SidebarManager
 *     (verified in src/sidebar/sidebar-manager.ts line 723).
 */
const TOOLBAR_CSS = `
.md-toolbar {
  position: fixed;
  display: flex;
  flex-direction: row;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  z-index: 10000;
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--text-primary) 15%, transparent);
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}

.md-toolbar__btn {
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.md-toolbar__btn:hover {
  background: var(--code-bg);
}

.md-toolbar__btn--active {
  background: var(--link-color);
  color: var(--bg-primary);
}

.md-toolbar__btn--disabled {
  opacity: 0.35;
  pointer-events: none;
  cursor: default;
}

/* Sidebar mode override: undo floating layout when mounted inside a sidebar panel.
   The .sidebar-panel-content wrapper class is assigned by SidebarManager
   (src/sidebar/sidebar-manager.ts) and is the authoritative container class. */
.sidebar-panel-content .md-toolbar {
  position: static;
  flex-wrap: wrap;
  padding: 12px 8px;
  box-shadow: none;
  border: none;
  background: transparent;
}
`;

/**
 * Unique id for the injected <style> element. Used for idempotent guard (EC-15).
 *
 * @visibleForTesting Exported so that the injectCSS idempotency test can locate
 * the element by id without hardcoding the string in two places.
 */
export const STYLE_ID = "__markable_md_toolbar_css__";

/**
 * Inject the toolbar <style> tag into <head>.
 *
 * Guarded by the element id so rapid enable/disable cycles never produce
 * duplicate <style> tags (EC-15).
 *
 * @visibleForTesting Exported only for idempotency tests — do not call from
 * production code outside onEnable.
 */
export function injectCSS(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOOLBAR_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the toolbar <style> tag injected by injectCSS().
 * No-op when the tag is absent (e.g. onDisable called before onEnable completes).
 *
 * @visibleForTesting Exported only for idempotency tests — do not call from
 * production code outside onDisable.
 */
export function removeCSS(): void {
  document.getElementById(STYLE_ID)?.remove();
}

// ── 5. Format registry ────────────────────────────────────────────────────────

/**
 * All supported inline format identifiers.
 * "erase" is a special action (strips all formatting), not a detectable state.
 */
export type FormatId =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "highlight"
  | "inlineCode"
  | "superscript"
  | "link"
  | "image"
  | "erase";

/**
 * Descriptor for a single inline format.
 *
 * The `open`/`close` fields define the Markdown markers used for wrapping and
 * for text-based detection. When `close` is absent, the format uses the same
 * marker on both sides (e.g. bold uses ** on both).
 */
export interface FormatDef {
  readonly id: FormatId;
  /** Human-readable label; used as button title/tooltip. */
  readonly label: string;
  /** Opening marker (e.g. "**" for bold). Absent for erase, link, image. */
  readonly open?: string;
  /** Closing marker. Defaults to `open` when absent. */
  readonly close?: string;
  /** True for HTML-based formats like <u>…</u>. */
  readonly isHtml?: true;
  /** True for [text](url) link format. Uses special wrap/unwrap logic. */
  readonly isLink?: true;
  /** True for ![alt](url) image format. Uses special wrap/unwrap logic. */
  readonly isImage?: true;
}

/**
 * Record mapping each FormatId to a boolean indicating whether that format is
 * currently active (i.e. the selection overlaps with a wrapped region).
 * The `erase` key is always false — it is an action, not a detectable state.
 */
export type FormatFlags = Record<FormatId, boolean>;

/**
 * Canonical format registry — single source of truth for:
 *   - Button creation order (step_04 iterates FORMATS to build DOM)
 *   - Detection algorithm (step_02 / detectFormats)
 *   - Wrap/unwrap dispatch (step_03 / computeWrap / computeUnwrap)
 *
 * Never hardcode a format list anywhere else. Always iterate this array.
 */
export const FORMATS: readonly FormatDef[] = [
  { id: "bold",          label: "Bold",            open: "**" },
  { id: "italic",        label: "Italic",          open: "*" },
  { id: "underline",     label: "Underline",       open: "<u>",  close: "</u>", isHtml: true },
  { id: "strikethrough", label: "Strikethrough",   open: "~~" },
  { id: "highlight",     label: "Highlight",       open: "==" },
  { id: "inlineCode",    label: "Inline Code",     open: "`" },
  { id: "superscript",   label: "Superscript",     open: "^" },
  { id: "link",          label: "Link",                                          isLink: true },
  { id: "image",         label: "Image",                                         isImage: true },
  { id: "erase",         label: "Erase Formatting" },
];

// ── 6. Format detection ───────────────────────────────────────────────────────

/**
 * Detect which inline formats are active around the given selection range.
 *
 * This is a pure function with no CM6 or DOM dependency — testable with plain
 * strings. It is called on the debounced updateListener tick (step_06) and by
 * the button click handler (step_04) to decide wrap vs unwrap.
 *
 * Algorithm:
 *   1. Extract a context window of CONTEXT_RADIUS characters on each side of the
 *      selection. This keeps the function O(1) regardless of document size.
 *   2. For standard formats: check that the opening marker appears before the
 *      selection start and the closing marker appears after the selection end.
 *   3. Bold/italic disambiguation: the italic detector uses a negative-lookahead
 *      regex to avoid matching a lone `*` that is part of `**`.
 *   4. For HTML and link/image formats: use a regex against the context window
 *      and check that the match spans or contains the selection.
 *
 * @remarks This function intentionally exceeds 30 lines because it exhaustively
 * checks all 10 format types (bold, italic, underline, strikethrough, highlight,
 * inlineCode, superscript, link, image, erase). Each case requires distinct
 * pattern matching logic: standard marker scan, italic disambiguation with
 * list-bullet exclusion, and regex overlap for HTML/link/image formats. There
 * is no meaningful way to reduce the per-format work without obscuring the logic.
 *
 * @param docText - Full document text (CM6 doc.toString(), LF line endings).
 * @param from    - Absolute offset of the selection anchor (sel.from).
 * @param to      - Absolute offset of the selection head (sel.to).
 * @returns       FormatFlags record; erase is always false.
 */
export function detectFormats(
  docText: string,
  from: number,
  to: number,
): FormatFlags {
  // Context window radius: 64 chars on each side is sufficient for all standard
  // inline markers. Long link URLs may occasionally fall outside the window,
  // producing a false-negative — that is an acceptable trade-off for O(1) cost.
  const CONTEXT_RADIUS = 64;
  const ctxStart = Math.max(0, from - CONTEXT_RADIUS);
  const ctxEnd   = Math.min(docText.length, to + CONTEXT_RADIUS);
  const ctx      = docText.slice(ctxStart, ctxEnd);

  // Offsets of from/to translated into the context window coordinates.
  const localFrom = from - ctxStart;
  const localTo   = to   - ctxStart;

  // Whether the call represents a non-empty selection (from < to).
  // For non-empty selections we extend the left/right context search to include
  // markers that start exactly at `from` or end exactly at `to`. This handles
  // the EC-20 multi-line case where the user selects a region beginning with a
  // format marker (e.g. **bold across\nlines** selected from the first *).
  // For zero-width cursors (from === to) we use the strict boundaries.
  const hasSelection = from < to;

  const flags: Partial<FormatFlags> = {};

  for (const fmt of FORMATS) {
    if (fmt.id === "erase") {
      // Erase is an action, not a detectable state — always false.
      flags["erase"] = false;
      continue;
    }

    if (fmt.isLink) {
      // Link detection: find all [text](url) patterns, check overlap.
      flags["link"] = _matchesOverlap(/\[([^\]]*)\]\(([^)]*)\)/g, ctx, ctxStart, from, to);
      continue;
    }

    if (fmt.isImage) {
      // Image detection: find all ![alt](url) patterns, check overlap.
      flags["image"] = _matchesOverlap(/!\[([^\]]*)\]\(([^)]*)\)/g, ctx, ctxStart, from, to);
      continue;
    }

    if (fmt.isHtml) {
      // Underline detection: find all <u>…</u> patterns, check overlap.
      flags["underline"] = _matchesOverlap(/<u>([\s\S]*?)<\/u>/g, ctx, ctxStart, from, to);
      continue;
    }

    // Standard format: check that the opening marker appears in the left context
    // and the closing marker appears in the right context.
    //
    // Left context extension: for non-empty selections, include characters up to
    // localFrom + open.length so that a marker starting exactly at `from` is
    // detected as "opening before/at the selection start". For zero-width cursors
    // the strict ctx.slice(0, localFrom) is used to avoid false positives (AC-2.2).
    const open  = fmt.open!;
    const close = fmt.close ?? fmt.open!;

    if (fmt.id === "italic") {
      // Bold/italic disambiguation (AC-2.4, AC-2.5, H-1 regression):
      //
      // The old parity heuristic (odd star count on each side) produced false
      // positives for `*`-bulleted lists: "* item1\n* item2" has one `*` on each
      // side of the selection, satisfying the odd/odd condition incorrectly.
      //
      // Correct approach: scan for a lone `*` (not part of `**`) that is NOT a
      // list bullet. A `*` is a list bullet when it is at the very start of the
      // document (position 0 in the full docText) OR when the preceding
      // non-whitespace character in the full docText is a newline.
      //
      // Steps:
      //   1. Build left/right context windows (same bounds as other formats).
      //   2. Walk the left context RIGHT-TO-LEFT looking for a lone `*` that is
      //      not a bullet. Use the absolute position in docText to inspect the
      //      character before the `*` in the full document.
      //   3. Walk the right context LEFT-TO-RIGHT looking for the matching lone `*`
      //      closing marker (applying the same not-bullet rule).
      //   4. Only set italic: true when BOTH markers are found.
      const leftBound  = hasSelection ? localFrom + open.length                 : localFrom;
      const rightBound = hasSelection ? Math.max(0, localTo - close.length + 1) : localTo;
      const leftCtx    = ctx.slice(0, leftBound);
      const rightCtx   = ctx.slice(rightBound);

      /**
       * Return true when the `*` at absolute position `absPos` in docText is a
       * list bullet rather than an italic marker.
       *
       * A list bullet `*` satisfies TWO conditions simultaneously:
       *   (a) It is at the start of a line: either at docText position 0,
       *       or preceded only by optional spaces/tabs then a newline.
       *   (b) It is immediately followed by a space or tab (the list separator).
       *       This is the critical distinction: "* item" is a bullet,
       *       but "*word*" is italic even when `*` appears at the start of a line.
       *
       * Both conditions must hold. Checking only (a) would incorrectly exclude
       * `*word*` on a line by itself (e.g. the first character of the document).
       */
      function _isListBullet(absPos: number): boolean {
        // Condition (b): must be followed by a space or tab.
        const charAfter = docText[absPos + 1];
        if (charAfter !== " " && charAfter !== "\t") return false;

        // Condition (a): must be at start-of-line.
        let i = absPos - 1;
        // Skip optional leading spaces/tabs on the line.
        while (i >= 0 && (docText[i] === " " || docText[i] === "\t")) {
          i--;
        }
        // At start-of-document or after a newline → it is at start-of-line.
        return i < 0 || docText[i] === "\n";
      }

      /**
       * Scan `s` right-to-left for the rightmost contiguous `*` run that has an
       * odd length (meaning one italic `*` remains after all `**` bold pairs are
       * consumed). Returns the absolute document position of the run start, or -1
       * when no such run is found or all candidates are list bullets.
       *
       * Star-run parity rule:
       *   - N=1 → 1 lone `*`  → italic present
       *   - N=2 → 0 lone `*`  → bold only
       *   - N=3 → 1 lone `*`  → bold + italic
       *   - N=4 → 0 lone `*`  → bold only (two pairs)
       *
       * @param s           - The context substring to scan.
       * @param baseAbsPos  - Absolute document offset of s[0].
       * @returns Absolute document position of the matching run start, or -1.
       */
      function _findItalicMarkerInCtx(s: string, baseAbsPos: number): number {
        let i = s.length - 1;
        while (i >= 0) {
          if (s[i] !== "*") { i--; continue; }
          // Found the rightmost char of a star-run. Expand leftward to get the run.
          let runEnd = i;
          while (i > 0 && s[i - 1] === "*") i--;
          const runStart  = i;
          const runLength = runEnd - runStart + 1;

          // An odd-length run has exactly one lone italic `*` after bold pairs
          // are consumed (runLength % 2 === 1).
          if (runLength % 2 === 1) {
            const absRunStart = baseAbsPos + runStart;
            // Exclude list bullets: a lone `*` at start-of-line followed by space.
            if (!_isListBullet(absRunStart)) {
              return absRunStart;
            }
          }
          i = runStart - 1;
        }
        return -1;
      }

      const foundLeft  = _findItalicMarkerInCtx(leftCtx, ctxStart) !== -1;

      // For the right context, use baseAbsPos = absolute start of rightCtx.
      const rightCtxAbsStart = ctxStart + rightBound;
      const foundRight = _findItalicMarkerInCtx(rightCtx, rightCtxAbsStart) !== -1;

      flags["italic"] = foundLeft && foundRight;
      continue;
    }

    // For all other standard formats (bold, strikethrough, highlight, inlineCode,
    // superscript): presence of open marker in left context AND close marker in
    // right context implies the selection is inside this format.
    //
    // For non-empty selections we also extend the right context to include the
    // closing marker that ends exactly at `to`. For example, if the user selects
    // from the opening ** to the end of the closing **, the closing ** starts
    // one position before `to` and `ctx.slice(localTo)` would miss it.
    const leftBound  = hasSelection ? localFrom + open.length          : localFrom;
    const rightBound = hasSelection ? Math.max(0, localTo - close.length + 1) : localTo;
    const leftCtx    = ctx.slice(0, leftBound);
    const rightCtx   = ctx.slice(rightBound);
    flags[fmt.id]    = leftCtx.includes(open) && rightCtx.includes(close);
  }

  return flags as FormatFlags;
}

/**
 * Test whether a regex match in the context window overlaps the absolute
 * selection range [from, to].
 *
 * "Overlaps" means the match either:
 *   - Contains the selection entirely (matchStart <= from && matchEnd >= to), OR
 *   - The selection contains the entire match, OR
 *   - The selection overlaps part of the match (partial overlap).
 *
 * For toolbar purposes (detecting if the cursor/selection is inside a format)
 * we use the definition: matchStart <= from AND matchEnd >= to, which means
 * the match fully wraps the selection. This is the most intuitive: if I select
 * text inside a link, the link detection fires.
 *
 * @param re       - Global regex to run against the context string.
 * @param ctx      - Context substring of the document.
 * @param ctxStart - Absolute offset of ctx[0] in the document.
 * @param from     - Absolute selection start.
 * @param to       - Absolute selection end.
 * @returns        true if any match fully wraps the selection.
 */
function _matchesOverlap(
  re: RegExp,
  ctx: string,
  ctxStart: number,
  from: number,
  to: number,
): boolean {
  let m: RegExpExecArray | null;
  while ((m = re.exec(ctx)) !== null) {
    const matchStart = ctxStart + m.index;
    const matchEnd   = ctxStart + m.index + m[0].length;
    // The selection is fully inside this match.
    if (matchStart <= from && matchEnd >= to) {
      return true;
    }
  }
  return false;
}

// ── 7. Wrap / Unwrap / Erase pure functions ───────────────────────────────────

/**
 * Result of computeWrap: describes the text to insert and the resulting selection.
 * All offsets are RELATIVE to the start of the replaced selection range.
 */
export interface WrapResult {
  /** The text to replace the current selection with. */
  insert: string;
  /** New selection anchor, relative to the start of the original selection. */
  selFrom: number;
  /** New selection head, relative to the start of the original selection. */
  selTo: number;
}

/**
 * Result of computeUnwrap: describes the replacement and the new absolute selection.
 */
export interface UnwrapResult {
  /** Absolute document offset where the replacement starts (includes opening marker). */
  changeFrom: number;
  /** Absolute document offset where the replacement ends (includes closing marker). */
  changeTo: number;
  /** The inner text to replace the marked region with (markers removed). */
  insert: string;
  /** Absolute selection anchor after the unwrap. */
  selFrom: number;
  /** Absolute selection head after the unwrap. */
  selTo: number;
}

/**
 * Result of computeErase: the stripped text and a flag indicating whether any
 * formatting was actually removed.
 */
export interface EraseResult {
  /** The selected text with all format wrappers stripped. */
  insert: string;
  /** False when no wrappers were found — caller should skip view.dispatch (EC-11). */
  changed: boolean;
}

/**
 * Compute the text to insert when wrapping selected text with a format.
 *
 * This function is synchronous and pure. It does NOT call resolveUrl — the
 * caller (handleButtonClick) awaits resolveUrl() first and passes the result
 * as `url`. This keeps computeWrap deterministic and testable (EC-21).
 *
 * @param selectedText - The currently selected document text.
 * @param fmt          - The FormatDef describing how to wrap.
 * @param url          - Resolved URL for link/image formats (optional).
 * @returns            WrapResult with insert text and relative selection offsets.
 */
export function computeWrap(
  selectedText: string,
  fmt: FormatDef,
  url?: string,
): WrapResult {
  if (fmt.isLink) {
    // [selectedText](url)
    const resolvedUrl = url ?? "";
    const insert = "[" + selectedText + "](" + resolvedUrl + ")";
    return {
      insert,
      selFrom: 1,                          // after "["
      selTo:   1 + selectedText.length,    // before "]"
    };
  }

  if (fmt.isImage) {
    // ![selectedText](url)
    const resolvedUrl = url ?? "";
    const insert = "![" + selectedText + "](" + resolvedUrl + ")";
    return {
      insert,
      selFrom: 2,                          // after "!["
      selTo:   2 + selectedText.length,    // before "]"
    };
  }

  // Standard format: open + selectedText + close
  // EC-21: selectedText is inserted verbatim — no escaping of any characters.
  const open  = fmt.open!;
  const close = fmt.close ?? fmt.open!;
  const insert = open + selectedText + close;
  return {
    insert,
    selFrom: open.length,
    selTo:   open.length + selectedText.length,
  };
}

/**
 * Shared helper for regex-based unwrap branches (HTML, link, image).
 *
 * Scans the context window for a match that fully wraps the selection range
 * [from, to] and returns the corresponding UnwrapResult using the capture
 * group at `innerGroupIndex` as the replacement text (inner content).
 *
 * Extracted to eliminate three copy-pasted scan blocks in computeUnwrap (M-1).
 *
 * @param re             - Global regex to match the full wrapping construct.
 * @param docText        - Full document text.
 * @param from           - Absolute selection start.
 * @param to             - Absolute selection end.
 * @param searchRadius   - Characters to scan on each side of [from, to].
 * @param innerGroupIndex - Index of the capture group that yields the inner text
 *                         (e.g. 1 for the text inside `<u>(inner)</u>`).
 * @returns UnwrapResult when a wrapping match is found, null otherwise.
 */
function _findRegexUnwrap(
  re: RegExp,
  docText: string,
  from: number,
  to: number,
  searchRadius: number,
  innerGroupIndex: number,
): UnwrapResult | null {
  const ctxStart = Math.max(0, from - searchRadius);
  const ctxEnd   = Math.min(docText.length, to + searchRadius);
  const ctx      = docText.slice(ctxStart, ctxEnd);

  let m: RegExpExecArray | null;
  while ((m = re.exec(ctx)) !== null) {
    const matchStart = ctxStart + m.index;
    const matchEnd   = ctxStart + m.index + m[0].length;
    if (matchStart <= from && matchEnd >= to) {
      const inner = m[innerGroupIndex];
      return {
        changeFrom: matchStart,
        changeTo:   matchEnd,
        insert:     inner,
        selFrom:    matchStart,
        selTo:      matchStart + inner.length,
      };
    }
  }
  return null;
}

/**
 * Compute the replacement needed to remove a format wrapper from the selection.
 *
 * Returns null if the markers cannot be found in the search radius. This should
 * not happen when detectFormats returned true, but is a defensive guard.
 *
 * Bold/italic disambiguation for unwrap: when unwrapping italic, the backward
 * search must find a lone `*` (not part of `**`). This is handled by collecting
 * all `*` positions in the left context and filtering out those adjacent to
 * another `*`, then taking the rightmost survivor.
 *
 * @remarks This function intentionally exceeds 30 lines because it handles N
 * mutually exclusive format types (HTML, link, image, italic, standard), each
 * requiring distinct regex patterns and disambiguation logic that cannot be
 * collapsed without losing clarity.
 *
 * @param docText - Full document text.
 * @param from    - Absolute selection start (sel.from).
 * @param to      - Absolute selection end (sel.to).
 * @param fmt     - The FormatDef to remove.
 * @returns       UnwrapResult, or null when markers are not found.
 */
export function computeUnwrap(
  docText: string,
  from: number,
  to: number,
  fmt: FormatDef,
): UnwrapResult | null {
  // Search radius is 128 chars — doubled vs detection because we need the full
  // marker at the boundary of the selection, not just its presence nearby.
  const SEARCH_RADIUS = 128;

  if (fmt.isHtml) {
    // Underline: use _findRegexUnwrap to find the <u>…</u> span containing
    // the selection. Capture group 1 is the inner text.
    return _findRegexUnwrap(/<u>([\s\S]*?)<\/u>/g, docText, from, to, SEARCH_RADIUS, 1);
  }

  if (fmt.isLink) {
    // Link: find [text](url) span. Capture group 1 is the visible text.
    return _findRegexUnwrap(/\[([^\]]*)\]\(([^)]*)\)/g, docText, from, to, SEARCH_RADIUS, 1);
  }

  if (fmt.isImage) {
    // Image: find ![alt](url) span.
    // Capture group 1 is the alt text only; the URL (group 2) is discarded.
    return _findRegexUnwrap(/!\[([^\]]*)\]\(([^)]*)\)/g, docText, from, to, SEARCH_RADIUS, 1);
  }

  // Standard format: search backward for open marker, forward for close marker.
  const open  = fmt.open!;
  const close = fmt.close ?? fmt.open!;

  // L-3 fix: extend the left window by open.length so that a marker starting
  // exactly at `from` is captured. Without this, docText.slice(x, from) would
  // exclude the `*` that begins at position `from`, causing computeUnwrap to
  // return null even though detectFormats correctly identified the format.
  const leftSearchStart = Math.max(0, from - SEARCH_RADIUS - open.length);
  const leftContext     = docText.slice(leftSearchStart, from);
  const rightContext    = docText.slice(to, Math.min(docText.length, to + SEARCH_RADIUS));

  let openAbsStart: number;

  if (fmt.id === "italic") {
    // Italic disambiguation: find the rightmost lone `*` in the left context
    // that is NOT a list bullet. A lone `*` is one where neither the preceding
    // nor the following character is `*`. A list bullet is a `*` that is either
    // at document position 0 or preceded only by spaces/tabs then a newline.
    let foundLocalIdx = -1;
    for (let i = leftContext.length - 1; i >= 0; i--) {
      if (leftContext[i] !== "*") continue;
      const prevChar = i > 0 ? leftContext[i - 1] : "";
      const nextChar = i < leftContext.length - 1 ? leftContext[i + 1] : "";
      // Skip stars that are part of a `**` bold pair.
      if (prevChar === "*" || nextChar === "*") continue;
      // Skip list bullets: walk back past spaces/tabs to check for newline or BOD.
      const absPos = leftSearchStart + i;
      let j = absPos - 1;
      while (j >= 0 && (docText[j] === " " || docText[j] === "\t")) j--;
      if (j < 0 || docText[j] === "\n") continue; // it's a bullet — skip
      // This is a valid italic opener.
      foundLocalIdx = i;
      break; // rightmost (we search right-to-left) is the first match
    }
    if (foundLocalIdx === -1) return null;
    openAbsStart = leftSearchStart + foundLocalIdx;
  } else {
    // For all other standard formats, use lastIndexOf to find the rightmost marker.
    const openIdx = leftContext.lastIndexOf(open);
    if (openIdx === -1) return null;
    openAbsStart = leftSearchStart + openIdx;
  }

  const openAbsEnd = openAbsStart + open.length;

  // Find the first occurrence of the closing marker in the right context.
  const closeIdx = rightContext.indexOf(close);
  if (closeIdx === -1) return null;

  const closeAbsStart = to + closeIdx;
  const closeAbsEnd   = closeAbsStart + close.length;

  // The inner text is everything between the two markers.
  const innerText = docText.slice(openAbsEnd, closeAbsStart);

  return {
    changeFrom: openAbsStart,
    changeTo:   closeAbsEnd,
    insert:     innerText,
    selFrom:    openAbsStart,
    selTo:      openAbsStart + innerText.length,
  };
}

/**
 * Compute the replacement needed to strip all inline format markers from a
 * selected region of text.
 *
 * The algorithm iterates a fixed set of stripping regexes in a loop until the
 * text stabilises (no further changes in one full pass). This handles nested
 * formats (EC-12) with at most a handful of iterations.
 *
 * EC-11: When no wrappers are found, `changed` is false and the caller should
 * skip view.dispatch to avoid creating an empty undo entry.
 * EC-13: Link syntax [text](url) → text; image ![alt](url) → alt.
 *
 * @param docText - Full document text (used only to extract the slice).
 * @param from    - Absolute selection start.
 * @param to      - Absolute selection end.
 * @returns       EraseResult with stripped text and changed flag.
 */
export function computeErase(
  docText: string,
  from: number,
  to: number,
): EraseResult {
  const original = docText.slice(from, to);
  let text = original;

  // Iterate until no further stripping occurs (handles nested formats, EC-12).
  for (;;) {
    const prev = text;
    // Apply all stripping patterns in decreasing specificity order.
    // IMPORTANT: bold (** … **) must come before italic (* … *) — the italic
    // regex uses negative lookahead/lookbehind to exclude ** at both ends, but
    // if bold markers were left in place first the regex could still partially
    // match a ** pair and leave stray * characters. Running bold first ensures
    // those ** sequences are already consumed before the italic pass runs.
    // Image must come before link so that "![alt](url)" is matched as a whole
    // by the image pattern before the bare "[alt](url)" link pattern can run
    // and leave a leading "!" in the output (EC-13 / AC-3.12).
    text = text.replace(/\*\*([\s\S]*?)\*\*/g, "$1");                               // bold
    // M-2: Use negative lookahead AND lookbehind so the italic regex does not
    // partially match ** bold markers. Without the lookahead on the closing *,
    // "** text **" could be misread after bold stripping leaves residual *.
    text = text.replace(/(?<!\*)\*([\s\S]*?)(?<!\*)\*(?!\*)/g, "$1"); // italic (lone *)
    text = text.replace(/<u>([\s\S]*?)<\/u>/g, "$1");                // underline
    text = text.replace(/~~([\s\S]*?)~~/g, "$1");                    // strikethrough
    text = text.replace(/==([\s\S]*?)==/g, "$1");                    // highlight
    text = text.replace(/`([\s\S]*?)`/g, "$1");                      // inline code
    text = text.replace(/\^([\s\S]*?)\^/g, "$1");                    // superscript
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");            // image → alt (before link)
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");             // link → text
    if (text === prev) break; // No change in this pass — done.
  }

  return { insert: text, changed: text !== original };
}

// ── 8. resolveUrl ─────────────────────────────────────────────────────────────

/**
 * Determine a URL for a link or image insertion.
 *
 * Strategy:
 *   1. Try to read the clipboard. If it looks like a URL, use it silently (EC-7).
 *   2. If the clipboard is unavailable or does not contain a URL, fall back to
 *      window.prompt (EC-8).
 *   3. If the user cancels the prompt, return null (EC-9) — the caller aborts.
 *
 * This function is not pure (it reads the clipboard and may show a dialog).
 * Tests mock navigator.clipboard and window.prompt via vi.stubGlobal.
 *
 * @returns The resolved URL string, or null if the user cancelled.
 */
export async function resolveUrl(): Promise<string | null> {
  // Step 1: try clipboard.
  try {
    const clipText = (await navigator.clipboard.readText()).trim();
    if (isUrlLike(clipText)) {
      return clipText;
    }
  } catch {
    // Clipboard read denied or unavailable — fall through to prompt.
  }

  // Step 2: fall back to prompt.
  const result = window.prompt("Enter URL:");
  if (result === null) return null; // User cancelled (EC-9).
  return result;
}

/**
 * Test whether a string looks like a URL for the purpose of clipboard detection.
 *
 * Intentionally conservative: only strings starting with a well-known scheme
 * or a root-relative path are considered URLs. Plain domain names like
 * "example.com" are NOT matched because they cannot be distinguished from
 * regular prose in a clipboard string.
 *
 * Exported for testability (used by resolveUrl, no DOM dependency).
 *
 * @param s - The trimmed candidate string.
 * @returns   True when the string starts with https://, http://, ftp://, or /.
 */
export function isUrlLike(s: string): boolean {
  return (
    s.startsWith("https://") ||
    s.startsWith("http://")  ||
    s.startsWith("ftp://")   ||
    s.startsWith("/")
  );
}

// ── 9. DOM helpers ────────────────────────────────────────────────────────────

/**
 * Button label characters for each format button.
 * Using conventional single-letter labels for the text formats and Unicode
 * symbols for link, image, and erase.
 */
const BUTTON_LABELS: Record<FormatId, string> = {
  bold:          "B",
  italic:        "I",
  underline:     "U",
  strikethrough: "S",
  highlight:     "H",
  inlineCode:    "`·`",
  superscript:   "x²",
  link:          "⌘",
  image:         "⊞",
  erase:         "✕",
};

/**
 * Lazily retrieve the @codemirror/view module from the window.__CM_VIEW__ global.
 *
 * NOT imported at module evaluation time — doing so would fail in test
 * environments where window.__CM_VIEW__ is not defined. Called only inside
 * onEnable and factory functions that run in a real runtime context where the
 * global is guaranteed to be present (assigned by cm-globals.ts before any
 * plugin IIFE runs).
 *
 * @returns The @codemirror/view module object from the shared CM6 instance.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function getCmView(): typeof import("@codemirror/view") {
  return (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Handle a toolbar button click for the given format id.
 *
 * Reads the live EditorView from window.__MARKABLE_EDITOR_VIEW__ at call time
 * (EC-23) so it always targets the active tab's editor. One view.dispatch call
 * per click ensures a single undo step (EC-6).
 *
 * @remarks This function intentionally exceeds 30 lines because the URL
 * resolution path (link/image buttons) is inherently async and requires a
 * try/finally block to release the _clickInFlight guard. Extracting the async
 * URL resolution into a helper keeps this function at roughly the same line
 * count and the guard/release logic most clearly belongs here where the flag
 * is also set. See the inline comment for the guard's rationale (L-4).
 *
 * @param fmtId - The format button that was clicked.
 */
async function handleButtonClick(fmtId: FormatId): Promise<void> {
  // L-4: Double-click guard for async link/image resolution. resolveUrl() is
  // async and may await clipboard access or show a prompt. Without this guard,
  // two rapid clicks on the Link or Image button would each start an independent
  // async invocation — resulting in two prompt dialogs or two overlapping
  // dispatches. The guard is set before the await and cleared in a finally block
  // so it is always released even if an error occurs.
  if (_clickInFlight) return;

  // Prefer the live window global (EC-23: always targets the active tab's view).
  // Fall back to the module-level _view reference captured by the updateListener,
  // which may lag by one transaction but is acceptable for edge cases.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const view = ((window as any).__MARKABLE_EDITOR_VIEW__ as
    | EditorViewType
    | undefined) ?? _view ?? undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (!view) return;

  const state  = view.state;
  const sel    = state.selection.main;

  // EC-1 / EC-2: empty selection guard — no-op for all formats.
  if (sel.empty) return;

  const docText = state.doc.toString();

  if (fmtId === "erase") {
    const result = computeErase(docText, sel.from, sel.to);
    // EC-11: skip dispatch when nothing changed to avoid a spurious undo entry.
    if (!result.changed) return;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: result.insert },
      selection: { anchor: sel.from, head: sel.from + result.insert.length },
    });
    return;
  }

  const fmt = FORMATS.find((f) => f.id === fmtId);
  if (!fmt) return;

  const flags = detectFormats(docText, sel.from, sel.to);

  if (flags[fmtId]) {
    // Format is active — toggle it off by unwrapping.
    const result = computeUnwrap(docText, sel.from, sel.to, fmt);
    if (!result) return; // Defensive: markers not found.
    view.dispatch({
      changes:   { from: result.changeFrom, to: result.changeTo, insert: result.insert },
      selection: { anchor: result.selFrom, head: result.selTo },
    });
  } else {
    // Format is inactive — apply it by wrapping.
    // For link/image, resolve the URL first; abort if user cancels (EC-9).
    // The _clickInFlight flag is set here (inside the async branch only) so
    // that rapid double-clicks on link/image buttons do not open two prompts.
    let url: string | undefined;
    if (fmt.isLink || fmt.isImage) {
      _clickInFlight = true;
      try {
        const resolved = await resolveUrl();
        if (resolved === null) return;
        url = resolved;
      } finally {
        _clickInFlight = false;
      }
    }
    const selectedText = docText.slice(sel.from, sel.to);
    const result       = computeWrap(selectedText, fmt, url);
    view.dispatch({
      changes:   { from: sel.from, to: sel.to, insert: result.insert },
      selection: {
        anchor: sel.from + result.selFrom,
        head:   sel.from + result.selTo,
      },
    });
  }
}

/**
 * Build the toolbar DOM element.
 *
 * Creates the container div and all 10 format buttons in FORMATS order.
 * Attaches a single delegated mousedown listener (not click) to preserve
 * editor focus (FR-4) — preventDefault on mousedown prevents the editor
 * from losing focus when a toolbar button is pressed.
 *
 * @remarks This function intentionally exceeds 30 lines because it must
 * iterate the full FORMATS array to create and configure each button (id,
 * class, title, textContent, data-format attribute) and then attach the
 * delegated mousedown event listener — all steps that belong in a single
 * factory function rather than being split across helpers.
 *
 * @returns The fully-wired toolbar HTMLElement.
 */
function buildToolbarDOM(): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.id        = "__markable_md_toolbar__";
  toolbar.className = "md-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Formatting");

  // Create one button per format entry in FORMATS order.
  for (const fmt of FORMATS) {
    const btn          = document.createElement("button");
    btn.type           = "button";
    btn.className      = "md-toolbar__btn";
    btn.dataset["format"] = fmt.id;
    btn.title          = fmt.label;
    btn.textContent    = BUTTON_LABELS[fmt.id];
    toolbar.appendChild(btn);
  }

  // Single delegated mousedown listener on the container.
  // Using mousedown + preventDefault is the standard pattern for toolbars that
  // must not steal focus from the editor (FR-4).
  toolbar.addEventListener("mousedown", (e: MouseEvent) => {
    // Prevent the editor from losing focus on button press.
    e.preventDefault();
    const btn = (e.target as Element).closest("[data-format]") as HTMLElement | null;
    if (!btn) return;
    const fmtId = btn.dataset["format"] as FormatId;
    void handleButtonClick(fmtId);
  });

  return toolbar;
}

// ── 10. DOM update functions ──────────────────────────────────────────────────

/**
 * Update the active-state CSS class on each toolbar button based on the current
 * FormatFlags.
 *
 * Called by the debounced updateListener tick. Exported for unit testing with
 * a JSDOM-provided NodeList (step_07 tests create buttons via document).
 *
 * Complexity: O(n) where n = 10 (number of buttons) — negligible.
 *
 * @param flags   - FormatFlags from the latest detectFormats call.
 * @param buttons - The stored NodeList of all toolbar buttons, or null.
 */
export function updateActiveButtons(
  flags: FormatFlags,
  buttons: NodeListOf<HTMLButtonElement> | null,
): void {
  if (!buttons) return;
  for (const btn of buttons) {
    const fmtId = btn.dataset["format"] as FormatId | undefined;
    if (!fmtId) continue;
    if (flags[fmtId]) {
      btn.classList.add("md-toolbar__btn--active");
    } else {
      btn.classList.remove("md-toolbar__btn--active");
    }
  }
}

/**
 * Toggle the disabled CSS class on all toolbar buttons.
 *
 * In sidebar mode, buttons are physically non-interactive (pointer-events: none
 * via CSS) when the selection is empty (EC-2). This prevents accidental clicks
 * and gives clear visual feedback.
 *
 * @visibleForTesting Exported only for unit tests — do not call directly from
 * production code outside the updateListener and sidebar render() callback.
 *
 * @param isEmpty - True when the editor selection is empty (sel.empty).
 * @param buttons - The stored NodeList of all toolbar buttons, or null.
 */
export function updateDisabledState(
  isEmpty: boolean,
  buttons: NodeListOf<HTMLButtonElement> | null,
): void {
  if (!buttons) return;
  for (const btn of buttons) {
    if (isEmpty) {
      btn.classList.add("md-toolbar__btn--disabled");
    } else {
      btn.classList.remove("md-toolbar__btn--disabled");
    }
  }
}

/**
 * Update the position of the floating toolbar relative to the current selection.
 *
 * In floating mode this is called synchronously on every selection change (no
 * debounce) because visual lag in the bubble position is unacceptable.
 *
 * Positioning strategy:
 *   1. Preferred: directly above the selection anchor.
 *   2. EC-14 flip: if preferred position is above the viewport (top < 0), place
 *      below the selection instead.
 *   3. Left edge clamped so the toolbar never overflows the viewport right edge.
 *
 * @remarks This function intentionally exceeds 30 lines because it must handle
 * three distinct positioning states (empty selection → hide, outside viewport →
 * hide, visible → compute top/left with flip and clamp), each needing its own
 * early return or branch. Collapsing these into fewer lines would reduce clarity.
 *
 * @param view      - The live EditorView from the updateListener update object.
 * @param toolbarEl - The floating toolbar DOM element.
 */
function updatePosition(view: EditorViewType, toolbarEl: HTMLElement): void {
  const sel = view.state.selection.main;

  // Hide toolbar when selection is empty (EC-1).
  if (sel.empty) {
    toolbarEl.style.display = "none";
    return;
  }

  const coords = view.coordsAtPos(sel.from);
  // Selection outside viewport — hide and bail.
  if (!coords) {
    toolbarEl.style.display = "none";
    return;
  }

  // Use offsetHeight with fallback for the first call before paint (offsetHeight === 0).
  const toolbarHeight = toolbarEl.offsetHeight || 36;
  const toolbarWidth  = toolbarEl.offsetWidth  || 280;
  const OFFSET        = 8;

  // Preferred: above the selection anchor.
  let top  = coords.top - toolbarHeight - OFFSET;
  let left = coords.left;

  // EC-14: flip below the selection when there is no room above.
  if (top < 0) {
    top = coords.bottom + OFFSET;
  }

  // Clamp so the toolbar does not overflow the right edge of the viewport.
  const maxLeft = window.innerWidth - toolbarWidth - 8;
  if (left > maxLeft) left = maxLeft;
  if (left < 0)       left = 0;

  toolbarEl.style.top     = `${top}px`;
  toolbarEl.style.left    = `${left}px`;
  toolbarEl.style.display = "flex";
}

// ── 11. CM6 listener factory ──────────────────────────────────────────────────

/**
 * Build the CM6 updateListener extension for the Markdown Toolbar plugin.
 *
 * This is a factory function rather than a module-level constant so that
 * getCmView() is not called at module-evaluation time. Calling it at module
 * load would fail in test environments where window.__CM_VIEW__ is undefined.
 * The factory is invoked inside onEnable(), which only runs in a real
 * Tauri/browser context where the global is guaranteed to be present.
 *
 * Two behaviours at different rates:
 *   - Synchronous: floating toolbar repositioned on every selection change.
 *     coordsAtPos is O(log lines) — cheap enough for synchronous execution.
 *   - Debounced (DEBOUNCE_MS): active-state detection + disabled-state update.
 *     doc.toString() is O(document size); worth debouncing to ~6-7 calls/second.
 *
 * Snapshot rationale: docText and sel are captured BEFORE the setTimeout.
 * CM6 may advance to newer transactions during the 150 ms window; reading them
 * inside the callback would use stale state.
 *
 * @remarks This function intentionally exceeds 30 lines because it contains two
 * distinct real-time paths inside the same listener callback: synchronous
 * position update (coordsAtPos) and debounced active-state detection. Splitting
 * them into separate extensions would require two CM6 compartment entries and
 * more complex teardown logic. A single listener with clear inline section
 * comments is the cleanest approach given the project's architecture pattern.
 *
 * @returns A CM6 Extension (EditorView.updateListener instance).
 */
function buildUpdateListener() {
  const { EditorView } = getCmView();

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;

    // Always capture the latest view reference. This is cheap and ensures the
    // reference stays current even across tab switches.
    _view = update.view;

    const docChanged = update.docChanged;
    const selChanged = update.selectionSet;

    if (!docChanged && !selChanged) return;

    // ── Synchronous: reposition floating toolbar ──────────────────────────────
    if (_settings.toolbarMode === "floating" && _toolbarEl) {
      updatePosition(update.view, _toolbarEl);
    }

    // ── Debounced: active state and disabled state ────────────────────────────
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    // Snapshot immutable values before the async delay (see function comment).
    const docText = update.state.doc.toString();
    const sel     = update.state.selection.main;
    const isEmpty = sel.empty;

    _debounceTimer = setTimeout(() => {
      // Guard: the plugin may have been disabled during the 150 ms window (EC-16).
      if (!_enabled) return;

      const flags = detectFormats(docText, sel.from, sel.to);
      updateActiveButtons(flags, _buttons);

      // Sidebar mode only: grey out buttons when selection is empty (EC-2).
      if (_settings.toolbarMode === "sidebar") {
        updateDisabledState(isEmpty, _buttons);
      }
    }, DEBOUNCE_MS);
  });
}

// ── 12. Plugin export ─────────────────────────────────────────────────────────

/**
 * Activate the Markdown Toolbar plugin.
 *
 * Loads settings, injects CSS, builds the toolbar DOM, registers the CM6
 * updateListener, and mounts the toolbar in either floating or sidebar mode
 * depending on the resolved `toolbarMode` setting.
 *
 * @remarks This function intentionally exceeds 30 lines because it branches
 * across two mutually exclusive modes (floating vs sidebar), each requiring
 * distinct setup (body.appendChild vs api.registerSidebarPanel with a full
 * descriptor object including render/destroy callbacks). Collapsing the branch
 * into a smaller helper would scatter the mode-specific setup logic.
 *
 * @param api - The MarkablePluginAPI instance provided by the plugin loader.
 */
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  _enabled = true;

  // Load and validate persisted settings (EC-18, EC-19).
  const raw = await api.loadSettings();
  _settings = mergeWithDefaults(raw);

  // Inject toolbar CSS (idempotent, guarded by style id — EC-15).
  injectCSS();

  // Build the toolbar DOM element and store the button NodeList.
  _toolbarEl = buildToolbarDOM();
  _buttons   = _toolbarEl.querySelectorAll<HTMLButtonElement>(".md-toolbar__btn");

  // Register the CM6 updateListener extension.
  api.addExtensions([buildUpdateListener()]);

  if (_settings.toolbarMode === "floating") {
    // Floating mode: append to body, initially hidden until a selection appears.
    document.body.appendChild(_toolbarEl);
    _toolbarEl.style.display = "none";
  } else {
    // Sidebar mode: register a sidebar panel. The render() callback mounts
    // _toolbarEl into the provided container. The sidebarDescriptor is created
    // here (not at module level) to capture the current _settings.sidebarSide
    // value resolved from mergeWithDefaults above.
    const sidebarDescriptor = {
      id:           "markdown-toolbar",
      title:        "Markdown Toolbar",
      side:         _settings.sidebarSide,
      defaultWidth: 220,

      render(container: HTMLElement): void {
        // Mount the pre-built toolbar element into the sidebar container.
        // _toolbarEl was created by buildToolbarDOM() above and is non-null here.
        if (_toolbarEl) {
          container.appendChild(_toolbarEl);
        }

        // Perform initial disabled-state update.
        // EC-22: if __MARKABLE_EDITOR_VIEW__ is undefined at render time (e.g.
        // editor not yet initialised), treat selection as empty.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as
          | EditorViewType
          | undefined;
        /* eslint-enable @typescript-eslint/no-explicit-any */
        const selEmpty = liveView ? liveView.state.selection.main.empty : true;
        updateDisabledState(selEmpty, _buttons);
      },

      destroy(_container: HTMLElement): void {
        // The container DOM is removed by SidebarManager after this callback.
        // Null both references to prevent onDisable from calling .remove() on
        // a detached node (would be a no-op, but is confusing).
        _toolbarEl = null;
        _buttons   = null;
      },
    };

    api.registerSidebarPanel(sidebarDescriptor);
    _sidebarPanelRegistered = true;
  }
}

/**
 * Deactivate the Markdown Toolbar plugin.
 *
 * Performs the exact reverse of onEnable: cancels the debounce timer, removes
 * the CM6 extension, removes the floating toolbar DOM (or unregisters the
 * sidebar panel), removes injected CSS, and resets all module-level state so
 * the next onEnable call starts from a known-clean state (NFR-3).
 *
 * @remarks This function intentionally exceeds 30 lines because it must
 * conditionally handle floating vs sidebar teardown paths and reset all module-
 * level variables individually. The per-variable resets are intentionally
 * explicit — a loop over an object would obscure what is being reset and why.
 *
 * @param api - The MarkablePluginAPI instance provided by the plugin loader.
 */
function onDisable(api: MarkablePluginAPI): void {
  _enabled = false;

  // Cancel any in-flight debounce to prevent stale active-state updates after
  // the buttons have been removed from the DOM (EC-16).
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  // Remove the CM6 extension from the editor's Compartment.
  api.removeExtensions();

  // Remove the floating toolbar from the DOM (EC-16).
  // Not called in sidebar mode — the SidebarManager removes the container.
  if (_toolbarEl && _settings.toolbarMode === "floating") {
    _toolbarEl.remove();
  }

  // Unregister the sidebar panel only when it was registered (EC-17).
  if (_sidebarPanelRegistered) {
    api.unregisterSidebarPanel("markdown-toolbar");
    _sidebarPanelRegistered = false;
  }

  // Remove the injected CSS <style> tag.
  removeCSS();

  // Reset all module-level state to initial values for a clean next onEnable.
  // _clickInFlight is reset here in case onDisable fires while a link/image
  // resolveUrl() await is in progress (e.g. user disables plugin mid-prompt).
  _toolbarEl      = null;
  _buttons        = null;
  _view           = null;
  _settings       = { ...DEFAULT_SETTINGS };
  _clickInFlight  = false;
}

/**
 * Markdown Toolbar plugin export object.
 *
 * onEnable sequence:
 *   1. _enabled = true; load + merge settings.
 *   2. Inject CSS (idempotent).
 *   3. Build toolbar DOM; store button NodeList.
 *   4. Register CM6 updateListener via api.addExtensions().
 *   5a. Floating: append to body, hide.
 *   5b. Sidebar: register panel via api.registerSidebarPanel().
 *
 * onDisable sequence (exact reversal):
 *   1. _enabled = false; cancel debounce.
 *   2. api.removeExtensions().
 *   3a. Floating: remove toolbar from DOM.
 *   3b. Sidebar: api.unregisterSidebarPanel() (if registered).
 *   4. Remove CSS.
 *   5. Reset all module-level state.
 */
export default {
  id:             "markdown-toolbar",
  name:           "Markdown Toolbar",
  version:        "1.0.0",
  description:    "Formatting toolbar for common Markdown styles",
  detail:
    "Provides a 10-button toolbar for applying and removing inline Markdown formatting: " +
    "bold, italic, underline, strikethrough, highlight, inline code, superscript, link, " +
    "image, and erase formatting. Available as a floating bubble above the selection " +
    "(default) or as a docked sidebar panel.",
  sidebarPanelId: "markdown-toolbar",
  onEnable,
  onDisable,
};

/**
 * Unified Toolbar plugin for Markable 2.0.
 *
 * Consolidates markdown-toolbar, table-toolbar, and image-toolbar into a single
 * context-sensitive plugin. A single CM6 updateListener selects among three
 * sub-toolbars based on cursor position:
 *
 *   Image context  (highest priority) — cursor on a line with ![alt](url) syntax
 *                                        or user clicked a rendered <img>.
 *   Table context  — cursor inside a GFM table.
 *   Default        — everything else (inline formatting toolbar).
 *
 * Self-containment rules (same as all .plugin.ts files):
 *   - No @codemirror/* imports as values — accessed via window.__CM_VIEW__.
 *   - No app-internal module imports.
 *   - CSS injected as <style id="__markable_unified_toolbar_css__"> in onEnable.
 *   - import type annotations are erased by tsc; safe for IDE support.
 *
 * Module sections (in order per AD-2):
 *   1.  Type-only imports
 *   2.  Settings types and defaults (UnifiedToolbarSettings, mergeWithDefaults)
 *   3.  Module-level state declarations (combined from all three originals)
 *   4.  CSS constant (TOOLBAR_CSS — merged) + lifecycle helpers (injectCSS/removeCSS)
 *   5.  Format registry (FORMATS) and detectFormats / isUrlLike
 *   6.  Pure format functions (computeWrap / computeUnwrap / computeErase / resolveUrl)
 *   7.  Pure image logic (ImageContext, AlignmentState; sub-sections 7a–7g for each
 *                         pure function group: parseImageSyntax, detectDivWrapper,
 *                         detectFloatRight, detectAlignment, extractImageCore,
 *                         alignment builders, URL operations)
 *   8.  Pure table logic (TableContext, splitRow, isSeparatorRow, parseTableRows,
 *                         detectTableContext; sub-section 8a for table operations:
 *                         insert/delete/move/align)
 *   9.  DOM builders and helpers (markdown toolbar, image popover, table floating
 *                     elements, unified sidebar panel with inner swap divs)
 *   10. Positioning helpers (updateActiveButtons, updateDisabledState, updatePosition,
 *                            updateFloatingPositions, positionPopover, etc.)
 *   11. Context resolver (resolveContext, detectTableContextFromState; sub-section
 *                         11a for detectImageRegion and anchor resolver)
 *   12. Shared CM6 updateListener factory (buildUpdateListener)
 *   13. Event handlers (_onDocClick, _onDocMousedown)
 *   14. Action handler (handleAction — routes image and table actions)
 *   15. onEnable / onDisable / renderDetailExtra
 *   16. Plugin export object
 */

// ── 1. Type-only imports (erased at compile time) ────────────────────────────

// All four imports are type-only — fully erased by tsc.
// EditorStateType and SyntaxTree are new additions sourced from the original
// image-toolbar and table-toolbar respectively.
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { EditorState as EditorStateType } from "@codemirror/state";
import type { Tree as SyntaxTree } from "@lezer/common";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── 2. Settings types and defaults ───────────────────────────────────────────

/** Determines whether the toolbar floats over the editor or lives in the sidebar. */
export type ToolbarMode = "floating" | "sidebar";

/** Which sidebar slot the toolbar panel should occupy when in sidebar mode. */
export type SidebarSide = "left" | "right";

/**
 * Unified persisted settings — one settings object covers all three sub-toolbars.
 * Old table-toolbar and image-toolbar settings files on disk are ignored (EC-18).
 */
export interface UnifiedToolbarSettings {
  toolbarMode: ToolbarMode;
  sidebarSide: SidebarSide;
}

// Keep the old name alias so existing markdown-toolbar tests that import
// ToolbarSettings still compile. The unified type is identical.
export type ToolbarSettings = UnifiedToolbarSettings;

/**
 * Default settings — floating mode, left sidebar side.
 * Used on first run (EC-15) or when stored settings are invalid (EC-17).
 */
export const DEFAULT_SETTINGS: UnifiedToolbarSettings = {
  toolbarMode: "floating",
  sidebarSide: "left",
};

/**
 * Merge raw (potentially partial or null) persisted data with defaults.
 *
 * Handles:
 *   EC-15: null input → returns DEFAULT_SETTINGS copy.
 *   EC-16: partial object (missing keys) → fills missing keys from defaults.
 *   EC-17: invalid toolbarMode string → falls back to "floating".
 *   EC-18: old table-toolbar / image-toolbar settings files — this function
 *          never reads those; it only validates its own input argument.
 *
 * @param raw - Parsed JSON object from disk, or null if none exists.
 * @returns   A complete, validated UnifiedToolbarSettings object.
 */
export function mergeWithDefaults(
  raw: Record<string, unknown> | null,
): UnifiedToolbarSettings {
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
// to their initial values in onDisable to support clean toggle cycles (NFR-2).

/** Debounce delay in milliseconds for active-button highlight recalculation (NFR-5). */
const DEBOUNCE_MS = 150;

/** Guards the updateListener hot path. Set true in onEnable, false in onDisable. */
let _enabled: boolean = false;

/** Active resolved settings for the current onEnable cycle. */
let _settings: UnifiedToolbarSettings = { ...DEFAULT_SETTINGS };

/**
 * The MarkablePluginAPI instance captured in onEnable.
 * Used by renderDetailExtra to save settings and restart the plugin.
 */
let _api: MarkablePluginAPI | null = null;

/** Active debounce timer for active-button highlight recalculation. Cleared in onDisable. */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Markdown sub-toolbar state ────────────────────────────────────────────────

/**
 * Live EditorView reference captured on each updateListener invocation.
 * Written by the listener on every transaction; reset in onDisable.
 */
let _view: EditorViewType | null = null;

/** The floating markdown toolbar DOM element. Created in onEnable, removed in onDisable. */
let _toolbarEl: HTMLElement | null = null;

/**
 * NodeList of all 10 markdown toolbar buttons.
 * In floating mode: from the floating _toolbarEl.
 * In sidebar mode: from _sidebarPanelEl's #unified-toolbar-md-content.
 */
let _buttons: NodeListOf<HTMLButtonElement> | null = null;

/**
 * In-flight guard for link/image button async resolution.
 * Prevents double-click from opening two prompt dialogs simultaneously.
 */
let _clickInFlight: boolean = false;

/**
 * Whether a sidebar panel was registered in the current onEnable cycle.
 * Guards api.unregisterSidebarPanel in onDisable so it is only called when needed.
 */
let _sidebarPanelRegistered: boolean = false;

// ── Table sub-toolbar state ───────────────────────────────────────────────────

/** Top bar element (7 column-level buttons). Created in onEnable floating mode. */
let _topBar: HTMLElement | null = null;

/** Row handle element (drag handle icon positioned left of current row). */
let _rowHandle: HTMLElement | null = null;

/** Drag-to-reorder indicator line shown during a row drag (EC-30). */
let _dragIndicator: HTMLElement | null = null;

/** Bottom pill element (the + button below the table). */
let _bottomPill: HTMLElement | null = null;

/** Sidebar panel DOM element for unified toolbar. Nulled in onDisable. */
let _sidebarPanelEl: HTMLElement | null = null;

/**
 * Window blur listener (capture phase) that hides floating elements when the
 * editor loses focus. Null when not in floating mode.
 */
let _blurListener: (() => void) | null = null;

// ── Image sub-toolbar state ───────────────────────────────────────────────────

/** The floating image popover DOM element. Always appended to body (AD-5). */
let _popoverEl: HTMLElement | null = null;

/**
 * The current image context — set when the popover opens, cleared on hide.
 * ImageContext is defined in section 7 below.
 * Null means the image popover is hidden.
 */
// eslint-disable-next-line prefer-const
let currentImageContext: ImageContext | null = null;

/**
 * How the image toolbar was last opened: "edit" (cursor on image line) or
 * "click" (user clicked rendered image). Null when hidden. Retained for state
 * tracking and future extension; write-only in the current implementation.
 */
// @ts-ignore TS6133: assigned for state tracking; value not yet read
let triggerMode: "edit" | "click" | null = null;

/**
 * Stored as named refs so the same function reference can be passed to
 * removeEventListener in onDisable (NFR-2 — no anonymous listeners).
 */
let _onDocClick: ((e: MouseEvent) => void) | null = null;
let _onDocMousedown: ((e: MouseEvent) => void) | null = null;

/** Blur listener for the editor DOM element. Hides image popover on editor blur. */
let _onEditorBlur: (() => void) | null = null;

/** The <input> element inside the popover "Embed Link" panel. */
let _urlInput: HTMLInputElement | null = null;

/** All four alignment buttons inside the popover. */
let _alignBtns: NodeListOf<HTMLButtonElement> | null = null;

// ── 4. CSS constant and lifecycle helpers ─────────────────────────────────────

/**
 * Unique id for the single injected <style> element.
 * Replaces the three separate STYLE_IDs from the original plugins:
 *   __markable_md_toolbar_css__  (markdown-toolbar)
 *   __markable_tbl_toolbar_css__ (table-toolbar)
 *   __markable_img_toolbar_css__ (image-toolbar)
 *
 * The idempotent guard in injectCSS uses this id to prevent duplicate tags
 * on rapid enable/disable cycles (EC-9).
 *
 * @visibleForTesting Exported so tests can locate the element by id.
 */
export const STYLE_ID = "__markable_unified_toolbar_css__";

/**
 * Merged CSS from all three original plugins, concatenated in this order:
 *   1. Markdown toolbar CSS (.md-toolbar rules)
 *   2. Table toolbar CSS (.tbl-toolbar rules)
 *   3. Image toolbar CSS (.img-toolbar rules)
 *
 * Class names are preserved verbatim so layout and visual behaviour are
 * identical to the original standalone plugins (FR-7, NFR-4).
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


/* ── Table toolbar ── */
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

/* ── Image toolbar ── */
.img-toolbar {
  position: fixed;
  z-index: 10000;
  display: none;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--text-primary) 15%, transparent);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  min-width: 220px;
}

.img-toolbar__tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
  margin-bottom: 4px;
}

.img-toolbar__tab {
  flex: 1;
  padding: 4px 8px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: -1px;
}

.img-toolbar__tab--active {
  border-bottom-color: var(--accent-color);
  color: var(--text-primary);
}

.img-toolbar__panel {
  display: flex;
  gap: 6px;
  align-items: center;
}

.img-toolbar__input {
  flex: 1;
  padding: 4px 8px;
  background: var(--bg-chrome);
  border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.img-toolbar__input:focus {
  border-color: var(--accent-color);
}

.img-toolbar__btn {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: var(--selection-bg);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.img-toolbar__btn:hover {
  background: var(--accent-color);
  color: var(--bg-primary);
}

.img-toolbar__divider {
  height: 1px;
  background: color-mix(in srgb, var(--text-primary) 12%, transparent);
  margin: 2px 0;
}

.img-toolbar__align-group {
  display: flex;
  gap: 4px;
}

.img-toolbar__align-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.img-toolbar__align-btn:hover {
  background: var(--selection-bg);
}

.img-toolbar__align-btn--active {
  background: var(--accent-color);
  color: var(--bg-primary);
}
`;

/**
 * Inject the unified <style> tag into <head>.
 *
 * Guarded by STYLE_ID so rapid enable/disable cycles never produce duplicate
 * <style> tags (EC-9). Idempotent — safe to call multiple times.
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
 * Remove the unified <style> tag injected by injectCSS().
 * No-op when the tag is absent.
 *
 * @visibleForTesting Exported only for lifecycle tests.
 */
export function removeCSS(): void {
  document.getElementById(STYLE_ID)?.remove();
}

// ── 5. Format registry ─────────────────────────────────────────────────────────

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


// ── 7. Pure image logic (types, pure functions, URL helpers) ─────────────────


/** The four supported alignment states for an image. */
export type AlignmentState = "left" | "center" | "right" | "float-right";

/**
 * Describes the full context of an image region in the document.
 * Populated when the toolbar opens; cleared (set to null) when the toolbar hides.
 *
 * AD-4: all fields except anchorEl are derived from the document source; anchorEl
 * is populated by the caller (click handler or edit-mode resolver).
 */
export interface ImageContext {
  /** Document position of the region start (inclusive). */
  from: number;
  /** Document position of the region end (exclusive). */
  to: number;
  /** Raw Markdown/HTML text of the full image region. */
  rawSource: string;
  /** Extracted URL from the Markdown source (not the resolved Tauri asset URL). */
  url: string;
  /** Extracted alt text verbatim. */
  alt: string;
  /** Detected alignment of the current image form. */
  alignment: AlignmentState;
  /** The <img> DOM element (or a DOMRect-like object) used to position the popover. */
  anchorEl: HTMLElement;
}

// ── 7a. Pure: parseImageSyntax ────────────────────────────────────────────────

/**
 * Parse `![alt](url)` from raw text.
 *
 * Returns the alt and url as-is — no trimming or unescaping (NFR-5, EC-26).
 * Returns null if the text does not match the bare Markdown image form.
 *
 * EC-10: empty alt and url (`![]()`) → returns `{ url: "", alt: "" }`.
 *
 * @param text - Raw string to test (will be trimmed before matching).
 * @returns     Parsed { url, alt } or null.
 */
export function parseImageSyntax(text: string): { url: string; alt: string } | null {
  // Match exactly the form ![alt](url) with nothing else on the line.
  const match = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(text.trim());
  if (!match) return null;
  return { alt: match[1], url: match[2] };
}

// ── 7b. Pure: detectDivWrapper ────────────────────────────────────────────────

/**
 * Detect the `<div align="center|right">...</div>` wrapper form.
 *
 * Handles both the single-line form (`<div align="center">![a](b)</div>`) and
 * the two-line form where the open tag and close tag are on separate lines.
 *
 * EC-27: the caller has already split on the document's line ending; this
 * function receives plain line text strings without embedded line endings.
 *
 * @param lineText     - Full text of the candidate first line.
 * @param nextLineText - Text of the next line (null if none exists).
 * @returns            Wrapper info or null if no match.
 */
export function detectDivWrapper(
  lineText: string,
  nextLineText: string | null,
): { align: "center" | "right"; innerText: string } | null {
  // Case 1: single-line form — `<div align="center">content</div>` on one line.
  const singleLine = /^<div\s+align="(center|right)">(.*)<\/div>$/i.exec(lineText);
  if (singleLine) {
    return {
      align: singleLine[1].toLowerCase() as "center" | "right",
      innerText: singleLine[2],
    };
  }

  // Case 2: two-line form — open tag on lineText, close tag on nextLineText.
  // The inner content is everything after the opening tag on line 1,
  // followed by anything before </div> on line 2.
  const openTag = /^<div\s+align="(center|right)">(.*)/i.exec(lineText);
  if (openTag && nextLineText !== null) {
    const closeTag = /^(.*)<\/div>$/i.exec(nextLineText);
    if (closeTag) {
      // Combine the inner content from both lines. The line2 prefix before </div>
      // may be empty (typical case: `</div>` alone on its own line).
      const part1 = openTag[2];
      const part2 = closeTag[1];
      // Only include the separator if both parts are non-empty — avoids trailing \n
      const innerText = part2 ? `${part1}\n${part2}` : part1;
      return {
        align: openTag[1].toLowerCase() as "center" | "right",
        innerText,
      };
    }
  }

  return null;
}

// ── 7c. Pure: detectFloatRight ────────────────────────────────────────────────

/**
 * Return true if `lineText` (trimmed) is the float-right `<img>` form.
 *
 * The float-right form is an inline HTML `<img>` tag with `align="right"`.
 * This is distinct from the `<div align="right">` wrapper form.
 *
 * EC-3: this detection allows the toolbar to recognise float-right images.
 *
 * @param lineText - Line text to test (trimmed before testing).
 * @returns         True if this is a float-right inline image.
 */
export function detectFloatRight(lineText: string): boolean {
  return /^<img\b[^>]*\balign="right"[^>]*>/i.test(lineText.trim());
}

// ── 7d. Pure: detectAlignment ─────────────────────────────────────────────────

/**
 * Classify the alignment state of a raw image region string.
 *
 * Rules applied in priority order (first match wins):
 *   1. `<div align="center">` → "center"
 *   2. `<div align="right">` → "right"
 *   3. float-right `<img>` tag → "float-right"
 *   4. Anything else (bare `![alt](url)`, `<div align="left">`, etc.) → "left"
 *
 * EC-24: never throws regardless of input — empty string returns "left".
 *
 * @param rawSource - Full raw text of the image region.
 * @returns           The current alignment classification.
 */
export function detectAlignment(rawSource: string): AlignmentState {
  if (/^<div\s+align="center">/i.test(rawSource)) return "center";
  if (/^<div\s+align="right">/i.test(rawSource)) return "right";
  if (detectFloatRight(rawSource.trim())) return "float-right";
  // Default: bare image, `<div align="left">`, or unrecognised form.
  return "left";
}

// ── 7e. Pure: extractImageCore ────────────────────────────────────────────────

/**
 * Extract `url` and `alt` from any supported image form.
 *
 * Tries each form in order and returns the first successful parse:
 *   1. Bare `![alt](url)` form (parseImageSyntax).
 *   2. `<div align="...">![alt](url)</div>` — extracts inner Markdown syntax.
 *   3. Float-right `<img src="..." alt="..." ...>` — parses HTML attributes.
 *   4. Fallback: returns `{ url: "", alt: "" }` — never throws (EC-10, EC-28).
 *
 * Alt text returned verbatim — no trimming or unescaping (NFR-5, EC-26).
 *
 * @param rawSource - Full raw text of the image region.
 * @returns           Extracted { url, alt }, both empty strings on parse failure.
 */
export function extractImageCore(rawSource: string): { url: string; alt: string } {
  // Attempt 1: bare Markdown image form.
  const bare = parseImageSyntax(rawSource.trim());
  if (bare) return bare;

  // Attempt 2: image embedded inside a <div align="..."> wrapper.
  // Extract the inner ![alt](url) regardless of whether the div spans one or two lines.
  const innerImgMatch = /!\[([^\]]*)\]\(([^)]*)\)/.exec(rawSource);
  if (innerImgMatch) return { alt: innerImgMatch[1], url: innerImgMatch[2] };

  // Attempt 3a: float-right form with src before alt.
  const floatSrcFirst = /<img\b[^>]*\bsrc="([^"]*)"[^>]*\balt="([^"]*)"[^>]*>/i.exec(rawSource);
  if (floatSrcFirst) return { url: floatSrcFirst[1], alt: floatSrcFirst[2] };

  // Attempt 3b: float-right form with alt before src (EC-28).
  const floatAltFirst = /<img\b[^>]*\balt="([^"]*)"[^>]*\bsrc="([^"]*)"[^>]*>/i.exec(rawSource);
  if (floatAltFirst) return { url: floatAltFirst[2], alt: floatAltFirst[1] };

  // Fallback: unrecognised form — return empty strings to avoid throwing (EC-10).
  return { url: "", alt: "" };
}

// ── 7f. Pure: alignment builders ──────────────────────────────────────────────

/**
 * Return the bare `![alt](url)` Markdown image form.
 *
 * Alt and url are inserted verbatim — no escaping (NFR-5, EC-26).
 * Works correctly when alt or url is empty string (EC-10).
 *
 * @param alt - Alt text.
 * @param url - Image URL or path.
 * @returns     Bare Markdown image string.
 */
export function buildBareImage(alt: string, url: string): string {
  return `![${alt}](${url})`;
}

/**
 * Return the `<div align="center|right">![alt](url)</div>` wrapper form.
 *
 * FR-3a specifies this as a single-line form, which most Markdown renderers
 * accept. The `lineEnding` parameter is accepted for API compatibility and
 * reserved for a future multi-line variant.
 *
 * EC-22: line endings are detected and passed by applyAlignment but unused here
 * because we always produce a single-line `<div>` form.
 *
 * @param alt         - Alt text (verbatim).
 * @param url         - Image URL (verbatim).
 * @param align       - "center" or "right".
 * @param lineEnding  - "\n" or "\r\n" (reserved for future use).
 * @returns             Single-line div-wrapped image string.
 */
export function wrapWithDiv(
  alt: string,
  url: string,
  align: "center" | "right",
  _lineEnding: string,
): string {
  // Single-line form as specified in FR-3a.
  return `<div align="${align}">![${alt}](${url})</div>`;
}

/**
 * Return the float-right inline HTML image form.
 *
 * Attribute order is fixed: src, alt, align, style — exactly as specified in FR-3a.
 * Alt and url are inserted verbatim (NFR-5, EC-26).
 *
 * @param alt - Alt text (verbatim).
 * @param url - Image URL (verbatim).
 * @returns     Float-right <img> HTML string.
 */
export function buildFloatRightImg(alt: string, url: string): string {
  return `<img src="${url}" alt="${alt}" align="right" style="float:right; margin:0 0 8px 16px">`;
}

/**
 * Detect the line ending used in `rawSource`.
 *
 * Used by applyAlignment to ensure the correct line ending is passed to
 * wrapWithDiv, preserving CRLF documents (EC-22, EC-27, NFR-5).
 *
 * @param rawSource - The raw image region text.
 * @returns           "\r\n" if CRLF is present, else "\n".
 */
export function detectLineEnding(rawSource: string): "\r\n" | "\n" {
  return rawSource.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Master alignment operation — maps any current image form to the desired alignment.
 *
 * Extracts alt and url from `rawSource` using extractImageCore, then builds the
 * new form using the appropriate builder. Never throws — falls back to empty
 * strings if extraction fails.
 *
 * EC-5: calling with alignment="left" on an already-bare image returns the same
 *       string (idempotent write — still dispatched to normalise any edge cases).
 * EC-3: float-right → left rewrites <img> to bare ![alt](url).
 * EC-4: float-right → center rewrites <img> to <div align="center">...</div>.
 * EC-32: clicking the active alignment button still dispatches.
 *
 * @param rawSource  - Current raw text of the image region.
 * @param alignment  - Desired new alignment.
 * @returns            New Markdown/HTML string to insert.
 */
export function applyAlignment(rawSource: string, alignment: AlignmentState): string {
  const { url, alt } = extractImageCore(rawSource);
  const le = detectLineEnding(rawSource);
  switch (alignment) {
    case "left":        return buildBareImage(alt, url);
    case "center":      return wrapWithDiv(alt, url, "center", le);
    case "right":       return wrapWithDiv(alt, url, "right", le);
    case "float-right": return buildFloatRightImg(alt, url);
  }
}

// ── 7g. Pure: URL operations ──────────────────────────────────────────────────

/**
 * Replace the URL in `rawSource` with `newUrl`, preserving alt text and alignment.
 *
 * Uses the reconstruction strategy (preferred over string-replace) to guarantee
 * alt text fidelity and handle the empty-url edge case cleanly (EC-10).
 *
 * Rules:
 *   - Alt text preserved verbatim (NFR-5, EC-26).
 *   - Alignment wrapper preserved.
 *   - newUrl used verbatim — no URL-encoding (EC-31, NFR-5).
 *   - If rawSource cannot be parsed, returns rawSource unchanged (graceful no-op).
 *
 * @param rawSource - Current raw text of the image region.
 * @param newUrl    - New URL to use (verbatim).
 * @returns           New Markdown/HTML string with the URL replaced.
 */
export function replaceImageSrc(rawSource: string, newUrl: string): string {
  const { alt } = extractImageCore(rawSource);
  const alignment = detectAlignment(rawSource);
  const le = detectLineEnding(rawSource);

  // If we could not parse any recognisable image form (all empty + no structure),
  // return the source unchanged as a graceful no-op.
  const { url: oldUrl } = extractImageCore(rawSource);
  if (oldUrl === "" && alt === "" && !rawSource.includes("![") && !rawSource.includes("<img")) {
    return rawSource;
  }

  // Reconstruct the output form with the new URL.
  switch (alignment) {
    case "left":        return buildBareImage(alt, newUrl);
    case "center":      return wrapWithDiv(alt, newUrl, "center", le);
    case "right":       return wrapWithDiv(alt, newUrl, "right", le);
    case "float-right": return buildFloatRightImg(alt, newUrl);
  }
}

/**
 * Internal: compute the directory part of a file path (macOS/POSIX separator).
 *
 * @param filePath - Absolute file path.
 * @returns          Directory path (e.g. "/Users/dm/Notes").
 */
function _dirname(filePath: string): string {
  const parts = filePath.split("/");
  parts.pop(); // Remove the filename.
  return parts.join("/") || "/";
}

/**
 * Convert `selectedAbsPath` to a path relative to `docPath`'s directory when
 * the selected file is inside or below that directory; return the absolute path
 * otherwise.
 *
 * Rules:
 *   EC-6:  file in same directory or subdirectory → relative path (e.g. "./img.png").
 *   EC-7:  file outside document directory → absolute path unchanged.
 *   EC-8:  docPath is null (untitled) → absolute path unchanged.
 *   EC-31: spaces and Unicode characters preserved verbatim — no URL-encoding.
 *
 * macOS paths use "/" separator. No Windows path support in v1.0.
 *
 * @param selectedAbsPath - Absolute path selected by the user.
 * @param docPath         - Absolute path of the current document, or null.
 * @returns                 Relative or absolute path string.
 */
export function resolveRelativePath(
  selectedAbsPath: string,
  docPath: string | null,
): string {
  // EC-8: untitled document — use absolute path as-is.
  if (!docPath) return selectedAbsPath;

  const docDir = _dirname(docPath);

  // EC-7: file is outside the document's directory.
  if (!selectedAbsPath.startsWith(docDir + "/")) return selectedAbsPath;

  // EC-6: file is inside the document's directory (same dir or subdir).
  // Prepend "./" to make the relative path unambiguous.
  return "./" + selectedAbsPath.slice(docDir.length + 1);
}


// ── 8. Pure table logic (types and context detection) ────────────────────────


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

// detectLineEnding is defined once in section 7 (image logic). Used here by reference.


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

// detectTableContextFromState wrapper lives in section 11 (context resolver).


// ── 8a. Pure table operations (insert/delete/move/align) ─────────────────────

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


// ── CM globals ────────────────────────────────────────────────────────────────
// These helpers are used throughout sections 9–15. Defined here once so there
// is a single source of truth (no duplicate getCmView / getCmLanguage definitions
// from the three originals).

/**
 * Access the @codemirror/view module from the window.__CM_VIEW__ global set by cm-globals.ts.
 * Never called at module-evaluation time — only inside factory functions.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function getCmView(): typeof import("@codemirror/view") {
  return (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Access the syntaxTree function from the @codemirror/language module global.
 * The project exposes this via window.__CM_LANGUAGE__ (set in cm-globals.ts).
 */
function getCmLanguage():
  | { syntaxTree: typeof import("@codemirror/language").syntaxTree }
  | undefined {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (window as any).__CM_LANGUAGE__ as
    | { syntaxTree: typeof import("@codemirror/language").syntaxTree }
    | undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Return the live EditorView from the window global.
 * Always reads fresh — never caches — so a new tab's view is always used (EC-25).
 * Returns undefined when the global is not set (test environment).
 */
function getEditorView(): EditorViewType | undefined {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (window as any).__MARKABLE_EDITOR_VIEW__ as EditorViewType | undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}


// ── 9. DOM builders and helpers ──────────────────────────────────────────────

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

// getCmView is defined in the CM globals section above.

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
export function buildToolbarDOM(): { toolbar: HTMLElement; buttons: NodeListOf<HTMLButtonElement> } {
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

  const buttons = toolbar.querySelectorAll<HTMLButtonElement>(".md-toolbar__btn");
  return { toolbar, buttons };
}


// ── 9b. Image popover DOM ────────────────────────────────────────────────────

/**
 * Create the full popover DOM tree. Called once in onEnable.
 *
 * The element is NOT appended to document.body here — the caller does that.
 * Tab switching is handled by a single delegated listener on the tab strip.
 * Button actions are handled by a single delegated listener on the popover root.
 *
 * Module-level `_urlInput` and `_alignBtns` are populated as a side effect so
 * showPopover can reference them without re-querying the DOM each time.
 *
 * @returns The root popover element (not yet in the DOM).
 *
 * @remarks Length justification: The function builds four distinct structural
 * sections of the popover DOM (tab strip, Select panel, Embed Link panel,
 * alignment group) plus the delegated listeners for tab switching and action
 * routing. Each section shares the outer `el` variable and must be assembled in
 * sequence (child nodes must exist before appendChild). Splitting into smaller
 * builders would require threading `el` as a parameter and would obscure the
 * one-pass construction contract. The inline section comments already serve as
 * logical headers.
 */
export function buildPopover(): HTMLElement {
  const el = document.createElement("div");
  el.className = "img-toolbar";
  el.id = "__markable_img_toolbar__";
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Image options");

  // ── Tab strip ──────────────────────────────────────────────────────────────
  const tabs = document.createElement("div");
  tabs.className = "img-toolbar__tabs";

  const tabSelect = document.createElement("button");
  tabSelect.className = "img-toolbar__tab img-toolbar__tab--active";
  tabSelect.dataset["tab"] = "select";
  tabSelect.textContent = "Select";

  const tabEmbed = document.createElement("button");
  tabEmbed.className = "img-toolbar__tab";
  tabEmbed.dataset["tab"] = "embed";
  tabEmbed.textContent = "Embed Link";

  tabs.appendChild(tabSelect);
  tabs.appendChild(tabEmbed);

  // ── Select panel (visible by default) ─────────────────────────────────────
  const panelSelect = document.createElement("div");
  panelSelect.className = "img-toolbar__panel img-toolbar__panel--select";
  panelSelect.dataset["panel"] = "select";

  const btnChooseFile = document.createElement("button");
  btnChooseFile.className = "img-toolbar__btn";
  btnChooseFile.dataset["action"] = "choose-file";
  btnChooseFile.textContent = "Choose File";
  panelSelect.appendChild(btnChooseFile);

  // ── Embed Link panel (hidden by default) ──────────────────────────────────
  const panelEmbed = document.createElement("div");
  panelEmbed.className = "img-toolbar__panel img-toolbar__panel--embed";
  panelEmbed.dataset["panel"] = "embed";
  panelEmbed.style.display = "none";

  const urlInput = document.createElement("input");
  urlInput.className = "img-toolbar__input";
  urlInput.type = "text";
  urlInput.placeholder = "URL or relative path";
  urlInput.setAttribute("aria-label", "Image URL");

  const btnEmbed = document.createElement("button");
  btnEmbed.className = "img-toolbar__btn";
  btnEmbed.dataset["action"] = "embed-image";
  btnEmbed.textContent = "Embed Image";

  panelEmbed.appendChild(urlInput);
  panelEmbed.appendChild(btnEmbed);

  // ── Divider ────────────────────────────────────────────────────────────────
  const divider = document.createElement("div");
  divider.className = "img-toolbar__divider";
  divider.setAttribute("aria-hidden", "true");

  // ── Alignment group ────────────────────────────────────────────────────────
  const alignGroup = document.createElement("div");
  alignGroup.className = "img-toolbar__align-group";
  alignGroup.setAttribute("role", "group");
  alignGroup.setAttribute("aria-label", "Alignment");

  // Image alignment actions use the "img-align-*" prefix to avoid colliding
  // with the identically-named table column-alignment actions (Issue 1 fix).
  const alignments: Array<{ action: string; title: string; icon: string }> = [
    { action: "img-align-left",        title: "Left",        icon: "←" },
    { action: "img-align-center",      title: "Center",      icon: "↔" },
    { action: "img-align-right",       title: "Right",       icon: "→" },
    { action: "align-float-right",     title: "Float Right", icon: "⤵" },
  ];

  for (const { action, title, icon } of alignments) {
    const btn = document.createElement("button");
    btn.className = "img-toolbar__align-btn";
    btn.dataset["action"] = action;
    btn.title = title;
    btn.textContent = icon;
    alignGroup.appendChild(btn);
  }

  // ── Assemble ──────────────────────────────────────────────────────────────
  el.appendChild(tabs);
  el.appendChild(panelSelect);
  el.appendChild(panelEmbed);
  el.appendChild(divider);
  el.appendChild(alignGroup);

  // ── Tab switching — single delegated listener on the tab strip ────────────
  tabs.addEventListener("click", (event: MouseEvent) => {
    const tabBtn = (event.target as Element).closest("[data-tab]") as HTMLElement | null;
    if (!tabBtn) return;
    const targetTab = tabBtn.dataset["tab"];

    // Update tab button active states.
    tabs.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.classList.toggle("img-toolbar__tab--active", btn === tabBtn);
    });

    // Show the matching panel, hide others.
    el.querySelectorAll("[data-panel]").forEach((panel) => {
      const p = panel as HTMLElement;
      p.style.display = p.dataset["panel"] === targetTab ? "flex" : "none";
    });
  });

  // ── Action delegation — single listener on the popover root ───────────────
  // Alignment and embed button clicks are caught here and forwarded to handleAction.
  el.addEventListener("click", (event: MouseEvent) => {
    const btn = (event.target as Element).closest("[data-action]") as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset["action"];
    if (action) handleAction(action);
  });

  // ── Store module-level refs for showPopover ────────────────────────────────
  _urlInput = el.querySelector("input.img-toolbar__input");
  _alignBtns = el.querySelectorAll(".img-toolbar__align-btn");

  return el;
}

/**
 * Position the popover relative to an anchor bounding rect.
 *
 * Positioning strategy (FR-7):
 *   - Default: appear above the anchor, offset by popoverHeight + 8px.
 *   - Flip: if top would be above viewport top (< 0), render below instead (EC-23).
 *   - Clamp: if right edge exceeds viewport width, shift left (EC-24).
 *   - Sets `display: "flex"` to make the popover visible.
 *
 * Note: uses style.display = "flex" (NOT classList) — learned from table-toolbar bug.
 *
 * @param anchorRect - Bounding rect of the anchor element.
 * @param popoverEl  - The popover element to position.
 */
export function positionPopover(
  anchorRect: { top: number; bottom: number; left: number; right: number },
  popoverEl: HTMLElement,
): void {
  // Use offsetHeight/offsetWidth with fallback before first paint.
  const popoverHeight = popoverEl.offsetHeight || 120;
  const popoverWidth = popoverEl.offsetWidth || 220;

  // Default: render above the anchor with an 8px gap.
  let top = anchorRect.top - popoverHeight - 8;

  // EC-23: flip below if the toolbar would render above the viewport top edge.
  if (top < 0) {
    top = anchorRect.bottom + 8;
  }

  let left = anchorRect.left;

  // EC-24: clamp so the right edge stays within the viewport.
  if (left + popoverWidth > window.innerWidth) {
    left = window.innerWidth - popoverWidth - 8;
  }

  // Prevent negative left (off the left viewport edge).
  left = Math.max(0, left);

  popoverEl.style.top = top + "px";
  popoverEl.style.left = left + "px";
  // Use direct style assignment (NOT classList.add) — mirrors table-toolbar pattern.
  popoverEl.style.display = "flex";
}

/**
 * Prepare and display the popover for a given ImageContext.
 *
 * Called from both the click-trigger and edit-trigger paths. Resets to the
 * "Select" tab on each open so the user always sees a consistent initial state.
 *
 * @param ctx - The full image context including the anchor element.
 */
export function showPopover(ctx: ImageContext): void {
  // Safety guard — called before onEnable or after onDisable.
  if (_popoverEl === null) return;

  // Pre-fill the URL input with the current image's URL (FR-2b).
  if (_urlInput) _urlInput.value = ctx.url;

  // Update the active alignment button — remove --active from all, then add to match.
  // Image alignment buttons use the "img-align-*" prefix for left/center/right, and
  // "align-float-right" for float-right (Issue 1 fix: these differ from table actions).
  if (_alignBtns) {
    const alignmentToAction: Record<string, string> = {
      left:         "img-align-left",
      center:       "img-align-center",
      right:        "img-align-right",
      "float-right": "align-float-right",
    };
    const targetAction = alignmentToAction[ctx.alignment] ?? ("img-align-" + ctx.alignment);
    _alignBtns.forEach((btn) => {
      if (btn.dataset["action"] === targetAction) {
        btn.classList.add("img-toolbar__align-btn--active");
      } else {
        btn.classList.remove("img-toolbar__align-btn--active");
      }
    });
  }

  // Reset to "Select" tab — hide embed panel, show select panel.
  _popoverEl.querySelectorAll("[data-panel]").forEach((panel) => {
    const p = panel as HTMLElement;
    p.style.display = p.dataset["panel"] === "select" ? "flex" : "none";
  });

  // Update tab button active state to match "Select".
  _popoverEl.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("img-toolbar__tab--active", btn.getAttribute("data-tab") === "select");
  });

  // Position and show the popover (positionPopover sets display: "flex").
  positionPopover(ctx.anchorEl.getBoundingClientRect(), _popoverEl);
}

/**
 * Hide the popover and reset all trigger-mode state.
 *
 * This is the single exit point for all dismiss paths (FR-5 — unified dismiss
 * contract). Uses style.display = "none" (NOT classList — table-toolbar lesson).
 */
export function hideToolbar(): void {
  if (_popoverEl) _popoverEl.style.display = "none";
  currentImageContext = null;
  triggerMode = null;
}


// ── 9c. Table floating elements DOM ─────────────────────────────────────────

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


// ── 9c continued: Table positioning helpers ─────────────────────────────────

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


/**
 * Button configuration for the table controls portion of the sidebar panel.
 * Each entry: [data-action, label, alwaysEnabled]
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
 * Build the unified sidebar panel DOM element.
 *
 * Returns a container with two inner swap divs:
 *   #unified-toolbar-md-content  — 10 markdown format buttons (visible by default)
 *   #unified-toolbar-tbl-content — 11 table operation buttons (hidden by default)
 *
 * swapSidebarContent() in the updateListener toggles display between these two divs
 * without re-registration (AD-3, EC-12, EC-13).
 *
 * Elements with display:none are excluded from tab order by the browser — no
 * tabindex manipulation is needed for keyboard accessibility (EC-38).
 *
 * @returns The root unified panel element.
 */
export function buildSidebarPanel(): HTMLElement {
  const container = document.createElement("div");
  container.className = "unified-toolbar-sidebar-panel";

  // ── Markdown content div (visible by default) ─────────────────────────────
  const mdContent = document.createElement("div");
  mdContent.id = "unified-toolbar-md-content";

  const mdToolbar = document.createElement("div");
  mdToolbar.id = "__markable_md_toolbar__";
  mdToolbar.className = "md-toolbar";
  mdToolbar.setAttribute("role", "toolbar");
  mdToolbar.setAttribute("aria-label", "Formatting");

  for (const fmt of FORMATS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "md-toolbar__btn";
    btn.dataset["format"] = fmt.id;
    btn.title = fmt.label;
    btn.textContent = BUTTON_LABELS[fmt.id];
    mdToolbar.appendChild(btn);
  }

  mdToolbar.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const btn = (e.target as Element).closest("[data-format]") as HTMLElement | null;
    if (!btn) return;
    const fmtId = btn.dataset["format"] as FormatId;
    void handleButtonClick(fmtId);
  });

  mdContent.appendChild(mdToolbar);

  // ── Table content div (hidden by default) ─────────────────────────────────
  const tblContent = document.createElement("div");
  tblContent.id = "unified-toolbar-tbl-content";
  tblContent.style.display = "none";

  const tblPanel = document.createElement("div");
  tblPanel.id = "__markable_tbl_sidebar_panel__";
  tblPanel.className = "tbl-toolbar-sidebar";
  tblPanel.setAttribute("role", "toolbar");
  tblPanel.setAttribute("aria-label", "Table controls");

  for (const [action, label] of SIDEBAR_BUTTONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tbl-toolbar__btn";
    btn.dataset["action"] = action;
    btn.textContent = label;
    btn.title = label;
    tblPanel.appendChild(btn);
  }

  tblPanel.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const btn = (e.target as Element).closest("[data-action]") as HTMLElement | null;
    if (!btn) return;
    if (btn.classList.contains("tbl-toolbar__btn--disabled")) return;
    handleTableAction(btn.dataset["action"]!);
  });

  tblContent.appendChild(tblPanel);

  container.appendChild(mdContent);
  container.appendChild(tblContent);

  return container;
}

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

// ── 10. Positioning helpers ──────────────────────────────────────────────────

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


// ── 11. Context resolver ──────────────────────────────────────────────────────

/**
 * The three possible toolbar contexts. Returned by resolveContext().
 *
 * Priority order (FR-2):
 *   1. "image"  — cursor on image line or user clicked rendered <img>
 *   2. "table"  — cursor inside a GFM table (and not on an image line)
 *   3. "default" — all other positions
 */
export type ToolbarContext = "image" | "table" | "default";

// ── 11a. CM6: detectImageRegion and anchor resolver ───────────────────────────

/**
 * Walk the CM6 syntax tree to find an Image node at or near `pos`, then build
 * a full ImageContext data object (without anchorEl — caller populates that).
 *
 * Algorithm (FR-4):
 *   1. Resolve the syntax tree node at pos.
 *   2. Walk up until an "Image" node is found.
 *   3. Check for `<div align="...">` wrapper on the same line.
 *   4. Check for float-right `<img>` form.
 *   5. Otherwise use the bare Image node range.
 *   6. Extract url, alt, alignment from the raw source.
 *
 * Returns null if no Image node exists at pos, or if CM globals are absent.
 *
 * @param state - The current CM6 EditorState.
 * @param pos   - The document position to inspect.
 * @returns       Image context data (without anchorEl), or null.
 *
 * @remarks Length justification: The function performs six sequential steps
 * (getCmLanguage guard, syntaxTree resolution, parent-walk to Image node, line
 * extraction, wrapper type detection with two-line boundary arithmetic, and
 * final rawSource extraction). Each step requires access to variables produced
 * by the prior step (e.g. lineObj is needed for both the wrapper check and the
 * two-line to-boundary). Splitting into helper functions would require threading
 * at least four variables across call sites, adding indirection without reducing
 * complexity. The numbered inline comments already act as step markers.
 */
function detectImageRegion(
  state: EditorStateType,
  pos: number,
): Omit<ImageContext, "anchorEl"> | null {
  const cmState = getCmLanguage();
  if (!cmState) {
    // CM globals not available — cannot walk the syntax tree.
    return null;
  }

  const tree = cmState.syntaxTree(state);
  let node = tree.resolveInner(pos, 1) as {
    name: string;
    from: number;
    to: number;
    parent: { name: string; from: number; to: number; parent: unknown } | null;
  } | null;

  // Walk up the tree to find an Image node.
  while (node && node.name !== "Image") {
    node = node.parent as typeof node;
  }

  if (!node) return null;

  const lineObj = state.doc.lineAt(node.from);
  const lineText = lineObj.text;

  // Check for a next line (for the two-line div wrapper form).
  const hasNext = lineObj.to < state.doc.length;
  const nextLineText = hasNext ? state.doc.lineAt(lineObj.to + 1).text : null;

  let from: number;
  let to: number;

  // EC-1/EC-2: check for `<div align="...">` wrapper (single- or two-line form).
  const divWrapper = detectDivWrapper(lineText, nextLineText);
  if (divWrapper) {
    from = lineObj.from;
    if (nextLineText !== null) {
      // Check if the close tag is on the next line (two-line form).
      const closesOnNextLine = /^(.*)<\/div>$/i.test(nextLineText);
      const opensAndClosesOnThisLine = /^<div\s+align="(center|right)">(.*)<\/div>$/i.test(lineText);
      if (closesOnNextLine && !opensAndClosesOnThisLine) {
        // Two-line form: region ends at end of next line.
        to = state.doc.lineAt(lineObj.to + 1).to;
      } else {
        // Single-line form.
        to = lineObj.to;
      }
    } else {
      to = lineObj.to;
    }
  } else if (detectFloatRight(lineText)) {
    // EC-3: float-right <img> tag — region is the full line.
    from = lineObj.from;
    to = lineObj.to;
  } else {
    // Default: bare Image node range.
    from = node.from;
    to = node.to;
  }

  const rawSource = state.doc.sliceString(from, to);
  const { url, alt } = extractImageCore(rawSource);
  const alignment = detectAlignment(rawSource);

  return { from, to, rawSource, url, alt, alignment };
}

/**
 * Find the `<img class="cm-live-image">` DOM element corresponding to `fromPos`.
 *
 * Strategy:
 *   1. Query all `.cm-live-image` elements in the editor DOM.
 *   2. For each, try `view.posAtDOM(img)`. If position matches fromPos, return it.
 *   3. Fallback: use `view.coordsAtPos(fromPos)` to produce a pseudo-rect anchor.
 *   4. Return null only if coordsAtPos also fails.
 *
 * The fallback pseudo-rect satisfies positionPopover's interface so the toolbar
 * can still appear in edit mode even when the image widget is not rendered
 * (the editor shows raw Markdown when the cursor is on the image line).
 *
 * @param view    - The live EditorView.
 * @param fromPos - The document position of the image region start.
 * @returns         An HTMLElement or pseudo-rect, or null if positioning fails.
 */
function _resolveAnchorForEditMode(
  view: EditorViewType,
  fromPos: number,
): HTMLElement | null {
  // First try: find the actual rendered <img> element.
  const imgs = view.dom.querySelectorAll("img.cm-live-image");
  for (const img of imgs) {
    try {
      const p = view.posAtDOM(img as HTMLElement);
      if (Math.abs(p - fromPos) < 5) return img as HTMLElement;
    } catch {
      // Skip elements that posAtDOM cannot resolve.
    }
  }

  // Fallback: use coordsAtPos to create a pseudo-rect that satisfies positionPopover.
  const coords = view.coordsAtPos(fromPos);
  if (!coords) return null;

  // Return an object that satisfies the `{ top, bottom, left, right }` interface.
  // getBoundingClientRect is added so showPopover's ctx.anchorEl.getBoundingClientRect()
  // call works when this object is stored as anchorEl.
  const pseudoRect = {
    top: coords.top,
    bottom: coords.bottom,
    left: coords.left,
    right: coords.right,
    getBoundingClientRect() { return this as unknown as DOMRect; },
  };
  return pseudoRect as unknown as HTMLElement;
}

/**
 * Fallback position recovery for EC-15: posAtDOM threw.
 *
 * Scans all Image nodes in visible ranges and matches against imgEl by comparing
 * the tail of the src attribute against the end of imgEl.src (best-effort heuristic
 * since the Tauri asset URL form is not importable in the plugin sandbox).
 *
 * @param view   - The live EditorView.
 * @param imgEl  - The clicked <img> element.
 * @returns       Document position or -1 if no match found.
 */
function _fallbackPosFromImgEl(view: EditorViewType, imgEl: HTMLElement): number {
  const cmState = getCmLanguage();
  if (!cmState) return -1;

  // Walk the syntax tree over all visible ranges.
  for (const range of view.visibleRanges) {
    const cursor = cmState.syntaxTree(view.state).cursor();
    cursor.moveTo(range.from, 1);
    do {
      if (cursor.name === "Image") {
        const rawSource = view.state.doc.sliceString(cursor.from, cursor.to);
        const { url } = extractImageCore(rawSource);
        if (url) {
          // Heuristic: check if imgEl.src ends with the last path segment of url.
          const urlTail = url.split("/").pop() ?? "";
          if (urlTail && (imgEl as HTMLImageElement).src.endsWith(urlTail)) {
            return cursor.from;
          }
        }
      }
    } while (cursor.next() && cursor.from < range.to);
  }

  return -1;
}


/**
 * Production wrapper that calls detectTableContext with the live CM6 state.
 * Exported for step_06 integration tests.
 *
 * @param state - A CM6 EditorState object (or a compatible test stub).
 */
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
  // getCmLanguage() returns undefined when the CM6 language package global is not loaded
  // (e.g. during unit tests or before the editor initialises). Guard to avoid crash.
  const cmLang = getCmLanguage();
  if (!cmLang) return null;
  const { syntaxTree } = cmLang;
  const tree = syntaxTree(state);
  const docText = state.doc.toString() as string;
  const cursorPos = state.selection.main.head as number;
  return detectTableContext(docText, cursorPos, tree);
}

/**
 * Resolve the active toolbar context for the current editor update.
 *
 * Priority (FR-2, NFR-5):
 *   1. detectImageRegion — one line text check, cheapest.
 *      Short-circuit: if image detected, table detection is skipped.
 *   2. detectTableContextFromState — syntax-tree walk.
 *   3. Default context.
 *
 * Side effect: writes to `currentImageContext` module-level variable.
 * This is intentional — the image action handler reads that variable.
 *
 * @param update - The CM6 ViewUpdate from the updateListener.
 * @returns       "image" | "table" | "default"
 */
export function resolveContext(update: ViewUpdate): ToolbarContext {
  // Step 1: image check first (cheapest — one line text scan) (NFR-5).
  const imgCtx = detectImageRegion(update.state, update.state.selection.main.head);
  if (imgCtx !== null) {
    // Resolve the DOM anchor element needed to position the floating popover.
    const anchorEl = _resolveAnchorForEditMode(update.view, imgCtx.from);
    if (anchorEl) {
      // Anchor is ready: store full image context and return image context.
      currentImageContext = { ...imgCtx, anchorEl };
      return "image";
    }
    // Anchor not ready yet (DOM not yet painted for this line) — fall through to
    // table/default rather than returning "image" with null context, which would
    // hide ALL sub-toolbars simultaneously until the next update tick (Issue 3 fix).
  }

  // Clear stale image context when no longer on an image line (or when anchor was null).
  currentImageContext = null;

  // Step 2: table check (only when image check failed — short-circuit from NFR-5).
  const tblCtx = detectTableContextFromState(update.state);
  if (tblCtx !== null) return "table";

  // Step 3: default context.
  return "default";
}

// ── 12. Shared CM6 updateListener factory ────────────────────────────────────

/**
 * Build the single shared CM6 updateListener extension for all three sub-toolbars.
 *
 * Architecture (NFR-1, NFR-5):
 *   - Context detection (resolveContext) runs synchronously on every selection/doc change.
 *   - Sub-toolbar show/hide runs synchronously immediately after — no debounce, no rAF.
 *   - Only the active-button highlight recalculation is debounced at 150 ms.
 *
 * Tab switching (EC-25, EC-26): window.__MARKABLE_EDITOR_VIEW__ is updated on tab
 * switch. The next CM6 transaction on the new view fires this listener, which calls
 * resolveContext on the new view. If the new view's cursor is not on an image line,
 * hideImageSubToolbar() is called automatically — no special tab-switch code needed.
 *
 * @returns A CM6 Extension (EditorView.updateListener instance).
 */
function buildUpdateListener() {
  const { EditorView } = getCmView();

  // ── Swap helper — synchronously toggles sidebar panel inner divs (EC-12, EC-13) ──
  // Exported so integration tests can call it directly.

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;

    // Always capture latest view reference.
    _view = update.view;

    if (!update.docChanged && !update.selectionSet) return;

    // ── Step 2: Resolve context (synchronous) ────────────────────────────────
    const context: ToolbarContext = resolveContext(update);

    // ── Step 3: Synchronous show/hide (no debounce — NFR-5, EC-34) ──────────
    if (context === "image") {
      // Show image popover; hide table and markdown toolbars.
      // swapSidebarContent is intentionally NOT called here — the sidebar panel
      // retains its previous state while the floating image popover is shown (EC-14).
      _showImageSubToolbar();
      _hideTableSubToolbar();
      _hideMarkdownSubToolbar();

    } else if (context === "table") {
      // Show table sub-toolbar; hide image popover and markdown toolbar.
      _hideImageSubToolbar();
      _showTableSubToolbar(update);
      _hideMarkdownSubToolbar();
      // Sidebar: swap content to show table controls (EC-12).
      if (_settings.toolbarMode === "sidebar") {
        swapSidebarContent("table");
      }

    } else {
      // Default: show markdown toolbar; hide image and table toolbars.
      _hideImageSubToolbar();
      _hideTableSubToolbar();
      _showMarkdownSubToolbar(update);
      // Sidebar: swap content to show markdown buttons (EC-13).
      // This is the single authoritative call site for swapSidebarContent("default").
      if (_settings.toolbarMode === "sidebar") {
        swapSidebarContent("default");
      }
    }

    // ── Step 4: Debounced active-button highlight (NFR-5) ────────────────────
    // Clear and restart the debounce timer on every tick. Sub-toolbar visibility
    // above is always correct before this fires (EC-34).
    clearTimeout(_debounceTimer!);
    _debounceTimer = setTimeout(() => {
      if (!_enabled) return;
      if (context === "default" || context === "image") {
        // Update markdown button active/disabled state.
        const docText = update.state.doc.toString();
        const sel = update.state.selection.main;
        const flags = detectFormats(docText, sel.from, sel.to);
        updateActiveButtons(flags, _buttons);
        if (_settings.toolbarMode === "sidebar") {
          updateDisabledState(sel.empty, _buttons);
        }
      } else if (context === "table") {
        const tblCtx = detectTableContextFromState(update.state);
        if (_settings.toolbarMode === "sidebar") {
          if (_sidebarPanelEl && tblCtx) {
            const tblDiv = _sidebarPanelEl.querySelector("#unified-toolbar-tbl-content") as HTMLElement | null;
            if (tblDiv) updateSidebarButtonStates(tblDiv, tblCtx);
          }
        } else {
          if (tblCtx) updateTopBarButtonStates(tblCtx);
        }
      }
    }, DEBOUNCE_MS);
  });
}

// ── Internal show/hide helpers ────────────────────────────────────────────────

/** Show the image popover for the current image context. */
function _showImageSubToolbar(): void {
  if (currentImageContext) {
    showPopover(currentImageContext);
  }
}

/** Hide the image popover. */
function _hideImageSubToolbar(): void {
  hideToolbar();
}

/**
 * Show the table sub-toolbar for the current cursor position.
 * In floating mode: position and reveal the top bar, row handle, and bottom pill.
 * In sidebar mode: the sidebar panel is already visible; swapSidebarContent handles content.
 */
function _showTableSubToolbar(update: ViewUpdate): void {
  if (_settings.toolbarMode === "floating") {
    // Quick tree walk to get table/row positions for floating element placement.
    const cmLang = getCmLanguage();
    if (!cmLang) return;
    const tree = cmLang.syntaxTree(update.state);
    const head = update.state.selection.main.head;
    let tableFrom: number | null = null;
    let tableTo: number | null = null;
    let rowFrom: number | null = null;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let node = tree.resolve(head, 1) as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    while (node) {
      if (node.name === "Table") {
        tableFrom = node.from;
        tableTo = node.to;
      }
      if (
        (node.name === "TableRow" || node.name === "TableHeader" || node.name === "TableDelimiter") &&
        rowFrom === null
      ) {
        rowFrom = node.from;
      }
      node = node.parent;
    }
    if (tableFrom !== null && tableTo !== null && rowFrom !== null) {
      updateFloatingPositions(update.view, tableFrom, tableTo, rowFrom);
    }
  }
}

/**
 * Hide the table sub-toolbar floating elements.
 *
 * In floating mode: hides the top bar, row handle, and bottom pill.
 * In sidebar mode: does nothing — the sidebar panel is always visible; content
 * swapping is the explicit responsibility of the updateListener call sites.
 *
 * Design rationale: sidebar content is NOT reset here to avoid the double-call bug
 * where both this function and the updateListener's default-context branch would both
 * call swapSidebarContent("default") on every tick (Issue 4 fix, EC-13, EC-14).
 */
function _hideTableSubToolbar(): void {
  if (_settings.toolbarMode === "floating") {
    if (_topBar) _topBar.style.display = "none";
    if (_rowHandle) _rowHandle.style.display = "none";
    if (_bottomPill) _bottomPill.style.display = "none";
  }
  // Sidebar mode: swapSidebarContent is intentionally NOT called here.
  // The updateListener's default-context branch calls swapSidebarContent("default")
  // explicitly after this function returns, so this function must not duplicate that
  // call. The image-context branch intentionally omits swapSidebarContent entirely so
  // the sidebar retains its previous state while the floating popover shows (EC-14).
}

/**
 * Show the markdown sub-toolbar.
 * In floating mode: position the floating bubble above the selection.
 * In sidebar mode: the panel is always visible; swapSidebarContent("default") is
 * called by the updateListener caller in section 12 so it is not duplicated here.
 */
function _showMarkdownSubToolbar(update: ViewUpdate): void {
  if (_settings.toolbarMode === "floating" && _toolbarEl) {
    updatePosition(update.view, _toolbarEl);
  }
}

/** Hide the markdown sub-toolbar (floating mode only; sidebar always visible). */
function _hideMarkdownSubToolbar(): void {
  if (_settings.toolbarMode === "floating" && _toolbarEl) {
    _toolbarEl.style.display = "none";
  }
  // Sidebar mode: the panel stays visible; no action needed.
}

/**
 * Swap the sidebar panel's inner content between markdown and table controls.
 *
 * Toggles display on the two inner divs inside the unified panel:
 *   "table"   → shows #unified-toolbar-tbl-content, hides #unified-toolbar-md-content
 *   "default" → shows #unified-toolbar-md-content, hides #unified-toolbar-tbl-content
 *
 * No DOM rebuild, no sidebar re-registration (AD-3, EC-12, EC-13).
 *
 * Exported for integration tests.
 *
 * @param ctx - Which inner div to show.
 */
export function swapSidebarContent(ctx: "table" | "default"): void {
  const mdDiv = _sidebarPanelEl?.querySelector("#unified-toolbar-md-content") as HTMLElement | null;
  const tblDiv = _sidebarPanelEl?.querySelector("#unified-toolbar-tbl-content") as HTMLElement | null;
  if (!mdDiv || !tblDiv) return;
  mdDiv.style.display  = ctx === "default" ? "" : "none";
  tblDiv.style.display = ctx === "table"   ? "" : "none";
}

// ── 13. Event handlers ────────────────────────────────────────────────────────

// Named function references stored in module-level vars so the same reference
// can be passed to removeEventListener in onDisable (NFR-2).

/**
 * Click-delegation handler for <img class="cm-live-image"> elements.
 * Triggers the image popover in live preview mode when user clicks a rendered image.
 */
function _handleDocClick(event: MouseEvent): void {
  const imgEl = (event.target as Element).closest("img.cm-live-image") as HTMLElement | null;
  if (!imgEl) return;

  const view = getEditorView();
  if (!view) return;

  let pos: number;
  try {
    pos = view.posAtDOM(imgEl);
  } catch (err) {
    pos = _fallbackPosFromImgEl(view, imgEl);
    if (pos === -1) {
      console.error("[markdown-toolbar] click: position recovery failed", err);
      return;
    }
  }

  const ctxData = detectImageRegion(view.state, pos);
  if (!ctxData) return;

  const ctx: ImageContext = { ...ctxData, anchorEl: imgEl };
  currentImageContext = ctx;
  triggerMode = "click";
  showPopover(ctx);
}

/**
 * Click-away dismiss handler.
 * Hides the image popover on mousedown outside the popover element.
 */
function _handleDocMousedown(event: MouseEvent): void {
  if (!currentImageContext) return;
  if (_popoverEl && _popoverEl.contains(event.target as Node)) return;
  hideToolbar();
}

// ── 14. Action handler ────────────────────────────────────────────────────────

/**
 * Route a button action string to the appropriate CM6 dispatch.
 *
 * Image actions are handled by handleImageAction; table actions by handleTableAction.
 * Markdown format actions are handled inline by handleButtonClick (attached to button
 * DOM elements directly) — they do not go through this function.
 *
 * Exported for test access.
 *
 * @param action - The data-action attribute value from the clicked button.
 */
export function handleAction(action: string): void {
  if (isImageAction(action)) {
    handleImageAction(action);
    return;
  }
  if (isTableAction(action)) {
    handleTableAction(action);
    return;
  }
}

/**
 * True when the action string belongs to the image sub-toolbar.
 *
 * Image alignment actions use the "img-align-*" prefix to avoid colliding
 * with the identically-named table column-alignment actions ("align-left",
 * "align-center", "align-right"). The float-right action is image-only so
 * its name is unambiguous and kept as-is.
 */
function isImageAction(action: string): boolean {
  return (
    action === "choose-file" ||
    action === "embed-image" ||
    action === "img-align-left" ||
    action === "img-align-center" ||
    action === "img-align-right" ||
    action === "align-float-right"
  );
}

/** True when the action string belongs to the table sub-toolbar. */
function isTableAction(action: string): boolean {
  return (
    action === "insert-table" ||
    action === "delete-table" ||
    action === "insert-row-above" ||
    action === "insert-row-below" ||
    action === "delete-row" ||
    action === "insert-col-left" ||
    action === "insert-col-right" ||
    action === "delete-col" ||
    action === "align-left" ||
    action === "align-center" ||
    action === "align-right" ||
    action === "move-row-up" ||
    action === "move-row-down"
  );
}

/**
 * Handle an image sub-toolbar action.
 * Ported verbatim from image-toolbar.plugin.ts handleAction.
 */
function handleImageAction(action: string): void {
  switch (action) {
    case "choose-file": {
      const dialog = (window as unknown as Record<string, unknown>)["__TAURI_DIALOG__"] as
        | { open: (options: unknown) => Promise<string | null> }
        | undefined;

      if (!dialog?.open) {
        // EC-28: dialog global not available — warn and no-op.
        console.warn("[markdown-toolbar] __TAURI_DIALOG__ not available");
        return;
      }

      // Capture current file path BEFORE the async dialog opens (EC-25).
      const currentFile = (window as unknown as Record<string, unknown>)[
        "__MARKABLE_CURRENT_FILE__"
      ] as string | null | undefined;

      dialog
        .open({
          multiple: false,
          filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
        })
        .then((selectedPath: string | null) => {
          if (!selectedPath) return; // EC-27: user cancelled.
          const docPath = currentFile ?? null;
          const resolvedUrl = resolveRelativePath(selectedPath, docPath);
          const view = getEditorView();
          if (!view || !currentImageContext) return;
          const { from, to, rawSource } = currentImageContext;
          const newSource = replaceImageSrc(rawSource, resolvedUrl);
          view.dispatch({ changes: { from, to, insert: newSource } });
          hideToolbar();
        })
        .catch((err: unknown) => {
          console.error("[markdown-toolbar] dialog.open() failed", err);
        });
      break;
    }

    case "embed-image": {
      if (!currentImageContext) return;
      const newUrl = _urlInput?.value ?? "";
      if (newUrl.trim() === "") return;
      if (newUrl === currentImageContext.url) return;
      const view = getEditorView();
      if (!view) return;
      const { from, to, rawSource } = currentImageContext;
      const newSource = replaceImageSrc(rawSource, newUrl);
      view.dispatch({ changes: { from, to, insert: newSource } });
      hideToolbar();
      break;
    }

    // Image alignment cases use the "img-align-*" prefix (see isImageAction).
    case "img-align-left":
    case "img-align-center":
    case "img-align-right":
    case "align-float-right": {
      if (!currentImageContext) return;
      const view = getEditorView();
      if (!view) return;
      const alignMap: Record<string, AlignmentState> = {
        "img-align-left":    "left",
        "img-align-center":  "center",
        "img-align-right":   "right",
        "align-float-right": "float-right",
      };
      const alignment = alignMap[action];
      const { from, to, rawSource } = currentImageContext;
      const newSource = applyAlignment(rawSource, alignment);
      view.dispatch({ changes: { from, to, insert: newSource } });
      hideToolbar();
      break;
    }

    default:
      console.warn("[markdown-toolbar] unknown image action:", action);
  }
}

/**
 * Handle a table sub-toolbar action.
 * Ported verbatim from table-toolbar.plugin.ts handleAction.
 *
 * @param action - The data-action string from the clicked button.
 */
export function handleTableAction(action: string): void {
  const view = getEditorView();
  if (!view) return;

  const state = view.state;
  const ctx = detectTableContextFromState(state);

  switch (action) {

    case "insert-table": {
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
      if (!ctx || ctx.isSeparatorRow) return;
      const newText = insertRowAbove(ctx.tableText, ctx.rowIndex);
      if (newText === null) return;
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "insert-row-below": {
      if (!ctx || ctx.isSeparatorRow) return;
      const newText = insertRowBelow(ctx.tableText, ctx.rowIndex);
      if (newText === null) return;
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "delete-row": {
      if (!ctx || ctx.isHeaderRow || ctx.isSeparatorRow) return;
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
      if (ctx.columnCount <= 1) return;
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

    case "move-row-up": {
      // Move the current row one position up (toward lower index) in the table.
      // rowIndex is 0-based absolute; moveRow guards against moving header/separator
      // (indices 0 and 1) so a guard of rowIndex > 2 is needed here (row 2 is the
      // first data row; moving it up would place it at index 1, which moveRow rejects).
      if (!ctx || ctx.isSeparatorRow || ctx.isHeaderRow) return;
      // rowIndex is null only when isSeparatorRow is true; the guard above ensures
      // it is a number here. The explicit null check satisfies the TypeScript compiler.
      if (ctx.rowIndex === null) return;
      if (ctx.rowIndex <= 2) return; // already the first data row — nowhere to go
      const newText = moveRow(ctx.tableText, ctx.rowIndex, ctx.rowIndex - 1);
      if (newText === null) return;
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }

    case "move-row-down": {
      // Move the current row one position down (toward higher index) in the table.
      // rowIndex + 2 as toIdx places the dragged row after its current successor
      // (effectively swapping the two rows).
      if (!ctx || ctx.isSeparatorRow || ctx.isHeaderRow) return;
      // rowIndex is null only when isSeparatorRow is true; the guard above ensures
      // it is a number here. The explicit null check satisfies the TypeScript compiler.
      if (ctx.rowIndex === null) return;
      const rowCount = ctx.tableText.split("\n").filter(Boolean).length;
      if (ctx.rowIndex >= rowCount - 1) return; // already the last row — nowhere to go
      const newText = moveRow(ctx.tableText, ctx.rowIndex, ctx.rowIndex + 2);
      if (newText === null) return;
      view.dispatch({ changes: { from: ctx.tableFrom, to: ctx.tableTo, insert: newText } });
      break;
    }
  }
}

// ── 15. onEnable / onDisable / renderDetailExtra ──────────────────────────────

/**
 * Activate the unified toolbar plugin.
 *
 * Loads settings, injects CSS, builds DOM for all three sub-toolbars,
 * registers document/editor event listeners, and registers the CM6 updateListener.
 *
 * Mode-specific setup:
 *   - floating: appends markdown toolbar, table floating elements, and image popover
 *     to document.body. All start hidden.
 *   - sidebar: registers a single sidebar panel with inner swap divs; image popover
 *     is ALWAYS appended to body regardless of mode (AD-5 / FR-4).
 *
 * @param api - The MarkablePluginAPI instance provided by the plugin loader.
 */
export async function onEnable(api: MarkablePluginAPI): Promise<void> {
  _enabled = true;
  _api = api;

  // Load and validate persisted settings (EC-15, EC-16, EC-17).
  // Only reads "markdown-toolbar" namespace — old table-toolbar / image-toolbar
  // settings files on disk are ignored (EC-18).
  const raw = await api.loadSettings();
  _settings = mergeWithDefaults(raw as Record<string, unknown> | null);

  // Inject unified CSS (idempotent — EC-9).
  injectCSS();

  if (_settings.toolbarMode === "floating") {
    // ── Floating mode setup ────────────────────────────────────────────────
    const { toolbar, buttons } = buildToolbarDOM();
    _toolbarEl = toolbar;
    _buttons   = buttons;
    _toolbarEl.style.display = "none";
    document.body.appendChild(_toolbarEl);

    _topBar     = buildTopBar();
    _rowHandle  = buildRowHandle();
    _bottomPill = buildBottomPill();
    _topBar.style.display     = "none";
    _rowHandle.style.display  = "none";
    _bottomPill.style.display = "none";
    document.body.appendChild(_topBar);
    document.body.appendChild(_rowHandle);
    document.body.appendChild(_bottomPill);

    // Image popover always appended to body (AD-5).
    _popoverEl = buildPopover();
    _popoverEl.style.display = "none";
    document.body.appendChild(_popoverEl);

    // Window blur listener hides all floating elements when editor loses focus.
    _blurListener = () => {
      if (_topBar)    _topBar.style.display    = "none";
      if (_rowHandle) _rowHandle.style.display = "none";
      if (_bottomPill) _bottomPill.style.display = "none";
      hideToolbar();
    };
    window.addEventListener("blur", _blurListener, true);

  } else {
    // ── Sidebar mode setup ─────────────────────────────────────────────────
    _sidebarPanelEl = buildSidebarPanel();

    // Point _buttons at the markdown buttons inside the panel.
    const mdContent = _sidebarPanelEl.querySelector("#unified-toolbar-md-content") as HTMLElement;
    _buttons = mdContent.querySelectorAll<HTMLButtonElement>("button[data-format]");

    api.registerSidebarPanel({
      id:           "markdown-toolbar",
      title:        "Toolbar",
      side:         _settings.sidebarSide,
      defaultWidth: 220,
      render(container: HTMLElement): void {
        if (_sidebarPanelEl) container.appendChild(_sidebarPanelEl);
        // Initial disabled state for markdown buttons.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as EditorViewType | undefined;
        /* eslint-enable @typescript-eslint/no-explicit-any */
        const selEmpty = liveView ? liveView.state.selection.main.empty : true;
        updateDisabledState(selEmpty, _buttons);
      },
      destroy(_container: HTMLElement): void {
        _sidebarPanelEl = null;
      },
    });
    _sidebarPanelRegistered = true;

    // Image popover is ALWAYS floating even in sidebar mode (AD-5, FR-4).
    _popoverEl = buildPopover();
    _popoverEl.style.display = "none";
    document.body.appendChild(_popoverEl);
  }

  // Document listeners for image click path (both modes).
  _onDocClick     = _handleDocClick;
  _onDocMousedown = _handleDocMousedown;
  document.addEventListener("click",     _onDocClick);
  document.addEventListener("mousedown", _onDocMousedown);

  // Editor blur listener for image popover dismiss.
  _onEditorBlur = () => hideToolbar();
  const editorDom = getEditorView()?.dom;
  if (editorDom) {
    editorDom.addEventListener("blur", _onEditorBlur);
  }

  // Register the single shared CM6 updateListener (NFR-1).
  api.addExtensions([buildUpdateListener()]);
}

/**
 * Deactivate the unified toolbar plugin.
 *
 * Exact reversal of onEnable: cancels debounce, removes CM6 extension, removes all
 * DOM elements, removes event listeners, and resets all module-level state.
 * All three sub-toolbars' teardown is combined here (EC-6, EC-7, EC-8, EC-9).
 *
 * @param api - The MarkablePluginAPI instance provided by the plugin loader.
 */
export function onDisable(api: MarkablePluginAPI): void {
  _enabled = false;
  const mode = _settings.toolbarMode; // capture before reset

  // Cancel any in-flight debounce (EC-9).
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  // Cancel any in-progress drag — remove indicator from DOM (EC-30).
  if (_dragIndicator) {
    _dragIndicator.remove();
    _dragIndicator = null;
  }

  // Remove CM6 extension.
  api.removeExtensions();

  // Remove document listeners.
  if (_onDocClick)     { document.removeEventListener("click",     _onDocClick);     _onDocClick     = null; }
  if (_onDocMousedown) { document.removeEventListener("mousedown", _onDocMousedown); _onDocMousedown = null; }

  // Remove editor blur listener.
  if (_onEditorBlur) {
    getEditorView()?.dom?.removeEventListener("blur", _onEditorBlur);
    _onEditorBlur = null;
  }

  // Remove window blur listener (floating mode only).
  if (_blurListener) {
    window.removeEventListener("blur", _blurListener, true);
    _blurListener = null;
  }

  // Mode-specific DOM teardown.
  if (mode === "floating") {
    // Remove all floating elements (EC-7, EC-8).
    _toolbarEl?.remove();
    _topBar?.remove();
    _rowHandle?.remove();
    _bottomPill?.remove();
  }

  // Image popover is always floating, always in body — remove in both modes (EC-6).
  _popoverEl?.remove();

  // Unregister sidebar panel (EC-10, EC-11).
  if (_sidebarPanelRegistered) {
    api.unregisterSidebarPanel("markdown-toolbar");
    _sidebarPanelRegistered = false;
  }

  // Remove unified CSS.
  removeCSS();

  // Reset the remaining module-level state variables to their initial values so the
  // next onEnable call starts from a clean slate (NFR-2). Variables already nulled
  // earlier in this function (_dragIndicator, _onDocClick, _onDocMousedown,
  // _onEditorBlur, _blurListener, _sidebarPanelRegistered) are intentionally omitted
  // from this block — they were reset at their respective teardown call sites above.
  _enabled         = false;
  _settings        = { ...DEFAULT_SETTINGS };
  _api             = null;
  _debounceTimer   = null;
  _view            = null;
  _toolbarEl       = null;
  _buttons         = null;
  _clickInFlight   = false;
  _topBar          = null;
  _rowHandle       = null;
  _bottomPill      = null;
  _sidebarPanelEl  = null;
  _popoverEl       = null;
  currentImageContext = null;
  triggerMode      = null;
  _urlInput        = null;
  _alignBtns       = null;
}

/**
 * Render the 3-way position toggle (Left / Float / Right) in the Plugins Panel
 * detail view.
 *
 * Identical to the controls in the original markdown-toolbar and table-toolbar.
 * The image sub-toolbar has no position control (it is always floating — AD-5).
 *
 * @param container - The detail-view body element provided by the Plugins Panel.
 */
export function renderDetailExtra(container: HTMLElement): void {
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
    { id: "left-sidebar",  label: "Left"  },
    { id: "floating",      label: "Float" },
    { id: "right-sidebar", label: "Right" },
  ];

  for (const opt of options) {
    const btn = document.createElement("button");
    btn.className =
      "plugin-detail-sidebar-btn" + (activePosition === opt.id ? " active" : "");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      if (!_api || activePosition === opt.id) return;
      const newMode: ToolbarMode = opt.id === "floating" ? "floating" : "sidebar";
      const newSide: SidebarSide = opt.id === "right-sidebar" ? "right" : "left";
      void _api.saveSettings({ toolbarMode: newMode, sidebarSide: newSide })
               .then(() => _api!.restartSelf());
    });
    section.appendChild(btn);
  }

  section.prepend(label);
  container.appendChild(section);
}

// ── 16. Plugin export object ──────────────────────────────────────────────────

/**
 * Test-only helper: set the module-level currentImageContext directly.
 * Preserved from the original image-toolbar for test compatibility.
 *
 * @param ctx - The ImageContext to set, or null to clear.
 */
export function _setContextForTesting(ctx: ImageContext | null): void {
  currentImageContext = ctx;
}

/**
 * Unified Toolbar plugin export object.
 *
 * id: "markdown-toolbar" — the single plugin ID for all three sub-toolbars.
 * sidebarPanelId is always set so the Plugins Panel shows the L/R toggle.
 */
export default {
  id:             "markdown-toolbar",
  name:           "Markdown Toolbar",
  version:        "2.0.0",
  description:    "Context-sensitive toolbar: formatting, table management, and image controls",
  detail:
    "Unified toolbar that switches automatically based on cursor context. " +
    "Shows formatting buttons by default, table management controls when inside a table, " +
    "and an image popover when on an image line. Available as a floating bubble (default) " +
    "or a docked sidebar panel.",
  sidebarPanelId: "markdown-toolbar",
  renderDetailExtra,
  onEnable,
  onDisable,
};

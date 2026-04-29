/**
 * Command Bar plugin for Markable 2.0 (FC2 #11 + Modal Command Bar step 01).
 *
 * Implements a floating modal command palette with three modes:
 *   - Files mode (Cmd-P): search open tabs and workspace files
 *   - Commands mode (Cmd-Shift-P): fuzzy-search app commands and headings
 *   - Keybindings mode (Cmd-Shift-K): browse and reassign keyboard shortcuts
 *
 * Architecture:
 *   - IIFE plugin: no app module imports at runtime. All inter-boundary
 *     communication goes through window globals (AD-01..AD-09 in 00_index.md).
 *   - fuzzy-ranker.ts is a pure module imported here and bundled inline by Rollup.
 *   - All CSS uses CSS variables; no hardcoded hex or font names (NFR-04).
 *   - Single DOM instance: overlay created once in onEnable, reused across opens.
 *   - Focus trap: Tab/Shift-Tab cycle through results; focus never leaves overlay.
 *   - Mode state is module-level (_mode variable), never derived from DOM (AD-CB-01).
 */

import { fuzzyMatch, renderHighlightedLabel } from "./fuzzy-ranker";
import type { FuzzyMatch } from "./fuzzy-ranker";
import {
  buildFilesResults,
  countWorkspaceBeforeCap,
  FILES_CAP,
  FILES_SECTION_LABELS,
} from "./files-mode";
import type { FilesResult, TabEntry } from "./files-mode";
import {
  buildKeybindingResults,
  captureKeyFromEvent,
  checkConflict,
  isModifierOnly,
  formatKeyDisplay,
  type KeybindingResult,
  type ConflictInfo,
} from "./keybindings-mode";
import {
  loadPresets,
  saveNewPreset,
  deletePreset,
  renamePreset,
  validatePresetName,
  DEFAULT_PRESET_NAME,
  type PresetEntry,
  type PresetApiDeps,
} from "./preset-manager";
import { buildToggleRow } from "../../settings/settings-fields";

// ── Re-export public functions used by test imports ───────────────────────────
export { renderHighlightedLabel };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The four operating modes of the modal command bar.
 *
 *   files       — open tabs + vault-wide file search (Cmd-P)
 *   commands    — app commands + headings (Cmd-Shift-P, legacy default)
 *   keybindings — browse and reassign keyboard shortcuts (Cmd-Shift-K)
 *   content     — full-text vault content search (accessed via '/' prefix)
 *
 * Mode state is stored as a module-level variable (_mode) — never derived from
 * DOM attributes — to keep transitions O(1) and avoid layout reads (AD-CB-01).
 */
export type BarMode = "files" | "commands" | "keybindings" | "content";

/**
 * The result categories shown in the Command Bar.
 * "content" is used for content-search result rows registered in _visibleResults;
 * the rendering path for content mode ignores this field, but having a proper
 * literal avoids the `as any` cast that would otherwise be needed.
 */
type ResultCategory = "commands" | "headings" | "recent" | "content";

/**
 * A single item in the Command Bar results list.
 *
 * The `action` closure is captured at build time and called when the user
 * activates the result. Closures capture relevant state (e.g. line offset
 * for heading navigation) so no extra lookup is needed at activation time.
 */
interface CommandBarResult {
  id: string;                 // Unique per result (e.g. "cmd:file-save")
  category: ResultCategory;
  label: string;              // Display text; used for fuzzy matching
  sublabel?: string;          // Secondary text (e.g. directory path for recent files)
  keybinding?: string;        // Formatted key badge string (Category A only)
  headingLevel?: number;      // 1–6 (Category B only)
  dimmed: boolean;            // True when context-invalid (no file open)
  action: () => void;         // Executed on activation; bar closes before calling
  _matchPositions?: number[]; // Set by filterAndRender(); consumed by renderResults()
}

/**
 * Internal type pairing a result with its fuzzy match metadata for sorting.
 */
interface MatchedResult {
  result: CommandBarResult;
  match: FuzzyMatch;
}

/**
 * Shape expected from the PluginManager global.
 * Typed loosely to avoid importing the actual PluginManager class.
 */
interface PluginManagerLike {
  getStates(): Record<string, boolean>;
  toggle(id: string, enabled: boolean): Promise<void>;
  getDefinitions(): Array<{ id: string; name: string }>;
}

/** Subset of MarkableSettings that the Command Bar reads. */
interface MarkableSettingsSubset {
  recentFiles: string[];
  keybindings?: Record<string, string>;
}

/** Plugin API surface (from src/plugins/markable-plugin-api.ts). */
interface MarkablePluginAPI {
  loadSettings(): Promise<Record<string, unknown> | null>;
  saveSettings(data: Record<string, unknown>): Promise<void>;
}

/** Shape of a CommandDef entry from keybindings-panel.ts. */
interface CommandDef {
  id: string;
  label: string;
  defaultKey: string;
  section: string;
}

/** Dependency injection bag for buildCommandResults(). */
export interface CommandBuilderDeps {
  commands: CommandDef[];
  pluginManager: PluginManagerLike;
  keybindings: Record<string, string>;
  currentFile: string | null;
  navigateToPlugin: (pluginId: string) => void;
}

/** Dependency injection bag for buildHeadingResults(). */
export interface HeadingBuilderDeps {
  cmState: any | null;   // CodeMirror EditorState instance (from __MARKABLE_EDITOR_VIEW__.state)
  currentFile: string | null;
}

/** Dependency injection bag for buildRecentFileResults(). */
export interface RecentFilesBuilderDeps {
  recentFiles: string[];
  openFileByPath: (path: string) => Promise<void>;
}

/**
 * Persisted settings for the Command Bar plugin.
 *
 * `showRecentFiles` is deprecated as of the Modal Command Bar refactor (Step 03).
 * It is accepted on load for backwards-compatibility but ignored in practice.
 * It must remain in the interface to satisfy existing tests for renderDetailExtra.
 */
interface CommandBarSettings {
  showCommands:    boolean; // default: true
  showHeadings:    boolean; // default: true
  showRecentFiles: boolean; // deprecated (FR-09.2); kept for export compat; default: true
  activePreset:    string;  // name of the active keybinding preset; default: "Default"
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Section header labels rendered above each category group.
 * Kept as a lookup table to avoid string literals scattered across the code.
 */
const CATEGORY_LABELS: Record<ResultCategory, string> = {
  commands:  "Commands",
  headings:  "Headings",
  recent:    "Recent Files",
  // "content" is used for rows registered in _visibleResults during content-mode
  // search results. The label is never surfaced in the UI (content mode has its
  // own section header rendering path), but the exhaustive Record type requires it.
  content:   "Content Search",
};

/**
 * Command ids that require an open file to be meaningful.
 * Commands in this set are dimmed when window.__MARKABLE_CURRENT_FILE__ is null.
 * See also: requiresFile() which additionally checks for the "format-" prefix.
 */
const REQUIRES_FILE_IDS = new Set([
  "file-save",
  "file-save-as",
  "file-export",
  "file-print",
  "edit-paste-plain",
  "edit-paste-link",
  "edit-copy-plain",
  "edit-copy-html",
  "edit-duplicate-line",
  "edit-delete-line",
  "edit-goto-line",
  "edit-find",
  "edit-find-replace",
]);

/** Default plugin settings applied when no saved data exists. */
const DEFAULT_SETTINGS: CommandBarSettings = {
  showCommands:    true,
  showHeadings:    true,
  showRecentFiles: true,   // deprecated; kept for export compat and backward compat
  activePreset:    "Default",
};

// ---------------------------------------------------------------------------
// Mode constants (Step 01 — Mode Infrastructure)
// ---------------------------------------------------------------------------

/**
 * Placeholder text shown in the search input for each mode.
 * Gives the user an immediate visual cue about what the current mode searches.
 * FR-4: files mode now says "Search vault files…" to communicate vault-wide scope.
 */
export const MODE_PLACEHOLDERS: Record<BarMode, string> = {
  files:       "Search vault files…",
  commands:    "Type a command or search headings…",
  keybindings: "Search actions to assign shortcut…",
  content:     "Search file contents…",
};

/**
 * Footer hint text for each mode. Shown in the .cb-footer bar at the bottom
 * of the overlay panel so the user knows what Enter and Escape do.
 */
export const MODE_FOOTER_HINTS: Record<BarMode, string> = {
  files:       "Enter to open  ·  Esc to close",
  commands:    "Enter to run  ·  Esc to close",
  keybindings: "Enter to assign shortcut  ·  Esc to close",
  content:     "Enter to search  ·  Esc to close",
};

/**
 * Human-readable mode labels displayed in the mode badge button.
 */
export const MODE_BADGE_LABELS: Record<BarMode, string> = {
  files:       "Files",
  commands:    "Commands",
  keybindings: "Keybindings",
  content:     "Content",
};

/**
 * Cycle order for tab strip clicks (FR-08.3, AD-GS-07).
 * Content is appended at the end — accessed primarily via '/' prefix, not Tab cycling.
 */
export const MODE_CYCLE: BarMode[] = ["commands", "files", "keybindings", "content"];

/**
 * Shortcut hint glyphs shown next to each tab label.
 * Displayed in a muted, smaller font so power users can see the hotkey at a glance
 * without the glyph competing visually with the tab label (NFR-04 — no hardcoded hex).
 * Content mode shortcut is Cmd-Shift-G (⌘⇧G); also accessible via '/' prefix (FR-5).
 */
export const MODE_TAB_SHORTCUTS: Record<BarMode, string> = {
  files:       "⌘P",
  commands:    "⌘⇧P",
  keybindings: "⌘⇧K",
  content:     "⌘⇧G",
};

/** Id of the CSS style tag injected by injectCSS(). */
const STYLE_ID = "__markable_command_bar_css__";

/**
 * The full CSS for the Command Bar overlay. Injected as a <style> tag so the
 * plugin remains self-contained (IIFE constraint). All values use CSS variables
 * for theme compatibility (NFR-04).
 *
 * Fallback values are included for environments where CSS variables are not
 * yet set (e.g. during tests).
 */
const CSS_TEXT = `
/* ── Command Bar overlay ─────────────────────────────── */

#markable-command-bar-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
}

#markable-command-bar-overlay.cb-hidden {
  display: none;
}

.cb-panel {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  width: 560px;
  max-width: calc(100vw - 48px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: var(--ui-font);
  color: var(--text-primary);
}

.cb-input-row {
  /* flex layout: badge | input (badge is flex-shrink:0; input fills remaining width) */
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.cb-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--ui-font);
  font-size: 15px;
  color: var(--text-primary);
  caret-color: var(--accent-color);
  padding: 0;
}

.cb-input::placeholder {
  color: var(--text-secondary);
}

.cb-results {
  overflow-y: auto;
  max-height: 380px;
  padding: 4px 0;
}

.cb-section-header {
  padding: 5px 14px 3px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary);
  user-select: none;
}

.cb-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  cursor: pointer;
  font-size: 13.5px;
  color: var(--text-primary);
  border-radius: 6px;
  margin: 0 4px;
  min-height: 34px;
  overflow: hidden;
}

.cb-result:hover:not(.cb-result--dimmed) {
  background: var(--code-bg);
}

.cb-result--selected {
  background: var(--accent-color) !important;
  color: #fff;
}

.cb-result--dimmed {
  opacity: 0.38;
  cursor: default;
  pointer-events: none;
}

.cb-result-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cb-result-sublabel {
  font-size: 11.5px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.cb-result--selected .cb-result-sublabel {
  color: rgba(255,255,255,0.70);
}

.cb-result-key {
  font-family: var(--key-font);
  font-size: 11px;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--code-bg);
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.cb-result--selected .cb-result-key {
  background: rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.85);
}

.cb-result-level {
  font-family: var(--mono-font);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--code-bg);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.cb-result--selected .cb-result-level {
  background: rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.80);
}

mark.cb-match {
  background: transparent;
  color: var(--accent-color);
  font-weight: 600;
}

.cb-result--selected mark.cb-match {
  color: #fff;
  text-decoration: underline;
}

.cb-empty {
  padding: 18px 14px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
  user-select: none;
}

/* ── Mode tab strip (replaces single badge pill) ─────────── */
/*
 * WHY a tab strip instead of a cycling badge:
 *   All three modes are always visible, making it obvious that Files / Commands /
 *   Keybindings exist without requiring the user to discover them via clicking.
 *   The active tab gets a 2 px accent underline; inactive tabs are dimmed (50 %).
 *   Clicking any tab switches directly to that mode (no cycling needed).
 */

.cb-tab-strip {
  /* Full-width flex row sitting above the input; padded to align with input text */
  display: flex;
  align-items: stretch;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-color, #ccc);
  gap: 0;
}

.cb-tab {
  /* Each tab is a plain button — no default browser styling */
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  border: none;
  background: transparent;
  font-family: var(--ui-font);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  /* 2 px bottom border slot reserved on all tabs; transparent on inactive */
  border-bottom: 2px solid transparent;
  /* Shift down so the 2 px border sits exactly on the strip's bottom edge */
  margin-bottom: -1px;
  opacity: 0.5;
  transition: opacity 0.1s ease;
}

.cb-tab:hover {
  opacity: 0.8;
}

/* Active tab: full brightness + accent underline */
.cb-tab--active {
  opacity: 1;
  border-bottom-color: var(--accent-color, #0070f3);
  color: var(--text-primary);
}

/* Shortcut glyph shown to the right of the tab label */
.cb-tab-hint {
  font-size: 10px;
  font-weight: 400;
  font-family: var(--key-font, var(--mono-font));
  color: var(--text-secondary, #888);
  /* Slightly smaller so it does not compete visually with the label */
  opacity: 0.85;
}

/* ── Footer hint bar (Step 01) ───────────────────────────── */

.cb-footer {
  padding: 6px 14px;
  font-size: 11px;
  color: var(--text-secondary, #666);
  border-top: 1px solid var(--border-color, #ccc);
  user-select: none;
}

/* ── Preset row (Step 01 scaffold; shown only in keybindings mode) ─── */

.cb-preset-row {
  position: relative;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-color, #ccc);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

/* Hidden by default; removed by setMode("keybindings") */
.cb-preset-row--hidden {
  display: none;
}

/* ── Files mode: loading / notice rows (Step 02) ──────────────────── */

/* "Loading…" placeholder shown while the async workspace scan is in-flight. */
.cb-loading {
  padding: 16px 14px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #666);
  user-select: none;
  font-style: italic;
}

/* Inline notice rows: no-workspace, no-files, capped, error. */
.cb-notice {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  user-select: none;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

/* ── Key-capture view (Step 04) ──────────────────────────── */

.cb-capture-view {
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cb-capture-view--hidden {
  display: none;
}

/* Hidden class for results list while key-capture sub-state is active. */
.cb-results--hidden {
  display: none;
}

.cb-capture-action {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.cb-capture-existing {
  font-size: 12px;
  color: var(--text-secondary);
}

.cb-capture-prompt {
  font-size: 13px;
  color: var(--text-secondary);
  font-style: italic;
}

.cb-conflict-warning {
  font-size: 13px;
  color: var(--accent-color);
}

.cb-capture-buttons {
  display: flex;
  gap: 8px;
}

.cb-capture-btn {
  padding: 5px 12px;
  border-radius: 5px;
  border: 1px solid var(--border-color);
  background: var(--code-bg);
  color: var(--text-primary);
  font-family: var(--ui-font);
  font-size: 12px;
  cursor: pointer;
}

.cb-capture-btn--primary {
  background: var(--accent-color);
  color: #fff;
  border-color: var(--accent-color);
}

/* "(default)" / "(custom)" / "(unbound)" label shown on keybinding result rows. */
.cb-result-binding-status {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

/* Key badge shown on keybinding mode result rows (distinct from command mode's .cb-result-key). */
.cb-result-key-badge {
  font-family: var(--key-font);
  font-size: 11px;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--code-bg);
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Preset row UI (Step 05) ──────────────────────────────────── */

.cb-preset-name {
  font-size: 12px;
  color: var(--text-secondary);
  flex: 1;
}

.cb-preset-dropdown-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 2px 6px;
  border-radius: 4px;
}

.cb-preset-dropdown-btn:hover {
  background: var(--code-bg);
}

.cb-preset-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
  z-index: 10000;
  overflow: hidden;
}

.cb-preset-dropdown-item {
  padding: 7px 12px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.cb-preset-dropdown-item:hover {
  background: var(--code-bg);
}

.cb-preset-dropdown-item--active {
  color: var(--accent-color);
  font-weight: 600;
}

.cb-preset-dropdown-item--action {
  color: var(--text-secondary);
  font-style: italic;
}

.cb-preset-action-btn {
  border: none;
  background: transparent;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 3px;
}

.cb-preset-action-btn:hover {
  background: var(--code-bg);
  color: var(--text-primary);
}

.cb-preset-save-input {
  flex: 1;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 3px 6px;
  font-family: var(--ui-font);
  font-size: 12px;
  color: var(--text-primary);
  outline: none;
}

.cb-preset-save-input:focus {
  border-color: var(--accent-color);
}

.cb-preset-save-error {
  font-size: 11px;
  color: var(--accent-color);
  display: none;
  width: 100%;
  padding: 2px 0;
}

/* ── Content mode rows (Step 03) ─────────────────────────────── */

/* File header row: bold title with a separator above each group. */
.cb-result--content-header {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--text-primary);
  border-top: 1px solid var(--border-color);
  margin-top: 4px;
  padding-top: 8px;
}

/* Remove the top border from the very first header row in the list. */
.cb-result--content-header:first-child {
  border-top: none;
  margin-top: 0;
}

/* Excerpt rows: indented, smaller, muted text. */
.cb-result--content-excerpt {
  padding-left: 24px;
  font-size: 12.5px;
  color: var(--text-secondary);
}

/* The matched substring within an excerpt is highlighted in accent colour. */
.cb-result--content-excerpt strong {
  color: var(--accent-color);
  font-weight: 600;
}

/* Line number prefix shown before each excerpt line. */
.cb-content-excerpt-linenum {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  margin-right: 4px;
  opacity: 0.6;
  flex-shrink: 0;
}

/* The line text part of an excerpt row — clipped if too long. */
.cb-content-excerpt-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* "N more matches" non-clickable trailer row for files with >3 matches. */
.cb-result--content-more {
  padding: 2px 24px 6px;
  font-size: 11.5px;
  color: var(--text-secondary);
  opacity: 0.7;
  cursor: default;
  user-select: none;
}

/* General content mode notice rows (empty state, errors, loading). */
.cb-content-notice {
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-secondary);
}

/* Warning variant: cap notice and skipped-files notice. */
.cb-content-notice--warning {
  color: var(--accent-color);
  font-size: 12px;
}
`;

// ---------------------------------------------------------------------------
// CSS injection / removal
// ---------------------------------------------------------------------------

/**
 * Inject the Command Bar CSS into the document <head> as a <style> tag.
 * Idempotent: does nothing if the tag already exists.
 */
function injectCSS(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS_TEXT;
  document.head.appendChild(style);
}

/**
 * Remove the injected CSS style tag. Called in onDisable to clean up.
 */
function removeCSS(): void {
  document.getElementById(STYLE_ID)?.remove();
}

// ---------------------------------------------------------------------------
// Context-invalid dimming helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the given command id requires an open file to be meaningful.
 * Commands that require a file are dimmed in the results list when no file is
 * currently open (FR-05). The "format-" prefix covers all formatting commands.
 *
 * @param id - A CommandDef id string (e.g. "file-save", "format-bold").
 */
function requiresFile(id: string): boolean {
  return REQUIRES_FILE_IDS.has(id) || id.startsWith("format-");
}

// ---------------------------------------------------------------------------
// Key formatting helper (mirrors keybindings-panel.ts implementation)
// ---------------------------------------------------------------------------

/**
 * Convert a key string like "Cmd-Shift-S" to symbol notation "⌘⇧S".
 * This is a copy of the same function from keybindings-panel.ts — we inline
 * it here because the IIFE plugin cannot import from TypeScript modules.
 *
 * @param key - Key string in "Cmd-Shift-X" format.
 * @returns Formatted string with platform symbols (⌘, ⇧, ⌥, ⌃).
 */
function formatKeyForDisplay(key: string): string {
  return key.split("-").map((part) => {
    switch (part) {
      case "Cmd":   return "⌘";
      case "Shift": return "⇧";
      case "Alt":   return "⌥";
      case "Ctrl":  return "⌃";
      default:      return part;
    }
  }).join("");
}

// ---------------------------------------------------------------------------
// Category A: Command result builder (FR-03.A)
// ---------------------------------------------------------------------------

/**
 * Build Category A results: one result per COMMANDS entry (minus the Command
 * Bar itself) plus two results per loaded plugin (action + navigate).
 *
 * Dependencies are passed explicitly so this function can be tested in
 * isolation without window globals being set (dependency injection pattern).
 *
 * Why this function is justified at >30 lines:
 * The builder has two distinct responsibilities that are tightly coupled: (1)
 * iterating over COMMANDS to produce one result per entry (with dimming logic,
 * key formatting, and self-exclusion), and (2) iterating over plugin definitions
 * to produce two results per plugin (action + navigate). Both loops share the
 * same deps context and output array. Splitting into two sub-functions would
 * force a shared mutable array to be passed as an argument or returned and
 * merged, adding complexity with no readability gain. The sequential nature of
 * the two loops makes inline composition the clearest approach here.
 *
 * @param deps - Command builder dependencies (commands, pluginManager, etc.)
 * @returns Array of CommandBarResult for the Commands category.
 */
export function buildCommandResults(deps: CommandBuilderDeps): CommandBarResult[] {
  const { commands, pluginManager, keybindings, currentFile, navigateToPlugin } = deps;
  const hasFile = currentFile !== null;
  const results: CommandBarResult[] = [];

  // ── Per-command results ──────────────────────────────────────────────────
  for (const cmd of commands) {
    // The Command Bar should not offer itself as a result (it invoked the bar).
    if (cmd.id === "command-bar-open") continue;

    const activeKey = keybindings[cmd.id] ?? cmd.defaultKey;
    // EC-25: only set keybinding when the key string is non-empty.
    const keybinding = activeKey ? formatKeyForDisplay(activeKey) : undefined;
    const dimmed = !hasFile && requiresFile(cmd.id);

    // The action closure captures cmd.id and dispatches it via the global
    // handleAction bridge. Dimmed results guard execution inside activateSelected().
    const actionId = cmd.id;
    results.push({
      id: `cmd:${cmd.id}`,
      category: "commands",
      label: cmd.label,
      keybinding,
      dimmed,
      action: () => {
        const ha = (window as any).__MARKABLE_HANDLE_ACTION__;
        if (typeof ha === "function") ha(actionId);
      },
    });
  }

  // ── Plugin dual-results (FR-04) ──────────────────────────────────────────
  // For each loaded plugin: one "action" result (toggle on/off) and one
  // "navigate" result (open Plugins Panel). Action result comes first (FR-04.2).
  if (pluginManager) {
    const states = pluginManager.getStates();
    const defs = pluginManager.getDefinitions();

    for (const def of defs) {
      const isEnabled = states[def.id] ?? false;

      // Action result: clicking enables or disables the plugin.
      // Label convention (AD-09): when plugin is ON, the action says "Disabled"
      // (clicking will disable it); when OFF, the action says "Enabled".
      const actionLabel = isEnabled
        ? `${def.name} Disabled`
        : `${def.name} Enabled`;

      const pluginId = def.id;
      results.push({
        id: `plugin-toggle:${def.id}`,
        category: "commands",
        label: actionLabel,
        dimmed: false,
        action: () => {
          void pluginManager.toggle(pluginId, !isEnabled);
        },
      });

      // Navigate result: clicking opens the Plugins Panel.
      results.push({
        id: `plugin-nav:${def.id}`,
        category: "commands",
        label: def.name,
        dimmed: false,
        action: () => navigateToPlugin(def.id),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Category B: Heading result builder (FR-03.B)
// ---------------------------------------------------------------------------

/**
 * Build Category B results: one result per Markdown heading (H1–H6) found in
 * the current document.
 *
 * Uses doc.iterLines() for O(n) document scan, then doc.line(n) only for
 * matched lines (O(k log n) where k = number of headings). This keeps the
 * worst-case time well within the 80ms NFR-01 budget for large documents.
 *
 * Why this function is justified at >30 lines:
 * The heading scanner has five tightly coupled steps: null guard, regex
 * definition, line iteration, offset lookup, and result construction with
 * closure capture. The closure for the heading action captures `lineFrom` which
 * is only available during the iteration step — making it impossible to defer
 * result construction to a separate pass. All steps must happen in one loop
 * body, which drives the line count. Decomposing further (e.g. a separate
 * "build heading action" function) would require threading `lineFrom` through
 * an extra parameter layer, adding indirection without clarity benefit.
 *
 * @param deps - Heading builder dependencies (cmState, currentFile).
 * @returns Array of CommandBarResult for the Headings category.
 */
export function buildHeadingResults(deps: HeadingBuilderDeps): CommandBarResult[] {
  const { cmState, currentFile } = deps;
  if (!cmState) return [];

  const results: CommandBarResult[] = [];
  const doc = cmState.doc;
  const HEADING_RE = /^(#{1,6})\s+(.+)$/;

  // doc.iterLines() returns an iterator, not a callback-based API.
  // Use doc.line(n) per iteration: O(log n) per call, O(n log n) total —
  // well within the NFR-01 budget for documents up to several thousand lines.
  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const m = HEADING_RE.exec(line.text);
    if (m) {
      const level = m[1].length;
      const headingText = m[2];
      const lineFrom = line.from; // captured in the closure for cursor placement

      // EC-29: id includes both line number and byte offset, guaranteeing
      // uniqueness even when duplicate headings have the same text.
      results.push({
        id: `heading:${lineNum}:${lineFrom}`,
        category: "headings",
        label: headingText,
        headingLevel: level,
        // FR-05.3: headings are dimmed (non-activatable) when no file is open.
        dimmed: currentFile === null,
        action: () => {
          // Scroll the CM6 editor to the heading's start position and focus it.
          // __MARKABLE_EDITOR_VIEW__ is the live EditorView instance (not the
          // @codemirror/view module namespace which lives at __CM_VIEW__).
          const view = (window as any).__MARKABLE_EDITOR_VIEW__;
          if (!view) return;
          view.dispatch({
            selection: { anchor: lineFrom },
            scrollIntoView: true,
          });
          view.focus();
        },
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Category C: Recent files result builder (FR-03.C)
// ---------------------------------------------------------------------------

/**
 * Build Category C results: one result per recently opened file path.
 *
 * Paths are presented in recency order (most recent first — the order
 * returned by settings.recentFiles). No additional sorting is applied (FR-03.C.3).
 *
 * Home directory prefix (/Users/<name>/) is abbreviated to ~/ for readability.
 *
 * @param deps - Recent files builder dependencies.
 * @returns Array of CommandBarResult for the Recent Files category.
 */
export function buildRecentFileResults(deps: RecentFilesBuilderDeps): CommandBarResult[] {
  return deps.recentFiles.map((filePath, idx) => {
    const basename = filePath.split("/").pop() ?? filePath;
    const dir = filePath.slice(0, filePath.length - basename.length);

    // Abbreviate /Users/<username>/ to ~/ for display (macOS convention).
    // The regex /^\/Users\/[^/]+\// matches /Users/<anything>/ at the start.
    const abbrevDir = dir.replace(/^\/Users\/[^/]+\//, "~/");
    const sublabel = abbrevDir || "/";

    return {
      id: `recent:${idx}`,
      category: "recent",
      label: basename,
      sublabel,
      dimmed: false, // recent files are always activatable (no file-context requirement)
      action: () => {
        const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
        if (tabManager && typeof tabManager.openFileInTab === "function") {
          void tabManager.openFileInTab(filePath);
        }
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Top-level result builder (Step 03: mode-dispatching)
// ---------------------------------------------------------------------------

/**
 * Build results for Commands mode: Commands + Headings categories.
 *
 * Reads window globals and delegates to the pure builder functions
 * (buildCommandResults, buildHeadingResults). The showRecentFiles setting is
 * intentionally NOT used here — the Recent Files category was removed from
 * Commands mode in the Modal Command Bar refactor (FR-09.2, AD-02).
 *
 * Why this function is justified at >30 lines:
 * This function is the boundary between the IIFE plugin sandbox and the app.
 * All window global access is concentrated here rather than scattered across
 * individual builders — each builder accepts explicit dependency injection args
 * (tested in isolation). Reading six distinct globals and constructing the
 * navigateToPlugin closure drives the line count, not algorithmic complexity.
 *
 * @param settings - Current plugin settings (controls which categories are shown).
 * @returns Array of CommandBarResult for the Commands category and/or Headings category.
 */
function buildCommandModeResults(settings: CommandBarSettings): CommandBarResult[] {
  const cmds = (window as any).__MARKABLE_COMMANDS__ as CommandDef[] ?? [];
  if (cmds.length === 0) {
    console.warn("[CommandBar] __MARKABLE_COMMANDS__ is empty or not set. Commands category will be empty.");
  }
  const pm   = (window as any).__MARKABLE_PLUGIN_MANAGER__ as PluginManagerLike | undefined;
  const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
  const appSettings: MarkableSettingsSubset =
    typeof getSettings === "function"
      ? getSettings()
      : { recentFiles: [], keybindings: {} };
  const cmState      = (window as any).__MARKABLE_EDITOR_VIEW__?.state ?? null;
  const currentFile  = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;
  const handleAction = (window as any).__MARKABLE_HANDLE_ACTION__;

  const results: CommandBarResult[] = [];

  if (settings.showCommands) {
    // buildCommandResults is called unconditionally when showCommands is true.
    // The pm (pluginManager) guard is intentionally applied ONLY to the plugin
    // dual-results section INSIDE buildCommandResults — so COMMANDS-array results
    // are always built even when the plugin manager is unavailable (e.g. during
    // early startup or tests that don't inject a plugin manager).
    results.push(...buildCommandResults({
      commands: cmds,
      pluginManager: pm!,
      keybindings: appSettings.keybindings ?? {},
      currentFile,
      // Navigate to plugin: open the Plugins Panel, then rely on the panel
      // to show all plugins. Scrolling to a specific plugin id is a deferred
      // enhancement logged in docs/specs/command-bar/00_index.md.
      navigateToPlugin: (_id: string) => {
        if (typeof handleAction === "function") handleAction("app-plugins");
      },
    }));
  }

  if (settings.showHeadings) {
    results.push(...buildHeadingResults({ cmState, currentFile }));
  }

  // showRecentFiles is intentionally NOT used here (FR-09.2, AD-02).
  // Recent files were part of the old single-mode bar; the modal bar exposes
  // them via Files mode (Cmd-P) rather than Commands mode (Cmd-Shift-P).

  return results;
}

/**
 * Build the result set for the current mode.
 *
 * Dispatches to mode-specific builders:
 *   "commands"    → buildCommandModeResults() (synchronous)
 *   "files"       → returns [] (Files mode builds results via fetchWorkspaceFiles)
 *   "keybindings" → returns [] stub until Step 4 implements buildKeybindingResults()
 *
 * This function is exported for unit testing (Step 03 TDD anchors). Production
 * code calls it only for "commands" mode — the other modes have their own
 * data pipelines in openBar() / fetchWorkspaceFiles().
 *
 * @param mode     - The active BarMode.
 * @param settings - Current plugin settings (controls which categories are shown).
 * @returns Array of CommandBarResult for the given mode.
 */
export function buildResultsForMode(mode: BarMode, settings: CommandBarSettings): CommandBarResult[] {
  if (mode === "commands") {
    return buildCommandModeResults(settings);
  }
  if (mode === "keybindings") {
    // Cast required: KeybindingResult and CommandBarResult share structural contract
    // (id, label, dimmed, action) but differ in extra fields (activeKey, isUnbound, etc.).
    // The keybindings renderer (renderKeybindingResults) receives the typed array directly.
    return buildKeybindingModeResults() as unknown as CommandBarResult[];
  }
  // "files" builds results asynchronously via fetchWorkspaceFiles — not here.
  return [];
}

/**
 * Build the full Keybindings mode result list by reading __MARKABLE_COMMANDS__
 * and the current custom bindings from __MARKABLE_GET_SETTINGS__().
 *
 * Tolerates missing globals gracefully: if __MARKABLE_COMMANDS__ is absent or
 * empty the function returns [] and logs a warning (EC-16 variant).
 *
 * @returns Array of KeybindingResult, one per registered command.
 */
function buildKeybindingModeResults(): KeybindingResult[] {
  const cmds = (window as any).__MARKABLE_COMMANDS__ as CommandDef[] ?? [];
  const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
  const appSettings = typeof getSettings === "function" ? getSettings() : { keybindings: {} };
  const customBindings: Record<string, string> = appSettings.keybindings ?? {};

  if (cmds.length === 0) {
    console.warn("[CommandBar] __MARKABLE_COMMANDS__ is empty. Keybindings mode has no results.");
    return [];
  }

  return buildKeybindingResults({
    commands: cmds,
    customBindings,
    enterCapture: enterKeyCapture,
  });
}

// Note: buildAllResults() was removed in Step 04. All callers now use
// buildResultsForMode(mode, settings) directly. This replaced both the "commands"
// path (buildResultsForMode("commands", ...)) and adds the "keybindings" path
// (buildResultsForMode("keybindings", ...)).

// ---------------------------------------------------------------------------
// DOM builder
// ---------------------------------------------------------------------------

/**
 * Build the Command Bar overlay DOM structure. Called once in onEnable.
 * The returned element is appended to document.body and kept alive for the
 * lifetime of the plugin (hidden/shown by toggling the cb-hidden class).
 *
 * DOM structure (see step_04_overlay_dom.md for full spec):
 *   #markable-command-bar-overlay (backdrop)
 *     .cb-panel
 *       .cb-tab-strip
 *         button.cb-tab[data-mode="files"]
 *         button.cb-tab[data-mode="commands"]
 *         button.cb-tab[data-mode="keybindings"]
 *       .cb-input-row
 *         input.cb-input[role=combobox]
 *       .cb-results#cb-results-list[role=listbox]
 *
 * Why this function is justified at >30 lines:
 * The IIFE plugin cannot inject an HTML template string via innerHTML because
 * doing so would bypass the Content Security Policy (the Tauri webview applies a
 * strict CSP that blocks eval and dynamic HTML parsing from strings). Every element
 * and every attribute must be set programmatically via createElement / setAttribute.
 * The nesting depth (overlay > panel > inputRow > input, plus the results div) and
 * the number of ARIA attributes required by NFR-05 (role, aria-expanded,
 * aria-autocomplete, aria-controls, aria-activedescendant) mean each logical
 * "section" of the DOM takes several lines to construct correctly. The line count
 * is driven by DOM API verbosity, not by algorithmic complexity.
 *
 * @returns The overlay root element.
 */
export function buildOverlayDOM(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.id = "markable-command-bar-overlay";
  overlay.setAttribute("aria-hidden", "true");
  // Start hidden; openCommandBar() removes this class.
  overlay.classList.add("cb-hidden");

  const panel = document.createElement("div");
  panel.className = "cb-panel";

  // ── Tab strip: [Files ⌘P] [Commands ⌘⇧P] [Keybindings ⌘⇧K] ───────────────
  // Sits ABOVE the input row. All three modes are always visible so the user
  // can discover them without clicking a cycling badge (AD-CB-07 revised).
  // The active tab receives the `.cb-tab--active` class; setMode() updates it.
  const tabStrip = document.createElement("div");
  tabStrip.className = "cb-tab-strip";
  tabStrip.setAttribute("role", "tablist");
  tabStrip.setAttribute("aria-label", "Command bar mode");

  // Build one tab button per mode in cycle order.
  for (const mode of MODE_CYCLE) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "cb-tab" + (mode === "files" ? " cb-tab--active" : "");
    tab.dataset.mode = mode;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", mode === "files" ? "true" : "false");
    tab.setAttribute("aria-label", `${MODE_BADGE_LABELS[mode]} mode`);

    // Label text node.
    tab.appendChild(document.createTextNode(MODE_BADGE_LABELS[mode]));

    // Shortcut hint in a separate span so it can be styled independently.
    const hint = document.createElement("span");
    hint.className = "cb-tab-hint";
    hint.setAttribute("aria-hidden", "true");   // decorative; screen reader sees aria-label
    hint.textContent = MODE_TAB_SHORTCUTS[mode];
    tab.appendChild(hint);

    // mousedown preventDefault: keeps input focused while the click fires.
    tab.addEventListener("mousedown", (e) => e.preventDefault());

    tabStrip.appendChild(tab);
  }

  // ── Input row: full-width search input (no badge prepended) ────────────────
  const inputRow = document.createElement("div");
  inputRow.className = "cb-input-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cb-input";
  // Default placeholder for files mode; setMode() will update per mode.
  input.placeholder = MODE_PLACEHOLDERS["files"];
  input.autocomplete = "off";
  input.spellcheck = false;
  // ARIA attributes for screen reader support (NFR-05, EC-27).
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "cb-results-list");
  input.setAttribute("aria-activedescendant", "");
  inputRow.appendChild(input);

  // ── Preset row: only visible in keybindings mode (Step 5) ──────────────────
  // Scaffolded here so DOM is stable; fully populated in Step 5.
  const presetRow = document.createElement("div");
  presetRow.className = "cb-preset-row cb-preset-row--hidden";

  // ── Results list ────────────────────────────────────────────────────────────
  const resultsList = document.createElement("div");
  resultsList.className = "cb-results";
  resultsList.id = "cb-results-list";
  resultsList.setAttribute("role", "listbox");

  // ── Footer hint bar: always present; text changes with mode ─────────────────
  const footer = document.createElement("div");
  footer.className = "cb-footer";
  footer.textContent = MODE_FOOTER_HINTS["files"];

  // ── Key-capture view (Step 04): hidden until enterKeyCapture() activates it ──
  // Sits between results and footer; shown by toggling cb-capture-view--hidden.
  // aria-live="assertive" ensures screen readers announce state changes immediately.
  const captureView = document.createElement("div");
  captureView.className = "cb-capture-view cb-capture-view--hidden";
  captureView.setAttribute("aria-live", "assertive");

  panel.appendChild(tabStrip);
  panel.appendChild(inputRow);
  panel.appendChild(presetRow);
  panel.appendChild(resultsList);
  panel.appendChild(captureView);
  panel.appendChild(footer);
  overlay.appendChild(panel);

  return overlay;
}

// ---------------------------------------------------------------------------
// Results renderer
// ---------------------------------------------------------------------------

/**
 * Clear and rebuild the results list container from the provided results array.
 *
 * Called on every open and on every input event. For performance, the renderer
 * does not diff — it clears and rebuilds each time. At ≤300 results this is
 * fast enough for the NFR-02 <50ms filter latency budget (see 00_index.md).
 *
 * Why this function is justified at >30 lines:
 * The rendering logic has multiple sequential responsibilities that are tightly
 * coupled to the DOM: empty-state guard, category header injection, per-result
 * row construction with conditional children (level badge, sublabel, key badge,
 * highlight rendering). Splitting would scatter the rendering contract.
 *
 * @param container  - The .cb-results element to populate.
 * @param results    - The results to render (may include _matchPositions).
 * @param query      - Current query string (non-empty triggers highlight rendering).
 * @param selectedId - The id of the currently selected result, or null.
 */
export function renderResults(
  container: HTMLElement,
  results: CommandBarResult[],
  query: string,
  selectedId: string | null,
): void {
  container.innerHTML = "";

  if (results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cb-empty";
    // Simple "No results" message. Detailed diagnostics were previously shown
    // here but they made tests fragile and leaked internal state to the UI.
    // Runtime diagnostics now log to the console instead (see buildAllResults).
    empty.textContent = "No results";
    container.appendChild(empty);
    return;
  }

  let lastCategory: ResultCategory | null = null;
  let resultIndex = 0;

  for (const result of results) {
    // Insert a section header whenever the category changes (AD-06).
    if (result.category !== lastCategory) {
      lastCategory = result.category;
      const header = document.createElement("div");
      header.className = "cb-section-header";
      header.setAttribute("data-cat", result.category);
      header.textContent = CATEGORY_LABELS[result.category];
      container.appendChild(header);
    }

    const row = document.createElement("div");
    row.className = "cb-result";
    if (result.dimmed) row.classList.add("cb-result--dimmed");

    if (result.id === selectedId) {
      row.classList.add("cb-result--selected");
      row.setAttribute("aria-selected", "true");
    } else {
      row.setAttribute("aria-selected", "false");
    }
    row.setAttribute("role", "option");
    row.setAttribute("data-id", result.id);
    row.setAttribute("data-cat", result.category);
    // EC-27: id is referenced by input's aria-activedescendant.
    row.id = `cb-result-${resultIndex}`;

    // Heading level badge (Category B only).
    if (result.headingLevel !== undefined) {
      const levelBadge = document.createElement("span");
      levelBadge.className = "cb-result-level";
      levelBadge.textContent = `H${result.headingLevel}`;
      row.appendChild(levelBadge);
    }

    // Label with optional highlight spans.
    const labelEl = document.createElement("div");
    labelEl.className = "cb-result-label";
    if (query && result._matchPositions && result._matchPositions.length > 0) {
      // renderHighlightedLabel builds DOM nodes safely (no innerHTML, EC-10).
      labelEl.appendChild(renderHighlightedLabel(result.label, result._matchPositions));
    } else {
      labelEl.textContent = result.label;
    }
    row.appendChild(labelEl);

    // Sublabel: directory path for recent files (Category C).
    if (result.sublabel) {
      const sublabel = document.createElement("div");
      sublabel.className = "cb-result-sublabel";
      sublabel.textContent = result.sublabel;
      row.appendChild(sublabel);
    }

    // Keybinding badge (Category A only, EC-25: omitted when key is empty).
    if (result.keybinding) {
      const badge = document.createElement("kbd");
      badge.className = "cb-result-key";
      badge.textContent = result.keybinding;
      row.appendChild(badge);
    }

    // EC-07/EC-08: full label as tooltip for long truncated text.
    row.title = result.label + (result.sublabel ? ` — ${result.sublabel}` : "");

    container.appendChild(row);
    resultIndex++;
  }
}

// ---------------------------------------------------------------------------
// Files mode renderer (Step 02)
// ---------------------------------------------------------------------------

/**
 * Create a `.cb-notice` element with the given text. Notice rows communicate
 * informational states (no workspace, no files, cap exceeded, error) without
 * using the main results pipeline.
 *
 * @param text - Plain text content for the notice row.
 */
function makeNotice(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "cb-notice";
  el.textContent = text;
  return el;
}

/**
 * Clear and rebuild the results list container for Files mode results.
 *
 * Called by refreshFilesDisplay() and filterAndRenderFiles(). Handles:
 *   - Rendering section headers ("Open Tabs", "Files") whenever the category changes.
 *   - Rendering result rows with selection highlight and sublabel.
 *   - Appending notice rows after the results: loading, error, no-workspace, no-files, cap.
 *
 * Why this is a separate function from renderResults():
 *   Files mode uses FilesResult[] (from files-mode.ts) with FilesResultCategory labels,
 *   two-phase loading state notices, and a cap notice. Merging this into renderResults()
 *   would require a union type parameter and mode-conditional branches throughout —
 *   harder to read than keeping two clean, purpose-built renderers.
 *
 * @param container          - The .cb-results element to populate.
 * @param results            - Files mode results to render.
 * @param query              - Current query (used for future highlight integration; passed through).
 * @param selectedId         - The id of the currently selected result, or null.
 * @param loadState          - Controls which notice rows appear after results.
 * @param totalWorkspaceCount - Deduplicated workspace file count before the cap (for EC-05 notice).
 * @param noFileOpen         - True when __MARKABLE_CURRENT_FILE__ is null (EC-01 notice).
 */
export function renderFilesResults(
  container: HTMLElement,
  results: FilesResult[],
  query: string,
  selectedId: string | null,
  loadState: "loading" | "loaded" | "error" | "no-workspace",
  totalWorkspaceCount: number,
  noFileOpen: boolean,
): void {
  container.innerHTML = "";

  let lastCat: FilesResult["category"] | null = null;
  let resultIndex = 0;

  // ── Render result rows with section headers ────────────────────────────────
  for (const result of results) {
    // Insert a section header when the category changes (same pattern as renderResults).
    if (result.category !== lastCat) {
      lastCat = result.category;
      const header = document.createElement("div");
      header.className = "cb-section-header";
      header.setAttribute("data-cat", result.category);
      header.textContent = FILES_SECTION_LABELS[result.category];
      container.appendChild(header);
    }

    const row = document.createElement("div");
    row.className = "cb-result";
    if (result.dimmed) row.classList.add("cb-result--dimmed");

    if (result.id === selectedId) {
      row.classList.add("cb-result--selected");
      row.setAttribute("aria-selected", "true");
    } else {
      row.setAttribute("aria-selected", "false");
    }
    row.setAttribute("role", "option");
    row.setAttribute("data-id", result.id);
    row.setAttribute("data-cat", result.category);
    // DOM id for aria-activedescendant lookup (mirrors renderResults() pattern).
    row.id = `cb-result-${resultIndex}`;

    // Label
    const labelEl = document.createElement("div");
    labelEl.className = "cb-result-label";
    if (query && result._matchPositions && result._matchPositions.length > 0) {
      // Re-use the same highlight renderer used by renderResults() for visual consistency.
      labelEl.appendChild(renderHighlightedLabel(result.label, result._matchPositions));
    } else {
      labelEl.textContent = result.label;
    }
    row.appendChild(labelEl);

    // Sublabel: abbreviated directory path (shown below the label).
    if (result.sublabel) {
      const sublabelEl = document.createElement("div");
      sublabelEl.className = "cb-result-sublabel";
      sublabelEl.textContent = result.sublabel;
      row.appendChild(sublabelEl);
    }

    // Full tooltip for truncated text (EC-07/EC-08 pattern).
    row.title = result.label + (result.sublabel ? ` — ${result.sublabel}` : "");

    container.appendChild(row);
    resultIndex++;
  }

  // ── Status notices (appended after results) ────────────────────────────────

  // Loading: async scan is in-flight; tabs may already be shown above (phase 1).
  if (loadState === "loading") {
    const notice = document.createElement("div");
    notice.className = "cb-loading";
    notice.textContent = "Loading…";
    container.appendChild(notice);
  }

  // Error: invoke failed.
  if (loadState === "error") {
    container.appendChild(makeNotice("Could not load workspace files"));
  }

  // Determine if any workspace-file rows were rendered (used for empty-state checks).
  const hasWorkspaceRows = results.some((r) => r.category === "workspace-files");

  // No workspace: no file is currently open so we cannot resolve a directory (EC-01).
  if (loadState === "loaded" && noFileOpen && !hasWorkspaceRows) {
    container.appendChild(makeNotice("No workspace — open a file first"));
  } else if (loadState === "loaded" && !noFileOpen && !hasWorkspaceRows) {
    // Empty workspace: a directory was resolved but no .md files were found (EC-04).
    container.appendChild(makeNotice("No markdown files in workspace"));
  }

  // Cap notice: more workspace files exist than the FILES_CAP limit (EC-05).
  // Only shown when we have finished loading (loadState === "loaded") and the
  // total deduplicated count exceeds FILES_CAP.
  if (loadState === "loaded" && totalWorkspaceCount > FILES_CAP) {
    container.appendChild(
      makeNotice(`Showing ${FILES_CAP} of ${totalWorkspaceCount} files — type to filter`)
    );
  }
}

// ---------------------------------------------------------------------------
// Keybindings mode renderer (Step 04)
// ---------------------------------------------------------------------------

/**
 * Clear and rebuild the results list container for Keybindings mode.
 *
 * Renders a single "Actions" section header followed by one row per result.
 * Each row shows the action label, a "(default)"/"(custom)"/"(unbound)" badge,
 * and (when bound) a formatted key badge.
 *
 * Why separate from renderResults():
 *   KeybindingResult differs from CommandBarResult in actionId, activeKey, isDefault,
 *   isUnbound — fields used by the binding status and key badge. Merging these types
 *   would add union branches throughout renderResults(). A dedicated renderer keeps
 *   both paths clean and independently testable.
 *
 * @param container  - The .cb-results element to populate.
 * @param results    - Keybinding mode results to render.
 * @param query      - Current query (triggers highlight when non-empty).
 * @param selectedId - The id of the currently selected result, or null.
 */
export function renderKeybindingResults(
  container: HTMLElement,
  results: KeybindingResult[],
  query: string,
  selectedId: string | null,
): void {
  container.innerHTML = "";

  if (results.length === 0) {
    // EC-16: no commands available — show a friendly empty state.
    const empty = document.createElement("div");
    empty.className = "cb-empty";
    empty.textContent = "No actions available";
    container.appendChild(empty);
    return;
  }

  // Single "Actions" section header (keybindings mode has no sub-categories).
  const header = document.createElement("div");
  header.className = "cb-section-header";
  header.textContent = "Actions";
  container.appendChild(header);

  let resultIndex = 0;
  for (const result of results) {
    const row = document.createElement("div");
    row.className = "cb-result";
    if (result.id === selectedId) {
      row.classList.add("cb-result--selected");
      row.setAttribute("aria-selected", "true");
    } else {
      row.setAttribute("aria-selected", "false");
    }
    row.setAttribute("role", "option");
    row.setAttribute("data-id", result.id);
    // DOM id for aria-activedescendant lookup (same pattern as renderResults()).
    row.id = `cb-result-${resultIndex}`;

    // Action label — highlight matched characters when a query is active.
    const labelEl = document.createElement("div");
    labelEl.className = "cb-result-label";
    if (query && result._matchPositions?.length) {
      labelEl.appendChild(renderHighlightedLabel(result.label, result._matchPositions));
    } else {
      labelEl.textContent = result.label;
    }
    row.appendChild(labelEl);

    // Binding status badge: "(unbound)" | "(default)" | "(custom)".
    const statusEl = document.createElement("span");
    statusEl.className = "cb-result-binding-status";
    statusEl.textContent = result.isUnbound
      ? "(unbound)"
      : (result.isDefault ? "(default)" : "(custom)");
    row.appendChild(statusEl);

    // Key badge: only shown when the action has a binding (unbound rows omit it).
    if (!result.isUnbound) {
      const keyBadge = document.createElement("kbd");
      keyBadge.className = "cb-result-key cb-result-key-badge";
      keyBadge.textContent = formatKeyDisplay(result.activeKey);
      row.appendChild(keyBadge);
    }

    container.appendChild(row);
    resultIndex++;
  }
}

// ---------------------------------------------------------------------------
// Key-capture view types (Step 04)
// ---------------------------------------------------------------------------

/**
 * Union type representing the four states the capture view can be in:
 *   "waiting"                — prompting the user to press a key combo
 *   { type: "conflict" }    — showing an Override/Cancel choice
 *   { type: "system-reserved-confirm" } — showing an "Assign Anyway?" choice
 *   { type: "error" }       — showing an inline save failure message (EC-22)
 */
type CaptureViewState =
  | "waiting"
  | { type: "conflict"; info: ConflictInfo; _pendingCombo: string }
  | { type: "system-reserved-confirm"; combo: string }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Key-capture view renderer (Step 04)
// ---------------------------------------------------------------------------

/**
 * Render the key-capture view with the given state.
 *
 * The view always starts with the action name and current binding for reference,
 * then renders state-specific UI:
 *   "waiting"                — "Waiting for key combo…" prompt + optional Reset button
 *   "conflict"               — warning text + Override / Cancel buttons
 *   "system-reserved-confirm"— macOS-reserved warning + Assign Anyway / Cancel buttons
 *   "error"                  — inline error message (EC-22, write failure)
 *
 * Reads _captureActionLabel and _captureExistingKey from module-level state
 * (set by enterKeyCapture() before this is called).
 *
 * @param state - The current capture view state discriminant.
 */
export function renderCaptureView(state: CaptureViewState): void {
  if (!_captureViewEl) return;
  _captureViewEl.innerHTML = "";

  // Always show the action name being assigned.
  const actionEl = document.createElement("div");
  actionEl.className = "cb-capture-action";
  actionEl.textContent = _captureActionLabel;
  _captureViewEl.appendChild(actionEl);

  // Always show the current binding (or "unbound" status) for reference.
  const existingEl = document.createElement("div");
  existingEl.className = "cb-capture-existing";
  existingEl.textContent = _captureExistingKey
    ? `Current binding: ${formatKeyDisplay(_captureExistingKey)}`
    : "Currently unbound";
  _captureViewEl.appendChild(existingEl);

  if (state === "waiting") {
    // Prompt: ask the user to press the new combo.
    const prompt = document.createElement("div");
    prompt.className = "cb-capture-prompt";
    prompt.textContent = "Waiting for key combo…";
    _captureViewEl.appendChild(prompt);

    // Reset to default button: only shown when the action has a current binding.
    // Clicking it removes the custom binding and reverts to defaultKey (FR-07.9).
    if (_captureExistingKey) {
      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "cb-capture-btn";
      resetBtn.textContent = "Reset to default";
      resetBtn.addEventListener("click", () => void handleResetToDefault());
      _captureViewEl.appendChild(resetBtn);
    }

  } else if (typeof state === "object" && state.type === "conflict") {
    // Conflict: another action already has this combo. Offer Override or Cancel.
    const warn = document.createElement("div");
    warn.className = "cb-conflict-warning";
    warn.textContent = `⚠ Already bound to: ${state.info.conflictingActionLabel ?? "another action"}`;
    _captureViewEl.appendChild(warn);

    const btns = document.createElement("div");
    btns.className = "cb-capture-buttons";

    const overrideBtn = document.createElement("button");
    overrideBtn.type = "button";
    overrideBtn.className = "cb-capture-btn cb-capture-btn--primary";
    overrideBtn.textContent = "Override";
    // Capture the pending combo in a local const to avoid closing over the
    // module-level _pendingCombo which may change if events race.
    const pendingComboForOverride = state._pendingCombo;
    overrideBtn.addEventListener("click", () => void handleOverride(pendingComboForOverride));
    btns.appendChild(overrideBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "cb-capture-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => exitKeyCapture());
    btns.appendChild(cancelBtn);

    _captureViewEl.appendChild(btns);

  } else if (typeof state === "object" && state.type === "system-reserved-confirm") {
    // System-reserved: give the user a second chance to confirm or cancel (EC-19, EC-20).
    const warn = document.createElement("div");
    warn.className = "cb-conflict-warning";
    warn.textContent = "This shortcut is reserved by macOS. Are you sure?";
    _captureViewEl.appendChild(warn);

    const btns = document.createElement("div");
    btns.className = "cb-capture-buttons";

    const assignBtn = document.createElement("button");
    assignBtn.type = "button";
    assignBtn.className = "cb-capture-btn cb-capture-btn--primary";
    assignBtn.textContent = "Assign Anyway";
    const comboForAssign = state.combo;
    assignBtn.addEventListener("click", () => void handleOverride(comboForAssign));
    btns.appendChild(assignBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "cb-capture-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => exitKeyCapture());
    btns.appendChild(cancelBtn);

    _captureViewEl.appendChild(btns);

  } else if (typeof state === "object" && state.type === "error") {
    // EC-22: write failure — show inline error, keep bar open so user can retry.
    const errEl = document.createElement("div");
    errEl.className = "cb-conflict-warning";
    errEl.textContent = `Could not save binding: ${state.message}`;
    _captureViewEl.appendChild(errEl);
  }
}

// ---------------------------------------------------------------------------
// Key-capture entry / exit (Step 04)
// ---------------------------------------------------------------------------

/**
 * Enter key-capture sub-state for the given action.
 *
 * Hides the results list, shows the capture view, and clears the input field
 * (saving the current query for restoration on Escape — EC-17).
 *
 * Guard: no-op if capture DOM refs are not yet available (safety for test environments
 * where onEnable has not been called).
 *
 * @param actionId - The id of the action the user wants to assign a key to.
 */
function enterKeyCapture(actionId: string): void {
  if (!_captureViewEl || !_resultsEl || !_inputEl) return;

  const cmds = (window as any).__MARKABLE_COMMANDS__ as CommandDef[] ?? [];
  const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
  const appSettings = typeof getSettings === "function" ? getSettings() : { keybindings: {} };
  const customBindings: Record<string, string> = appSettings.keybindings ?? {};

  const cmd = cmds.find((c) => c.id === actionId);
  if (!cmd) return; // Unknown actionId — guard against stale results.

  // Save state for EC-17 (Escape restore) and for the capture view display.
  _capturingFor = actionId;
  _captureQuery = _inputEl.value;
  _captureActionLabel = cmd.label;
  _captureExistingKey = customBindings[actionId] ?? cmd.defaultKey;

  // Swap visibility: hide results, show capture view.
  _resultsEl.classList.add("cb-results--hidden");
  _captureViewEl.classList.remove("cb-capture-view--hidden");
  renderCaptureView("waiting");

  // Reset input to signal "press keys now".
  _inputEl.value = "";
  _inputEl.placeholder = "Press keys…";
}

/**
 * Exit key-capture sub-state, restoring the Keybindings search view (EC-17).
 *
 * Called when the user presses Escape, clicks Cancel in a conflict/system dialog,
 * or when closeBar() is called while capture is active (EC-30).
 *
 * Restores the saved query and re-runs filterAndRender so the results list
 * reflects the current query exactly as before entering capture.
 */
function exitKeyCapture(): void {
  if (!_captureViewEl || !_resultsEl || !_inputEl) return;

  _capturingFor = null;

  // Restore the search view.
  _captureViewEl.classList.add("cb-capture-view--hidden");
  _resultsEl.classList.remove("cb-results--hidden");

  // Restore query and placeholder before re-rendering so filterAndRender sees
  // the correct input value.
  _inputEl.value = _captureQuery;
  _inputEl.placeholder = MODE_PLACEHOLDERS["keybindings"];
  filterAndRender(_captureQuery.trim());
}

// ---------------------------------------------------------------------------
// Keybinding save helpers (Step 04)
// ---------------------------------------------------------------------------

/**
 * Persist a keybinding assignment to the full app settings object.
 *
 * The Tauri save_settings command expects the complete MarkableSettings object,
 * not a partial update. This function reads the full settings via __MARKABLE_GET_SETTINGS__,
 * merges the keybindings update, then writes the merged object back. This ensures
 * no other settings fields are lost on write.
 *
 * Side effects:
 *   - Removes `combo` from any other action that previously held it (FR-05.6 override).
 *   - Dispatches "markable-keybindings-changed" CustomEvent so main.ts can invalidate
 *     the resolveAction() settings cache (AD-CB-06, FR-07.10).
 *
 * @param actionId - The action to assign the combo to.
 * @param combo    - The combo string to save (e.g. "Cmd-Shift-S").
 * @throws Re-throws Tauri invoke errors so callers can show EC-22 error state.
 */
async function saveBinding(actionId: string, combo: string): Promise<void> {
  const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
  const fullSettings = typeof getSettings === "function" ? getSettings() : {};
  const currentBindings: Record<string, string> = { ...(fullSettings.keybindings ?? {}) };

  // FR-05.6: Remove this combo from any other action that previously held it.
  // This implements the "override" semantic — the previous owner is unbound.
  for (const [id, key] of Object.entries(currentBindings)) {
    if (key === combo && id !== actionId) {
      delete currentBindings[id];
    }
  }

  currentBindings[actionId] = combo;

  // Merge keybindings into the full settings object before writing.
  const mergedSettings = { ...fullSettings, keybindings: currentBindings };

  // Use the same Tauri command that bridge.ts saveSettings() calls (AD-CB-06).
  await (window as any).__TAURI_INTERNALS__.invoke("save_settings", {
    settings: JSON.stringify(mergedSettings),
  });

  // Dispatch cache-invalidation event so main.ts updateSettings() picks up the change.
  document.dispatchEvent(
    new CustomEvent("markable-keybindings-changed", {
      detail: { keybindings: currentBindings },
    })
  );
}

/**
 * Override flow: save the binding and close the bar.
 *
 * Called when:
 *   - A free combo is pressed (no conflict)
 *   - The user clicks "Override" after a conflict warning
 *   - The user clicks "Assign Anyway" after a system-reserved warning
 *
 * On write failure, shows an inline error (EC-22) and keeps the bar open
 * so the user can retry or cancel.
 *
 * @param combo - The combo string to save.
 */
async function handleOverride(combo: string): Promise<void> {
  if (!_capturingFor) return;
  try {
    await saveBinding(_capturingFor, combo);
    closeBar();
  } catch (err) {
    // EC-22: write failed — show inline error, do not close bar.
    renderCaptureView({ type: "error", message: String(err) });
  }
}

/**
 * Reset the active binding to default: remove the custom binding for _capturingFor.
 *
 * Reads the full settings, deletes _capturingFor from keybindings, writes back,
 * dispatches the cache-invalidation event, then closes the bar (FR-07.9).
 * On write failure, shows an inline error (EC-22).
 */
async function handleResetToDefault(): Promise<void> {
  if (!_capturingFor) return;
  const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
  const fullSettings = typeof getSettings === "function" ? getSettings() : {};
  const currentBindings: Record<string, string> = { ...(fullSettings.keybindings ?? {}) };

  // Removing the custom binding restores the default (the resolver falls back to defaultKey).
  delete currentBindings[_capturingFor];

  const mergedSettings = { ...fullSettings, keybindings: currentBindings };

  try {
    await (window as any).__TAURI_INTERNALS__.invoke("save_settings", {
      settings: JSON.stringify(mergedSettings),
    });
    document.dispatchEvent(
      new CustomEvent("markable-keybindings-changed", {
        detail: { keybindings: currentBindings },
      })
    );
    closeBar();
  } catch (err) {
    renderCaptureView({ type: "error", message: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Preset API wiring (Step 05)
// ---------------------------------------------------------------------------

/**
 * Build a PresetApiDeps object wired to Tauri globals.
 *
 * Called at runtime to wire preset operations to the real Tauri backend. During
 * tests, tests pass their own mock PresetApiDeps directly to preset-manager.ts
 * functions — this function is only called in the live plugin.
 *
 * Notes on Tauri bridge:
 *   - `read_plugin_settings` returns the raw JSON string (or null). We parse it
 *     here rather than relying on the bridge.ts wrapper.
 *   - `write_plugin_settings` with data=null writes an empty object (tombstone).
 *   - `list_preset_files` uses AppHandle internally — no dirPath argument needed.
 */
function makePresetApiDeps(): PresetApiDeps {
  return {
    /**
     * Load plugin settings for a given namespace and parse the JSON string.
     * Returns null if the namespace has no stored data or if parsing fails.
     */
    loadSettings: async (namespace: string) => {
      try {
        const raw = await (window as any).__TAURI_INTERNALS__.invoke(
          "read_plugin_settings",
          { pluginId: namespace },
        );
        if (raw === null || raw === undefined) return null;
        return JSON.parse(raw as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    },

    /**
     * Save plugin settings for a given namespace.
     * Passing null writes an empty object (tombstone) to the plugin settings file.
     */
    saveSettings: async (namespace: string, data: Record<string, unknown> | null) => {
      await (window as any).__TAURI_INTERNALS__.invoke("write_plugin_settings", {
        pluginId: namespace,
        data: JSON.stringify(data ?? {}),
      });
    },

    /**
     * List .json filenames in the keybinding-presets directory via Rust command.
     * Falls back to [] on invoke error so preset loading degrades gracefully.
     */
    listPresetFiles: async () => {
      try {
        return await (window as any).__TAURI_INTERNALS__.invoke(
          "list_preset_files",
        ) as string[];
      } catch {
        return [];
      }
    },
  };
}

/**
 * Write a complete keybindings map to app settings and dispatch the cache-invalidation event.
 *
 * Used when applying a preset (which replaces ALL bindings at once). Individual
 * binding writes use saveBinding() from Step 04.
 *
 * Dispatches `markable-keybindings-changed` so main.ts updates its in-memory
 * settings singleton without a page reload (AD-CB-06).
 *
 * @param bindings - The complete keybinding map to persist.
 */
async function saveKeybindings(bindings: Record<string, string>): Promise<void> {
  const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
  const appSettings = typeof getSettings === "function" ? getSettings() : {};
  const merged = { ...appSettings, keybindings: bindings };

  await (window as any).__TAURI_INTERNALS__.invoke("save_settings", {
    settings: JSON.stringify(merged),
  });

  document.dispatchEvent(
    new CustomEvent("markable-keybindings-changed", { detail: { keybindings: bindings } }),
  );
}

// ---------------------------------------------------------------------------
// Preset UI functions (Step 05)
// ---------------------------------------------------------------------------

/**
 * Rebuild the preset row DOM from current `_presets` and `_settings.activePreset`.
 *
 * Called after every preset state change (load completes, save, delete, rename).
 * Clears existing content and rebuilds from scratch for simplicity.
 * Any open dropdown is closed when the row re-renders.
 */
function renderPresetRow(): void {
  if (!_presetRowEl) return;
  _presetRowEl.innerHTML = "";

  // A preset label showing the currently active preset name.
  const label = document.createElement("span");
  label.className = "cb-preset-name";
  label.textContent = `Preset: ${_settings.activePreset}`;
  _presetRowEl.appendChild(label);

  // Dropdown trigger button (▾ glyph).
  const dropdownBtn = document.createElement("button");
  dropdownBtn.type = "button";
  dropdownBtn.className = "cb-preset-dropdown-btn";
  dropdownBtn.setAttribute("aria-label", "Open preset menu");
  dropdownBtn.textContent = "▾";
  dropdownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePresetDropdown();
  });
  _presetRowEl.appendChild(dropdownBtn);

  // Show the "Save as preset" inline input if it was open before this re-render.
  if (_presetSaveInputVisible) {
    renderSaveAsPresetInput();
  }
}

/**
 * Toggle the preset dropdown open/closed.
 * If already open, closes it. Otherwise builds and appends it.
 */
function togglePresetDropdown(): void {
  const existing = _presetRowEl?.querySelector(".cb-preset-dropdown");
  if (existing) {
    existing.remove();
    return;
  }
  renderPresetDropdown();
}

/**
 * Build and append the preset dropdown to the preset row.
 *
 * Each user preset row has Rename and Delete action buttons. Clicking a row
 * (not a button) applies that preset. A "Save as preset…" entry at the bottom
 * opens the inline name input.
 */
function renderPresetDropdown(): void {
  if (!_presetRowEl) return;

  const dropdown = document.createElement("div");
  dropdown.className = "cb-preset-dropdown";
  dropdown.setAttribute("role", "listbox");
  dropdown.setAttribute("aria-label", "Keybinding presets");

  for (const preset of _presets) {
    const item = document.createElement("div");
    item.className = "cb-preset-dropdown-item";
    item.setAttribute("role", "option");

    // Highlight the currently active preset for quick visual identification.
    if (preset.name === _settings.activePreset) {
      item.classList.add("cb-preset-dropdown-item--active");
    }

    const nameSpan = document.createElement("span");
    // The "(read-only)" annotation signals that Default cannot be modified.
    nameSpan.textContent = preset.isDefault ? `${preset.name} (read-only)` : preset.name;
    nameSpan.style.flex = "1";
    item.appendChild(nameSpan);

    // Rename / Delete buttons appear only on user-created presets.
    if (!preset.isDefault) {
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "cb-preset-action-btn";
      renameBtn.textContent = "Rename";
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.remove();
        void handleRenamePreset(preset);
      });
      item.appendChild(renameBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "cb-preset-action-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.remove();
        void handleDeletePreset(preset);
      });
      item.appendChild(deleteBtn);
    }

    // Clicking the row itself (not the buttons) applies the preset.
    item.addEventListener("click", () => {
      dropdown.remove();
      void handleApplyPreset(preset);
    });

    dropdown.appendChild(item);
  }

  // "Save as preset…" entry at the bottom of the dropdown list.
  const saveItem = document.createElement("div");
  saveItem.className = "cb-preset-dropdown-item cb-preset-dropdown-item--action";
  saveItem.setAttribute("role", "option");
  saveItem.textContent = "Save as preset…";
  saveItem.addEventListener("click", () => {
    dropdown.remove();
    _presetSaveInputVisible = true;
    renderPresetRow();
  });
  dropdown.appendChild(saveItem);

  _presetRowEl.appendChild(dropdown);
}

/**
 * Build and append the "Save as preset" inline input to the preset row.
 *
 * Shows a text field for the preset name with live validation.
 * Enter saves; Escape cancels (EC-17-style cancel pattern).
 */
function renderSaveAsPresetInput(): void {
  if (!_presetRowEl) return;

  const inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.placeholder = "Preset name…";
  inputEl.className = "cb-preset-save-input";

  const errorEl = document.createElement("div");
  errorEl.className = "cb-preset-save-error";

  // Live validation: show error message as the user types so they get immediate
  // feedback before attempting to save (pairs with EC-25, EC-26).
  const showValidation = () => {
    const existingNames = _presets.filter((p) => !p.isDefault).map((p) => p.name);
    const err = validatePresetName(inputEl.value, existingNames);
    errorEl.textContent = err ?? "";
    errorEl.style.display = err ? "block" : "none";
  };

  inputEl.addEventListener("input", showValidation);
  inputEl.addEventListener("keydown", (e) => {
    // Stop propagation so the command bar's global keydown handler doesn't interfere.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSaveAsPreset(inputEl.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      _presetSaveInputVisible = false;
      renderPresetRow();
    }
  });

  _presetRowEl.appendChild(inputEl);
  _presetRowEl.appendChild(errorEl);

  // Delay focus by one tick so the element is fully in the DOM before focus() fires.
  setTimeout(() => inputEl.focus(), 0);
}

/**
 * Apply a preset: replace all current keybindings with the preset's bindings.
 *
 * Prompts for confirmation before overwriting (non-destructive UX pattern).
 * On success, updates `_settings.activePreset` and closes the bar.
 *
 * @param preset - The preset to apply.
 */
async function handleApplyPreset(preset: PresetEntry): Promise<void> {
  const confirmed = window.confirm(
    `Replace all current shortcuts with the "${preset.name}" preset?`,
  );
  if (!confirmed) return;

  try {
    await saveKeybindings(preset.bindings);
    _settings.activePreset = preset.name;
    if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);
    closeBar();
  } catch (err) {
    console.error(`[CommandBar] Failed to apply preset "${preset.name}":`, err);
  }
}

/**
 * Save the current keybindings as a new named preset.
 *
 * On validation failure, the save-input stays open and the live-validation
 * handler shows the error. On success, updates `_settings.activePreset`.
 *
 * @param name - The proposed preset name from the inline input.
 */
async function handleSaveAsPreset(name: string): Promise<void> {
  const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
  const appSettings = typeof getSettings === "function" ? getSettings() : { keybindings: {} };
  const currentBindings: Record<string, string> = appSettings.keybindings ?? {};

  try {
    _presets = await saveNewPreset(name, currentBindings, _presets, makePresetApiDeps());
    _presetSaveInputVisible = false;
    _settings.activePreset = name.trim();
    if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);
    renderPresetRow();
  } catch (err) {
    // Validation error — the input stays open. The live-validation handler in
    // renderSaveAsPresetInput() will show the error message on the next input event.
    // We log but do not re-render here so the user can correct the name.
    console.warn("[CommandBar] saveNewPreset failed:", err);
  }
}

/**
 * Prompt the user for a new name and rename the preset.
 *
 * Uses `window.prompt` for simplicity (consistent with the rename UX in other
 * parts of the app). On success, updates the active preset name if it was the
 * renamed preset.
 *
 * @param preset - The preset entry to rename.
 */
async function handleRenamePreset(preset: PresetEntry): Promise<void> {
  const newName = window.prompt(`Rename "${preset.name}" to:`);
  if (!newName) return;
  try {
    _presets = await renamePreset(preset.name, newName, _presets, makePresetApiDeps());
    // Keep active preset name in sync if the renamed preset was the active one.
    if (_settings.activePreset === preset.name) {
      _settings.activePreset = newName.trim();
      if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);
    }
    renderPresetRow();
  } catch (err) {
    console.error("[CommandBar] renamePreset failed:", err);
  }
}

/**
 * Confirm and delete a preset.
 *
 * If the deleted preset was the active one, falls back to Default.
 *
 * @param preset - The preset entry to delete.
 */
async function handleDeletePreset(preset: PresetEntry): Promise<void> {
  const confirmed = window.confirm(`Delete preset "${preset.name}"?`);
  if (!confirmed) return;
  try {
    _presets = await deletePreset(preset.name, _presets, makePresetApiDeps());
    // If the deleted preset was active, fall back to the Default preset.
    if (_settings.activePreset === preset.name) {
      _settings.activePreset = DEFAULT_PRESET_NAME;
      if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);
    }
    renderPresetRow();
  } catch (err) {
    console.error("[CommandBar] deletePreset failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Module-level plugin state
// ---------------------------------------------------------------------------

// DOM references set once in onEnable; nulled in onDisable.
let _overlayEl:   HTMLElement | null = null;
let _inputEl:     HTMLInputElement | null = null;
let _resultsEl:   HTMLElement | null = null;
let _tabStripEl:  HTMLElement | null = null;         // mode tab strip container
let _presetRowEl: HTMLElement | null = null;         // preset row container
let _footerEl:    HTMLElement | null = null;         // footer hint element
let _api:         MarkablePluginAPI | null = null;

// Per-open state.
let _mode: BarMode = "files";            // current bar mode (AD-CB-01: module var, not DOM)
let _openGeneration = 0;                 // incremented each openBar(); stale-async guard (EC-28)

/** Incremented each time a new content search is launched. Used to discard stale
 *  async results (EC-12, EC-13, EC-14). Separate from _openGeneration (AD-GS-03). */
let _contentSearchGeneration = 0;

/** True while a content search Rust call is in flight. Prevents duplicate launches. */
let _contentSearchInFlight = false;
let _allResults: CommandBarResult[] = [];
let _visibleResults: CommandBarResult[] = [];
let _selectedId: string | null = null;
let _isOpen = false;

// Plugin settings (loaded from API in onEnable).
let _settings: CommandBarSettings = { ...DEFAULT_SETTINGS };

// ── Key-capture state (Step 04) ────────────────────────────────────────────
// These variables drive the key-capture sub-state (FR-05). They are set when
// the user selects an action in Keybindings mode and cleared when they save
// or cancel (Escape). All are null/empty when not in capture.

/** DOM reference to the .cb-capture-view container; set in onEnable, nulled in onDisable. */
let _captureViewEl: HTMLElement | null = null;

/** The action id currently being assigned; null means not in capture sub-state. */
let _capturingFor: string | null = null;

/** The input value saved when entering capture, restored on Escape (EC-17). */
let _captureQuery: string = "";

/** Display label for the action being assigned (shown in the capture view header). */
let _captureActionLabel: string = "";

/** The current resolved binding before capture begins (shown for reference). */
let _captureExistingKey: string = "";

// Note: _pendingCombo was considered for module-level storage but the combo is
// instead embedded directly into the CaptureViewState object passed to renderCaptureView(),
// which closes over it in the button click listeners. This avoids a stale-closure race.

// ── Preset state (Step 05) ────────────────────────────────────────────────────
// Loaded asynchronously when keybindings mode opens. Cleared on disable/close.

/**
 * All loaded presets (Default + any user presets on disk).
 * Populated by loadPresets() when keybindings mode opens.
 * Starts with just the Default preset until the async load completes.
 */
let _presets: PresetEntry[] = [];


/**
 * True while the "Save as preset" inline input is visible in the preset row.
 * Cleared on save, Escape, or bar close.
 */
let _presetSaveInputVisible = false;

// ---------------------------------------------------------------------------
// Files mode async state (Step 02)
// ---------------------------------------------------------------------------

/**
 * Results built asynchronously from the workspace file scan.
 * Populated by fetchWorkspaceFiles(); consumed by refreshFilesDisplay().
 * Reset to [] on every openBar("files") call.
 */
let _fileModeResults: FilesResult[] = [];

/**
 * True once the async workspace file fetch has completed (successfully or with error).
 * While false the UI shows "Loading…". Reset on every openBar("files").
 */
let _fileListLoaded = false;

/**
 * True when the last workspace file fetch ended with an invoke error.
 * Controls whether an error notice or the results are shown.
 */
let _fileListError = false;

/**
 * The total count of deduplicated workspace files (before the FILES_CAP slice).
 * Used to render the cap notice when this exceeds FILES_CAP (EC-05).
 */
let _totalWorkspaceCount = 0;

// ---------------------------------------------------------------------------
// Mode management (Step 01 — Mode Infrastructure)
// ---------------------------------------------------------------------------

/**
 * Switch the bar to the given mode, updating all mode-coupled UI elements:
 *   - badge text label
 *   - input placeholder
 *   - footer hint text
 *   - preset row visibility (only shown in keybindings mode)
 *
 * Exported for unit testing. Safe to call before or after the overlay is in the DOM
 * because each assignment is null-guarded.
 *
 * @param mode - Target BarMode value.
 */
export function setMode(mode: BarMode): void {
  _mode = mode;

  // Update the tab strip: remove active class from all tabs, add it to the
  // tab whose data-mode attribute matches the new mode.
  // aria-selected is also updated so screen readers announce the active tab.
  if (_tabStripEl) {
    const tabs = _tabStripEl.querySelectorAll<HTMLButtonElement>(".cb-tab");
    tabs.forEach((tab) => {
      const isActive = tab.dataset.mode === mode;
      tab.classList.toggle("cb-tab--active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  // Update input placeholder so the user knows what this mode searches.
  if (_inputEl) _inputEl.placeholder = MODE_PLACEHOLDERS[mode];

  // Update footer hint so the user knows what Enter/Escape do in this mode.
  if (_footerEl) _footerEl.textContent = MODE_FOOTER_HINTS[mode];

  // Preset row is only meaningful in keybindings mode (Step 5 populates it).
  // In all other modes it is hidden to avoid an empty visual gap.
  if (_presetRowEl) {
    _presetRowEl.classList.toggle("cb-preset-row--hidden", mode !== "keybindings");
  }
}

/**
 * Shared mode-switch logic used by both the tab strip click handler and any
 * future keyboard shortcut that cycles modes directly.
 *
 * Why extracted: the same sequence (setMode → clear input → rebuild results)
 * must run whether the user clicks a tab or triggers a mode via a shortcut key.
 * Having a single function avoids duplicating the files-vs-commands branch.
 *
 * @param targetMode - The mode to switch to.
 */
function switchMode(targetMode: BarMode): void {
  setMode(targetMode);
  if (_inputEl) _inputEl.value = "";
  _openGeneration++;

  if (targetMode === "files") {
    // Switching TO files mode: reset files state and kick off a fresh workspace scan.
    _fileListLoaded = false;
    _fileListError = false;
    _fileModeResults = [];
    _totalWorkspaceCount = 0;
    _allResults = [];
    filterAndRenderFiles("");
    const capturedGeneration = _openGeneration;
    void fetchWorkspaceFiles(capturedGeneration);
  } else {
    // Switching INTO commands or keybindings mode: rebuild _allResults.
    // Files mode sets _allResults = [] (unused); commands/keybindings require a fresh build.
    try {
      _allResults = buildResultsForMode(targetMode, _settings);
    } catch (err) {
      console.error("[CommandBar] buildResultsForMode failed on mode switch:", err);
      _allResults = [];
    }
    filterAndRender("");
  }
}

/**
 * Tab strip click handler. Uses event delegation on `.cb-tab-strip` so a single
 * listener covers all three tab buttons.
 *
 * Reads `data-mode` from the clicked button (or its closest `.cb-tab` ancestor
 * in case the user clicks the `.cb-tab-hint` span inside the button). Ignores
 * clicks that already target the active mode (no-op) to avoid an unnecessary
 * results rebuild.
 *
 * @param e - The click MouseEvent fired on the strip container.
 */
function onTabStripClick(e: MouseEvent): void {
  // Walk up from the exact target to find the .cb-tab button, which carries data-mode.
  const tab = (e.target as Element).closest<HTMLButtonElement>(".cb-tab");
  if (!tab) return;

  const targetMode = tab.dataset.mode as BarMode | undefined;
  if (!targetMode || targetMode === _mode) return;   // already active — no-op

  // EC-11: cancel key-capture before switching modes so the capture overlay
  // is hidden and result list restored before the new mode renders.
  if (_capturingFor !== null) exitKeyCapture();
  switchMode(targetMode);
}

// ---------------------------------------------------------------------------
// Files mode helpers (Step 02)
// ---------------------------------------------------------------------------

/**
 * Read the current open tabs from the tab manager global.
 * Returns an empty array if the global is unavailable (graceful degradation).
 */
function getOpenTabs(): TabEntry[] {
  const tm = (window as any).__MARKABLE_TAB_MANAGER__;
  if (!tm || typeof tm.getAllTabs !== "function") return [];
  return tm.getAllTabs() as TabEntry[];
}

/**
 * Switch the editor to the given tab via the tab manager global.
 * No-op if the global is unavailable.
 *
 * @param tabId - The id returned by getAllTabs().
 */
function switchToTab(tabId: string): void {
  const tm = (window as any).__MARKABLE_TAB_MANAGER__;
  if (tm && typeof tm.switchToTab === "function") tm.switchToTab(tabId);
}

/**
 * Open a workspace file in a new tab via the tab manager global.
 * Supports both `openFile` (preferred) and the older `openFileInTab` method name.
 *
 * @param filePath - Absolute path to the .md file to open.
 */
function openFileInTab(filePath: string): void {
  const tm = (window as any).__MARKABLE_TAB_MANAGER__;
  if (tm && typeof tm.openFile === "function") {
    void tm.openFile(filePath);
  } else if (tm && typeof tm.openFileInTab === "function") {
    void tm.openFileInTab(filePath);
  }
}

/**
 * Refresh the Files mode results area after the async workspace scan completes
 * or when the bar is first shown (phase-1 tabs-only display).
 *
 * Only operates when the bar is open in files mode — safely called from the
 * async completion path where the bar may have been closed already.
 */
function refreshFilesDisplay(): void {
  if (!_isOpen || _mode !== "files" || !_resultsEl || !_inputEl) return;
  filterAndRenderFiles(_inputEl.value.trim());
}

/**
 * Asynchronously fetch workspace .md files via the Tauri list_md_files command,
 * then update the Files mode display.
 *
 * Uses the generation counter pattern (EC-28): the generation value is captured
 * at call time and compared after every await. If _openGeneration has advanced
 * (because the bar closed, mode switched, or a new openBar() call occurred), the
 * results are silently discarded — a stale async result must never overwrite a
 * newer UI state.
 *
 * Phase flow:
 *   1. Resolve workspace directory from __MARKABLE_CURRENT_FILE__.
 *      If null → EC-01/EC-02: set loaded with no results; return early.
 *   2. invoke("list_md_files", { dir }) → await.
 *      If invoke rejects → EC-03: set error state; return early.
 *   3. Generation check after await (EC-28): bail if stale.
 *   4. Deduplicate against open tabs, compute cap count, build FilesResult[].
 *   5. Set _fileModeResults, _fileListLoaded, call refreshFilesDisplay().
 *
 * @param generation - The generation value captured at openBar() time.
 */
/**
 * Asynchronously fetch workspace .md files, then update the Files mode display.
 *
 * Path selection (FR-1, FR-2, FR-3):
 *   1. If a vault is active (`getActiveVault()` is non-null):
 *      a. If the vault index is already built (`getVaultIndex()` is non-null):
 *         extract absolute paths synchronously from entries (NFR-4). No Rust call.
 *      b. If the vault index is still building (null):
 *         show loading notice; schedule a single 1.5s retry (FR-3, AD-GS-08).
 *   2. If no vault is active (`getActiveVault()` is null):
 *      fall back to the previous behaviour: derive workspaceDir from
 *      __MARKABLE_CURRENT_FILE__ and invoke("list_md_files", { dir }). If
 *      __MARKABLE_CURRENT_FILE__ is also null, set no-workspace state (FR-2).
 *
 * Generation counter (EC-12/EC-28): the generation value is captured at call time
 * and compared after every await. Stale results are silently discarded.
 *
 * EC-17 (corrupt index): entries with a falsy path are silently skipped.
 *
 * @param generation - The generation value captured at openBar() time.
 */
async function fetchWorkspaceFiles(generation: number): Promise<void> {
  // Length justified: two-phase fetch (sync tab phase, async vault-index phase) with
  // multiple early-exit guards; extracting phases would require exposing internal generation state.
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;

  // ── Vault path (FR-1, FR-3) ──────────────────────────────────────────────
  if (vm && typeof vm.getActiveVault === "function" && vm.getActiveVault() !== null) {
    const index = (typeof vm.getVaultIndex === "function") ? vm.getVaultIndex() : null;

    if (index !== null) {
      // FR-1: synchronous vault-index read (NFR-4 — no async latency).
      if (_openGeneration !== generation) return; // EC-28: stale guard
      const entries: Array<{ path: string }> = index.entries ?? [];
      // EC-17: skip entries with a falsy path (corrupt index guard).
      const workspaceFiles: string[] = entries
        .filter((e) => !!e.path)
        .map((e) => e.path);

      const tabs = getOpenTabs();
      const openPaths = new Set<string>(tabs.flatMap((t) => (t.filePath ? [t.filePath] : [])));
      _totalWorkspaceCount = countWorkspaceBeforeCap(workspaceFiles, openPaths);

      _fileModeResults = buildFilesResults({
        tabs,
        workspaceFiles,
        workspaceLoadState: "loaded",
        openTab: switchToTab,
        openFile: openFileInTab,
      });
      _fileListLoaded = true;
      _fileListError = false;

      if (_mode === "files" && _isOpen) refreshFilesDisplay();
      return;
    }

    // FR-3: vault active but index still building — show loading notice and
    // schedule a single 1.5s retry rather than continuous polling (AD-GS-08).
    if (_openGeneration !== generation) return;
    _fileModeResults = buildFilesResults({
      tabs: getOpenTabs(),
      workspaceFiles: [],
      workspaceLoadState: "loading",
      openTab: switchToTab,
      openFile: openFileInTab,
    });
    _fileListLoaded = false;
    _fileListError = false;
    if (_mode === "files" && _isOpen) refreshFilesDisplay();

    const genAtRetry = generation;
    setTimeout(() => {
      if (_openGeneration !== genAtRetry || !_isOpen || _mode !== "files") return;
      void fetchWorkspaceFiles(genAtRetry);
    }, 1500);
    return;
  }

  // ── Fallback path (FR-2): no vault active ────────────────────────────────
  const currentFile: string | null = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;

  if (!currentFile) {
    // EC-2: no open file and no vault — show no-workspace notice.
    if (_openGeneration !== generation) return; // EC-28: stale guard
    _fileListLoaded = true;
    _fileListError = false;
    // _fileModeResults stays [] — the render will show the no-workspace notice.
    refreshFilesDisplay();
    return;
  }

  // Resolve the workspace directory (EC-32: must be absolute, never ~/).
  // Split on "/" and discard the last segment (the filename). Rejoin with "/".
  // Edge: if the path was just "/file.md", parts becomes ["", "file.md"] → joined = "".
  // The `|| "/"` fallback ensures we never pass an empty string to invoke.
  const parts = currentFile.split("/");
  parts.pop();
  const workspaceDir = parts.join("/") || "/";

  let workspaceFiles: string[] = [];
  try {
    workspaceFiles = await (window as any).__TAURI_INTERNALS__.invoke(
      "list_md_files",
      { dir: workspaceDir },
    );
  } catch (_err) {
    // EC-03: invoke failed (permission error, missing command, network issue).
    if (_openGeneration !== generation) return; // EC-28: stale guard
    _fileListLoaded = true;
    _fileListError = true;
    refreshFilesDisplay();
    return;
  }

  // EC-28: check generation after await — bar may have been closed or mode-switched
  // while the network round-trip was in progress.
  if (_openGeneration !== generation) return;

  // Deduplicate workspace files against currently open tab paths (EC-06) and
  // compute the total count before cap for the cap notice (EC-05).
  const tabs = getOpenTabs();
  const openPaths = new Set<string>(tabs.flatMap((t) => (t.filePath ? [t.filePath] : [])));
  _totalWorkspaceCount = countWorkspaceBeforeCap(workspaceFiles, openPaths);

  _fileModeResults = buildFilesResults({
    tabs,
    workspaceFiles,
    workspaceLoadState: "loaded",
    openTab: switchToTab,
    openFile: openFileInTab,
  });
  _fileListLoaded = true;
  _fileListError = false;

  if (_mode === "files" && _isOpen) refreshFilesDisplay();
}

// ---------------------------------------------------------------------------
// Content mode helpers (Step 03)
// ---------------------------------------------------------------------------

/**
 * Called when the user presses Enter in content mode.
 *
 * Guards:
 *   - FR-16: empty/whitespace query → show hint, no Rust call.
 *   - EC-3:  no active vault → show notice, no Rust call.
 *   - EC-12: a search is already in flight → no-op (generation counter prevents stale results).
 *
 * On success: renders grouped results via renderContentResults().
 * On error:   renders an inline error notice.
 */
async function handleContentSearchEnter(): Promise<void> {
  // Length justified: sequential async guard chain — generation checks, vault checks,
  // invoke, stale-result guard; each step has ordering dependencies that resist decomposition.
  if (!_inputEl || !_resultsEl) return;

  const query = _inputEl.value.trim();

  // FR-16: empty query guard — no Rust call, show a helpful prompt instead.
  if (!query) {
    renderContentNotice("Enter a search term");
    return;
  }

  // EC-3: no vault open — content search requires a vault for root_paths.
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const activeVault = (vm && typeof vm.getActiveVault === "function")
    ? vm.getActiveVault()
    : null;
  if (!activeVault) {
    renderContentNotice("No vault open — content search requires a vault");
    return;
  }

  // EC-1 (H-2): vault is active but the index is still being built.
  // The index is not needed for content search itself (root_paths come from the
  // vault object, not the index), but EC-1 requires a loading notice rather than
  // invoking the Rust command when the index is null, so users understand that
  // the vault is initialising. Try again in a moment.
  const vaultIdx = (typeof vm.getVaultIndex === "function") ? vm.getVaultIndex() : null;
  if (vaultIdx === null) {
    renderContentNotice("Vault index is still building — try again in a moment");
    return;
  }

  // Extract root paths and exclude patterns from the active vault object.
  const rootPaths: string[] = activeVault.rootPaths ?? [];
  const excludePatterns: string[] = activeVault.excludePatterns ?? [];

  // EC-12: prevent duplicate in-flight calls (a second Enter while searching is a no-op).
  if (_contentSearchInFlight) return;

  // Capture generation before the await so we can detect staleness afterward.
  _contentSearchGeneration++;
  const gen = _contentSearchGeneration;
  _contentSearchInFlight = true;

  // Show loading state immediately while the Rust call is in progress.
  renderContentLoading();

  let payload: any;
  try {
    payload = await (window as any).__TAURI_INTERNALS__.invoke(
      "search_vault_content",
      {
        rootPaths,
        excludePatterns,
        query,
        maxResults: 50,
      },
    );
  } catch (err) {
    // Only update UI if this generation is still current (EC-13, EC-14).
    if (_contentSearchGeneration !== gen || !_isOpen || _mode !== "content") {
      _contentSearchInFlight = false;
      return;
    }
    _contentSearchInFlight = false;
    renderContentNotice(`Search failed: ${String(err)}`);
    return;
  }

  _contentSearchInFlight = false;

  // EC-12 / EC-13 / EC-14: discard stale results (bar closed, vault switched,
  // or a new search was launched while this one was in flight).
  if (_contentSearchGeneration !== gen || !_isOpen || _mode !== "content") return;

  renderContentResults(payload, query);
}

/**
 * Render a single informational notice row in the content mode results area.
 * Used for: no-vault state, empty query, error state, no-results state.
 *
 * @param message - Text to display in the notice row.
 */
function renderContentNotice(message: string): void {
  if (!_resultsEl) return;
  _resultsEl.innerHTML = "";
  const row = document.createElement("div");
  row.className = "cb-content-notice";
  row.textContent = message;
  _resultsEl.appendChild(row);
  _visibleResults = [];
  _selectedId = null;
}

/**
 * Render a loading indicator in the content mode results area.
 * Replaces any previous results while the Rust search call is in progress.
 */
function renderContentLoading(): void {
  if (!_resultsEl) return;
  _resultsEl.innerHTML = "";
  const row = document.createElement("div");
  row.className = "cb-content-notice";
  row.textContent = "Searching…";
  _resultsEl.appendChild(row);
  _visibleResults = [];
  _selectedId = null;
}

/**
 * Render content search results grouped by file.
 *
 * @param payload - The ContentSearchPayload from search_vault_content, or null to
 *                  render the initial empty state (footer hint, no rows).
 * @param query   - The query string used for match highlighting.
 *
 * Layout per FileContentResult (FR-10, AD-GS-05):
 *   1. Clickable file-header row  (.cb-result.cb-result--content-header)
 *      Shows the file title; data-id set for click routing (FR-11).
 *   2. Up to 3 excerpt rows (.cb-result.cb-result--content-excerpt)
 *      Each shows "line_number: line_text" with the matched substring bolded.
 *      data-id set so clicks open the same file (FR-11).
 *   3. "N more matches" non-clickable row (.cb-result--content-more) when
 *      matches.length > 3.
 *
 * Notices prepended when relevant (EC-7, EC-8):
 *   - capped === true: "Showing matches in the first N files — refine your query to see more"
 *   - skippedCount > 0: "N files could not be searched"
 *
 * EC-6 (no results): "No results for 'query'" shown as a notice row.
 * EC-5 (empty vault): same as EC-6.
 */
export function renderContentResults(payload: any | null, query: string): void {
  // Length justified: single DOM pass over variable-depth result tree; sub-functions
  // would require threading _resultsEl through every callsite.
  if (!_resultsEl) return;
  _resultsEl.innerHTML = "";
  _visibleResults = [];
  _selectedId = null;

  // Null payload means the user just switched into content mode — show empty state.
  if (payload === null) return;

  const results: any[] = payload.results ?? [];
  const capped: boolean = payload.capped ?? false;
  const skippedCount: number = payload.skippedCount ?? 0;

  // EC-7: cap notice — shown when results were truncated at max_results.
  if (capped) {
    const capRow = document.createElement("div");
    capRow.className = "cb-content-notice cb-content-notice--warning";
    capRow.textContent = `Showing matches in the first ${results.length} files — refine your query to see more`;
    _resultsEl.appendChild(capRow);
  }

  // EC-8: skipped files notice — shown when one or more files could not be read.
  if (skippedCount > 0) {
    const skipRow = document.createElement("div");
    skipRow.className = "cb-content-notice cb-content-notice--warning";
    skipRow.textContent = `${skippedCount} file${skippedCount === 1 ? "" : "s"} could not be searched`;
    _resultsEl.appendChild(skipRow);
  }

  // EC-5 / EC-6: no results — show a friendly empty-state message.
  if (results.length === 0) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "cb-content-notice";
    emptyRow.textContent = `No results for "${query}"`;
    _resultsEl.appendChild(emptyRow);
    return;
  }

  // Render one group per FileContentResult.
  for (const fileResult of results) {
    const filePath: string = fileResult.path ?? "";
    const title: string = fileResult.title || filePath.split("/").pop() || "(untitled)";
    const matches: any[] = fileResult.matches ?? [];

    // Unique id for this file group. The header and excerpt rows share the same
    // open-file action but have distinct ids for aria-activedescendant tracking.
    const fileId = `content-file:${filePath}`;

    // Action shared by the file header and all its excerpt rows (FR-11).
    // Captures filePath in a closure to avoid the loop variable problem.
    const fp = filePath;
    const openAction = (): void => {
      openFileInTab(fp);
      closeBar();
    };

    // 1. File header row — shows the file title, clickable.
    const headerRow = document.createElement("div");
    headerRow.className = "cb-result cb-result--content-header";
    headerRow.dataset.id = fileId;
    headerRow.setAttribute("role", "option");
    headerRow.textContent = title;
    headerRow.addEventListener("click", openAction);
    _resultsEl.appendChild(headerRow);

    // Register in _visibleResults so arrow-key navigation works.
    _visibleResults.push({
      id: fileId,
      // "recent" is the closest existing category for content results;
      // content mode ignores the category field in its rendering path.
      category: "content",
      label: title,
      dimmed: false,
      action: openAction,
    });

    // 2. Up to 3 excerpt rows with highlighted match substrings.
    const excerptCount = Math.min(matches.length, 3);
    for (let i = 0; i < excerptCount; i++) {
      const match = matches[i];
      const lineNum: number = match.lineNumber ?? 0;
      const lineText: string = match.lineText ?? "";
      const colStart: number = match.columnStart ?? 0;
      const queryLen = query.length;

      const excerptId = `content-excerpt:${filePath}:${lineNum}`;

      const excerptRow = document.createElement("div");
      excerptRow.className = "cb-result cb-result--content-excerpt";
      excerptRow.dataset.id = excerptId;
      excerptRow.setAttribute("role", "option");
      excerptRow.addEventListener("click", openAction);

      // Build highlighted line text using DOM nodes to avoid innerHTML XSS risk.
      // Structure: <span class="linenum">N: </span><span class="text">before<strong>match</strong>after</span>
      const before = lineText.slice(0, colStart);
      const matched = lineText.slice(colStart, colStart + queryLen);
      const after = lineText.slice(colStart + queryLen);

      const lineNumSpan = document.createElement("span");
      lineNumSpan.className = "cb-content-excerpt-linenum";
      lineNumSpan.textContent = `${lineNum}: `;

      const textSpan = document.createElement("span");
      textSpan.className = "cb-content-excerpt-text";
      textSpan.appendChild(document.createTextNode(before));
      const strong = document.createElement("strong");
      strong.textContent = matched;
      textSpan.appendChild(strong);
      textSpan.appendChild(document.createTextNode(after));

      excerptRow.appendChild(lineNumSpan);
      excerptRow.appendChild(textSpan);
      _resultsEl.appendChild(excerptRow);

      _visibleResults.push({
        id: excerptId,
        category: "content",
        label: lineText,
        dimmed: false,
        action: openAction,
      });
    }

    // 3. "N more matches" row — non-clickable, no data-id (AD-GS-05).
    if (matches.length > 3) {
      const moreRow = document.createElement("div");
      moreRow.className = "cb-result--content-more";
      moreRow.textContent = `${matches.length - 3} more match${matches.length - 3 === 1 ? "" : "es"}`;
      _resultsEl.appendChild(moreRow);
    }
  }

  // Set initial keyboard selection to the first result.
  if (_visibleResults.length > 0 && _inputEl) {
    _selectedId = _visibleResults[0].id;
    updateAriaActiveDescendant(_inputEl, _selectedId);
  }
}

/**
 * Filter _fileModeResults against the current query and render via renderFilesResults().
 * Called by filterAndRender() when _mode === "files".
 *
 * Empty query: show all results in natural order.
 * Non-empty query: apply the same fuzzy-ranker pipeline used by commands/headings.
 */
function filterAndRenderFiles(query: string): void {
  if (!_resultsEl || !_inputEl) return;

  const currentFile: string | null = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;
  const noFileOpen = currentFile === null;

  // Determine load state for the notice renderer.
  const loadState: "loading" | "loaded" | "error" | "no-workspace" = !_fileListLoaded
    ? "loading"
    : _fileListError
      ? "error"
      : "loaded";

  let displayResults: FilesResult[];

  if (!_fileListLoaded) {
    // Phase 1: async scan not yet done — show only open tabs immediately.
    // Build a fresh tabs-only snapshot (does not use _fileModeResults which is still []).
    const tabs = getOpenTabs();
    displayResults = buildFilesResults({
      tabs,
      workspaceFiles: [],
      workspaceLoadState: "loading",
      openTab: switchToTab,
      openFile: openFileInTab,
    });
  } else {
    displayResults = _fileModeResults;
  }

  // Apply fuzzy filtering when there is a query.
  let filteredResults: FilesResult[];
  if (query === "") {
    filteredResults = displayResults;
  } else {
    // Use the same four-tier fuzzy ranker used in commands mode. Rank each result
    // against the query independently (both sections participate in ranking).
    const matched: Array<{ result: FilesResult; match: FuzzyMatch }> = [];
    for (const result of displayResults) {
      const m = fuzzyMatch(result.label, query);
      if (m) {
        result._matchPositions = m.positions;
        matched.push({ result, match: m });
      } else {
        result._matchPositions = undefined;
      }
    }
    // Sort by tier then label (same sort as commands mode for consistency).
    matched.sort((a, b) => {
      if (a.match.tier !== b.match.tier) return a.match.tier - b.match.tier;
      return a.result.label.toLowerCase().localeCompare(b.result.label.toLowerCase());
    });
    filteredResults = matched.map((mr) => mr.result);
  }

  // Update module-level selection state (FilesResult is cast to CommandBarResult
  // for _visibleResults — they share the same structural contract for id/dimmed).
  _visibleResults = filteredResults as unknown as CommandBarResult[];
  _selectedId = filteredResults.find((r) => !r.dimmed)?.id ?? null;

  renderFilesResults(
    _resultsEl,
    filteredResults,
    query,
    _selectedId,
    loadState,
    _totalWorkspaceCount,
    noFileOpen,
  );

  updateAriaActiveDescendant(_inputEl, _selectedId);
  scrollSelectedIntoView(_resultsEl);
}

// ---------------------------------------------------------------------------
// Open / close bar DOM operations
// ---------------------------------------------------------------------------

/**
 * Make the overlay visible and reset input state.
 * Called by openBar() after the open guard passes.
 *
 * @param overlay - The overlay root element.
 * @param input   - The search input element.
 */
function openCommandBar(overlay: HTMLElement, input: HTMLInputElement): void {
  overlay.classList.remove("cb-hidden");
  overlay.setAttribute("aria-hidden", "false");
  input.setAttribute("aria-expanded", "true");
  // FR-01.4: clear input on every open so user starts with a clean query.
  input.value = "";
  (window as any).__MARKABLE_COMMAND_BAR_IS_OPEN__ = true;
}

/**
 * Hide the overlay and restore editor focus.
 * Called by closeBar() after state cleanup.
 *
 * @param overlay - The overlay root element.
 * @param input   - The search input element.
 */
function closeCommandBar(overlay: HTMLElement, input: HTMLInputElement): void {
  overlay.classList.add("cb-hidden");
  overlay.setAttribute("aria-hidden", "true");
  input.setAttribute("aria-expanded", "false");
  (window as any).__MARKABLE_COMMAND_BAR_IS_OPEN__ = false;
  // NFR-05: return focus to the CM6 editor after the bar closes.
  // __MARKABLE_EDITOR_VIEW__ is the live EditorView instance.
  // __CM_VIEW__ is the @codemirror/view module namespace — never call .focus() on it.
  const view = (window as any).__MARKABLE_EDITOR_VIEW__;
  if (view) view.focus();
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/**
 * Returns the id of the first non-dimmed result, or null if all are dimmed.
 * Used to pre-select on open and after filtering.
 *
 * @param results - The current visible results array.
 */
export function firstSelectableId(results: CommandBarResult[]): string | null {
  return results.find((r) => !r.dimmed)?.id ?? null;
}

/**
 * Returns all non-dimmed result ids in the current visible order.
 * Used by moveSelection() to build the navigation cycle.
 */
function selectableIds(results: CommandBarResult[]): string[] {
  return results.filter((r) => !r.dimmed).map((r) => r.id);
}

/**
 * Move the selection by delta (+1 = down, -1 = up) with wrap-around.
 * Skips dimmed results by operating on the selectableIds() subset.
 * EC-11: no-op when there are no selectable results.
 *
 * @param delta - Direction of movement (+1 or -1).
 */
function moveSelection(delta: 1 | -1): void {
  if (!_resultsEl || !_inputEl) return;
  const ids = selectableIds(_visibleResults);
  if (ids.length === 0) return; // EC-11: no selectable results

  const currentIdx = _selectedId ? ids.indexOf(_selectedId) : -1;
  let nextIdx: number;
  if (delta === 1) {
    // Down: wrap from last back to first (FR-06.1).
    nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % ids.length;
  } else {
    // Up: wrap from first back to last.
    nextIdx = currentIdx <= 0 ? ids.length - 1 : currentIdx - 1;
  }

  _selectedId = ids[nextIdx];
  // Dispatch to the appropriate renderer based on the current mode.
  if (_mode === "keybindings") {
    renderKeybindingResults(_resultsEl, _visibleResults as unknown as KeybindingResult[], _inputEl.value, _selectedId);
  } else {
    renderResults(_resultsEl, _visibleResults, _inputEl.value, _selectedId);
  }
  updateAriaActiveDescendant(_inputEl, _selectedId);
  scrollSelectedIntoView(_resultsEl);
}

/**
 * Update the input's aria-activedescendant to reference the DOM id of the
 * currently selected result row. Screen readers announce the selected item
 * when this attribute changes (EC-27, NFR-05).
 *
 * @param input      - The search input element.
 * @param selectedId - The Command Bar result id, or null to clear.
 */
function updateAriaActiveDescendant(input: HTMLInputElement, selectedId: string | null): void {
  if (!selectedId) {
    input.setAttribute("aria-activedescendant", "");
    return;
  }
  // Row DOM ids are set as `cb-result-${index}` in renderResults().
  const idx = _visibleResults.findIndex((r) => r.id === selectedId);
  input.setAttribute("aria-activedescendant", idx >= 0 ? `cb-result-${idx}` : "");
}

/**
 * Scroll the selected result row into view without disturbing the input focus.
 * Uses "nearest" block alignment to minimize scroll distance.
 *
 * @param container - The .cb-results element.
 */
function scrollSelectedIntoView(container: HTMLElement): void {
  const sel = container.querySelector(".cb-result--selected");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------------------
// Filter and render pipeline
// ---------------------------------------------------------------------------

/**
 * Filter and rank results against the query, then re-render the results container.
 *
 * Dispatches to mode-specific sub-functions:
 *   - "files" mode → filterAndRenderFiles() (Step 02)
 *   - "commands" / "keybindings" mode → existing commands pipeline (unchanged)
 *
 * Called on every input event and after opening/switching modes.
 *
 * @param query - Trimmed input string.
 */
function filterAndRender(query: string): void {
  if (!_resultsEl || !_inputEl) return;

  // Files mode has its own renderer path (two-phase async results, section headers,
  // loading/error/cap notices). Delegate to the files-specific sub-function.
  if (_mode === "files") {
    filterAndRenderFiles(query);
    return;
  }

  // ── Commands / Keybindings mode pipeline ────────────────────────────────
  // Keybindings mode uses renderKeybindingResults (typed for KeybindingResult);
  // commands mode uses renderResults (typed for CommandBarResult).
  if (query === "") {
    // FR-02.5: empty query shows all results without ranking.
    _visibleResults = _allResults;
    _selectedId = firstSelectableId(_visibleResults);
    if (_mode === "keybindings") {
      renderKeybindingResults(_resultsEl, _visibleResults as unknown as KeybindingResult[], "", _selectedId);
    } else {
      renderResults(_resultsEl, _visibleResults, "", _selectedId);
    }
  } else {
    const matched: MatchedResult[] = [];
    for (const result of _allResults) {
      const m = fuzzyMatch(result.label, query);
      if (m) {
        result._matchPositions = m.positions;
        matched.push({ result, match: m });
      } else {
        result._matchPositions = undefined;
      }
    }

    // Sort: lower tier first, then alphabetically by label within a tier.
    matched.sort((a, b) => {
      if (a.match.tier !== b.match.tier) return a.match.tier - b.match.tier;
      return a.result.label.toLowerCase().localeCompare(b.result.label.toLowerCase());
    });

    _visibleResults = matched.map((mr) => mr.result);
    _selectedId = firstSelectableId(_visibleResults);
    if (_mode === "keybindings") {
      renderKeybindingResults(_resultsEl, _visibleResults as unknown as KeybindingResult[], query, _selectedId);
    } else {
      renderResults(_resultsEl, _visibleResults, query, _selectedId);
    }
  }

  updateAriaActiveDescendant(_inputEl, _selectedId);
  scrollSelectedIntoView(_resultsEl);
}

// ---------------------------------------------------------------------------
// Open / close bar logic
// ---------------------------------------------------------------------------

/**
 * Open the Command Bar in the given mode.
 *
 * Mode parameter rules (AD-CB-08, FR-11.3):
 *   - No argument → opens in Files mode (default).
 *   - Same mode called while open → toggle-close (FR-01.8, EC-13).
 *   - Different mode called while open → switch without closing (FR-01.8, EC-12).
 *
 * - EC-05/FR-01.6: if already open in same mode, acts as a toggle and closes the bar.
 * - FR-03.A.2: rebuilds the full result set synchronously on every open.
 * - FR-01.3: focuses the input after open.
 * - FR-06.3: pre-selects the first non-dimmed result.
 *
 * @param mode - Target BarMode. Defaults to "files".
 */
function openBar(mode?: BarMode): void {
  if (!_overlayEl || !_inputEl || !_resultsEl) return;

  const targetMode = mode ?? "files";

  if (_isOpen) {
    if (_mode === targetMode) {
      // Same mode re-triggered: toggle close (FR-01.8, EC-13).
      closeBar();
      return;
    } else {
      // Different mode: switch without closing (FR-01.8, EC-12).
      // If key-capture is active, cancel it before switching modes (EC-11/EC-12).
      if (_capturingFor !== null) exitKeyCapture();
      setMode(targetMode);
      _inputEl.value = "";
      _openGeneration++;

          if (targetMode === "files") {
        // Switching TO files mode while open: reset files state and start a fresh fetch.
        _fileListLoaded = false;
        _fileListError = false;
        _fileModeResults = [];
        _totalWorkspaceCount = 0;
        _allResults = [];
        filterAndRenderFiles("");
        const capturedGeneration = _openGeneration;
        void fetchWorkspaceFiles(capturedGeneration);
      } else {
        // Switching INTO commands/keybindings mode: rebuild _allResults.
        // Files mode uses a separate pipeline (_fileModeResults); commands/keybindings
        // use _allResults which must be fresh. If we're switching from files mode,
        // _allResults was set to [] and must be repopulated.
        try {
          _allResults = buildResultsForMode(targetMode, _settings);
        } catch (err) {
          console.error("[CommandBar] buildResultsForMode failed on mode switch:", err);
          _allResults = [];
        }
        filterAndRender("");

        // Keybindings mode: start async preset loading (Step 05).
        // The generation guard ensures stale loads do not land after mode switches.
        if (targetMode === "keybindings") {
          _presets = [{ name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true }];
          renderPresetRow(); // show Default immediately; user sees dropdown right away
          const genAtOpen = _openGeneration;
          void loadPresets(makePresetApiDeps()).then((presets) => {
            // Discard result if bar was closed or mode changed while loading.
            if (!_isOpen || _mode !== "keybindings" || _openGeneration !== genAtOpen) return;
            _presets = presets;
            // EC-36: if saved activePreset no longer exists on disk, fall back to Default.
            const found = presets.find((p) => p.name === _settings.activePreset);
            if (!found) {
              console.warn(
                `[CommandBar] Active preset "${_settings.activePreset}" not found; falling back to Default`,
              );
              _settings.activePreset = DEFAULT_PRESET_NAME;
              if (_api) void _api.saveSettings(_settings as unknown as Record<string, unknown>);
            }
            renderPresetRow();
          });
        }
      }
      return;
    }
  }

  _isOpen = true;
  _openGeneration++;
  setMode(targetMode);
  openCommandBar(_overlayEl, _inputEl);

  if (targetMode === "files") {
    // ── Files mode: two-phase open ───────────────────────────────────────────
    // Phase 1 (synchronous): reset async state and render open tabs immediately
    // so the bar is interactive at T+0ms (NFR-01 <80ms to interactive).
    _fileListLoaded = false;
    _fileListError = false;
    _fileModeResults = [];
    _totalWorkspaceCount = 0;
    // _allResults is not used by the files path; set to empty to keep state clean.
    _allResults = [];

    // filterAndRenderFiles() in turn calls buildFilesResults with workspaceFiles:[]
    // and workspaceLoadState:"loading" — this renders the tabs and the "Loading…" notice.
    filterAndRenderFiles("");

    // Phase 2 (async): kick off the workspace scan. The generation value captured here
    // lets fetchWorkspaceFiles detect if the bar has been closed before the scan finishes
    // and silently drop stale results (EC-28).
    const capturedGeneration = _openGeneration;
    void fetchWorkspaceFiles(capturedGeneration);
  } else {
    // ── Commands / Keybindings mode: synchronous build ────────────────────────
    // Rebuild results fresh on every open (reflects current plugin/keybinding state).
    try {
      _allResults = buildResultsForMode(targetMode, _settings);
    } catch (err) {
      console.error("[CommandBar] buildResultsForMode failed:", err);
      _allResults = [];
    }
    _visibleResults = _allResults;
    _selectedId = firstSelectableId(_visibleResults);
    if (targetMode === "keybindings") {
      renderKeybindingResults(_resultsEl, _visibleResults as unknown as KeybindingResult[], "", _selectedId);
    } else {
      renderResults(_resultsEl, _visibleResults, "", _selectedId);
    }
    updateAriaActiveDescendant(_inputEl, _selectedId);
    scrollSelectedIntoView(_resultsEl);

    // Keybindings mode: load presets asynchronously (Step 05).
    // The synchronous build above is interactive immediately (NFR-01 <80ms).
    // Preset loading happens in parallel — Default is shown until it resolves.
    if (targetMode === "keybindings") {
      _presets = [{ name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true }];
      renderPresetRow(); // show Default immediately
      const genAtOpen = _openGeneration;
      void loadPresets(makePresetApiDeps()).then((presets) => {
        // Discard result if bar was closed or mode changed while loading.
        if (!_isOpen || _mode !== "keybindings" || _openGeneration !== genAtOpen) return;
        _presets = presets;
        // EC-36: if saved activePreset no longer exists on disk, fall back to Default.
        const found = presets.find((p) => p.name === _settings.activePreset);
        if (!found) {
          console.warn(
            `[CommandBar] Active preset "${_settings.activePreset}" not found; falling back to Default`,
          );
          _settings.activePreset = DEFAULT_PRESET_NAME;
          if (_api) void _api.saveSettings(_settings as unknown as Record<string, unknown>);
        }
        renderPresetRow();
      });
    }
  }

  // FR-01.3: use setTimeout(0) rather than requestAnimationFrame so focus lands
  // after the macOS/Tauri window system has finished processing the triggering
  // keystroke. rAF fires within the same event-loop task; setTimeout queues a
  // new macrotask, giving the window time to settle before we focus.
  const inputRef = _inputEl;
  setTimeout(() => { inputRef.focus(); }, 0);
}

/**
 * Close the Command Bar and restore state.
 * Safe to call when bar is already closed (no-op via _isOpen guard).
 *
 * FR-01.9: resets _mode to "files" on every close so the next open always
 * starts fresh in the default mode regardless of which mode was active.
 */
function closeBar(): void {
  if (!_overlayEl || !_inputEl || !_isOpen) return;

  // EC-30: exit key-capture cleanly if active when bar is closed from outside
  // (e.g. the user triggers another shortcut or the plugin is disabled mid-capture).
  if (_capturingFor !== null) {
    _capturingFor = null;
    _captureViewEl?.classList.add("cb-capture-view--hidden");
    _resultsEl?.classList.remove("cb-results--hidden");
  }

  _openGeneration++;   // EC-28: guard stale async fetches (preset loading, workspace scan)
  // EC-12/EC-13: invalidate any in-flight content search so stale results are discarded.
  _contentSearchGeneration++;
  _contentSearchInFlight = false;
  _isOpen = false;
  // FR-01.9: always reset to files mode on close so the next open is predictable.
  _mode = "files";
  closeCommandBar(_overlayEl, _inputEl);
  _selectedId = null;
  _visibleResults = [];
  // Reset preset save input visibility so it does not persist into the next open.
  _presetSaveInputVisible = false;
}

/**
 * Activate the currently selected result: close the bar, then run the action.
 * Dimmed results are guarded (they should not be selectable, but we double-guard).
 * Bar closes before the action runs so the action's UI changes are unobstructed.
 */
function activateSelected(): void {
  if (!_selectedId) return;
  const result = _visibleResults.find((r) => r.id === _selectedId);
  if (!result || result.dimmed) return;

  // In keybindings mode the action enters key-capture — do not close the bar.
  if (_mode !== "keybindings") closeBar();
  result.action();
}

// ---------------------------------------------------------------------------
// Named event handler functions (module-level for removeEventListener)
// ---------------------------------------------------------------------------

/**
 * Handle input events on the search field.
 * `this` is the input element (standard DOM event handler pattern).
 *
 * Prefix switching (AD-CB-09): checked here in the `input` event (after the
 * character is in the field) rather than in `keydown` (before the DOM updates).
 * Only activates FROM files mode — '>' in commands mode is a normal search char.
 *
 * Prefix rules (FR-06.1, FR-06.2):
 *   '>' typed as the sole character in files mode → switch to commands mode
 *   '#' typed as the sole character in files mode → switch to keybindings mode
 */
function onInput(this: HTMLInputElement): void {
  const raw = this.value;

  // Prefix switching: only triggers when in files mode and the entire input
  // consists of a single prefix character. Any additional text means the user
  // is searching, not switching modes.
  if (_mode === "files" && raw === ">") {
    setMode("commands");
    this.value = "";
    // Rebuild _allResults for commands mode: files mode leaves _allResults = []
    // so we must repopulate before filterAndRender() can show any results.
    try {
      _allResults = buildResultsForMode("commands", _settings);
    } catch (err) {
      console.error("[CommandBar] buildResultsForMode failed on prefix switch:", err);
      _allResults = [];
    }
    filterAndRender("");
    return;
  }
  if (_mode === "files" && raw === "#") {
    setMode("keybindings");
    this.value = "";
    _openGeneration++;
    // Rebuild _allResults for keybindings mode: files mode leaves _allResults = [].
    try {
      _allResults = buildResultsForMode("keybindings", _settings);
    } catch (err) {
      console.error("[CommandBar] buildResultsForMode failed on prefix switch:", err);
      _allResults = [];
    }
    filterAndRender("");
    // Start preset loading for keybindings mode (same pattern as openBar / switchMode).
    _presets = [{ name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true }];
    renderPresetRow();
    const genAtSwitch = _openGeneration;
    void loadPresets(makePresetApiDeps()).then((presets) => {
      if (!_isOpen || _mode !== "keybindings" || _openGeneration !== genAtSwitch) return;
      _presets = presets;
      renderPresetRow();
    });
    return;
  }

  // FR-6: '/' as the sole character in files mode → switch to content mode.
  // EC-21: once already in content mode, '/' is a normal search character (no switch).
  // EC-15: '/' within a longer query (e.g. "design/") does NOT switch modes because
  //         `raw` would be "design/", not the single character "/".
  if (_mode === "files" && raw === "/") {
    setMode("content");
    this.value = "";
    // Increment _openGeneration so any stale async fetch (e.g. a pending
    // fetchWorkspaceFiles from files mode) sees this switch and self-cancels (M-3).
    _openGeneration++;
    // Reset any in-flight content search from a previous session.
    _contentSearchGeneration++;
    _contentSearchInFlight = false;
    // Render the initial empty state (null payload = no results yet, footer hint visible).
    renderContentResults(null, "");
    return;
  }

  filterAndRender(raw.trim());
}

/**
 * Handle keydown events on the overlay (Escape, arrow keys, Enter, Tab, Backspace).
 * All navigation keys are consumed (preventDefault + stopPropagation) to implement
 * the focus trap (NFR-05, FR-06.4) and prevent bubbling to the CM6 editor.
 *
 * Tab = move selection down; Shift+Tab = move selection up (FR-06.4).
 *
 * Backspace rule (FR-06.3, FR-06.4):
 *   When input is empty AND mode is not files → return to files mode.
 *   When input is non-empty → normal delete (do not intercept).
 *   When already in files mode → normal no-op (do not intercept).
 */
function onOverlayKeydown(e: KeyboardEvent): void {
  // ── Key-capture sub-state: intercept ALL keys (FR-05.3, EC-19, EC-20) ────────
  // When the user is in capture mode (awaiting a key combo for an action), every
  // keydown must be intercepted so it is not forwarded to the editor or system.
  // Escape exits capture and restores search view (EC-17).
  // Modifier-only presses are ignored — we wait for a real key (EC-18).
  if (_capturingFor !== null) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      exitKeyCapture(); // EC-17: restore search view
      return;
    }

    if (isModifierOnly(e)) return; // EC-18: wait for non-modifier key

    const combo = captureKeyFromEvent(e)!;
    const cmds = (window as any).__MARKABLE_COMMANDS__ as CommandDef[] ?? [];
    const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
    const appSettings = typeof getSettings === "function" ? getSettings() : { keybindings: {} };
    const customBindings: Record<string, string> = appSettings.keybindings ?? {};

    const conflict = checkConflict(combo, _capturingFor, cmds, customBindings);

    if (conflict === null) {
      // Free combo — save immediately and close.
      void handleOverride(combo);
      return;
    }

    if (conflict.type === "self") {
      // EC-21: user pressed the same key the action already has — treat as no-op.
      // The binding is unchanged; close the bar without showing a conflict warning.
      closeBar();
      return;
    }

    if (conflict.type === "system-reserved") {
      // EC-19, EC-20: macOS-reserved combo — show second-confirmation prompt.
      renderCaptureView({ type: "system-reserved-confirm", combo });
      return;
    }

    // Regular conflict: another action owns this combo. Show Override/Cancel.
    renderCaptureView({ type: "conflict", info: conflict, _pendingCombo: combo });
    return;
  }

  // Backspace-to-files: only when the input is empty and we are not already in files mode.
  // If the input has text, Backspace deletes a character normally (FR-06.4).
  if (e.key === "Backspace" && _inputEl!.value === "" && _mode !== "files") {
    e.preventDefault();
    e.stopPropagation();
    setMode("files");
    filterAndRender("");
    return;
  }

  switch (e.key) {
    case "Escape":
      e.preventDefault();
      e.stopPropagation();
      closeBar(); // EC-06: always closes regardless of input content
      break;
    case "ArrowDown":
      e.preventDefault();
      e.stopPropagation();
      moveSelection(1);
      break;
    case "ArrowUp":
      e.preventDefault();
      e.stopPropagation();
      moveSelection(-1);
      break;
    case "Enter":
      e.preventDefault();
      e.stopPropagation();
      // Content mode intercepts Enter to perform a vault-wide content search.
      // All other modes use activateSelected() to run the highlighted action.
      if (_mode === "content") {
        void handleContentSearchEnter();
      } else {
        activateSelected();
      }
      break;
    case "Tab":
      // Focus trap: Tab cycles through results without leaving the overlay.
      e.preventDefault();
      e.stopPropagation();
      moveSelection(e.shiftKey ? -1 : 1);
      break;
  }
}

/**
 * Close the bar when the user clicks the backdrop (area outside .cb-panel).
 * FR-01.2: click outside = close.
 */
function onBackdropClick(e: MouseEvent): void {
  if (e.target === _overlayEl) closeBar();
}

/**
 * Handle result row clicks via event delegation.
 * EC-02: dimmed results are no-ops (also enforced by CSS pointer-events:none).
 */
function onResultClick(e: MouseEvent): void {
  const row = (e.target as Element).closest(".cb-result") as HTMLElement | null;
  if (!row) return;
  const resultId = row.dataset.id;
  if (!resultId) return;
  const result = _visibleResults.find((r) => r.id === resultId);
  if (!result || result.dimmed) return;
  _selectedId = resultId;
  // In keybindings mode the action enters key-capture — do not close the bar.
  // In content mode the openAction closure already calls closeBar() explicitly,
  // so we must not call it here too (double-close guard, AD-GS-05).
  if (_mode !== "keybindings" && _mode !== "content") closeBar();
  result.action();
}

/**
 * Handle result row hover via event delegation.
 * FR-06.5: hovering highlights a result (updates _selectedId and re-renders).
 */
function onResultHover(e: MouseEvent): void {
  const row = (e.target as Element).closest(".cb-result") as HTMLElement | null;
  if (!row) return;
  const resultId = row.dataset.id;
  if (!resultId) return;
  const result = _visibleResults.find((r) => r.id === resultId);
  if (!result || result.dimmed) return;
  if (_selectedId === resultId) return; // no-op if already selected

  _selectedId = resultId;
  if (!_inputEl || !_resultsEl) return;
  if (_mode === "keybindings") {
    // Keybindings mode uses its own renderer to show key badges and capture buttons.
    renderKeybindingResults(_resultsEl, _visibleResults as unknown as KeybindingResult[], _inputEl.value, _selectedId);
  } else if (_mode === "files") {
    // Files mode uses its own data pipeline — re-run the filter/render so the
    // selection highlight updates correctly without corrupting files-mode DOM.
    filterAndRenderFiles(_inputEl.value.trim());
  } else if (_mode === "content") {
    // Content mode renders custom grouped DOM (file header + excerpts). Calling
    // renderResults() here would wipe that DOM. Instead, only update the selection
    // highlight in place without re-rendering all rows (AD-GS-05).
    // NOTE: the `updateAriaActiveDescendant` call that was here previously is
    // removed (M-2): the unconditional call at the end of this function covers it.
    const prevSelected = _resultsEl?.querySelector(".cb-result--selected");
    prevSelected?.classList.remove("cb-result--selected");
    const newSelected = _resultsEl?.querySelector(`[data-id="${_selectedId}"]`);
    newSelected?.classList.add("cb-result--selected");
  } else {
    renderResults(_resultsEl, _visibleResults, _inputEl.value, _selectedId);
  }
  updateAriaActiveDescendant(_inputEl, _selectedId);
}

/**
 * EC-12: close the bar defensively when the active tab closes.
 * The TabManager dispatches a "markable-tab-closed" CustomEvent on document.
 */
function onTabClosed(): void {
  if (_isOpen) closeBar();
}

// ---------------------------------------------------------------------------
// Listener management
// ---------------------------------------------------------------------------

/**
 * Attach all event listeners to the overlay and document.
 * Called once in onEnable after the DOM is built and appended.
 */
function attachListeners(): void {
  if (!_overlayEl || !_inputEl || !_resultsEl) return;

  _inputEl.addEventListener("input", onInput);
  _overlayEl.addEventListener("keydown", onOverlayKeydown);
  _overlayEl.addEventListener("click", onBackdropClick);
  _resultsEl.addEventListener("click", onResultClick);
  _resultsEl.addEventListener("mousemove", onResultHover);

  // Tab strip: clicking any tab directly switches to that tab's mode.
  // Event delegation on the strip catches all three tab buttons with one listener.
  if (_tabStripEl) _tabStripEl.addEventListener("click", onTabStripClick);

  // EC-12: listen for tab-close events at the document level.
  document.addEventListener("markable-tab-closed", onTabClosed);
}

/**
 * Remove the document-level event listener for tab-close.
 * DOM listeners on _overlayEl are automatically removed when the element is
 * removed from the DOM (they follow the node's lifecycle).
 */
function detachListeners(): void {
  document.removeEventListener("markable-tab-closed", onTabClosed);
}

// ---------------------------------------------------------------------------
// Settings UI (Step 06)
// ---------------------------------------------------------------------------

/**
 * Render the settings UI into the Plugins Panel detail view container.
 * Called by the Plugins Panel when the user opens the Command Bar detail.
 *
 * Creates two labeled checkboxes (showCommands, showHeadings) using the standard
 * plugin settings CSS classes for visual consistency. showRecentFiles was removed
 * from the UI in Step 03 (FR-09.2) — it is accepted from saved settings for
 * backwards compatibility but is no longer surfaced to the user.
 *
 * Also renders a static "Keybinding Preset" section that will be populated
 * in Step 05 with the full preset management UI. For now it shows the active
 * preset name as a read-only label.
 *
 * Why this function is justified at >30 lines:
 * This function must produce two semantically complete form rows in a single
 * pass, where each row requires: a wrapper div, a label wrapper div, a <label>
 * element (with htmlFor), a description <p> element, and an <input type=checkbox>
 * with a change handler that both mutates module-level `_settings` and persists
 * via `_api.saveSettings()`. Each row takes ~10 lines of DOM API calls. Two rows
 * plus the preset section (three child elements) drive the line count. Abstracting
 * "make one row" into a helper would split the rendering contract without adding clarity.
 *
 * @param container - Freshly created container element provided by the panel.
 */
export function renderDetailExtra(container: HTMLElement): void {
  // Step 03: showRecentFiles removed from the items array (FR-09.2, AD-02).
  // Recent files are now accessible only via Files mode (Cmd-P).
  const items: Array<{ key: keyof CommandBarSettings; label: string; description: string }> = [
    {
      key: "showCommands",
      label: "Show Commands",
      description: "Include app commands and plugin toggles in results",
    },
    {
      key: "showHeadings",
      label: "Show Headings",
      description: "Include document headings for quick navigation",
    },
    // showRecentFiles removed — FR-09.2, AD-02
  ];

  const section = document.createElement("div");
  section.className = "settings-section";

  const title = document.createElement("h3");
  title.className = "settings-label";
  title.textContent = "Result Categories";
  section.appendChild(title);

  for (const item of items) {
    const settingKey = item.key;
    const row = buildToggleRow({
      label: item.label,
      description: item.description,
      checked: _settings[item.key] as boolean,
      id: `cb-setting-${item.key}`,
      onChange: (checked) => {
        (_settings as any)[settingKey] = checked;
        // FR-07.2: persist immediately so settings survive plugin reload.
        if (_api) void _api.saveSettings(_settings as unknown as Record<string, unknown>);
      },
    });
    section.appendChild(row);
  }

  container.appendChild(section);

  // ── Keybinding Preset section (Step 03 placeholder; fully populated in Step 05) ──
  // Shows the currently active preset name as a read-only label. Step 05 will
  // replace this with the full preset management UI (dropdown, save, rename, delete).
  const presetSection = document.createElement("div");
  presetSection.className = "settings-section";

  const presetTitle = document.createElement("h3");
  presetTitle.className = "settings-label";
  presetTitle.textContent = "Keybinding Preset";

  const presetDesc = document.createElement("p");
  presetDesc.className = "settings-description";
  presetDesc.textContent = `Active preset: ${_settings.activePreset}`;

  presetSection.appendChild(presetTitle);
  presetSection.appendChild(presetDesc);
  container.appendChild(presetSection);
}

// ---------------------------------------------------------------------------
// Settings loader
// ---------------------------------------------------------------------------

/**
 * Load persisted plugin settings from the plugin API.
 * Falls back to DEFAULT_SETTINGS for any missing or invalid field so the plugin
 * is robust to corrupt or partial saved data.
 *
 * @param api - The MarkablePluginAPI instance provided by onEnable.
 */
async function loadPluginSettings(api: MarkablePluginAPI): Promise<void> {
  const saved = await api.loadSettings();
  if (saved) {
    _settings = {
      showCommands:  typeof saved.showCommands  === "boolean" ? (saved.showCommands  as boolean) : DEFAULT_SETTINGS.showCommands,
      showHeadings:  typeof saved.showHeadings  === "boolean" ? (saved.showHeadings  as boolean) : DEFAULT_SETTINGS.showHeadings,
      // showRecentFiles is accepted from saved data for backwards compatibility
      // (FR-09.2) but is always set to true internally — the value in saved settings
      // is ignored. Recent files are now served by Files mode, not Commands mode.
      showRecentFiles: true,
      activePreset:  typeof saved.activePreset  === "string"  ? (saved.activePreset  as string)  : DEFAULT_SETTINGS.activePreset,
    };
  } else {
    _settings = { ...DEFAULT_SETTINGS };
  }
}

// ---------------------------------------------------------------------------
// Plugin export (Step 07)
// ---------------------------------------------------------------------------

/**
 * Command Bar plugin definition.
 *
 * Lifecycle:
 *   onEnable  — inject CSS, build DOM, attach listeners, register global
 *   onDisable — clean close, remove DOM, remove CSS, null globals
 */
export default {
  id: "command-bar",
  name: "Command Bar",
  version: "1.0.0",
  description: "Fuzzy command palette for commands, headings, and recent files",
  detail:
    "Open with Cmd-Shift-P to fuzzy-search all app commands, document headings, " +
    "and recently opened files. Fully keyboard-driven. Keybinding is remappable " +
    "in Preferences > Keyboard Shortcuts.",

  renderDetailExtra,

  async onEnable(api: MarkablePluginAPI): Promise<void> {
    _api = api;

    // Load persisted settings before building results (category visibility).
    await loadPluginSettings(api);

    // Inject CSS and build the overlay DOM once (reused across open/close cycles).
    injectCSS();
    _overlayEl   = buildOverlayDOM();
    _inputEl     = _overlayEl.querySelector<HTMLInputElement>(".cb-input")!;
    _resultsEl   = _overlayEl.querySelector<HTMLElement>(".cb-results")!;
    // Wire mode tab strip and supporting UI element refs.
    _tabStripEl     = _overlayEl.querySelector<HTMLElement>(".cb-tab-strip")!;
    _presetRowEl    = _overlayEl.querySelector<HTMLElement>(".cb-preset-row")!;
    _footerEl       = _overlayEl.querySelector<HTMLElement>(".cb-footer")!;
    // Step 04: wire key-capture view ref.
    _captureViewEl  = _overlayEl.querySelector<HTMLElement>(".cb-capture-view")!;

    attachListeners();
    document.body.appendChild(_overlayEl);

    // Register the open function with mode-aware signature (AD-CB-08).
    // Existing callers that call __MARKABLE_COMMAND_BAR_OPEN__() with no argument
    // continue to open in Files mode (FR-11.3 default).
    (window as any).__MARKABLE_COMMAND_BAR_OPEN__ = (mode?: BarMode) => openBar(mode);
  },

  onDisable(_unusedApi: MarkablePluginAPI): void {
    // EC-20: clean close if the bar is open when the plugin is disabled.
    if (_isOpen) closeBar();

    // Remove document-level listeners; DOM listeners removed with overlay.
    detachListeners();
    _overlayEl?.remove();

    // Deregister window globals so handleAction() becomes a no-op (EC-19).
    (window as any).__MARKABLE_COMMAND_BAR_OPEN__     = null;
    (window as any).__MARKABLE_COMMAND_BAR_IS_OPEN__  = false;

    removeCSS();

    // Null all module-level state for a clean re-enable cycle.
    _overlayEl      = null;
    _inputEl        = null;
    _resultsEl      = null;
    _tabStripEl     = null;
    _presetRowEl    = null;
    _footerEl       = null;
    _api            = null;
    _mode           = "files";
    _openGeneration = 0;
    _allResults     = [];
    _visibleResults = [];
    _selectedId     = null;
    _isOpen         = false;
    _settings       = { ...DEFAULT_SETTINGS };
    // Reset files mode async state (Step 02).
    _fileModeResults     = [];
    _fileListLoaded      = false;
    _fileListError       = false;
    _totalWorkspaceCount = 0;
    // Reset content search state (Step 03).
    _contentSearchGeneration++;
    _contentSearchInFlight = false;
    // Reset key-capture state (Step 04).
    _captureViewEl       = null;
    _capturingFor        = null;
    _captureQuery        = "";
    _captureExistingKey  = "";
    _captureActionLabel  = "";
    // Reset preset state (Step 05).
    _presets              = [];
    _presetSaveInputVisible = false;
  },
};

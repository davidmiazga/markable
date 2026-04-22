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

// ── Re-export public functions used by test imports ───────────────────────────
export { renderHighlightedLabel };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The three operating modes of the modal command bar.
 *
 *   files       — open tabs + workspace file search (Cmd-P)
 *   commands    — app commands + headings (Cmd-Shift-P, legacy default)
 *   keybindings — browse and reassign keyboard shortcuts (Cmd-Shift-K)
 *
 * Mode state is stored as a module-level variable (_mode) — never derived from
 * DOM attributes — to keep transitions O(1) and avoid layout reads (AD-CB-01).
 */
export type BarMode = "files" | "commands" | "keybindings";

/** The three result categories shown in the Command Bar. */
type ResultCategory = "commands" | "headings" | "recent";

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
 */
const MODE_PLACEHOLDERS: Record<BarMode, string> = {
  files:       "Open file or tab…",
  commands:    "Type a command or search headings…",
  keybindings: "Search actions to assign shortcut…",
};

/**
 * Footer hint text for each mode. Shown in the .cb-footer bar at the bottom
 * of the overlay panel so the user knows what Enter and Escape do.
 */
const MODE_FOOTER_HINTS: Record<BarMode, string> = {
  files:       "Enter to open  ·  Esc to close",
  commands:    "Enter to run  ·  Esc to close",
  keybindings: "Enter to assign shortcut  ·  Esc to close",
};

/**
 * Human-readable mode labels displayed in the mode badge button.
 */
const MODE_BADGE_LABELS: Record<BarMode, string> = {
  files:       "Files",
  commands:    "Commands",
  keybindings: "Keybindings",
};

/**
 * Cycle order for tab strip clicks (FR-08.3).
 * Kept for keyboard / fallback cycling logic.
 */
const MODE_CYCLE: BarMode[] = ["commands", "files", "keybindings"];

/**
 * Shortcut hint glyphs shown next to each tab label.
 * Displayed in a muted, smaller font so power users can see the hotkey at a glance
 * without the glyph competing visually with the tab label (NFR-04 — no hardcoded hex).
 */
const MODE_TAB_SHORTCUTS: Record<BarMode, string> = {
  files:       "⌘P",
  commands:    "⌘⇧P",
  keybindings: "⌘⇧K",
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
  // "files" builds results asynchronously via fetchWorkspaceFiles — not here.
  // "keybindings" builder is implemented in Step 4; stub returns [] until then.
  return [];
}

/**
 * @deprecated Use buildResultsForMode("commands", settings) instead.
 *
 * Legacy wrapper retained for call-site compatibility within this file.
 * The old buildAllResults() included the Recent Files category (showRecentFiles).
 * That category is now removed from Commands mode (FR-09.2). Any internal callers
 * that previously used buildAllResults() have been updated to call
 * buildResultsForMode() directly. This wrapper is kept as a named alias so that
 * a reader searching for "buildAllResults" can trace the evolution.
 *
 * @param settings - Current plugin settings.
 * @returns Same as buildResultsForMode("commands", settings).
 */
function buildAllResults(settings: CommandBarSettings): CommandBarResult[] {
  return buildResultsForMode("commands", settings);
}

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

  panel.appendChild(tabStrip);
  panel.appendChild(inputRow);
  panel.appendChild(presetRow);
  panel.appendChild(resultsList);
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
let _allResults: CommandBarResult[] = [];
let _visibleResults: CommandBarResult[] = [];
let _selectedId: string | null = null;
let _isOpen = false;

// Plugin settings (loaded from API in onEnable).
let _settings: CommandBarSettings = { ...DEFAULT_SETTINGS };

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
 * Badge click handler: cycle through modes in order Files → Commands → Keybindings → Files.
 * Clears the input and re-renders results for the new mode.
 *
 * FR-08.3: clicking the badge advances to the next mode in MODE_CYCLE.
 * EC-11: key-capture exit (Step 4) will be wired here in the future; for now,
 *        it is a no-op because key-capture is not yet implemented.
 *
 * Why _allResults is rebuilt here for non-files modes:
 *   When transitioning FROM files mode (where _allResults = []) TO commands or
 *   keybindings mode, _allResults must be repopulated before filterAndRender() is
 *   called. Without this, the commands/keybindings mode would render an empty list.
 *   Transitioning FROM commands mode: _allResults is already populated, no rebuild needed.
 *   Transitioning TO files mode: filterAndRenderFiles() handles its own data pipeline.
 */
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
      _allResults = buildAllResults(_settings);
    } catch (err) {
      console.error("[CommandBar] buildAllResults failed on mode switch:", err);
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
async function fetchWorkspaceFiles(generation: number): Promise<void> {
  const currentFile: string | null = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;

  if (!currentFile) {
    // EC-01/EC-02: no open file, so no workspace directory to scan.
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
  parts.pop(); // remove the filename segment
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

  // Build the full FilesResult[] including both tabs and workspace files.
  // This replaces the phase-1 tabs-only result set with the complete set.
  _fileModeResults = buildFilesResults({
    tabs,
    workspaceFiles,
    workspaceLoadState: "loaded",
    openTab: switchToTab,
    openFile: openFileInTab,
  });

  _fileListLoaded = true;
  _fileListError = false;

  // Only refresh if the bar is still open in files mode (EC-28: second guard on
  // the display path, complementing the generation check above).
  if (_mode === "files" && _isOpen) {
    refreshFilesDisplay();
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
  renderResults(_resultsEl, _visibleResults, _inputEl.value, _selectedId);
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

  // ── Commands / Keybindings mode (existing pipeline, unchanged) ────────────
  if (query === "") {
    // FR-02.5: empty query shows all results without ranking.
    _visibleResults = _allResults;
    _selectedId = firstSelectableId(_visibleResults);
    renderResults(_resultsEl, _visibleResults, "", _selectedId);
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
    renderResults(_resultsEl, _visibleResults, query, _selectedId);
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
          _allResults = buildAllResults(_settings);
        } catch (err) {
          console.error("[CommandBar] buildAllResults failed on mode switch:", err);
          _allResults = [];
        }
        filterAndRender("");
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
    // Rebuild results fresh on every open (EC-30: reflects current plugin states).
    // Wrapped in try-catch: if buildAllResults throws (e.g. a missing global or
    // unexpected API shape), the overlay still shows and renders an empty list
    // rather than leaving the results container blank with no feedback.
    try {
      _allResults = buildAllResults(_settings);
    } catch (err) {
      console.error("[CommandBar] buildAllResults failed:", err);
      _allResults = [];
    }
    _visibleResults = _allResults;
    _selectedId = firstSelectableId(_visibleResults);
    renderResults(_resultsEl, _visibleResults, "", _selectedId);
    updateAriaActiveDescendant(_inputEl, _selectedId);
    scrollSelectedIntoView(_resultsEl);
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
  _isOpen = false;
  // FR-01.9: always reset to files mode on close so the next open is predictable.
  _mode = "files";
  closeCommandBar(_overlayEl, _inputEl);
  _selectedId = null;
  _visibleResults = [];
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

  closeBar();
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
    filterAndRender("");
    return;
  }
  if (_mode === "files" && raw === "#") {
    setMode("keybindings");
    this.value = "";
    filterAndRender("");
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
      activateSelected();
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
  closeBar();
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
  renderResults(_resultsEl, _visibleResults, _inputEl.value, _selectedId);
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
    const row = document.createElement("div");
    row.className = "settings-row";

    const labelWrap = document.createElement("div");
    labelWrap.className = "settings-row-label";

    const labelEl = document.createElement("label");
    const checkboxId = `cb-setting-${item.key}`;
    labelEl.htmlFor = checkboxId;
    labelEl.className = "settings-label";
    labelEl.textContent = item.label;

    const descEl = document.createElement("p");
    descEl.className = "settings-description";
    descEl.textContent = item.description;

    labelWrap.appendChild(labelEl);
    labelWrap.appendChild(descEl);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = checkboxId;
    checkbox.className = "settings-checkbox";
    checkbox.checked = _settings[item.key] as boolean;

    const settingKey = item.key; // captured in closure
    checkbox.addEventListener("change", () => {
      (_settings as any)[settingKey] = checkbox.checked;
      // FR-07.2: persist immediately so settings survive plugin reload.
      if (_api) void _api.saveSettings(_settings as unknown as Record<string, unknown>);
    });

    row.appendChild(labelWrap);
    row.appendChild(checkbox);
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
    _tabStripEl  = _overlayEl.querySelector<HTMLElement>(".cb-tab-strip")!;
    _presetRowEl = _overlayEl.querySelector<HTMLElement>(".cb-preset-row")!;
    _footerEl    = _overlayEl.querySelector<HTMLElement>(".cb-footer")!;

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
  },
};

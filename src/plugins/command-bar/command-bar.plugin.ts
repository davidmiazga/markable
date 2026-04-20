/**
 * Command Bar plugin for Markable 2.0 (FC2 #11).
 *
 * Implements a floating modal command palette (Cmd-Shift-P) that fuzzy-searches
 * three result categories and executes the selection:
 *   A) App commands + plugin toggles (from window.__MARKABLE_COMMANDS__)
 *   B) Document headings (from CM6 editor state)
 *   C) Recently opened files (from window.__MARKABLE_GET_SETTINGS__())
 *
 * Architecture:
 *   - IIFE plugin: no app module imports at runtime. All inter-boundary
 *     communication goes through window globals (AD-01..AD-09 in 00_index.md).
 *   - fuzzy-ranker.ts is a pure module imported here and bundled inline by Rollup.
 *   - All CSS uses CSS variables; no hardcoded hex or font names (NFR-04).
 *   - Single DOM instance: overlay created once in onEnable, reused across opens.
 *   - Focus trap: Tab/Shift-Tab cycle through results; focus never leaves overlay.
 */

import { fuzzyMatch, renderHighlightedLabel } from "./fuzzy-ranker";
import type { FuzzyMatch } from "./fuzzy-ranker";

// ── Re-export public functions used by test imports ───────────────────────────
export { renderHighlightedLabel };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/** Persisted settings for the Command Bar plugin. */
interface CommandBarSettings {
  showCommands: boolean;    // default: true
  showHeadings: boolean;    // default: true
  showRecentFiles: boolean; // default: true
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
  showCommands: true,
  showHeadings: true,
  showRecentFiles: true,
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
// Top-level result builder
// ---------------------------------------------------------------------------

/**
 * Build the complete result set by calling all three category builders and
 * concatenating their outputs in category order (A → B → C).
 *
 * This function reads from window globals. It is called synchronously on every
 * open of the Command Bar. The full result set is cached in _allResults so
 * the scan only happens once per open (not once per keystroke).
 *
 * Why this function is justified at >30 lines:
 * This function is the boundary between the IIFE plugin sandbox and the rest of
 * the app. All window global access is intentionally concentrated here rather
 * than scattered across individual builders — each builder accepts explicit
 * dependency injection args (tested in isolation). buildAllResults is the single
 * place where globals are read and assembled into those args. Six distinct globals
 * must be read and three conditional pushes made, one per enabled category. The
 * boilerplate of reading globals + constructing the navigateToPlugin closure for
 * the commands category + building the fallback appSettings object drives the line
 * count. Splitting would only move lines around without clarifying responsibility.
 *
 * @param settings - Current plugin settings (controls which categories are shown).
 * @returns Complete array of CommandBarResult across enabled categories.
 */
function buildAllResults(settings: CommandBarSettings): CommandBarResult[] {
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

  if (settings.showRecentFiles) {
    results.push(...buildRecentFileResults({
      recentFiles: appSettings.recentFiles ?? [],
      openFileByPath: (path: string) => {
        const tm = (window as any).__MARKABLE_TAB_MANAGER__;
        if (tm) void tm.openFileInTab(path);
        return Promise.resolve();
      },
    }));
  }

  return results;
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

  const inputRow = document.createElement("div");
  inputRow.className = "cb-input-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cb-input";
  input.placeholder = "Type a command or search…";
  input.autocomplete = "off";
  input.spellcheck = false;
  // ARIA attributes for screen reader support (NFR-05, EC-27).
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "cb-results-list");
  input.setAttribute("aria-activedescendant", "");
  inputRow.appendChild(input);

  const resultsList = document.createElement("div");
  resultsList.className = "cb-results";
  resultsList.id = "cb-results-list";
  resultsList.setAttribute("role", "listbox");

  panel.appendChild(inputRow);
  panel.appendChild(resultsList);
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
    const cmds = (window as any).__MARKABLE_COMMANDS__;
    const pm   = (window as any).__MARKABLE_PLUGIN_MANAGER__;
    const ha   = (window as any).__MARKABLE_HANDLE_ACTION__;
    if (_lastBuildError) {
      empty.textContent = `Build error: ${_lastBuildError}`;
    } else if (!cmds || (Array.isArray(cmds) && cmds.length === 0)) {
      empty.textContent = `No results — __MARKABLE_COMMANDS__ is ${cmds === undefined ? "undefined" : cmds === null ? "null" : "empty[]"}. Restart app to apply main.ts changes.`;
    } else {
      empty.textContent = `No results — COMMANDS:${(cmds as any[]).length} PM:${pm ? "ok" : "missing"} HA:${ha ? "ok" : "missing"} | sc:${_settings.showCommands} sh:${_settings.showHeadings} sr:${_settings.showRecentFiles}`;
    }
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
// Module-level plugin state
// ---------------------------------------------------------------------------

// DOM references set once in onEnable; nulled in onDisable.
let _overlayEl: HTMLElement | null = null;
let _inputEl: HTMLInputElement | null = null;
let _resultsEl: HTMLElement | null = null;
let _api: MarkablePluginAPI | null = null;

// Per-open state.
let _allResults: CommandBarResult[] = [];
let _visibleResults: CommandBarResult[] = [];
let _selectedId: string | null = null;
let _isOpen = false;

// Plugin settings (loaded from API in onEnable).
let _settings: CommandBarSettings = { ...DEFAULT_SETTINGS };

// Last error from buildAllResults, shown in the empty state for diagnostics.
let _lastBuildError: string | null = null;

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
 * Filter and rank _allResults against the query, then re-render the results.
 * Called on every input event and after opening the bar.
 *
 * Empty query: show all results in natural order (FR-02.5, no fuzzy ranking).
 * Non-empty query: fuzzy-match each result, sort by tier then label, render.
 *
 * @param query - Trimmed input string.
 */
function filterAndRender(query: string): void {
  if (!_resultsEl || !_inputEl) return;

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
 * Open the Command Bar.
 *
 * - EC-05/FR-01.6: if already open, acts as a toggle and closes the bar.
 * - FR-03.A.2: rebuilds the full result set synchronously on every open.
 * - FR-01.3: focuses the input after open.
 * - FR-06.3: pre-selects the first non-dimmed result.
 */
function openBar(): void {
  if (!_overlayEl || !_inputEl || !_resultsEl) return;

  if (_isOpen) {
    closeBar();
    return;
  }

  _isOpen = true;
  openCommandBar(_overlayEl, _inputEl);

  // Rebuild results fresh on every open (EC-30: reflects current plugin states).
  // Wrapped in try-catch: if buildAllResults throws (e.g. a missing global or
  // unexpected API shape), the overlay still shows and renders an empty list
  // rather than leaving the results container blank with no feedback.
  _lastBuildError = null;
  try {
    _allResults = buildAllResults(_settings);
  } catch (err) {
    _lastBuildError = String(err);
    console.error("[CommandBar] buildAllResults failed:", err);
    _allResults = [];
  }
  _visibleResults = _allResults;
  _selectedId = firstSelectableId(_visibleResults);
  renderResults(_resultsEl, _visibleResults, "", _selectedId);
  updateAriaActiveDescendant(_inputEl, _selectedId);
  scrollSelectedIntoView(_resultsEl);

  // FR-01.3: use setTimeout(0) rather than requestAnimationFrame so focus lands
  // after the macOS/Tauri window system has finished processing the triggering
  // keystroke (Cmd-Shift-P). rAF fires within the same event-loop task; setTimeout
  // queues a new macrotask, giving the window time to settle before we focus.
  const inputRef = _inputEl;
  setTimeout(() => { inputRef.focus(); }, 0);
}

/**
 * Close the Command Bar and restore state.
 * Safe to call when bar is already closed (no-op via _isOpen guard).
 */
function closeBar(): void {
  if (!_overlayEl || !_inputEl || !_isOpen) return;
  _isOpen = false;
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
 */
function onInput(this: HTMLInputElement): void {
  filterAndRender(this.value.trim());
}

/**
 * Handle keydown events on the overlay (Escape, arrow keys, Enter, Tab).
 * All keys are consumed (preventDefault + stopPropagation) to implement the
 * focus trap (NFR-05, FR-06.4) and prevent bubbling to the CM6 editor.
 *
 * Tab = move selection down; Shift+Tab = move selection up (FR-06.4).
 */
function onOverlayKeydown(e: KeyboardEvent): void {
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
 * Creates three labeled checkboxes (showCommands, showHeadings, showRecentFiles)
 * using the standard plugin settings CSS classes for visual consistency.
 *
 * Why this function is justified at >30 lines:
 * This function must produce three semantically complete form rows in a single
 * pass, where each row requires: a wrapper div, a label wrapper div, a <label>
 * element (with htmlFor), a description <p> element, and an <input type=checkbox>
 * with a change handler that both mutates module-level `_settings` and persists
 * via `_api.saveSettings()`. Generating one row already takes ~10 lines of DOM
 * API calls. Three rows therefore mandate ~30 lines before even accounting for
 * the outer section element and title header. Abstracting "make one row" into a
 * helper would split the rendering contract across two functions for minimal gain
 * because the helper would still need to close over `_settings` and `_api`.
 *
 * @param container - Freshly created container element provided by the panel.
 */
export function renderDetailExtra(container: HTMLElement): void {
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
    {
      key: "showRecentFiles",
      label: "Show Recent Files",
      description: "Include recently opened files",
    },
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
    checkbox.checked = _settings[item.key];

    const settingKey = item.key; // captured in closure
    checkbox.addEventListener("change", () => {
      _settings[settingKey] = checkbox.checked;
      // FR-07.2: persist immediately so settings survive plugin reload.
      if (_api) void _api.saveSettings(_settings as unknown as Record<string, unknown>);
    });

    row.appendChild(labelWrap);
    row.appendChild(checkbox);
    section.appendChild(row);
  }

  container.appendChild(section);
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
      showCommands:    typeof saved.showCommands    === "boolean" ? (saved.showCommands    as boolean) : DEFAULT_SETTINGS.showCommands,
      showHeadings:    typeof saved.showHeadings    === "boolean" ? (saved.showHeadings    as boolean) : DEFAULT_SETTINGS.showHeadings,
      showRecentFiles: typeof saved.showRecentFiles === "boolean" ? (saved.showRecentFiles as boolean) : DEFAULT_SETTINGS.showRecentFiles,
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
    _overlayEl = buildOverlayDOM();
    _inputEl   = _overlayEl.querySelector<HTMLInputElement>(".cb-input")!;
    _resultsEl = _overlayEl.querySelector<HTMLElement>(".cb-results")!;

    attachListeners();
    document.body.appendChild(_overlayEl);

    // Register the open function so handleAction("command-bar-open") can call it.
    // AD-03 in 00_index.md.
    (window as any).__MARKABLE_COMMAND_BAR_OPEN__ = openBar;
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
    _overlayEl    = null;
    _inputEl      = null;
    _resultsEl    = null;
    _api          = null;
    _allResults   = [];
    _visibleResults = [];
    _selectedId   = null;
    _isOpen       = false;
    _settings         = { ...DEFAULT_SETTINGS };
    _lastBuildError   = null;
  },
};

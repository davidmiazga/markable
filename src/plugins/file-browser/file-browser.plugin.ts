/**
 * file-browser.plugin.ts
 *
 * IIFE plugin: File Browser sidebar panel for Markable 2.0.
 *
 * Registers a left-sidebar panel titled "Files" that shows:
 *   - A vault root node at depth 0 (vault name + icon).
 *   - A collapsible/expandable directory tree of the active vault's contents.
 *   - A search/filter input that switches to a flat filtered view when non-empty.
 *   - A "No vault" empty state with a "Manage Vaults" button.
 *   - An active-file highlight that updates on tab switch.
 *
 * This file implements Step 02a (read-only). No write operations are included.
 * File CRUD operations are added in Step 02b.
 *
 * Self-containment rules (IIFE constraints):
 *   - No app-internal imports at runtime — only type-only imports (erased by tsc).
 *   - All Tauri interaction goes through window.__TAURI_INTERNALS__.invoke.
 *   - Vault state is accessed via window.__MARKABLE_VAULT_MANAGER__.
 *   - Tab navigation uses window.__MARKABLE_TAB_MANAGER__.
 *   - Pure utility modules (file-tree.ts, vault-types.ts) are bundled inline
 *     by Rollup at build time so they are available in the IIFE scope.
 *
 * @module file-browser.plugin
 */

// Type-only imports — erased by tsc at compile time; safe for the IIFE context.
import type { MarkablePluginAPI } from "../markable-plugin-api";
import type { VaultEntry, VaultIndex, VaultFileChangedEvent } from "../../lib/vault-types";
import type { SidebarPanelDescriptor } from "../markable-plugin-api";

// Material Symbols icons — bundled inline by Rollup at build time.
import {
  ICON_VAULT,
  ICON_FOLDER,
  ICON_FOLDER_OPEN,
  ICON_FILE,
  ICON_FILE_MD,
  ICON_FILE_IMAGE,
  ICON_FILE_JSON,
  ICON_FILE_CODE,
  ICON_CHEVRON,
  ICON_UNMOUNT,
} from "./icons/material/index";

// Pure utility modules — bundled inline by Rollup (no window globals needed).
import {
  buildTreeFromIndex,
  sortNodes,
  filterTree,
  diffTree,
  type TreeNode,
} from "./file-tree";

import { mountManageVaultsPanel, showCreateVaultForm } from "./manage-vaults-ui";

// File operation helpers — bundled inline by Rollup.
import {
  createNote,
  renameNode,
  deleteFile,
  deleteDirectory,
  moveNode,
  validateFilename,
  getFileStem,
  getParentDir,
  getBasename,
  showInlineError,
} from "./file-browser-ops";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Unique identifier for this plugin. */
const PLUGIN_ID = "file-browser";

/** Unique identifier for the sidebar panel registered by this plugin. */
const PANEL_ID = "file-browser";

/** CSS style tag element ID (idempotent injection guard). */
const STYLE_ID = "__markable_file_browser_css__";

/** Debounce delay (ms) for the search input before filtering the tree. */
const SEARCH_DEBOUNCE_MS = 150;

/** Debounce delay (ms) for persisting expanded-paths settings after toggle. */
const SETTINGS_SAVE_DEBOUNCE_MS = 500;

// ── Inline CSS ────────────────────────────────────────────────────────────────

/*
 * The CSS is inlined here as a template literal so the IIFE is a single
 * self-contained file that does not depend on a runtime <link> tag.
 * This follows the same pattern as backlinks.plugin.ts's BACKLINKS_CSS constant.
 *
 * The full style rules live in file-browser.css for authoring; this string
 * is a verbatim copy injected at runtime via a <style id="..."> element.
 */
const FILE_BROWSER_CSS = `
.file-browser-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  font-family: var(--ui-font);
  font-size: 13px;
}
.file-browser-header {
  flex-shrink: 0;
}
.file-browser-header.has-search {
  border-bottom: 1px solid var(--border-color, rgba(128,128,128,.2));
}
.file-browser-search-row {
  padding: 6px 8px 6px;
}
.file-browser-search-row.hidden { display: none; }
.file-browser-search {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  background: var(--input-bg, var(--code-bg, rgba(0,0,0,.08)));
  border: 1px solid var(--input-border, var(--border-color, rgba(128,128,128,.25)));
  border-radius: 4px;
  font-family: var(--ui-font);
  font-size: 12px;
  color: var(--text-primary);
  outline: none;
}
.file-browser-search:focus {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 2px var(--accent-focus-ring, rgba(92,107,192,.15));
}
.file-tree {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
}
.tree-node {
  display: flex;
  align-items: center;
  height: 28px;
  cursor: pointer;
  padding-right: 8px;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  outline: none;
}
.tree-node:hover { background: var(--hover-bg, rgba(128,128,128,.08)); }
.tree-node:focus-visible { box-shadow: inset 0 0 0 1px var(--accent-color); }
.tree-node-active {
  background: var(--selection-bg, rgba(92,107,192,.15));
  box-shadow: inset 2px 0 0 var(--accent-color);
}
/* .tree-node-indent kept for DOM structure compatibility with inline-create inputs */
.tree-node-indent { display: none; }
.tree-node-icon {
  flex-shrink: 0;
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: .9;
}
.vault-icon svg, .folder-icon svg, .file-icon svg, .vault-row-unmount-btn svg { display: block; fill: currentColor; }
.tree-node-source-file { opacity: 0.5; }
.tree-node-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 3px;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 28px;
}
.tree-node-vault {
  font-weight: 600;
  height: 28px;
}
.tree-node-vault .tree-node-label { line-height: 28px; }

/* ── Hover-reveal unmount button on vault rows (step_02) ─────────────────── */
/*
 * OQ-VUX-02: The button must always be in layout at 12% opacity so the
 * affordance is discoverable on hover without a jarring layout shift.
 * Using opacity (not display:none) preserves the button's space in the row
 * and keeps pointer-events active for the transition to work correctly.
 */
.vault-row-unmount-btn {
  display: flex;           /* always in layout — never display:none */
  opacity: 0.12;           /* 12% resting state per OQ-VUX-02 */
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: auto;
  margin-right: 2px;
  background: none;
  border: none;
  border-radius: 3px;
  color: var(--text-secondary, rgba(128,128,128,.55));
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: opacity 0.12s ease, color 0.12s ease;
}
/* Row hover: reveal button to partial opacity, color stays neutral */
.tree-node-vault:hover .vault-row-unmount-btn,
.tree-node-vault:focus-visible .vault-row-unmount-btn {
  opacity: 0.5;
}
/* Button hover: full opacity + red danger color */
.vault-row-unmount-btn:hover {
  opacity: 1 !important;
  color: var(--error-color, #c0392b) !important;
}
.file-tree-card {
  margin: 6px 8px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--card-bg, rgba(128,128,128,.07));
}
.file-tree-card .file-tree {
  overflow-y: visible;
  overflow-x: visible;
  flex: none;
}
.file-browser-add-row {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  cursor: pointer;
  color: var(--text-secondary, rgba(128,128,128,.6));
  font-size: 12px;
  gap: 5px;
  user-select: none;
  border-radius: 0 0 6px 6px;
}
.file-browser-add-row:hover {
  background: var(--hover-bg, rgba(128,128,128,.08));
  color: var(--text-primary);
}
.tree-node-directory .tree-node-label { font-weight: 500; }
.tree-node-chevron {
  flex-shrink: 0;
  width: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, rgba(128,128,128,.55));
  transition: transform .12s ease;
}
.tree-node-chevron svg { fill: currentColor; display: block; }
.tree-node[aria-expanded="true"] .tree-node-chevron { transform: rotate(90deg); }
.file-browser-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  font-family: var(--ui-font);
  font-size: 12px;
  color: var(--muted-text, var(--text-secondary, rgba(128,128,128,.7)));
  text-align: center;
  gap: 10px;
}
.file-browser-empty p { margin: 0; }
.file-browser-empty button {
  margin-top: 4px;
  padding: 5px 12px;
  background: var(--accent-color);
  color: var(--btn-primary-text, #fff);
  border: none;
  border-radius: 4px;
  font-family: var(--ui-font);
  font-size: 12px;
  cursor: pointer;
}
.file-browser-empty button:hover { opacity: .85; }
.file-browser-cap-notice {
  padding: 4px 10px;
  font-family: var(--ui-font);
  font-size: 11px;
  color: var(--muted-text, var(--text-secondary));
  background: var(--hover-bg, rgba(128,128,128,.06));
  border-bottom: 1px solid var(--border-color, rgba(128,128,128,.15));
}

/* ── Context menu ──────────────────────────────────────────────────────────── */
.context-menu {
  position: fixed;
  z-index: 9999;
  list-style: none;
  padding: 4px 0;
  margin: 0;
  min-width: 160px;
  background: var(--menu-bg, var(--bg-primary, #fff));
  border: 1px solid var(--border-color, rgba(128,128,128,.25));
  border-radius: 6px;
  box-shadow: 0 4px 16px var(--shadow-color, rgba(0,0,0,.2));
  font-family: var(--ui-font);
  font-size: 13px;
}
.context-menu-item {
  padding: 6px 16px;
  cursor: pointer;
  color: var(--text-primary);
  white-space: nowrap;
}
.context-menu-item:hover { background: var(--hover-bg, rgba(128,128,128,.08)); }
.context-menu-item.disabled { opacity: .4; cursor: default; pointer-events: none; }
.context-menu-separator {
  height: 1px;
  background: var(--border-color, rgba(128,128,128,.15));
  margin: 4px 0;
}

/* ── Inline rename / create input ─────────────────────────────────────────── */
.tree-node-rename-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--input-bg, var(--code-bg, rgba(0,0,0,.08)));
  border: 1px solid var(--accent-color);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: var(--ui-font);
  font-size: 13px;
  color: var(--text-primary);
  outline: none;
}
.tree-node-inline-error {
  display: block;
  padding: 2px 8px;
  font-family: var(--ui-font);
  font-size: 11px;
  color: var(--error-color, #c0392b);
}

/* ── Drag-and-drop ─────────────────────────────────────────────────────────── */
.drag-over {
  background: var(--drag-target-bg, rgba(92,107,192,.1));
  outline: 1px dashed var(--accent-color);
}

/* Dim the node being dragged so the user has clear visual feedback (FR-2, FR-3). */
.is-dragging {
  opacity: 0.5;
}

/* ── Link-update banner ────────────────────────────────────────────────────── */
.file-browser-link-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 12px;
  background: var(--warning-bg, rgba(255,193,7,.15));
  border-bottom: 1px solid var(--border-color, rgba(128,128,128,.15));
  font-family: var(--ui-font);
  font-size: 12px;
  color: var(--text-primary);
}
.file-browser-link-banner-btn {
  padding: 2px 8px;
  background: var(--accent-color);
  color: var(--btn-primary-text, #fff);
  border: none;
  border-radius: 3px;
  font-family: var(--ui-font);
  font-size: 11px;
  cursor: pointer;
}
.file-browser-link-banner-dismiss {
  background: var(--hover-bg, rgba(128,128,128,.15));
  color: var(--text-secondary);
}

/* ── Inline error strip ────────────────────────────────────────────────────── */
.file-browser-inline-error {
  padding: 4px 12px;
  background: var(--error-bg, rgba(192,57,43,.1));
  border-bottom: 1px solid var(--error-color, #c0392b);
  font-family: var(--ui-font);
  font-size: 11px;
  color: var(--error-color, #c0392b);
}

/* ── Manage Vaults panel (inside .settings-body) ──────────────────────────── */
.vault-list-rows { display: flex; flex-direction: column; }
.vault-list-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: background 0.1s ease;
}
.vault-list-row:hover { background: var(--hover-bg, rgba(128,128,128,.08)); }
.vault-list-row.active {
  border-left-color: var(--link-color, var(--accent-color));
  background: var(--selection-bg, rgba(92,107,192,.08));
}
.vault-list-row-info { flex: 1; min-width: 0; }
.vault-list-row-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vault-list-row-paths {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.vault-list-row-meta { font-size: 11px; color: var(--text-secondary); white-space: nowrap; flex-shrink: 0; }
.vault-form { display: flex; flex-direction: column; }
.vault-form-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.vault-paths-list { display: flex; flex-direction: column; gap: 6px; }
.vault-path-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--code-bg, rgba(0,0,0,.04));
  border: 1px solid var(--border-color, rgba(128,128,128,.2));
  border-radius: 6px;
}
.vault-path-entry-text {
  flex: 1;
  font-size: 12px;
  font-family: var(--mono-font);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vault-path-entry-remove {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
}
.vault-path-entry-remove:hover { color: var(--error-color, #c0392b); background: var(--hover-bg, rgba(128,128,128,.08)); }
.vault-add-path-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  box-sizing: border-box;
  background: none;
  border: 1px dashed var(--border-color, rgba(128,128,128,.3));
  border-radius: 6px;
  padding: 7px 12px;
  font-family: var(--ui-font);
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.1s, color 0.1s;
}
.vault-add-path-btn:hover { border-color: var(--link-color); color: var(--link-color); }
.vault-overlap-warning {
  padding: 8px 12px;
  background: var(--warning-bg, rgba(255,193,7,.12));
  border: 1px solid var(--warning-border, rgba(255,193,7,.4));
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
}
.vault-performance-warning {
  padding: 6px 10px;
  background: var(--warning-bg, rgba(255,193,7,.12));
  border: 1px solid var(--warning-border, rgba(255,193,7,.4));
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-primary);
  margin-top: 6px;
}
.vault-inline-error { font-size: 11px; color: var(--error-color, #c0392b); margin-top: 4px; }
.vault-form-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-top: 16px;
  border-top: 1px solid var(--border-color, rgba(128,128,128,.15));
  margin-top: 8px;
}
.vault-form-actions .btn-danger { margin-left: auto; }
.vault-form-textarea { resize: vertical; min-height: 80px; }
.manage-vaults-empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}
.manage-vaults-empty p { margin: 0 0 12px; }
.manage-vaults-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

`;


// ── CSS injection / removal ───────────────────────────────────────────────────

/**
 * Inject the File Browser CSS into the document head.
 *
 * Guarded by STYLE_ID so repeated calls (e.g. from rapid enable/disable cycles)
 * never insert duplicate <style> tags.
 */
export function injectFileBrowserCSS(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = FILE_BROWSER_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the File Browser CSS from the document head.
 *
 * No-op when the tag is not present (e.g. onDisable called before onEnable,
 * or running in a test environment without a real document).
 */
export function removeFileBrowserCSS(): void {
  if (typeof document === "undefined") return;
  document.getElementById(STYLE_ID)?.remove();
}

// ── Module-level state ────────────────────────────────────────────────────────

/** Whether the plugin is currently enabled (guards all async callbacks). */
let _enabled = false;

/** The panel container element (null when the panel is not mounted). */
let _panelContainer: HTMLElement | null = null;

/** The <ul class="file-tree"> element inside the panel (null when unmounted). */
let _treeEl: HTMLElement | null = null;

/** The search input element (null when unmounted). Exposed via _testing.getSearchEl(). */
let _searchEl: HTMLInputElement | null = null;

/** The current search query string (empty string = no filter active). */
let _searchQuery = "";

/** Whether the search row is currently expanded. */
let _searchVisible = false;

/** Reference to the header-action search toggle button (in the sidebar title bar). */
let _searchToggleBtn: HTMLButtonElement | null = null;

/**
 * The currently rendered tree nodes.
 *
 * Kept in module state so the incremental update path (onIndexUpdated) can call
 * diffTree against the previous render without re-building from scratch.
 */
let _currentTree: TreeNode[] = [];

/**
 * Whether the panel is in "loading" state (awaiting index build).
 *
 * When true, the panel shows a loading spinner instead of the tree.
 */
let _isLoading = false;

/**
 * Debounce timer handle for the search input.
 * Cleared and reset on each input event; fires after SEARCH_DEBOUNCE_MS.
 */
let _searchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounce timer handle for settings persistence after expand/collapse.
 * Cleared and reset each time the user toggles a directory's expanded state.
 */
let _settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Expanded directory paths for the currently active vault.
 *
 * Persisted to plugin settings on a debounced schedule whenever the user
 * expands or collapses a directory. Keyed by vault ID so each vault's state
 * is preserved independently.
 */
let _expandedPaths: Set<string> = new Set();

/**
 * Cached plugin API reference so we can call saveSettings from event handlers
 * without threading the api object through every function call.
 */
let _api: MarkablePluginAPI | null = null;

/** The vault-changed callback ref, stored so it can be removed in onDisable. */
let _vaultChangedCb: ((vault: VaultEntry | null) => void) | null = null;

/** The index-updated callback ref, stored so it can be removed in onDisable. */
let _indexUpdatedCb: ((event: VaultFileChangedEvent) => void) | null = null;

/** Window event listener for tab-changed events, stored for cleanup. */
let _tabChangedListener: ((e: Event) => void) | null = null;

/** Interval timer for polling tab change when custom event is unavailable. */
let _pollTimer: ReturnType<typeof setInterval> | null = null;

/** The last known file path from __MARKABLE_CURRENT_FILE__ for tab-change detection. */
let _lastKnownFile: string | null = null;

/**
 * The currently visible context menu element, or null.
 *
 * Kept in module state so the "click outside" dismissal handler can find and
 * remove it without needing to query the DOM.
 */
let _contextMenu: HTMLElement | null = null;

/** Document-level click listener for dismissing the context menu on outside click. */
let _contextMenuDismiss: ((e: MouseEvent) => void) | null = null;

/**
 * Document-level keydown listener that closes the context menu on Escape.
 *
 * Stored at module level (not as a local variable inside showContextMenu) so
 * closeContextMenu() can always remove it regardless of which code path
 * triggered the close. Without this, every showContextMenu() call that is
 * closed via a path other than Escape leaks one keydown listener — Finding 4.
 */
let _contextMenuEscHandler: ((e: KeyboardEvent) => void) | null = null;

/** Unsubscribe function returned by vault-file-changed Tauri event listener. */
let _fsUnlisten: (() => void) | null = null;

/** Debounce timer for FS watcher events — fires after 300ms of silence. */
let _fsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The absolute path of the folder currently selected/highlighted in the
 * file browser. Updated when the user single-clicks a directory node or
 * right-clicks a directory node (context menu target).
 *
 * null when no folder is selected or when only files are selected.
 *
 * Exposed via window.__MARKABLE_FILE_BROWSER__.getSelectedFolderPath()
 * so the find widget can read it without a direct import dependency.
 * This follows the pull model: the find widget reads synchronously at search
 * time rather than caching an event-delivered value.
 */
let _selectedFolderPath: string | null = null;

/**
 * Tracks the path of the node currently being dragged within the tree.
 * Set on dragstart, cleared on dragend. Used instead of dataTransfer.types
 * in the dragover handler because WKWebView (Tauri/macOS) does not always
 * expose custom MIME types in dataTransfer.types during dragover, which
 * prevents preventDefault() from being called and blocks the drop event.
 */
let _activeDragPath: string | null = null;

// ── Settings persistence ──────────────────────────────────────────────────────

/**
 * Settings shape persisted to disk via api.saveSettings().
 *
 * expandedPaths maps each vault ID to an array of expanded directory paths,
 * preserving the user's open/close state across panel open/close cycles.
 */
interface FileBrowserSettings {
  expandedPaths: Record<string, string[]>;
}

/**
 * Load plugin settings from disk and populate _expandedPaths for the given vault.
 *
 * Called during onEnable and when the active vault changes. Falls back to an
 * empty set when no saved settings exist (first run).
 *
 * @param vaultId - The vault ID whose expanded paths to restore.
 */
async function loadExpandedPaths(vaultId: string): Promise<void> {
  if (!_api) return;
  try {
    const saved = await _api.loadSettings() as FileBrowserSettings | null;
    const paths = saved?.expandedPaths?.[vaultId] ?? [];
    _expandedPaths = new Set(paths);
  } catch {
    _expandedPaths = new Set();
  }
}

/**
 * Persist the current _expandedPaths set to disk (debounced).
 *
 * Each call resets the debounce timer so rapid expand/collapse interactions
 * produce only one disk write when the user pauses.
 *
 * @param vaultId - The vault ID whose paths are being saved.
 */
function scheduleSettingsSave(vaultId: string): void {
  if (_settingsSaveTimer !== null) {
    clearTimeout(_settingsSaveTimer);
  }

  _settingsSaveTimer = setTimeout(async () => {
    if (!_api || !_enabled) return;
    try {
      const existing = (await _api.loadSettings()) as FileBrowserSettings | null;
      const expandedPaths = existing?.expandedPaths ?? {};
      expandedPaths[vaultId] = Array.from(_expandedPaths);
      await _api.saveSettings({ expandedPaths });
    } catch {
      /* Save failure is non-critical — expanded state is in-memory until next open. */
    }
  }, SETTINGS_SAVE_DEBOUNCE_MS);
}

// ── Manage Vaults modal ───────────────────────────────────────────────────────

/**
 * Build the full-screen overlay element using the settings-panel shell classes.
 *
 * Uses .settings-overlay (position:fixed, flex centering) and .settings-backdrop
 * (semi-transparent scrim). The backdrop click dismisses the modal.
 *
 * Extracted from openManageVaultsModal to keep each helper ≤30 lines.
 *
 * @returns The configured overlay <div> element.
 */
function buildModalOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.id = "__fb_manage_vaults_overlay__";
  overlay.className = "settings-overlay";
  overlay.style.zIndex = "9999";
  const backdrop = document.createElement("div");
  backdrop.className = "settings-backdrop";
  backdrop.addEventListener("click", () => overlay.remove());
  overlay.appendChild(backdrop);
  return overlay;
}

/**
 * Build the .settings-panel modal shell with a themed header and scrollable body.
 *
 * Appends the modal to the overlay and returns the .settings-body div where
 * the ManageVaults panel content should be mounted.
 *
 * Extracted from openManageVaultsModal to keep each helper ≤30 lines.
 *
 * @param overlay - The backdrop overlay element (modal is appended to it).
 * @returns The .settings-body div — pass this to mountManageVaultsPanel.
 */
function buildModalContent(overlay: HTMLDivElement): HTMLDivElement {
  const modal = document.createElement("div");
  modal.className = "settings-panel";
  modal.style.cssText = "width:520px;max-width:90vw";

  const header = document.createElement("div");
  header.className = "settings-header";
  const title = document.createElement("h2");
  title.className = "settings-title";
  title.textContent = "Manage Vaults";
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.className = "settings-close-btn";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "settings-body";
  modal.appendChild(body);

  overlay.appendChild(modal);
  return body;
}

/**
 * Open the Manage Vaults UI as a modal overlay.
 *
 * Creates a full-screen overlay div, appends it to document.body, and
 * mounts the ManageVaults panel inside it. A close button and backdrop
 * click both dismiss the overlay. The manage-vaults-ui module is bundled
 * inline by Rollup.
 *
 * When `selectedVaultId` is provided, the modal opens directly on the edit
 * form for that vault (MEDIUM-4: "Edit Vault…" context menu fix).
 *
 * @param selectedVaultId - Optional vault ID to pre-select for editing.
 */
function openManageVaultsModal(selectedVaultId?: string): void {
  /* Guard against double-opening */
  if (document.getElementById("__fb_manage_vaults_overlay__")) return;

  const overlay = buildModalOverlay();
  const body = buildModalContent(overlay);
  mountManageVaultsPanel(body, selectedVaultId, () => overlay.remove());

  document.body.appendChild(overlay);
}

/**
 * Open the Manage Vaults UI pre-navigated to the Create Vault form.
 *
 * Replaces direct calls to openManageVaultsModal() from "New Vault" entry
 * points so the user lands on the create form immediately — not the vault
 * list — decoupling the two actions (step_01).
 *
 * The double-open guard from openManageVaultsModal() is replicated here so
 * calling openNewVaultModal() twice does not produce two overlays (EC-VUX-07).
 */
function openNewVaultModal(): void {
  if (document.getElementById("__fb_manage_vaults_overlay__")) return;

  const overlay = buildModalOverlay();
  const body = buildModalContent(overlay);
  mountManageVaultsPanel(body, undefined, () => overlay.remove());
  /*
   * Attach the overlay to the DOM *before* calling showCreateVaultForm()
   * so that any internal DOM queries inside showCreateVaultForm() (e.g.
   * querying the modal body for an active input to focus) find the element
   * already attached. Order matters: mount → append → navigate.
   */
  document.body.appendChild(overlay);
  /* Skip the list view: navigate directly to the create form (step_01) */
  showCreateVaultForm();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

// ── Icon system ───────────────────────────────────────────────────────────────

/**
 * IconSet interface — the single extension point for icon themes.
 *
 * All three methods receive contextual arguments so future implementations
 * can return different SVG strings based on file extension, folder name,
 * or expanded state without any changes to the call sites.
 *
 * To add a new icon theme:
 *   1. Create an object that satisfies this interface.
 *   2. Call setIconSet(myIconSet) before or after plugin enable.
 *   3. Call renderPanel() to repaint.
 */
interface IconSet {
  /** SVG string for the vault root node. */
  vault(): string;
  /**
   * SVG string for a directory node.
   * @param _name     - Directory basename (for named-folder overrides later).
   * @param _expanded - Whether the directory is currently open.
   */
  folder(_name: string, _expanded: boolean): string;
  /**
   * SVG string for a file node.
   * @param _name - Full filename including extension (for ext overrides later).
   */
  file(_name: string): string;
}

/**
 * Inject width/height into a Material Symbols SVG string.
 * The fetched SVGs have no width/height attributes (stripped by fetch script)
 * so we add them here for consistent 16×16 rendering.
 */
function wrapSvg(svg: string, size: number): string {
  return svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
}

/** Map a filename extension to the appropriate Material Symbol icon string. */
function fileIconFor(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (ext === "md" || ext === "markdown") return ICON_FILE_MD;
  if (ext === "png" || ext === "jpg" || ext === "jpeg" ||
      ext === "gif" || ext === "webp" || ext === "svg" ||
      ext === "ico" || ext === "bmp" || ext === "tiff") return ICON_FILE_IMAGE;
  if (ext === "json" || ext === "jsonc") return ICON_FILE_JSON;
  if (ext === "yaml" || ext === "yml" || ext === "toml" ||
      ext === "env"  || ext === "ini"  || ext === "cfg") return ICON_FILE_CODE;
  return ICON_FILE;
}

/**
 * Built-in icon set using Google Material Symbols Outlined (Apache 2.0).
 * Icons are inlined at build time — no runtime network calls.
 */
const OUTLINE_ICONS: IconSet = {
  vault:  ()           => wrapSvg(ICON_VAULT, 16),
  folder: (_n, exp)    => wrapSvg(exp ? ICON_FOLDER_OPEN : ICON_FOLDER, 16),
  file:   (name)       => wrapSvg(fileIconFor(name), 16),
};

/** Active icon set. Replace via setIconSet() to switch themes. */
let _iconSet: IconSet = OUTLINE_ICONS;

/**
 * Swap the active icon set and repaint the panel.
 *
 * @param set - Any object satisfying the IconSet interface.
 */
export function setIconSet(set: IconSet): void {
  _iconSet = set;
  if (_enabled) renderPanel();
}

// ── Node rendering ─────────────────────────────────────────────────────────────

/**
 * Build and append the chevron, icon, and label spans to a node <li>.
 *
 * Uses _iconSet so the icon source is swappable without touching this function.
 */
function appendIconAndLabel(li: HTMLElement, node: TreeNode): void {
  /* VSCode-style: depth * 16px padding-left, then [chevron][icon][label] */
  li.style.paddingLeft = `${node.depth * 16}px`;

  /* Chevron — present for vault/directory, empty spacer for files */
  const chevron = document.createElement("span");
  chevron.className = "tree-node-chevron";
  if (node.type === "vault" || node.type === "directory") {
    chevron.innerHTML = wrapSvg(ICON_CHEVRON, 14);
  }
  li.appendChild(chevron);

  /* Icon — resolved through the active icon set */
  const icon = document.createElement("span");
  icon.className = `tree-node-icon ${
    node.type === "vault" ? "vault-icon" :
    node.type === "directory" ? "folder-icon" : "file-icon"
  }`;
  if (node.type === "vault") {
    icon.innerHTML = _iconSet.vault();
  } else if (node.type === "directory") {
    icon.innerHTML = _iconSet.folder(node.name, node.expanded);
  } else {
    icon.innerHTML = _iconSet.file(node.name);
  }
  li.appendChild(icon);

  /* Label */
  const label = document.createElement("span");
  label.className = "tree-node-label";
  label.textContent = node.type === "file" && node.path.toLowerCase().endsWith(".md")
    ? node.name + ".md"
    : node.name;
  label.title = node.path;
  li.appendChild(label);
}

/**
 * Build a single tree node <li> element for the given TreeNode.
 *
 * The element structure follows the spec:
 *   <li class="tree-node tree-node-{type}" data-path="..." [aria-expanded="true/false"]>
 *     <span class="tree-node-indent" style="--depth: N"></span>
 *     <span class="tree-node-icon {iconClass}"></span>
 *     <span class="tree-node-label">{name}</span>
 *     [<span class="tree-node-chevron">▶</span>]   (directories and vaults only)
 *   </li>
 *
 * @param node       - The TreeNode to render.
 * @param activeFile - The currently open file path (for .tree-node-active class).
 * @returns The rendered <li> element.
 */
function buildNodeEl(node: TreeNode, activeFile: string | null): HTMLElement {
  const li = document.createElement("li");
  li.className = `tree-node tree-node-${node.type}`;
  li.setAttribute("data-path", node.path);
  li.setAttribute("data-type", node.type);
  li.tabIndex = 0;

  appendIconAndLabel(li, node);

  /* aria-expanded for CSS chevron rotation */
  if (node.type === "vault" || node.type === "directory") {
    li.setAttribute("aria-expanded", node.expanded ? "true" : "false");
  }

  /*
   * Vault rows: append a hover-reveal unmount button (step_02).
   * Using display:none as base means it consumes no space and intercepts no
   * pointer events when invisible. The click handler is wired in
   * attachVaultUnmountListener() (called from attachNodeListeners) so all event
   * wiring stays in one place.
   */
  if (node.type === "vault") {
    const unmountBtn = document.createElement("button");
    unmountBtn.className = "vault-row-unmount-btn";
    unmountBtn.setAttribute("aria-label", `Unmount vault ${node.name}`);
    unmountBtn.setAttribute("title", "Unmount vault");
    /* Render the chip_extraction icon at 16×16 */
    unmountBtn.innerHTML = wrapSvg(ICON_UNMOUNT, 16);
    li.appendChild(unmountBtn);
  }

  /* Active file highlight — open tab (markdown). */
  if (
    node.type === "file" &&
    (activeFile && node.path === activeFile)
  ) {
    li.classList.add("tree-node-active");
  }

  /* Source-file dimming: binary/media assets (images, PDFs, etc.) are
     view-only — dim them to 50% to signal they open in the media viewer. */
  const lp = node.path.toLowerCase();
  if (node.type === "file" && !lp.endsWith(".md") && !lp.endsWith(".txt")) {
    li.classList.add("tree-node-source-file");
  }

  if (node.vaultId) {
    li.setAttribute("data-vault-id", node.vaultId);
  }

  return li;
}

/**
 * Recursively render a flat list of <li> elements from a tree of TreeNodes.
 *
 * All nodes are always added to the DOM so that toggleDirectoryNode can show
 * and hide them via display:none without needing a full re-render. Children
 * of collapsed directories start hidden (display:none); children of expanded
 * directories start visible. The hidden flag propagates down — once a parent
 * is hidden, all descendants start hidden regardless of their own expanded state.
 *
 * The search-filtered view passes a flat list of file nodes — in that case all
 * nodes are visible (hidden = false, the default).
 *
 * @param nodes      - The nodes to render (may be filtered).
 * @param activeFile - Currently open file path for highlight detection.
 * @param out        - Accumulator array mutated by this function.
 * @param hidden     - Whether to start this node hidden (parent is collapsed).
 */
function renderNodes(
  nodes: TreeNode[],
  activeFile: string | null,
  out: HTMLElement[],
  hidden = false,
): void {
  for (const node of nodes) {
    const el = buildNodeEl(node, activeFile);
    if (hidden) el.style.display = "none";
    out.push(el);

    if (node.children.length > 0) {
      /* Children are hidden when this directory is collapsed or when the parent
         was already hidden. Vault nodes are always expanded (expanded: true). */
      const childHidden = hidden || (node.type === "directory" && !node.expanded);
      renderNodes(node.children, activeFile, out, childHidden);
    }
  }
}

// ── Search toggle helpers ─────────────────────────────────────────────────────

/**
 * Update the active state of the header-action search toggle button.
 * Called after query changes so the button reflects whether search is in use.
 */
function _updateSearchToggleState(): void {
  if (_searchToggleBtn) {
    _searchToggleBtn.classList.toggle("active", _searchVisible || !!_searchQuery);
  }
}

/**
 * Toggle the search row open/closed. Called by the headerAction onClick.
 * Keeps _searchVisible in sync, shows/hides the DOM row, and clears the
 * query when closing.
 */
function toggleSearch(): void {
  _searchVisible = !_searchVisible;
  _updateSearchToggleState();

  /* Find the search row inside the current panel render */
  const row = _panelContainer?.querySelector<HTMLElement>(".file-browser-search-row");
  const header = _panelContainer?.querySelector<HTMLElement>(".file-browser-header");
  if (!row || !header) return;

  if (_searchVisible) {
    row.classList.remove("hidden");
    header.classList.add("has-search");
    _searchEl?.focus();
  } else {
    row.classList.add("hidden");
    header.classList.remove("has-search");
    if (_searchQuery) {
      _searchQuery = "";
      if (_searchEl) _searchEl.value = "";
      _updateSearchToggleState();
      const wrapper = _panelContainer?.querySelector<HTMLElement>(".file-browser-panel");
      if (wrapper) renderTreeContent(wrapper);
    }
  }
}

// ── Panel rendering ───────────────────────────────────────────────────────────

/**
 * Render the full panel into _panelContainer.
 *
 * Clears the container and rebuilds from scratch. This is the "full render"
 * path, triggered by vault change and panel open. The incremental path
 * (renderIncremental) is used when only a single file changes.
 *
 * This function reads all state from module-level variables so it can be
 * called from multiple paths without parameter threading.
 */
export function renderPanel(): void {
  if (!_panelContainer) return;
  _panelContainer.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "file-browser-panel";

  /* ── Header: collapsible search row (shown when _searchVisible is true) ── */
  const header = document.createElement("div");
  header.className = "file-browser-header" + (_searchVisible ? " has-search" : "");

  /* Search input row */
  const searchRow = document.createElement("div");
  searchRow.className = "file-browser-search-row" + (_searchVisible ? "" : " hidden");

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "file-browser-search";
  searchInput.placeholder = "Search files…";
  searchInput.value = _searchQuery;
  searchInput.setAttribute("aria-label", "Filter files");

  searchInput.addEventListener("input", () => {
    if (_searchTimer !== null) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      _searchQuery = searchInput.value;
      _updateSearchToggleState();
      renderTreeContent(wrapper);
    }, SEARCH_DEBOUNCE_MS);
  });

  searchRow.appendChild(searchInput);
  header.appendChild(searchRow);
  wrapper.appendChild(header);
  _searchEl = searchInput;

  if (_searchVisible) setTimeout(() => searchInput.focus(), 0);

  renderTreeContent(wrapper);

  _panelContainer.appendChild(wrapper);
}

/**
 * Build and append the index-capped notice bar to the wrapper when needed.
 *
 * Extracted from renderTreeContent to keep that function ≤30 lines.
 * The notice is only rendered when VaultIndex.capped is true (EC-08).
 *
 * @param wrapper     - The panel wrapper to append the notice into.
 * @param vaultIndex  - The current vault index (used for entry counts).
 */
function buildCapNotice(wrapper: HTMLElement, vaultIndex: VaultIndex): void {
  const notice = document.createElement("div");
  notice.className = "file-browser-cap-notice";
  notice.textContent =
    `Showing ${vaultIndex.entries.length} of ${vaultIndex.totalFilesFound} notes. ` +
    `Increase the index limit in Vault Settings.`;
  wrapper.appendChild(notice);
}

/**
 * Build the file tree <ul> from displayNodes and append it to wrapper.
 *
 * Extracted from renderTreeContent to keep that function ≤30 lines.
 * Sets the module-level _treeEl reference so keyboard nav and highlight
 * update functions can find the list without re-querying the DOM.
 *
 * @param wrapper       - The panel wrapper to append the <ul> into.
 * @param displayNodes  - Pre-filtered/sorted tree nodes to render.
 * @param activeFile    - Currently open file path for active highlighting.
 * @param vaultId       - The active vault's ID for listener context.
 */
function buildTreeUl(
  wrapper: HTMLElement,
  displayNodes: TreeNode[],
  activeFile: string | null,
  vaultId: string,
): void {
  const card = document.createElement("div");
  card.className = "file-tree-card";

  const ul = document.createElement("ul");
  ul.className = "file-tree";
  ul.setAttribute("role", "tree");
  _treeEl = ul;

  const nodeEls: HTMLElement[] = [];
  renderNodes(displayNodes, activeFile, nodeEls);
  for (const el of nodeEls) {
    ul.appendChild(el);
    attachNodeListeners(el, vaultId);
  }

  card.appendChild(ul);
  card.appendChild(buildAddRow(vaultId));

  card.addEventListener("contextmenu", (e: MouseEvent) => {
    if ((e.target as Element).closest(".tree-node")) return;
    e.preventDefault();
    const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
    const rootPath: string = vaultManager?.getActiveVault?.()?.rootPaths?.[0] ?? "";
    const container = _panelContainer;
    if (!rootPath || !container) return;
    showContextMenu([
      { label: "New File", handler: () => showInlineCreateInput(rootPath, container, vaultId) },
      { label: "New Folder", handler: () => showInlineFolderCreateInput(rootPath, container, vaultId) },
    ], e.clientX, e.clientY);
  });

  wrapper.appendChild(card);
}

/**
 * Build the "+ Add…" row appended at the bottom of the file-tree card.
 *
 * Clicking shows a context menu with New File / New Folder / New Vault.
 *
 * @param vaultId - Active vault ID used for inline-create context.
 */
function buildAddRow(vaultId: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "file-browser-add-row";
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", "Add…");
  row.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Add…</span>`;

  row.addEventListener("click", (e) => {
    const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
    const activeVault = vaultManager?.getActiveVault?.();
    const rootPath: string = activeVault?.rootPaths?.[0] ?? "";
    const container = _panelContainer;

    showContextMenu(
      [
        {
          label: "New File",
          handler: () => {
            if (!container || !rootPath) return;
            showInlineCreateInput(rootPath, container, vaultId);
          },
        },
        {
          label: "New Folder",
          handler: () => {
            if (!container || !rootPath) return;
            showInlineFolderCreateInput(rootPath, container, vaultId);
          },
        },
        { separator: true, label: "", handler: null },
        {
          label: "New Vault…",
          /* step_01: open create form directly, bypassing the vault list */
          handler: () => openNewVaultModal(),
        },
      ],
      e.clientX,
      e.clientY,
    );
  });

  return row;
}

/**
 * Render (or re-render) only the tree content area inside the panel wrapper.
 *
 * Called by renderPanel (initial) and by the search debounce handler
 * (filter updates). Does NOT touch the header/search input.
 *
 * Length justification: this function is the central dispatch point for all
 * tree content rendering states (no-vault, loading, no-files, capped, search,
 * and the normal tree path). Each branch delegates to a dedicated helper
 * (buildCapNotice, buildTreeUl, renderEmptyState, renderLoadingState), but the
 * branching logic itself cannot be split further without threading the vault and
 * index values through multiple call sites — which would obscure the intent
 * rather than clarify it. All extracted helpers are ≤30 lines (Step 02a review
 * accepted this as Low-priority because the helper extractions were already
 * maximally applied).
 *
 * @param wrapper - The .file-browser-panel div to update.
 */
function renderTreeContent(wrapper: HTMLElement): void {
  /* Remove any existing tree card / empty-state / loading / cap-notice content */
  wrapper.querySelector(".file-tree-card, .file-browser-empty, .file-browser-loading")?.remove();
  wrapper.querySelector(".file-browser-cap-notice")?.remove();

  const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
  const activeVault: VaultEntry | null = vaultManager?.getActiveVault?.() ?? null;

  if (!activeVault) { renderEmptyState(wrapper, "no-vault"); return; }
  if (_isLoading)   { renderLoadingState(wrapper); return; }

  const vaultIndex = vaultManager?.getVaultIndex?.() as VaultIndex | null;

  const hasContent =
    vaultIndex &&
    (vaultIndex.entries.length > 0 ||
      (vaultIndex.nonMdFiles?.length ?? 0) > 0 ||
      (vaultIndex.directories?.length ?? 0) > 0);
  if (!hasContent) {
    renderEmptyState(wrapper, "no-files");
    return;
  }

  if (vaultIndex.capped) buildCapNotice(wrapper, vaultIndex);

  /* Merge .md entries with non-Markdown files (images, PDFs, etc.) so the
     tree reflects the vault's full contents, not just notes. */
  const allEntries = [
    ...vaultIndex.entries,
    ...(vaultIndex.nonMdFiles ?? []).map((f) => ({
      path: f.path,
      name: f.name,
      title: f.name,
      outboundLinks: [] as string[],
      tags: [] as string[],
      modified: 0,
      size: 0,
    })),
  ];

  /* Build, sort, and cache the tree */
  const tree = buildTreeFromIndex(
    allEntries,
    activeVault.rootPaths,
    _expandedPaths,
    activeVault,
    vaultIndex.directories,
  );
  sortNodes(tree);
  _currentTree = tree;

  /* Apply search filter (returns original tree reference when query is empty) */
  const displayNodes = _searchQuery.trim() ? filterTree(tree, _searchQuery) : tree;

  if (_searchQuery.trim() && displayNodes.length === 0) {
    renderEmptyState(wrapper, "no-search-results");
    return;
  }

  const activeFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  buildTreeUl(wrapper, displayNodes, activeFile, activeVault.id);
}

/**
 * Render an empty-state message into the panel wrapper.
 *
 * Three variants:
 *   "no-vault"         — no active vault configured yet.
 *   "no-files"         — vault configured but has no indexed files.
 *   "no-search-results" — search produced no matches.
 *
 * @param wrapper  - The .file-browser-panel div to append the empty state into.
 * @param variant  - Which empty state message to display.
 */
function renderEmptyState(
  wrapper: HTMLElement,
  variant: "no-vault" | "no-files" | "no-search-results",
): void {
  const div = document.createElement("div");
  div.className = "file-browser-empty";

  if (variant === "no-vault") {
    const p = document.createElement("p");
    p.textContent = "Create your first vault to get started.";
    div.appendChild(p);

    const btn = document.createElement("button");
    btn.textContent = "New Vault";
    /* step_01: open create form directly (EC-VUX-07) */
    btn.addEventListener("click", () => openNewVaultModal());
    div.appendChild(btn);
  } else if (variant === "no-files") {
    const p = document.createElement("p");
    p.textContent = "No notes yet. Click the + button to create your first note.";
    div.appendChild(p);
  } else {
    /* no-search-results */
    const p = document.createElement("p");
    const em = document.createElement("em");
    em.textContent = _searchQuery;
    p.appendChild(document.createTextNode("No notes match '"));
    p.appendChild(em);
    p.appendChild(document.createTextNode("'."));
    div.appendChild(p);
  }

  wrapper.appendChild(div);
}

/**
 * Render a "Loading…" placeholder while the vault index is being built.
 *
 * @param wrapper - The .file-browser-panel div to append the loading state into.
 */
function renderLoadingState(wrapper: HTMLElement): void {
  const div = document.createElement("div");
  div.className = "file-browser-empty file-browser-loading";
  const p = document.createElement("p");
  p.textContent = "Loading…";
  div.appendChild(p);
  wrapper.appendChild(div);
}

// ── Node event listeners ──────────────────────────────────────────────────────

/**
 * Build the activate handler (click / Enter) for a tree node.
 *
 * Extracted from attachNodeListeners to keep each function ≤30 lines.
 * Routes activation to the appropriate action based on the node type:
 *   file      → open in tab manager
 *   vault     → switch vault (no-op when already active)
 *   directory → toggle expand/collapse
 *
 * @param el      - The <li> element being activated.
 * @param vaultId - Active vault ID for directory toggle persistence.
 * @returns The event handler function.
 */
function buildActivateHandler(el: HTMLElement, vaultId: string): (e: Event) => void {
  return (e: Event): void => {
    e.stopPropagation();
    const type = el.getAttribute("data-type") as "vault" | "directory" | "file" | null;
    const path = el.getAttribute("data-path") ?? "";

    if (type === "file") {
      const lpath = path.toLowerCase();
      if (lpath.endsWith(".md") || lpath.endsWith(".txt")) {
        /* Text files (.md, .txt): open in editor tab. */
        void (window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(path);
      } else {
        /* Non-text assets (images, PDFs, etc.): open in the media viewer. */
        void (window as any).__MARKABLE_TAB_MANAGER__?.openMediaInTab?.(path);
      }
      /*
       * File node activated: clear folder selection. The find widget's
       * "Folder" scope option will hide itself when getSelectedFolderPath()
       * returns null (EC-5).
       */
      _selectedFolderPath = null;
      window.dispatchEvent(
        new CustomEvent("markable-folder-selected", { detail: { path: null } })
      );
    } else if (type === "vault") {
      const nodeVaultId = el.getAttribute("data-vault-id") ?? "";
      const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
      const active: VaultEntry | null = vm?.getActiveVault?.() ?? null;
      if (active?.id === nodeVaultId) {
        /* Already-active vault: toggle expand/collapse like a directory. */
        toggleDirectoryNode(el, path, vaultId);
      } else {
        /* Inactive vault: switch to it (vault-manager fires onVaultChanged → re-render). */
        void vm?.switchVault?.(nodeVaultId);
      }
      /*
       * Vault root node activated: treat as a directory for folder scope
       * purposes. The vault root is a valid scope for "Folder" search.
       */
      _selectedFolderPath = path;
      window.dispatchEvent(
        new CustomEvent("markable-folder-selected", { detail: { path } })
      );
    } else if (type === "directory") {
      toggleDirectoryNode(el, path, vaultId);
      /*
       * Directory node activated: update folder selection so the find widget
       * can offer a "Folder" scope option scoped to this directory.
       */
      _selectedFolderPath = path;
      window.dispatchEvent(
        new CustomEvent("markable-folder-selected", { detail: { path } })
      );
    }
  };
}

/**
 * Attach keyboard arrow-key and Enter handlers to a tree node <li>.
 *
 * Extracted from attachNodeListeners to keep each function ≤30 lines.
 * ArrowRight/Left expand and collapse directory nodes.
 * ArrowDown/Up move focus along the visible node list.
 *
 * @param el           - The <li> element to wire up.
 * @param vaultId      - Active vault ID for directory toggle persistence.
 * @param onActivate   - The activate handler (Enter delegates to this).
 */
function attachKeyboardHandler(
  el: HTMLElement,
  vaultId: string,
  onActivate: (e: Event) => void,
): void {
  el.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { onActivate(e); return; }
    const type = el.getAttribute("data-type");
    const path = el.getAttribute("data-path") ?? "";
    if (e.key === "ArrowRight" && (type === "directory" || type === "vault") && el.getAttribute("aria-expanded") === "false") {
      toggleDirectoryNode(el, path, vaultId);
    }
    if (e.key === "ArrowLeft" && (type === "directory" || type === "vault") && el.getAttribute("aria-expanded") === "true") {
      toggleDirectoryNode(el, path, vaultId);
    }
    if (e.key === "ArrowDown") { e.preventDefault(); focusAdjacentNode(el, "next"); }
    if (e.key === "ArrowUp")   { e.preventDefault(); focusAdjacentNode(el, "prev"); }
  });
}

/**
 * Wire the unmount button click handler for a vault row.
 *
 * Extracted from attachNodeListeners so all vault-specific event wiring lives
 * in a single helper (≤30 lines rule).
 *
 * Behaviour (OQ-VUX-01 resolution):
 *   - Active vault: shows a native window.confirm() before deleting.
 *   - Inactive vault: silent unmount with no dialog (EC-VUX-02).
 *   - stopPropagation() prevents the vault-switch activate handler from firing
 *     (AC-5, EC-VUX-06 note: context-menu's outside-click dismissal handles
 *     the menu itself naturally since the click still reaches document).
 *
 * @param el - The vault <li> element that contains the unmount button.
 */
function attachVaultUnmountListener(el: HTMLElement): void {
  const btn = el.querySelector<HTMLButtonElement>(".vault-row-unmount-btn");
  if (!btn) return;

  btn.addEventListener("click", (e: MouseEvent) => {
    /* Prevent vault-switch (or expand/collapse) from firing on the row */
    e.stopPropagation();
    e.preventDefault();
    /*
     * EC-VUX-06: If a context menu is open when the unmount button is clicked,
     * stopPropagation() above prevents the mousedown dismiss listener from
     * reaching the document. Close the menu explicitly here so the two
     * affordances (context menu + unmount button) never conflict.
     */
    closeContextMenu();

    const nodeVaultId = el.getAttribute("data-vault-id") ?? "";
    if (!nodeVaultId) return;

    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    const activeVault = vm?.getActiveVault?.();

    if (activeVault?.id === nodeVaultId) {
      /* EC-VUX-01: confirm before unmounting the active vault */
      const vaultName = activeVault.name ?? "this vault";
      const confirmed = window.confirm(
        `Unmount "${vaultName}"? You can re-add it later. Your notes are not deleted.`,
      );
      if (!confirmed) return;
    }
    /* EC-VUX-02: silent unmount for inactive vaults */
    void vm?.deleteVault?.(nodeVaultId);
  });
}

/**
 * Wire the double-click inline-rename handler for a vault row (step_03).
 *
 * The dblclick fires after two clicks. The activate handler (single click) may
 * have already run, which is acceptable: if the vault is already active the
 * click is a harmless toggle; if not, the vault switches first, then rename
 * activates on the now-active vault.
 *
 * @param el      - The vault <li> element.
 * @param vaultId - Unused here; kept for API symmetry with other listener helpers.
 */
function attachVaultDblClickListener(el: HTMLElement, _vaultId: string): void {
  el.addEventListener("dblclick", (e: MouseEvent) => {
    e.stopPropagation();
    void startVaultInlineRename(el);
  });
}

/**
 * Activate inline rename for a vault row.
 *
 * Replaces the .tree-node-label span with a text input pre-filled with the
 * current vault name. Enter commits; Escape or blur cancels (EC-VUX-04).
 * Reuses the existing .tree-node-rename-input and .tree-node-inline-error CSS.
 *
 * The commit path calls vm.updateVault() with a partial patch {name} which is
 * sufficient because vault-manager.ts accepts Partial<Pick<VaultEntry, ...>>.
 * After a successful rename, vault-manager fires onVaultChanged → renderPanel
 * re-paints the row with the new name automatically.
 *
 * Length justification: the cancel, commit, blur, and keydown closures all
 * share the same mutable state — the input element, the errSpan, the
 * originalName string, and the labelEl reference. Splitting any of these
 * closures into separate helper functions would require passing five
 * interdependent arguments, producing more indirection than clarity. This is
 * the same irreducible-closure pattern accepted on renderTreeContent (see the
 * length justification in that function's JSDoc above).
 *
 * @param el - The vault <li> element to inline-edit.
 */
export async function startVaultInlineRename(el: HTMLElement): Promise<void> {
  const labelEl = el.querySelector<HTMLElement>(".tree-node-label");
  if (!labelEl) return;

  const nodeVaultId = el.getAttribute("data-vault-id") ?? "";
  if (!nodeVaultId) return;

  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const allVaults = vm?.getAllVaults?.() ?? [];
  const vaultEntry = allVaults.find((v: any) => v.id === nodeVaultId);
  if (!vaultEntry) return;

  const originalName = vaultEntry.name as string;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-node-rename-input";
  input.value = originalName;

  const errSpan = document.createElement("span");
  errSpan.className = "tree-node-inline-error";

  labelEl.replaceWith(input);
  input.insertAdjacentElement("afterend", errSpan);
  input.focus();
  input.select();

  const cancel = (): void => {
    if (document.contains(input)) {
      input.replaceWith(labelEl);
      errSpan.remove();
      el.tabIndex = 0;
    }
  };

  const commit = async (): Promise<void> => {
    const newName = input.value.trim();
    /* EC-VUX-03: duplicate names are allowed; EC-VUX-04: empty/unchanged cancels */
    if (!newName || newName === originalName) { cancel(); return; }
    try {
      await vm.updateVault(nodeVaultId, { name: newName });
      /* vault-manager fires onVaultChanged → renderPanel re-renders the label */
    } catch (err) {
      errSpan.textContent = String(err);
    }
  };

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void commit(); }
    if (e.key === "Escape") { cancel(); }
  });

  /* EC-VUX-04: blur cancels — defer 100ms so Enter commit runs first */
  input.addEventListener("blur", () => {
    setTimeout(() => { if (document.contains(input)) cancel(); }, 100);
  });

  /* Prevent propagation so a click inside the input does not activate the row */
  input.addEventListener("click", (e: MouseEvent) => e.stopPropagation());
}

/**
 * Attach click, keyboard, context menu, and drag-and-drop event listeners to a
 * rendered tree node <li>.
 *
 * Delegates to buildActivateHandler (click logic), attachKeyboardHandler
 * (arrow key / Enter logic), handleContextMenu (right-click), and
 * attachDragDropListeners (drag-and-drop), so each responsibility lives in a
 * helper ≤30 lines.
 *
 * @param el      - The <li> element to wire up.
 * @param vaultId - The active vault's ID (used for settings persistence on expand/collapse).
 */
function attachNodeListeners(el: HTMLElement, vaultId: string): void {
  const handleActivate = buildActivateHandler(el, vaultId);
  el.addEventListener("click", handleActivate);
  attachKeyboardHandler(el, vaultId, handleActivate);

  /* Right-click context menu (Step 02b) */
  el.addEventListener("contextmenu", (e: MouseEvent) => {
    handleContextMenu(e, el, vaultId);
  });

  /* F2 / Delete keyboard handlers for file and directory nodes (FR-3, FR-8, EC-16) */
  el.addEventListener("keydown", (e: KeyboardEvent) => {
    const type = el.getAttribute("data-type");
    const path = el.getAttribute("data-path") ?? "";

    /* F2: inline rename for file and directory nodes (FR-3) */
    if (e.key === "F2" && (type === "file" || type === "directory")) {
      e.preventDefault();
      startInlineRename(el, path, vaultId);
      return; // Explicit return prevents fall-through into Delete handling.
    }

    /* Delete key: delete file or directory (FR-8, EC-16).
     * reloadAndRender is intentionally absent here — deleteFile and deleteDirectory
     * both call reloadVaultIndex internally, which triggers renderPanel via the
     * vault-changed event. A chained reloadAndRender would cause a second redundant
     * reload (NFR Finding 9 / FR-15). */
    if (e.key === "Delete") {
      if (type === "file") {
        e.preventDefault();
        // Pass _panelContainer so deleteFile can surface Rust errors inline (M2).
        void deleteFile(path, _panelContainer ?? document.createElement("div"));
      } else if (type === "directory") {
        e.preventDefault();
        // Pass _panelContainer so deleteDirectory can surface Rust errors inline (M2).
        void deleteDirectory(path, _panelContainer ?? document.createElement("div"));
      }
    }
  });

  /* FR-1: Double-click triggers inline rename for file and directory nodes.
   * Single-click opens the file (handled by buildActivateHandler via click).
   * dblclick fires as a separate browser event — no timer or click-count guard needed.
   * EC-15: the guard explicitly excludes vault nodes so vault root rows are not affected. */
  if (el.getAttribute("data-type") === "file" || el.getAttribute("data-type") === "directory") {
    el.addEventListener("dblclick", (e: MouseEvent) => {
      e.preventDefault();
      // stopPropagation prevents the rename input from being immediately dismissed
      // by a container-level click handler that may receive the bubbled event.
      e.stopPropagation();
      const path = el.getAttribute("data-path") ?? "";
      startInlineRename(el, path, vaultId);
    });
  }

  /* Vault-specific interactions: unmount button (step_02) + dblclick rename (step_03) */
  if (el.getAttribute("data-type") === "vault") {
    attachVaultUnmountListener(el);
    attachVaultDblClickListener(el, vaultId);
  }

  /* Drag-and-drop (Step 02b) */
  attachDragDropListeners(el, vaultId);
}

/**
 * Show or hide the descendant <li> elements of a directory node after toggle.
 *
 * Extracted from toggleDirectoryNode to keep each function ≤30 lines.
 *
 * When expanding (newExpanded = true), shows every descendant whose parent
 * directory is also expanded. When collapsing (newExpanded = false), hides
 * every descendant without checking sub-directory state — a later expand
 * of the parent will re-apply this function and correctly honour inner state.
 *
 * @param allNodes    - Flat ordered list of all .tree-node elements in the tree.
 * @param elIndex     - Index of the toggled directory in allNodes.
 * @param path        - Absolute path of the toggled directory (for child matching).
 * @param newExpanded - Whether the directory is now expanded or collapsed.
 */
function applyDescendantVisibility(
  allNodes: HTMLElement[],
  elIndex: number,
  path: string,
  newExpanded: boolean,
): void {
  let i = elIndex + 1;
  while (i < allNodes.length) {
    const sibling = allNodes[i];
    const sibPath = sibling.getAttribute("data-path") ?? "";
    if (!sibPath.startsWith(path + "/")) break;

    sibling.style.display = newExpanded ? "" : "none";

    if (!newExpanded) { i++; continue; }

    /* Expanding: skip over children of collapsed sub-directories */
    const isCollapsedDir =
      sibling.getAttribute("data-type") === "directory" &&
      sibling.getAttribute("aria-expanded") === "false";

    if (isCollapsedDir) {
      i++;
      while (i < allNodes.length) {
        const gcPath = allNodes[i].getAttribute("data-path") ?? "";
        if (!gcPath.startsWith(sibPath + "/")) break;
        i++;
      }
      continue;
    }

    i++;
  }
}

/**
 * Toggle the expanded/collapsed state of a directory node in the live tree.
 *
 * Updates the in-memory expanded-paths set, flips the aria-expanded attribute
 * (CSS drives the chevron rotation), then calls applyDescendantVisibility to
 * show or hide the affected subtree. A full re-render is avoided — only the
 * affected nodes are touched for performance.
 *
 * @param el      - The directory <li> element whose state is being toggled.
 * @param path    - The absolute path of the directory node.
 * @param vaultId - The active vault's ID (for settings persistence).
 */
function toggleDirectoryNode(el: HTMLElement, path: string, vaultId: string): void {
  const newExpanded = el.getAttribute("aria-expanded") !== "true";

  if (newExpanded) {
    _expandedPaths.add(path);
  } else {
    _expandedPaths.delete(path);
  }

  el.setAttribute("aria-expanded", newExpanded ? "true" : "false");

  if (_treeEl) {
    const allNodes = Array.from(_treeEl.querySelectorAll<HTMLElement>(".tree-node"));
    applyDescendantVisibility(allNodes, allNodes.indexOf(el), path, newExpanded);
  }

  /* Persist updated expanded state (debounced) */
  scheduleSettingsSave(vaultId);
}

/**
 * Move keyboard focus to the next or previous visible node in the tree.
 *
 * "Visible" means the <li> element is not hidden via display:none (i.e. its
 * ancestor directory is expanded). Uses DOM traversal rather than index
 * arithmetic so the result is correct after filtering or partial collapse.
 *
 * @param current   - The currently focused node element.
 * @param direction - "next" or "prev" to determine focus movement direction.
 */
function focusAdjacentNode(current: HTMLElement, direction: "next" | "prev"): void {
  if (!_treeEl) return;

  const allNodes = Array.from(
    _treeEl.querySelectorAll<HTMLElement>(".tree-node"),
  ).filter((n) => n.style.display !== "none");

  const idx = allNodes.indexOf(current);
  if (idx === -1) return;

  const target = direction === "next"
    ? allNodes[idx + 1]
    : allNodes[idx - 1];

  target?.focus();
}

// ── Active file highlight ─────────────────────────────────────────────────────

/**
 * Update the active file highlight in the live tree DOM.
 *
 * Removes .tree-node-active from all nodes, then adds it to the node whose
 * data-path matches the current file. Scrolls the active node into view.
 *
 * Called on tab switch and on panel show.
 */
export function updateActiveFileHighlight(): void {
  if (!_treeEl) return;

  const activeFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;

  for (const el of _treeEl.querySelectorAll<HTMLElement>(".tree-node")) {
    el.classList.remove("tree-node-active");
    if (activeFile && el.getAttribute("data-path") === activeFile) {
      el.classList.add("tree-node-active");
      el.scrollIntoView({ block: "nearest" });
    }
  }
}

// ── Vault data loading ────────────────────────────────────────────────────────

/**
 * Load or rebuild the index for the active vault and re-render the panel.
 *
 * When vault-manager already has a cached index, a full re-render fires
 * immediately. When no index exists, a loading state is shown and
 * vaultManager.reloadVaultIndex() is called so that vault-manager owns the
 * build_vault_index invoke and keeps its internal state consistent.
 *
 * The onVaultChanged subscription (registered in onEnable) will fire once
 * reloadVaultIndex completes, which triggers a second renderPanel() call.
 * The _isLoading = false + renderPanel() pair after the await is a safety
 * net in case the subscription fires before the await settles.
 */
export async function refreshVaultData(): Promise<void> {
  if (!_enabled) return;

  const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
  const activeVault: VaultEntry | null = vaultManager?.getActiveVault?.() ?? null;

  if (!activeVault) {
    _isLoading = false;
    renderPanel();
    return;
  }

  /*
   * Load expanded paths for this vault from settings so the tree restores
   * the user's last open/close state when the vault changes.
   */
  await loadExpandedPaths(activeVault.id);

  /* Fast path: vault-manager already has a loaded index — render immediately */
  const existing = vaultManager?.getVaultIndex?.();
  if (existing) {
    _isLoading = false;
    renderPanel();
    return;
  }

  /*
   * No cached index — show a loading spinner, then delegate the build to
   * vault-manager. We must NOT invoke build_vault_index directly here because
   * that would bypass vault-manager's in-memory state, leaving getVaultIndex()
   * returning null forever even after the build completes (BLOCKING-1).
   *
   * vault-manager.reloadVaultIndex() invokes build_vault_index, stores the
   * result, and emits onVaultChanged — the subscription registered in onEnable
   * will then call renderPanel() with the fresh index.
   */
  _isLoading = true;
  renderPanel();

  try {
    await vaultManager?.reloadVaultIndex?.();
    /* onVaultChanged fires → triggers renderPanel() via subscription */
  } catch (err) {
    console.error("[file-browser] reloadVaultIndex failed:", err);
  }

  _isLoading = false;
  if (_enabled) renderPanel();
}

// ── Tab-change detection ──────────────────────────────────────────────────────

/**
 * Handle a tab-changed event by updating the active file highlight.
 *
 * This is the clean path used when the tab manager fires the
 * "markable-tab-changed" custom event on window. The polling fallback
 * (below) handles cases where the event is not fired (e.g. wiki-link
 * navigation that bypasses the event bus).
 */
function onTabChanged(): void {
  if (!_enabled) return;
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (currentFile !== _lastKnownFile) {
    _lastKnownFile = currentFile;
    updateActiveFileHighlight();
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────

/**
 * Close and remove the currently visible context menu, if any.
 *
 * Removes both the DOM element and the document-level dismissal listener so
 * the teardown is clean whether triggered by Escape, outside-click, or a menu
 * item activation.
 */
function closeContextMenu(): void {
  _contextMenu?.remove();
  _contextMenu = null;
  if (_contextMenuDismiss) {
    document.removeEventListener("mousedown", _contextMenuDismiss);
    _contextMenuDismiss = null;
  }
  /*
   * Always remove the Escape keydown handler regardless of which code path
   * closed the menu. The handler was previously a local variable inside
   * showContextMenu() so it could only remove itself on Escape — all other
   * close paths (outside click, menu item click, unmount button) leaked the
   * listener. Moving it to _contextMenuEscHandler and clearing here fixes
   * the leak (Finding 4).
   */
  if (_contextMenuEscHandler) {
    document.removeEventListener("keydown", _contextMenuEscHandler);
    _contextMenuEscHandler = null;
  }
}

/**
 * Append a single item to a context menu `<ul>`.
 *
 * @param ul       - The context menu list to append to.
 * @param label    - The display text.
 * @param handler  - Click handler; null when the item is disabled.
 * @param disabled - When true, the item is rendered with `.disabled` class.
 */
function addMenuItem(
  ul: HTMLElement,
  label: string,
  handler: (() => void) | null,
  disabled = false,
): void {
  const li = document.createElement("li");
  li.className = "context-menu-item" + (disabled ? " disabled" : "");
  li.textContent = label;
  if (handler && !disabled) {
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      closeContextMenu();
      handler();
    });
  }
  ul.appendChild(li);
}

/**
 * Show a context menu at the given viewport coordinates.
 *
 * Clamps the menu position so it never overflows the viewport. Registers a
 * document-level `mousedown` listener that closes the menu on outside click.
 * An Escape keydown listener is also registered for keyboard dismissal.
 *
 * @param items - Array of { label, handler, disabled? } descriptors.
 * @param x     - Desired left position (viewport-relative).
 * @param y     - Desired top position (viewport-relative).
 */
function showContextMenu(
  items: Array<{ label: string; handler: (() => void) | null; disabled?: boolean; separator?: boolean }>,
  x: number,
  y: number,
): void {
  closeContextMenu();

  const ul = document.createElement("ul");
  ul.className = "context-menu";
  ul.setAttribute("role", "menu");

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("li");
      sep.className = "context-menu-separator";
      sep.setAttribute("role", "separator");
      ul.appendChild(sep);
    } else {
      addMenuItem(ul, item.label, item.handler ?? null, item.disabled ?? false);
    }
  }

  document.body.appendChild(ul);
  _contextMenu = ul;

  /* Clamp to viewport */
  const rect = ul.getBoundingClientRect();
  const clampedX = Math.min(x, window.innerWidth - rect.width - 4);
  const clampedY = Math.min(y, window.innerHeight - rect.height - 4);
  ul.style.left = `${Math.max(0, clampedX)}px`;
  ul.style.top  = `${Math.max(0, clampedY)}px`;

  /* Dismiss on outside click */
  _contextMenuDismiss = (e: MouseEvent) => {
    if (!ul.contains(e.target as Node)) {
      closeContextMenu();
    }
  };
  document.addEventListener("mousedown", _contextMenuDismiss);

  /*
   * Dismiss on Escape — stored in _contextMenuEscHandler (module-level) so
   * closeContextMenu() can remove it on any close path, not just Escape itself.
   * This fixes the listener leak from Finding 4.
   */
  _contextMenuEscHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeContextMenu();
  };
  document.addEventListener("keydown", _contextMenuEscHandler);
}

/**
 * Build the context menu items for a file node.
 *
 * @param el           - The node <li> element.
 * @param path         - Absolute path of the file.
 * @param vaultId      - Active vault ID (for context operations).
 */
function buildFileContextMenuItems(
  el: HTMLElement,
  path: string,
  vaultId: string,
): Array<{ label: string; handler: (() => void) | null; disabled?: boolean; separator?: boolean }> {
  const parentDir = getParentDir(path);
  const container = _panelContainer;

  return [
    {
      label: "New Note",
      handler: () => {
        if (!container) return;
        showInlineCreateInput(parentDir, container, vaultId);
      },
    },
    {
      label: "New Folder",
      handler: () => {
        if (!container) return;
        showInlineFolderCreateInput(parentDir, container, vaultId);
      },
    },
    { separator: true, label: "", handler: null },
    {
      label: "Rename",
      handler: () => startInlineRename(el, path, vaultId),
    },
    {
      label: "Delete",
      // reloadAndRender is intentionally absent — deleteFile calls reloadVaultIndex
      // internally (FR-15). Chaining reloadAndRender would cause a redundant reload.
      // container is passed so Rust errors are surfaced inline (M2).
      handler: () => {
        void deleteFile(path, container ?? document.createElement("div"));
      },
    },
    { separator: true, label: "", handler: null },
    {
      label: "Move to…",
      handler: null,
      disabled: true,
    },
    {
      label: "Open in Finder",
      handler: () => {
        void (window as any).__TAURI_INTERNALS__?.invoke?.("reveal_in_finder", { path });
      },
    },
    {
      label: "Copy Path",
      handler: () => {
        void navigator.clipboard.writeText(path);
      },
    },
  ];
}

/**
 * Build the context menu items for a directory node.
 *
 * @param el      - The node <li> element.
 * @param path    - Absolute path of the directory.
 * @param vaultId - Active vault ID.
 */
function buildDirContextMenuItems(
  el: HTMLElement,
  path: string,
  vaultId: string,
): Array<{ label: string; handler: (() => void) | null; disabled?: boolean; separator?: boolean }> {
  const container = _panelContainer;

  return [
    {
      label: "New Note",
      handler: () => {
        if (!container) return;
        showInlineCreateInput(path, container, vaultId);
      },
    },
    {
      label: "New Folder",
      handler: () => {
        if (!container) return;
        showInlineFolderCreateInput(path, container, vaultId);
      },
    },
    { separator: true, label: "", handler: null },
    {
      label: "Rename",
      handler: () => startInlineRename(el, path, vaultId),
    },
    {
      label: "Delete",
      // reloadAndRender is intentionally absent — deleteDirectory calls reloadVaultIndex
      // internally (FR-15). Chaining reloadAndRender would cause a redundant reload.
      // container is passed so Rust errors are surfaced inline (M2).
      handler: () => {
        void deleteDirectory(path, container ?? document.createElement("div"));
      },
    },
    { separator: true, label: "", handler: null },
    {
      label: "Open in Finder",
      handler: () => {
        void (window as any).__TAURI_INTERNALS__?.invoke?.("reveal_in_finder", { path });
      },
    },
  ];
}

/**
 * Build the context menu items for a vault root node (step_04).
 *
 * Items:
 *   Unmount   — calls deleteVault (removes from Markable, does not touch disk).
 *               Confirms first when the vault is active (EC-VUX-01).
 *   Rename    — activates inline rename on the row (same as double-click, step_03).
 *   Edit Type — opens Manage Vaults modal focused on this vault's edit form.
 *
 * The old "New Vault…", "Edit Vault…", "Delete Vault…" items are removed.
 * Creating vaults is now via the "+ Add…" row (step_01).
 *
 * @param el      - The vault <li> element (forwarded to startVaultInlineRename).
 * @param _path   - Vault path (unused; kept for API consistency with other builders).
 * @param vaultId - The ID of the vault whose node was right-clicked.
 */
function buildVaultContextMenuItems(
  el: HTMLElement,
  _path: string,
  vaultId: string,
): Array<{ label: string; handler: (() => void) | null; disabled?: boolean; separator?: boolean }> {
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const activeVault = vm?.getActiveVault?.();
  const rootPath: string = activeVault?.rootPaths?.[0] ?? "";

  return [
    {
      label: "New File",
      handler: () => {
        const container = _panelContainer;
        if (!container || !rootPath) return;
        showInlineCreateInput(rootPath, container, vaultId);
      },
    },
    {
      label: "New Folder",
      handler: () => {
        const container = _panelContainer;
        if (!container || !rootPath) return;
        showInlineFolderCreateInput(rootPath, container, vaultId);
      },
    },
    { separator: true, label: "", handler: null },
    {
      label: "Unmount",
      handler: () => {
        const isActive = activeVault?.id === vaultId;
        if (isActive) {
          const name = activeVault.name ?? "this vault";
          const confirmed = window.confirm(
            `Unmount "${name}"? You can re-add it later. Your notes are not deleted.`,
          );
          if (!confirmed) return;
        }
        /* EC-VUX-02: silent unmount for inactive vaults */
        void vm?.deleteVault?.(vaultId);
      },
    },
    {
      label: "Rename",
      /* Delegates to startVaultInlineRename — same behaviour as double-click */
      handler: () => void startVaultInlineRename(el),
    },
    { separator: true, label: "", handler: null },
    {
      label: "Edit Type",
      /* Opens Manage Vaults modal focused on the edit form for this vault */
      handler: () => openManageVaultsModal(vaultId),
    },
  ];
}

/**
 * Handle a right-click on a tree node: build and display the appropriate
 * context menu based on the node type.
 *
 * @param e       - The contextmenu MouseEvent.
 * @param el      - The clicked <li> element.
 * @param vaultId - Active vault ID.
 */
function handleContextMenu(e: MouseEvent, el: HTMLElement, vaultId: string): void {
  e.preventDefault();
  e.stopPropagation();

  const type = el.getAttribute("data-type") as "vault" | "directory" | "file" | null;
  const path = el.getAttribute("data-path") ?? "";

  /*
   * Update the selected folder path when a context menu is invoked.
   * This allows the find widget to read the right-clicked folder as the
   * current scope target via getSelectedFolderPath() (step_01 contract).
   *
   * File right-clicks clear the folder selection (EC-5).
   * Vault-root right-clicks are treated as valid folder scope (same as
   * the vault-root activate handler above).
   */
  if (type === "directory") {
    _selectedFolderPath = path;
  } else if (type === "file") {
    _selectedFolderPath = null;
  }
  // vault-root: do NOT clear; treat vault root as valid folder scope.

  let items: Array<{ label: string; handler: (() => void) | null; disabled?: boolean; separator?: boolean }>;

  if (type === "file") {
    items = buildFileContextMenuItems(el, path, vaultId);
  } else if (type === "directory") {
    items = buildDirContextMenuItems(el, path, vaultId);
  } else {
    items = buildVaultContextMenuItems(el, path, vaultId);
  }

  showContextMenu(items, e.clientX, e.clientY);
}

// ── Inline rename / create ────────────────────────────────────────────────────

/**
 * Replace the label span of a tree node with an inline `<input>` for renaming.
 *
 * Behaviour:
 *   - Enter → commit rename via renameNode().
 *   - Escape or blur → cancel, restore original label (EC-24).
 *   - Real-time validation on `input` events (EC-17).
 *
 * @param el      - The tree node <li> element to inline-edit.
 * @param path    - Absolute path of the node being renamed.
 * @param vaultId - Active vault ID.
 */
export function startInlineRename(el: HTMLElement, path: string, _vaultId: string): void {
  const labelEl = el.querySelector<HTMLElement>(".tree-node-label");
  if (!labelEl) return;

  const isFile = path.endsWith(".md");
  const currentStem = isFile ? getFileStem(path) : getBasename(path);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-node-rename-input";
  input.value = currentStem;

  const errSpan = document.createElement("span");
  errSpan.className = "tree-node-inline-error";

  labelEl.replaceWith(input);

  /* Insert error span after the input — will be populated on validation fail */
  input.insertAdjacentElement("afterend", errSpan);
  input.focus();
  input.select();

  /* Real-time validation */
  input.addEventListener("input", () => {
    const err = validateFilename(input.value.trim());
    errSpan.textContent = err ?? "";
  });

  const cancel = () => {
    input.replaceWith(labelEl);
    errSpan.remove();
    el.setAttribute("tabIndex", "0");
  };

  const commit = async () => {
    const newName = input.value.trim();
    if (!newName || newName === currentStem) { cancel(); return; }

    const container = _panelContainer;
    if (!container) { cancel(); return; }

    try {
      // Pass nodeType from data-type attribute so renameNode can discriminate
      // directories from extension-less files (H2 fix).
      const nodeType = (el.getAttribute("data-type") ?? "file") as "file" | "directory";
      await renameNode(path, newName, container, nodeType);
      // renameNode calls reloadVaultIndex which triggers onVaultChanged → renderPanel
    } catch (err) {
      errSpan.textContent = String(err);
    }
  };

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void commit(); }
    if (e.key === "Escape") { cancel(); }
  });

  /* Blur cancels (EC-24) */
  input.addEventListener("blur", () => {
    /* Defer so Enter handler runs first if focus leaves via Enter */
    setTimeout(() => {
      if (document.contains(input)) cancel();
    }, 100);
  });

  /* Prevent node click propagation while input is active */
  input.addEventListener("click", (e: MouseEvent) => e.stopPropagation());
}

/**
 * Show an inline create input at the top of a directory in the tree.
 *
 * Creates a temporary `<li>` with a text input. Enter commits creation via
 * createNote(). Escape or blur removes the input without creating anything.
 *
 * @param dirPath   - Parent directory for the new note.
 * @param container - The panel container (for error display and tree lookup).
 * @param vaultId   - Active vault ID.
 */
function showInlineCreateInput(dirPath: string, container: HTMLElement, vaultId: string): void {
  if (!_treeEl) return;
  const li = buildInlineInputNode(dirPath, container, vaultId, "file");
  const target = _treeEl.querySelector(`[data-path="${CSS.escape(dirPath)}"]`);
  if (target) {
    target.insertAdjacentElement("afterend", li);
  } else {
    _treeEl.prepend(li);
  }
}

/**
 * Show an inline create input for a new folder inside `dirPath`.
 *
 * @param dirPath   - Parent directory for the new folder.
 * @param container - The panel container.
 * @param vaultId   - Active vault ID.
 */
function showInlineFolderCreateInput(dirPath: string, container: HTMLElement, vaultId: string): void {
  if (!_treeEl) return;
  const li = buildInlineInputNode(dirPath, container, vaultId, "directory");
  const target = _treeEl.querySelector(`[data-path="${CSS.escape(dirPath)}"]`);
  if (target) {
    target.insertAdjacentElement("afterend", li);
  } else {
    _treeEl.prepend(li);
  }
}

/**
 * Build a temporary `<li>` with an inline create input.
 *
 * Extracted from showInlineCreateInput / showInlineFolderCreateInput so each
 * remains ≤30 lines.
 *
 * @param dirPath   - Parent directory.
 * @param container - Panel container.
 * @param vaultId   - Vault ID.
 * @param kind      - "file" or "directory".
 * @returns The temporary <li> node.
 */
function buildInlineInputNode(
  dirPath: string,
  container: HTMLElement,
  vaultId: string,
  kind: "file" | "directory",
): HTMLElement {
  const li = document.createElement("li");
  li.className = "tree-node tree-node-" + kind;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-node-rename-input";
  input.placeholder = kind === "file" ? "Note name…" : "Folder name…";

  const errSpan = document.createElement("span");
  errSpan.className = "tree-node-inline-error";

  li.appendChild(input);
  li.appendChild(errSpan);

  input.addEventListener("input", () => {
    const err = validateFilename(input.value.trim());
    errSpan.textContent = err ?? "";
  });

  const cancel = () => li.remove();

  const commit = async () => {
    const name = input.value.trim();
    if (!name) { cancel(); return; }

    if (kind === "file") {
      try {
        await createNote(dirPath, name, container);
      } catch (err) {
        errSpan.textContent = String(err);
        return;
      }
    } else {
      const newDir = (dirPath.endsWith("/") ? dirPath : dirPath + "/") + name;
      try {
        await (window as any).__TAURI_INTERNALS__?.invoke?.("create_directory", { path: newDir });
        _expandedPaths.add(dirPath);
        scheduleSettingsSave(vaultId);
        await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
      } catch (err) {
        errSpan.textContent = String(err);
        return;
      }
    }

    li.remove();
  };

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void commit(); }
    if (e.key === "Escape") { cancel(); }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => { if (document.contains(input)) cancel(); }, 100);
  });

  input.addEventListener("click", (e: MouseEvent) => e.stopPropagation());

  /* Focus immediately so the user can start typing */
  setTimeout(() => input.focus(), 0);
  return li;
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────────

/**
 * Pure guard logic for the drag-drop handler, extracted for unit testing.
 *
 * Given the target node's path and type, and the source node's path, returns
 * the directory that `moveNode` should target, or `null` when the drop is a
 * no-op.
 *
 * No-op cases (returns null):
 *   - sourcePath is empty — external drag from OS Finder or browser (EC-17, FR-7)
 *   - targetDir equals sourcePath — dragged directory dropped on its own <li> (EC-4)
 *   - targetDir equals source's parent — dropped into its current parent (EC-3)
 *   - targetDir starts with sourcePath + "/" — cycle: folder dropped into a
 *     descendant of itself (EC-5)
 *
 * File-on-file resolution (EC-2, FR-5):
 *   When the drop target is a file node, the effective targetDir is the file's
 *   parent directory, not the file itself.
 *
 * @param targetPath - data-path of the <li> that received the drop.
 * @param targetType - data-type of the <li> ("file" | "directory" | "vault").
 * @param sourcePath - data-path of the <li> being dragged (from DataTransfer).
 * @returns Resolved target directory, or null when the drop should be ignored.
 *
 * @internal exported for tests only
 */
export function resolveDropTarget(
  targetPath: string,
  targetType: string,
  sourcePath: string,
): string | null {
  // EC-17: external drags carry no markable MIME data; reject them silently.
  if (!sourcePath) return null;

  // Resolve the effective target directory.
  // File nodes represent files, not directories; a drop onto a file node means
  // "move the source into the same folder as this file" (FR-5).
  const targetDir = targetType === "file" ? getParentDir(targetPath) : targetPath;

  // EC-4: the directory node was dropped onto its own <li>.
  if (targetDir === sourcePath) return null;

  // EC-3: the node is already in this directory — the move would be a no-op.
  // This guard applies to all target types, including vault root. If the source
  // is already a direct child of the vault root (e.g. /vault/docs), dropping it
  // on the vault root is also a no-op. EC-20 (a non-child dropped onto vault root)
  // still passes because getParentDir(sourcePath) will differ from the vault root.
  if (targetDir === getParentDir(sourcePath)) return null;

  // EC-5: dropping a directory into one of its own descendants would create a
  // filesystem cycle. Reject by checking whether targetDir starts with the
  // source path followed by a separator.
  if (targetDir.startsWith(sourcePath + "/")) return null;

  return targetDir;
}

/**
 * Attach HTML5 drag-and-drop event handlers to a rendered tree node.
 *
 * File and directory nodes are draggable (vault root is not — EC-1).
 * All node types (file, directory, vault) accept drops.
 * File nodes resolve their drop target to their parent directory (FR-5, EC-2).
 *
 * @param el      - The <li> element to wire up.
 * @param _vaultId - Active vault ID (reserved for future per-vault routing).
 */
function attachDragDropListeners(el: HTMLElement, _vaultId: string): void {
  const type = el.getAttribute("data-type");
  const path = el.getAttribute("data-path") ?? "";

  /* File and directory nodes are draggable via pointer events; vault root is not (EC-1).
   * HTML5 drag+drop (draggable="true") is NOT used because WKWebView on macOS does not
   * reliably fire dragstart. Instead we use pointerdown/pointermove/pointerup which work
   * correctly in Tauri's WebView. The dragend handler is retained so existing tests that
   * dispatch synthetic dragend events continue to exercise the cleanup path. */
  if (type === "file" || type === "directory") {
    let startX = 0;
    let startY = 0;
    let dragActive = false;
    let activePointerId = -1;
    let currentDropTarget: HTMLElement | null = null;
    let ghostEl: HTMLElement | null = null;

    const cleanupDrag = (): void => {
      if (ghostEl) { ghostEl.remove(); ghostEl = null; }
      el.classList.remove("is-dragging");
      currentDropTarget?.classList.remove("drag-over");
      currentDropTarget = null;
      _activeDragPath = null;
      dragActive = false;
      activePointerId = -1;
      _treeEl?.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
      document.body.style.userSelect = "";
      (document.body.style as any).webkitUserSelect = "";
      document.body.style.cursor = "";
    };

    el.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      dragActive = false;
      activePointerId = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch { /* JSDOM may not support */ }
      // Suppress text selection immediately so even sub-threshold pointer movement
      // never highlights text. Restored unconditionally in cleanupDrag().
      document.body.style.userSelect = "none";
      (document.body.style as any).webkitUserSelect = "none";
      window.getSelection()?.removeAllRanges();
      e.stopPropagation();
    });

    el.addEventListener("pointermove", (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!dragActive) {
        if (Math.hypot(dx, dy) < 6) return;
        dragActive = true;
        _activeDragPath = path;
        el.classList.add("is-dragging");
        // Suppress text selection and set a grabbing cursor across the whole
        // document for the duration of the drag.
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        // Clear any selection that may have started before the threshold was crossed.
        window.getSelection()?.removeAllRanges();
        ghostEl = document.createElement("div");
        ghostEl.className = "drag-ghost";
        ghostEl.textContent = el.querySelector(".file-name, .dir-name, .vault-name")
          ?.textContent ?? path.split("/").pop() ?? "item";
        ghostEl.style.cssText =
          "position:fixed;z-index:9999;pointer-events:none;padding:3px 8px;" +
          "background:var(--bg-secondary,#2a2a2a);border:1px solid var(--border-color,#444);" +
          "border-radius:4px;font-size:12px;white-space:nowrap;opacity:0.85;";
        document.body.appendChild(ghostEl);
      }

      if (!dragActive) return;

      if (ghostEl) {
        ghostEl.style.left = `${e.clientX + 14}px`;
        ghostEl.style.top = `${e.clientY + 6}px`;
      }

      // Hit-test: find the tree node under the cursor (excluding the dragged node itself).
      el.style.pointerEvents = "none";
      const hitEl = document.elementFromPoint(e.clientX, e.clientY);
      el.style.pointerEvents = "";

      const targetNode =
        (hitEl as HTMLElement | null)?.closest<HTMLElement>("[data-path][data-type]") ?? null;

      if (targetNode !== currentDropTarget) {
        currentDropTarget?.classList.remove("drag-over");
        currentDropTarget = null;
      }
      if (targetNode && targetNode !== el) {
        const tType = targetNode.getAttribute("data-type");
        if (tType === "file" || tType === "directory" || tType === "vault") {
          targetNode.classList.add("drag-over");
          currentDropTarget = targetNode;
        }
      }
    });

    const handlePointerEnd = (e: PointerEvent): void => {
      if (e.pointerId !== activePointerId) {
        // Different pointer — still clear any userSelect lock we set on pointerdown.
        document.body.style.userSelect = "";
        (document.body.style as any).webkitUserSelect = "";
        document.body.style.cursor = "";
        return;
      }
      try { el.releasePointerCapture(e.pointerId); } catch { /* JSDOM may not support */ }

      if (dragActive && currentDropTarget) {
        const targetPath = currentDropTarget.getAttribute("data-path") ?? "";
        const targetType = currentDropTarget.getAttribute("data-type") ?? "";
        const sourcePath = path;
        cleanupDrag();

        const targetDir = resolveDropTarget(targetPath, targetType, sourcePath);
        if (targetDir !== null) {
          void moveNode(sourcePath, targetDir, _panelContainer).catch((err) => {
            console.error("[file-browser] move failed:", err);
            if (_panelContainer) {
              showInlineError(_panelContainer, `Move failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          });
        }
      } else {
        cleanupDrag();
      }
    };

    el.addEventListener("pointerup", handlePointerEnd);
    el.addEventListener("pointercancel", handlePointerEnd);

    // dragend is kept solely so existing tests that dispatch synthetic "dragend"
    // events can exercise the cleanup path without needing pointer-capture support.
    el.addEventListener("dragend", cleanupDrag);
  }

  /* All node types accept drops via the pointer-up path above (source element finds
   * the target via elementFromPoint). The dragover/dragleave/drop listeners below are
   * retained only for test compatibility: test suites dispatch synthetic DragEvents
   * which do not go through the pointer path. They are dead code in the live app. */
  if (type === "file" || type === "directory" || type === "vault") {
    el.addEventListener("dragover", (e: DragEvent) => {
      if (_activeDragPath === null) return;
      e.preventDefault();
      el.classList.add("drag-over");
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("drag-over");
    });

    el.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("drag-over");

      const sourcePath =
        _activeDragPath ?? e.dataTransfer?.getData("text/x-markable-path") ?? "";

      const targetDir = resolveDropTarget(path, type, sourcePath);
      if (targetDir === null) return;

      void moveNode(sourcePath, targetDir, _panelContainer).catch((err) => {
        console.error("[file-browser] move failed:", err);
        if (_panelContainer) {
          showInlineError(_panelContainer, `Move failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    });
  }
}

// ── FS watcher integration ────────────────────────────────────────────────────

/**
 * Start the Tauri vault-file-changed event listener.
 *
 * Uses `window.__TAURI_INTERNALS__.event.listen` (the IIFE-safe path) to
 * subscribe to the `"vault-file-changed"` event emitted by the Rust watcher.
 * Events are debounced at 300ms before triggering a vault index reload.
 *
 * The spec calls for invoking `watch_vault` here so the watcher is live for
 * as long as the plugin is enabled. If the Rust side debounces and emits,
 * we debounce again on the TS side to batch rapid storm events.
 */
async function startFsWatcher(): Promise<void> {
  const vault = (window as any).__MARKABLE_VAULT_MANAGER__?.getActiveVault?.();
  if (!vault) return;

  /* Start the Rust-side notify watcher for this vault */
  try {
    await (window as any).__TAURI_INTERNALS__?.invoke?.("watch_vault", {
      vaultId: vault.id,
      rootPaths: vault.rootPaths,
    });
  } catch (err) {
    console.warn("[file-browser] watch_vault failed:", err);
  }

  /* Subscribe to Tauri vault-file-changed events */
  const tauriEvent = (window as any).__TAURI_INTERNALS__?.event ??
                     (window as any).__TAURI__?.event;

  if (tauriEvent?.listen) {
    try {
      _fsUnlisten = await tauriEvent.listen("vault-file-changed", (event: any) => {
        handleFsEvent(event.payload);
      });
    } catch (err) {
      console.warn("[file-browser] Failed to subscribe to vault-file-changed:", err);
    }
  }
}

/**
 * Stop the Tauri vault-file-changed event listener and un-watch the vault.
 *
 * Called during onDisable and when the active vault changes so the old vault's
 * watcher is cleaned up before a new one is started.
 */
async function stopFsWatcher(): Promise<void> {
  /* Unsubscribe the Tauri event listener */
  if (_fsUnlisten) {
    try { _fsUnlisten(); } catch { /* ignore */ }
    _fsUnlisten = null;
  }

  /* Cancel any pending debounce timer */
  if (_fsDebounceTimer !== null) {
    clearTimeout(_fsDebounceTimer);
    _fsDebounceTimer = null;
  }

  /* Tell Rust to stop watching */
  const vault = (window as any).__MARKABLE_VAULT_MANAGER__?.getActiveVault?.();
  if (!vault) return;

  try {
    await (window as any).__TAURI_INTERNALS__?.invoke?.("unwatch_vault", { vaultId: vault.id });
  } catch (err) {
    console.warn("[file-browser] unwatch_vault failed:", err);
  }
}

/**
 * Handle a `vault-file-changed` payload received from the Rust watcher.
 *
 * Debounces at 300ms so rapid events (e.g. saving multiple files) are batched
 * into a single vault index reload rather than triggering a re-render storm.
 *
 * Ignores events for vaults other than the currently active vault (EC-25).
 *
 * @param payload - The event payload with `vaultId`, `eventType`, and `path`.
 */
function handleFsEvent(payload: { vaultId?: string; eventType?: string; path?: string }): void {
  const activeVault = (window as any).__MARKABLE_VAULT_MANAGER__?.getActiveVault?.();
  if (!activeVault) return;

  /* EC-25: ignore events that are not for the active vault */
  if (payload.vaultId && payload.vaultId !== activeVault.id) return;

  /* Debounce: reset the timer on every incoming event */
  if (_fsDebounceTimer !== null) clearTimeout(_fsDebounceTimer);

  _fsDebounceTimer = setTimeout(() => {
    _fsDebounceTimer = null;
    if (!_enabled) return;
    void (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
  }, 300);
}

// ── Plugin lifecycle ──────────────────────────────────────────────────────────

/**
 * File Browser plugin definition.
 *
 * onEnable sequence:
 *   1. Store the API reference and set _enabled.
 *   2. Inject CSS.
 *   3. Subscribe to vault-manager events (onVaultChanged, onIndexUpdated).
 *   4. Register the sidebar panel.
 *   5. Start the tab-change detection (event + poll fallback).
 *
 * onDisable sequence (exact reversal):
 *   1. Clear _enabled.
 *   2. Unsubscribe from vault-manager events.
 *   3. Unregister the sidebar panel.
 *   4. Remove event listeners and timers.
 *   5. Remove CSS.
 *   6. Clear all module-level state.
 */
/**
 * Register vault-manager event subscriptions for the plugin.
 *
 * Extracted from onEnable to keep each function ≤30 lines.
 * Populates the module-level _vaultChangedCb and _indexUpdatedCb refs so
 * they can be removed by onDisable.
 *
 * @param vaultManager - The vault manager instance from the window global.
 */
function setupVaultSubscriptions(vaultManager: any): void {
  _vaultChangedCb = (_vault: VaultEntry | null) => {
    if (!_enabled) return;
    _searchQuery = "";
    /*
     * Clear the selected folder path on vault change. When the vault switches
     * (or becomes inactive), the previously selected folder is no longer
     * meaningful. The find widget will fall back to "vault" scope (EC-4 / EC-5).
     */
    _selectedFolderPath = null;
    void refreshVaultData();
  };

  _indexUpdatedCb = (_event: VaultFileChangedEvent) => {
    if (!_enabled) return;
    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    const activeVault: VaultEntry | null = vm?.getActiveVault?.() ?? null;
    if (!activeVault) return;
    const vaultIndex = vm?.getVaultIndex?.() as VaultIndex | null;
    if (!vaultIndex) return;

    const newTree = buildTreeFromIndex(
      vaultIndex.entries, activeVault.rootPaths, _expandedPaths, activeVault,
    );
    sortNodes(newTree);
    const diff = diffTree(_currentTree, newTree);
    if (diff.toAdd.length > 0 || diff.toRemove.length > 0 || diff.toUpdate.length > 0) {
      _currentTree = newTree;
      renderPanel();
    }
  };

  vaultManager?.onVaultChanged?.(_vaultChangedCb);
  vaultManager?.onIndexUpdated?.(_indexUpdatedCb);
}

/**
 * Build the SidebarPanelDescriptor for the Files panel.
 *
 * Extracted from onEnable to keep each function ≤30 lines.
 * The descriptor wires panel lifecycle (render / destroy) and the header
 * action that opens the Manage Vaults modal.
 *
 * @returns The fully configured descriptor ready for api.registerSidebarPanel.
 */
function makePanelDescriptor(): SidebarPanelDescriptor {
  return {
    id: PANEL_ID,
    title: "Files",
    side: "left",
    defaultWidth: 240,

    render(container: HTMLElement): void {
      _panelContainer = container;
      _treeEl = null;
      _searchEl = null;
      /*
       * refreshVaultData() is the sole driver of all renderPanel() calls. The
       * _treeEl reference is null here (it is set inside renderPanel → buildTreeUl),
       * so calling updateActiveFileHighlight() at this point would be a no-op because
       * updateActiveFileHighlight() guards on `if (!_treeEl) return`. We therefore
       * omit the call here and rely on the highlight being applied correctly inside
       * buildNodeEl() during the renderPanel() that refreshVaultData() triggers
       * (LOW-1 fix from Step 02a code review).
       */
      void refreshVaultData();
    },

    destroy(container: HTMLElement): void {
      /* Clear DOM before nulling refs — prevents listener leaks (HIGH-1) */
      container.innerHTML = "";
      _panelContainer = null;
      _treeEl = null;
      _searchEl = null;
    },

    headerActions: [
      {
        id: "file-browser-search-btn",
        icon: "",
        iconHTML: `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.4"/><line x1="8.7" y1="8.7" x2="12.5" y2="12.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
        title: "Search files",
        onClick: toggleSearch,
      },
      {
        /* ⋯ (horizontal ellipsis) matches the spec icon for panel menus */
        id: "file-browser-manage-vaults-btn",
        icon: "⋯",
        title: "Panel menu",
        onClick: openManageVaultsModal,
      },
    ],
  };
}

const plugin = {
  id: PLUGIN_ID,
  name: "File Browser",
  version: "1.0.0",
  description: "Browse and open files in the active vault",
  detail:
    "Shows the active vault's file tree in the left sidebar. Supports " +
    "fuzzy search, expand/collapse directories, and active-file highlighting.",
  sidebarPanelId: PANEL_ID,

  onEnable(api: MarkablePluginAPI): void {
    _enabled = true;
    _api = api;

    injectFileBrowserCSS();

    /*
     * step_05: Register the window global so external entry points (Plugin Panel
     * button, vault-manage keybinding) can open the Manage Vaults modal without
     * a direct import dependency on this module. Follows the __MARKABLE_COMMAND_BAR_OPEN__
     * pattern used by other plugins.
     */
    (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = openManageVaultsModal;

    /*
     * Expose the folder-selection accessor so the multi-file find widget can
     * read the currently selected folder path synchronously at search time.
     * The pull model (accessor) is used instead of a DOM event because the
     * find widget needs the path at query dispatch time, not reactively.
     *
     * Follows the __MARKABLE_OPEN_MANAGE_VAULTS__ pattern (AD decision in
     * docs/specs/multi-file-find-replace/00_index.md).
     */
    (window as any).__MARKABLE_FILE_BROWSER__ = {
      /**
       * Returns the absolute path of the folder currently highlighted in the
       * file-browser sidebar, or null if no folder is selected or if the
       * plugin is disabled.
       */
      getSelectedFolderPath(): string | null {
        return _selectedFolderPath;
      },
    };

    setupVaultSubscriptions((window as any).__MARKABLE_VAULT_MANAGER__);
    api.registerSidebarPanel(makePanelDescriptor());

    /* Capture the search toggle button reference after the sidebar renders it */
    setTimeout(() => {
      _searchToggleBtn = document.getElementById("file-browser-search-btn") as HTMLButtonElement | null;
    }, 0);

    /* Tab-change via custom event (clean path) */
    _tabChangedListener = () => onTabChanged();
    window.addEventListener("markable-tab-changed", _tabChangedListener);

    /*
     * Polling fallback (500ms) for tab changes that bypass the event bus
     * (e.g. wiki-link navigation that calls openFile directly).
     */
    _pollTimer = setInterval(() => {
      if (!_enabled) return;
      const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
      if (currentFile !== _lastKnownFile) {
        _lastKnownFile = currentFile;
        updateActiveFileHighlight();
      }
    }, 500);

    /* Start the file-system watcher for the active vault (Step 02b) */
    void startFsWatcher();
  },

  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;

    /* step_05: Unregister the window global so the button is unreachable while disabled */
    (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = null;

    /*
     * Null the file-browser global and clear the folder path so any retained
     * accessor references return null after disable (FS-4).
     */
    (window as any).__MARKABLE_FILE_BROWSER__ = null;
    _selectedFolderPath = null;

    /* Close any open context menu so it doesn't linger after disable */
    closeContextMenu();

    /* Stop the file-system watcher (Step 02b) */
    void stopFsWatcher();

    /* Unsubscribe from vault-manager event bus */
    const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
    if (vaultManager) {
      if (_vaultChangedCb) vaultManager.offVaultChanged?.(_vaultChangedCb);
      if (_indexUpdatedCb) vaultManager.offIndexUpdated?.(_indexUpdatedCb);
    }
    _vaultChangedCb = null;
    _indexUpdatedCb = null;

    /* Unregister sidebar panel */
    api.unregisterSidebarPanel(PANEL_ID);
    _searchToggleBtn = null;
    _searchVisible = false;

    /* Remove event listeners */
    if (_tabChangedListener) {
      window.removeEventListener("markable-tab-changed", _tabChangedListener);
      _tabChangedListener = null;
    }

    /* Cancel timers */
    if (_pollTimer !== null) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_searchTimer !== null) { clearTimeout(_searchTimer); _searchTimer = null; }
    if (_settingsSaveTimer !== null) { clearTimeout(_settingsSaveTimer); _settingsSaveTimer = null; }
    if (_fsDebounceTimer !== null) { clearTimeout(_fsDebounceTimer); _fsDebounceTimer = null; }

    /* Remove CSS */
    removeFileBrowserCSS();

    /* Reset all module-level state */
    _api = null;
    _panelContainer = null;
    _treeEl = null;
    _searchEl = null;
    _searchQuery = "";
    _currentTree = [];
    _isLoading = false;
    _expandedPaths = new Set();
    _lastKnownFile = null;
    _contextMenu = null;
    _contextMenuDismiss = null;
    _contextMenuEscHandler = null;
    _fsUnlisten = null;
    _fsDebounceTimer = null;
    _activeDragPath = null;
    /* _selectedFolderPath is already cleared above (after nulling the global). */
  },
};

// ── Test accessor ─────────────────────────────────────────────────────────────

/**
 * Testing-only accessor for module-level state.
 *
 * Allows unit tests to directly inspect and manipulate private state variables
 * without going through the full plugin lifecycle. Never use this in production
 * code outside of the test suite.
 */
export const _testing = {
  /** Set the panel container DOM element. */
  setPanelContainer(el: HTMLElement | null): void {
    _panelContainer = el;
  },
  /** Get the panel container (for assertions). */
  getPanelContainer(): HTMLElement | null {
    return _panelContainer;
  },
  /** Set the tree <ul> element. */
  setTreeEl(el: HTMLElement | null): void {
    _treeEl = el;
  },
  /** Get the tree <ul> element. */
  getTreeEl(): HTMLElement | null {
    return _treeEl;
  },
  /** Get the search input element. */
  getSearchEl(): HTMLInputElement | null {
    return _searchEl;
  },
  /** Set the search query. */
  setSearchQuery(q: string): void {
    _searchQuery = q;
  },
  /** Get the current search query. */
  getSearchQuery(): string {
    return _searchQuery;
  },
  /** Set the loading state flag. */
  setIsLoading(v: boolean): void {
    _isLoading = v;
  },
  /** Get the loading state flag. */
  getIsLoading(): boolean {
    return _isLoading;
  },
  /** Set the current tree. */
  setCurrentTree(nodes: TreeNode[]): void {
    _currentTree = nodes;
  },
  /** Get the current tree. */
  getCurrentTree(): TreeNode[] {
    return _currentTree;
  },
  /** Set expanded paths. */
  setExpandedPaths(paths: Set<string>): void {
    _expandedPaths = paths;
  },
  /** Get expanded paths. */
  getExpandedPaths(): Set<string> {
    return _expandedPaths;
  },
  /** Directly call renderPanel for testing. */
  renderPanel,
  /** Directly call updateActiveFileHighlight for testing. */
  updateActiveFileHighlight,
  /** Expose renderEmptyState for variant testing. */
  renderEmptyState,
  /** Check whether CSS is injected. */
  isCSSInjected(): boolean {
    return typeof document !== "undefined" && !!document.getElementById(STYLE_ID);
  },
  /** Set the enabled flag (needed by tests that call refreshVaultData directly). */
  setEnabled(v: boolean): void {
    _enabled = v;
  },
  /** Get the enabled flag. */
  getEnabled(): boolean {
    return _enabled;
  },
  /** Expose startInlineRename for testing. */
  startInlineRename,
  /** Expose startVaultInlineRename for testing (step_03). */
  startVaultInlineRename,
  /** Expose openNewVaultModal for testing (step_01). */
  openNewVaultModal,
  /** Expose buildVaultContextMenuItems for testing (step_04). */
  buildVaultContextMenuItems,
  /** Expose buildFileContextMenuItems for testing. */
  buildFileContextMenuItems,
  /** Expose showInlineCreateInput for testing. */
  showInlineCreateInput,
  /** Expose showInlineFolderCreateInput for testing. */
  showInlineFolderCreateInput,
  /** Expose buildInlineInputNode for testing. */
  buildInlineInputNode,
  /** Expose attachDragDropListeners for drag-to-move tests (step_02b). */
  attachDragDropListeners,
  /** Expose buildNodeEl for testing (step_02). */
  buildNodeEl,
  /** Expose attachVaultUnmountListener for testing (step_02). */
  attachVaultUnmountListener,
  /** Expose handleFsEvent for watcher debounce testing. */
  handleFsEvent,
  /** Get the current context menu element (null when none is open). */
  getContextMenu(): HTMLElement | null {
    return _contextMenu;
  },
  /** Expose closeContextMenu for testing. */
  closeContextMenu,
  /**
   * Expose showContextMenu for testing (EC-VUX-06: verify context menu is closed
   * when unmount button is clicked while the menu is open).
   */
  showContextMenu,
  /** Get the FS debounce timer handle (null when no pending event). */
  getFsDebounceTimer(): ReturnType<typeof setTimeout> | null {
    return _fsDebounceTimer;
  },

  /**
   * Directly set the module-level _selectedFolderPath variable.
   *
   * Used by tests to verify that getSelectedFolderPath() returns a non-null
   * path (FS-6). In production code, this variable is only written by the
   * folder-selection handler; the _testing accessor is the only way to set
   * it directly without simulating a full DOM interaction.
   *
   * @param path - The path to set, or null to clear the selection.
   */
  setSelectedFolderPath(path: string | null): void {
    _selectedFolderPath = path;
  },

  /**
   * Read the current _selectedFolderPath directly (mirrors the public
   * getSelectedFolderPath accessor but available before onEnable).
   */
  getSelectedFolderPath(): string | null {
    return _selectedFolderPath;
  },
};

export default plugin;

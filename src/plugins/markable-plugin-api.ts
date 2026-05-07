/**
 * Unified plugin API and interface types for Markable 2.0.
 *
 * This file defines the target type system introduced in the Unified Plugin System
 * refactor (docs/requirements/active_task.md). It coexists with the old types in
 * plugin-types.ts and user-plugin-types.ts during Chunks 1–2; the old files are
 * deleted in Chunk 4 (step_04c) once all consumers have migrated.
 *
 * Naming note: the new plugin interface is called `UnifiedPlugin` here (not
 * `MarkablePlugin`) to avoid a TypeScript collision with the existing `MarkablePlugin`
 * export in plugin-types.ts. It will be renamed to `MarkablePlugin` and replace the
 * old interface in step_02a.
 *
 * Key design decisions (from active_task.md):
 *   - Decision 1: addExtensions/removeExtensions are on the API; raw EditorView absent.
 *   - Decision 8: removeExtensions() is all-or-nothing per plugin id.
 *   - FR-1: all plugins (core and user) receive the same API object.
 *   - FR-2: version field is required; getExtensions/isEnabled/handlesOwnPersistence removed.
 */

import type { Extension } from "@codemirror/state";
import { readPluginSettings, writePluginSettings } from "../lib/bridge";
import {
  ensureStatusBar,
  hideStatusBarIfUnused,
  registerStatusBarDependent,
  unregisterStatusBarDependent,
} from "./status-bar/status-bar";
import { pluginManager } from "./index";
import {
  registerSidebarPanel as _registerSidebarPanel,
  unregisterSidebarPanel as _unregisterSidebarPanel,
  focusSidebarPanel as _focusSidebarPanel,
  toggleSidebarPanel as _toggleSidebarPanel,
} from "../sidebar";
import type { SidebarPanelDescriptor } from "../sidebar";
// tabManager import — used in openCustomRenderTab only. The import is at module
// scope (not deferred to the method body) because there is no circular dependency:
// tab-manager.ts does not import from markable-plugin-api.ts.
import { tabManager } from "../tabs/tab-manager";

// Re-export for plugin author convenience — plugins can import the type
// directly from this module without knowing the internal sidebar/ path.
export type { SidebarPanelDescriptor } from "../sidebar";

// ── Public API surface (FR-1) ─────────────────────────────────────────────────

/**
 * The API object injected into every plugin's onEnable / onDisable calls.
 *
 * This is the complete, intentional API surface available to plugins. The raw
 * EditorView, invoke(), and window.__TAURI_INTERNALS__ are NOT accessible
 * through this object (PC-3, Decision 1). Plugins interact with CM6 exclusively
 * through addExtensions / removeExtensions.
 *
 * The object is constructed by buildMarkablePluginAPI() and is specific to one
 * plugin id — the loadSettings/saveSettings closures capture pluginId, and the
 * addExtensions/removeExtensions closures delegate to PluginManager with pluginId.
 */
export interface MarkablePluginAPI {
  /**
   * Direct references to the three status bar zone DOM elements.
   * Plugins may append children to these elements; they MUST remove all
   * appended children in onDisable to avoid leaking DOM nodes across toggle cycles.
   */
  statusBar: {
    left: HTMLElement;
    center: HTMLElement;
    right: HTMLElement;
  };

  /**
   * Show the status bar. Safe to call multiple times — no-op if already visible.
   * Call this in onEnable if the plugin contributes content to any status bar zone.
   */
  ensureStatusBar(): void;

  /**
   * Hide the status bar if no registered plugin currently needs it.
   * Checks the internal STATUS_BAR_PLUGINS set in status-bar.ts.
   * Call this in onDisable after removing status bar content.
   */
  hideStatusBarIfUnused(): void;

  /**
   * Register this plugin as a status bar dependent.
   *
   * Call in onEnable when the plugin writes content to any status bar zone.
   * The STATUS_BAR_PLUGINS set in status-bar.ts tracks registered plugins so
   * that hideStatusBarIfUnused() only hides the bar when the set is empty.
   *
   * Idempotent — Set semantics prevent duplicate registrations (EC-3).
   *
   * Bug #3/#4 fix: the original API was missing this method. Without it, calling
   * hideStatusBarIfUnused() in onDisable would always hide the bar (the set was
   * always empty), and ensureStatusBar() could not track which plugins depend on it.
   */
  registerStatusBarDependent(): void;

  /**
   * Unregister this plugin as a status bar dependent.
   *
   * Call in onDisable, before hideStatusBarIfUnused(), so the bar hides only
   * when truly no plugin needs it. No-op if this plugin was not registered.
   *
   * Bug #3/#4 fix: counterpart to registerStatusBarDependent() — both are
   * needed to maintain correct STATUS_BAR_PLUGINS set membership across
   * toggle cycles.
   */
  unregisterStatusBarDependent(): void;

  /**
   * Load this plugin's persistent settings from disk.
   * Returns the parsed JSON object, or null if no settings file exists yet
   * (first run — EC-23). Never throws; returns null on any read error.
   *
   * Reads from: ~/Library/Application Support/com.markable.app/plugins/<pluginId>/settings.json
   */
  loadSettings(): Promise<Record<string, unknown> | null>;

  /**
   * Persist this plugin's settings to disk as JSON.
   * Rejects if data is not JSON-serialisable (EC-25 — Rust validates before write).
   *
   * Best practice: save eagerly on each user interaction, not only in onDisable,
   * because the window may close before onDisable completes (EC-26).
   *
   * Writes to: ~/Library/Application Support/com.markable.app/plugins/<pluginId>/settings.json
   */
  saveSettings(data: Record<string, unknown>): Promise<void>;

  /**
   * Register CM6 extensions for this plugin. The PluginManager stores these
   * extensions under the calling plugin's id and reconfigures the shared
   * Compartment immediately.
   *
   * Replaces any extensions previously registered by this plugin (idempotent
   * on repeated onEnable calls — toggle off then back on).
   *
   * EC-18: if called before the editor exists (should not happen under normal
   * startup — setEditorView is called before restoreAll), extensions are queued
   * and applied the moment setEditorView is called.
   *
   * CONTRACT: every plugin that calls addExtensions in onEnable MUST call
   * removeExtensions() in onDisable. Omitting removeExtensions leaves the
   * plugin's CM6 extensions active after disable — no runtime error, but
   * the editor behavior persists invisibly (EC-16).
   *
   * @param extensions  Array of CM6 Extension objects to register for this plugin.
   */
  addExtensions(extensions: Extension[]): void;

  /**
   * Remove all CM6 extensions previously registered by this plugin via
   * addExtensions(), then reconfigure the shared Compartment.
   *
   * Takes no arguments — removal is all-or-nothing per plugin id (Decision 8).
   * No-op if this plugin has not registered any extensions (EC-17).
   *
   * Call this from onDisable.
   */
  removeExtensions(): void;

  /**
   * Register a sidebar panel for this plugin. Call in onEnable.
   *
   * The panel appears in the sidebar slot specified by descriptor.side.
   * Idempotent: calling again with the same id logs a warning and is rejected
   * (the first registration stays active) — EC-12.
   *
   * descriptor.render(container) is called immediately after registration.
   * If render throws, an error placeholder is shown inside the container — EC-13.
   *
   * @param descriptor  Panel configuration. The id must be unique across all
   *                    registered panels in the session.
   */
  registerSidebarPanel(descriptor: SidebarPanelDescriptor): void;

  /**
   * Unregister the sidebar panel with the given id. Call in onDisable.
   *
   * Calls descriptor.destroy(container) before removing the panel DOM.
   * If destroy throws, the error is logged but DOM removal still proceeds — EC-14.
   *
   * No-op if panelId was not registered by this plugin — EC-19.
   *
   * @param panelId  The id from the original SidebarPanelDescriptor.
   */
  unregisterSidebarPanel(panelId: string): void;

  /**
   * Bring a registered panel into view: opens its sidebar side if closed and
   * makes it the active tab. No-op if panelId is not registered.
   *
   * @param panelId  The id from the original SidebarPanelDescriptor.
   */
  focusSidebarPanel(panelId: string): void;

  /**
   * Toggle a sidebar panel open/closed.
   *
   * Opens and focuses the panel when it is not the current active visible panel.
   * Closes the sidebar side when the panel is already the active visible panel.
   *
   * @param panelId  The id from the original SidebarPanelDescriptor.
   */
  toggleSidebarPanel(panelId: string): void;

  /**
   * Open a custom render tab in the main content area.
   *
   * Delegates to tabManager.openCustomRenderTab(). If a custom tab with the
   * same title already exists, it is replaced in-place (DC-07).
   *
   * renderFn is called synchronously within openCustomRenderTab — errors are
   * caught by TabManager and displayed as a fallback message (EC-15).
   *
   * @param title     Display title for the tab strip entry.
   * @param renderFn  Callback that receives the cleared host element and
   *                  populates it with HTML content.
   */
  openCustomRenderTab(title: string, renderFn: (container: HTMLElement) => void): void;

  /**
   * Disable then re-enable this plugin in a single async call.
   *
   * Useful for applying settings changes that require a full onEnable cycle
   * (e.g. switching toolbar mode). The caller should save new settings to disk
   * via saveSettings() BEFORE calling restartSelf() so that the subsequent
   * onEnable reads the updated values.
   */
  restartSelf(): Promise<void>;
}

// ── Plugin interface (FR-2) ───────────────────────────────────────────────────

/**
 * The unified plugin interface. Both core plugins (IIFE .js files in plugins/core/)
 * and user plugins (IIFE .js files in plugins/user/) must return an object matching
 * this interface from their IIFE body.
 *
 * Named `UnifiedPlugin` here to avoid collision with the existing `MarkablePlugin`
 * export in plugin-types.ts. Renamed to `MarkablePlugin` and replaces the old
 * interface in step_02a (Chunk 2).
 *
 * Removed relative to the old MarkablePlugin in plugin-types.ts:
 *   - getExtensions()          — replaced by api.addExtensions() in onEnable
 *   - restoreFromSettings()    — PluginManager handles restore uniformly (FR-5)
 *   - isEnabled()              — enabled state tracked by PluginManager, not plugins
 *   - handlesOwnPersistence    — no longer needed; all persistence is unified
 *
 * New relative to the old MarkablePlugin:
 *   - version: string          — required; semver recommended; displayed in panel
 *
 * Validated at load time by validatePlugin() in plugin-loader.ts (step_04a):
 *   - id:          non-empty string, no '/', '\', '.', or NUL
 *   - name:        non-empty string
 *   - description: non-empty string
 *   - version:     non-empty string (semver recommended, not enforced)
 *   - onEnable:    function
 *   - onDisable:   function
 *   - detail:      optional (falls back to description in panel if absent)
 */
export interface UnifiedPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly detail?: string;
  readonly version: string;
  /**
   * ID of the sidebar panel this plugin registers via api.registerSidebarPanel().
   *
   * When present, the Plugins Panel detail view renders a Left / Right assignment
   * toggle that lets the user reassign the panel to either sidebar slot.
   *
   * Omit this field for plugins that do not register a sidebar panel — the
   * detail view will simply not show the sidebar assignment section.
   */
  readonly sidebarPanelId?: string;
  /**
   * Optional hook called by the Plugins Panel when rendering the detail view for
   * this plugin. The plugin receives a `container` element and may append any
   * additional settings UI to it (e.g. a mode toggle row).
   *
   * Called every time the detail view is opened. The container is freshly created
   * on each call — no cleanup is needed. Must not throw; errors are silently
   * swallowed by the panel to avoid breaking the detail view for other plugins.
   */
  renderDetailExtra?: (container: HTMLElement) => void;
  onEnable(api: MarkablePluginAPI): void | Promise<void>;
  onDisable(api: MarkablePluginAPI): void | Promise<void>;
}

// ── API factory ───────────────────────────────────────────────────────────────

/**
 * Build the `MarkablePluginAPI` object for a specific plugin.
 *
 * The returned object captures `pluginId` in closures for:
 *   - loadSettings / saveSettings   — routes to plugins/<pluginId>/settings.json
 *   - addExtensions / removeExtensions — delegates to PluginManager with pluginId
 *
 * The statusBar zones are taken from `statusBarZones`, which come from the
 * PluginContext / DOM — the factory does not query the DOM itself.
 *
 * PC-3: The raw EditorView, invoke(), window.__TAURI_INTERNALS__, and all other
 * Markable internals are absent from the returned object. Only the listed
 * properties are present.
 *
 * Circular dependency note: this file imports `pluginManager` from `./index`;
 * `./index` will eventually import `buildMarkablePluginAPI` from this file in
 * step_04a. During Chunks 1–2 that second import does not yet exist, so there is
 * no circular dependency at this step. The same safety analysis as step_01a applies
 * for the future state — both cross-file accesses occur only inside method/function
 * bodies, never at module evaluation time.
 *
 * @param pluginId       The plugin's id. Captured in all closures.
 * @param statusBarZones Direct references to the three status bar zone elements.
 * @returns              A fully wired MarkablePluginAPI for this plugin.
 */
export function buildMarkablePluginAPI(
  pluginId: string,
  statusBarZones: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
): MarkablePluginAPI {
  return {
    statusBar: statusBarZones,

    ensureStatusBar,

    hideStatusBarIfUnused,

    /**
     * Register this plugin in STATUS_BAR_PLUGINS so that hideStatusBarIfUnused()
     * knows to keep the bar visible. The closure captures `pluginId`.
     */
    registerStatusBarDependent(): void {
      registerStatusBarDependent(pluginId);
    },

    /**
     * Unregister this plugin from STATUS_BAR_PLUGINS. After calling this,
     * hideStatusBarIfUnused() will hide the bar if no other plugin is registered.
     * The closure captures `pluginId`.
     */
    unregisterStatusBarDependent(): void {
      unregisterStatusBarDependent(pluginId);
    },

    /**
     * Loads plugin settings from disk. Returns null if none exist (EC-23) or
     * on any read error — never throws (callers do not need a try/catch).
     */
    async loadSettings(): Promise<Record<string, unknown> | null> {
      try {
        return await readPluginSettings(pluginId);
      } catch (err) {
        console.warn(`[Plugin:${pluginId}] loadSettings failed:`, err);
        return null;
      }
    },

    /**
     * Persists plugin settings to disk. Rejects if data is not JSON-serialisable
     * (EC-25 — Rust validates before writing the file).
     */
    async saveSettings(data: Record<string, unknown>): Promise<void> {
      await writePluginSettings(pluginId, data);
    },

    /**
     * Registers CM6 extensions, delegating to PluginManager with the captured
     * pluginId so the compartment is reconfigured under the right key.
     */
    addExtensions(extensions: Extension[]): void {
      pluginManager.addExtensions(pluginId, extensions);
    },

    /**
     * Removes all CM6 extensions for this plugin, delegating to PluginManager
     * with the captured pluginId. No-op if none are registered (EC-17).
     */
    removeExtensions(): void {
      pluginManager.removeExtensions(pluginId);
    },

    /**
     * Delegates to SidebarManager.register(), capturing pluginId in the
     * closure so the manager can enforce ownership on unregister (EC-19).
     */
    registerSidebarPanel(descriptor: SidebarPanelDescriptor): void {
      _registerSidebarPanel(pluginId, descriptor);
    },

    /**
     * Delegates to SidebarManager.unregister(), passing pluginId for
     * ownership verification — only the registering plugin may unregister
     * its own panels (EC-19).
     */
    unregisterSidebarPanel(panelId: string): void {
      _unregisterSidebarPanel(pluginId, panelId);
    },

    focusSidebarPanel(panelId: string): void {
      _focusSidebarPanel(panelId);
    },

    toggleSidebarPanel(panelId: string): void {
      _toggleSidebarPanel(panelId);
    },

    /**
     * Open a custom render tab by delegating to the TabManager singleton.
     * The tabManager import is at module scope (no circular dependency).
     */
    openCustomRenderTab(title: string, renderFn: (container: HTMLElement) => void): void {
      tabManager.openCustomRenderTab(title, renderFn);
    },

    /**
     * Restart this plugin: disable then re-enable via PluginManager.toggle.
     * The caller must save updated settings to disk before calling this so
     * the fresh onEnable reads the new values.
     */
    async restartSelf(): Promise<void> {
      await pluginManager.toggle(pluginId, false);
      await pluginManager.toggle(pluginId, true);
    },
  };
}

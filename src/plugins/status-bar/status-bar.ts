/**
 * Status bar infrastructure — shared by all plugins that use the status bar.
 *
 * This module owns:
 *   - The set of plugins currently using the status bar (STATUS_BAR_PLUGINS).
 *   - The ensureStatusBar() / hideStatusBarIfUnused() functions.
 *   - Registration API: call registerStatusBarDependent(id) from plugin.onEnable,
 *     and unregisterStatusBarDependent(id) from plugin.onDisable.
 *
 * EC-1: ensureStatusBar guards with ?. on getElementById so it is safe to call
 *       before the #statusbar DOM element exists.
 * EC-2: hideStatusBarIfUnused checks the size of STATUS_BAR_PLUGINS before hiding,
 *       so the bar stays visible while any dependent plugin is still enabled.
 * EC-3: registerStatusBarDependent uses Set.add() — duplicate calls are no-ops.
 */

import { updatePluginStates } from "../plugins-panel/plugins-panel";
import { updateSettings } from "../../lib/settings";

/** Internal visible state (mirrors the DOM). */
let _statusBarVisible = false;

/**
 * Plugins currently requiring the status bar. Set semantics prevent duplicates.
 * The set is dynamic: plugins add/remove themselves in onEnable/onDisable.
 * An empty set means no plugin needs the bar.
 */
const STATUS_BAR_PLUGINS = new Set<string>();

/**
 * Register a plugin as a status bar dependent.
 * Call from plugin.onEnable so the bar is kept visible while the plugin runs.
 * EC-3: idempotent — Set.add() ignores duplicate ids.
 *
 * @param id - Plugin id string (e.g. "wordCount").
 */
export function registerStatusBarDependent(id: string): void {
  STATUS_BAR_PLUGINS.add(id);
}

/**
 * Unregister a plugin as a status bar dependent.
 * Call from plugin.onDisable. After unregistering, hideStatusBarIfUnused()
 * should be called to conditionally hide the bar.
 *
 * @param id - Plugin id string previously passed to registerStatusBarDependent.
 */
export function unregisterStatusBarDependent(id: string): void {
  STATUS_BAR_PLUGINS.delete(id);
}

/**
 * Ensure the status bar is visible.
 * No-op if already visible. Safe to call multiple times (idempotent).
 * Also syncs the plugins panel so the Status Bar toggle reflects the auto-enable.
 *
 * EC-1: guards with optional chaining on #statusbar — safe before DOM exists.
 */
export function ensureStatusBar(): void {
  if (_statusBarVisible) return;
  _statusBarVisible = true;
  document.getElementById("statusbar")?.classList.remove("hidden");
  updatePluginStates({ statusBar: true });
  void updateSettings((s) => ({ ...s, statusBar: { visible: true } }));
}

/**
 * Hide the status bar if no dependent plugin is currently registered.
 * EC-2: checks STATUS_BAR_PLUGINS.size before hiding — bar stays visible
 *       while any plugin still needs it.
 */
export function hideStatusBarIfUnused(): void {
  if (STATUS_BAR_PLUGINS.size > 0) return;
  _statusBarVisible = false;
  document.getElementById("statusbar")?.classList.add("hidden");
  updatePluginStates({ statusBar: false });
  void updateSettings((s) => ({ ...s, statusBar: { visible: false } }));
}

/**
 * Read the current visibility state.
 * Used by StatusBarPlugin.isEnabled() to expose state without DOM access.
 */
export function getStatusBarVisible(): boolean {
  return _statusBarVisible;
}

/**
 * Directly set the internal visibility state.
 * Used by StatusBarPlugin.onEnable/onDisable and the legacy restore path.
 *
 * @param visible - New visibility state.
 */
export function setStatusBarVisible(visible: boolean): void {
  _statusBarVisible = visible;
}

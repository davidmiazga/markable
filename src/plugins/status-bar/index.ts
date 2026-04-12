/**
 * Status Bar Plugin.
 *
 * Manages the status bar's visibility. Other plugins (e.g. Word Count) depend
 * on it by calling registerStatusBarDependent/unregisterStatusBarDependent.
 *
 * restoreFromSettings: checks settings.statusBar?.visible (not settings.statusBar,
 * which is an object, not a boolean). This is the only plugin whose settings key
 * holds an object rather than a boolean.
 *
 * EC-12: onDisable calls hideStatusBarIfUnused() rather than forcing the bar
 * hidden. This preserves the bar when Word Count (or another dependent) is
 * still enabled.
 */

import "./status-bar.css";
import {
  hideStatusBarIfUnused,
  getStatusBarVisible,
  setStatusBarVisible,
} from "./status-bar";
import { updateSettings } from "../../lib/settings";
import type { MarkablePlugin, PluginContext } from "../plugin-types";
import type { MarkableSettings } from "../../lib/settings";

export const StatusBarPlugin: MarkablePlugin = {
  id: "statusBar",
  name: "Status Bar",
  description: "Show a status bar at the bottom of the editor",
  detail:
    "Adds a status bar at the bottom of the editor window. Other plugins (like Word Count) display their information here. The bar is hidden when no plugins use it.",

  // Status Bar has no CM6 extensions — it is purely a DOM element.
  // getExtensions is intentionally omitted.

  /**
   * Prevents PluginManager.toggle() from issuing a second updateSettings call
   * that would write `{ statusBar: true }` (a plain boolean), overwriting the
   * structured `{ statusBar: { visible: true } }` object that this plugin
   * persists in onEnable/onDisable. Without this flag, the next app launch
   * would read `settings.statusBar?.visible === undefined` and the status bar
   * would never restore.
   */
  handlesOwnPersistence: true,

  /**
   * Show the status bar and persist the visible state.
   * Uses setStatusBarVisible directly rather than ensureStatusBar so the
   * explicit user action bypasses the already-visible guard.
   *
   * @param ctx - Plugin context (unused by this plugin).
   */
  onEnable(_ctx: PluginContext): void {
    setStatusBarVisible(true);
    document.getElementById("statusbar")?.classList.remove("hidden");
    void updateSettings((s) => ({ ...s, statusBar: { visible: true } }));
  },

  /**
   * Attempt to hide the status bar.
   * EC-12: calls hideStatusBarIfUnused() so the bar is only hidden when no
   * other plugin (e.g. Word Count) still needs it.
   *
   * @param ctx - Plugin context (unused by this plugin).
   */
  onDisable(_ctx: PluginContext): void {
    hideStatusBarIfUnused();
    // Persist the actual resulting visibility rather than blindly writing false.
    // If hideStatusBarIfUnused() kept the bar visible (Word Count still on),
    // this correctly persists true.
    void updateSettings((s) => ({
      ...s,
      statusBar: { visible: getStatusBarVisible() },
    }));
  },

  /**
   * Restore status bar visibility from persisted settings during app init.
   * settings.statusBar is an object { visible: boolean }, not a plain boolean,
   * so we must access .visible explicitly.
   *
   * @param settings - Persisted application settings.
   * @param ctx      - Plugin context (unused by this plugin).
   */
  restoreFromSettings(settings: MarkableSettings, _ctx: PluginContext): void {
    if (settings.statusBar?.visible === true) {
      this.onEnable(_ctx);
    } else {
      // Leave status bar hidden (the default). Do not call onDisable.
      setStatusBarVisible(false);
    }
  },

  /**
   * Returns whether the status bar is currently visible.
   * Reads from the module-level flag rather than the DOM.
   */
  isEnabled(): boolean {
    return getStatusBarVisible();
  },
};

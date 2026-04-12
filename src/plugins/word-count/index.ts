/**
 * Word Count Plugin.
 *
 * Displays live word/character count in the center zone of the status bar.
 * Requires the Status Bar plugin to be visible.
 *
 * Note: scheduleUpdate (exported from word-count.ts) continues to be called
 * directly from main.ts's CM6 updateListener. This is intentional — the update
 * pathway is performance-sensitive and adding indirection via the plugin manager
 * would be over-engineering for no gain.
 */

import type { MarkablePlugin, PluginContext } from "../plugin-types";
import type { MarkableSettings } from "../../lib/settings";
import {
  enableWordCount,
  disableWordCount,
  isWordCountEnabled,
} from "./word-count";
import {
  registerStatusBarDependent,
  unregisterStatusBarDependent,
} from "../status-bar/status-bar";

export const WordCountPlugin: MarkablePlugin = {
  id: "wordCount",
  name: "Word Count",
  description: "Word and character count in the status bar",
  detail:
    "Displays a live word count and character count in the status bar. Updates as you type. Shows selection count when text is selected.",

  // No CM6 extensions — word count reads from updateListener in main.ts.
  // getExtensions is intentionally omitted.

  /**
   * Enable word count: attach display to the status bar center zone,
   * ensure the bar is visible, and register as a status bar dependent.
   *
   * @param ctx - Runtime context providing statusBar zone elements
   *              and the ensureStatusBar helper.
   */
  onEnable(ctx: PluginContext): void {
    enableWordCount(ctx.statusBar.center);
    ctx.ensureStatusBar();
    registerStatusBarDependent("wordCount");
  },

  /**
   * Disable word count: clear the display, unregister from status bar,
   * and conditionally hide the bar if no other plugin needs it.
   *
   * @param ctx - Runtime context providing the hideStatusBarIfUnused helper.
   */
  onDisable(ctx: PluginContext): void {
    disableWordCount();
    unregisterStatusBarDependent("wordCount");
    ctx.hideStatusBarIfUnused();
  },

  /**
   * Restore word count state from persisted settings during app init.
   * EC-15: Sets enabled state via onEnable before returning.
   *
   * @param settings - Persisted application settings.
   * @param ctx      - Runtime context (passed through to onEnable).
   */
  restoreFromSettings(settings: MarkableSettings, ctx: PluginContext): void {
    if (settings.wordCount === true) {
      this.onEnable(ctx);
    }
    // If false/undefined, leave disabled. isWordCountEnabled() returns false by default.
  },

  /**
   * Returns whether word count is currently enabled.
   * Reads from the module-level flag in word-count.ts.
   */
  isEnabled(): boolean {
    return isWordCountEnabled();
  },
};

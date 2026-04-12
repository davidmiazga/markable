/**
 * Focus Mode Plugin — iA Writer-style paragraph dimming.
 *
 * Dims all lines except the paragraph/block containing the cursor.
 * The CM6 extension is always registered in the editor (via getExtensions()).
 * The `focusModeField` StateField defaults to false; toggling it via
 * `setFocusMode` StateEffect is the only way to enable/disable.
 *
 * EC-4: The extension is registered before onEnable is ever called. The
 * StateField defaults to false so no visual dimming occurs until the effect
 * is dispatched by onEnable.
 */

import "./focus-mode.css";
import type { Extension } from "@codemirror/state";
import { focusModeExtension, setFocusMode } from "./focus-mode";
import type { MarkablePlugin, PluginContext, MarkableSettings } from "../plugin-types";

/**
 * Module-level enabled flag. Mutable state lives here, not on the plugin
 * object, per the MarkablePlugin convention.
 */
let _enabled = false;

export const FocusModePlugin: MarkablePlugin = {
  id: "focusMode",
  name: "Focus Mode",
  description: "Dim all content except the current paragraph",
  detail:
    "Dims all lines except the paragraph containing your cursor, helping you focus on what you're writing. The active paragraph stays at full opacity while everything else fades. Works at the paragraph/block level — code fences and list items are treated as single blocks.",

  /**
   * Returns the CM6 extensions this plugin contributes to the editor.
   * Pure and idempotent — no DOM access, no side effects.
   * The focusModeField StateField is always present in the editor so the
   * effect dispatch in onEnable/onDisable is always valid.
   */
  getExtensions(): Extension[] {
    return [focusModeExtension];
  },

  /**
   * Enable focus mode: set internal flag and dispatch the StateEffect.
   * @param ctx - Runtime context containing the live EditorView.
   */
  onEnable(ctx: PluginContext): void {
    _enabled = true;
    ctx.editor.dispatch({ effects: setFocusMode.of(true) });
  },

  /**
   * Disable focus mode: clear internal flag and dispatch the StateEffect.
   * @param ctx - Runtime context containing the live EditorView.
   */
  onDisable(ctx: PluginContext): void {
    _enabled = false;
    ctx.editor.dispatch({ effects: setFocusMode.of(false) });
  },

  /**
   * Restore focus mode state from persisted settings during app initialization.
   * EC-15: Sets _enabled via onEnable before returning so isEnabled() is accurate.
   * @param settings - Persisted application settings.
   * @param ctx      - Runtime context containing the live EditorView.
   */
  restoreFromSettings(settings: MarkableSettings, ctx: PluginContext): void {
    if (settings.focusMode === true) {
      this.onEnable(ctx);
    } else {
      // Explicitly set to false (default) so isEnabled() is reliable even
      // if this method is called multiple times.
      _enabled = false;
    }
  },

  /**
   * Returns the current enabled state as tracked by the module-level flag.
   * Does not read from the CM6 StateField to avoid requiring an editor reference.
   */
  isEnabled(): boolean {
    return _enabled;
  },
};

/**
 * Typewriter Mode Plugin — keep the cursor line vertically centered.
 *
 * The CM6 extension is always registered (via getExtensions()). The
 * typewriterModeField StateField defaults to false; toggling via
 * setTypewriterMode StateEffect enables/disables behavior.
 *
 * No CSS file — typewriter mode uses imperative inline padding on contentDOM,
 * not CSS classes. See typewriter-mode.ts updatePadding().
 */

import type { Extension } from "@codemirror/state";
import { typewriterModeExtension, setTypewriterMode } from "./typewriter-mode";
import type { MarkablePlugin, PluginContext } from "../plugin-types";
import type { MarkableSettings } from "../../lib/settings";

/** Module-level enabled flag. Mutable state lives here, not on the plugin object. */
let _enabled = false;

export const TypewriterModePlugin: MarkablePlugin = {
  id: "typewriterMode",
  name: "Typewriter Mode",
  description: "Keep the cursor line vertically centered",
  detail:
    "Keeps the line you're typing on vertically centered in the viewport, like a typewriter. Allows blank space above and below at document edges so the cursor is always in the middle of the screen. Can be combined with Focus Mode.",

  /**
   * Returns the CM6 extensions this plugin contributes to the editor.
   * Pure and idempotent — no DOM access, no side effects.
   * The typewriterModeField StateField is always present in the editor so the
   * effect dispatch in onEnable/onDisable is always valid.
   */
  getExtensions(): Extension[] {
    return [typewriterModeExtension];
  },

  /**
   * Enable typewriter mode: set internal flag and dispatch the StateEffect.
   *
   * @param ctx - Runtime context containing the live EditorView.
   */
  onEnable(ctx: PluginContext): void {
    _enabled = true;
    ctx.editor.dispatch({ effects: setTypewriterMode.of(true) });
  },

  /**
   * Disable typewriter mode: clear internal flag and dispatch the StateEffect.
   *
   * @param ctx - Runtime context containing the live EditorView.
   */
  onDisable(ctx: PluginContext): void {
    _enabled = false;
    ctx.editor.dispatch({ effects: setTypewriterMode.of(false) });
  },

  /**
   * Restore typewriter mode state from persisted settings during app init.
   * EC-15: Sets _enabled via onEnable before returning so isEnabled() is accurate.
   *
   * @param settings - Persisted application settings.
   * @param ctx      - Runtime context containing the live EditorView.
   */
  restoreFromSettings(settings: MarkableSettings, ctx: PluginContext): void {
    if (settings.typewriterMode === true) {
      this.onEnable(ctx);
    } else {
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

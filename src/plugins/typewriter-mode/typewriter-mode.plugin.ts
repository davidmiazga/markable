/**
 * IIFE entry point for the Typewriter Mode core plugin.
 *
 * Compiled by vite.plugins.config.ts into:
 *   src-tauri/plugins/core/typewriter-mode.js
 *
 * Evaluated at runtime via: new Function(source + "\nreturn __markablePlugin__;")()
 *
 * Self-containment rules: only @codemirror/* imports allowed; no app-internal modules.
 * No CSS to inject — typewriter mode controls editor layout via contentDOM padding.
 * The `import type` for MarkablePluginAPI is erased by tsc; no runtime code emitted.
 *
 * CM6 extension logic is duplicated from typewriter-mode.ts to keep the IIFE
 * fully self-contained. The original file remains unchanged.
 *
 * EC-30, EC-31, EC-32: see focus-mode.plugin.ts for full EC rationale.
 */

import {
  StateField,
  StateEffect,
  type Extension,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── CM6 extension ─────────────────────────────────────────────────────────────
// Duplicated from src/editor/typewriter-mode.ts. Original file is NOT modified.

/** StateEffect that enables or disables typewriter mode. */
const setTypewriterMode = StateEffect.define<boolean>();

/**
 * StateField that tracks whether typewriter mode is active.
 * Defaults to false — no centering until the effect fires.
 * PluginManager._enablePlugin (step_04a) dispatches setTypewriterMode.of(true)
 * through the live EditorView after addExtensions completes.
 */
const typewriterModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setTypewriterMode)) return e.value;
    }
    return value;
  },
});

/**
 * Adjust the contentDOM padding so the cursor line is vertically centered.
 *
 * When enabled: sets paddingTop and paddingBottom to half the editor height
 * so the first and last lines can scroll to the middle of the viewport.
 * When disabled: clears both padding values to restore normal layout.
 *
 * @param view    - The live EditorView.
 * @param enabled - Whether typewriter mode is being turned on or off.
 */
function updatePadding(view: EditorView, enabled: boolean): void {
  const content = view.contentDOM;
  if (enabled) {
    // Half the editor container height gives the cursor room to reach center.
    const halfHeight = Math.round(view.dom.clientHeight / 2);
    content.style.paddingTop = `${halfHeight}px`;
    content.style.paddingBottom = `${halfHeight}px`;
  } else {
    // Clear inline padding so the stylesheet values take over.
    content.style.paddingTop = "";
    content.style.paddingBottom = "";
  }
}

/**
 * UpdateListener that scrolls the cursor to vertical center on every edit or
 * selection change when typewriter mode is active. Also updates padding when
 * the mode is toggled on/off.
 */
const typewriterUpdateListener = EditorView.updateListener.of(
  (update: ViewUpdate) => {
    const enabled = update.state.field(typewriterModeField);
    const wasEnabled = update.startState.field(typewriterModeField);
    // Update padding immediately when the mode flag changes.
    if (enabled !== wasEnabled) {
      updatePadding(update.view, enabled);
    }
    if (!enabled) return;
    const modeToggled = enabled !== wasEnabled;
    // No need to scroll if nothing changed (avoids spurious dispatches).
    if (!update.docChanged && !update.selectionSet && !modeToggled) return;
    // Scroll the cursor position to vertical center of the viewport.
    const head = update.state.selection.main.head;
    update.view.dispatch({
      effects: EditorView.scrollIntoView(head, { y: "center" }),
    });
  },
);

/**
 * ViewPlugin that watches for editor resize events and recalculates the padding
 * when the container changes size (e.g. window resize, panel open/close).
 *
 * Uses ResizeObserver on the editor's host DOM element and cleans up the
 * observer in its destroy() hook to prevent memory leaks (EC-16).
 */
const resizePlugin = ViewPlugin.define((view) => {
  const observer = new ResizeObserver(() => {
    const enabled = view.state.field(typewriterModeField);
    if (enabled) updatePadding(view, true);
  });
  observer.observe(view.dom);
  return {
    destroy() {
      observer.disconnect();
    },
  };
});

/**
 * Combined CM6 extension: StateField (tracks enabled state), updateListener
 * (scrolls cursor to center on each update), and resizePlugin (maintains
 * correct padding across container size changes).
 */
const typewriterModeExtension: Extension = [
  typewriterModeField,
  typewriterUpdateListener,
  resizePlugin,
];

// ── Plugin object ─────────────────────────────────────────────────────────────

/**
 * UnifiedPlugin definition for Typewriter Mode.
 *
 * onEnable: registers the CM6 extension via the API.
 *   The StateField defaults to false (no centering) until PluginManager._enablePlugin
 *   (step_04a) dispatches setTypewriterMode.of(true) through the EditorView.
 *
 * onDisable: removes all CM6 extensions. The removeCSS step is not needed here
 *   because typewriter mode uses only inline padding on contentDOM — no CSS injection.
 */
export default {
  id: "typewriter-mode",
  name: "Typewriter Mode",
  version: "1.0.0",
  description: "Keep the cursor line vertically centered",
  detail:
    "Keeps the line you're typing on vertically centered in the viewport, like a typewriter. Allows blank space above and below at document edges so the cursor is always in the middle of the screen. Can be combined with Focus Mode.",

  onEnable(api: MarkablePluginAPI): void {
    api.addExtensions([typewriterModeExtension]);
    // The StateField defaults to false after compartment registration.
    // PluginManager._enablePlugin (step_04a) dispatches setTypewriterMode.of(true)
    // through the live EditorView after this call returns.
  },

  onDisable(api: MarkablePluginAPI): void {
    api.removeExtensions();
  },
};

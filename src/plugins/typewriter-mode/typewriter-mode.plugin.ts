/**
 * IIFE entry point for the Typewriter Mode core plugin.
 *
 * Compiled by vite.plugins.config.ts into:
 *   src-tauri/plugins/core/typewriter-mode.js
 *
 * Evaluated at runtime via: new Function(source + "\nreturn __markablePlugin__;")()
 *
 * Self-containment rules: only @codemirror/view import allowed; no app-internal modules.
 * No CSS to inject — typewriter mode controls editor layout via contentDOM padding.
 * The `import type` for MarkablePluginAPI is erased by tsc; no runtime code emitted.
 *
 * CM6 extension logic is duplicated from typewriter-mode.ts to keep the IIFE
 * fully self-contained. The original file remains unchanged.
 *
 * Bug #2 fix: The original implementation wrapped the centering logic in a StateField
 * that defaulted to false and required a StateEffect to activate. PluginManager never
 * dispatched that effect (step_04a was never reached), so the cursor never centered.
 *
 * The fix removes the StateField/StateEffect toggle entirely. The compartment provided
 * by PluginManager is the on/off mechanism: when the plugin is enabled, api.addExtensions
 * installs the extensions; when disabled, api.removeExtensions removes them. The
 * updateListener therefore always scrolls the cursor to center when installed.
 *
 * EC-30, EC-31, EC-32: see focus-mode.plugin.ts for full EC rationale.
 */

// Bug #5 fix: DO NOT import from @codemirror/* directly. The build marks all
// @codemirror/* packages as external. At runtime, main.ts assigns the real CM6
// module objects to window globals (cm-globals.ts) before any plugin IIFE runs.
// Destructuring from those globals ensures this plugin shares the SAME ViewPlugin
// and EditorView namespace as the main editor.
/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  EditorView,
  ViewPlugin,
} = (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
/* eslint-enable @typescript-eslint/no-explicit-any */

// Type-only import — erased by tsc, safe for IDE support.
import type { ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── CM6 extension ─────────────────────────────────────────────────────────────
// Duplicated from src/editor/typewriter-mode.ts. Original file is NOT modified.
//
// Bug #2 fix: No StateField or StateEffect. The updateListener always scrolls
// the cursor to center when the extension is present in the compartment.
// The compartment is the on/off switch.

/**
 * Adjust the contentDOM padding so the cursor line is vertically centered.
 *
 * When called on enable: sets paddingTop and paddingBottom to half the editor
 * height so the first and last lines can scroll to the middle of the viewport.
 * When called on disable: clears both padding values to restore normal layout.
 *
 * @param view    - The live EditorView.
 * @param enabled - True to apply centering padding; false to clear it.
 */
function updatePadding(view: InstanceType<typeof EditorView>, enabled: boolean): void {
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
 * selection change. Installed via api.addExtensions() so it only runs when the
 * plugin is enabled (compartment is the on/off switch — Bug #2 fix).
 *
 * No internal boolean guard — if the extension is in the compartment, it runs.
 */
const typewriterUpdateListener = EditorView.updateListener.of(
  (update: ViewUpdate) => {
    // No need to scroll if nothing changed (avoids spurious dispatches).
    if (!update.docChanged && !update.selectionSet) return;
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
 * Applies centering padding immediately on construction so the layout is correct
 * from the first frame after the plugin is enabled. Clears padding on destroy so
 * the editor layout is restored cleanly when the plugin is disabled.
 *
 * Uses ResizeObserver on the editor's host DOM element and cleans up the
 * observer in its destroy() hook to prevent memory leaks (EC-16).
 */
const resizePlugin = ViewPlugin.define((view) => {
  // Apply centering padding immediately when the plugin is installed.
  updatePadding(view, true);

  const observer = new ResizeObserver(() => {
    // Recalculate half-height whenever the container resizes.
    updatePadding(view, true);
  });
  observer.observe(view.dom);

  return {
    destroy() {
      observer.disconnect();
      // Clear padding on teardown so the editor returns to normal layout.
      updatePadding(view, false);
    },
  };
});

/**
 * Combined CM6 extension: the updateListener (scrolls cursor to center on each
 * edit/selection change) and the resizePlugin (maintains correct padding across
 * container size changes and handles initial padding application/cleanup).
 *
 * No StateField needed — the compartment handles enable/disable (Bug #2 fix).
 */
const typewriterModeExtension = [
  typewriterUpdateListener,
  resizePlugin,
];

// ── Plugin object ─────────────────────────────────────────────────────────────

/**
 * UnifiedPlugin definition for Typewriter Mode.
 *
 * onEnable: registers the CM6 extensions via api.addExtensions(). The resizePlugin
 *   applies contentDOM padding immediately on construction. The updateListener
 *   starts scrolling the cursor to center on every edit. No effect dispatch needed.
 *
 * onDisable: removes all CM6 extensions. The resizePlugin.destroy() hook clears
 *   contentDOM padding, restoring the normal editor layout.
 */
export default {
  id: "typewriter-mode",
  name: "Typewriter Mode",
  version: "1.0.0",
  description: "Keep the cursor line vertically centered",
  detail:
    "Keeps the line you're typing on vertically centered in the viewport, like a typewriter. Allows blank space above and below at document edges so the cursor is always in the middle of the screen. Can be combined with Focus Mode.",

  onEnable(api: MarkablePluginAPI): void {
    // Register the updateListener and resizePlugin. The compartment is the on/off
    // switch — no StateField or StateEffect needed (Bug #2 fix).
    api.addExtensions(typewriterModeExtension);
  },

  onDisable(api: MarkablePluginAPI): void {
    // removeExtensions triggers resizePlugin.destroy(), which clears the padding.
    api.removeExtensions();
  },
};

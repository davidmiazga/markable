/**
 * IIFE entry point for the Status Bar core plugin.
 *
 * Compiled by vite.plugins.config.ts into:
 *   src-tauri/plugins/core/status-bar.js
 *
 * Evaluated at runtime via: new Function(source + "\nreturn __markablePlugin__;")()
 *
 * Self-containment rules: no @codemirror imports needed; no app-internal modules.
 * CSS is injected as a <style> tag as a safety net — the full theme-aware rules
 * live in the main app bundle's status-bar.css. This injection ensures the status
 * bar is functional even if the IIFE runs before the app CSS is parsed.
 * The `import type` for MarkablePluginAPI is erased by tsc; no runtime code emitted.
 *
 * Note on `handlesOwnPersistence`:
 *   The old static StatusBarPlugin set `handlesOwnPersistence: true` to prevent
 *   writing a boolean over the structured `{ statusBar: { visible: true } }` object.
 *   This IIFE version does not need that flag — the new unified PluginManager (step_04a)
 *   persists state under `plugins["status-bar"].enabled: boolean`, never touching the
 *   old `statusBar` key.
 *
 * EC-30, EC-31, EC-32: see focus-mode.plugin.ts for full EC rationale.
 */

import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── Inline CSS ────────────────────────────────────────────────────────────────
// Safety net in case this IIFE runs before the main app CSS is loaded.
// The full, theme-aware CSS lives in status-bar.css in the main app bundle.
// These rules are minimal — enough for the bar to display correctly at all times.

/**
 * Inject the minimal status-bar CSS into the document <head>.
 * No-op if already injected (identified by the unique element id).
 */
function injectCSS(): void {
  const id = "__markable_status_bar_css__";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  // Only the structural rules needed for the bar to function.
  // Theme variables (colors, fonts) come from the app bundle's status-bar.css.
  style.textContent = `
    #statusbar { display: flex; align-items: center; height: 24px; }
    #statusbar.hidden { display: none; }
    .statusbar-left, .statusbar-center, .statusbar-right { flex: 1; }
    .statusbar-center { text-align: center; }
    .statusbar-right { text-align: right; }
  `;
  document.head.appendChild(style);
}

// ── Plugin object ─────────────────────────────────────────────────────────────

/**
 * UnifiedPlugin definition for Status Bar.
 *
 * This plugin has no CM6 extensions — it is purely a DOM-visibility controller.
 * Other plugins (e.g. Word Count) write content into the status bar zones via
 * the MarkablePluginAPI.statusBar.* elements. This plugin's job is only to
 * ensure the bar DOM element exists and is visible when enabled.
 *
 * onEnable: injects safety CSS and calls ensureStatusBar() to make the bar visible.
 * onDisable: calls hideStatusBarIfUnused() — the bar hides only if no other plugin
 *   needs it (the API checks the STATUS_BAR_PLUGINS set in status-bar.ts).
 */
export default {
  id: "status-bar",
  name: "Status Bar",
  version: "1.0.0",
  description: "Show a status bar at the bottom of the editor",
  detail:
    "Adds a status bar at the bottom of the editor window. Other plugins (like Word Count) display their information here. The bar is hidden when no plugins use it.",

  onEnable(api: MarkablePluginAPI): void {
    injectCSS();
    api.ensureStatusBar();
  },

  onDisable(api: MarkablePluginAPI): void {
    api.hideStatusBarIfUnused();
  },
};

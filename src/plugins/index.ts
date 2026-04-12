/**
 * PluginManager — central registry for Markable FC2 plugins.
 *
 * Plugins are registered in the constructor in display order (the order they
 * appear in the Plugins panel). Adding a new plugin requires only:
 *   1. Create src/plugins/<name>/index.ts implementing MarkablePlugin.
 *   2. Import it here and add it to the `this.plugins` array.
 *   3. Zero changes to main.ts.
 *
 * The `pluginManager` singleton is module-level. It is instantiated before the
 * editor exists. Therefore:
 *   - The constructor must not access the DOM.
 *   - `getExtensions()` must not access the DOM (it is called before editor creation).
 *   - `toggle()` and `restoreAll()` receive a PluginContext and may access the DOM.
 *
 * EC-8: Constructor and getExtensions() are DOM-free by design.
 * EC-9: pluginManager is a module-level const, so ES module resolution guarantees
 *       it is non-null before any importing code runs.
 */

import type { Extension } from "@codemirror/state";
import type { MarkablePlugin, PluginContext, PluginDef } from "./plugin-types";
import type { MarkableSettings } from "../lib/settings";
import { updateSettings } from "../lib/settings";

// --- Plugin imports (add new plugins here for future plugins) ---
import { WordCountPlugin } from "./word-count/index";
import { StatusBarPlugin } from "./status-bar/index";
import { FocusModePlugin } from "./focus-mode/index";
import { TypewriterModePlugin } from "./typewriter-mode/index";

export class PluginManager {
  private plugins: MarkablePlugin[];

  constructor() {
    // Registration order controls display order in the Plugins panel.
    // Adding a new plugin requires only: create src/plugins/<name>/index.ts
    // and add it to this array. Zero changes to main.ts.
    this.plugins = [
      WordCountPlugin,
      StatusBarPlugin,
      FocusModePlugin,
      TypewriterModePlugin,
    ];
  }

  /**
   * Aggregate CM6 extensions from all plugins that declare getExtensions().
   * Called once during buildExtensions() in extensions.ts before editor creation.
   *
   * Pure — no side effects, no DOM access. Safe to call before the editor exists.
   *
   * @returns Flat array of all plugin-contributed CM6 Extension objects.
   */
  getExtensions(): Extension[] {
    const exts: Extension[] = [];
    for (const plugin of this.plugins) {
      if (plugin.getExtensions) {
        exts.push(...plugin.getExtensions());
      }
    }
    return exts;
  }

  /**
   * Enable or disable a plugin by id.
   * Calls onEnable/onDisable and — unless the plugin sets handlesOwnPersistence —
   * persists the new state via a generic `{ [id]: boolean }` updateSettings call.
   *
   * Plugins whose settings key holds a non-boolean value (e.g. StatusBarPlugin
   * with `statusBar: { visible: boolean }`) must set `handlesOwnPersistence: true`
   * so that this generic call is skipped and their own onEnable/onDisable persist
   * logic runs without being overwritten.
   *
   * @param id      Plugin id — must match a registered plugin's id.
   * @param enabled Target enabled state.
   * @param ctx     PluginContext from buildPluginContext() in main.ts.
   *                Must be non-null (only call after editor is created).
   */
  toggle(id: string, enabled: boolean, ctx: PluginContext): void {
    const plugin = this.plugins.find((p) => p.id === id);
    if (!plugin) {
      console.warn(`PluginManager.toggle: unknown plugin id "${id}"`);
      return;
    }
    if (enabled) {
      plugin.onEnable(ctx);
    } else {
      plugin.onDisable(ctx);
    }
    // Skip the generic boolean persist when the plugin declares it handles its
    // own persistence. This prevents overwriting a structured settings value
    // (e.g. `statusBar: { visible: true }`) with a plain boolean
    // (`statusBar: true`), which would cause `settings.statusBar?.visible` to
    // return `undefined` on the next launch.
    if (plugin.handlesOwnPersistence) return;
    void updateSettings((s) => ({
      ...s,
      [id]: enabled,
    }));
  }

  /**
   * Restore all plugins from persisted settings. Called once during initApp()
   * after the editor is created.
   *
   * For each plugin:
   *   - If restoreFromSettings() is defined, delegates to it entirely (the plugin
   *     owns the full restore logic, including setting _enabled).
   *   - Otherwise, applies the default: enable if settings[plugin.id] === true.
   *     If false/undefined, _enabled stays at its initialized default (false).
   *
   * EC-15: Each plugin's restoreFromSettings (or its onEnable called here) must
   * update _enabled before returning so isEnabled() returns accurate state.
   *
   * @param settings  Persisted application settings loaded from disk.
   * @param ctx       PluginContext built after the editor is created.
   */
  restoreAll(settings: MarkableSettings, ctx: PluginContext): void {
    for (const plugin of this.plugins) {
      if (plugin.restoreFromSettings) {
        // Plugin owns its own restore logic (handles complex settings shapes).
        plugin.restoreFromSettings(settings, ctx);
      } else {
        // Default path: simple boolean check against the settings key.
        const settingsValue = (settings as Record<string, unknown>)[plugin.id];
        if (settingsValue === true) {
          plugin.onEnable(ctx);
        }
        // If false/undefined: _enabled stays false (its initialized default).
        // We do not call onDisable here because the plugin was never enabled.
      }
    }
  }

  /**
   * Returns a snapshot of all registered plugins' enabled states.
   * Used by togglePluginsPanel() to seed the panel's internal state object
   * and by handleAction() to read current state before toggling.
   *
   * @returns Record mapping plugin id to its current isEnabled() value.
   */
  getStates(): Record<string, boolean> {
    const states: Record<string, boolean> = {};
    for (const plugin of this.plugins) {
      states[plugin.id] = plugin.isEnabled();
    }
    return states;
  }

  /**
   * Returns PluginDef[] for the registered plugins, in registration order.
   * Used by createPluginsPanel() as the data source for list rendering.
   *
   * @returns Array of minimal plugin descriptors for panel rendering.
   */
  getDefinitions(): PluginDef[] {
    return this.plugins.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      detail: p.detail,
    }));
  }
}

/**
 * Module-level singleton. Instantiated before the editor exists.
 * EC-9: ES module resolution guarantees this is non-null when imported.
 */
export const pluginManager = new PluginManager();

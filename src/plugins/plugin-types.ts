/**
 * Plugin system type definitions for Markable 2.0.
 *
 * These interfaces are the contract between the PluginManager and each
 * individual plugin module. A plugin is a `const` object literal implementing
 * `MarkablePlugin` — not a class instance. This convention enables future
 * user-created plugins that are plain JS objects.
 *
 * Key invariants (enforced by convention, not the type system):
 *   - `id` must equal the corresponding key in `MarkableSettings` (e.g. "focusMode").
 *   - `getExtensions()` must be pure and idempotent — no side effects, same
 *     result on every call. It is invoked once during editor initialization.
 *   - `isEnabled()` reads from a module-level `let _enabled` flag maintained
 *     by each plugin's `onEnable`/`onDisable`/`restoreFromSettings`.
 */

import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { MarkableSettings } from "../lib/settings";

// Re-export so consumers only need one import location.
export type { MarkableSettings };

/**
 * Runtime context passed to every plugin lifecycle method.
 * Constructed by `buildPluginContext()` in `main.ts` after the editor is created.
 * Never passed before the editor is non-null.
 */
export interface PluginContext {
  /** The live CodeMirror EditorView instance. */
  editor: EditorView;

  /**
   * Direct references to the three status bar zone elements.
   * Guaranteed non-null when passed; the status bar DOM is created at startup
   * before any plugin lifecycle method is called.
   */
  statusBar: {
    left: HTMLElement;
    center: HTMLElement;
    right: HTMLElement;
  };

  /**
   * Show the status bar and persist its visibility to settings.
   * Safe to call multiple times — no-op if already visible.
   * Implemented by `src/plugins/status-bar/status-bar.ts`.
   */
  ensureStatusBar(): void;

  /**
   * Hide the status bar if no dependent plugin is currently registered.
   * Checks the internal `STATUS_BAR_PLUGINS` set in `status-bar.ts`.
   * Implemented by `src/plugins/status-bar/status-bar.ts`.
   */
  hideStatusBarIfUnused(): void;
}

/**
 * The interface every Markable plugin object must satisfy.
 *
 * All properties are readonly so plugins are treated as immutable descriptors.
 * Mutable state lives in module-level `let` variables inside each plugin file,
 * never on the plugin object itself.
 */
export interface MarkablePlugin {
  /**
   * Stable identifier for this plugin. Must equal the corresponding key in
   * `MarkableSettings` (e.g. "wordCount", "statusBar", "focusMode",
   * "typewriterMode"). Never change this value after shipping.
   */
  readonly id: string;

  /** Human-readable name shown in the Plugins panel list. */
  readonly name: string;

  /** One-line description shown next to the toggle in the list view. */
  readonly description: string;

  /** Full description shown in the detail view. */
  readonly detail: string;

  /**
   * Return the CodeMirror extensions this plugin contributes to the editor.
   * Called once during `buildExtensions()`, before the editor is created.
   *
   * MUST be pure: no DOM access, no side effects, same result every call.
   * Optional: omit for plugins that have no CM6 extensions (e.g. Status Bar).
   */
  getExtensions?(): Extension[];

  /**
   * Called when the plugin is enabled (either via user toggle or settings restore).
   * Must update the internal `_enabled` flag to `true`.
   */
  onEnable(ctx: PluginContext): void;

  /**
   * Called when the plugin is disabled.
   * Must update the internal `_enabled` flag to `false`.
   * Must clean up any DOM mutations or subscriptions created by `onEnable`.
   */
  onDisable(ctx: PluginContext): void;

  /**
   * Called by PluginManager.restoreAll() during app initialization.
   * Should read the relevant field(s) from `settings` and call
   * `onEnable(ctx)` or `onDisable(ctx)` as appropriate, ensuring
   * `_enabled` is correctly set before returning.
   *
   * Optional: if absent, PluginManager applies the default boolean check:
   *   `(settings as Record<string, unknown>)[plugin.id] === true`
   * That default is sufficient for simple boolean plugins (focusMode, typewriterMode).
   */
  restoreFromSettings?(settings: MarkableSettings, ctx: PluginContext): void;

  /**
   * When true, PluginManager.toggle() skips its generic boolean persist call
   * (`updateSettings({ [id]: enabled })`). The plugin is responsible for
   * persisting its own settings in onEnable/onDisable.
   *
   * This flag exists to prevent settings corruption for plugins whose settings
   * key holds a non-boolean value. The canonical example is StatusBarPlugin,
   * whose key is `statusBar: { visible: boolean }`. If PluginManager wrote
   * `{ statusBar: true }` after onEnable/onDisable, it would overwrite that
   * object with a plain boolean, making `settings.statusBar?.visible` return
   * `undefined` on the next launch and breaking restore.
   *
   * Set this to `true` only when the plugin's onEnable and onDisable already
   * call updateSettings for every code path that changes enabled state.
   */
  readonly handlesOwnPersistence?: boolean;

  /**
   * Returns the current enabled state of this plugin.
   * Reads from the module-level `_enabled` flag maintained by the plugin.
   * Used by `PluginManager.getStates()` and the panel's toggle reflection.
   */
  isEnabled(): boolean;
}

/**
 * Minimal plugin descriptor used by the Plugins panel for rendering.
 * A MarkablePlugin satisfies this interface (id/name/description/detail overlap),
 * but PluginDef is kept separate so panel code does not depend on MarkablePlugin.
 */
export interface PluginDef {
  id: string;
  name: string;
  description: string;
  detail: string;
}

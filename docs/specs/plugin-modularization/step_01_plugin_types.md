# Step 01 — Create `plugin-types.ts` (Additive Only)

**Phase:** A1
**Checklist item:** `src/plugins/plugin-types.ts` created with `PluginContext`, `MarkablePlugin`, `PluginDef`
**Risk:** None. No existing file is modified. This step is purely additive.

---

## Objective

Create the canonical type definitions file for the Markable plugin system. This file is the single
source of truth for the three interfaces used throughout all subsequent steps. Nothing else changes
in this step — the app must be identical in behavior before and after.

---

## File to Create

### `src/plugins/plugin-types.ts` (new file)

```typescript
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
```

---

## Files Modified

None. This step creates one new file only.

---

## Files Created

| File | Status |
|---|---|
| `src/plugins/plugin-types.ts` | New |

---

## Verification Checklist

- [ ] `src/plugins/plugin-types.ts` exists and TypeScript compiles without errors
  (`npx tsc --noEmit` from the project root, or confirm `npm run tauri dev` starts cleanly).
- [ ] All three interfaces (`PluginContext`, `MarkablePlugin`, `PluginDef`) are exported.
- [ ] `MarkableSettings` is re-exported from `plugin-types.ts` (so later plugin files can import
  it from one place).
- [ ] No existing file was modified.
- [ ] `npm run tauri dev` launches; app behavior is identical to before this step.
- [ ] 29 Rust tests pass (`cargo test` in `src-tauri/`).
- [ ] 204 Vitest tests pass (`npm test`).

---

## Notes for Lead Developer

- The `MarkableSettings` re-export on line 17 (`export type { MarkableSettings }`) is
  intentional. Plugin files will import settings types from `plugin-types.ts` rather than
  reaching back into `../lib/settings`. This keeps plugin imports self-contained.
- The `PluginDef` interface here is identical in shape to the one currently defined inline in
  `src/plugins/plugins-panel.ts` (lines 12–17). In Step 7 the `plugins-panel.ts` definition
  will be replaced with an import from this file (addressing EC-16).
- Do not add `import` statements that would create a circular dependency. The only imports in
  this file are type-only (`import type`) from `@codemirror/state`, `@codemirror/view`, and
  `../lib/settings`. These are all leaf modules in the dependency graph.

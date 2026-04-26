# Step 01b — Unified Interface Types

**Chunk:** 1 — Foundation
**Objective:** Create `src/plugins/markable-plugin-api.ts` containing the new `MarkablePluginAPI` interface, the new `UnifiedPlugin` interface, and the `buildMarkablePluginAPI()` factory function. No existing types are deleted in this step — all old types (`MarkablePlugin`, `PluginContext`, `PluginDef`, `UserPlugin`, `UserPluginAPI`) remain in their current files through Chunk 3.

**Invariant throughout this step:** No existing files are modified. No imports are changed. The new file sits alongside the old type files and is not yet imported by anything — it is a type foundation, not a runtime change.

**Pre-condition:** Step 01a must be complete. `pluginManager` must have `addExtensions(pluginId, exts)` and `removeExtensions(pluginId)` available before `buildMarkablePluginAPI()` can delegate to them.

---

## Files to CREATE

1. `src/plugins/markable-plugin-api.ts` — new file; full content specified below

## Files NOT Modified

All existing files are unchanged in this step:
- `src/plugins/plugin-types.ts` — old `MarkablePlugin`, `PluginContext`, `PluginDef` remain
- `src/plugins/user-plugin-types.ts` — old `UserPlugin`, `UserPluginAPI` remain
- `src/plugins/user-plugin-loader.ts` — `buildUserPluginAPI()` unchanged
- `src/plugins/index.ts` — `PluginManager` unchanged beyond step_01a additions
- `src/main.ts` — no changes beyond step_01a addition

---

## 1. New file: `src/plugins/markable-plugin-api.ts`

Create this file at the exact path `src/plugins/markable-plugin-api.ts`.

```typescript
/**
 * Unified plugin API and interface types for Markable 2.0.
 *
 * This file defines the target type system introduced in the Unified Plugin System
 * refactor (docs/requirements/active_task.md). It coexists with the old types in
 * plugin-types.ts and user-plugin-types.ts during Chunks 1–2; the old files are
 * deleted in Chunk 4 (step_04c) once all consumers have migrated.
 *
 * Naming note: the interface is called `UnifiedPlugin` here (not `MarkablePlugin`)
 * to avoid a TypeScript collision with the existing `MarkablePlugin` export in
 * plugin-types.ts. It will be renamed to `MarkablePlugin` and replace the old
 * interface in step_02a.
 *
 * Key design decisions (from active_task.md):
 *   - Decision 1: addExtensions/removeExtensions are on the API; raw EditorView is absent.
 *   - Decision 8: removeExtensions() is all-or-nothing per plugin id.
 *   - FR-1: all plugins (core and user) receive the same API object.
 *   - FR-2: version field is required; getExtensions/isEnabled/handlesOwnPersistence removed.
 */

import type { Extension } from "@codemirror/state";
import { readPluginSettings, writePluginSettings } from "../lib/bridge";
import { ensureStatusBar, hideStatusBarIfUnused } from "./status-bar/status-bar";
import { pluginManager } from "./index";

// ── Public API surface (FR-1) ─────────────────────────────────────────────────

/**
 * The API object injected into every plugin's onEnable / onDisable calls.
 *
 * This is the complete, intentional API surface available to plugins. The raw
 * EditorView, invoke(), and window.__TAURI_INTERNALS__ are NOT accessible
 * through this object (PC-3, Decision 1). Plugins interact with CM6 exclusively
 * through addExtensions / removeExtensions.
 *
 * The object is constructed by buildMarkablePluginAPI() and is specific to one
 * plugin id — the loadSettings/saveSettings closures capture pluginId, and the
 * addExtensions/removeExtensions closures delegate to PluginManager with pluginId.
 */
export interface MarkablePluginAPI {
  /**
   * Direct references to the three status bar zone DOM elements.
   * Plugins may append children to these elements; they MUST remove all
   * appended children in onDisable to avoid leaking DOM nodes across toggle cycles.
   */
  statusBar: {
    left: HTMLElement;
    center: HTMLElement;
    right: HTMLElement;
  };

  /**
   * Show the status bar. Safe to call multiple times — no-op if already visible.
   * Call this in onEnable if the plugin contributes content to any status bar zone.
   */
  ensureStatusBar(): void;

  /**
   * Hide the status bar if no registered plugin currently needs it.
   * Checks the internal STATUS_BAR_PLUGINS set in status-bar.ts.
   * Call this in onDisable after removing status bar content.
   */
  hideStatusBarIfUnused(): void;

  /**
   * Load this plugin's persistent settings from disk.
   * Returns the parsed JSON object, or null if no settings file exists yet
   * (first run — EC-23). Never throws; returns null on any read error.
   *
   * Reads from: ~/Library/Application Support/com.markable.app/plugins/<pluginId>/settings.json
   */
  loadSettings(): Promise<Record<string, unknown> | null>;

  /**
   * Persist this plugin's settings to disk as JSON.
   * Rejects if data is not JSON-serialisable (EC-25 — Rust validates before write).
   *
   * Best practice: save eagerly on each user interaction, not only in onDisable,
   * because the window may close before onDisable completes (EC-26).
   *
   * Writes to: ~/Library/Application Support/com.markable.app/plugins/<pluginId>/settings.json
   */
  saveSettings(data: Record<string, unknown>): Promise<void>;

  /**
   * Register CM6 extensions for this plugin. The PluginManager stores these
   * extensions under the calling plugin's id and reconfigures the shared
   * Compartment immediately.
   *
   * Replaces any extensions previously registered by this plugin (idempotent
   * on repeated onEnable calls — toggle off then back on).
   *
   * EC-18: if called before the editor exists (should not happen under normal
   * startup — setEditorView is called before restoreAll), extensions are queued
   * and applied the moment setEditorView is called.
   *
   * CONTRACT: every plugin that calls addExtensions in onEnable MUST call
   * removeExtensions() in onDisable. Omitting removeExtensions leaves the
   * plugin's CM6 extensions active after disable — no runtime error, but
   * the editor behavior persists invisibly (EC-16).
   *
   * @param extensions  Array of CM6 Extension objects to register for this plugin.
   */
  addExtensions(extensions: Extension[]): void;

  /**
   * Remove all CM6 extensions previously registered by this plugin via
   * addExtensions(), then reconfigure the shared Compartment.
   *
   * Takes no arguments — removal is all-or-nothing per plugin id (Decision 8).
   * No-op if this plugin has not registered any extensions (EC-17).
   *
   * Call this from onDisable.
   */
  removeExtensions(): void;
}

// ── Plugin interface (FR-2) ───────────────────────────────────────────────────

/**
 * The unified plugin interface. Both core plugins (IIFE .js files in plugins/core/)
 * and user plugins (IIFE .js files in plugins/user/) must return an object matching
 * this interface from their IIFE body.
 *
 * Named `UnifiedPlugin` here to avoid collision with the existing `MarkablePlugin`
 * export in plugin-types.ts. Renamed to `MarkablePlugin` and replaces the old
 * interface in step_02a (Chunk 2).
 *
 * Removed relative to the old MarkablePlugin in plugin-types.ts:
 *   - getExtensions()          — replaced by api.addExtensions() in onEnable
 *   - restoreFromSettings()    — PluginManager handles restore uniformly (FR-5)
 *   - isEnabled()              — enabled state tracked by PluginManager, not plugins
 *   - handlesOwnPersistence    — no longer needed; all persistence is unified
 *
 * New relative to the old MarkablePlugin:
 *   - version: string          — required; semver recommended; displayed in panel
 *
 * Removed relative to old UserPlugin in user-plugin-types.ts:
 *   - (none — UserPlugin is a strict subset; this interface is a superset)
 *
 * Validated at load time by validatePlugin() in plugin-loader.ts (step_04a):
 *   - id:          non-empty string, no '/', '\', '.', or NUL
 *   - name:        non-empty string
 *   - description: non-empty string
 *   - version:     non-empty string (semver recommended, not enforced)
 *   - onEnable:    function
 *   - onDisable:   function
 *   - detail:      optional (falls back to description in panel if absent)
 */
export interface UnifiedPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly detail?: string;
  readonly version: string;
  onEnable(api: MarkablePluginAPI): void | Promise<void>;
  onDisable(api: MarkablePluginAPI): void | Promise<void>;
}

// ── API factory ───────────────────────────────────────────────────────────────

/**
 * Build the `MarkablePluginAPI` object for a specific plugin.
 *
 * The returned object captures `pluginId` in closures for:
 *   - loadSettings / saveSettings   — routes to plugins/<pluginId>/settings.json
 *   - addExtensions / removeExtensions — delegates to PluginManager with pluginId
 *
 * The statusBar zones are taken from `statusBarZones`, which comes from the
 * PluginContext / DOM — the factory does not query the DOM itself.
 *
 * PC-3: The raw EditorView, invoke(), window.__TAURI_INTERNALS__, and all other
 * Markable internals are absent from the returned object. Only the listed
 * properties are present.
 *
 * @param pluginId       The plugin's id. Captured in all closures.
 * @param statusBarZones Direct references to the three status bar zone elements.
 * @returns              A fully wired MarkablePluginAPI for this plugin.
 */
export function buildMarkablePluginAPI(
  pluginId: string,
  statusBarZones: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
): MarkablePluginAPI {
  return {
    statusBar: statusBarZones,

    ensureStatusBar,

    hideStatusBarIfUnused,

    async loadSettings(): Promise<Record<string, unknown> | null> {
      try {
        return await readPluginSettings(pluginId);
      } catch (err) {
        console.warn(`[Plugin:${pluginId}] loadSettings failed:`, err);
        return null;
      }
    },

    async saveSettings(data: Record<string, unknown>): Promise<void> {
      await writePluginSettings(pluginId, data);
    },

    addExtensions(extensions: Extension[]): void {
      pluginManager.addExtensions(pluginId, extensions);
    },

    removeExtensions(): void {
      pluginManager.removeExtensions(pluginId);
    },
  };
}
```

---

## Design Notes

### Why `UnifiedPlugin` and not `MarkablePlugin`?

The existing `src/plugins/plugin-types.ts` already exports a `MarkablePlugin` interface (with the old shape: `getExtensions()`, `isEnabled()`, etc.). TypeScript would allow two `MarkablePlugin` exports in different files, but any file that imports both would need explicit aliasing (`import type { MarkablePlugin as OldMarkablePlugin }`), making the migration noisier. Using `UnifiedPlugin` as a transitional name avoids that collision entirely. The rename happens in step_02a when `plugin-types.ts` is replaced.

### Why is `buildMarkablePluginAPI()` in this file (not in `user-plugin-loader.ts`)?

`user-plugin-loader.ts` currently exports `buildUserPluginAPI()` which builds the restricted `UserPluginAPI` (no CM6 access). The new `buildMarkablePluginAPI()` builds the unified API that includes `addExtensions`/`removeExtensions`. These are parallel implementations that coexist through Chunks 1–3. Putting the new factory in a dedicated file avoids entangling the migration with the existing loader, and makes the step_04a migration (replacing `user-plugin-loader.ts`) a clean file swap.

### Circular dependency note

`markable-plugin-api.ts` imports `pluginManager` from `./index`. `index.ts` will eventually import `buildMarkablePluginAPI` from this file (in step_04a). During Chunks 1–2 that second import does not exist yet, so there is no circular dependency at this step. Even when it does exist in step_04a, the same analysis as step_01a applies — both imports are used only inside function/method bodies, not at module evaluation time.

### `ensureStatusBar` / `hideStatusBarIfUnused` coupling

These two functions are currently exported from `src/plugins/status-bar/status-bar.ts`. They are re-used here unchanged. The import path `./status-bar/status-bar` is correct relative to `src/plugins/`. No change to `status-bar.ts` is needed in this step.

---

## Verification Checklist

- [ ] File `src/plugins/markable-plugin-api.ts` exists.
- [ ] `MarkablePluginAPI` is exported from that file with all seven properties: `statusBar`, `ensureStatusBar`, `hideStatusBarIfUnused`, `loadSettings`, `saveSettings`, `addExtensions`, `removeExtensions`.
- [ ] `UnifiedPlugin` is exported with fields: `id`, `name`, `description`, `detail?`, `version`, `onEnable`, `onDisable`.
- [ ] `buildMarkablePluginAPI(pluginId, statusBarZones)` is exported and returns a `MarkablePluginAPI`.
- [ ] The `addExtensions` closure delegates to `pluginManager.addExtensions(pluginId, extensions)`.
- [ ] The `removeExtensions` closure delegates to `pluginManager.removeExtensions(pluginId)`.
- [ ] No existing files are modified by this step.
- [ ] `tsc --noEmit` passes with zero errors on the new file in isolation.
- [ ] No runtime behavior changes — `buildMarkablePluginAPI` is not called by anything yet.

# Step 02 — Unified API Types

**Objective:** Define the new `MarkablePluginAPI` interface and the new unified `MarkablePlugin` interface. Define `PluginRecord` and `PluginLoadResult`. Update `src/lib/settings.ts` to add the `plugins` field and mark old fields as deprecated. Mark `user-plugin-types.ts` as deprecated (file is deleted in step_08).

This step is purely type-level. No runtime behavior changes.

---

## Files to Modify

1. `src/plugins/plugin-types.ts` — full replacement
2. `src/lib/settings.ts` — add `plugins?` field; mark deprecated fields

---

## 1. `src/plugins/plugin-types.ts` — Full Replacement

Replace the entire file with the following. The old `MarkablePlugin`, `PluginContext`, and `PluginDef` interfaces are removed. The new file exports `MarkablePluginAPI`, `MarkablePlugin`, `PluginRecord`, and `PluginLoadResult`.

```typescript
/**
 * Plugin system type definitions for Markable 2.0 — Unified Plugin System.
 *
 * All plugins — core and user — implement the same `MarkablePlugin` interface
 * and receive the same `MarkablePluginAPI` object at runtime. There is no
 * longer a PluginContext / UserPluginAPI split.
 *
 * The `MarkablePluginAPI` is the complete, intentional API surface available
 * to plugins. The raw EditorView, invoke(), and window.__TAURI_INTERNALS__
 * are NOT accessible through this object (PC-3). Plugins interact with CM6
 * exclusively through addExtensions / removeExtensions.
 */

import type { Extension } from "@codemirror/state";

// ── Public API surface (FR-1) ─────────────────────────────────────────────────

/**
 * The API object injected into every plugin's onEnable / onDisable calls.
 *
 * Provided by PluginManager.buildAPI(pluginId). All properties are
 * implemented by PluginManager closures; plugins never see the raw internals.
 */
export interface MarkablePluginAPI {
  /**
   * Direct references to the three status bar zone DOM elements.
   * Plugins may append children; must remove them in onDisable to prevent leaks.
   */
  statusBar: {
    left: HTMLElement;
    center: HTMLElement;
    right: HTMLElement;
  };

  /** Show the status bar. Safe to call if already visible. */
  ensureStatusBar(): void;

  /**
   * Hide the status bar if no registered plugin currently needs it.
   * Call in onDisable after removing status bar content.
   */
  hideStatusBarIfUnused(): void;

  /**
   * Load this plugin's persistent settings from disk.
   * Returns the parsed JSON object, or null if no settings file exists yet
   * (first run — EC-23). Never throws; returns null on any read error.
   */
  loadSettings(): Promise<Record<string, unknown> | null>;

  /**
   * Persist this plugin's settings to disk as JSON.
   * Rejects if data is not JSON-serialisable (EC-25 — Rust validates before write).
   * Best practice: save eagerly on each change, not only in onDisable.
   */
  saveSettings(data: Record<string, unknown>): Promise<void>;

  /**
   * Register CM6 extensions for this plugin. The PluginManager stores these
   * extensions under the calling plugin's id and reconfigures the shared
   * Compartment. Replaces any extensions previously registered by this plugin
   * (idempotent on re-enable).
   *
   * Call this from onEnable. If called before the editor exists (EC-18),
   * the extensions are queued and applied once the view is available.
   *
   * CONTRACT: every plugin that calls addExtensions in onEnable MUST call
   * removeExtensions() in onDisable. Failure to do so leaks the extensions
   * for the session (EC-16 — no runtime error, but the editor behavior
   * from the disabled plugin persists).
   */
  addExtensions(extensions: Extension[]): void;

  /**
   * Remove all CM6 extensions previously registered by this plugin via
   * addExtensions(), then reconfigure the shared Compartment.
   *
   * Takes no arguments — removal is all-or-nothing per plugin id (PC-6).
   * No-op if this plugin has not registered any extensions (EC-17).
   *
   * Call this from onDisable.
   */
  removeExtensions(): void;
}

// ── Plugin interface (FR-2) ───────────────────────────────────────────────────

/**
 * The interface every Markable plugin object must satisfy.
 *
 * Both core plugins (IIFE .js files in plugins/core/) and user plugins
 * (IIFE .js files in plugins/user/) must return an object matching this
 * interface from their IIFE body.
 *
 * Removed relative to the old MarkablePlugin:
 *   - getExtensions() — replaced by api.addExtensions() inside onEnable
 *   - restoreFromSettings() — PluginManager handles restore uniformly
 *   - isEnabled() — enabled state is tracked by PluginManager, not the plugin
 *   - handlesOwnPersistence — no longer needed; persistence is unified
 *
 * The version field is new and required. Absent version is a validation error.
 *
 * Validated at load time by validatePlugin() in plugin-loader.ts:
 *   - id:          non-empty string, no '/', '\', '.', NUL
 *   - name:        non-empty string
 *   - description: non-empty string
 *   - version:     non-empty string
 *   - onEnable:    function
 *   - onDisable:   function
 *
 * detail is optional (falls back to description in the panel if absent).
 */
export interface MarkablePlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly detail?: string;
  readonly version: string;
  onEnable(api: MarkablePluginAPI): void | Promise<void>;
  onDisable(api: MarkablePluginAPI): void | Promise<void>;
}

// ── Loader types ──────────────────────────────────────────────────────────────

/**
 * Discriminated union returned by validatePlugin() in plugin-loader.ts.
 */
export type PluginLoadResult =
  | { ok: true; plugin: MarkablePlugin }
  | { ok: false; filename: string; reason: string };

// ── Internal record type ──────────────────────────────────────────────────────

/**
 * Internal record for a registered plugin in PluginManager.
 * Covers both core and user plugins (FR-5).
 *
 * status values:
 *   "loaded"    — plugin evaluated, validated, and registered successfully.
 *   "failed"    — eval or validation error; plugin and api are null.
 *   "missing"   — was registered last session but .js file no longer exists.
 *   "overridden"— a core plugin slot whose filename is shadowed by a same-named
 *                 file in plugins/user/. The core file is not evaluated.
 *                 Only valid for records with origin "core".
 */
export interface PluginRecord {
  /** The validated plugin object. Null for failed/overridden/missing records. */
  plugin: MarkablePlugin | null;
  /** The per-plugin API object. Null for failed/overridden/missing records. */
  api: MarkablePluginAPI | null;
  /** Filename on disk (e.g. "focus-mode.js"). Used for override detection and dedup. */
  filename: string;
  /** "core" = from plugins/core/; "user" = from plugins/user/. */
  origin: "core" | "user";
  status: "loaded" | "failed" | "missing" | "overridden";
  /** Human-readable error reason. Set only when status is "failed". */
  failReason?: string;
  /** Runtime enabled state. Maintained by PluginManager._enable/_disable helpers. */
  _enabled: boolean;
}
```

---

## 2. `src/lib/settings.ts` — Add `plugins` field; mark deprecated fields

### Change: add `plugins?` field to `MarkableSettings` and annotate deprecated fields

In `MarkableSettings` interface (currently lines 25–52), apply these changes:

```typescript
export interface MarkableSettings {
  version: number;
  window: WindowSettings;
  editor: EditorSettings;
  theme: ThemeSettings;
  recentFiles: string[];
  findWidget: FindWidgetPosition | null;
  keybindings?: Record<string, string>;

  /**
   * Unified plugin enable/disable state (FR-7).
   * Keys are plugin ids (kebab-case, e.g. "focus-mode", "word-count").
   * Replaces the flat boolean fields and the userPlugins map below.
   * Populated by migratePluginSettings() on first launch post-upgrade.
   */
  plugins?: Record<string, { enabled: boolean }>;

  /**
   * @deprecated Migrated to plugins["status-bar"].enabled by migratePluginSettings().
   * Kept here so the migration can read it. Removed from the type in step_08.
   */
  statusBar?: { visible: boolean };

  /**
   * @deprecated Migrated to plugins["word-count"].enabled.
   */
  wordCount?: boolean;

  /**
   * @deprecated Migrated to plugins["focus-mode"].enabled.
   */
  focusMode?: boolean;

  /**
   * @deprecated Migrated to plugins["typewriter-mode"].enabled.
   */
  typewriterMode?: boolean;

  listStyle?: "standard" | "alphanumeric" | "decimal" | "steps";

  /**
   * @deprecated Migrated to plugins[id].enabled by migratePluginSettings().
   */
  userPlugins?: Record<string, { enabled: boolean }>;

  /**
   * The app version for which core plugin files were last copied from
   * the app bundle to ~/Library/.../plugins/core/. Written by main.ts
   * after a successful copy_core_plugins invocation (FR-6, Decision 5).
   * Absence means never copied (first launch or pre-refactor).
   */
  pluginsCopiedForVersion?: string;
}
```

---

## Verification Checklist

- [ ] `src/plugins/plugin-types.ts` exports: `MarkablePluginAPI`, `MarkablePlugin`, `PluginLoadResult`, `PluginRecord`.
- [ ] Old exports (`PluginContext`, `PluginDef`, old `MarkablePlugin` shape with `getExtensions`/`isEnabled`) are gone.
- [ ] `src/lib/settings.ts` has `plugins?: Record<string, { enabled: boolean }>`.
- [ ] `src/lib/settings.ts` has `pluginsCopiedForVersion?: string`.
- [ ] Old flat fields are still present but annotated `@deprecated`.
- [ ] TypeScript compiles without errors.

Note: at this point, the existing plugin files (`focus-mode/index.ts`, `word-count/index.ts`, etc.) will have TypeScript errors because they import the old `PluginContext` type. This is expected and is resolved in step_03.

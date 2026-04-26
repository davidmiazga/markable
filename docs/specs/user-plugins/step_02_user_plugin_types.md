# Step 02 — TypeScript Types + Settings Schema

**Objective:** Create `src/plugins/user-plugin-types.ts` with all user-plugin-facing interfaces; add `userPlugins` key to `MarkableSettings` in `src/lib/settings.ts`.

**Traceability:** PC-1, PC-2, PC-3, PC-5, PC-6, EC-4, EC-5, EC-7, EC-15, EC-20.

---

## Files to Create

### `src/plugins/user-plugin-types.ts` (new file)

```typescript
/**
 * Type definitions for the user plugin system.
 *
 * These types are the public contract for third-party plugin authors.
 * They are deliberately separate from `plugin-types.ts` (the internal
 * MarkablePlugin interface) to enforce the narrower API surface defined
 * by PC-3 and PC-6: user plugins have no CM6 access, no EditorView,
 * no invoke, and no Tauri globals.
 *
 * Key invariants:
 *   - UserPlugin is a subset of MarkablePlugin: id/name/description/detail
 *     overlap, but getExtensions() and restoreFromSettings() are absent.
 *   - UserPluginAPI is a subset of PluginContext: statusBar zones and the
 *     two visibility helpers are present, but editor (EditorView) is absent.
 *   - loadSettings/saveSettings give access to per-plugin persistent JSON
 *     stored at plugins/<id>/settings.json via Tauri commands.
 */

// ── Public plugin interface ───────────────────────────────────────────────────

/**
 * The interface a user plugin object must satisfy.
 *
 * A valid plugin file must evaluate to an object matching this interface
 * (returned from the IIFE body). The loader rejects any file that does not
 * return a conforming object.
 *
 * Constraints enforced at load time (UserPluginLoader.validate):
 *   - id:        non-empty string with no '/', '\', '.', or NUL (EC-20, PC-2)
 *   - name:      non-empty string
 *   - description: non-empty string
 *   - onEnable:  function
 *   - onDisable: function
 *
 * detail is optional (falls back to description in the panel).
 * getExtensions() is intentionally absent (PC-6).
 */
export interface UserPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly detail?: string;
  onEnable(api: UserPluginAPI): void | Promise<void>;
  onDisable(api: UserPluginAPI): void | Promise<void>;
}

// ── Plugin API surface (PC-3) ─────────────────────────────────────────────────

/**
 * The API object injected into every user plugin's onEnable/onDisable calls.
 *
 * This is the COMPLETE API surface available to user plugins. Nothing else
 * from the Markable runtime is accessible through this object.
 *
 * Excluded intentionally (PC-3, PC-6):
 *   - EditorView (editor)
 *   - invoke / window.__TAURI_INTERNALS__
 *   - Any CM6 construct (Compartment, StateEffect, Extension)
 */
export interface UserPluginAPI {
  /**
   * Direct references to the three status bar zone DOM elements.
   * Plugins may append children to these elements; they must remove all
   * children in onDisable to avoid leaking DOM nodes.
   */
  statusBar: {
    left: HTMLElement;
    center: HTMLElement;
    right: HTMLElement;
  };

  /**
   * Show the status bar. Safe to call if already visible.
   * Call this in onEnable if the plugin contributes status bar content.
   */
  ensureStatusBar(): void;

  /**
   * Hide the status bar if no built-in plugin currently needs it.
   * Call this in onDisable after removing status bar content.
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
   * The plugins directory must be writable; rejects if data is not
   * JSON-serialisable (EC-25).
   *
   * Best practice: save eagerly on each change, not only in onDisable,
   * because onDisable may not complete before the window closes (EC-26).
   */
  saveSettings(data: Record<string, unknown>): Promise<void>;
}

// ── Loader result ─────────────────────────────────────────────────────────────

/**
 * Discriminated union returned by UserPluginLoader.evaluate().
 *
 * On success, `plugin` is a validated UserPlugin object ready for registration.
 * On failure, `reason` is a human-readable error string logged to the console
 * and displayed in the User Plugins panel as a failed-plugin badge.
 */
export type UserPluginLoadResult =
  | { ok: true; plugin: UserPlugin }
  | { ok: false; filename: string; reason: string };

// ── Panel descriptor ──────────────────────────────────────────────────────────

/**
 * Extends PluginDef with user-plugin-specific display fields.
 * Passed to createPluginsPanel() as the user plugin data source.
 */
export interface UserPluginDef {
  id: string;
  name: string;
  description: string;
  detail: string;
  /** "loaded" = registered and evaluatable; "failed" = eval/validation error;
   *  "missing" = was registered last session but .js file no longer exists. */
  status: "loaded" | "failed" | "missing";
  /** Human-readable reason for "failed" status; displayed in panel. */
  failReason?: string;
}
```

---

## Files to Modify

### `src/lib/settings.ts`

**Change 1:** Add `userPlugins` field to the `MarkableSettings` interface.

The `MarkableSettings` interface currently ends at line 45 (closing brace). Insert the new field before the closing brace:

Locate this exact block (lines 25–45):

```typescript
export interface MarkableSettings {
  version: number;
  window: WindowSettings;
  editor: EditorSettings;
  theme: ThemeSettings;
  recentFiles: string[];
  /** TC-6: optional field — null means use default position (upper-right). */
  findWidget: FindWidgetPosition | null;
  /** Custom keybinding overrides. Maps command-id → key string (e.g. "Cmd-Shift-O"). Absent = use default. */
  keybindings?: Record<string, string>;
  /** Status bar visibility. */
  statusBar?: { visible: boolean };
  /** Word count plugin enabled. */
  wordCount?: boolean;
  /** Focus mode (dim non-active paragraphs). */
  focusMode?: boolean;
  /** Typewriter mode (cursor always vertically centered). */
  typewriterMode?: boolean;
  /** Active list style for ambiguous markers (e.g. "1."). */
  listStyle?: "standard" | "alphanumeric" | "decimal" | "steps";
}
```

Replace with (one field added at the end):

```typescript
export interface MarkableSettings {
  version: number;
  window: WindowSettings;
  editor: EditorSettings;
  theme: ThemeSettings;
  recentFiles: string[];
  /** TC-6: optional field — null means use default position (upper-right). */
  findWidget: FindWidgetPosition | null;
  /** Custom keybinding overrides. Maps command-id → key string (e.g. "Cmd-Shift-O"). Absent = use default. */
  keybindings?: Record<string, string>;
  /** Status bar visibility. */
  statusBar?: { visible: boolean };
  /** Word count plugin enabled. */
  wordCount?: boolean;
  /** Focus mode (dim non-active paragraphs). */
  focusMode?: boolean;
  /** Typewriter mode (cursor always vertically centered). */
  typewriterMode?: boolean;
  /** Active list style for ambiguous markers (e.g. "1."). */
  listStyle?: "standard" | "alphanumeric" | "decimal" | "steps";
  /**
   * User plugin enable/disable state.
   * Keyed by plugin id. Absent key = never been toggled (treated as disabled).
   * Preserved through Rust round-trips via the raw-JSON pass-through (EC-15).
   * PC-5: this is separate from the flat boolean keys used by built-in plugins.
   */
  userPlugins?: Record<string, { enabled: boolean }>;
}
```

**Change 2:** No change to `DEFAULT_SETTINGS` is required. The `userPlugins` field is optional and its absence is treated as `{}` by the merge-with-defaults logic in `loadSettings()` (line 214: `currentSettings = { ...structuredClone(DEFAULT_SETTINGS), ...result.value }`). EC-15 is satisfied by this existing spread pattern.

---

## Verification Checklist

- [ ] `src/plugins/user-plugin-types.ts` compiles with zero TypeScript errors (`npx tsc --noEmit`).
- [ ] `UserPlugin` has no `getExtensions()` method (PC-6 enforced at the type level).
- [ ] `UserPluginAPI` has no `editor` property and no `invoke` (PC-3 enforced at the type level).
- [ ] `MarkableSettings.userPlugins` is optional (EC-15: absent = `{}`, no migration needed).
- [ ] Existing tests in `tests/settings.test.ts` still pass (no breaking change to interface).
- [ ] `UserPluginDef.status` is typed as the union `"loaded" | "failed" | "missing"` — not a plain string.
- [ ] `UserPluginLoadResult` is a discriminated union where `ok: true` carries `plugin` and `ok: false` carries `filename` and `reason`.

# step_03c — Settings Migration

**Feature:** `unified-plugins`
**Chunk:** 3
**Step:** 03c
**Depends on:** step_03b (`PluginManager` refactor; `loadPlugins` expects `settings.plugins`)

---

## Objective

Introduce a `plugins` key in `MarkableSettings` that is the single source of truth
for plugin enabled/disabled state. Write a `migratePluginSettings(settings)` function
that reads the old flat boolean keys (`focusMode`, `typewriterMode`, `wordCount`,
`statusBar.visible`) and the old `userPlugins` record, then populates `settings.plugins`
from them. Call this function once in `initApp()` before `loadPlugins()`.

The old fields are preserved in the type (marked `@deprecated`) and kept in the
serialized JSON through this chunk so that downgrading the app leaves settings readable.
They are removed from the type in step_04c.

After this step:

- `settings.plugins["focus-mode"].enabled` is the authoritative enabled state for
  the Focus Mode plugin.
- `settings.plugins["status-bar"].enabled` is the authoritative state for the Status Bar
  plugin (replaces the `statusBar.visible` structure).
- `settings.plugins["word-count"].enabled` and `settings.plugins["typewriter-mode"].enabled`
  similarly.
- User plugin states are in `settings.plugins["<user-plugin-id>"].enabled` with
  `kind: "user"`.
- Migration runs only once per settings file: if `settings.plugins` is already populated,
  the function returns the settings unchanged (EC-26, EC-27, EC-28).

---

## Files to Modify

| File | Action |
|------|--------|
| `src/lib/settings.ts` | Add `plugins?` to `MarkableSettings`; annotate old fields `@deprecated` |
| `src/plugins/settings-migration.ts` | NEW — `migratePluginSettings()` function |
| `src/main.ts` | Import and call `migratePluginSettings()` in `initApp()` |

---

## 1. `src/lib/settings.ts` — add `plugins` field

### 1a. Add `PluginEnableRecord` type

Add before the `MarkableSettings` interface:

```typescript
/**
 * Per-plugin enable/disable state entry in the unified `plugins` map.
 *
 * `kind` distinguishes core plugins from user plugins. It is stored so that
 * the panel can display the correct section without re-reading the disk.
 */
export interface PluginEnableRecord {
  enabled: boolean;
  kind: "core" | "user";
}
```

### 1b. Add `plugins?` to `MarkableSettings`

Add after the `userPlugins?` field (currently line 51):

```typescript
/**
 * Unified plugin enable/disable state map. Keys are plugin ids (kebab-case).
 *
 * This is the single authoritative source for plugin state as of Chunk 3.
 * Populated from old flat fields by migratePluginSettings() on first run after
 * the upgrade. Old flat fields (focusMode, typewriterMode, wordCount, statusBar,
 * userPlugins) are preserved through Chunk 3 for backward compatibility and
 * removed in step_04c.
 *
 * Absent key = never configured (treated as disabled on first run).
 * Absent map = settings file pre-dates Chunk 3 (migratePluginSettings runs).
 */
plugins?: Record<string, PluginEnableRecord>;
```

### 1c. Annotate old fields as deprecated

```typescript
/**
 * @deprecated since Chunk 3 (step_03c). Use plugins["status-bar"].enabled instead.
 * Preserved through step_04c for backward compatibility.
 */
statusBar?: { visible: boolean };

/**
 * @deprecated since Chunk 3 (step_03c). Use plugins["word-count"].enabled instead.
 */
wordCount?: boolean;

/**
 * @deprecated since Chunk 3 (step_03c). Use plugins["focus-mode"].enabled instead.
 */
focusMode?: boolean;

/**
 * @deprecated since Chunk 3 (step_03c). Use plugins["typewriter-mode"].enabled instead.
 */
typewriterMode?: boolean;

/**
 * @deprecated since Chunk 3 (step_03c). Use the plugins map instead.
 * Preserved through step_04c for backward compatibility.
 */
userPlugins?: Record<string, { enabled: boolean }>;
```

---

## 2. `src/plugins/settings-migration.ts` — NEW FILE

```typescript
/**
 * Settings migration for the Unified Plugin System (Chunk 3).
 *
 * migratePluginSettings() converts old flat boolean settings keys into the
 * unified plugins map introduced in step_03c.
 *
 * Migration table (active_task.md § Settings Key Migration):
 *
 *   Old key                      → New key
 *   focusMode: true              → plugins["focus-mode"].enabled = true
 *   typewriterMode: true         → plugins["typewriter-mode"].enabled = true
 *   wordCount: true              → plugins["word-count"].enabled = true
 *   statusBar: { visible: true } → plugins["status-bar"].enabled = true
 *   userPlugins["x"].enabled     → plugins["x"].enabled (kind: "user")
 *
 * Idempotency (EC-26, EC-27, EC-28):
 *   If settings.plugins is already defined and non-empty, no migration runs.
 *   The old fields are left in place (not deleted) for backward compat.
 */

import type { MarkableSettings, PluginEnableRecord } from "../lib/settings";

/** Map from old camelCase settings key → new kebab-case plugin id. */
const FLAT_KEY_TO_PLUGIN_ID: ReadonlyArray<{
  oldKey: keyof MarkableSettings;
  pluginId: string;
}> = [
  { oldKey: "focusMode",      pluginId: "focus-mode" },
  { oldKey: "typewriterMode", pluginId: "typewriter-mode" },
  { oldKey: "wordCount",      pluginId: "word-count" },
];

/**
 * Migrate old plugin settings keys to the unified `plugins` map.
 *
 * Returns a new settings object (does not mutate the input).
 * If `settings.plugins` is already defined with at least one key, returns
 * the settings unchanged (EC-26, EC-27, EC-28: idempotent).
 *
 * @param settings  The settings object loaded from disk.
 * @returns         Settings with `plugins` populated from old keys.
 */
export function migratePluginSettings(settings: MarkableSettings): MarkableSettings {
  // EC-26: if plugins map already exists and is non-empty, skip migration.
  // "non-empty" = at least one key, indicating the migration already ran.
  if (settings.plugins && Object.keys(settings.plugins).length > 0) {
    return settings;
  }

  const plugins: Record<string, PluginEnableRecord> = {};

  // ── 1. Migrate flat boolean keys ──────────────────────────────────────────
  for (const { oldKey, pluginId } of FLAT_KEY_TO_PLUGIN_ID) {
    const value = (settings as Record<string, unknown>)[oldKey];
    // Only migrate if the key is explicitly `true` — undefined/false both map
    // to disabled (the default state).
    plugins[pluginId] = {
      enabled: value === true,
      kind: "core",
    };
  }

  // ── 2. Migrate statusBar (object shape, not plain boolean) ────────────────
  // EC-27: old format is `statusBar: { visible: boolean }`.
  plugins["status-bar"] = {
    enabled: settings.statusBar?.visible === true,
    kind: "core",
  };

  // ── 3. Migrate userPlugins record ─────────────────────────────────────────
  // EC-28: each entry in userPlugins maps 1:1 to plugins[id] with kind "user".
  if (settings.userPlugins) {
    for (const [id, record] of Object.entries(settings.userPlugins)) {
      // Guard: skip if the id would collide with a core plugin we already wrote.
      // This should not happen in practice (user plugin ids should not match
      // core ids), but is defensive against corrupted settings files.
      if (!(id in plugins)) {
        plugins[id] = {
          enabled: record.enabled === true,
          kind: "user",
        };
      }
    }
  }

  return {
    ...settings,
    plugins,
  };
}
```

---

## 3. `src/main.ts` — call `migratePluginSettings` in `initApp()`

### 3a. Add import

At the top of `main.ts`, after the `loadSettings` import block:

```typescript
import { migratePluginSettings } from "./plugins/settings-migration";
```

### 3b. Call migration in `initApp()`

The current sequence in `initApp()` after Chunk 2B (lines 817–870, simplified):

```typescript
const settings = await loadSettings();
// ... copyCorePlugins ...
// ... applyWindowSettings ...
// ... createEditor ...
// ... setEditorView ...
// ... applyEditorSettings ...
pluginManager.restoreAll(settings, ctx);      // ← to be replaced by step_03b
await pluginManager.loadUserPlugins(ctx, settings);
```

After step_03b replaces those last two lines with `loadPlugins`, the sequence becomes:

```typescript
const settings = await loadSettings();
// ← INSERT migration call here (before any plugin loading):
const migratedSettings = migratePluginSettings(settings);

try {
  await copyCorePlugins();
} catch (err) {
  console.warn("[init] copyCorePlugins failed (non-fatal):", err);
}

// ... applyWindowSettings(migratedSettings.window) ...
// ... createEditor ...
// ... setEditorView ...
// ... applyEditorSettings(migratedSettings.editor) ...

await pluginManager.loadPlugins(migratedSettings, statusBarZones);
```

All subsequent code that reads `settings.` must be updated to read
`migratedSettings.` to pick up the populated `plugins` map.

The migration result is also persisted so subsequent launches skip the migration:

```typescript
// After migratePluginSettings():
const migratedSettings = migratePluginSettings(settings);

// Persist if migration added new keys (i.e. plugins was absent or empty before).
if (!settings.plugins || Object.keys(settings.plugins).length === 0) {
  void updateSettings(() => migratedSettings);
}
```

The `void` here is intentional: the persist is fire-and-forget. If it fails,
the migration runs again on the next launch (idempotent).

---

## 4. Edge cases

| EC | Handling |
|----|----------|
| EC-26 — migration idempotency | `if (settings.plugins && Object.keys(settings.plugins).length > 0) return settings` guard |
| EC-27 — statusBar object shape | Reads `.visible` field explicitly; does not treat the object itself as boolean |
| EC-28 — userPlugins collision | Core ids are written first; userPlugins loop skips keys already in `plugins` |
| First run (no old keys) | All four core plugins default to `enabled: false`; the plugin's `onEnable` is not called unless `enabled === true` |
| Settings written while migration pending | `migratePluginSettings` runs before `loadPlugins`; `updateSettings` persists the migrated map; `loadPlugins` reads the migrated `settings.plugins` map |
| `statusBar.visible === undefined` | `settings.statusBar?.visible === true` evaluates to `false` → status-bar starts disabled — correct, because the old default was also `false` |

---

## 5. Tests to write

Create `tests/settings-migration.test.ts`:

### 5a. Idempotency (EC-26)

```
- migratePluginSettings returns the same reference if plugins is non-empty
- calling migratePluginSettings twice produces the same result as calling it once
```

### 5b. Flat boolean fields (EC-26, EC-27)

```
- focusMode: true → plugins["focus-mode"].enabled = true, kind = "core"
- focusMode: false → plugins["focus-mode"].enabled = false, kind = "core"
- focusMode: undefined → plugins["focus-mode"].enabled = false, kind = "core"
- typewriterMode: true → plugins["typewriter-mode"].enabled = true, kind = "core"
- wordCount: true → plugins["word-count"].enabled = true, kind = "core"
```

### 5c. statusBar migration (EC-27)

```
- statusBar: { visible: true } → plugins["status-bar"].enabled = true, kind = "core"
- statusBar: { visible: false } → plugins["status-bar"].enabled = false
- statusBar: undefined → plugins["status-bar"].enabled = false
- statusBar: true (malformed) → plugins["status-bar"].enabled = false
  (because .visible is undefined on a boolean)
```

### 5d. userPlugins migration (EC-28)

```
- userPlugins: { "my-plugin": { enabled: true } } → plugins["my-plugin"].enabled = true, kind = "user"
- userPlugins: { "my-plugin": { enabled: false } } → plugins["my-plugin"].enabled = false, kind = "user"
- userPlugins: {} → no user entries in plugins map
- userPlugins with key matching a core id → skipped (does not overwrite core entry)
```

### 5e. Non-mutation of input

```
- migratePluginSettings does not mutate the settings object passed in
- returned object spread includes all original settings fields (window, editor, theme, etc.)
```

### 5f. All four core plugin entries are always present after migration

```
- after migration, plugins["focus-mode"], plugins["typewriter-mode"],
  plugins["word-count"], plugins["status-bar"] are all defined
- kind is "core" for all four
```

---

## Verification Checklist

- [ ] `npx tsc --noEmit` passes with 0 new errors
- [ ] `npm test` passes (all existing tests + new settings-migration tests)
- [ ] `settings.plugins` is populated after `migratePluginSettings()` runs
- [ ] On first launch with a pre-Chunk-3 settings file: all four core plugin entries
  appear in `settings.plugins` with the correct enabled state
- [ ] On second launch: `settings.plugins` is already non-empty; migration is a no-op
- [ ] `updateSettings` is called once to persist the migrated map
  (verified by checking `settings.json` after first launch)
- [ ] EC-26: calling `migratePluginSettings` on already-migrated settings returns the
  input unchanged (same object reference)
- [ ] EC-27: `statusBar: { visible: true }` settings file maps correctly to
  `plugins["status-bar"].enabled = true`
- [ ] EC-28: a user plugin with id "my-plugin" in `userPlugins` maps to
  `plugins["my-plugin"].enabled` with `kind: "user"`
- [ ] Old fields (`focusMode`, `typewriterMode`, `wordCount`, `statusBar`,
  `userPlugins`) remain in the serialized JSON (not deleted)

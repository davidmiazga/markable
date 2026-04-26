# step_03b — PluginManager Refactor

**Feature:** `unified-plugins`
**Chunk:** 3
**Step:** 03b
**Depends on:** step_03a (loader unification, `listCorePlugins`, `buildMarkablePluginAPI` re-export)

---

## Objective

Replace the two-tier `PluginManager` (static built-ins + dynamic user plugins) with a
single unified tier. Concretely:

1. Remove the static built-in imports (`WordCountPlugin`, `StatusBarPlugin`,
   `FocusModePlugin`, `TypewriterModePlugin`) and the `this.plugins` array from the
   constructor.
2. Introduce a unified `PluginRecord` type replacing both `UserPluginRecord` and the
   implicit built-in records.
3. Add `loadPlugins(settings)` — scans both `plugins/core/` and `plugins/user/`,
   performs override detection (user file wins when names collide), evaluates each
   file using `evaluatePlugin(..., kind)`, builds one `MarkablePluginAPI` per plugin.
4. Replace `restoreAll(settings, ctx)` with a unified restore that reads from the new
   `settings.plugins` key (step_03c provides the migration that populates it).
5. Unify `toggle` / `toggleUserPlugin` into a single `toggle(id, enabled)`.
6. Unify `getStates()` / `getUserStates()` and `getDefinitions()` / `getUserDefinitions()`.
7. Remove `getExtensions()` from `PluginManager` (the static path is gone).
8. Remove `pluginManager.getExtensions()` call from `extensions.ts`.
9. Remove `buildPluginContext()` from `main.ts` and all call sites that pass a
   `PluginContext` to `PluginManager` methods.

After this step the app must still load and all four plugins must still work.

---

## Files to Modify

| File | Action |
|------|--------|
| `src/plugins/index.ts` | Full rewrite of `PluginManager` — see §3 |
| `src/editor/extensions.ts` | Remove `pluginManager.getExtensions()` call (line 191) |
| `src/main.ts` | Remove `buildPluginContext()`, `restoreAll`, `loadUserPlugins`, `reloadUserPlugins`, `handlePluginToggle` wiring; replace with `loadPlugins`, unified `toggle`; remove `scheduleWordCount` static call (word-count plugin owns it now) |
| `src/plugins/plugins-panel/plugins-panel.ts` | Update call signatures (unified defs + states) |
| `src/plugins/plugin-types.ts` | Annotate `PluginContext` and old `MarkablePlugin` as deprecated |

---

## 1. New `PluginRecord` type

In `src/plugins/index.ts`, replace the old `UserPluginRecord` interface with:

```typescript
/**
 * Unified record for a registered plugin (core or user).
 *
 * Replaces the old split between implicit built-in records (stored on MarkablePlugin[])
 * and UserPluginRecord. All plugins — core and user — share this one type.
 *
 * Status values:
 *   "loaded"     — evaluated, validated, API built.
 *   "failed"     — eval, validation, or id-collision error.
 *   "missing"    — was loaded last session; .js file no longer on disk.
 *   "overridden" — core slot whose filename exists in plugins/user/; not evaluated.
 */
interface PluginRecord {
  /** Plugin id. Null for failed-to-load records before validation. */
  id: string | null;
  /** Filename on disk (e.g. "focus-mode.js"). Used for override detection. */
  filename: string;
  /** Whether this record came from plugins/core/ or plugins/user/. */
  kind: "core" | "user";
  /** Load and validation outcome. */
  status: "loaded" | "failed" | "missing" | "overridden";
  /** The validated plugin object. Null for failed/overridden records. */
  plugin: UnifiedPlugin | null;
  /** The per-plugin API instance. Null for failed/overridden records. */
  api: ReturnType<typeof buildMarkablePluginAPI> | null;
  /** Runtime enabled state. Maintained by _enable / _disable helpers. */
  _enabled: boolean;
  /** Human-readable load error. Set only when status === "failed". */
  failReason?: string;
}
```

The type requires these imports at the top of `index.ts`:

```typescript
import type { UnifiedPlugin } from "./markable-plugin-api";
import { buildMarkablePluginAPI } from "./markable-plugin-api";
import { listCorePlugins, listUserPlugins, readPluginFile } from "../lib/bridge";
import type { ReadPluginFileResult } from "../lib/bridge";
import { evaluatePlugin } from "./user-plugin-loader";
import { updateSettings } from "../lib/settings";
import type { MarkableSettings } from "../lib/settings";
import { pluginCompartment } from "../editor/extensions";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
```

Remove all imports of the old static built-ins:

```typescript
// DELETE these four lines:
import { WordCountPlugin } from "./word-count/index";
import { StatusBarPlugin } from "./status-bar/index";
import { FocusModePlugin } from "./focus-mode/index";
import { TypewriterModePlugin } from "./typewriter-mode/index";
```

Remove the old type imports that are no longer needed:

```typescript
// DELETE:
import type { MarkablePlugin, PluginContext, PluginDef } from "./plugin-types";
import type { UserPlugin, UserPluginAPI, UserPluginDef } from "./user-plugin-types";
import { evaluatePlugin, buildUserPluginAPI } from "./user-plugin-loader";
import { listUserPlugins, readPluginFile, type ReadPluginFileResult } from "../lib/bridge";
```

---

## 2. Updated `PluginManager` class

Replace the entire class body. Public API surface after the rewrite:

```
setEditorView(view)          — unchanged
addExtensions(id, exts)      — unchanged
removeExtensions(id)         — unchanged
loadPlugins(settings)        — NEW; replaces loadUserPlugins + restoreAll combo
toggle(id, enabled)          — unified; replaces toggle(id, enabled, ctx) + toggleUserPlugin
getStates()                  — unified; single Record<string, boolean>
getDefinitions()             — unified; single PluginDef-compatible array (see §2c)
```

Removed from public API:
- `getExtensions()` — gone
- `restoreAll(settings, ctx)` — gone
- `loadUserPlugins(ctx, settings)` — gone
- `reloadUserPlugins(ctx, settings)` — gone
- `toggleUserPlugin(id, enabled, ctx)` — gone
- `getUserDefinitions()` — gone
- `getUserStates()` — gone

### 2a. Constructor

```typescript
constructor() {
  // No static plugin registrations.
  // All plugins are loaded from disk by loadPlugins().
}
```

The `this.plugins` array is removed. The `this.records` private array holds all
`PluginRecord` objects.

### 2b. `loadPlugins(settings: MarkableSettings): Promise<void>`

Full algorithm:

```
1. Discover filenames:
   a. coreFilenames  = await listCorePlugins()  → .files
   b. userFilenames  = await listUserPlugins()  → .files  (50-cap applies here)
      If .truncated.length > 0, emit console.warn (HF-2).

2. Build override set:
   userFilenameSet = new Set(userFilenames)

3. Process core files:
   For each filename in coreFilenames:
     If userFilenameSet.has(filename):
       Push PluginRecord {
         id: null, filename, kind: "core",
         status: "overridden", plugin: null, api: null, _enabled: false,
       }
       continue

     Read file: readPluginFile(filename) — BUT read from core dir.
     (NOTE: readPluginFile currently reads from the flat plugins/ dir.
      In step_03b we add a `kind` param to readPluginFile.
      Interim approach: read_plugin_file Rust command reads from the dir
      that matches the kind. See §2b-note below.)

     If read error → push failed record; continue.
     Evaluate: evaluatePlugin(source, filename, "core")
     If eval error → push failed record; continue.
     Check id collision against already-registered records.
     Build api = buildMarkablePluginAPI(plugin.id, statusBarZones)
     Push loaded record.

4. Process user files:
   For each filename in userFilenames:
     Skip already-registered filenames (idempotency — EC-23).
     Read, evaluate with kind="user", collision-check, build api, push.

5. Restore enabled state:
   For each loaded record:
     const saved = settings.plugins?.[record.plugin.id]
     if (saved?.enabled === true) await _enable(record)
```

### 2b-note. `readPluginFile` path routing

The current `read_plugin_file` Rust command reads from `plugins/` (the old flat dir).
After Chunk 2B it still reads from `plugins/user/` … actually: in the current code
`read_plugin_file` calls `plugins_dir(app)?.join(filename)` which resolves to
`~/…/plugins/<filename>` — the old flat path. The `list_user_plugins` command reads
from the same `plugins_dir` root, not from `plugins/user/`.

This means in step_03b we must update `read_plugin_file` to accept a `kind` param:

#### `src-tauri/src/commands/plugins.rs` — update `read_plugin_file`

Current signature (line 159):
```rust
pub fn read_plugin_file(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    sanitize_filename(&filename)?;
    let dir = plugins_dir(&app)?;
```

Replace with:
```rust
pub fn read_plugin_file(
    app: tauri::AppHandle,
    filename: String,
    kind: Option<String>,
) -> Result<String, String> {
    sanitize_filename(&filename)?;
    let dir = match kind.as_deref() {
        Some("core") => plugins_core_dir(&app)?,
        Some("user") | None => plugins_user_dir(&app)?,
        Some(other) => return Err(format!("Unknown plugin kind: {}", other)),
    };
```

The rest of the function body (size check, read_to_string) is unchanged.

`list_user_plugins` currently reads from `plugins_dir(app)` (the old flat root).
Update it to read from `plugins_user_dir(app)`:

```rust
// In list_user_plugins, replace:
let dir = ensure_plugins_dir(&app)?;
// With:
let dir = plugins_user_dir(&app)?;
ensure_dir(&dir)?;
```

Update `bridge.ts` `readPluginFile` wrapper:

```typescript
export async function readPluginFile(
  filename: string,
  kind?: "core" | "user",
): Promise<ReadPluginFileResult> {
  try {
    const source = await invoke<string>("read_plugin_file", {
      filename,
      kind: kind ?? null,
    });
    return { source };
  } catch (error) {
    const reason = typeof error === "string" ? error : String(error);
    console.warn(`Failed to read plugin file "${filename}":`, reason);
    return { error: reason };
  }
}
```

This is a backward-compatible change — existing callers that omit `kind` continue
to read from `plugins/user/` (same as the old `plugins/` flat dir after the migration).

### 2c. `getDefinitions()` — unified

Returns an array of unified plugin descriptor objects used by the plugins panel.
The shape is a superset of `PluginDef` to carry the new fields the panel needs:

```typescript
interface UnifiedPluginDef {
  id: string;
  name: string;
  description: string;
  detail: string;
  version: string;
  kind: "core" | "user";
  status: "loaded" | "failed" | "missing" | "overridden";
  failReason?: string;
}
```

Export this interface from `index.ts`. The plugins panel (step_03b) reads it.

`getDefinitions()` returns `UnifiedPluginDef[]` — one entry per record, both core
and user, in load order (core records first, user records second, within each group
in lexicographic filename order).

### 2d. `toggle(id, enabled): Promise<void>`

```typescript
async toggle(id: string, enabled: boolean): Promise<void> {
  const record = this._recordById(id);
  if (!record || record.status !== "loaded" || !record.plugin || !record.api) {
    console.warn(`PluginManager.toggle: unknown or non-loaded plugin id "${id}"`);
    return;
  }
  if (enabled) {
    await this._enable(record);
  } else {
    await this._disable(record);
  }
  // Persist new state into settings.plugins.
  void updateSettings((s) => ({
    ...s,
    plugins: {
      ...(s.plugins ?? {}),
      [id]: { enabled, kind: record.kind },
    },
  }));
}
```

### 2e. `_enable(record)` and `_disable(record)` private helpers

```typescript
private async _enable(record: PluginRecord): Promise<void> {
  if (!record.plugin || !record.api) return;
  try {
    const result = record.plugin.onEnable(record.api);
    if (result instanceof Promise) await result;
    record._enabled = true;
  } catch (err) {
    console.error(`[Plugin:${record.plugin.id}] onEnable threw:`, err);
    record._enabled = false;
  }
}

private async _disable(record: PluginRecord): Promise<void> {
  if (!record.plugin || !record.api) return;
  try {
    const result = record.plugin.onDisable(record.api);
    if (result instanceof Promise) await result;
  } catch (err) {
    console.error(`[Plugin:${record.plugin.id}] onDisable threw:`, err);
  } finally {
    record._enabled = false;
  }
}
```

### 2f. `getStates()` — unified

```typescript
getStates(): Record<string, boolean> {
  const states: Record<string, boolean> = {};
  for (const record of this._records) {
    if (record.id !== null && record.status === "loaded") {
      states[record.id] = record._enabled;
    }
  }
  return states;
}
```

### 2g. Private `_records` field and `_recordById` helper

```typescript
private _records: PluginRecord[] = [];

private _recordById(id: string): PluginRecord | undefined {
  return this._records.find((r) => r.id === id && r.status !== "overridden");
}
```

### 2h. `statusBarZones` — passed into `loadPlugins`

`buildMarkablePluginAPI` needs the three status bar DOM elements. They are passed
to `loadPlugins` from `main.ts` (the caller has access to DOM). Signature:

```typescript
async loadPlugins(
  settings: MarkableSettings,
  statusBarZones: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
): Promise<void>
```

---

## 3. Remove `getExtensions()` from `PluginManager`

Delete the entire `getExtensions()` method (lines 111–119 in the current
`src/plugins/index.ts`). It is no longer called after the static built-in imports
are removed.

---

## 4. `src/editor/extensions.ts` — remove static `getExtensions()` call

Current lines 188–191:
```typescript
// Push CM6 extensions contributed by all registered plugins via the static path.
// This call is retained for Chunk 1 compatibility and is removed in step_02c
// once all built-ins migrate to api.addExtensions() / api.removeExtensions().
extensions.push(...pluginManager.getExtensions());
```

Delete these four lines entirely. The `pluginCompartment.of([])` line immediately
below (line 196) is retained — it is the dynamic injection path.

Also delete the `pluginManager` import from `extensions.ts`:
```typescript
// DELETE this line (line 22):
import { pluginManager } from "../plugins/index";
```

And delete the comment block about it (lines 22–26):
```typescript
// NOTE: If a future plugin module ever imports from this file (extensions.ts),
// a circular dependency would be introduced. ...
```

---

## 5. `src/main.ts` — call-site updates

### 5a. Remove `buildPluginContext()` and `PluginContext` import

Delete the function `buildPluginContext()` (lines 668–683) in full.

Delete:
```typescript
// line 74:
import type { PluginContext } from "./plugins/plugin-types";
```

### 5b. Remove `scheduleWordCount` static call

The word-count plugin's IIFE version registers its own `EditorView.updateListener`
via `api.addExtensions()` in `onEnable`. The static `scheduleWordCount` call in
`main.ts` (lines 879–883) duplicates this and must be removed.

Delete:
```typescript
// line 76:
import { scheduleUpdate as scheduleWordCount } from "./plugins/word-count/word-count";
```

Delete lines 879–883:
```typescript
// Feed word count on doc change or selection change
if (update.docChanged || update.selectionSet) {
  const sel = update.state.selection.main;
  scheduleWordCount(update.state.doc.toString(), sel.from, sel.to);
}
```

The `editor.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of(...)) })`
block (lines 872–886) remains, but now only contains the dirty-state check:

```typescript
editor.dispatch({
  effects: StateEffect.appendConfig.of(
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !isReadOnly) {
        setDirty(true);
      }
    })
  ),
});
```

### 5c. Replace `restoreAll` + `loadUserPlugins` with `loadPlugins`

Current `initApp` sequence (lines 863–870):
```typescript
const ctx = buildPluginContext();
pluginManager.restoreAll(settings, ctx);
await pluginManager.loadUserPlugins(ctx, settings);
```

Replace with:
```typescript
const statusBarZones = {
  left:   document.getElementById("statusbar-left")   as HTMLElement,
  center: document.getElementById("statusbar-center") as HTMLElement,
  right:  document.getElementById("statusbar-right")  as HTMLElement,
};
await pluginManager.loadPlugins(settings, statusBarZones);
```

`migratePluginSettings` (step_03c) is called just before this block.

### 5d. Replace `createPluginsPanel` call

Current (lines 917–937):
```typescript
createPluginsPanel(
  pluginManager.getDefinitions(),
  pluginManager.getUserDefinitions(),
  (id, enabled) => {
    if (editor) pluginManager.toggle(id, enabled, buildPluginContext());
  },
  (id, enabled) => {
    if (editor) void pluginManager.toggleUserPlugin(id, enabled, buildPluginContext());
  },
  async () => { ... reloadUserPlugins ... },
);
```

Replace with:
```typescript
createPluginsPanel(
  pluginManager.getDefinitions(),
  pluginManager.getStates(),
  async (id, enabled) => {
    if (editor) await pluginManager.toggle(id, enabled);
  },
);
```

The "Reload" functionality is deferred to step_04b (panel rewrite). For now
the panel still works with the existing 5-argument signature but the reload
callback is a no-op. See step_03b §6 for the panel changes.

### 5e. Replace all `pluginManager.toggle(id, enabled, buildPluginContext())` call sites

There are three such call sites in `handleAction()` (lines 715, 718, 721):

```typescript
// Before:
if (editor) pluginManager.toggle("statusBar", !pluginManager.getStates().statusBar, buildPluginContext());
// After:
if (editor) void pluginManager.toggle("statusBar", !pluginManager.getStates()["status-bar"]);
```

```typescript
// Before:
if (editor) pluginManager.toggle("focusMode", !pluginManager.getStates().focusMode, buildPluginContext());
// After:
if (editor) void pluginManager.toggle("focus-mode", !pluginManager.getStates()["focus-mode"]);
```

```typescript
// Before:
if (editor) pluginManager.toggle("typewriterMode", !pluginManager.getStates().typewriterMode, buildPluginContext());
// After:
if (editor) void pluginManager.toggle("typewriter-mode", !pluginManager.getStates()["typewriter-mode"]);
```

Note: plugin ids change from camelCase to kebab-case in this step because IIFE
filenames are kebab-case. The `handleAction` switch cases that map old menu action
strings to plugin ids must also be updated (e.g. `"view-toggle-statusbar"` → id
`"status-bar"`).

---

## 6. `src/plugins/plugins-panel/plugins-panel.ts` — minimal update

A full panel rewrite is deferred to step_04b. In step_03b only the call signature
changes to accept the unified data structures:

```typescript
export function createPluginsPanel(
  defs: UnifiedPluginDef[],
  states: Record<string, boolean>,
  toggle: (id: string, enabled: boolean) => Promise<void>,
  reloadPlugins?: () => Promise<void>,  // optional; omitted until step_04b
): void
```

The panel renders all definitions from `defs` in a flat list (no core/user split yet
— that is step_04b). Each entry renders the `status` badge for failed/missing/overridden
entries. The "Reload" button in the User Plugins section is hidden when `reloadPlugins`
is not provided.

Import `UnifiedPluginDef` from `src/plugins/index.ts` (where it is exported):
```typescript
import type { UnifiedPluginDef } from "../index";
```

Remove imports of old types:
```typescript
// DELETE:
import type { PluginDef } from "../plugin-types";
import type { UserPluginDef } from "../user-plugin-types";
```

---

## 7. `src/plugins/plugin-types.ts` — deprecation annotations

Add JSDoc `@deprecated` annotations to `PluginContext`, `MarkablePlugin`, and
`PluginDef`. Do NOT delete the file yet (step_04c). This allows TypeScript to emit
deprecation hints during migration without breaking the build.

```typescript
/**
 * @deprecated since step_03b. Use MarkablePluginAPI from markable-plugin-api.ts instead.
 * Will be deleted in step_04c.
 */
export interface PluginContext { ... }

/**
 * @deprecated since step_03b. Use UnifiedPlugin from markable-plugin-api.ts instead.
 * Will be deleted in step_04c.
 */
export interface MarkablePlugin { ... }
```

---

## 8. Tests to write

Create `tests/plugin-manager-unified.test.ts`:

### 8a. `loadPlugins` override detection (EC-7, EC-8)

```
- core file whose filename exists in user/ gets status "overridden"
- user file that shares a name with a core file is loaded normally
- loaded user record id does not collide with loaded core record id (EC-12)
```

### 8b. `toggle` unified

```
- toggle("focus-mode", true) calls onEnable on the focus-mode record
- toggle("focus-mode", false) calls onDisable on the focus-mode record
- toggle for unknown id emits console.warn and does not throw
- toggle for failed record emits console.warn and does not throw (EC-13)
- toggle persists { plugins: { "focus-mode": { enabled: true, kind: "core" } } }
```

### 8c. `getStates` unified

```
- returns entries for all loaded records (core + user)
- does not include overridden or failed records
- returns _enabled = true only after _enable has been called
```

### 8d. `_enable` / `_disable` error isolation (EC-13, EC-14, EC-15)

```
- _enable: synchronous throw → _enabled stays false
- _enable: rejected promise → _enabled stays false
- _disable: throw → _enabled forced to false (finally)
```

### 8e. `getExtensions()` removed

```
- pluginManager.getExtensions is undefined (the method no longer exists)
```

---

## Verification Checklist

- [ ] `cargo test` passes (41+ Rust tests — `read_plugin_file` kind param)
- [ ] `npx tsc --noEmit` passes with 0 new errors
- [ ] `npm test` passes
- [ ] `pluginManager.getExtensions` does not exist (TypeScript error if called)
- [ ] `extensions.ts` no longer imports `pluginManager`
- [ ] `main.ts` no longer imports `PluginContext` or `scheduleWordCount`
- [ ] `main.ts` calls `pluginManager.loadPlugins(settings, statusBarZones)` once
- [ ] All four plugins load from disk and enable/disable correctly via the panel
- [ ] View > Toggle Focus mode menu item works (id: "focus-mode")
- [ ] View > Toggle Typewriter mode menu item works (id: "typewriter-mode")
- [ ] View > Toggle Status Bar menu item works (id: "status-bar")
- [ ] EC-7/EC-8: a file named "focus-mode.js" placed in plugins/user/ shows as
  "Overridden" in the core section and loads the user version
- [ ] EC-12: a user plugin with id "focus-mode" (different filename) is rejected
  with a collision error
- [ ] EC-23: loadPlugins called a second time does not re-register existing filenames

# Step 06 — Settings Persistence + main.ts Wiring + Tests

**Objective:** Wire everything together in `src/main.ts`; verify `userPlugins` key round-trips correctly through `settings.json`; add the plugin authoring guide; write integration tests covering all 27 edge cases.

**Traceability:** All 27 edge cases (EC-1 through EC-27), PC-5, PC-10, Definition of Done.

---

## Files to Modify

### `src/main.ts`

Four changes are needed, listed in order of their position in the file.

#### Change 1: New imports

Add to the existing import block (around lines 64–70):

```typescript
// After:
import { pluginManager } from "./plugins/index";
// Add:
import { updateUserPluginDefs } from "./plugins/plugins-panel/plugins-panel";
```

Add to the bridge imports (wherever `listThemes`, `updateThemeMenu` are imported):

```typescript
import {
  listUserPlugins,      // used indirectly via pluginManager — but bridge needs to be imported
  readPluginFile,       // same
  readPluginSettings,   // used by user-plugin-loader (no direct import needed in main.ts)
  writePluginSettings,  // same
} from "./lib/bridge";
```

Note: `listUserPlugins`, `readPluginFile`, `readPluginSettings`, `writePluginSettings` are called inside `user-plugin-loader.ts` and `index.ts` via their own internal imports from bridge.ts. The developer must verify those imports exist in those files (step_03 and step_04 already specify them). No additional import in `main.ts` is strictly required unless `main.ts` calls bridge functions directly. It does NOT call them directly — this note is a reminder to the developer that `bridge.ts` must be compiled with the new functions.

#### Change 2: Call `loadUserPlugins` after `restoreAll`

Current code (around lines 838–839):

```typescript
  const ctx = buildPluginContext();
  pluginManager.restoreAll(settings, ctx);
```

Change to:

```typescript
  const ctx = buildPluginContext();
  pluginManager.restoreAll(settings, ctx);

  // Load user plugins from the plugins directory.
  // Must run after restoreAll (built-ins) so id-collision checks against
  // built-in ids work correctly. Runs asynchronously; errors are isolated
  // per-plugin inside loadUserPlugins().
  await pluginManager.loadUserPlugins(ctx, settings);
```

`initApp()` is already `async` — the `await` is valid.

#### Change 3: Update `createPluginsPanel` call site

Current code (lines 886–891):

```typescript
  createPluginsPanel(
    pluginManager.getDefinitions(),
    (id, enabled) => {
      if (editor) pluginManager.toggle(id, enabled, buildPluginContext());
    },
  );
```

Replace with:

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
    async () => {
      // Reload user plugins: rescan directory, register new files, refresh panel.
      if (!editor) return;
      await pluginManager.reloadUserPlugins(buildPluginContext(), getCurrentSettings());
      updateUserPluginDefs(
        pluginManager.getUserDefinitions(),
        pluginManager.getUserStates(),
      );
    },
  );
```

#### Change 4: Update `togglePluginsPanel` call site

Locate (around line 684):

```typescript
    case "app-plugins":     togglePluginsPanel(pluginManager.getStates()); break;
```

Replace with:

```typescript
    case "app-plugins":
      togglePluginsPanel(pluginManager.getStates(), pluginManager.getUserStates());
      break;
```

---

## Settings Persistence Notes

### How `userPlugins` survives Rust round-trips (EC-15)

The Rust `save_settings` and `get_settings` commands preserve all JSON keys that are not in the Rust `MarkableSettings` struct by operating on the raw JSON string (from `docs/build-notes` and the MEMORY.md notes: "Rust settings persistence fix"). The `userPlugins` key is a frontend-only field. Because `save_settings` accepts a raw JSON string and writes it verbatim, `userPlugins` is preserved unchanged.

On load, `loadSettings()` in `src/lib/settings.ts` merges the loaded data over `DEFAULT_SETTINGS` (line 214 spread). Because `DEFAULT_SETTINGS` does not define `userPlugins`, the loaded value (or absence) passes through. If the key is absent from the loaded JSON (EC-15: first launch after feature upgrade), `settings.userPlugins` will be `undefined`, which the `loadUserPlugins` path handles via `settings.userPlugins?.[id]?.enabled`.

No migration is required.

### Stale entry cleanup (EC-17)

Plugins that were registered in a previous session but whose `.js` file has since been deleted are NOT cleaned up at launch. The `loadUserPlugins` call only processes files returned by `list_user_plugins`. Files not returned are simply never registered in the current session's `userPluginRecords`. The `settings.userPlugins` entry for that plugin remains in `settings.json` until the user manually clears it or a future cleanup pass is added.

The existing `userPlugins` key in `settings.json` is read only to determine enabled state for plugins that ARE successfully loaded. Stale keys for non-existing plugins are silently ignored.

The panel never shows "missing" entries from the previous session (because those plugins were never registered in the current session's records). EC-17 applies only to plugins deleted while the app is running — those remain in the current session's records with `status: "missing"`, which the panel displays with a grey badge.

---

## Plugin Authoring Guide

Create `docs/specs/user-plugins/authoring-guide.md`:

```markdown
# Markable User Plugin Authoring Guide

## File format

A user plugin is a single `.js` file placed in:

    ~/Library/Application Support/com.markable.app/plugins/

The file must contain a `return` statement at the top level that yields a plugin object:

    "use strict";

    let _element = null;

    return {
      id: "my-plugin",           // unique string; no dots, slashes, or backslashes
      name: "My Plugin",
      description: "One-line summary shown in the Plugins panel.",
      detail: "Optional longer description shown in the detail view.",

      onEnable(api) {
        _element = document.createElement("span");
        _element.textContent = "Hello";
        api.statusBar.center.appendChild(_element);
        api.ensureStatusBar();
      },

      onDisable(api) {
        _element?.remove();
        _element = null;
        api.hideStatusBarIfUnused();
      },
    };

## Available API (api parameter)

| Property | Type | Description |
|---|---|---|
| `api.statusBar.left` | `HTMLElement` | Left zone of the status bar |
| `api.statusBar.center` | `HTMLElement` | Center zone of the status bar |
| `api.statusBar.right` | `HTMLElement` | Right zone of the status bar |
| `api.ensureStatusBar()` | `void` | Show the status bar |
| `api.hideStatusBarIfUnused()` | `void` | Hide the status bar if no other plugin needs it |
| `api.loadSettings()` | `Promise<object \| null>` | Load this plugin's settings.json |
| `api.saveSettings(data)` | `Promise<void>` | Save settings to plugins/<id>/settings.json |

## Sandbox boundary (important)

Your plugin runs in the same WebView as Markable. `window`, `document`, and other browser globals are accessible. However, **you should not access `window.__TAURI_INTERNALS__` or call `invoke()` directly** — these are internal Tauri APIs that can change without notice and will bypass Markable's security model.

The only officially supported API is the `api` parameter passed to `onEnable` and `onDisable`.

## Reloading plugins

After installing a new plugin file, click **Reload** in the User Plugins section of the Plugins panel (Cmd-Shift-P). The new file will be evaluated and registered. Already-loaded plugins are not re-evaluated.

**Limitation (EC-22):** If you fix a bug in a plugin file, you must quit and relaunch Markable to pick up the corrected version. The Reload button only registers *new* files, not updated ones.

## Persisting settings

Use `api.loadSettings()` and `api.saveSettings(data)` to store plugin-specific settings as a JSON object. Settings are stored at `plugins/<your-plugin-id>/settings.json`. Save eagerly on each change rather than only in `onDisable`, because `onDisable` may not complete before the window closes (EC-26).

## Error handling

If `onEnable` or `onDisable` throws, the error is caught by Markable, logged to the console, and the plugin is marked disabled. Other plugins are unaffected.
```

---

## Test additions

### Update `tests/plugin-manager.test.ts`

The existing test at line 116 asserts `expect(mgr.getDefinitions().length).toBe(4)`. This test is for built-in plugins only and does not need to change (user plugins are in a separate list). Add a comment update:

```typescript
    it("returns exactly 4 built-in plugin definitions (WordCount, StatusBar, FocusMode, TypewriterMode)", () => {
      // Update this count when a new built-in plugin is added.
      // User plugins are tracked separately via getUserDefinitions().
      const mgr = new PluginManager();
      expect(mgr.getDefinitions().length).toBe(4);
    });
```

### Update `tests/plugins-panel.test.ts`

The existing test calls `updatePluginStates(partial)` with one argument. After the signature change, `updatePluginStates` accepts an optional second parameter. The existing test remains valid because the second parameter defaults to `{}`. No change needed.

Add one new test case to cover `updateUserPluginDefs` guard:

```typescript
import { updateUserPluginDefs } from "../src/plugins/plugins-panel/plugins-panel";

it("updateUserPluginDefs does not throw before createPluginsPanel is called", () => {
  expect(() => updateUserPluginDefs([], {})).not.toThrow();
});
```

### Edge case coverage matrix

The table below maps each EC to the test that covers it.

| EC | Description | Test location |
|----|-------------|---------------|
| EC-1 | Plugins dir absent on first launch | `step_01` Rust unit test (`list_user_plugins` autocreates dir) |
| EC-2 | Empty plugin file | `tests/user-plugin-loader.test.ts` "rejects empty source" |
| EC-3 | Syntax error in plugin file | `tests/user-plugin-loader.test.ts` "rejects source with syntax error" |
| EC-4 | Non-object return value | `tests/user-plugin-loader.test.ts` "rejects null" / "rejects string" |
| EC-5 | Missing required fields | `tests/user-plugin-loader.test.ts` "reports all missing fields" |
| EC-6 | Duplicate user plugin id | `tests/plugin-manager-user.test.ts` "rejects second plugin with duplicate id" |
| EC-7 | User plugin id collides with built-in | `tests/plugin-manager-user.test.ts` "rejects user plugin whose id matches built-in" |
| EC-8 | `onEnable` throws synchronously | `tests/plugin-manager-user.test.ts` "onEnable throw does not propagate" |
| EC-9 | `onEnable` returns rejected Promise | `tests/plugin-manager-user.test.ts` "onEnable throw does not propagate" (async onEnable) |
| EC-10 | `onDisable` throws | `tests/plugin-manager-user.test.ts` add test: `toggleUserPlugin` with throwing onDisable |
| EC-11 | Path traversal in filename | `step_01` Rust unit test (`sanitize_filename_rejects_traversal`) |
| EC-12 | File larger than 500 KB | `step_01` Rust unit test (requires temp file) |
| EC-13 | Invalid UTF-8 binary file | `step_01` Rust: `read_to_string` returns error; bridge returns null |
| EC-14 | Plugin accesses `window.__TAURI_INTERNALS__` | Code review: verify loader does not inject window/document/invoke into fn params |
| EC-15 | `userPlugins` key absent in settings.json | `tests/plugin-manager-user.test.ts` "loads plugin with no userPlugins in settings" |
| EC-16 | Toggle disabled plugin in error state | `tests/plugin-manager-user.test.ts` add: toggle failed plugin calls onDisable safely |
| EC-17 | Plugin file deleted while app running | Panel shows "missing" badge — visual test |
| EC-18 | Subdirectories in plugins dir | `step_01` Rust: `is_file()` check; add unit test with temp dir |
| EC-19 | Zero .js files in plugins dir | `tests/plugins-panel.test.ts` — render with empty userDefs shows placeholder |
| EC-20 | Invalid id characters | `tests/user-plugin-loader.test.ts` "rejects id with '.'" etc. |
| EC-21 | Reload re-encounters registered file | `tests/plugin-manager-user.test.ts` "does not re-evaluate on reload" |
| EC-22 | Corrected file not picked up on reload | Documented limitation in authoring guide; comment in `reloadUserPlugins` |
| EC-23 | `read_plugin_settings` for plugin with no settings.json | `step_01` Rust unit test; bridge returns null |
| EC-24 | `write_plugin_settings` subdir absent | `step_01` Rust: `create_dir_all` before write |
| EC-25 | `write_plugin_settings` with invalid JSON | `step_01` Rust: `serde_json::from_str` check before write |
| EC-26 | `saveSettings` called during shutdown | Documented convention in authoring guide |
| EC-27 | More than 50 .js files in dir | `step_01` Rust: `truncate(50)` after sort; add unit test |

---

## Verification Checklist (Definition of Done)

- [ ] `cargo test` — all Rust tests pass, including new tests in `plugins.rs`.
- [ ] `npm test` — all Vitest tests pass, including new tests in `user-plugin-loader.test.ts`, `plugin-manager-user.test.ts`, and updated `plugins-panel.test.ts`.
- [ ] `npx tsc --noEmit` — zero TypeScript errors across all modified files.
- [ ] `npm run tauri dev` — app launches without errors in the console.
- [ ] Plugins dir is created on first launch if absent (EC-1, visual).
- [ ] Installing a `.js` plugin file, clicking Reload, and toggling it on in the panel calls `onEnable` and shows its output (smoke test).
- [ ] Toggling the plugin off calls `onDisable` and removes its output (smoke test).
- [ ] Quitting and relaunching the app re-enables a previously-enabled user plugin (settings persistence).
- [ ] A plugin with a syntax error shows a red `(failed)` badge in the panel; other plugins load normally (EC-3).
- [ ] The plugins panel shows both "Built-in Plugins" and "User Plugins" sections, both open by default.
- [ ] The folder path label is visible in the User Plugins section.
- [ ] All 27 edge cases mapped in the table above are covered by at least a test or a documented limitation.
- [ ] `docs/specs/user-plugins/authoring-guide.md` documents the convention-only sandbox boundary (EC-14) and the Reload limitation (EC-22).
- [ ] No new entries in `src-tauri/capabilities/default.json`.
- [ ] No TODO comments in any new or modified source file.

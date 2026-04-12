# Active Task: Plugin Modularization

**Status:** Requirements Validated
**Date:** 2026-04-12
**Covers:** Refactoring the 4 existing FC2 plugins (Word Count, Status Bar, Focus Mode, Typewriter Mode) into self-contained directory modules with a formal `MarkablePlugin` interface and `PluginManager` class.

---

## 1. Feature Scope

This task is a pure refactor. No user-visible behavior changes are intended. The four working plugins are reorganized from their current scattered locations into a cohesive `src/plugins/` module tree with a formal interface and a manager class that eliminates all hardcoded plugin logic from `main.ts`.

**Problem being solved (confirmed from source):**

- `src/editor/focus-mode.ts` and `src/editor/typewriter-mode.ts` are co-located with infrastructure code rather than plugin code, making their purpose ambiguous.
- Status bar CSS (lines 712–742 of `styles.css`) and focus mode CSS (lines 744–748) live in the global stylesheet rather than alongside their plugin.
- `handlePluginToggle()` in `main.ts` is a 4-case switch statement. Adding a plugin requires editing `main.ts`.
- Plugin metadata (`name`, `description`, `detail`) is duplicated in the `plugins-panel.ts` `PLUGINS` array, far from each plugin's implementation.
- Module-level flags `statusBarVisible`, `wordCountEnabled`, `focusModeEnabled`, `typewriterModeEnabled` in `main.ts` each hold a single plugin's state — this does not scale.
- No formal `MarkablePlugin` interface exists.

**Intended outcome:**

Adding a 5th plugin must require only creating a new `src/plugins/<name>/` directory and registering the plugin in `PluginManager`'s constructor. Zero changes to `main.ts` must be required beyond the constructor call.

---

## 2. Constraints

- **Zero behavior change.** All 4 plugins must toggle on/off, persist across restarts, and function identically to the current implementation after the refactor.
- **Each step leaves the app in a working state.** Intermediate commits must not leave the app broken or any plugin non-functional. This is required because the work spans 10 steps.
- **No new dependencies.** This refactor introduces no new `npm` packages or Rust crates.
- **No test regressions.** The current test counts (29 Rust tests, 204 frontend Vitest tests) must remain passing throughout each step.
- **`MarkablePlugin` objects are exported as `const` object literals, not class instances.** This is the convention for future user-plugin compatibility.
- **CSS stays co-located with plugins.** Plugin CSS is imported inside the plugin's `index.ts` so Vite bundles it automatically, not via a global import in `styles.css`.
- **`getExtensions()` must be pure and idempotent.** It is called once during editor initialization; it must have no side effects and must return the same result on every call.
- **Plugin `id` === settings key.** The 4 existing settings keys (`wordCount`, `statusBar`, `focusMode`, `typewriterMode`) in `src/lib/settings.ts` `MarkableSettings` are immutable — plugin IDs must match them exactly.

---

## 3. Functional Requirements

### FR-1: `plugin-types.ts` — Formal Interface

Create `src/plugins/plugin-types.ts` (additive only, no file deletions) defining:

```typescript
export interface PluginContext {
  editor: EditorView;
  statusBar: { left: HTMLElement; center: HTMLElement; right: HTMLElement; };
  ensureStatusBar(): void;
  hideStatusBarIfUnused(): void;
}

export interface MarkablePlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly detail: string;
  getExtensions?(): Extension[];
  onEnable(ctx: PluginContext): void;
  onDisable(ctx: PluginContext): void;
  restoreFromSettings?(settings: MarkableSettings, ctx: PluginContext): void;
  isEnabled(): boolean;
}
```

Key decisions locked in by this interface:

- `id` is both the plugin identifier and the `MarkableSettings` key — no separate `settingsKey` field.
- `getExtensions()` is optional (e.g. Status Bar has no CM6 extension) and, when present, must be pure.
- `isEnabled()` reports the plugin's internally tracked state; `main.ts` must not maintain separate per-plugin boolean flags after Step 8.
- `restoreFromSettings` is optional; `PluginManager` provides a default boolean check via `settings[plugin.id]` when the method is absent.

### FR-2: Status Bar Plugin Module

Create `src/plugins/status-bar/`:

- `status-bar.ts` — extracts `ensureStatusBar()`, `hideStatusBarIfUnused()`, `STATUS_BAR_PLUGINS` set, and `statusBarVisible` state from `main.ts`. Exports `registerStatusBarDependent(id)` and `unregisterStatusBarDependent(id)` functions.
- `status-bar.css` — cut from `styles.css` lines 712–742 (`#statusbar`, `.statusbar-left`, `.statusbar-center`, `.statusbar-right` rules). Imported inside `index.ts`.
- `index.ts` — implements `MarkablePlugin`. `restoreFromSettings` checks `settings.statusBar?.visible`. `onEnable` shows the bar and persists the setting. `onDisable` hides the bar if no dependent plugin is registered and persists the setting.

**Critical contract:** After Step 2, `main.ts` must import `ensureStatusBar` and `hideStatusBarIfUnused` from `src/plugins/status-bar/status-bar.ts` rather than defining them locally. The `PluginContext` interface's `ensureStatusBar` and `hideStatusBarIfUnused` function members must be satisfied by the exported functions from this module.

### FR-3: Word Count Plugin Module

Create `src/plugins/word-count/`:

- `word-count.ts` — file content is unchanged; the file is moved from `src/plugins/word-count.ts`. Only the import paths in `main.ts` change.
- `index.ts` — implements `MarkablePlugin`. `onEnable` calls `enableWordCount(ctx.statusBar.center)`, `ctx.ensureStatusBar()`, then `registerStatusBarDependent("wordCount")`. `onDisable` calls `disableWordCount()`, `unregisterStatusBarDependent("wordCount")`, then `ctx.hideStatusBarIfUnused()`. `restoreFromSettings` checks `settings.wordCount`.

**Contract preserved:** `scheduleUpdate` (renamed `scheduleWordCount` at the call site in `main.ts`) continues to be called directly from `main.ts`'s CM6 `updateListener`. This is intentional — the plan explicitly avoids over-engineering the CM6 update pathway.

### FR-4: Focus Mode Plugin Module

Create `src/plugins/focus-mode/`:

- `focus-mode.ts` — file content is unchanged; moved from `src/editor/focus-mode.ts`. The old file at `src/editor/focus-mode.ts` is deleted.
- `focus-mode.css` — cut from `styles.css` lines 744–748 (`.cm-focus-dimmed` rule). Imported inside `index.ts`.
- `index.ts` — implements `MarkablePlugin`. `getExtensions()` returns `[focusModeExtension]`. `onEnable` dispatches `setFocusMode.of(true)` on the editor. `onDisable` dispatches `setFocusMode.of(false)`.

**`extensions.ts` import update:** The import of `focusModeExtension` in `src/editor/extensions.ts` must be updated from `"./focus-mode"` to `"../plugins/focus-mode/focus-mode"`.

### FR-5: Typewriter Mode Plugin Module

Create `src/plugins/typewriter-mode/`:

- `typewriter-mode.ts` — file content is unchanged; moved from `src/editor/typewriter-mode.ts`. The old file at `src/editor/typewriter-mode.ts` is deleted.
- No CSS file — typewriter mode uses imperative inline padding only, confirmed from source.
- `index.ts` — implements `MarkablePlugin`. `getExtensions()` returns `[typewriterModeExtension]`. `onEnable` dispatches `setTypewriterMode.of(true)`. `onDisable` dispatches `setTypewriterMode.of(false)`.

**`extensions.ts` import update:** The import of `typewriterModeExtension` must be updated from `"./typewriter-mode"` to `"../plugins/typewriter-mode/typewriter-mode"`.

### FR-6: PluginManager Class

Create `src/plugins/index.ts` exporting:

```typescript
export class PluginManager {
  private plugins: MarkablePlugin[];
  getExtensions(): Extension[]      // Aggregates all plugin getExtensions() results
  toggle(id, enabled, ctx): void    // Replaces handlePluginToggle switch
  restoreAll(settings, ctx): void   // Replaces the FC2 restore block in initApp()
  getStates(): Record<string, boolean>   // For plugins panel open call
  getDefinitions(): PluginDef[]          // For plugins panel list rendering
}

export const pluginManager = new PluginManager();
```

Registration order in constructor (determines panel display order):

```
[WordCountPlugin, StatusBarPlugin, FocusModePlugin, TypewriterModePlugin]
```

**`toggle()` behavior:** Calls `plugin.onEnable(ctx)` or `plugin.onDisable(ctx)` and persists the change via `updateSettings`. Does not duplicate settings-persistence logic that already lives inside each plugin's `onEnable`/`onDisable`.

**`restoreAll()` behavior:** Iterates over all plugins. For each plugin, calls `plugin.restoreFromSettings(settings, ctx)` if the method exists; otherwise applies the default boolean check (`settings[plugin.id] === true`). Replaces the lines 902–922 block in `main.ts`'s `initApp()`.

**`getDefinitions()` return type:** Returns `PluginDef[]` as currently defined in `plugins-panel.ts`, reusing the same interface shape. `PluginDef` type must be exported from `plugin-types.ts` after the refactor.

### FR-7: Plugins Panel Decoupling

Update `src/plugins/plugins-panel.ts`:

- Remove the hardcoded `PLUGINS: PluginDef[]` array (lines 19–44 of current file).
- Change the `createPluginsPanel` signature to add `definitions: PluginDef[]` as the first parameter. The existing `toggleCallback` parameter remains as the second.
- The `main.ts` call site becomes: `createPluginsPanel(pluginManager.getDefinitions(), (id, enabled) => pluginManager.toggle(id, enabled, buildPluginContext()))`.

**`updatePluginStates` stays.** It is still needed for external state syncing (e.g. when word count auto-enables the status bar). It is called from inside `status-bar.ts`'s `ensureStatusBar`/`hideStatusBarIfUnused` rather than from `main.ts`.

### FR-8: `main.ts` Cleanup

After Step 8, `main.ts` must no longer contain:

| Removed | Replaced by |
|---------|-------------|
| `import { setFocusMode }` | Imported inside `focus-mode/index.ts` |
| `import { setTypewriterMode }` | Imported inside `typewriter-mode/index.ts` |
| `let statusBarVisible`, `let wordCountEnabled`, `let focusModeEnabled`, `let typewriterModeEnabled` | `plugin.isEnabled()` via `pluginManager` |
| `function getPluginStates()` | `pluginManager.getStates()` |
| `const STATUS_BAR_PLUGINS`, `function ensureStatusBar()`, `function hideStatusBarIfUnused()` | `status-bar.ts` module |
| `function handlePluginToggle()` switch | `pluginManager.toggle(id, enabled, ctx)` |
| `function toggleStatusBar/toggleFocusMode/toggleTypewriterMode` | Inline `pluginManager.toggle` in `handleAction` |
| FC2 restore block (lines 902–922) | `pluginManager.restoreAll(settings, ctx)` |

**What stays in `main.ts`:**

- `import { scheduleUpdate as scheduleWordCount }` — word count is still called directly from the CM6 `updateListener`.
- `handleAction` switch (format/file/view/theme actions) — simplified to single-line `pluginManager.toggle` for the 4 plugin-related cases.
- `buildPluginContext()` helper — constructs `PluginContext` from `editor` and DOM elements after editor creation; imports `ensureStatusBar` and `hideStatusBarIfUnused` from `status-bar.ts`.

### FR-9: `extensions.ts` Optional Simplification (Step 9)

This step is marked optional in the plan. The two import path updates (FR-4 and FR-5) are mandatory. Replacing them with `pluginManager.getExtensions()` is optional, but if done:

- Must verify no circular dependency: `extensions.ts` would import from `src/plugins/index.ts`, which imports plugin modules, which import from `@codemirror/*` — no loop through `extensions.ts` itself.
- Circular dependency check is a required gate before this optional step is performed.

### FR-10: Plugins Panel Directory Move (Step 10)

Move `src/plugins/plugins-panel.ts` and `src/plugins/plugins-panel.css` to `src/plugins/plugins-panel/`:

- Update the `@import` in `plugins-panel.css` from `"../settings/settings-panel.css"` to `"../../settings/settings-panel.css"`.
- Update the import path in `main.ts` from `"./plugins/plugins-panel"` to `"./plugins/plugins-panel/plugins-panel"`.
- No behavior changes.

---

## 4. Implementation Step Order

Each step must leave the app fully functional before proceeding to the next.

| Step | Action | Files Modified |
|------|--------|---------------|
| 1 | Create `plugin-types.ts` (additive only) | `src/plugins/plugin-types.ts` (new) |
| 2 | Extract status-bar module + CSS | `src/plugins/status-bar/` (new), `styles.css`, `main.ts` |
| 3 | Move focus-mode to plugins + extract CSS | `src/plugins/focus-mode/` (new), `src/editor/focus-mode.ts` (delete), `extensions.ts`, `styles.css` |
| 4 | Move typewriter-mode to plugins | `src/plugins/typewriter-mode/` (new), `src/editor/typewriter-mode.ts` (delete), `extensions.ts` |
| 5 | Move word-count into subdirectory | `src/plugins/word-count/` (new), `src/plugins/word-count.ts` (delete), `main.ts` import path |
| 6 | Create PluginManager (not yet wired into `main.ts`) | `src/plugins/index.ts` (new) |
| 7 | Wire PluginManager to plugins-panel | `plugins-panel.ts`, `main.ts` (createPluginsPanel call only) |
| 8 | Wire PluginManager to `main.ts` (full cleanup) | `main.ts` — remove flags, switch, restore block |
| 9 | (Optional) Simplify extensions.ts | `src/editor/extensions.ts` |
| 10 | Move plugins-panel into subdirectory | `src/plugins/plugins-panel/`, update `@import` depth |

---

## 5. Verification Criteria

After all steps are complete, the following must be true:

1. `npm run tauri dev` launches; all 4 plugins toggle correctly via the Plugins panel.
2. Quit and relaunch — all previously-enabled plugins restore from `settings.json` identically to current behavior.
3. `src/editor/` contains neither `focus-mode.ts` nor `typewriter-mode.ts`.
4. `src/styles.css` contains no `#statusbar` or `.cm-focus-dimmed` rules.
5. `main.ts` contains no `let statusBarVisible`, `let wordCountEnabled`, `let focusModeEnabled`, `let typewriterModeEnabled` declarations.
6. `main.ts` contains no `handlePluginToggle` function.
7. `main.ts` contains no `switch` statement that dispatches plugin-specific `setFocusMode` or `setTypewriterMode` effects directly.
8. All 29 Rust tests and all 204 frontend Vitest tests (minus the 27 documented skip cases) pass.
9. Adding a 5th plugin requires only: create `src/plugins/new-plugin/index.ts` implementing `MarkablePlugin`, add to `PluginManager` constructor. No changes to `main.ts` are required.

---

## 6. Edge Case Inventory

All items below are mandatory verification items for the Code Reviewer.

| # | Step | Edge Case | Expected Behavior |
|---|------|-----------|-------------------|
| EC-1 | Step 2 | `ensureStatusBar()` is called before the status bar DOM element exists in the document | Must guard with null check on `document.getElementById("statusbar")`, consistent with current implementation |
| EC-2 | Step 2 | `hideStatusBarIfUnused()` is called while Word Count is still enabled (e.g. Status Bar manually disabled via panel while Word Count is on) | Status bar `STATUS_BAR_PLUGINS` set check prevents hiding; status bar remains visible |
| EC-3 | Step 2 | `registerStatusBarDependent` called twice for the same plugin id (e.g. double-enable) | Set semantics handle this — second `add()` is a no-op; no duplication |
| EC-4 | Step 3 | `focusModeExtension` is registered in `extensions.ts` at the time the editor is built, but `onEnable` has not yet been called | Extension is always registered; the `focusModeField` StateField defaults to `false`. No visual change until `onEnable` dispatches the effect. Confirmed safe by existing code. |
| EC-5 | Step 3 | Import path in `extensions.ts` is updated but old `src/editor/focus-mode.ts` file is not deleted in the same commit | TypeScript compiler will not error (both exports are compatible), but the old file creates dead code. The file deletion and the import update must occur in the same step. |
| EC-6 | Step 4 | Same as EC-5 for `src/editor/typewriter-mode.ts` | Same resolution — deletion and import update in the same commit. |
| EC-7 | Step 5 | `main.ts` still imports `scheduleUpdate` from the old path `"./plugins/word-count"` after the file is moved to `"./plugins/word-count/word-count"` | TypeScript will error at build time, catching the problem immediately. The import path must be updated in Step 5. |
| EC-8 | Step 6 | `PluginManager` is instantiated as a module-level singleton before the editor exists; `getExtensions()` is called before the DOM is ready | `getExtensions()` must be pure (no DOM or editor access). Confirmed by design — it only delegates to each plugin's `getExtensions()`, which returns static CM6 extension arrays. |
| EC-9 | Step 7 | Plugins panel is opened before `pluginManager` singleton is initialized (e.g. module load order issue) | ES module imports are resolved before any code runs; `pluginManager` is a module-level `const`. No timing issue is possible. |
| EC-10 | Step 8 | `pluginManager.restoreAll()` calls `onEnable` on WordCountPlugin, which calls `ctx.ensureStatusBar()`, which calls `updatePluginStates()` — but the plugins panel DOM has not been created yet | `updatePluginStates()` guards with `if (!panelElement) return`. Confirmed safe from current `openPluginsPanel` / `updatePluginStates` source. Must be verified that the guard survives the refactor. |
| EC-11 | Step 8 | `buildPluginContext()` is called before `editor` is non-null | `buildPluginContext()` is only called after `editor = createEditor(...)` succeeds; it must not be called from a code path that runs before the editor is created. Must be verified at call sites in `main.ts`. |
| EC-12 | Step 8 | `pluginManager.toggle("statusBar", false, ctx)` is dispatched while Word Count is enabled | `StatusBarPlugin.onDisable` must call `hideStatusBarIfUnused()`, which checks the `STATUS_BAR_PLUGINS` set. Because Word Count is still registered, the bar must not hide. This replicates the current behavior of `hideStatusBarIfUnused()` in `main.ts`. |
| EC-13 | Step 9 (optional) | Circular dependency: `extensions.ts` imports `pluginManager` from `src/plugins/index.ts`, which imports `FocusModePlugin` from `src/plugins/focus-mode/index.ts`, which imports `focusModeExtension` from `./focus-mode.ts` — no dependency back to `extensions.ts` | Must be confirmed via a dependency graph check or build dry-run before Step 9 is performed. If a cycle is detected, Step 9 must be skipped. |
| EC-14 | Step 10 | `@import` path depth in `plugins-panel.css` is updated incorrectly (e.g. single `../` instead of double `../../`) | Vite will throw a build error; the panel will be visually broken. Must verify with a `tauri dev` run after Step 10. |
| EC-15 | Any step | A plugin's `isEnabled()` returns stale state after a settings restore if `_enabled` is not updated inside `restoreFromSettings` | Each plugin's `restoreFromSettings` (or the PluginManager default path) must update the internal `_enabled` flag before calling `onEnable`. |
| EC-16 | Any step | `PluginDef` type is referenced in both `plugin-types.ts` (new canonical location) and the existing `plugins-panel.ts`; the duplicate definition causes a type mismatch at the call site | `PluginDef` must be moved to `plugin-types.ts` and re-exported or re-imported in `plugins-panel.ts`. Both files must use the same interface. |

---

## 7. Out of Scope

- **User plugin loading** (`src/plugins/user/` + `import.meta.glob`): The foundations are established by this refactor (plugin interface, manager) but the dynamic loader is explicitly deferred.
- **New plugins**: No new plugin functionality (Markdown Toolbar, Auto TOC, Templates, etc.) is added in this task.
- **Settings UI changes**: The Plugins panel UI is unchanged in behavior. Only the data source for the plugin list changes (from hardcoded to `pluginManager.getDefinitions()`).
- **Keybinding changes**: No keyboard shortcuts are added or changed.
- **Rust/backend changes**: All changes are TypeScript/CSS only.
- **Advanced Lists plugin**: Not included in the 4 plugins being modularized; it is treated as a separate in-progress feature.

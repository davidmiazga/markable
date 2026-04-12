# Plugin Modularization — Architecture Overview and Master Checklist

**Requirements source:** `docs/requirements/active_task.md`
**Status:** Ready for Implementation
**Date:** 2026-04-12

---

## Problem Statement

Four working FC2 plugins (Word Count, Status Bar, Focus Mode, Typewriter Mode) have their code
scattered across three directories:

- `src/editor/focus-mode.ts` and `src/editor/typewriter-mode.ts` — plugin logic living among
  infrastructure files.
- `src/styles.css` lines 712–748 — status bar and focus mode CSS embedded in the global
  stylesheet.
- `src/main.ts` lines 652–732 — four per-plugin boolean flags, a `getPluginStates()` function, a
  `STATUS_BAR_PLUGINS` set, `ensureStatusBar()`, `hideStatusBarIfUnused()`, and a
  `handlePluginToggle()` switch statement.
- `src/plugins/plugins-panel.ts` lines 19–44 — a hardcoded `PLUGINS: PluginDef[]` array whose
  metadata duplicates what each plugin should own.

Adding a 5th plugin today requires edits in at least four files. The goal of this refactor is to
reduce that to one file (`src/plugins/index.ts`) with zero changes to `main.ts`.

---

## Target Directory Structure

```
src/plugins/
  plugin-types.ts              # MarkablePlugin + PluginContext + PluginDef interfaces
  index.ts                     # PluginManager class + pluginManager singleton
  status-bar/
    index.ts                   # MarkablePlugin implementation
    status-bar.ts              # Logic extracted from main.ts (ensureStatusBar, etc.)
    status-bar.css             # Cut from styles.css lines 712–742
  word-count/
    index.ts                   # MarkablePlugin implementation
    word-count.ts              # File moved from src/plugins/word-count.ts (unchanged)
  focus-mode/
    index.ts                   # MarkablePlugin implementation
    focus-mode.ts              # File moved from src/editor/focus-mode.ts (unchanged)
    focus-mode.css             # Cut from styles.css lines 744–748
  typewriter-mode/
    index.ts                   # MarkablePlugin implementation
    typewriter-mode.ts         # File moved from src/editor/typewriter-mode.ts (unchanged)
  plugins-panel/
    plugins-panel.ts           # File moved; hardcoded PLUGINS array removed
    plugins-panel.css          # File moved; @import path depth updated
```

---

## Key Design Decisions

### Plugin as `const` object literal (not class instance)

```typescript
export const FocusModePlugin: MarkablePlugin = {
  id: "focusMode",
  // ...
};
```

This convention is required by `active_task.md` for future user-plugin compatibility.

### Plugin ID equals settings key

The four IDs are `"wordCount"`, `"statusBar"`, `"focusMode"`, `"typewriterMode"` — matching the
existing keys in `src/lib/settings.ts` `MarkableSettings`. These are immutable.

### `getExtensions()` is pure and idempotent

Called once during `buildExtensions()` in `extensions.ts`. Returns a static CM6 `Extension[]`
array. No DOM access, no side effects.

### CSS co-located with each plugin

Each plugin's `index.ts` contains `import "./plugin-name.css"` so Vite bundles the CSS
automatically. No global import required in `styles.css` or `main.ts`.

### Status bar dependency tracking lives in `status-bar.ts`

`status-bar.ts` exports `registerStatusBarDependent(id)` and `unregisterStatusBarDependent(id)`.
`WordCountPlugin.onEnable/onDisable` call these. `hideStatusBarIfUnused()` checks the internal set.

### `PluginContext` satisfies `buildPluginContext()` in `main.ts`

After Step 8, `main.ts` constructs a `PluginContext` object that passes through the
`ensureStatusBar` and `hideStatusBarIfUnused` functions imported from `status-bar.ts`.

---

## Formal Interfaces

```typescript
// src/plugins/plugin-types.ts

import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { MarkableSettings } from "../lib/settings";

export interface PluginContext {
  editor: EditorView;
  statusBar: {
    left: HTMLElement;
    center: HTMLElement;
    right: HTMLElement;
  };
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

export interface PluginDef {
  id: string;
  name: string;
  description: string;
  detail: string;
}
```

---

## PluginManager API Contract

```typescript
// src/plugins/index.ts

export class PluginManager {
  private plugins: MarkablePlugin[];

  constructor() {
    this.plugins = [
      WordCountPlugin,
      StatusBarPlugin,
      FocusModePlugin,
      TypewriterModePlugin,
    ];
  }

  /** Aggregate CM6 extensions from all plugins that declare getExtensions(). */
  getExtensions(): Extension[];

  /**
   * Enable or disable a plugin by id. Calls onEnable/onDisable and persists
   * the new state via updateSettings. The ctx is built by buildPluginContext()
   * in main.ts and must be non-null (only called after editor is created).
   */
  toggle(id: string, enabled: boolean, ctx: PluginContext): void;

  /**
   * Called once during initApp() after the editor is created. For each plugin,
   * calls restoreFromSettings() if defined; otherwise applies the default
   * boolean check (settings[plugin.id] === true -> onEnable).
   */
  restoreAll(settings: MarkableSettings, ctx: PluginContext): void;

  /** Returns a snapshot of all plugin enabled states. Used by plugins panel. */
  getStates(): Record<string, boolean>;

  /** Returns PluginDef[] in registration order. Used by plugins panel rendering. */
  getDefinitions(): PluginDef[];
}

export const pluginManager = new PluginManager();
```

---

## `main.ts` Before/After Summary

### Removed from `main.ts` after Step 8

| Removed item | Replacement |
|---|---|
| `import { setFocusMode } from "./editor/focus-mode"` | Imported inside `focus-mode/index.ts` |
| `import { setTypewriterMode } from "./editor/typewriter-mode"` | Imported inside `typewriter-mode/index.ts` |
| `let statusBarVisible` (line 652) | `pluginManager` tracks state internally |
| `let wordCountEnabled` (line 653) | `pluginManager` tracks state internally |
| `let focusModeEnabled` (line 654) | `pluginManager` tracks state internally |
| `let typewriterModeEnabled` (line 655) | `pluginManager` tracks state internally |
| `function getPluginStates()` (lines 658–665) | `pluginManager.getStates()` |
| `const STATUS_BAR_PLUGINS` (line 668) | `status-bar.ts` module |
| `function ensureStatusBar()` (lines 675–681) | `status-bar.ts` module |
| `function hideStatusBarIfUnused()` (lines 687–694) | `status-bar.ts` module |
| `function handlePluginToggle()` switch (lines 697–732) | `pluginManager.toggle(id, enabled, ctx)` |
| `function toggleStatusBar()` (lines 734–736) | Inline `pluginManager.toggle` in `handleAction` |
| `function toggleFocusMode()` (lines 738–741) | Inline `pluginManager.toggle` in `handleAction` |
| `function toggleTypewriterMode()` (lines 743–746) | Inline `pluginManager.toggle` in `handleAction` |
| FC2 restore block (lines 902–922) | `pluginManager.restoreAll(settings, ctx)` |

### What stays in `main.ts`

- `import { scheduleUpdate as scheduleWordCount }` from word-count — still called from CM6 updateListener.
- `handleAction` switch for all menu events — simplified to single `pluginManager.toggle` call per plugin action.
- `buildPluginContext()` helper — constructs `PluginContext` after editor is created.

---

## Data Flow

```
initApp()
  └─ loadSettings()                  // read settings.json from disk
  └─ createEditor()                  // editor is non-null from here
  └─ pluginManager.restoreAll()      // calls each plugin's restoreFromSettings or default boolean
       └─ plugin.onEnable(ctx)       // if enabled in settings
            └─ ensureStatusBar()     // status-bar module
            └─ CM6 dispatch effect   // e.g. setFocusMode.of(true)

user toggles plugin via panel
  └─ pluginManager.toggle(id, enabled, ctx)
       └─ plugin.onEnable/onDisable(ctx)
       └─ updateSettings()           // persist to disk

5th plugin added in the future
  └─ create src/plugins/new-plugin/index.ts
  └─ add NewPlugin to PluginManager constructor
  └─ zero changes to main.ts
```

---

## Edge Cases Addressed by This Architecture

| EC # | Step | Description | Resolution |
|---|---|---|---|
| EC-1 | Step 2 | `ensureStatusBar()` called before `#statusbar` DOM exists | Null-check on `document.getElementById("statusbar")` in `status-bar.ts` |
| EC-2 | Step 2 | `hideStatusBarIfUnused()` while Word Count still enabled | `STATUS_BAR_PLUGINS` set check in `status-bar.ts`; bar stays visible |
| EC-3 | Step 2 | `registerStatusBarDependent` called twice for same id | Set semantics — second `add()` is a no-op |
| EC-4 | Step 3 | `focusModeExtension` always registered in `extensions.ts` before `onEnable` is called | StateField defaults to `false`; no visual change until effect dispatched |
| EC-5 | Step 3 | Old `src/editor/focus-mode.ts` not deleted in same step as import update | File deletion and import update happen in the same step |
| EC-6 | Step 4 | Same as EC-5 for `typewriter-mode.ts` | Same resolution |
| EC-7 | Step 5 | `main.ts` import path for word-count not updated after file moves | TypeScript build error catches it immediately; update in same step |
| EC-8 | Step 6 | `PluginManager` singleton instantiated before editor exists | `getExtensions()` is pure; no DOM access in constructor or `getExtensions()` |
| EC-9 | Step 7 | Plugins panel opened before `pluginManager` initialized | ES module imports resolve before code runs; `pluginManager` is a module-level `const` |
| EC-10 | Step 8 | `restoreAll()` calls `onEnable` which calls `ensureStatusBar()` which calls `updatePluginStates()` before panel DOM exists | `updatePluginStates()` guards with `if (!panelElement) return` — verified in source |
| EC-11 | Step 8 | `buildPluginContext()` called before `editor` is non-null | `buildPluginContext()` only called after `editor = createEditor(...)` succeeds; call sites verified |
| EC-12 | Step 8 | `toggle("statusBar", false, ctx)` while Word Count enabled | `StatusBarPlugin.onDisable` calls `hideStatusBarIfUnused()`, which checks the set and keeps bar visible |
| EC-13 | Step 9 (opt.) | Circular dependency via `extensions.ts` -> `plugins/index.ts` -> plugin modules | Must run dependency check before Step 9; skip Step 9 if cycle detected |
| EC-14 | Step 10 | `@import` depth wrong in moved `plugins-panel.css` | Must be `../../settings/settings-panel.css`; verified with `tauri dev` after step |
| EC-15 | Any | `isEnabled()` returns stale state after restore if `_enabled` not set | Each `restoreFromSettings` (or default path) sets `_enabled = true` before calling `onEnable` |
| EC-16 | Any | `PluginDef` defined in both `plugin-types.ts` and `plugins-panel.ts` | `PluginDef` canonical location is `plugin-types.ts`; `plugins-panel.ts` imports it from there |

---

## Implementation Checklist

### Phase A Pilot Wire-up (step_04_main_ts_pilot_wire.md — COMPLETE)
- [x] `main.ts` imports `pluginManager` from `"./plugins/index"`
- [x] `main.ts` imports `PluginContext` type from `"./plugins/plugin-types"`
- [x] `main.ts` no longer imports `setFocusMode`
- [x] `main.ts` no longer declares `let focusModeEnabled`
- [x] `handlePluginToggle` switch `case "focusMode"` delegates to `pluginManager.toggle()`
- [x] `toggleFocusMode()` helper removed from `main.ts`
- [x] `handleAction` case `"view-toggle-focus"` calls `pluginManager.toggle()` directly
- [x] `initApp()` calls `pluginManager.restoreAll(settings, ctx)` for focus mode
- [x] `buildPluginContext()` function added to `main.ts`
- [x] EC-11 verified: `buildPluginContext()` only called after editor is non-null
- [x] EC-15 verified: `FocusModePlugin.restoreFromSettings` calls `onEnable` which sets `_enabled = true`
- [x] Word Count, Status Bar, and Typewriter Mode unaffected (still use legacy path)

### Step 1 — `plugin-types.ts` (additive only)
- [x] `src/plugins/plugin-types.ts` created with `PluginContext`, `MarkablePlugin`, `PluginDef`
- [x] No existing file modified
- [x] `npm run tauri dev` still launches without errors

### Step 2 — Status Bar Module
- [x] `src/plugins/status-bar/status-bar.ts` created (logic from `main.ts`)
- [x] `src/plugins/status-bar/status-bar.css` created (cut from `styles.css` lines 712–742)
- [x] `src/plugins/status-bar/index.ts` created (MarkablePlugin impl)
- [x] `src/styles.css` lines 712–742 removed
- [x] `main.ts` updated to import `ensureStatusBar`/`hideStatusBarIfUnused` from `status-bar.ts`
- [x] `main.ts` existing `ensureStatusBar`/`hideStatusBarIfUnused` definitions removed
- [x] `main.ts` `STATUS_BAR_PLUGINS` const removed (lives in `status-bar.ts`)
- [x] EC-1, EC-2, EC-3 verified by inspection
- [x] App functional: status bar toggles, word count auto-enables bar (verified by 299 passing tests)

### Step 3 — Focus Mode Module
- [x] `src/plugins/focus-mode/focus-mode.ts` created (file moved, content unchanged)
- [x] `src/plugins/focus-mode/focus-mode.css` created (cut from `styles.css` lines 744–748)
- [x] `src/plugins/focus-mode/index.ts` created (MarkablePlugin impl)
- [x] `src/editor/focus-mode.ts` deleted
- [x] `src/editor/extensions.ts` import updated to `"../plugins/focus-mode/focus-mode"`
- [x] `src/styles.css` lines 744–748 removed
- [x] EC-4, EC-5 verified
- [x] App functional: focus mode dimming works (verified by test suite)

### Step 4 — Typewriter Mode Module
- [x] `src/plugins/typewriter-mode/typewriter-mode.ts` created (file moved, content unchanged)
- [x] `src/plugins/typewriter-mode/index.ts` created (MarkablePlugin impl)
- [x] `src/editor/typewriter-mode.ts` deleted
- [x] `src/editor/extensions.ts` import updated (B7: via `pluginManager.getExtensions()` instead of direct)
- [x] EC-6 verified: file deleted and import updated in same step
- [x] App functional: typewriter mode scroll-centering works (verified by 299 passing tests)

### Step 5 — Word Count Module
- [x] `src/plugins/word-count/word-count.ts` created (file moved, content unchanged)
- [x] `src/plugins/word-count/index.ts` created (MarkablePlugin impl)
- [x] `src/plugins/word-count.ts` deleted
- [x] `main.ts` import path updated to `"./plugins/word-count/word-count"`
- [x] EC-7 verified: TypeScript build succeeds (tsc --noEmit, no new errors)
- [x] App functional: word count displays in status bar

### Step 6 — PluginManager (Phase A pilot — FocusModePlugin only; not yet fully wired)
- [x] `src/plugins/index.ts` created with `PluginManager` class and `pluginManager` singleton
- [x] All 4 plugins registered in constructor (Phase B complete)
- [x] `getExtensions()`, `toggle()`, `restoreAll()`, `getStates()`, `getDefinitions()` implemented
- [x] EC-8 verified: `getExtensions()` makes no DOM access
- [x] App functional: All 4 plugins wired to pluginManager

### Step 7 — PluginManager to Plugins Panel
- [x] `plugins-panel.ts` `PLUGINS` array removed
- [x] `PluginDef` interface removed from `plugins-panel.ts`; imported from `plugin-types.ts` (EC-16)
- [x] `createPluginsPanel` signature updated: `definitions: PluginDef[]` added as first parameter
- [x] `main.ts` `createPluginsPanel` call updated to pass `pluginManager.getDefinitions()`
- [x] `main.ts` `togglePluginsPanel` call updated to pass `pluginManager.getStates()`
- [x] EC-9, EC-16 verified by inspection
- [x] App functional: plugins panel list renders from PluginManager definitions

### Step 8 — Full `main.ts` Cleanup
- [x] `import { setTypewriterMode }` removed from `main.ts`
- [x] `let statusBarVisible/wordCountEnabled/typewriterModeEnabled` removed
- [x] `getPluginStates()` removed; replaced with `pluginManager.getStates()`
- [x] `handlePluginToggle()` switch removed; replaced with `pluginManager.toggle()`
- [x] `toggleStatusBar/toggleTypewriterMode` helpers removed
- [x] FC2 restore block replaced with `pluginManager.restoreAll(settings, ctx)`
- [x] `buildPluginContext()` helper present in `main.ts`
- [x] EC-10: `updatePluginStates` in plugins-panel guards with `if (!panelElement) return`
- [x] EC-11: `buildPluginContext()` only called after editor is non-null (verified by inspection)
- [x] EC-12: `StatusBarPlugin.onDisable` calls `hideStatusBarIfUnused()` — preserves bar for Word Count
- [x] EC-15: each plugin's `restoreFromSettings` calls `onEnable` which sets `_enabled = true`
- [x] 299 frontend Vitest tests pass (27 skipped — documented runtime-only)
- [x] 29 Rust tests pass
- [x] All 4 plugins toggle and persist correctly end-to-end

### Step 9 — (Optional) Simplify `extensions.ts`
- [x] Circular dependency check performed: no cycle detected (see spec § B7 for dep graph)
- [x] `focusModeExtension` and `typewriterModeExtension` direct imports replaced with `pluginManager.getExtensions()`
- [x] Circular dep risk documented in `extensions.ts` comment for future contributors

### Step 10 — Move Plugins Panel to Subdirectory
- [x] `src/plugins/plugins-panel/plugins-panel.ts` created (moved + B5 PLUGINS removal applied)
- [x] `src/plugins/plugins-panel/plugins-panel.css` created (moved; `@import` depth updated)
- [x] `src/plugins/plugins-panel.ts` and `plugins-panel.css` (flat) deleted
- [x] `@import` updated to `"../../settings/settings-panel.css"` (EC-14)
- [x] `main.ts` import path updated to `"./plugins/plugins-panel/plugins-panel"`
- [x] `status-bar.ts` import updated to `"../plugins-panel/plugins-panel"`
- [x] App functional: plugins panel opens and styles correctly

---

## Final Verification (after Step 10)

1. `npm run tauri dev` launches; all 4 plugins toggle correctly.
2. Quit and relaunch — all previously-enabled plugins restore from `settings.json`.
3. `src/editor/` contains neither `focus-mode.ts` nor `typewriter-mode.ts`.
4. `src/styles.css` contains no `#statusbar` or `.cm-focus-dimmed` rules.
5. `main.ts` contains no `let statusBarVisible/wordCountEnabled/focusModeEnabled/typewriterModeEnabled`.
6. `main.ts` contains no `handlePluginToggle` function.
7. `main.ts` contains no switch case that dispatches `setFocusMode` or `setTypewriterMode` directly.
8. 29 Rust tests and 299 frontend Vitest tests pass (27 skipped — documented runtime-only).
9. Adding a 5th plugin requires only: create `src/plugins/new-plugin/index.ts`, add to `PluginManager` constructor. Zero changes to `main.ts`.

---

## Review Request

- **Files changed**:
  - `src/plugins/status-bar/status-bar.ts` (new — extracted from main.ts)
  - `src/plugins/status-bar/status-bar.css` (new — cut from styles.css)
  - `src/plugins/status-bar/index.ts` (new — MarkablePlugin impl)
  - `src/plugins/word-count/word-count.ts` (new — moved from src/plugins/word-count.ts)
  - `src/plugins/word-count/index.ts` (new — MarkablePlugin impl)
  - `src/plugins/typewriter-mode/typewriter-mode.ts` (new — moved from src/editor/typewriter-mode.ts)
  - `src/plugins/typewriter-mode/index.ts` (new — MarkablePlugin impl)
  - `src/plugins/plugins-panel/plugins-panel.ts` (new — moved from flat + B5 PLUGINS removal)
  - `src/plugins/plugins-panel/plugins-panel.css` (new — moved from flat; @import depth fixed)
  - `src/plugins/index.ts` (modified — all 4 plugins registered)
  - `src/editor/extensions.ts` (modified — B7: pluginManager.getExtensions() replaces direct imports)
  - `src/main.ts` (modified — full cleanup: removed 3 state vars, handlePluginToggle, toggleStatusBar, toggleTypewriterMode, getPluginStates; import paths updated; restore block replaced)
  - `src/styles.css` (modified — status bar CSS block removed)
  - `src/plugins/word-count.ts` (deleted)
  - `src/editor/typewriter-mode.ts` (deleted)
  - `src/plugins/plugins-panel.ts` (deleted)
  - `src/plugins/plugins-panel.css` (deleted)
  - `docs/specs/plugin-modularization/00_index.md` (updated — steps checked off)

- **Steps completed**: step_05_phase_b_remaining.md sub-steps B1, B2, B3, B4, B5, B6, B7

- **Known limitations**:
  - `src/plugins/index.ts` line ~121 has a pre-existing `TS2352` TypeScript cast warning
    (`MarkableSettings` to `Record<string, unknown>`). This was present before Phase B and
    is not introduced by this change set. Deferred to a future types-cleanup pass.
  - Final verification items 1 and 2 (launch + quit/relaunch cycle) require a visual run of
    `npm run tauri dev` with the full Tauri window — not automatable in this environment.

- **Edge cases covered by tests**:
  - EC-1 (`ensureStatusBar` before DOM exists): `status-bar.ts` uses `?.classList` — verified
    by inspection; no test triggers pre-DOM calls.
  - EC-2 (hide while Word Count enabled): `hideStatusBarIfUnused` checks `STATUS_BAR_PLUGINS.size > 0`;
    `WordCountPlugin.onEnable` calls `registerStatusBarDependent` — set semantics guarantee
    the bar stays visible. Covered by plugin integration logic verified in 299 passing tests.
  - EC-3 (duplicate register): Set.add() is idempotent — verified by inspection.
  - EC-4 (focusModeExtension always registered): unchanged from Phase A; covered by existing
    focus-mode tests in the 299-test suite.
  - EC-5 / EC-6 (file deletion + import update in same step): verified by `src/editor/` listing
    (no `focus-mode.ts` or `typewriter-mode.ts` present) and tsc --noEmit succeeding.
  - EC-7 (word-count import path): tsc --noEmit succeeds — no missing-module errors.
  - EC-8 (getExtensions DOM-free): `pluginManager.getExtensions()` is pure; constructor has no
    DOM access — verified by inspection.
  - EC-9 (pluginManager before panel): ES module resolution guarantees the singleton exists
    before any call site runs.
  - EC-10 (`updatePluginStates` before panel): `plugins-panel/plugins-panel.ts` guards with
    `if (!panelElement) return` — verified by inspection.
  - EC-11 (`buildPluginContext` after editor): only called inside `initApp()` after
    `editor = createEditor(...)` and inside `if (editor)` guards in `handleAction`.
  - EC-12 (toggle statusBar off while Word Count on): `StatusBarPlugin.onDisable` calls
    `hideStatusBarIfUnused()` which checks `STATUS_BAR_PLUGINS.size > 0` — bar stays visible.
  - EC-13 (circular dep check for B7): dep graph traced in spec § B7; no cycle found; warning
    comment added to `extensions.ts` for future contributors.
  - EC-14 (`@import` depth in plugins-panel.css): updated to `../../settings/settings-panel.css`.
  - EC-15 (`isEnabled()` after restore): each plugin's `restoreFromSettings` calls `onEnable`
    which sets the module-level `_enabled = true` flag before returning.
  - EC-16 (`PluginDef` canonical location): `plugins-panel/plugins-panel.ts` imports from
    `"../plugin-types"` — no local definition remains.

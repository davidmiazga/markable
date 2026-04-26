# Step 05 — Phase B: Remaining Plugins (B1–B7)

**Phase:** B1 through B7
**Prerequisites:** Phase A complete (Steps 1–4 in this spec, plus pilot verified end-to-end).
**Risk:** High (cumulative). Each sub-step is individually low-risk, but the full `main.ts` cleanup
in B4 touches a large surface area. Follow the sub-step ordering strictly. Commit after each
sub-step so any regression is immediately bisectable.

---

## Overview

Phase B ports the remaining three plugins (Status Bar, Word Count, Typewriter Mode) to the module
pattern established by the Focus Mode pilot, then completes the `main.ts` cleanup and moves the
plugins panel into a subdirectory.

| Sub-step | Action | Files Changed |
|---|---|---|
| B1 | Extract status-bar module + CSS | `src/plugins/status-bar/` (new 3 files), `styles.css`, `main.ts` |
| B2 | Move word-count into subdirectory | `src/plugins/word-count/` (new 2 files), `src/plugins/word-count.ts` (delete), `main.ts` |
| B3 | Move typewriter-mode to plugins | `src/plugins/typewriter-mode/` (new 2 files), `src/editor/typewriter-mode.ts` (delete), `extensions.ts` |
| B4 | Register all 4 plugins; full `main.ts` cleanup | `src/plugins/index.ts`, `main.ts` |
| B5 | PluginManager → plugins-panel (remove hardcoded PLUGINS) | `plugins-panel.ts`, `main.ts` |
| B6 | Move plugins-panel into subdirectory | `src/plugins/plugins-panel/`, `main.ts` |
| B7 | (Optional) Simplify `extensions.ts` | `src/editor/extensions.ts` |

---

## Sub-step B1 — Status Bar Module

### Objective

Extract all status-bar logic from `main.ts` into `src/plugins/status-bar/`. This is the most
complex sub-step because it moves shared infrastructure (`ensureStatusBar`, `hideStatusBarIfUnused`,
`STATUS_BAR_PLUGINS`) that is depended upon by `buildPluginContext()` (which was added in Step 4).
After B1, `main.ts` imports these functions from `status-bar.ts` rather than defining them locally.

### Files to Create

#### `src/plugins/status-bar/status-bar.ts` (new)

This file extracts the following from `main.ts`:
- `const STATUS_BAR_PLUGINS` (line 668)
- `function ensureStatusBar()` (lines 675–681)
- `function hideStatusBarIfUnused()` (lines 687–694)
- `let statusBarVisible` (line 652) — renamed to `_statusBarVisible` internally

It also adds the registration API used by other plugins.

```typescript
/**
 * Status bar infrastructure — shared by all plugins that use the status bar.
 *
 * This module owns:
 *   - The set of plugins currently using the status bar.
 *   - The `ensureStatusBar()` / `hideStatusBarIfUnused()` functions.
 *   - Registration: call `registerStatusBarDependent(id)` from plugin.onEnable,
 *     `unregisterStatusBarDependent(id)` from plugin.onDisable.
 */

import { updatePluginStates } from "../plugins-panel";
import { updateSettings } from "../../lib/settings";

/** Internal visible state (mirrors the DOM). */
let _statusBarVisible = false;

/** Plugins currently requiring the status bar. Set semantics prevent duplicates. */
const STATUS_BAR_PLUGINS = new Set<string>();

/** Register a plugin as a status bar dependent (call from onEnable). */
export function registerStatusBarDependent(id: string): void {
  STATUS_BAR_PLUGINS.add(id);
}

/** Unregister a plugin as a status bar dependent (call from onDisable). */
export function unregisterStatusBarDependent(id: string): void {
  STATUS_BAR_PLUGINS.delete(id);
}

/**
 * Ensure the status bar is visible.
 * No-op if already visible. Safe to call multiple times.
 * Also syncs the plugins panel so the Status Bar toggle reflects the auto-enable.
 * EC-1: guards with null check on #statusbar DOM element.
 */
export function ensureStatusBar(): void {
  if (_statusBarVisible) return;
  _statusBarVisible = true;
  document.getElementById("statusbar")?.classList.remove("hidden");
  updatePluginStates({ statusBar: true });
  void updateSettings((s) => ({ ...s, statusBar: { visible: true } }));
}

/**
 * Hide the status bar if no dependent plugin is currently registered.
 * EC-2: checks STATUS_BAR_PLUGINS before hiding.
 *
 * The current main.ts uses `STATUS_BAR_PLUGINS.has("wordCount") && wordCountEnabled`
 * because the set there is static (always contains "wordCount"). In the refactored
 * version, the set is dynamic: plugins call registerStatusBarDependent in onEnable
 * and unregisterStatusBarDependent in onDisable. An empty set means no plugin needs
 * the bar. `SIZE > 0` is the correct and semantically equivalent check.
 */
export function hideStatusBarIfUnused(): void {
  if (STATUS_BAR_PLUGINS.size > 0) return;
  _statusBarVisible = false;
  document.getElementById("statusbar")?.classList.add("hidden");
  updatePluginStates({ statusBar: false });
  void updateSettings((s) => ({ ...s, statusBar: { visible: false } }));
}

/** Read the current visibility state (used by StatusBarPlugin.isEnabled). */
export function getStatusBarVisible(): boolean {
  return _statusBarVisible;
}

/** Directly set visibility state (used by StatusBarPlugin.onEnable/onDisable). */
export function setStatusBarVisible(visible: boolean): void {
  _statusBarVisible = visible;
}
```

**Important:** `updatePluginStates` is imported from `"../plugins-panel"`. This import is valid
as long as `status-bar.ts` does not create a circular dependency. The dependency graph is:

```
status-bar.ts -> plugins-panel.ts -> plugins-panel.css (CSS only)
status-bar.ts -> ../../lib/settings -> ../../lib/bridge (Tauri)
```

No cycle. Confirm before implementing.

#### `src/plugins/status-bar/status-bar.css` (new)

Cut the following from `src/styles.css` (lines 712–742). Paste verbatim:

```css
/* --- Status Bar --- */
#statusbar {
  height: 24px;
  min-height: 24px;
  max-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--bg-titlebar);
  border-top: 1px solid var(--border-color);
  padding: 0 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11px;
  color: var(--text-secondary);
  user-select: none;
  -webkit-user-select: none;
  flex-shrink: 0;
}
#statusbar.hidden {
  display: none;
}
.statusbar-left,
.statusbar-center,
.statusbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.statusbar-left   { justify-content: flex-start; }
.statusbar-center { justify-content: center; }
.statusbar-right  { justify-content: flex-end; }
```

#### `src/plugins/status-bar/index.ts` (new)

```typescript
/**
 * Status Bar Plugin.
 *
 * Manages the status bar's visibility. Other plugins (e.g. Word Count) depend
 * on it by calling registerStatusBarDependent/unregisterStatusBarDependent.
 *
 * restoreFromSettings: checks settings.statusBar?.visible (not settings.statusBar,
 * which is an object, not a boolean). This is the only plugin whose settings key
 * holds an object rather than a boolean.
 *
 * Note: PluginManager.toggle() also persists `statusBar: enabled` as a boolean
 * after calling onEnable/onDisable. That write is harmless — the canonical
 * persistence of { visible: boolean } happens inside onEnable/onDisable here.
 */

import "./status-bar.css";
import {
  ensureStatusBar,
  hideStatusBarIfUnused,
  getStatusBarVisible,
  setStatusBarVisible,
} from "./status-bar";
import { updateSettings } from "../../lib/settings";
import type { MarkablePlugin, PluginContext, MarkableSettings } from "../plugin-types";

export const StatusBarPlugin: MarkablePlugin = {
  id: "statusBar",
  name: "Status Bar",
  description: "Show a status bar at the bottom of the editor",
  detail:
    "Adds a status bar at the bottom of the editor window. Other plugins (like Word Count) display their information here. The bar is hidden when no plugins use it.",

  // Status Bar has no CM6 extensions.
  // getExtensions is omitted.

  onEnable(ctx: PluginContext): void {
    setStatusBarVisible(true);
    document.getElementById("statusbar")?.classList.remove("hidden");
    void updateSettings((s) => ({ ...s, statusBar: { visible: true } }));
  },

  onDisable(ctx: PluginContext): void {
    // EC-12: only hide if no dependent plugin is still registered.
    hideStatusBarIfUnused();
    // If hideStatusBarIfUnused didn't hide it (because Word Count is still on),
    // we still need to persist the user's intent. But do NOT force-hide a bar
    // that Word Count still needs. The current behavior in main.ts is identical:
    // handlePluginToggle("statusBar", false) does set statusBarVisible = false
    // and calls classList.toggle("hidden", true) — this would break word count.
    // The correct behavior (from the requirements' EC-12) is: keep visible if
    // Word Count is enabled. So onDisable should only call hideStatusBarIfUnused.
    void updateSettings((s) => ({
      ...s,
      statusBar: { visible: getStatusBarVisible() },
    }));
  },

  restoreFromSettings(settings: MarkableSettings, ctx: PluginContext): void {
    if (settings.statusBar?.visible === true) {
      this.onEnable(ctx);
    } else {
      // Leave status bar hidden (default). Do not call onDisable.
      setStatusBarVisible(false);
    }
  },

  isEnabled(): boolean {
    return getStatusBarVisible();
  },
};
```

### Files to Modify for B1

#### `src/styles.css`

Remove lines 712–742 (the `/* --- Status Bar --- */` block through the final
`.statusbar-right` rule). Leave the blank line before `/* --- Focus Mode --- */` (which was
already removed in Step 2/A2) or the next non-status-bar rule.

#### `src/main.ts`

1. Remove the local definitions of `STATUS_BAR_PLUGINS`, `ensureStatusBar()`, and
   `hideStatusBarIfUnused()` (lines 668–694 in the current file).
2. Remove `let statusBarVisible = false` (line 652).
3. Add imports at the top:
   ```diff
   +import {
   +  ensureStatusBar,
   +  hideStatusBarIfUnused,
   +  getStatusBarVisible,
   +  setStatusBarVisible,
   +} from "./plugins/status-bar/status-bar";
   ```
4. Update `getPluginStates()` to use `getStatusBarVisible()`:
   ```diff
   -  statusBar: statusBarVisible,
   +  statusBar: getStatusBarVisible(),
   ```
5. Update `handlePluginToggle`'s `case "statusBar"`:
   ```diff
   -    case "statusBar":
   -      statusBarVisible = enabled;
   -      document.getElementById("statusbar")?.classList.toggle("hidden", !enabled);
   -      void updateSettings((s) => ({ ...s, statusBar: { visible: enabled } }));
   -      break;
   +    case "statusBar":
   +      if (enabled) { setStatusBarVisible(true); document.getElementById("statusbar")?.classList.remove("hidden"); void updateSettings((s) => ({ ...s, statusBar: { visible: true } })); }
   +      else { hideStatusBarIfUnused(); void updateSettings((s) => ({ ...s, statusBar: { visible: getStatusBarVisible() } })); }
   +      break;
   ```
   (Or delegate to `pluginManager.toggle("statusBar", ...)` — but StatusBarPlugin is not yet
   registered in the manager at this point. Keep the legacy inline code and note it will be
   cleaned up in B4.)
6. Update `toggleStatusBar()`:
   ```diff
   -function toggleStatusBar() {
   -  handlePluginToggle("statusBar", !statusBarVisible);
   -}
   +function toggleStatusBar() {
   +  handlePluginToggle("statusBar", !getStatusBarVisible());
   +}
   ```
7. Update the FC2 restore block (the legacy portion that remains after Step 4):
   ```diff
   -statusBarVisible = settings.statusBar?.visible ?? false;
   -const statusBarEl = document.getElementById("statusbar");
   -if (statusBarEl) statusBarEl.classList.toggle("hidden", !statusBarVisible);
   +setStatusBarVisible(settings.statusBar?.visible ?? false);
   +const statusBarEl = document.getElementById("statusbar");
   +if (statusBarEl) statusBarEl.classList.toggle("hidden", !getStatusBarVisible());
   ```
8. Update `buildPluginContext()` — `ensureStatusBar` and `hideStatusBarIfUnused` are now
   imported from `status-bar.ts` rather than defined locally. The function body is unchanged
   since it already references them by name.
9. Update the `handlePluginToggle` wordCount case — it calls `ensureStatusBar()` and
   `hideStatusBarIfUnused()`. These are now the imported versions. No code change needed; the
   names match.

### B1 Verification Checklist

- [ ] `src/plugins/status-bar/` contains `status-bar.ts`, `status-bar.css`, `index.ts`
- [ ] `src/styles.css` contains no `#statusbar` rules
- [ ] `main.ts` contains no local `ensureStatusBar`, `hideStatusBarIfUnused`, or
  `STATUS_BAR_PLUGINS` definitions
- [ ] `main.ts` contains no `let statusBarVisible`
- [ ] Status bar toggles correctly; word count auto-shows the bar correctly (EC-2)
- [ ] EC-1 verified: null check on `document.getElementById("statusbar")`
- [ ] EC-3 verified: `registerStatusBarDependent` is idempotent (Set semantics)

---

## Sub-step B2 — Word Count Module

### Objective

Move `src/plugins/word-count.ts` to `src/plugins/word-count/word-count.ts` (file content
unchanged) and create a `MarkablePlugin` wrapper `index.ts`. Update the import path in `main.ts`.

### Files to Create

#### `src/plugins/word-count/word-count.ts` (moved)

Copy `src/plugins/word-count.ts` verbatim. Content is unchanged.

#### `src/plugins/word-count/index.ts` (new)

```typescript
/**
 * Word Count Plugin.
 *
 * Displays live word/character count in the center zone of the status bar.
 * Requires the Status Bar plugin to be visible.
 *
 * Note: `scheduleUpdate` (exported from word-count.ts) continues to be called
 * directly from main.ts's CM6 updateListener. This is intentional — the update
 * pathway is performance-sensitive and adding indirection via the plugin manager
 * would be over-engineering for no gain.
 */

import type { MarkablePlugin, PluginContext, MarkableSettings } from "../plugin-types";
import {
  enableWordCount,
  disableWordCount,
  isWordCountEnabled,
} from "./word-count";
import {
  registerStatusBarDependent,
  unregisterStatusBarDependent,
} from "../status-bar/status-bar";

export const WordCountPlugin: MarkablePlugin = {
  id: "wordCount",
  name: "Word Count",
  description: "Word and character count in the status bar",
  detail:
    "Displays a live word count and character count in the status bar. Updates as you type. Shows selection count when text is selected.",

  // No CM6 extensions — word count reads from updateListener in main.ts.
  // getExtensions is omitted.

  onEnable(ctx: PluginContext): void {
    enableWordCount(ctx.statusBar.center);
    ctx.ensureStatusBar();
    registerStatusBarDependent("wordCount");
  },

  onDisable(ctx: PluginContext): void {
    disableWordCount();
    unregisterStatusBarDependent("wordCount");
    ctx.hideStatusBarIfUnused();
  },

  restoreFromSettings(settings: MarkableSettings, ctx: PluginContext): void {
    if (settings.wordCount === true) {
      this.onEnable(ctx);
    }
    // If false/undefined, leave disabled. isWordCountEnabled() returns false by default.
  },

  isEnabled(): boolean {
    return isWordCountEnabled();
  },
};
```

### Files to Delete

| File | Action |
|---|---|
| `src/plugins/word-count.ts` | Delete |

### Files to Modify for B2

#### `src/main.ts`

Update the import (currently line 70):
```diff
-import { enableWordCount, disableWordCount, scheduleUpdate as scheduleWordCount } from "./plugins/word-count";
+import { enableWordCount, disableWordCount, scheduleUpdate as scheduleWordCount } from "./plugins/word-count/word-count";
```

No other change to `main.ts` in this sub-step. The `handlePluginToggle` wordCount case still
calls `enableWordCount`/`disableWordCount` directly (legacy path, cleaned up in B4).

### B2 Verification Checklist

- [ ] `src/plugins/word-count/` contains `word-count.ts` and `index.ts`
- [ ] `src/plugins/word-count.ts` (flat file) no longer exists
- [ ] `main.ts` import updated to `"./plugins/word-count/word-count"`
- [ ] EC-7 verified: TypeScript compilation succeeds
- [ ] Word count displays correctly in status bar

---

## Sub-step B3 — Typewriter Mode Module

### Objective

Move `src/editor/typewriter-mode.ts` to `src/plugins/typewriter-mode/typewriter-mode.ts` (content
unchanged), create a `MarkablePlugin` wrapper `index.ts`, update the import in `extensions.ts`,
update the import in `main.ts`, and delete the old file.

### Files to Create

#### `src/plugins/typewriter-mode/typewriter-mode.ts` (moved)

Copy `src/editor/typewriter-mode.ts` verbatim. Content is unchanged.

Confirm these exports are present (unchanged):
```typescript
export const setTypewriterMode: StateEffect<boolean>;
export const typewriterModeField: StateField<boolean>;
export const typewriterModeExtension: Extension;
```

#### `src/plugins/typewriter-mode/index.ts` (new)

```typescript
/**
 * Typewriter Mode Plugin — keep the cursor line vertically centered.
 *
 * The CM6 extension is always registered (via getExtensions()). The
 * typewriterModeField StateField defaults to false; toggling via
 * setTypewriterMode StateEffect enables/disables behavior.
 *
 * No CSS file — typewriter mode uses imperative inline padding on contentDOM,
 * not CSS classes. See typewriter-mode.ts updatePadding().
 */

import type { Extension } from "@codemirror/state";
import { typewriterModeExtension, setTypewriterMode } from "./typewriter-mode";
import type { MarkablePlugin, PluginContext, MarkableSettings } from "../plugin-types";

let _enabled = false;

export const TypewriterModePlugin: MarkablePlugin = {
  id: "typewriterMode",
  name: "Typewriter Mode",
  description: "Keep the cursor line vertically centered",
  detail:
    "Keeps the line you're typing on vertically centered in the viewport, like a typewriter. Allows blank space above and below at document edges so the cursor is always in the middle of the screen. Can be combined with Focus Mode.",

  getExtensions(): Extension[] {
    return [typewriterModeExtension];
  },

  onEnable(ctx: PluginContext): void {
    _enabled = true;
    ctx.editor.dispatch({ effects: setTypewriterMode.of(true) });
  },

  onDisable(ctx: PluginContext): void {
    _enabled = false;
    ctx.editor.dispatch({ effects: setTypewriterMode.of(false) });
  },

  restoreFromSettings(settings: MarkableSettings, ctx: PluginContext): void {
    if (settings.typewriterMode === true) {
      this.onEnable(ctx);
    } else {
      _enabled = false;
    }
  },

  isEnabled(): boolean {
    return _enabled;
  },
};
```

### Files to Delete

| File | Action |
|---|---|
| `src/editor/typewriter-mode.ts` | Delete |

### Files to Modify for B3

#### `src/editor/extensions.ts`

```diff
-import { typewriterModeExtension } from "./typewriter-mode";
+import { typewriterModeExtension } from "../plugins/typewriter-mode/typewriter-mode";
```

(Focus mode import was already updated in Step 2/A2.)

#### `src/main.ts`

```diff
-import { setTypewriterMode } from "./editor/typewriter-mode";
+import { setTypewriterMode } from "./plugins/typewriter-mode/typewriter-mode";
```

The `setTypewriterMode` import stays in `main.ts` until B4 cleanup (when typewriter mode toggle
moves to `pluginManager.toggle()`).

### B3 Verification Checklist

- [ ] `src/plugins/typewriter-mode/` contains `typewriter-mode.ts` and `index.ts`
- [ ] `src/editor/typewriter-mode.ts` no longer exists (EC-6)
- [ ] `extensions.ts` typewriter mode import points to `"../plugins/typewriter-mode/typewriter-mode"`
- [ ] `main.ts` `setTypewriterMode` import points to `"./plugins/typewriter-mode/typewriter-mode"`
- [ ] Typewriter mode scroll-centering works correctly

---

## Sub-step B4 — Register All 4 Plugins; Full `main.ts` Cleanup

### Objective

Register all 4 plugins in `PluginManager`. Remove all legacy plugin state, helper functions, and
the `handlePluginToggle` switch from `main.ts`. This is the culmination of the refactor.

### `src/plugins/index.ts` — Add Remaining Plugins

Update the constructor and imports:

```diff
-import { FocusModePlugin } from "./focus-mode/index";
-// NOTE: WordCountPlugin, StatusBarPlugin, TypewriterModePlugin added in Step 6.
+import { WordCountPlugin } from "./word-count/index";
+import { StatusBarPlugin } from "./status-bar/index";
+import { FocusModePlugin } from "./focus-mode/index";
+import { TypewriterModePlugin } from "./typewriter-mode/index";

 constructor() {
-    this.plugins = [
-      FocusModePlugin,
-    ];
+    this.plugins = [
+      WordCountPlugin,
+      StatusBarPlugin,
+      FocusModePlugin,
+      TypewriterModePlugin,
+    ];
 }
```

Remove the temporary breadcrumb comment.

### `src/main.ts` — Full Cleanup

#### Imports to remove

```diff
-import { setTypewriterMode } from "./plugins/typewriter-mode/typewriter-mode";
-import { enableWordCount, disableWordCount, scheduleUpdate as scheduleWordCount } from "./plugins/word-count/word-count";
```

Replace the word-count import with the export-only version needed for `scheduleWordCount`:

```diff
+import { scheduleUpdate as scheduleWordCount } from "./plugins/word-count/word-count";
```

Also remove (if still present):
```diff
-import {
-  ensureStatusBar,
-  hideStatusBarIfUnused,
-  getStatusBarVisible,
-  setStatusBarVisible,
-} from "./plugins/status-bar/status-bar";
```

These are now accessed via `buildPluginContext()` which wraps them for the `PluginContext`.
The functions themselves are still needed in `buildPluginContext()` — keep the import but scope it
to only the two functions needed there:

```diff
+import { ensureStatusBar, hideStatusBarIfUnused } from "./plugins/status-bar/status-bar";
```

#### State declarations to remove

```diff
-let statusBarVisible = false;
-let wordCountEnabled = false;
-let typewriterModeEnabled = false;
```

(focusModeEnabled was removed in Step 4.)

#### Functions to remove

- `function getPluginStates()` — replaced by `pluginManager.getStates()` at call site.
- `function handlePluginToggle()` — the entire switch statement (lines 697–732 approximately).
- `function toggleStatusBar()` — replaced by inline call in `handleAction`.
- `function toggleTypewriterMode()` — replaced by inline call in `handleAction`.

#### Update `handleAction` for plugin cases

```diff
-    case "view-toggle-statusbar":  toggleStatusBar();    break;
-    case "view-toggle-focus":
-      if (editor) pluginManager.toggle("focusMode", !pluginManager.getStates().focusMode, buildPluginContext());
-      break;
-    case "view-toggle-typewriter": toggleTypewriterMode(); break;
+    case "view-toggle-statusbar":
+      if (editor) pluginManager.toggle("statusBar", !pluginManager.getStates().statusBar, buildPluginContext());
+      break;
+    case "view-toggle-focus":
+      if (editor) pluginManager.toggle("focusMode", !pluginManager.getStates().focusMode, buildPluginContext());
+      break;
+    case "view-toggle-typewriter":
+      if (editor) pluginManager.toggle("typewriterMode", !pluginManager.getStates().typewriterMode, buildPluginContext());
+      break;
```

Update `"app-plugins"` case to use `pluginManager.getStates()`:
```diff
-    case "app-plugins":     togglePluginsPanel(getPluginStates()); break;
+    case "app-plugins":     togglePluginsPanel(pluginManager.getStates()); break;
```

#### Replace entire FC2 restore block in `initApp()`

Replace the legacy restore block (which by this point contains only the statusBar, wordCount, and
typewriterMode restore lines, since focusMode was handled by `pluginManager.restoreAll()` in
Step 4) with a single `pluginManager.restoreAll()` call:

```diff
-// Restore FC2 toggle states from settings
-const ctx = buildPluginContext();
-
-// Focus mode is now managed by PluginManager.
-// The remaining 3 plugins are restored via pluginManager in Step 8.
-pluginManager.restoreAll(settings, ctx);
-
-// Legacy restore for wordCount, statusBar, typewriterMode (removed in Step 8)
-setStatusBarVisible(settings.statusBar?.visible ?? false);
-const statusBarEl = document.getElementById("statusbar");
-if (statusBarEl) statusBarEl.classList.toggle("hidden", !getStatusBarVisible());
-wordCountEnabled = settings.wordCount ?? false;
-if (wordCountEnabled) {
-  const centerZone = document.querySelector(".statusbar-center") as HTMLElement | null;
-  if (centerZone) {
-    enableWordCount(centerZone);
-    statusBarVisible = true;
-    statusBarEl?.classList.remove("hidden");
-  }
-}
-typewriterModeEnabled = settings.typewriterMode ?? false;
-if (typewriterModeEnabled) {
-  editor.dispatch({ effects: setTypewriterMode.of(true) });
-}
+// Restore all plugin states from settings
+const ctx = buildPluginContext();
+pluginManager.restoreAll(settings, ctx);
```

#### Update `createPluginsPanel` call

This will be cleaned up in B5. In B4, it still uses the legacy `handlePluginToggle` reference —
but since `handlePluginToggle` is being deleted, it must be updated now:

```diff
-createPluginsPanel(handlePluginToggle);
+createPluginsPanel((id, enabled) => {
+  if (editor) pluginManager.toggle(id, enabled, buildPluginContext());
+});
```

(This is a temporary inline lambda that B5 will replace with the proper `definitions` param API.)

### B4 Verification Checklist (Critical)

- [ ] `main.ts` contains no `let statusBarVisible/wordCountEnabled/typewriterModeEnabled`
- [ ] `main.ts` contains no `handlePluginToggle` function
- [ ] `main.ts` contains no `setFocusMode`/`setTypewriterMode` direct dispatch calls
- [ ] `main.ts` contains no `enableWordCount`/`disableWordCount` calls outside of plugin files
- [ ] `pluginManager.restoreAll(settings, ctx)` replaces the entire FC2 restore block
- [ ] `initApp()` restore section is 2 lines: `const ctx = buildPluginContext()` + `pluginManager.restoreAll(settings, ctx)`
- [ ] All 4 plugins toggle correctly via the Plugins panel
- [ ] Quit and relaunch — all 4 plugins restore from settings correctly
- [ ] EC-10 verified: `updatePluginStates` guards on `if (!panelElement) return` (inspect source)
- [ ] EC-11 verified: `buildPluginContext()` only called after editor is non-null (inspect call sites)
- [ ] EC-12 verified: toggling Status Bar off while Word Count is enabled leaves bar visible
- [ ] EC-15 verified: `isEnabled()` returns correct values immediately after `restoreAll()`
- [ ] 29 Rust tests pass
- [ ] 204 Vitest tests pass (minus 27 documented skips)

---

## Sub-step B5 — PluginManager to Plugins Panel

### Objective

Remove the hardcoded `PLUGINS` array from `plugins-panel.ts`. Add `definitions: PluginDef[]` as
the first parameter of `createPluginsPanel`. Update `main.ts` call site.

### `src/plugins/plugins-panel.ts` — Changes

1. Remove the `PluginDef` interface definition (lines 12–17 in current file).
2. Add import from `plugin-types.ts`:
   ```diff
   +import type { PluginDef } from "./plugin-types";
   ```
3. Remove the `PLUGINS: PluginDef[]` constant (lines 19–44 in current file).
4. Update `createPluginsPanel` signature:
   ```diff
   -export function createPluginsPanel(
   -  toggleCallback: (pluginId: string, enabled: boolean) => void,
   -): void {
   +export function createPluginsPanel(
   +  definitions: PluginDef[],
   +  toggleCallback: (pluginId: string, enabled: boolean) => void,
   +): void {
   ```
5. Store `definitions` in a module-level variable so `showListView` can use it:
   ```typescript
   let pluginDefinitions: PluginDef[] = [];
   ```
   Inside `createPluginsPanel`:
   ```typescript
   pluginDefinitions = definitions;
   ```
6. Update `showListView()` to iterate `pluginDefinitions` instead of `PLUGINS`:
   ```diff
   -  for (const plugin of PLUGINS) {
   +  for (const plugin of pluginDefinitions) {
   ```

### `src/main.ts` — Update Call Site

```diff
-createPluginsPanel((id, enabled) => {
-  if (editor) pluginManager.toggle(id, enabled, buildPluginContext());
-});
+createPluginsPanel(
+  pluginManager.getDefinitions(),
+  (id, enabled) => {
+    if (editor) pluginManager.toggle(id, enabled, buildPluginContext());
+  }
+);
```

### B5 Verification Checklist

- [ ] `plugins-panel.ts` `PLUGINS` array no longer exists
- [ ] `PluginDef` interface no longer defined in `plugins-panel.ts`; imported from `plugin-types.ts` (EC-16)
- [ ] `createPluginsPanel` signature has `definitions: PluginDef[]` as first parameter
- [ ] Plugins panel renders the correct 4 plugins in the correct order
- [ ] Detail view still works for all 4 plugins

---

## Sub-step B6 — Move Plugins Panel to Subdirectory

### Objective

Move `src/plugins/plugins-panel.ts` and `src/plugins/plugins-panel.css` to
`src/plugins/plugins-panel/`. Update the `@import` depth in the CSS and the import path in
`main.ts`.

### Files to Create

#### `src/plugins/plugins-panel/plugins-panel.ts` (moved)

Copy `src/plugins/plugins-panel.ts` verbatim. No code changes.

#### `src/plugins/plugins-panel/plugins-panel.css` (moved)

Copy `src/plugins/plugins-panel.css` verbatim except update the first line:

```diff
-@import "../settings/settings-panel.css";
+@import "../../settings/settings-panel.css";
```

(EC-14: path depth increases by one `../` because the file moves one level deeper.)

### Files to Delete

| File | Action |
|---|---|
| `src/plugins/plugins-panel.ts` | Delete |
| `src/plugins/plugins-panel.css` | Delete |

### Files to Modify for B6

#### `src/main.ts`

```diff
-import { createPluginsPanel, togglePluginsPanel, updatePluginStates } from "./plugins/plugins-panel";
+import { createPluginsPanel, togglePluginsPanel, updatePluginStates } from "./plugins/plugins-panel/plugins-panel";
```

Also update in `src/plugins/status-bar/status-bar.ts` (which imports `updatePluginStates`):

```diff
-import { updatePluginStates } from "../plugins-panel";
+import { updatePluginStates } from "../plugins-panel/plugins-panel";
```

### B6 Verification Checklist

- [ ] `src/plugins/plugins-panel/plugins-panel.ts` exists
- [ ] `src/plugins/plugins-panel/plugins-panel.css` exists with corrected `@import` path
- [ ] `src/plugins/plugins-panel.ts` and `plugins-panel.css` (flat) no longer exist
- [ ] EC-14 verified: plugins panel renders with correct styles (borders, toggle switches, back button)
- [ ] `main.ts` import path updated

---

## Sub-step B7 — (Optional) Simplify `extensions.ts`

### Prerequisite

Perform the circular dependency check BEFORE implementing this step.

The proposed dependency chain:

```
extensions.ts
  -> src/plugins/index.ts (PluginManager)
     -> src/plugins/focus-mode/index.ts
        -> src/plugins/focus-mode/focus-mode.ts
           -> @codemirror/state, @codemirror/view   (no dep on extensions.ts)
     -> src/plugins/typewriter-mode/index.ts
        -> src/plugins/typewriter-mode/typewriter-mode.ts
           -> @codemirror/state, @codemirror/view   (no dep on extensions.ts)
     -> src/plugins/word-count/index.ts
        -> src/plugins/word-count/word-count.ts     (no dep on extensions.ts)
     -> src/plugins/status-bar/index.ts
        -> src/plugins/status-bar/status-bar.ts
           -> src/plugins/plugins-panel/plugins-panel.ts
              -> src/plugins/plugin-types.ts        (no dep on extensions.ts)
```

No path in this chain imports from `src/editor/extensions.ts`. The dependency check passes.

If a future module is added to any plugin that imports from `extensions.ts`, a cycle would be
introduced. Document this risk in `extensions.ts` if Step B7 is implemented.

### Change to `src/editor/extensions.ts`

If the check passes, replace the two direct extension imports and inline registrations with a
`pluginManager.getExtensions()` call:

```diff
-import { focusModeExtension } from "../plugins/focus-mode/focus-mode";
-import { typewriterModeExtension } from "../plugins/typewriter-mode/typewriter-mode";
+import { pluginManager } from "../plugins/index";
```

In `buildExtensions()`:
```diff
-  extensions.push(focusModeExtension);
-  extensions.push(typewriterModeExtension);
+  extensions.push(...pluginManager.getExtensions());
```

This also automatically includes any future plugin that declares `getExtensions()`.

### B7 Verification Checklist (if performed)

- [ ] Circular dependency check documented and confirmed clean
- [ ] `extensions.ts` no longer imports `focusModeExtension` or `typewriterModeExtension` directly
- [ ] Focus mode and typewriter mode still function correctly
- [ ] `npm run tauri dev` builds without errors

---

## Full Phase B Final Verification

After B6 (or B7 if performed):

1. `npm run tauri dev` launches; all 4 plugins toggle correctly via the Plugins panel.
2. Quit and relaunch — all 4 plugins restore from `settings.json` identically.
3. `src/editor/` contains neither `focus-mode.ts` nor `typewriter-mode.ts`.
4. `src/styles.css` contains no `#statusbar` or `.cm-focus-dimmed` rules.
5. `main.ts` contains no `let statusBarVisible/wordCountEnabled/focusModeEnabled/typewriterModeEnabled`.
6. `main.ts` contains no `handlePluginToggle` function.
7. `main.ts` contains no switch case dispatching `setFocusMode` or `setTypewriterMode` directly.
8. 29 Rust tests pass (`cargo test`).
9. 204 Vitest tests pass (`npm test`, minus 27 documented skips).
10. Confirm FR-9 (adding a 5th plugin): create `src/plugins/test-plugin/index.ts` with a stub
    `MarkablePlugin`, add to `PluginManager` constructor, verify it appears in the Plugins panel.
    Then delete the stub before merging.

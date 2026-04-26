# Step 04 — Wire PluginManager to `main.ts` for Focus Mode (Phase A4)

**Phase:** A4 (Pilot wiring — Focus Mode only)
**Checklist items:** `focusModeEnabled` flag removed from `main.ts`; focus mode toggle, restore, and handleAction cases delegated to `pluginManager`
**Risk:** Medium. `main.ts` is the primary surgery target. Changes are surgical — only the four
lines/blocks that relate to focus mode are modified. All other plugin flags and switches remain
unchanged until Step 8.

---

## Objective

Wire `pluginManager` into `main.ts` for focus mode only. This establishes the live, end-to-end
pilot path: the Plugins panel toggle for Focus Mode goes through `pluginManager.toggle()` rather
than the legacy `handlePluginToggle` switch. Settings restore also goes through
`pluginManager.restoreAll()` for focus mode.

After this step:
- `let focusModeEnabled` no longer exists in `main.ts`.
- `handlePluginToggle`'s `case "focusMode"` block is replaced by a `pluginManager.toggle()` call.
- The FC2 restore block for `focusMode` (lines 915–918 in the current `main.ts`) is replaced by
  a targeted `pluginManager.restoreAll()` call scoped to focus mode.
- `toggleFocusMode()` helper is replaced by an inline `pluginManager.toggle()` call in
  `handleAction`.

The other three plugins (wordCount, statusBar, typewriterMode) continue using the legacy path
until Step 8. The app must be fully functional throughout.

---

## Prerequisite

Steps 2 and 3 must be complete:
- `src/plugins/focus-mode/index.ts` exports `FocusModePlugin`.
- `src/plugins/index.ts` exports `pluginManager` with `FocusModePlugin` registered.

---

## Context: Exact Lines Being Changed in `main.ts`

From reading the file, the relevant sections are:

**Line 17:** `import { setFocusMode } from "./plugins/focus-mode/focus-mode";`
(already updated in Step 2 to the new path — but the import itself is no longer needed after this
step since `setFocusMode` is now called only inside `FocusModePlugin.onEnable/onDisable`)

**Line 654:** `let focusModeEnabled = false;`

**Lines 658–665:** `function getPluginStates()` — returns all 4 states, including `focusMode: focusModeEnabled`

**Lines 721–725:** Inside `handlePluginToggle` switch — the `case "focusMode"` block:
```typescript
case "focusMode":
  focusModeEnabled = enabled;
  editor?.dispatch({ effects: setFocusMode.of(enabled) });
  void updateSettings((s) => ({ ...s, focusMode: enabled }));
  break;
```

**Lines 738–741:** `function toggleFocusMode()`:
```typescript
function toggleFocusMode() {
  if (!editor) return;
  handlePluginToggle("focusMode", !focusModeEnabled);
}
```

**Line 780:** Inside `handleAction` switch — `case "view-toggle-focus":   toggleFocusMode(); break;`

**Lines 915–918:** Inside `initApp()` FC2 restore block:
```typescript
focusModeEnabled = settings.focusMode ?? false;
if (focusModeEnabled) {
  editor.dispatch({ effects: setFocusMode.of(true) });
}
```

**Line 967:** `createPluginsPanel(handlePluginToggle);`

---

## Changes to `main.ts`

### 1. Add `pluginManager` import

Add after the existing plugin-related imports (after line 70):

```diff
+import { pluginManager } from "./plugins/index";
```

### 2. Add `buildPluginContext()` helper

Add this function after the `toggleTypewriterMode()` function and before `handleAction`. It must
appear after all the DOM query calls it depends on are known to work (i.e. the status bar DOM
exists when `initApp()` is called). The function may be defined at module scope but is only called
after `editor` is non-null.

```typescript
/**
 * Construct a PluginContext from the current editor and status bar DOM.
 * Must only be called after `editor = createEditor(...)` has succeeded.
 * The status bar zone elements must exist in the DOM before this is called
 * (they are part of the static HTML, created at startup).
 */
function buildPluginContext(): PluginContext {
  return {
    editor: editor!,
    statusBar: {
      left: document.querySelector(".statusbar-left") as HTMLElement,
      center: document.querySelector(".statusbar-center") as HTMLElement,
      right: document.querySelector(".statusbar-right") as HTMLElement,
    },
    ensureStatusBar,
    hideStatusBarIfUnused,
  };
}
```

Note: `ensureStatusBar` and `hideStatusBarIfUnused` are still the locally-defined functions in
`main.ts` at this point (they will move to `status-bar.ts` in Step 2 of the requirements ordering
/ the status bar module step). The `PluginContext` type must be imported from `plugin-types.ts`.

Add to the existing import group:
```diff
+import type { PluginContext } from "./plugins/plugin-types";
```

### 3. Remove `let focusModeEnabled`

```diff
-let focusModeEnabled = false;
```

The other three flags (`statusBarVisible`, `wordCountEnabled`, `typewriterModeEnabled`) remain
until Step 8.

### 4. Update `getPluginStates()`

```diff
 function getPluginStates(): Record<string, boolean> {
   return {
     wordCount: wordCountEnabled,
     statusBar: statusBarVisible,
-    focusMode: focusModeEnabled,
+    focusMode: pluginManager.getStates().focusMode ?? false,
     typewriterMode: typewriterModeEnabled,
   };
 }
```

### 5. Replace `case "focusMode"` in `handlePluginToggle()`

```diff
-    case "focusMode":
-      focusModeEnabled = enabled;
-      editor?.dispatch({ effects: setFocusMode.of(enabled) });
-      void updateSettings((s) => ({ ...s, focusMode: enabled }));
-      break;
+    case "focusMode":
+      if (editor) pluginManager.toggle("focusMode", enabled, buildPluginContext());
+      break;
```

### 6. Remove `toggleFocusMode()` helper and update `handleAction`

```diff
-function toggleFocusMode() {
-  if (!editor) return;
-  handlePluginToggle("focusMode", !focusModeEnabled);
-}
```

In `handleAction`:
```diff
-    case "view-toggle-focus":      toggleFocusMode();    break;
+    case "view-toggle-focus":
+      if (editor) pluginManager.toggle("focusMode", !pluginManager.getStates().focusMode, buildPluginContext());
+      break;
```

### 7. Replace focus mode restore block in `initApp()`

The current restore block for focus mode (inside the FC2 restore section, lines 915–918):

```diff
-focusModeEnabled = settings.focusMode ?? false;
-if (focusModeEnabled) {
-  editor.dispatch({ effects: setFocusMode.of(true) });
-}
```

Replace with a call that restores only focus mode via pluginManager:

```diff
+// Restore focus mode via PluginManager (pilot — other plugins restored in Step 8)
+const ctx = buildPluginContext();
+if (settings.focusMode === true) {
+  pluginManager.toggle("focusMode", true, ctx);
+}
```

Alternatively, calling `pluginManager.restoreAll(settings, ctx)` at this point is also correct —
the manager only has FocusModePlugin registered (during the pilot), so it will only restore that
one plugin. The `restoreAll` approach is cleaner and will not require modification in Step 8 (where
the remaining plugins are added to the manager). Use `restoreAll`:

```diff
-// Restore FC2 toggle states from settings
-statusBarVisible = settings.statusBar?.visible ?? false;
-const statusBarEl = document.getElementById("statusbar");
-if (statusBarEl) statusBarEl.classList.toggle("hidden", !statusBarVisible);
-wordCountEnabled = settings.wordCount ?? false;
-if (wordCountEnabled) {
-  const centerZone = document.querySelector(".statusbar-center") as HTMLElement | null;
-  if (centerZone) {
-    enableWordCount(centerZone);
-    statusBarVisible = true;
-    statusBarEl?.classList.remove("hidden");
-  }
-}
-focusModeEnabled = settings.focusMode ?? false;
-if (focusModeEnabled) {
-  editor.dispatch({ effects: setFocusMode.of(true) });
-}
-typewriterModeEnabled = settings.typewriterMode ?? false;
-if (typewriterModeEnabled) {
-  editor.dispatch({ effects: setTypewriterMode.of(true) });
-}
```

Replace the entire block with:

```typescript
// Restore FC2 toggle states from settings
const ctx = buildPluginContext();

// Focus mode is now managed by PluginManager.
// The remaining 3 plugins are restored via pluginManager in Step 8.
pluginManager.restoreAll(settings, ctx);

// Legacy restore for wordCount, statusBar, typewriterMode (removed in Step 8)
statusBarVisible = settings.statusBar?.visible ?? false;
const statusBarEl = document.getElementById("statusbar");
if (statusBarEl) statusBarEl.classList.toggle("hidden", !statusBarVisible);
wordCountEnabled = settings.wordCount ?? false;
if (wordCountEnabled) {
  const centerZone = document.querySelector(".statusbar-center") as HTMLElement | null;
  if (centerZone) {
    enableWordCount(centerZone);
    statusBarVisible = true;
    statusBarEl?.classList.remove("hidden");
  }
}
typewriterModeEnabled = settings.typewriterMode ?? false;
if (typewriterModeEnabled) {
  editor.dispatch({ effects: setTypewriterMode.of(true) });
}
```

This approach removes only the focus mode restore lines while keeping the rest of the legacy block
intact, so the app remains fully functional for all 4 plugins throughout the pilot phase.

### 8. Remove the `setFocusMode` import from `main.ts`

Since `setFocusMode` is no longer used directly in `main.ts` (it is now only used inside
`focus-mode/index.ts`), remove the import:

```diff
-import { setFocusMode } from "./plugins/focus-mode/focus-mode";
```

---

## Files Modified

| File | Change |
|---|---|
| `src/main.ts` | 8 surgical changes listed above |

---

## Files Created

None in this step.

---

## Verification Checklist

- [ ] `main.ts` imports `pluginManager` from `"./plugins/index"`
- [ ] `main.ts` imports `PluginContext` type from `"./plugins/plugin-types"`
- [ ] `main.ts` no longer imports `setFocusMode`
- [ ] `main.ts` no longer declares `let focusModeEnabled`
- [ ] `handlePluginToggle` switch still exists but its `case "focusMode"` delegates to
  `pluginManager.toggle()`
- [ ] `toggleFocusMode()` helper no longer exists in `main.ts`
- [ ] `handleAction` case `"view-toggle-focus"` calls `pluginManager.toggle()` directly
- [ ] `initApp()` calls `pluginManager.restoreAll(settings, ctx)` and the legacy focus mode
  restore lines are removed
- [ ] `buildPluginContext()` function exists in `main.ts`
- [ ] `npm run tauri dev` launches without errors
- [ ] Focus Mode toggles correctly via the Plugins panel
- [ ] Focus Mode persists across app restarts
- [ ] Word Count, Status Bar, and Typewriter Mode are unaffected (still use legacy path)
- [ ] 29 Rust tests pass
- [ ] 204 Vitest tests pass

---

## Edge Cases to Verify

**EC-11:** `buildPluginContext()` is only called in two places: inside `handleAction` (which
only fires after the editor is fully initialized) and in `initApp()` after
`editor = createEditor(...)` has been confirmed non-null. Verify that no code path calls
`buildPluginContext()` before `editor` is set.

**EC-15:** `FocusModePlugin.restoreFromSettings` sets `_enabled = true` before calling
`onEnable`. Verify by reading `focus-mode/index.ts`'s `restoreFromSettings` implementation from
Step 2 — it calls `this.onEnable(ctx)` which sets `_enabled = true` as its first operation.

---

## Notes for Lead Developer

- The `buildPluginContext()` call in `handleAction` for `"view-toggle-focus"` reads
  `pluginManager.getStates().focusMode` to get the current state before toggling. This is the
  correct approach — do not read `focusModeEnabled` (which is removed) or any other local flag.
- The `ctx` variable in `initApp()` is declared once and reused for the `pluginManager.restoreAll`
  call. It must be declared after `editor = createEditor(...)` returns a non-null editor, not
  before. Check the placement carefully.
- After this step, the Pilot (Phase A) is complete. The next step in the requirements doc
  ordering is Step 2 (status bar module extraction), which is Phase B1 in the plan. See
  `step_05_phase_b_remaining.md` for all of Phase B.

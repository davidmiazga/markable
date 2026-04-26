# Step 02 — Focus Mode Module (Phase A2)

**Phase:** A2 (Pilot — Focus Mode only)
**Checklist items:** Focus mode directory created, CSS extracted, old file deleted, `extensions.ts` import updated
**Risk:** Medium. Three files are modified (`extensions.ts`, `styles.css`, and `main.ts` for the
import line). The old `src/editor/focus-mode.ts` is deleted. All changes must happen together in
one commit (EC-5).

---

## Objective

Move Focus Mode out of `src/editor/` into its own plugin directory under `src/plugins/`. Extract
the CSS class `.cm-focus-dimmed` from `styles.css` into a co-located `focus-mode.css`. Create the
`MarkablePlugin` wrapper `index.ts`. Update the one import in `extensions.ts`. Delete the old
file.

At the end of this step, `src/editor/` no longer contains `focus-mode.ts`, and `styles.css` no
longer contains the `.cm-focus-dimmed` rule. The `focusModeField` state, `setFocusMode` effect,
and `focusModeExtension` export are now at `src/plugins/focus-mode/focus-mode.ts`.

The plugin is NOT yet wired through `PluginManager` (that is Step 6). `main.ts` still toggles
focus mode by calling `setFocusMode` directly via `handlePluginToggle`. Only the file location and
`extensions.ts` import path change in this step.

---

## Files to Create

### `src/plugins/focus-mode/focus-mode.ts` (moved, content unchanged)

Copy `src/editor/focus-mode.ts` verbatim. Do not alter any export names, function signatures, or
logic. The file's internal imports (`@codemirror/state`, `@codemirror/view`) use bare package
specifiers and require no path adjustment.

Confirm the following exports are present (unchanged):

```typescript
export const setFocusMode: StateEffect<boolean>;
export const focusModeField: StateField<boolean>;
export const focusModeExtension: Extension;
```

### `src/plugins/focus-mode/focus-mode.css` (new)

Cut the following block from `src/styles.css` (currently at lines 744–748) and paste it here:

```css
/* --- Focus Mode --- */
.cm-focus-dimmed {
  opacity: 0.25;
  transition: opacity 0.15s ease;
}
```

### `src/plugins/focus-mode/index.ts` (new)

```typescript
/**
 * Focus Mode Plugin — iA Writer-style paragraph dimming.
 *
 * Dims all lines except the paragraph/block containing the cursor.
 * The CM6 extension is always registered in the editor (via getExtensions()).
 * The `focusModeField` StateField defaults to false; toggling it via
 * `setFocusMode` StateEffect is the only way to enable/disable.
 */

import "./focus-mode.css";
import type { Extension } from "@codemirror/state";
import { focusModeExtension, setFocusMode } from "./focus-mode";
import type { MarkablePlugin, PluginContext, MarkableSettings } from "../plugin-types";

let _enabled = false;

export const FocusModePlugin: MarkablePlugin = {
  id: "focusMode",
  name: "Focus Mode",
  description: "Dim all content except the current paragraph",
  detail:
    "Dims all lines except the paragraph containing your cursor, helping you focus on what you're writing. The active paragraph stays at full opacity while everything else fades. Works at the paragraph/block level — code fences and list items are treated as single blocks.",

  getExtensions(): Extension[] {
    return [focusModeExtension];
  },

  onEnable(ctx: PluginContext): void {
    _enabled = true;
    ctx.editor.dispatch({ effects: setFocusMode.of(true) });
  },

  onDisable(ctx: PluginContext): void {
    _enabled = false;
    ctx.editor.dispatch({ effects: setFocusMode.of(false) });
  },

  restoreFromSettings(settings: MarkableSettings, ctx: PluginContext): void {
    if (settings.focusMode === true) {
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

---

## Files to Modify

### `src/editor/extensions.ts`

**Change 1:** Update the focus mode import (line 22 in the current file):

```diff
-import { focusModeExtension } from "./focus-mode";
+import { focusModeExtension } from "../plugins/focus-mode/focus-mode";
```

The `typewriterModeExtension` import on line 23 is NOT changed in this step. Typewriter mode
moves in Step 4.

No other change to `extensions.ts` in this step.

### `src/styles.css`

**Remove lines 744–748** (the Focus Mode block):

```diff
-/* --- Focus Mode --- */
-.cm-focus-dimmed {
-  opacity: 0.25;
-  transition: opacity 0.15s ease;
-}
```

The Status Bar block (lines 712–742) is NOT removed in this step. That moves in Step 2
(status-bar module). Wait — Steps are numbered differently in the requirements doc vs the plan.
Clarification: the requirements doc's step order (1–10) is authoritative. This file is "Step 3"
in the requirements doc numbering, and "A2" in the plan's phase labeling. The status bar
extraction (requirements step 2) happens after this step in the implementation order shown in
`00_index.md`. The CSS lines that need removing here are only the focus mode block (lines 744–748).

### `main.ts`

The import of `setFocusMode` at line 17 must be updated to reflect the new path:

```diff
-import { setFocusMode } from "./editor/focus-mode";
+import { setFocusMode } from "./plugins/focus-mode/focus-mode";
```

This is the only `main.ts` change in this step. The `handlePluginToggle` function that uses
`setFocusMode` remains unchanged until Step 8.

---

## Files to Delete

| File | Action |
|---|---|
| `src/editor/focus-mode.ts` | Delete |

This deletion MUST happen in the same commit as the import update in `extensions.ts` (EC-5). The
TypeScript compiler will error if `extensions.ts` references the old path while the file still
exists at two locations.

---

## Verification Checklist

- [ ] `src/plugins/focus-mode/` directory contains `focus-mode.ts`, `focus-mode.css`, `index.ts`
- [ ] `src/editor/focus-mode.ts` no longer exists
- [ ] `src/styles.css` contains no `.cm-focus-dimmed` rule
- [ ] `src/editor/extensions.ts` line for focus mode import points to
  `"../plugins/focus-mode/focus-mode"`
- [ ] `src/main.ts` import for `setFocusMode` points to `"./plugins/focus-mode/focus-mode"`
- [ ] `npm run tauri dev` launches without TypeScript or Vite errors
- [ ] Focus mode can be enabled via the Plugins panel and lines dim correctly
- [ ] Focus mode state persists across app restarts
- [ ] 29 Rust tests pass
- [ ] 204 Vitest tests pass

---

## Edge Cases to Verify

**EC-4:** `focusModeExtension` is registered in `extensions.ts` during `buildExtensions()` before
`onEnable` is ever called. The `focusModeField` StateField defaults to `false` at creation. No
visual dimming occurs until `setFocusMode.of(true)` is dispatched. This is safe and unchanged from
the current behavior.

**EC-5:** File deletion and import update are in the same commit. If the PR diff shows
`extensions.ts` updated but `src/editor/focus-mode.ts` still present, the step is incomplete.

---

## Notes for Lead Developer

- The `index.ts` imports `"./focus-mode"` (relative, no `.ts` extension) per TypeScript/Vite
  convention. Vite resolves this correctly.
- The metadata strings in `FocusModePlugin` (`name`, `description`, `detail`) must exactly match
  the current values in `src/plugins/plugins-panel.ts` lines 33–37. Copy them verbatim to avoid
  a visible change in the Plugins panel.
- The `import "./focus-mode.css"` at the top of `index.ts` causes Vite to bundle the CSS
  automatically. No global import is needed in `main.ts` or `styles.css`.
- After this step, `main.ts` has two import paths from `./plugins/focus-mode/`:
  one for `setFocusMode` (used directly until Step 8) and one indirectly via
  `extensions.ts`. This is expected and harmless.

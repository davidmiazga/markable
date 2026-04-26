# Step 01 — Enable Menu Items + Wire Menu Events

**Goal:** Enable `edit-find` and `edit-find-replace` in the native macOS menu so they receive click events, and handle those events in `main.ts` by calling the appropriate CM6 commands.

**Requirements covered:** FR-1.1, FR-1.2, FR-3.1, FR-3.2, FR-3.3, AC-1 through AC-5, EC-1, EC-16, EC-23

**Files to change:**
- `src-tauri/src/menu.rs` (2 character changes)
- `src/main.ts` (import additions + 2 new `case` blocks)

---

## 1. `src-tauri/src/menu.rs`

### Change

Lines 68–69 in `menu.rs` (inside `edit_menu`). Change the `false` enabled flag to `true` on both menu items:

**Before:**
```rust
&MenuItem::with_id(handle, "edit-find", "Find...", false, Some("CmdOrCtrl+F"))?,
&MenuItem::with_id(handle, "edit-find-replace", "Find and Replace...", false, Some("CmdOrCtrl+Shift+F"))?,
```

**After:**
```rust
&MenuItem::with_id(handle, "edit-find", "Find...", true, Some("CmdOrCtrl+F"))?,
&MenuItem::with_id(handle, "edit-find-replace", "Find and Replace...", true, Some("CmdOrCtrl+Shift+F"))?,
```

No other changes to `menu.rs`. The accelerators remain exactly as written. No new Rust commands are needed (TC-1).

---

## 2. `src/main.ts`

### 2a. Add imports

At the top of `main.ts`, the import block for format commands currently reads:

```typescript
import {
  toggleHeading,
  toggleInlineWrap,
  toggleLinePrefix,
  toggleOrderedList,
  toggleTaskList,
  insertCodeFence,
  insertHorizontalRule,
  indentLines,
  outdentLines,
  clearFormatting,
} from "./editor/format";
```

Add a new import for the two CM6 search commands that will be dispatched. This import must come from `@codemirror/search` (which will be a direct dependency after step_02):

```typescript
import { openSearchPanel } from "@codemirror/search";
```

Place this import after the existing `@codemirror`-family imports (after line 13 `import { previewCompartment, previewExtensions } from "./editor/extensions";`), in a logical grouping. The exact placement does not affect behavior, but grouping by source (CM6 packages together) keeps the file readable.

### 2b. Add cases to the menu-event switch

Locate the `switch (event.payload.action)` block inside `initApp()`. The last explicit named `case` before the `default` block is:

```typescript
case "format-clear": if (editor) clearFormatting(editor); break;
```

Insert two new cases **immediately before** the `default:` block:

```typescript
      // EC-1, EC-16: guard against editor not yet initialized
      case "edit-find":
        if (!editor) break;
        // EC-23: settings panel may be visible simultaneously — that is acceptable;
        // both panels can coexist since they occupy different DOM regions.
        openSearchPanel(editor);
        break;

      case "edit-find-replace":
        if (!editor) break;
        // CM6 v6.6.0 has no openReplacePanel command — the replace row is always
        // rendered in the panel DOM. Open the panel then focus the replace field.
        openSearchPanel(editor);
        // Use requestAnimationFrame so the panel has completed its mount cycle
        // before we attempt to query the replace input.
        requestAnimationFrame(() => {
          const replaceInput = editor!.dom.querySelector<HTMLInputElement>(
            '.cm-search input[name="replace"]'
          );
          replaceInput?.focus();
          replaceInput?.select();
        });
        break;
```

### Complete diff context (for precision)

The area around the insertion point in `main.ts` should look like this after the change:

```typescript
      case "format-clear": if (editor) clearFormatting(editor); break;

      // EC-1, EC-16: guard against editor not yet initialized
      case "edit-find":
        if (!editor) break;
        // EC-23: settings panel may be visible simultaneously — that is acceptable;
        // both panels can coexist since they occupy different DOM regions.
        openSearchPanel(editor);
        break;

      case "edit-find-replace":
        if (!editor) break;
        // CM6 v6.6.0 has no openReplacePanel command — the replace row is always
        // rendered in the panel DOM. Open the panel then focus the replace field.
        openSearchPanel(editor);
        requestAnimationFrame(() => {
          const replaceInput = editor!.dom.querySelector<HTMLInputElement>(
            '.cm-search input[name="replace"]'
          );
          replaceInput?.focus();
          replaceInput?.select();
        });
        break;

      default: {
```

---

## Acceptance Criteria for Step 01

- [ ] `cargo check` passes with no errors (Rust side).
- [ ] `Edit > Find...` menu item is visible and enabled in the running app (not grayed out).
- [ ] `Edit > Find and Replace...` menu item is visible and enabled.
- [ ] Clicking `Edit > Find...` does not throw a JavaScript error (panel may not appear yet — that is step_02's job).
- [ ] `tsc --noEmit` passes with no TypeScript errors after adding the `openSearchPanel` import and cases.
- [ ] No TODO comments introduced.

---

## Notes

- The `editor!` non-null assertion in `requestAnimationFrame` is safe because the `if (!editor) break` guard above ensures `editor` is non-null at the point the outer `case` runs. The arrow function closes over `editor` after the guard, but the `!` is required because TypeScript cannot see through the closure's deferred execution.
- `requestAnimationFrame` is chosen over `setTimeout(..., 0)` because it defers execution to the next paint frame, which is when CM6 guarantees the panel DOM is mounted. Both would work, but `requestAnimationFrame` is semantically more precise.
- There is no need to call `editor.focus()` before `openSearchPanel` — the CM6 command handles focus correctly regardless of current focus state.

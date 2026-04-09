# Step 04 — Menu Wiring

**Goal:** Enable the `file-export` menu item in Rust, forward its event to the frontend, and handle it in `main.ts` by calling `exportAsHtml`.

**Requirement references:** FR-1.1, FR-1.2, FR-2.1, FR-2.2, AC-1, AC-2, AC-3, AC-20

**Prerequisite:** step_02 complete (dialog infrastructure), step_03 complete (`exportAsHtml` exported from `src/lib/export.ts`).

---

## Files to Change

### 1. `src-tauri/src/menu.rs`

**Change:** On the `file-export` `MenuItem`, change `enabled: false` to `enabled: true`.

Current (line 47):
```rust
&MenuItem::with_id(handle, "file-export", "Export", false, Some("CmdOrCtrl+Alt+E"))?,
```

New:
```rust
&MenuItem::with_id(handle, "file-export", "Export", true, Some("CmdOrCtrl+Alt+E"))?,
```

This is a single boolean change. The accelerator `CmdOrCtrl+Alt+E` is retained as-is (TC-3).

The `file-import` line immediately below remains `enabled: false` — do not change it.

---

### 2. `src-tauri/src/lib.rs`

**Change:** Add `"file-export"` to the `forward` match arm inside `on_menu_event`.

Current block (lines 185-192):
```rust
let forward = match id {
    "app-settings"
    | "file-new" | "file-open" | "file-save" | "file-save-as"
    | "view-toggle-preview"
    | "view-zoom-in" | "view-zoom-out" | "view-zoom-reset"
    | "theme-next" | "theme-prev"
    | "theme-light" | "theme-dark" | "theme-system" => true,
    _ if id.starts_with("format-") || id.starts_with("recent-file-") => true,
    _ => {
        ...
        false
    }
};
```

New (add `"file-export"` to the first match arm — placement after `"file-save-as"` is clearest):
```rust
let forward = match id {
    "app-settings"
    | "file-new" | "file-open" | "file-save" | "file-save-as" | "file-export"
    | "view-toggle-preview"
    | "view-zoom-in" | "view-zoom-out" | "view-zoom-reset"
    | "theme-next" | "theme-prev"
    | "theme-light" | "theme-dark" | "theme-system" => true,
    _ if id.starts_with("format-") || id.starts_with("recent-file-") => true,
    _ => {
        ...
        false
    }
};
```

No other changes to `lib.rs` in this step. (The `pub use` and `invoke_handler!` changes were completed in step_02.)

---

### 3. `src/main.ts`

Three changes are required.

**Change A — Add `saveHtmlDialog` to the bridge import and add `exportAsHtml` import:**

Current import block (lines 29-37):
```typescript
import {
  readFile,
  writeFile,
  openFileDialog,
  saveFileDialog,
  updateRecentFilesMenu,
  listThemes,
  readThemeCss,
  updateThemeMenu,
} from "./lib/bridge";
```

New (add `saveHtmlDialog`):
```typescript
import {
  readFile,
  writeFile,
  openFileDialog,
  saveFileDialog,
  saveHtmlDialog,
  updateRecentFilesMenu,
  listThemes,
  readThemeCss,
  updateThemeMenu,
} from "./lib/bridge";
```

Add a new import for `exportAsHtml`. Place it after the bridge import block:
```typescript
import { exportAsHtml } from "./lib/export";
```

Note: `saveHtmlDialog` is imported here via `bridge.ts` because that is the established pattern for all dialog and file functions in `main.ts`. The `exportAsHtml` function in `export.ts` imports `saveHtmlDialog` directly from `bridge.ts` itself (not from `main.ts`). The `saveHtmlDialog` import in `main.ts` is NOT used directly by `main.ts` — it is here only if future code in `main.ts` needs it. If the TypeScript compiler warns about an unused import, remove it; `exportAsHtml` handles the dialog internally.

Actually, re-evaluate: `exportAsHtml` already imports `saveHtmlDialog` directly from `./bridge` inside `export.ts`. `main.ts` does not call `saveHtmlDialog` directly. Therefore **do not add `saveHtmlDialog` to the `main.ts` import**. Only add the `exportAsHtml` import. Change A is:

```typescript
import { exportAsHtml } from "./lib/export";
```

This single line is added after the bridge import block and before the settings import block (or at any logical grouping point consistent with the existing import ordering in the file).

**Change B — Add `"file-export"` case to the `menu-event` switch block:**

The switch block is inside the `listen<{ action: string }>("menu-event", ...)` callback in `initApp()`. Locate the `case "file-save-as":` case:

```typescript
case "file-save-as":
  saveFileAs();
  break;
```

Add the new case immediately after it:

```typescript
case "file-export":
  // FR-2.2: void-prefix keeps the async call from producing an unhandled
  // promise in the synchronous switch/event-listener context.
  // AC-20: exportAsHtml never modifies currentFilePath.
  void exportAsHtml(editor, currentFilePath);
  break;
```

The `void` prefix is consistent with the pattern used by other async operations invoked from the synchronous switch block (observe that `openFile()`, `saveFile()`, `saveFileAs()` are all async functions called without `await` in the switch, which produces the same floating-promise pattern). Using `void` makes the intent explicit and suppresses any linter warnings about floating promises.

**Change C — Verify `currentFilePath` is not declared `const`:**

`currentFilePath` is declared as `let currentFilePath: string | null = null` at module scope (line 63 of `main.ts`). This is correct — `exportAsHtml` receives it as a value parameter, reads it, and does not reassign the module-level variable. No change needed; this is a verification step only.

---

## Verification — End-to-End Manual Test

After completing all four file changes and running `cargo build && npx tsc --noEmit`:

1. Launch the app with `npm run tauri dev`.
2. Verify `File > Export` is enabled in the menu bar (not greyed out). (AC-1)
3. Press `Cmd-Alt-E`. The native save dialog should open. (AC-2)
4. The dialog's default filename should be `untitled.html` (no file open). (AC-6)
5. Cancel the dialog. No error, no state change. (AC-7, EC-8)
6. Open a file (e.g. `notes.md`).
7. Press `Cmd-Alt-E`. Dialog default filename should be `notes.html`. (AC-5, FR-7.2)
8. Choose a save location and confirm.
9. Open the exported `.html` file in Safari. It should display a readable document with the correct title and styled content. (AC-8, AC-9, AC-14)
10. Verify the title bar in Markable still shows `notes.md` — not changed to `notes.html`. (AC-20, FR-8.4)

---

## Acceptance Criteria for This Step

- [ ] `File > Export` is enabled and visible in the macOS menu bar. (AC-1)
- [ ] `Cmd-Alt-E` triggers the export flow. (AC-2)
- [ ] Clicking `File > Export` triggers the export flow. (AC-3)
- [ ] The save dialog opens with the correct suggested filename. (AC-5, AC-6)
- [ ] Cancel is silent. (AC-7)
- [ ] Exported HTML opens in Safari with correct title and styled content. (AC-9, AC-14)
- [ ] `currentFilePath` in `main.ts` is not modified after export. (AC-20)
- [ ] `cargo build` produces no errors.
- [ ] `npx tsc --noEmit` produces no errors.
- [ ] `file-import` is still disabled.

---

## What NOT to Do

- Do not assign `currentFilePath` to the exported path anywhere — not in `main.ts`, not in `export.ts`.
- Do not add `await` before `exportAsHtml(...)` in the switch case — the listener callback is not async-compatible; use `void` instead.
- Do not enable `file-import`.
- Do not change the `file-export` accelerator from `CmdOrCtrl+Alt+E` (TC-3).

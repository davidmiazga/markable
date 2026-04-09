# Step 02 — HTML Save Dialog Infrastructure

**Goal:** Add a new `save_html_dialog` Rust command and a corresponding `saveHtmlDialog` TypeScript bridge function. The existing `save_file_dialog` command and its callers are NOT changed.

**Requirement references:** FR-7.1, FR-7.2, FR-7.3, TC-1

**Prerequisite:** step_01 complete (`marked` installed).

---

## Context

The existing `save_file_dialog` Rust command (`src-tauri/src/commands/dialogs.rs`) accepts no parameters and hardcodes:
- Filter: `.md` / `.txt`
- Default filename: `untitled.md`

It cannot be reused for HTML export because the filter and default filename need to differ. The design decision (documented in `00_index.md`) is to add a new command rather than parameterize the existing one, to avoid any regression in the Save As flow.

The new command `save_html_dialog` accepts a `suggested_filename: String` parameter and hardcodes the HTML filter.

---

## Files to Change

### 1. `src-tauri/src/commands/dialogs.rs`

Append the following function after the existing `save_file_dialog` function. Do not modify any existing function.

```rust
/// Save file dialog for exporting as HTML.
///
/// # Arguments
/// * `app` - Tauri AppHandle for dialog access
/// * `suggested_filename` - Pre-populated filename in the dialog (e.g. "notes.html")
///
/// # Returns
/// * `Ok(Some(path))` - User selected save location (absolute path as string)
/// * `Ok(None)` - User cancelled the dialog
/// * `Err(String)` - Dialog failed (rare)
///
/// # Dialog Behavior
/// - Starts in user's home directory
/// - Default filename: value of `suggested_filename`
/// - Primary filter: HTML Files (.html, .htm)
/// - Secondary filter: All Files (*)
#[tauri::command]
pub async fn save_html_dialog(
    app: tauri::AppHandle,
    suggested_filename: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = mpsc::channel();

    app.dialog()
        .file()
        .add_filter("HTML Files", &["html", "htm"])
        .add_filter("All Files", &["*"])
        .set_file_name(&suggested_filename)
        .save_file(move |path| {
            let path_string = path.map(|p| p.to_string());
            let _ = tx.send(path_string);
        });

    rx.recv().map_err(|e| {
        eprintln!("save_html_dialog error: {}", e);
        format!("File dialog failed: {}", e)
    })
}
```

Note: `mpsc` is already imported at the top of `dialogs.rs` (`use std::sync::mpsc;`) — do not add a duplicate import.

---

### 2. `src-tauri/src/lib.rs`

Two changes are required. Both are additive — no existing lines are removed.

**Change A — Re-export on the `pub use` line (line 9):**

Current:
```rust
pub use commands::{open_file_dialog, read_file, save_file_dialog, write_file, get_settings, save_settings, list_themes, read_theme_css};
```

New (add `save_html_dialog` to the list):
```rust
pub use commands::{open_file_dialog, read_file, save_file_dialog, save_html_dialog, write_file, get_settings, save_settings, list_themes, read_theme_css};
```

**Change B — Register in `invoke_handler!` (inside `pub fn run()`):**

Current:
```rust
.invoke_handler(tauri::generate_handler![
    greet,
    open_file_dialog,
    read_file,
    save_file_dialog,
    write_file,
    ...
])
```

New (add `save_html_dialog` after `save_file_dialog`):
```rust
.invoke_handler(tauri::generate_handler![
    greet,
    open_file_dialog,
    read_file,
    save_file_dialog,
    save_html_dialog,
    write_file,
    ...
])
```

---

### 3. `src/lib/dialogs.ts`

Append the following function after the existing `saveFileDialog` function. Do not modify any existing function.

```typescript
/**
 * Save file dialog for exporting as HTML.
 *
 * @param suggestedFilename - Pre-populated filename (e.g. "notes.html")
 * @returns Promise resolving to DialogResult
 *   - { cancelled: false, path: string } — User selected save location
 *   - { cancelled: true } — User cancelled the dialog
 *
 * @example
 * ```typescript
 * const result = await saveHtmlDialog("notes.html");
 * if (!result.cancelled) {
 *   await writeFile(result.path, htmlContent);
 * }
 * ```
 */
export async function saveHtmlDialog(suggestedFilename: string): Promise<DialogResult> {
  try {
    const path = await invoke<string | null>("save_html_dialog", {
      suggestedFilename,
    });

    if (path) {
      return { cancelled: false, path };
    } else {
      return { cancelled: true };
    }
  } catch (error) {
    console.error("saveHtmlDialog error:", error);
    // Treat errors as cancellation for UI purposes
    return { cancelled: true };
  }
}
```

Note: `invoke` and `DialogResult` are already imported at the top of `dialogs.ts` — do not add duplicate imports.

The Tauri invoke parameter key is `suggestedFilename` (camelCase). Tauri v2 maps this to the Rust snake_case parameter `suggested_filename` automatically via its serde rename convention.

---

### 4. `src/lib/bridge.ts`

Add `saveHtmlDialog` to the re-export line for dialog functions.

Current (line 14):
```typescript
export { openFileDialog, saveFileDialog } from "./dialogs";
```

New:
```typescript
export { openFileDialog, saveFileDialog, saveHtmlDialog } from "./dialogs";
```

---

## Verification

After making all four changes:

```bash
cargo build 2>&1 | grep -E "error|warning"
npx tsc --noEmit
```

Both must produce zero errors. The dialog will not be visually testable until step_04 wires the menu event, but the TypeScript and Rust compilation confirms the plumbing is correct.

---

## Acceptance Criteria for This Step

- [ ] `save_html_dialog` Rust command compiles without errors.
- [ ] `save_html_dialog` is in the `pub use` line in `lib.rs`.
- [ ] `save_html_dialog` is in `tauri::generate_handler![]` in `lib.rs`.
- [ ] `saveHtmlDialog(suggestedFilename: string)` is exported from `src/lib/dialogs.ts`.
- [ ] `saveHtmlDialog` is re-exported from `src/lib/bridge.ts`.
- [ ] `cargo build` produces no errors.
- [ ] `npx tsc --noEmit` produces no errors.
- [ ] The existing `saveFileDialog()` function and its call site in `saveFileAs()` in `main.ts` are unchanged.

---

## What NOT to Do

- Do not modify the existing `save_file_dialog` Rust function.
- Do not modify the existing `saveFileDialog` TypeScript function.
- Do not modify `saveFileAs()` in `main.ts` — it still calls `saveFileDialog()` unchanged.
- Do not add a new Tauri plugin. The existing `tauri_plugin_dialog` is sufficient.

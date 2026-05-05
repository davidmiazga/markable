---
title: Step 01 — Rust Commands + TypeScript Bridge
last-updated: "2026-05-05"
review-cadence-days: 90
status: active
---

# Step 01 — Rust Commands + TypeScript Bridge

## Goal

Implement the foundational I/O layer:

1. `write_binary_file` Rust command in `io.rs` (atomic temp-file-swap for `Vec<u8>`)
2. `save_image_dialog` Rust command in `dialogs.rs` (PNG-filtered save dialog)
3. Export and register both commands in `mod.rs` and `lib.rs`
4. TypeScript bridge wrappers `writeBinaryFile` and `saveImageDialog`
5. New helper module `src/lib/clipboard-image.ts` with pure functions `generateImageFilename` and `computeImageSnippet`

After this step `cargo test` must pass. `npm run test:run` must also pass
(the paste handler is not yet wired, but no existing tests may regress).

---

## Files to Create

| Path | Purpose |
|---|---|
| `src/lib/clipboard-image.ts` | Pure helper functions extracted for testability |

## Files to Modify

| Path | Change |
|---|---|
| `src-tauri/src/commands/io.rs` | Add `write_binary_file` command after `write_file` |
| `src-tauri/src/commands/dialogs.rs` | Add `save_image_dialog` command after `save_html_dialog` |
| `src-tauri/src/commands/mod.rs` | Export `write_binary_file` from `io` and `save_image_dialog` from `dialogs` |
| `src-tauri/src/lib.rs` | Add both to `pub use` block and `generate_handler![]` |
| `src/lib/dialogs.ts` | Add `saveImageDialog` function |
| `src/lib/bridge.ts` | Add `writeBinaryFile` function; add `saveImageDialog` to re-export line |

---

## Detailed Instructions

### 1. `src-tauri/src/commands/io.rs` — add `write_binary_file`

Insert immediately after the closing brace of `write_file` (before `#[cfg(test)]`).

The function signature and pattern must exactly mirror `write_file`, substituting
`content: String` for `data: Vec<u8>` and `file.write_all(content.as_bytes())`
for `file.write_all(&data)`. All other logic — parent-dir guard, timestamp-based
temp filename, `sync_all()`, atomic rename, error messages — must be identical.

Key difference in doc comment: state that `data` is raw binary bytes and that
callers pass a `number[]` from JavaScript which Tauri deserializes as `Vec<u8>`.

Error message strings must be identical to those in `write_file` so tests can
use the same assertions:
- Parent missing: `"File not found: {path} (parent dir missing)"`
- Permission denied on create: `"Permission denied: {path}"`
- Permission denied on rename: `"Permission denied: {path}"`
- Atomic swap failure: `"Write failed: atomic swap could not complete ({kind})"`
- Disk write error: `"Failed to write to temp file: {path} ({e})"`
- Sync error: `"Failed to sync file to disk: {path} ({e})"`

### 2. `src-tauri/src/commands/io.rs` — add Rust tests for `write_binary_file`

Add a new `#[cfg(test)]` sub-section inside the existing `mod tests` block,
after the existing `write_file` tests. Tests to write:

- `test_write_binary_file_success`: write known bytes (e.g. `[0x89, 0x50, 0x4e, 0x47]`
  — the PNG magic bytes), verify the file exists and `fs::read()` returns those exact bytes.
- `test_write_binary_file_creates_new_file`: confirm the file does not exist before,
  succeeds, and is readable after.
- `test_write_binary_file_parent_missing`: call with `/nonexistent/test.bin`,
  assert `is_err()` and message contains `"File not found"`.
- `test_write_binary_file_empty_data`: write zero bytes, verify file exists with
  zero length.

Use the same `create_temp_file` / `remove_temp_file` helpers as the existing tests.
For the binary tests, use `std::env::temp_dir().join(format!("markable_binary_{}.bin", std::process::id()))`.

### 3. `src-tauri/src/commands/dialogs.rs` — add `save_image_dialog`

Insert immediately after `save_html_dialog`. The implementation is structurally
identical to `save_html_dialog`:

```rust
#[tauri::command]
pub async fn save_image_dialog(
    app: tauri::AppHandle,
    suggested_filename: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = mpsc::channel();

    app.dialog()
        .file()
        .add_filter("PNG Image", &["png"])
        .add_filter("All Files", &["*"])
        .set_file_name(&suggested_filename)
        .save_file(move |path| {
            let path_string = path.map(|p| p.to_string());
            let _ = tx.send(path_string);
        });

    rx.recv().map_err(|e| {
        eprintln!("save_image_dialog error: {}", e);
        format!("File dialog failed: {}", e)
    })
}
```

No Rust tests are required for `save_image_dialog` — dialog tests require a
running app handle and are excluded from `cargo test` per project convention
(see `save_html_dialog`: no tests exist for it either).

### 4. `src-tauri/src/commands/mod.rs`

Add to the existing `pub use io::` line:

```rust
pub use io::{read_file, write_file, write_binary_file};
```

Add to the existing `pub use dialogs::` line:

```rust
pub use dialogs::{open_file_dialog, open_folder_dialog, save_file_dialog, save_html_dialog, save_image_dialog};
```

### 5. `src-tauri/src/lib.rs`

In the `pub use commands::` block (around line 26), add `write_binary_file` on
the same line as `write_file`, and add `save_image_dialog` on the same line as
`save_html_dialog`.

In `generate_handler![]`, add `write_binary_file` immediately after `write_file`
and add `save_image_dialog` immediately after `save_html_dialog`.

CRITICAL INVARIANT CHECK: After editing `lib.rs`, verify that:
- The line `let logical_h = phys.height as f64 / scale * 0.8;` is still present
  and unchanged (window size invariant — do not touch the `.setup()` hook).

### 6. `src/lib/dialogs.ts` — add `saveImageDialog`

Insert after `saveHtmlDialog`. The implementation mirrors it exactly, substituting
`save_html_dialog` for `save_image_dialog` and adjusting the error log text:

```typescript
export async function saveImageDialog(
  suggestedFilename: string
): Promise<DialogResult> {
  try {
    const path = await invoke<string | null>("save_image_dialog", {
      suggestedFilename,
    });

    if (path) {
      return { cancelled: false, path };
    } else {
      return { cancelled: true };
    }
  } catch (error) {
    console.error("saveImageDialog error:", error);
    return { cancelled: true };
  }
}
```

### 7. `src/lib/bridge.ts` — add `writeBinaryFile` and re-export `saveImageDialog`

Add `writeBinaryFile` after `writeFile`:

```typescript
/**
 * Write raw binary data to a file atomically.
 *
 * Uses the same temp-file-swap pattern as writeFile.
 * `data` must be a plain number[] (values 0-255); Tauri serializes this
 * correctly to Vec<u8> on the Rust side. Uint8Array is not supported.
 *
 * @param path - Absolute file path (created if doesn't exist)
 * @param data - Raw bytes as array of unsigned integers (0-255)
 * @returns Promise resolving to FileResult<void>
 */
export async function writeBinaryFile(
  path: string,
  data: number[]
): Promise<FileResult<void>> {
  try {
    await invoke("write_binary_file", { path, data });
    return { ok: true, value: undefined };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "write_binary_file",
        path,
      } satisfies TauriCommandError,
    };
  }
}
```

Update the existing `export { ... } from "./dialogs"` re-export line to include
`saveImageDialog`:

```typescript
export { openFileDialog, openFolderDialog, saveFileDialog, saveHtmlDialog, saveImageDialog } from "./dialogs";
```

### 8. `src/lib/clipboard-image.ts` — new file

Create this file. It has zero imports from Tauri or CodeMirror. It is a pure
TypeScript module imported by `main.ts` and by tests.

```typescript
/**
 * Pure helper functions for clipboard image paste.
 *
 * Extracted into a standalone module so unit tests can import these
 * functions without pulling in the full app initialisation from main.ts.
 * No Tauri, no CodeMirror, no DOM — purely synchronous string/date operations.
 */

/**
 * Generate the image filename for a clipboard paste.
 *
 * @param now - The current local wall-clock time (injected for testability).
 * @returns A filename of the form "YYYYMMDD-HHmmss.png".
 *
 * @example
 *   generateImageFilename(new Date("2026-05-05T14:30:22"))
 *   // → "20260505-143022.png"
 */
export function generateImageFilename(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const year  = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day   = pad(now.getDate());
  const hour  = pad(now.getHours());
  const min   = pad(now.getMinutes());
  const sec   = pad(now.getSeconds());
  return `${year}${month}${day}-${hour}${min}${sec}.png`;
}

/**
 * Compute the Markdown image snippet to insert.
 *
 * Rules (FR-04, EC-11, EC-12, EC-13):
 * - If activeFilePath is non-null AND the image is in the same directory
 *   as the active file → use filename only: "![](filename.png)"
 * - Otherwise (untitled tab or different directory) → absolute path:
 *   "![]({imagePath})"
 *
 * @param imagePath      Absolute path of the saved image file.
 * @param activeFilePath Absolute path of the current editor tab's file,
 *                       or null if the tab is Untitled.
 * @returns The Markdown image snippet string.
 */
export function computeImageSnippet(
  imagePath: string,
  activeFilePath: string | null
): string {
  if (activeFilePath !== null) {
    const imageDir  = imagePath.substring(0, imagePath.lastIndexOf("/"));
    const activeDir = activeFilePath.substring(0, activeFilePath.lastIndexOf("/"));
    if (imageDir === activeDir) {
      const filename = imagePath.substring(imagePath.lastIndexOf("/") + 1);
      return `![](${filename})`;
    }
  }
  return `![](${imagePath})`;
}
```

---

## TDD Checklist (for `cargo test` and `npm run test:run`)

### Rust tests (in `io.rs` — `mod tests`)

- [ ] `test_write_binary_file_success` — write known bytes, read back and compare
- [ ] `test_write_binary_file_creates_new_file` — file absent before, present after
- [ ] `test_write_binary_file_parent_missing` — `Err` containing `"File not found"`
- [ ] `test_write_binary_file_empty_data` — write 0 bytes, file exists with 0 length

### TypeScript tests (in `tests/clipboard-image-paste.test.ts`)

These tests import only from `src/lib/clipboard-image.ts`. No mocking needed —
the functions are pure.

**generateImageFilename:**
- [ ] Returns correct format for a normal date (`20260505-143022.png`)
- [ ] Zero-pads month, day, hour, minute, second correctly
- [ ] Handles midnight (`HH=00`, `mm=00`, `ss=00`)
- [ ] Handles end-of-month boundary (month `12`, day `31`)
- [ ] Extension is always `.png`

**computeImageSnippet — vault-active snippet form (for reference only; vault path
inserts `"![](assets/filename.png)"` which is built in main.ts, not by this function):**

**computeImageSnippet — no-vault paths:**
- [ ] `activeFilePath` is null → returns absolute path form `![]({imagePath})`
- [ ] `imagePath` and `activeFilePath` in the same directory → returns `![](filename.png)` (filename only)
- [ ] `imagePath` in a different directory than `activeFilePath` → returns `![]({imagePath})`
- [ ] Image path with a filename containing no directory separators edge case
      (e.g. `activeFilePath = "/a/b.md"`, `imagePath = "/a/image.png"`) → same dir → relative

---

## Acceptance Criteria (Step 01 only)

- [ ] `cargo test` passes; all four new `write_binary_file` tests green.
- [ ] `npm run test:run` passes; `generateImageFilename` and `computeImageSnippet` tests green.
- [ ] `write_binary_file` is registered in `generate_handler![]` and reachable via `invoke`.
- [ ] `save_image_dialog` is registered in `generate_handler![]` and reachable via `invoke`.
- [ ] `writeBinaryFile` is exported from `bridge.ts` and `saveImageDialog` is re-exported.
- [ ] Window size invariant intact: `lib.rs` still has `* 0.8` for `logical_h`.
- [ ] No TODO comments in any modified file.

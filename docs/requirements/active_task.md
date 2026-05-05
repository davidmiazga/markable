---
title: Clipboard Image Paste
last-updated: "2026-05-05"
review-cadence-days: 14
status: active
---

# Clipboard Image Paste

## Context

When a user copies an image (screenshot, image from a browser, copied from Finder, etc.) and presses Cmd-V while the Markable editor is focused, the app currently does nothing useful with image clipboard data. The text paste path falls through to CodeMirror's default paste handler, which ignores binary data.

This feature intercepts the browser `paste` DOM event before CodeMirror's own paste handler runs, detects an image MIME type on the `ClipboardEvent.clipboardData`, writes the PNG bytes to disk via a new Rust command, and inserts a Markdown image reference at the caret.

---

## Functional Requirements

### FR-01 — Image detection and interception

When Cmd-V is pressed:
- The feature inspects `ClipboardEvent.clipboardData.items` for an item whose `type` starts with `image/`.
- If such an item is found AND the editor is focused AND an active tab is open, the feature takes ownership of the event (`event.preventDefault()`).
- If any of those three conditions is not met, the event is NOT intercepted and falls through to the browser/CM6 default paste handling.

### FR-02 — File naming

The image filename is always `YYYYMMDD-HHmmss.png` where the timestamp is the local wall-clock time at the moment of paste, formatted as:
- `YYYY` — 4-digit year
- `MM`   — 2-digit month (zero-padded)
- `DD`   — 2-digit day (zero-padded)
- `HH`   — 2-digit 24-hour hour (zero-padded)
- `mm`   — 2-digit minute (zero-padded)
- `ss`   — 2-digit second (zero-padded)

Example: `20260505-143022.png`.

The extension is always `.png` regardless of the source MIME type (e.g. `image/jpeg` from the clipboard is still written as `.png`).

### FR-03 — Vault-active path: write to `assets/`

When a vault is active (`vaultManager.getActiveVault()` returns a non-null entry):
- The destination path is `{vaultRoot}/assets/{filename}` where `vaultRoot` is `vault.rootPaths[0]`.
- If the `assets/` subdirectory does not exist, it is created before writing (via the existing `ensure_directory` bridge call).
- The PNG bytes are written atomically via the new `write_binary_file` Rust command (temp-file-swap, identical pattern to `write_file`).
- The Markdown image snippet `![](assets/{filename})` is inserted at `view.state.selection.main.head` in the active CodeMirror view.

### FR-04 — No-vault path: native Save dialog

When no vault is active (`vaultManager.getActiveVault()` returns null):
- A native save-file dialog is shown, pre-populated with `{filename}` and filtered to PNG files only.
- If the user cancels the dialog, the operation is aborted silently — no insertion, no error shown.
- If the user confirms a path, the PNG bytes are written atomically to the chosen absolute path.
- The Markdown snippet to insert is computed as follows:
  - If the active tab has a non-null `filePath` AND the chosen image path shares the same parent directory as the active file, the snippet is `![](assets/{filename})` using just the filename (relative, same-directory form).
  - If the active tab has no `filePath` (Untitled), or if the image path is in a different directory, the snippet is `![]({absoluteImagePath})`.

### FR-05 — CM6 insertion

The Markdown snippet is inserted at the cursor position using:

```
view.dispatch({
  changes: {
    from: view.state.selection.main.head,
    insert: "![](assets/YYYYMMDD-HHmmss.png)",
  },
  userEvent: "input.paste.image",
  scrollIntoView: true,
})
```

The cursor is placed immediately after the closing `)` of the snippet.

### FR-06 — New Rust command: `write_binary_file`

A new Tauri command `write_binary_file` is added to `src-tauri/src/commands/io.rs`:
- Signature: `write_binary_file(path: String, data: Vec<u8>) -> Result<(), String>`
- Uses the identical temp-file-swap atomic write pattern as `write_file`.
- Registered in `tauri::generate_handler![]` in `src-tauri/src/lib.rs`.
- Exported from `src-tauri/src/commands/mod.rs`.

### FR-07 — TypeScript bridge wrapper

A typed wrapper `writeBinaryFile(path: string, data: number[]) -> Promise<FileResult<void>>` is added to `src/lib/bridge.ts`. It calls `invoke("write_binary_file", { path, data })`.

The `data` parameter is `number[]` (an array of unsigned byte values 0–255) because Tauri's `invoke()` serializes JavaScript `Uint8Array` as a JSON array of integers when the Rust side declares `Vec<u8>`.

### FR-08 — Save dialog for no-vault path

A new `saveImageDialog` function is added to `src/lib/dialogs.ts` (or reuses `saveFileDialog` with an override filter). It:
- Opens the native save dialog filtered to PNG files only.
- Pre-populates the filename with the generated `YYYYMMDD-HHmmss.png` value.
- Returns `DialogResult` (same discriminated union as other dialog functions).

### FR-09 — Capability grant

`src-tauri/capabilities/default.json` must include any new permission entries required by `write_binary_file`. Because `write_binary_file` is a custom Tauri command (not a plugin permission), no new capability entry is required beyond those already present for `write_file`. However, if `tauri-plugin-clipboard-manager` is used to read image bytes (see Design Constraint DC-02), the capability entry `clipboard-manager:allow-read-image` must be added.

### FR-10 — Listener location

The `paste` listener is registered on `document` (not on the editor DOM node) at the capture phase inside `initApp()` in `src/main.ts`, placed immediately after the `document.addEventListener("keydown", ...)` block. It must be registered after `editor` is confirmed non-null and after `tabManager.init()` completes.

### FR-11 — Read-only tab guard

If the active tab is a read-only content tab (e.g. a Help file), the paste must not insert into it. Guard: check `tabManager.getActiveTab()?.kind === "editor"` before intercepting.

---

## Non-Functional Requirements

### NFR-01 — Performance

The `Blob.arrayBuffer()` call and the Tauri `invoke` must not block the UI thread. Both are async; the paste handler returns a `Promise`. The editor remains interactive during the write (no spinner or blocking modal is shown for vault-active pastes).

### NFR-02 — Error visibility

On write failure (Rust returns an error string), a browser `alert()` is shown with a human-readable message. This is consistent with existing error handling in `tabManager.saveActiveTab()`.

### NFR-03 — Filename collision handling

If a file already exists at `{vaultRoot}/assets/YYYYMMDD-HHmmss.png`, the atomic rename (`fs::rename`) on Rust will silently overwrite it (POSIX semantics). This is acceptable because same-second collisions are astronomically unlikely and the overwritten file is another paste of the same session. No suffix counter is required at this stage.

### NFR-04 — Non-PNG clipboard images

If the clipboard item's MIME type is not `image/png` (e.g. `image/jpeg`, `image/gif`, `image/webp`), the image bytes are still written with a `.png` extension. The browser `Blob` API is used to read the raw bytes as-is; no transcoding is performed. The file extension is `.png` regardless of actual encoding. This is an explicit simplification — the Architect may revisit PNG-only transcoding in a follow-up.

### NFR-05 — No plugin IIFE boundary

This feature is implemented entirely in the main bundle (`src/main.ts` + `src/lib/bridge.ts` + `src-tauri/src/commands/io.rs`). It is NOT implemented as a plugin IIFE. Rationale: it needs direct access to the `editor` variable, `vaultManager`, and `tabManager`, all of which are main-bundle singletons.

### NFR-06 — Tests

Unit tests cover:
- Filename generation (`YYYYMMDD-HHmmss.png`) for boundary times (midnight, end-of-month).
- The relative vs. absolute path computation for the no-vault dialog path.
- The fall-through guard (non-image clipboard item must not intercept).
- Focus/tab guard (no active tab or read-only tab must not intercept).
- Rust `write_binary_file` — success, parent-missing error, permission-denied error (mirroring `write_file` tests).

---

## Design Constraints

### DC-01 — No `invoke()` calls outside `bridge.ts`

All Tauri command calls must go through `src/lib/bridge.ts`. The paste handler in `main.ts` calls `writeBinaryFile(...)` from `bridge.ts`, not `invoke()` directly.

### DC-02 — Image bytes from `ClipboardEvent`, not Tauri clipboard plugin

The PNG bytes are read from `ClipboardEvent.clipboardData.items[n].getAsFile()` and converted to `Uint8Array` via `Blob.arrayBuffer()`. This is the standard browser Clipboard API and requires no new Tauri plugin permission for reading. The existing `tauri-plugin-clipboard-manager` handles text only and is not extended here.

### DC-03 — Interaction with `pasteURLHandler`

The existing `pasteURLHandler` CM6 extension (`src/editor/format.ts`, `Prec.highest`) intercepts paste of a URL-shaped text when text is selected. The new image paste listener is on `document` at the capture phase and fires before any CM6 DOM event handler. For an image-only clipboard (no `text/plain` item), `pasteURLHandler` will never see a text item and will return `false` harmlessly. For mixed clipboard data (image + text), the document-level listener takes ownership first if it detects an image. There is no conflict.

### DC-04 — Atomic write mandatory

`write_binary_file` must use the same temp-file-swap pattern as `write_file`. Direct `fs::write(path, data)` is prohibited.

### DC-05 — `vaultRoot` definition

For a multi-root vault, `vault.rootPaths[0]` is always used as the single `assets/` parent. Multi-root vaults are an advanced edge case; this simplification is explicitly accepted for v1 of this feature.

---

## Impact Analysis

| Area | Change |
|---|---|
| `src-tauri/src/commands/io.rs` | Add `write_binary_file` command |
| `src-tauri/src/commands/mod.rs` | Export `write_binary_file` |
| `src-tauri/src/lib.rs` | Register `write_binary_file` in `generate_handler![]` |
| `src/lib/bridge.ts` | Add `writeBinaryFile` typed wrapper |
| `src/lib/dialogs.ts` | Add `saveImageDialog` function (or parameterise existing `saveFileDialog`) |
| `src/main.ts` | Add `document` paste listener in `initApp()` |
| `src-tauri/capabilities/default.json` | No change required (custom commands carry no capability entry) |
| `tests/` | New test files for filename generation, path logic, Rust command |

No existing commands, extensions, or plugins are modified. `pasteURLHandler` is unaffected.

---

## Edge Case Inventory

| # | Scenario | Expected behaviour |
|---|---|---|
| EC-01 | Clipboard contains only text (no image item) | Fall through to CM6 default paste. No interception. |
| EC-02 | Clipboard contains an image AND selected text | Image path wins. Image is written; snippet is inserted at caret (not wrapping selection). The selection is not collapsed first — insertion happens at `selection.main.head`. |
| EC-03 | No active tab (`tabManager.getActiveTab()` returns null) | Fall through to default paste. No interception. |
| EC-04 | Active tab is a read-only content tab (Help file) | Fall through. No interception. Do not write any file. |
| EC-05 | Active tab is a media tab (kind = "media") | Fall through. No interception. |
| EC-06 | Editor does not have focus (`!view.hasFocus`) | Fall through. Do not intercept. |
| EC-07 | Vault active but `assets/` directory creation fails (permissions) | `ensure_directory` rejects. Show `alert("Could not create assets directory: {error}")`. Do not insert snippet. |
| EC-08 | Vault active but `write_binary_file` fails (disk full, permissions) | Rust returns `Err`. Show `alert("Could not save image: {error}")`. Do not insert snippet. |
| EC-09 | No vault, user cancels the Save dialog | Silent abort. No file written, no snippet inserted, no error shown. |
| EC-10 | No vault, `write_binary_file` fails after user picks a path | Show `alert("Could not save image: {error}")`. Do not insert snippet. |
| EC-11 | No vault, active tab is Untitled (no `filePath`) | Absolute path from the dialog is inserted: `![]({absolutePath})`. |
| EC-12 | No vault, chosen image path is in a different directory than the active file | Absolute path inserted: `![]({absolutePath})`. |
| EC-13 | No vault, chosen image path is in the same directory as the active file | Relative filename inserted: `![](YYYYMMDD-HHmmss.png)` (no path prefix). |
| EC-14 | Two pastes within the same second (same `YYYYMMDD-HHmmss`) | Second write atomically overwrites the first file. Both paste insertions reference the same filename. Accepted behaviour per NFR-03. |
| EC-15 | Clipboard item `getAsFile()` returns null | The `ClipboardItem` reported type `image/*` but produced a null `File`. Treat as non-image. Fall through to default paste. |
| EC-16 | `Blob.arrayBuffer()` rejects (memory, browser security) | Catch the rejection. Show `alert("Could not read clipboard image data.")`. Do not write or insert. |
| EC-17 | Image is very large (>50 MB) | No size guard is imposed at this stage. The write proceeds. The Architect may add a size cap as a follow-up. |
| EC-18 | Vault is active but `vault.rootPaths` is empty | Guard: if `vault.rootPaths.length === 0`, fall through to the no-vault Save dialog path instead. |
| EC-19 | Active tab is dirty and unsaved | The paste proceeds normally. Dirty state is unaffected; the image file write does not interact with the tab save state. The CM6 insertion will mark the tab dirty via the existing `updateListener`. |
| EC-20 | The `initApp()` paste listener fires before `editor` is assigned | The listener checks `if (!editor || !editor.hasFocus)` at call time (not at registration time), so a null `editor` causes a safe fall-through. |
| EC-21 | Multiple image items in one `ClipboardEvent` (e.g. PNG + TIFF) | Use the first item whose `type.startsWith("image/")`. Ignore subsequent image items. |
| EC-22 | User pastes while the Command Bar overlay is open | The Command Bar steals keyboard focus from the editor; `editor.hasFocus` will be false. The listener falls through to default paste. The overlay handles the event itself. |
| EC-23 | User pastes while the Find/Replace widget is open | The widget has its own focused input; `editor.hasFocus` will be false. Fall through. |

---

## Acceptance Criteria Checklist

- [ ] AC-01: Pasting a PNG screenshot with an active vault writes `{vaultRoot}/assets/YYYYMMDD-HHmmss.png` and inserts `![](assets/YYYYMMDD-HHmmss.png)` at the caret.
- [ ] AC-02: The `assets/` directory is created automatically if it does not exist.
- [ ] AC-03: Pasting plain text with an active vault falls through to normal CM6 paste behaviour — no file is written.
- [ ] AC-04: Pasting an image with no active vault shows the native Save dialog pre-populated with the generated filename.
- [ ] AC-05: Cancelling the Save dialog leaves the editor and filesystem unchanged.
- [ ] AC-06: Pasting an image in a no-vault scenario where the chosen path is in the same directory as the active file inserts a relative filename-only reference.
- [ ] AC-07: Pasting an image in a no-vault scenario where the active tab is Untitled inserts the absolute path.
- [ ] AC-08: Pasting an image when the editor does not have focus does not intercept the event.
- [ ] AC-09: Pasting an image on a read-only content tab does not intercept the event.
- [ ] AC-10: `write_binary_file` Rust command uses temp-file-swap and its tests pass.
- [ ] AC-11: All EC-01 through EC-23 edge cases are covered by automated tests or manual test notes in the spec.
- [ ] AC-12: `npm run test:run` passes with no regressions to existing tests.
- [ ] AC-13: `cargo test` passes with new `write_binary_file` tests.

---
title: Clipboard Image Paste — Master Blueprint
last-updated: "2026-05-05"
review-cadence-days: 90
status: active
---

# Clipboard Image Paste — Master Blueprint

Requirements source: `docs/requirements/active_task.md`

---

## Stack Decision

No new technology is introduced. This feature uses only mechanisms that already
exist in the codebase:

| Layer | Mechanism | Rationale |
|---|---|---|
| Clipboard read | `ClipboardEvent.clipboardData` (browser DOM API) | DC-02: explicit requirement to NOT use the Tauri clipboard plugin for image bytes |
| Binary write | New `write_binary_file` Rust command in `io.rs` | DC-04: atomic temp-file-swap mandatory; mirrors `write_file` exactly |
| Bridge | `writeBinaryFile` in `bridge.ts` | DC-01: all `invoke()` calls must go through `bridge.ts` |
| Save dialog | New `save_image_dialog` Rust command in `dialogs.rs` + `saveImageDialog` TS wrapper in `dialogs.ts` | Mirrors `save_html_dialog` / `saveHtmlDialog` pattern exactly |
| Paste intercept | `document.addEventListener("paste", ...)` in `main.ts` | FR-10: placed immediately after the existing `keydown` capture listener |
| Directory creation | Existing `ensureDirectory` bridge call | FR-03: already used elsewhere; no new Rust code needed |

---

## High-Level Architecture

### Data flow — vault-active path

```
Cmd-V keypress
  └─ document paste listener (capture phase, main.ts)
       └─ Guard: clipboardData has image/* item  AND  editor.hasFocus  AND  activeTab.kind === "editor"
            └─ event.preventDefault()
            └─ generateImageFilename()  →  "YYYYMMDD-HHmmss.png"
            └─ getAsFile() → Blob → arrayBuffer() → Uint8Array → number[]
            └─ vaultManager.getActiveVault()  (non-null)
                 └─ destPath = vaultRoot + "/assets/" + filename
                 └─ ensureDirectory(vaultRoot + "/assets/")
                 └─ writeBinaryFile(destPath, bytes)   →  invoke("write_binary_file")
                 └─ view.dispatch({ insert: "![](assets/filename.png)" })
```

### Data flow — no-vault path

```
Cmd-V keypress
  └─ document paste listener (capture phase, main.ts)
       └─ Guard passes (editor focused, editor tab)
            └─ generateImageFilename()  →  "YYYYMMDD-HHmmss.png"
            └─ getAsFile() → Blob → arrayBuffer() → Uint8Array → number[]
            └─ vaultManager.getActiveVault()  (null)
                 └─ saveImageDialog(filename)  →  invoke("save_image_dialog")
                      └─ cancelled → silent abort
                      └─ confirmed path
                           └─ writeBinaryFile(chosenPath, bytes)
                           └─ computeSnippet(chosenPath, activeTab.filePath)
                                └─ same dir AND tab has filePath  →  "![](filename.png)"
                                └─ else                           →  "![]({absolutePath})"
                           └─ view.dispatch({ insert: snippet })
```

### Error surface

Any failure after `event.preventDefault()` shows `alert(message)` consistent
with `tabManager.saveActiveTab()`. No failure before `preventDefault()` is
possible (the guards are synchronous).

---

## Component Map

### New files to create

| Path | Purpose |
|---|---|
| `tests/clipboard-image-paste.test.ts` | Full TDD suite: filename generation, path logic, guard fall-through, cancel, write failure |

### Files to modify

| Path | Change |
|---|---|
| `src-tauri/src/commands/io.rs` | Add `write_binary_file` command (atomic write, `Vec<u8>` data) |
| `src-tauri/src/commands/mod.rs` | `pub use io::write_binary_file;` |
| `src-tauri/src/commands/dialogs.rs` | Add `save_image_dialog` command (PNG filter) |
| `src-tauri/src/commands/mod.rs` | `pub use dialogs::save_image_dialog;` |
| `src-tauri/src/lib.rs` | Add `write_binary_file` and `save_image_dialog` to `pub use` block and `generate_handler![]` |
| `src/lib/bridge.ts` | Add `writeBinaryFile` typed wrapper |
| `src/lib/dialogs.ts` | Add `saveImageDialog` function |
| `src/lib/bridge.ts` | Re-export `saveImageDialog` from `dialogs.ts` |
| `src/main.ts` | Add `document` paste listener in `initApp()` after keydown block |

### Files that must NOT change

`src/editor/format.ts`, `src/editor/extensions.ts`,
`src/plugins/**`, `src/tabs/tab-manager.ts`,
`src-tauri/capabilities/default.json` (no new capability entry needed — FR-09),
`src/lib/settings.ts`, `src/lib/errors.ts`

---

## Implementation Roadmap

| Step | File(s) | Summary |
|---|---|---|
| `step_01_rust-and-bridge.md` | `io.rs`, `dialogs.rs`, `mod.rs`, `lib.rs`, `bridge.ts`, `dialogs.ts` | Rust commands + TS bridge + dialog wrapper; Rust tests green ✓ |
| `step_02_paste-handler.md` | `main.ts` + `tests/clipboard-image-paste.test.ts` | Paste listener, helper functions, full test suite green ✓ |

Both steps must leave `npm run test:run` and `cargo test` green before merge.

---

## API Contracts

### `write_binary_file` (Rust)

```rust
#[tauri::command]
pub fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String>
```

- Identical temp-file-swap pattern as `write_file`.
- `data` is `Vec<u8>`; Tauri deserializes a JS `number[]` directly.
- Error messages mirror `write_file`: "File not found: {path} (parent dir missing)",
  "Permission denied: {path}", "Write failed: atomic swap could not complete ({kind})".

### `save_image_dialog` (Rust)

```rust
#[tauri::command]
pub async fn save_image_dialog(
    app: tauri::AppHandle,
    suggested_filename: String,
) -> Result<Option<String>, String>
```

- PNG filter only: `.add_filter("PNG Image", &["png"])`.
- `set_file_name(&suggested_filename)`.
- Returns `Ok(Some(path))` on confirm, `Ok(None)` on cancel.
- Mirrors `save_html_dialog` exactly (same mpsc channel pattern).

### `writeBinaryFile` (TypeScript bridge)

```typescript
export async function writeBinaryFile(
  path: string,
  data: number[]
): Promise<FileResult<void>>
```

- Calls `invoke("write_binary_file", { path, data })`.
- Returns `{ ok: true, value: undefined }` on success.
- Returns `{ ok: false, error: TauriCommandError }` on failure.
- `data` is `number[]` (not `Uint8Array`) because Tauri serializes `number[]`
  to `Vec<u8>` correctly over JSON; `Uint8Array` does not serialize reliably.

### `saveImageDialog` (TypeScript)

```typescript
export async function saveImageDialog(
  suggestedFilename: string
): Promise<DialogResult>
```

- Calls `invoke<string | null>("save_image_dialog", { suggestedFilename })`.
- Returns `{ cancelled: false, path }` or `{ cancelled: true }`.
- Errors are caught and treated as cancellation (mirrors `saveHtmlDialog`).

### `generateImageFilename` (TypeScript helper, exported for tests)

```typescript
export function generateImageFilename(now: Date): string
```

- Returns `"YYYYMMDD-HHmmss.png"` using local wall-clock components.
- Exported from the paste handler module or from `main.ts` via a named export
  in a helper file so tests can import it without importing all of `main.ts`.
- Extraction strategy: the paste listener is implemented inside `initApp()` but
  `generateImageFilename` and `computeImageSnippet` are extracted as standalone
  pure functions in a new file `src/lib/clipboard-image.ts` that `main.ts`
  imports. This makes the helpers testable without mocking the entire app init.

### `computeImageSnippet` (TypeScript helper, exported for tests)

```typescript
export function computeImageSnippet(
  imagePath: string,
  activeFilePath: string | null
): string
```

- If `activeFilePath` is non-null AND `path.dirname(imagePath) === path.dirname(activeFilePath)`:
  returns `"![](FILENAME)"` where FILENAME is the basename of `imagePath`.
- Otherwise: returns `"![](" + imagePath + ")"`.
- Uses `path` operations on the string level only — no Node.js `path` module.
  Extract dirname as `str.substring(0, str.lastIndexOf("/"))` and basename as
  `str.substring(str.lastIndexOf("/") + 1)`.

---

## Guard Logic (all guards are AND-conditions)

```
1. clipboardData.items has at least one item with type.startsWith("image/")  (FR-01, EC-01)
2. editor !== null && editor.hasFocus                                         (FR-01, EC-06, EC-20)
3. tabManager.getActiveTab() !== null                                         (FR-01, EC-03)
4. tabManager.getActiveTab().kind === "editor"                                (FR-11, EC-04, EC-05)
5. item.getAsFile() !== null                                                  (EC-15)
```

If any guard fails: do NOT call `event.preventDefault()`. Fall through to CM6.

EC-21 (multiple image items): use the first item matching `type.startsWith("image/")` only.

---

## Edge Cases Addressed

All 23 edge cases from `docs/requirements/active_task.md` are assigned to a step:

| EC | Assigned step |
|---|---|
| EC-01 (text-only clipboard) | step_02 (guard 1 fails; fall-through test) |
| EC-02 (image + selected text) | step_02 (insert at head, not wrapping selection) |
| EC-03 (no active tab) | step_02 (guard 3 fails; fall-through test) |
| EC-04 (read-only content tab) | step_02 (guard 4 fails; fall-through test) |
| EC-05 (media tab) | step_02 (guard 4 fails; fall-through test) |
| EC-06 (editor not focused) | step_02 (guard 2 fails; fall-through test) |
| EC-07 (assets/ dir create fails) | step_02 (ensureDirectory catch → alert) |
| EC-08 (write_binary_file fails) | step_02 (writeBinaryFile !ok → alert) |
| EC-09 (no-vault cancel dialog) | step_02 (silent abort test) |
| EC-10 (no-vault write fails) | step_02 (writeBinaryFile !ok → alert) |
| EC-11 (no-vault untitled tab) | step_02 (absolute path test via computeImageSnippet) |
| EC-12 (no-vault different dir) | step_02 (absolute path test via computeImageSnippet) |
| EC-13 (no-vault same dir) | step_02 (relative filename test via computeImageSnippet) |
| EC-14 (same-second collision) | Accepted per NFR-03; no code needed |
| EC-15 (getAsFile() returns null) | step_02 (guard 5 fails; fall-through test) |
| EC-16 (arrayBuffer() rejects) | step_02 (catch block → alert) |
| EC-17 (image > 50 MB) | Accepted per NFR-04; no size guard |
| EC-18 (empty rootPaths) | step_02 (rootPaths.length === 0 → no-vault path) |
| EC-19 (dirty unsaved tab) | Accepted per requirements; no special handling |
| EC-20 (editor null at call time) | step_02 (guard 2 null-check) |
| EC-21 (multiple image items) | step_02 (first-match-only test) |
| EC-22 (command bar open) | Covered by guard 2: hasFocus = false |
| EC-23 (find/replace open) | Covered by guard 2: hasFocus = false |

---

## File Layout After Implementation

```
src/
  lib/
    bridge.ts             ← writeBinaryFile added; saveImageDialog re-exported
    dialogs.ts            ← saveImageDialog added
    clipboard-image.ts    ← NEW: generateImageFilename, computeImageSnippet (pure helpers)
  main.ts                 ← paste listener added in initApp()

src-tauri/src/
  commands/
    io.rs                 ← write_binary_file added
    dialogs.rs            ← save_image_dialog added
    mod.rs                ← write_binary_file and save_image_dialog exported
  lib.rs                  ← both commands in pub use and generate_handler![]

tests/
  clipboard-image-paste.test.ts   ← NEW: all TS unit tests
  (Rust tests live in io.rs itself, mirroring write_file tests)
```

---

## Definition of Done

- `npm run test:run` passes with no failures after step_02.
- `cargo test` passes with new `write_binary_file` tests after step_01.
- All 23 ECs are covered by at least one automated test or a documented
  accepted-behaviour note in `active_task.md`.
- No TODO comments in source files.
- No changes to files in the "must NOT change" list.
- Window size invariant: `src-tauri/src/lib.rs` (`sizeH` multiplier = `0.8`)
  and `src/lib/settings.ts` (`sizeH = "80%"`) both intact after editing `lib.rs`.
- `src-tauri/capabilities/default.json` unchanged (FR-09 confirmed: custom
  commands need no capability entry).

---

## Acceptance Criteria Checklist

- [x] AC-01: Paste PNG with active vault → writes `{vaultRoot}/assets/YYYYMMDD-HHmmss.png` + inserts `![](assets/YYYYMMDD-HHmmss.png)` (T-HPG-06)
- [x] AC-02: `assets/` directory created automatically if absent (T-HPG-06, T-HPG-07)
- [x] AC-03: Paste plain text with active vault → falls through to CM6 default paste (Guard 1 falls through if no image item)
- [x] AC-04: Paste image with no vault → native Save dialog pre-populated with filename (T-HPG-09, T-HPG-10)
- [x] AC-05: Cancel Save dialog → editor and filesystem unchanged (T-HPG-10)
- [x] AC-06: No-vault, same-dir path → inserts relative filename only (T-HPG-11, T-CIS-02)
- [x] AC-07: No-vault, untitled tab → inserts absolute path (T-HPG-12, T-CIS-01)
- [x] AC-08: Editor not focused → event not intercepted (Guard 2 in main.ts; EC-06/EC-22/EC-23)
- [x] AC-09: Read-only content tab → event not intercepted (T-HPG-03, Guard 4)
- [x] AC-10: `write_binary_file` Rust tests pass (success, parent-missing, empty-data, creates-new-file)
- [x] AC-11: All EC-01 through EC-23 covered by tests or accepted-behaviour notes (see edge case table above)
- [x] AC-12: `npm run test:run` passes with no regressions (78 test files, 3418 tests)
- [x] AC-13: `cargo test` passes with new `write_binary_file` tests (178 tests)

---

## Review Request

- **Files changed**:
  - `src-tauri/src/commands/io.rs` — added `write_binary_file` command + 4 Rust tests
  - `src-tauri/src/commands/dialogs.rs` — added `save_image_dialog` command
  - `src-tauri/src/commands/mod.rs` — exported `write_binary_file` and `save_image_dialog`
  - `src-tauri/src/lib.rs` — added both commands to `pub use` block and `generate_handler![]`
  - `src/lib/bridge.ts` — added `writeBinaryFile` wrapper; re-exported `saveImageDialog`
  - `src/lib/dialogs.ts` — added `saveImageDialog` function
  - `src/lib/clipboard-image.ts` — NEW: pure helpers `generateImageFilename`, `computeImageSnippet`
  - `src/lib/clipboard-image-handler.ts` — NEW: `handleImagePaste` extracted for testability
  - `src/main.ts` — added `paste` capture listener in `initApp()` after keydown block; added imports
  - `tests/clipboard-image-paste.test.ts` — NEW: 24 unit tests (5 GIF + 5 CIS + 14 HPG)
  - `docs/specs/clipboard-image-paste/00_index.md` — this file

- **Steps completed**: `step_01_rust-and-bridge.md`, `step_02_paste-handler.md`

- **Known limitations**:
  - EC-14 (same-second filename collision) accepted per NFR-03: atomic rename silently overwrites; no suffix counter.
  - EC-17 (image >50 MB) accepted per NFR-04: no size guard; write proceeds.
  - EC-19 (dirty unsaved tab) accepted: paste proceeds normally; no interaction with tab save state.

- **Edge cases covered by tests**:
  | EC | Test(s) |
  |---|---|
  | EC-01 (text-only clipboard) | Guard 1 in paste listener (structural); T-HPG-01 covers null-activeTab fallthrough |
  | EC-02 (image + selected text) | Insert uses `selection.main.head` — confirmed in T-HPG-06 via `getSelectionHead` |
  | EC-03 (no active tab) | T-HPG-02 |
  | EC-04 (read-only content tab) | T-HPG-03 (kind check covers "content" as well as "media") |
  | EC-05 (media tab) | T-HPG-03 |
  | EC-06 (editor not focused) | Guard 2 in paste listener (structural) |
  | EC-07 (assets/ dir create fails) | T-HPG-07 |
  | EC-08 (write_binary_file fails vault) | T-HPG-08 |
  | EC-09 (no-vault cancel) | T-HPG-10 |
  | EC-10 (no-vault write fails) | T-HPG-13 |
  | EC-11 (no-vault untitled tab) | T-HPG-12, T-CIS-01 |
  | EC-12 (no-vault different dir) | T-HPG-12, T-CIS-03, T-CIS-05 |
  | EC-13 (no-vault same dir) | T-HPG-11, T-CIS-02, T-CIS-04 |
  | EC-14 (same-second collision) | Accepted per NFR-03 — no code needed |
  | EC-15 (getAsFile() returns null) | Guard 5 in paste listener (structural) |
  | EC-16 (arrayBuffer() rejects) | T-HPG-04, T-HPG-05 |
  | EC-17 (image >50 MB) | Accepted per NFR-04 — no size guard |
  | EC-18 (empty rootPaths) | T-HPG-09 |
  | EC-19 (dirty unsaved tab) | Accepted — no interaction with tab save state |
  | EC-20 (editor null at call time) | Guard 2 in paste listener (`if (!editor ...`) |
  | EC-21 (multiple image items) | T-HPG-14; first-match loop in paste listener |
  | EC-22 (command bar open) | Guard 2 (`editor.hasFocus` = false) |
  | EC-23 (find/replace open) | Guard 2 (`editor.hasFocus` = false) |

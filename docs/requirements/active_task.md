---
title: Drag & Drop Files to Open
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Drag & Drop Files to Open — Requirements

## Feature Summary

As a user, I want to drag one or more `.md` or `.txt` files from Finder (or any macOS source) onto the Markable window and have them open as tabs, so that I can open files without using File > Open or the file browser.

---

## Codebase Context Findings

These findings are the authoritative result of reading the codebase before requirements were written. They directly shape which files need to change and which do not.

### Finding 1 — The handler is already implemented

`src/main.ts` lines 1106–1116 contain a complete, functional drag-and-drop handler:

```
await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
  if (event.payload.type !== "drop") return;
  const paths = event.payload.paths.filter(
    (p) => p.endsWith(".md") || p.endsWith(".txt")
  );
  if (paths.length === 0) return;
  for (const path of paths) {
    await tabManager.openFileInTab(path);
  }
  await refreshRecentFilesMenu();
});
```

This uses the correct Tauri v2 API (`onDragDropEvent` on the `WebviewWindow` object), the correct event shape (`event.payload.type === "drop"`, `event.payload.paths: string[]`), correct file filtering, and delegates to the existing `tabManager.openFileInTab()` path which handles deduplication, error alerting, and session persistence.

### Finding 2 — No Rust-side changes are needed

`src-tauri/src/lib.rs` has no drag-drop handler and needs none. Tauri v2 emits `DragDropEvent` automatically to the frontend via the WebviewWindow event bus. There is no Rust hook required.

### Finding 3 — No capability permission is needed

`src-tauri/capabilities/default.json` does not list a `drag-drop` permission, and none is required. Tauri v2's drag-drop events are part of the core window event surface and are not gated behind a separate ACL permission.

### Finding 4 — No new Cargo feature flag is needed

`src-tauri/Cargo.toml` lists `tauri = { version = "2", features = ["protocol-asset"] }`. No `drag-drop` feature flag exists in Tauri v2; drag-drop is always enabled.

### Finding 5 — `openFileInTab` handles all downstream concerns

`src/tabs/tab-manager.ts` `openFileInTab(filePath)`:
- Returns `false` if the file is already open (activates the existing tab instead — dedup is built in).
- Calls `readFile()` from `bridge.ts`, which wraps `invoke("read_file")` with a typed error result. On failure it calls `alert()` with the error message.
- Records the file in the recent-files list and saves the session.
- Auto-closes the clean Untitled tab if it was the only other tab.

### Finding 6 — No `dropToOpen` setting exists

`src/lib/settings.ts` has no `dropToOpen` or drag-drop-related setting. None is needed for the initial implementation.

### Finding 7 — The comment in main.ts already references EC-14

The existing handler comment reads: "EC-14: all dropped files open in new tabs; duplicate-path guard inside openFileInTab() prevents the same file from opening twice." This confirms the feature was intentionally implemented but never formally specified.

### Finding 8 — No visual drop-zone highlight is implemented

The existing handler responds only to `type === "drop"`. There is no `type === "enter"` or `type === "over"` handling that would produce a visual overlay. The handler silently accepts files.

---

## Functional Requirements

**FR-1 — Accepted file types**
The handler must open files whose path ends with `.md` or `.txt` (case-sensitive match, consistent with the existing filter). All other extensions are silently ignored; no error dialog is shown.

**FR-2 — Multiple files**
When multiple files are dropped simultaneously, every accepted file (`.md` or `.txt`) must be opened. Each file opens in its own tab. Files are processed in the order they appear in `event.payload.paths`.

**FR-3 — Deduplication**
If a dropped file is already open in any tab, `openFileInTab` activates that tab rather than opening a second copy. This is handled by the existing duplicate-path guard in `tab-manager.ts` and requires no additional logic in the drop handler.

**FR-4 — Recent files refresh**
After all dropped files are processed, the native Open Recent submenu must be refreshed via `refreshRecentFilesMenu()`, matching the behaviour of File > Open.

**FR-5 — Whole-window drop target**
The entire Markable window surface is the drop target. There is no restricted zone. The `onDragDropEvent` listener is registered on the root `WebviewWindow` object, which covers the full window.

**FR-6 — Drop ignored for directories**
If a directory path is included in the drop payload, it must be ignored. Directory paths do not end in `.md` or `.txt`, so the existing extension filter handles this without additional code.

**FR-7 — No visual drop-zone indicator (initial scope)**
The initial implementation does not render a dashed border, overlay, or any visual feedback during the drag-over phase. Silent acceptance is the specified behaviour. Visual feedback is deferred to a future enhancement (see Out of Scope).

**FR-8 — Guard against uninitialized tabManager**
The `onDragDropEvent` listener is registered after `tabManager.init(editor)` completes (line 966 precedes line 1106 in `main.ts`). The ordering constraint must be preserved in any future refactoring. If `tabManager` is not yet initialized when the event fires, the handler must be a no-op rather than throw.

---

## Edge Case Inventory

**EC-01 — Already-open file dropped**
A file whose `filePath` matches an open tab is dropped. Expected: `openFileInTab` returns `false` and activates the existing tab. No duplicate tab is created. No error is shown.

**EC-02 — Non-.md / non-.txt file dropped (e.g. `.pdf`, `.png`, `.docx`)**
The extension filter `p.endsWith(".md") || p.endsWith(".txt")` excludes the path. Expected: the file is silently ignored. No error dialog.

**EC-03 — Directory dropped**
A directory path is included in the payload (e.g. dragging a folder from Finder). Expected: silently ignored by the extension filter. No crash, no error.

**EC-04 — Mix of valid and invalid files dropped together**
Payload contains `/notes/foo.md`, `/images/photo.png`, `/data/report.pdf`. Expected: only `foo.md` opens; the two invalid files are ignored.

**EC-05 — File with spaces in path**
Path is `/Users/dave/My Notes/Meeting Notes April.md`. Expected: Tauri's `onDragDropEvent` provides native OS paths — no URL encoding is applied. `openFileInTab` calls `invoke("read_file", { path })` which handles the raw path correctly on the Rust side.

**EC-06 — File with Unicode characters in path**
Path is `/Users/dave/日本語ノート/レシピ.md`. Expected: Tauri passes the raw UTF-8 path. `read_file` uses Rust's `std::fs::read_to_string` which handles UTF-8 paths. No special handling is needed.

**EC-07 — Drop while Settings panel is open**
The settings panel is a DOM overlay; it does not intercept OS-level drag events. Expected: the drop event fires normally, files open as tabs in the background. The settings panel remains open.

**EC-08 — Drop while Vault / Manage Vaults modal is open**
Same reasoning as EC-07. The modal is a DOM overlay. Expected: files open as tabs; the modal remains open.

**EC-09 — Drop before tabManager is initialized**
Under abnormal startup timing, `onDragDropEvent` could theoretically fire before `tabManager.init()` completes. Expected: the `tabManager` reference exists but the listener is not yet registered (the `await` on line 1106 only resolves after `tabManager.init()` on line 966). This ordering is safe as long as the registration sequence in `initApp()` is not reordered.

**EC-10 — Drop event fires with empty paths array**
`event.payload.paths` is `[]` (e.g. user drags a non-file object). Expected: the `paths.length === 0` guard exits immediately. No error.

**EC-11 — Drop of a `.txt` file that contains binary data**
Tauri's `read_file` calls `fs::read_to_string`, which returns an error on invalid UTF-8. Expected: `openFileInTab` receives `result.ok === false` and calls `alert()` with the error message. Matches existing error-handling behaviour for any unreadable file.

**EC-12 — Drop while window is hidden (Dock-click reopen before file opens)**
The window is hidden (no-close pattern). A file is dropped onto the Markable Dock icon or a visible portion of the window. Expected: on macOS, dragging to the Dock icon triggers `applicationShouldHandleReopen` — this is outside Tauri's drag-drop surface and is not handled by this feature.

**EC-13 — Drop of a `.md` file that no longer exists on disk**
The file appears in Finder but is deleted between drag-start and drop-complete. Expected: `read_file` returns an error; `openFileInTab` shows `alert()`. Matches existing error-handling for stale files.

---

## Non-Functional Requirements

**NFR-1 — No additional Rust code**
The feature is implemented entirely in TypeScript. No new Tauri commands, no new Rust modules, no changes to `lib.rs`.

**NFR-2 — No new capability permissions**
`src-tauri/capabilities/default.json` must not be modified for this feature.

**NFR-3 — No new settings fields**
`MarkableSettings` must not be extended. No user-configurable toggle for drag-drop is required.

**NFR-4 — No visible loading state**
`.md` and `.txt` files are small. No spinner or progress indicator is needed. Files open immediately via the existing `openFileInTab` path.

**NFR-5 — No flicker**
The drop handler must not cause any visible layout reflow or flash. There is no CSS change or DOM manipulation during the drag phase (no visual feedback, per FR-7).

**NFR-6 — Sequential tab opening**
Multiple files must be opened in sequence (`for...of` with `await`) to preserve the order they appear in the payload and to avoid race conditions in `tabManager` state.

---

## Files That Must Change

Given the codebase findings, the implementation state is assessed as follows:

| File | Status | Change Required |
|------|--------|-----------------|
| `src/main.ts` | Implemented (lines 1106–1116) | Validate against this spec; add EC-09 guard if absent |
| `src-tauri/src/lib.rs` | No change needed | None |
| `src-tauri/Cargo.toml` | No change needed | None |
| `src-tauri/capabilities/default.json` | No change needed | None |
| `src/lib/bridge.ts` | No change needed | None |
| `src/tabs/tab-manager.ts` | No change needed | None |
| `src/lib/settings.ts` | No change needed | None |

The primary deliverable is a **test file** that exercises the edge cases above using the existing implementation.

---

## Out of Scope

- **Visual drag-over feedback** (dashed border, translucent overlay, "Drop to open" label) — deferred.
- **`.txt` extension case-insensitivity** (e.g. `.TXT`, `.MD`) — not required; existing filter is case-sensitive.
- **Dock-icon drag target** — macOS `applicationShouldHandleReopen` is outside Tauri's drag-drop API surface.
- **Opening non-Markdown binary files** (images, PDFs) via drag-drop — handled by the existing media tab path (`openMediaTab`), but that is not wired into the drag-drop handler and is not in scope here.
- **Drag-and-drop from within the app** (reordering tabs by drag) — separate feature.
- **A user preference to disable drag-drop** — not required.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 13 items in Edge Case Inventory (EC-01 through EC-13)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.

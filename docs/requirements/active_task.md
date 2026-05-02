---
title: Drag-to-Move Files and Folders in File Browser Tree
last-updated: "2026-04-30"
review-cadence-days: 90
status: archive
---

# Drag-to-Move Files and Folders in File Browser Tree

## Feature Summary

As a user with a vault open in the file browser, I want to drag any file or
folder node onto a directory or vault-root node to move it there, so that I
can reorganise my vault without leaving the editor.

This is the final piece of full CRUD + reorganisation for the file browser
tree, completing the sequence: Create (shipped), Rename + Delete (shipped),
Move (this task).

---

## Codebase Context Findings

### Finding 1 — Drag-and-drop plumbing already exists but has gaps

`attachDragDropListeners` (file-browser.plugin.ts, line 2481) already:
- Marks `file` and `directory` nodes as `draggable="true"`.
- Sets `dragstart` data via `e.dataTransfer.setData("text/plain", path)`.
- Adds `dragend` cleanup that removes `.drag-over` from all nodes.
- Adds `dragover` / `dragleave` / `drop` on `directory` and `vault` nodes.
- `drop` reads the source path, guards against dropping onto itself and
  dropping into a descendant, then calls `moveNode(sourcePath, targetPath, _panelContainer)`.

`moveNode` (file-browser-ops.ts, line 648) already:
- Calls `move_file` Rust command.
- Reloads the vault index.
- Calls `handleFileRename` on the tab manager.
- Shows the link-update banner when the stem changes (always false for moves,
  but the guard exists for future safety).

`move_file` (file_ops.rs, line 173) already:
- Validates source exists.
- Validates destination is a directory.
- Rejects if `destination_dir/filename` already exists (EC-19 guard).
- Returns the new absolute path on success.

**This is therefore a "specify, harden, and complete UX" task, not a
"write from scratch" task.** The primary work is:
1. Handling the "file dropped on a file" case (drop into parent directory).
2. Handling the folder-move case (`moveNode` only calls `handleFileRename`
   for one path; all open tabs under the moved folder need updating).
3. Ensuring drag visual feedback is correct and cleaned up on all paths.
4. Specifying the inline error surface for the no-op and collision cases.

### Finding 2 — File-on-file drop is not handled

The current `drop` handler fires only on `directory` and `vault` nodes
(these are the only nodes that register `dragover`/`drop`). If a user drags
a file and releases it over another file node, nothing happens — no drop is
registered because the file `<li>` is not a drop target. The intended
behaviour (per the feature brief) is to treat a file-on-file drop as a drop
into the target file's parent directory. This requires either:
(a) making file nodes also accept drops and resolving `targetDir` to the
    parent directory in the `drop` handler, or
(b) keeping only directory/vault nodes as drop targets and relying on the
    directory row being visible above the file. Option (a) is specified here
    as it matches the stated intent and common file-browser conventions.

### Finding 3 — Folder move does not update open tabs under moved folder

`moveNode` calls `handleFileRename(sourcePath, newPath)` where `newPath` is
the new absolute path of the moved item. For a **file** move this is correct:
`handleFileRename` updates the single tab whose `filePath === sourcePath`.

For a **folder** move, `sourcePath` is a directory path, not a file path.
`handleFileRename` will find no tab with `filePath === directoryPath` (tabs
store file paths, not directory paths) and silently do nothing. All open tabs
whose paths begin with `sourcePath + "/"` will be left with stale file paths
pointing to the old (now non-existent) location.

`moveNode` must be updated to detect the directory case and iterate all open
tabs, updating each one whose path starts with the moved directory's path —
the same prefix-substitution pattern used by `renameNode` for directory
renames (file-browser-ops.ts, lines 393–406).

### Finding 4 — `dragover` removes `.drag-over` class only on `dragleave`, not across siblings

When the user drags from one drop target to another, `dragleave` fires on the
first target and removes `.drag-over`. Then `dragover` fires on the new target
and adds `.drag-over` there. This sequencing is correct. However, the `dragend`
cleanup in the drag source is the safety net — it removes `.drag-over` from all
nodes in case the drag is abandoned outside any target. The existing
implementation already does this correctly.

### Finding 5 — No visual feedback while dragging a node (drag ghost / opacity)

The HTML5 drag API provides a default drag ghost (a semi-transparent copy of
the element). The browser default is sufficient for this application. A custom
`setDragImage` call is not required.

A subtle improvement: setting `opacity: 0.5` on the dragged element during a
drag (`.is-dragging` CSS class on `dragstart`, removed on `dragend`) gives
the user a clear signal of which node is in flight. This is low-risk and
purely additive CSS.

### Finding 6 — `move_file` Rust command only handles files, not directories

`move_file` in `file_ops.rs` validates `src.exists()` but does NOT check
whether the source is a file or directory. `std::fs::rename` works for both
files and directories on macOS/POSIX, so the command works for directory
moves without any code change. The function name `move_file` is a misnomer
but the implementation is correct. No Rust changes are needed.

### Finding 7 — No-op case: dropped on own parent directory

The current `drop` handler guards `sourcePath === path` (prevents dropping a
node onto itself — the case where a directory is dropped on itself). However
it does NOT guard the case where a file is dropped on its own parent directory:
`path === getParentDir(sourcePath)`. In this case `move_file` would try to
rename `file.md` to `parentDir/file.md` (same as the current path), causing
`rename_file` to return `Err("Destination already exists")`. This should be
caught before the Rust call and treated as a silent no-op.

### Finding 8 — CSS `.drag-over` class already defined

The CSS rule `.drag-over { background: var(--drag-target-bg, rgba(92,107,192,.1)); outline: 1px dashed var(--accent-color); }` is already in `FILE_BROWSER_CSS` (line 346–349). No new CSS rules are needed for drop-target highlighting.

### Finding 9 — Cycle-prevention guard already exists

The current `drop` handler includes `if (path.startsWith(sourcePath + "/")) return;`
which prevents dragging a folder into its own descendant. This guard is
complete and correct.

### Finding 10 — `moveNode` currently only shows link-update banner when stem changes

For a file named `note.md` moved from `/vault/A/note.md` to `/vault/B/note.md`,
the stem (`note`) does not change so `oldStem !== newStem` is false and the
banner is suppressed (AD-01 guard). This is correct behaviour: moving a file
does not change wiki-link paths because Markable wiki-links are stem-based, not
path-based. No change needed here.

### Finding 11 — Existing test file exists for this feature

`tests/plugins/backlinks/create-note-from-broken-wikilink.test.ts` and
`docs/specs/create-note-from-broken-wikilink/` exist but are unrelated to this
feature. A new test file at
`tests/plugins/file-browser/drag-to-move.test.ts` should be created for this
feature (TDD in the Lead Developer phase).

---

## Functional Requirements

### FR-1 — Drag source: files and directories are draggable; vault root is not

Every `<li>` node with `data-type="file"` or `data-type="directory"` must have
`draggable="true"` set and `dragstart` / `dragend` event handlers attached.

Vault root nodes (`data-type="vault"`) must NOT be draggable. They must NOT
receive `draggable="true"`.

### FR-2 — Drag source: `dragstart` stores source path and type

On `dragstart`:
- Call `e.dataTransfer.setData("text/x-markable-path", sourcePath)`.
- Call `e.dataTransfer.setData("text/x-markable-type", nodeType)` where
  `nodeType` is `"file"` or `"directory"`.
- Add a CSS class `.is-dragging` to the dragged `<li>` so it can be dimmed
  via CSS while in flight.
- Call `e.stopPropagation()` to prevent the drag event from bubbling to a
  parent drop target and triggering an unintended move.

Note: the current implementation uses `"text/plain"`. Switching to a
namespaced MIME type (`"text/x-markable-path"`) prevents accidental drops
from browser tabs or OS file manager events being interpreted as tree moves.

### FR-3 — Drag source: `dragend` cleanup

On `dragend` (fires regardless of whether the drop was accepted):
- Remove `.is-dragging` from the dragged element.
- Remove `.drag-over` from all `.tree-node` elements in `_treeEl`.

### FR-4 — Drop targets: directories and vault root accept drops

Every `<li>` node with `data-type="directory"` or `data-type="vault"` must
register `dragover`, `dragleave`, and `drop` event handlers.

File nodes (`data-type="file"`) must ALSO register `dragover`, `dragleave`,
and `drop` handlers (see FR-5 for file-on-file resolution).

### FR-5 — File-on-file drop: resolve to parent directory

When a `drop` event fires on a `<li data-type="file">`, resolve the target
directory as `getParentDir(targetFilePath)` and proceed with the move as if
the user had dropped onto that directory node.

### FR-6 — Visual feedback: `.drag-over` highlight on valid drop targets

On `dragover`:
- Call `e.preventDefault()` to signal a valid drop target to the browser.
- Add `.drag-over` class to the target `<li>`.

On `dragleave`:
- Remove `.drag-over` from the target `<li>`.

No additional visual feedback is required.

### FR-7 — Drop handler: no-op cases

On `drop`, before calling `moveNode`, check for the following conditions and
return silently (no Rust call, no error message):

1. **Source path is empty or not set**: `e.dataTransfer.getData("text/x-markable-path")` returns empty string.
2. **Dropped on self**: `targetDir === sourcePath` (directory dropped on
   itself) or `targetDir === getParentDir(sourcePath)` (dropped on own
   parent directory — resolves to same location).
3. **Descendant cycle**: `targetDir.startsWith(sourcePath + "/")` (dragging a
   folder into one of its own descendants). Already implemented.

### FR-8 — Drop handler: collision error

If `moveNode` rejects because `move_file` returns an error containing "already
exists", surface the error as an inline error strip via `showInlineError(_panelContainer, ...)`.

This is already implemented in the current `moveNode` catch block. Verify
the error string from the Rust command is user-readable.

### FR-9 — Drop handler: general error

If `moveNode` rejects for any other reason (e.g. source not found, permission
error), surface the error via `showInlineError`.

Already implemented. Verify.

### FR-10 — Drop handler: move a file

When the source type is `"file"`:
1. Compute `targetDir` (either the directory node's path, or the parent of
   the target file node for file-on-file drops).
2. Apply no-op guards (FR-7).
3. Call `moveNode(sourcePath, targetDir, _panelContainer)`.
4. `moveNode` internally: calls `move_file`, calls `reloadVaultIndex`, calls
   `handleFileRename(oldPath, newPath)`.
5. After success: vault index reload triggers `onVaultChanged → renderPanel`.
   The moved file appears in its new location in the tree.

### FR-11 — Drop handler: move a directory

When the source type is `"directory"`:
1. Compute `targetDir` (the directory or vault-root node's path; file-on-file
   is not possible for directory sources since files cannot be the source of
   a file-on-directory resolution here — directory sources always land on
   explicit directory or vault targets, or on a file target that resolves to
   its parent).
2. Apply no-op guards (FR-7), including the descendant-cycle guard.
3. Call `moveNode(sourcePath, targetDir, _panelContainer)`.

`moveNode` must be updated to handle the directory case:
- After `move_file` returns `newPath` (the new absolute path of the directory):
  - Reload vault index (already done).
  - Iterate all open tabs via `__MARKABLE_TAB_MANAGER__.getTabs()`.
  - For each tab whose `filePath` starts with `sourcePath + "/"`, compute
    `newTabPath = newPath + "/" + tab.filePath.slice((sourcePath + "/").length)`
    and call `handleFileRename(tab.filePath, newTabPath)`.
  - The existing single `handleFileRename(sourcePath, newPath)` call must be
    replaced or supplemented with this prefix-substitution loop.

### FR-12 — Drop: always clean up drag-over highlight

On every `drop` event (success, no-op, or error), remove `.drag-over` from
the target element before returning. Also remove `.is-dragging` from the
source (in `dragend`).

### FR-13 — Post-move tree update: automatic via vault index reload

`reloadVaultIndex()` fires `onVaultChanged → renderPanel`. The tree redraws
with the moved item in its new location automatically. No manual DOM patching
is needed.

---

## Non-Functional Requirements

**NFR-1 — No new Rust commands**
`move_file` handles both files and directories. No new Cargo changes.

**NFR-2 — MIME type for drag data**
Use `"text/x-markable-path"` and `"text/x-markable-type"` as the
`dataTransfer` keys. This prevents false positives from external drag sources
(browser link drags, OS file manager drops). External drops that do not set
these keys are silently ignored.

**NFR-3 — IIFE plugin boundary compliance**
All Tauri calls use `window.__TAURI_INTERNALS__.invoke(...)`. No ES module
imports from `bridge.ts` at runtime.

**NFR-4 — Single drag only**
Multi-select drag is out of scope. Each drag operation moves exactly one node.

**NFR-5 — Cross-vault drag not supported**
The vault root is the boundary. A drag that originates inside one vault root
and is dropped outside its tree is a no-op (browser default — the drop lands
outside the `file-tree` DOM element, no `drop` event fires on any tree node).

**NFR-6 — Plugin build step after source changes**
After any change to `src/plugins/file-browser/`:
`npm run build:plugins && npm run sync:plugins`.

**NFR-7 — No TODO comments in source**
Deferred work is logged in `docs/specs/file-browser/00_index.md`.

**NFR-8 — Window size invariant**
No changes to `src-tauri/src/lib.rs` or `src/lib/settings.ts`. Invariant unaffected.

---

## Files That Must Change

| File | Change |
|------|--------|
| `src/plugins/file-browser/file-browser.plugin.ts` | Update `attachDragDropListeners`: switch to namespaced MIME type, add `.is-dragging` class, make file nodes valid drop targets (file-on-file resolution to parent dir), add source-type to dataTransfer |
| `src/plugins/file-browser/file-browser-ops.ts` | Update `moveNode`: add directory-move prefix substitution for open tabs (iterate `getTabs()`, call `handleFileRename` per affected tab) |

### Files that must NOT change

| File | Reason |
|------|--------|
| `src-tauri/src/commands/file_ops.rs` | `move_file` handles both files and directories correctly |
| `src/tabs/tab-manager.ts` | `handleFileRename` and `getTabs` already exist from the previous Rename task |
| `src/lib/bridge.ts` | No new bridge wrappers required |
| `src-tauri/src/lib.rs` | Window size invariant |
| `src/lib/settings.ts` | Window size invariant |

---

## Out of Scope

- **Multi-file drag**: single drag only; no multi-select support.
- **Cross-vault drag**: the vault root is the hard boundary; no inter-vault moves.
- **"Move to…" context menu item**: the disabled "Move to…" item in the context
  menu is a future folder-picker UI. Not unlocked in this iteration.
- **Drag-and-drop from OS Finder into the tree**: external drops are ignored.
- **Undo of move**: disk operations are permanent.
- **Drag to re-order within a directory**: the tree is always sorted by name;
  custom ordering is not a supported concept.

---

## Edge Case Inventory

**EC-1 — Drag source is vault root**
Vault root nodes are not draggable (`draggable` attribute is never set on them).
`dragstart` never fires. No action possible.

**EC-2 — Drop target is a file node (file-on-file)**
`drop` fires on the file node. `targetDir` is resolved via `getParentDir(targetFilePath)`.
Move proceeds as if the user dropped onto the parent directory. If the file is
in the vault root, `targetDir` is the vault root path (a valid directory).

**EC-3 — Node dropped onto its own parent directory (no-op)**
`targetDir === getParentDir(sourcePath)`. Guard in `drop` handler detects this
and returns silently. No Rust call, no error shown.

**EC-4 — Node dropped on itself (directory dropped on its own `<li>`)**
`targetDir === sourcePath` (if a directory is both source and target). Guard
catches this. No Rust call.

**EC-5 — Folder dragged into a descendant (cycle prevention)**
`targetDir.startsWith(sourcePath + "/")`. Guard catches this and returns
silently. No Rust call.

**EC-6 — Destination already contains a file/folder with the same name (collision)**
`move_file` returns `Err("File 'X' already exists in 'Y'")`. `moveNode` rejects.
The catch block calls `showInlineError(_panelContainer, "Move failed: …")`.
The source file/folder is untouched.

**EC-7 — Source file no longer exists at drag time (stale drag)**
`move_file` returns `Err("Source not found: …")`. Same error surface as EC-6.

**EC-8 — Moving a directory that has open tabs inside it**
After `move_file` succeeds, `moveNode` iterates `getTabs()` and calls
`handleFileRename` for each affected tab. All open tabs under the moved
directory receive updated `filePath` values. Unsaved changes in those tabs
are preserved (the in-memory editor state is unaffected; the path update
ensures the next Cmd-S writes to the correct new location).

**EC-9 — Moving a directory that has NO open tabs inside it**
`getTabs()` iteration finds no matching tabs. No `handleFileRename` calls.
Vault index reload triggers re-render. Normal path.

**EC-10 — Moving a file that is currently open in the active tab**
`handleFileRename(oldPath, newPath)` updates the tab's `filePath` and title.
The editor content is unchanged. The next Cmd-S writes to the new path.

**EC-11 — Moving a file that is open in a background (non-active) tab**
Same as EC-10. `handleFileRename` updates all matching tabs, not just the
active one.

**EC-12 — Moving a `.md` file changes its stem (not possible in a simple move)**
`move_file` preserves the filename — only the parent directory changes. The
stem is always identical before and after a move. `oldStem !== newStem` is
always false. The link-update banner is correctly suppressed (AD-01 guard).

**EC-13 — Drag abandoned mid-air (user releases outside any drop target)**
`drop` never fires. `dragend` fires on the source node. Cleanup: remove
`.is-dragging` from the source, remove `.drag-over` from all nodes. No move
occurs.

**EC-14 — Drag abandoned over a non-tree element (e.g. the editor area)**
`dragend` fires on the source node (same as EC-13). The editor area does not
register `dragover` with `preventDefault()`, so it does not accept the drop.
Cleanup is correct.

**EC-15 — Rapid drag followed by immediate second drag before `reloadVaultIndex` completes**
The vault index reload is async. The tree may re-render mid-second-drag. The
second drag's `dragstart` captures the source path at that moment. If the
first move has not yet been reflected in the DOM, the source node may still
appear at its old location. Accepting this as a low-frequency edge case with
no user-visible harm: the second drag will use the correct on-disk path because
`data-path` attributes are set from the vault index at render time.

**EC-16 — `_panelContainer` is null when `drop` fires**
`moveNode` accepts a nullable container for the banner. `showInlineError` is
called from the catch block only if `_panelContainer` is non-null. If null,
the error is logged to the console only. This matches the existing pattern.

**EC-17 — Drop fires from an external source (OS Finder, browser link drag)**
The `drop` handler reads `e.dataTransfer.getData("text/x-markable-path")`. An
external drag source will not have set this key. The value will be an empty
string. The empty-string guard in FR-7 causes an immediate silent return. No
move is attempted.

**EC-18 — Vault index reload fails after a successful move**
The disk operation has already completed. `reloadVaultIndex()` rejects. The
tree may be stale until the next FS watcher event (fires within 300 ms via the
existing `handleFsEvent` debounce). Error is caught and logged. No user-facing
crash.

**EC-19 — `move_file` destination directory does not exist**
`move_file` validates `dst_dir.is_dir()` and returns `Err("Destination is not
a directory: …")`. This cannot occur in normal usage because drop targets are
always rendered from the vault index (which only includes existing directories).
It can occur if the user has deleted a directory via the OS while a drag is in
progress. The error surfaces via `showInlineError`.

**EC-20 — Moving a folder into the vault root**
`targetDir` is the vault root path (the `data-type="vault"` node's `data-path`).
`move_file` moves the folder into the vault root. This is valid and no special
case is needed. The descendant-cycle guard does not fire because the vault root
is not inside the moved folder.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 20 items in Edge Case Inventory (EC-1 through EC-20)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.

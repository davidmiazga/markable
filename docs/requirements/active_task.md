---
title: Rename and Delete File/Folder from File Browser Tree
last-updated: "2026-04-30"
review-cadence-days: 90
status: archive
---

# Rename and Delete File/Folder from File Browser Tree

## Feature Summary

As a user with a vault open in the file browser, I want to rename and delete
files and folders directly from the tree panel — via double-click or right-click
on any node — so that I can maintain and reorganise my vault without leaving the
editor.

This feature completes the full CRUD surface for the file browser tree.
Create (files and folders) was shipped in the previous task. This task adds
Rename and Delete.

---

## Codebase Context Findings

### Finding 1 — Rename and Delete UI entry points already exist; the ops layer is partially wired

`buildFileContextMenuItems` already contains "Rename" and "Delete" items.
`buildDirContextMenuItems` also contains both. `startInlineRename` is
implemented in `file-browser.plugin.ts`. `renameNode`, `deleteFile`, and
`deleteDirectory` are implemented in `file-browser-ops.ts`. The F2 keyboard
shortcut fires `startInlineRename` for file and directory nodes. The Delete key
calls `deleteFile` for file nodes.

**This is therefore not a "write from scratch" task — it is a "verify, complete,
and fix gaps" task.** The core logic exists; the gaps are in the tab manager
integration and several edge cases documented below.

### Finding 2 — Critical gap: tab manager does not expose `renameFile` or `closeFile`

`file-browser-ops.ts` calls:
- `__MARKABLE_TAB_MANAGER__?.renameFile?.(oldPath, newPath)` (line 330)
- `__MARKABLE_TAB_MANAGER__?.closeFile?.(path)` (line 392)

The tab manager (`src/tabs/tab-manager.ts`) is the full `TabManager` class
instance. It has NO `renameFile` method and NO `closeFile` method. Both calls
silently fail because optional chaining swallows the miss.

The tab manager's actual public API relevant here:
- `closeTab(id: string): Promise<void>` — closes by tab ID, not file path
- `openFileInTab(filePath: string): Promise<boolean>` — open by path
- `getTabs(): TabEntry[]` — returns a shallow copy of all open tabs
- `getActiveFilePath(): string | null`

To close a tab by file path, the plugin must look up the tab ID first:
`getTabs().find(t => t.filePath === path)?.id`, then call `closeTab(id)`.

To "rename" an open tab (update its title and path reference after a file
rename), there is also NO method on the tab manager. The tab manager must
either:
(a) expose a new `handleFileRename(oldPath, newPath)` method, or
(b) the plugin re-opens the file in a new tab after rename (awkward), or
(c) the plugin patches tab state via an escape hatch.

**Resolution required (see Unknowns).** The Architect must either add
`handleFileRename(oldPath: string, newPath: string): void` and
`closeFileByPath(path: string): Promise<void>` to `TabManager`, or document
an alternative pattern. The plugin already has the call sites reserved; the
tab manager side needs to be built.

### Finding 3 — `renameNode` in `file-browser-ops.ts` hardcodes `.md` extension logic

`renameNode` (line 299–338) determines whether the node is a file by checking
`oldPath.endsWith(".md")`. It then always constructs `newFileName = stem + ".md"`
for files. This means:
- Non-`.md` files in the vault (e.g. `.txt`, `.yaml`) cannot be renamed via the
  tree because their extension will be overwritten with `.md`.
- The inline rename input prefills only the stem (without extension) for `.md`
  files, which is the correct UX. For non-`.md` files, `getFileStem` strips the
  last `.`-delimited component, which is also correct. The extension reconstruction
  needs to use the original extension, not hardcode `.md`.

### Finding 4 — `startInlineRename` also hardcodes `.md` detection

`startInlineRename` (line 2243) determines `isFile = path.endsWith(".md")` and
uses `getFileStem` for `.md` files and `getBasename` for directories. For a
non-`.md` file (e.g. `config.yaml`), `isFile` is false and `getBasename` returns
`config.yaml` — the full name including extension is pre-filled in the input,
which is acceptable. The issue is in `renameNode`'s reconstruction (Finding 3).

### Finding 5 — `deleteDirectory` does not check for unsaved changes before closing tabs

`closeTabsUnder(dirPath)` (line 432–446) iterates `vaultIndex.entries` and calls
`tm.closeFile(entry.path)` per file. Because `closeFile` does not exist on the
tab manager, NO tabs are closed before the directory is deleted. If the user has
unsaved changes in a file inside the deleted folder, those changes are silently
lost when the tab next tries to save (the file no longer exists).

The correct implementation must use the existing `getTabs()` + `closeTab(id)`
pattern, and `closeTab` already handles the unsaved-changes confirmation dialog
internally.

### Finding 6 — `deleteFile` calls `tm.closeFile(path)` which does not exist

Same root cause as Finding 5. The tab for the deleted file is never closed.
After deletion, the tab still appears open and shows the last in-memory content.
If the user presses Cmd-S, `writeFile` will error because the path no longer
exists.

### Finding 7 — Double-click on file/directory nodes does not trigger rename

`attachNodeListeners` (line 1647) wires double-click (`dblclick`) only for
`vault` type nodes via `attachVaultDblClickListener`. File and directory nodes
have no `dblclick` listener. The feature brief states double-click should trigger
inline rename for files and directories. This listener must be added.

### Finding 8 — Delete keyboard shortcut only wired for files, not directories

The `keydown` handler in `attachNodeListeners` (line 1658) fires `deleteFile`
when `e.key === "Delete"` and `type === "file"`. There is no Delete key handler
for `type === "directory"`. Per the feature brief, directories should also be
deletable via keyboard (Delete key).

### Finding 9 — `reloadAndRender` call after delete is redundant / incorrect

`deleteFile(path).then(() => reloadAndRender(vaultId))` — `deleteFile` already
calls `reloadVaultIndex()` internally, which triggers `onVaultChanged` →
`renderPanel`. The additional `reloadAndRender(vaultId)` call after the Promise
resolves causes a second redundant reload. Similarly for `deleteDirectory`. This
is not a blocking bug but wastes a round-trip and should be cleaned up.

### Finding 10 — Rust commands are all present and correct

`rename_file(old_path, new_path)`, `delete_file(path)`, `delete_directory(path)`
all exist in `src-tauri/src/commands/file_ops.rs` and are fully tested. No new
Rust commands are needed.

### Finding 11 — `renameNode` uses `rename_file` for both files and directories

The Rust `rename_file` command (line 108 of `file_ops.rs`) delegates to
`std::fs::rename`, which works on both files and directories on macOS/POSIX. The
current `renameNode` implementation always calls `rename_file` regardless of node
type. This is correct and no change is needed on the Rust side.

### Finding 12 — Backlink banner is already wired in `renameNode` for `.md` files

`checkAndShowLinkBanner` is called inside `renameNode` when `isFile && oldStem !== stem`.
This covers the main rename path. The banner infrastructure in `file-browser-ops.ts`
is complete and correct.

---

## Functional Requirements

### FR-1 — Rename: trigger via double-click on file or directory node

Double-clicking a file or directory `<li>` must activate the inline rename input
for that node. The dblclick listener must be added to `attachNodeListeners` for
nodes where `data-type === "file"` or `data-type === "directory"`. The handler
calls `startInlineRename(el, path, vaultId)`.

Single-click remains the activate/toggle-expand action and must not be affected.

### FR-2 — Rename: trigger via right-click "Rename" menu item

"Rename" already exists in `buildFileContextMenuItems` and `buildDirContextMenuItems`
and calls `startInlineRename`. No change needed for the menu entry itself.

### FR-3 — Rename: trigger via F2 keyboard shortcut

F2 already fires `startInlineRename` for file and directory nodes in
`attachNodeListeners`. No change needed.

### FR-4 — Rename: inline input behaviour

`startInlineRename` replaces the `.tree-node-label` span with a focused
`<input class="tree-node-rename-input">` pre-filled with:
- For `.md` files: the filename stem (no `.md` extension).
- For non-`.md` files: the full basename including extension (so the user sees
  `config.yaml`, not `config`).
- For directories: the directory name.

The input selects all text on focus so the user can immediately type a replacement.

Real-time validation on `input` events: calls `validateFilename` on the trimmed
value and writes the error to the inline error span. Validation is applied to
the stem (no extension) for files; the full name for directories.

Enter commits. Escape or blur (100 ms deferred) cancels, restoring the original
label element.

### FR-5 — Rename commit for files

When the user presses Enter in the file rename input:

1. Trim the input value.
2. If empty or unchanged from `currentStem`, cancel (no-op rename).
3. Run `validateFilename` on the stem. If invalid, show error, stay open.
4. Determine the new filename:
   - For `.md` files: `newStem + ".md"` always (user edits only the stem).
   - For non-`.md` files: preserve the original extension. The input shows
     `originalBasename`; the user may edit the full name. Use the trimmed value
     as-is (no extension manipulation). Validate the trimmed name as a whole via
     `validateFilename`.
5. Check `filenameExistsInDir(parentDir, newFilename)`. If exists, show inline
   error "'name' already exists in this folder." Stay open.
6. Call `invoke("rename_file", { oldPath, newPath })`. If Rust returns an error,
   show it inline. Stay open.
7. On success:
   a. Call `__MARKABLE_VAULT_MANAGER__.reloadVaultIndex()` (triggers re-render).
   b. Call `__MARKABLE_TAB_MANAGER__.handleFileRename(oldPath, newPath)` to
      update any open tab's `filePath` and title to reflect the new path.
   c. If the file is `.md` and `oldStem !== newStem`, call
      `checkAndShowLinkBanner(container, oldStem, newStem)`.

### FR-6 — Rename commit for directories

When the user presses Enter in the directory rename input:

1. Trim the input value.
2. If empty or unchanged from the current directory name, cancel.
3. Run `validateFilename`. If invalid, show error, stay open.
4. Check `filenameExistsInDir(parentDir, newDirName)`. If exists, show inline
   error. Stay open.
5. Call `invoke("rename_file", { oldPath, newPath })` (Rust `rename_file` works
   for directories). If Rust returns an error, show inline. Stay open.
6. On success:
   a. Call `__MARKABLE_VAULT_MANAGER__.reloadVaultIndex()`.
   b. For each open tab whose `filePath` starts with `oldPath + "/"`, call
      `__MARKABLE_TAB_MANAGER__.handleFileRename(oldTabPath, newTabPath)` where
      `newTabPath` replaces the `oldPath` prefix with `newPath`.
   c. No backlink banner for directory renames (directory names are not wiki-link
      targets; only file stems matter).

### FR-7 — Delete: trigger via right-click "Delete" menu item

"Delete" exists in `buildFileContextMenuItems` and `buildDirContextMenuItems`.
These handlers must be updated to use the corrected `deleteFile` /
`deleteDirectory` implementations (see FR-9, FR-10).

### FR-8 — Delete: trigger via Delete keyboard shortcut

The Delete key shortcut must fire for both file and directory nodes. Currently
it only fires for `type === "file"`. Add `|| type === "directory"` to the
condition in `attachNodeListeners`. For directories, call `deleteDirectory(path)`
(already imported).

### FR-9 — Delete file behaviour

`deleteFile(path)` must:

1. Show a native confirmation: `window.confirm('Delete "${basename}"? This cannot be undone.')`.
   If the user cancels, return immediately without any side effects.
2. Find any open tab whose `filePath === path` using `getTabs().find(...)`.
3. If found, close it via `closeTab(tab.id)`. `closeTab` handles its own
   unsaved-changes prompt internally. If the user declines the unsaved-changes
   prompt in `closeTab`, the delete should be aborted (not proceed after the
   tab close is rejected). This requires awaiting `closeTab` and checking whether
   the tab was actually closed.
4. Call `invoke("delete_file", { path })`.
5. Call `__MARKABLE_VAULT_MANAGER__.reloadVaultIndex()`.
6. Do NOT call `reloadAndRender(vaultId)` separately (redundant — vault index
   reload triggers re-render via `onVaultChanged`).

### FR-10 — Delete directory behaviour

`deleteDirectory(path)` must:

1. Show a native confirmation: `window.confirm('Delete folder "${dirName}" and all its contents? This cannot be undone.')`.
   If the user cancels, return immediately.
2. Find all open tabs whose `filePath` starts with `path + "/"` using `getTabs()`.
3. For each such tab, call `closeTab(tab.id)`. If the user declines the
   unsaved-changes prompt for any tab, abort the delete entirely (do not proceed).
   Collect all tabs to close before closing any, to avoid mutating the list
   mid-iteration.
4. Call `invoke("delete_directory", { path })`.
5. Call `__MARKABLE_VAULT_MANAGER__.reloadVaultIndex()`.
6. Do NOT call `reloadAndRender(vaultId)` separately.

### FR-11 — Tab manager: add `handleFileRename(oldPath, newPath)` method

A new method must be added to `TabManager`:

```
handleFileRename(oldPath: string, newPath: string): void
```

Behaviour:
- Find the tab(s) with `filePath === oldPath`.
- Update each matching tab's `filePath` to `newPath`.
- Update each matching tab's `title` to the new basename (using `_titleFromPath`
  or equivalent).
- If the updated tab is the currently active tab, update the window title (if
  applicable) and re-apply live-preview file path via `setLivePreviewFilePath(newPath)`.
- Call `_notifyRenderer()` so the tab bar redraws with the new title.
- Call `saveSession()` (async, void, fire-and-forget) to persist the new path.

This method should be exposed on `window.__MARKABLE_TAB_MANAGER__` automatically
(the tab manager instance is exposed as-is).

### FR-12 — Tab manager: add `closeFileByPath(path)` method (alternative to `closeFile`)

A new method must be added to `TabManager`:

```
async closeFileByPath(path: string): Promise<boolean>
```

Behaviour:
- Find the tab with `filePath === path`.
- If not found, return `true` (nothing to close, delete can proceed).
- Call `closeTab(tab.id)`.
- After `closeTab` resolves, check whether the tab still exists in `getTabs()`.
  If it still exists (user cancelled the unsaved-changes prompt), return `false`
  (delete should be aborted).
- If the tab is gone, return `true` (delete can proceed).

This method replaces the missing `closeFile` call site in `file-browser-ops.ts`.
`deleteFile` and `deleteDirectory` must use `closeFileByPath` (or the
`getTabs`/`closeTab` inline pattern) instead of the currently broken `closeFile`
optional chain.

### FR-13 — Confirmation dialog: use `window.confirm` (native)

Both delete operations use the native browser `window.confirm()` dialog. Do NOT
use the Tauri `plugin:dialog|confirm` command for file delete. The `window.confirm`
pattern is consistent with the existing implementation in `deleteFile` and
`deleteDirectory` (already coded; preserve this).

### FR-14 — Post-rename tree update: automatic via vault index reload

After a successful rename, `reloadVaultIndex()` triggers `onVaultChanged` →
`renderPanel`. The tree redraws automatically. No manual DOM patching is needed.

### FR-15 — Post-delete tree update: automatic via vault index reload

Same as FR-14. After delete, `reloadVaultIndex()` triggers the re-render. No
manual DOM patching.

### FR-16 — Backlink banner on file rename

When a `.md` file is renamed and the old stem differs from the new stem, check
the vault index for files containing `[[oldStem]]`. If any are found, show the
link-update banner. This is already implemented in `checkAndShowLinkBanner`; the
requirement is to ensure it remains wired after the tab manager fix in FR-5.

### FR-17 — Non-`.md` file rename: no backlink banner

Files with extensions other than `.md` are not wiki-link targets. No backlink
banner is shown when a non-`.md` file is renamed.

---

## Tab Manager API Gap — Open Questions Resolved

The following design decisions resolve the unknowns identified in Finding 2:

**Q: Should `handleFileRename` and `closeFileByPath` be added to `TabManager`,
or should the plugin work around via `getTabs`/`closeTab` directly?**

Decision: Add both methods to `TabManager`. Rationale: the operations are
tab-manager concerns (they mutate tab state), and exposing them as named methods
keeps the plugin's code readable and makes the contract explicit. The plugin
calls them via the `__MARKABLE_TAB_MANAGER__` global with optional chaining as
before, so no import boundary is crossed.

**Q: What if `closeTab` is declined (unsaved changes)?**

Decision: If the user declines closing a dirty tab, the delete is aborted
entirely. This is the safe default — a partial delete (some tabs closed, some
not, then the directory is deleted) would leave the editor in an inconsistent
state. `closeFileByPath` returns `false` to signal abort.

**Q: Should double-click on a file node open a rename input or open the file?**

Decision: Single-click opens a file (existing behaviour). Double-click triggers
rename. This matches VS Code and Obsidian conventions. A 200 ms timer or click
count check is not needed because the single-click "open" and the double-click
"rename" are distinct event types — `dblclick` fires independently of `click`
and does not require cancelling the prior single-click's open action (the file
will open on single-click, then the rename input replaces the label; on Escape
the file remains open in its tab).

---

## Edge Case Inventory

**EC-1 — Rename to same name (no-op)**
User opens rename input and presses Enter without changing the text, or types
the same stem. `commit()` detects `newName === currentStem` and calls `cancel()`
instead. No Rust call is made, no vault reload, no banner.

**EC-2 — Rename collision: file already exists with the new name**
`filenameExistsInDir` returns true, or `rename_file` returns `Err("Destination
already exists")`. The inline error "'name' already exists in this folder." is
shown. The input stays open. The original file is untouched.

**EC-3 — Rename: illegal characters in new name**
`validateFilename` catches `:` or `/` or dot-only names. Error shown inline.
Input stays open.

**EC-4 — Rename: empty input committed**
`newName.trim()` is empty. `commit()` calls `cancel()`. No Rust call.

**EC-5 — Rename: Escape or blur cancels**
`cancel()` restores the original `.tree-node-label` span and removes the error
span. If the user blurred by clicking elsewhere, the 100 ms deferred cancel
fires only if the input is still in the DOM (guard against Enter having already
committed and removed the input).

**EC-6 — Rename: open tab for the renamed file has unsaved changes**
`handleFileRename` updates the tab's `filePath` and `title` in memory. The
dirty state (`isDirty`) is preserved. When the user next saves (Cmd-S), the
write goes to the new path. This is correct behaviour — the in-memory content
is the canonical state for a dirty tab.

**EC-7 — Rename directory: open tabs inside the renamed directory**
All open tabs whose paths start with `oldPath + "/"` must have their `filePath`
updated to use `newPath` as the prefix. `handleFileRename` must be called once
per affected tab. Missing this update would leave tabs with stale paths — saving
would write to the old (now non-existent) path.

**EC-8 — Rename directory: no open tabs inside**
`handleFileRename` finds no matching tabs. No-op on the tab manager. Re-render
fires via vault index reload. Normal path.

**EC-9 — Delete file: tab has unsaved changes**
`closeTab(id)` shows the unsaved-changes confirm dialog. If the user clicks
"Don't Save" or "Save", `closeTab` completes and `closeFileByPath` returns `true`.
If the user clicks "Cancel", the tab remains open and `closeFileByPath` returns
`false`. The delete is aborted.

**EC-10 — Delete directory: one of the open tabs inside has unsaved changes**
Same as EC-9, but for each tab inside the directory. If ANY tab's close is
declined, the entire delete is aborted. No tabs are closed that were already
closed before the abort decision. The implementation must collect all tab IDs
before closing any.

**EC-11 — Delete: file or directory not found on disk**
The Rust command returns `Err("Not found: …")`. The confirmation dialog has
already fired. The error is surfaced via `showInlineError` in the panel
container. The vault index is reloaded to sync state.

**EC-12 — Delete: Rust `delete_directory` returns error for non-empty directory**
The current Rust implementation uses `remove_dir_all` which deletes recursively
regardless of contents. The Rust command will not return an error for non-empty
directories. The confirmation dialog text already warns "and all its contents".
No additional check needed.

**EC-13 — Rename fired while another rename input is open**
If `startInlineRename` is called on a node while a rename input is already open
on a different node, two inputs coexist. This is a low-probability race (context
menu closes before another can open). It is acceptable behaviour — each input
operates independently.

**EC-14 — Rename fired on a node whose `data-path` attribute is empty or missing**
The `path` argument would be an empty string. `getFileStem("")` returns `""`.
`validateFilename("")` returns "Name must not be empty." This blocks commit.
The input can be dismissed with Escape.

**EC-15 — Double-click on vault root node**
`attachVaultDblClickListener` already handles vault nodes — the new dblclick
handler for file/directory nodes must NOT fire for vault nodes. The guard
`data-type === "file" || data-type === "directory"` already excludes vault.

**EC-16 — Delete keyboard shortcut (Delete key) on directory**
The Delete key shortcut is added for `type === "directory"`. It calls
`deleteDirectory(path)` which shows the confirmation dialog. Same behaviour as
the context menu item.

**EC-17 — Rename of a non-`.md` file (e.g. `config.yaml`)**
`startInlineRename` prefills the full basename (`config.yaml`). The user edits
it (e.g. to `config-backup.yaml`). On commit, the new filename is used as-is
(no `.md` appended). `rename_file` renames `config.yaml` → `config-backup.yaml`.
No backlink banner (non-markdown). Tab manager `handleFileRename` updates the
open tab if any.

**EC-18 — Vault index reload fails after rename or delete**
`reloadVaultIndex()` rejects. The disk operation has already succeeded. The tree
may be stale until the next FS watcher event (fires within 300 ms). Error is
caught and logged to console. No user-facing crash.

**EC-19 — `handleFileRename` called when tab manager is not yet initialised**
If `__MARKABLE_TAB_MANAGER__` is null or the method doesn't exist yet (very
early startup race), the optional chain `?.handleFileRename?.()` is a no-op.
The file is renamed on disk but the tab title remains stale until the user
next focuses the tab (at which point the file path mismatch will cause a load
error on save). This is an acceptable edge case for early-startup races.

**EC-20 — `closeFileByPath` called but `closeTab` is called asynchronously and the
tab is not found after resolution**
If two async operations race to close the same tab, the second `closeTab(id)`
call is a silent no-op (tab already gone). `closeFileByPath`'s "is tab still
open" check handles this correctly: the tab is gone, so it returns `true`.

---

## Non-Functional Requirements

**NFR-1 — No new Rust commands**
`rename_file`, `delete_file`, `delete_directory` are all present. No new Cargo
changes.

**NFR-2 — IIFE plugin boundary compliance**
All Tauri calls use `window.__TAURI_INTERNALS__.invoke(...)`. No ES module
imports from `bridge.ts` at runtime.

**NFR-3 — `TabManager` is modified in `src/tabs/tab-manager.ts`**
This is the only non-plugin file that changes. It is a compiled app-internal
module, not an IIFE. The two new methods (`handleFileRename`, `closeFileByPath`)
are plain TypeScript additions to the `TabManager` class.

**NFR-4 — `window.confirm` for delete confirmation**
Native `window.confirm` is the correct pattern here. The Tauri plugin-dialog
`confirm` command is not required. The existing implementation already uses
`window.confirm`; preserve this.

**NFR-5 — Error display pattern**
Rename errors (collision, illegal chars, Rust errors) are displayed in the
inline error span adjacent to the rename input. The input stays open.
Delete errors (Rust failure) are displayed via `showInlineError` in the panel
container (since there is no inline input during a delete flow).

**NFR-6 — No TODO comments in source**
Deferred work is logged in `docs/specs/file-browser/00_index.md`.

**NFR-7 — Plugin build step after source changes**
After any change to `src/plugins/file-browser/`:
`npm run build:plugins && npm run sync:plugins`.

**NFR-8 — Window size invariant**
No changes to `src-tauri/src/lib.rs` or `src/lib/settings.ts`. Invariant unaffected.

---

## Files That Must Change

| File | Change |
|------|--------|
| `src/tabs/tab-manager.ts` | Add `handleFileRename(oldPath, newPath): void` and `closeFileByPath(path): Promise<boolean>` |
| `src/plugins/file-browser/file-browser-ops.ts` | Fix `renameFile` → `handleFileRename`; fix `closeFile` → `closeFileByPath`; fix extension handling for non-`.md` files in `renameNode`; remove redundant `reloadAndRender` calls from `deleteFile` and `deleteDirectory` callers |
| `src/plugins/file-browser/file-browser.plugin.ts` | Add dblclick rename listener for file/directory nodes in `attachNodeListeners`; add Delete key handler for directory nodes; remove redundant `.then(() => reloadAndRender(vaultId))` from delete keyboard handler |

### Files that must NOT change

| File | Reason |
|------|--------|
| `src-tauri/src/commands/file_ops.rs` | All required commands exist and are correct |
| `src/lib/bridge.ts` | No new bridge wrappers required |
| `src-tauri/src/lib.rs` | Window size invariant |
| `src/lib/settings.ts` | Window size invariant |

---

## Out of Scope

- **Rename vault root name** — vault root rename is already implemented separately
  via `startVaultInlineRename` and `vm.updateVault()`. This feature does not
  touch vault-level rename.
- **Move file to different directory** — drag-and-drop move is already implemented.
  A "Move to…" context menu item exists but is disabled. Not in this iteration.
- **Batch rename or delete** — single-item operations only.
- **Undo of rename or delete** — disk operations are permanent. Undo within
  CodeMirror does not affect the filesystem.
- **Trash / recycle bin** — delete is permanent (`rm`, not `trash`). A future
  "Move to Trash" feature is out of scope here.
- **Rename file from tab bar** — tab bar rename is a separate surface not addressed here.
- **Keyboard shortcut for delete on directory nodes beyond the Delete key** — the
  Delete key is added; no other shortcuts.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 20 items in Edge Case Inventory (EC-1 through EC-20)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.

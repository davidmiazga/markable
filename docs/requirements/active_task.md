---
title: Create File / Folder from File Browser Tree
last-updated: "2026-04-30"
review-cadence-days: 90
status: archive
---

# Create File / Folder from File Browser Tree

## Feature Summary

As a user with a vault open in the file browser, I want to create new files and
folders directly from the tree panel — via a "+" button at the tree bottom, a
right-click context menu on any node, or right-clicking empty tree space — so
that I can build and organise my vault without leaving the editor.

---

## Codebase Context Findings

### Finding 1 — The skeleton already exists; this is a fix-and-complete task

The majority of the feature is already implemented across two files:

- `src/plugins/file-browser/file-browser.plugin.ts` — contains
  `showInlineCreateInput`, `showInlineFolderCreateInput`, `buildInlineInputNode`,
  `buildAddRow` (the "+ Add…" button), and context-menu items "New Note" /
  "New Folder" wired to both the file and directory node menus.
- `src/plugins/file-browser/file-browser-ops.ts` — contains `createNote`
  (validate → duplicate-check → `create_file` invoke → `reloadVaultIndex` →
  open tab), `validateFilename`, `filenameExistsInDir`, `showInlineError`.

The Rust backend already exposes `create_file` (atomic temp-file-swap, fails if
path exists) and `create_directory` (wraps `create_dir_all`, idempotent on
existing) in `src-tauri/src/commands/file_ops.rs`. No new Rust commands are
needed.

### Finding 2 — Bug: wrong tab-manager method name in `createNote`

`createNote` (line 270 of `file-browser-ops.ts`) calls
`__MARKABLE_TAB_MANAGER__?.openFile?.(fullPath)`. The tab manager exposes
`openFileInTab(path)` (registered on `window.__MARKABLE_TAB_MANAGER__` at
`src/main.ts` line 899). The method `openFile` does not exist on the tab
manager — the optional chain silently swallows the miss and the new file is
never opened in a tab after creation.

The correct call is:
`(window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(fullPath)`.

### Finding 3 — Bug: inline create input always inserts at tree top, not inside target directory

Both `showInlineCreateInput` and `showInlineFolderCreateInput` call
`_treeEl.prepend(li)`. This places the input at the absolute top of the flat
`<ul>` list regardless of which directory was right-clicked. The `dirPath`
parameter is correctly threaded through to `createNote` / `create_directory`,
so the file is created in the right place on disk, but the input appears at
the wrong position in the UI. The input should be inserted immediately after
the `<li>` element for the target directory (or at the top if the trigger was
the vault root or the "+ Add…" row).

### Finding 4 — Gap: `filenameExistsInDir` only checks `.md` entries, not folders

`filenameExistsInDir` iterates `vaultIndex.entries` which contains only the
indexed `.md` files. Checking for duplicate folder names requires also
consulting `vaultIndex.nonMdFiles` or — more reliably — checking
`vaultIndex.entries` for any path whose parent directory segment equals
`dirPath/name`. The current logic will miss a collision with an existing folder
of the same name, allowing `create_directory` to be called (which is idempotent
and succeeds silently), then the inline input is removed with no feedback.

For folder creation, the duplicate check should use `create_directory`'s
idempotent behaviour as the authoritative check. The inline error should be
shown only when the Rust command returns an error. For file creation, the
current `filenameExistsInDir` check against `vaultIndex.entries` is accurate
for `.md` files but races with external creates; the `create_file` Rust command
is the authoritative check (it returns `Err("File already exists: …")`) and
should be used as the final guard.

### Finding 5 — Gap: custom file extensions not honoured

`createNote` always strips any typed extension and re-appends `.md`:
```
const stem = trimmed.endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
const fullFilename = stem + ".md";
```
The stated design intent is: if the user types a name with an extension (e.g.
`notes.txt`), honour it; if no extension, append `.md`. Currently `notes.txt`
would create `notes.txt.md`. The logic must be revised: check whether the
trimmed input contains an extension (any `.` after the first character), and if
so, use the name as given; otherwise append `.md`. The validation stem for
`validateFilename` should strip the extension before checking for illegal
characters.

### Finding 6 — Gap: "New Folder" absent from file node context menu

`buildFileContextMenuItems` contains "New Note" but no "New Folder" item. The
directory menu has both. Since right-clicking a file is a common path (the user
may want a sibling folder), "New Folder" should be added to the file context
menu, creating the new folder in the file's parent directory.

### Finding 7 — Gap: post-folder-creation does not auto-expand the parent

After `create_directory` succeeds in `buildInlineInputNode`, the vault index is
reloaded and `renderPanel` fires via the `onVaultChanged` subscription. However,
the newly-created folder is not added to `_expandedPaths`, so the parent
directory renders as collapsed and the folder is not visible until the user
manually expands the parent. The parent directory path (the `dirPath` passed to
the inline input) should be added to `_expandedPaths` before reloading the
index so the tree opens to show the new folder.

### Finding 8 — Gap: no right-click on empty tree area

Right-clicking on the `.file-tree` `<ul>` element below all nodes (empty space)
currently has no `contextmenu` handler. The design intent states that a click on
empty space creates at vault root. A `contextmenu` listener on the `.file-tree`
(or `.file-tree-card`) that fires when the event target is not a `.tree-node`
should show a menu with "New File" and "New Folder" pointing to the vault's
first root path.

### Finding 9 — Existing inline input appears correctly for vault root via "+ Add…" row

The `buildAddRow` function (lines 1210–1252) correctly reads
`activeVault.rootPaths[0]` as the `rootPath` and passes it to
`showInlineCreateInput`. This trigger point functions correctly for vault-root
creation. The bug (Finding 3) only affects the insert position in the DOM, not
the path used for creation.

### Finding 10 — `openFileInTab` is the correct method; `openFile` does not exist

`window.__MARKABLE_TAB_MANAGER__` is the `tabManager` singleton from
`src/tabs/tab-manager.ts`. Its public API (confirmed in `src/main.ts:899` and
`src/tabs/drag-drop.ts:12`) includes `openFileInTab(path: string):
Promise<boolean>`. No `openFile` method exists. The optional-chain silence
pattern (`?.openFile?.()`) means the current code fails silently on every file
creation.

---

## Functional Requirements

### FR-1 — Trigger: "+ Add…" row at the bottom of the file-tree card

A `<div class="file-browser-add-row">` is rendered at the bottom of the tree
card. Clicking it shows a context menu with "New File", "New Folder", and a
separator followed by "New Vault…". The "New File" and "New Folder" items create
at the active vault's first root path (`activeVault.rootPaths[0]`). This trigger
is already implemented; no changes are required beyond the fixes in FR-6 and FR-7.

### FR-2 — Trigger: right-click on a directory node

The directory context menu already contains "New Note" and "New Folder". Both
create inside the right-clicked directory. No new items are needed; the fix in
FR-3 (correct insert position) applies here.

### FR-3 — Trigger: right-click on a file node

The file context menu already contains "New Note" which creates a sibling note
in the file's parent directory. A "New Folder" item must be added (below "New
Note") that creates a sibling folder in the same parent directory (FR-12).

### FR-4 — Trigger: right-click on empty space in the tree

A `contextmenu` listener must be added to the `.file-tree-card` element (or the
`.file-tree` `<ul>`). When the event target is not a `.tree-node` descendant,
show a context menu with "New File" and "New Folder" that create at the vault's
first root path. Escape and outside-click dismiss the menu using the existing
`closeContextMenu()` pattern.

### FR-5 — Inline input pattern for file creation

When "New File" is activated from any trigger:

1. A temporary `<li class="tree-node tree-node-file">` is inserted into the
   tree immediately after the target directory's `<li>` element (or at the top
   of the `<ul>` for vault-root creation). The input must be inserted after the
   directory row, not prepended to the top of the entire list.
2. The `<li>` contains a focused `<input class="tree-node-rename-input">` with
   placeholder "Note name…" and an empty `<span class="tree-node-inline-error">`.
3. Real-time validation on `input` events: calls `validateFilename(value.trim())`
   and displays the error in the inline error span without dismissing the input.
4. Enter commits (FR-6). Escape or blur (100 ms deferred) cancels — removes the
   `<li>` without creating anything.
5. Click inside the input calls `stopPropagation()` so the tree node click
   handler does not fire.

### FR-6 — File creation commit

When the user presses Enter in the inline file-creation input:

1. Validate the name via `validateFilename`. If invalid, show inline error and
   do not dismiss.
2. Determine the final filename: if the trimmed input contains a `.` after the
   first character (has an explicit extension), use the name as-is; otherwise
   append `.md`. Examples: `my-note` → `my-note.md`; `script.py` → `script.py`;
   `my.note` → `my.note.md` if this is ambiguous — use the rule "last segment
   after final dot" to determine extension presence.
3. Pre-check the vault index for the filename in the target directory via
   `filenameExistsInDir`. If a match is found, show inline error "'{name}'
   already exists in this folder." and do not dismiss. This check is advisory
   only (races are handled by the Rust layer).
4. Invoke `create_file` via `window.__TAURI_INTERNALS__.invoke`. If Rust returns
   an error (e.g. "File already exists"), show inline error and do not dismiss.
5. On success:
   a. Remove the temporary `<li>`.
   b. Call `window.__MARKABLE_VAULT_MANAGER__.reloadVaultIndex()`.
   c. Call `window.__MARKABLE_TAB_MANAGER__.openFileInTab(fullPath)` to open
      the new file in a tab. Note: the method is `openFileInTab`, not `openFile`.

### FR-7 — Folder creation commit

When the user presses Enter in the inline folder-creation input:

1. Validate the name via `validateFilename`. If invalid, show inline error.
2. Folder names never receive an appended extension.
3. Pre-check: a folder collision check against the vault index is not reliable
   (index only tracks `.md` files). Proceed directly to the Rust command.
4. Invoke `create_directory` via `window.__TAURI_INTERNALS__.invoke`. The Rust
   command uses `create_dir_all` and is idempotent — it returns `Ok(())` even
   if the directory already exists. To detect the "already exists" case, the
   pre-check must use the filesystem: check whether `dirPath + "/" + name`
   already exists as a directory in the vault tree (consult `vaultIndex.entries`
   for any entry whose path starts with the target path prefix, OR use a
   `stat`-style check via a Rust command if one exists). If an exact collision
   is detected, show inline error "'name' folder already exists here." and do
   not dismiss. If Rust returns an error for any other reason, show inline error.
5. On success:
   a. Remove the temporary `<li>`.
   b. Add `dirPath` (the parent) to `_expandedPaths` so the parent is expanded.
   c. Call `window.__MARKABLE_VAULT_MANAGER__.reloadVaultIndex()`.
   d. The vault index reload triggers `onVaultChanged` → `renderPanel`, which
      will now render the new folder as visible because the parent is in
      `_expandedPaths`.

### FR-8 — Inline input insert position

The temporary `<li>` for both file and folder creation must be inserted
immediately after the `<li>` element for the target directory in the flat
`<ul>` list. For vault-root creation (triggered from "+ Add…" or the vault root
node context menu), the `<li>` is prepended to the top of the `<ul>`.

To find the correct insertion point, locate the `<li>` whose `data-path`
attribute matches `dirPath` in `_treeEl`, then call `insertAdjacentElement('afterend', li)`.
If no matching `<li>` is found (vault root trigger), fall back to `_treeEl.prepend(li)`.

### FR-9 — No extension appended for folder names

Folder names are used as-is. `validateFilename` is called on the trimmed name
to reject illegal characters (`:`, `/`, dot-only names, empty names). No `.md`
or other suffix is appended.

### FR-10 — Duplicate file name: inline error, input stays open

If a file with the resolved name already exists in `dirPath` (detected either
by `filenameExistsInDir` or by the Rust `create_file` error), the inline input
must remain open with the error text displayed inline. The user can edit the
name and press Enter again to retry. Escape still cancels.

### FR-11 — Post-file-creation: open in tab, cursor at top

After successful file creation, `openFileInTab(fullPath)` is called. The tab
manager opens the file, activates the tab, and places the cursor at the top of
the document. No additional cursor-placement logic is required in the plugin.

### FR-12 — "New Folder" added to file node context menu

`buildFileContextMenuItems` must include a "New Folder" item after the "New
Note" item (before the first separator). Activating it calls
`showInlineFolderCreateInput(getParentDir(path), container, vaultId)` —
creating the folder as a sibling of the file.

### FR-13 — Extension handling: honour explicit extension, default to `.md`

The extension rule:
- Name contains no `.` after position 0, or ends with a `.` (trailing dot):
  append `.md`. Example: `my-note` → `my-note.md`, `trailingdot.` → treat as
  stem `trailingdot` → `trailingdot.md`.
- Name contains a `.` after position 0 and does not end with `.`: use name
  as-is. Example: `notes.txt` → `notes.txt`, `My File.md` → `My File.md`.

`validateFilename` receives the stem (name minus extension) for character
validation. The extension (if any) is not validated beyond the overall name
passing the illegal-character check.

---

## Edge Case Inventory

**EC-1 — No active vault when trigger is activated**
`getActiveVault()` returns null. `buildAddRow`, context menu handlers, and the
empty-space listener all guard `rootPath`. Expected: if `rootPath` is empty or
null, the inline input is not shown and no action is taken. No crash.

**EC-2 — `_treeEl` is null when trigger fires**
`showInlineCreateInput` and `showInlineFolderCreateInput` both guard
`if (!_treeEl) return`. Expected: no-op with no visible feedback. (This can
occur if the panel has been destroyed but an async event fires late.)

**EC-3 — Target directory `<li>` not found in the tree (insert position)**
The directory row may be hidden (display:none) when the parent is collapsed, or
not yet rendered (incremental update lag). Expected: fall back to
`_treeEl.prepend(li)` — the input appears at the top, which is suboptimal but
functional. No crash.

**EC-4 — Duplicate file: both vault-index check and Rust check**
The `filenameExistsInDir` pre-check is advisory and based on the in-memory
index. A file created externally between the last index build and the user
pressing Enter won't be in the index. The Rust `create_file` command is the
authoritative guard (returns `Err("File already exists: …")`). Both checks must
surface the error inline without dismissing the input.

**EC-5 — User types a name with only dots (e.g. `...`)**
`validateFilename` already rejects names consisting entirely of dots with the
message "Name cannot consist entirely of dots." The inline error is shown and
the input stays open.

**EC-6 — User types a name containing `:` or `/`**
`validateFilename` rejects these with "Name contains an illegal character (:
or /)." The inline error is shown and the input stays open.

**EC-7 — User presses Escape with a non-empty input**
Cancel runs immediately: the temporary `<li>` is removed, no file or folder is
created, no error is shown.

**EC-8 — User tabs away (blur) from the inline input**
Blur fires after 100 ms (deferred so Enter commits first). If the input is still
in the DOM at 100 ms, cancel runs — the `<li>` is removed. If Enter was pressed
first, commit runs within the 100 ms window and removes the `<li>` before the
blur timer fires; the deferred cancel's `document.contains(input)` guard
returns false and is a no-op.

**EC-9 — Vault index reload fails after file creation**
`reloadVaultIndex()` rejects. The file exists on disk but the tree will not
show the new node until the next vault event triggers a reload. Expected:
the error is caught and logged (`console.error`), not surfaced as a user-facing
dialog. The tab is still opened via `openFileInTab`. The tree will self-correct
on the next file-system watcher event (FS watcher fires 300 ms after any
disk change and triggers its own reload).

**EC-10 — `openFileInTab` call fails after file creation**
`openFileInTab` rejects (e.g. file is locked, read error). The file was created
on disk and the vault index was reloaded. Expected: the error is caught and
logged. The tree will show the new file. The user can click it to open
manually. No user-facing error dialog.

**EC-11 — User types a filename that is valid but results in a path exceeding macOS 255-byte limit**
`create_file` returns an OS-level error. FR-6 surfaces the Rust error message
inline. The input stays open.

**EC-12 — Two inline create inputs simultaneously**
If the user somehow opens two context menus rapidly and triggers two create
actions, two `<li>` inputs are prepended/inserted. Both are independent and
functional. The second commit creates a second file. This is an unusual path
(context menu closes before a second can open) and is acceptable behaviour.

**EC-13 — File creation in a subdirectory that does not yet exist on disk**
This is not possible from the UI: the tree only shows directories that exist.
The inline create input is triggered from an existing tree node's path, so the
parent always exists. `create_file`'s `create_dir_all` for parent creation is
a safety net for programmatic calls, not a primary UI path.

**EC-14 — Folder creation: parent directory not in `_expandedPaths` before reload**
If `dirPath` is not added to `_expandedPaths` before calling
`reloadVaultIndex()`, the new folder will be hidden under a collapsed parent
after re-render. FR-7 step b requires adding `dirPath` to `_expandedPaths`
before the reload. The `scheduleSettingsSave(vaultId)` should also be called to
persist the expanded state.

**EC-15 — Non-`.md` file created but not in the vault index**
The vault index only tracks `.md` files in `entries`. A file like `notes.txt`
created via FR-6's custom-extension path will appear in `vaultIndex.nonMdFiles`
(the supplementary list) after the next index reload. The tree renders non-md
files using the `nonMdFiles` array (confirmed in `renderTreeContent`), so the
file will appear in the tree. Opening it via `openFileInTab` will invoke the
media viewer path (`openMediaInTab`) for non-markdown files.

**EC-16 — Empty-space right-click: `target` is the scrollbar or inner padding**
The `contextmenu` handler on `.file-tree-card` must distinguish "click on empty
space" from "click on a node". Guard: if `e.target` is or is contained within a
`.tree-node`, do not show the empty-space menu (let the node's own
`contextmenu` handler fire). Use `(e.target as Element).closest('.tree-node')`
as the guard check.

**EC-17 — Right-click on vault root node: missing "New File"/"New Folder" items**
The vault context menu (`buildVaultContextMenuItems`) currently contains
"Unmount", "Rename", and "Edit Type". It does not have "New File" or "New
Folder" items for creating notes at the vault root. These should be added as
the first two items (before a separator and the existing items) to make the
vault root consistent with directory nodes.

**EC-18 — `_panelContainer` is null when a context menu item fires**
If the panel is destroyed between right-click and menu item selection (race),
`_panelContainer` will be null. Context menu handlers already guard
`if (!container) return`. This pattern must be maintained in any new handlers.

---

## Non-Functional Requirements

**NFR-1 — No new Rust commands**
All required Rust commands exist: `create_file`, `create_directory`,
`rename_file`, `delete_file`. No new Cargo dependencies.

**NFR-2 — IIFE plugin boundary compliance**
All Tauri calls in the plugin use `window.__TAURI_INTERNALS__.invoke(...)`.
No ES module imports from `bridge.ts` at runtime.

**NFR-3 — Atomic writes**
`create_file` uses the temp-file-swap pattern. All file writes are atomic.

**NFR-4 — Error display pattern**
User-visible errors (duplicate name, illegal characters, OS errors) are
displayed inline in the `.tree-node-inline-error` span adjacent to the input.
The input remains open so the user can edit and retry. The existing
`showInlineError` panel-level strip is used only for unexpected async errors
after the input has been dismissed (e.g. vault reload failure).

**NFR-5 — CSS uses only existing variables and classes**
No new CSS classes are introduced. The inline create input reuses
`.tree-node-rename-input` and `.tree-node-inline-error` which are already
defined in the embedded `FILE_BROWSER_CSS` constant. If new classes are needed
(e.g. for a folder creation icon), they must use only the existing CSS custom
properties (`--accent-color`, `--text-primary`, etc.).

**NFR-6 — Window size invariant must not regress**
No changes to `src-tauri/src/lib.rs` or `src/lib/settings.ts` are required.
The window size invariant is unaffected.

**NFR-7 — No TODO comments in source**
Deferred work must be logged in `docs/specs/file-browser/00_index.md`, not
inline in source code.

**NFR-8 — Plugin build step after any source change**
After any change to `src/plugins/file-browser/` source files:
`npm run build:plugins && npm run sync:plugins` must be run before testing.

---

## Files That Must Change

| File | Change |
|------|--------|
| `src/plugins/file-browser/file-browser-ops.ts` | Fix `openFile` → `openFileInTab` bug (Finding 2); revise extension-handling logic to honour custom extensions (FR-13) |
| `src/plugins/file-browser/file-browser.plugin.ts` | Fix `_treeEl.prepend` → insert-after-target-directory (FR-8); add "New Folder" to file context menu (FR-12); add contextmenu listener on empty tree space (FR-4); add "New File"/"New Folder" to vault root context menu (EC-17); add `_expandedPaths.add(dirPath)` before folder-creation reload (FR-7) |

### New files to create

None. All changes are contained in the two existing plugin files.

### Files that must NOT change

| File | Reason |
|------|--------|
| `src-tauri/src/commands/file_ops.rs` | All required commands exist; no new Rust commands needed |
| `src/lib/bridge.ts` | No new bridge wrappers required |
| `src/lib/vault-manager.ts` | `reloadVaultIndex` already exists and works |
| `src-tauri/src/lib.rs` | Window size invariant — must not be touched |
| `src/lib/settings.ts` | Window size invariant — must not be touched |

---

## Out of Scope

- **Keyboard shortcut for new file/folder** — not in this iteration; the three
  trigger points ("+", context menu on node, context menu on empty space) are
  sufficient for the initial PKM story.
- **Subfolder picker dialog** — placement is determined by the trigger point
  (which node was right-clicked); no modal folder picker is introduced.
- **Template selection on creation** — new files are created with empty content;
  template support is deferred to the Templates plugin.
- **Undo of file/folder creation** — once created, files exist on disk; undo
  within CodeMirror does not delete files.
- **Drag-to-reorder within the tree** — already implemented via drag-and-drop;
  not a new concern.
- **Multi-file selection and batch create** — single-file/folder creation only.
- **Custom icon for the inline create node** — the temporary `<li>` uses the
  existing `tree-node-file` / `tree-node-directory` class; no new icon is added.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 18 items in Edge Case Inventory (EC-1 through EC-18)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.

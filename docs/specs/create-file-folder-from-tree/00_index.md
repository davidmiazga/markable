---
title: "Create File / Folder from Tree — Master Index"
last-updated: "2026-04-30"
review-cadence-days: 7
status: active
---

# Create File / Folder from Tree — Master Index

Requirements source: `docs/requirements/active_task.md`

---

## Implementation Checklist

- [ ] step_01 — Fix `createNote`: `openFileInTab` bug + extension-handling logic
- [ ] step_02 — Fix inline input insert position (`_treeEl.prepend` → insert-after-target)
- [ ] step_03 — Add "New Folder" to file context menu + folder-creation auto-expand
- [ ] step_04 — Add "New File" / "New Folder" to vault root context menu
- [ ] step_05 — Add empty-tree-space `contextmenu` listener
- [ ] step_06 — Test suite

---

## Scope

All source changes are confined to two files:

    src/plugins/file-browser/file-browser-ops.ts
    src/plugins/file-browser/file-browser.plugin.ts

One new test file is created:

    tests/plugins/file-browser/create-file-folder.test.ts

No new Rust commands. No new CSS classes (existing `.tree-node-rename-input` and
`.tree-node-inline-error` are reused). No changes to `src-tauri/src/lib.rs` or
`src/lib/settings.ts`.

---

## Architecture Summary

### What already works

The skeleton is complete. The `showInlineCreateInput`, `showInlineFolderCreateInput`,
`buildInlineInputNode`, and `buildAddRow` functions exist and are wired. The Rust commands
`create_file` and `create_directory` are in place. The "New Note" and "New Folder" items are
already in the directory context menu. The "+ Add…" row already works for vault-root creation.

### What needs fixing (bugs)

**Bug 1 — Wrong tab-manager method** (`file-browser-ops.ts` line 270)
`__MARKABLE_TAB_MANAGER__?.openFile?.(fullPath)` — `openFile` does not exist on the
tab manager. The optional chain silently drops the call so newly-created files are never
opened. Fix: call `openFileInTab`.

**Bug 2 — Inline input inserted at tree top** (`file-browser.plugin.ts` lines 2283, 2296)
Both `showInlineCreateInput` and `showInlineFolderCreateInput` call `_treeEl.prepend(li)`.
This places the input at the absolute top of the `<ul>` regardless of which directory was
triggered. Fix: find the `<li data-path="dirPath">` element and call
`insertAdjacentElement('afterend', li)`. Fall back to `_treeEl.prepend(li)` when not found
(vault-root trigger, EC-3).

### What needs adding (gaps)

**Gap 1 — Extension handling** (`file-browser-ops.ts` `createNote`)
The current logic always strips any extension and appends `.md`, so `notes.txt` becomes
`notes.txt.md`. Fix: detect a real extension (`.` after position 0, not trailing), use
the name as-is if an extension is present, append `.md` otherwise.

**Gap 2 — "New Folder" absent from file context menu** (`file-browser.plugin.ts`
`buildFileContextMenuItems`)
Add a "New Folder" item immediately after "New Note" in the file node context menu.
It creates a folder in `getParentDir(path)`.

**Gap 3 — Folder creation does not auto-expand parent** (`file-browser.plugin.ts`
`buildInlineInputNode` directory branch)
After `create_directory` succeeds: add `dirPath` to `_expandedPaths` and call
`scheduleSettingsSave(vaultId)` before calling `reloadVaultIndex()`.

**Gap 4 — Vault root context menu missing "New File" / "New Folder"** (`file-browser.plugin.ts`
`buildVaultContextMenuItems`)
Add "New File" and "New Folder" as the first two items before the existing separator.
Both create at `activeVault.rootPaths[0]`.

**Gap 5 — No contextmenu on empty tree space** (`file-browser.plugin.ts`)
Attach a `contextmenu` listener to the `card` element (`.file-tree-card`) created inside
`buildTreeUl`. Guard: if `(e.target as Element).closest('.tree-node')` is non-null, let
the node's own handler fire. Otherwise show "New File" / "New Folder" at vault root.

### Key design decisions

**Insert-after-target-directory (FR-8)**
The `<ul class="file-tree">` is a flat list of `<li>` elements (one per visible node).
To insert the inline input after the target directory, query `_treeEl.querySelector(
'[data-path="' + CSS.escape(dirPath) + '"]')` and call `insertAdjacentElement(
'afterend', li)`. If not found, fall back to `_treeEl.prepend(li)`. This covers the
vault-root trigger (no node has `data-path` matching `rootPaths[0]` when the vault root
node uses the vault ID, not the path — confirmed by reading `buildNodeEl`). Note: the
vault root `<li>` carries `data-path` equal to `activeVault.rootPaths[0]`; the "+ Add…"
row passes `rootPaths[0]` as `dirPath`, so `_treeEl.querySelector('[data-path="..."]')`
will find the vault node if expanded. The `prepend` fallback is only exercised when the
vault root node is not rendered (empty tree, loading state, EC-3).

**Extension detection (FR-13)**
Rule: a name has an explicit extension when it contains a `.` after position 0 and does
not end with `.`. Implementation:

```typescript
function hasExplicitExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1;
}
```

`validateFilename` continues to receive the full trimmed name (not just the stem), because
the illegal-character check (`/` and `:`) applies to the full string. The stem passed to
`filenameExistsInDir` should be the resolved final filename (after extension decision),
not the raw input.

**`filenameExistsInDir` — no change for folder check**
Per FR-7 and Finding 4: folder duplicate detection is unreliable via the vault index
(index only tracks `.md` files). The authoritative check is the filesystem response from
`create_directory`. Because `create_dir_all` is idempotent, the Rust command succeeds
silently even for an existing directory. Therefore the pre-check for folder collisions
should scan `vaultIndex.entries` for any entry whose path starts with the would-be
directory path (`dirPath + "/" + name + "/"`). If any entry starts with that prefix,
the folder exists and we show an inline error. This is a best-effort check; the fallback
is that the folder is created silently (idempotent) with no user feedback, which is an
acceptable outcome noted in the requirements (FR-7 step 4).

**Empty-tree contextmenu listener lifetime**
The listener must be attached once when the card element is created inside `renderTreeCard`,
not at plugin enable time. The card is recreated on each `renderPanel` call, so the
listener is garbage-collected with the card. No cleanup is needed.

**`_vaultId` parameter threading**
`buildInlineInputNode` receives `_vaultId` but ignores it (currently unused beyond naming).
The folder-creation fix (Gap 3) requires calling `scheduleSettingsSave(vaultId)`. The
parameter is already present but named `_vaultId` (prefixed underscore meaning "unused").
Remove the underscore prefix and use it.

---

## Component Map

### Files changed

| File | What changes |
|---|---|
| `src/plugins/file-browser/file-browser-ops.ts` | `createNote`: fix `openFile` → `openFileInTab`; revise extension logic (`hasExplicitExtension`); adjust `validateFilename` call to pass full name |
| `src/plugins/file-browser/file-browser.plugin.ts` | `showInlineCreateInput` + `showInlineFolderCreateInput`: fix insert position; `buildInlineInputNode`: add `_expandedPaths.add` + `scheduleSettingsSave` for folder success; `buildFileContextMenuItems`: add "New Folder" item; `buildVaultContextMenuItems`: add "New File" + "New Folder"; `renderTreeCard`: attach empty-space contextmenu listener; `_testing` export: expose `buildFileContextMenuItems`, `showInlineCreateInput`, `showInlineFolderCreateInput` |

### Files NOT changed

| File | Reason |
|---|---|
| `src-tauri/src/commands/file_ops.rs` | All required commands exist |
| `src/lib/bridge.ts` | No new bridge wrappers required |
| `src/lib/vault-manager.ts` | `reloadVaultIndex` already works |
| `src-tauri/src/lib.rs` | Window size invariant — must not be touched |
| `src/lib/settings.ts` | Window size invariant — must not be touched |

### New files

| File | Purpose |
|---|---|
| `tests/plugins/file-browser/create-file-folder.test.ts` | Full test suite for all 7 bugs/gaps |

---

## Requirement-to-Component Traceability

| Requirement | Component |
|---|---|
| FR-1 ("+Add…" row) | No change needed — already works; bugs fixed in FR-5 fix path |
| FR-2 (dir right-click) | Insert-position fix in `showInlineCreateInput` / `showInlineFolderCreateInput` |
| FR-3 (file right-click — New Folder) | `buildFileContextMenuItems` gap fill |
| FR-4 (empty-space right-click) | New `contextmenu` listener in `renderTreeCard` |
| FR-5 (inline input pattern) | Insert-position fix (`insertAdjacentElement`) |
| FR-6 (file creation commit) | `createNote` fixes: `openFileInTab` + extension logic |
| FR-7 (folder creation commit) | `buildInlineInputNode` folder branch: `_expandedPaths.add` + `scheduleSettingsSave` |
| FR-8 (insert position) | `showInlineCreateInput` + `showInlineFolderCreateInput` |
| FR-9 (no extension for folders) | `buildInlineInputNode` folder branch — no change needed |
| FR-10 (duplicate error stays open) | Existing inline error pattern; `createNote` error bubbling to `errSpan` |
| FR-11 (open in tab) | `createNote` fix: `openFileInTab` |
| FR-12 ("New Folder" in file menu) | `buildFileContextMenuItems` gap fill |
| FR-13 (extension handling) | `createNote` + `hasExplicitExtension` helper |
| EC-1 (no vault guard) | Existing guards unchanged; empty-space handler guards `rootPath` |
| EC-2 (`_treeEl` null guard) | Existing `if (!_treeEl) return` unchanged |
| EC-3 (target `<li>` not found fallback) | `_treeEl.prepend(li)` fallback in insert-position fix |
| EC-4 (duplicate check layers) | `filenameExistsInDir` + Rust error surfaced via `errSpan` |
| EC-5 (dots-only name) | `validateFilename` already handles this |
| EC-6 (illegal char) | `validateFilename` already handles this |
| EC-7 (Escape) | `cancel` callback unchanged |
| EC-8 (blur cancel) | `setTimeout` + `document.contains(input)` guard unchanged |
| EC-9 (vault reload failure) | `catch` → `console.error` in `createNote` |
| EC-10 (`openFileInTab` failure) | Caught and logged in `createNote` |
| EC-11 (path too long) | Rust error surfaced via `errSpan` |
| EC-14 (folder not visible) | `_expandedPaths.add(dirPath)` before reload |
| EC-15 (non-md file in tree) | `openFileInTab` path — no change needed in plugin |
| EC-16 (empty-space guard) | `(e.target as Element).closest('.tree-node')` guard |
| EC-17 (vault root "New File"/"New Folder") | `buildVaultContextMenuItems` gap fill |
| EC-18 (null `_panelContainer` in handler) | `if (!container) return` pattern maintained |

---

## Step Files

- `step_01_ops_fixes.md` — `createNote` bug fix + extension logic in `file-browser-ops.ts`
- `step_02_insert_position.md` — insert-after-target-directory in `file-browser.plugin.ts`
- `step_03_file_menu_folder_expand.md` — "New Folder" in file context menu + auto-expand in folder creation
- `step_04_vault_root_menu.md` — "New File" / "New Folder" in vault root context menu
- `step_05_empty_space_contextmenu.md` — `contextmenu` listener on empty tree space
- `step_06_tests.md` — full test suite for `tests/plugins/file-browser/create-file-folder.test.ts`

---
title: "Folder View — Step 06: Context Menu Integration"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Step 06 — Context Menu Integration

**Goal**: Inject "Open Folder View" and "Create Folder View..." into the directory context menu. Implement `createFolderViewFile` with the EC-16 guard.

**Files created**: none.

**Files modified**:
- `src/plugins/file-browser/file-browser.plugin.ts`

---

## Detailed Tasks

### 1. Modify `buildDirContextMenuItems`

The `buildDirContextMenuItems` function currently returns a fixed array. It must be updated to accept a `hasFolderView` boolean and inject folder-view-specific items.

#### 1a. Update signature

```typescript
function buildDirContextMenuItems(
  el: HTMLElement,
  path: string,
  vaultId: string,
  hasFolderView: boolean,
): Array<{ label: string; handler: (() => void) | null; disabled?: boolean; separator?: boolean }>
```

#### 1b. Inject "Open Folder View" as the first item when `hasFolderView` is true (FR-34)

At the very start of the returned array (before the Pin/Unpin item):

```typescript
...(hasFolderView ? [
  {
    label: "Open Folder View",
    handler: () => openFolderViewTab(path),
  },
  { separator: true, label: "", handler: null },
] : []),
```

This places "Open Folder View" above all other items (FR-34: "above all other items").

#### 1c. Inject "Create Folder View..." when `hasFolderView` is false (FR-35)

The item must appear between "New Note" and "New Folder" per FR-35 ("between 'New Note' and 'New Folder', near the top of creation actions"). Insert it in the array between those items:

```typescript
{ label: "New Note", handler: () => { ... } },
{
  label: "Create Folder View…",
  handler: () => createFolderViewFile(path, container, vaultId),
},
{ label: "New Folder", handler: () => { ... } },
```

This applies only when `hasFolderView === false`.

#### 1d. Update all call sites of `buildDirContextMenuItems`

There are two call sites:
1. `handleContextMenu` (the main context menu handler).
2. `buildPinnedSection` → `buildDirContextMenuItems(li, pinnedPath, vaultId)`.

For call site 1 (`handleContextMenu`):
- The `hasFolderView` value is determined from `folderViewSet.has(path)`. However, `folderViewSet` is not currently available in `handleContextMenu`. 
- Solution: compute it on demand: `const hasFolderView = folderViewSet?.has(path) ?? false` where `folderViewSet` is a module-level variable `_lastFolderViewSet: Set<string>` updated each time `renderTreeContent` runs.

Add a module-level variable:
```typescript
/** Last computed folder-view set, updated each renderTreeContent call. FR-06. */
let _lastFolderViewSet: Set<string> = new Set();
```

In `renderTreeContent`, after computing `folderViewSet`, assign:
```typescript
_lastFolderViewSet = folderViewSet;
```

In `handleContextMenu`, when routing to `buildDirContextMenuItems`:
```typescript
items = buildDirContextMenuItems(el, path, vaultId, _lastFolderViewSet.has(path));
```

For call site 2 (`buildPinnedSection`, pinned directory items):
```typescript
const normalItems = isDir
  ? buildDirContextMenuItems(li, pinnedPath, vaultId, _lastFolderViewSet.has(pinnedPath))
  : buildFileContextMenuItems(li, pinnedPath, vaultId);
```

In `onDisable`, reset `_lastFolderViewSet`:
```typescript
_lastFolderViewSet = new Set();
```

#### 1e. EC-24: Smart Folder exclusion

Smart Folder nodes already route to `buildSmartFolderContextMenuItems` before reaching `buildDirContextMenuItems` (the `sfId !== null` branch in `handleContextMenu` executes first). No additional guard is needed. Verify in tests.

### 2. Implement `createFolderViewFile`

Add this function to `file-browser.plugin.ts` near the other directory operation handlers.

```typescript
/**
 * Create _folder.md in the given directory with a minimal starter template.
 *
 * FR-35, FR-36, EC-16.
 *
 * EC-16 guard: if _folder.md already exists in the vault index, open it
 * in the editor instead of creating a duplicate.
 *
 * @param dirPath   - Absolute path of the target directory.
 * @param container - Panel container element (for error display).
 * @param vaultId   - Active vault ID (for settings persistence if needed).
 */
async function createFolderViewFile(
  dirPath: string,
  container: HTMLElement | null,
  _vaultId: string,
): Promise<void> {
  const folderMdPath = dirPath + "/_folder.md";

  // EC-16: check vault index for existing _folder.md.
  const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
  const vaultIndex = vaultManager?.getVaultIndex?.();
  const existingEntry = vaultIndex?.entries?.find(
    (e: any) => e.path === folderMdPath
  );

  if (existingEntry) {
    // EC-16: already exists — open it in the editor.
    void (window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(folderMdPath);
    return;
  }

  // FR-36: write the minimal starter template.
  const STARTER = "---\nlayout: folder-cards\n---\n";
  try {
    await (window as any).__TAURI_INTERNALS__?.invoke?.(
      "write_file",
      { path: folderMdPath, content: STARTER },
    );
  } catch (err) {
    if (container) {
      showInlineError(
        container,
        `Could not create _folder.md: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // FR-35: open _folder.md in the editor tab so the user can customize immediately.
  void (window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(folderMdPath);

  // FR-37: the vault FS watcher fires automatically after write_file; no manual
  // index reload is needed here. The watcher triggers _indexUpdatedCb which
  // calls renderPanel() and detects the new _folder.md on the next render pass.
}
```

**Note on length**: `createFolderViewFile` is 35 lines. Length justification: the function contains three distinct execution paths (EC-16 existing file, write failure with error display, and success with editor open) all sharing the same `folderMdPath` variable. Extracting the write path would require threading `folderMdPath`, `container`, and the Tauri invoke reference — net increase in complexity.

---

## Acceptance Criteria

### Tests to write: `tests/folder-view/context-menu.test.ts`

All tests must pass via `npm run test:run -- tests/folder-view/context-menu.test.ts`.

1. **FR-34**: `buildDirContextMenuItems(el, "/vault/A", "v1", true)` → first item has `label === "Open Folder View"`.
2. **FR-34**: "Open Folder View" item is before the Pin/Unpin item (check array index 0 vs Pin index).
3. **FR-35**: `buildDirContextMenuItems(el, "/vault/A", "v1", false)` → no "Open Folder View" item; "Create Folder View…" item is present.
4. **FR-35 position**: "Create Folder View…" appears between "New Note" and "New Folder" in the array (verify by finding the index of each).
5. **FR-35 no duplicate**: `buildDirContextMenuItems(el, "/vault/A", "v1", true)` → no "Create Folder View…" item.
6. **EC-24**: A smart folder node → `buildSmartFolderContextMenuItems` is called; `buildDirContextMenuItems` is NOT called. (Tested at `handleContextMenu` level by setting `data-smart-folder-id` on the `<li>`)
7. **EC-16 already exists**: `createFolderViewFile` called when `vaultIndex.entries` contains `{ path: "/vault/A/_folder.md" }` → `write_file` invoke is NOT called; `openFileInTab` IS called.
8. **FR-36 starter template**: `createFolderViewFile` called when `_folder.md` does NOT exist → `write_file` is called with `content = "---\nlayout: folder-cards\n---\n"`.
9. **FR-35 open after create**: After successful create, `openFileInTab("/vault/A/_folder.md")` is called.
10. **Error handling**: `write_file` throws → `showInlineError` is called; `openFileInTab` is NOT called.

### Visual verification (after running `npm run build:plugins && npm run sync:plugins`)

1. Right-click a directory that has `_folder.md` → first context menu item is "Open Folder View".
2. Click "Open Folder View" → Folder View tab opens (same as label click).
3. Right-click a directory WITHOUT `_folder.md` → "Create Folder View…" appears between "New Note" and "New Folder".
4. Click "Create Folder View…" → `_folder.md` is created and opened in the editor. The file browser re-detects the directory on the next render.
5. Right-click a directory WITHOUT `_folder.md` again immediately after creating (before index refresh) → EC-16 is confirmed by the absence of a duplicate write.
6. Right-click a Smart Folder → no "Open Folder View" or "Create Folder View…" items (EC-24).

**Run after this step**:
```
npm run build:plugins && npm run sync:plugins
```

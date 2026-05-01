---
title: "Step 03 — New Folder in File Menu + Auto-expand on Folder Creation"
last-updated: "2026-04-30"
review-cadence-days: 7
status: active
---

# Step 03 — "New Folder" in File Context Menu + Auto-expand on Folder Creation

## Goal

Fix two related gaps in `src/plugins/file-browser/file-browser.plugin.ts`:

1. Add a "New Folder" item to `buildFileContextMenuItems` (Gap 2 / FR-12).
2. After `create_directory` succeeds in `buildInlineInputNode`, add the parent directory
   (`dirPath`) to `_expandedPaths` and persist the expanded state before reloading the
   vault index (Gap 3 / FR-7 / EC-14).

---

## File: `src/plugins/file-browser/file-browser.plugin.ts`

### Change 1 — "New Folder" in `buildFileContextMenuItems`

Current `buildFileContextMenuItems` returns:

```typescript
return [
  {
    label: "New Note",
    handler: () => {
      if (!container) return;
      showInlineCreateInput(parentDir, container, vaultId);
    },
  },
  { separator: true, label: "", handler: null },
  // ... Rename, Delete, Move to…, Open in Finder, Copy Path
];
```

Add "New Folder" immediately after "New Note" (before the first separator):

```typescript
return [
  {
    label: "New Note",
    handler: () => {
      if (!container) return;
      showInlineCreateInput(parentDir, container, vaultId);
    },
  },
  {
    label: "New Folder",
    handler: () => {
      if (!container) return;
      showInlineFolderCreateInput(parentDir, container, vaultId);
    },
  },
  { separator: true, label: "", handler: null },
  // ... Rename, Delete, Move to…, Open in Finder, Copy Path (unchanged)
];
```

Both "New Note" and "New Folder" use `parentDir` (derived from `getParentDir(path)` at the
top of `buildFileContextMenuItems`) so both items create siblings of the right-clicked file,
consistent with FR-12.

### Change 2 — Auto-expand parent after folder creation in `buildInlineInputNode`

The current folder-creation success branch in `buildInlineInputNode` (lines 2350–2358):

```typescript
// BEFORE
} else {
  const newDir = (dirPath.endsWith("/") ? dirPath : dirPath + "/") + name;
  try {
    await (window as any).__TAURI_INTERNALS__?.invoke?.("create_directory", { path: newDir });
    await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
  } catch (err) {
    errSpan.textContent = String(err);
    return;
  }
}
```

Replace with:

```typescript
// AFTER
} else {
  const newDir = (dirPath.endsWith("/") ? dirPath : dirPath + "/") + name;

  // Pre-check: folder collision via vault index (best-effort, advisory only).
  // The vault index only tracks .md files, so scan entries for any file whose
  // path starts with the would-be directory prefix. This catches the common
  // case where the folder already exists and contains notes.
  const vaultIndex = (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.();
  const prefix = newDir.endsWith("/") ? newDir : newDir + "/";
  if (vaultIndex?.entries?.some((e: { path: string }) => e.path.startsWith(prefix))) {
    errSpan.textContent = `"${name}" already exists here.`;
    return;
  }

  try {
    await (window as any).__TAURI_INTERNALS__?.invoke?.("create_directory", { path: newDir });
  } catch (err) {
    errSpan.textContent = String(err);
    return;
  }

  // Add the parent directory to _expandedPaths so the new folder is visible
  // after the tree re-renders (EC-14 / FR-7 step b).
  _expandedPaths.add(dirPath);
  scheduleSettingsSave(vaultId);

  try {
    await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
  } catch (err) {
    console.error("[file-browser] vault reload failed after create_directory:", err);
  }
}
```

Key points:
- The pre-check is advisory. If the folder exists but contains no `.md` files, the check
  will not detect it and `create_directory` will succeed silently (idempotent). This is
  the acceptable behaviour noted in FR-7 step 4.
- `_expandedPaths.add(dirPath)` runs only after `create_directory` succeeds, not before.
- `scheduleSettingsSave(vaultId)` persists the new expanded state so it survives panel
  reopens (EC-14 / FR-7 step b via `scheduleSettingsSave` existing debounce).
- Vault reload failure is caught and logged separately, consistent with EC-9 pattern.

### Change 3 — Fix `_vaultId` parameter in `buildInlineInputNode`

The `buildInlineInputNode` function signature currently uses `_vaultId` (underscore prefix
to mark it unused). Now that the folder-creation branch uses `vaultId` to call
`scheduleSettingsSave`, rename the parameter:

```typescript
// BEFORE
function buildInlineInputNode(
  dirPath: string,
  container: HTMLElement,
  _vaultId: string,
  kind: "file" | "directory",
): HTMLElement {
```

```typescript
// AFTER
function buildInlineInputNode(
  dirPath: string,
  container: HTMLElement,
  vaultId: string,
  kind: "file" | "directory",
): HTMLElement {
```

All three call sites already pass a real `vaultId` argument — this rename has no runtime
effect, it only allows using `vaultId` inside the function body.

### `_testing` export additions

Add the following entry to the `_testing` export object:

```typescript
/** Expose buildFileContextMenuItems for testing. */
buildFileContextMenuItems,
```

---

## Acceptance Criteria

1. Right-clicking a file node shows a context menu that includes both "New Note" and "New Folder".
2. "New Folder" in the file context menu calls `showInlineFolderCreateInput` with `getParentDir(path)` — the folder is a sibling of the file, not inside it.
3. After successful folder creation, `_expandedPaths` contains `dirPath`.
4. After successful folder creation, `scheduleSettingsSave` is called (verifiable via `_api.saveSettings` mock being called within the debounce window).
5. The folder-collision pre-check: if any vault index entry starts with `newDir + "/"`, `errSpan.textContent` is set to `"\"name\" already exists here."` and no Tauri call is made.
6. `create_directory` failure sets `errSpan.textContent` and does not proceed to `_expandedPaths.add`.
7. Vault reload failure after `create_directory` success is caught and logged; `_expandedPaths` still contains `dirPath`.

---

## TDD Notes

Tests for this step live in Suite D (file context menu) and Suite E (folder auto-expand)
of `tests/plugins/file-browser/create-file-folder.test.ts`.

For Suite E, the test must:
1. Set `_testing.setTreeEl(ul)`, `_testing.setExpandedPaths(new Set())`.
2. Mock `__TAURI_INTERNALS__.invoke` to resolve on `create_directory`.
3. Call `_testing.showInlineFolderCreateInput("/notes/work", container, "v1")`.
4. Find the input element in the newly-inserted `<li>`.
5. Simulate typing a name and pressing Enter.
6. Assert `_testing.getExpandedPaths().has("/notes/work")` is true after the async commit.

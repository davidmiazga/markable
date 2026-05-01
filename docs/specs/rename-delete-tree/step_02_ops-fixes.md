---
title: step_02 — Fix file-browser-ops.ts (extension handling, tab manager calls, redundant reloads)
last-updated: "2026-04-30"
review-cadence-days: 90
status: active
---

# step_02 — Fix `file-browser-ops.ts`

## Prerequisites

step_01 complete and green. `TabManager` now exposes `handleFileRename` and
`closeFileByPath`.

---

## File to edit

`src/plugins/file-browser/file-browser-ops.ts`

---

## Change 1: `renameNode` — fix extension handling and tab manager call

### Current code (lines 299–338)

```typescript
export async function renameNode(
  oldPath: string,
  newName: string,
  container: HTMLElement,
): Promise<void> {
  const oldStem = getFileStem(oldPath);
  const trimmed = newName.trim();
  const stem = trimmed.endsWith(".md") ? trimmed.slice(0, -3) : trimmed;

  const validationError = validateFilename(stem);
  if (validationError) {
    showInlineError(container, validationError);
    return;
  }

  const parentDir = getParentDir(oldPath);
  const isFile = oldPath.endsWith(".md");           // BUG: only .md files
  const newFileName = isFile ? stem + ".md" : stem; // BUG: hardcodes .md
  const newPath = (parentDir.endsWith("/") ? parentDir : parentDir + "/") + newFileName;

  if (filenameExistsInDir(parentDir, newFileName)) {
    showInlineError(container, `"${stem}" already exists in this folder.`);
    return;
  }

  await invoke("rename_file", { oldPath, newPath });

  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();

  // BUG: renameFile does not exist on TabManager
  (window as any).__MARKABLE_TAB_MANAGER__?.renameFile?.(oldPath, newPath);

  if (isFile && oldStem !== stem) {
    checkAndShowLinkBanner(container, oldStem, stem);
  }
}
```

### What to replace it with

```typescript
export async function renameNode(
  oldPath: string,
  newName: string,
  container: HTMLElement,
): Promise<void> {
  const trimmed = newName.trim();
  const oldBasename = getBasename(oldPath);

  // Determine the original extension (empty string for directories or
  // extension-less files). Extension = everything from the last dot onward,
  // but only when the dot is after position 0 and not the last character
  // (i.e. not a dotfile and not a trailing dot).
  const lastDot = oldBasename.lastIndexOf(".");
  const originalExt = (lastDot > 0 && lastDot < oldBasename.length - 1)
    ? oldBasename.slice(lastDot) // e.g. ".md", ".yaml", ".txt"
    : "";

  const isMdFile = originalExt === ".md";

  // For .md files the user edits the stem only; reconstruct with original ext.
  // For non-.md files (and directories) the user edits the full name as-is.
  const newFileName = isMdFile ? trimmed + ".md" : trimmed;

  // Validate the user-visible editable portion:
  //   .md files: validate the stem (trimmed, no extension).
  //   all others: validate the full new name (trimmed).
  const validationTarget = isMdFile ? trimmed : trimmed;
  const validationError = validateFilename(validationTarget);
  if (validationError) {
    showInlineError(container, validationError);
    return;
  }

  const parentDir = getParentDir(oldPath);
  const newPath = (parentDir.endsWith("/") ? parentDir : parentDir + "/") + newFileName;

  if (filenameExistsInDir(parentDir, newFileName)) {
    showInlineError(container, `"${trimmed}" already exists in this folder.`);
    return;
  }

  await invoke("rename_file", { oldPath, newPath });

  // Reload the vault index to reflect the rename in the tree.
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();

  // Notify the tab manager so the open tab's path and title update (FR-11).
  const isDirectory = originalExt === "";
  if (isDirectory) {
    // Directory rename: update all tabs whose paths start with oldPath + "/".
    const prefix = oldPath + "/";
    const tabs: Array<{ filePath: string | null }> =
      (window as any).__MARKABLE_TAB_MANAGER__?.getTabs?.() ?? [];
    for (const tab of tabs) {
      if (tab.filePath?.startsWith(prefix)) {
        const newTabPath = newPath + "/" + tab.filePath.slice(prefix.length);
        (window as any).__MARKABLE_TAB_MANAGER__?.handleFileRename?.(tab.filePath, newTabPath);
      }
    }
  } else {
    // File rename: update only the tab for this exact path.
    (window as any).__MARKABLE_TAB_MANAGER__?.handleFileRename?.(oldPath, newPath);
  }

  // Only show backlink banner when a .md file's stem actually changed (FR-16).
  if (isMdFile) {
    const oldStem = getFileStem(oldPath);
    const newStem = trimmed;
    if (oldStem !== newStem) {
      checkAndShowLinkBanner(container, oldStem, newStem);
    }
  }
}
```

### Key decisions

- `originalExt === ""` is the isDirectory check: a directory path has no extension
  in the basename. This is robust on macOS where directory names with dots are
  uncommon in vault contexts, and matches the Rust behaviour of using `rename_file`
  for both types.
- For non-`.md` files `validationTarget === trimmed` (the full new name). The
  comment clarifies this even though both branches resolve to the same value, so a
  future reader cannot accidentally optimise away the intent.
- `getTabs()` returns a shallow copy so iterating it while `handleFileRename`
  mutates the live array is safe.

---

## Change 2: `deleteFile` — use `closeFileByPath`, abort if declined

### Current code (lines 384–396)

```typescript
export async function deleteFile(path: string): Promise<void> {
  const stem = getFileStem(path);
  const confirmed = window.confirm(`Delete "${stem}.md"? This cannot be undone.`);
  if (!confirmed) return;

  await invoke("delete_file", { path });

  // BUG: closeFile does not exist on TabManager
  (window as any).__MARKABLE_TAB_MANAGER__?.closeFile?.(path);

  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
}
```

### What to replace it with

```typescript
export async function deleteFile(path: string): Promise<void> {
  const basename = getBasename(path);
  const confirmed = window.confirm(`Delete "${basename}"? This cannot be undone.`);
  if (!confirmed) return;

  // Close the open tab (if any). If the user declines the unsaved-changes
  // dialog, closeFileByPath returns false and the delete is aborted (EC-9).
  const tm = (window as any).__MARKABLE_TAB_MANAGER__;
  if (tm?.closeFileByPath) {
    const canProceed: boolean = await tm.closeFileByPath(path);
    if (!canProceed) return;
  }

  await invoke("delete_file", { path });

  // Vault index reload triggers onVaultChanged → renderPanel (FR-15).
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
}
```

### Notes

- The confirmation text is changed from `"${stem}.md"` to `"${basename}"` so that
  non-`.md` files show the correct name (e.g. `config.yaml` not `config.yaml.md`).
- The tab manager guard is retained as a `?.closeFileByPath` optional chain so the
  function degrades gracefully in tests or early-startup races (EC-19).
- Do NOT add `reloadAndRender` here. `reloadVaultIndex` is sufficient.

---

## Change 3: `deleteDirectory` — collect tabs first, abort if any close is declined

### Current code (lines 407–421)

```typescript
export async function deleteDirectory(path: string): Promise<void> {
  const dirName = getBasename(path);
  const confirmed = window.confirm(
    `Delete folder "${dirName}" and all its contents? This cannot be undone.`,
  );
  if (!confirmed) return;

  // BUG: closeTabsUnder uses the broken closeFile pattern
  await closeTabsUnder(path);

  await invoke("delete_directory", { path });
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
}
```

### What to replace it with

```typescript
export async function deleteDirectory(path: string): Promise<void> {
  const dirName = getBasename(path);
  const confirmed = window.confirm(
    `Delete folder "${dirName}" and all its contents? This cannot be undone.`,
  );
  if (!confirmed) return;

  // Collect affected tabs before closing any, so the iteration set is stable
  // even as closeFileByPath mutates the live tab array (EC-10).
  const aborted = await closeTabsUnder(path);
  if (aborted) return;

  await invoke("delete_directory", { path });

  // Vault index reload triggers onVaultChanged → renderPanel (FR-15).
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
}
```

---

## Change 4: `closeTabsUnder` — rewrite using `getTabs` + `closeFileByPath`

### Current code (lines 432–446)

```typescript
async function closeTabsUnder(dirPath: string): Promise<void> {
  const tm = (window as any).__MARKABLE_TAB_MANAGER__;
  if (!tm?.closeFile) return;

  const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  const vaultIndex = ...;
  if (!vaultIndex) return;

  for (const entry of vaultIndex.entries) {
    if (entry.path.startsWith(prefix)) {
      await tm.closeFile(entry.path);  // BUG: closeFile does not exist
    }
  }
}
```

### What to replace it with

The return type changes from `Promise<void>` to `Promise<boolean>` (true = abort).

```typescript
/**
 * Close all open tabs whose filePath starts with `dirPath + "/"`.
 *
 * Collects the full list of affected tab paths before closing any, so the
 * iteration is not affected by mutations to the tab array mid-loop (EC-10).
 *
 * Returns true if the delete should be aborted (the user declined at least
 * one unsaved-changes dialog). Returns false if all tabs were successfully
 * closed (or no tabs were open under this directory).
 *
 * @param dirPath - Absolute path of the directory being deleted.
 * @returns true = abort delete; false = proceed.
 */
async function closeTabsUnder(dirPath: string): Promise<boolean> {
  const tm = (window as any).__MARKABLE_TAB_MANAGER__;
  if (!tm?.getTabs || !tm?.closeFileByPath) return false;

  const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";

  // Snapshot the matching paths before closing any tabs.
  const pathsToClose: string[] = (tm.getTabs() as Array<{ filePath: string | null }>)
    .filter((t) => t.filePath?.startsWith(prefix))
    .map((t) => t.filePath as string);

  for (const filePath of pathsToClose) {
    const canProceed: boolean = await tm.closeFileByPath(filePath);
    if (!canProceed) return true; // User declined — abort.
  }

  return false; // All tabs closed (or no tabs were open).
}
```

---

## Change 5: `moveNode` — update `renameFile` call to `handleFileRename`

### Current code (line 482)

```typescript
(window as any).__MARKABLE_TAB_MANAGER__?.renameFile?.(sourcePath, newPath);
```

### Replace with

```typescript
(window as any).__MARKABLE_TAB_MANAGER__?.handleFileRename?.(sourcePath, newPath);
```

---

## Test file to create

`tests/plugins/file-browser/rename-delete-ops.test.ts`

### Test cases required

Use the same fixture helpers (`makeVaultIndex`, `makeContainer`) from
`tests/plugins/file-browser/create-file-folder.test.ts`.

**`renameNode` tests**

1. Renames a `.md` file: calls `invoke("rename_file", ...)` with `newPath` ending in
   `.md`, and calls `handleFileRename` with the correct paths.
2. Renames a `.yaml` file: `newPath` ends in `.yaml` (not `.md`); `handleFileRename`
   is called with `oldPath` and the `.yaml` newPath.
3. Renames a directory: `handleFileRename` is called once per open tab inside the
   directory, with the prefix-substituted new path.
4. Shows inline error when `validateFilename` fails.
5. Shows inline error when `filenameExistsInDir` returns true.
6. Shows backlink banner when a `.md` file stem changes.
7. Does NOT show backlink banner when a non-`.md` file is renamed.
8. Does NOT show backlink banner when a `.md` stem is unchanged (EC-1).

**`deleteFile` tests**

9. Calls `closeFileByPath` before `invoke("delete_file", ...)`.
10. Aborts (no `invoke` call) when `closeFileByPath` returns false.
11. Aborts when `window.confirm` returns false.
12. Does NOT call `reloadAndRender` (verify by checking no extra `reloadVaultIndex`
    calls beyond the one inside `deleteFile`).

**`deleteDirectory` tests**

13. Calls `closeTabsUnder` logic: collects tabs whose filePath starts with prefix.
14. Aborts entire delete when one `closeFileByPath` returns false.
15. Calls `invoke("delete_directory", ...)` when all tabs close successfully.
16. Aborts when `window.confirm` returns false.

**`closeTabsUnder` tests** (test via `deleteDirectory` behaviour)

17. Returns false (proceed) when no tabs are open under the directory.
18. Returns true (abort) when any tab's `closeFileByPath` returns false.

### Mock pattern

```typescript
beforeEach(() => {
  invokeMock = vi.fn().mockResolvedValue(undefined);
  (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getVaultIndex: vi.fn(() => makeVaultIndex([])),
    reloadVaultIndex: vi.fn().mockResolvedValue(undefined),
  };
  closeFileByPathMock = vi.fn().mockResolvedValue(true);
  handleFileRenameMock = vi.fn();
  getTabsMock = vi.fn().mockReturnValue([]);
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    handleFileRename: handleFileRenameMock,
    closeFileByPath: closeFileByPathMock,
    getTabs: getTabsMock,
  };
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
```

---

## Verification

```bash
npm run test:run -- tests/plugins/file-browser/rename-delete-ops.test.ts
```

All tests must pass. Also run the full suite to confirm no regressions:

```bash
npm run test:run
```

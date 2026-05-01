---
title: "Step 04 — New File / New Folder in Vault Root Context Menu"
last-updated: "2026-04-30"
review-cadence-days: 7
status: active
---

# Step 04 — "New File" / "New Folder" in Vault Root Context Menu

## Goal

Add "New File" and "New Folder" as the first two items in `buildVaultContextMenuItems`
so that right-clicking the vault root node (the bold vault name at the top of the tree)
offers the same creation affordances as right-clicking a directory (EC-17).

Only `buildVaultContextMenuItems` changes in this step.

---

## File: `src/plugins/file-browser/file-browser.plugin.ts`

### Background

`buildVaultContextMenuItems` is called from `handleContextMenu` when `type === "vault"`.
The `_path` parameter is currently unused (passed for API consistency). It is equal to
`activeVault.rootPaths[0]` in practice — but rather than relying on that, we read
`rootPaths[0]` directly from `activeVault` so the intent is clear and matches what
`buildAddRow` does.

### Current implementation (lines 2122–2158)

```typescript
function buildVaultContextMenuItems(
  el: HTMLElement,
  _path: string,
  vaultId: string,
): Array<...> {
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const activeVault = vm?.getActiveVault?.();

  return [
    { label: "Unmount", handler: ... },
    { label: "Rename", handler: ... },
    { separator: true, label: "", handler: null },
    { label: "Edit Type", handler: ... },
  ];
}
```

### Replacement

```typescript
function buildVaultContextMenuItems(
  el: HTMLElement,
  _path: string,
  vaultId: string,
): Array<{ label: string; handler: (() => void) | null; disabled?: boolean; separator?: boolean }> {
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const activeVault = vm?.getActiveVault?.();
  const rootPath: string = activeVault?.rootPaths?.[0] ?? "";
  const container = _panelContainer;

  return [
    {
      label: "New File",
      handler: () => {
        if (!container || !rootPath) return;
        showInlineCreateInput(rootPath, container, vaultId);
      },
    },
    {
      label: "New Folder",
      handler: () => {
        if (!container || !rootPath) return;
        showInlineFolderCreateInput(rootPath, container, vaultId);
      },
    },
    { separator: true, label: "", handler: null },
    {
      label: "Unmount",
      handler: () => {
        const isActive = activeVault?.id === vaultId;
        if (isActive) {
          const name = activeVault.name ?? "this vault";
          const confirmed = window.confirm(
            `Unmount "${name}"? You can re-add it later. Your notes are not deleted.`,
          );
          if (!confirmed) return;
        }
        /* EC-VUX-02: silent unmount for inactive vaults */
        void vm?.deleteVault?.(vaultId);
      },
    },
    {
      label: "Rename",
      /* Delegates to startVaultInlineRename — same behaviour as double-click */
      handler: () => void startVaultInlineRename(el),
    },
    { separator: true, label: "", handler: null },
    {
      label: "Edit Type",
      /* Opens Manage Vaults modal focused on the edit form for this vault */
      handler: () => openManageVaultsModal(vaultId),
    },
  ];
}
```

Key points:
- "New File" and "New Folder" are first (before any separator), consistent with the
  directory context menu ordering.
- A separator appears between the creation items and the vault management items.
- The existing Unmount, Rename, and Edit Type items are reproduced verbatim.
- `rootPath` guard: if `activeVault` is null (EC-1) or `rootPaths` is empty, `rootPath`
  is `""` and the handler returns early — no crash, no Tauri call.
- `container` guard: if `_panelContainer` is null (EC-18), the handler returns early.

---

## Acceptance Criteria

1. Right-clicking the vault root node shows "New File", "New Folder", a separator, then "Unmount", "Rename", a separator, then "Edit Type".
2. Clicking "New File" calls `showInlineCreateInput(rootPaths[0], container, vaultId)`.
3. Clicking "New Folder" calls `showInlineFolderCreateInput(rootPaths[0], container, vaultId)`.
4. When `activeVault` is null, the "New File" and "New Folder" handlers return without error (EC-1).
5. When `_panelContainer` is null, the handlers return without error (EC-18).
6. Existing "Unmount", "Rename", "Edit Type" behaviour is unchanged.

---

## TDD Notes

Tests for this step live in Suite F of `tests/plugins/file-browser/create-file-folder.test.ts`.

The existing `buildVaultContextMenuItems` tests in `file-browser.test.ts` (vault-ux.test.ts
section) test only Unmount/Rename/Edit Type. The new test suite must verify the "New File"
and "New Folder" items are present at index 0 and 1 of the returned array.

Use `_testing.buildVaultContextMenuItems` which is already exported.

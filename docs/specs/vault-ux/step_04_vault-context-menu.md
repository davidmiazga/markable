# Step 04 — Vault Node Context Menu (Unmount / Rename / Edit Type)

**File to modify**: `src/plugins/file-browser/file-browser.plugin.ts`
**Dependency**: step_02 (unmount logic) and step_03 (`startVaultInlineRename`) must be complete.

---

## Goal

Replace the current vault node context menu (which has "New Vault…", "Edit Vault…", "Delete Vault…") with the new design:

| Item | Action |
|---|---|
| Unmount | Disconnects the vault from Markable without deleting files |
| Rename | Triggers the same inline rename as double-click |
| Edit Type | Opens Manage Vaults modal focused on that vault's edit form |

---

## Current `buildVaultContextMenuItems()`

```ts
function buildVaultContextMenuItems(_el, _path, vaultId) {
  return [
    { label: "New Vault…",    handler: () => openManageVaultsModal() },
    { label: "Edit Vault…",   handler: () => openManageVaultsModal(vaultId) },
    { separator: true, label: "", handler: null },
    { label: "Delete Vault…", handler: /* confirm + deleteVault */ },
  ];
}
```

---

## New `buildVaultContextMenuItems()`

Replace the entire function body:

```ts
/**
 * Build the context menu items for a vault root node.
 *
 * Items:
 *   Unmount  — calls deleteVault (removes from Markable, does not touch disk files).
 *              Confirms first when the vault is active (EC-VUX-01).
 *   Rename   — activates inline rename on the row (same as double-click).
 *   Edit Type — opens Manage Vaults modal focused on this vault's edit form.
 *
 * @param el      - The vault <li> element.
 * @param _path   - Vault path (unused).
 * @param vaultId - The ID of the vault node that was right-clicked.
 */
function buildVaultContextMenuItems(
  el: HTMLElement,
  _path: string,
  vaultId: string,
): Array<{ label: string; handler: (() => void) | null; disabled?: boolean; separator?: boolean }> {
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const activeVault = vm?.getActiveVault?.();

  return [
    {
      label: "Unmount",
      handler: () => {
        const isActive = activeVault?.id === vaultId;
        if (isActive) {
          const name = activeVault.name ?? "this vault";
          const confirmed = window.confirm(
            `Unmount "${name}"? You can re-add it later. Your notes are not deleted.`
          );
          if (!confirmed) return;
        }
        void vm?.deleteVault?.(vaultId);
      },
    },
    {
      label: "Rename",
      handler: () => void startVaultInlineRename(el),
    },
    { separator: true, label: "", handler: null },
    {
      label: "Edit Type",
      handler: () => openManageVaultsModal(vaultId),
    },
  ];
}
```

---

## What Changes vs What Stays

| Old item | New item | Notes |
|---|---|---|
| "New Vault…" | Removed | Creating vaults is now via "+ Add…" row (step_01) |
| "Edit Vault…" | Renamed to "Edit Type" | Same `openManageVaultsModal(vaultId)` call |
| "Delete Vault…" | Renamed to "Unmount" | Same `deleteVault` call; confirm logic matches step_02 |
| (new) "Rename" | Added | Delegates to `startVaultInlineRename(el)` from step_03 |

---

## "Ctrl-click" as Right-click

The existing `handleContextMenu` handler is wired to `contextmenu` events only. The user brief mentions "Ctrl-click" as an alternative trigger. On macOS, `Ctrl-click` naturally fires `contextmenu` events in Tauri's WebView (this is standard browser behaviour). No additional wiring is needed.

---

## Acceptance Criteria

1. Right-clicking (or Ctrl-clicking) a vault row shows the three-item menu: Unmount, Rename, Edit Type.
2. "Unmount" on an inactive vault silently removes it. No dialog.
3. "Unmount" on the active vault shows a `window.confirm()` before removing.
4. "Rename" activates the inline rename input on the vault row (same as double-click, per step_03).
5. "Edit Type" opens the Manage Vaults modal focused on the edit form for that specific vault.
6. The old "New Vault…", "Edit Vault…", "Delete Vault…" items no longer appear.

---

## Tests (step_06 covers)

- `buildVaultContextMenuItems` returns exactly three non-separator items: Unmount, Rename, Edit Type.
- Clicking "Unmount" on inactive vault calls `vm.deleteVault` without `window.confirm`.
- Clicking "Unmount" on active vault calls `window.confirm` before `vm.deleteVault`.
- Clicking "Rename" calls `startVaultInlineRename(el)`.
- Clicking "Edit Type" calls `openManageVaultsModal(vaultId)`.

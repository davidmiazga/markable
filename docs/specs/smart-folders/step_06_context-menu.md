---
title: Step 06 — Context menu integration & lifecycle (rename, delete, new)
last-updated: "2026-05-08"
review-cadence-days: 30
status: active
---

# Step 06 — Context menu integration & lifecycle (rename, delete, new)

## Goal

Wire the right-click context menu and the "+ New Smart Folder" entry
points (FR-21, FR-22, FR-24, FR-25). Reuses the existing
`showContextMenu` factory so this step is mostly **dispatch**, not new
infrastructure.

After this step, the user can:

- Right-click a Smart Folder row → `Edit Filters | Rename | Delete`.
- Right-click the vault root → see "New Smart Folder" alongside
  "New File" / "New Folder".
- Click the Add row's "+" button → see "New Smart Folder" in the menu.
- Inline-rename a Smart Folder (name only, rules untouched — FR-24).
- Delete a Smart Folder (with confirmation) and have its expansion
  state purged (FR-25, EC-06).

---

## Files to create

1. `src/plugins/file-browser/smart-folders/context-menu.ts` — the items
   factory and lifecycle helpers.

## Files to modify

1. `src/plugins/file-browser/smart-folders/index.ts` — add `renameSmartFolder`
   and `deleteSmartFolder` to the public surface.
2. `file-browser.plugin.ts` — three small dispatch additions:
   1. In `handleContextMenu`: branch on `data-smart-folder-id` before
      directory branch.
   2. In `buildVaultContextMenuItems`: insert "New Smart Folder".
   3. In `buildAddRow`: insert "New Smart Folder" in the menu.

---

## 1. `context-menu.ts` — items factory

### Required exports

```typescript
import type { MenuItem } from "../file-browser.plugin";       // adjust to actual type / inline locally
import type { SmartFolderDef } from "./types";

/** Items shown when a smart-folder row is right-clicked. */
export function buildSmartFolderContextMenuItems(
  el: HTMLElement,                  // the <li> element
  def: SmartFolderDef,              // current def (for Rename's initial value)
  vaultRootPath: string,            // for Edit Filters anchorPath
): MenuItem[];
```

The shape of `MenuItem` matches the existing `Array<{ label, handler,
disabled?, separator? }>` type used by `showContextMenu`. If the type
isn't already exported, inline the type locally (the file-browser already
inlines this same shape in multiple places).

### Items

```typescript
return [
  {
    label: "Edit Filters",
    handler: () => openFilterEditor({
      mode: "edit",
      anchorPath: el.getAttribute("data-path") ?? "",
      def,
    }),
  },
  {
    label: "Rename",
    handler: () => startSmartFolderInlineRename(el, def.id),
  },
  { separator: true, label: "", handler: null },
  {
    label: "Delete",
    handler: () => confirmAndDelete(def),
  },
];
```

### `startSmartFolderInlineRename` algorithm

Mirrors the existing `startInlineRename` in `file-browser.plugin.ts`
(lines 2517+). Reuses the same DOM technique:

```text
const labelEl = el.querySelector(".tree-node-label")
const input = create text input pre-filled with def.name
labelEl.replaceWith(input)
input.focus(); input.select()

on Enter: commit
on Escape | blur: cancel and restore label

commit:
  const newName = input.value.trim()
  if (!newName) → cancel (restore)
  await renameSmartFolder(def.id, newName)
  renderPanel()                  // existing
```

`renameSmartFolder(id, newName)` lives in `index.ts`:

```typescript
export async function renameSmartFolder(id: string, newName: string): Promise<void> {
  const idx = _smartFolders.findIndex(d => d.id === id);
  if (idx < 0) return;
  _smartFolders[idx] = { ..._smartFolders[idx], name: newName };
  await saveSmartFolders(_api, activeVaultId(), _smartFolders);
  // No re-evaluation needed — rules are unchanged. But existing result
  // map already keys by id, so just re-render.
}
```

**EC-05 verification**: rename does NOT change the id, so
`expandedPaths.has("__smart__/<id>")` is preserved automatically across
rebuild.

### `confirmAndDelete` algorithm

```text
const confirmed = window.confirm(
  `Delete Smart Folder "${def.name}"? This cannot be undone. Files are not affected.`
)
if (!confirmed) return

await deleteSmartFolder(def.id)
```

`deleteSmartFolder(id)` in `index.ts`:

```typescript
export async function deleteSmartFolder(id: string): Promise<void> {
  _smartFolders = _smartFolders.filter(d => d.id !== id);

  // Purge expansion state — EC-06.
  const synth = smartFolderPath(id);
  _expandedPaths.delete(synth);

  await saveSmartFolders(_api, activeVaultId(), _smartFolders);
  scheduleSettingsSave(activeVaultId());      // also persists the cleaned expandedPaths

  // Drop result entry so renderer doesn't synthesize a stale node.
  removeEvaluationResult(id);

  renderPanel();
}
```

`removeEvaluationResult(id)` is added to step_02's evaluator state:

```typescript
export function removeEvaluationResult(id: string): void {
  _evaluationResults.delete(id);
}
```

**EC-06 specifics**: purging `expandedPaths` AND removing the result
together ensures no stale DOM survives the next render. Existing
`diffTree` reports `toRemove` for the path, which the incremental
update path can consume — but because we call `renderPanel()` (full
render), the simpler full-rebuild path catches it deterministically.

---

## 2. Modify `handleContextMenu` (file-browser.plugin.ts)

Around line 2467:

```typescript
function handleContextMenu(e: MouseEvent, el: HTMLElement, vaultId: string): void {
  e.preventDefault();
  e.stopPropagation();

  const type = el.getAttribute("data-type") as "vault" | "directory" | "file" | null;
  const path = el.getAttribute("data-path") ?? "";
  const sfId = el.getAttribute("data-smart-folder-id");

  // Folder selection update — preserved …

  let items: MenuItem[];

  if (sfId !== null) {
    // Smart Folder row — NEW BRANCH.
    const def = _smartFolders.find(d => d.id === sfId);
    if (!def) return;
    const vaultRoot = (window as any).__MARKABLE_VAULT_MANAGER__
      ?.getActiveVault?.()?.rootPaths?.[0] ?? "";
    items = buildSmartFolderContextMenuItems(el, def, vaultRoot);
  } else if (type === "file") {
    items = buildFileContextMenuItems(el, path, vaultId);
  } else if (type === "directory") {
    items = buildDirContextMenuItems(el, path, vaultId);
  } else {
    items = buildVaultContextMenuItems(el, path, vaultId);
  }

  showContextMenu(items, e.clientX, e.clientY);
}
```

The branch order matters: smart-folder before directory, because
smart-folder rows have `data-type="directory"` (per FR-15 they reuse
the directory shape).

---

## 3. Modify `buildVaultContextMenuItems` (file-browser.plugin.ts)

Insert "New Smart Folder" between "New Folder" and the separator
before "Unmount". Around line 2422:

```typescript
{
  label: "New Folder",
  handler: () => {
    const container = _panelContainer;
    if (!container || !rootPath) return;
    showInlineFolderCreateInput(rootPath, container, vaultId);
  },
},
// NEW — FR-22:
{
  label: "New Smart Folder",
  handler: () => openFilterEditor({ mode: "create", anchorPath: rootPath }),
},
{ separator: true, label: "", handler: null },
{
  label: "Unmount",
  // …
},
```

---

## 4. Modify `buildAddRow` (file-browser.plugin.ts)

Add "New Smart Folder" after "New Folder" in the `showContextMenu` call
inside the click handler. Around line 1419:

```typescript
showContextMenu(
  [
    { label: "New File", handler: …  },
    { label: "New Folder", handler: …  },
    { label: "New Smart Folder",
      handler: () => {
        const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
        const rootPath: string = vaultManager?.getActiveVault?.()?.rootPaths?.[0] ?? "";
        openFilterEditor({ mode: "create", anchorPath: rootPath });
      },
    },
    { separator: true, label: "", handler: null },
    { label: "New Vault…", handler: () => openNewVaultModal() },
  ],
  e.clientX,
  e.clientY,
);
```

This satisfies FR-22's "small button at the top of the file browser
panel" — the existing add row IS that button. No new toolbar button.

---

## 5. Reuse the empty-state new-vault row?

If the user has zero smart folders for the active vault, no extra UI
is needed (EC-02). The Add row's menu and the vault root's right-click
menu are sufficient entry points.

---

## Tests to pass after this step

Create `tests/plugins/file-browser/smart-folders.context-menu.test.ts`:

| Test name | Asserts |
|---|---|
| `right-click on smart-folder li shows Edit/Rename/Delete` | FR-21 |
| `Edit Filters opens editor in edit mode anchored to the row` | FR-21 |
| `Rename swaps label for input` | FR-24 + EC-23 mirror |
| `Rename Enter commits, label updates` | FR-24 |
| `Rename does not change id` | EC-05 |
| `Rename Escape restores original label` | parity |
| `Delete prompts confirm; cancel keeps def` | UX |
| `Delete confirm removes def, purges expandedPaths['__smart__/<id>']` | FR-25, EC-06 |
| `Delete confirm purges _evaluationResults entry` | EC-06 |
| `Vault-root right-click menu has 'New Smart Folder' item` | FR-22 |
| `Add row menu has 'New Smart Folder' item` | FR-22 |
| `New Smart Folder opens editor in create mode anchored to vault root` | FR-22 |

---

## Done when

- [ ] Lifecycle test suite passes.
- [ ] Manual smoke: create → rename → expand → edit filters → delete.
- [ ] No regressions in existing context-menu tests
      (`tests/plugins/file-browser/file-browser.test.ts`).

---

## Constraints

- Reuse `showContextMenu` verbatim — do NOT create a parallel menu
  factory.
- Reuse the inline-rename DOM technique from `startInlineRename` —
  mimic its lifecycle (Enter, Escape, blur).
- Each function ≤ 30 lines.
- Confirmation for Delete is a `window.confirm` (matches existing
  vault-unmount UX). A custom modal is out of scope for v1.

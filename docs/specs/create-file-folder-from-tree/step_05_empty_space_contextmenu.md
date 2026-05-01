---
title: "Step 05 — Empty-Tree-Space Context Menu"
last-updated: "2026-04-30"
review-cadence-days: 7
status: active
---

# Step 05 — Empty-Tree-Space Context Menu

## Goal

Attach a `contextmenu` listener to the `.file-tree-card` element so that right-clicking
empty space below the tree nodes (where no `<li class="tree-node">` was clicked) shows
a "New File" / "New Folder" menu at the vault root (FR-4 / Finding 8).

The existing node-level `contextmenu` listeners must continue to fire without interference.

---

## File: `src/plugins/file-browser/file-browser.plugin.ts`

### Where to add the listener

The listener is attached to the `card` element inside `buildTreeUl`. `buildTreeUl` is
the function that creates `<div class="file-tree-card">`, creates `_treeEl`, renders
nodes, and appends `buildAddRow`. The card is created fresh on every `renderPanel` call
(via `renderTreeContent` → `buildTreeUl`), so the listener is garbage-collected with it
— no manual cleanup required.

### The function `buildTreeUl` currently ends with:

```typescript
card.appendChild(ul);
card.appendChild(buildAddRow(vaultId));
wrapper.appendChild(card);
```

### New code — add the contextmenu listener to `card` before `wrapper.appendChild(card)` inside `buildTreeUl`

```typescript
// Attach empty-space contextmenu listener (FR-4).
card.addEventListener("contextmenu", (e: MouseEvent) => {
  // If the click was on or inside a .tree-node, let the node's own handler fire.
  if ((e.target as Element).closest(".tree-node")) return;

  e.preventDefault();
  e.stopPropagation();

  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const activeVault = vm?.getActiveVault?.();
  const rootPath: string = activeVault?.rootPaths?.[0] ?? "";
  const container = _panelContainer;

  if (!rootPath || !container) return;

  showContextMenu(
    [
      {
        label: "New File",
        handler: () => showInlineCreateInput(rootPath, container, vaultId),
      },
      {
        label: "New Folder",
        handler: () => showInlineFolderCreateInput(rootPath, container, vaultId),
      },
    ],
    e.clientX,
    e.clientY,
  );
});

card.appendChild(ul);
card.appendChild(buildAddRow(vaultId));
wrapper.appendChild(card);
```

Key points:

**Guard: `(e.target as Element).closest(".tree-node")`**
If the user right-clicks on a `.tree-node` element (or any descendant of one), this
guard returns a truthy element and the function returns immediately — letting the
`contextmenu` listener attached by `attachNodeListeners` on the individual `<li>` handle
it. The node's listener calls `e.stopPropagation()`, so in practice the card-level
listener will never receive a node click — but the guard is a defensive belt-and-suspenders
for any future cases where `stopPropagation` is not called.

**Guard: `!rootPath || !container`**
If there is no active vault or no panel container, return silently (EC-1, EC-18).

**`e.preventDefault()` and `e.stopPropagation()`**
`preventDefault()` suppresses the browser's native context menu. `stopPropagation()`
prevents the event bubbling further up the DOM (though in a Tauri WKWebView context
there is no meaningful parent handler, this is defensive).

**Listener lifetime**
The card element is created inside `buildTreeUl`, which is called from `renderTreeContent`
on every `renderPanel`. The listener is automatically garbage-collected when the card is
replaced. There is no `removeEventListener` needed.

**Empty `<ul>` state**
When the vault has no files, `_treeEl` is an empty `<ul>` inside `card`. The card is
still rendered and the contextmenu listener fires correctly on the empty area.

---

## Acceptance Criteria

1. Right-clicking empty space in the `.file-tree-card` (not on a `.tree-node`) shows a context menu with "New File" and "New Folder".
2. "New File" calls `showInlineCreateInput(rootPaths[0], container, vaultId)`.
3. "New Folder" calls `showInlineFolderCreateInput(rootPaths[0], container, vaultId)`.
4. Right-clicking on a `.tree-node` does not show the empty-space menu — the node's own menu fires instead (EC-16).
5. Right-clicking empty space when `activeVault` is null shows nothing (EC-1).
6. Right-clicking empty space when `_panelContainer` is null shows nothing (EC-18).

---

## TDD Notes

Tests for this step live in Suite G of `tests/plugins/file-browser/create-file-folder.test.ts`.

Test setup:
1. Call `renderPanel()` via `_testing.renderPanel()` with a vault and index mock.
2. Locate `_panelContainer.querySelector(".file-tree-card")`.
3. Dispatch a `contextmenu` event with `e.target = card` (empty space) and assert
   `document.querySelector(".context-menu")` is non-null.
4. Dispatch a second `contextmenu` event with `e.target` being a `.tree-node` child
   and assert the empty-space menu did not open (the node's own menu did).

Note: JSDOM does not simulate native context-menu propagation. Use `new MouseEvent("contextmenu",
{ bubbles: true, cancelable: true, clientX: 10, clientY: 10 })` dispatched on `card` directly.
For the "target is tree-node" case, dispatch on a known `<li>` child element.

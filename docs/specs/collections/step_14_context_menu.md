---
title: "Step 14 — Context Menu Entries"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 14 — Right-Click Wiring

## Goal

Add "Make Collection" / "Unmake Collection" entries to the directory context menu in the file browser, and confirm the per-box context menus built in step 09 are surfaced via the file-browser's existing `showContextMenu()` helper.

## Files touched

- **Edit** `src/plugins/file-browser/file-browser.plugin.ts`
- **New** `tests/collections/context-menu.test.ts`

## Function signatures to add

In `file-browser.plugin.ts`, edit `buildDirContextMenuItems(folderPath, …)` to append two new entries before the existing "Reveal in Finder" separator:

```typescript
// Pseudo-diff
items.push(
  { sep: true },
  await isCollectionFolder(folderPath)
    ? { label: "Unmake Collection", action: async () => { /* see below */ } }
    : { label: "Make Collection",    action: async () => { /* see below */ } },
);
```

Concretely:

- **Make Collection** → `await commands.makeCollection(folderPath); vaultManager.reloadVaultIndex(); fileBrowser.refreshTree();` On `{ ok: false, code: "already-collection" | "nested" }`, show toast with the corresponding human-readable message.
- **Unmake Collection** → confirmation modal (reuse `sf-modal-*` shell per project memory `feedback_look_first`) → `await commands.unmakeCollection(folderPath); vaultManager.reloadVaultIndex();`.

Per-Stack glyph and per-note-box context menus are built inside their renderers (steps 06, 09) and dispatched via `showContextMenu()` from `file-browser.plugin.ts`. Step 14 wires the dispatch:

```typescript
// In renderer.ts (step 12) — context-menu handlers call:
const items = buildNoteBoxContextItems(handle);
showContextMenu(ev.clientX, ev.clientY, items.map(item => ({
  label: item.label,
  action: () => handleNoteBoxAction(item.action, handle),
  danger: item.danger,
})));
```

`handleNoteBoxAction(action, handle)` switch:
- `"rename"` → `beginInlineRename(handle)` → on commit, `bridge.moveFile(old, new)` + `store.appendNoteToStack`/`removeNoteFromStack` to keep `order` consistent.
- `"move-up"` / `"move-down"` → `store.reorderNote(...)` → re-render stack panel.
- `"move-to-other-stack"` → modal Stack picker → `bridge.moveFile(...)` + update both Stacks' `order`.
- `"add-reference"` → modal Stack picker → `commands.addReference(notePath, targetStackPath)`.
- `"delete"` → confirmation → `bridge.deleteFile(...)` → store.removeNoteFromStack → reference-index propagates removal (step 13).
- `"open-canonical"` (reference box) → `navigateToStack(canonicalStackPath)` then auto-focus the canonical box.
- `"remove-reference"` (reference / broken box) → `store.removeReference(ownerStackPath, canonicalRel)` → re-render.
- `"edit-in-place"` → `inlineEditor.mount(handle, content)`.

## Failing tests to write FIRST

`tests/collections/context-menu.test.ts`:

| Test name | EC / FR | Asserts |
|---|---|---|
| `Make Collection appears on a folder that is not yet a Collection` | FR-1 | menu items include "Make Collection" |
| `Unmake Collection appears on a Collection folder; Make Collection does not` | FR-4 | mutually exclusive |
| `Clicking Make Collection invokes commands.makeCollection with the folder path` | FR-1 | spy called once |
| `Clicking Make Collection on already-Collection shows toast (defense-in-depth)` | EC-1 | toast spy fires with "already-collection" message |
| `Clicking Unmake Collection opens confirmation modal; only Confirm triggers commands.unmakeCollection` | FR-4 | Cancel → no call; Confirm → one call |
| `Note box rename action shows inline rename input` | FR-12 | `beginInlineRename` invoked |
| `Note box delete action shows confirmation then calls bridge.deleteFile` | FR-12 | Confirm only → file deleted |
| `Reference-box menu has Open canonical / Remove reference / Edit in place` | FR-24 | exact items |
| `Broken-box menu has only Remove reference` | EC-16 | one item |
| `Stack glyph menu has Rename / Move up / Move down / Set folder icon… / Delete` | FR-14 | exact items |
| `Set folder icon… on a Stack opens the existing folder-icon picker (delegates, does not re-implement)` | C-6 | folder-icon-picker.openFolderIconPicker spy called with Stack path |

## Implementation outline

1. Modify `buildDirContextMenuItems` in `file-browser.plugin.ts` to call `await isCollectionFolder(folderPath)` and branch on the result. Since `buildDirContextMenuItems` is currently sync (verify in implementation), refactor only the path that builds Collection items into an `async` branch, or eagerly compute the predicate before building items.
2. Add a small helper module `src/plugins/file-browser/collections/context-actions.ts` (NEW — not in original layout) if the dispatch switch gets too long; otherwise inline in `renderer.ts`. Keep the action strings as a typed union:
   ```typescript
   export type NoteBoxAction =
     | "rename" | "move-up" | "move-down" | "move-to-other-stack"
     | "add-reference" | "delete"
     | "open-canonical" | "remove-reference" | "edit-in-place";
   ```
   (Add `context-actions.ts` to the §2 file map in `00_index.md` if pulled out — Lead Developer's call.)
3. **Stack picker modal** (for "Move to other Stack…" and "Add reference to another Stack…"): a minimal list of the Collection's other Stacks. Reuse `sf-modal-*` chrome.

## Refactor opportunities

Many of the actions duplicate the file-browser's existing right-click → Rename/Delete pipeline. If the existing pipeline can be invoked with the box's `notePath`, do so instead of building a parallel path. Verify during implementation.

## Definition of Done

```bash
npm run test:run -- tests/collections/context-menu.test.ts
```
Expected: 11 tests pass. Plugin rebuild required.

Manual:
- Right-click a regular folder → "Make Collection" present, "Unmake Collection" absent.
- Right-click a Collection folder → reverse.
- Right-click a Stack glyph → expected 5 items; "Set folder icon…" opens the existing picker.
- Right-click a canonical note box → expected 6 items.
- Right-click a reference box → expected 3 items.
- Right-click a broken box → expected 1 item.

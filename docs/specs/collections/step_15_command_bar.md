---
title: "Step 15 — Command Bar Entries + Keybindings"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 15 — Command Palette Wiring

## Goal

Register three new command-bar entries (FR-20) under the section `"Collection"` with `defaultKey: ""`, and wire their actions through `handleAction()` in `main.ts`.

## Files touched

- **Edit** `src/plugins/command-bar/command-bar.plugin.ts`
- **Edit** `src/keybindings/keybindings-panel.ts`
- **Edit** `src/main.ts` (`handleAction()`)
- **New** `tests/collections/command-bar.test.ts`

## Function signatures + entries to add

```typescript
// keybindings-panel.ts — extend COMMANDS

{
  id: "collection:make-collection",
  label: "Make Collection from Folder",
  section: "Collection",
  defaultKey: "",
  enabled: (ctx) => ctx.activeFocus === "folder",
},
{
  id: "collection:new-stack",
  label: "New Stack in Current Collection",
  section: "Collection",
  defaultKey: "",
  enabled: (ctx) => ctx.activeTab?.kind === "collection-home",
},
{
  id: "collection:add-reference",
  label: "Add Reference to Another Stack…",
  section: "Collection",
  defaultKey: "",
  enabled: (ctx) => ctx.activeFocus === "note-in-collection",
},
```

`enabled` predicate signatures depend on the existing `COMMANDS` shape — adapt during implementation. If `enabled` is not a field today, gate enable-state inside `handleAction` instead (no-op + toast for invalid context).

```typescript
// main.ts — handleAction() switch additions

case "collection:make-collection": {
  const folderPath = getFocusedFolderPath();   // existing helper or new one
  if (!folderPath) { toast("Select a folder first."); return; }
  void commands.makeCollection(folderPath).then(handleResult);
  return;
}
case "collection:new-stack": {
  const collectionPath = getActiveCollectionPath();
  if (!collectionPath) { toast("Open a Collection first."); return; }
  void commands.newStack(collectionPath).then(handleResult);
  return;
}
case "collection:add-reference": {
  const notePath = getFocusedNotePath();
  if (!notePath) { toast("Focus a note in a Collection first."); return; }
  void openStackPickerForAddReference(notePath);
  return;
}
```

`getActiveCollectionPath()` is a small helper: reads `tabManager.activeTab` and, if it's a folder tab whose path is a Collection, returns the path. Verify existing helpers first.

## Failing tests to write FIRST

`tests/collections/command-bar.test.ts`:

| Test name | EC / FR | Asserts |
|---|---|---|
| `command-bar registers collection:make-collection / new-stack / add-reference` | FR-20 | all three IDs present in the registry |
| `each entry is in section "Collection"` | FR-20 | section field matches |
| `each entry has defaultKey: ""` | FR-20 | empty string |
| `handleAction("collection:make-collection") with no focused folder shows toast` | UX | toast spy fires; commands.makeCollection NOT called |
| `handleAction("collection:make-collection") with focused folder calls commands.makeCollection` | FR-20 | spy called once with path |
| `handleAction("collection:new-stack") with no active Collection shows toast` | UX | toast |
| `handleAction("collection:new-stack") with active Collection calls commands.newStack` | FR-20 | spy fires |
| `handleAction("collection:add-reference") with no focused note shows toast` | UX | toast |
| `handleAction("collection:add-reference") with focused note opens stack picker` | FR-20, FR-23 | picker modal spy fires |
| `command-bar entries are filtered by the enabled predicate at picker render time` | UX | when activeFocus !== "folder", the make-collection row is hidden or greyed |
| `keybindings panel groups the three entries under "Collection" section header` | FR-20 | panel render includes header + 3 rows |

## Implementation outline

1. **command-bar.plugin.ts**: locate the registration block (each plugin/feature contributes its entries). Add the three entries. Pattern from any existing entry (e.g., search for `"file-browser:create-file"` or similar in the same file).
2. **keybindings-panel.ts**: append to `COMMANDS` array. The `Collection` section header should appear automatically once the section name exists (verify the rendering code at line 345: `COMMANDS.filter((c) => c.section === section)`).
3. **main.ts handleAction**: add three switch cases as above. Existing helpers (`getFocusedFolderPath`, `getFocusedNotePath`, `getActiveCollectionPath`) may need to be introduced if not present — keep them small and colocated.
4. **Stack picker for add-reference**: reuse the same modal-shell pattern used by the right-click "Add reference to another Stack…" flow in step 14. If both end up using the same picker, extract a `openStackPicker(opts)` helper now.

## Refactor opportunities

If many features need a "focused note path" helper, promote to `src/main.ts` exports. Keep it private to step 15 if no other consumers exist.

## Definition of Done

```bash
npm run test:run -- tests/collections/command-bar.test.ts
```
Expected: 11 tests pass. Plugin rebuild required.

Manual: Cmd+K (or whatever the project's command-bar shortcut is) → type "collection" → see the three entries → invoking each performs the expected action when context allows, else toasts.

---
title: "Step R01 — Remove Make/Unmake Collection Ceremony"
last-updated: "2026-06-06"
review-cadence-days: 7
status: active
---

# Step R01 — Delete the "Make Collection" Ceremony

## Goal

Remove every entry-point and helper that exists ONLY to support the
"Make Collection" / "Unmake Collection" gesture: commands, context-menu
items, command-bar handlers, keybinding rows. After this step, the right-
click menu and the command-bar are free of any Make/Unmake entries, but
the rest of Collections still works (legacy `type: collection` folders
still render via the unchanged `detection-glue.ts` short-circuit — that
goes in step_R03).

## Files touched

- **Edit**  `src/plugins/file-browser/collections/commands.ts`
- **Edit**  `src/plugins/file-browser/collections/context-actions.ts`
- **Edit**  `src/plugins/file-browser/file-browser.plugin.ts`
- **Edit**  `src/main.ts`
- **Edit**  `src/keybindings/keybindings-panel.ts`
- **Edit/Delete tests**  `tests/collections/commands.test.ts`
- **Edit/Delete tests**  `tests/collections/context-menu.test.ts`
- **Edit/Delete tests**  `tests/collections/command-bar.test.ts`

## Function signatures to add / edit / delete

### Delete from `commands.ts`

```typescript
// DELETE entirely:
export async function makeCollection(folderPath: string): Promise<FileResult<void>>;
export async function unmakeCollection(collectionPath: string): Promise<FileResult<void>>;

// DELETE helpers used only by the above:
async function isCollectionFolder(folderPath: string): Promise<boolean>;
async function hasCollectionAncestor(folderPath: string): Promise<boolean>;
async function stripStackKeys(stackPath: string): Promise<FileResult<void>>;
async function stripCollectionKeysFromRoot(collectionPath: string): Promise<FileResult<void>>;
function stripArrayKey(lines: readonly string[], key: string): string[];
function defaultCollectionMeta(displayName: string): CollectionMeta;
function dirnameOf(absPath: string): string;
```

KEEP unchanged: `newStack`, `createNotecardInDefaultStack`,
`createNoteInStack`, `addReference`, `uniqueUntitled`, `toVaultRel`,
`basenameOf`, `defaultStackMeta`. (Verify each before delete — if a kept
function still references one of the helpers above, do NOT delete that
helper; the dependency check is part of the implementation.)

### Delete from `context-actions.ts`

```typescript
// DELETE:
export interface FolderContextItem {  // delete if no other consumer
  readonly label: string;
}
export function buildMakeUnmakeCollectionItem(
  isCollection: boolean,
): FolderContextItem;
```

KEEP `buildStackGlyphMenu`, `buildNoteBoxMenu`.

### Edit `file-browser.plugin.ts`

Delete lines 3292–3310 (the Make/Unmake branch including the leading
`{ separator: true, ... }` row). Also delete the upstream `isCollection`
precompute on line 3202 IF its only consumer was this deleted branch
(verify by grep — the variable name may appear elsewhere; only delete
the assignment if no other usage remains).

### Edit `main.ts`

Delete the `case "collection:make-collection":` block at lines
1075–1090 inclusive (the entire case including its closing `break;`).
KEEP `case "collection:new-stack":` and `case "collection:add-reference":`.

### Edit `keybindings-panel.ts`

Delete line 157:

```typescript
// DELETE this row:
{ id: "collection:make-collection", label: "Make Collection from Folder", defaultKey: "", section: "Collection" },
```

KEEP the adjacent two rows (`new-stack`, `add-reference`). The
`"Collection"` section label stays — those two commands keep it
populated.

## Failing tests to write FIRST

### Add to `tests/collections/ec-sweep.test.ts`

| Test name | EC | Asserts |
|---|---|---|
| `"EC-28 — buildDirContextMenuItems does NOT include Make Collection"` | EC-28 / FR-60 | Import `buildDirContextMenuItems` from `file-browser.plugin.ts` (or mock the closure if not exported); render the menu items for an arbitrary folder path; assert no item has `label === "Make Collection"` or `label === "Unmake Collection"`. |
| `"EC-28 — keybindings panel COMMANDS array does NOT include collection:make-collection"` | EC-28 / FR-60 | Import the `COMMANDS` array from `keybindings-panel.ts`; assert no row has `id === "collection:make-collection"` or `id === "collection:unmake-collection"`. |
| `"EC-28 — main.ts handleAction does NOT dispatch collection:make-collection"` | EC-28 / FR-60 | Read `src/main.ts` as text; assert it does NOT contain the literal `"collection:make-collection"` (the case label). |
| `"commands.ts no longer exports makeCollection / unmakeCollection"` | FR-60 | Import `* as commands` from `collections/commands.ts`; assert `commands.makeCollection === undefined` AND `commands.unmakeCollection === undefined`. |

### Delete from `tests/collections/commands.test.ts`

Remove every test whose name contains `makeCollection`, `unmakeCollection`,
`already-collection`, `nested-not-supported`, or asserts the
`buildMakeUnmakeCollectionItem` label. The EC-1 / EC-2 / EC-23 round-trip
tests go. Keep EC-3 (Stack name gap-skip), EC-12 (Notecard with no
Stack), EC-17 (reference-to-folder refusal) — those exercise the
surviving commands.

### Delete from `tests/collections/context-menu.test.ts`

Remove tests asserting "Make Collection" / "Unmake Collection" label
presence. Keep Stack-glyph and note-box menu assertions (those exercise
`buildStackGlyphMenu` / `buildNoteBoxMenu`, which survive).

### Delete from `tests/collections/command-bar.test.ts`

Remove the `collection:make-collection` registration test. Keep
`new-stack` and `add-reference` registration tests.

## Implementation outline

1. **Run the new failing tests first.** They fail because the symbols
   still exist.
2. **Delete the symbols from `commands.ts`.** Confirm no remaining
   import in the rest of the Collections codebase references
   `makeCollection` / `unmakeCollection` / `isCollectionFolder` /
   `hasCollectionAncestor`. Adjust the file's module-doc header if it
   still describes the deleted commands.
3. **Delete `buildMakeUnmakeCollectionItem`** and the `FolderContextItem`
   interface from `context-actions.ts`.
4. **Edit `file-browser.plugin.ts`:**
   - Delete lines 3292–3310. The `{ separator }` row at 3291 also
     goes (otherwise two consecutive separators surround "Reveal in
     Finder"). KEEP the separator just before "Reveal in Finder"
     (3311) — it bookends the menu cleanly.
   - Delete the `isCollection` precompute (line 3202 vicinity) IF no
     other consumer remains. The comment block (3199–3201) also goes
     if the variable is removed.
   - Delete the dynamic `import("./collections/commands")` that the
     handler called — it's now unreachable.
5. **Edit `main.ts`:**
   - Delete the `case "collection:make-collection":` block.
   - Verify `getFocusedFolderPath` and `notifyCollectionsToast` still
     have at least one caller; if `getFocusedFolderPath` is now unused,
     it can stay (other callers may exist; do NOT delete it as part of
     this step — out of scope).
6. **Edit `keybindings-panel.ts`:**
   - Delete the single row for `collection:make-collection`. The
     `"Collection"` section label entry in `SECTIONS` stays.
7. **Verify**:
   - `npm run test:run -- tests/collections/` — every refactor EC-28
     test green; deleted tests no longer exist; remaining tests still
     green.
   - `npm run build` — TypeScript clean (no unused-export errors).
8. **Plugin rebuild**:
   - `npm run build:plugins && npm run sync:plugins`.

## Refactor opportunities

- If, after the delete, `context-actions.ts` is a pure re-export of
  `buildStackGlyphMenu` + `buildNoteBoxMenu`, consider deleting the
  file and importing directly from `home-canvas.ts` / `note-box.ts`.
  This is opportunistic; not required.
- The `FolderContextItem` interface may be referenced by tests; if
  so, leave it in `context-actions.ts` until tests are updated.

## Definition of Done

```bash
npm run test:run -- tests/collections/
```

Expected: every test in the directory green; the EC-28 regression tests
added in this step pass; the deleted tests are removed from the file.
Full project suite (`npm run test:run`) green. Plugin IIFE rebuilt.

Manual smoke check:
- Right-click any folder in the file browser → menu shows no "Make
  Collection" / "Unmake Collection" entry.
- Open the command bar (`Cmd-K`) → "Make Collection from Folder" is
  absent.
- Settings → Keyboard Shortcuts → "Collection" section shows only the
  two remaining commands (`New Stack`, `Add Reference`).

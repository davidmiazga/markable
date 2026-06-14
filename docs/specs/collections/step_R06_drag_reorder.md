---
title: "Step R06 — Drag-Reorder via attachFolderItemDrag"
last-updated: "2026-06-06"
review-cadence-days: 7
status: active
---

# Step R06 — Drag-Reorder for Notes-within-Stack and Stack-Tiles-within-Home

## Goal

Wire drag-reorder onto the existing primitive (`attachFolderItemDrag`
from `folder-view/folder-item-drag.ts`) for both the Stack panel
(notes-within-Stack) and the Home canvas (Stack-tiles-within-Home).
Persistence uses the existing `store.reorderNote(..., { toIndex })`
and `store.reorderStack(..., { toIndex })` APIs — both already
implemented in the MVP step_02 and used by the right-click "Move up /
Move down" handlers.

Cross-Stack drag is refused (EC-12 / FR-33). The right-click "Move to
other Stack…" entry stays the cross-Stack mechanism.

## Files touched

- **Edit** `src/plugins/file-browser/collections/stack-panel.ts`
- **Edit** `src/plugins/file-browser/collections/home-canvas.ts`
- **Edit** `src/plugins/file-browser/collections/renderer.ts` (wire the
  reorder callbacks)
- **New**  `tests/collections/drag-reorder.test.ts`

## Function signatures to add / edit

### Edit `stack-panel.ts`

```typescript
// Inside renderStackPanel(), inside the per-note loop (after createPlaceholder
// returns the handle, before observing), attach drag-reorder:

attachFolderItemDrag(
  handle.el,         // the .fv-collection-note-box element
  listEl,            // the .fv-collection-stack-list container scoping siblings
  noteFilename,      // the stable ID is the basename; matches the order: array shape
  ".fv-collection-note-box[data-path]",
  (orderedFilenames) => {
    // orderedFilenames is the full post-drop order. Compute the new
    // toIndex for the dragged item and dispatch through the store.
    // The store performs the atomic _folder.md rewrite + per-file queue.
    const toIndex = orderedFilenames.indexOf(noteFilename);
    void store.reorderNote(opts.stackPath, noteFilename, { toIndex });
  },
);

// Also: every note-box element must carry data-path=<noteFilename> so the
// drag util's sibling lookup finds it. Set this when building the box.
```

The trailing `+ Note` affordance is NOT made draggable (no `data-path`
on it).

### Edit `home-canvas.ts`

Two attach points — Stack tiles AND note boxes (for the parent's own
notes from FR-10 group 2):

```typescript
// Inside the stack-tile builder (renderStackGlyph), set data-path:
wrap.dataset.path = stackFolderName;   // basename, matches stackOrder: shape

// After the wrap is appended to the grid container, attach drag:
attachFolderItemDrag(
  wrap,
  grid,
  stackFolderName,
  ".fv-collection-stack-glyph[data-path], .fv-collection-note-box[data-path]",
  (orderedIds) => {
    // The orderedIds array contains a mix of Stack folder names and note
    // filenames (FR-31 — mixed array). For now, the Home-canvas drag
    // persists ONLY the subfolder order via stackOrder. Note ordering on
    // the Home canvas does NOT have a dedicated persistence key yet
    // (parent _folder.md's `order:` array could serve, but that key is
    // currently per-Stack-only in the Stack's _folder.md). Plan:
    //
    //   - Filter orderedIds down to the subfolder names by checking
    //     against the current loaded stack names.
    //   - Persist via store.reorderStack(collectionPath, name, { toIndex }).
    //
    // FR-31 mentions a mixed array; that's deferred to a Phase-2 follow-up
    // — the MVP refactor persists ONLY the Stack-tile order on Home, and
    // parent-folder note order is determined by directory listing.
    //
    // Track this as DW-R2 in the 00_index DW table (added in step_R08).

    const draggedIsStack = stackTileNames.has(stackFolderName);
    if (!draggedIsStack) return;
    const newStackOrder = orderedIds.filter((id) => stackTileNames.has(id));
    const toIndex = newStackOrder.indexOf(stackFolderName);
    void store.reorderStack(opts.collectionPath, stackFolderName, { toIndex });
  },
);
```

For note boxes on the Home canvas, attach drag in the same loop with
the same sibling selector. The callback filters to note filenames and
persists via... currently nothing (DW-R2 deferral). The drag still
visually works (the box moves) but the order is not persisted across
reload. Document this clearly in DW-R2.

### Edit `renderer.ts`

No structural changes — the drag attachment is fully contained inside
`stack-panel.ts` and `home-canvas.ts`. The renderer just continues
calling `navigateToHome` / `navigateToStack` as before.

### Cross-Stack drag refusal (EC-12 / FR-33)

`attachFolderItemDrag`'s callback gives the full post-drop order
within the SAME container (`itemSelector` is scoped to the container).
Dragging across containers (Stack A → Stack B) means the dragged
element is dropped outside Stack A's container — `attachFolderItemDrag`
treats the drop as "drop at end of source container", which means
the order WITHIN Stack A is unchanged (the element stays appended
inside Stack A's DOM). It does NOT move the element to Stack B.

To make the refusal explicit: the test asserts no `writeFile` call to
either Stack's `_folder.md` when a drag starts on one Stack's note
box and ends over another Stack's tile / note box. The drag util's
existing behaviour already implements this — no code change needed.

## Failing tests to write FIRST

### `tests/collections/drag-reorder.test.ts` (new)

| Test name | EC / FR | Asserts |
|---|---|---|
| `"FR-30 / EC-10 — drag a note within a Stack persists via reorderNote { toIndex }"` | EC-10 / FR-30 | Render a Stack with 3 notes (`a.md`, `b.md`, `c.md`); manually trigger `attachFolderItemDrag`'s `onReorder` callback with `["b.md", "a.md", "c.md"]` (simulating a drag of `b.md` to position 0); assert `store.reorderNote(stackPath, "b.md", { toIndex: 0 })` was called; assert on next `readStack`, the `order:` array is `["b.md", "a.md", "c.md"]`. |
| `"FR-30 — drag-reorder persists across reload"` | EC-10 | After the drag, simulate a tab close + reopen by calling `renderStackPanel` afresh; assert the rendered DOM matches the new order. |
| `"FR-31 / EC-11 — drag a Stack tile on Home canvas persists via reorderStack { toIndex }"` | EC-11 / FR-31 | Same shape as FR-30 but on the Home canvas; the dragged item is a Stack tile; assert `store.reorderStack(collectionPath, name, { toIndex })`. |
| `"EC-12 / FR-33 — drag from Stack A onto a target outside the Stack panel is refused (no writeFile)"` | EC-12 | Mock `bridge.writeFile`; trigger a drag in Stack A's panel whose drop target is OUTSIDE the panel's `listEl`; assert `writeFile` was NOT called. (The drag util scopes by container, so this is structural — the test exercises the contract.) |
| `"EC-12 — drag a note onto a Stack tile produces no _folder.md mutation"` | EC-12 | Slightly different shape: render a Home canvas with note boxes AND tiles; trigger a drag on a NOTE box ending over a TILE; assert no `writeFile` call (mixed sibling selector means the drop is interpreted as a reorder, but the test gating is on what happens after `reorderStack` filtering — for note IDs that are not in stackTileNames, no call is made). |
| `"data-path attribute is set on every draggable element"` | (sanity) | After rendering, query `.fv-collection-note-box`; every element has a non-empty `dataset.path`. Same for `.fv-collection-stack-glyph`. |

## Implementation outline

1. **Write the new tests.** All fail.
2. **Edit `stack-panel.ts`:**
   - Inside the canonical-box loop, set `handle.el.dataset.path =
     noteFilename` (NOT the absolute path — the order array stores
     filenames).
   - Inside the reference-box loop, also set `data-path =
     <some-stable-id>`. References are NOT reorderable in the same
     way (they live in `references:`, a different array). For MVP,
     skip the drag attachment for reference boxes (do not call
     `attachFolderItemDrag` on them). Mark the gap as DW-R3 in the
     spec.
   - Attach `attachFolderItemDrag` on canonical boxes only.
3. **Edit `home-canvas.ts`:**
   - Set `data-path = stackFolderName` on tile elements.
   - Attach `attachFolderItemDrag` on tiles. The callback filters
     orderedIds to subfolder names and calls `store.reorderStack`.
   - For parent-folder note boxes, set `data-path = noteFilename`
     and attach drag. The callback's persistence path is deferred
     (DW-R2) — see implementation below.
4. **Verify cross-Stack refusal is structural.** No code change
   required (`attachFolderItemDrag` already scopes by container).
   The test in `drag-reorder.test.ts` asserts the contract.
5. **Run plugin rebuild**: `npm run build:plugins && npm run sync:plugins`.

## Refactor opportunities

- A shared helper `attachStackDrag(element, container, id, persist)`
  that wraps the boilerplate could DRY up the stack-panel and
  home-canvas call sites. Opportunistic.
- Mixed sibling selector on the Home canvas (`.fv-collection-stack-glyph,
  .fv-collection-note-box`) means the drag insertion-line geometry
  works across both shapes. Confirm visually in QA.

## Definition of Done

```bash
npm run test:run -- tests/collections/drag-reorder.test.ts
npm run test:run -- tests/collections/stack-panel.test.ts
npm run test:run -- tests/collections/home-canvas.test.ts
```

Expected: all three files green; the new drag-reorder cases pass;
existing stack-panel and home-canvas tests still pass (drag attach is
additive).

Manual smoke check:
- Open a Stack with 3 notes. Drag note 2 to position 1. Close + reopen.
  The order persists.
- Open a Home canvas with 3 Stack tiles. Drag tile 2 to position 1.
  Close + reopen. The order persists.
- Try to drag a note from Stack A onto Stack B's tile. The drag does
  not commit a move; no `_folder.md` write occurs. (Visually the
  drag may show insertion line — that's harmless.)

Plugin rebuild required.

## Carry-forward deferred work

Add to the 00_index DW table (step_R08 confirms the entries):

- **DW-R2** — Parent-folder note ordering on Home canvas is not yet
  persisted. The drag UI visually reorders but the next reload
  reverts to directory order. A dedicated per-parent `order:` array
  (analogous to the per-Stack `order:`) is the future fix.
- **DW-R3** — Reference boxes (cross-Stack pointers) are not
  drag-reorderable. They render in `references:` array order; right-
  click Move up / Move down is the only manual control.

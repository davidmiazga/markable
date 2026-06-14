---
title: "Step R05 — Filesystem-Derived Subfolder Rendering"
last-updated: "2026-06-06"
review-cadence-days: 7
status: active
---

# Step R05 — Subfolder-as-Stack: Filesystem-Derived Home Canvas

## Goal

Refactor `home-canvas.ts` so the Home canvas renders **every immediate
subfolder** of a `layout: collection-home` folder as a Stack tile,
sourced from the vault index (not from `stackOrder:` membership).
`stackOrder:` is repurposed: it carries the **manual ordering** of
subfolder tiles that the user has touched. New subfolders auto-append
in directory-listing order; missing entries silently drop.

Additionally, the Home canvas now includes the parent folder's own
immediate `.md` files as note boxes (FR-10 group 2) — mixed with the
Stack tiles in one container so the manual-order array can interleave
both kinds.

## Files touched

- **Edit**  `src/plugins/file-browser/collections/home-canvas.ts`
- **Edit**  `src/plugins/file-browser/collections/renderer.ts` (wire the
  new home-canvas signature)
- **New**   `tests/collections/home-canvas.test.ts` cases (additive; the
  file exists)

## Function signatures to add / edit

### Edit `home-canvas.ts`

```typescript
// REPLACE the existing loadStackGlyphs() with two helpers:

/**
 * Read the immediate subfolders of `collectionPath` from the vault index.
 * Pure read — no `_folder.md` parsing here.
 */
function listImmediateSubfolders(
  collectionPath: string,
  vaultIndex: VaultIndex | null,
): string[];   // returns absolute subfolder paths in vault-index order

/**
 * Read the immediate `.md` files of `collectionPath` from the vault index
 * (excluding `_folder.md`). FR-10 group 2.
 */
function listImmediateNotes(
  collectionPath: string,
  vaultIndex: VaultIndex | null,
): string[];   // returns absolute note paths in vault-index order

/**
 * Build the per-Stack data for the displayed tiles. Iterates the
 * subfolder list from listImmediateSubfolders, applies the user's
 * manual order (stackOrder), reads each Stack's _folder.md for icon +
 * note count. Missing folders silently drop; new folders auto-append.
 */
async function loadStackGlyphs(
  collectionPath: string,
  manualOrder: readonly string[],   // stackOrder from _folder.md
  vaultIndex: VaultIndex | null,
): Promise<StackGlyphData[]>;
```

```typescript
// REPLACE the existing renderHomeCanvas() to accept the parent's own
// notes alongside subfolder tiles:

export interface HomeCanvasOptions {
  readonly collectionPath: string;
  readonly onStackClick: (stackPath: string) => void;
  readonly onCreateStack: () => Promise<void>;
  readonly onCreateNotecard: () => Promise<void>;
  // Note-box handlers (NEW — for the parent's own .md files):
  readonly onNoteClick: (notePath: string) => void;
  readonly onNoteContextMenu: (notePath: string, ev: MouseEvent) => void;
  // The rest is unchanged.
  readonly onStackRename: (stackPath: string, newName: string) => Promise<void>;
  readonly onStackReorder: (stackPath: string, direction: "up" | "down") => Promise<void>;
  readonly onStackDelete: (stackPath: string) => Promise<void>;
  readonly onStackSetIcon: (stackPath: string) => void;
}

export async function renderHomeCanvas(
  container: HTMLElement,
  opts: HomeCanvasOptions,
): Promise<void>;
```

### Edit `renderer.ts` — `navigateToHome`

The renderer must pass `onNoteClick` / `onNoteContextMenu` to the home
canvas. The mounting of the inline editor on a parent-folder note
follows the EXACT same pattern as Stack-panel note-box clicks (see
`navigateToStack` in the same file). Reuse the existing
`state.inlineEditor.mount(handle, content)` call path.

## Implementation outline

1. **Write the new failing tests** (see test inventory below).

2. **`listImmediateSubfolders(collectionPath, vaultIndex)`** — Reuse the
   `collectChildren` algorithm from `tab.ts:151–193`. Filter the result
   to `kind === "directory"`. Return absolute paths.

3. **`listImmediateNotes(...)`** — Same, filtered to `kind === "file"`
   AND `ext === ".md"`, excluding the `_folder.md` itself (matches
   existing FR-23 exclusion in `collectChildren`).

4. **`loadStackGlyphs(...)`**:
   - List the subfolders via `listImmediateSubfolders`.
   - Build a `FolderCard[]`-like array of subfolder cards (path-only is
     fine for this step; the full FolderCard shape is overkill).
   - Apply manual order via `applyManualOrder(cards, manualOrder)` from
     `folder-view/renderer.ts:155` (already exported). The order entries
     are subfolder NAMES (basenames), not paths — so build the
     `FolderCard`-shaped array with `path === subfolderName` for the
     applyManualOrder pass, then map back to absolute paths. OR adapt:
     use a simple in-place sort by mapping `manualOrder` to indices.

     Recommendation: write a tiny local helper `applyNameManualOrder(names,
     order)` (5 lines) instead of round-tripping through FolderCard. This
     is more honest about the shape and avoids the path-vs-basename
     confusion.

   - For each subfolder name in the manually-ordered list, call
     `store.readStack(subfolderPath)` to get the icon + display name +
     note count. Use the default `notebook` icon for subfolders that
     have no `_folder.md` (EC-5/EC-6 — `readStack` already returns
     defaults in that case).

5. **`renderHomeCanvas(...)`**:
   - Read the Collection meta via `store.readCollection`.
   - Call `loadStackGlyphs(...)` to get the tile data.
   - Call `listImmediateNotes(...)` to get the parent-folder notes.
   - If both arrays are empty AND the trailing affordances would be
     the only content, render the frame-01 empty-state popover (FR-14).
     Otherwise:
     - Build the mixed grid: one `.fv-collection-home-mixed` container.
     - Append Stack tiles in `loadStackGlyphs` order.
     - Append note boxes (placeholder shells; preview is rendered by
       the same `note-box.ts` pipeline, including the
       `IntersectionObserver`-driven preview cache from the existing
       `preview-cache.ts`).
     - Append the trailing `+` Stack affordance.
     - Append the trailing `+ Note` affordance (parent-folder note,
       NOT inside a Stack — per EC-20).
   - All elements get `data-path` attributes pointing at their
     **subfolder name** (for tiles) or **note filename** (for note
     boxes) so step_R06's drag wiring can read consistent IDs.

6. **`renderer.ts` wire-up**:
   - Pass `onNoteClick` / `onNoteContextMenu` from
     `navigateToHome` to the home canvas. The handlers reuse the
     same `state.inlineEditor.mount` path used for Stack-panel notes.
     Pass a synthetic `NoteBoxHandle` (built via `createPlaceholder`)
     so the editor mount path works unchanged.

## Failing tests to write FIRST

### Add to `tests/collections/home-canvas.test.ts`

| Test name | EC / FR | Asserts |
|---|---|---|
| `"FR-10 group 1 — subfolders render as Stack tiles when stackOrder is empty"` | FR-10 / EC-5 | Vault index has `parent/Sub A`, `parent/Sub B`; `_folder.md` has `stackOrder: []`; render; assert two `.fv-collection-stack-glyph` elements with `data-path="Sub A"` and `data-path="Sub B"`, in directory order. |
| `"FR-10 group 1 — stackOrder reorders existing subfolders; unknown entries drop"` | RQ-2 | Vault index has `A`, `B`, `C`; `stackOrder: ["B", "ZZZ"]`; assert tile order = `B, A, C`; `ZZZ` does not produce a tile. |
| `"EC-5 — subfolder without _folder.md renders as tile with notebook icon and basename label"` | EC-5 | Subfolder has no `_folder.md` (readFile returns ok:false); assert tile has class `folder-icon-notebook` and label equal to the basename. |
| `"EC-6 — subfolder with _folder.md but no layout: inherits Collections rendering"` | EC-6 | Subfolder has a `_folder.md` with `displayName: Custom`, `icon: book`, but no `layout:` field; assert tile renders with the custom display name and book icon. (The rendering inherits because the Home canvas iterates subfolders regardless of the subfolder's own layout field.) |
| `"FR-10 group 2 — parent's own .md files render as note boxes alongside Stack tiles"` | FR-10 | Parent folder has 1 subfolder + 2 `.md` files; assert 3 child elements rendered: 1 `.fv-collection-stack-glyph`, 2 `.fv-collection-note-box`. |
| `"FR-10 — _folder.md is excluded from the rendered note-box list"` | FR-23 / EC-17 | Parent has `_folder.md` + `Real Note.md`; only one note box renders (Real Note); `_folder.md` is not rendered. |
| `"EC-9 — folder with zero subfolders AND zero .md files renders the empty-state popover"` | EC-9 / FR-14 | Empty folder; assert `.fv-collection-empty-state` is rendered, NOT a mixed grid. |
| `"FR-11 — clicking + Stack creates a new Stack and re-renders"` | FR-11 | Trigger the `+` button; assert `commands.newStack` was called. (Use spy on commands module.) |
| `"FR-12 — clicking + Note creates a note in the PARENT folder (not in a Stack)"` | FR-12 / EC-20 | Trigger the `+ Note` button on the Home canvas; assert `commands.createNoteInStack` was called with the parent folder path (not a subfolder). |
| `"EC-20 — empty folder + Notecard creates Untitled.md in the parent, NOT auto-creating Stack 01"` | EC-20 | This intentionally differs from the MVP's EC-12. Document the change in the test name. |

### Update existing tests

Tests that assumed `loadStackGlyphs` iterates `stackOrder` exclusively
(MVP behaviour) need re-fixturing. Replace fixtures with the new
behaviour where present.

## Refactor opportunities

- The local `applyNameManualOrder` helper could move to
  `folder-view/renderer.ts` alongside `applyManualOrder` (or replace
  `applyManualOrder` with a generic over-string-id version). MVP keeps
  it local to `home-canvas.ts` to avoid touching the shared module.
- The mixed Home-canvas grid uses one container for tiles + boxes; CSS
  must be updated to support both shapes flowing in the same flex-wrap
  context. The class names stay consistent with the existing
  `.fv-collection-stack-glyph` and `.fv-collection-note-box`.

## Definition of Done

```bash
npm run test:run -- tests/collections/home-canvas.test.ts
```

Expected: every new test green; every pre-existing test that wasn't
re-fixtured still green; total pass count for the file matches the
test inventory (count from the new + retained tests; verify in the
implementation PR).

```bash
npm run test:run -- tests/collections/
```

Expected: all green.

Manual smoke check:
- Create a folder with 3 subfolders (no Collections metadata). Open
  it. Pick "Collection" via the picker. The 3 subfolders appear as
  Stack tiles.
- Add a `.md` file to the parent folder. Re-render. The note appears
  as a framed box alongside the Stack tiles.
- Drag is wired in step_R06; here we only verify rendering.

Plugin rebuild required.

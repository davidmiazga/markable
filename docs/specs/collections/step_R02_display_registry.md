---
title: "Step R02 — Register `collection-home` in DISPLAY_REGISTRY"
last-updated: "2026-06-06"
review-cadence-days: 7
status: active
---

# Step R02 — DISPLAY_REGISTRY + select-widget RENDERERS Registration

## Goal

Make Collections selectable via the same display-options picker that
exposes Cards / Table / Timeline / Kanban / Bookshelf. This is the
user-facing entry point that replaces the deleted "Make Collection"
gesture (per FR-2 / FR-3 / EC-13).

There are **two registration points** because Markable has two
folder-view dispatch paths:
  1. **`DISPLAY_REGISTRY`** in `folder-view/display-options.ts` — the
     catalog the codeblock-modal picker reads to build its pill row.
     This is what the user sees and clicks.
  2. **`RENDERERS`** in `editor/select-widget.ts` — the dispatch map
     that the codeblock `select`-fence widget uses to render the
     chosen layout in-place. When the modal writes `display:
     collection-home` into the codefence, this map routes the render
     call.

Both must include `collection-home` for the round-trip to work.

The existing `LAYOUT_RENDERERS["collection-home"]` entry in
`folder-view/tab.ts:125` (the legacy `renderFolderViewTabAsync` path)
remains as-is — it's already correct.

## Files touched

- **Edit** `src/plugins/file-browser/folder-view/display-options.ts`
- **Edit** `src/editor/select-widget.ts`
- **New**  `tests/collections/display-options.test.ts`

## Function signatures to add / edit

### Edit `display-options.ts:39–78`

Append one entry to `DISPLAY_REGISTRY`:

```typescript
export const DISPLAY_REGISTRY: DisplaySpec[] = [
  /* ... existing entries unchanged ... */
  {
    slug: "bookshelf",
    label: "Bookshelf",
    /* ... unchanged ... */
  },
  // NEW — Collections (Q-R2: single-option MVP per Bookshelf precedent)
  {
    slug: "collection-home",
    label: "Collection",
    defaultOption: "default",
    options: [
      { slug: "default", label: "Default" },
    ],
  },
];
```

Ordering: insert AFTER Bookshelf (the analogue). The picker shows
entries in registry order; Collections appears as the last pill.

### Edit `select-widget.ts:40–46`

Add `renderCollectionHome` to the `RENDERERS` map and to the imports:

```typescript
// In imports block near line 25:
import { renderCollectionHome } from "../plugins/file-browser/collections/renderer";

// Replace the RENDERERS map (line 40):
const RENDERERS: Record<string, FolderLayoutRenderer> = {
  cards:           renderFolderCards,
  table:           renderFolderTable,
  timeline:        renderFolderTimeline,
  kanban:          renderFolderKanban,
  bookshelf:       renderFolderBookshelf,
  "collection-home": renderCollectionHome,   // NEW
};
```

That's the entire patch — `renderCollectionHome` is already exported
from `collections/renderer.ts` (verified by `tab.ts:23` import).

## Failing tests to write FIRST

### `tests/collections/display-options.test.ts` (new)

| Test name | EC / FR | Asserts |
|---|---|---|
| `"DISPLAY_REGISTRY contains a `collection-home` entry"` | FR-2 | Import `DISPLAY_REGISTRY`; assert at least one entry has `slug === "collection-home"`. |
| `"Collections entry has label `Collection` and single default option"` | FR-2 / Q-R2 | The entry has `label === "Collection"`, `defaultOption === "default"`, `options.length === 1`, `options[0].slug === "default"`. |
| `"Collections entry appears after Bookshelf in registry order"` | (UX ordering) | Index of `collection-home` > index of `bookshelf`. |
| `"resolveDisplayAndOption(`collection-home`, null) returns the default option"` | FR-2 / Q-R2 | Calling `resolveDisplayAndOption("collection-home", null)` returns `{ display: "collection-home", option: "default" }`. |
| `"resolveDisplayAndOption(`collection-home`, `nonsense`) falls back to default"` | EC-1 | Returns `{ display: "collection-home", option: "default" }`. |
| `"select-widget RENDERERS routes `collection-home` to renderCollectionHome"` | RQ-3 | Import `RENDERERS` from `select-widget.ts` (re-export if not exported; tests can also assert via a public `getRenderer(slug)` helper if the map stays module-private — see implementation note below). Assert the entry resolves to the imported `renderCollectionHome` reference. |
| `"getDisplaySpec(`collection-home`) returns the new spec"` | FR-2 | Non-null return; `spec.slug === "collection-home"`. |

### Add to `tests/collections/ec-sweep.test.ts`

| Test name | EC | Asserts |
|---|---|---|
| `"EC-27 — picker shows Collection as the active pill for a layout: collection-home folder"` | EC-27 | Render the codeblock modal mock (existing test util pattern); assert the pill with `data-slug="collection-home"` has the `.is-active` class when the codefence carries `display: collection-home`. |

## Implementation outline

1. **Write the new tests.** They fail because the registry entry does
   not exist and the `RENDERERS` map does not have `collection-home`.
2. **Add the registry entry.** Place after Bookshelf for UX ordering.
3. **Add the RENDERERS entry.** Import `renderCollectionHome` at the
   top of `select-widget.ts`. If the existing `RENDERERS` map is
   module-private, expose a `getRenderer(slug)` helper (one-liner) OR
   export the map directly — the test must be able to assert the
   binding. Pick the smaller diff (likely: export the map under a
   new name like `SELECT_WIDGET_RENDERERS` for test introspection).
4. **No code changes beyond these two edits.** `renderCollectionHome`
   is already exported and already handles its config / cards /
   container / folderPath / bulkContext args correctly (verified in
   `collections/renderer.ts`).
5. **Verify**: `npm run test:run -- tests/collections/display-options.test.ts`
   green; new EC-27 test green.
6. **Plugin rebuild**: `npm run build:plugins && npm run sync:plugins`.

## Refactor opportunities

- The `RENDERERS` map in `select-widget.ts` and the `LAYOUT_RENDERERS`
  map in `tab.ts` could share a single source of truth (both must list
  the same layout-slugs). This is opportunistic; out of scope for the
  refactor.
- Consider adding the `description:` field to the Collections entry
  in `DISPLAY_REGISTRY` (Bookshelf options carry descriptions). MVP
  ships without — no description for the single `default` option.

## Definition of Done

```bash
npm run test:run -- tests/collections/display-options.test.ts
npm run test:run -- tests/collections/ec-sweep.test.ts
```

Expected: both files green. Full suite still green. Plugin rebuilt.

Manual smoke check:
- Open any folder. The codeblock modal pops with the display picker.
  A pill labelled "Collection" appears at the end of the row.
- Click the Collection pill → the option sub-row shows a single
  "Default" pill, pre-selected.
- Click Apply → the codefence body's `display:` is `collection-home`
  (the actual render dispatch is verified in step_R03 once the
  short-circuit is removed; until then, the legacy `tab.ts`
  short-circuit may still take precedence for legacy folders).

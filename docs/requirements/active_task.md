---
title: "Folder View Unified Data Model — Shared Enrichment, Bulk Selection, and Fields for Both Layouts"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Folder View Unified Data Model

## Summary

As a Markable user, I want both the `folder-cards` and `folder-table` layouts to
share the same enrichment pipeline, the same `fields:` / `extra-fields:` YAML
configuration, and the same bulk-selection + bulk-action toolbar, so that switching
layout is purely a visual change and the data available to each layout is identical.

---

## Knowns

### What exists today

- `tab.ts` runs enrichment **only** when `layoutKey === "folder-table"` (line 328).
  For any other layout the enrichment block is skipped entirely, so `card.meta` is
  never populated for cards rendered by `renderer.ts`.
- `table-renderer.ts` owns: creating `SelectionState`, building the bulk toolbar
  via `buildToolbar()`, wiring the `syncToolbar` closure, and appending
  `toolbarRefs.toolbar` as the first child of the host element.
- `renderer.ts` (`folder-cards`) has: no checkboxes, no bulk toolbar, no metadata
  line. Cards show only a preview rectangle, card name, optional tag chips, and an
  optional modified date.
- `bulk-toolbar.ts`, `bulk-selection.ts`, and `bulk-operations.ts` are already
  layout-agnostic and will not change.
- `parser.ts` exports `BUILTIN_FIELDS` and `parseFolderMd()`. The `fields:` YAML
  key is already fully parsed and stored in `config.fields`. The enrichment guard
  in `tab.ts` reads `config.extraFields.length > 0` and `imageColumnsRequested(config)`.
- The existing `fields:` mechanism already drives column order and extra-field
  derivation for the table layout. The mechanism will be reused — not replaced —
  for the cards layout.
- `FOLDER_VIEW_STARTER` in `file-browser.plugin.ts` (lines 2987–3027) is the
  template written when the user creates a new `_folder.md`. It currently
  comments out `fields:` as "folder-table only". That comment must be updated
  (see C-8).

### What the user has decided

1. The enrichment pipeline runs for **all** layouts, not just `folder-table`.
   The layout-key gate (`layoutKey === "folder-table"`) is removed.

2. `fields:` controls which fields are shown in **both** layouts:
   - table layout: as sortable columns (unchanged behaviour).
   - cards layout: as a single condensed metadata line below the card name.

3. **Metadata line format (cards).** One line, values only, no field labels.
   Values separated by ` · ` (space-dot-space). Tags shown as plain text values
   joined by ` · `, not as chip elements. Example: `Jan 5, 2026 · nature · travel`.
   All values written via `.textContent` (never `.innerHTML`).

4. **Default fields when `fields:` is absent (cards layout).** `modified` and
   `tags` render automatically with no YAML at all — the "minimum useful" default,
   matching the existing `showModified` / `showTags` boolean defaults.

5. **`show-modified` / `show-tags` interaction with `fields:`.** When `fields:` is
   declared, it fully supersedes `show-modified` and `show-tags` for metadata-line
   rendering. The boolean flags apply only in legacy mode (no `fields:` declared).
   This is consistent with how the table layout already handles the flags.

6. **`extra-fields:` scope for cards.** Custom frontmatter keys in `extra-fields:`
   are fully supported for the cards layout. The same enrichment pipeline (which
   reads `.md` frontmatter via Tauri) runs for both layouts. Values appear in the
   metadata line.

7. **Image metadata in cards.** If `fields:` includes image built-in keys
   (`width`, `height`, `date-taken`, `camera`), those values appear in the metadata
   line on image cards. The enrichment pipeline already supports this for table;
   cards receive the same values.

8. **Checkbox position on cards.** Top-left corner of the card, absolutely
   positioned. Hover-only visibility — appears when the card or its parent section
   is hovered (same opacity-transition pattern used elsewhere in the app). Both
   file cards and directory cards receive checkboxes.

9. **Bulk toolbar position on cards.** Sticky above the section content inside
   `.folder-view-host`, same position as the table layout. Same DOM construction
   from the existing `buildToolbar()` function.

10. The bulk toolbar appears above both layouts. One `SelectionState` is shared
    across both sections per render call, identical to the existing table behaviour.

11. `bulk-toolbar.ts`, `bulk-selection.ts`, and `bulk-operations.ts` internals
    are **not changed** — they are already layout-agnostic.

12. This refactor ships before any further layout types are added.

---

## Proposed Constraints

- **C-1 (Enrichment gate).** Remove `layoutKey === "folder-table" &&` from the
  `needsEnrichment` condition in `tab.ts`. The new condition is simply:
  `config.extraFields.length > 0 || imageColumnsRequested(config)`. This is
  necessary and sufficient because `parseFolderMd` already derives
  `config.extraFields` from non-builtin entries in `fields:` when `fields:` is
  declared (parser line 576–578). No parser changes are needed for the enrichment
  gate to work for cards.

- **C-2 (Toolbar construction moves to `tab.ts`).** `renderFolderViewTabAsync`
  creates `SelectionState` and calls `buildToolbar()` before dispatching to the
  layout renderer. Both `selectionState` and `toolbarRefs` are passed as new
  arguments to the `FolderLayoutRenderer` signature (or via a shared context
  object). `table-renderer.ts` removes its own `SelectionState`/toolbar
  construction and uses the passed-in values instead. `renderer.ts` adds its own
  checkbox and toolbar wiring using the same passed-in values.

  **Alternative:** keep toolbar construction inside each renderer but factor out
  a shared helper function exported from a new `shared-bulk.ts`. This avoids
  changing the `FolderLayoutRenderer` type signature. Architect should decide.

- **C-3 (No `FolderViewConfig` changes for default cards fields).** Rather than
  adding a new config field (e.g. `cardsDefaultFields`), the default metadata
  rendering for cards is hard-coded inside `renderer.ts`: when `config.fields`
  is null and `config.extraFields` is empty, show `modified` and `tags` only if
  those items are non-empty. This avoids widening the `FolderViewConfig` type
  and keeps `parser.ts` unchanged.

- **C-4 (Metadata line rendering in cards — XSS).** All field values in the
  metadata line must use `.textContent`, not `.innerHTML`. This mirrors the
  existing table renderer pattern and is non-negotiable given the XSS surface
  (frontmatter values are user-controlled).

- **C-5 (Checkbox cell does not trigger card navigation).** The checkbox `<input>`
  and its containing element must call `event.stopPropagation()` to prevent the
  card's `click` handler from firing when the user checks a card. This matches
  the existing `buildCheckboxTd` pattern in `bulk-selection.ts`.

- **C-6 (Lazy-loading compatibility).** Cards are loaded in batches via
  `IntersectionObserver`. Checkboxes added to lazy-loaded cards must register
  into the same `SelectionState`, `rowCheckboxes`, and `sectionPaths` arrays
  used by the section master checkbox. The lazy-load path in `appendCardsToGrid`
  must pass these arrays through to `buildCard` (or equivalent) — this is the
  critical threading requirement. The architect must design the wiring so that
  each `IntersectionObserver` callback closure captures the correct per-section
  arrays, not a stale snapshot.

- **C-7 (Sort-rebuild clears selection in cards).** When the cards view is
  re-sorted (if sort is added), the selection state must be cleared before
  rebuilding. For v1 of this refactor, cards do not support interactive sort,
  so this constraint applies only if the architect decides to add card sorting
  in the same task.

- **C-8 (`FOLDER_VIEW_STARTER` update).** The comment in `FOLDER_VIEW_STARTER`
  that describes `fields:` as "folder-table only" must be removed. The updated
  comment must explain that `fields:` applies to both layouts: for table it drives
  column order; for cards it drives the metadata line below the card name. The
  `extra-fields:` comment must similarly remove any table-only qualifier.

- **C-9 (CSS for metadata line).** A new CSS class (`.folder-view-card-meta`)
  must be added to `folder-view-css.ts` for the metadata line beneath the card
  name. Styling: smaller font, muted color, consistent with the existing
  `.folder-view-card-date` style. The metadata line replaces the existing
  `.folder-view-card-date` element when `fields:` is declared — the two must not
  appear simultaneously.

- **C-10 (CSS for card checkbox).** A new CSS rule for the card checkbox element
  must be added to `folder-view-css.ts`. Positioning: `position: absolute`,
  top-left corner of the card. Visibility: `opacity: 0` by default; transitions
  to `opacity: 1` when the card or its ancestor section is hovered (using the
  same opacity-transition pattern already present in the app). The checkbox must
  not interfere with the card preview image layout.

---

## Files That Change

| File | Nature of change |
|---|---|
| `tab.ts` | Remove `layoutKey === "folder-table" &&` from enrichment gate; move `SelectionState` + `buildToolbar()` construction here (if C-2 preferred over alternative) |
| `renderer.ts` | Add checkbox per card (top-left, hover-only, wired to `SelectionState`); add metadata line below card name (from `config.fields` / `config.extraFields` / default fields); wire lazy-load path to pass selection arrays through; wire master checkbox per section |
| `table-renderer.ts` | Remove `SelectionState` + `buildToolbar()` construction (if C-2 preferred); receive them as parameters or from shared context |
| `folder-view-css.ts` | Add `.folder-view-card-meta` styles; add card checkbox position and hover-opacity CSS (C-9, C-10) |
| `file-browser.plugin.ts` | Update `FOLDER_VIEW_STARTER` comment on `fields:` and `extra-fields:` to remove "folder-table only" qualifier (C-8) |

## Files That Do NOT Change

| File | Reason |
|---|---|
| `bulk-toolbar.ts` | Already layout-agnostic |
| `bulk-selection.ts` | Already layout-agnostic |
| `bulk-operations.ts` | Already layout-agnostic |
| `parser.ts` | No new YAML keys; existing `fields:` / `extra-fields:` parsing is sufficient |
| `types.ts` | `FolderViewConfig` and `FolderCard` need no new fields (C-3); `FolderLayoutRenderer` signature may change only if C-2 approach adds parameters |
| `folder-table-css.ts` | Table-specific styles unchanged |
| `yaml-frontmatter.ts` | No change |
| `frontmatter-reader.ts` | No change |

---

## Edge Case Inventory

The following edge cases must be verified in tests and code review. This list is
the Reviewer's mandatory test checklist.

**EC-1 — Cards layout, no `fields:` declared, no `extra-fields:`.**
Expected: metadata line shows `modified` (if > 0) and tags (if any) as plain
text values separated by ` · `, matching the existing `showModified`/`showTags`
defaults. No enrichment reads occur because `config.extraFields` is empty and
`imageColumnsRequested` returns false.

**EC-2 — Cards layout, `fields:` declared with only built-in fields (e.g. `modified`, `tags`).**
Expected: metadata line shows exactly those fields in declaration order, values
only, separated by ` · `. No enrichment reads occur (no custom frontmatter keys,
no image keys). Card click still navigates normally.

**EC-3 — Cards layout, `fields:` declared with a custom frontmatter key (e.g. `status`).**
Expected: enrichment runs and reads `status` from each `.md` file's frontmatter.
The value appears in the metadata line. Cards with no `status` key show an em-dash.
Non-`.md` cards (images, PDFs) show an em-dash for custom keys.

**EC-4 — Cards layout, `fields:` includes image built-in keys (`width`, `height`) and cards include image files.**
Expected: enrichment runs `get_image_dimensions` for each image card. Values appear
in the metadata line for image cards. Non-image cards show an em-dash.

**EC-5 — Cards layout, `fields:` declared, card count exceeds `LAZY_BATCH_SIZE` (50).**
Expected: lazily-loaded card batch registers checkboxes into the same
`SelectionState` and section arrays as the first batch. The `IntersectionObserver`
callback closure must capture the per-section `rowCheckboxes` and `sectionPaths`
arrays by reference (not copy). Master checkbox state transitions
(unchecked → indeterminate → checked) remain correct after lazy load fires.

**EC-6 — User checks a card, then a lazy batch loads.**
Expected: previously checked cards retain their `fv-row--selected` visual class
and their paths remain in `selectionState.paths`. Newly loaded cards start
unchecked. Master checkbox transitions to indeterminate if partial selection
now exists.

**EC-7 — Bulk delete on cards layout.**
Expected: same flow as table layout. After `refreshLayoutView()`, the entire host
is re-rendered and selection is cleared. The toolbar hides. No ghost-checked cards
appear.

**EC-8 — Bulk move on cards layout.**
Expected: same as EC-7. Destination path input and Confirm Move flow are identical
to the table layout because `buildToolbar` is reused unchanged.

**EC-9 — Card checkbox click does not navigate.**
Expected: clicking the checkbox area does not open the file or expand the folder.
`stopPropagation()` on both the `<input>` change event and the containing element
click event prevents the card's navigation handler from firing.

**EC-10 — Directory card checkbox.**
Expected: directory cards include a checkbox and can be selected for bulk operations
(move, delete). The `kindMap` entry for directory paths is `"directory"`, so
`executeBulkDelete` dispatches the correct `delete_directory` Tauri command.

**EC-11 — Mixed layout: one folder uses `folder-cards`, another uses `folder-table`.**
Expected: both folders function independently. Each render call is isolated — a
`SelectionState` created for one folder view has no effect on another. Switching
tabs between the two layouts does not cause shared state contamination.

**EC-12 — `fields:` declared in a `folder-table` `_folder.md` after the refactor.**
Expected: table layout behaviour is identical to today. Enrichment gate change
does not break anything. Column rendering, sort, and bulk operations all work as
before.

**EC-13 — `fields:` contains only `name` (no date, no tags, no custom fields).**
Expected for cards: metadata line is empty (or omitted entirely). The card shows
only the name, preview, and checkbox — no `.folder-view-card-meta` element is
appended to the DOM. No enrichment runs.

**EC-14 — `fields:` contains `count` for a `folder-cards` layout.**
Expected: `count` appears in the metadata line of directory cards only (showing
`childCount`). File cards show an em-dash for `count`, consistent with how the
table layout handles this case.

**EC-15 — XSS attempt: a file has a frontmatter value containing `<script>alert(1)</script>`.**
Expected: the metadata line renders the raw string via `.textContent`, not
`.innerHTML`. The `<script>` tag is displayed as literal text, not executed.

**EC-16 — `show-modified: false` and `fields:` both declared in a cards `_folder.md`.**
Expected: `fields:` fully supersedes `show-modified`. If `modified` is not in
`fields:`, no modified date appears — regardless of the `show-modified:` boolean.
The boolean flags are ignored entirely when `fields:` is declared.

**EC-17 — Enrichment failure for one card (read_file returns error).**
Expected: that card's `meta` is set to `{}`. Its metadata line shows em-dashes for
all custom fields. Other cards in the same render complete normally (per-card error
isolation, unchanged from the existing table enrichment logic).

**EC-18 — Checkbox visibility on hover: parent section hover vs. card hover.**
Expected: checkbox becomes visible (opacity 1) when either the individual card
is hovered or when the parent section container is hovered (whichever CSS rule
is used). Checkbox returns to invisible when hover leaves both the card and the
section. The transition must use the same opacity-transition duration as other
hover effects in the app.

---

## Out of Scope for This Task

- Adding new layout types beyond `folder-cards` and `folder-table`.
- Interactive column sorting in the cards layout (cards do not have sortable
  column headers; config `sort:` continues to control initial card order).
- YAML editor / UI for configuring `fields:` — users edit `_folder.md` directly.
- Changes to `bulk-operations.ts`, `bulk-toolbar.ts`, or `bulk-selection.ts`
  internals.
- Any change to the Rust backend commands.
- Adding image preview to the metadata line (images continue to show the preview
  rectangle as today; image metadata via `fields:` appears in the text metadata
  line below the name).

---

## Open Questions for Architect

The following design decision must be resolved during architecture (not during
requirements):

**OQ-1 — Shared context vs. changed renderer signature.**
C-2 proposes moving `SelectionState` + toolbar construction to `tab.ts` and
passing them as parameters to each renderer. This changes the `FolderLayoutRenderer`
type signature, which is a type-level breaking change for any future third-party
layout renderer. The alternative (a shared helper, new `shared-bulk.ts`) keeps the
signature stable. Architect to pick one approach and document the rationale.

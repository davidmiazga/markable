---
title: "Collections — Hierarchy, Drag, Composite Views"
last-updated: "2026-06-09"
review-cadence-days: 7
status: active
---

# Collections — Hierarchy, Drag-into-Container, and Composite Content Views

## Summary

As a Markable user organising notes in a Collection, I want (1) the popover's
**Chapter** and **Book** items to become first-class container levels above
Stack, (2) to drag a Note tile onto any deeper container tile (Stack / Chapter
/ Book) to MOVE the file into that folder, and (3) to toggle each
Stack/Chapter/Book panel between its existing icon-grid view and a rendered
**composite content view** that concatenates the children's bodies — so the
hierarchy feels coherent end-to-end without leaving the Collections home tab.

These three capabilities ship together because they are coupled: the level
marker drives renderer dispatch; the renderer dispatches the drop-target
hit-test; the drop-target completes the hierarchy; the composite is the
"flatten and read" payoff for assembling the hierarchy.

This builds directly on the shipped Collections MVP
(`docs/specs/collections/00_index.md`, 226 tests passing) and the Unified
View Modal's codeblock-shape `_folder.md` precedent
(`docs/specs/view-modal/00_index.md`).

## Resolved Open Questions

| # | Question | Resolution | Source |
|---|---|---|---|
| Q1 | Composite delimiter between concatenated child bodies | **Blank line + `---` rule + blank line.** Stable, unambiguous, renders as a horizontal rule in preview. Inline-heading variants (`## <child name>`) deferred to Phase 2 if users request per-child anchors. | Plan brief recommendation |
| Q2 | Recursive composite cost for deep hierarchies (Book → Chapter → Stack) | **Accepted for MVP.** Lazy-on-read regenerates the full cascade when a Book content view opens. Caching / mtime invalidation is Phase 2 (DW). Architect to set a target latency budget (informally: <500 ms for a 3-level hierarchy with ~30 leaf notes). | Plan brief; locked decision 3 |
| Q3 | Chapter / Book initial state on create | **Empty container, matching Stack creation.** No auto-populated child. Users add children via the popover, drag, or right-click. Symmetry with current `newStack` is more important than convenience. | Plan brief recommendation |
| Q4 | Cross-container drop visual | **Solid 2px border highlight in `--accent-color` token + 6% tinted background.** No pulse animation. Tile cursor becomes "copy" style during a valid hover; "not-allowed" during an invalid hover. Architect owns final pixel tuning; the token + structural choice is locked here. | Architect-deferred per brief; we lock the structural choice |
| Q5 | Composite editing | **Read-only.** Composite is a generated artifact; editing must happen on the source children. The rendered composite uses the existing markdown preview pipeline (no CM6 editor mount). Re-opening the content view always shows the latest regeneration. | Plan brief recommendation |
| Q6 | Composite frontmatter visibility | **Body-only rendering.** The composite's own frontmatter (`composite: true`, plus the auto-generated title) is stripped from the user-visible render. The frontmatter exists on disk so the file-view filter can identify and exclude it. | Plan brief recommendation |
| Q7 | Composite includes referenced notes (Stack `references:`) | **Yes — referenced note bodies are included** in the composite, ordered after canonical-`order:` notes (mirrors the file-view sequence: canonical first, then references). A broken reference renders as an italic "_(missing: <path>)_" placeholder line in the composite, never silently dropped. | Plan brief recommendation |
| Q8 | Should ascending / lateral drag show any visual hint? | **No.** Invalid drop targets receive no highlight class and no cursor change beyond the default drag cursor. Drop is a silent no-op. This is the existing sibling-reorder util's behaviour and matches the brief's "no-op, no error". | Inferred |
| Q9 | Does the composite write happen ALSO on the first read of an empty (never-opened) composite? | **Yes** — first open of content view triggers regeneration regardless of whether the composite file exists yet. The file is created via the same atomic `writeFile` path. | Inferred from "lazy on read" |
| Q10 | Where is `level:` persisted — frontmatter or the codeblock body? | **Codeblock body (the `select` fence)**, alongside the existing `type` / `displayName` / `stackOrder` / `order` / `references` keys. This matches the View Modal migration: subfolder `_folder.md` files written by this feature carry their keys in the codeblock, not frontmatter. The `view:` key persists in the same codeblock body. | Architect-locked precedent from View Modal AD-5 / AD-6 |
| Q11 | What about Collection root vs container subfolders — does the Collection root carry a `level:` too? | **No.** The Collection root keeps `layout: collection-home` as its discriminator (existing behaviour). Only subfolders inside a Collection carry `level: stack | chapter | book`. Subfolders without `level:` are treated as `stack` for read-compat (preserves current behaviour for Stacks created before this feature). | Plan brief recommendation |

## Functional Requirements

### FR-1 — Popover enables Chapter & Book

The Collection home-canvas popover's currently-stubbed **Chapter** and **Book**
items become functional. Selecting them invokes the new commands (FR-2).

### FR-2 — New container-creation commands

- `commands.newChapter(parentPath)` — creates a uniquely-named subfolder
  (`Chapter 01`, `Chapter 02`, …) inside `parentPath`, writes `_folder.md`
  with `level: chapter`, `type: stack` (legacy compat — Architect may
  rename the type field), `displayName`, and an empty `stackOrder:`.
- `commands.newBook(parentPath)` — analogous, with `level: book` and a child
  ordering field (Architect decides whether `stackOrder` is reused or a
  separate `chapterOrder` field is introduced).
- Both reuse `uniqueUntitled()` for collision avoidance.
- Both write through the existing atomic-write path (no new Rust commands).

### FR-3 — Level marker persistence

Every container subfolder's `_folder.md` carries `level: stack | chapter | book`
in the `select` codeblock body. The Collection root keeps `layout: collection-home`.
Subfolders without `level:` default to `stack` on read (preserves all existing
Stacks).

### FR-4 — Renderer dispatch by level

`renderer.ts` reads the active folder's `level:` and dispatches to:

- `level: stack` → existing `stack-panel.ts` (renders note tiles).
- `level: chapter` → new `chapter-panel.ts` (renders Stack tiles as children).
- `level: book` → new `book-panel.ts` (renders Chapter tiles as children).

A Chapter panel renders its child folders the same way the Home canvas renders
Stacks; a Book panel renders its child folders the same way (but the children
are Chapters). The breadcrumb extends to reflect deeper navigation (already
supports 5 segments).

### FR-5 — Drop-target detection layer

A new `drop-target.ts` module installs a pointer-event layer parallel to
`folder-item-drag.ts`:

- During drag of any item bearing `data-source-id` (note tile, Stack tile,
  Chapter tile), hit-tests the cursor against tiles bearing `data-level`.
- If the target's `level:` is a valid descent from the source's level:
  - Apply `.is-drop-target` class to the target tile.
  - Show "copy" cursor.
- If the target is invalid (ascending, lateral, same-tile, descendant-of-self):
  - No highlight class added.
  - No cursor change.
  - No-op on release.

### FR-6 — Valid descent matrix

Sources may descend to:

| Source level | Valid targets |
|---|---|
| Note (no `level:`) | Stack, Chapter, Book |
| Stack | Chapter, Book |
| Chapter | Book |
| Book | (no descent — Book is the top container level) |

Ascending (Note → root, Stack → root) and lateral (Note → Note, Stack → Stack)
drags are refused at the hit-test layer; no DOM artifact is left behind on
mouseup.

### FR-7 — Drop dispatch

On a valid drop:

1. `moveFile(sourcePath, targetFolderPath)` (existing bridge wrapper, atomic
   Rust-side `move_file`).
2. Remove the source's name from the source parent's order array
   (`order:` for notes; `stackOrder:` for child folders) via
   `store.removeNoteFromStack` / equivalent.
3. Append the source's new name to the target's order array
   (`store.appendNoteToStack` / equivalent).
4. `vault-manager.reloadVaultIndex()` so the file browser tree and home canvas
   tile counts refresh.
5. The reference-integrity watcher fires automatically on the rename event and
   updates any cross-Stack `references:` arrays (existing wiring;
   no change needed).

### FR-8 — View toggle in panel header

Each Stack / Chapter / Book panel header carries a two-state toggle:

- **File view** (default) — icon-grid view as today (note tiles for Stack;
  Stack tiles for Chapter; Chapter tiles for Book).
- **Content view** — renders the composite markdown as a read-only preview.

The toggle uses icon-grid and doc-text glyphs (Architect picks exact SVGs).
The active state is persisted per-folder in the `_folder.md` codeblock body as
`view: file | content` (default `file`).

### FR-9 — Composite file: location, name, identity

When the user opens or toggles to the content view, the composite is
(re)generated and atomically written to:

```
<folder>/<folder-name>.md
```

The file carries frontmatter `composite: true` (Architect: place this in the
file's frontmatter, NOT the codeblock — `composite:` is a render-control flag,
not a render-config flag). The first line of the body is the composite content
(after frontmatter strip).

### FR-10 — File view excludes composites

The file view (icon-grid) filters out any child `.md` file whose frontmatter
includes `composite: true`. This filter survives folder renames (the
filter is by flag, not by name).

### FR-11 — Composite generation per level

- **Stack composite**: concatenate child note bodies in `order:` sequence,
  followed by referenced-note bodies in `references:` sequence
  (resolving each canonical path; broken refs render as the missing-line
  placeholder in Q7). Each child body has its YAML frontmatter stripped
  before inclusion.
- **Chapter composite**: recursively regenerate each child Stack's composite
  first (lazy cascade), then concatenate the resulting bodies in
  `stackOrder:` sequence.
- **Book composite**: recursively regenerate each child Chapter's composite,
  then concatenate in the Book's `stackOrder:` (or `chapterOrder:`) sequence.

### FR-12 — Composite delimiter

Children are separated by:

```
\n\n---\n\n
```

(blank line + `---` + blank line). This produces a visible horizontal rule in
the rendered preview. The delimiter is NOT inserted before the first child or
after the last.

### FR-13 — Composite read-only rendering

The content view uses the existing markdown preview pipeline (the same `marked`
+ extension wiring used by the live-preview chain). It does NOT mount a CM6
EditorView. Click handlers, selection, and edits are disabled in this view.

### FR-14 — View toggle persists across reopen

Closing the panel (breadcrumb-back, tab close) and reopening it restores the
last-used view per folder. Persistence happens through the existing
`store.write*Meta()` path (the `view:` key is part of the codeblock body it
already manages).

### FR-15 — Read-compat for pre-feature Stacks

Any `_folder.md` written before this feature ships continues to render as a
Stack with file view, no migration required. Migration-on-write applies the
new `level:` and `view:` keys only when the user touches the folder via a
write path (popover create, drop, view toggle).

### FR-16 — Renderer dispatches composite drop for empty containers

A Chapter or Book with no children renders an empty-state placeholder
mirroring the Home canvas's "+ Notecard / Stack" affordance. The popover from
that affordance offers level-appropriate items (a Chapter's `+` offers
Stack; a Book's `+` offers Chapter; Architect may also include Note as a
convenience).

## Non-Functional Requirements

### NFR-1 — Window-size invariant intact

`tests/settings/window-defaults.test.ts` must remain green. No edits to
`src/lib/settings.ts` `window.sizeW` / `sizeH` or `src-tauri/src/lib.rs`.

### NFR-2 — Atomic writes only; no new Rust commands

All file mutations (composite write, `_folder.md` write, file move) route
through existing `bridge.ts` wrappers (`writeFile`, `moveFile`). The composite
is a real `.md` file written through the existing atomic-write Rust command.

### NFR-3 — Theme tokens only

The `.is-drop-target` highlight, view-toggle button styles, and any new
CSS must use canonical tokens from `src/styles.css`. No hardcoded hex; no
new tokens added (the existing palette covers accent + background +
border + text).

### NFR-4 — Composite regen latency budget

For a 3-level hierarchy with ~30 leaf notes (~50 KB total markdown), opening
a Book content view should complete the cascade and paint within 500 ms on
the dev machine. Architect quantifies after step planning; if exceeded, mtime
caching becomes a Phase-1 requirement rather than a deferral.

### NFR-5 — No TODOs in source

Deferred work goes in the Architect's spec `00_index.md` deferred-work table.

### NFR-6 — Plugin rebuild

Every change to `src/plugins/**/*.ts` must be followed by
`npm run build:plugins && npm run sync:plugins` before testing.

### NFR-7 — Test discipline

Each EC in the inventory below maps to ≥1 failing test written before the
implementation step that satisfies it. Tests live in
`tests/collections/hierarchy/` (new subdirectory) and existing
`tests/collections/` for reused-pattern coverage.

### NFR-8 — Plugin API unchanged

This feature touches only `src/plugins/file-browser/collections/` and the
existing `vault-manager` watcher. The `MarkablePluginAPI` surface is not
extended.

## Edge Case Inventory

The Reviewer must verify every EC below has a passing test before merge.

| # | Edge Case | Expected behaviour |
|---|---|---|
| EC-1 | Drag-cancel mid-hover | `.is-drop-target` class removed from every tile on `mouseup` AND on `Escape` keydown during drag. No DOM artifact survives. |
| EC-2 | Drop on invalid target (Note → Note) | Hit-test refuses; no highlight applied; no move dispatched; no toast. Silent no-op. |
| EC-3 | Drag a folder into its own descendant (cycle) | Refused at hit-test layer: target's path is a descendant of source. No move; no highlight. |
| EC-4 | Composite filename collides with a real authored note | If `<Stack>/<Stack>.md` already exists as a non-composite user note (no `composite: true` flag), the composite write refuses with a toast: "Cannot generate composite — a note with this name already exists. Rename it to enable the content view." File view still works. |
| EC-5 | Composite of an empty container | Write an empty body (just the `composite: true` frontmatter block). The content view shows a non-error placeholder: "_(no children to compose)_". |
| EC-6 | Broken reference in Stack `references:` | Composite renders an italic placeholder `_(missing: <path>)_` line in place of the referenced body. Sequence position preserved. |
| EC-7 | View toggle state survives close-reopen | Per-folder `view:` written to codeblock body on every toggle; restored on next render. |
| EC-8 | Reorder children, then open content view | Lazy regen reads the updated `order:` / `stackOrder:` and produces a composite in the new sequence. |
| EC-9 | Cross-Stack drag — Note from Stack A dragged onto Stack B's tile (rendered as a sibling tile in the parent Chapter) | Drop is valid (Note → Stack is descent). Move succeeds; both Stack A's `order:` and Stack B's `order:` update; vault index reloads. |
| EC-10 | Vault index refresh after drop | After `moveFile()` completes, file-browser tree refreshes AND home canvas badge counts refresh in the same render pass. No stale tile counts. |
| EC-11 | Drop highlight respects level matrix dynamically | Mid-drag, hovering over a Note tile while dragging a Stack → no highlight (Stack cannot descend into Note). Hovering over a Chapter tile → highlight applied. |
| EC-12 | Stale composite on disk | Between the last regen and the next content-view open, the composite may be stale. This is accepted per locked decision 3. The next content-view open regenerates atomically. |
| EC-13 | Composite write fails (disk full, permission denied) | Toast the error; file view continues to render normally; content view shows the error inline (no infinite spinner). |
| EC-14 | Pre-feature Stack opened | Subfolder with no `level:` key renders as a Stack with file view (default). No migration on read. |
| EC-15 | Toggle view on pre-feature Stack | First toggle writes both `level: stack` AND `view: content` to the codeblock (migration-on-write). Composite generated. |
| EC-16 | Chapter/Book creation when no Collection root exists | Popover commands `newChapter` / `newBook` refuse if invoked outside a Collection (same gate as `newStack`). |
| EC-17 | Composite frontmatter visible to user | The rendered content view strips the composite's own frontmatter (`composite: true` + title). User sees only the body. The composite frontmatter remains on disk. |
| EC-18 | Composite includes references but a referenced file is unreadable (permission denied) | Treated as broken reference (EC-6 placeholder). No crash. |
| EC-19 | Drop a Book onto another tile | Refused — Book has no valid descent target. No highlight; no-op. |
| EC-20 | Concurrent drops to the same target | Per-file write queue (existing `withFileQueue`) serialises the `_folder.md` updates. No corruption. |
| EC-21 | `moveFile` collision (target already contains a file with the same name) | The Rust `move_file` command auto-renames with `-1` suffix per existing behaviour. The new name is appended to the target's `order:` (not the original). |
| EC-22 | Re-toggle to file view mid-regen | Regen completes in the background (the `writeFile` promise is awaited but not blocking the toggle return); the file view paints immediately. The composite may be in either state on disk — both are valid. |
| EC-23 | Composite includes a Stack whose own composite is stale | Recursive regen always recomputes Stack composites bottom-up; the Book's recursive walk regenerates Stacks first, then Chapters, then itself. |
| EC-24 | Window-invariant regression check | `tests/settings/window-defaults.test.ts` green throughout. |
| EC-25 | Plugin IIFE not rebuilt | Lead Dev must run `npm run build:plugins && npm run sync:plugins` after every plugin-source edit; CI catches stale IIFEs via test failure mode. |
| EC-26 | Same-tile drop (drop a tile onto itself) | Refused — source path equals target path. No-op. |

## Out of Scope (Deferred — Phase 2)

- **Editable composite that propagates back to children** (per Q5 resolution).
- **Composite caching with mtime invalidation** — every content-view open
  re-regenerates the full subtree. Caching deferred to Phase 2 if NFR-4 is
  hit or user perceptual lag is reported.
- **Ascending drag** (Note → parent folder) — users can still right-click "Move
  to other Stack…" (already wired).
- **Cross-Collection drag** — dropping into a different Collection's Stack
  is not supported; the drop-target hit-test refuses tiles outside the current
  Collection's subtree.
- **Per-level distinct icons** — Stack, Chapter, Book all use `icon-Stack.svg`
  for MVP. Distinct glyphs are a Phase-2 visual polish.
- **Reverse-engineering manual edits to the composite back to children** — if
  a user opens the composite `.md` directly (outside the content view) and
  edits it, those edits are lost on the next regen. The file is a generated
  artifact; the user is expected to edit children, not the composite.
- **Per-child anchor headings in the composite** — inline `## <child name>`
  separators are deferred; MVP ships the horizontal-rule delimiter only.
- **Drop-target animation polish** — pulse, fade-in, drop-zone hatched
  background — all deferred. MVP ships solid-border + tinted-bg only.
- **Multi-select drag** — dragging multiple tiles at once. MVP supports
  single-tile drag only.

## Files Expected to Change

Mirroring the plan's Scope section (Architect confirms exact paths and line
numbers in `docs/specs/collections-hierarchy/00_index.md`):

### NEW

- `src/plugins/file-browser/collections/composite.ts` — composite generator.
- `src/plugins/file-browser/collections/drop-target.ts` — pointer-event drop
  detection layer.
- `src/plugins/file-browser/collections/chapter-panel.ts` — Chapter renderer.
- `src/plugins/file-browser/collections/book-panel.ts` — Book renderer.
- Shared view-toggle helper (location TBD by Architect — likely
  `panel-header.ts` or inlined per panel).

### EDIT

- `src/plugins/file-browser/collections/popover.ts` — enable Chapter / Book
  items; wire to new commands.
- `src/plugins/file-browser/collections/store.ts` — extend codeblock body
  read/write to include `level:` and `view:`. Add `readLevel` / `writeLevel`
  helpers. Generalise child-order helpers if Chapter/Book introduce a
  parallel field name.
- `src/plugins/file-browser/collections/stack-panel.ts` — header view-toggle;
  composite filter on file-view child list; content-view branch that
  invokes `composite.ts` and renders via marked.
- `src/plugins/file-browser/collections/home-canvas.ts` — `data-level`
  tagging on tiles; drop-target wiring; multi-level tile rendering.
- `src/plugins/file-browser/collections/renderer.ts` — level-based panel
  dispatch; breadcrumb extension.
- `src/plugins/file-browser/collections/commands.ts` — `newChapter`,
  `newBook`, `moveChildIntoContainer` helper.
- `src/plugins/file-browser/collections/types.ts` — `Level` enum,
  `ChapterMeta`, `BookMeta`, `CompositeFlag`.
- `src/plugins/file-browser/collections/collections.css` — drop-target
  highlight class, view-toggle button styles (canonical tokens only).
- `tests/collections/` — new sub-directory `hierarchy/` with per-EC tests.

### NO CHANGE (precedent reused)

- `src/lib/bridge.ts` `moveFile` / `writeFile` — exact APIs needed.
- `src-tauri/src/commands/file_ops.rs` `move_file` — already atomic.
- `src/plugins/file-browser/folder-view/folder-item-drag.ts` — sibling
  reorder keeps its existing behaviour; the new drop-target layer is parallel.
- `src/plugins/file-browser/collections/reference-integrity-wiring.ts` —
  watcher fires on programmatic moves; `references:` arrays auto-update.
- `src/lib/settings.ts`, `src-tauri/src/lib.rs` — window invariant locked.

## Verification

### Automated

- `npm run test:run` — full suite green; new `tests/collections/hierarchy/`
  coverage added. Baseline before this feature: 226 Collections tests, 4825
  project tests (per View Modal Review Sign-off).
- `npm run test:run -- tests/settings/window-defaults.test.ts` — invariant
  green (EC-24).
- `npm run test:run -- tests/collections/` — full Collections suite green
  including new hierarchy/ subdirectory.
- `npm run build` — TypeScript clean.
- `cargo test` from `src-tauri/` — no Rust changes; all green.
- `npm run build:plugins && npm run sync:plugins` after every plugin-source
  edit.

### Manual scenarios

1. In a Collection with two loose notes and one empty Stack, drag a note onto
   the Stack tile → the note file moves into the Stack folder; both source
   and target `order:` arrays update; file browser tree refreshes;
   home-canvas badge count on the Stack increments from 0 to 1.
2. Create a Chapter via the popover (now enabled). Verify `_folder.md` carries
   `level: chapter` in the codeblock body. Drag a Stack tile onto the Chapter
   tile → Stack folder is moved into the Chapter.
3. Drag a note tile directly onto a Chapter tile (skipping Stack) → note moves
   into the Chapter root. Chapter's file view shows it.
4. Open a Stack with three notes. Click the content toggle in the header. The
   composite content view renders the three note bodies concatenated in
   `order:` sequence, separated by horizontal rules. The composite file exists
   on disk at `<Stack>/<Stack>.md` after the toggle.
5. Reorder notes via drag in the file view; toggle to content view → content
   order matches the new sequence (lazy regen worked).
6. Book-level composite — open a Book containing two Chapters, each with two
   Stacks, each with one note. Content view renders 4 note bodies in the
   expected nesting order, with `---` rules between every pair.
7. Composite file does NOT appear as a tile in the file view (filtered by
   `composite: true` frontmatter).
8. Refusing ascending drag — drag a Stack tile onto a Note tile → no
   highlight; no move; no error.
9. Refusing cycle — try to drag a Chapter tile onto a Stack tile that lives
   inside that Chapter → no highlight; no move.
10. View toggle persistence — toggle to content; navigate Home; navigate back
    → content view restored.
11. Window-invariant check — restart the app; window still launches at 50% ×
    80% centered.

## Handoff Summary

- Artifact: docs/requirements/active_task.md
- Status: Requirements Validated (Auto-Mode resolution of Q1–Q11 using
  brief recommendations; user may redirect any choice)
- Edge cases to verify in tests: 26 items in Edge Case Inventory

Next step: Activate @software-architect and provide
`docs/requirements/active_task.md` as context. Architect output target:
`docs/specs/collections-hierarchy/00_index.md` plus per-step files in the
same directory.

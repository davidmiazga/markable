---
title: "Collections — MVP (Frames 01–04) [PARKED]"
last-updated: "2026-06-05"
review-cadence-days: 30
status: draft
---

# Collections — MVP (Frames 01–04) [PARKED 2026-06-05]

> **Status: SUPERSEDED (2026-06-05).** This parked draft has been folded into the active spec at `docs/requirements/active_task.md`. All 8 AMENDMENTS PENDING items below are now reflected in the body of that document; Q10–Q12 (rendering strategy, naming flow re-confirmation, unclicked-state rendering) were resolved in Auto mode. Kept here as historical reference only — do **not** edit.
>
> **Original status: PARKED.** Work was paused pending the folder-icon-assignment prerequisite. When resuming, the Requirements Analyst was to fold the **AMENDMENTS PENDING** section below into the body of this document, then promote it back to `active_task.md` with `status: active`.

---

## AMENDMENTS PENDING (apply on resume)

The following revisions came from the user after the Analyst's first draft. They have NOT yet been merged into the body of this document.

1. **Sidecar file**: Use the existing `_folder.md` pattern (YAML frontmatter on a markdown file) instead of `_collection.json`. Rationale: `_folder.md` is the established Markable folder-metadata convention; `parser.ts` already parses it. All references to `_collection.json` throughout this document must change. Schema examples must move from JSON to YAML frontmatter.
2. **Q5 — Drag-reorder**: Move from "Phase 2 / deferred" to **near-term Phase 1.5 priority**. Right-click Move up/down is acceptable for first ship but drag-reorder must follow quickly. Remove drag-reorder from the Out-of-Scope list.
3. **Q7 — Stack visual treatment**: **Drop the bookshelf paired-palette reuse.** Stacks render using **user-assigned folder icons** (from the folder-icon-assignment prerequisite feature). Default icon when none is assigned: a stacked-card glyph specific to Collections. Constraint C-6 is deleted.
4. **NEW — Multi-reference notes**: A Stack's `_folder.md` frontmatter can hold pointer records (relative paths) to notes that live in other folders. The note file itself has a single canonical home; references are pointers, not copies. Editing the canonical file updates the note everywhere it appears. Remove "Multi-home notes" from Out-of-Scope; add functional requirements for managing references (add, remove, render).
5. **NEW — Section view with Typora-style click-to-edit**: In frames 02/03 (a Stack's panel view), notes do NOT render as filename-only cards. They render as **framed boxes** with the note name labeled, displaying the note content (rendered markdown) inline. Clicking a box enters Typora-style edit mode for that note within the same panel. This supersedes FR-9 and changes NFR-1 (the 5,000-note performance target must be re-evaluated; lazy / virtualized rendering becomes necessary). The Analyst on resume should clarify with the user whether all notes are eagerly rendered or only the visible ones (recommend the latter).
6. **NEW — Hierarchy breadcrumb**: The full breadcrumb is `Home(Collection Name)/Book/Chapter/Section-stack/Notes.md`. MVP only implements Collection → Stack → Note; the breadcrumb component must be designed to support the deeper levels (Book, Chapter) so Phase 2 doesn't require rebuilding the navigation chrome.
7. **NEW — Prerequisite feature**: Folder-icon assignment ships as a separate feature first. This document assumes that prerequisite is complete when work resumes — specifically, that the folder-view tree can render a user-assigned icon per folder. The Analyst should add a "Prerequisites" section pointing to that feature's spec.
8. **Naming flow (Q8) reaffirmed**: User-named on creation is preferred; auto-name-then-rename is acceptable as the simpler MVP path. No change required, but the Analyst should re-confirm on resume.

---

# Collections — MVP (Frames 01–04)

## Summary

As a user, I want to designate a vault folder as a **Collection**, group my
notes into one or more **Stacks** inside it, and see a "Home" canvas that
renders each Stack as a stacked-card glyph with a badge count — so I can
organize notes into named groups without leaving the filesystem behind, and
so the structure survives Finder moves and round-trips through other tools.

The MVP delivers frames 01–04 of the Figma mockup at
`/Users/daveslaptop/Desktop/Screenshot 2026-06-05 at 4.28.37 PM.png`:

- **Frame 01** — Empty Collection canvas with `+ Notecard/Stack` prompt
- **Frame 02** — Single Stack containing one note card
- **Frame 03** — Same Stack populated with multiple note cards
- **Frame 04** — Home canvas: each Stack rendered as a stacked-card icon
  with a badge showing note count, plus a `+` to add another Stack

Frames 05–09 (rename-multiple, Chapters, Books, settings, workflow
configurator) are **Phase 2** and explicitly out of scope here.

---

## Knowns

### Locked decisions (from the planning brief)

1. **Feature name**: **Collections.** Top-level entity is a Collection; the
   basic notecard grouping inside is a **Stack**. This supersedes the
   older "Stacks" Tier-1 entry in `docs/handoffs/PKM-features-v2.0.md`.
2. **Storage**: **Hybrid — real folders + sidecar JSON.** A Collection is
   a real folder. Each Stack is a real subfolder of the Collection. Notes
   are real `.md` files inside the Stack folder. Per-folder
   `_collection.json` sidecars carry display name, type tag, ordering,
   and (for Phase 2) TOC/workflow config. The structure survives Finder
   moves, round-trips through other tools, and degrades gracefully if a
   sidecar is missing.
3. **Scope**: MVP = frames 01–04 only. Chapters/Books/configurator deferred.
4. **Implementation**: First-class core feature (not a user plugin). The
   plugin API lacks command-palette entries and granular file-event
   subscriptions that this feature requires.

### Resolved open questions (proposed answers — applied in this spec)

These were "Open Questions" in the brief. Operating in Auto mode, the
Analyst made the call below; the user may override before approval.

| # | Question | Resolution |
|---|----------|------------|
| Q1 | What designates a folder as a Collection? | A `_collection.json` sidecar at the folder root, written when the user invokes **"Make Collection"** on a folder via right-click in the file browser or via a command-bar entry. A Collection MAY be nested inside a normal folder. Nesting a Collection inside another Collection is **not** supported in MVP — surfaced as an error if attempted. |
| Q2 | Where does the "Home" canvas (frame 04) live? | It **replaces the standard folder view** when the active folder tab is a Collection folder. Implemented as a new folder-view layout key (`collection-home`) selected automatically by `detection.ts`, alongside the existing kanban/timeline/etc. renderers. No new tab kind. |
| Q3 | What does `+ Notecard/Stack` create in the empty state? | A two-item popover (`Stack` and `Notecard`). **Stack** creates a new auto-named Stack folder (`Stack 01`, `Stack 02`, ...). **Notecard** creates a new note (`Untitled.md`) inside a default Stack — if no Stack exists, one is created (`Stack 01`) and the note placed inside. Both flows leave the new item in immediate inline-rename mode. |
| Q4 | Multi-stack membership? | **Single-home for MVP.** A note lives in exactly one Stack folder. Sidecar-only multi-home references are out of scope. |
| Q5 | Drag-and-drop reordering of notes inside a Stack? | **Deferred to Phase 2.** MVP order is the `order` array in the Stack's `_collection.json`; mutation is via "Move up / Move down" right-click menu entries on each note card. |
| Q6 | Note thumbnail content? | **Filename only** (matches the Figma: cards show `MyNotecard.md`, `MyNotecard2…`, etc.). No body snippet, no first-heading read, no icon variation. Truncation with ellipsis at fixed card width. Zero file reads on render. |
| Q7 | Stack visual treatment (frame 04 stacked-card)? | Reuse the **bookshelf paired-palette pattern** already used for compact spines (see `project_bookshelf_css_patterns.md` and `bookshelf-patterns.ts`). Hash-derived stable slot from the Stack folder name → paired color palette. Badge is a small dark circle at the upper-right of the glyph showing `noteCount`. |
| Q8 | Stack naming/creation flow? | **Auto-name + immediate inline rename.** Creating a Stack writes the folder as `Stack 01` (next available index) and immediately focuses an inline rename input over the Stack label. Pressing `Enter` commits; `Escape` keeps the auto-name. No modal. |

---

## Functional Requirements

### Collection lifecycle

- **FR-1** — User can convert a folder into a Collection via right-click →
  **"Make Collection"** in the file browser, or via a command-bar entry
  `collection:make-collection`. The action writes a `_collection.json`
  sidecar at the folder root with shape:
  ```json
  {
    "schemaVersion": 1,
    "type": "collection",
    "displayName": "<folder name>",
    "stackOrder": []
  }
  ```
- **FR-2** — A folder containing a `_collection.json` with `"type": "collection"`
  at its root is recognized as a Collection on every vault scan and folder open.
- **FR-3** — Opening a Collection folder renders the **Home canvas** layout
  (`collection-home`) instead of the default folder view. The user can still
  switch to a standard folder layout via the existing display-options picker
  for debugging or escape-hatch reasons, but `collection-home` is the default.
- **FR-4** — User can convert a Collection back to a regular folder via
  right-click → **"Unmake Collection"**. This deletes the root
  `_collection.json` and all Stack `_collection.json` sidecars but leaves all
  `.md` files and folder structure untouched.

### Stack lifecycle

- **FR-5** — From an empty Collection (frame 01), clicking `+ Notecard/Stack`
  opens a popover with two options: **Stack** and **Notecard** (see Q3
  resolution). "Stack" creates a new Stack folder; "Notecard" creates a note
  inside the default Stack (creating Stack 01 if needed).
- **FR-6** — Creating a Stack writes a new subfolder named with the next
  available `Stack NN` index (`Stack 01`, `Stack 02`, ...) and a
  `_collection.json` sidecar inside it with shape:
  ```json
  {
    "schemaVersion": 1,
    "type": "stack",
    "displayName": "Stack 01",
    "order": []
  }
  ```
  The new Stack's id (folder name) is appended to the parent Collection's
  `stackOrder`.
- **FR-7** — User can rename a Stack inline (single click on the label →
  edit) or via right-click → **Rename Stack**. The folder is renamed via the
  existing atomic-rename Rust command **and** the sidecar's `displayName` is
  updated. The parent's `stackOrder` is updated to reflect the new folder name.
- **FR-8** — User can delete a Stack via right-click → **Delete Stack**.
  Confirmation modal warns that all notes inside will be moved to OS trash
  (uses the existing `move_to_trash` Rust command if present, else `delete_path`).

### Note lifecycle inside a Stack

- **FR-9** — Frame 02/03 Stack panels show each note as a small card with
  the **filename only** (no extension if `.md`; show extension for other
  types). Cards are arranged in a flex-wrap row inside the Stack panel.
- **FR-10** — Clicking a note card opens the file in a new tab via the
  existing `openFileInTab` pathway.
- **FR-11** — The trailing dashed-border card in each Stack (frames 02/03)
  is a **"+ Note"** affordance. Clicking it creates a new `Untitled.md` in
  that Stack and opens it in a new tab, with the filename selected for
  immediate rename.
- **FR-12** — Right-click on a note card offers: **Rename**, **Move up**,
  **Move down**, **Move to other Stack…**, **Delete**. "Move to other
  Stack…" updates both the source Stack's `order` array and the target
  Stack's `order` array, and atomically moves the file via Rust.

### Home canvas (frame 04)

- **FR-13** — The Home canvas header reads `Home` (or, in Phase 2, the
  Collection's `displayName`). Below the header, each Stack is rendered
  as a **stacked-card glyph** with a paired-palette color (Q7) and a
  badge in the upper-right showing the note count.
- **FR-14** — Stack glyphs are laid out in a flex-wrap row in the order
  defined by the parent Collection's `stackOrder`. Below the glyphs sits
  a `+` button that creates a new Stack (FR-6).
- **FR-15** — Clicking a Stack glyph opens the Stack's panel view (frame
  02/03 layout) in the same tab — i.e., the Home view "drills into" the
  Stack. A breadcrumb at the top lets the user return to Home.
- **FR-16** — Empty Collection (no Stacks yet) renders frame 01: a single
  large dashed rounded rectangle with the `+ Notecard/Stack` button
  centered. This is the **same** layout key (`collection-home`)
  rendering its empty state.

### Persistence and atomicity

- **FR-17** — All sidecar writes (root `_collection.json`, per-Stack
  `_collection.json`) go through the existing Rust temp-file-swap atomic
  write pattern (per CLAUDE.md). No direct overwrites.
- **FR-18** — All Tauri command calls go through `src/lib/bridge.ts`
  typed wrappers returning `FileResult<T>` (per CLAUDE.md). No raw
  `invoke()` calls anywhere in feature code.
- **FR-19** — `_collection.json` sidecars are **excluded** from vault
  indexing as notes. The vault index continues to scan the folder and
  list real `.md` files; the sidecars are read on demand by the
  Collections renderer. (Architect: extend `build_vault_index` ignore
  list or filter at read time.)

### Command-palette entries

- **FR-20** — Two new command-bar entries:
  - `collection:make-collection` — "Make Collection from Folder" (active
    when current focus is a folder)
  - `collection:new-stack` — "New Stack in Current Collection" (active
    when the active tab is a Collection)

  Section in keybindings panel: `"Collection"`. Both ship with
  `defaultKey: ""`.

---

## Non-Functional Requirements

- **NFR-1** — Home canvas rendering with up to 50 Stacks of up to 100
  notes each (5,000 notes total) must paint within 200ms on the dev
  machine. Achieved by reading only the sidecar JSON and never reading
  note bodies for rendering (per FR-9, Q6).
- **NFR-2** — A missing or corrupt sidecar must NEVER break the parent
  folder view. If `_collection.json` is missing on a folder previously
  marked as a Collection, the folder reverts to the standard folder
  view with a one-time toast: "Collection metadata missing. Reopen?"
  with a [Recreate] action.
- **NFR-3** — Window launch size invariant (`50% × 80%`) must not
  regress. The regression test
  `tests/settings/window-defaults.test.ts` must still pass after this
  feature ships. Verify both `src/lib/settings.ts` and
  `src-tauri/src/lib.rs` are untouched by this feature, OR if touched,
  both values match per CLAUDE.md.
- **NFR-4** — No TODO comments in source code (per CLAUDE.md). Deferred
  work is logged in `docs/specs/collections/00_index.md`.
- **NFR-5** — Atomic writes: every sidecar mutation passes through the
  Rust temp-file-swap pattern. A crash mid-write must leave either the
  old sidecar or the new sidecar intact — never a partial file.
- **NFR-6** — All file operations (folder create, folder rename, file
  move, file delete) use existing Rust commands. No new "convenience"
  wrappers that bypass the bridge layer.

---

## Proposed Constraints

- **C-1 (Layout key registration)** — Register a new
  `collection-home` layout in `LAYOUT_RENDERERS` at
  `src/plugins/file-browser/folder-view/tab.ts` (~line 109), following
  the 4-step folder-view-layout pattern documented in the project
  memory `project_folder_views`.
- **C-2 (Detection)** — `src/plugins/file-browser/folder-view/detection.ts`
  gains a check: if a folder contains `_collection.json` with
  `"type": "collection"`, return `"collection-home"` as the layout key.
  This check must short-circuit before any other detection logic.
- **C-3 (Sidecar I/O)** — New module `src/plugins/file-browser/collections/sidecar.ts`
  with typed `readCollectionSidecar(path)`, `writeCollectionSidecar(path, data)`,
  `readStackSidecar(path)`, `writeStackSidecar(path, data)` — all returning
  `FileResult<T>` via new bridge wrappers.
- **C-4 (Rust commands)** — New atomic-write Rust commands in
  `src-tauri/src/commands/collections.rs` (or extend the existing
  `files.rs` if it already exposes the temp-file-swap helper). Wired
  into the bridge layer via typed wrappers in `src/lib/bridge.ts`.
- **C-5 (Vault index exclusion)** — `_collection.json` files must be
  filtered out of `VaultIndex` `.md`-file enumeration. Implement in
  Rust `build_vault_index` (preferred — single source of truth) or
  at read time in `vault-manager.ts` (fallback).
- **C-6 (Stack visual reuse)** — The stacked-card glyph in the Home
  canvas reuses the paired-palette and hash-slot logic from
  `src/plugins/file-browser/folder-view/bookshelf-patterns.ts`. No
  parallel palette system. (Per `project_theme_system` memory and
  `feedback_look_first` memory — reuse existing CSS, do not invent.)
- **C-7 (Settings persistence)** — A minimal addition to
  `MarkableSettings.plugins["file-browser"].collections[vaultId]`
  for cross-Collection UI state only (e.g., last-opened Stack per
  Collection for breadcrumb restoration). All per-folder data lives
  in `_collection.json` sidecars, not in app settings.
- **C-8 (No TODOs)** — Deferred work (rename-multiple, Chapters,
  Books, settings panel, workflow configurator, multi-home,
  drag-reorder, import-existing-folder) is documented in
  `docs/specs/collections/00_index.md` only.
- **C-9 (Plugin build rule)** — If any file under
  `src/plugins/file-browser/**` is touched, `npm run build:plugins &&
  npm run sync:plugins` is mandatory (per CLAUDE.md). Architect must
  include this in the verification step of `00_index.md`.

---

## Edge Case Inventory

Every Edge Case must have a corresponding test in the Reviewer's final
checklist. Architect is required to write a failing test for each EC
before implementation begins.

- **EC-1 (Make Collection on a folder that already contains a
  `_collection.json`)** — Refuse the operation with a clear error
  ("Already a Collection"). Do not overwrite the existing sidecar.
- **EC-2 (Make Collection on a folder nested inside another
  Collection)** — Refuse with an error ("Nested Collections not
  supported in MVP"). Detected by walking parent folders and checking
  for any `_collection.json` ancestor with `"type": "collection"`.
- **EC-3 (Stack folder name conflict)** — Creating a new Stack when
  the auto-name (`Stack 01`, `Stack 02`, ...) already exists must
  increment to the next available index. If the user renames a Stack
  to a name that conflicts with another Stack folder, the rename is
  refused with an inline error.
- **EC-4 (Missing sidecar on Collection-marked folder)** — If the root
  `_collection.json` is deleted externally (Finder, git operation),
  the folder falls back to the standard folder view on next open
  with a one-time toast (NFR-2). No crash, no silent failure.
- **EC-5 (Missing sidecar on Stack folder)** — A Stack subfolder
  without `_collection.json` is **still rendered as a Stack** if its
  parent Collection's `stackOrder` includes it. The displayName is
  derived from the folder name; the `order` array defaults to the
  natural directory listing. A sidecar is written lazily on the next
  ordering change.
- **EC-6 (Corrupt sidecar JSON)** — If `_collection.json` exists but
  fails to parse, treat as missing (EC-4 / EC-5 path) and surface a
  toast with [View Error] for the user. Do not crash the file browser.
- **EC-7 (Note file moved via Finder while Markable is open)** — The
  file watcher detects the move; the Stack's `order` array is updated
  on next sidecar write. Stale entries in `order` that point to
  missing files are silently dropped from the rendered card list (no
  red error tiles).
- **EC-8 (Sidecar `stackOrder` references a folder that no longer
  exists)** — Stale folder references in `stackOrder` are silently
  dropped from the Home canvas render. The sidecar is rewritten on
  the next user action.
- **EC-9 (User deletes the last Stack in a Collection)** — The Home
  canvas returns to the frame-01 empty state. The Collection itself
  is NOT auto-removed; the user must explicitly "Unmake Collection"
  to revert to a normal folder.
- **EC-10 (Concurrent sidecar write)** — Two rapid actions (e.g.,
  user clicks "Move up" twice before the first write completes) must
  not corrupt the sidecar. Achieved by the temp-file-swap pattern
  plus a single-writer queue in `sidecar.ts` (per-file lock).
- **EC-11 (Note filename collision on rename)** — Renaming a note to
  a filename that already exists in the same Stack is refused with
  an inline error. The original filename is preserved.
- **EC-12 (Notecard creation when no Stack exists)** — Frame 01
  empty-state `+ Notecard` click auto-creates `Stack 01` first, then
  the note inside it. The Home canvas re-renders to show frame-02
  state in a single repaint (no flash).
- **EC-13 (Schema-version mismatch)** — A sidecar with
  `schemaVersion` greater than what the running build knows about
  is treated as read-only (rendered as-is) and a toast warns the
  user that this Collection was created by a newer version. No
  destructive writes.
- **EC-14 (Window-size invariant regression)** — Architect and Lead
  Dev must verify `tests/settings/window-defaults.test.ts` still
  passes after every change. Both `sizeW: "50%"` and `sizeH: "80%"`
  values are untouched. (Per CLAUDE.md invariant.)
- **EC-15 (Vault-index treats sidecar as a note)** — If the vault
  indexer ever surfaces `_collection.json` as a `.md`-equivalent
  searchable entry, this is a bug. Test: scan a Collection folder,
  assert the index contains zero entries with path ending in
  `_collection.json`.

---

## Out of Scope (Phase 2 / Later)

Captured explicitly so the Architect does NOT design for these:

- **Frame 05 — Rename-multiple stacks.** A bulk-rename interaction.
- **Frame 06 — Chapters.** A second hierarchical layer (Stacks
  grouped into Chapters), including the `_collection.json`
  `"type": "chapter"` variant.
- **Frame 07 — Books.** A third hierarchical layer (Chapters grouped
  into Books).
- **Frame 08 — Home settings access.** A gear icon on the Home
  canvas opening per-Collection settings.
- **Frame 09 — Workflow configurator.** The "Book workflow" editor
  with TOC, page numbers, and ordered hierarchy levels.
- **Multi-home notes.** A note appearing in more than one Stack
  (would require sidecar-only `references` arrays and a
  reverse-lookup index).
- **Drag-and-drop reordering.** Drag notes between Stacks, drag
  Stacks to reorder on the Home canvas. MVP uses right-click
  Move up / Move down + Move to other Stack…
- **Importing existing folders as Collections.** MVP is greenfield —
  user explicitly invokes "Make Collection". Auto-detecting "this
  folder looks like a Collection" is a Phase 2 problem.
- **Sync / sharing / export of Collections.**
- **Plugin API surface for third-party Collection renderers.** This
  feature is first-class core; the API is closed for MVP.

---

## Files Expected to Change

(Architect to confirm; this is the working set from the planning brief.)

| File | Nature of change |
|---|---|
| `src/plugins/file-browser/collections/` *(new dir)* | New: renderer (`home-renderer.ts`, `stack-renderer.ts`), types (`types.ts`), sidecar I/O (`sidecar.ts`), CSS (`collections.css`) |
| `src/plugins/file-browser/folder-view/tab.ts` | Edit: register `collection-home` layout in `LAYOUT_RENDERERS` |
| `src/plugins/file-browser/folder-view/detection.ts` | Edit: short-circuit to `collection-home` if root sidecar present |
| `src/plugins/file-browser/folder-view/display-options.ts` | Edit: picker entry (optional escape hatch) |
| `src-tauri/src/commands/collections.rs` *(new file)* | New: atomic read/write for `_collection.json`; uses existing temp-file-swap helper |
| `src-tauri/src/lib.rs` | Edit: register the new commands in the invoke handler (NO window-size changes) |
| `src/lib/bridge.ts` | Edit: typed wrappers returning `FileResult<T>` for the new commands |
| `src/lib/settings.ts` | Edit: small addition under `plugins["file-browser"].collections[vaultId]` for last-opened state only |
| `src/lib/vault-manager.ts` *(or Rust `build_vault_index`)* | Edit: exclude `_collection.json` from `.md`-equivalent enumeration |
| `src/plugins/command-bar/command-bar.plugin.ts` | Edit: register the two new command-bar entries |
| `src/keybindings/keybindings-panel.ts` | Edit: two new `COMMANDS` entries under section `"Collection"` |
| `src/main.ts` `handleAction()` | Edit: two new cases for the command-bar entries |
| `tests/collections/*.test.ts` *(new)* | New: one test per EC-1…EC-15 |
| `docs/specs/collections/00_index.md` *(new)* | New: Architect output with deferred-work log (NFR-4, C-8) |

---

## Verification (when implementation lands)

- `npm run test:run` — all existing tests pass.
- `npm run test:run -- tests/settings/window-defaults.test.ts` — window
  invariant intact (EC-14, NFR-3).
- `npm run test:run -- tests/collections/` — every EC has a passing
  test.
- `cargo test` from `src-tauri/` — new Rust sidecar commands pass.
- Manual: open a fresh vault, right-click a folder → "Make Collection",
  observe frame-01 empty state.
- Manual: click `+ Notecard/Stack` → `Stack`, observe a new Stack with
  inline-rename active (frame 02 empty Stack).
- Manual: add 1 note, then 3 notes — confirm frames 02 and 03 render.
- Manual: navigate up, observe Home canvas (frame 04) with stacked-card
  glyph showing the badge count.
- Manual: close & reopen the app — Collection state restores from sidecars.
- Manual: move the Collection folder via Finder, reopen Markable —
  sidecar survives, view still renders.
- Manual: delete the root `_collection.json` externally — folder falls
  back to standard view with the NFR-2 toast.
- Manual: `npm run build:plugins && npm run sync:plugins` after any
  `src/plugins/**/*.ts` edit (C-9).

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements drafted in Auto mode; user may approve or amend
- Edge cases to verify in tests: **15 items** in Edge Case Inventory
  (EC-1 … EC-15)

Next step: User reviews the Auto-mode resolutions in the "Resolved open
questions" table and either says **"Requirements approved. Activate
Architect."** or sends amendments. After approval, activate
`@software-architect` with this file as context, targeting
`docs/specs/collections/00_index.md` as the output artifact.

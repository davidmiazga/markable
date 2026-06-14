---
title: "Collections — MVP (Frames 01–04) [SUPERSEDED]"
last-updated: "2026-06-06"
review-cadence-days: 30
status: archive
---

> # SUPERSEDED — 2026-06-06
>
> This document captures the requirements for the "Make Collection" /
> `type: collection` marker architecture that shipped on 2026-06-05 and
> was approved-for-merge that same day. On 2026-06-06 the user
> clarified that Collections should be **just another folder-view
> layout** (opted into via `layout: collection-home` in `_folder.md`,
> mirroring Bookshelf), **not** a separate top-level "Make Collection"
> concept.
>
> The active requirements live in
> `docs/requirements/active_task.md` (Collections — Layout Refactor).
> The substantive code (renderer, stack-panel, inline-editor,
> preview-cache, breadcrumb, reference-index, and 7 more modules)
> survives the refactor; only the discovery/dispatch path and a few
> lifecycle commands are replaced.
>
> This file is retained for historical context. Do not implement
> against it.

# Collections — MVP (Frames 01–04)

## Prerequisites

The **folder-icon-assignment** feature is shipped and merged
(`docs/specs/folder-icon-assignment/00_index.md`, "Approved for Merge"
2026-06-05). Collections **consumes** that feature; it does **not**
re-implement icon assignment.

What Collections uses from the prerequisite:

| Symbol / path | Purpose |
|---|---|
| `src/plugins/file-browser/folder-icons.ts` → `FOLDER_ICONS` | 24-glyph catalog. The default Stack icon is `notebook` (see C-6). |
| `src/plugins/file-browser/folder-icons.ts` → `getFolderIconClass(value?)` | Resolve a raw `icon:` string (catalog iconId, absolute path, empty, or unknown) to a CSS class. |
| `src/plugins/file-browser/folder-icons.ts` → `interpretIconValue(value?)` | Discriminate catalog vs custom-path vs fallback per the prerequisite's §1.8 rules. |
| `src/plugins/file-browser/folder-icon-store.ts` → `setFolderIcon(folderPath, iconValue)`, `readFolderIcon(folderPath)`, `buildFolderIconMap(...)` | Atomic read/write of the `icon:` YAML key in `_folder.md`. Collections uses this to seed the default icon for new Stacks and to read the assigned icon for the Home canvas glyph. |
| `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` → `parseYamlFrontmatter`, `applyYamlKey`, `removeYamlKey`, `reconstructFile` | The store layer Collections uses for *Collections-specific* keys (`type`, `stackOrder`, `order`, `references`). |
| `src/plugins/file-browser/folder-view/parser.ts` → `parseFolderMd()` | The black-box reader for any `_folder.md`. Collections reads `type`, `stackOrder`, `order`, `references`, and (for the Home glyph) `icon` from the parsed object. |
| `src/lib/bridge.ts` → `readFile`, `writeFile` (existing) | Atomic temp-file-swap writes for all `_folder.md` mutations. |
| `src/plugins/file-browser/file-browser.plugin.ts` "Set folder icon…" context-menu entry | Already shipped. The user can re-skin any Stack via the existing right-click flow; Collections does NOT need its own icon picker UI. |

Collections introduces no new icon-storage mechanism, no new Rust command
for icon I/O, and no separate icon catalog.

---

## Summary

As a user, I want to designate a vault folder as a **Collection**, group
my notes into one or more **Stacks** inside it, see a "Home" canvas that
renders each Stack as an icon with a note-count badge, and open a Stack
into a section view where each note appears as a framed box with its
content rendered inline (clicking enters Typora-style edit mode) — so I
can organize notes into named groups without leaving the filesystem
behind, and so the structure survives Finder moves and round-trips
through other tools.

The MVP delivers frames 01–04 of the Figma mockup at
`/Users/daveslaptop/Desktop/Screenshot 2026-06-05 at 4.28.37 PM.png`:

- **Frame 01** — Empty Collection canvas with `+ Notecard/Stack` prompt
- **Frame 02** — Single Stack with one framed-box note rendered inline
- **Frame 03** — Same Stack populated with multiple framed-box notes
- **Frame 04** — Home canvas: each Stack rendered as an assigned icon
  glyph with a badge showing note count, plus a `+` to add another Stack

Frames 05–09 (rename-multiple, Chapters, Books, settings, workflow
configurator) are **Phase 2** and explicitly out of scope here.

---

## Knowns

### Locked decisions

1. **Feature name**: **Collections.** Top-level entity is a Collection;
   the basic notecard grouping inside is a **Stack**. This supersedes
   the older "Stacks" Tier-1 entry in
   `docs/handoffs/PKM-features-v2.0.md`.
2. **Storage**: **Real folders + `_folder.md` sidecar with YAML
   frontmatter.** A Collection is a real folder containing a
   `_folder.md` whose frontmatter declares `type: collection`. Each
   Stack is a real subfolder of the Collection containing a `_folder.md`
   whose frontmatter declares `type: stack`. Notes are real `.md` files
   inside the Stack folder. The frontmatter carries display name,
   ordering, and (for multi-reference notes) pointer records. The
   structure survives Finder moves, round-trips through other tools,
   and degrades gracefully if a `_folder.md` is missing.
   - `_folder.md` is the established Markable folder-metadata
     convention; `parseFolderMd()` already parses it; the
     yaml-frontmatter helpers already mutate it atomically.
3. **Scope**: MVP = frames 01–04 only. Chapters/Books/configurator
   deferred.
4. **Implementation**: First-class core feature (not a user plugin).
   The plugin API lacks command-palette entries and granular
   file-event subscriptions that this feature requires.
5. **Stack visuals are user-assigned icons.** Home-canvas Stack glyphs
   are rendered using the icon assigned via the shipped
   folder-icon-assignment feature. No bookshelf paired-palette reuse,
   no parallel palette system. Default icon for a new Stack is
   `notebook` from the catalog.
6. **Multi-reference notes are in scope.** A note has one canonical
   home (its real `.md` file on disk in exactly one Stack folder) but
   may be referenced from other Stacks via pointer records in those
   Stacks' `_folder.md` frontmatter. Editing the canonical file updates
   the note everywhere it is referenced.
7. **Section view (frames 02/03) renders notes inline as framed boxes
   with rendered HTML preview content.** A note appears in the Stack
   panel as a framed box labeled with the note name, showing the
   rendered markdown preview of the body inline. Single-click on a
   box switches that one box into Typora-style edit mode for the note.
   Off-screen notes are lazily/virtualized — only the boxes currently
   in the viewport render their content.
8. **Naming flow**: auto-name on Stack creation + immediate inline
   rename. The folder is written as `Stack 01` (next available index);
   an inline rename input is focused over the Stack label. `Enter`
   commits, `Escape` keeps the auto-name.

### Resolved Open Questions

The original draft posed Q1–Q8; the AMENDMENTS PENDING section added
three more on resume (Q10–Q12). The table below consolidates all
twelve and is the single source of truth.

| # | Question | Resolution |
|---|----------|------------|
| Q1 | What designates a folder as a Collection? | A `_folder.md` at the folder root whose YAML frontmatter contains `type: collection`. Written when the user invokes **"Make Collection"** on a folder via right-click in the file browser or via a command-bar entry. A Collection MAY be nested inside a normal folder. Nesting a Collection inside another Collection is **not** supported in MVP — surfaced as an error if attempted. |
| Q2 | Where does the "Home" canvas (frame 04) live? | It **replaces the standard folder view** when the active folder tab is a Collection folder. Implemented as a new folder-view layout key (`collection-home`) selected automatically by `detection.ts`, alongside the existing kanban/timeline/etc. renderers. No new tab kind. |
| Q3 | What does `+ Notecard/Stack` create in the empty state? | A two-item popover (`Stack` and `Notecard`). **Stack** creates a new auto-named Stack folder (`Stack 01`, `Stack 02`, ...). **Notecard** creates a new note (`Untitled.md`) inside a default Stack — if no Stack exists, one is created (`Stack 01`) and the note placed inside. Both flows leave the new item in immediate inline-rename mode. |
| Q4 | Multi-stack membership? | **Single canonical home + multi-reference pointers.** A note's `.md` file lives in exactly one Stack folder (canonical home). Other Stacks may reference it via pointer records (relative paths from the vault root) in their `_folder.md` `references:` array. Edits to the canonical file are reflected wherever the note is referenced. See FR-21…FR-26. |
| Q5 | Drag-and-drop reordering? | **Phase 1.5 near-term.** First ship uses right-click "Move up" / "Move down" on each note box and on each Stack glyph on the Home canvas. Drag-reorder of notes within a Stack and of Stacks on the Home canvas follows immediately. NOT in the deferred-forever bucket. |
| Q6 | Note rendering content? | **Framed box with rendered HTML preview inline** (per Q12). Filename labels the box; the box's body shows the markdown rendered to HTML (bold is bold, headings styled, links blue, images thumbnailed). Click → Typora-style edit mode on that one box. See FR-9, FR-10, FR-27. |
| Q7 | Stack visual treatment (frame 04)? | **User-assigned folder icon from the shipped catalog.** New Stacks default to the `notebook` glyph; the user may change this via the existing right-click "Set folder icon…" flow (already wired by the folder-icon-assignment feature). A badge in the upper-right of the glyph shows `noteCount`. Bookshelf paired-palette reuse is dropped. |
| Q8 | Stack naming/creation flow? | **Auto-name + immediate inline rename.** Creating a Stack writes the folder as `Stack 01` (next available index) and a `_folder.md` with `type: stack` and `displayName: "Stack 01"`. The Stack label receives an inline rename input on creation. `Enter` commits; `Escape` keeps the auto-name. No modal. (Re-confirmed on resume per amendment #8.) |
| Q10 | Section-view rendering strategy (lazy vs eager)? | **Lazy / virtualized.** Only the framed boxes currently in the viewport render their note content. Off-screen boxes render as placeholder boxes of the same dimensions (so scroll height is correct) and lazy-load their content when scrolled in (e.g., via `IntersectionObserver`). This preserves the 5,000-note NFR-1 target. |
| Q11 | Naming flow on Stack creation (re-confirmed)? | **Auto-name + immediate inline rename.** Same as Q8. The folder is created on disk *first* with the auto-name (so the `_folder.md` write is real), then the inline rename receives focus. `Escape` keeps the auto-name (which is already on disk). `Enter` commits the new name via the existing atomic-rename Rust command. |
| Q12 | Unclicked-state rendering of a note box? | **Rendered HTML preview.** The box content is the markdown rendered to HTML — formatting is visible (bold is bold, headings styled, links blue, etc.). The same renderer used by the live-preview / read-mode in the main editor is reused; no parallel renderer is introduced. Click → switch that one box to Typora-style edit mode. |

(Q9 was reserved for and used by the folder-icon-assignment doc; the
numbering is preserved to avoid cross-document collision.)

---

## Functional Requirements

### Collection lifecycle

- **FR-1** — User can convert a folder into a Collection via right-click →
  **"Make Collection"** in the file browser, or via a command-bar entry
  `collection:make-collection`. The action writes a `_folder.md` at the
  folder root containing this frontmatter:
  ```yaml
  ---
  schemaVersion: 1
  type: collection
  displayName: <folder name>
  stackOrder: []
  ---
  ```
  Existing keys in a pre-existing `_folder.md` (e.g. `layout`, `sort`,
  `icon`) are preserved verbatim by going through `applyYamlKey()` from
  `yaml-frontmatter.ts`.
- **FR-2** — A folder whose `_folder.md` frontmatter contains
  `type: collection` is recognized as a Collection on every vault scan
  and folder open.
- **FR-3** — Opening a Collection folder renders the **Home canvas**
  layout (`collection-home`) instead of the default folder view. The
  user can still switch to a standard folder layout via the existing
  display-options picker for debugging or escape-hatch reasons, but
  `collection-home` is the default.
- **FR-4** — User can convert a Collection back to a regular folder via
  right-click → **"Unmake Collection"**. This removes the
  `type: collection`, `stackOrder`, and `references` YAML keys from
  the root `_folder.md` (via `removeYamlKey()`) and removes the
  `type: stack`, `order`, and `references` keys from every Stack
  subfolder's `_folder.md`. All other keys, all `.md` files, and the
  folder structure are left untouched. Stack folders remain on disk
  as ordinary folders.

### Stack lifecycle

- **FR-5** — From an empty Collection (frame 01), clicking
  `+ Notecard/Stack` opens a popover with two options: **Stack** and
  **Notecard** (see Q3 resolution). "Stack" creates a new Stack folder;
  "Notecard" creates a note inside the default Stack (creating Stack 01
  if needed).
- **FR-6** — Creating a Stack writes a new subfolder named with the
  next available `Stack NN` index (`Stack 01`, `Stack 02`, ...) and a
  `_folder.md` inside it with this frontmatter:
  ```yaml
  ---
  schemaVersion: 1
  type: stack
  displayName: Stack 01
  icon: notebook
  order: []
  references: []
  ---
  ```
  `icon: notebook` is the default seed value (C-6); the user may
  change it later via the existing "Set folder icon…" context-menu
  entry. The new Stack's folder name is appended to the parent
  Collection's `stackOrder` (atomic write via the parent's
  `_folder.md`).
- **FR-7** — User can rename a Stack inline (single click on the label →
  edit) or via right-click → **Rename Stack**. The folder is renamed
  via the existing atomic-rename Rust command **and** the Stack's
  `displayName` is updated. The parent Collection's `stackOrder` array
  is rewritten with the new folder name. The order of Stacks on the
  Home canvas is preserved.
- **FR-8** — User can delete a Stack via right-click → **Delete Stack**.
  Confirmation modal warns that all notes inside will be moved to OS
  trash (uses the existing `move_to_trash` Rust command if present, else
  `delete_path`). Any `references:` entries in *other* Stacks pointing
  to notes in the deleted Stack are removed by the Stack-delete handler
  (single pass over the parent Collection's `stackOrder`).

### Note lifecycle inside a Stack — section view (frames 02/03)

- **FR-9** — Each note in a Stack's section view renders as a **framed
  box** labeled with the note's filename (no extension if `.md`; show
  extension for other types). The box body displays the **rendered
  HTML preview** of the note's markdown (the same renderer used by the
  editor's live-preview / read-mode — `marked` plus the project's
  preview-extension pipeline). Boxes are arranged in a vertical stack
  (or flex-wrap row per Figma layout) inside the Stack panel.
- **FR-10** — Single-click on a framed box switches that one box into
  **Typora-style edit mode** for the note. A CodeMirror 6 editor
  instance is mounted inside the box; the note becomes editable in
  place. The box exits edit mode and re-renders as preview when the
  user clicks elsewhere (outside the box), presses `Escape`, or the box
  loses focus by tab navigation. The save pathway is the existing
  per-tab autosave / write pipeline.
- **FR-11** — The trailing dashed-border card in each Stack
  (frames 02/03) is a **"+ Note"** affordance. Clicking it creates a
  new `Untitled.md` in that Stack and immediately enters edit mode in
  a new framed box (and selects the filename for rename via the
  trailing inline-rename label).
- **FR-12** — Right-click on a note's framed box offers: **Rename**,
  **Move up**, **Move down**, **Move to other Stack…**, **Add reference
  to another Stack…**, **Delete**. "Move to other Stack…" updates the
  source Stack's `order` array, removes the entry, atomically moves
  the file via Rust, and appends to the target Stack's `order` array.

### Multi-reference notes (Q4 resolution)

- **FR-21** — A Stack's `_folder.md` `references:` YAML array holds
  pointer records to notes that live in *other* Stacks. Each entry is
  a relative path from the vault root, e.g.
  ```yaml
  references:
    - "Projects/Stack 02/Big Idea.md"
    - "Inbox/Stack 01/Quick Note.md"
  ```
  Pointer records are paths only — no copy of content, no copy of
  metadata. The canonical note's `.md` file remains the single source
  of truth.
- **FR-22** — When rendering a Stack's section view (FR-9), referenced
  notes are rendered as additional framed boxes after the notes from
  the Stack's own `order` array. Referenced boxes carry a small visual
  indicator (e.g. an arrow / link glyph in the upper-right corner) to
  distinguish them from canonical-home notes. Edit-mode entry (FR-10)
  works identically — editing a referenced box edits the canonical
  file, and all references render the updated content on next preview.
- **FR-23** — Right-click → **"Add reference to another Stack…"** on a
  note's framed box opens a Stack picker (the Collection's existing
  Stacks); selecting a target Stack appends the canonical file's
  vault-relative path to the target Stack's `_folder.md` `references:`
  array (atomic write). The canonical file is **not** moved or copied.
- **FR-24** — Right-click on a *referenced* framed box (i.e. one
  rendered from a `references:` entry, not from `order:`) offers:
  **Open canonical**, **Remove reference (from this Stack)**, **Edit
  in place** (same as Single-click, FR-10). "Remove reference" removes
  the entry from the current Stack's `references:` array only;
  canonical file is untouched.
- **FR-25** — When the canonical file is moved (rename / Move to other
  Stack… / Finder move detected by the watcher), every `references:`
  array in the vault is scanned and updated to the new vault-relative
  path. Broken pointers (canonical deleted or unreachable) are
  handled per EC-16.
- **FR-26** — When the canonical file is deleted, every `references:`
  entry in the vault pointing to its old path is removed atomically
  (single rewrite pass per affected `_folder.md`).

### Home canvas (frame 04)

- **FR-13** — The Home canvas header reads `Home` (or, in Phase 2, the
  Collection's `displayName`). Below the header, each Stack is rendered
  as a **glyph using the Stack's assigned folder icon** (default
  `notebook`, per FR-6). The glyph carries a badge in the upper-right
  showing the note count, computed as `len(order) + len(references)`.
- **FR-14** — Stack glyphs are laid out in a flex-wrap row in the
  order defined by the parent Collection's `stackOrder`. Below the
  glyphs sits a `+` button that creates a new Stack (FR-6). Right-click
  on a Stack glyph offers **Rename**, **Move up**, **Move down**, **Set
  folder icon…** (delegates to the existing folder-icon-assignment
  picker), **Delete**.
- **FR-15** — Clicking a Stack glyph opens the Stack's section view
  (frame 02/03 layout) in the same tab — i.e., the Home view "drills
  into" the Stack. A breadcrumb at the top lets the user return to
  Home. See FR-30 for breadcrumb composition.
- **FR-16** — Empty Collection (no Stacks yet) renders frame 01: a
  single large dashed rounded rectangle with the `+ Notecard/Stack`
  button centered. This is the **same** layout key (`collection-home`)
  rendering its empty state.

### Breadcrumb (Q6 amendment — multi-level ready)

- **FR-30** — A breadcrumb chrome above the active Collection-view
  content shows the full path. MVP renders three levels:
  `Home(Collection displayName) / Stack displayName / Note filename`.
  Component is implemented so that two intermediate levels (Book,
  Chapter) can be inserted without re-architecting:
  ```
  Home(Collection) / Book / Chapter / Stack / Note.md
  ```
  Implementation: the breadcrumb takes an ordered list of
  `{ label, onClick }` pairs and renders them with `/` separators. MVP
  always emits three pairs; Phase 2 emits up to five.
- **FR-31** — Each breadcrumb segment is clickable: clicking
  `Home(Collection)` returns to the Home canvas, clicking the Stack
  segment returns to the Stack section view (closing any open edit-mode
  box). The current segment is rendered un-clicked (or as plain text)
  per the project's chrome conventions.

### Persistence and atomicity

- **FR-17** — All `_folder.md` writes (root Collection, per-Stack,
  cross-Stack `references:` updates) go through the existing Rust
  temp-file-swap atomic write pattern via the `writeFile()` bridge
  wrapper (per CLAUDE.md). No direct overwrites. No new Rust commands
  are introduced for Collections-specific frontmatter — the same path
  used by the folder-icon-assignment feature is reused (read → parse →
  mutate via `applyYamlKey`/`removeYamlKey` → reconstruct →
  `writeFile()`).
- **FR-18** — All Tauri command calls go through `src/lib/bridge.ts`
  typed wrappers returning `FileResult<T>` (per CLAUDE.md). No raw
  `invoke()` calls anywhere in feature code.
- **FR-19** — `_folder.md` files continue to be excluded from
  vault-index `.md`-equivalent enumeration the same way they are today
  (the folder-icon-assignment feature already established this
  contract). No change to `build_vault_index` is required for
  Collections.

### Command-palette entries

- **FR-20** — Three new command-bar entries:
  - `collection:make-collection` — "Make Collection from Folder"
    (active when current focus is a folder)
  - `collection:new-stack` — "New Stack in Current Collection"
    (active when the active tab is a Collection)
  - `collection:add-reference` — "Add Reference to Another Stack…"
    (active when the active focus is a note inside a Collection)

  Section in keybindings panel: `"Collection"`. All ship with
  `defaultKey: ""`.

### Section-view rendering (Q10)

- **FR-27** — The section view virtualizes framed-box rendering. Only
  notes whose framed box intersects the viewport (plus a small
  overscan window — Architect picks, ≤ 1 viewport height) render their
  HTML preview body. Off-screen boxes render as placeholder rectangles
  of the same outer dimensions so the scroll bar reflects total
  content height accurately.
- **FR-28** — Implementation uses `IntersectionObserver` (browser
  native, already supported in the project). When a box scrolls into
  view, its preview HTML is computed (or pulled from a per-tab LRU
  cache keyed by `(path, mtimeMs)`) and injected. When a box scrolls
  far out of view, its body is replaced with the placeholder shell to
  reclaim DOM nodes.
- **FR-29** — Box height is computed from the first preview render
  and cached per `(path, mtimeMs)` so subsequent off-screen → on-screen
  transitions do not cause scroll jumps. If a note's mtime changes
  (external edit), the cached height is invalidated and recomputed on
  the next view.

---

## Non-Functional Requirements

- **NFR-1** — Section-view rendering of a Stack with up to 200 notes
  must paint the visible viewport within 200ms on the dev machine,
  with scroll latency under 50ms per frame thereafter. Achieved by the
  virtualization in FR-27 / FR-28 / FR-29 (lazy HTML preview, height
  cache, IntersectionObserver). Home-canvas rendering with up to 50
  Stacks of up to 100 notes each (5,000 notes total) must paint
  within 200ms by reading only `_folder.md` frontmatter — never note
  bodies — for badge counts.
- **NFR-2** — A missing or corrupt `_folder.md` must NEVER break the
  parent folder view. If the root `_folder.md` is missing on a folder
  previously marked as a Collection, the folder reverts to the
  standard folder view with a one-time toast: "Collection metadata
  missing. Reopen?" with a [Recreate] action. Per-Stack missing
  `_folder.md` is handled per EC-5.
- **NFR-3** — Window launch size invariant (`50% × 80%`) must not
  regress. The regression test
  `tests/settings/window-defaults.test.ts` must still pass after this
  feature ships. Verify both `src/lib/settings.ts` and
  `src-tauri/src/lib.rs` are untouched by this feature, OR if touched,
  both values match per CLAUDE.md.
- **NFR-4** — No TODO comments in source code (per CLAUDE.md).
  Deferred work is logged in `docs/specs/collections/00_index.md`.
- **NFR-5** — Atomic writes: every `_folder.md` mutation passes
  through the Rust temp-file-swap pattern. A crash mid-write must
  leave either the old `_folder.md` or the new `_folder.md` intact —
  never a partial file.
- **NFR-6** — All file operations (folder create, folder rename, file
  move, file delete) use existing Rust commands. No new "convenience"
  wrappers that bypass the bridge layer.
- **NFR-7** — Theme tokens only — all colors, sizes, and typography in
  Collection-specific CSS pull from the canonical token catalog in
  `src/styles.css`. No new hex values, no hardcoded pixel sizes for
  framed-box chrome (per the project's theme-system contract).
- **NFR-8** — Plugin build rule: any edit under
  `src/plugins/file-browser/**/*.ts` is followed by
  `npm run build:plugins && npm run sync:plugins` (per CLAUDE.md).
  Architect must include this in the verification step of
  `00_index.md`.

---

## Proposed Constraints

- **C-1 (Layout key registration)** — Register a new
  `collection-home` layout in `LAYOUT_RENDERERS` at
  `src/plugins/file-browser/folder-view/tab.ts` (~line 109), following
  the 4-step folder-view-layout pattern documented in the project
  memory `project_folder_views`.
- **C-2 (Detection)** — `src/plugins/file-browser/folder-view/detection.ts`
  gains a check: if a folder's `_folder.md` frontmatter contains
  `type: collection`, return `"collection-home"` as the layout key.
  Read via `parseFolderMd()`. This check must short-circuit before any
  other detection logic.
- **C-3 (Frontmatter I/O)** — New module
  `src/plugins/file-browser/collections/store.ts` with typed:
  - `readCollection(folderPath): Promise<FileResult<CollectionMeta>>`
  - `writeCollectionMeta(folderPath, meta): Promise<FileResult<void>>`
  - `readStack(folderPath): Promise<FileResult<StackMeta>>`
  - `writeStackMeta(folderPath, meta): Promise<FileResult<void>>`
  - `appendReference(stackFolderPath, vaultRelPath)`,
    `removeReference(stackFolderPath, vaultRelPath)`,
    `updateReferenceOnMove(oldVaultRelPath, newVaultRelPath)`
  All implementations compose the existing `parseYamlFrontmatter`,
  `applyYamlKey`, `removeYamlKey`, `reconstructFile` helpers from
  `yaml-frontmatter.ts` (located at
  `src/plugins/file-browser/folder-view/yaml-frontmatter.ts`). No
  fork. No parallel parser.
- **C-4 (No new Rust commands)** — Collections introduces zero new
  Rust commands. All atomic writes go through the existing `writeFile`
  bridge wrapper (which already implements temp-file-swap). The folder-
  icon-assignment feature already established this pattern; Collections
  follows it.
- **C-5 (Vault index — no change)** — `_folder.md` exclusion from
  `.md`-equivalent enumeration is already in place from the folder-
  icon-assignment work. Collections relies on this; no further
  exclusion list changes are needed.
- **C-6 (Default Stack icon = `notebook`)** — New Stacks are created
  with `icon: notebook` in their `_folder.md`. `notebook` is one of
  the 24 catalog entries shipped by folder-icon-assignment. The user
  re-skins via the existing right-click "Set folder icon…" entry —
  Collections does NOT ship its own icon-picker UI.
- **C-7 (Settings persistence)** — A minimal addition to
  `MarkableSettings.plugins["file-browser"].collections[vaultId]` for
  cross-Collection UI state only (e.g., last-opened Stack per
  Collection for breadcrumb restoration, scroll position per Stack).
  All per-folder data lives in `_folder.md` files, not in app
  settings.
- **C-8 (No TODOs)** — Deferred work (rename-multiple, Chapters,
  Books, settings panel, workflow configurator, sync / sharing /
  export, importing existing folders) is documented in
  `docs/specs/collections/00_index.md` only. Drag-reorder is *not* in
  this bucket — it is Phase 1.5 and must be designed-for, even if
  shipped after the right-click reorder controls.
- **C-9 (Plugin build rule)** — If any file under
  `src/plugins/file-browser/**` is touched,
  `npm run build:plugins && npm run sync:plugins` is mandatory
  (per CLAUDE.md). Architect must include this in the verification
  step of `00_index.md`.
- **C-10 (Live-preview renderer reuse)** — The framed-box HTML preview
  (FR-9) and the in-place edit mode (FR-10) reuse the existing
  live-preview / editor extensions stack. No parallel `marked` import
  with different extension wiring; no parallel CodeMirror 6 build
  with a different `EditorState` config. The Architect maps the exact
  reuse points during `00_index.md` design.
- **C-11 (Breadcrumb component is multi-level-ready from day one)** —
  The breadcrumb (FR-30) takes an ordered list of segments and
  renders all of them. MVP always passes three segments; the Phase 2
  Book/Chapter work passes five. There is no MVP-specific shortcut
  that hardcodes the three-level case.

---

## Edge Case Inventory

Every Edge Case must have a corresponding test in the Reviewer's final
checklist. Architect is required to write a failing test for each EC
before implementation begins.

- **EC-1 (Make Collection on a folder whose `_folder.md` already has
  `type: collection`)** — Refuse the operation with a clear error
  ("Already a Collection"). Do not overwrite the existing frontmatter.
- **EC-2 (Make Collection on a folder nested inside another
  Collection)** — Refuse with an error ("Nested Collections not
  supported in MVP"). Detected by walking parent folders and reading
  each ancestor's `_folder.md` via `parseFolderMd()`, checking for
  any `type: collection` ancestor.
- **EC-3 (Stack folder name conflict)** — Creating a new Stack when
  the auto-name (`Stack 01`, `Stack 02`, ...) already exists must
  increment to the next available index. If the user renames a Stack
  to a name that conflicts with another Stack folder, the rename is
  refused with an inline error.
- **EC-4 (Missing `_folder.md` on Collection-marked folder)** — If
  the root `_folder.md` is deleted externally (Finder, git operation),
  the folder falls back to the standard folder view on next open with
  a one-time toast (NFR-2). No crash, no silent failure.
- **EC-5 (Missing `_folder.md` on Stack folder)** — A Stack subfolder
  without `_folder.md` is **still rendered as a Stack** if its parent
  Collection's `stackOrder` includes its folder name. The displayName
  is derived from the folder name; the `order` array defaults to the
  natural directory listing; the icon defaults to `notebook`; the
  `references` array defaults to empty. A `_folder.md` is written
  lazily on the next ordering change.
- **EC-6 (Malformed YAML frontmatter in `_folder.md`)** — If the
  frontmatter exists but fails to parse, treat as missing (EC-4 /
  EC-5 path) and surface a toast with [View Error] for the user. Do
  not crash the file browser. The folder-icon-assignment work
  established this contract; Collections reuses it.
- **EC-7 (Note file moved via Finder while Markable is open)** — The
  file watcher detects the move. The source Stack's `order` array is
  updated on next write (stale entries silently dropped from the
  rendered list). Every `references:` array pointing to the old
  vault-relative path is rewritten to the new path (FR-25). No red
  error tiles.
- **EC-8 (Parent Collection's `stackOrder` references a folder that
  no longer exists)** — Stale folder references in `stackOrder` are
  silently dropped from the Home canvas render. The root `_folder.md`
  is rewritten on the next user action.
- **EC-9 (User deletes the last Stack in a Collection)** — The Home
  canvas returns to the frame-01 empty state. The Collection itself
  is NOT auto-removed; the user must explicitly "Unmake Collection"
  to revert to a normal folder.
- **EC-10 (Concurrent `_folder.md` write)** — Two rapid actions (e.g.,
  user clicks "Move up" twice before the first write completes) must
  not corrupt the frontmatter. Achieved by the temp-file-swap pattern
  plus a single-writer per-file queue in `store.ts` (mirrors the
  pattern used by the folder-icon-assignment feature).
- **EC-11 (Note filename collision on rename)** — Renaming a note to
  a filename that already exists in the same Stack is refused with an
  inline error. The original filename is preserved. Existing
  `references:` arrays pointing to the original path are unaffected.
- **EC-12 (Notecard creation when no Stack exists)** — Frame 01
  empty-state `+ Notecard` click auto-creates `Stack 01` first (with
  default `icon: notebook`), then the note inside it. The Home canvas
  re-renders to show frame-02 state in a single repaint (no flash).
- **EC-13 (Schema-version mismatch)** — A `_folder.md` with
  `schemaVersion` greater than what the running build knows about is
  treated as read-only (rendered as-is) and a toast warns the user
  that this Collection was created by a newer version. No destructive
  writes.
- **EC-14 (Window-size invariant regression)** — Architect and Lead
  Dev must verify `tests/settings/window-defaults.test.ts` still
  passes after every change. Both `sizeW: "50%"` and `sizeH: "80%"`
  values are untouched. (Per CLAUDE.md invariant.)
- **EC-15 (Vault-index treats `_folder.md` as a note)** — Already
  prevented by the folder-icon-assignment work. Test: scan a
  Collection folder, assert the index contains zero entries with
  path ending in `_folder.md`.
- **EC-16 (Broken multi-reference pointer)** — A `references:` entry
  whose target file no longer exists (deleted, moved without watcher
  catching the rename, vault rebuilt from a stale snapshot) renders
  as a **dimmed broken-link box** in the section view: filename
  shown, body replaced with a one-line "(referenced note not found)"
  message. The user can right-click → "Remove reference" to clean it
  up. No crash, no silent omission.
- **EC-17 (Reference to a folder rather than a note)** — Stacks are
  folders, notes are files. By construction, a `references:` entry
  always points to a `.md` file (it can only be created via FR-23
  which only accepts files). If an external edit puts a folder path
  in `references:`, that entry is treated as a broken pointer
  (EC-16 path). Circular references between Stacks are therefore
  impossible — a Stack cannot reference itself or another Stack
  because Stacks are folders, not notes.
- **EC-18 (Section view scroll behavior with lazy rendering)** — As
  the user scrolls a Stack with many notes, framed boxes entering
  the viewport must render their preview HTML without visible
  flicker, and boxes exiting the viewport must release their preview
  DOM without changing the scroll position (height cache per FR-29).
  Test: scroll a 200-note Stack from top to bottom and back,
  asserting (a) no scroll jumps, (b) DOM node count stays bounded
  (~ visible-count + overscan), (c) each visible box ends with its
  preview rendered.
- **EC-19 (Click-to-edit, then click-elsewhere)** — User clicks a
  framed box → it enters edit mode (FR-10). User then clicks outside
  the box (e.g., another box, the breadcrumb, empty Stack area).
  Required: (a) the edit is committed (autosave fires, file written
  atomically), (b) the editing box exits edit mode and re-renders as
  preview, (c) if the user clicked *another* box, that other box
  enters edit mode in the same gesture (i.e., only one box is in
  edit mode at a time). No data loss.
- **EC-20 (Multi-reference edit propagation)** — A note that appears
  in Stack A (canonical) and is referenced from Stack B is edited via
  Stack B's framed box. The edit writes to the canonical file in
  Stack A. The next render of Stack A (whether it's the active view
  or returned-to later) reflects the updated content. Same for any
  Stack C that also references the note. Test: render two open
  Stacks side-by-side (or one at a time across navigation), assert
  edits propagate.
- **EC-21 (Multi-reference cycle)** — Cycles cannot occur by
  construction (EC-17). The test asserts that attempting to add a
  reference whose target path resolves to a folder (rather than a
  `.md` file) is refused at FR-23.
- **EC-22 (Custom-icon assignment on a Stack)** — A user opens the
  existing "Set folder icon…" right-click flow on a Stack folder and
  picks either a catalog icon or a custom SVG (per the shipped
  folder-icon-assignment feature). Collections must render the
  user's choice as the Home-canvas Stack glyph, with the badge count
  overlaid in the upper-right. Default `icon: notebook` is overridden
  by the user's pick. Test: set `icon: book` and `icon: /abs/path.svg`
  on two different Stacks, assert each Home glyph renders correctly.
- **EC-23 (Unmake Collection preserves user data)** — "Unmake
  Collection" removes only the Collections-specific YAML keys
  (`type`, `stackOrder`, `references`, `order`); it preserves
  `icon`, `layout`, `sort`, `displayName`, `schemaVersion`, and any
  other unrelated keys on the root and Stack `_folder.md` files. All
  `.md` files are untouched. Test: round-trip Make → Unmake → diff
  asserts non-Collections frontmatter and all note files are
  byte-identical to pre-Make state.
- **EC-24 (Breadcrumb after Stack rename)** — User is in a Stack
  section view, renames the Stack. The breadcrumb middle segment
  updates to the new `displayName` in the same render pass. No
  navigation occurs; the user stays in the section view.

---

## Out of Scope (Phase 2 / Later)

Captured explicitly so the Architect does NOT design for these:

- **Frame 05 — Rename-multiple stacks.** A bulk-rename interaction.
- **Frame 06 — Chapters.** A second hierarchical layer (Stacks
  grouped into Chapters), including the `_folder.md` `type: chapter`
  variant. The breadcrumb (FR-30) is multi-level-ready (C-11) but
  the Chapter layout key, renderer, and detection wiring are deferred.
- **Frame 07 — Books.** A third hierarchical layer (Chapters grouped
  into Books).
- **Frame 08 — Home settings access.** A gear icon on the Home canvas
  opening per-Collection settings.
- **Frame 09 — Workflow configurator.** The "Book workflow" editor
  with TOC, page numbers, and ordered hierarchy levels.
- **Importing existing folders as Collections.** MVP is greenfield —
  user explicitly invokes "Make Collection". Auto-detecting "this
  folder looks like a Collection" is a Phase 2 problem.
- **Sync / sharing / export of Collections.**
- **Plugin API surface for third-party Collection renderers.** This
  feature is first-class core; the API is closed for MVP.
- **Custom-icon assignment UI inside Collections.** Not in scope —
  the user re-skins any Stack via the existing folder-icon-assignment
  right-click flow that shipped 2026-06-05.

Note: **Drag-and-drop reordering of notes within a Stack and of
Stacks on the Home canvas is NOT in this list.** It is **Phase 1.5
near-term** per Q5. First ship uses right-click Move up/down on both
notes and Stacks; drag-reorder follows immediately as a small follow-up
PR. The Architect should design the order-mutation API (`reorderNote`,
`reorderStack`) such that the drag UI is a thin wrapper over the same
backend call.

---

## Files Expected to Change

(Architect to confirm; this is the working set.)

| File | Nature of change |
|---|---|
| `src/plugins/file-browser/collections/` *(new dir)* | New: renderer (`home-renderer.ts`, `stack-renderer.ts`), types (`types.ts`), frontmatter I/O (`store.ts`), framed-box rendering (`framed-box.ts`), breadcrumb (`breadcrumb.ts`), CSS (`collections.css`) |
| `src/plugins/file-browser/folder-view/tab.ts` | Edit: register `collection-home` layout in `LAYOUT_RENDERERS` |
| `src/plugins/file-browser/folder-view/detection.ts` | Edit: short-circuit to `collection-home` if root `_folder.md` has `type: collection` |
| `src/plugins/file-browser/folder-view/display-options.ts` | Edit: picker entry (optional escape hatch) |
| `src/plugins/file-browser/folder-view/parser.ts` | **No change.** `parseFolderMd()` reused as-is; Collections reads `type`, `stackOrder`, `order`, `references`, `icon`, `displayName`, `schemaVersion` from the returned object. |
| `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` | **No change.** `applyYamlKey`, `removeYamlKey`, `reconstructFile`, `parseYamlFrontmatter` reused by `collections/store.ts` for atomic frontmatter mutations. |
| `src/plugins/file-browser/folder-icons.ts` | **No change.** `FOLDER_ICONS`, `getFolderIconClass`, `interpretIconValue` reused for Home-glyph rendering. |
| `src/plugins/file-browser/folder-icon-store.ts` | **No change.** `setFolderIcon`, `readFolderIcon`, `buildFolderIconMap` reused for default icon seeding and Home-glyph lookup. |
| `src-tauri/src/lib.rs` | **No change.** No new Rust commands. (NO window-size changes either; NFR-3 / EC-14.) |
| `src-tauri/src/commands/` | **No new files.** Existing `write_file` (atomic temp-file-swap) reused via the bridge. |
| `src/lib/bridge.ts` | **Minimal or no change.** Reuses the existing `readFile` and `writeFile` typed wrappers. New wrappers only if the Architect identifies a missing typed I/O path. |
| `src/lib/settings.ts` | Edit: small addition under `plugins["file-browser"].collections[vaultId]` for last-opened-Stack and per-Stack scroll position. **DO NOT touch** `window.sizeW` / `window.sizeH` (NFR-3 / EC-14). |
| `src/plugins/command-bar/command-bar.plugin.ts` | Edit: register the three new command-bar entries (FR-20) |
| `src/keybindings/keybindings-panel.ts` | Edit: three new `COMMANDS` entries under section `"Collection"` |
| `src/main.ts` `handleAction()` | Edit: three new cases for the command-bar entries |
| `src/plugins/file-browser/file-browser.plugin.ts` | Edit: add "Make Collection" / "Unmake Collection" entries to `buildDirContextMenuItems` for folders; add framed-box right-click items (FR-12, FR-24) wired into the existing context-menu builder |
| `tests/collections/*.test.ts` *(new)* | New: one test per EC-1…EC-24, plus FR-21…FR-26 reference-pointer tests |
| `docs/specs/collections/00_index.md` *(new)* | New: Architect output with deferred-work log (NFR-4, C-8) |

---

## Verification (when implementation lands)

- `npm run test:run` — all existing tests pass.
- `npm run test:run -- tests/settings/window-defaults.test.ts` — window
  invariant intact (EC-14, NFR-3).
- `npm run test:run -- tests/folder-icons/` — folder-icon-assignment
  tests still pass (verifies Collections did not regress the
  prerequisite).
- `npm run test:run -- tests/collections/` — every EC has a passing
  test.
- `cargo test` from `src-tauri/` — no new Rust commands, but existing
  `write_file` / `read_file` / `rename` paths must remain green.
- Manual: open a fresh vault, right-click a folder → "Make Collection",
  observe frame-01 empty state. Inspect the folder on disk; assert a
  `_folder.md` exists with `type: collection`.
- Manual: click `+ Notecard/Stack` → `Stack`, observe a new Stack with
  inline-rename active (frame 02 empty Stack). Inspect Stack folder;
  assert a `_folder.md` with `type: stack` and `icon: notebook`.
- Manual: add 1 note, then 3 notes — confirm frame 02 and frame 03
  render. Confirm framed boxes show rendered HTML preview (bold is
  bold, headings styled).
- Manual: click a framed box, confirm Typora-style edit mode opens
  in place. Edit, click elsewhere, confirm save + re-render.
- Manual: in a Stack with 1 note, right-click → "Add reference to
  another Stack…" → pick a different Stack → navigate to that Stack,
  confirm the referenced note renders with the link-indicator badge.
  Edit the referenced box, confirm the canonical file changed.
- Manual: navigate up, observe Home canvas (frame 04) with the
  Stack's `notebook` glyph and the badge count.
- Manual: right-click the Stack glyph → "Set folder icon…" → pick a
  different catalog icon, confirm the Home glyph updates.
- Manual: scroll a 200-note Stack from top to bottom and back —
  assert no scroll jumps, DOM node count stays bounded (FR-27 / FR-28
  / FR-29).
- Manual: close & reopen the app — Collection state restores from
  `_folder.md` frontmatter.
- Manual: move the Collection folder via Finder, reopen Markable —
  frontmatter survives, view still renders, all references update.
- Manual: delete the root `_folder.md` externally — folder falls back
  to standard view with the NFR-2 toast.
- Manual: right-click → "Unmake Collection" — confirm the
  Collection-specific keys are gone but `icon`, `layout`, etc. remain;
  all notes still on disk.
- Manual: `npm run build:plugins && npm run sync:plugins` after any
  `src/plugins/**/*.ts` edit (C-9, NFR-8).

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated (resumed 2026-06-05 with all 8
  AMENDMENTS folded in + Q10/Q11/Q12 resolved in Auto mode)
- Edge cases to verify in tests: **24 items** in Edge Case Inventory
  (EC-1 … EC-24)

Next step: Activate `@software-architect` and provide
`docs/requirements/active_task.md` as context, targeting
`docs/specs/collections/00_index.md` as the output artifact.

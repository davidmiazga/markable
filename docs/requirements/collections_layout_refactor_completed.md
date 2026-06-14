---
title: "Collections — Layout Refactor (Completed)"
last-updated: "2026-06-08"
review-cadence-days: 30
status: archive
---

> **SUPERSEDED 2026-06-08.** This requirements doc covered the
> Collections Layout Refactor, which shipped and was merged into
> `docs/specs/collections/00_index.md`. It has been parked here for
> historical context.
>
> The current active requirements doc is
> `docs/requirements/active_task.md` (the **Unified View Modal**
> feature). Do not implement against this archived file.

# Collections — Layout Refactor (Completed)

## Context

Collections shipped end-to-end on 2026-06-05 and was approved-for-merge.
On 2026-06-06 the user clarified — after spot-checking the result and
producing a new mock — that the architecture overshot the intent.

What shipped:
- A "Make Collection" / "Unmake Collection" right-click gesture and
  command-bar entries.
- A `type: collection` marker written to `_folder.md` YAML frontmatter.
- A detection short-circuit in `tab.ts` that inspects the marker and
  overrides standard `layout:` dispatch.
- Treated Collections as a top-level concept distinct from other
  folder-view layouts.

What the user actually wants (confirmed via the new mock at
`/Users/daveslaptop/work-LocalArea/markdown-planning/Collections-View/out/CollectionUI-context-mock1.1.png`):
- Collections is **just another folder-view layout** opted into via
  `_folder.md`'s `layout:` field, registered in `DISPLAY_REGISTRY` and
  shown in the existing display-options picker — mirroring **Bookshelf**.
- No "Make Collection" ceremony, no separate marker, no detection
  short-circuit.
- **Hierarchy is filesystem-derived.** A folder with
  `layout: collection-home` is itself the Home canvas; its subfolders
  automatically render as Stack tiles on that canvas; clicking a tile
  drills into that subfolder; the breadcrumb walks the resulting chain.
  Subfolders inherit the Collections layout automatically (no need to
  set `layout:` on each level).
- **Drag-reorder is bundled** for both notes-within-a-Stack and
  Stacks-on-the-Home-canvas, **recycling the existing card "manual
  order" mechanism** (the `sort: manual` + `order: []` pattern used by
  the Cards / Kanban layouts; see
  `src/plugins/file-browser/folder-view/renderer.ts:155
  applyManualOrder()` and the `folder-item-drag.ts` util). Do not
  invent a parallel drag system.
- **Read-compat migration**: opening a legacy `type: collection` folder
  still works (it's interpreted as `layout: collection-home`). The
  first user-initiated write to that folder's `_folder.md` atomically
  strips `type: collection` and writes `layout: collection-home`.
  Read-only viewing never rewrites.

The substantive code (13 modules — renderer, stack-panel,
inline-editor, preview-cache, breadcrumb, reference-index, note-box,
home-canvas, popover, settings-persistence, types, schema,
reference-integrity-wiring) is good and survives. This refactor removes
the ceremony, swaps the dispatch path, adds subfolder-as-Stack
rendering on the Home canvas, and wires drag-reorder onto the existing
manual-order primitive.

The prior MVP requirements live at
`docs/requirements/collections_layout_pre_refactor.md` (status:
archive). They are retained for historical context; do not implement
against them.

## Prerequisites

The **folder-icon-assignment** feature (shipped, merged
2026-06-05, `docs/specs/folder-icon-assignment/00_index.md`) continues
to be the icon source. Collections **consumes** it without
modification. Default Stack icon remains `notebook`.

| Symbol / path | Purpose (unchanged) |
|---|---|
| `src/plugins/file-browser/folder-icons.ts` → `FOLDER_ICONS` | 24-glyph catalog. Default Stack icon = `notebook`. |
| `src/plugins/file-browser/folder-icons.ts` → `getFolderIconClass`, `interpretIconValue` | Resolve raw `icon:` strings. |
| `src/plugins/file-browser/folder-icon-store.ts` → `setFolderIcon`, `readFolderIcon`, `buildFolderIconMap` | Atomic icon read/write. |
| `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` → `parseYamlFrontmatter`, `applyYamlKey`, `removeYamlKey`, `reconstructFile` | Store-layer primitives. |
| `src/plugins/file-browser/folder-view/parser.ts` → `parseFolderMd()` | Black-box `_folder.md` reader. |
| `src/lib/bridge.ts` → `readFile`, `writeFile` | Atomic temp-file-swap writes. |
| Right-click "Set folder icon…" context-menu entry | User re-skins any Stack here. |

In addition this refactor consumes:

| Symbol / path | Purpose |
|---|---|
| `src/plugins/file-browser/folder-view/display-options.ts` → `DISPLAY_REGISTRY` (lines 39–78) | The Bookshelf entry (lines 68–77) is the exact precedent for the new Collections entry. |
| `src/plugins/file-browser/folder-view/tab.ts` → `LAYOUT_RENDERERS` (line 111) | The `"collection-home"` entry is already registered (line 125). The refactor removes the short-circuit branch (today at lines 351–355) so dispatch flows via standard `config.layout` resolution. |
| `src/plugins/file-browser/folder-view/renderer.ts` → `applyManualOrder()` (line 155), `sortCards()` manual-sort no-op (line 124), `attachFolderItemDrag` import (line 23) | The card manual-order pattern. Drag-reorder of notes-within-Stack and Stacks-on-Home recycles this primitive. |
| `src/plugins/file-browser/folder-view/folder-item-drag.ts` | Existing drag util attached to Cards. Reused for Collections. |

---

## Summary

As a user, I want to pick the **Collection** layout for any folder via
the existing display-options picker (the same `↗` icon I use to pick
Cards / Table / Bookshelf), have that folder render as a Collections
Home canvas where its subfolders appear as Stack tiles and its own
notes appear in a default Stack, drill into a Stack to see notes
rendered inline as Typora-style framed boxes, drag notes within a
Stack to reorder, and drag Stack tiles on the Home canvas to reorder —
all without any separate "Make Collection" gesture, marker field, or
out-of-band ceremony.

The mock at
`/Users/daveslaptop/work-LocalArea/markdown-planning/Collections-View/out/CollectionUI-context-mock1.1.png`
is the authoritative target for the discovery model and the in-tab
chrome. The original Figma at
`/Users/daveslaptop/Desktop/Screenshot 2026-06-05 at 4.28.37 PM.png`
remains authoritative for the visual treatment of framed boxes, Stack
glyphs, and the empty-state popover.

---

## Knowns

### Locked decisions (do not re-litigate)

1. **Discovery model**: `layout: collection-home` in `_folder.md` YAML
   frontmatter, exactly like `layout: bookshelf`. Registered in
   `DISPLAY_REGISTRY`. **No marker field, no detection short-circuit.**
2. **Hierarchy**: filesystem-derived. A folder with
   `layout: collection-home` is the Home canvas. Its subfolders render
   as Stack tiles on that canvas. Clicking a tile drills into the
   subfolder, which inherits the Collections layout automatically; the
   breadcrumb walks grandparent → parent → child. Subfolders do **not**
   need their own `layout:` entry.
3. **Drag-reorder**: bundled into this pass. **Recycle the existing
   card manual-order pattern** — the `sort: manual` + `order: []`
   primitive used by Cards / Kanban (see `renderer.ts:155
   applyManualOrder()` and `folder-item-drag.ts`). Notes-within-Stack
   and Stacks-on-Home both use the same mechanism. Do not invent a
   new drag system.
4. **Migration**: read-compat. Opening a legacy `type: collection`
   folder still renders correctly (interpreted as
   `layout: collection-home`). On any user-initiated write to that
   folder's `_folder.md`, the store atomically strips `type: collection`
   and writes `layout: collection-home` in the same atomic file write.
   Read-only viewing never rewrites.

### Resolved open questions (Auto-mode defaults applied 2026-06-06)

The refactor brief surfaced four open questions. Auto-mode resolution
(reasonable calls — the user can redirect):

| # | Question | Resolution |
|---|----------|------------|
| Q-R1 | Migration write-on-touch policy | **YES.** Read-compat on open: a folder whose `_folder.md` has `type: collection` AND no `layout:` is treated as `layout: collection-home`. Render path performs NO write. On the FIRST user-initiated mutation to that `_folder.md` (rename, add note, reorder, set-icon, etc.), the store atomically: (a) strips `type: collection`, (b) adds `layout: collection-home`, (c) applies the user's actual mutation — all in the same `applyYamlKey`/`removeYamlKey`/`reconstructFile`/`writeFile` chain (one atomic temp-file-swap). |
| Q-R2 | Sub-options in DISPLAY_REGISTRY | **One mode (`default`) for MVP.** Mirror Bookshelf shape but ship a single option. Sub-options (e.g. `compact` vs `expanded` preview sizing) are reserved for Phase 2 and **do not block** the refactor. The registry entry's `options:` array stays single-element so the picker shows the layout pill without a sub-pill row. |
| Q-R3 | Subfolder-as-Stack opt-in | **Automatic.** All immediate subfolders of a `layout: collection-home` folder render as Stack tiles on the parent's Home canvas, regardless of whether they have their own `_folder.md` or `layout:` entry. Each subfolder inherits the Collections layout when drilled into; subfolders without `_folder.md` render with synthetic defaults (folder name as display name, `notebook` icon, natural directory listing for note order). This is the ergonomic default and matches the mock. |
| Q-R4 | Empty-state popover trigger | **Confirmed.** With no "Make Collection" gesture, the frame-01 empty-state `+ Notecard/Stack` popover appears whenever a folder rendering under `layout: collection-home` has zero subfolders AND zero notes. Picking the layout on an empty folder via the display-options picker produces this state. |

---

## Functional Requirements

### Discovery and dispatch (replaces old FR-1, FR-2, FR-3)

- **FR-1** — A folder whose `_folder.md` YAML frontmatter contains
  `layout: collection-home` is rendered using the Collections renderer.
  Resolution flows through the standard `config.layout` dispatch in
  `LAYOUT_RENDERERS` — exactly the path Bookshelf uses. No marker
  field, no detection short-circuit, no parallel discovery mechanism.
- **FR-2** — `DISPLAY_REGISTRY` (in
  `src/plugins/file-browser/folder-view/display-options.ts`) gains a
  new entry:
  ```typescript
  {
    slug: "collection-home",
    label: "Collection",
    defaultOption: "default",
    options: [{ slug: "default", label: "Default" }],
  }
  ```
  This makes Collections selectable via the same display-options picker
  (`↗` icon) that the user already uses to pick Cards / Table /
  Bookshelf for any folder. Mirror the Bookshelf entry shape at
  `display-options.ts:68–77`.
- **FR-3** — Switching a folder's layout to Collections via the picker
  writes `layout: collection-home` to that folder's `_folder.md` via
  the existing display-options write path. No new write API.
- **FR-4 (read-compat)** — A folder whose `_folder.md` contains
  `type: collection` AND lacks a `layout:` field is treated as
  `layout: collection-home` on read. The render path performs no
  write. (Implementation note: the store's `readCollection()` is the
  one place this aliasing happens; downstream code never sees the
  legacy shape.)
- **FR-5 (migration on write)** — When any user-initiated mutation
  causes a `_folder.md` write on a folder whose on-disk frontmatter
  carries `type: collection`, the same atomic write strips
  `type: collection` and adds `layout: collection-home`. The user's
  actual mutation (rename, reorder, etc.) is applied in the same
  `reconstructFile` → `writeFile` step. No "migration" prompt; no
  separate write.

### Home canvas — filesystem-derived hierarchy (replaces old FR-13–FR-16)

- **FR-10** — The Home canvas of a `layout: collection-home` folder
  renders **two groups** in this order:
  1. **Subfolder tiles** — each immediate subfolder is rendered as a
     Stack tile (glyph from the subfolder's `_folder.md` `icon:` field
     or `notebook` default; badge in upper-right showing
     `noteCount(subfolder) = (immediate .md files in subfolder) +
     (length of subfolder's _folder.md references: array, if present)`).
     Tiles are laid out in a flex-wrap row.
  2. **Note boxes** — the folder's own immediate `.md` files render as
     framed boxes (see FR-20 for inline rendering), in a default
     in-place Stack.
  Plus the existing trailing `+` affordance to add a new Stack
  (creates a new subfolder, FR-11) and the trailing dashed `+ Note`
  card (creates a new note, FR-12).
- **FR-11** — Clicking the `+` Stack affordance creates a new subfolder
  with the next available `Stack NN` name and immediately enters
  inline-rename mode on its tile label. The new subfolder is appended
  to the parent's `order:` array (the same array drag-reorder uses,
  per FR-30).
- **FR-12** — Clicking the trailing `+ Note` card on the Home canvas
  creates an `Untitled.md` in the parent folder (NOT in a subfolder)
  and immediately mounts the inline editor on its framed box.
- **FR-13** — Clicking a subfolder Stack tile drills into that
  subfolder. The container re-renders the subfolder under the same
  Collections layout (in-tab navigation; no new tab). The breadcrumb
  updates to reflect the new path.
- **FR-14** — Empty state (frame 01): a `layout: collection-home`
  folder with zero subfolders AND zero `.md` files renders the
  `+ Notecard/Stack` popover centered in a dashed rounded rectangle.
  Picking "Notecard" creates `Untitled.md` in the current folder and
  enters inline edit. Picking "Stack" creates a new subfolder
  (FR-11 flow). Same layout key; no special empty-state renderer.
- **FR-15** — A subfolder's Stack tile is right-clickable; the menu
  offers: **Rename**, **Move up**, **Move down**, **Set folder icon…**
  (delegates to existing folder-icon-assignment picker), **Delete**.
  Move up/down mutate the parent's `order:` array. Drag-reorder
  (FR-30) is the keyboard-free equivalent.

### Stack section view (preserved from prior MVP, frames 02/03)

- **FR-20** — Inside a Stack (i.e. a subfolder being drilled into),
  each note renders as a **framed box** labeled with the filename,
  showing rendered HTML preview inline (the live-preview / read-mode
  renderer). Click on a box → Typora-style in-place edit mode (CM6
  editor reparented into the box). Same renderer, same preview-cache,
  same IntersectionObserver lazy-rendering as the shipped MVP.
- **FR-21** — Trailing dashed-border `+ Note` affordance creates a
  new `Untitled.md` in the current Stack subfolder, entering edit mode
  immediately.
- **FR-22** — Right-click on a framed box offers: **Rename**, **Move
  up**, **Move down**, **Move to other Stack…**, **Add reference to
  another Stack…**, **Delete**. Move up/down mutate the current
  Stack's `order:` array (FR-30 covers drag).
- **FR-23** — Multi-reference notes (cross-Stack pointers via the
  current Stack's `_folder.md` `references:` array) are preserved
  verbatim from the prior MVP (see prior FR-21–FR-26 + reference-index
  module). No requirements change in this refactor.

### Drag-reorder — recycles the existing card manual-order primitive

- **FR-30** — User can drag a framed note-box within a Stack to
  reorder it. The reordered sequence is persisted in that Stack's
  `_folder.md` `order:` array (the same key the right-click Move
  up/down handlers already mutate). Persistence path: identical to
  the Cards-layout drag persistence — the drag handler computes the
  new ordering and calls the existing store API (`reorderNote(...,
  { toIndex: number })`, already exposed per the shipped MVP's
  step_18 Phase-1.5 hook). On reorder, the parent's `sort:` field is
  set to `manual` (if not already), and `applyManualOrder()` is
  applied to the cards on next render — the exact mechanism Cards
  uses today.
- **FR-31** — User can drag a Stack tile on the Home canvas to
  reorder it relative to other Stack tiles. Persisted in the
  parent's `_folder.md` `order:` array (same key as FR-11's append).
  Same `sort: manual` + `order:` + `applyManualOrder()` mechanism as
  FR-30. Note-boxes on the Home canvas (FR-10 group 2) participate in
  the SAME `order:` array as the Stack tiles — i.e. the parent
  folder's `order:` mixes folder paths and note paths. This matches
  how `applyManualOrder()` already handles a `FolderCard[]` containing
  both `kind: "directory"` and `kind: "file"`.
- **FR-32** — Drag-reorder uses the existing `attachFolderItemDrag()`
  util from
  `src/plugins/file-browser/folder-view/folder-item-drag.ts`. No new
  drag library. No new ghost element. Visual treatment matches the
  Cards-layout drag.
- **FR-33** — Drag-reorder of a note **across Stack boundaries**
  (Stack A → Stack B) is **OUT OF SCOPE for this refactor** (deferred
  to a follow-up). Within-Stack drag and Home-canvas-tile drag are
  in scope. The right-click "Move to other Stack…" entry (FR-22)
  remains the cross-Stack relocation mechanism for now.

### Breadcrumb (preserved, but path is filesystem-derived)

- **FR-40** — A breadcrumb chrome above the Collection view shows the
  full filesystem path from the root `layout: collection-home` folder
  down to the currently-viewed Stack (and, in edit mode, the
  currently-edited note). MVP renders up to three levels:
  `Home (root displayName) / Stack displayName / Note filename`.
  The path is walked by reading immediate parent directories in the
  vault index until the first `_folder.md` carrying
  `layout: collection-home` is found (the canvas root). Phase 2
  Book/Chapter layers (deferred) extend this without code change.
- **FR-41** — Each breadcrumb segment is clickable; clicking returns
  to that level's view in the same tab. Active segment renders as
  plain text. No new component — the breadcrumb component shipped in
  the prior MVP is reused verbatim (it already supports up to 5
  segments).

### Persistence and atomicity

- **FR-50** — All `_folder.md` writes (layout switch, Stack create,
  note reorder, drag-reorder, `_folder.md` migration) go through the
  Rust temp-file-swap atomic write pattern via `writeFile()` in
  `src/lib/bridge.ts`. No direct overwrites. No new Rust commands.
- **FR-51** — All Tauri calls go through `src/lib/bridge.ts` typed
  wrappers returning `FileResult<T>`. No raw `invoke()` in feature
  code.
- **FR-52** — `_folder.md` continues to be excluded from vault-index
  `.md`-equivalent enumeration (already established by
  folder-icon-assignment).

### Command-bar entries

- **FR-60** — Three commands from the prior MVP are **deleted**:
  - `collection:make-collection` — DELETED (no longer a concept)
  - `collection:unmake-collection` — DELETED (use display-options
    picker to switch layout instead)
  - Their keybinding entries in `src/keybindings/keybindings-panel.ts`
    are removed.
- **FR-61** — Two commands from the prior MVP are **kept**:
  - `collection:new-stack` — "New Stack in Current Collection"
    (active when the active tab is a `layout: collection-home`
    folder). Creates a subfolder (FR-11 flow).
  - `collection:add-reference` — "Add Reference to Another Stack…"
    (active when the active focus is a note inside a Collections
    folder). Unchanged.

### Inline rendering (preserved)

- **FR-70** — Framed-box preview rendering, click-to-edit, lazy
  IntersectionObserver virtualization, preview-cache, height-cache,
  one-persistent-EditorView-per-Stack — all preserved verbatim from
  the shipped MVP. See prior FR-27/28/29 and spec §1.8.D/E. No
  requirements change.

---

## Non-Functional Requirements

- **NFR-1** — Home canvas with up to 50 subfolders and up to 100
  notes (5,000 notes total via subfolder badge counts) must paint
  within 200ms. Badge counts read only `_folder.md` frontmatter —
  never note bodies. Section-view rendering of a 200-note Stack must
  paint visible viewport within 200ms; scroll latency < 50ms/frame
  thereafter. Achieved by the existing virtualization (IntersectionObserver +
  preview-cache + height-cache).
- **NFR-2** — A missing or corrupt `_folder.md` must NEVER break the
  parent folder view. If the root `_folder.md` is missing, the folder
  reverts to the standard folder view (Cards by default — the
  Markable system-wide default) with a one-time toast: "Collection
  metadata missing." with a [Recreate] action.
- **NFR-3** — **Window launch size invariant** (`50% × 80%`) must not
  regress. `tests/settings/window-defaults.test.ts` must remain
  green. Per CLAUDE.md: both `src/lib/settings.ts` and
  `src-tauri/src/lib.rs` are NOT touched by this refactor.
- **NFR-4** — No TODO comments in source code. Deferred work goes in
  `docs/specs/collections/00_index.md` under a "Refactor 2026-06-06 —
  Deferred Work" subsection.
- **NFR-5** — Atomic writes: every `_folder.md` mutation passes
  through the Rust temp-file-swap. A crash mid-write leaves either
  old or new file intact — never a partial.
- **NFR-6** — All file operations use existing Rust commands. No new
  Rust commands.
- **NFR-7** — Theme tokens only — all Collections CSS pulls from the
  canonical token catalog in `src/styles.css`. No new tokens. No new
  hex values.
- **NFR-8** — Plugin build rule: any edit under
  `src/plugins/file-browser/**/*.ts` is followed by
  `npm run build:plugins && npm run sync:plugins` (CLAUDE.md).

---

## Proposed Constraints

- **C-1 (Registry entry mirrors Bookshelf)** — The `DISPLAY_REGISTRY`
  entry shape, ordering, and label conventions follow
  `display-options.ts:68–77` exactly. Single-option MVP shape (per
  Q-R2). Slug is `collection-home`, label is `Collection`.
- **C-2 (No detection short-circuit)** — `detection.ts` / `tab.ts`
  contain ZERO Collections-specific dispatch logic. The branch at
  current `tab.ts:351–355` (`detectCollectionLayout` short-circuit)
  is removed. Dispatch flows through standard `config.layout`
  resolution like every other layout.
- **C-3 (Subfolder-as-Stack rendering uses Cards subfolder pattern)** —
  The Home canvas's subfolder-tile rendering mirrors Cards renderer's
  `card.kind === "directory"` branch at
  `src/plugins/file-browser/folder-view/renderer.ts:289–344` but uses
  the Collections Stack-glyph DOM already implemented in
  `home-canvas.ts`. No new directory-collection scanning logic — reuse
  `collectChildren()` from `tab.ts` if useful.
- **C-4 (Drag-reorder uses `attachFolderItemDrag` + `applyManualOrder`)** —
  No new drag util. No new persistence shape. The Collections
  renderer attaches `attachFolderItemDrag()` to Stack tiles and note
  boxes; the store calls `applyManualOrder()` on next render to
  reflect the `order:` array.
- **C-5 (Read-compat is a one-place aliasing)** — `store.readCollection()`
  is the single function that aliases legacy `type: collection` to
  `layout: collection-home`. No other module sees the legacy shape.
- **C-6 (Migration on write is atomic and transparent)** — The store's
  write path detects `type: collection` on disk during the
  read-modify-write cycle and strips it inside the same
  `applyYamlKey`/`removeYamlKey` chain. One temp-file-swap. No
  separate migration write, no toast, no user prompt.
- **C-7 (No new Rust commands)** — Same as the prior MVP. Atomic I/O
  via `writeFile`.
- **C-8 (Frontmatter helpers are composed, not modified)** —
  `parseFolderMd`, `parseYamlFrontmatter`, `applyYamlKey`,
  `removeYamlKey`, `reconstructFile` are used as-is. No fork.
- **C-9 (Theme tokens only)** — Same as NFR-7.
- **C-10 (Plugin build rule)** — Same as NFR-8.
- **C-11 (Live-preview renderer reuse)** — Framed-box HTML preview
  and in-place edit reuse the existing live-preview / editor
  extensions stack. No parallel `marked` import. No parallel CM6
  build. Unchanged from prior MVP's C-10.
- **C-12 (Multi-level breadcrumb component is unchanged)** — The
  breadcrumb component (already shipped, already supports 5
  segments) is unchanged. MVP emits up to 3.

---

## Scope — what this refactor DELETES, ADDS, and KEEPS

### DELETES (~177 lines + a few wiring entries)

| Path | What goes |
|---|---|
| `src/plugins/file-browser/collections/commands.ts` | `makeCollection()`, `unmakeCollection()`, `isCollectionFolder()`, `hasCollectionAncestor()` and helpers (~120 lines). `newStack()`, `createNotecardInDefaultStack()`, `addReference()` are KEPT but rewritten where they relied on the marker. |
| `src/plugins/file-browser/collections/context-actions.ts` | `buildMakeUnmakeCollectionItem()` (7 lines). |
| `src/plugins/file-browser/file-browser.plugin.ts` | "Make Collection" / "Unmake Collection" right-click branch (~lines 3292–3310). |
| `src/main.ts` `handleAction()` | The `collection:make-collection` and `collection:unmake-collection` cases (~30 lines). |
| `src/keybindings/keybindings-panel.ts` | The two corresponding `COMMANDS` rows. |
| `src/plugins/file-browser/collections/detection-glue.ts` | The `detectCollectionLayout()` short-circuit. The module can stay as a thin helper file or be deleted entirely — Architect's call. |
| `src/plugins/file-browser/folder-view/tab.ts` | The short-circuit branch at lines 351–355 that overrides `layoutKey` based on the marker. |
| `src/plugins/file-browser/collections/store.ts` | The `type: stack` write inside `writeStackMeta()` (a stack no longer needs the marker — it's identified by being a subfolder of a `layout: collection-home` folder). The read side keeps tolerating `type: stack` for backward compat. |

### ADDS

| Path | What's new |
|---|---|
| `src/plugins/file-browser/folder-view/display-options.ts` | New `DISPLAY_REGISTRY` entry: `{ slug: "collection-home", label: "Collection", defaultOption: "default", options: [{ slug: "default", label: "Default" }] }`. |
| `src/plugins/file-browser/collections/home-canvas.ts` | Subfolder-as-Stack tile rendering (FR-10 group 1). Mix-with-notes layout (FR-10 group 1 + group 2 in one container). |
| `src/plugins/file-browser/collections/stack-panel.ts` | Drag-reorder wiring via `attachFolderItemDrag()` + store's `reorderNote(..., { toIndex })`. |
| `src/plugins/file-browser/collections/renderer.ts` | Drag-reorder wiring for Home-canvas Stack tiles + note boxes. |
| `src/plugins/file-browser/collections/store.ts` | Read-compat alias `type: collection` → `layout: collection-home` inside `readCollection()`. Migration-on-write: any write through `writeCollectionMeta()` that sees `type: collection` on disk strips it and writes `layout: collection-home` in the same atomic write. |
| `tests/collections/` | New tests for: (a) `DISPLAY_REGISTRY` includes `collection-home`, (b) `layout: collection-home` discovery via standard dispatch, (c) subfolder-as-Stack rendering, (d) drag-reorder persistence (notes + Stacks), (e) read-compat with legacy `type: collection`, (f) migration on write strips `type: collection`, (g) layout-switch via picker writes `layout: collection-home`. |

### KEEPS (substantive code that survives)

The 13 modules that contain the substantive Collections behavior all
survive unchanged or with minimal edits. From `docs/specs/collections/00_index.md`:

- `renderer.ts` (state machine + dispatch — minor edit for drag-reorder)
- `inline-editor.ts` (persistent CM6 reparented per box — unchanged)
- `preview-cache.ts` (lazy markdown render cache — unchanged)
- `note-box.ts` (framed-box rendering, click-to-edit — unchanged)
- `breadcrumb.ts` (multi-segment navigation — unchanged)
- `reference-index.ts` (reverse index for multi-reference notes — unchanged)
- `reference-integrity-wiring.ts` (vault-manager rename/delete hooks — unchanged)
- `popover.ts` (Stack action UI — unchanged)
- `settings-persistence.ts` (scroll/view state — unchanged)
- `types.ts`, `schema.ts` (definitions — minor: drop `type: "collection"` and `type: "stack"` from required fields, keep them as optional for read-compat)
- `home-canvas.ts` (Home canvas frame — edit for subfolder rendering + drag)
- `stack-panel.ts` (Stack section view — edit for drag-reorder)

---

## Edge Case Inventory

Every Edge Case must have a corresponding failing test written BEFORE
its implementation step. Architect maps each EC to a test file in the
amended `00_index.md`.

- **EC-1 (`_folder.md` `layout:` field corruption — invalid value)** — If
  `_folder.md` has `layout: <unknown-value>` (typo, edited by hand to
  nonsense), the folder falls back to the standard folder view (Cards)
  without crashing. No toast required — the picker simply shows no
  active pill.
- **EC-2 (`_folder.md` `layout: collection-home` with corrupt or
  malformed YAML elsewhere)** — Frontmatter is treated as missing per
  `parseFolderMd()`'s existing tolerant behavior; falls back to
  standard folder view; a one-time toast surfaces the parse error
  (NFR-2 path).
- **EC-3 (Stack folder name conflict)** — Creating a new Stack
  (FR-11) auto-increments to the next available `Stack NN` index
  if `Stack 01`, `Stack 02`, etc. already exist. Renaming a Stack
  to a conflicting name refuses with inline error.
- **EC-4 (Missing `_folder.md` on `layout: collection-home` folder)** —
  Per NFR-2: falls back to standard view + one-time toast.
- **EC-5 (Subfolder without its own `_folder.md`)** — Renders as a
  Stack tile on the parent's Home canvas anyway, with synthetic
  defaults: display name = folder name, icon = `notebook`,
  notes = natural directory listing of immediate `.md` files,
  references = empty. A `_folder.md` is written lazily on the next
  ordering change.
- **EC-6 (Subfolder with `_folder.md` but no `layout:` field)** —
  Inherits Collections layout from the parent (Q-R3 resolution). Same
  rendering as EC-5 plus any custom `displayName` / `icon` / `order:` /
  `references:` from its own `_folder.md`.
- **EC-7 (Read-compat: legacy `type: collection` folder)** — A folder
  whose `_folder.md` carries `type: collection` AND lacks any
  `layout:` field is interpreted as `layout: collection-home`. The
  render path performs NO write. The user sees the Collections
  layout immediately on open. Verified by opening a folder created
  via the pre-refactor "Make Collection" gesture without first
  triggering any write.
- **EC-8 (Migration on write strips legacy marker)** — On the first
  user-initiated mutation to a legacy `type: collection` folder's
  `_folder.md` (rename, add note, reorder, etc.), the store strips
  `type: collection` and adds `layout: collection-home` in the SAME
  atomic write. After the mutation, the file contains
  `layout: collection-home` and no `type:` field. Test: pre-populate
  a `_folder.md` with `type: collection`, trigger any mutation,
  assert post-state file content.
- **EC-9 (Subfolder without notes renders as empty Stack tile)** —
  An empty subfolder of a `layout: collection-home` folder renders
  with badge count `0`. Clicking the tile drills in and shows the
  frame-01 empty-state popover (since the drilled-into subfolder
  also has zero notes and zero subsubfolders).
- **EC-10 (Drag-reorder persistence after reload)** — User drags a
  note within a Stack to position 3. The Stack's `_folder.md`
  `order:` array is rewritten and `sort: manual` is set. Closing and
  reopening the app (or the tab) renders the notes in the new order.
- **EC-11 (Drag-reorder of Stack tiles on Home canvas persistence)** —
  User drags Stack tile 2 to position 1 on the Home canvas. The
  parent's `_folder.md` `order:` array (which mixes folder paths and
  note paths) is rewritten and `sort: manual` is set. Close/reopen:
  new order intact.
- **EC-12 (Drag a note onto a Stack tile — cross-Stack drag)** —
  **Out of scope per FR-33.** The drag handler must REFUSE this
  gesture (cursor falls back to default, no drop indicator on Stack
  tiles when dragging a note). If the user attempts it, no
  `_folder.md` is mutated. The right-click "Move to other Stack…"
  entry remains the only cross-Stack relocation path.
- **EC-13 (Layout switch via picker)** — User opens any folder
  (regardless of current layout), clicks the display-options picker
  (`↗` icon), selects "Collection". The folder's `_folder.md` is
  written with `layout: collection-home`; the view re-renders as
  Collections in the same tab. Verified for: folder with notes only,
  folder with subfolders only, folder with both, empty folder.
- **EC-14 (Layout switch away from Collections)** — User opens a
  `layout: collection-home` folder, switches via picker to Cards.
  `_folder.md` is rewritten with `layout: cards` (or the picker's
  internal slug). Note boxes / Stack tiles disappear; Cards layout
  renders. All notes still on disk. All subfolders intact. No data
  loss.
- **EC-15 (Mid-edit layout switch)** — User is editing a note in a
  framed box (Stack section view) and uses the picker to switch the
  layout away from Collections. The edit must commit (autosave fires,
  file written atomically) BEFORE the layout switch unmounts the
  Stack panel. No data loss. State machine same as EC-19 from the
  prior MVP (now renumbered EC-21 below).
- **EC-16 (Window-size invariant)** — `tests/settings/window-defaults.test.ts`
  remains green. Neither `src/lib/settings.ts` nor `src-tauri/src/lib.rs`
  is touched by this refactor (per CLAUDE.md invariant).
- **EC-17 (Vault index excludes `_folder.md`)** — Existing contract.
  Verified by scanning a `layout: collection-home` folder and
  asserting zero index entries with paths ending `_folder.md`.
- **EC-18 (Concurrent `_folder.md` write)** — Two rapid user actions
  (e.g. user drags a note and the auto-migration also wants to write)
  must not corrupt the file. The per-file write queue in `store.ts`
  (existing) serializes writes; temp-file-swap guarantees atomicity.
- **EC-19 (Schema-version mismatch)** — A `_folder.md` with
  `schemaVersion` greater than what the running build knows about is
  rendered as-is, no writes; a toast warns the user. Unchanged from
  prior MVP.
- **EC-20 (Notecard creation when no Stack exists)** — On a
  `layout: collection-home` folder with no subfolders, clicking
  `+ Notecard` creates `Untitled.md` in the PARENT folder (not in
  a subfolder), entering edit mode. (This differs from the prior
  MVP's behavior of auto-creating Stack 01 — the new filesystem-
  derived model puts notes in the same folder by default.)
- **EC-21 (Click-to-edit, then click-elsewhere)** — Unchanged from
  prior MVP. Click box A → A enters edit. Click box B → A commits,
  B enters edit. Click outside → A commits, exits edit.
- **EC-22 (Multi-reference edit propagation)** — Unchanged from
  prior MVP. Edit a referenced box → canonical file updates → other
  Stacks render new content.
- **EC-23 (Broken reference pointer)** — Unchanged from prior MVP.
  Renders as dimmed broken-link box; right-click → "Remove reference"
  cleans up.
- **EC-24 (Reference to a folder rather than a note)** — Unchanged.
  Refused at FR-23's `addReference()` command level.
- **EC-25 (Custom-icon assignment on a Stack)** — Unchanged. User
  opens the existing "Set folder icon…" right-click on a subfolder
  Stack tile → picks catalog icon or custom SVG → Home glyph
  re-renders.
- **EC-26 (Breadcrumb after Stack rename)** — Unchanged. User
  renames a Stack while drilled into it; breadcrumb middle segment
  updates in the same render pass.
- **EC-27 (Picker shows current layout for a `layout: collection-home`
  folder)** — Opening the display-options picker on a Collections
  folder shows "Collection" as the active pill (same convention as
  every other layout). Confirms `DISPLAY_REGISTRY` registration is
  complete and the picker round-trips correctly.
- **EC-28 (Right-click "Make Collection" / "Unmake Collection" no
  longer appear)** — Regression test: scan the context menu items
  rendered for any folder and assert neither "Make Collection" nor
  "Unmake Collection" appears. Same for the command-bar.

---

## Out of Scope (Phase 2 / Later)

- **Phase 2 Chapter / Book distinction** — Still deferred. The
  filesystem-derived subfolder-as-Stack rendering is the substrate
  on which a future Book/Chapter typing can be layered (e.g. a
  subfolder with `type: chapter` in its own `_folder.md` could render
  with a different glyph), but no special handling ships in this
  refactor. Subfolders are all rendered as Stack tiles uniformly.
- **Workflow configurator UI (frame 09)** — Still deferred.
- **Cross-Stack drag-reorder (note from Stack A → Stack B via drag)** —
  **Confirmed out of scope** for this refactor. Right-click "Move to
  other Stack…" remains the only cross-Stack move mechanism. EC-12
  enforces the refusal.
- **Frame 05 — bulk rename-multiple stacks** — Deferred.
- **Frame 08 — per-Collection settings panel (gear icon)** — Deferred.
- **Sub-options for Collections in `DISPLAY_REGISTRY`** — Q-R2:
  single `default` option for MVP; future `compact` / `expanded`
  variants deferred.
- **Sync / sharing / export** — Deferred.
- **Plugin API surface for third-party Collection renderers** —
  Deferred.
- **Auto-detection of "this folder looks like a Collection"** —
  Deferred. Discovery is explicit: user picks the layout via picker
  (or read-compat aliases legacy `type: collection`).

---

## Files Expected to Change

(Architect to confirm exact line numbers; this is the working set.)

| File | Nature of change |
|---|---|
| `src/plugins/file-browser/folder-view/display-options.ts` | **EDIT** — add `collection-home` entry to `DISPLAY_REGISTRY`. |
| `src/plugins/file-browser/folder-view/tab.ts` | **EDIT** — remove the short-circuit branch at ~lines 351–355. The `LAYOUT_RENDERERS["collection-home"]` registration at line 125 stays. |
| `src/plugins/file-browser/folder-view/detection.ts` | **EDIT** — remove `detectCollectionLayout()` call site / function. |
| `src/plugins/file-browser/collections/detection-glue.ts` | **DELETE or stub** — Architect's call. The short-circuit goes away; if any thin helper remains useful (e.g. `isCollectionFolder()` for context-menu enablement) keep that; else delete the file. |
| `src/plugins/file-browser/collections/commands.ts` | **EDIT** — delete `makeCollection`, `unmakeCollection`, `isCollectionFolder`, `hasCollectionAncestor` and helpers. KEEP `newStack`, `createNotecardInDefaultStack` (rewritten to default to the parent folder per EC-20 — though `createNotecardInDefaultStack` may simply be renamed `createNotecardInFolder`), `addReference`. |
| `src/plugins/file-browser/collections/context-actions.ts` | **DELETE** — `buildMakeUnmakeCollectionItem()`. |
| `src/plugins/file-browser/file-browser.plugin.ts` | **EDIT** — remove "Make Collection" / "Unmake Collection" right-click branch (~lines 3292–3310). Right-click on Stack tiles (rename/move/delete/set-icon) is wired via the Home canvas, not here. |
| `src/main.ts` | **EDIT** — remove `collection:make-collection` and `collection:unmake-collection` cases. |
| `src/keybindings/keybindings-panel.ts` | **EDIT** — remove the two corresponding `COMMANDS` rows. |
| `src/plugins/file-browser/collections/store.ts` | **EDIT** — `readCollection()` aliases legacy `type: collection` → `layout: collection-home` (FR-4 / C-5). `writeCollectionMeta()` strips `type: collection` on write if present (FR-5 / C-6). `writeStackMeta()` drops the `type: stack` write (the marker is no longer needed). `readStack()` still tolerates `type: stack` on read for backward compat. |
| `src/plugins/file-browser/collections/home-canvas.ts` | **EDIT** — render subfolders as Stack tiles (FR-10 group 1). Attach `attachFolderItemDrag()` to tiles (FR-31). |
| `src/plugins/file-browser/collections/stack-panel.ts` | **EDIT** — wire drag-reorder onto note boxes via `attachFolderItemDrag()` (FR-30). |
| `src/plugins/file-browser/collections/renderer.ts` | **EDIT** — orchestration changes for the mixed Home canvas (subfolders + parent's own notes); drag-reorder dispatch. |
| `src/plugins/file-browser/collections/types.ts` | **EDIT** — `CollectionMeta.type` and `StackMeta.type` become optional (read-compat); add a `layout?: "collection-home"` field if the existing types don't already expose it. |
| `tests/collections/*.test.ts` | **EDIT + ADD** — update tests that asserted `type: collection` was written. Add tests for read-compat, migration-on-write, subfolder-as-Stack, drag-reorder persistence, layout switching via picker, no-more-Make-Collection regression. |
| `docs/specs/collections/00_index.md` | **APPEND** — add a "Refactor 2026-06-06" section documenting the architectural shift. Keep the prior MVP sign-off intact. Flip status from `reference` back to `active` until the refactor lands. |
| `src/plugins/file-browser/folder-view/parser.ts` | **NO CHANGE.** |
| `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` | **NO CHANGE.** |
| `src/plugins/file-browser/folder-icons.ts` / `folder-icon-store.ts` | **NO CHANGE.** |
| `src/plugins/file-browser/folder-view/renderer.ts` | **NO CHANGE.** (`applyManualOrder`, `attachFolderItemDrag` are imported and used as-is.) |
| `src/lib/settings.ts` | **NO CHANGE** (re: window invariant). The `collections` sub-object added by the prior MVP stays. |
| `src-tauri/src/lib.rs` | **NO CHANGE.** Window invariant protected. |
| `src-tauri/src/commands/` | **NO CHANGE.** No new Rust commands. |
| `src/lib/bridge.ts` | **NO CHANGE** (uses existing `readFile`, `writeFile`, `moveFile`, etc.). |

---

## Verification (when refactor lands)

- `npm run test:run` — all tests green; the 4655 baseline (or post-fix
  count) is maintained or grown.
- `npm run build` — TypeScript clean; bundle emitted.
- `npm run test:run -- tests/settings/window-defaults.test.ts` —
  window invariant intact (NFR-3, EC-16).
- `npm run test:run -- tests/folder-icons/` — prerequisite untouched.
- `npm run test:run -- tests/collections/` — every EC has a passing
  test.
- `npm run build:plugins && npm run sync:plugins` — mandatory after
  every `src/plugins/**/*.ts` edit.
- **Manual scenarios** (from the refactor brief):
  - Open any folder via the file browser. Click the display-options
    picker (`↗` icon). Select "Collection". The folder re-renders as
    the Collections layout (mock 1.1).
  - In a folder with subfolders, switch layout to Collections. The
    subfolders appear as Stack tiles on the Home canvas. Each tile
    shows the subfolder's icon (or `notebook` default) + a badge
    showing the note count.
  - Click a subfolder Stack tile. The view drills into the subfolder
    in the same tab; the Stack section view renders its notes as
    framed boxes; the breadcrumb shows
    `Home (root) / <subfolder name>`.
  - Drag a note box within a Stack to position 3. Close and reopen
    the tab. The note remains at position 3 (drag-reorder persists
    via `_folder.md` `order:` array).
  - Drag a Stack tile on the Home canvas. Close and reopen. The new
    order persists.
  - Try to drag a note from Stack A onto Stack B's tile. The drag is
    refused (no drop indicator, no `_folder.md` mutation). The
    right-click "Move to other Stack…" entry remains the only
    cross-Stack move path.
  - Open a folder created via the pre-refactor "Make Collection"
    gesture (i.e. its `_folder.md` carries `type: collection` with no
    `layout:` field). It renders as Collections immediately, with NO
    write to `_folder.md`. Inspect the file on disk: still has
    `type: collection`.
  - In the same legacy folder, drag a note (any mutation will do).
    Inspect the file on disk: `type: collection` is gone,
    `layout: collection-home` is present. The drag's order change is
    also reflected.
  - Confirm "Make Collection" and "Unmake Collection" no longer
    appear in folder right-click menus or the command bar.
  - Switch a Collections folder back to "Cards" via the picker.
    Note boxes / Stack tiles disappear; Cards layout renders; all
    notes still on disk; all subfolders intact.
  - Verify window size on launch is still 50% width × 80% height
    (centered). Run the regression test.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated (revised 2026-06-06; locked
  decisions + Auto-mode resolutions Q-R1…Q-R4)
- Edge cases to verify in tests: **28 items** in Edge Case Inventory
  (EC-1 … EC-28)
- Parked prior MVP doc: `docs/requirements/collections_layout_pre_refactor.md`
  (status: archive, SUPERSEDED banner applied)
- Architect target: **AMEND** `docs/specs/collections/00_index.md` —
  append a "Refactor 2026-06-06" section documenting:
  - Architectural shift (marker → layout-registry dispatch)
  - Subfolder-as-Stack rendering on Home canvas
  - Drag-reorder via `attachFolderItemDrag()` + `applyManualOrder()`
  - Read-compat + migration-on-write in `store.ts`
  - Updated step files for the deleted commands and the new tests
  - Flip status from `reference` back to `active` until refactor
    lands; restore `reference` post-merge
  - **Do NOT delete** the original sign-off — append, don't rewrite.

Next step: Activate `@software-architect` and provide
`docs/requirements/active_task.md` as context, targeting
`docs/specs/collections/00_index.md` as the artifact to AMEND.

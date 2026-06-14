---
title: "Unified View Modal (PARKED — superseded 2026-06-09)"
last-updated: "2026-06-09"
review-cadence-days: 30
status: archive
---

> **SUPERSEDED 2026-06-09.** This requirements doc captured the Unified View
> Modal feature, which shipped on 2026-06-08 (Approved for Merge — see
> `docs/specs/view-modal/00_index.md` §11 Review Sign-off). It is parked here
> as historical record. The active requirements doc has moved to
> **Collections — Hierarchy, Drag, Composite Views**.

# Unified View Modal

## Context

Markable currently has **two modals** that overlap in purpose:

- **New Folder View** (right-click → New Folder View) — a flat list of
  template tiles (Hub Page, Media Gallery, Project Table, Simple Index,
  Collection). Writes `_folder.md` with YAML frontmatter.
- **Insert CodeBlock** (in-doc) — pills + sub-options + Path + Filter.
  Inserts a `select` codefence with YAML body.

Both pick a layout, both produce YAML configuration, both define how a
list of files renders. The user named the duplication explicitly
("why do we even need two modals?") and provided a unified design at
`/Users/daveslaptop/Desktop/Screenshot 2026-06-08 at 11.10.00 AM.png`.

The user's design: **one modal**, big static preview on top, six
layout tabs below the preview
(**Cards / Table / Collection / Timeline / Kanban / Bookshelf**), and
a single config row (Path, Filter, Sort on the left; toggles + Content
Width on the right). Triggered from either context. Templates
(Hub Page, Media Gallery, etc.) are **out of scope here** — they
move to a deferred "Layouts" flow.

The mock at
`/Users/daveslaptop/Desktop/Screenshot 2026-06-08 at 11.10.00 AM.png`
is the authoritative target for visual layout. The approved planning
brief lives at
`/Users/daveslaptop/.claude/plans/i-have-some-ideas-lovely-cascade.md`.

The prior `active_task.md` (the Collections Layout Refactor) shipped
and was merged into `docs/specs/collections/00_index.md`. It has been
parked at `docs/requirements/collections_layout_refactor_completed.md`
with a SUPERSEDED banner.

---

## Summary

As a user, I want **one** modal that opens from both right-click ("New
Folder View") and in-doc codeblock insert, lets me pick from six
layouts (Cards / Table / Collection / Timeline / Kanban / Bookshelf)
via a tab strip below a big static preview illustration, configure
Path / Filter / Sort / display toggles / Content Width in a single
config row, and produces either a new `_folder.md` (right-click
context) or an inline `select` codefence at the editor cursor (in-doc
context). The modal always emits a `select` codefence shape; the
codeblock-type chooser (Select / Sidebar / Grid) moves out of the modal
to `/sidebar` and `/grid` slash commands that insert stubs directly.
`_folder.md` becomes a thin shell containing one `select` codeblock;
legacy frontmatter shapes are read-compat forever and migrate
opportunistically on any user-initiated write.

---

## Knowns

### Locked decisions (do NOT re-litigate)

1. **One modal for both contexts.** Triggered from right-click → "New
   Folder View" AND from in-doc codeblock insert. Same modal, same
   behavior, only the action-button label and the on-submit destination
   differ.
2. **Templates removed from this flow.** Hub Page, Media Gallery,
   Project Table, Simple Index are removed entirely. They are deferred
   to a separate future "Layouts" flow. Do not design or implement
   Layouts as part of this work.
3. **Path field always editable, default `./`.** Same behavior in both
   contexts. Pre-fill is just a default; the user can change it.
4. **Codeblock-type chooser moves to slash commands.** The modal always
   produces a `select` codefence. `/sidebar` and `/grid` slash commands
   handle the other two codefence types by inserting empty stubs at
   the cursor (no modal). Drops a tab layer from this UI.
5. **Preview area is static SVG illustrations per tab (Phase 1).** Live
   preview (rendering actual Path + Filter + Layout against real vault
   files) is **Phase 2** and out of scope here.
6. **`_folder.md` becomes a thin shell containing one `select`
   codeblock.** Same YAML shape as inline codeblocks. The folder-view
   renderer parses the codeblock from the body rather than YAML
   frontmatter. Existing `_folder.md` files with frontmatter keep
   working via read-compat indefinitely. Migration-on-write rewrites
   frontmatter into codeblock shape atomically on any user mutation.

### Resolved Open Questions (Auto-mode defaults applied 2026-06-08)

The brief surfaced five open questions. Auto-mode resolution (reasonable
calls — the user can redirect):

| # | Question | Resolution |
|---|----------|------------|
| Q-1 | **Title bar text** — literal "New folder view, New codeblock" combined string (as in the mockup), OR context-swapped per trigger? | **Context-swapped.** Title reads **"New Folder View"** when triggered from a folder right-click; **"Insert Codeblock"** when triggered from in-doc. Mockup's combined string was a concept sketch, not a literal spec. Cleaner mental model for users and matches the action-button label split (Create / Insert). |
| Q-2 | **Default toggle states** — mockup shows all three toggles (Show modified date / Show file extensions / Include preview pane) ON. Confirm default-ON for new views. | **All three ON by default.** Matches the mockup exactly. When the modal opens with no prefilled config (i.e. a fresh "New Folder View" or "Insert Codeblock"), the three toggles render in the ON position. When the modal opens to edit an existing codeblock or `_folder.md`, the toggles reflect the persisted values. |
| Q-3 | **Sort options** — current Insert CodeBlock has a Name ↑/↓ dropdown. Confirm options carry over identically OR expand. | **Carry over identically.** Options: Name ↑ and Name ↓. No expansion to Modified / Created / Manual in this round. Expanded sort options are deferred to a follow-up. |
| Q-4 | **Slash command behavior** — does `/sidebar` (and `/grid`) insert an empty stub, open an inline picker, or open the unified modal with the type swapped? | **Insert an empty stub at the cursor.** `/sidebar` inserts ```` ```sidebar\n\n``` ```` and places the cursor on the inner blank line. `/grid` inserts ```` ```grid\n\n``` ```` likewise. No modal, no inline picker. Simplest shape; consistent with the locked decision to remove the codeblock-type chooser from the modal. A future minimal modal for sidebar/grid can be added later as a separate piece of work (DW-1). |
| Q-5 | **Read-compat scope** — is the legacy-frontmatter read-compat indefinite, or transitional? Is migration ever forced? | **Indefinite read-compat. Opportunistic migration only.** Both shapes (legacy `_folder.md` with `layout:` in frontmatter AND the new shape with a `select` codeblock in the body) work forever. Migration is triggered exclusively by user-initiated writes via this modal or any other downstream mutation that goes through the writer. Read-only viewing NEVER rewrites. No "force migrate" UI, no batch migrator, no toast. Same pattern as the Collections refactor's `type: collection` → `layout: collection-home` migration. |

---

## Functional Requirements

### Modal trigger — right-click context

- **FR-1** — Right-clicking a folder in the file browser exposes a
  context-menu entry "New Folder View" (existing label; the menu copy
  does not change). Selecting it opens the **Unified View Modal** in
  **create mode**. Title bar reads **"New Folder View"** (Q-1).
- **FR-2** — In create mode, the modal opens with default state:
  - Active tab: **Cards** (the leftmost tab).
  - Path field: **`./`** (literal default per locked decision 3).
  - Filter row: empty (no filter rules); copy reads "Show all files"
    above the `+ Add filter` button.
  - Sort dropdown: **Name ↑** (default per Q-3).
  - All three toggles **ON** (per Q-2).
  - Content Width: **Normal** (the leftmost pill).
  - Action button label: **Create** (per locked decision; see FR-30).
- **FR-3** — On submit (Create), the modal writes `_folder.md` to the
  right-clicked folder containing a single `select` codeblock with the
  user's chosen layout, path, filter, sort, toggles, and content
  width. The file is created if absent; if present, see FR-32
  (existing-file policy).
- **FR-4** — After a successful Create, the folder's view tab opens in
  the file browser with the chosen layout rendered. If the tab is
  already open, it re-renders in place. No second tab is created.

### Modal trigger — in-doc context

- **FR-5** — In an open `.md` editor tab, the user triggers codeblock
  insert via the existing entry point (the in-doc "Insert CodeBlock"
  command — confirmed by Architect during implementation). This opens
  the **Unified View Modal** in **insert mode**. Title bar reads
  **"Insert Codeblock"** (Q-1).
- **FR-6** — In insert mode, the modal opens with default state
  identical to create mode (FR-2), except the action button label is
  **Insert** (per locked decision; see FR-30).
- **FR-7** — On submit (Insert), the modal inserts a `select`
  codefence at the editor's cursor position with the chosen layout +
  config. Cursor lands immediately after the closing fence (existing
  insert convention — Architect confirms). The cursor's prior selection
  (if any) is replaced.
- **FR-8** — Insert mode in mid-line (cursor not at line start): the
  codefence is preceded by a newline so the fence starts on its own
  line. Insert mode at a blank line: no leading newline added. Same
  behavior as the existing Insert CodeBlock modal — carry forward
  verbatim.

### The six tabs

- **FR-10** — The modal displays exactly six tabs in this order, below
  the preview area, above the config row:
  **Cards / Table / Collection / Timeline / Kanban / Bookshelf**.
  Order is fixed; no user-reorder, no admin-config.
- **FR-11** — The leftmost tab (**Cards**) is the default-selected tab
  when the modal opens in create mode or insert mode with no prefilled
  config. When opened in edit mode (editing an existing `_folder.md` or
  existing codeblock — Architect to confirm whether edit mode is wired
  in Phase 1 or deferred), the tab matching the persisted `layout:`
  value is selected.
- **FR-12** — Switching tabs:
  - Updates the preview illustration to the static SVG for that layout
    (FR-25).
  - Preserves all config-row state (Path, Filter rules, Sort, toggles,
    Content Width). Switching from Cards to Table must NOT clear Path
    or Filter rules.
  - Updates the codeblock `layout:` slug that will be emitted on
    submit: `cards`, `table`, `collection-home`, `timeline`, `kanban`,
    `bookshelf` (Architect confirms exact slug strings against
    `DISPLAY_REGISTRY` during implementation).
- **FR-13** — The active tab is visually distinct (existing pill /
  button-active styling reused from the current Insert CodeBlock
  modal). No new active-tab style is invented.

### Path field

- **FR-14** — The Path field is a single-line text input with the label
  "Path (select files to display)".
- **FR-15** — Default value is the literal string **`./`** (vault-
  relative, current folder). The user can change it freely.
- **FR-16** — In create mode, `./` is interpreted relative to the
  folder where `_folder.md` is being created. In insert mode, `./` is
  interpreted relative to the folder containing the file the codeblock
  is being inserted into. (Renderer-side concern; modal stores the
  string verbatim.)
- **FR-17** — Path validation (vault-relative resolution, missing-
  folder detection, etc.) is **NOT** the modal's responsibility. The
  renderer handles validation and error display when the view actually
  paints. The modal accepts whatever the user types.
- **FR-18** — Empty Path: an empty string is treated as the default
  `./` on submit. The modal does NOT block submit on empty Path (see
  EC-4).

### Filter row

- **FR-20** — The Filter row contains:
  - Label "Filter" (left-aligned).
  - A status line beneath the label that reads "Show all files" when
    no filter rules are configured, OR a summary count "N filter(s)
    applied" when one or more rules exist (Architect to confirm exact
    summary text against the current modal; this is the existing
    behavior carried forward verbatim).
  - A `+ Add filter` button that opens the existing smart-filter-
    builder modal (see `reference_smart_filter_builder`). Behavior is
    unchanged from the current Insert CodeBlock modal.
- **FR-21** — Filter rules persist into the emitted codeblock under
  the existing `filter:` key. Shape is unchanged from the current
  Insert CodeBlock modal output.
- **FR-22** — Filter rule editing, deletion, and AND-semantics are
  unchanged. The `+ Add filter` button is the only entry point in
  this modal.

### Sort dropdown

- **FR-25** — The Sort dropdown sits below the Filter row on the left
  column. Label reads "Sort". Options are exactly: **Name ↑**, **Name
  ↓** (Q-3). Default is **Name ↑**.
- **FR-26** — Sort persists into the emitted codeblock under the
  existing `sort:` key. Shape carries forward from the current Insert
  CodeBlock modal output.

### The three toggles

- **FR-30** — The right column of the config row contains exactly
  three toggles, stacked top-to-bottom:
  1. **Show modified date** — controls per-card / per-row modified-
     date display in the rendered view.
  2. **Show file extensions** — controls whether filenames show their
     `.md` (or other) suffix in the rendered view.
  3. **Include preview pane** — controls whether the rendered view
     reserves a side preview pane.
- **FR-31** — Default state for each toggle is **ON** (Q-2). When the
  modal opens with no prefilled config (FR-2, FR-6), all three render
  in the ON position. When opening with prefilled config (edit-mode,
  if wired), each toggle reflects the persisted boolean from the
  codeblock or `_folder.md`.
- **FR-32** — Each toggle persists into the emitted codeblock under
  an explicit key: `showModifiedDate: true|false`,
  `showFileExtensions: true|false`, `includePreviewPane: true|false`.
  (Architect confirms exact key names — must match existing render-
  consumer code; rename keys if needed but document the migration.)

### Content Width pills

- **FR-35** — Below the toggles, a "Content width" label and a row of
  three pills: **Normal**, **Wide**, **Full**. Exactly one is active
  at any time.
- **FR-36** — Default is **Normal** (leftmost pill).
- **FR-37** — Content Width persists into the emitted codeblock under
  the existing `contentWidth:` key with values `normal | wide | full`
  (Architect confirms key name against current modal output).

### Action button

- **FR-40** — The action button at the bottom-right of the modal
  displays:
  - **Create** when triggered from right-click context (FR-1, FR-2).
  - **Insert** when triggered from in-doc context (FR-5, FR-6).
- **FR-41** — Cancel button to the left of the action button. Cancel
  discards all modal state without writing anything to disk or
  inserting any text into the editor. The modal closes.
- **FR-42** — Submit button is keyboard-shortcut bound to ⏎ (Enter)
  per existing modal-keyboard convention (reuse `attachModalKeyboard`
  if used elsewhere). Cancel bound to Esc.

### Preview area (Phase 1 — static illustrations)

- **FR-45** — Above the tab strip sits the preview area, occupying
  ~60–65% of the modal's vertical space (matches mockup proportions).
- **FR-46** — The preview area shows a static SVG illustration keyed
  to the currently-selected tab. Six illustrations total — one per
  layout:
  - Cards: a grid of three card outlines.
  - Table: a 3-column table sketch.
  - Collection: a Home-canvas-like grid of Stack tiles.
  - Timeline: a vertical timeline with date markers.
  - Kanban: three columns of stacked cards.
  - Bookshelf: a row of book spines.
  Visual style mirrors existing template SVGs in the current "New
  Folder View" code path (dark-bg, simple shapes, dimensioned
  approximately 400×280). The Architect picks final dimensions.
- **FR-47** — The illustration swaps with no animation on tab change
  (instant; no fade, no slide). Phase 2 may add a live preview here;
  in Phase 1 the illustration is static SVG only.

### `_folder.md` write — new codeblock shape

- **FR-50** — On Create (FR-3), the modal writes `_folder.md` to the
  target folder with content shaped as:
  ```markdown
  ```select
  layout: <slug>
  path: <user-entered-path-or-default>
  filter:
    <filter rules verbatim>
  sort: <name-asc|name-desc>
  showModifiedDate: <bool>
  showFileExtensions: <bool>
  includePreviewPane: <bool>
  contentWidth: <normal|wide|full>
  ```
  ```
  (Exact key names confirmed by Architect against renderer.)
- **FR-51** — `_folder.md` MUST be written atomically via the existing
  `writeFile()` bridge wrapper (temp-file-swap). No new Rust commands.
- **FR-52** — The modal does NOT write YAML frontmatter (`---` block)
  to new `_folder.md` files. The codeblock is the sole config carrier.

### `_folder.md` read-compat — legacy frontmatter shape

- **FR-55** — When the folder-view renderer opens a `_folder.md`, it
  reads config with this precedence:
  1. **Codeblock first.** If the file body contains a `select`
     codeblock, parse YAML from its body and use that as the
     `FolderViewConfig`.
  2. **Frontmatter fallback.** If no codeblock is found, parse the
     YAML frontmatter as today (legacy shape). Same `FolderViewConfig`
     output.
- **FR-56** — Read-compat is **indefinite** (Q-5). No timeout, no
  toast, no UI prompting the user to migrate. Legacy files render
  forever without modification.
- **FR-57** — The `parseFolderMd()` machinery (in
  `src/plugins/file-browser/folder-view/parser.ts`) extends to also
  extract config from a `select` codeblock in the body. Returns the
  same shape regardless of source. The Architect chooses whether to
  add a new exported function or extend the existing one.

### Migration-on-write — opportunistic, atomic

- **FR-60** — When any user-initiated write touches a `_folder.md`
  that on disk carries `layout:` (or other folder-view config keys) in
  YAML frontmatter, the same atomic write rewrites the file with:
  - Frontmatter keys stripped (or, if other unrelated keys remain
    — e.g. `icon:`, `displayName:` — the frontmatter is preserved but
    the folder-view-config keys are removed).
  - A `select` codeblock containing the full config in the body.
  The mutation the user requested (e.g. layout change via picker,
  modal-driven edit, etc.) is folded into the same write.
- **FR-61** — Migration writes use the existing
  `applyYamlKey`/`removeYamlKey`/`reconstructFile` primitives plus
  body-text manipulation. Single temp-file-swap. No separate migration
  write.
- **FR-62** — Migration is silent. No toast, no prompt. Read-only
  viewing NEVER triggers a write.
- **FR-63** — Migration scope INCLUDES `type: collection` → codeblock
  shape (the Collections refactor's read-compat shim handles this on
  read; the modal-driven write completes the migration on write).
  Architect ensures the migration paths compose cleanly with the
  existing Collections read-compat in `store.ts`.

### `/sidebar` and `/grid` slash commands

- **FR-70** — Typing `/sidebar` at the slash-command prompt in an
  open `.md` editor inserts the following at the cursor:
  ```
  ```sidebar

  ```
  ```
  Cursor lands on the empty inner line.
- **FR-71** — Typing `/grid` at the slash-command prompt inserts:
  ```
  ```grid

  ```
  ```
  Cursor lands on the empty inner line.
- **FR-72** — Both commands behave identically to FR-8 with respect to
  mid-line vs blank-line insertion: leading newline added if cursor
  is mid-line.
- **FR-73** — The slash-command palette displays both entries under an
  appropriate section (Architect picks; likely "Insert" alongside the
  existing `/codeblock` entry).
- **FR-74** — Neither slash command opens the Unified View Modal.
  They insert empty stubs only. Future minimal modals for these two
  codefence types are deferred (DW-1).

### Collection tab behavior

- **FR-80** — Selecting the **Collection** tab and submitting writes
  `layout: collection-home` into the codeblock (matching the existing
  Collections renderer's expected layout slug).
- **FR-81** — All Collections features (subfolder-as-Stack rendering,
  drag-reorder, breadcrumb, inline editing of framed boxes) continue
  to function unchanged. The Unified View Modal is just a new entry
  point that writes the same `layout: collection-home` value the
  display-options picker writes today.
- **FR-82** — The Collection tab's static preview illustration depicts
  a Home-canvas-like grid of Stack tiles (per FR-46).
- **FR-83** — When the Collection tab is selected, the right-column
  toggles (Show modified date / Show file extensions / Include
  preview pane) remain editable. The Collections renderer ignores
  toggles it does not consume; this is the existing renderer-side
  behavior and is not the modal's concern.

---

## Non-Functional Requirements

- **NFR-1 (Window-size invariant)** — `tests/settings/window-defaults.test.ts`
  must remain green. Neither `src/lib/settings.ts` `window.sizeW` /
  `window.sizeH` nor `src-tauri/src/lib.rs` window-launch hook is
  touched by this work. The invariant is preserved by construction.
- **NFR-2 (Atomic writes)** — All `_folder.md` writes (create, edit,
  migration) go through the Rust temp-file-swap atomic write pattern
  via `writeFile()` in `src/lib/bridge.ts`. A crash mid-write must
  leave either old or new file intact — never a partial.
- **NFR-3 (Bridge layer for Tauri calls)** — All Tauri calls go
  through `src/lib/bridge.ts` typed wrappers returning `FileResult<T>`.
  No raw `invoke()` in feature code.
- **NFR-4 (No TODO comments in source)** — Deferred work goes in
  `docs/specs/view-modal/00_index.md` under a "Deferred Work" section.
- **NFR-5 (Theme tokens only)** — All Unified View Modal CSS pulls
  from the canonical token catalog in `src/styles.css`. No new
  tokens. No hardcoded hex values. The modal reuses existing modal-
  chrome classes (`settings-overlay`, `settings-panel`, `settings-
  footer`, `sf-modal-*`, etc.) per `feedback_look_first` and
  `feedback_global_form_controls`.
- **NFR-6 (Performance — tab switch feels instant)** — Switching tabs
  in the modal (which swaps the static SVG illustration and updates
  the `layout:` slug to be emitted) MUST render the new state in <16ms
  on the dev machine. No async I/O on tab switch. The six SVG
  illustrations are bundled inline as TypeScript constants (same
  pattern as `folder-icons.ts` catalog SVGs). No file-system reads on
  tab switch.
- **NFR-7 (Modal mount perf)** — Opening the modal (from right-click
  or in-doc) must paint within 100ms on the dev machine. Modal DOM is
  constructed lazily on first open and cached for subsequent opens
  (existing pattern from current Insert CodeBlock modal).
- **NFR-8 (Plugin build rule)** — Any edit under
  `src/plugins/file-browser/**/*.ts` or `src/plugins/command-bar/**/*.ts`
  is followed by `npm run build:plugins && npm run sync:plugins`
  (CLAUDE.md).
- **NFR-9 (`_folder.md` excluded from vault index)** — Existing
  contract from folder-icon-assignment. `_folder.md` files do not
  appear in `.md`-equivalent enumeration. Unchanged.
- **NFR-10 (Codeblock parser reuse)** — The modal MUST reuse the
  existing `select` codefence YAML parser (located in
  `src/editor/select-widget.ts` or a sibling — Architect confirms).
  No parallel YAML parser. No `marked` re-instantiation. The same
  parser is used by:
  1. The folder-view renderer (FR-55 read path).
  2. The in-doc `select` codefence renderer.
  3. The modal's edit-mode prefill (if wired in Phase 1).

---

## Proposed Constraints

- **C-1 (One modal module)** — A single TypeScript module owns the
  Unified View Modal (Architect picks location; suggested
  `src/plugins/file-browser/view-modal/view-modal.ts` or extending
  `src/editor/select-widget.ts`). Both contexts (right-click and
  in-doc) call the same `openViewModal(mode, ctx)` entry point with
  different `mode` and `ctx` arguments.
- **C-2 (Reuse modal chrome)** — The modal reuses
  `settings-overlay` / `settings-panel` / `settings-footer` /
  `sf-modal-*` classes per `feedback_look_first`. No new modal-
  chrome class invented.
- **C-3 (Reuse `+ Add filter` flow)** — The Filter row's `+ Add
  filter` button opens the existing smart-filter-builder modal (see
  `reference_smart_filter_builder`). No edit to the builder; the
  modal is consumed verbatim.
- **C-4 (Reuse codeblock YAML parser)** — Per NFR-10. No parallel
  parser.
- **C-5 (Reuse `parseFolderMd()` machinery)** — Per FR-57. The
  parser is extended (or composed) to extract from a codeblock body
  in addition to frontmatter. No fork.
- **C-6 (No new Rust commands)** — All file I/O uses existing
  `readFile` / `writeFile` / `createDirectory` (if needed) typed
  bridge wrappers. No new Tauri commands.
- **C-7 (Reuse `attachFolderItemDrag` / Collections renderer)** — The
  Collection tab simply writes `layout: collection-home`. The
  Collections renderer is consumed unchanged.
- **C-8 (Theme tokens only)** — Per NFR-5.
- **C-9 (Plugin build rule)** — Per NFR-8.
- **C-10 (No regressions to Collections feature)** — The Collections
  refactor (shipped 2026-06-06) MUST continue to work without
  modification: subfolder-as-Stack rendering, drag-reorder, breadcrumb,
  inline editing, read-compat for legacy `type: collection`. The
  Unified View Modal is a new entry point that produces the same
  codeblock the existing display-options picker writes.

---

## Edge Case Inventory

Every Edge Case must have a corresponding failing test written BEFORE
its implementation step. Architect maps each EC to a test file in the
spec's `00_index.md`.

- **EC-1 (Right-click on empty folder → Create → folder renders)** —
  Right-click an empty folder, select "New Folder View", pick Cards,
  click Create. `_folder.md` is created with the codeblock shape (no
  frontmatter). The folder's tab opens with Cards layout. Path
  defaults to `./`.
- **EC-2 (Right-click on folder with existing `_folder.md`)** — Policy:
  **The modal opens in edit mode and prefills from the existing
  `_folder.md`.** No confirm dialog; submitting overwrites
  (atomically). Cancel discards changes. Rationale: matches the
  "least surprise" mental model — right-clicking the same folder
  again to tweak the view is the common case, not a refusal. Tests:
  prefill is correct from both codeblock shape and legacy frontmatter
  shape.
- **EC-3 (In-doc Insert at mid-line)** — Cursor in the middle of a
  text line. Modal opens, user picks Table, clicks Insert. The
  codefence is inserted preceded by a newline so the opening ```` ```
  starts on its own line. Cursor lands after the closing fence.
- **EC-4 (Path field empty on submit)** — User clears the Path
  field and clicks Create / Insert. Submit proceeds; the emitted
  codeblock has `path: ./` (the default substituted by the modal).
  Submit is NOT blocked. (No validation in the modal — see FR-17.)
- **EC-5 (Filter with multiple rules)** — User adds three filter
  rules via `+ Add filter`. The emitted codeblock contains the
  three rules under `filter:` in the same shape the existing Insert
  CodeBlock modal produces today. No new YAML schema.
- **EC-6 (Layout tab switch preserves config state)** — User enters
  Path `Projects/2026`, adds two filter rules, sets Sort to Name ↓,
  toggles "Show modified date" OFF, then switches from Cards tab to
  Table tab. All five pieces of config state (Path, both filter
  rules, Sort, the toggle position, Content Width) MUST remain
  intact. Switching back to Cards must show them unchanged.
- **EC-7 (Legacy `_folder.md` with frontmatter renders correctly)** —
  A `_folder.md` containing `---\nlayout: cards\npath: ./\n---` (and
  no codeblock body) opens and renders as a Cards folder view via the
  read-compat path (FR-55). No write occurs. Inspect file on disk
  post-open: unchanged.
- **EC-8 (Legacy `_folder.md` mutated → rewritten as codeblock)** —
  Same file as EC-7. User opens the Unified View Modal via right-
  click and clicks Create / Save. Post-write, the file contains a
  `select` codeblock with the chosen config; the YAML frontmatter
  folder-view-config keys are stripped. Atomic single write. If
  other frontmatter keys exist (e.g. `icon: book`), they are
  preserved.
- **EC-9 (`/sidebar` typed inside an existing code fence)** — The
  cursor is INSIDE an open ```` ``` ```` block (e.g. between a `select`
  fence's lines). The slash-menu should NOT fire (Markable's existing
  slash-command guard inhibits within-fence triggering — Architect
  confirms). If the user manually types `/sidebar` as plain text in
  a fence, no insertion happens; the text stays as literal `/sidebar`.
- **EC-10 (`/grid` followed by Esc cancels insertion)** — User types
  `/grid` to open the command suggestion, then presses Esc before
  confirming. Nothing is inserted. The literal `/grid` text the user
  typed is removed (existing slash-command convention — Architect
  confirms).
- **EC-11 (Modal Cancel discards all changes)** — In create mode,
  user picks Table, enters Path `Foo`, adds a filter rule, clicks
  Cancel. Nothing is written to disk. The folder remains without a
  `_folder.md` (or, if one existed, it is unchanged).
- **EC-12 (Modal triggered while another modal is open)** — Policy:
  **Refuse.** If any other modal is currently open (settings,
  smart-filter-builder, command bar, etc.), the Unified View Modal
  trigger is a no-op. The user closes the existing modal first.
  Rationale: stacking modals is a regression risk and doesn't have
  a clear use case here. Tests assert the no-op.
- **EC-13 (Window-size invariant)** — `tests/settings/window-defaults.test.ts`
  remains green. Neither `src/lib/settings.ts` nor `src-tauri/src/lib.rs`
  is touched by this work (per CLAUDE.md invariant).
- **EC-14 (Collection tab + subfolders > 0 still renders subfolders
  as Stack tiles)** — User picks Collection tab on a folder with
  three subfolders + two notes, clicks Create. The folder opens with
  the Collections layout: three Stack tiles for the subfolders + the
  two notes in a default in-folder Stack. No regression to the
  Collections feature (FR-81).
- **EC-15 (Theme-token usage — no hardcoded hex)** — Grep the new
  modal source + any new CSS for hex color literals (`#[0-9a-fA-F]{3,8}`).
  Zero matches expected. All color comes from canonical tokens in
  `src/styles.css`.
- **EC-16 (Codeblock with YAML errors → error UI in folder-view tab)** —
  A `_folder.md` body contains a `select` codeblock with malformed
  YAML (e.g. stray `:` mid-value). The folder-view renderer surfaces
  a user-readable error inside the tab (not a crash, not a silent
  fallback). Existing behavior — the renderer's error path already
  handles this for inline codeblocks. Confirm extension to `_folder.md`
  body source.
- **EC-17 (Default toggles ON in create mode)** — Open the modal in
  create mode. Inspect the DOM: all three toggle switches render in
  the ON position (per Q-2 / FR-31). Submit immediately: the emitted
  codeblock contains `showModifiedDate: true`,
  `showFileExtensions: true`, `includePreviewPane: true`.
- **EC-18 (Tab switch is instant — no async)** — Click each of the
  six tabs in sequence. Each click MUST paint within 16ms (per
  NFR-6). No spinners, no file reads, no debounce.
- **EC-19 (Migration preserves non-folder-view frontmatter keys)** —
  A `_folder.md` contains `---\nlayout: cards\nicon: book\n---` (icon
  is the folder-icon-assignment feature's key; not folder-view
  config). User opens the modal and saves a new layout. Post-write:
  file contains a `select` codeblock with the new config, AND the
  frontmatter is reduced to `---\nicon: book\n---` (the icon key
  survives, folder-view config is gone). No regression to folder-
  icon-assignment.
- **EC-20 (Migration of `type: collection` legacy folder)** — A
  `_folder.md` carrying `type: collection` (pre-2026-06-06 Collections
  shape) is opened, the user picks the Collection tab via the modal,
  and clicks Save. Post-write: `type: collection` is stripped,
  `layout: collection-home` is written inside the new `select`
  codeblock, and the file body contains the codeblock. The
  Collections renderer continues to dispatch on
  `layout: collection-home` correctly via FR-55 read order. Composes
  cleanly with the Collections refactor's read-compat shim in
  `store.ts`.
- **EC-21 (Submit then immediately re-open shows persisted state)** —
  User submits Create with Cards + Path `Projects/2026` + two filter
  rules + Sort Name ↓ + first toggle OFF + Content Width Wide. Re-
  open the modal on the same folder. All seven pieces of state are
  prefilled to match what was just saved (assuming edit-mode is
  wired in Phase 1; if deferred, this EC moves to Phase 2).

---

## Out of Scope (Phase 2 / Later)

- **Layouts flow redesign** — Hub Page, Media Gallery, Project Table,
  Simple Index, Notion-style full-page layouts, Wikipedia-style
  full-page layouts. These get their own modal and flow later. The
  four old templates are REMOVED from the right-click menu in this
  work (no longer accessible until Layouts ships).
- **Live preview in the preview area** — Phase 2 only. Phase 1
  ships static SVG illustrations per tab.
- **`/sidebar` and `/grid` configuration modals** — The slash
  commands insert empty stubs only. Any future config UI for sidebar
  or grid is separate work (DW-1).
- **Forced migration of legacy frontmatter** — No batch migrator,
  no force-migrate UI, no toast nudging migration. Read-compat is
  indefinite (Q-5 / FR-56).
- **PATH validation** — Vault-relative path resolution, missing-
  folder detection, error display are the renderer's job. The modal
  accepts whatever the user types (FR-17).
- **Expanded Sort options** — Modified / Created / Manual sort
  options are deferred. MVP ships Name ↑ / Name ↓ only (Q-3 / FR-25).
- **Cross-context paste of codeblock config** — Future "copy this
  folder's view config to another folder" / "paste into a codeblock"
  is out of scope.
- **Sub-options inside tabs** — e.g. Cards: large / small / compact.
  Mirror Bookshelf's existing sub-options. Deferred. MVP ships a
  flat tab strip with no per-tab sub-pills.
- **Edit-mode prefill from existing config** — If Architect determines
  edit-mode prefill (FR-11 trailing paragraph, EC-21) is heavier than
  Phase 1 budget allows, edit-mode may be deferred to a follow-up.
  Architect decides during step planning and documents.

---

## Files Expected to Change

(Architect to confirm exact paths and line numbers; this is the
working set.)

| File | Nature of change |
|---|---|
| `src/editor/select-widget.ts` (or sibling — Architect locates) | **EDIT** — repurpose the existing Insert CodeBlock modal as the canonical Unified View Modal. Restructure layout: big preview on top, tab strip, single config row. Remove the Select / Sidebar / Grid type chooser tabs at the top of the current modal. |
| `src/editor/select-builder.ts` (or wherever codefence YAML is composed) | **EDIT** — minor, possibly no change. Confirm the six tabs map to the right `layout:` slug strings on emit. |
| `src/plugins/file-browser/file-browser.plugin.ts` | **EDIT** — replace the existing right-click → "New Folder View" handler (which currently calls `openTemplatePicker(...)`) with a call to the unified `openViewModal("create", { folderPath })`. Delete the `openTemplatePicker` call site. |
| **DELETE** — `FOLDER_VIEW_TEMPLATES` array | **EDIT to `file-browser.plugin.ts`** — remove the entire `FOLDER_VIEW_TEMPLATES` constant and the four `*_SVG` preview constants (Hub Page, Media Gallery, Project Table, Simple Index). The Collection template entry I added earlier is also removed; Collections is now accessible exclusively via the tab strip in the unified modal. |
| `src/plugins/file-browser/folder-view/parser.ts` | **EDIT** — `parseFolderMd()` learns to extract YAML config from a `select` codeblock in the body. Returns the same `FolderViewConfig` shape regardless of source. Read-compat for legacy frontmatter shape is preserved. |
| `src/plugins/file-browser/folder-view/tab.ts` | **EDIT** — the layout-resolution path reads layout from the codeblock-derived config first, falls back to frontmatter. Architect confirms exact site (likely the same area as the Collections short-circuit removal). |
| `src/plugins/file-browser/collections/store.ts` | **EDIT** — `writeCollectionMeta()` / `writeStackMeta()` learn to write the codeblock shape rather than frontmatter. Read-compat keeps tolerating BOTH legacy frontmatter `layout: collection-home` AND legacy `type: collection`. Migration-on-write strips both legacy markers when rewriting. |
| `src/plugins/command-bar/command-bar.plugin.ts` (or wherever slash commands register) | **EDIT** — add `/sidebar` and `/grid` slash command registrations. Each inserts a minimal codefence stub at the cursor per FR-70 / FR-71. |
| `src/plugins/file-browser/view-modal/view-modal.ts` (or wherever Architect places the unified module) | **NEW** — the unified modal entry point if Architect chooses to split it out from `select-widget.ts`. |
| `src/plugins/file-browser/view-modal/preview-illustrations.ts` (or wherever Architect places SVG constants) | **NEW** — six static SVG illustrations (one per tab) as inline TypeScript constants. |
| `tests/view-modal/` (new directory) | **NEW** — test files covering every FR and EC. At minimum: `modal-mount.test.ts`, `tab-switch.test.ts`, `config-row.test.ts`, `submit-create.test.ts`, `submit-insert.test.ts`, `read-compat.test.ts`, `migration-on-write.test.ts`, `slash-commands.test.ts`. |
| `docs/specs/view-modal/00_index.md` | **NEW** — Architect's spec artifact. |
| `src/lib/settings.ts` | **NO CHANGE.** (Window invariant protected.) |
| `src-tauri/src/lib.rs` | **NO CHANGE.** (Window invariant protected.) |
| `src-tauri/src/commands/` | **NO CHANGE.** (No new Rust commands.) |
| `src/lib/bridge.ts` | **NO CHANGE.** (Uses existing `readFile`, `writeFile`.) |

---

## Verification (when implementation lands)

- `npm run test:run` — full suite green; the existing 4654+ baseline
  is maintained or grown.
- `npm run build` — TypeScript clean; bundle emitted.
- `npm run test:run -- tests/settings/window-defaults.test.ts` — window
  invariant intact (NFR-1, EC-13).
- `npm run test:run -- tests/collections/` — Collections suite remains
  green (no regressions to the Collections refactor).
- `npm run test:run -- tests/view-modal/` — every FR / EC has a passing
  test.
- `npm run build:plugins && npm run sync:plugins` — mandatory after any
  `src/plugins/**/*.ts` edit.
- **Manual scenarios:**
  - Right-click any folder → "New Folder View" → unified modal opens.
    Title bar reads "New Folder View". Pick Cards, leave defaults,
    click Create. `_folder.md` is created containing a `select`
    codeblock with `layout: cards`. The folder opens with Cards
    layout.
  - Same flow, pick Collection → folder opens with Collections layout
    (Stack panel rendering, subfolders as tiles, drag-reorder works).
  - In an existing `.md` file, trigger the codeblock insert → same
    modal opens. Title bar reads "Insert Codeblock". Pick Table, click
    Insert. `select` codefence inserted at cursor with `layout: table`.
    Rendered inline in the document.
  - Open an existing `_folder.md` with frontmatter (legacy shape from
    before this refactor) → still renders correctly via read-compat.
    Trigger any mutation via the modal → file is rewritten as
    codeblock shape atomically.
  - Type `/sidebar` in an `.md` body → empty sidebar codefence stub
    inserted at cursor. Type `/grid` → empty grid codefence stub
    inserted.
  - Confirm the old four templates (Hub Page, Media Gallery, Project
    Table, Simple Index) no longer appear in the right-click menu.
  - Switch tabs in the modal six times — each switch paints instantly,
    no visible delay, config state preserved.
  - Open the modal twice on the same folder (in edit mode, if wired in
    Phase 1) — second open prefills with what was just saved.
  - Cancel discards all changes. Esc closes the modal.
  - Try to trigger the modal while another modal is open — no-op
    (per EC-12).
  - Verify window size on launch is still 50% width × 80% height
    (centered). Run the regression test.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated (Auto-mode resolutions Q-1 … Q-5,
  2026-06-08)
- Edge cases to verify in tests: **21 items** in Edge Case Inventory
  (EC-1 … EC-21)
- Parked prior doc: `docs/requirements/collections_layout_refactor_completed.md`
  (status: archive, SUPERSEDED banner applied)
- Architect target: **CREATE NEW** spec at
  `docs/specs/view-modal/00_index.md` covering:
  - The unified modal module location + entry-point signature
  - Six SVG illustration constants
  - Codeblock YAML parser reuse path
  - `parseFolderMd()` extension for codeblock-body extraction
  - Migration-on-write composition with the existing Collections
    read-compat shim in `store.ts`
  - `/sidebar` and `/grid` slash command registrations
  - Step files for each phase (DELETE → EDIT → NEW → tests)
  - Test inventory mapping each EC to a test file

Next step: Activate `@software-architect` and provide
`docs/requirements/active_task.md` as context, targeting
`docs/specs/view-modal/00_index.md` as the artifact to CREATE.

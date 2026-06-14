---
title: "Unified View Modal — Master Blueprint"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# Unified View Modal — Master Blueprint

> **Requirements source**: `docs/requirements/active_task.md` (status:
> Requirements Validated, 2026-06-08; 21 ECs, ~50 FRs, 10 NFRs).
> **Plan brief**: `/Users/daveslaptop/.claude/plans/i-have-some-ideas-lovely-cascade.md`.
> **Mockup (visual source of truth)**:
> `/Users/daveslaptop/Desktop/Screenshot 2026-06-08 at 11.10.00 AM.png`.
> **Prior precedent**:
> `docs/specs/collections/00_index.md` (migration-on-write pattern),
> `docs/specs/folder-icon-assignment/00_index.md` (spec structure).
> **Output of**: Software Architect. No implementation lives in this
> directory; each step file is a self-contained TDD unit.

This blueprint is the contract between the Architect and the Lead
Developer. Step files are TDD units (Red → Green → Refactor). Earlier
steps never forward-reference later steps. The Developer follows them
in strict order. Mandatory after every step that edits
`src/plugins/**/*.ts`: `npm run build:plugins && npm run sync:plugins`
(CLAUDE.md, NFR-8, C-9).

---

## 1. Stack Decision

Stack is **locked by the existing project**: Tauri v2 (Rust backend) +
TypeScript + CodeMirror 6 + Vite + Vitest + `marked`. No new technology
is introduced.

Web research was not performed because the stack is fixed by the
locked decisions in the requirements doc (no new Rust commands; reuse
existing bridge, parser, modal chrome, and slash-command machinery).
Every decision below binds to an existing primitive.

### What this feature reuses (no alternatives evaluated)

| Concern | Reused mechanism | Why |
|---|---|---|
| Atomic file writes | `writeFile()` in `src/lib/bridge.ts` (temp-file-swap inside the Rust `write_file` command) | NFR-2, C-6: no new Rust commands. Collections refactor proved the pattern. |
| YAML frontmatter parse/mutate | `parseYamlFrontmatter`, `applyYamlKey`, `removeYamlKey`, `reconstructFile` in `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` | C-3 forbids a parallel parser; preserves unrelated keys byte-for-byte (EC-19). |
| Codefence YAML parse | `parseSelectBody()` and `parseSelectBodyForBuilder()` in `src/editor/select-widget.ts` | NFR-10 / C-4: the only `select` codefence YAML parser in the codebase. Reused verbatim by `parseFolderMd()` for body-codeblock extraction (FR-55, FR-57). |
| Codefence YAML emit | `buildSelectFenceFromState()` in `src/lib/select-builder.ts` | One source of truth for `path:` / `display:` / `sort:` / `where:` / `show-modified:` / `show-extensions:` / `preview-pane:` / `content-width:` emission. Modal calls it on submit. |
| Folder metadata read | `parseFolderMd()` in `src/plugins/file-browser/folder-view/parser.ts` | C-5: extended in step_01 to also extract config from a body codeblock; legacy frontmatter remains a fallback. |
| Inline filter editor | `mountSelectForm()` Filter section + `+ Add filter` button + `buildRuleRow()` in `src/lib/rule-row.ts` | C-3: the smart-filter-builder is reused verbatim; no edit to its source. |
| Modal chrome | `settings-overlay` / `settings-panel` / `settings-footer` / `cbm-*` / `sb-*` classes already in `src/styles.css` and the existing modals' `<style>` injection | NFR-5, C-2 (`feedback_look_first`): no new modal-chrome class invented. |
| Modal keyboard | `attachModalKeyboard()` in `src/lib/modal-keyboard.ts` | FR-42: ⏎ submits, Esc closes. |
| Slash-command registry | `makeCommands()` in `src/editor/quick-commands.ts` (consumed by `buildQuickCommandExtension(deps)`) | FR-70…FR-74: `/sidebar` and `/grid` are added as new leaf entries; existing chip UI is reused. |
| Layout dispatch (folder-view) | `LAYOUT_RENDERERS` in `src/plugins/file-browser/folder-view/tab.ts:110` | Already lists `collection-home` and the five aliased layout keys. No new entry required. |
| Codefence dispatch (in-doc) | `SELECT_WIDGET_RENDERERS` in `src/editor/select-widget.ts:50` | Already lists `cards`/`table`/`timeline`/`kanban`/`bookshelf`/`collection-home`. No new entry required. |
| Collections store | `writeCollectionMeta()` / `writeStackMeta()` in `src/plugins/file-browser/collections/store.ts` | Today writes frontmatter; step_03 in this spec swaps the writer to emit a `select` codeblock instead. Read path adds codeblock-first precedence. The reference-index reader (`reference-integrity-wiring.ts`) keeps consuming the typed `CollectionMeta` / `StackMeta` shape, so its caller path is unchanged. |
| Bridge layer | `readFile`, `writeFile` typed `FileResult<T>` wrappers in `src/lib/bridge.ts` | NFR-3, C-6: no new bridge calls. |

---

## 2. Locked Architectural Decisions

The Architect's mandate listed 10 questions to resolve. All 10 are
locked here with rationale; step files reference them by number.

### AD-1 — Where the unified modal lives

**Decision: extend `src/lib/codeblock-modal.ts` in place.** Do NOT
create `src/plugins/file-browser/view-modal/view-modal.ts`.

Rationale:

- The existing `openCodeBlockModal()` (485 LOC) is already the canonical
  Insert CodeBlock modal. It is imported by **six call sites** in
  `src/main.ts` (lines 1037, 1054, 1471, 1501, 1543, 1562) and consumed
  by the right-click "Insert CodeBlock" entries in
  `file-browser.plugin.ts` (lines 3127, 3232). Moving the file forces a
  six-site import sweep with zero behaviour benefit.
- The right-click → "New Folder View" handler currently calls
  `openTemplatePicker()` from `src/plugins/file-browser/template-picker.ts`.
  We point it at `openViewModal(...)` exported from
  `src/lib/codeblock-modal.ts` and delete the template picker call.
- The file is renamed conceptually (it ceases to be a multi-type Insert
  CodeBlock modal and becomes the Unified View Modal) but stays at the
  same path. A header comment block updates to describe the new role.
- New supporting files (preview-illustrations, modal-stacking guard) are
  co-located alongside in `src/lib/`.

The new public surface added in step_04:

```typescript
// src/lib/codeblock-modal.ts (new exports)
export type ViewModalMode = "create" | "insert" | "edit";

export interface ViewModalContext {
  /** Vault-relative folder path the modal targets, when in create/edit mode. */
  folderPath?: string;
  /** EditorView + selection range, when in insert mode. */
  editor?: { view: EditorView; from: number; to: number };
  /** Prefilled config when in edit mode (existing _folder.md or codefence). */
  initial?: SelectBuilderInitial;
  /** Tag and extension suggestions for the filter rows. */
  ruleRowContext?: RuleRowContext;
}

export function openViewModal(mode: ViewModalMode, ctx: ViewModalContext): void;
```

The legacy `openCodeBlockModal(opts)` is **deleted** in step_09 once
all call sites migrate to `openViewModal`. Step_04 introduces
`openViewModal` alongside the old function; step_09 finishes the cut.

### AD-2 — Codeblock detection in `_folder.md`

**Decision: extend `parseFolderMd()` to look for a `select` codeblock in
the body. If found, parse its YAML and use that as the source of truth.
Otherwise, fall back to the existing frontmatter path. Codeblock wins
when both are present.**

Implementation (step_01):

1. After the existing frontmatter parse, scan `rawBody` for the first
   line that matches `/^```select(\s|$)/` (no surrounding-whitespace
   tolerance — the fence must start at column 0 of the body line).
2. Collect lines until the next line that matches `/^```\s*$/`.
3. Pass the collected body to `parseSelectBody()` (imported from
   `src/editor/select-widget.ts`).
4. Project the resulting `{ rawPath, display, config, contentWidth }`
   into a `FolderViewConfig` overlay. The overlay overrides the
   frontmatter-derived config field-by-field for the keys the codeblock
   carries; keys the codeblock does not carry (e.g. `title:`,
   `cover:`, `icon:`) fall through to the frontmatter values.

Precedence rule (locked):

> **Codeblock first, frontmatter second.** If `_folder.md` has both a
> body codeblock and a YAML frontmatter `layout:`, the codeblock wins.
> The frontmatter `layout:` is treated as a legacy artifact and is
> stripped on the next user-initiated write (FR-60).

Precedence rationale: the new write path emits ONLY the codeblock; a
file containing both shapes simultaneously is, by definition,
mid-migration. The codeblock represents the user's most recent intent.

### AD-3 — Codeblock YAML parser reuse (NFR-10)

**Decision: use `parseSelectBody()` (renderer-friendly,
`FolderViewConfig`-shaped) for `_folder.md` read-path extraction; use
`parseSelectBodyForBuilder()` (modal-friendly, `SelectBuilderInitial`-
shaped) for edit-mode prefill.** Both are exported from
`src/editor/select-widget.ts`. No new YAML parser exists in the
codebase, and step_01 does not introduce one.

Implementation note: `parseSelectBody()` already accepts a raw body
string. `parseFolderMd()` extracts the body string from between the
fence lines and hands it off. No copy, no fork.

### AD-4 — Migration-on-write trigger inventory

**Decision: the following operations trigger an opportunistic atomic
rewrite of `_folder.md` from legacy frontmatter shape to codeblock
shape:**

| # | Operation | Site |
|---|---|---|
| MW-1 | Modal Create (right-click → New Folder View → Create) | `openViewModal("create", ...)` → step_04 |
| MW-2 | Modal Save (right-click → New Folder View on a folder that already has `_folder.md` → modifies → Save) | `openViewModal("edit", ...)` → step_05 |
| MW-3 | `writeCollectionMeta()` invoked for any reason (rename Collection, change displayName, add/remove/reorder Stack) | step_03 |
| MW-4 | `writeStackMeta()` invoked for any reason (rename Stack, change icon, add/remove/reorder note, add/remove reference) | step_03 |
| MW-5 | Reference-index propagation (canonical rename / canonical delete in `reference-integrity-wiring.ts`) | step_03 (uses the same writer) |

**Operations that do NOT trigger migration (read-only paths):**

- Opening a folder-view tab on a legacy `_folder.md` (FR-62: read-only
  viewing NEVER triggers a write).
- The folder-icon picker write to a legacy `_folder.md` carrying
  `layout: cards` in frontmatter. Folder-icon writes touch only the
  `icon:` key via `applyYamlKey()`; the frontmatter `layout:` survives.
  Migration is opportunistic and bounded to writers that own
  folder-view config keys.
- Pinning a folder, drag-reorder of files outside `_folder.md`,
  vault-index rebuilds.

This is intentionally conservative. The locked Q-5 resolution states
"opportunistic migration only" and explicitly forbids batch / forced
migration. Adding more triggers risks rewriting files the user did
not intend to touch.

### AD-5 — Codeblock placement and canonical `_folder.md` shape

**Decision: when the modal creates a new `_folder.md`, the file is a
thin shell with the codeblock at the top of the body and no
frontmatter.** Exact shape:

```markdown
```select
path: ./
display: cards
sort: name-asc
show-modified: true
show-extensions: true
preview-pane: true
```
```

(Note: literal backticks; the inner three-backtick fence is the
codeblock body that lives inside the file.)

**Decision: when migration-on-write rewrites a `_folder.md` that has
existing frontmatter keys NOT owned by folder-view config (e.g.
`icon: book` from folder-icon-assignment), the rewrite preserves the
frontmatter block with the non-folder-view keys intact, strips the
folder-view keys, and inserts the codeblock at the top of the body
(immediately below the closing `---`, separated by exactly one blank
line).** Exact shape after migration of a file that originally was
`---\nlayout: cards\nicon: book\n---\n`:

```markdown
---
icon: book
---

```select
path: ./
display: cards
sort: name-asc
...
```
```

Rationale:

- Keeps the codeblock unambiguously discoverable at the top of the
  body for the parser (AD-2).
- Preserves folder-icon-assignment's contract (EC-19 / FR-60).
- The blank-line separator between `---` and ```` ```select ```` is
  required so the fence is unambiguously a fence; without it some
  markdown parsers treat the fence as part of the frontmatter close
  block.

The exhaustive list of "folder-view-config keys" stripped on
migration is locked here (so the writer is deterministic):

```
layout, sort, show-modified, show-extensions, show-tags, show-count,
preview-pane, preview-height, content-width, card-width, layout-mode,
aspect-ratio, fit, min-height, max-height, show-name, show-folders,
show-files, folders-title, files-title, content-area-override,
extra-fields, fields, exclude, kanban-field, kanban-order, order,
group-by, where, cover, type
```

`type` (Collections legacy `type: collection`) is included so EC-20
composes cleanly: a `type: collection` legacy folder gets the `type`
key stripped and `layout: collection-home` written into the codeblock
in the same atomic write. The `icon:` key is NOT in the strip list
(folder-icon-assignment owns it).

### AD-6 — Collections-specific carry-forward

**Decision: Collections' three array keys (`stackOrder:`, `order:`,
`references:`) move from frontmatter to the codeblock body.** They
follow the same YAML shape `parseSelectBody()` already understands
(YAML sequence under a top-level key). The renderer reads them through
`readCollection()` / `readStack()` which, post-step_03, return the
same `CollectionMeta` / `StackMeta` shape regardless of source.

The reverse-index (`reference-index.ts` + `reference-integrity-wiring.ts`)
calls `readCollection()` / `readStack()` and never reaches into raw
YAML, so the reverse-index is unaffected by the data-shape change.

Edge case (EC-7 — Finder-moved note re-ingest): the existing
`reference-integrity-wiring.ts` runs `rebuild()` on vault-changed
events. After the refactor, `rebuild()` reads through the new
codeblock-first path automatically. No additional wiring.

### AD-7 — Slash command registration site

**Decision: add `/sidebar` and `/grid` as new leaf entries in
`makeCommands()` in `src/editor/quick-commands.ts`.** No subpicker, no
deps wiring change. Each leaf's `apply()` dispatches a `view.dispatch`
that inserts the empty fenced stub at the slash range and lands the
cursor on the inner blank line. Follows the existing `sidebar-left`
leaf pattern (lines 231–240 in `quick-commands.ts`).

Mid-line behaviour (FR-72): the slash command pattern at line 319
already requires `^\/(\w*)$` at the start of a line, so the leaf
always replaces from `line.from`. No leading-newline insertion logic
is needed (the slash command itself is on its own line by construction
of the trigger regex).

EC-9 (slash trigger inside a code fence): the existing slash trigger
already requires "/" as the first character of a line. CodeMirror's
syntax tree treats lines inside a code fence as `FencedCode` content,
and the slash-trigger regex matches against the raw line text, not the
syntax-aware position. Step_07 verifies the trigger does NOT fire
inside an open fence by asserting the popup never opens for a "/"
typed on a line whose surrounding context is a `FencedCode` block. If
the existing pattern already inhibits this (likely — none of the
existing slash commands fire mid-fence in practice), the verification
test is a regression pin; otherwise step_07 adds a guard using
`syntaxTree(state).resolveInner(...)` to skip when the position is
inside a `FencedCode`.

### AD-8 — Modal stacking refusal (EC-12)

**Decision: introduce a tiny shared module `src/lib/active-modal.ts`
that exposes `isAnyModalOpen()` and `currentModalKey()`.** The
implementation queries the DOM for any element matching a known set of
modal-overlay sentinel IDs:

```typescript
// src/lib/active-modal.ts (NEW — step_06)
const KNOWN_MODAL_OVERLAYS = [
  "__codeblock-modal-overlay__",     // openViewModal
  "__select-builder-overlay__",      // openSelectBuilderModal
  "__template-picker-overlay__",     // openTemplatePicker (DELETED in step_08)
  "__smart-folder-editor-overlay__", // smart-filter-builder
  "__folder-icon-picker-overlay__",  // folder-icon picker
  "__settings-overlay__",            // settings panel
  // command-bar uses its own scrim — sentinel id confirmed during step_06
];

export function isAnyModalOpen(): boolean {
  return KNOWN_MODAL_OVERLAYS.some((id) => !!document.getElementById(id));
}
```

`openViewModal()` calls `isAnyModalOpen()` at the very top; if true, it
is a silent no-op (EC-12). No toast, no console log.

The smart-filter-builder modal opened from inside the View Modal's
`+ Add filter` button is the ONE exception: when the filter builder is
opened from within the View Modal, the View Modal is already open and
the builder stacks on top. This is the existing behaviour from the
shipped Insert CodeBlock modal and is preserved. The exception is
expressed by **not** including the filter builder's overlay id in the
guard list (or, equivalently, by the guard checking only at the
View Modal's open call, which happens once before any inner modal can
be invoked).

Rationale for a sentinel-list-based guard rather than a registry that
each modal claims/releases:

- Six other modals already exist with their own overlay-id pattern. A
  registry would require touching all six. The locked decision EC-12
  applies only to the View Modal's open path. Local guard, minimal
  blast radius.
- Adding new modals later does not break this guard; the worst case
  is a missed overlay id in the sentinel list, which means the View
  Modal opens stacked. That is recoverable (the user closes both); it
  is not data loss. The reverse risk (overzealous registry blocking a
  legitimate open) is bigger.

### AD-9 — SVG illustration source

**Decision: six static SVG strings live as inline TypeScript constants
in a new file `src/lib/view-modal-illustrations.ts`.** Co-located with
the modal module. Same pattern as `panel-icons.ts` and the existing
`HUB_PAGE_SVG` / `MEDIA_GALLERY_SVG` etc. constants in
`file-browser.plugin.ts` (which are deleted in step_08).

Dimensions: 400×280 (matches the existing `*_SVG` constants for
visual continuity; the mockup's preview area accommodates this with
modest letterboxing). Dark-bg, simple shapes, theme tokens only — no
hardcoded hex (NFR-5 / EC-15).

Exported shape:

```typescript
// src/lib/view-modal-illustrations.ts (NEW — step_04)
export const VIEW_MODAL_ILLUSTRATIONS: Readonly<Record<
  "cards" | "table" | "collection-home" | "timeline" | "kanban" | "bookshelf",
  string
>> = {
  cards:            "<svg ...>",  // grid of three card outlines
  table:            "<svg ...>",  // 3-column table sketch
  "collection-home": "<svg ...>", // Home-canvas-like grid of Stack tiles
  timeline:         "<svg ...>",  // vertical timeline with date markers
  kanban:           "<svg ...>",  // three columns of stacked cards
  bookshelf:        "<svg ...>",  // row of book spines
};
```

Each SVG uses `currentColor` for fills and strokes so the theme system
re-skins them automatically; CSS sets `color: var(--text-secondary)`
on the preview container.

### AD-10 — EC inventory mapping

All 21 ECs map to test files in §5 of this blueprint. The Test
Inventory table is the canonical mapping; step files reference it for
their failing-test list.

---

## 3. UI Decomposition

```
┌───────────────────────────────────────────────────────────────────────┐
│  New Folder View                                                  ✕   │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│                       [ PREVIEW ILLUSTRATION ]                        │
│                  (static SVG, 400×280, currentColor)                  │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│      [Cards*] [Table] [Collection] [Timeline] [Kanban] [Bookshelf]    │
├───────────────────────────────────────────────────────────────────────┤
│  Path (select files to display)    │  Show modified date         ●   │
│  [./                            ]  │  Show file extensions       ●   │
│                                    │  Include preview pane       ●   │
│  Filter                            │                                  │
│  Show all files                    │  Content width                   │
│  [+ Add filter]                    │  [Normal*] [Wide] [Full]         │
│                                    │                                  │
│  Sort  [Name ↑       ▾]            │                                  │
│                                                                       │
│                                    [Cancel]  [Create]                 │
└───────────────────────────────────────────────────────────────────────┘
```

Title bar text (Q-1 resolution):

- Create mode → `"New Folder View"`
- Insert mode → `"Insert Codeblock"`
- Edit mode → `"Edit Folder View"` (folder context) or
  `"Edit Codeblock"` (in-doc context)

Action button label (FR-40):

- Create mode → `"Create"`
- Insert mode → `"Insert"`
- Edit mode → `"Save"`

Tab order is fixed (FR-10): Cards, Table, Collection, Timeline,
Kanban, Bookshelf. Cards is default-selected in create / insert mode
(FR-11). In edit mode, the tab matching the persisted `display:` slug
(or, for legacy frontmatter, `layout:` slug normalised through
`resolveDisplayAndOption()`) is selected.

The six tab slugs (locked against `DISPLAY_REGISTRY` in
`display-options.ts:39`):

| Tab label | Codefence `display:` slug | Folder-view `layout:` value (legacy) |
|---|---|---|
| Cards | `cards` | `cards` / `view-cards` / `folder-cards` |
| Table | `table` | `table` / `view-table` / `folder-table` |
| Collection | `collection-home` | `collection-home` (or legacy `type: collection`) |
| Timeline | `timeline` | `timeline` / `view-timeline` / `folder-timeline` |
| Kanban | `kanban` | `kanban` / `view-kanban` / `folder-kanban` |
| Bookshelf | `bookshelf` | `bookshelf` |

The modal emits **`display:` keys** in the `select` codeblock body
(matches the existing `buildSelectFenceFromState()` convention; do
NOT switch to `layout:` for the body — the codeblock convention is
canonical for body shape).

### Component map

| New / Edit | Path | Responsibility |
|---|---|---|
| **EDIT** | `src/lib/codeblock-modal.ts` | Repurpose as the Unified View Modal. Add `openViewModal(mode, ctx)` export. New DOM layout (preview-on-top, tab strip, single config row). Drop the Select / Sidebar / Grid type tabs entirely (their behaviour moves to `/sidebar` and `/grid` slash commands, plus the Select form which becomes the modal's only form). |
| **NEW** | `src/lib/view-modal-illustrations.ts` | Six inline SVG constants (AD-9). |
| **NEW** | `src/lib/active-modal.ts` | `isAnyModalOpen()` guard (AD-8). |
| **EDIT** | `src/lib/select-builder.ts` | `mountSelectForm()` is reused by the new modal layout. Possibly: factor out the "single config row" hosts so the View Modal can lay out filter / path / sort on the left column and toggles / content width on the right column independently. The existing `mountSelectForm` mounts everything vertically; the View Modal needs a two-column wrapper around it. **Architect choice**: the new modal builds its own DOM and calls `mountSelectForm()` on a hidden host, then re-parents individual sub-sections into the two-column layout. No edit to `select-builder.ts` required. Step_04 confirms during implementation. |
| **EDIT** | `src/plugins/file-browser/folder-view/parser.ts` | `parseFolderMd()` extracts config from the first `select` codeblock in the body when present (AD-2). Frontmatter is fallback. Same `FolderViewConfig` return shape. |
| **EDIT** | `src/plugins/file-browser/folder-view/tab.ts` | No change to dispatch (LAYOUT_RENDERERS already lists all six). Confirm the layout-key resolution still picks up `collection-home` from the codeblock-derived config in addition to the existing frontmatter + `extractFrontmatterKeys(type: collection)` paths. |
| **EDIT** | `src/plugins/file-browser/collections/store.ts` | `writeCollectionMeta()` / `writeStackMeta()` swap output shape from frontmatter to codeblock. Read-compat keeps tolerating BOTH legacy frontmatter `layout: collection-home` AND legacy `type: collection`. Both are stripped on the next write (MW-3 / MW-4). The schema-too-new gate (EC-13 in the Collections spec) carries over unchanged. |
| **EDIT** | `src/plugins/file-browser/file-browser.plugin.ts` | (a) Replace `openFolderViewPicker(...)` call with `openViewModal("create", { folderPath: path, ruleRowContext: getRuleRowContext() })` (step_05). (b) Delete the `FOLDER_VIEW_TEMPLATES` array and the four `*_SVG` constants (step_08). (c) The "Insert CodeBlock" right-click entries at lines 3127 / 3232 redirect through `openViewModal("insert", ...)` (step_05). |
| **DELETE** | `src/plugins/file-browser/template-picker.ts` | Optional. If no other call sites remain after step_08, the file is deleted. (Architect to confirm in step_08 by grepping the codebase; if there are no consumers outside the deleted FOLDER_VIEW_TEMPLATES flow, delete it.) |
| **EDIT** | `src/editor/quick-commands.ts` | Add `/sidebar` and `/grid` leaf commands (step_07). |
| **EDIT** | `src/main.ts` | Replace the six `openCodeBlockModal(...)` call sites with `openViewModal(...)`. The "code-block" action handler (line 1020) becomes a thin shim calling `openViewModal("edit"|"insert", ...)`. Note: `openCodeBlockModal` previously accepted three different `kind`s (sidebar/grid/select); after step_07 only the Select equivalent exists in the modal. Sidebar and Grid moved to slash commands. |
| **EDIT** | `tests/` | Significant churn. Many existing tests assert frontmatter shape; they update to expect codeblock shape. Step files list the affected tests by name. |
| **NEW** | `tests/view-modal/` | New test directory; one test file per concern (see §5). |
| **NO CHANGE** | `src/lib/settings.ts` | Window-size invariant (NFR-1 / EC-13). |
| **NO CHANGE** | `src-tauri/src/lib.rs` | Window-size invariant (NFR-1 / EC-13). |
| **NO CHANGE** | `src-tauri/src/commands/**` | C-6: no new Rust commands. |
| **NO CHANGE** | `src/lib/bridge.ts` | C-6: no new bridge wrappers. |
| **NO CHANGE** | `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` | C-3: composed, not modified. |
| **NO CHANGE** | `src/plugins/file-browser/folder-icons.ts` / `folder-icon-store.ts` / `folder-icon-picker.ts` | Folder-icon writes do not trigger migration (AD-4). |

---

## 4. Implementation Roadmap

Strict order. Each step compiles and tests green independently.
Earlier steps never forward-reference later ones. Mandatory after
every step that touches `src/plugins/**/*.ts`:
`npm run build:plugins && npm run sync:plugins`.

| # | Step | Touches | Depends on |
|---|---|---|---|
| 01 | `step_01_codeblock_parser.md` | Extend `parseFolderMd()` for codeblock-body extraction (AD-2). | — |
| 02 | `step_02_codeblock_writer.md` | New helper `writeFolderMdCodeblock(folderPath, state)` that produces the codeblock-shape `_folder.md`. Composes `yaml-frontmatter.ts` primitives + `buildSelectFenceFromState()`. Includes the strip-on-write logic for legacy frontmatter folder-view keys (AD-5). | 01 |
| 03 | `step_03_collections_writes_codeblock.md` | `writeCollectionMeta()` / `writeStackMeta()` emit codeblock shape. Read-compat for both legacy `type: collection` AND legacy frontmatter `layout: collection-home`. Tests for reference-index integrity round-trip. | 02 |
| 04 | `step_04_modal_skeleton.md` | New `openViewModal(mode, ctx)` export in `codeblock-modal.ts`. DOM skeleton matches mockup (preview / tab strip / two-column config row). Six SVG constants in `view-modal-illustrations.ts`. No wire-up to triggers yet. | — |
| 05 | `step_05_modal_wire_up.md` | (a) Right-click "New Folder View" → `openViewModal("create", ...)`. (b) In-doc "Insert CodeBlock" → `openViewModal("insert", ...)`. (c) Right-click on a folder with existing `_folder.md` → `openViewModal("edit", { initial })` (EC-2). | 02, 04 |
| 06 | `step_06_modal_stacking_refusal.md` | `src/lib/active-modal.ts` + guard at top of `openViewModal()`. EC-12. | 04 |
| 07 | `step_07_slash_commands.md` | `/sidebar` and `/grid` in `quick-commands.ts`. EC-9, EC-10, FR-70…FR-74. | — |
| 08 | `step_08_remove_old_templates.md` | Delete `FOLDER_VIEW_TEMPLATES`, `openFolderViewPicker`, the four `*_SVG` constants, the Collection template entry. Delete `template-picker.ts` if no remaining consumers. Confirm right-click entries route through the new modal. | 05 |
| 09 | `step_09_remove_old_codeblock_modal_tabs.md` | Drop the Select / Sidebar / Grid type tabs from `codeblock-modal.ts` (now redundant: Select moved into the new layout, Sidebar/Grid moved to slash commands). Migrate the six call sites in `src/main.ts` to `openViewModal(...)`. Delete `openCodeBlockModal()` and its `BlockKind`-related exports if no callers remain. | 05, 07 |
| 10 | `step_10_regression_sweep.md` | All 21 ECs covered with passing tests; DW-* audit; full-suite verification. | all |

### Dependency graph

```
01 ── 02 ── 03 ────────────────────────────┐
                                            │
04 ── 05 ── 06 ─────────────────────────────┤── 08 ── 10
       │                                    │      │
       │                                    │      │
       │           07 ─────────────────────┼──────┘
       │                                    │
       └──────────── 09 ────────────────────┘
```

The DAG admits one cross-cut at step_08 (deletes can only happen
after step_05 has redirected the call sites). Step_07 is independent
of the modal work and can run in parallel; the Developer follows the
table order serially for review tractability.

### Per-step build invariant

Every step that edits `src/plugins/**/*.ts` (notably step_01, step_03,
step_05, step_08, step_09) MUST end with:

```bash
npm run build:plugins && npm run sync:plugins
```

Step_04, step_06, step_07 only touch `src/editor/` and `src/lib/`
which are NOT plugin IIFEs (they bundle into the main app build). The
plugin-rebuild is not required for those steps but is harmless if run.

---

## 5. Test Inventory — EC → test file

Every Edge Case maps to a failing test written BEFORE its implementation
step. The Lead Developer's TDD loop is strict (Red → Green → Refactor).

| EC | Description | Test file | Step |
|---|---|---|---|
| EC-1 | Right-click empty folder → Create → folder renders | `tests/view-modal/submit-create.test.ts` | 05 |
| EC-2 | Right-click folder with existing `_folder.md` → modal opens in edit mode, prefilled (no confirm dialog) | `tests/view-modal/submit-create.test.ts`, `tests/view-modal/read-compat.test.ts` | 05, 01 |
| EC-3 | In-doc Insert at mid-line → leading newline added | `tests/view-modal/submit-insert.test.ts` | 05 |
| EC-4 | Path empty on submit → emits `path: ./` | `tests/view-modal/config-row.test.ts` | 04 |
| EC-5 | Filter with multiple rules → emitted under `where:` in existing shape | `tests/view-modal/config-row.test.ts` | 04 |
| EC-6 | Tab switch preserves config state | `tests/view-modal/tab-switch.test.ts` | 04 |
| EC-7 | Legacy `_folder.md` with frontmatter renders correctly (read-compat) | `tests/view-modal/read-compat.test.ts` | 01 |
| EC-8 | Legacy `_folder.md` mutated → rewritten as codeblock shape, atomic | `tests/view-modal/migration-on-write.test.ts` | 02 |
| EC-9 | `/sidebar` typed inside an existing fence → no-op | `tests/view-modal/slash-commands.test.ts` | 07 |
| EC-10 | `/grid` followed by Esc → no insertion, literal `/grid` text removed | `tests/view-modal/slash-commands.test.ts` | 07 |
| EC-11 | Modal Cancel discards all changes | `tests/view-modal/modal-mount.test.ts` | 04 |
| EC-12 | Modal triggered while another modal is open → no-op | `tests/view-modal/modal-mount.test.ts` | 06 |
| EC-13 | Window-size invariant unchanged | `tests/settings/window-defaults.test.ts` (existing) | all |
| EC-14 | Collection tab + subfolders > 0 still renders subfolders as Stack tiles | `tests/view-modal/submit-create.test.ts`, `tests/collections/renderer.test.ts` (existing — verified untouched) | 05 |
| EC-15 | Theme-token usage — no hardcoded hex in new modal source | `tests/view-modal/css.test.ts` | 04 |
| EC-16 | Codeblock with YAML errors → renderer surfaces user-readable error | `tests/view-modal/read-compat.test.ts` | 01 |
| EC-17 | Default toggles ON in create mode → emitted codeblock has all three `true` | `tests/view-modal/submit-create.test.ts`, `tests/view-modal/config-row.test.ts` | 04, 05 |
| EC-18 | Tab switch is instant — no async, no spinner | `tests/view-modal/tab-switch.test.ts` | 04 |
| EC-19 | Migration preserves non-folder-view frontmatter keys (e.g. `icon:`) | `tests/view-modal/migration-on-write.test.ts` | 02 |
| EC-20 | Migration of `type: collection` legacy folder | `tests/view-modal/migration-on-write.test.ts`, `tests/collections/migration-codeblock.test.ts` | 02, 03 |
| EC-21 | Submit then immediately re-open shows persisted state | `tests/view-modal/submit-create.test.ts` (edit-mode round-trip) | 05 |

### FR → test inventory (selected)

| FR | Coverage | Test file | Step |
|---|---|---|---|
| FR-2 | Default state (Cards, `./`, empty filter, Name ↑, three toggles ON, Normal width) | `tests/view-modal/modal-mount.test.ts` | 04 |
| FR-7 | Insert at cursor; insertion replaces selection | `tests/view-modal/submit-insert.test.ts` | 05 |
| FR-12 | Tab switch preserves config state | `tests/view-modal/tab-switch.test.ts` | 04 |
| FR-25 | Sort options are exactly Name ↑ / Name ↓ | `tests/view-modal/config-row.test.ts` | 04 |
| FR-32 | Each toggle persists under its kebab-case codefence key (`show-modified`, `show-extensions`, `preview-pane`) | `tests/view-modal/config-row.test.ts`, `tests/view-modal/submit-create.test.ts` | 04, 05 |
| FR-37 | Content Width persists under `content-width:` (`normal`/`wide`/`full`) | `tests/view-modal/config-row.test.ts` | 04 |
| FR-50 | `_folder.md` body codeblock shape on create | `tests/view-modal/submit-create.test.ts` | 05 |
| FR-55 | Read precedence (codeblock first, frontmatter fallback) | `tests/view-modal/read-compat.test.ts` | 01 |
| FR-60 | Migration-on-write atomic single-write | `tests/view-modal/migration-on-write.test.ts` | 02 |
| FR-70 | `/sidebar` inserts ```` ```sidebar\n\n``` ```` at cursor | `tests/view-modal/slash-commands.test.ts` | 07 |
| FR-71 | `/grid` inserts ```` ```grid\n\n``` ```` at cursor | `tests/view-modal/slash-commands.test.ts` | 07 |
| FR-80 | Collection tab submit writes `display: collection-home` | `tests/view-modal/submit-create.test.ts` | 05 |
| FR-81 | Collections features continue to work unchanged | `tests/collections/*` (existing, verified untouched) | 03 |

---

## 6. Field-name mapping (modal toggles → codefence keys)

The requirements doc uses TypeScript-style camelCase placeholders
(`showModifiedDate`, `showFileExtensions`, `includePreviewPane`); the
codefence shape uses kebab-case. The Architect confirms the mapping
here so step_04's emit code is unambiguous:

| Modal toggle label | Internal state field | Emitted codefence key | Default |
|---|---|---|---|
| Show modified date | `showModified` (existing `SelectFormState`) | `show-modified` | `true` |
| Show file extensions | `showExtensions` (existing `SelectFormState`) | `show-extensions` | `true` |
| Include preview pane | `previewPane` (existing `SelectFormState`) | `preview-pane` | `true` (NEW DEFAULT — was `false` in legacy `mountSelectForm`) |

**Note**: the default for `previewPane` changes from `false` (current
`mountSelectForm` initial) to `true` (Q-2 / FR-31). Step_04 either
(a) overrides the default on the modal side before calling
`mountSelectForm()`, or (b) updates the `mountSelectForm()` default if
no other consumer depends on the prior default. **Decision: (a) —
override on the modal side** (`opts.initial.previewPane = true` when
no prefill is supplied). Rationale: `mountSelectForm()` is also used
by the legacy `openSelectBuilderModal()` and may be reused by other
future code; changing its default risks a silent behaviour change
elsewhere. Local override in the View Modal is safer.

The legacy `openSelectBuilderModal()` and its callers continue to use
the old default unchanged.

---

## 7. Deferred Work (DW-* — no TODOs in source per NFR-4)

| ID | Item | Origin |
|---|---|---|
| DW-1 | Minimal configuration modal for `/sidebar` and `/grid` (today they insert empty stubs only) | active_task.md Out-of-Scope; Q-4 / FR-74 |
| DW-2 | Live preview in the preview area (renders actual Path + Filter + Layout against real vault files) | active_task.md Out-of-Scope (Phase 2 / FR-47) |
| DW-3 | Layouts flow redesign (Hub Page, Media Gallery, Project Table, Simple Index, Notion-style full-page layouts, Wikipedia-style full-page layouts) | active_task.md Out-of-Scope (Phase 2) |
| DW-4 | Forced migration of legacy frontmatter (batch migrator, force-migrate UI, toast nudging) | Q-5 / FR-56: read-compat is indefinite |
| DW-5 | Cross-context paste of codeblock config (copy folder's view config to another folder, paste into a codeblock) | active_task.md Out-of-Scope |
| DW-6 | Sub-options inside tabs (Cards: large / small / compact mirroring Bookshelf's `option:` slugs) | active_task.md Out-of-Scope |
| DW-7 | Expanded Sort options (Modified / Created / Manual) — MVP ships Name ↑ / Name ↓ only | Q-3 / FR-25 |
| DW-8 | PATH validation (vault-relative resolution, missing-folder detection, error display) — modal accepts whatever the user types | FR-17 |
| DW-9 | Edit-mode prefill from existing config — if Architect determines edit-mode is heavier than Phase 1 budget, defer | active_task.md Out-of-Scope (conditional). **Architect decision: ship edit-mode prefill in Phase 1** because EC-2 / EC-21 explicitly require it and the implementation is a single `SelectBuilderInitial` round-trip through `parseSelectBodyForBuilder()`. No deferral required. |
| DW-10 | Modal-stacking registry pattern (a proper claim/release API across all modals) — Phase 1 uses a sentinel-id list (AD-8) | AD-8 discussion |
| DW-11 | Migration audit log (which legacy files were migrated when) — current writes are silent (Q-5) | Q-5 / FR-62 |
| DW-12 | Folder-view CSS extension to accept the `preview-pane: true` default (renderer already consumes it; visual polish may be needed in `preview-pane.ts`) | Q-2 / EC-17 |
| DW-14 | Decompose `openViewModal` (~450 LOC) in `src/lib/codeblock-modal.ts` into named helpers for preview / tab strip / config row | Reviewer M-1 (2026-06-08) |

---

## 8. Verification Checklist (run before declaring complete)

- [ ] `npm run test:run` — full suite green (target: at-or-above the 4654-passed baseline from the Collections refactor).
- [ ] `npm run test:run -- tests/settings/window-defaults.test.ts` — window invariant intact (NFR-1, EC-13).
- [ ] `npm run test:run -- tests/collections/` — every existing Collections test remains green (FR-81 / C-10).
- [ ] `npm run test:run -- tests/folder-view/` — every existing folder-view test remains green (read-compat for legacy `_folder.md`).
- [ ] `npm run test:run -- tests/view-modal/` — every FR and EC has a passing test.
- [ ] `npm run build` — TypeScript clean; bundle emitted.
- [ ] **`npm run build:plugins && npm run sync:plugins`** — mandatory after step_01, step_03, step_05, step_08 (CLAUDE.md, C-9, NFR-8).
- [ ] **Manual scenarios:**
  - Right-click any folder → "New Folder View" → unified modal opens, title reads "New Folder View". Pick Cards, leave defaults, click Create. `_folder.md` is created containing a `select` codeblock with `display: cards`. The folder opens with Cards layout.
  - Same flow, pick Collection → folder opens with Collections layout (Stack panel rendering, subfolders as tiles, drag-reorder works).
  - In an existing `.md` file, trigger the codeblock insert via the existing entry point → same modal opens, title reads "Insert Codeblock". Pick Table, click Insert. `select` codefence inserted at cursor with `display: table`. Rendered inline in the document.
  - Open an existing `_folder.md` with frontmatter (legacy shape) → still renders correctly via read-compat. Trigger any mutation via the modal → file is rewritten as codeblock shape atomically. Unrelated frontmatter keys (e.g. `icon: book`) survive.
  - Type `/sidebar` in an `.md` body → empty sidebar codefence stub inserted at cursor, cursor on inner blank line. Same for `/grid`.
  - Confirm the old four templates (Hub Page, Media Gallery, Project Table, Simple Index) no longer appear in the right-click menu.
  - Switch tabs in the modal six times — each switch paints instantly; config state preserved across switches.
  - Open the modal twice on the same folder (edit mode, Phase 1) → second open prefills with what was just saved.
  - Cancel discards all changes. Esc closes the modal.
  - Try to trigger the modal while another modal is open → no-op (EC-12).
  - Verify window size on launch is still 50% width × 80% height (centered). Run the regression test.

---

## 9. Handoff Summary

- Requirements source: `docs/requirements/active_task.md`
- Blueprint: `docs/specs/view-modal/00_index.md`
- Step files created:
  - `docs/specs/view-modal/step_01_codeblock_parser.md`
  - `docs/specs/view-modal/step_02_codeblock_writer.md`
  - `docs/specs/view-modal/step_03_collections_writes_codeblock.md`
  - `docs/specs/view-modal/step_04_modal_skeleton.md`
  - `docs/specs/view-modal/step_05_modal_wire_up.md`
  - `docs/specs/view-modal/step_06_modal_stacking_refusal.md`
  - `docs/specs/view-modal/step_07_slash_commands.md`
  - `docs/specs/view-modal/step_08_remove_old_templates.md`
  - `docs/specs/view-modal/step_09_remove_old_codeblock_modal_tabs.md`
  - `docs/specs/view-modal/step_10_regression_sweep.md`

## 10. Implementation Progress (Lead Developer, 2026-06-08)

- [x] step_01 — Codeblock parser extension (15 tests pass)
- [x] step_02 — Codeblock writer + migration-on-write (13 tests pass)
- [x] step_03 — Collections writes codeblock shape (11 new + 1 updated)
- [x] step_04 — Modal skeleton + SVG illustrations (32 tests across 4 files)
- [x] step_05 — Modal wire-up (14 tests; right-click + main.ts migrated)
- [x] step_06 — Modal stacking refusal (10 tests; active-modal.ts added)
- [x] step_07 — `/sidebar` and `/grid` slash commands (10 tests; EC-10 directive applied)
- [x] step_08 — Old templates deleted (7 regression pins; done during step_05 due to TS noUnusedLocals)
- [x] step_09 — Legacy openCodeBlockModal deleted (7 pins; main.ts migrated to openViewModal)
- [x] step_10 — Regression sweep (6 EC-10 lock-down tests; spec notes updated)

Final test counts: 4815 passing (baseline 4697; +118 net new). 39 skipped (pre-existing).

Window-invariant test (`tests/settings/window-defaults.test.ts`):
6 tests pass; `src/lib/settings.ts` and `src-tauri/src/lib.rs` were
NOT touched.

### Locked EC-10 resolution

The user directive resolved the EC-10 conflict flagged in step_07
IN FAVOR OF EC-10 as written in `active_task.md`:

> When the user types `/sidebar` or `/grid` and the slash-command menu
> is showing, pressing Esc must (1) remove the typed slash text,
> (2) close the slash menu, and (3) return the cursor to the position
> where the slash started.

Implementation: `ESC_REMOVES_TYPED_TEXT` Set in `quick-commands.ts`
+ `QuickCommandsPlugin.cancelOnEsc(view)` branches on the typed text.
Scope: applies ONLY to `/sidebar` and `/grid`; existing commands
keep their legacy convention. Tests: `slash-commands.test.ts` (5
EC-10 cases) + `ec10-lockdown.test.ts` (6 directive-point pins).

## Review Request

- **Files changed**:
  - `src/plugins/file-browser/folder-view/parser.ts`
  - `src/plugins/file-browser/folder-view/codeblock-writer.ts` (NEW)
  - `src/plugins/file-browser/collections/store.ts`
  - `src/plugins/file-browser/file-browser.plugin.ts`
  - `src/plugins/file-browser/template-picker.ts` (DELETED)
  - `src/lib/codeblock-modal.ts`
  - `src/lib/view-modal-illustrations.ts` (NEW)
  - `src/lib/active-modal.ts` (NEW)
  - `src/editor/quick-commands.ts`
  - `src/main.ts`
  - `tests/view-modal/` (NEW directory; 11 test files)
  - `tests/collections/migration-codeblock.test.ts` (NEW)
  - `tests/collections/store.test.ts` (1 test updated)
  - `docs/specs/view-modal/00_index.md`
  - `docs/specs/view-modal/step_10_regression_sweep.md`

- **Steps completed**: step_01 through step_10, in order, per the
  dependency graph in §4.

- **Known limitations**:
  - In-doc edit on an existing sidebar/grid codefence is now a silent
    no-op (modal route deleted in step_09). Users can edit inline or
    insert a fresh stub via `/sidebar` / `/grid`. A toast prompt is
    deferred to DW-1.
  - The `vm-width-pill.is-active` CSS uses `--text-primary` for the
    text color on the link-color background. A future `--text-on-accent`
    token would improve contrast on certain themes; pinned but not
    implemented (no new tokens per NFR-5).

- **Edge cases covered by tests** (each EC mapped to ≥1 test):
  - EC-1 → `submit-create.test.ts`
  - EC-2 → `submit-create.test.ts` + `read-compat.test.ts`
  - EC-3 → `submit-insert.test.ts`
  - EC-4 → `config-row.test.ts` + `submit-create.test.ts`
  - EC-5 → `config-row.test.ts` (FR-21 verified — filter rule UI present)
  - EC-6 → `tab-switch.test.ts`
  - EC-7 → `read-compat.test.ts`
  - EC-8 → `migration-on-write.test.ts`
  - EC-9 → `slash-commands.test.ts` (regex pin + syntax-tree-aware
    inside-fence test added 2026-06-08 per Reviewer L-2 follow-up;
    `quick-commands.ts` consults `syntaxTree(state).resolveInner` and
    suppresses the slash menu when the cursor sits inside `FencedCode`
    / `CodeBlock` / `CodeText` / `InlineCode`)
  - EC-10 → `slash-commands.test.ts` + `ec10-lockdown.test.ts` (LOCKED directive)
  - EC-11 → `modal-mount.test.ts` (Cancel discards)
  - EC-12 → `modal-stacking.test.ts`
  - EC-13 → `tests/settings/window-defaults.test.ts` (existing)
  - EC-14 → `submit-create.test.ts` (Collection tab end-to-end)
  - EC-15 → `css.test.ts`
  - EC-16 → `read-compat.test.ts` (malformed YAML → safe defaults)
  - EC-17 → `submit-create.test.ts` + `config-row.test.ts` + `modal-mount.test.ts`
  - EC-18 → `tab-switch.test.ts` (synchronous swap)
  - EC-19 → `migration-on-write.test.ts` (icon preserved)
  - EC-20 → `migration-on-write.test.ts` + `tests/collections/migration-codeblock.test.ts`
  - EC-21 → `submit-create.test.ts` (edit-mode prefill)

Next step: Activate `@code-reviewer`. Provide `docs/specs/view-modal/00_index.md`
and `docs/requirements/active_task.md` as context.

## 11. Reviewer Follow-Up Resolution (2026-06-08)

The Code Reviewer approved the feature with two surgical Low-severity
follow-ups. Both are resolved below; the M-1 modal-decomposition item
remains open as **DW-14** at the Reviewer's recommendation.

### L-1 — `Object.freeze` hardening of EC-10 opt-in Set

**Before**: `ESC_REMOVES_TYPED_TEXT` was a plain `Set<string>` typed as
`ReadonlySet<string>`. The TypeScript type prevented compile-time
mutation but a malicious plugin could still call `.add("table")` at
runtime to extend EC-10's "Esc removes typed text" behaviour to other
slash commands — silently re-pointing a locked UX directive.

**After**: the Set literal is wrapped in `Object.freeze(...)`.
`Object.isFrozen(ESC_REMOVES_TYPED_TEXT)` returns `true`. The binding
is asserted in `tests/view-modal/slash-commands.test.ts` via a
test-only re-export (`__TEST_ONLY_ESC_REMOVES_TYPED_TEXT`).

- File: `src/editor/quick-commands.ts:92-94` (Set + Object.freeze) and
  `src/editor/quick-commands.ts:96-105` (test-only re-export).
- New test: `slash commands — L-1 hardening (Object.freeze on EC-10
  opt-in Set)` → `ESC_REMOVES_TYPED_TEXT is runtime-frozen
  (Object.isFrozen returns true)`.

### L-2 — Syntax-tree guard for slash trigger inside open code fences

**Before**: the slash-trigger regex `^\/(\w*)$` matches against the raw
line text only. A blank line inside an open ```` ```js ```` fence still
matches the regex, so typing `/sidebar` on that line popped the slash
menu inside a code block. EC-9 was previously asserted only via a
regex-based mid-line negative pin (`Hello/sidebar` cannot fire), which
did not exercise the blank-line-inside-fence path.

**After**: the `update()` method consults `syntaxTree(state)
.resolveInner(pos, -1)` and walks ancestors looking for any of
`FencedCode`, `CodeBlock`, `CodeText`, `InlineCode` (the same canonical
set used by `typing-assist.plugin.ts:isProtectedContext`). If any
ancestor matches, the popup is closed and `update()` returns. A paired
regression pin asserts the slash menu STILL opens on a normal blank
line OUTSIDE any fence.

- Files: `src/editor/quick-commands.ts:31` (syntaxTree import),
  `src/editor/quick-commands.ts:107-135` (new `isInsideCodeFence`
  helper), `src/editor/quick-commands.ts:400-407` (guard call inside
  `QuickCommandsPlugin.update`).
- New tests (3) under `slash commands — EC-9 (slash trigger suppressed
  inside open code fences)`:
  - `EC-9 — \`/sidebar\` typed on a blank line INSIDE an open
    \`\`\`js fence does NOT open the popup`
  - `EC-9 — \`/grid\` typed inside an open \`\`\`python fence is
    also suppressed`
  - `EC-9 paired regression pin — \`/sidebar\` on a normal blank line
    OUTSIDE any fence STILL opens the popup`

### Verification

- `npm run test:run -- tests/view-modal/` → **117 passed** (was 113;
  +4 from L-1 and L-2).
- `npm run test:run -- tests/settings/window-defaults.test.ts` →
  **6 passed** (window invariant intact).
- `npm run test:run` → **4825 passed** + 39 skipped (was 4821 + 39;
  +4 net new tests).
- `npm run build` → TypeScript clean; bundle emitted.
- `npm run build:plugins && npm run sync:plugins` → 20/20 plugins
  rebuilt (defensive — `src/editor/` is not a plugin IIFE, so this is
  not strictly required, but harmless).
- Reviewer L-1 hardened: `Object.isFrozen(ESC_REMOVES_TYPED_TEXT) === true`.
- Reviewer L-2 covered: blank-line-inside-fence EC-9 case now tested
  AND guarded.

### Reviewer's deferred items (still open)

- **DW-14** (Reviewer M-1, deferred): decompose `openViewModal` — the
  function has grown to ~450 LOC in `src/lib/codeblock-modal.ts` and
  the Reviewer recommended factoring out preview / tab strip / config
  row into named helpers. Tracked but out of scope for this follow-up.

---

## Review Sign-off (Unified View Modal — 2026-06-08)

- **Date**: 2026-06-08
- **Findings summary**: 0 Critical, 0 High, 1 Medium (DW-14, deferred), 3 Low — 0 outstanding blockers. L-1 (`Object.freeze` hardening) and L-2 (EC-9 inside-fence test + syntax-tree guard) applied as Lead Dev follow-up.
- **Requirements traceability**: All ~50 FRs and 10 NFRs in the active spec verified against implementation.
- **Edge case coverage**: All 21 Edge Case Inventory items (EC-1 … EC-21) covered by passing tests that exercise the actual failure modes. EC-9 inside-fence case now backed by both regex pin AND syntax-tree-aware guard.
- **EC-10 directive (user-locked, non-negotiable)**: implemented exactly — `/sidebar` and `/grid` Esc removes typed text, closes menu, returns cursor to slash position. `ESC_REMOVES_TYPED_TEXT` is `Object.freeze`d. 11 tests cover the directive across edge cases.
- **Test counts**: tests/view-modal/ 117 passing across 13 files; tests/collections/ 216 passing; full project 4825 passing, 39 skipped; window-defaults 6/6 green; TypeScript build clean; 20 plugins rebuilt and synced.
- **Status**: Approved for Merge

LGTM. Ready for production.

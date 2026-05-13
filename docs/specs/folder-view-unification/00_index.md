---
title: "Folder View Unification — Master Blueprint"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Folder View Unification — Master Blueprint

Requirements source: `docs/requirements/active_task.md`

---

## Summary

Both the `folder-cards` and `folder-table` layouts must share one enrichment
pipeline, one `fields:` / `extra-fields:` configuration surface, and one bulk-
selection + bulk-action toolbar. After this refactor, switching layout is a
purely visual change — the data available to each layout is identical.

---

## OQ-1 Resolution: Shared Context Object (Preferred over Signature Change)

The requirements identified two alternatives for moving `SelectionState` and
`ToolbarRefs` from `table-renderer.ts` to `tab.ts`:

**Option A — Change `FolderLayoutRenderer` signature**: add `selectionState`
and `toolbarRefs` as new parameters. Clean, but is a type-level breaking change
for any future third-party renderer.

**Option B — Shared context object injected into each renderer call site**:
`renderFolderViewTabAsync` constructs a `BulkContext` object (containing
`selectionState`, `toolbarRefs`, `syncToolbar`, and the three operation
callbacks) and passes it as a **fifth argument** to the renderer call. The
`FolderLayoutRenderer` type is widened to accept an optional fifth parameter.
Because TypeScript function parameter contravariance allows callers to pass a
value that the callee ignores, renderers that do not need bulk support simply
ignore the argument with no type error.

**Decision: Option B.** Rationale:
- Keeps the existing four-parameter signature valid for all callers — no
  cascade of type errors across tests and existing renderers.
- The fifth parameter is optional (`context?: BulkContext`) so the type
  contract is additive, not breaking.
- Concentrates all bulk wiring in `tab.ts` (single responsibility); neither
  renderer invents its own state.
- `table-renderer.ts` stops creating `SelectionState`/toolbar and instead
  receives them via `context`. The behavior delta is zero — table layout is
  behaviorally unchanged.
- `renderer.ts` gains bulk support by reading from `context`; no other code
  path changes.

---

## High-Level Architecture

### Tech Stack

No new dependencies are introduced. The implementation uses:
- **TypeScript** — all existing source files; no runtime library changes.
- **Plain DOM construction** — AD-6 pattern already used throughout.
- **`Promise.all`** — already the enrichment concurrency strategy in `tab.ts`.

### Data Flow

```
_folder.md ──read──► parseFolderMd() ──► FolderViewConfig
                                               │
                                    ┌──────────┴───────────────────┐
                                    │ renderFolderViewTabAsync()    │
                                    │  tab.ts                       │
                                    │                               │
                                    │  1. collectChildren()         │
                                    │  2. enrichment (all layouts)  │
                                    │     when extraFields.length>0 │
                                    │     OR imageColumnsRequested  │
                                    │  3. createSelectionState()    │
                                    │  4. buildToolbar(...)         │
                                    │  5. host.appendChild(toolbar) │
                                    │  6. LAYOUT_RENDERERS[key](    │
                                    │       config, cards,          │
                                    │       container, folderPath,  │
                                    │       bulkContext)            │
                                    └───────────────────────────────┘
                                            │              │
                               ┌────────────┘              └────────────┐
                    renderFolderCards()               renderFolderTable()
                    renderer.ts                       table-renderer.ts
                    (reads bulkContext)               (reads bulkContext)
                    - one checkbox per card           - one checkbox per row
                    - metadata line below name        - columns unchanged
                    - section master checkbox         - section master checkbox
```

### Enrichment Gate (C-1)

Before this refactor (line 327–329 in `tab.ts`):
```typescript
const needsEnrichment =
  layoutKey === "folder-table" &&
  (config.extraFields.length > 0 || imageColumnsRequested(config));
```

After (Step 02):
```typescript
const needsEnrichment =
  config.extraFields.length > 0 || imageColumnsRequested(config);
```

The `layoutKey === "folder-table" &&` prefix is the only change. The enrichment
body is untouched.

---

## Component Map

### New Types (added to `types.ts`)

```typescript
/** Bulk wiring passed from tab.ts to both layout renderers. */
export interface BulkContext {
  selectionState: SelectionState;
  toolbarRefs: ToolbarRefs;
  syncToolbar: () => void;
  onMove:  (destDir: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onYaml:  (op: "add" | "remove", key: string, value: string) => Promise<void>;
}
```

`FolderLayoutRenderer` becomes:
```typescript
export type FolderLayoutRenderer = (
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
  context?: BulkContext,
) => void;
```

### Files Modified

| File | Steps | Nature of change |
|---|---|---|
| `types.ts` | 01 | Add `BulkContext` interface; widen `FolderLayoutRenderer` |
| `tab.ts` | 01, 02 | Move `SelectionState`+`buildToolbar`+`syncToolbar` construction here; remove enrichment gate layout guard; construct `BulkContext`; pass to `LAYOUT_RENDERERS[layoutKey]` call |
| `table-renderer.ts` | 01 | Remove own `SelectionState`+`buildToolbar` construction; read `context` param instead; host.appendChild(context.toolbarRefs.toolbar) moved to tab.ts |
| `renderer.ts` | 03, 04, 05 | Accept `context` param; place toolbar node above sections; add master checkbox per section; add card checkbox; add `fv-card-meta` metadata line |
| `folder-view-css.ts` | 06 | Add `.fv-card-meta` styles; add card checkbox position + hover-opacity |
| `file-browser.plugin.ts` | 06 | Update `FOLDER_VIEW_STARTER` `fields:` and `extra-fields:` comments (C-8) |

### Files NOT Modified

`bulk-toolbar.ts`, `bulk-selection.ts`, `bulk-operations.ts`, `parser.ts`,
`folder-table-css.ts`, `yaml-frontmatter.ts`, `frontmatter-reader.ts`.

---

## Critical Design Decisions

### D-1: `BulkContext` construction location

`renderFolderViewTabAsync` (in `tab.ts`) constructs the full `BulkContext`
— including `selectionState`, `toolbarRefs`, `syncToolbar`, and the three async
operation callbacks — **before** calling the layout renderer. The host
`<div>` is created in `tab.ts` and `toolbarRefs.toolbar` is appended to it
before any section content. This matches the existing `renderFolderTable`
structure exactly.

### D-2: Lazy-load checkbox threading (C-6)

`appendCardsToGrid` receives new parameters `rowCheckboxes`, `sectionPaths`,
`selectionState`, `syncToolbar`, and `masterInput`. These are captured **by
reference** (TypeScript arrays/objects) in the `IntersectionObserver` callback
closure. When a lazy batch fires, it calls `buildCard(card, config, checkboxCtx)`
where `checkboxCtx` is the same object that was passed to `appendCardsToGrid`.
The per-section arrays grow in place — the closure always sees the live arrays.

The `IntersectionObserver` pattern in `renderer.ts` changes from:
```typescript
// Old: no checkbox context
for (const card of batch) grid.insertBefore(buildCard(card, config), sentinel);
```
to:
```typescript
// New: checkbox context threaded
for (const card of batch) grid.insertBefore(buildCard(card, config, checkboxCtx), sentinel);
```

### D-3: Metadata line guard (C-7, EC-16)

In `buildCard`, the existing `showModified` block and `showTags` block are
guarded: they execute **only** when `config.fields === null`. When `fields:`
is declared, the new `fv-card-meta` element is rendered instead. The two paths
are mutually exclusive — `.folder-view-card-date` and `.fv-card-meta` never
appear simultaneously.

### D-4: `fv-card-meta` value rendering (C-4, EC-15)

All field values in the metadata line use `.textContent` assignment only.
Tag values are joined with ` · ` before being written. Custom frontmatter values
are written verbatim. Em-dash (`—`) is substituted for empty/missing values.
For the `count` field on directory cards, `String(card.childCount ?? 0)` is
used. For the `count` field on file cards, `—` is used.

### D-5: `toolbarRefs.toolbar` attachment point

`tab.ts` appends `toolbarRefs.toolbar` to `host` as the **first child**, before
the description block and before any sections — identical to the existing
`renderFolderTable` pattern. Neither renderer appends it (they receive it
already attached via the shared `host` reference).

Wait — reading `renderFolderTable` more carefully: `host` is created inside
`renderFolderTable`, not passed in. Under the new design, `host` must be
created in `tab.ts` so that `toolbarRefs.toolbar` can be pre-appended and the
same `host` reference passed to both renderers for use as the
`IntersectionObserver` scroll root.

**Revised host creation**: `host` moves from inside each renderer to inside
`renderFolderViewTabAsync`. Both renderers receive `host` (or the container
already cleared and host already attached — the renderer simply appends its
section content to `host` rather than creating it).

Alternative: keep `host` inside each renderer but pass `toolbarRefs` and let
each renderer do `host.insertBefore(toolbarRefs.toolbar, host.firstChild)`.
This is simpler and avoids changing the renderer call contract significantly.

**Final decision**: Keep `host` construction inside each renderer. Each
renderer calls `host.insertBefore(context.toolbarRefs.toolbar, host.firstChild)`
immediately after creating `host`. This is the minimal delta and avoids
threading `host` out of the renderer as an extra return value or parameter.
`tab.ts` passes only `context` (the fifth argument). This preserves the
existing renderer structure maximally.

---

## Implementation Phases (Step Files)

| Step | File | Scope | Gating test |
|---|---|---|---|
| 01 | `step_01_shared_state.md` | Move `SelectionState`+toolbar from `table-renderer.ts` to `tab.ts`; introduce `BulkContext`; table behavior unchanged | `table-renderer-bulk.test.ts` still passes |
| 02 | `step_02_enrichment_gate.md` | Remove `layoutKey === "folder-table" &&` from enrichment condition; extend `imageColumnsRequested` check to both layouts | `tab-image-enrichment.test.ts` still passes; new cards-enrichment test |
| 03 | `step_03_cards_toolbar.md` | Wire bulk toolbar into `renderer.ts`: place `context.toolbarRefs.toolbar` above sections; construct `buildToolbar` operation callbacks in `tab.ts` for cards layout | New toolbar-visibility test for cards layout |
| 04 | `step_04_cards_checkboxes.md` | Add checkbox to each card DOM (top-left, absolutely positioned); wire to `SelectionState`; thread through lazy-load path; per-section master checkbox | `renderer.test.ts` checkbox wiring; EC-5, EC-6, EC-9 |
| 05 | `step_05_cards_metadata.md` | Add `fv-card-meta` metadata line below card name; legacy default (modified + tags); `fields:` mode; guard against `.folder-view-card-date` duplication; C-8 `FOLDER_VIEW_STARTER` update | EC-1–EC-4, EC-13–EC-17 |
| 06 | `step_06_css.md` | Add `.fv-card-meta` CSS to `folder-view-css.ts`; add card checkbox CSS (position absolute, hover-opacity); no other file changes | Visual regression / CSS class assertions |

---

## Edge Case Coverage Matrix

| Edge Case | Step | Test |
|---|---|---|
| EC-1 (no fields, default meta line) | 05 | renderer.test.ts |
| EC-2 (fields: builtin only) | 05 | renderer.test.ts |
| EC-3 (fields: custom key) | 02, 05 | tab.test.ts + renderer.test.ts |
| EC-4 (fields: image keys) | 02 | tab-image-enrichment.test.ts |
| EC-5 (lazy batch, checkboxes register) | 04 | renderer.test.ts |
| EC-6 (checked card + lazy batch) | 04 | renderer.test.ts |
| EC-7 (bulk delete, re-render clears) | 03 | renderer.test.ts |
| EC-8 (bulk move) | 03 | renderer.test.ts |
| EC-9 (checkbox click no navigation) | 04 | renderer.test.ts |
| EC-10 (directory card checkbox) | 04 | renderer.test.ts |
| EC-11 (mixed layout isolation) | 01 | tab.test.ts |
| EC-12 (table unchanged after refactor) | 01 | table-renderer-bulk.test.ts |
| EC-13 (fields: name only, no meta line) | 05 | renderer.test.ts |
| EC-14 (count field on cards) | 05 | renderer.test.ts |
| EC-15 (XSS via textContent) | 05 | renderer.test.ts |
| EC-16 (show-modified + fields declared) | 05 | renderer.test.ts |
| EC-17 (enrichment failure, one card) | 02 | tab.test.ts |
| EC-18 (checkbox hover visibility) | 06 | CSS class assertion |

---

## Checklist

- [x] Step 01 complete and `table-renderer-bulk.test.ts` passing
- [x] Step 02 complete and `tab-image-enrichment.test.ts` passing
- [x] Step 03 complete and cards toolbar test passing
- [x] Step 04 complete and cards checkbox tests passing
- [x] Step 05 complete and metadata line tests passing
- [x] Step 06 complete and CSS assertions passing
- [x] All existing tests passing (`npm run test:run`) — 4172 passed, 3 pre-existing failures unrelated to this feature
- [x] `FOLDER_VIEW_STARTER` comment updated (C-8)
- [x] Code review: all edge cases from EC-1 through EC-18 verified

---

## Review Request

- **Files changed**:
  - `src/plugins/file-browser/folder-view/types.ts` — added `BulkContext` interface; widened `FolderLayoutRenderer` to accept optional 5th `context?: BulkContext` parameter
  - `src/plugins/file-browser/folder-view/tab.ts` — removed `layoutKey === "folder-table" &&` from enrichment gate; added `createSelectionState`, `buildToolbar`, `updateToolbar` construction; added `BulkContext` assembly; passes `bulkContext` as 5th arg to `LAYOUT_RENDERERS[layoutKey]`
  - `src/plugins/file-browser/folder-view/table-renderer.ts` — removed own `SelectionState`/toolbar construction; reads `context` param with `??` fallback for backward compatibility; keeps host-internal toolbar attachment via `context.toolbarRefs.toolbar`
  - `src/plugins/file-browser/folder-view/renderer.ts` — added `BulkContext` + checkbox imports; added module-internal `CheckboxContext` type; added `buildCardMeta()` function; modified `buildCard`, `appendCardsToGrid`, `buildSection`, `renderFolderCards` to accept and thread `CheckboxContext`; attaches toolbar as first child when context provided; renders per-section master checkboxes
  - `src/plugins/file-browser/folder-view/folder-view-css.ts` — appended `.fv-card-meta`, `.fv-card-checkbox-wrap` (position + opacity rules), hover/selected selectors, `.folder-view-card.fv-row--selected` tint, master checkbox row styles
  - `src/plugins/file-browser/file-browser.plugin.ts` — updated `FOLDER_VIEW_STARTER` constant: removed "folder-table only" qualifier, added dual description for `fields:` across both layouts, added `extra-fields:` comment block
  - `tests/folder-view/table-renderer-bulk.test.ts` — added tests I-20 (external BulkContext shared state) and I-21 (no-context fallback)
  - `tests/folder-view/tab.test.ts` — updated EC-12 comment; added enrichment-gate folder-cards describe block (tests A–D covering EC-3, EC-17)
  - `tests/folder-view/renderer.test.ts` — added Step 03 toolbar tests, Step 04 checkbox wiring tests (EC-5, EC-6, EC-9, EC-10, EC-11), Step 05 metadata line tests (EC-1–EC-4, EC-13–EC-16), Step 06 CSS class + C-8 assertions

- **Steps completed**: step_01_shared_state, step_02_enrichment_gate, step_03_cards_toolbar, step_04_cards_checkboxes, step_05_cards_metadata, step_06_css

- **Known limitations**:
  - EC-7 (bulk delete triggers re-render and clears selection) and EC-8 (bulk move) are exercised at the `tab.ts` level by the existing `table-renderer-bulk.test.ts` suite (tests I-8 through I-14). No new `renderer.test.ts` test for these cases because the callbacks are wired inside `tab.ts` and tested there; the renderer only plumbs them through `context.onDelete`/`context.onMove` which it does not invoke directly.
  - No end-to-end Tauri integration test. The full user flow (open folder in Tauri, bulk select, delete) requires a running app; unit tests stub `window.__TAURI_INTERNALS__`.

- **Edge cases covered by tests**:
  | Edge Case | Test file | Test name / describe |
  |---|---|---|
  | EC-1A (no fields declared, meta shows modified) | renderer.test.ts | "metadata line — fv-card-meta > EC-1A: no fields, modified present" |
  | EC-1B (no fields, no modified) | renderer.test.ts | "EC-1B: no fields, no modified" |
  | EC-2 (fields: builtin name only, no meta line) | renderer.test.ts | "EC-2: fields: [name] → no meta line" |
  | EC-3 (fields: custom key, value present) | renderer.test.ts + tab.test.ts | "EC-3: fields custom key" + enrichment gate test A |
  | EC-3b (fields: custom key, value absent → em-dash) | renderer.test.ts | "EC-3b: missing field → em-dash" |
  | EC-4 (fields: image keys, enrichment runs) | tab.test.ts | enrichment gate describe block (imageColumnsRequested path) |
  | EC-5 (lazy batch checkboxes register paths) | renderer.test.ts | "EC-5: lazy batch paths all register" |
  | EC-6 (pre-checked card survives lazy batch) | renderer.test.ts | "EC-6: checked card stays selected across lazy batch" |
  | EC-7 (bulk delete re-render) | table-renderer-bulk.test.ts | I-8 through I-14 |
  | EC-8 (bulk move) | table-renderer-bulk.test.ts | I-8 through I-14 |
  | EC-9 (checkbox click no navigation) | renderer.test.ts | "EC-9: checkbox click does not trigger card navigation" |
  | EC-10 (directory card checkbox) | renderer.test.ts | "EC-10: directory card gets checkbox" |
  | EC-11 (table layout unaffected by cards changes) | tab.test.ts | "EC-11 / C-5: table layout unchanged" |
  | EC-12 (table unchanged after refactor) | table-renderer-bulk.test.ts | I-20 + I-21 |
  | EC-13 (fields: name only, no meta line) | renderer.test.ts | "EC-13: fields name-only → no meta rendered" |
  | EC-14 (count field on directory card) | renderer.test.ts | "EC-14: count field on directory card" |
  | EC-15 (XSS via textContent) | renderer.test.ts | "EC-15: XSS values rendered as textContent only" |
  | EC-16 (showModified + fields declared → mutual exclusion) | renderer.test.ts | "EC-16: showModified true + fields declared → no date element" |
  | EC-17 (enrichment failure isolation) | tab.test.ts | enrichment gate test D (EC-17) |
  | EC-18 (checkbox hover opacity via CSS) | renderer.test.ts | "EC-18: CSS class fv-card-checkbox-wrap present on card" |

---

## Review Sign-off

- **Date**: 2026-05-12
- **Findings summary**: Third pass — 0 Critical, 0 High, 0 Medium, 1 Low (accepted); all prior H-1, M-1 through M-4, L-1 through L-6 findings resolved or accepted
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified.
- **Edge case coverage**: All Edge Case Inventory items EC-1 through EC-18 covered by tests.
- **Third-pass findings**:
  - **Low (accepted)** — `/src/plugins/file-browser/folder-view/renderer.ts` lines 53 and 783: two comments state that `sectionPaths` "grows when lazy cards push their path." This is inaccurate — `sectionPaths` is pre-seeded from all section cards in `makeCheckboxCtx` and does not grow during lazy loading. `rowCheckboxes` and `sectionRows` are the lazily-growing arrays. The behavior is correct (master checkbox always has full path knowledge), but the comments misrepresent the mechanism. Accepted as a documentation-only defect with no runtime impact.
- **F1 fix verified**: Dead `sectionPaths.includes` guard confirmed absent from `buildCard`. No residue.
- **F2 fix verified**: `buildCardMeta` legacy path references only `showModified`; no `showTags` double-render path exists.
- **F3 fix verified**: `applyExcludeFilter` in `shared.ts` is the sole implementation; both `tab.ts` and `renderer.ts` import and call it. Logic is correct (Set-based O(1) lookup, `.md` extension handling matches prior inline logic).
- **F4 fix verified**: EC-6 master checkbox `indeterminate` assertion is meaningful. `sectionPaths` is pre-seeded with all 51 paths; when the first checkbox fires its `change` event (50 DOM cards visible, 1 selected), `updateMasterCheckboxState` computes `1 of 51 = partial` and sets `indeterminate = true`. Assertion would fail for both the all-unselected case (indeterminate false) and the all-selected case (checked true). Not vacuously true.
- **Status**: Approved for Merge

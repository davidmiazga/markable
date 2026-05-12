---
title: "fields-column-control — Master Index"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Folder Table: Unified `fields:` Column List — Master Index

## Overview

This feature adds a single `fields:` YAML sequence to the `folder-table` layout
that replaces the separate `show-modified`, `show-tags`, `show-extensions`,
`show-count`, and `extra-fields:` flags as the column-control mechanism. When
`fields:` is absent, all existing behaviour is preserved exactly (full
backwards compatibility).

Requirements source: `docs/requirements/active_task.md`

---

## File Change Table

| File | Action | Step |
|---|---|---|
| `src/plugins/file-browser/folder-view/types.ts` | Extend | step_01 |
| `src/plugins/file-browser/folder-view/parser.ts` | Extend | step_02 |
| `src/plugins/file-browser/folder-view/table-renderer.ts` | Extend | step_03 |
| `src/plugins/file-browser/file-browser.plugin.ts` | Update starter | step_04 |
| `tests/folder-view/parser.test.ts` | Add describe block | step_02 |
| `tests/folder-view/table-renderer.test.ts` | Add describe block + fix makeConfig | step_03 |

**Files that must NOT be changed:**
- `src/plugins/file-browser/folder-view/tab.ts`
- `src/plugins/file-browser/folder-view/renderer.ts`
- `src/plugins/file-browser/folder-view/detection.ts`
- `src/plugins/file-browser/folder-view/fallback.ts`
- `src/plugins/file-browser/folder-view/frontmatter-reader.ts`
- Any Rust source files

---

## Architectural Decisions

### AD-1 — Dedicated `extractFieldsRaw` helper (not generalising `extractExtraFieldsRaw`)

`fields:` items are always plain strings with no sub-key structure. Generalising
`extractExtraFieldsRaw` to handle both would add conditional branching for a
mode that only one caller ever uses. A dedicated 20-line helper is narrower,
easier to test, and cannot accidentally affect extra-fields parsing. Decision:
write `extractFieldsRaw` as a standalone private function in `parser.ts`.

### AD-2 — `resolveFields` lives in `table-renderer.ts` (private helper)

`resolveFields(config, isFiles)` is used only by `buildSectionTable()`. No
other module needs it. Exporting it would widen the public surface without
benefit. Decision: private module-level function in `table-renderer.ts`.

### AD-3 — Em-dash filler cells for non-builtin fields in folder rows (not omit)

When `fields:` includes `modified`, `tags`, or custom keys, folder rows must
produce a `<td>` for each of those columns to keep column alignment between the
two section tables. Decision: em-dash `<td class="fv-td fv-td-placeholder">` for
every field that is not `name` or `count` in the folders section.

### AD-4 — `fieldHeaderLabel` as private helper in `table-renderer.ts`

Built-in labels (`name` → "Name", `type`/`ext` → "Type", `modified` →
"Modified", `tags` → "Tags", `count` → "Items") are hardcoded strings.
Custom fields look up `config.extraFields` for an explicit label first, then
fall back to `key.charAt(0).toUpperCase() + key.slice(1)`. This stays private
because it is only needed during header construction in `buildSectionTable`.

### AD-5 — All fields-mode columns sortable (except `tags` and `count`)

In fields mode every column except `tags` and `count` is sortable (string
sort for custom fields, existing sort logic for builtins). `tags` is not sortable
because it is a multi-value chip display. `count` is not sortable (same as legacy).
The CSS rule `.fv-th-icon, .fv-th-tags, .fv-th-count { cursor: default; }` already
handles the visual cue; the renderer simply does not attach a click handler to
those headers.

### AD-6 — `config.fields = null` on empty or absent `fields:` sequence

An empty `fields:` sequence is more likely an authoring error than intentional
zero-column suppression. Parser emits `null` when the key is absent OR when the
extracted list is empty after filtering. This keeps the invariant: `fields !==
null` always means at least one column identifier was declared.

### AD-7 — `makeConfig()` in table-renderer.test.ts gains `fields: null`

`FolderViewConfig` gains a new required field. `makeConfig()` must supply it
with `fields: null` as its default so all existing tests remain in legacy mode
and need no other changes. No other test fixture file references `FolderViewConfig`
with a full spread — `tab.test.ts` uses inline YAML strings, not type spreads.

### AD-8 — `count` filtered from files section by `resolveFields`, not rendered as em-dash

`count` is a folders-only concept. In the files section it is simply excluded
from the column list by `resolveFields(config, true)`. This avoids a phantom
column in the files section. This is different from, say, `modified` appearing
in the folders section, where the column IS rendered (with em-dash content) so
both section tables have the same number of columns for visual alignment. Note:
the two section tables are independent DOM elements — column alignment is a
visual concern only within each table, not between them.

---

## Implementation Checklist

- [x] step_01 — Types: `fields` field on `FolderViewConfig` + `FolderMdFrontMatter`
- [x] step_02 — Parser: `BUILTIN_FIELDS`, `extractFieldsRaw`, `config.fields`, derived `extraFields`
- [x] step_03 — Renderer: `resolveFields`, `fieldHeaderLabel`, fields-mode in `buildSectionTable`/rows
- [x] step_04 — Starter: replace `# extra-fields:` block with `# fields:` block in `FOLDER_VIEW_STARTER`

---

## Acceptance Criteria Map

| AC | Covered by |
|---|---|
| AC-01 — `fields: [name, modified, tags]` renders those three columns | T-10 (renderer test) |
| AC-02 — `fields: [modified, name]` renders Modified before Name | T-11 |
| AC-03 — `fields: [name, status]` renders custom Status column | T-12 |
| AC-04 — No `fields:` → legacy mode, all existing tests pass | T-18, existing tests |
| AC-05 — `fields: [name, count]` → Files: Name only; Folders: Name + Count | T-16 |
| AC-06 — `fields: [name, modified]` → Folders: Name + em-dash | T-17 |
| AC-07 — `fields: [modified, tags]` → no Name column | T-15 |
| AC-08 — `fields: []` → `config.fields = null` | T-07 (parser), EC-01 |
| AC-09 — `show-modified: false` ignored when `fields: [modified]` | T-09 (parser), EC-08 |
| AC-10 — `extra-fields: [status]` ignored when `fields:` present | T-08 (parser) |
| AC-11 — Inline comment stripped from `fields:` item | T-06 (parser) |
| AC-12 — `folder-cards` unaffected | EC-15 |

---

## Review Request

- **Files changed**:
  - `src/plugins/file-browser/folder-view/types.ts` — Added `"fields"?: unknown` to `FolderMdFrontMatter`; added `fields: string[] | null` to `FolderViewConfig`
  - `src/plugins/file-browser/folder-view/parser.ts` — Added `BUILTIN_FIELDS` (exported), `extractFieldsRaw` (private), `fields: null` to `safeDefaults`, `extractFieldsRaw` call and `resolvedExtraFields`/`fields` derivation, updated return statement
  - `src/plugins/file-browser/folder-view/table-renderer.ts` — Added `BUILTIN_FIELDS` import, `resolveFields` helper, `fieldHeaderLabel` helper; refactored `buildFolderRow`, `buildFileRow`, and `buildSectionTable` to support fields mode with legacy branches preserved intact
  - `src/plugins/file-browser/file-browser.plugin.ts` — Updated `FOLDER_VIEW_STARTER`: replaced `# extra-fields:` 4-line block with `# fields:` 7-line block
  - `tests/folder-view/parser.test.ts` — Added `describe("fields: extraction")` with 12 tests (T-01 through T-09, EC-01, EC-11, EC-17)
  - `tests/folder-view/table-renderer.test.ts` — Added `fields: null` to `makeConfig()`; added `describe("fields-mode rendering")` with 15 tests (T-10 through T-20, EC-03, EC-04, EC-10, EC-14)

- **Steps completed**: step_01, step_02, step_03, step_04

- **Known limitations**: None. All steps complete. The 3 pre-existing failures in `smart-folders.editor.test.ts` and `smart-folders.evaluator.test.ts` are unrelated to this feature and were failing before this implementation.

- **Edge cases covered by tests**:
  - EC-01 (empty `fields:` → null): T-07 in parser tests + named EC-01 test
  - EC-03 (count excluded from files): EC-03 in renderer tests
  - EC-04 (type/ext alias → "Type" header): EC-04 in renderer tests
  - EC-10 (folders with only custom keys → all em-dash): EC-10 in renderer tests
  - EC-11 (blank item after comment-strip skipped): EC-11 in parser tests
  - EC-14 (clearIndicators covers all fields-mode ths): EC-14 in renderer tests
  - EC-17 (quoted field item parsed without quotes): EC-17 in parser tests
  - AC-04 (legacy mode unchanged): T-18 in renderer tests
  - AC-05 (count: files section Name-only, folders Name+Count): T-16 in renderer tests
  - AC-06 (folder rows: em-dash for modified): T-17 in renderer tests
  - AC-07 (name absent from fields): T-15 in renderer tests
  - AC-08/T-07 (empty fields: → null): parser EC-01 + T-07
  - AC-09 (show-modified:false ignored in fields mode): T-09 in parser tests
  - AC-10 (extra-fields: ignored when fields: present): T-08 in parser tests
  - AC-11 (inline comment stripped): T-06 in parser tests

---

## Review Sign-off

- **Date**: 2026-05-11
- **Findings summary**: 2 Critical fixed, 0 High, 1 Medium fixed, 1 Low fixed — all resolved
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified.
- **Edge case coverage**: All 18 Edge Case Inventory items covered by tests (EC-08 and EC-09 renderer tests added by reviewer; EC-02 via EC-10; EC-05 via code inspection — no eval or native property access; EC-12/EC-13 accepted as no-test per spec).
- **Status**: Approved for Merge

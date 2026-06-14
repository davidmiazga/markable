---
title: "step_08 — Remove old template picker"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# step_08 — Remove old template picker

## Goal

Delete the legacy "New Folder View" template picker and all its
support code. After this step, the right-click → "New Folder View"
flow exclusively uses the unified View Modal (wired in step_05). The
four removed templates (Hub Page, Media Gallery, Project Table,
Simple Index) plus the earlier-added Collection template entry are
gone. Deferred to the future Layouts flow (DW-3).

## Files touched

- **EDIT** `src/plugins/file-browser/file-browser.plugin.ts` — delete:
  - The `FOLDER_VIEW_TEMPLATES` constant (line 3407).
  - The four `*_SVG` preview constants (Hub Page, Media Gallery,
    Project Table, Simple Index — search for `_SVG = ` patterns above
    `FOLDER_VIEW_TEMPLATES`).
  - The `openFolderViewPicker()` function (line 3508).
  - The `writeFolderViewTemplate()` helper (line 3525).
  - The `FOLDER_VIEW_STARTER` constant if it has no other callers.
  - The `openTemplatePicker` import at line 96 (if no other callers
    remain — Architect-confirmed in step_08).
- **DELETE** `src/plugins/file-browser/template-picker.ts` — only if
  no remaining callers exist (audit during step_08 implementation).
- **DELETE** existing test files that exercise the removed templates:
  - `tests/file-browser/template-picker.test.ts` (if exists)
  - any test that imports `FOLDER_VIEW_TEMPLATES`
- **EDIT** any test that asserts on the old template picker DOM (e.g.
  `__template-picker-overlay__`) to either delete it or rewrite it to
  the new modal.

## Function signatures

No new signatures. This is a pure deletion + import cleanup step.

The right-click handler change (already made in step_05) is unchanged:

```typescript
{
  label: "Folder View",
  handler: () => { void openViewModalForFolder(path, container, vaultId); },
},
```

The right-click handler at line 3232 (`hasCodeblock ? "Edit CodeBlock" : "Insert CodeBlock"`) is left unchanged for step_08 — step_09 collapses it together with the in-doc Insert CodeBlock flow.

## Failing tests FIRST

This step is destructive, not constructive. The "failing tests"
discipline applies in reverse — the Lead Developer adds **regression
pins** that assert the deletions actually happened. Add to a new test
file `tests/view-modal/templates-deleted.test.ts`:

1. **"FOLDER_VIEW_TEMPLATES is not exported"** — import attempt fails (or the import yields `undefined`). Use dynamic import + try/catch + assertion that the symbol is `undefined`.
2. **"openFolderViewPicker is not exported"** — same.
3. **"Hub Page, Media Gallery, Project Table, Simple Index SVG constants are not in the source"** — read `file-browser.plugin.ts` from disk; assert the string `HUB_PAGE_SVG`, `MEDIA_GALLERY_SVG`, `PROJECT_TABLE_SVG`, `SIMPLE_INDEX_SVG` does NOT appear.
4. **"the literal string `__template-picker-overlay__` does not appear in `file-browser.plugin.ts`"** — read file, assert no match.
5. **"right-click `Folder View` handler opens openViewModal (sanity)"** — mock `openViewModal`, simulate right-click → "Folder View" entry → handler invoked → mock called with mode `"create"` (or `"edit"` if `_folder.md` exists).

These tests fail before step_08's deletions land (the symbols and
strings still exist). They pass after.

EC mapping in this step: indirect — EC-1 / EC-2 / EC-14 are verified
in step_05; this step confirms the old code path is gone so no
regression to the new path can be masked by the old.

FR mapping: out-of-scope guard (active_task.md "Layouts flow
redesign" / Templates removed entirely from this flow).

## Implementation outline

The deletion is line-range work in `file-browser.plugin.ts`. Concrete
search-and-delete checklist:

1. **Find and delete** the `*_SVG` constants for the four templates.
   They live above `FOLDER_VIEW_TEMPLATES` (line 3407). The Architect
   estimates lines 3300-3406 carry them, but the Lead Developer greps
   for `_SVG = "` near `FOLDER_VIEW_TEMPLATES` to confirm.
2. **Find and delete** `const FOLDER_VIEW_TEMPLATES: TemplateDefinition<string>[] = [...]` (line 3407).
3. **Find and delete** `function openFolderViewPicker(...)` (line 3508).
4. **Find and delete** `async function writeFolderViewTemplate(...)` (line 3525).
5. **Audit** `FOLDER_VIEW_STARTER` — find references. If only used by
   `createFolderViewFile` (line 3588), keep it (that function survives;
   it's used by "Reset Folder View..."). Otherwise delete.
6. **Audit** the `openTemplatePicker` and `TemplateDefinition` imports at line 96. If no remaining call sites use them, delete the imports.
7. **Audit** `src/plugins/file-browser/template-picker.ts`. If no remaining call sites, delete the file. (Grep `import.*template-picker` across `src/`.)
8. **Audit** `src/lib/template-picker.ts` (if it exists — line 96's import is from `../../lib/template-picker`). If no consumers, delete.
9. **Audit** the existing `OVERLAY_ID = "__template-picker-overlay__"` in step_06's `KNOWN_MODAL_OVERLAY_IDS` — delete the entry from the list.
10. **Run plugin build**: `npm run build:plugins && npm run sync:plugins`.

The audit step (item 7) is non-trivial: if `template-picker.ts` is
used elsewhere (e.g. the apply-page-layout flow at
`docs/specs/apply-view-layout-commands/`), it stays. The Lead
Developer runs:

```bash
grep -rln "openTemplatePicker\|template-picker" src/ tests/
```

If the only results are the file itself and the deleted call site,
the file is deleted. Otherwise, the file stays and the import in
`file-browser.plugin.ts` may or may not be removed depending on
context.

## Refactor opportunities

- The "Reset Folder View..." flow still uses
  `createFolderViewFile()` with `FOLDER_VIEW_STARTER`. The starter
  template's content is reasonable as-is (it's a `_folder.md` with a
  minimal codeblock and a comment heading). No change needed.
- The four template SVGs are deleted. If a future Layouts flow needs
  them, they can be reconstructed from git history.

## Definition of Done

- All 5 tests in `tests/view-modal/templates-deleted.test.ts` pass.
- Existing tests in `tests/view-modal/` continue to pass (step_05's
  end-to-end Create flow still works).
- Existing tests in `tests/folder-view/` and `tests/collections/`
  continue to pass.
- `npm run test:run` runs clean.
- `npm run build:plugins && npm run sync:plugins` runs clean.
- Manual: right-click any folder → "Folder View" → modal opens (the
  unified one, not the old template picker).
- Manual: the four old templates (Hub Page, Media Gallery, Project
  Table, Simple Index) no longer appear in any menu.
- Window-defaults invariant test continues to pass.
- Lines deleted in `file-browser.plugin.ts`: ~200 (the four SVG
  constants are 30-50 lines each).

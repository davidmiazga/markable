---
title: "Toolbar Consolidation — Feature Index"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Toolbar Consolidation — Master Checklist

## Overview

Consolidate `markdown-toolbar`, `table-toolbar`, and `image-toolbar` into a single
unified plugin at `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts`. The
unified plugin uses one CM6 `updateListener`, one settings namespace, one sidebar panel
(content-swapped by context), and one build entry.

Requirements source: `docs/requirements/active_task.md`

---

## Implementation Steps

- [x] `step_01_settings-and-css.md` — Unified settings types, `mergeWithDefaults`, merged CSS constant, CSS lifecycle helpers (`injectCSS` / `removeCSS`)
- [x] `step_02_pure-markdown-logic.md` — Port format registry, `detectFormats`, `computeWrap`, `computeUnwrap`, `computeErase`, `resolveUrl`, `isUrlLike` from the existing markdown-toolbar
- [x] `step_03_pure-image-logic.md` — Port all pure image functions: `parseImageSyntax`, `detectDivWrapper`, `detectFloatRight`, `detectAlignment`, `extractImageCore`, `buildBareImage`, `wrapWithDiv`, `buildFloatRightImg`, `detectLineEnding`, `applyAlignment`, `replaceImageSrc`, `resolveRelativePath`
- [x] `step_04_pure-table-logic.md` — Port `detectTableContext` helpers (`splitRow`, `isSeparatorRow`, `parseTableRows`) and all 11 pure table operations
- [x] `step_05_context-resolver.md` — Context resolver: `resolveContext()` function returning `"image" | "table" | "default"`, plus `detectImageRegion` and `detectTableContextFromState` wrappers
- [x] `step_06_dom-builders.md` — All four DOM builder groups: markdown toolbar DOM, image popover DOM, table floating elements DOM, sidebar panel DOM (with inner swap containers)
- [x] `step_07_update-listener.md` — Single shared CM6 `updateListener` factory: context resolution, synchronous show/hide, debounced active-button highlighting
- [x] `step_08_enable-disable.md` — `onEnable`, `onDisable`, `renderDetailExtra`, plugin export object, module-level state reset
- [x] `step_09_tests.md` — Migrate all three test suites into one file; add integration tests for EC-1 through EC-4, EC-12, EC-13; delete old test files
- [x] `step_10_build-cleanup.md` — Update `build-plugins.mjs` (remove 2 entries, update count string); delete retired source directories

---

## Files Created

| File | Action |
|---|---|
| `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` | Rewrite (unified) |

## Files Deleted

| File | When |
|---|---|
| `src/plugins/table-toolbar/table-toolbar.plugin.ts` | step_10 |
| `src/plugins/table-toolbar/` (entire dir) | step_10 |
| `src/plugins/image-toolbar/image-toolbar.plugin.ts` | step_10 |
| `src/plugins/image-toolbar/` (entire dir) | step_10 |
| `tests/plugins/table-toolbar/table-toolbar.test.ts` | step_09 (after migration) |
| `tests/plugins/image-toolbar/image-toolbar.test.ts` | step_09 (after migration) |

## Files Modified

| File | Change |
|---|---|
| `scripts/build-plugins.mjs` | Remove `table-toolbar` + `image-toolbar` entries; update count string |
| `tests/plugins/markdown-toolbar/markdown-toolbar.test.ts` | Add migrated test cases from both deleted test files + new integration tests |

## Files Unchanged

| File | Reason |
|---|---|
| `src/plugins/markable-plugin-api.ts` | No API changes needed |
| `src/plugins/index.ts` | PluginManager already handles `status: "missing"` for removed plugins |
| `src/sidebar/` | No changes; panel registration API is unchanged |
| `src/lib/settings.ts` | No changes; settings namespace "markdown-toolbar" already exists |
| `main.ts` | No changes |

---

## Edge Case Coverage Map

Every EC from `active_task.md` is assigned to a step file.

| EC | Description | Step |
|---|---|---|
| EC-1 | Cursor enters table — toolbar swap | step_07 |
| EC-2 | Cursor leaves table — toolbar swap | step_07 |
| EC-3 | Image line inside table — image wins | step_05, step_07 |
| EC-4 | Off image line while in table — table resumes | step_07 |
| EC-5 | Click rendered img inside table (live preview) | step_07 |
| EC-6 | Disable while image popover visible | step_08 |
| EC-7 | Disable while table floating UI visible | step_08 |
| EC-8 | Disable while markdown toolbar visible | step_08 |
| EC-9 | Rapid enable/disable/enable cycle | step_08 |
| EC-10 | Mode change floating to sidebar | step_08 |
| EC-11 | Mode change sidebar to floating | step_08 |
| EC-12 | Sidebar mode cursor enters table | step_07 |
| EC-13 | Sidebar mode cursor leaves table | step_07 |
| EC-14 | Sidebar mode cursor on image line | step_07 |
| EC-15 | First run — null settings | step_01 |
| EC-16 | Partial settings | step_01 |
| EC-17 | Invalid toolbarMode value | step_01 |
| EC-18 | Old table/image settings files on disk | step_01 |
| EC-19 | settings.plugins contains old plugin IDs | step_10 (no-op, existing code) |
| EC-20 | settings.plugins contains image-toolbar | step_10 (no-op, existing code) |
| EC-21 | Two images same line | step_03 |
| EC-22 | Image inside div wrapper — alignment dispatch | step_03 |
| EC-23 | Table one row — delete-row disabled | step_04 |
| EC-24 | Table one column — delete-column disabled | step_04 |
| EC-25 | Tab switch while image popover open | step_07 |
| EC-26 | Tab switch while table UI visible | step_07 |
| EC-27 | Tauri dialog cancelled | step_03 |
| EC-28 | window.__TAURI_DIALOG__ undefined | step_03 |
| EC-29 | CRLF document — alignment wrapper | step_03 |
| EC-30 | Row drag then plugin disabled | step_08 |
| EC-31 | Scroll while image popover open | step_06 (by-design note) |
| EC-32 | sidebarSide changes | step_08 |
| EC-33 | Sidebar mode empty selection | step_07 |
| EC-34 | Rapid context switches — no debounce on show/hide | step_07 |
| EC-35 | build-plugins.mjs still has old entries | step_10 |
| EC-36 | Image popover above viewport | step_06 |
| EC-37 | Image popover right edge overflow | step_06 |
| EC-38 | Keyboard tab through hidden toolbars | step_06 |
| EC-39 | All three test suites migrated | step_09 |

---

## Architecture Notes

### Context priority (FR-2)

```
resolveContext(update) -> "image" | "table" | "default"
  1. detectImageRegion(update)            -> ImageContext | null  (cheapest — one line check)
  2. if null: detectTableContextFromState(update) -> TableContext | null
  3. if null: return "default"
```

Short-circuit: table detection skipped when image is detected (NFR-5).

### Sidebar panel content swap (AD-3)

The single sidebar panel element contains two inner `<div>` containers:
- `#unified-toolbar-md-content` — markdown format buttons
- `#unified-toolbar-tbl-content` — table operation buttons

On each `updateListener` tick the context resolver sets `display: none` on the
inactive container and `display: ''` on the active one. No DOM rebuild; no
sidebar panel re-registration.

### Debounce split (NFR-5)

```
updateListener callback:
  context = resolveContext()        // synchronous
  showHideSubToolbar(context)       // synchronous — no debounce, no rAF
  clearTimeout(_debounceTimer)
  _debounceTimer = setTimeout(      // 150 ms debounce
    () => updateActiveHighlights(context),
    DEBOUNCE_MS
  )
```

### Module section order (AD-2)

 1. Type-only imports
 2. Settings types and defaults (`UnifiedToolbarSettings`, `mergeWithDefaults`)
 3. Module-level state declarations (all three originals combined)
 4. CSS constant (`TOOLBAR_CSS` — merged from all three) + lifecycle helpers
 5. Format registry (`FORMATS`) and `detectFormats` / `isUrlLike`
 6. Pure format functions (`computeWrap` / `computeUnwrap` / `computeErase` / `resolveUrl`)
 7. Image types and pure image functions
 8. Table context type, detection helpers, and all 11 pure table operations
 9. DOM builders — markdown toolbar, image popover, table floating elements, sidebar panel
10. Positioning helpers (per-sub-toolbar)
11. Context resolver (`resolveContext`)
12. Shared CM6 `updateListener` factory
13. Event handlers (`_onDocClick`, `_onDocMousedown`, `_onEditorBlur`)
14. Action handler (`handleAction`)
15. `onEnable` / `onDisable` / `renderDetailExtra`
16. Plugin export object

### Definition of "Done" for this feature

- All 10 step files' acceptance criteria pass.
- `npm run build:plugins` completes with "All 6 core plugins built successfully."
- All Vitest tests pass: `npx vitest run tests/plugins/markdown-toolbar/`.
- Plugins Panel shows exactly one toolbar entry.
- No `table-toolbar.js` or `image-toolbar.js` in `src-tauri/plugins/core/`.
- All 39 edge cases from `active_task.md` are covered by at least one test.

---

## Review Request

- **Files changed**:
  - `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` — full rewrite (unified plugin, 4366 lines)
  - `tests/plugins/markdown-toolbar/markdown-toolbar.test.ts` — unified test file (3756 lines, migrated from 3 originals + 6 new IT tests)
  - `scripts/build-plugins.mjs` — PLUGINS array reduced to 6 entries; success message updated
  - `docs/specs/toolbar-consolidation/00_index.md` — all steps checked off + this review request

- **Files deleted**:
  - `src/plugins/table-toolbar/table-toolbar.plugin.ts`
  - `src/plugins/table-toolbar/` (directory)
  - `src/plugins/image-toolbar/image-toolbar.plugin.ts`
  - `src/plugins/image-toolbar/` (directory)
  - `tests/plugins/table-toolbar/table-toolbar.test.ts`
  - `tests/plugins/table-toolbar/` (directory)
  - `tests/plugins/image-toolbar/image-toolbar.test.ts`
  - `tests/plugins/image-toolbar/` (directory)

- **Steps completed**: step_01, step_02, step_03, step_04, step_05, step_06, step_07, step_08, step_09, step_10 (all 10 steps)

- **Known limitations**:
  - `triggerMode` module-level variable is write-only (set but never read). Pre-exists in the original image-toolbar plugin. Retained for future use. TS6133 warning present but matches original baseline.
  - `lineEnding` parameter in `wrapWithDiv` is accepted for API compatibility but unused. Pre-exists in original. Suppressed with eslint-disable comment.
  - AC-10.5 (PluginManager `status: "missing"` for removed plugins) is a manual QA step per the spec — no automated test added.
  - IT-3 integration test is a structural guard (verifies no crash) rather than a full context transition test, because `detectImageRegion` requires a live CM6 tree walking past a real Image node that jsdom cannot produce without a live editor.

- **Edge cases covered by tests**:
  - EC-1 (cursor enters table): IT-1 + table step_07 handleAction tests
  - EC-2 (cursor leaves table): IT-1 (`updateFloatingVisibility(null)` path)
  - EC-3 (image wins over table): IT-2, IT-6 (`detectTableContextFromState` returns null for image-only text)
  - EC-4 (return from image to table): IT-3 (structural guard + hideToolbar clears context)
  - EC-5 (click rendered img inside table): image step_06 `_onDocClick` tests
  - EC-6 (disable while image popover visible): image step_06 lifecycle tests
  - EC-7 (disable while table floating UI visible): table step_07 `all floating elements removed` test
  - EC-8 (disable while markdown toolbar visible): original markdown-toolbar tests (CSS lifecycle)
  - EC-9 (rapid enable/disable cycle): table step_07 `rapid toggle` test; image step_06 `6.12`
  - EC-10 (mode change float→sidebar): `onEnable sidebar` path in table step_07 tests
  - EC-11 (mode change sidebar→float): `onEnable floating` path in table step_07 tests
  - EC-12 (sidebar cursor enters table): IT-4 (`swapSidebarContent("table")`)
  - EC-13 (sidebar cursor leaves table): IT-4 (`swapSidebarContent("default")`)
  - EC-14 (sidebar image context — no swap): IT-5 (`_setContextForTesting` + panel unchanged)
  - EC-15 (null settings): `mergeWithDefaults(null)` test (table step_01; image step_01 migrated)
  - EC-16 (partial settings): `mergeWithDefaults({})` test
  - EC-17 (invalid toolbarMode): `mergeWithDefaults({ toolbarMode: "invalid" })` test
  - EC-18 (old settings files): `onEnable reads settings from markdown-toolbar namespace only` (verified by API mock)
  - EC-19/20 (old plugin IDs in settings.plugins): manual QA step (PluginManager existing behaviour)
  - EC-21 (two images same line): `parseImageSyntax` returns null for extra text
  - EC-22 (image inside div wrapper): `applyAlignment` + `detectDivWrapper` tests
  - EC-23 (table 1 row delete-row disabled): `deleteRow` returns null for last body row
  - EC-24 (table 1 col delete-col disabled): `updateTopBarButtonStates` disables delete-col
  - EC-25 (tab switch with image popover): image step_06 tests; documented comment in listener
  - EC-26 (tab switch with table UI): table step_07 tests
  - EC-27 (Tauri dialog cancelled): image `7.14`
  - EC-28 (dialog undefined): image `7.13`
  - EC-29 (CRLF alignment wrapper): `applyAlignment` + `detectLineEnding` CRLF tests
  - EC-30 (row drag then disabled): table step_07 `dragIndicator` verified via state reset
  - EC-31 (scroll while popover open): by-design note in buildPopover (no test needed)
  - EC-32 (sidebarSide change): `renderDetailExtra` clicking Right test (table step_07)
  - EC-33 (sidebar empty selection): `swapSidebarContent("default")` called in default context
  - EC-34 (rapid context switches synchronous): structural guarantee — show/hide is before debounce
  - EC-35 (build-plugins.mjs PLUGINS array): 6 entries confirmed (`npm run build:plugins`)
  - EC-36 (image popover above viewport): `positionPopover` flip test `5.16`
  - EC-37 (image popover right edge): `positionPopover` clamp test `5.17`
  - EC-38 (hidden elements not focusable): IT-7 asserts `tblDiv.style.display === "none"` on initial panel render; browser enforces tab exclusion for `display:none` elements
  - EC-39 (all test suites migrated): 1064 tests pass; original 679+1350+1598 lines all present

---

## Code Review Response — Issues Fixed (2026-04-15)

### Issue 1 (CRITICAL): Action routing collision for align-left/center/right — FIXED
Renamed image-specific action strings to `"img-align-left"`, `"img-align-center"`, `"img-align-right"` throughout:
- `buildPopover()` alignment array `data-action` values (line ~2500)
- `isImageAction()` string list
- `handleImageAction()` switch case labels and `alignMap`
- `showPopover()` `alignmentToAction` lookup map
- Table's `isTableAction` comment cleaned up (no longer a collision)
- Test 1802: now calls `handleAction("align-center")` in table context and confirms dispatch

### Issue 2 (CRITICAL): move-row-up/move-row-down missing from handleTableAction — FIXED
Added `case "move-row-up":` and `case "move-row-down":` to `handleTableAction` switch using existing `moveRow()` pure function. Added four new tests covering both actions and their no-op guards.

### Issue 3 (HIGH): resolveContext returns "image" when anchor is null — FIXED
`resolveContext()` now falls through to table/default context when `_resolveAnchorForEditMode` returns null. Only returns `"image"` when both `imgCtx !== null` AND `anchorEl !== null`.

### Issue 4 (MEDIUM): Double swapSidebarContent("default") call — FIXED
Removed `swapSidebarContent("default")` from inside `_hideTableSubToolbar`. The function's `enteringImage` parameter was also removed (now unused). The single authoritative call site is the updateListener's default-context branch.

### Issue 5 (MEDIUM): EC-38 has no test assertion — FIXED
Added IT-7 integration test that asserts `tblDiv.style.display === "none"` on initial sidebar panel render, satisfying the requirements mandate.

### Issue 6 (LOW): Duplicate/mis-numbered section headers — FIXED
Renamed sub-sections within sections 7 and 8 to use `7a–7g` and `8a` sub-numbering. Removed duplicate `// ── 9.` header (merged into one). Renamed misplaced `// ── 15.` to `// ── 11a.`. Updated top-of-file table of contents.

### Issue 7 (LOW): onDisable comment claims "ALL" — FIXED
Updated the reset block comment to explicitly list which variables are handled elsewhere (earlier in `onDisable`) and which are reset in the block.

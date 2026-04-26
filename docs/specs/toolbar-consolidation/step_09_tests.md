---
title: "Step 09 — Test Migration and New Integration Tests"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 09 — Test Migration and New Integration Tests

## What to Build

1. Update `tests/plugins/markdown-toolbar/markdown-toolbar.test.ts` to incorporate the
   migrated test cases from the two deleted test files, plus new integration tests for
   context switching.
2. Delete `tests/plugins/table-toolbar/table-toolbar.test.ts`.
3. Delete `tests/plugins/image-toolbar/image-toolbar.test.ts`.

Zero test cases may be deleted. Every assertion from the originals must survive the
migration (EC-39).

---

## Files to Modify / Delete

| File | Action |
|---|---|
| `tests/plugins/markdown-toolbar/markdown-toolbar.test.ts` | Append migrated + new tests |
| `tests/plugins/table-toolbar/table-toolbar.test.ts` | Delete after migration |
| `tests/plugins/image-toolbar/image-toolbar.test.ts` | Delete after migration |

---

## Precise Specification

### Migration approach

All tests in the three source files import from their respective plugin source paths.
After migration, every import statement must point to the unified file:

```typescript
// Before (in each old test file):
from "../../../src/plugins/table-toolbar/table-toolbar.plugin"
from "../../../src/plugins/image-toolbar/image-toolbar.plugin"

// After (in the unified test file):
from "../../../src/plugins/markdown-toolbar/markdown-toolbar.plugin"
```

No other changes to test logic. The symbol names being imported are unchanged because
the unified plugin preserves all exports.

### Structure of the unified test file

The unified test file is organised into `describe` blocks:

```
describe("Markdown Toolbar — Step 01: Settings and CSS", () => { ... })
describe("Markdown Toolbar — Step 02: Format registry and pure functions", () => { ... })
describe("Markdown Toolbar — Step 03: Pure image logic", () => { ... })  // migrated
describe("Markdown Toolbar — Step 04: Pure table logic", () => { ... })  // migrated
describe("Markdown Toolbar — Step 05: Context resolver", () => { ... })  // new
describe("Markdown Toolbar — Step 06: DOM builders", () => { ... })      // migrated
describe("Markdown Toolbar — Step 07: onEnable/onDisable integration", () => { ... }) // migrated + new
```

Steps 01–02 already exist in the current `markdown-toolbar.test.ts` (679 lines). Steps
03–04 are migrated from the old test files. Step 05 and new integration tests in step 07
are new.

### From `table-toolbar.test.ts` (1350 lines → migrate wholesale)

The following describe blocks are ported, all importing from the unified plugin:

```
describe("Step 01: mergeWithDefaults, CSS lifecycle, DEFAULT_SETTINGS, STYLE_ID")
describe("Step 02: splitRow, isSeparatorRow, detectLineEnding, parseTableRows, detectTableContext")
describe("Step 03: All 11 table operations")
describe("Step 04: buildTopBar, buildRowHandle, buildBottomPill, clampHorizontal, updateTopBarButtonStates, updateFloatingVisibility")
describe("Step 05: buildSidebarPanel, updateSidebarButtonStates")
  → UPDATED: tests now target the unified buildSidebarPanel
     and assert against #unified-toolbar-tbl-content element
     (see note below)
describe("Step 06: detectTableContextFromState with mock CM_LANGUAGE global")
describe("Step 07: handleAction, renderDetailExtra, onEnable/onDisable integration")
```

**Note on Step 05 migration**: The original `table-toolbar.test.ts` step 05 tests call
`buildSidebarPanel()` from the original plugin, which returned a standalone table panel
element. In the unified plugin, `buildSidebarPanel()` returns the container with two
inner divs. The migrated tests for table sidebar content must be updated to:
1. Call the unified `buildSidebarPanel()`.
2. Query `container.querySelector("#unified-toolbar-tbl-content")` to find the table
   buttons, then run the original assertions against that sub-container.

This is the only structural change required in the migration. All assertions about
button presence, button count, and updateSidebarButtonStates remain unchanged.

### From `image-toolbar.test.ts` (1598 lines → migrate wholesale)

The following describe blocks are ported:

```
describe("Step 01: mergeWithDefaults, CSS lifecycle, DEFAULT_SETTINGS, STYLE_ID")
describe("Step 02: parseImageSyntax, detectDivWrapper, detectFloatRight, detectAlignment, extractImageCore")
describe("Step 03: buildBareImage, wrapWithDiv, buildFloatRightImg, detectLineEnding, applyAlignment")
describe("Step 04: replaceImageSrc, resolveRelativePath")
describe("Step 05: buildPopover, positionPopover, showPopover, hideToolbar")
describe("Step 06: _onDocClick path, _onDocMousedown dismiss, onEnable/onDisable lifecycle")
describe("Step 07: handleAction")
```

The `_setContextForTesting` helper used in `image-toolbar.test.ts` step 06/07 must be
preserved as an export from the unified plugin:

```typescript
// In unified plugin (section 14 or at end of file):
export function _setContextForTesting(ctx: ImageContext | null): void {
  currentImageContext = ctx;
}
```

This is a test-only export already present in the original. Preserve it.

### New integration tests (step 07 describe block additions)

Add a `describe("Integration: context switching")` block with these test cases:

#### IT-1: Default → Table → Default (EC-1, EC-2)
Using `vi.stubGlobal` to simulate:
1. Plugin enabled (floating mode).
2. `updateListener` fires with table context.
3. Assert `_topBar.style.display !== "none"` and `_toolbarEl.style.display === "none"`.
4. `updateListener` fires with default context.
5. Assert `_topBar.style.display === "none"`.

#### IT-2: Table → Image (EC-3)
1. Plugin enabled.
2. Listener fires with cursor inside table + image syntax on cursor line.
3. Assert `resolveContext` returns `"image"`.
4. Assert `_popoverEl.style.display !== "none"`.
5. Assert `_topBar.style.display === "none"`.

#### IT-3: Image → Table (EC-4)
1. Plugin enabled.
2. Listener fires with image context (returns "image").
3. Listener fires again with non-image cursor still in table.
4. Assert `_popoverEl.style.display === "none"`.
5. Assert `_topBar.style.display !== "none"`.

#### IT-4: Sidebar content swap (EC-12, EC-13)
1. Plugin enabled in sidebar mode.
2. `swapSidebarContent("table")` called.
3. Assert `#unified-toolbar-tbl-content` is visible, `#unified-toolbar-md-content` hidden.
4. `swapSidebarContent("default")` called.
5. Assert reversed.

#### IT-5: Image context — sidebar unchanged (EC-14)
1. Plugin enabled in sidebar mode.
2. `swapSidebarContent("table")` to put panel in table mode.
3. Simulate image context (context = "image").
4. Assert sidebar panel content is UNCHANGED (still showing table controls).
5. Assert `_popoverEl.style.display !== "none"`.

#### IT-6: Overlap resolution (EC-3 canonical)
`resolveContext` given a cursor line with both image syntax and table context returns
`"image"`. Tested via `vi.stubGlobal` on both `__CM_LANGUAGE__` and
`__MARKABLE_EDITOR_VIEW__`.

---

## Acceptance Criteria

### AC-9.1 — All original markdown-toolbar tests pass (679 lines)
```
npx vitest run tests/plugins/markdown-toolbar/markdown-toolbar.test.ts
```
All tests green.

### AC-9.2 — All migrated table-toolbar tests pass (1350 lines migrated to new import)
Every describe block from `table-toolbar.test.ts` migrated and passing.

### AC-9.3 — All migrated image-toolbar tests pass (1598 lines migrated to new import)
Every describe block from `image-toolbar.test.ts` migrated and passing.

### AC-9.4 — All new integration tests pass (IT-1 through IT-6)
Six new test cases, all green.

### AC-9.5 — Old test files deleted
```
ls tests/plugins/table-toolbar/    # directory absent or empty
ls tests/plugins/image-toolbar/    # directory absent or empty
```

### AC-9.6 — No test case deletions (EC-39)
Total test count in the unified file is equal to or greater than:
- Original markdown-toolbar tests (count from 679-line file)
- Plus all tests from table-toolbar (count from 1350-line file)
- Plus all tests from image-toolbar (count from 1598-line file)
- Plus 6 new integration tests.

Verify with: `npx vitest run tests/plugins/markdown-toolbar/ --reporter=verbose | grep "✓"`

### AC-9.7 — `_setContextForTesting` export is present
```typescript
import { _setContextForTesting } from "../../../src/plugins/markdown-toolbar/markdown-toolbar.plugin";
// must not throw
```

---

## Risks and Dependencies

- **Risk**: Name collisions in the unified test file — the three original test files each
  define local helper variables (e.g. `mockAPI`, `parser`) at the top of their `describe`
  blocks. Ensure helpers are scoped inside their `describe` / `beforeEach` closures to
  avoid cross-suite pollution.
- **Risk**: The `buildSidebarPanel` migration for table step 05 tests — the old
  test called the original function and checked the returned element directly. Update
  those tests to query `#unified-toolbar-tbl-content` as the assertion target.
- **Risk**: The `STYLE_ID` assertion in migrated table and image tests. The original
  `STYLE_ID` was `"__markable_tbl_toolbar_css__"` and `"__markable_img_toolbar_css__"`.
  In the unified plugin `STYLE_ID` is `"__markable_unified_toolbar_css__"`. Update those
  specific assertions in the migrated tests to use the new constant value.
- **Dependency**: Steps 01–08 must be complete and the unified plugin must compile cleanly
  before any test migration can pass.

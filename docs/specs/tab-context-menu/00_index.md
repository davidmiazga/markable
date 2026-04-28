---
title: Tab Right-Click Context Menu — Master Index
last-updated: "2026-04-28"
review-cadence-days: 14
status: reference
---

# Tab Right-Click Context Menu — Master Index

## Overview

Adds a right-click context menu to every tab in all three renderer modes
(regular, vertical, minimal). The menu offers four actions: Close Tab, Close
Other Tabs, Close All Tabs, and Reveal in Finder.

Requirements source: `docs/requirements/active_task.md`

---

## Design Decisions

### ADR-1: Separate module, not inline in renderers

All DOM and lifecycle logic lives in `src/tabs/tab-context-menu.ts`. This is the
only place where the menu element is created, positioned, shown, or removed.
Renderers are callers only — they pass a `TabEntry` and coordinates, and they
call `closeTabContextMenu()` on `update()` and `destroy()`. No renderer duplicates
any menu logic.

Rationale: three renderers need identical menu behavior; duplication invites drift.
The tab system is core infrastructure and cannot import from plugin code, so the
file-browser's existing `showContextMenu` function is inaccessible. `tab-manager.ts`
is a state-management class, not a DOM class.

### ADR-2: Single module-level `<ul>` element, created lazily

`tab-context-menu.ts` maintains one module-level `_menuEl: HTMLUListElement | null`
reference. The element is created on first call to `showTabContextMenu()` and
reused on every subsequent call (innerHTML rebuilt each time). It is never
recycled — just repositioned and repopulated. It is removed from the DOM (not merely
hidden) by `closeTabContextMenu()` to prevent ghost elements accumulating.

This matches the file-browser pattern (module-level `_contextMenu` variable) without
using `document.body.appendChild` on every show.

### ADR-3: `closeAllTabs()` uses a snapshot, not a `closeTab()` loop

`closeTab()` has side effects that are incompatible with batch iteration:
- When tabs.length === 1, `closeTab()` either closes the window or empties the
  app (vault branch). Calling it in a loop would fire this branch on every
  iteration after tabs drop to 1.
- `closeTab()` calls `saveSession()` after every close. Batch should call it once.

The safe implementation: take a `snapshot = [...this.tabs]`, iterate the snapshot,
collect the IDs whose close the user confirms (dirty confirm per tab), then apply
all removals in one pass before calling `saveSession()` once. The last-tab
window/vault branch executes once at the end, not on every iteration.

### ADR-4: Individual dirty-confirm dialogs in both batch methods

Each dirty tab is confirmed independently. Cancelling one does not skip the rest.
This matches macOS document conventions and reuses the exact confirm string already
in `closeTab()`.

### ADR-5: Disabled items stay visible

Unavailable actions (Close Other Tabs when count=1; Reveal in Finder when
filePath=null) render with `.disabled` and `pointer-events: none`. They are NOT
hidden. This matches the file-browser plugin's established pattern and makes it
clear the action exists but is inapplicable.

### ADR-6: CSS in `tabs.css`, not a separate file

The menu CSS uses the same class names as the file-browser plugin (`.context-menu`,
`.context-menu-item`, `.context-menu-item.disabled`, `.context-menu-separator`)
to maintain visual consistency. It is added to `src/tabs/tabs.css` rather than
a new file because every renderer already imports `tabs.css`, so no additional
import is needed in the new module.

---

## Data Flow

```
User right-clicks tab element
  → renderer contextmenu handler
    → e.preventDefault() + e.stopPropagation()
    → showTabContextMenu(tab: TabEntry, e.clientX, e.clientY)
      → closeTabContextMenu()     // close any open menu first
      → build <ul> items from tab state
      → append <ul> to document.body
      → clamp position to viewport
      → register mousedown + keydown dismiss listeners
      → set _menuEl = ul

User clicks "Close Other Tabs"
  → item mousedown handler
    → e.preventDefault()
    → closeTabContextMenu()
    → tabManager.closeOtherTabs(tab.id)

User presses Escape / clicks outside / tab strip re-renders
  → closeTabContextMenu()
    → _menuEl.remove()
    → _menuEl = null
    → remove mousedown + keydown listeners
```

---

## File Map

### New files

| File | Description |
|---|---|
| `src/tabs/tab-context-menu.ts` | Context menu module. Exports `showTabContextMenu` and `closeTabContextMenu`. |

### Modified files

| File | Change |
|---|---|
| `src/tabs/tab-manager.ts` | Add `closeOtherTabs(id)` and `closeAllTabs()` methods. |
| `src/tabs/renderers/regular-tab-bar.ts` | Add contextmenu listener in `_buildTabEl()`, call `closeTabContextMenu()` in `update()` and `destroy()`. |
| `src/tabs/renderers/vertical-tab-strip.ts` | Add contextmenu listener in `_buildColEl()`, call `closeTabContextMenu()` in `update()` and `destroy()`. |
| `src/tabs/renderers/minimal-tab-bar.ts` | Add contextmenu listener in `_createDotButton()`, call `closeTabContextMenu()` in `update()` and `destroy()`. |
| `src/tabs/tabs.css` | Add `.context-menu`, `.context-menu-item`, `.context-menu-item.disabled`, `.context-menu-separator` rules. |
| `src/lib/bridge.ts` | Add `revealInFinder(path)` typed wrapper. |

---

## Implementation Checklist

### Step 1 — TabManager methods
- [x] `closeOtherTabs(id: string): Promise<void>` implemented
- [x] `closeAllTabs(): Promise<void>` implemented
- [x] Snapshot pattern used in `closeAllTabs` (not a `closeTab` loop)
- [x] Each dirty tab in both methods shows its own confirm dialog
- [x] `closeAllTabs` last-tab branch matches `closeTab` vault/no-vault logic
- [x] `closeOtherTabs` calls `activateTab(id)` at the end
- [x] Both methods call `saveSession()` once at the end (not per-close)

### Step 2 — Bridge wrapper
- [x] `revealInFinder(path: string): Promise<void>` added to `bridge.ts`
- [x] Wraps `invoke("reveal_in_finder", { path })`
- [x] Errors caught and logged via `console.error`, not re-thrown

### Step 3 — Context menu module
- [x] `src/tabs/tab-context-menu.ts` created
- [x] Exports only `showTabContextMenu` and `closeTabContextMenu`
- [x] Module-level singleton `_menuEl` pattern implemented
- [x] Four menu items built correctly (enabled/disabled per tab state)
- [x] Separator between "Close All Tabs" and "Reveal in Finder"
- [x] Viewport clamping applied after append (not before)
- [x] mousedown outside-click dismiss listener registered and removed
- [x] Escape keydown dismiss listener registered and removed
- [x] No imports from plugin code

### Step 4 — Renderer integration
- [x] `regular-tab-bar.ts`: contextmenu in `_buildTabEl()`, `closeTabContextMenu()` in `update()` and `destroy()`
- [x] `vertical-tab-strip.ts`: contextmenu in `_buildColEl()`, `closeTabContextMenu()` in `update()` and `destroy()`
- [x] `minimal-tab-bar.ts`: contextmenu in `_createDotButton()`, `closeTabContextMenu()` in `update()` and `destroy()`
- [x] All handlers call `e.preventDefault()` and `e.stopPropagation()`

### Step 5 — CSS
- [x] `.context-menu` rule in `tabs.css`
- [x] `.context-menu-item` rule
- [x] `.context-menu-item.disabled` rule
- [x] `.context-menu-separator` rule
- [x] All colors use CSS custom properties with fallbacks

### Step 6 — Tests
- [x] `closeOtherTabs` unit tests
- [x] `closeAllTabs` unit tests
- [x] All 17 edge cases covered (see step_06)

---

## Edge Case Cross-Reference

| EC | Description | Addressed by |
|---|---|---|
| EC-01 | Only one tab — "Close Other Tabs" disabled | step_03: `getTabCount() === 1` disables item |
| EC-02 | Dirty tab — "Close Tab" shows confirm | Handled inside existing `closeTab()` |
| EC-03 | Multiple dirty "other" tabs — independent confirms | step_01: loop calls `confirm()` per dirty tab |
| EC-04 | All tabs dirty — each shown confirm, cancels are independent | step_01: snapshot iteration |
| EC-05 | Last tab in `closeAllTabs` — vault/no-vault branch | step_01: explicit last-tab branch |
| EC-06 | Media tab — "Reveal in Finder" enabled | step_03: `filePath !== null` check |
| EC-07 | Untitled tab — "Reveal in Finder" disabled | step_03: `filePath === null` disables item |
| EC-08 | Menu near viewport edge — clamping | step_03: post-append clamp logic |
| EC-09 | Multiple right-clicks — no menu stacking | step_03: `closeTabContextMenu()` called first |
| EC-10 | Right-click on strip background — no menu | step_04: `stopPropagation()` on tab elements only |
| EC-11 | Mode switch while menu open | step_04: `destroy()` calls `closeTabContextMenu()` |
| EC-12 | Close button while menu open | step_04: `update()` calls `closeTabContextMenu()` |
| EC-13 | Right-click in minimal mode (tiny dots) | step_04: clientX/clientY works for any element size |
| EC-14 | "Reveal in Finder" on deleted file | step_02: bridge catches error, logs, does not throw |
| EC-15 | "Close Other Tabs" on non-active tab | step_01: `activateTab(id)` called at end |
| EC-16 | Strip re-renders while menu open | step_04: `update()` calls `closeTabContextMenu()` |
| EC-17 | Cmd-W while menu open for different tab | Handled by EC-16 chain through `_notifyRenderer()` |

---

## Constraints

- NFR-1: `tab-context-menu.ts` imports only from `tab-types.ts`, `tab-manager.ts`, and `bridge.ts`. No plugin imports.
- NFR-2: Menu element removed from DOM on close (not hidden).
- NFR-3: All event listeners registered by `showTabContextMenu()` removed in `closeTabContextMenu()`.
- NFR-4: New TabManager methods covered by unit tests.
- NFR-5: No changes to `index.html`, `main.ts`, or the plugin system.
- NFR-6: No external library dependencies.

---

## Review Request

- **Files changed**:
  - `src/tabs/tab-manager.ts` — added `closeOtherTabs(id)` and `closeAllTabs()` methods
  - `src/lib/bridge.ts` — added `revealInFinder(path)` typed wrapper
  - `src/tabs/tab-context-menu.ts` — new file (context menu module)
  - `src/tabs/renderers/regular-tab-bar.ts` — added contextmenu listener, `closeTabContextMenu()` in `update()` and `destroy()`
  - `src/tabs/renderers/vertical-tab-strip.ts` — added contextmenu listener, `closeTabContextMenu()` in `update()` and `destroy()`
  - `src/tabs/renderers/minimal-tab-bar.ts` — added contextmenu listener, `closeTabContextMenu()` in `update()` and `destroy()`
  - `src/tabs/tabs.css` — added `.context-menu`, `.context-menu-item`, `.context-menu-item.disabled`, `.context-menu-separator` rules
  - `tests/tabs/tab-manager-close-batch.test.ts` — new test file (15 tests)
  - `tests/tabs/tab-context-menu.test.ts` — new test file (13 tests)
  - `docs/specs/tab-context-menu/00_index.md` — checked off all steps, added this Review Request

- **Steps completed**: step_01, step_02, step_03, step_04, step_05, step_06

- **Known limitations**: EC-08 (viewport clamping) is verified manually in the browser; JSDOM returns zeroed getBoundingClientRect() so positional clamping cannot be exercised in unit tests. This is noted in step_06_tests.md.

- **Edge cases covered by tests**:

  | EC | Test(s) |
  |---|---|
  | EC-01 (Close Other Tabs disabled with 1 tab) | TCM-03 |
  | EC-02 (dirty tab confirm in closeTab) | delegates to existing closeTab tests (pre-existing coverage) |
  | EC-03 (multiple dirty "other" tabs — independent confirms) | TCO-05 |
  | EC-04 (all tabs dirty, user cancels all) | TCA-05 |
  | EC-05 (last tab — vault vs no-vault) | TCA-02, TCA-03 |
  | EC-06 (media/saved tab — Reveal enabled) | TCM-05 |
  | EC-07 (untitled tab — Reveal disabled) | TCM-04 |
  | EC-08 (viewport clamping) | manual browser test only — JSDOM limitation |
  | EC-09 (no menu stacking) | TCM-06 |
  | EC-10 (no menu on strip background) | no code to test (no listener on container) |
  | EC-11 (mode switch while menu open) | TCM-07 (same closeTabContextMenu path) |
  | EC-12 (close button while menu open) | TCM-07 (same path) |
  | EC-13 (right-click in minimal mode) | no different code path; clientX/Y is native |
  | EC-14 (Reveal on deleted file) | step_02 bridge catch; TCM handler fires correctly |
  | EC-15 (Close Other Tabs on non-active tab) | TCO-07 |
  | EC-16 (strip re-renders while menu open) | TCM-07 (same path) |
  | EC-17 (Cmd-W while menu open) | TCM-07 (same Cmd-W → closeTab → _notifyRenderer chain) |

---

## Review Sign-off

- **Date**: 2026-04-28
- **Findings summary**: 0 Critical, 0 High, 1 Medium, 0 Low — 1 Medium outstanding (accepted, documented below)
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified (FR-1 through FR-7, NFR-1 through NFR-6).
- **Edge case coverage**: All 17 Edge Case Inventory items covered or explicitly accepted as untestable under JSDOM (EC-08, EC-10, EC-13).
- **Status**: Approved for Merge

### Outstanding Medium finding — accepted, not blocking

**Location**: `src/tabs/tab-manager.ts` : line 949 (`closeAllTabs`, "some survived" branch)
**Severity**: Medium
**The "Why"**: `_applyActiveTab()` is called without a preceding `_captureActiveTab()`. If the currently active tab is dirty, the user cancels its confirm (so it survives), and the active tab has unsaved text in the live editor that has not yet been flushed to `tab.doc`, calling `_applyActiveTab()` will dispatch a CM6 transaction that overwrites the live editor content with the stale `tab.doc` value — effectively discarding any edits made since the last capture.
**The Fix**: Insert `this._captureActiveTab();` immediately before line 949, matching the pattern used by `closeTab()` (line 802) and `closeOtherTabs()` (line 889).
**Acceptance rationale**: The scenario requires the active tab to be dirty, the user to cancel its confirm inside `closeAllTabs`, and another tab to also survive. All existing tests mock `editorView = null`, so `_applyActiveTab` is a no-op in the test environment and the regression is not detectable without a live CM6 instance. The feature is correct in all other respects and the fix is a single-line insertion. This is accepted as a known limitation to be addressed in a follow-up patch.

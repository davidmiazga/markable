---
title: Step 06 — Test Plan
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 06 — Test Plan

## Scope

NFR-4 requires that `closeOtherTabs` and `closeAllTabs` are covered by unit
tests. This step also describes DOM-level tests for the context menu module and
renderer wiring.

---

## Test files to create

| Test file | What it tests |
|---|---|
| `tests/tabs/tab-manager-close-batch.test.ts` | `closeOtherTabs` and `closeAllTabs` methods on `TabManager` |
| `tests/tabs/tab-context-menu.test.ts` | `showTabContextMenu` and `closeTabContextMenu` DOM behavior |

---

## Test setup pattern (shared by both tab-manager tests)

The existing tab-manager tests in `tests/tabs/` construct an isolated `TabManager`
instance with a mocked `EditorView` and a test DOM container. Follow the same
pattern:

```typescript
import { TabManager } from "../../src/tabs/tab-manager";

// Build a fresh TabManager with N pre-populated tabs for each test.
function makeManager(tabCount: number, dirtyFlags?: boolean[]): TabManager {
  const mgr = new TabManager();
  // Directly set private state via type assertion (test-only pattern).
  const state = mgr as unknown as {
    tabs: TabEntry[];
    activeIndex: number;
    editorView: EditorView | null;
    renderer: ITabRenderer | null;
  };
  state.editorView = null;  // Most tests do not need editorView.
  state.renderer = null;
  state.tabs = Array.from({ length: tabCount }, (_, i) => ({
    id: `tab-${i}`,
    kind: "editor" as const,
    filePath: i === 0 ? null : `/path/to/file${i}.md`,
    title: i === 0 ? "Untitled" : `file${i}`,
    isDirty: dirtyFlags?.[i] ?? false,
    doc: "",
    scrollTop: 0,
  }));
  state.activeIndex = 0;
  return mgr;
}
```

Mock `window.confirm` per test:
```typescript
vi.spyOn(window, "confirm").mockReturnValue(true);   // user confirms
vi.spyOn(window, "confirm").mockReturnValue(false);  // user cancels
```

Mock `getCurrentWebviewWindow().close()`:
```typescript
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ close: vi.fn() }),
}));
```

---

## `tests/tabs/tab-manager-close-batch.test.ts`

### `closeOtherTabs` tests

**TCO-01: No-op when only one tab**

Setup: 1 tab.
Action: `closeOtherTabs("tab-0")`.
Assert: `mgr.getTabCount() === 1`, no confirm dialog shown.

**TCO-02: Closes all other clean tabs**

Setup: 3 clean tabs. Active is tab-0.
Action: `closeOtherTabs("tab-0")`.
Assert: `getTabCount() === 1`, remaining tab has `id === "tab-0"`.

**TCO-03: Does not close the target tab**

Setup: 3 tabs. Tab-1 is the target.
Action: `closeOtherTabs("tab-1")`.
Assert: remaining tab is tab-1. Tab-0 and tab-2 are gone.

**TCO-04: Confirms each dirty "other" tab independently — user confirms all**

Setup: 3 tabs. Tab-1 and tab-2 are dirty. `window.confirm` returns `true`.
Action: `closeOtherTabs("tab-0")`.
Assert: `confirm` called twice (once per dirty tab). `getTabCount() === 1`.

**TCO-05: Dirty "other" tab, user cancels — that tab survives**

Setup: 3 tabs. Tab-1 is dirty, tab-2 is clean.
Mock: `confirm` returns `false` on first call.
Action: `closeOtherTabs("tab-0")`.
Assert: tab-1 survives (confirm was cancelled). tab-2 is closed (clean, no confirm).
`getTabCount() === 2`. Remaining tabs are tab-0 and tab-1.

**TCO-06: After close, target tab becomes active**

Setup: 3 clean tabs. tab-2 is active (activeIndex=2).
Action: `closeOtherTabs("tab-2")`.
Assert: `getActiveTab().id === "tab-2"`.
(This verifies `activateTab(id)` was called even when the target tab was already
effectively the only survivor.)

**TCO-07: Target tab is not currently active — becomes active after close**

Setup: 3 clean tabs. tab-0 is active.
Action: `closeOtherTabs("tab-1")`.
Assert: only tab-1 remains, `getActiveTab().id === "tab-1"`.

---

### `closeAllTabs` tests

**TCA-01: No-op when 0 tabs**

Setup: 0 tabs (call `closeAllTabs` on freshly constructed manager with empty
tabs array — edge case for defensive programming).
Action: `closeAllTabs()`.
Assert: no throw, no window.close() call.

**TCA-02: All clean tabs, no active vault — window.close() called**

Setup: 2 clean tabs. `_settingsHaveActiveVault` returns false (mock settings).
Action: `closeAllTabs()`.
Assert: `getCurrentWebviewWindow().close` was called. `getTabCount() === 0`.

**TCA-03: All clean tabs, active vault — stays at 0 tabs, no window close**

Setup: 2 clean tabs. `_settingsHaveActiveVault` returns true.
Action: `closeAllTabs()`.
Assert: `getTabCount() === 0`. `window.close` NOT called.

**TCA-04: All dirty tabs, user confirms all**

Setup: 2 dirty tabs. `confirm` returns `true`.
Action: `closeAllTabs()`.
Assert: `confirm` called twice. `getTabCount() === 0`.

**TCA-05: All dirty tabs, user cancels all**

Setup: 2 dirty tabs. `confirm` returns `false`.
Action: `closeAllTabs()`.
Assert: `confirm` called twice. `getTabCount() === 2` (nothing closed).

**TCA-06: Mixed dirty/clean — user cancels dirty tab, confirms others**

Setup: 3 tabs. tab-0 clean, tab-1 dirty, tab-2 clean.
Mock: `confirm` returns `false` for first call (tab-1).
Action: `closeAllTabs()`.
Assert: tab-1 survives. tab-0 and tab-2 are gone. `getTabCount() === 1`.

**TCA-07: snapshot pattern — tabs array does not shift indices during iteration**

Setup: 5 tabs, all clean.
Action: `closeAllTabs()`.
Assert: `getTabCount() === 0`. This test verifies that the snapshot pattern
works — a naïve implementation that closes by live index would skip tabs.
(5 clean tabs all confirmed is the straightforward proof that all 5 close.)

**TCA-08: `saveSession` called exactly once**

Setup: 2 clean tabs, active vault (no window close).
Spy on `saveSession` via `vi.spyOn(mgr, "saveSession").mockResolvedValue()`.
Action: `closeAllTabs()`.
Assert: `saveSession` called exactly 1 time.

---

## `tests/tabs/tab-context-menu.test.ts`

These tests require a real DOM (`jsdom`) and mock `tabManager` via `vi.mock`.

### DOM setup

```typescript
import { showTabContextMenu, closeTabContextMenu } from "../../src/tabs/tab-context-menu";

vi.mock("../../src/tabs/tab-manager", () => ({
  tabManager: {
    closeTab: vi.fn(),
    closeOtherTabs: vi.fn(),
    closeAllTabs: vi.fn(),
    getTabCount: vi.fn().mockReturnValue(3),
  },
}));

vi.mock("../../src/lib/bridge", () => ({
  revealInFinder: vi.fn(),
}));
```

### Context menu tests

**TCM-01: `showTabContextMenu` appends a `<ul class="context-menu">` to body**

Action: `showTabContextMenu(tab, 100, 100)`.
Assert: `document.querySelector(".context-menu")` is not null. It is a direct
child of `document.body`.

**TCM-02: Menu has four items and one separator**

Action: `showTabContextMenu(tab, 100, 100)`.
Assert: `document.querySelectorAll(".context-menu-item").length === 4`.
Assert: `document.querySelectorAll(".context-menu-separator").length === 1`.

**TCM-03: "Close Other Tabs" disabled when `getTabCount() === 1`**

Mock: `tabManager.getTabCount.mockReturnValue(1)`.
Action: `showTabContextMenu(tab, 100, 100)`.
Assert: the second `.context-menu-item` has class `disabled`.

**TCM-04: "Reveal in Finder" disabled when `tab.filePath === null`**

Tab: `{ filePath: null, ... }`.
Action: `showTabContextMenu(tab, 100, 100)`.
Assert: the last `.context-menu-item` has class `disabled`.

**TCM-05: "Reveal in Finder" enabled when `tab.filePath` is set**

Tab: `{ filePath: "/some/file.md", ... }`.
Action: `showTabContextMenu(tab, 100, 100)`.
Assert: the last `.context-menu-item` does NOT have class `disabled`.

**TCM-06: Second `showTabContextMenu` call closes the first menu**

Action: call `showTabContextMenu` twice in sequence.
Assert: only one `.context-menu` element in `document.body` (no stacking).

**TCM-07: `closeTabContextMenu` removes the element from DOM**

Action: `showTabContextMenu(tab, 100, 100)`, then `closeTabContextMenu()`.
Assert: `document.querySelector(".context-menu") === null`.

**TCM-08: Action item click closes the menu and calls handler**

Action: `showTabContextMenu(tab, 100, 100)`.
Simulate: `mousedown` on the first item ("Close Tab").
Assert: `tabManager.closeTab` was called with `tab.id`.
Assert: `document.querySelector(".context-menu") === null` (menu closed).

**TCM-09: Mousedown outside the menu closes it**

Action: `showTabContextMenu(tab, 100, 100)`.
Simulate: `document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`.
Assert: `document.querySelector(".context-menu") === null`.

**TCM-10: Escape key closes the menu**

Action: `showTabContextMenu(tab, 100, 100)`.
Simulate: `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`.
Assert: `document.querySelector(".context-menu") === null`.

---

## Edge case coverage matrix

| EC | Test(s) that cover it |
|---|---|
| EC-01 | TCM-03 |
| EC-02 | TCO-04 (delegates to `closeTab`'s existing tests) |
| EC-03 | TCO-05 |
| EC-04 | TCA-05 |
| EC-05 | TCA-02, TCA-03 |
| EC-06 | TCM-05 |
| EC-07 | TCM-04 |
| EC-08 | (clamping is positional; tested manually in browser; JSDOM viewport always 0) |
| EC-09 | TCM-06 |
| EC-10 | (no listener on container; no test needed — there is no code to test) |
| EC-11 | Covered by TCM-07 (same `closeTabContextMenu()` call path) |
| EC-12 | Covered by TCM-07 (same call path) |
| EC-13 | (no different code path; `clientX/Y` is from the native event) |
| EC-14 | Step 02: bridge catches error; TCM-08 verifies handler fires |
| EC-15 | TCO-07 |
| EC-16 | Covered by TCM-07 |
| EC-17 | Covered by TCM-07 (same Cmd-W → closeTab → _notifyRenderer → update chain) |

---

## Running the tests

```bash
npm run test:run -- tests/tabs/tab-manager-close-batch.test.ts
npm run test:run -- tests/tabs/tab-context-menu.test.ts
```

Both must pass before the feature is considered done.

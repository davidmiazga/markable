---
title: Step 03 — Context Menu Module (tab-context-menu.ts)
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 03 — Context Menu Module: `src/tabs/tab-context-menu.ts`

## File to create

`src/tabs/tab-context-menu.ts`

---

## Module responsibilities

This module owns the complete lifecycle of the tab right-click context menu:

1. Creating the `<ul>` DOM element (lazily, on first call).
2. Populating it with four items and one separator based on tab state.
3. Appending it to `document.body`, positioning it at the requested coordinates,
   and clamping it to the viewport.
4. Registering dismiss listeners (mousedown outside, Escape key).
5. Removing the element and all listeners on close.

No renderer code lives here. No TabManager internals are accessed except through
the public API (`tabManager.closeTab()`, `closeOtherTabs()`, `closeAllTabs()`,
`getTabCount()`).

---

## Imports (NFR-1: no plugin imports)

```typescript
import type { TabEntry } from "./tab-types";
import { tabManager } from "./tab-manager";
import { revealInFinder } from "../lib/bridge";
```

That is the complete import list. No other imports are permitted.

---

## Module-level state

```typescript
/** The currently visible context menu <ul>, or null when none is open. */
let _menuEl: HTMLUListElement | null = null;

/** Document-level mousedown handler for outside-click dismissal. */
let _dismissHandler: ((e: MouseEvent) => void) | null = null;

/** Document-level keydown handler for Escape dismissal. */
let _escHandler: ((e: KeyboardEvent) => void) | null = null;
```

Three module-level variables: the menu element, the mousedown handler, and the
Escape handler. All three are set by `showTabContextMenu()` and cleared by
`closeTabContextMenu()`. This mirrors the file-browser plugin's pattern exactly.

---

## Exported function 1: `closeTabContextMenu()`

```typescript
/**
 * Remove the currently visible tab context menu from the DOM, if any.
 *
 * Removes the element and both document-level dismiss listeners so the
 * teardown is clean regardless of which code path triggers the close
 * (outside click, Escape, action item, renderer update, renderer destroy).
 *
 * Safe to call when no menu is open — all operations are no-ops on null.
 */
export function closeTabContextMenu(): void {
  _menuEl?.remove();
  _menuEl = null;

  if (_dismissHandler) {
    document.removeEventListener("mousedown", _dismissHandler);
    _dismissHandler = null;
  }

  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}
```

### Key points

- Removes the element from the DOM (not just hidden). NFR-2.
- Removes both event listeners. NFR-3.
- Idempotent — safe to call from `update()` and `destroy()` even when no menu
  is open (all operations guard against null).

---

## Exported function 2: `showTabContextMenu(tab, x, y)`

```typescript
/**
 * Show the tab context menu at the given viewport coordinates.
 *
 * If a menu is already open, it is closed first (EC-09). Builds the menu
 * items based on the tab's current state, appends to document.body, clamps
 * to the viewport, and registers dismiss listeners.
 *
 * @param tab  The TabEntry that was right-clicked.
 * @param x    Desired left position (viewport-relative, e.clientX).
 * @param y    Desired top position (viewport-relative, e.clientY).
 */
export function showTabContextMenu(tab: TabEntry, x: number, y: number): void {
  // Close any existing menu before building a new one (EC-09).
  closeTabContextMenu();

  const ul = document.createElement("ul");
  ul.className = "context-menu";
  ul.setAttribute("role", "menu");

  // ── Item: Close Tab ─────────────────────────────────────────────────────────
  // Always enabled. Delegates to closeTab() which handles dirty confirmation.
  _addItem(ul, "Close Tab", () => {
    void tabManager.closeTab(tab.id);
  });

  // ── Item: Close Other Tabs ──────────────────────────────────────────────────
  // Disabled when only one tab is open (EC-01).
  const onlyOneTab = tabManager.getTabCount() === 1;
  _addItem(
    ul,
    "Close Other Tabs",
    () => { void tabManager.closeOtherTabs(tab.id); },
    onlyOneTab   // disabled = true when only one tab
  );

  // ── Item: Close All Tabs ────────────────────────────────────────────────────
  // Always enabled.
  _addItem(ul, "Close All Tabs", () => {
    void tabManager.closeAllTabs();
  });

  // ── Separator ───────────────────────────────────────────────────────────────
  const sep = document.createElement("li");
  sep.className = "context-menu-separator";
  sep.setAttribute("role", "separator");
  ul.appendChild(sep);

  // ── Item: Reveal in Finder ──────────────────────────────────────────────────
  // Disabled when filePath is null (untitled or content tab). EC-07.
  // Enabled for both editor tabs with saved files and media tabs. EC-06.
  const noPath = tab.filePath === null;
  _addItem(
    ul,
    "Reveal in Finder",
    () => { void revealInFinder(tab.filePath!); },
    noPath   // disabled = true when no path
  );

  // ── Append to body and position ─────────────────────────────────────────────
  // Append first so getBoundingClientRect() returns the rendered size.
  document.body.appendChild(ul);
  _menuEl = ul;

  // Position at (x, y), then clamp so no part renders off-screen (EC-08).
  // The clamping formula is taken directly from the file-browser plugin.
  const rect = ul.getBoundingClientRect();
  const clampedX = Math.min(x, window.innerWidth - rect.width - 4);
  const clampedY = Math.min(y, window.innerHeight - rect.height - 4);
  ul.style.left = `${Math.max(0, clampedX)}px`;
  ul.style.top  = `${Math.max(0, clampedY)}px`;

  // ── Dismiss listeners ───────────────────────────────────────────────────────

  // mousedown outside closes the menu (FR-5.1).
  _dismissHandler = (e: MouseEvent) => {
    if (_menuEl && !_menuEl.contains(e.target as Node)) {
      closeTabContextMenu();
    }
  };
  document.addEventListener("mousedown", _dismissHandler);

  // Escape closes the menu (FR-5.2).
  _escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeTabContextMenu();
    }
  };
  document.addEventListener("keydown", _escHandler);
}
```

---

## Private helper: `_addItem()`

```typescript
/**
 * Append one action item to a context menu `<ul>`.
 *
 * The item is rendered with `.disabled` class and `pointer-events: none` when
 * `disabled` is true. The CSS rule for `.context-menu-item.disabled` handles
 * the visual treatment (opacity, cursor).
 *
 * Action items use `mousedown` rather than `click` to fire before the outside-
 * click dismiss listener; `e.preventDefault()` prevents text selection side effects.
 *
 * @param ul        The context menu <ul> to append to.
 * @param label     Display text for the item.
 * @param handler   Function to call when the item is activated.
 * @param disabled  When true, the item is visible but not interactive.
 */
function _addItem(
  ul: HTMLUListElement,
  label: string,
  handler: () => void,
  disabled = false,
): void {
  const li = document.createElement("li");
  li.className = "context-menu-item" + (disabled ? " disabled" : "");
  li.setAttribute("role", "menuitem");
  li.textContent = label;

  if (!disabled) {
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();     // Prevent text selection artifacts.
      closeTabContextMenu();  // Close menu before action (FR-5.3).
      handler();
    });
  }

  ul.appendChild(li);
}
```

### Why `mousedown` not `click`

The outside-click dismiss handler listens on `mousedown`. If the item handler
used `click` (which fires after `mousedown`), the dismiss handler would fire
first on the same event, close the menu and remove the `<li>` element, and
then the `click` event would fire on a detached node — the handler would never
run. Using `mousedown` for both ensures the item handler fires on the same event
phase as the dismiss check.

The `contains()` check in the dismiss handler (`_menuEl.contains(e.target)`)
ensures that a `mousedown` inside the menu is not treated as an outside click,
so the item's `mousedown` and the dismiss's `mousedown` do not conflict.

---

## Positioning (EC-08)

The clamping happens AFTER `document.body.appendChild(ul)` because
`getBoundingClientRect()` returns a zeroed rect on elements not yet in the DOM.
The menu is appended at `(0, 0)` by the default `ul.style` before clamping runs,
which is invisible for the one paint frame it takes. An alternative is to set
`visibility: hidden` before append and restore it after clamping, but the
file-browser pattern (append then clamp) has no visible flash in practice.

Clamping formula:
```
left = max(0, min(x, window.innerWidth  - rect.width  - 4))
top  = max(0, min(y, window.innerHeight - rect.height - 4))
```

The `- 4` provides a 4px gap from the window edge. `max(0, ...)` prevents
negative values if the menu is wider than the viewport (degenerate case).

---

## Complete file structure

```
src/tabs/tab-context-menu.ts
│
├── imports: TabEntry, tabManager, revealInFinder
│
├── module-level state: _menuEl, _dismissHandler, _escHandler
│
├── export function closeTabContextMenu(): void
│
├── export function showTabContextMenu(
│     tab: TabEntry,
│     x: number,
│     y: number
│   ): void
│
└── function _addItem(
      ul: HTMLUListElement,
      label: string,
      handler: () => void,
      disabled?: boolean
    ): void
```

Approximate line count: ~110 lines including JSDoc.

---

## Acceptance criteria

- [ ] File is at `src/tabs/tab-context-menu.ts`.
- [ ] Only two exports: `showTabContextMenu` and `closeTabContextMenu`.
- [ ] Only imports from `./tab-types`, `./tab-manager`, `../lib/bridge`. No plugin imports.
- [ ] `closeTabContextMenu()` removes `_menuEl` from DOM, not just hides it.
- [ ] `closeTabContextMenu()` removes both `_dismissHandler` and `_escHandler`.
- [ ] `showTabContextMenu()` calls `closeTabContextMenu()` before building a new menu.
- [ ] "Close Other Tabs" is disabled when `tabManager.getTabCount() === 1`.
- [ ] "Reveal in Finder" is disabled when `tab.filePath === null`.
- [ ] Separator `<li class="context-menu-separator">` is between "Close All Tabs" and "Reveal in Finder".
- [ ] Menu appended to `document.body`.
- [ ] Clamping applied after append (post-`getBoundingClientRect()`).
- [ ] Action items use `mousedown` not `click`.
- [ ] Action handler calls `closeTabContextMenu()` before executing the action.

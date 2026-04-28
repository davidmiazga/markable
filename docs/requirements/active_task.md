---
title: Tab Right-Click Context Menu
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Tab Right-Click Context Menu — Requirements

## Feature Summary

As a user, I want to right-click any tab in any tab renderer (regular, vertical,
or minimal) and see a small context menu with Close Tab, Close Other Tabs,
Close All Tabs, and Reveal in Finder actions, so I can manage open documents
without reaching for the keyboard.

---

## Codebase Context

### TabManager (`src/tabs/tab-manager.ts`)

- `closeTab(id: string): Promise<void>` — exists. Handles dirty confirmation,
  last-tab-closes-window logic, and session persistence.
- `closeAllTabs()` — does NOT exist. Must be added.
- `closeOtherTabs(id: string)` — does NOT exist. Must be added.
- `activateTab(id)`, `getTabs()`, `getTabCount()` — all exist and accessible
  on the singleton `tabManager`.
- The `TabManager` class and its methods are the only sanctioned mutation path
  for tab state. The context menu must call these methods; it must never mutate
  the `tabs` array directly.

### TabEntry (`src/tabs/tab-types.ts`)

Relevant fields for this feature:

- `id: string` — unique identifier per tab
- `kind: "editor" | "media"` — media tabs have a non-null `filePath` but are
  never dirty
- `filePath: string | null` — null for untitled editor tabs
- `isDirty: boolean` — always false for media tabs

### Renderers

All three renderers build DOM via full `innerHTML` clear and rebuild on every
`update()` call. Right-click listeners attached inside the element-build loop
are automatically discarded when `innerHTML = ""` runs — no manual cleanup.

- **RegularTabBar** (`src/tabs/renderers/regular-tab-bar.ts`): each tab is a
  `<button class="tab-label">`. Tab `id` is captured by closure in
  `_buildTabEl()`. The right-click listener must be added inside `_buildTabEl()`.

- **VerticalTabStrip** (`src/tabs/renderers/vertical-tab-strip.ts`): each tab
  is a `<div class="tab-vertical-col">`. Right-click added inside `_buildColEl()`.

- **MinimalTabBar** (`src/tabs/renderers/minimal-tab-bar.ts`): each tab is a
  `<button class="tab-dot">`. Right-click added inside `_createDotButton()`.

### Reveal in Finder — Rust Command

- `reveal_in_finder(path: String)` exists in
  `src-tauri/src/commands/file_ops.rs` (line 386) and is registered in
  `src-tauri/src/commands/mod.rs`.
- It is NOT currently wrapped in `src/lib/bridge.ts`. A typed bridge wrapper
  must be added as part of this feature.
- The file-browser plugin currently calls this command via raw
  `__TAURI_INTERNALS__.invoke`. The bridge wrapper is the canonical path going
  forward; the file-browser raw invoke is pre-existing technical debt and is
  out of scope for this feature.

### Existing Context Menu Pattern

`src/plugins/file-browser/file-browser.plugin.ts` contains a complete,
battle-tested context menu implementation:

- `showContextMenu(items, x, y)` creates a `<ul class="context-menu">`,
  appends to `document.body`, clamps to viewport, wires outside-click and
  Escape dismissal.
- `closeContextMenu()` removes the element and removes all listeners.
- CSS classes: `.context-menu`, `.context-menu-item`,
  `.context-menu-item.disabled`, `.context-menu-separator`.

The tab context menu must use the same visual language but must be implemented
in a separate module (`src/tabs/tab-context-menu.ts`). The file-browser is a
plugin; the tab system is core infrastructure. Imports across that boundary
are prohibited. The matching CSS must be added to `src/tabs/tabs.css`.

---

## Functional Requirements

### FR-1: Context Menu Trigger

FR-1.1 A `contextmenu` event listener must be attached to every rendered tab
element in all three renderers: the `<button class="tab-label">` in
RegularTabBar, the `<div class="tab-vertical-col">` in VerticalTabStrip, and
the `<button class="tab-dot">` in MinimalTabBar.

FR-1.2 Right-clicking on the tab strip background (not on a tab element) must
NOT show a context menu. Each tab element's handler calls `e.stopPropagation()`
and no contextmenu listener is attached to the strip container element.

FR-1.3 `e.preventDefault()` must be called on the contextmenu event to
suppress the browser's native context menu.

FR-1.4 The context menu must appear at `(e.clientX, e.clientY)` and be clamped
to the viewport so no part of it renders off-screen (see EC-08).

### FR-2: Menu Actions

FR-2.1 **Close Tab** — always enabled. Calls `tabManager.closeTab(tab.id)`.
The existing dirty-confirmation dialog inside `closeTab()` runs as normal.
No additional confirmation layer is added at the context menu level.

FR-2.2 **Close Other Tabs** — calls `tabManager.closeOtherTabs(tab.id)`.
Disabled (greyed out, `pointer-events: none`) when `tabManager.getTabCount() === 1`.
The item is visible but not clickable when there is only one tab.

FR-2.3 **Close All Tabs** — always enabled. Calls `tabManager.closeAllTabs()`.

FR-2.4 **Reveal in Finder** — calls `bridge.revealInFinder(tab.filePath)`.
Disabled when `tab.filePath === null` (untitled editor tab). Enabled for all
tabs where `filePath` is non-null, including media tabs (images and PDFs are
valid to reveal in Finder).

FR-2.5 A visual separator must appear between the "Close All Tabs" item and
the "Reveal in Finder" item, using a `<li class="context-menu-separator">`.

### FR-3: Context Menu Module

FR-3.1 All context menu DOM logic must live in a new module:
`src/tabs/tab-context-menu.ts`.

FR-3.2 The module must export one entry-point function:

```typescript
function showTabContextMenu(tab: TabEntry, x: number, y: number): void
```

Renderers call this from their `contextmenu` event handlers. The module owns
the menu's full lifecycle.

FR-3.3 The module must maintain at most one context menu element in the DOM at
a time. A second call while a menu is already open closes the first, then opens
a new one at the new coordinates.

FR-3.4 The module must export a cleanup function:

```typescript
function closeTabContextMenu(): void
```

Renderers call this from `update()` and `destroy()` to ensure any open menu
is removed during re-renders and mode switches.

### FR-4: New TabManager Methods

**FR-4.1 `closeOtherTabs(id: string): Promise<void>`**

- Closes all tabs whose `id !== id`.
- Dirty tabs among the "other" tabs each receive their individual confirm
  dialog (same dialog text as in `closeTab`). Cancelling for one dirty tab
  does not stop processing of the remaining tabs.
- The tab identified by `id` is never closed by this method.
- After the loop, calls `activateTab(id)` to ensure the right-clicked tab
  becomes (or remains) active.
- Calls `saveSession()` once after all close operations complete.

**FR-4.2 `closeAllTabs(): Promise<void>`**

- Closes all open tabs.
- Dirty tabs each receive their individual confirm dialog. Cancelling any
  one does not abort closing the others; each is evaluated independently.
- When the final remaining tab is closed, follows the same vault-branching
  logic as `closeTab()`: no active vault closes the window; active vault
  leaves the app open at 0 tabs.
- Implementation strategy to avoid "last-tab triggers window-close during
  a loop" hazard: iterate a snapshot of the tabs array, collect confirmed
  closes, apply in one batch, then call `saveSession()` once. Do not call
  `closeTab()` in a loop — the side effects (window-close, per-call
  saveSession) are incompatible with batch operation.

### FR-5: Dismiss Behavior

FR-5.1 The context menu closes on a mousedown outside the menu element
(document-level `mousedown` listener, same pattern as the file-browser plugin).

FR-5.2 The context menu closes when the user presses Escape (document-level
`keydown` listener).

FR-5.3 The context menu closes immediately after any action item is selected
(action handler fires, then menu closes).

FR-5.4 The context menu closes when the tab strip re-renders. Each renderer's
`update()` method must call `closeTabContextMenu()` at its start, before
rebuilding the DOM.

FR-5.5 The context menu closes when the renderer is destroyed. Each renderer's
`destroy()` method must call `closeTabContextMenu()`.

### FR-6: Bridge Wrapper

FR-6.1 A typed wrapper for `reveal_in_finder` must be added to
`src/lib/bridge.ts`:

```typescript
export async function revealInFinder(path: string): Promise<void>
```

It wraps `invoke("reveal_in_finder", { path })` in a try/catch and logs
errors via `console.error` without re-throwing, so a Finder failure (e.g.
file deleted since the tab was opened) is non-fatal.

### FR-7: CSS

FR-7.1 Context menu styles must be added to `src/tabs/tabs.css` using the
following class names to match the file-browser plugin's visual language:

- `.context-menu` — the `<ul>` container
- `.context-menu-item` — each `<li>` action
- `.context-menu-item.disabled` — greyed-out, non-interactive state
- `.context-menu-separator` — visual divider between item groups

FR-7.2 All color values must use CSS custom properties with fallbacks:
`--bg-secondary`, `--text-primary`, `--border-color`, `--bg-hover`,
`--text-muted`. No hardcoded color values.

FR-7.3 The menu must use `position: fixed` and `z-index: 9999` (same as
`#tab-tooltip`) so it renders above the tab strip, editor, and sidebar panels.

---

## Edge Case Inventory

EC-01: **Right-click on the only open tab — "Close Other Tabs" must be
disabled.** When `tabs.length === 1`, the item renders with `.disabled` class
and `pointer-events: none`. It is visible but not actionable.

EC-02: **Right-click on a dirty tab — "Close Tab" shows the confirm dialog.**
The confirmation is inside `closeTab()` and is not affected by the context
menu. No additional dialog is added.

EC-03: **"Close Other Tabs" with multiple dirty "other" tabs.** Each dirty tab
among the others shows its own confirm dialog in sequence. The user may confirm
some and cancel others independently. The right-clicked tab is never closed.

EC-04: **"Close All Tabs" with all tabs dirty.** Each dirty tab shows its own
confirm dialog sequentially. If the user cancels all, no tabs close. The
`closeAllTabs()` method iterates a snapshot so mutation during the loop does
not cause missed entries.

EC-05: **"Close All Tabs" — last-tab behavior.** When the final tab is closed,
the same vault/no-vault branching applies as in `closeTab()`: no vault active
closes the window; vault active leaves the app at 0 tabs. The
`closeAllTabs()` implementation must replicate this branch, not call
`closeTab()` recursively.

EC-06: **Media tab — "Reveal in Finder" enabled.** Media tabs always have a
non-null `filePath`. The item is enabled. Calling `revealInFinder` on an
image or PDF path is valid.

EC-07: **Untitled editor tab — "Reveal in Finder" disabled.**
`tab.filePath === null`. The item renders with `.disabled` class.

EC-08: **Context menu near the right or bottom viewport edge.** Clamp
logic: after appending the `<ul>` to `document.body`, read its bounding rect,
then set `left = min(x, window.innerWidth - rect.width - 4)` and
`top = min(y, window.innerHeight - rect.height - 4)`, each floored at 0.
This matches the file-browser plugin's clamping strategy.

EC-09: **Multiple right-clicks in quick succession.** `showTabContextMenu()`
calls `closeTabContextMenu()` before creating a new menu. No stacking occurs;
each call produces exactly one menu.

EC-10: **Right-click on the tab strip background, not on a tab.** No menu
appears. Each tab element handler calls `e.stopPropagation()`. No contextmenu
listener is attached to the strip container.

EC-11: **Context menu open when mode switches (e.g. regular to vertical).**
`TabManager.setMode()` tears down the renderer via `_instantiateRenderer()`,
which calls `renderer.destroy()`. The updated `destroy()` calls
`closeTabContextMenu()`, ensuring the menu is removed.

EC-12: **Context menu open when a tab closes via the close button (not the
context menu).** The close button calls `tabManager.closeTab()`, which calls
`_notifyRenderer()`, which calls `renderer.update()`. The updated `update()`
calls `closeTabContextMenu()` at its start, removing any open menu.

EC-13: **Right-click in minimal mode (small dot buttons).** The dots are 8 px
circles expanding to 22 px pills. The context menu appears at `(e.clientX,
e.clientY)` regardless of element size. No minimum target size requirement
beyond what the native click event provides.

EC-14: **"Reveal in Finder" when the file has been deleted from disk.** macOS
`open -R` on a missing path fails silently or reveals the parent folder. The
bridge wrapper catches any invoke error and logs via `console.error`. No
user-facing alert is shown.

EC-15: **"Close Other Tabs" when the right-clicked tab is NOT the currently
active tab.** The method closes all other tabs (with dirty confirmations) and
then calls `activateTab(id)` to make the right-clicked tab active. The user
keeps the tab they right-clicked on.

EC-16: **Tab strip re-renders while the context menu is open (e.g. a background
tab becomes dirty and triggers `_notifyRenderer()`).** The `update()` call
closes the menu. The user must right-click again to reopen it. This is
acceptable; keeping the menu alive across rebuilds would require holding a
stale `TabEntry` reference.

EC-17: **Cmd-W pressed while the context menu is open for a different tab.**
Cmd-W fires `closeTab(activeTab)` via the keyboard handler. This calls
`_notifyRenderer()`, which closes the menu (EC-16). The active tab is closed;
the keyboard shortcut and context menu do not conflict.

---

## Non-Functional Requirements

NFR-1: `src/tabs/tab-context-menu.ts` must import only from
`src/tabs/tab-types.ts`, `src/tabs/tab-manager.ts`, and `src/lib/bridge.ts`.
No imports from plugin code.

NFR-2: The context menu DOM element must be a single `<ul>` appended to
`document.body`. It must be removed from the DOM on close, not merely hidden,
to prevent accumulating ghost elements.

NFR-3: All event listeners registered by `showTabContextMenu()` (outside-click,
Escape) must be removed in `closeTabContextMenu()`. No listener leaks.

NFR-4: The two new `TabManager` methods (`closeOtherTabs`, `closeAllTabs`)
must be covered by unit tests.

NFR-5: No changes to `index.html`, `main.ts`, or the plugin system are required.
The feature is self-contained within `src/tabs/` and `src/lib/bridge.ts`.

NFR-6: No external library dependencies are introduced.

---

## Out of Scope

- Keyboard navigation within the context menu (arrow keys, Enter to select items).
- Drag-and-drop reordering of tabs from the context menu.
- "Move to New Window" or "Duplicate Tab" actions.
- Open/close animation on the context menu.
- Replacing the file-browser plugin's raw `__TAURI_INTERNALS__` invoke with
  the new `bridge.revealInFinder` wrapper (noted as technical debt; separate task).
- Touch / long-press support.

---

## Architecture Decision Record

**ADR-1: Where does the context menu logic live?**

A new `src/tabs/tab-context-menu.ts` module. Rationale:

1. All three renderers need identical behavior. A shared module avoids
   duplicating the same `show`/`close` logic across three files.
2. The tab system is core infrastructure and must not import from plugins.
   The file-browser's `showContextMenu` is inaccessible to core modules by
   design.
3. `tab-manager.ts` is already approximately 1,150 lines and its responsibility
   is tab state, not DOM presentation. Adding context menu DOM logic there
   would violate single responsibility.
4. A thin, focused module (expected ~120 lines) mirrors the established pattern
   of `minimal-tab-bar.ts` and `regular-tab-bar.ts`.

**ADR-2: Reveal in Finder for media tabs.**

Media tabs always have a non-null `filePath` (an image or PDF on disk).
Revealing a binary asset in Finder is a valid and useful operation. "Reveal
in Finder" is therefore enabled for media tabs, not disabled.

**ADR-3: Individual dirty-confirm dialogs in "Close Other Tabs" and "Close All
Tabs."**

Each dirty tab receives its own dialog, not a single bulk-confirm. This matches
macOS conventions (each document is asked independently), reuses the existing
dialog text already in `closeTab()`, and gives the user granular control.

**ADR-4: `closeAllTabs()` batch approach.**

Iterating `closeTab()` in a loop is unsafe because `closeTab()` has side
effects that depend on the number of remaining tabs (window-close on last tab,
session-save on each call). The correct implementation collects confirmed
closes from a snapshot, then applies them in one pass before calling
`saveSession()` once.

**ADR-5: Disabled vs. hidden for unavailable items.**

Disabled items (`.disabled` class, `pointer-events: none`) are kept visible
rather than hidden. This follows the established pattern in the file-browser
plugin (`.context-menu-item.disabled`) and makes it clear to the user that
the action exists but is not currently applicable, rather than confusing them
with a shorter menu whose item count changes contextually.

---

## Affected Files

| File | Change |
|---|---|
| `src/tabs/tab-context-menu.ts` | New file. Owns all context menu DOM and lifecycle. |
| `src/tabs/tab-manager.ts` | Add `closeOtherTabs(id)` and `closeAllTabs()` methods. |
| `src/tabs/renderers/regular-tab-bar.ts` | Add contextmenu listener in `_buildTabEl()`, call `closeTabContextMenu()` in `update()` and `destroy()`. |
| `src/tabs/renderers/vertical-tab-strip.ts` | Same as above, in `_buildColEl()`. |
| `src/tabs/renderers/minimal-tab-bar.ts` | Same as above, in `_createDotButton()`. |
| `src/tabs/tabs.css` | Add `.context-menu`, `.context-menu-item`, `.context-menu-item.disabled`, `.context-menu-separator` rules. |
| `src/lib/bridge.ts` | Add `revealInFinder(path)` wrapper. |

---

## Handoff Summary

- Artifact: `/Users/daveslaptop/work-LocalArea/markable-2.0/docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 17 items in Edge Case Inventory (EC-01 through EC-17)

Next step: Activate @software-architect and provide
`docs/requirements/active_task.md` as context.

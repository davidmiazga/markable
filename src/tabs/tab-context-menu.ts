/**
 * tab-context-menu.ts — Right-click context menu for tab strip elements.
 *
 * Owns the complete lifecycle of the tab right-click context menu:
 *   1. Creating the <ul> DOM element (lazily, on first call).
 *   2. Populating it with four action items and one separator based on tab state.
 *   3. Appending to document.body, positioning at the requested coordinates,
 *      and clamping to the viewport so no part renders off-screen.
 *   4. Registering dismiss listeners (mousedown outside, Escape key).
 *   5. Removing the element and all listeners on close.
 *
 * Only two symbols are exported: showTabContextMenu and closeTabContextMenu.
 * All renderer-agnostic menu logic lives here — renderers are callers only.
 *
 * Design decisions: ADR-1 through ADR-6 in docs/specs/tab-context-menu/00_index.md.
 * NFR-1: imports only from ./tab-types, ./tab-manager, and ../lib/bridge.
 */

import type { TabEntry } from "./tab-types";
import { tabManager } from "./tab-manager";
import { revealInFinder } from "../lib/bridge";

// ── Module-level state ─────────────────────────────────────────────────────────

/**
 * The currently visible context menu <ul>, or null when none is open.
 *
 * ADR-2: one module-level element, created lazily and reused. The element is
 * removed from the DOM on close (not merely hidden) so ghost elements cannot
 * accumulate (NFR-2).
 */
let _menuEl: HTMLUListElement | null = null;

/**
 * Document-level mousedown handler for outside-click dismissal.
 * Stored so it can be removed in closeTabContextMenu() (NFR-3).
 */
let _dismissHandler: ((e: MouseEvent) => void) | null = null;

/**
 * Document-level keydown handler for Escape key dismissal.
 * Stored so it can be removed in closeTabContextMenu() (NFR-3).
 */
let _escHandler: ((e: KeyboardEvent) => void) | null = null;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Remove the currently visible tab context menu from the DOM, if any.
 *
 * Removes the <ul> element from document.body and removes both document-level
 * dismiss listeners so teardown is clean regardless of which code path
 * triggers the close (outside click, Escape, action item, renderer update,
 * renderer destroy).
 *
 * Idempotent — safe to call when no menu is open (all operations guard null).
 * This property satisfies EC-11, EC-12, EC-16, EC-17 where update() and
 * destroy() unconditionally call this function.
 */
export function closeTabContextMenu(): void {
  // Remove the menu element from the DOM (NFR-2: not merely hidden).
  _menuEl?.remove();
  _menuEl = null;

  // Remove both dismiss listeners so they are not called after the menu is gone.
  if (_dismissHandler) {
    document.removeEventListener("mousedown", _dismissHandler);
    _dismissHandler = null;
  }

  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}

/**
 * Show the tab context menu at the given viewport coordinates.
 *
 * If a menu is already open it is closed first (EC-09). The menu is built
 * fresh each call: four items (Close Tab, Close Other Tabs, Close All Tabs,
 * Reveal in Finder) plus one separator between "Close All Tabs" and "Reveal".
 * Items that are unavailable for the given tab are rendered with class
 * "disabled" and pointer-events:none (ADR-5).
 *
 * The menu is appended to document.body before clamping so
 * getBoundingClientRect() returns the real rendered dimensions (EC-08).
 * Two dismiss listeners (mousedown outside, Escape) are registered and
 * will be removed by closeTabContextMenu() (NFR-3).
 *
 * @param tab  The TabEntry that was right-clicked.
 * @param x    Desired left position in viewport px (e.clientX).
 * @param y    Desired top position in viewport px (e.clientY).
 */
export function showTabContextMenu(tab: TabEntry, x: number, y: number): void {
  // Close any existing menu before building a new one (EC-09: no stacking).
  closeTabContextMenu();

  const ul = document.createElement("ul");
  ul.className = "context-menu";
  ul.setAttribute("role", "menu");

  // ── Item: Pin / Unpin Tab ────────────────────────────────────────────────────
  _addItem(ul, tab.pinned ? "Unpin Tab" : "Pin Tab", () => {
    tab.pinned ? tabManager.unpinTab(tab.id) : tabManager.pinTab(tab.id);
  });

  // ── Item: Close Tab ──────────────────────────────────────────────────────────
  // Always enabled. Delegates to closeTab() which handles dirty-confirm internally.
  _addItem(ul, "Close Tab", () => {
    void tabManager.closeTab(tab.id);
  });

  // ── Item: Close Other Tabs ───────────────────────────────────────────────────
  // Disabled when only one tab is open (EC-01: nothing to close besides self).
  const onlyOneTab = tabManager.getTabCount() === 1;
  _addItem(
    ul,
    "Close Other Tabs",
    () => { void tabManager.closeOtherTabs(tab.id); },
    onlyOneTab,
  );

  // ── Item: Close All Tabs ─────────────────────────────────────────────────────
  // Always enabled. closeAllTabs() handles dirty-confirm for each tab internally.
  _addItem(ul, "Close All Tabs", () => {
    void tabManager.closeAllTabs();
  });

  // ── Separator ────────────────────────────────────────────────────────────────
  // Visual divider between the "close" group and the "finder" action.
  const sep = document.createElement("li");
  sep.className = "context-menu-separator";
  sep.setAttribute("role", "separator");
  ul.appendChild(sep);

  // ── Item: Reveal in Finder ───────────────────────────────────────────────────
  // Disabled when filePath is null (untitled or content tab, EC-07).
  // Enabled for editor tabs with a saved path and for media tabs (EC-06).
  const noPath = tab.filePath === null;
  _addItem(
    ul,
    "Reveal in Finder",
    () => {
      // The non-null assertion is safe because the handler is only attached when
      // noPath is false (the _addItem disabled check prevents attachment otherwise).
      void revealInFinder(tab.filePath!);
    },
    noPath,
  );

  // ── Append to body and position ──────────────────────────────────────────────
  // Append first so getBoundingClientRect() returns a real rendered size.
  // Without appending first, all rect fields return 0 and clamping would be wrong.
  document.body.appendChild(ul);
  _menuEl = ul;

  // Clamp the menu position so no part of the menu renders off-screen (EC-08).
  // Formula matches the file-browser plugin: 4px gap from window edges.
  const rect = ul.getBoundingClientRect();
  const clampedX = Math.min(x, window.innerWidth - rect.width - 4);
  const clampedY = Math.min(y, window.innerHeight - rect.height - 4);
  ul.style.left = `${Math.max(0, clampedX)}px`;
  ul.style.top  = `${Math.max(0, clampedY)}px`;

  // ── Dismiss listeners ────────────────────────────────────────────────────────

  // Outside-click: close when the user mousedowns anywhere outside the menu.
  // mousedown fires before click, which is important because item handlers also
  // listen on mousedown — see _addItem() for the detailed explanation.
  _dismissHandler = (e: MouseEvent) => {
    if (_menuEl && !_menuEl.contains(e.target as Node)) {
      closeTabContextMenu();
    }
  };
  document.addEventListener("mousedown", _dismissHandler);

  // Escape key: close without activating any item (FR-5.2).
  _escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeTabContextMenu();
    }
  };
  document.addEventListener("keydown", _escHandler);
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * Append one action item to a context menu <ul>.
 *
 * Disabled items render with class "disabled" and pointer-events:none (ADR-5).
 * They are NOT hidden — the user can see that the action exists but is
 * inapplicable in the current state.
 *
 * Action items use `mousedown` rather than `click` because the outside-click
 * dismiss listener also listens on `mousedown`. If items used `click` (which
 * fires after mousedown), the dismiss handler would fire first on the same
 * event, remove the <li> element from the DOM, and the click would arrive on
 * a detached node — the handler would never run. Using `mousedown` for both
 * ensures the item handler fires in the same event phase as the dismiss check.
 * The `contains()` guard in the dismiss handler prevents an item mousedown from
 * being treated as an outside click.
 *
 * @param ul        The context menu <ul> to append to.
 * @param label     Display text shown in the menu.
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
      // Prevent text-selection artifacts from the mousedown.
      e.preventDefault();
      // Close the menu before calling the handler so the menu element is
      // already gone when the handler (e.g. confirm dialog) runs.
      closeTabContextMenu();
      handler();
    });
  }

  ul.appendChild(li);
}

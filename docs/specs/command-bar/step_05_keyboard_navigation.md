---
title: "Command Bar — Step 05: Keyboard Navigation + Focus Trap"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# Step 05 — Keyboard Navigation + Focus Trap

## Goal

Wire the full runtime behavior of the Command Bar:
- Filter and rank on input.
- Arrow key navigation (wrap-around, dimmed-skip).
- Enter to activate.
- Escape to close.
- Tab/Shift-Tab focus trap.
- Mouse hover highlight + click activate.
- `aria-activedescendant` updates for screen readers.
- Pre-selection of first non-dimmed result on open.
- Toggle behavior: open while already open → close.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/plugins/command-bar/command-bar.plugin.ts` | All event listeners, open/close logic, filter/rank pipeline |

---

## Module-level state (plugin-scoped)

```typescript
// Set once at enable time; never recreated across open/close cycles.
let _overlayEl: HTMLElement | null = null;
let _inputEl: HTMLInputElement | null = null;
let _resultsEl: HTMLElement | null = null;

// Rebuilt on every open.
let _allResults: CommandBarResult[] = [];
// Current filtered + ranked results (or _allResults when query is empty).
let _visibleResults: CommandBarResult[] = [];
// id of the currently selected result; null if no selectable result.
let _selectedId: string | null = null;

// Open/closed state (single instance guard, NFR-07).
let _isOpen = false;

// Plugin settings (loaded at onEnable, persisted on change).
let _settings: CommandBarSettings = {
  showCommands: true,
  showHeadings: true,
  showRecentFiles: true,
};
```

---

## `openBar()`

```typescript
function openBar(): void {
  if (!_overlayEl || !_inputEl || !_resultsEl) return;

  // Toggle behavior (EC-05, FR-01.6): if already open, close instead.
  if (_isOpen) {
    closeBar();
    return;
  }

  _isOpen = true;
  openCommandBar(_overlayEl, _inputEl); // from step_04: removes cb-hidden, sets aria-hidden=false

  // Rebuild the full result set (FR-03.A.2).
  _allResults = buildAllResults(_settings);

  // Initial render: full unfiltered set (FR-01.5), no query.
  _visibleResults = _allResults;
  _selectedId = firstSelectableId(_visibleResults);
  renderResults(_resultsEl, _visibleResults, "", _selectedId);
  updateAriaActiveDescendant(_inputEl, _selectedId);
  scrollSelectedIntoView(_resultsEl);

  // Focus input (FR-01.3).
  _inputEl.focus();
}
```

---

## `closeBar()`

```typescript
function closeBar(): void {
  if (!_overlayEl || !_inputEl || !_isOpen) return;
  _isOpen = false;
  closeCommandBar(_overlayEl, _inputEl); // from step_04: adds cb-hidden, restores editor focus
  _selectedId = null;
  _visibleResults = [];
}
```

---

## `filterAndRender(query: string)`

Called on every `input` event on `_inputEl`.

```typescript
function filterAndRender(query: string): void {
  if (!_resultsEl || !_inputEl) return;

  if (query === "") {
    // Empty query: show all unfiltered, no ranking (FR-02.5).
    _visibleResults = _allResults;
    _selectedId = firstSelectableId(_visibleResults);
    renderResults(_resultsEl, _visibleResults, "", _selectedId);
  } else {
    // Filter + rank.
    const matched: MatchedResult[] = [];
    for (const result of _allResults) {
      const m = fuzzyMatch(result.label, query);
      if (m) {
        result._matchPositions = m.positions;
        matched.push({ result, match: m });
      } else {
        result._matchPositions = undefined;
      }
    }

    // Sort: tier ascending, then label alphabetically within tier (FR-02.3).
    matched.sort((a, b) => {
      if (a.match.tier !== b.match.tier) return a.match.tier - b.match.tier;
      return a.result.label.toLowerCase().localeCompare(b.result.label.toLowerCase());
    });

    _visibleResults = matched.map((m) => m.result);
    _selectedId = firstSelectableId(_visibleResults);
    renderResults(_resultsEl, _visibleResults, query, _selectedId);
  }

  updateAriaActiveDescendant(_inputEl, _selectedId);
  scrollSelectedIntoView(_resultsEl);
}
```

---

## Selection helpers

```typescript
/** Returns the id of the first non-dimmed result, or null. */
function firstSelectableId(results: CommandBarResult[]): string | null {
  return results.find((r) => !r.dimmed)?.id ?? null;
}

/** All non-dimmed result ids in current visible order. */
function selectableIds(results: CommandBarResult[]): string[] {
  return results.filter((r) => !r.dimmed).map((r) => r.id);
}

/** Move selection by delta (+1 = down, -1 = up) with wrap-around. */
function moveSelection(delta: 1 | -1): void {
  if (!_resultsEl || !_inputEl) return;
  const ids = selectableIds(_visibleResults);
  if (ids.length === 0) return; // EC-11: no selectable results

  const currentIdx = _selectedId ? ids.indexOf(_selectedId) : -1;
  let nextIdx: number;
  if (delta === 1) {
    nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % ids.length;
  } else {
    nextIdx = currentIdx <= 0 ? ids.length - 1 : currentIdx - 1;
  }

  _selectedId = ids[nextIdx];
  // Rerender with updated selection (cheap: same visibleResults, same query).
  renderResults(_resultsEl, _visibleResults, _inputEl.value, _selectedId);
  updateAriaActiveDescendant(_inputEl, _selectedId);
  scrollSelectedIntoView(_resultsEl);
}

/** Update input's aria-activedescendant to the DOM id of the selected result. */
function updateAriaActiveDescendant(input: HTMLInputElement, selectedId: string | null): void {
  if (!selectedId) {
    input.setAttribute("aria-activedescendant", "");
    return;
  }
  // The DOM id is set as `cb-result-${index}` in renderResults.
  // Find the index of selectedId in _visibleResults.
  const idx = _visibleResults.findIndex((r) => r.id === selectedId);
  input.setAttribute("aria-activedescendant", idx >= 0 ? `cb-result-${idx}` : "");
}

/** Scroll selected result into view (smooth or instant). */
function scrollSelectedIntoView(container: HTMLElement): void {
  const sel = container.querySelector(".cb-result--selected");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}
```

---

## `activateSelected()`

```typescript
function activateSelected(): void {
  if (!_selectedId) return;
  const result = _visibleResults.find((r) => r.id === _selectedId);
  if (!result || result.dimmed) return; // guard against race

  // Close before executing action (FR-01.2, FR-06.2).
  closeBar();
  result.action();
}
```

---

## Event listeners (attached in `attachListeners()`)

All listeners are registered in `onEnable` and cleaned up in `onDisable`.

### Input listener

```typescript
_inputEl.addEventListener("input", () => {
  filterAndRender(_inputEl.value.trim());
});
```

Note: `.trim()` is applied so leading/trailing spaces do not affect matching.

### Overlay keydown listener

```typescript
_overlayEl.addEventListener("keydown", (e: KeyboardEvent) => {
  switch (e.key) {
    case "Escape":
      e.preventDefault();
      e.stopPropagation();
      closeBar(); // EC-06: always closes regardless of input content
      break;

    case "ArrowDown":
      e.preventDefault();
      e.stopPropagation();
      moveSelection(1);
      break;

    case "ArrowUp":
      e.preventDefault();
      e.stopPropagation();
      moveSelection(-1);
      break;

    case "Enter":
      e.preventDefault();
      e.stopPropagation();
      activateSelected();
      break;

    case "Tab":
      // Focus trap: Tab = move down, Shift-Tab = move up (FR-06.4, NFR-05).
      e.preventDefault();
      e.stopPropagation();
      moveSelection(e.shiftKey ? -1 : 1);
      break;
  }
});
```

### Backdrop click listener

```typescript
_overlayEl.addEventListener("click", (e: MouseEvent) => {
  // Close only when clicking the backdrop, not the panel (FR-01.2).
  if (e.target === _overlayEl) closeBar();
});
```

### Result row click listener (event delegation)

```typescript
_resultsEl.addEventListener("click", (e: MouseEvent) => {
  const row = (e.target as Element).closest(".cb-result") as HTMLElement | null;
  if (!row) return;
  const resultId = row.dataset.id;
  if (!resultId) return;
  const result = _visibleResults.find((r) => r.id === resultId);
  if (!result || result.dimmed) return; // EC-02: dimmed results are no-ops
  _selectedId = resultId;
  closeBar();
  result.action();
});
```

### Result row hover listener (event delegation for selection highlight)

```typescript
_resultsEl.addEventListener("mousemove", (e: MouseEvent) => {
  const row = (e.target as Element).closest(".cb-result") as HTMLElement | null;
  if (!row) return;
  const resultId = row.dataset.id;
  if (!resultId) return;
  const result = _visibleResults.find((r) => r.id === resultId);
  if (!result || result.dimmed) return;
  if (_selectedId === resultId) return; // no-op if already selected

  _selectedId = resultId;
  if (!_inputEl) return;
  renderResults(_resultsEl!, _visibleResults, _inputEl.value, _selectedId);
  updateAriaActiveDescendant(_inputEl, _selectedId);
});
```

### Tab close defensive listener (EC-12)

The tab manager fires a change notification when a tab closes. The Command Bar must
close defensively if the active tab closes while the bar is open. The tab manager
exposes no direct event; instead, subscribe to a custom DOM event if available, or
use a polling fallback.

**Approach**: Listen for `"markable-tab-changed"` on `document` (if the tab manager
fires this event). If no such event exists today, implement a simpler guard:

```typescript
// In openBar(), capture current file at open time.
const _fileAtOpen = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;

// In filterAndRender() or a setInterval (100ms), check if the file changed:
// If _fileAtOpen was non-null and __MARKABLE_CURRENT_FILE__ is now null → close.
// This is a paranoia guard; the primary use is EC-12.
```

For now, implement a document event listener for a `"markable-tab-closed"` custom
event (to be fired by TabManager when a tab closes). If the event does not exist in
the current TabManager implementation, add it as part of this step:

In `tab-manager.ts`, add after the tab is fully closed:
```typescript
document.dispatchEvent(new CustomEvent("markable-tab-closed"));
```

In the plugin:
```typescript
function onTabClosed(): void {
  if (_isOpen) closeBar();
}
document.addEventListener("markable-tab-closed", onTabClosed);
// Remove in cleanup: document.removeEventListener("markable-tab-closed", onTabClosed);
```

---

## Cleanup on `onDisable`

```typescript
function detachListeners(): void {
  document.removeEventListener("markable-tab-closed", onTabClosed);
  // Overlay event listeners are removed by removing the overlay from the DOM.
  // Since the overlay is the single root, all delegated listeners are gone.
}
```

All event listeners registered on `_overlayEl` or `_resultsEl` are automatically
cleaned up when `_overlayEl.remove()` is called in `onDisable` (they are DOM-attached
and follow the node's lifecycle). The `document` listener for `markable-tab-closed`
must be explicitly removed.

---

## Full open/close lifecycle summary

```
onEnable:
  1. injectCSS()
  2. _overlayEl = buildOverlayDOM()
  3. _inputEl = _overlayEl.querySelector(".cb-input")
  4. _resultsEl = _overlayEl.querySelector(".cb-results")
  5. attachListeners(_overlayEl, _inputEl, _resultsEl)
  6. document.body.appendChild(_overlayEl)
  7. window.__MARKABLE_COMMAND_BAR_OPEN__ = openBar

onDisable:
  1. if (_isOpen) closeBar() — clean close
  2. _overlayEl.remove()
  3. detachListeners()
  4. window.__MARKABLE_COMMAND_BAR_OPEN__ = null
  5. window.__MARKABLE_COMMAND_BAR_IS_OPEN__ = false
  6. removeCSS()
  7. _overlayEl = null; _inputEl = null; _resultsEl = null

Cmd-Shift-P pressed (plugin enabled):
  1. main.ts keydown → resolveAction → "command-bar-open"
  2. handleAction("command-bar-open") → window.__MARKABLE_COMMAND_BAR_OPEN__()
  3. openBar() → if (_isOpen) closeBar() else ...open sequence...
```

---

## EC Coverage

| Edge Case | Handling |
|---|---|
| EC-01: heading jump, no file | `dimmed: true`, `activateSelected()` guards `result.dimmed` |
| EC-02: format command, no file, mouse click | `pointer-events: none` on `.cb-result--dimmed` + click handler `result.dimmed` check |
| EC-04: zero results | "No results" placeholder in `renderResults()` |
| EC-05: Cmd-Shift-P while open | `openBar()` calls `closeBar()` when `_isOpen === true` |
| EC-06: Escape with empty input | Escape keydown always closes, regardless of input value |
| EC-11: all results dimmed, arrow key | `selectableIds()` returns `[]`; `moveSelection()` early-returns |
| EC-12: tab closes while open | `markable-tab-closed` event triggers `closeBar()` |
| EC-13: plugin toggled off mid-session | `_allResults` is rebuilt on next open (FR-03.A.2) |
| EC-18: all categories disabled | `_allResults = []`; "No results" shown |
| EC-19: command-bar plugin disabled | `window.__MARKABLE_COMMAND_BAR_OPEN__ = null`; handleAction is a no-op |
| EC-20: rapid open/close | `_isOpen` flag prevents duplicate opens |
| EC-21: 500-char paste | fuzzyMatch handles long queries synchronously (O(n)) |
| EC-26: window blur | `window.focus` handler skips `editor.focus()` when `__MARKABLE_COMMAND_BAR_IS_OPEN__ = true` |
| EC-27: screen reader | `aria-activedescendant` updated on every selection change |

---

## Test Cases

```typescript
// Pre-selection: first non-dimmed result selected on open (FR-06.3)
const results: CommandBarResult[] = [
  { id: "d1", category: "commands", label: "Bold", dimmed: true, action: () => {} },
  { id: "s1", category: "commands", label: "New",  dimmed: false, action: () => {} },
];
expect(firstSelectableId(results)).toBe("s1");

// EC-11: all dimmed → firstSelectableId returns null
const allDimmed: CommandBarResult[] = [
  { id: "d1", category: "commands", label: "Bold", dimmed: true, action: () => {} },
];
expect(firstSelectableId(allDimmed)).toBeNull();

// moveSelection wraps: down from last → first (FR-06.1)
// Down from index 1 (last) with 2 selectable items → index 0
// Requires a DOM environment + initialized state

// EC-04: empty _allResults → placeholder visible
// Requires DOM environment

// EC-05: openBar() when _isOpen = true calls closeBar()
// Tested by calling openBar() twice and asserting second call closes the bar.

// activateSelected: dimmed result is not activated (EC-01, EC-02)
// result.dimmed = true → activateSelected() returns without calling action
const dimmedResult: CommandBarResult = {
  id: "x", category: "commands", label: "Bold", dimmed: true, action: jest.fn(),
};
_visibleResults = [dimmedResult];
_selectedId = "x";
activateSelected();
expect(dimmedResult.action).not.toHaveBeenCalled();
```

---

## Acceptance Criteria

- [ ] Cmd-Shift-P opens the bar (routed through handleAction → `__MARKABLE_COMMAND_BAR_OPEN__`).
- [ ] Cmd-Shift-P while open closes the bar (EC-05, FR-01.6).
- [ ] Escape closes the bar regardless of input content (EC-06).
- [ ] Clicking backdrop closes the bar (FR-01.2).
- [ ] First non-dimmed result is pre-selected on open (FR-06.3).
- [ ] Arrow keys navigate, skipping dimmed results (FR-06.2, FR-05.2).
- [ ] Navigation wraps: Down from last → first, Up from first → last (FR-06.1).
- [ ] EC-11: no selectable results → arrow keys are no-ops, Enter does nothing.
- [ ] Enter activates selected result and closes bar (FR-06.2).
- [ ] Tab moves selection down; Shift-Tab moves up (FR-06.4, NFR-05).
- [ ] Tab does NOT focus anything outside the overlay (NFR-05 focus trap).
- [ ] On close, `window.__CM_VIEW__.focus()` is called (NFR-05).
- [ ] `aria-activedescendant` is updated on every selection change (EC-27).
- [ ] `aria-expanded` is `"true"` when open, `"false"` when closed.
- [ ] Dimmed results cannot be activated by keyboard or mouse (EC-01, EC-02).
- [ ] Clicking a dimmed result is a no-op (EC-02).
- [ ] Mouse hover highlights a result (FR-06.5).
- [ ] Mouse click activates and closes (FR-06.5).
- [ ] `__MARKABLE_COMMAND_BAR_IS_OPEN__` is `true` while open, `false` after close.
- [ ] Window `focus` event does not steal focus from open command bar (EC-26).
- [ ] EC-12: bar closes when active tab closes.
- [ ] EC-19: pressing Cmd-Shift-P when plugin is disabled is a silent no-op.
- [ ] EC-20: rapid open/close cycles do not stack overlays or cause errors.
- [ ] All navigation tests pass via `npm test`.

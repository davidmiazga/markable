---
title: "Command Bar — Step 07: Integration + Build Registration"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# Step 07 — Integration + Build Registration

## Goal

Assemble all parts into the complete plugin object, wire `onEnable`/`onDisable`,
register the plugin with the build system, and verify the full end-to-end behavior.

---

## Files to Modify or Create

| File | Change |
|------|--------|
| `src/plugins/command-bar/command-bar.plugin.ts` | Complete plugin export |
| `src/plugins/command-bar/fuzzy-ranker.ts` | Pure module created in step_02 |
| `scripts/build-plugins.mjs` | Add entry to PLUGINS array |
| `src-tauri/src/commands/plugins.rs` | Stale plugin cleanup (remove old .js files not in bundle) |
| `tests/plugins/command-bar/command-bar.test.ts` | Full integration test assertions |

---

## Complete plugin object

```typescript
export default {
  id: "command-bar",
  name: "Command Bar",
  version: "1.0.0",
  description: "Fuzzy command palette for commands, headings, and recent files",
  detail:
    "Open with Cmd-Shift-P to fuzzy-search all app commands, document headings, " +
    "and recently opened files. Fully keyboard-driven. Keybinding is remappable " +
    "in Preferences > Keyboard Shortcuts.",

  renderDetailExtra,

  async onEnable(api: MarkablePluginAPI): Promise<void> {
    _api = api;
    await loadPluginSettings(api);
    injectCSS();
    _overlayEl = buildOverlayDOM();
    _inputEl = _overlayEl.querySelector<HTMLInputElement>(".cb-input")!;
    _resultsEl = _overlayEl.querySelector<HTMLElement>(".cb-results")!;
    attachListeners();
    document.body.appendChild(_overlayEl);

    // Register the open function for handleAction() dispatch (AD-03).
    (window as any).__MARKABLE_COMMAND_BAR_OPEN__ = openBar;
  },

  onDisable(api: MarkablePluginAPI): void {
    // Clean close if bar happens to be open (EC-20).
    if (_isOpen) closeBar();

    // Detach listeners and remove DOM.
    detachListeners();
    _overlayEl?.remove();

    // Deregister window globals.
    (window as any).__MARKABLE_COMMAND_BAR_OPEN__ = null;
    (window as any).__MARKABLE_COMMAND_BAR_IS_OPEN__ = false;

    // Remove injected CSS.
    removeCSS();

    // Null out all module-level state.
    _overlayEl = null;
    _inputEl = null;
    _resultsEl = null;
    _api = null;
    _allResults = [];
    _visibleResults = [];
    _selectedId = null;
    _isOpen = false;
  },
};
```

---

## `attachListeners()` / `detachListeners()` — complete implementation

Because all DOM listeners are attached to `_overlayEl` (a delegating root), they are
automatically removed when `_overlayEl.remove()` is called. Only the `document`-level
listener for `markable-tab-closed` (EC-12) needs explicit removal:

```typescript
function attachListeners(): void {
  if (!_overlayEl || !_inputEl || !_resultsEl) return;

  // Input: filter on each keystroke
  _inputEl.addEventListener("input", onInput);

  // Overlay keydown: Escape, arrows, Enter, Tab
  _overlayEl.addEventListener("keydown", onOverlayKeydown);

  // Backdrop click
  _overlayEl.addEventListener("click", onBackdropClick);

  // Result click (delegated)
  _resultsEl.addEventListener("click", onResultClick);

  // Result hover (delegated)
  _resultsEl.addEventListener("mousemove", onResultHover);

  // Tab close guard (EC-12)
  document.addEventListener("markable-tab-closed", onTabClosed);
}

function detachListeners(): void {
  document.removeEventListener("markable-tab-closed", onTabClosed);
  // DOM listeners on _overlayEl are removed with the element.
}
```

Each handler is a named function at module scope so it can be referenced by both
`addEventListener` and `removeEventListener` without creating new function objects.

---

## Named handler functions (module-level)

```typescript
function onInput(this: HTMLInputElement): void {
  filterAndRender(this.value.trim());
}

function onOverlayKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case "Escape":  e.preventDefault(); e.stopPropagation(); closeBar(); break;
    case "ArrowDown": e.preventDefault(); e.stopPropagation(); moveSelection(1); break;
    case "ArrowUp":   e.preventDefault(); e.stopPropagation(); moveSelection(-1); break;
    case "Enter":     e.preventDefault(); e.stopPropagation(); activateSelected(); break;
    case "Tab":       e.preventDefault(); e.stopPropagation(); moveSelection(e.shiftKey ? -1 : 1); break;
  }
}

function onBackdropClick(e: MouseEvent): void {
  if (e.target === _overlayEl) closeBar();
}

function onResultClick(e: MouseEvent): void {
  const row = (e.target as Element).closest(".cb-result") as HTMLElement | null;
  if (!row) return;
  const resultId = row.dataset.id;
  if (!resultId) return;
  const result = _visibleResults.find((r) => r.id === resultId);
  if (!result || result.dimmed) return;
  _selectedId = resultId;
  closeBar();
  result.action();
}

function onResultHover(e: MouseEvent): void {
  const row = (e.target as Element).closest(".cb-result") as HTMLElement | null;
  if (!row) return;
  const resultId = row.dataset.id;
  if (!resultId) return;
  const result = _visibleResults.find((r) => r.id === resultId);
  if (!result || result.dimmed) return;
  if (_selectedId === resultId) return;
  _selectedId = resultId;
  if (!_inputEl) return;
  renderResults(_resultsEl!, _visibleResults, _inputEl.value, _selectedId);
  updateAriaActiveDescendant(_inputEl, _selectedId);
}

function onTabClosed(): void {
  if (_isOpen) closeBar();
}
```

---

## Build registration in `scripts/build-plugins.mjs`

Add to the `PLUGINS` array after `"media-preview"`:

```javascript
["command-bar", "src/plugins/command-bar/command-bar.plugin.ts"],
```

The full updated array:
```javascript
const PLUGINS = [
  ["focus-mode",        "src/plugins/focus-mode/focus-mode.plugin.ts"],
  ["typewriter-mode",   "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"],
  ["word-count",        "src/plugins/word-count/word-count.plugin.ts"],
  ["auto-toc",          "src/plugins/auto-toc/auto-toc.plugin.ts"],
  ["markdown-toolbar",  "src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts"],
  ["backlinks",         "src/plugins/backlinks/backlinks.plugin.ts"],
  ["templates",         "src/plugins/templates/templates.plugin.ts"],
  ["yaml-pane",         "src/plugins/yaml-pane/yaml-pane.plugin.ts"],
  ["math",              "src/plugins/math/math.plugin.ts"],
  ["media-preview",     "src/plugins/media-preview/media-preview.plugin.ts"],
  ["command-bar",       "src/plugins/command-bar/command-bar.plugin.ts"],
];
```

---

## Stale plugin cleanup in Rust

The `copy_core_plugins` command in `src-tauri/src/commands/plugins.rs` performs a
cleanup step that removes `.js` files in the core plugins directory that are not in
the current bundle. Since `command-bar.js` is a new file, no removal is needed. The
existing cleanup logic handles this automatically — after the copy, any file present
in the destination but not in the source is removed.

No Rust changes are required for this step.

---

## File structure

After all steps are complete:

```
src/plugins/command-bar/
  command-bar.plugin.ts    ← main plugin file (IIFE entry point)
  fuzzy-ranker.ts          ← pure fuzzy match module (imported by plugin, bundled inline)

tests/plugins/command-bar/
  command-bar.test.ts      ← all unit tests

src-tauri/plugins/core/
  command-bar.js           ← built output (after npm run build:plugins)
```

---

## NFR-01 performance verification

On open, the following synchronous work is done:
1. `buildAllResults(_settings)` — calls three builders.
   - Category A: iterates `COMMANDS` (~50 entries) + `pluginManager.getDefinitions()` (~10 entries). O(60).
   - Category B: scans CM6 document lines. For a 50,000-line doc with 500 headings,
     `doc.iterLines()` is a single O(n) pass. At 2ns/op (modern JS), 50,000 iterations
     ≈ 0.1ms. Well within budget.
   - Category C: iterates `settings.recentFiles` (≤10 entries). O(10).
2. `renderResults()` — creates DOM nodes for all results. At ~60 category A +
   500 category B + 10 category C = ~570 nodes, DOM creation takes ≈5–10ms.
3. Total estimated: <20ms. Budget: 80ms (NFR-01). Comfortable margin.

For NFR-02 (filter latency <50ms): fuzzyMatch on 570 items, each ~30-char label.
Subsequence match is O(n × m) where n = label length, m = query length. At worst:
570 × 30 × 20 (max query) = 342,000 char comparisons ≈ 0.3ms. Negligible.

---

## Integration test cases

These supplement the unit tests with end-to-end behavior assertions:

```typescript
// Full enable/disable cycle: no stale DOM after disable
plugin.onDisable(mockApi);
expect(document.getElementById("markable-command-bar-overlay")).toBeNull();
expect(document.getElementById("__markable_command_bar_css__")).toBeNull();

// Re-enable after disable: overlay is recreated
await plugin.onEnable(mockApi);
expect(document.getElementById("markable-command-bar-overlay")).toBeTruthy();

// EC-30: plugin manager state read fresh on each open
// Simulate enabling Focus Mode between opens:
// First open: Focus Mode Disabled (it was disabled)
// Enable Focus Mode externally
// Second open: Focus Mode Enabled (it is now enabled)
// → verified by checking Category A result labels on second open
```

---

## EC Coverage (this step completes remaining edge cases)

| Edge Case | Coverage |
|---|---|
| EC-14: remapped Cmd-Shift-P | `resolveAction()` in main.ts keydown handler handles this; plugin has no hard-coded key |
| EC-15: key conflict | Keybindings panel handles conflict detection; no special behavior in Command Bar |
| EC-28: heading at line 1 | `buildHeadingResults` scans from line 1; no special case |
| EC-30: hot-loaded plugin | `buildAllResults()` calls `pluginManager.getDefinitions()` fresh on every open |

---

## Acceptance Criteria

- [ ] `npm run build:plugins` succeeds and produces `src-tauri/plugins/core/command-bar.js`.
- [ ] `command-bar.js` is ≤500 KB (NFR: plugin size limit).
- [ ] `onEnable` → `onDisable` → `onEnable` cycle leaves no duplicate DOM nodes.
- [ ] `onDisable` removes the overlay, the CSS style tag, and all document listeners.
- [ ] `window.__MARKABLE_COMMAND_BAR_OPEN__` is null after `onDisable`.
- [ ] Opening the bar, switching tabs, and pressing Cmd-Shift-P again works correctly.
- [ ] EC-30: newly loaded plugins appear in Category A results on the next open.
- [ ] EC-14: pressing a remapped key opens the bar; original Cmd-Shift-P does not (if remapped).
- [ ] Full manual verification checklist (see below).
- [ ] All tests in `tests/plugins/command-bar/command-bar.test.ts` pass.
- [ ] `npm test` passes for the full test suite.
- [ ] `npm run build` passes with no TypeScript errors.

---

## Manual verification checklist

Before marking this feature complete, the developer must verify each item visually:

- [ ] Cmd-Shift-P opens the bar. Input is focused immediately.
- [ ] Bar is centered horizontally, in upper third of window (FR-08.1).
- [ ] First non-dimmed result is pre-selected.
- [ ] Typing filters results in real time. Matched characters are highlighted.
- [ ] Arrow Up/Down navigates. Wrap-around works.
- [ ] Enter executes the selected result. Bar closes.
- [ ] Escape closes the bar. Editor regains focus.
- [ ] Clicking backdrop closes the bar.
- [ ] Tab navigates down, Shift-Tab navigates up. Focus never escapes the overlay.
- [ ] Plugin toggled off: pressing Cmd-Shift-P does nothing.
- [ ] Plugin re-enabled: Cmd-Shift-P works again. No duplicate overlays.
- [ ] Open the bar, disable a plugin via the Plugins Panel, close panel, open bar again:
  the plugin's toggle entry reflects its new state.
- [ ] With no file open: format commands and heading results are dimmed, not selectable.
- [ ] Document with no headings: "Headings" section header is absent.
- [ ] No recent files: "Recent Files" section header is absent.
- [ ] All three categories disabled: "No results" placeholder shown.
- [ ] Long label is truncated with ellipsis; full text on hover.
- [ ] Keybinding badge visible for commands with key; absent for commands with empty key.
- [ ] Heading level badge (H1/H2/H3...) visible next to heading results.
- [ ] Clicking a recent file opens it in a new tab. Bar closes.
- [ ] Clicking a heading result scrolls the editor to that heading. Bar closes.

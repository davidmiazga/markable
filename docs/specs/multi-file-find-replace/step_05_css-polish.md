---
title: Step 05 — CSS polish and viewport overflow
last-updated: "2026-05-03"
review-cadence-days: 90
status: active
---

# Step 05 — CSS polish and viewport overflow

## Objective

This is the final polishing step. It addresses:

1. **EC-16 / FR-16**: Viewport overflow when the widget is positioned near the
   bottom of the screen and the results panel expands downward.
2. **EC-19**: Ensure `_clampY` uses the correct post-expansion `offsetHeight`.
3. **FR-16 / NFR-7**: Dynamically reduce `max-height` of the results panel when
   the widget's position would cause it to overflow the viewport.
4. **Small-screen reflow** at `max-width: 400px`.
5. **Dark-mode shadows** and any residual polish items.

After this step `npm run test:run` must pass and
`npm run build:plugins && npm run sync:plugins` must succeed.

---

## Files to edit

- `src/editor/find-widget.ts` — `_clampY` update; dynamic results panel height
- `src/editor/find-widget.css` — minor polish rules

---

## Part A: Viewport overflow clamping (EC-16, EC-19, FR-16)

### Problem statement

The widget starts at `top: 54px` (default, right edge). When vault scope is
active, the results panel expands the widget downward. If the user has dragged
the widget near the bottom of the viewport before activating vault scope, the
panel overflows below the visible area.

The existing `_clampY(y)` method clamps drag positions but is not called when
the results panel expands in-place (only called during drag). EC-19 notes that
drag continues to work because the whole widget moves; the issue is the initial
growth after scope switch.

### Solution in `find-widget.ts`

Add a private method `_clampVaultResultsHeight()` that is called:
- After `_renderVaultResults()` renders new content.
- After `_showConfirmationPanel()` is called.

```typescript
/**
 * Dynamically clamp the max-height of the vault results panel so the widget
 * does not overflow the viewport vertically (EC-16, FR-16).
 *
 * The available height below the widget's current top edge, minus the
 * height of the find/scope/replace rows, is the maximum space for the
 * results panel.
 *
 * Called after any operation that changes the results panel content.
 */
private _clampVaultResultsHeight(): void {
  const PADDING = 16; // px below widget before hitting viewport edge
  const MIN_RESULTS_HEIGHT = 80; // never shrink below this (usability floor)
  const DEFAULT_MAX_HEIGHT = 320; // FR-16 default

  const widgetTop = parseFloat(this.root.style.top) || 54;
  const viewportHeight = window.innerHeight;

  // Height of non-results content (find row + scope row + replace row).
  // Measure the actual offsetHeight of the root before the panel expanded.
  // If the panel is currently visible, subtract its scrollHeight from the total.
  const panelScrollHeight = this.vaultResultsPanel.scrollHeight || 0;
  const currentRootHeight = this.root.offsetHeight || 200;
  const nonPanelHeight = currentRootHeight - Math.min(panelScrollHeight, DEFAULT_MAX_HEIGHT);

  const availableForPanel =
    viewportHeight - widgetTop - nonPanelHeight - PADDING;

  const clampedMax = Math.max(
    MIN_RESULTS_HEIGHT,
    Math.min(DEFAULT_MAX_HEIGHT, availableForPanel),
  );

  this.vaultResultsPanel.style.maxHeight = `${clampedMax}px`;
  this.confirmationPanel.style.maxHeight = `${clampedMax}px`;
}
```

### Where to call `_clampVaultResultsHeight()`

1. At the end of `_renderVaultResults()`, after the panel content is built:

```typescript
// After all DOM nodes are appended to panel:
this._clampVaultResultsHeight();
```

2. At the end of `_showConfirmationPanel()`, after `panel.style.display = "block"`:

```typescript
this._clampVaultResultsHeight();
```

3. In the drag `_onMouseMove` handler, after `this.root.style.top = ...`:

```typescript
// Re-clamp results panel height as the widget is dragged vertically.
if (this._vaultResults) {
  this._clampVaultResultsHeight();
}
```

### Update `_clampY()` to account for expanded widget height (EC-19)

The existing `_clampY` method uses `this.root.offsetHeight` which correctly
includes the results panel once it is visible:

```typescript
private _clampY(y: number): number {
  const widgetHeight = this.root.offsetHeight || 100;
  const maxY = window.innerHeight - widgetHeight;
  return Math.max(0, Math.min(y, Math.max(0, maxY)));
}
```

No change is needed to `_clampY` itself — `offsetHeight` already accounts for
the expanded panel. The fix in Part A (calling `_clampVaultResultsHeight` in
the mousemove handler) ensures the panel does not overflow while dragging.

---

## Part B: `src/editor/find-widget.css` polish additions

Add the following to the end of the file (after all step_02 through step_04
additions):

```css
/* ---- Step 05 polish ---- */

/* Dark mode: extra shadow depth for vault results panel. */
[data-theme="dark"] .find-widget-vault-results {
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* Smooth open animation for vault results panel. */
.find-widget-vault-results {
  transition: max-height 0.1s ease;
}

/* Scope row: add subtle separator when vault results are visible. */
.find-widget-scope-row + .find-widget-vault-results {
  border-top: none; /* Avoid double border — scope row already has border-top */
}

/* Confirmation panel dark mode. */
[data-theme="dark"] .find-widget-confirmation {
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* Prevent regexpDisabledMsg overlay from overlapping inputs. */
.find-widget-regexp-disabled {
  /* Hidden by default; shown via JS when vault scope is active. */
  display: none;
  position: absolute;
  font-size: 10px;
  color: var(--text-secondary);
  background: var(--search-panel-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 2px 6px;
  pointer-events: none;
  z-index: 201;
  white-space: nowrap;
}

/* Narrow viewport: cap the max-height more aggressively (FR-16). */
@media (max-height: 500px) {
  .find-widget-vault-results {
    max-height: 150px;
  }
  .find-widget-confirmation {
    max-height: 150px;
  }
}

/* Focus visible ring for scope row buttons. */
.find-widget-scope-btn:focus-visible {
  outline: 2px solid var(--link-color);
  outline-offset: 1px;
}
```

---

## Part C: Settings scope persistence — complete `_saveScope` and `_restoreScope`

These methods were introduced in step_02. Verify they interact correctly with
the `findWidgetScope` field added to `MarkableSettings` in step_02 Part B.

No code changes needed in step_05 if step_02 was implemented correctly. This
is a verification checkpoint only:

- `getCurrentSettings().findWidgetScope` is read in `_restoreScope()` on
  `open()`.
- `updateSettings((s) => ({ ...s, findWidgetScope: this._scope }))` is called
  in `_saveScope()` on every `_setScope()` call.
- Persisted key: `findWidgetScope` (a new optional field on `MarkableSettings`).

If the field is absent (old settings file), `_restoreScope()` defaults to
`"file"` via the `?? "file"` guard. No migration is needed.

---

## No new tests required in this step

Step 05 changes are purely visual / defensive positioning logic. The
`_clampVaultResultsHeight` method depends on `offsetHeight` / `scrollHeight`
which are not available in JSDOM (always 0). Testing this method in unit tests
would require mocking layout properties, which is fragile.

Instead, verify via manual testing:
1. Open the find widget with a vault active.
2. Drag the widget so its top edge is within 200px of the viewport bottom.
3. Switch to "Vault" scope and type a query with multiple results.
4. Verify the results panel does not overflow below the viewport.
5. Drag the widget upward and verify the results panel expands back to 320px.

The existing `npm run test:run` suite must still pass (no regressions).

---

## Final checklist before marking the feature complete

After step_05, run the following commands and verify all pass:

```bash
npm run test:run
npm run build:plugins && npm run sync:plugins
npm run test:run -- tests/settings/window-defaults.test.ts
```

Additionally verify manually:

- [ ] AC-1: No vault active → widget opens with no scope toggle, behaviour
      identical to today.
- [ ] AC-2: Vault active → scope toggle shows "File" and "Vault".
- [ ] AC-3: Vault scope + typing → results appear after 150 ms debounce.
- [ ] AC-4: File groups show title, count, 3 excerpts; "Show all N" expands.
- [ ] AC-5: `capped: true` → notice below results.
- [ ] AC-6: Folder selected in file browser → "Folder" scope option appears.
- [ ] AC-7: Switching to "File" scope → results panel hidden.
- [ ] AC-8: "Replace" in vault scope with focused match → replaces match.
- [ ] AC-9: "In File" → replaces all in focused file.
- [ ] AC-10: "Replace All" → confirmation panel shown first.
- [ ] AC-11: "Confirm" → sequential processing + progress indicators.
- [ ] AC-12: "Cancel" → results restored, no writes.
- [ ] AC-13: `_matchCase` active → only exact-case results shown.
- [ ] AC-14: `_wholeWord` active → only word-boundary results shown.
- [ ] AC-15: `_regexp` active + vault scope → toggle visually disabled.
- [ ] AC-16: Dirty tab hit → per-file prompt before write.
- [ ] AC-17: Write failure → progress panel marks file failed, batch continues.
- [ ] AC-18: Escape in confirmation panel → returns to results, does not close.
- [ ] AC-19: Scope selection persists across close/reopen.
- [ ] AC-20: All existing FindWidget tests pass.
- [ ] AC-21: Unit tests cover (a) case-sensitive filter, (b) whole-word filter,
      (c) replace mechanics.

---

## Acceptance criteria for this step

- AC-S5-1: The vault results panel does not overflow the viewport when the
  widget is dragged near the viewport bottom.
- AC-S5-2: `_clampY` correctly uses the expanded `offsetHeight` during drag
  (EC-19).
- AC-S5-3: The `@media (max-width: 400px)` breakpoint correctly reflows the
  scope row and caps the results panel height.
- AC-S5-4: No new test failures introduced.
- AC-S5-5: `npm run build:plugins && npm run sync:plugins` succeeds.
- AC-S5-6: Window size regression test passes:
  `npm run test:run -- tests/settings/window-defaults.test.ts`

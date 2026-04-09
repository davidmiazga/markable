# Step 01 — Suppress CM6 Panel Factory + Clean Up search-theme.ts

**Goal:** Replace `search({ top: false })` with a panel-suppressed equivalent so the CM6 search state field remains functional but no CM6 panel DOM is ever injected. Also strip the now-unnecessary panel CSS rules from `search-theme.ts`.

---

## Files to Change

| File | Change type |
|---|---|
| `src/editor/extensions.ts` | Modify: replace `search({ top: false })` |
| `src/editor/search-theme.ts` | Modify: remove panel rules, retain match highlight rules |

---

## 1. `src/editor/extensions.ts`

### What to change

Remove the `search({ top: false })` call. Replace it with `search({ createPanel: () => hiddenPanel })` where `hiddenPanel` is a minimal hidden `Panel` object constructed once at module scope.

### Exact change

**Before (line 109):**
```typescript
extensions.push(search({ top: false }));
```

**After:**

Add before `buildExtensions()` (at module scope, after the existing imports):

```typescript
/**
 * FR-2.2 / TC-2: Suppress the CM6 built-in search panel DOM entirely.
 *
 * search() must be registered so that its searchState StateField is
 * present in the editor state — without it, setSearchQuery, findNext,
 * findPrevious, replaceNext, replaceAll, and searchKeymap all silently
 * no-op. However, the default panel factory injects .cm-panels DOM that
 * conflicts with the custom FindWidget.
 *
 * createPanel returns a minimal Panel whose dom is a zero-size hidden div.
 * CM6 mounts this "panel" but it contributes nothing to layout.
 * openSearchPanel / closeSearchPanel are never called from application
 * code (main.ts uses FindWidget.open/close instead), so the togglePanel
 * effect that would make the hidden div visible is never dispatched in
 * normal operation.
 */
const _hiddenPanelDom = Object.assign(document.createElement("div"), {
  style: "display:none;width:0;height:0;overflow:hidden;position:absolute",
} as Partial<CSSStyleDeclaration> & { style: string });
const _suppressedPanel = { dom: _hiddenPanelDom };
```

Replace the `search({ top: false })` push:

```typescript
// TC-2: search() registers the searchState StateField required by
// setSearchQuery, findNext, findPrevious, replaceNext, replaceAll.
// createPanel is overridden to suppress the built-in panel DOM.
// See docs/specs/find-replace/00_index.md § TC-2 Resolution.
// IMPORTANT: search() must be registered BEFORE Prec.high(keymap.of(searchKeymap)).
extensions.push(search({ createPanel: () => _suppressedPanel }));
```

### Full updated `buildExtensions` order

After this change, the extension list inside `buildExtensions()` is:

1. `markdown(...)`
2. `EditorView.lineWrapping`
3. `Prec.high(keymap.of(formatKeymap))`
4. `search({ createPanel: () => _suppressedPanel })`
5. `Prec.high(keymap.of(searchKeymap))`
6. `baseTheme`
7. `searchTheme`
8. `syntaxHighlighting(themeHighlight)`
9. `previewCompartment.of(previewExtensions)`

---

## 2. `src/editor/search-theme.ts`

### What to remove

Remove all rules that style the CM6 panel DOM. The CM6 panel DOM no longer exists, so these rules are dead code:

- `.cm-panels` block
- `.cm-search` block
- `.cm-search label` block
- `.cm-textfield` block
- `.cm-textfield:focus` block
- `.cm-textfield.cm-not-found` block
- `.cm-button` block
- `.cm-button:hover` block
- `.cm-button:active` block

### What to keep

The following rules style document-level decorations applied by CM6's match highlighting ViewPlugin. They are independent of the panel and must be retained:

- `.cm-searchMatch` block
- `.cm-searchMatch.cm-searchMatch-selected` block

### Target state of `search-theme.ts` after this step

```typescript
/**
 * Search match highlight theme for Markable.
 *
 * These rules style the document-level decorations that CM6 applies to
 * matched text when a SearchQuery is active. They are independent of
 * the panel UI — the custom FindWidget (src/editor/find-widget.ts) manages
 * its own appearance via src/editor/find-widget.css.
 *
 * CSS custom properties (defined in styles.css):
 *   --search-match-bg            highlight color for all non-active matches
 *   --search-match-selected-bg   highlight color for the active (current) match
 */
import { EditorView } from "@codemirror/view";

export const searchTheme = EditorView.theme({
  /**
   * FR-4.1 / AC-15: All non-active match highlights.
   * Semi-transparent so the underlying text remains readable.
   */
  ".cm-searchMatch": {
    backgroundColor: "var(--search-match-bg)",
    outline: "none",
    borderRadius: "2px",
  },
  /**
   * FR-4.2 / AC-15: The currently active (selected) match highlight.
   * More saturated than .cm-searchMatch so the user can track position.
   */
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--search-match-selected-bg)",
    outline: "1px solid color-mix(in srgb, var(--search-match-selected-bg) 80%, transparent)",
  },
});
```

---

## Acceptance Criteria

- [ ] `tsc --noEmit` passes with no errors after this change.
- [ ] Opening the app and pressing Cmd-G does not throw; the editor does not display any CM6 panel DOM at the bottom.
- [ ] No `.cm-panels` element exists in the DOM (verify via DevTools).
- [ ] `search-theme.ts` contains no `.cm-panels`, `.cm-search`, `.cm-textfield`, or `.cm-button` selectors.
- [ ] `search-theme.ts` still contains `.cm-searchMatch` and `.cm-searchMatch.cm-searchMatch-selected`.
- [ ] The existing 29 Rust tests and 34 Vitest tests still pass (no regressions from removing search-theme rules).

---

## Notes

- The `_hiddenPanelDom` and `_suppressedPanel` objects are module-level constants, not re-created on each `buildExtensions()` call. This is safe because `Panel.dom` is never mutated by CM6 — it is only appended/removed from the DOM by the `showPanel` facet.
- The `top: false` option previously on `search()` is not replicated — it controls panel position, which is now irrelevant.
- The comment referencing `FR-2.2` in the old `search()` call (about newlines in search field) is removed — EC-13 handling now lives in `find-widget.ts`.

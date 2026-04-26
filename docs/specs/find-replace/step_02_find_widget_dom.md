# Step 02 — FindWidget DOM Structure + CSS Skeleton

**Goal:** Create `src/editor/find-widget.ts` and `src/editor/find-widget.css`. This step covers only DOM construction, the open/close/isOpen API, and the CSS skeleton. CM6 search logic is wired in step_03. Drag is wired in step_04.

**Precondition:** step_01 complete (`search()` is using the suppressed panel factory).

---

## Files to Create

| File | Purpose |
|---|---|
| `src/editor/find-widget.ts` | `FindWidget` class exported as named export + `createFindWidget` factory |
| `src/editor/find-widget.css` | Widget-specific styles |

---

## 1. `src/editor/find-widget.ts` — DOM Construction

### Module structure

```typescript
import type { EditorView } from "@codemirror/view";
import "./find-widget.css";

// --- Public types ---

export interface FindWidgetPosition {
  x: number;
  y: number;
}

// --- FindWidget class ---

export class FindWidget {
  private view: EditorView;
  private root: HTMLDivElement;
  private header: HTMLDivElement;
  private findInput: HTMLInputElement;
  private replaceInput: HTMLInputElement;
  private countLabel: HTMLSpanElement;
  private toggleMatchCase: HTMLButtonElement;
  private toggleWholeWord: HTMLButtonElement;
  private toggleRegexp: HTMLButtonElement;
  private chevronBtn: HTMLButtonElement;
  private replaceRow: HTMLDivElement;
  private replaceOneBtn: HTMLButtonElement;
  private replaceAllBtn: HTMLButtonElement;
  private _isOpen: boolean = false;
  private _replaceVisible: boolean = false;

  constructor(view: EditorView) {
    this.view = view;
    this.root = this._buildDom();
    document.body.appendChild(this.root);
  }

  // ... methods described below
}

// --- Factory function (FR-3.1) ---
export function createFindWidget(view: EditorView): FindWidget {
  return new FindWidget(view);
}
```

### DOM structure

The `_buildDom()` private method constructs the following HTML structure exactly matching FR-3.2:

```
div.find-widget[role="dialog"][aria-label="Find"][style="display:none; position:fixed; ..."]
  div.find-widget-header
    span.find-widget-label  (text: "Find")
  div.find-widget-find-row
    button.find-widget-chevron[aria-label="Toggle replace" title="Toggle Replace"]  (›)
    input.find-widget-input[type="text"][placeholder="Find"][aria-label="Find"]
    button.find-widget-toggle[data-name="matchCase"][aria-label="Match Case" title="Match Case"]  (Aa)
    button.find-widget-toggle[data-name="wholeWord"][aria-label="Whole Word" title="Whole Word"]  (ab)
    button.find-widget-toggle[data-name="regexp"][aria-label="Use Regular Expression" title="Use Regular Expression"]  (.*)
    span.find-widget-count[aria-live="polite"]
    button.find-widget-prev[aria-label="Previous Match" title="Previous Match (Shift+Enter)"]  (↑)
    button.find-widget-next[aria-label="Next Match" title="Next Match (Enter)"]   (↓)
    button.find-widget-close[aria-label="Close" title="Close (Escape)"]  (×)
  div.find-widget-replace-row[style="display:none"]
    input.find-widget-replace-input[type="text"][placeholder="Replace"][aria-label="Replace"]
    button.find-widget-replace-one[aria-label="Replace" title="Replace (Enter)"]  (Replace)
    button.find-widget-replace-all[aria-label="Replace All" title="Replace All"]  (All)
```

**Positioning:** The root element is appended to `document.body` with `position: fixed`. The `top` and `right` CSS properties are set as inline styles by `open()` based on saved position or the default. No `left` is set at default position — `right: 16px` is used so the widget anchors to the right edge. When drag begins (step_04), `right` is cleared and `left` is set.

**Default position calculation (D-3):**

```typescript
private _defaultPosition(): { top: string; right: string } {
  // titlebar is 38px (--titlebar-height). Widget sits 16px below it.
  return { top: '54px', right: '16px' };
}
```

The value `54px` = `38px` (titlebar) + `16px` (margin). This satisfies AC-8 (widget does not overlap title bar).

### `open(mode: 'find' | 'replace')` method

```typescript
open(mode: 'find' | 'replace'): void {
  // EC-2: If already open, just focus the find input. Do not re-initialize position.
  if (this._isOpen) {
    this.findInput.focus();
    this.findInput.select();
    return;
  }

  // Apply persisted or default position
  this._restorePosition();

  // Show or hide replace row based on mode
  this._setReplaceVisible(mode === 'replace');

  // Update header label
  this._headerLabel.textContent = mode === 'replace' ? 'Find & Replace' : 'Find';

  // Show widget
  this.root.style.display = 'flex';
  this._isOpen = true;

  // FR-3.6 / FR-3.7: Focus the find input in both modes; select existing content
  this.findInput.focus();
  this.findInput.select();
}
```

### `close()` method

```typescript
close(): void {
  if (!this._isOpen) return;
  this.root.style.display = 'none';
  this._isOpen = false;
  // FR-10.3: Return focus to the CM6 editor
  this.view.focus();
}
```

### `isOpen()` method

```typescript
isOpen(): boolean {
  return this._isOpen;
}
```

### `setPreFill(text: string)` method

Called by `main.ts` before `open()` when a text selection exists.

```typescript
setPreFill(text: string): void {
  // FR-5.3 / EC-13: Only use text up to the first newline.
  // Multi-line selections are truncated to the first line.
  const firstLine = text.split('\n')[0];
  this.findInput.value = firstLine;
}
```

### `_setReplaceVisible(visible: boolean)` private method

```typescript
private _setReplaceVisible(visible: boolean): void {
  this._replaceVisible = visible;
  this.replaceRow.style.display = visible ? 'flex' : 'none';
  this.chevronBtn.textContent = visible ? '›' : '›';
  this.chevronBtn.setAttribute('aria-expanded', String(visible));
  // Rotate chevron via CSS class
  this.chevronBtn.classList.toggle('expanded', visible);
}
```

### Escape key handler

Registered on `this.root` as a `keydown` listener during construction:

```typescript
this.root.addEventListener('keydown', (e: KeyboardEvent) => {
  // EC-17: Only active when widget is visible (handled by the fact that
  // the widget root only receives events when display !== 'none').
  // EC-27: Escape from replace input also closes the widget.
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    this.close();
  }
});
```

### Chevron toggle handler

```typescript
this.chevronBtn.addEventListener('click', () => {
  this._setReplaceVisible(!this._replaceVisible);
});
```

---

## 2. `src/editor/find-widget.css` — CSS Skeleton

This step creates the CSS file with layout and structural rules only. Colors and theming tokens are added in step_06, but the structural tokens must be present now so the widget is usable for testing.

```css
/* ============================================================
   Find Widget — Markable 2.0
   A floating find/replace panel modeled after VS Code's find widget.
   All colors use CSS custom properties defined in styles.css.
   ============================================================ */

.find-widget {
  /* Structural layout */
  display: flex;             /* set to 'none' when hidden */
  flex-direction: column;
  gap: 0;

  /* Positioning — top/right set by JS on open() */
  position: fixed;
  z-index: 200;              /* above editor content (max 10); below settings panel (1000) */

  /* Size */
  min-width: 320px;
  max-width: 480px;

  /* Visual — tokens filled in step_06 */
  background-color: var(--search-panel-bg);
  border: 1px solid var(--search-panel-border);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);

  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  color: var(--text-primary);

  /* Prevent text selection in the editor underneath during interactions */
  user-select: none;
  -webkit-user-select: none;
}

/* ---- Header / drag handle ---- */

.find-widget-header {
  display: flex;
  align-items: center;
  padding: 6px 10px 4px 10px;
  cursor: move;              /* FR-7.1: indicates draggability */
  border-bottom: 1px solid var(--search-panel-border);
  min-height: 24px;
}

.find-widget-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  pointer-events: none;      /* prevent label from capturing drag mousedown */
}

/* ---- Find row ---- */

.find-widget-find-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  flex-wrap: nowrap;
}

/* ---- Chevron toggle ---- */

.find-widget-chevron {
  /* Shares base button styles but rotates on expand */
  transition: transform 0.15s ease;
  flex-shrink: 0;
}

.find-widget-chevron.expanded {
  transform: rotate(90deg);
}

/* ---- Find / Replace inputs ---- */

.find-widget-input,
.find-widget-replace-input {
  flex: 1;
  min-width: 0;              /* allow shrinking below intrinsic width */
  padding: 3px 7px;
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
  outline: none;

  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.find-widget-input:focus,
.find-widget-replace-input:focus {
  border-color: var(--link-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--link-color) 20%, transparent);
}

/* FR-12.2 / EC-3: Error state — no matches found */
.find-widget-input.find-widget-no-results {
  border-color: hsl(0, 72%, 51%);
  background-color: color-mix(in srgb, hsl(0, 72%, 51%) 12%, var(--bg-primary));
}

/* FR-12.3: Invalid regexp state */
.find-widget-input.find-widget-invalid-regexp {
  border-color: hsl(30, 90%, 50%);
  background-color: color-mix(in srgb, hsl(30, 90%, 50%) 10%, var(--bg-primary));
}

/* ---- Toggle buttons (match case, whole word, regexp) ---- */

.find-widget-toggle {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid transparent;

  background-color: transparent;
  color: var(--text-secondary);
  transition: background-color 0.1s ease, color 0.1s ease;
}

.find-widget-toggle:hover {
  background-color: color-mix(in srgb, var(--text-primary) 8%, var(--bg-primary));
  color: var(--text-primary);
}

/* FR-9.5 / AC-18-20: Active state for toggle buttons */
.find-widget-toggle.active {
  background-color: color-mix(in srgb, var(--link-color) 15%, var(--bg-primary));
  color: var(--link-color);
  border-color: color-mix(in srgb, var(--link-color) 35%, transparent);
}

/* ---- Count label ---- */

.find-widget-count {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  min-width: 48px;
  text-align: center;
  flex-shrink: 0;
}

.find-widget-count.no-results {
  color: hsl(0, 72%, 51%);
}

/* ---- Navigation + close buttons ---- */

.find-widget-prev,
.find-widget-next,
.find-widget-close {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 4px;
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;

  background-color: transparent;
  color: var(--text-secondary);
  transition: background-color 0.1s ease, color 0.1s ease;
}

.find-widget-prev:hover,
.find-widget-next:hover,
.find-widget-close:hover {
  background-color: color-mix(in srgb, var(--text-primary) 8%, var(--bg-primary));
  color: var(--text-primary);
}

/* ---- Replace row ---- */

.find-widget-replace-row {
  display: none;             /* toggled by JS */
  align-items: center;
  gap: 4px;
  padding: 4px 8px 6px 8px;
  border-top: 1px solid var(--search-panel-border);
}

.find-widget-replace-one,
.find-widget-replace-all {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;

  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  transition: background-color 0.1s ease;
}

.find-widget-replace-one:hover,
.find-widget-replace-all:hover {
  background-color: color-mix(in srgb, var(--text-primary) 8%, var(--bg-primary));
}

/* ---- EC-21: Viewport clamping at narrow widths ---- */
@media (max-width: 400px) {
  .find-widget {
    min-width: 0;
    width: calc(100vw - 32px);
    right: 16px !important;
    left: 16px !important;
  }
}
```

---

## Acceptance Criteria

- [ ] `tsc --noEmit` passes with no TypeScript errors.
- [ ] `createFindWidget(view)` can be called and returns a `FindWidget` instance without throwing.
- [ ] The widget root element exists in `document.body` after construction.
- [ ] Widget is hidden (`display: none`) by default (FR-10.1).
- [ ] `open('find')`: widget becomes visible, find input is focused, replace row is hidden.
- [ ] `open('replace')`: widget becomes visible, replace row is visible, find input is focused.
- [ ] `open()` called twice: second call does not re-initialize position; find input is focused.
- [ ] `close()`: widget becomes hidden, focus returns to editor (verify `view.focus()` called).
- [ ] `isOpen()`: returns `true` after `open()`, `false` after `close()`.
- [ ] Escape key press inside the widget calls `close()`.
- [ ] Chevron click toggles the replace row visibility.
- [ ] Widget DOM structure matches FR-3.2 exactly (verify by inspecting `document.body` in DevTools).
- [ ] Widget default position is below the title bar (top ~54px, right 16px) — AC-6, AC-8.
- [ ] No `.cm-panels` element exists in the DOM.
- [ ] CSS file is valid and loads without errors (check browser console).

---

## Notes

- `setPreFill()` is a public method called by `main.ts` before `open()`. It does not call `open()` itself.
- `_restorePosition()` is implemented in step_04. In this step, it can be a stub that sets the default position.
- The `_headerLabel` field stores the `span.find-widget-label` element for updating the text when mode changes.
- All DOM element references (`findInput`, `replaceInput`, etc.) are stored as class fields during `_buildDom()` for efficient access in event handlers.
- EC-24: The settings overlay has `z-index: 1000`. The widget has `z-index: 200`. No conflict.

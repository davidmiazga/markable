---
title: "Tabs Step 02 — MinimalTabBar Renderer + CSS + DOM Insertion"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 02 — MinimalTabBar Renderer + CSS + DOM Insertion

**Goal:** Implement the `MinimalTabBar` renderer; insert `#tab-strip` into the DOM; call `tabManager.init()` from `main.ts`. After this step the minimal dot strip is visible and functional.

**App state after this step:** Minimal dot/pill strip visible below the title bar. Dots are clickable (no actual tab switching yet — switching wired in step_07, but the renderer's click handler calls `tabManager.activateTab()` which will work for single-tab use). The app still behaves as single-document on file open/save — that changes in step_07.

---

## File: `index.html` (modify)

Add `#tab-strip` between `#titlebar` and `#app`:

```html
<body>
  <div id="titlebar" data-tauri-drag-region>
    <span id="titlebar-title" data-tauri-drag-region>Untitled</span>
  </div>

  <div id="tab-strip"></div>   <!-- ← ADD THIS LINE -->

  <div id="app">
    ...
  </div>
</body>
```

The element is always present in the DOM. `TabManager` finds it via `document.getElementById("tab-strip")`.

---

## File: `src/tabs/tabs.css` (new)

All tab-related CSS. Must use CSS custom properties — no hardcoded colors (NFR-4).

### Required CSS custom properties (define with fallbacks against existing theme vars)

```css
:root {
  --tab-strip-height: 28px;
  --tab-strip-bg: var(--bg-primary, #1e1e1e);
  --tab-dot-size: 8px;
  --tab-dot-active-width: 22px;
  --tab-dot-inactive-color: var(--text-muted, #555);
  --tab-dot-active-color: var(--text-primary, #e0e0e0);
  --tab-dot-dirty-indicator-color: var(--accent, #f59e0b);
  --tab-regular-height: 36px;
  --tab-regular-bg: var(--bg-secondary, #252526);
  --tab-regular-active-bg: var(--bg-primary, #1e1e1e);
  --tab-regular-text: var(--text-primary, #cccccc);
  --tab-regular-accent: var(--accent, #0078d4);
  --tab-vertical-width: 36px;
  --tab-vertical-bg: var(--bg-secondary, #252526);
  --tab-vertical-active-bg: var(--bg-primary, #1e1e1e);
  --tab-vertical-text: var(--text-primary, #cccccc);
}
```

### `#tab-strip` base

```css
#tab-strip {
  width: 100%;
  display: flex;
  align-items: center;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--tab-strip-bg);
  /* Height varies by mode; set by mode-specific classes */
}

#tab-strip.tab-mode-minimal {
  height: var(--tab-strip-height);
  padding: 0 8px;
  gap: 6px;
  justify-content: flex-start;
}

#tab-strip.tab-mode-regular {
  height: var(--tab-regular-height);
  padding: 0;
  gap: 0;
}

#tab-strip.tab-mode-vertical {
  display: none; /* vertical mode uses #tab-vertical-strip, not #tab-strip */
}
```

### Minimal mode: dots

```css
/* Each tab is a dot/pill. role="tab" per NFR-3 */
.tab-dot {
  flex-shrink: 0;
  height: var(--tab-dot-size);
  width: var(--tab-dot-size);
  border-radius: 999px;
  background: var(--tab-dot-inactive-color);
  cursor: pointer;
  transition: width 120ms ease, background 120ms ease;
  position: relative;
}

.tab-dot[aria-selected="true"] {
  width: var(--tab-dot-active-width);
  background: var(--tab-dot-active-color);
}

/* Dirty indicator: small dot overlay in upper-right of the dot */
.tab-dot.is-dirty::after {
  content: "";
  position: absolute;
  top: -2px;
  right: -2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--tab-dot-dirty-indicator-color);
}

/* Warning: > TAB_SOFT_WARNING_THRESHOLD tabs — shift color of all dots */
#tab-strip.tab-over-limit .tab-dot {
  opacity: 0.6;
}
#tab-strip.tab-over-limit::after {
  content: attr(data-tab-warning);
  font-size: 10px;
  color: var(--tab-dot-dirty-indicator-color);
  margin-left: 4px;
  white-space: nowrap;
}
```

### Regular mode: tab labels (step_03 fills this in)

```css
/* Placeholder — detailed rules in step_03 */
.tab-label { /* ... */ }
```

### Vertical mode: strip (step_04 fills this in)

```css
/* Placeholder — detailed rules in step_04 */
#tab-vertical-strip { /* ... */ }
```

---

## File: `src/tabs/renderers/minimal-tab-bar.ts` (new)

Implements `ITabRenderer`. Import `tabs.css` at the top of this file.

### Responsibilities

- Renders one `.tab-dot` element per tab inside `#tab-strip`.
- Adds/removes `aria-selected="true"` on the active dot.
- Adds/removes `.is-dirty` class on dirty tabs.
- Attaches tooltip on hover (800 ms delay, FR-3.1).
- Fires `tabManager.activateTab(id)` on click.
- Adds `tab-mode-minimal` class to `#tab-strip`.

### Constructor

Takes a callback for tab activation: `constructor(private onActivate: (id: string) => void, private onClose?: (id: string) => void)`. In practice, `TabManager` instantiates with `(id) => this.activateTab(id)`.

### `mount(container, tabs, activeIndex)`

1. Add `tab-mode-minimal` class to `container`.
2. Set `container.setAttribute("role", "tablist")`.
3. Call `update(tabs, activeIndex)` to do initial render.

### `update(tabs, activeIndex)`

Full re-render (simple: dot count is typically small):
1. Clear `container.innerHTML = ""`.
2. For each tab at index `i`:
   - Create `<button class="tab-dot" role="tab">`.
   - Set `aria-selected = String(i === activeIndex)`.
   - Set `aria-label = tab.title` (NFR-3).
   - If `tab.isDirty`: add class `is-dirty`.
   - Attach tooltip logic (see below).
   - Attach click handler: `button.addEventListener("click", () => this.onActivate(tab.id))`.
   - Append to container.
3. Update `container.classList.toggle("tab-over-limit", tabs.length > TAB_SOFT_WARNING_THRESHOLD)`.
4. If over limit: `container.dataset.tabWarning = "${tabs.length} tabs open"`.

### Tooltip implementation (FR-3.1, NFR-3)

Use a single shared tooltip `<div>` appended to `document.body`:
- On `mouseenter`: start 800 ms timer, position tooltip near dot, set text to `tab.title + (filePath ? " — " + filePath : "")`.
- On `mouseleave` or `click`: cancel timer and hide tooltip.
- Position tooltip below the dot using `getBoundingClientRect()`.
- Attach via `aria-describedby` pointing to the tooltip element id (NFR-3).

### `destroy()`

1. Remove `tab-mode-minimal` class from container.
2. Remove `role="tablist"` from container.
3. `container.innerHTML = ""`.
4. Remove tooltip element from `document.body`.
5. Cancel any pending tooltip timer.

---

## Modify: `src/tabs/tab-manager.ts`

### Import MinimalTabBar

```typescript
import { MinimalTabBar } from "./renderers/minimal-tab-bar";
```

### Update `init()` — renderer instantiation

After session restore and before `_applyActiveTab()`, add:

```typescript
// Instantiate renderer based on persisted mode.
// In step_02, only MinimalTabBar is available; other modes fall back to minimal.
this._instantiateRenderer();
if (this.renderer && this.tabStripEl) {
  this.renderer.mount(this.tabStripEl, this.tabs, this.activeIndex);
}
```

### Add `_instantiateRenderer(): void` (private)

```typescript
private _instantiateRenderer(): void {
  if (this.renderer) {
    this.renderer.destroy();
    this.renderer = null;
  }
  // In step_02: only minimal exists. Steps 03 and 04 add the other branches.
  switch (this.mode) {
    case "minimal":
    default:
      this.renderer = new MinimalTabBar(
        (id) => this.activateTab(id),
      );
      break;
  }
}
```

### Update `setMode()` — call `_instantiateRenderer()`

Replace the "instantiate new renderer" comment with a call to `_instantiateRenderer()`.

---

## Modify: `src/tabs/tabs.css` import

Import `tabs.css` at the top of `minimal-tab-bar.ts`:

```typescript
import "../tabs.css";
```

(Vite handles CSS imports from TypeScript.)

---

## Modify: `src/main.ts`

### Import

```typescript
import { tabManager } from "./tabs";
```

### In `initApp()`, after `restoreSidebarFromSettings()`

```typescript
// Initialize tab manager. Must run after initSidebar() (which creates #app-row)
// and after editor creation. Tab manager reads settings and restores the session.
await tabManager.init(editor);
```

### Replace the dirty-state listener

The existing `EditorView.updateListener` block (lines ~902–912) must be replaced. The `setDirty(true)` call moves into `TabManager`. Replace with:

```typescript
editor.dispatch({
  effects: StateEffect.appendConfig.of(
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        tabManager.markActiveTabDirty();
      }
    })
  ),
});
```

Remove the `isReadOnly` guard — `TabManager` does not use `isReadOnly`. If read-only tabs are needed in the future (help files), that is a separate concern.

**Note:** The existing top-level `isDirty` and `setDirty()` in `main.ts` are not removed in this step — they remain alongside the new system. They will be removed in step_07.

---

## Tests to Write (`tests/tabs/minimal-tab-bar.test.ts`)

| Test | Covers |
|---|---|
| `mount` sets `role="tablist"` on container | NFR-3 |
| `update` with 3 tabs renders 3 `.tab-dot` elements | FR-3.1 |
| `update` marks active tab with `aria-selected="true"` | NFR-3 |
| `update` marks dirty tab with `.is-dirty` class | FR-7 |
| `update` triggers `tab-over-limit` class at threshold | FR-9 |
| Click on dot calls `onActivate` callback with correct id | FR-3.1 |
| `destroy` clears container innerHTML | NFR-5 |
| `destroy` removes tooltip from body | NFR-5 |

---

## Verification

After implementing step_02:
1. `npm run tauri dev` — app opens with a row of gray dots below the title bar.
2. With one (untitled) tab, one active dot/pill is visible.
3. Clicking the dot does nothing visible (single tab activating itself).
4. No TypeScript errors.
5. `#tab-strip` has `role="tablist"` in the DOM inspector.

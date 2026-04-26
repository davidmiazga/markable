---
title: "Tabs Step 03 — RegularTabBar Renderer"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 03 — RegularTabBar Renderer

**Goal:** Implement the `RegularTabBar` renderer (filename + close buttons + "+" button). Wire it into `_instantiateRenderer()`. The user can switch to regular mode from Settings.

**App state after this step:** Regular tab bar is renderable. Switching to regular mode from Settings shows a standard tab bar with filenames. Minimal mode remains the default.

---

## File: `src/tabs/renderers/regular-tab-bar.ts` (new)

Implements `ITabRenderer`.

### Constructor

```typescript
constructor(
  private onActivate: (id: string) => void,
  private onClose: (id: string) => void,
  private onNew: () => void,
)
```

`TabManager` instantiates with:
```typescript
new RegularTabBar(
  (id) => this.activateTab(id),
  (id) => void this.closeTab(id),
  () => this.openNewTab(),
)
```

### `mount(container, tabs, activeIndex)`

1. Add class `tab-mode-regular` to `container`.
2. Set `container.setAttribute("role", "tablist")`.
3. Build and append the tab bar:
   - A scrollable inner container: `<div class="tab-bar-inner">`.
   - Tab labels appended to `tab-bar-inner` (see `_buildTabEl`).
   - A "+" button appended after `tab-bar-inner`.
4. Call `update(tabs, activeIndex)`.

### `update(tabs, activeIndex)`

Full re-render of tab labels (efficient enough for ≤30 tabs):
1. Clear the `tab-bar-inner` contents.
2. For each tab at index `i`:
   - Call `_buildTabEl(tab, i === activeIndex)`.
   - Append to `tab-bar-inner`.
3. Update the "+" button's `disabled` attribute if at warning threshold (FR-9 visual cue is a warning badge, not a disable — leave enabled).

### `_buildTabEl(tab: TabEntry, isActive: boolean): HTMLElement` (private)

Returns a `<button class="tab-label" role="tab">` element:

```html
<button class="tab-label [active]" role="tab" aria-selected="[true/false]">
  <span class="tab-label-dirty">•</span>   ← visible only when isDirty
  <span class="tab-label-text">[title]</span>
  <button class="tab-close" aria-label="Close [title]">×</button>
</button>
```

- `aria-selected`: `String(isActive)`.
- `aria-label` on outer button: `tab.title` (for screen readers, NFR-3).
- Click on outer button (not the close button): call `this.onActivate(tab.id)`. Use `stopPropagation` on close button click to prevent outer click.
- Click on close button: call `this.onClose(tab.id)`.
- Dirty dot: `tab-label-dirty` element is hidden via CSS when tab is not dirty. Toggle via class: `button.classList.toggle("is-dirty", tab.isDirty)`.

### CSS additions for regular mode (add to `tabs.css`)

```css
#tab-strip.tab-mode-regular {
  height: var(--tab-regular-height);
  background: var(--tab-regular-bg);
  padding: 0;
  gap: 0;
  align-items: stretch;
}

.tab-bar-inner {
  display: flex;
  flex: 1;
  overflow: hidden; /* overflow deferred per OOS */
  align-items: stretch;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px 0 12px;
  background: transparent;
  border: none;
  border-right: 1px solid var(--border-subtle, #333);
  cursor: pointer;
  color: var(--tab-regular-text);
  font-size: calc(var(--settings-base-font-size, 16px) * 0.8);
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 180px;
  min-width: 60px;
  position: relative;
}

.tab-label[aria-selected="true"] {
  background: var(--tab-regular-active-bg);
  border-bottom: 2px solid var(--tab-regular-accent);
}

.tab-label-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-label-dirty {
  display: none;
  color: var(--tab-dot-dirty-indicator-color);
  font-size: 10px;
  line-height: 1;
}

.tab-label.is-dirty .tab-label-dirty {
  display: inline;
}

.tab-close {
  margin-left: 4px;
  background: none;
  border: none;
  color: var(--text-muted, #888);
  cursor: pointer;
  padding: 0 2px;
  border-radius: 3px;
  font-size: 14px;
  line-height: 1;
}

.tab-close:hover {
  background: var(--bg-hover, #444);
  color: var(--text-primary, #ccc);
}

.tab-new-btn {
  flex-shrink: 0;
  padding: 0 10px;
  background: none;
  border: none;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 18px;
  line-height: var(--tab-regular-height);
  height: 100%;
}

.tab-new-btn:hover {
  color: var(--text-primary, #ccc);
  background: var(--bg-hover, #444);
}

/* Soft warning: badge on the "+" button */
.tab-new-btn.tab-over-limit {
  color: var(--tab-dot-dirty-indicator-color);
}
```

### `destroy()`

1. Remove `tab-mode-regular` class.
2. Remove `role="tablist"`.
3. `container.innerHTML = ""`.

---

## Modify: `src/tabs/tab-manager.ts`

### Import RegularTabBar

```typescript
import { RegularTabBar } from "./renderers/regular-tab-bar";
```

### Update `_instantiateRenderer()` — add regular case

```typescript
case "regular":
  this.renderer = new RegularTabBar(
    (id) => this.activateTab(id),
    (id) => void this.closeTab(id),
    () => this.openNewTab(),
  );
  break;
```

---

## Settings Panel Integration (Settings panel adds a "Tab Mode" section)

This is the entry point for the user to switch modes. The Settings panel lives in `src/settings/settings-panel.ts` (not modified in steps 01–04, but the developer must know where to add this in step_05).

**Defer to step_05** — settings persistence comes first, then the Settings UI control.

---

## Tests to Write (`tests/tabs/regular-tab-bar.test.ts`)

| Test | Covers |
|---|---|
| `mount` sets `role="tablist"` | NFR-3 |
| `update` with 2 tabs renders 2 `.tab-label` elements | FR-3.2 |
| `update` marks active tab with `aria-selected="true"` | NFR-3 |
| `update` shows dirty dot on dirty tab | FR-7, FR-3.2 |
| Click on tab label fires `onActivate` | FR-3.2 |
| Click on close button fires `onClose`, not `onActivate` | FR-5.2 |
| Click on "+" button fires `onNew` | FR-5.1, FR-3.2 |
| `destroy` clears container | NFR-5 |

---

## Verification

After implementing step_03:
1. Go to Settings (Cmd-,) and add a temporary tab mode selector (even a raw button that calls `tabManager.setMode("regular")`).
2. The tab bar switches to filename labels.
3. Clicking "+" opens a new untitled tab.
4. The dots from minimal mode are gone.
5. Switching back to minimal restores dots.
6. No TypeScript errors.

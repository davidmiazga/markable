---
title: "Tabs Step 04 — VerticalTabStrip Renderer"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 04 — VerticalTabStrip Renderer

**Goal:** Implement `VerticalTabStrip`. Wire it into `_instantiateRenderer()`. Implement the sidebar interaction: hide/show `#sidebar-left` via `toggleSide`.

**App state after this step:** Vertical tab mode is fully renderable. Switching to vertical mode hides the left sidebar and shows the vertical strip. Switching away restores the left sidebar.

---

## DOM Layout in Vertical Mode

When vertical mode is active, `#tab-strip` gets class `tab-mode-vertical` (which sets `display: none` per step_02 CSS). A new element `#tab-vertical-strip` is inserted as the first child of `#app-row`.

```
#app
  #app-row
    #tab-vertical-strip    ← created by VerticalTabStrip, first flex child
    #sidebar-left          ← hidden via toggleSide("left", false)
    #editor
    #sidebar-right
```

When vertical mode is exited, `#tab-vertical-strip` is removed and `toggleSide("left", true)` restores `#sidebar-left`.

**Important:** `VerticalTabStrip.mount()` receives the `#tab-strip` element as its `container` argument (consistent with other renderers). However, it does NOT render into `#tab-strip`. Instead, it:
1. Adds class `tab-mode-vertical` to `container` (which CSS hides it).
2. Creates `#tab-vertical-strip`, inserts it into `#app-row`.
3. Renders all tab elements into `#tab-vertical-strip`.

`destroy()` removes `#tab-vertical-strip` from the DOM and removes class `tab-mode-vertical` from `container`.

---

## File: `src/tabs/renderers/vertical-tab-strip.ts` (new)

### Constructor

```typescript
constructor(
  private onActivate: (id: string) => void,
  private onClose: (id: string) => void,
)
```

`TabManager` instantiates with:
```typescript
new VerticalTabStrip(
  (id) => this.activateTab(id),
  (id) => void this.closeTab(id),
)
```

### `mount(container, tabs, activeIndex)`

`container` is `#tab-strip`.

1. Add class `tab-mode-vertical` to `container` (hides `#tab-strip`).
2. Find `#app-row`: `const appRow = document.getElementById("app-row")`. If not found, log error and return.
3. Create `stripEl = document.createElement("div")`. Set `stripEl.id = "tab-vertical-strip"`. Set `stripEl.setAttribute("role", "tablist")`.
4. Store `this.stripEl = stripEl`.
5. Insert as first child of `#app-row`: `appRow.insertBefore(stripEl, appRow.firstChild)`.
6. Call `update(tabs, activeIndex)`.

### `update(tabs, activeIndex)`

Full re-render of the vertical strip:
1. `this.stripEl.innerHTML = ""`.
2. For each tab at index `i`:
   - Create `<button class="tab-vertical-item" role="tab">`.
   - `aria-selected = String(i === activeIndex)`.
   - `aria-label = tab.title`.
   - Inner structure:
     ```html
     <button class="tab-vertical-item [active] [is-dirty]" role="tab" aria-selected="...">
       <span class="tab-vertical-text">[title]</span>
       <button class="tab-close" aria-label="Close [title]">×</button>
     </button>
     ```
   - Click on outer (not close): `onActivate(tab.id)`.
   - Click on close: `onClose(tab.id)`.
3. Over-limit: add class `tab-over-limit` to `this.stripEl` if `tabs.length > TAB_SOFT_WARNING_THRESHOLD`.

### `destroy()`

1. `this.stripEl?.remove()`.
2. `this.stripEl = null`.
3. Remove `tab-mode-vertical` class from `container`.
4. Remove `role="tablist"` from `container`.

---

## CSS additions for vertical mode (add to `tabs.css`)

```css
#tab-vertical-strip {
  width: var(--tab-vertical-width);
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--tab-vertical-bg);
  overflow: hidden;
  flex-shrink: 0;
  padding: 8px 0;
  gap: 4px;
}

.tab-vertical-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 8px 0;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
  color: var(--tab-vertical-text);
  position: relative;
}

.tab-vertical-item[aria-selected="true"] {
  background: var(--tab-vertical-active-bg);
  border-left-color: var(--tab-regular-accent);
}

.tab-vertical-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);   /* text reads top-to-bottom */
  font-size: calc(var(--settings-base-font-size, 16px) * 0.75);
  white-space: nowrap;
  overflow: hidden;
  max-height: 80px;
  text-overflow: ellipsis;
  color: var(--tab-vertical-text);
}

.tab-vertical-item.is-dirty .tab-vertical-text::after {
  content: " •";
  color: var(--tab-dot-dirty-indicator-color);
}

/* Close button in vertical strip — shown on hover */
.tab-vertical-item .tab-close {
  opacity: 0;
  transition: opacity 150ms;
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 11px;
  padding: 1px 3px;
  border-radius: 2px;
  background: var(--bg-hover, #444);
  border: none;
  cursor: pointer;
  color: var(--text-muted, #888);
}

.tab-vertical-item:hover .tab-close {
  opacity: 1;
}

#tab-vertical-strip.tab-over-limit::after {
  content: "!";
  color: var(--tab-dot-dirty-indicator-color);
  font-size: 10px;
  font-weight: bold;
  padding: 4px;
}
```

---

## Modify: `src/tabs/tab-manager.ts`

### Imports to add

```typescript
import { VerticalTabStrip } from "./renderers/vertical-tab-strip";
import { toggleSide } from "../sidebar/sidebar-manager";
```

**Note on import path:** Use the direct internal path `../sidebar/sidebar-manager` rather than the public facade `../sidebar`. The public facade re-exports `toggleSide` as `toggleSidebarSide` (aliased). To avoid the alias, import directly from the implementation module. This is acceptable because `TabManager` is core infrastructure, not a plugin.

### Update `_instantiateRenderer()` — add vertical case

```typescript
case "vertical":
  this.renderer = new VerticalTabStrip(
    (id) => this.activateTab(id),
    (id) => void this.closeTab(id),
  );
  break;
```

### Update `setMode()` — sidebar interaction

The sidebar calls must be synchronous (EC-11 — no animation delay). After adding `case "vertical"` to `_instantiateRenderer`, `setMode` already calls `_instantiateRenderer()`. The sidebar calls are:

```typescript
async setMode(mode: "minimal" | "regular" | "vertical"): Promise<void> {
  if (mode === this.mode) return;

  // Step 1: Restore left sidebar if leaving vertical mode (EC-10)
  if (this.mode === "vertical") {
    toggleSide("left");  // toggleSide is a toggle; call only if currently hidden
    // More precisely: force-show the left sidebar regardless of current state.
    // toggleSide() uses DOM display state as truth. We need to call it only if
    // #sidebar-left is currently hidden. See note below.
  }

  // Step 2: Destroy current renderer
  if (this.renderer && this.tabStripEl) {
    this.renderer.destroy();
    this.renderer = null;
  }

  // Step 3: Persist new mode
  this.mode = mode;
  await updateSettings(s => ({ ...s, tabMode: mode }));

  // Step 4: Hide left sidebar if entering vertical mode
  if (mode === "vertical") {
    // Force-hide the left sidebar.
    // toggleSide() is a toggle; we need to ensure it's hidden.
    // The sidebar manager uses DOM display state as truth (see sidebar-manager.ts line ~354).
    // We must call toggleSide("left") only if it's currently visible.
    const sidebarLeft = document.getElementById("sidebar-left");
    if (sidebarLeft && sidebarLeft.style.display !== "none") {
      toggleSide("left");
    }
  }

  // Step 5: Instantiate and mount new renderer
  this._instantiateRenderer();
  if (this.renderer && this.tabStripEl) {
    this.renderer.mount(this.tabStripEl, this.tabs, this.activeIndex);
  }
}
```

**Note on `toggleSide` direction:** `toggleSide(side)` in `sidebar-manager.ts` is a pure toggle — it reads `el.style.display !== "none"` and flips. There is no `toggleSide(side, forcedOpen)` variant. Therefore, `TabManager` must check the current display state before calling toggle. The code above implements this correctly.

If a future version of `sidebar-manager.ts` adds a forced-state variant (e.g., `toggleSide("left", false)` as required spec says), the call simplifies to `toggleSide("left", false)`. For now, use the DOM check pattern above.

**Sidebar restore on mode exit** — when leaving vertical mode, the same pattern applies: only call `toggleSide("left")` if sidebar-left is currently hidden.

---

## Tests to Write (`tests/tabs/vertical-tab-strip.test.ts`)

| Test | Covers |
|---|---|
| `mount` creates `#tab-vertical-strip` in `#app-row` | FR-3.3 |
| `mount` hides `#tab-strip` via `tab-mode-vertical` class | FR-3.3 |
| `update` with 2 tabs renders 2 `.tab-vertical-item` elements | FR-3.3 |
| `update` marks active with `aria-selected="true"` | NFR-3 |
| `update` adds `is-dirty` class to dirty tabs | FR-7, FR-3.3 |
| Click on item fires `onActivate` | FR-3.3 |
| Click on close fires `onClose` | FR-5.2 |
| `destroy` removes `#tab-vertical-strip` from DOM | NFR-5 |
| `destroy` removes `tab-mode-vertical` from `#tab-strip` | NFR-5 |

---

## Verification

After implementing step_04:
1. Temporarily call `tabManager.setMode("vertical")` after `init()` in `main.ts`.
2. App opens with a narrow vertical strip on the left where `#sidebar-left` was.
3. The existing left sidebar panels are hidden (left sidebar hidden).
4. Switching back to `"minimal"` restores left sidebar.
5. No TypeScript errors.
6. `#tab-vertical-strip` exists in the DOM in vertical mode and is absent in other modes.

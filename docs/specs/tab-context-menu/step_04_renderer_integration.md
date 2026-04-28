---
title: Step 04 — Renderer Integration
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 04 — Renderer Integration

## Files to modify

- `src/tabs/renderers/regular-tab-bar.ts`
- `src/tabs/renderers/vertical-tab-strip.ts`
- `src/tabs/renderers/minimal-tab-bar.ts`

---

## Import to add (same in all three files)

At the top of each renderer file, after the existing imports, add:

```typescript
import { showTabContextMenu, closeTabContextMenu } from "../tab-context-menu";
```

---

## Pattern applied identically in all three renderers

Each renderer requires three identical touch points:

1. **Import** `showTabContextMenu` and `closeTabContextMenu` from `../tab-context-menu`.
2. **`update()` method**: call `closeTabContextMenu()` at the very start, before
   clearing `innerHTML`. This handles EC-12 (close button fires while menu open)
   and EC-16 (any background state change triggers a re-render).
3. **`destroy()` method**: call `closeTabContextMenu()` at the very start. This
   handles EC-11 (mode switch) and the general teardown path.
4. **Element-build helper** (`_buildTabEl`, `_buildColEl`, `_createDotButton`):
   attach a `contextmenu` event listener that calls `e.preventDefault()`,
   `e.stopPropagation()`, and `showTabContextMenu(tab, e.clientX, e.clientY)`.

Note: "at the very start" for `update()` means before `this.innerEl.innerHTML = ""`
(RegularTabBar) / `this.leftStripEl.innerHTML = ""` (VerticalTabStrip) /
`this.trackEl.innerHTML = ""` (MinimalTabBar). The existing null-guards (`if
(!this.innerEl ...) return`) run before the close call — that is acceptable.

---

## RegularTabBar (`regular-tab-bar.ts`)

### `update()` change

Current first line of `update()` body:
```typescript
if (!this.innerEl || !this.newBtnEl) return;
```

Insert `closeTabContextMenu()` immediately after the guard:
```typescript
update(tabs: TabEntry[], activeIndex: number): void {
  if (!this.innerEl || !this.newBtnEl) return;
  closeTabContextMenu();   // ← ADD THIS LINE

  this.innerEl.innerHTML = "";
  // ... rest unchanged
}
```

### `destroy()` change

Current first line of `destroy()` body:
```typescript
if (!this.container) return;
```

Insert `closeTabContextMenu()` before the guard (so it fires even if `container`
is null — which should never happen, but `closeTabContextMenu` is a safe no-op):

```typescript
destroy(): void {
  closeTabContextMenu();   // ← ADD THIS LINE
  if (!this.container) return;
  // ... rest unchanged
}
```

### `_buildTabEl()` change

Inside `_buildTabEl()`, after the existing `click` event listener registration
(around the last `btn.addEventListener("click", ...)` line), add:

```typescript
// Right-click: show the tab context menu (FR-1.1 / FR-1.2 / FR-1.3).
btn.addEventListener("contextmenu", (e) => {
  e.preventDefault();     // Suppress the browser's native context menu (FR-1.3).
  e.stopPropagation();    // Prevent the event from reaching the strip container (FR-1.2 / EC-10).
  showTabContextMenu(tab, e.clientX, e.clientY);
});
```

The `tab` variable is already in scope via the `_buildTabEl(tab, isActive)` parameter.

---

## VerticalTabStrip (`vertical-tab-strip.ts`)

### `update()` change

Current first line of `update()` body:
```typescript
if (!this.leftStripEl || !this.rightStripEl) return;
```

Insert after the guard:
```typescript
update(tabs: TabEntry[], activeIndex: number): void {
  if (!this.leftStripEl || !this.rightStripEl) return;
  closeTabContextMenu();   // ← ADD THIS LINE

  this.leftStripEl.innerHTML = "";
  // ... rest unchanged
}
```

### `destroy()` change

Current `destroy()` begins with:
```typescript
destroy(): void {
  this.leftStripEl?.remove();
  // ...
```

Insert `closeTabContextMenu()` as the first statement:
```typescript
destroy(): void {
  closeTabContextMenu();   // ← ADD THIS LINE
  this.leftStripEl?.remove();
  // ... rest unchanged
}
```

### `_buildColEl()` change

Inside `_buildColEl()`, after the existing `click` event listener on the `col`
element, add:

```typescript
// Right-click: show the tab context menu (FR-1.1).
col.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  e.stopPropagation();
  showTabContextMenu(tab, e.clientX, e.clientY);
});
```

The `tab` variable is in scope via the `_buildColEl(tab, isActive)` parameter.

---

## MinimalTabBar (`minimal-tab-bar.ts`)

### `update()` change

Current first line of `update()` body:
```typescript
if (!this.container || !this.trackEl) return;
```

Insert after the guard:
```typescript
update(tabs: TabEntry[], activeIndex: number): void {
  if (!this.container || !this.trackEl) return;
  closeTabContextMenu();   // ← ADD THIS LINE

  this.trackEl.innerHTML = "";
  // ... rest unchanged
}
```

### `destroy()` change

Current `destroy()` begins with:
```typescript
destroy(): void {
  this._cancelTooltipTimer();
  // ...
```

Insert `closeTabContextMenu()` as the first statement:
```typescript
destroy(): void {
  closeTabContextMenu();   // ← ADD THIS LINE
  this._cancelTooltipTimer();
  // ... rest unchanged
}
```

### `_createDotButton()` change

Inside `_createDotButton()`, after the existing `click` event listener
registration, add:

```typescript
// Right-click: show the tab context menu (FR-1.1 / EC-13).
btn.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  e.stopPropagation();
  showTabContextMenu(tab, e.clientX, e.clientY);
});
```

The `tab` variable is in scope via `_createDotButton(tab, isActive)`.

---

## Why `stopPropagation()` is required (EC-10)

If `stopPropagation()` is omitted, the `contextmenu` event bubbles from the
tab element up to the strip container. If the strip container also had a
`contextmenu` listener, it would fire a second menu. But the requirement is
stronger: even without a container listener, the browser may still show its
native context menu for the containing element. `stopPropagation()` ensures
the event stays on the tab element where `preventDefault()` has already
suppressed the native menu.

Additionally, `stopPropagation()` is the correct implementation for EC-10
("right-click on strip background shows no menu") because no `contextmenu`
listener is attached to the container — only to individual tab elements. Any
`contextmenu` event that originates from the strip background itself (not from
a tab child element) does not propagate from a tab element and therefore no
menu is shown.

---

## EC-11 / EC-12 / EC-16 / EC-17: why update() and destroy() both close the menu

These four edge cases all involve the tab strip being re-rendered or torn down
while the menu is open:

- EC-11: mode switch calls `renderer.destroy()` → `closeTabContextMenu()` fires.
- EC-12: user clicks the close button on a tab → `closeTab()` → `_notifyRenderer()`
  → `renderer.update()` → `closeTabContextMenu()` fires.
- EC-16: any background dirty-state change calls `_notifyRenderer()` →
  `renderer.update()` → `closeTabContextMenu()` fires.
- EC-17: Cmd-W → `closeTab(activeTab)` → same chain as EC-12.

The call in `update()` fires before the DOM is rebuilt (before `innerHTML = ""`),
so there is no race where the menu's `<li>` elements are orphaned or the dismiss
listeners reference detached nodes.

---

## Acceptance criteria

- [ ] `closeTabContextMenu` imported in all three renderer files.
- [ ] `showTabContextMenu` imported in all three renderer files.
- [ ] `update()` calls `closeTabContextMenu()` before clearing innerHTML in all three.
- [ ] `destroy()` calls `closeTabContextMenu()` as its first statement in all three.
- [ ] `_buildTabEl()` in RegularTabBar has contextmenu listener with `preventDefault` + `stopPropagation`.
- [ ] `_buildColEl()` in VerticalTabStrip has contextmenu listener with `preventDefault` + `stopPropagation`.
- [ ] `_createDotButton()` in MinimalTabBar has contextmenu listener with `preventDefault` + `stopPropagation`.
- [ ] No contextmenu listener attached to container elements (strip background).
- [ ] The `tab` variable passed to `showTabContextMenu` is the local parameter in each helper — not a `this.tabs` lookup.

---
title: "Image Toolbar — Step 05: DOM — buildPopover, show/hide/position"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 05 — DOM: buildPopover, showPopover, hideToolbar, positionPopover

**Depends on:** step_01 (CSS classes defined), step_02 (AlignmentState), step_03, step_04
**Adds to:** `src/plugins/image-toolbar/image-toolbar.plugin.ts` sections 19–22
**Tests:** `tests/plugins/image-toolbar/image-toolbar.test.ts` — `describe("step_05 — DOM popover", ...)`

DOM functions are tested via jsdom (Vitest's default environment). No CM6 globals required.

---

## Functions to implement

### `buildPopover(): HTMLElement`

Create the full popover DOM tree. Called once in `onEnable`. The returned element is appended to `document.body` and reused for all subsequent triggers.

```typescript
export function buildPopover(): HTMLElement
```

DOM structure to produce:

```html
<div class="img-toolbar" id="__markable_img_toolbar__" role="toolbar" aria-label="Image options">

  <!-- Tab strip -->
  <div class="img-toolbar__tabs">
    <button class="img-toolbar__tab img-toolbar__tab--active" data-tab="select">Select</button>
    <button class="img-toolbar__tab" data-tab="embed">Embed Link</button>
  </div>

  <!-- Select tab panel (visible by default) -->
  <div class="img-toolbar__panel img-toolbar__panel--select" data-panel="select">
    <button class="img-toolbar__btn" data-action="choose-file">Choose File</button>
  </div>

  <!-- Embed Link tab panel (hidden by default) -->
  <div class="img-toolbar__panel img-toolbar__panel--embed" data-panel="embed" style="display:none">
    <input class="img-toolbar__input" type="text" placeholder="URL or relative path" aria-label="Image URL">
    <button class="img-toolbar__btn" data-action="embed-image">Embed Image</button>
  </div>

  <!-- Divider -->
  <div class="img-toolbar__divider" aria-hidden="true"></div>

  <!-- Alignment controls -->
  <div class="img-toolbar__align-group" role="group" aria-label="Alignment">
    <button class="img-toolbar__align-btn" data-action="align-left"        title="Left">←</button>
    <button class="img-toolbar__align-btn" data-action="align-center"      title="Center">↔</button>
    <button class="img-toolbar__align-btn" data-action="align-right"       title="Right">→</button>
    <button class="img-toolbar__align-btn" data-action="align-float-right" title="Float Right">⤵</button>
  </div>

</div>
```

Implementation notes:

- All click events on buttons within the popover are handled by a **single delegated listener** on the popover root element. The listener checks `event.target.closest("[data-action]")` and calls `handleAction(action)` (defined in step_07). This avoids attaching per-button listeners.
- Tab switching is handled by a click listener on `.img-toolbar__tabs` that checks `event.target.closest("[data-tab]")`. On match: hide all `[data-panel]` panels, show the clicked panel, toggle `--active` on tab buttons.
- The `<input>` element reference is stored in a module-level variable `_urlInput: HTMLInputElement | null` so `showPopover` can pre-fill it.
- The alignment button NodeList reference is stored in module-level `_alignBtns: NodeListOf<HTMLButtonElement> | null` so `showPopover` can update active state.
- The entire popover is `display: none` initially; `positionPopover` sets it to `display: flex`.

### `positionPopover(anchorRect: DOMRect | { top: number; bottom: number; left: number; right: number }, popoverEl: HTMLElement): void`

Position the popover relative to an anchor bounding rect. Implements the flip and clamp logic from FR-7.

```typescript
export function positionPopover(
  anchorRect: { top: number; bottom: number; left: number; right: number },
  popoverEl: HTMLElement,
): void
```

Algorithm:

1. `const popoverHeight = popoverEl.offsetHeight || 120`.
2. `const popoverWidth = popoverEl.offsetWidth || 220`.
3. `let top = anchorRect.top - popoverHeight - 8`.
4. Flip: if `top < 0` → `top = anchorRect.bottom + 8` (EC-23).
5. `let left = anchorRect.left`.
6. Clamp: if `left + popoverWidth > window.innerWidth` → `left = window.innerWidth - popoverWidth - 8` (EC-24).
7. Clamp: `left = Math.max(0, left)` (prevent negative left).
8. `popoverEl.style.top = top + "px"`.
9. `popoverEl.style.left = left + "px"`.
10. `popoverEl.style.display = "flex"`.

### `showPopover(ctx: ImageContext): void`

Prepare and display the popover for a given `ImageContext`. Called from both the click-trigger and edit-trigger paths.

```typescript
export function showPopover(ctx: ImageContext): void
```

Algorithm:

1. If `_popoverEl === null`: return (safety guard — called before `onEnable`).
2. Pre-fill the URL input: `if (_urlInput) _urlInput.value = ctx.url`.
3. Update active alignment button: iterate `_alignBtns`, remove `--active` from all, add `--active` to the button whose `data-action` matches `"align-" + ctx.alignment`.
4. Reset to "Select" tab (default state on each open):
   - Set all `[data-panel]` to `display: none` except the `select` panel.
   - Set `--active` on the "select" tab button, remove from "embed".
5. Call `positionPopover(ctx.anchorEl.getBoundingClientRect(), _popoverEl)`.

### `hideToolbar(): void`

Hide the popover and reset all trigger-mode state.

```typescript
export function hideToolbar(): void
```

Algorithm:

1. If `_popoverEl`: `_popoverEl.style.display = "none"`.
2. `currentImageContext = null`.
3. `triggerMode = null`.

---

## Module-level additions for step_05

Two new module-level variables (add to section 3):

```typescript
let _urlInput: HTMLInputElement | null = null;
let _alignBtns: NodeListOf<HTMLButtonElement> | null = null;
```

These are set inside `buildPopover()` after the element is constructed, by querying the newly created DOM:

```typescript
_urlInput = popoverEl.querySelector("input.img-toolbar__input");
_alignBtns = popoverEl.querySelectorAll(".img-toolbar__align-btn");
```

They are nulled in `onDisable` when `_popoverEl` is removed.

---

## Tests for step_05

### `buildPopover`

| # | Scenario | Expected |
|---|---|---|
| 5.1 | Call `buildPopover()` | Returns an `HTMLElement` |
| 5.2 | Element has `id="__markable_img_toolbar__"` | True |
| 5.3 | Element has two tab buttons with `data-tab="select"` and `data-tab="embed"` | True |
| 5.4 | "Select" tab button has class `img-toolbar__tab--active` | True |
| 5.5 | "Embed" panel has `display: none` style | True |
| 5.6 | "Select" panel is visible (no `display:none`) | True |
| 5.7 | Element contains `data-action="choose-file"` button | True |
| 5.8 | Element contains `data-action="embed-image"` button | True |
| 5.9 | Element contains 4 `data-action="align-*"` buttons | True |
| 5.10 | Element contains a text `<input>` with class `img-toolbar__input` | True |

### Tab switching (via simulated click)

| # | Scenario | Expected |
|---|---|---|
| 5.11 | Click "Embed Link" tab button | "Embed" panel becomes visible; "Select" panel gets `display:none` |
| 5.12 | Click "Embed Link" tab, then "Select" tab | "Select" panel returns to visible |
| 5.13 | "Embed Link" tab button gets `--active` class after click | True |
| 5.14 | "Select" tab button loses `--active` class after "Embed Link" clicked | True |

### `positionPopover`

| # | Scenario | Expected |
|---|---|---|
| 5.15 | anchor rect fits above viewport: `top=200, bottom=220, left=100` | `top = 200 - 120 - 8 = 72`; `left = 100`; `display = "flex"` |
| 5.16 | anchor near top of viewport (flip): `top=50, bottom=100, left=100` | `top = 100 + 8 = 108` (EC-23) |
| 5.17 | anchor near right edge (clamp): `top=200, bottom=220, left=900` (innerWidth=1000, popoverWidth=220) | `left = 1000 - 220 - 8 = 772` (EC-24) |
| 5.18 | `anchorRect.top = 0` exactly (boundary) | `top < 0` → flip to below |

### `showPopover`

| # | Scenario | Expected |
|---|---|---|
| 5.19 | Call `showPopover` with ctx `url="old.png"` | `_urlInput.value === "old.png"` |
| 5.20 | Call `showPopover` with `alignment="center"` | `align-center` button has `--active`; others do not |
| 5.21 | Call `showPopover` with `alignment="float-right"` | `align-float-right` button has `--active` |
| 5.22 | Call `showPopover` twice (different alignment) | Active button updates to new alignment; old active class removed |
| 5.23 | `showPopover` resets to "Select" tab (embed panel hidden) | True — even if "Embed" was active before |

### `hideToolbar`

| # | Scenario | Expected |
|---|---|---|
| 5.24 | After `showPopover` then `hideToolbar` | `popoverEl.style.display === "none"` |
| 5.25 | `currentImageContext` is null after `hideToolbar` | True |
| 5.26 | `triggerMode` is null after `hideToolbar` | True |
| 5.27 | `hideToolbar()` when `_popoverEl` is null | No crash |

---

## Acceptance Criteria for Step 05

- [ ] All 27 test cases pass
- [ ] `buildPopover()` creates exactly one element — no side effects on `document.body`
- [ ] Tab switching is handled by a single delegated listener on the popover root (not per-button)
- [ ] `positionPopover` flips below the anchor when `top < 0` (EC-23)
- [ ] `positionPopover` clamps to `window.innerWidth` when right edge overflows (EC-24)
- [ ] `showPopover` pre-fills URL input with `ctx.url`
- [ ] `showPopover` marks the correct alignment button as active
- [ ] `hideToolbar()` sets `currentImageContext = null` and `triggerMode = null`

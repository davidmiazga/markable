---
title: Step 05 — CSS: context menu styles in tabs.css
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 05 — CSS: Context Menu Styles in `tabs.css`

## File to modify

`src/tabs/tabs.css`

---

## Where to insert

Append the following block at the end of `tabs.css`, after the existing
`/* ── Media viewer ... */` section. Add a section comment to keep the file
organized.

---

## CSS to add

```css
/* ── Tab context menu ────────────────────────────────────────────────────── */
/*
 * The tab context menu is a <ul class="context-menu"> appended to document.body
 * by tab-context-menu.ts. Its visual language matches the file-browser plugin's
 * context menu (same class names, same CSS variables) so the two menus look
 * identical even though they are separate modules.
 *
 * z-index: 9999 matches #tab-tooltip to ensure the menu renders above the tab
 * strip, editor, and all sidebar panels (FR-7.3).
 *
 * All color values use CSS custom properties with fallbacks so the menu
 * inherits the active theme automatically (FR-7.2).
 */

.context-menu {
  position: fixed;
  z-index: 9999;
  list-style: none;
  padding: 4px 0;
  margin: 0;
  min-width: 160px;
  background: var(--bg-secondary, #252526);
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  box-shadow: 0 4px 16px var(--shadow-color, rgba(0, 0, 0, 0.2));
  font-family: var(--ui-font);
  font-size: 13px;
}

.context-menu-item {
  padding: 6px 16px;
  cursor: pointer;
  color: var(--text-primary, #cccccc);
  white-space: nowrap;
}

.context-menu-item:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
}

.context-menu-item.disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}

.context-menu-separator {
  height: 1px;
  background: var(--border-color, rgba(128, 128, 128, 0.15));
  margin: 4px 0;
}
```

---

## Design notes

### Visual parity with file-browser plugin

The class names and CSS rules are copied exactly from the file-browser plugin's
stylesheet (which lives inside the plugin's JS bundle). Using the same class
names means that any future shared theme CSS can target `.context-menu` once
and both menus benefit. The values are identical: same padding, border-radius,
box-shadow, font-size.

### CSS variables used and their fallbacks

| Property | Variable | Fallback |
|---|---|---|
| Background | `--bg-secondary` | `#252526` (dark grey) |
| Border | `--border-color` | `rgba(128,128,128,0.25)` |
| Shadow | `--shadow-color` | `rgba(0,0,0,0.2)` |
| Font | `--ui-font` | (none needed; browser default) |
| Item text | `--text-primary` | `#cccccc` |
| Item hover background | `--bg-hover` | `rgba(128,128,128,0.08)` |
| Separator background | `--border-color` | `rgba(128,128,128,0.15)` |

All fallbacks are dark-mode values consistent with the existing `tabs.css`
fallbacks already in the file.

### `position: fixed` and `z-index: 9999`

`position: fixed` is required so the menu does not scroll with any parent
container and so `clientX` / `clientY` coordinates map directly to the menu's
`left` / `top` values without offset adjustment.

`z-index: 9999` matches `#tab-tooltip` in the same file, ensuring the context
menu renders above all other UI elements including the editor surface, the
vertical tab strip, and any overlay panels.

### `pointer-events: none` on `.context-menu-item.disabled`

This CSS property prevents the `:hover` style from applying and prevents mouse
events from firing on the item, reinforcing the JS-side check (`if (!disabled)`)
in `_addItem()`. The two-layer approach (JS skips attaching the handler; CSS
blocks mouse events) ensures disabled items are inert regardless of which code
path produces them.

---

## Acceptance criteria

- [ ] Block appended to end of `src/tabs/tabs.css`.
- [ ] `.context-menu` has `position: fixed`, `z-index: 9999`, `list-style: none`.
- [ ] `.context-menu` uses `--bg-secondary` with fallback.
- [ ] `.context-menu-item` uses `--text-primary` with fallback.
- [ ] `.context-menu-item:hover` uses `--bg-hover` with fallback.
- [ ] `.context-menu-item.disabled` has `opacity: 0.4`, `cursor: default`, `pointer-events: none`.
- [ ] `.context-menu-separator` has `height: 1px` and uses `--border-color` with fallback.
- [ ] No hardcoded hex color values (only CSS variable references with fallbacks).

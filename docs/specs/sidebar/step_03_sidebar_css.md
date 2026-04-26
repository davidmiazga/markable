---
title: "Step 03 — Sidebar CSS"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 03 — Sidebar CSS

## Goal

Create `src/sidebar/sidebar.css` containing all sidebar chrome styles. No pixel values that belong to "chrome sizing" (border widths, header heights, chevron dimensions, handle width) are permitted in TypeScript — they must live here and be overridable via CSS custom properties or selector specificity.

All colour values must use existing CSS custom property tokens from the Markable theme system. No new CSS custom properties for colours are introduced.

**Dependency:** step_02 must be complete so the class names are known.

---

## Files Changed

| File | Action |
|---|---|
| `src/sidebar/sidebar.css` | Create |
| `src/sidebar/sidebar-manager.ts` | Add `import "./sidebar.css"` at top of file |

---

## Token Reference

The following CSS custom properties are used. They are defined in the app's theme files and must not be redefined here.

| Token | Used for |
|---|---|
| `var(--bg-titlebar)` | Sidebar background |
| `var(--border-color)` | Outer borders, tab bar bottom border, header bottom border |
| `var(--text-primary)` | Active tab label, accordion title when active |
| `var(--text-secondary)` | Inactive tab labels, accordion title default state |
| `var(--link-color)` | Active tab underline indicator |
| `var(--selection-bg)` | Active tab background, hovered tab/item background |
| `var(--code-bg)` | Hover state for tab and panel header |

---

## Full CSS Specification

```css
/* ── Layout row ─────────────────────────────────────────────────────────────── */

#app-row {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Sidebar slots ───────────────────────────────────────────────────────────── */

#sidebar-left,
#sidebar-right {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;     /* Contains the absolutely-positioned resize handle */
  overflow: hidden;
  background: var(--bg-titlebar);
  min-width: 150px;
  max-width: 600px;
}

#sidebar-left {
  border-right: 1px solid var(--border-color);
}

#sidebar-right {
  border-left: 1px solid var(--border-color);
}

/* ── Tab bar ─────────────────────────────────────────────────────────────────── */

.sidebar-tab-bar {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;            /* Firefox */
  border-bottom: 1px solid var(--border-color);
}

.sidebar-tab-bar::-webkit-scrollbar {
  display: none;                    /* WebKit / Blink */
}

.sidebar-tab {
  flex-shrink: 0;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 6px 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  text-transform: uppercase;
  transition: color 0.1s, border-color 0.1s;
}

.sidebar-tab:hover {
  background: var(--code-bg);
  color: var(--text-primary);
}

.sidebar-tab.sidebar-tab-active {
  color: var(--text-primary);
  border-bottom-color: var(--link-color);
}

/* ── Panel wrapper ───────────────────────────────────────────────────────────── */

.sidebar-panel-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Panel header (accordion row) ────────────────────────────────────────────── */

.sidebar-panel-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
  height: 32px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border-color);
  cursor: default;
}

.sidebar-panel-title {
  flex: 1;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}

/* ── Accordion toggle button ─────────────────────────────────────────────────── */

.sidebar-accordion-toggle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: none;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  transition: background 0.1s, transform 0.15s;
}

.sidebar-accordion-toggle:hover {
  background: var(--code-bg);
  color: var(--text-primary);
}

/* Chevron icon — drawn with CSS border trick to avoid SVG/font dependencies */
.sidebar-accordion-toggle::after {
  content: "";
  display: block;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);          /* ▼ pointing down = expanded */
  transition: transform 0.15s;
  margin-top: -3px;                  /* optical centering */
}

/* When collapsed (aria-expanded="false"), point chevron right */
.sidebar-accordion-toggle[aria-expanded="false"]::after {
  transform: rotate(-45deg);
  margin-top: 0;
}

/* ── Panel content area ───────────────────────────────────────────────────────── */

.sidebar-panel-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

/* ── Error placeholder ────────────────────────────────────────────────────────── */

.sidebar-panel-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  user-select: none;
  pointer-events: none;
}

/* ── Resize handle ────────────────────────────────────────────────────────────── */

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
  /* Invisible by default; visible feedback provided by cursor change only */
}

/* Left sidebar: handle is on the right edge */
#sidebar-left .sidebar-resize-handle {
  right: 0;
}

/* Right sidebar: handle is on the left edge */
#sidebar-right .sidebar-resize-handle {
  left: 0;
}

.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
  background: var(--link-color);
  opacity: 0.4;
}

/* ── Editor flex fill ─────────────────────────────────────────────────────────── */

/*
 * #editor must fill the remaining space in #app-row.
 * The existing #editor styles may already set flex: 1; if not, ensure it here.
 * min-width: 0 prevents the flex item from overflowing the container.
 */
#app-row > #editor {
  flex: 1;
  min-width: 0;
}
```

---

## Import in sidebar-manager.ts

At the very top of `src/sidebar/sidebar-manager.ts`, add:

```typescript
import "./sidebar.css";
```

This follows the same pattern as `plugins-panel.ts` importing `./plugins-panel.css` and `keybindings-panel.ts` importing `./keybindings-panel.css`. Vite processes the CSS import and injects it into the document at runtime.

---

## Acceptance Criteria

1. The sidebar chrome renders without any unstyled flash after `initSidebar()` is called.
2. Tab bar appears only when two or more panels exist on a side; it is absent for single-panel sides.
3. Accordion chevron points down when expanded and rotates to point right when collapsed (`aria-expanded` drives the CSS transform — no JavaScript-driven class toggling for the chevron direction).
4. All colour tokens resolve correctly in both the default light and default dark themes and in the solarized-dark/nord custom themes.
5. No hardcoded colour hex values, rgb(), or hsl() values appear in the file — only `var(--token-name)` references.
6. Resize handle cursor is `col-resize` and the handle becomes visible (using `--link-color` at 40% opacity) on hover.
7. `#app-row > #editor` has `flex: 1` and `min-width: 0` so the editor fills remaining space correctly when sidebars are present.
8. `#sidebar-left` and `#sidebar-right` have `min-width: 150px` and `max-width: 600px` matching the clamp enforced in the TypeScript resize handler (step_02).

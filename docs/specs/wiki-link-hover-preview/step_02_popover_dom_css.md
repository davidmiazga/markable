---
title: "Step 02 — Popover DOM Element and CSS"
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 02: Popover DOM Element and CSS

## Requirement Traceability

- FR-4.1 — Single `<div>` appended to `document.body`.
- FR-4.2 — Three child elements: `.wl-popover-title`, `.wl-popover-path`, `.wl-popover-excerpt`.
- FR-4.3 — Element carries `data-markable-wiki-popover="true"`.
- FR-9.1 — Styles injected via `<style data-markable-wiki-popover-styles="true">`.
- FR-9.2 — CSS variables used: `--bg-primary`, `--border-color`, `--text-primary`, `--text-secondary`, `--ui-font`, `--link-color`.
- FR-9.3 — Fixed dimensions: max-width 320px, max-height 240px, font sizes, padding, box-shadow, border-radius, z-index 10000.
- FR-9.4 — 100ms CSS fade-in using `opacity` + `translate` transform.
- FR-10.5 — `user-select: none`.

## Context

This step creates two functions: `injectWikiPopoverStyles` and
`removeWikiPopoverStyles`. It does NOT create the popover DOM element itself
— the element is created fresh inside `showWikiPopover` (step_03) on every
display call. This is consistent with FR-4.4 (only one instance at a time)
and simplifies cleanup: `dismissWikiPopover` just calls `el.remove()`.

The pattern exactly mirrors `injectWikiLinkStyles` / `removeWikiLinkStyles`
(lines ~670–696) and `injectBacklinksCSS` / `removeBacklinksCSS`
(lines ~1690–1709). Use those as the implementation template.

## Section Placement

Add a new section comment block after the existing Step 9 flag declarations
(after line ~1882 where `_view` is declared) and before the plugin export:

```typescript
// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — CSS
// ---------------------------------------------------------------------------
```

This placement keeps all hover-popover code grouped together (the module-level
state variables for the hover feature will also go in this section, added in
step_03).

## CSS Specification

The injected CSS string (assign to a `const WIKI_POPOVER_CSS` variable for
readability):

```css
[data-markable-wiki-popover] {
  position: fixed;
  z-index: 10000;
  max-width: 320px;
  max-height: 240px;
  overflow: hidden;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  padding: 12px;
  font-family: var(--ui-font);
  user-select: none;
  pointer-events: auto;
  display: none;
  opacity: 0;
  transform: translate(0, 4px);
  transition: opacity 100ms ease, transform 100ms ease;
}

[data-markable-wiki-popover].wl-popover-visible {
  display: block;
  opacity: 1;
  transform: translate(0, 0);
}

.wl-popover-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--link-color);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wl-popover-path {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wl-popover-excerpt {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 7;
  -webkit-box-orient: vertical;
}
```

### CSS Design Notes

**Fade-in implementation**: The popover starts with `display: none; opacity: 0;
transform: translate(0, 4px)`. When the JS code adds the class `wl-popover-visible`,
it sets `display: block` plus the target opacity and transform values. The
`transition` on the base rule animates the opacity and transform.

Note: CSS transitions do not animate from `display: none`. The JS code must
force a reflow between removing `display: none` and setting the visible class.
The implementation pattern in `showWikiPopover` (step_03) will be:

```typescript
popoverEl.style.display = "block";
// Force reflow so the browser registers the initial opacity:0 state before transitioning
void popoverEl.offsetHeight;
popoverEl.classList.add("wl-popover-visible");
```

This replaces the `display` toggle on the base rule. An alternative is to keep
`display: block` always and use only `opacity`/`visibility`. However, using
`display: none` as the hidden state prevents the popover from being tab-focusable
or catchable by other event listeners when not visible.

**`-webkit-line-clamp`**: Used for excerpt truncation as a CSS-only approach.
7 lines at line-height 1.5 and font-size 12px occupies approximately 126px,
well within the 240px max-height when title (≈20px) and path (≈17px) and
padding (24px total) are accounted for.

**`pointer-events: auto`**: The popover must catch `mouseenter`/`mouseleave`
to implement the EC-08 grace period. This is why the popover is appended to
`document.body` rather than inside the editor's `overflow: hidden` container.

## `injectWikiPopoverStyles` Function

```typescript
export function injectWikiPopoverStyles(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector("[data-markable-wiki-popover-styles]")) return;

  const style = document.createElement("style");
  style.setAttribute("data-markable-wiki-popover-styles", "true");
  style.textContent = WIKI_POPOVER_CSS;
  document.head.appendChild(style);
}
```

## `removeWikiPopoverStyles` Function

```typescript
export function removeWikiPopoverStyles(): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector("[data-markable-wiki-popover-styles]");
  if (el) el.remove();
}
```

## Acceptance Criteria

1. Calling `injectWikiPopoverStyles()` once inserts exactly one `<style>` tag with `data-markable-wiki-popover-styles="true"` into `document.head`.
2. Calling `injectWikiPopoverStyles()` twice inserts only one tag (idempotent guard).
3. Calling `removeWikiPopoverStyles()` removes the tag.
4. Calling `removeWikiPopoverStyles()` when no tag exists does not throw.
5. The injected CSS string contains `z-index: 10000`.
6. The injected CSS string contains `user-select: none`.
7. The injected CSS string contains `transition: opacity 100ms`.
8. In a test environment (`typeof document === "undefined"`), both functions are no-ops.

## Implementation Notes

- Export both functions so tests can call them directly.
- The `WIKI_POPOVER_CSS` constant does NOT need to be exported.
- Do not add `--bg-color` (which does not exist); the correct variable is `--bg-primary` (confirmed in `src/styles.css` line 8 and dark mode override line 80).
- The `data-markable-wiki-popover-styles` attribute (on the `<style>` tag) is different from `data-markable-wiki-popover` (on the popover `<div>`). Do not confuse them.

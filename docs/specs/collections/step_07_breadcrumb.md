---
title: "Step 07 — Breadcrumb Component"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 07 — Multi-Level-Ready Breadcrumb

## Goal

Provide a single render function that turns an ordered list of segments into a breadcrumb DOM element. Supports up to 5 segments; MVP emits 3 (Home / Stack / Note). No internal state.

## Files touched

- **New** `src/plugins/file-browser/collections/breadcrumb.ts`
- **New** `tests/collections/breadcrumb.test.ts`

## Function signatures to add

```typescript
import type { BreadcrumbSegment } from "./types";

/**
 * Build a breadcrumb element from a list of segments.
 *
 * - Segments are rendered in order with literal "/" separators.
 * - A segment whose `onClick === null` is rendered as plain text
 *   (the "current page" segment).
 * - All other segments render as buttons; click fires `onClick`.
 *
 * Returns a fresh detached element; the caller mounts it. Component
 * is stateless — to update, replace the node.
 *
 * MVP emits 3 segments (Home, Stack, Note). Phase 2 may emit 5
 * (Home, Book, Chapter, Stack, Note). No code change needed.
 */
export function renderBreadcrumb(
  segments: readonly BreadcrumbSegment[],
): HTMLElement;
```

DOM shape:

```html
<nav class="fv-collection-breadcrumb" aria-label="Breadcrumb">
  <button class="fv-collection-breadcrumb-seg" type="button">Home</button>
  <span class="fv-collection-breadcrumb-sep" aria-hidden="true">/</span>
  <button class="fv-collection-breadcrumb-seg" type="button">Stack 01</button>
  <span class="fv-collection-breadcrumb-sep" aria-hidden="true">/</span>
  <span class="fv-collection-breadcrumb-seg is-current">MyNote.md</span>
</nav>
```

## Failing tests to write FIRST

`tests/collections/breadcrumb.test.ts`:

| Test name | EC / FR | Asserts |
|---|---|---|
| `renders one segment + zero separators for a 1-segment input` | edge | DOM has 1 button, 0 separators |
| `renders 3 segments + 2 separators for the MVP case` | FR-30 | 3 children of type segment, 2 separators interleaved |
| `last segment with onClick null renders as span, not button` | FR-31 | last child is `<span class="fv-collection-breadcrumb-seg is-current">` |
| `clicking a segment fires its onClick` | FR-31 | spy fires with no args |
| `non-current segment with onClick null renders as span (not button)` | FR-31 | applies regardless of position |
| `renders 5 segments + 4 separators (Phase-2 readiness)` | C-11 | structure scales |
| `escapes label text (no innerHTML injection)` | XSS | label with `<script>` rendered as text |
| `aria-label attribute equals "Breadcrumb"` | a11y | accessibility contract |
| `update by replacement: render twice yields two independent elements` | stateless | nodeA !== nodeB; mutating nodeA doesn't affect nodeB |
| `stack rename → new render shows new label without navigation` | EC-24 | re-render with updated middle segment label → DOM reflects the new label string |

## Implementation outline

1. `const nav = document.createElement("nav"); nav.className = "fv-collection-breadcrumb"; nav.setAttribute("aria-label", "Breadcrumb");`
2. For each segment, index `i`:
   - If `seg.onClick === null`:
     - `const el = document.createElement("span"); el.className = "fv-collection-breadcrumb-seg is-current"; el.textContent = seg.label;`
   - Else:
     - `const el = document.createElement("button"); el.type = "button"; el.className = "fv-collection-breadcrumb-seg"; el.textContent = seg.label; el.addEventListener("click", seg.onClick);`
   - Append `el`.
   - If `i < segments.length - 1`, append separator span with literal `/`.
3. Return `nav`.

`textContent` (not `innerHTML`) covers the XSS test.

## Refactor opportunities

None — the component is intentionally minimal. Step 17 (CSS) wires the visuals.

## Definition of Done

```bash
npm run test:run -- tests/collections/breadcrumb.test.ts
```
Expected: 10 tests pass. Plugin rebuild required.

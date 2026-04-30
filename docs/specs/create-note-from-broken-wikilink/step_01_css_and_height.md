# Step 01 — CSS Additions and `estimatedHeight` Update

**File**: `src/plugins/backlinks/backlinks.plugin.ts`
**Goal**: Append two new CSS rules to `WIKI_POPOVER_CSS` and update the
`estimatedHeight` constant in `positionPopover`.

No logic changes in this step. No new functions. This step is self-contained
and can be committed independently.

---

## Change 1 — Extend `WIKI_POPOVER_CSS`

**Location**: the `WIKI_POPOVER_CSS` template literal (currently ends with the
`.wl-popover-excerpt` block, around line 2227).

Append the following two rule blocks immediately after the closing brace of
`.wl-popover-excerpt`:

```css
.wl-popover-create-btn {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 10px;
  font-family: var(--ui-font);
  font-size: 12px;
  color: var(--link-color);
  background: transparent;
  border: 1px solid var(--link-color);
  border-radius: 4px;
  cursor: pointer;
}

.wl-popover-create-btn:hover {
  background: color-mix(in srgb, var(--link-color) 15%, transparent);
}

.wl-popover-error-msg {
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-error, #c0392b);
  white-space: pre-wrap;
  word-break: break-word;
}
```

### Rationale

- `color-mix(in srgb, var(--link-color) 15%, transparent)` is the standards-
  compliant alternative to `rgba(var(--link-color), 0.15)` — CSS variables are
  not decomposable via rgba(), so `color-mix` is required for alpha-blended
  tints. All WebKit versions shipping in macOS 13+ (Ventura) support `color-mix`.
- `var(--color-error, #c0392b)` provides a theme-aware error colour with a
  fallback. If the active theme defines `--color-error`, it is used; otherwise
  a sensible red is applied.
- No hardcoded non-fallback colours are used. NFR-5 satisfied.
- No new font families, weights, or sizes beyond those already in the popover.
- `margin-top: 8px` on both new elements provides visual separation from the
  path row above and keeps the layout consistent with the 12 px padding on the
  popover container.

---

## Change 2 — Update `estimatedHeight` in `positionPopover`

**Location**: inside `positionPopover`, the line that reads:

```typescript
  const estimatedHeight = 240; // matches CSS max-height
```

Change to:

```typescript
  const estimatedHeight = 280; // increased for broken-link "Create note" button row
```

### Rationale

The broken-link popover adds a button row (approximately 36 px including
`margin-top: 8px` + `4px 10px` padding + `12px` font line height). The
`estimatedHeight` constant is a conservative estimate used for the viewport
flip-above calculation — it is not the CSS `max-height` value. The CSS
`max-height: 240px` on `[data-markable-wiki-popover]` does not need to change
because the Create note popover has fewer rows (no excerpt), so total height
stays within 240 px in practice. The bump to 280 ensures the flip-above
calculation has sufficient headroom and does not misplace the popover when the
button row is present. NFR-3 satisfied.

---

## Acceptance Criteria

- `WIKI_POPOVER_CSS` string contains `.wl-popover-create-btn` block.
- `WIKI_POPOVER_CSS` string contains `.wl-popover-error-msg` block.
- `WIKI_POPOVER_CSS` string contains `.wl-popover-create-btn:hover` block.
- No hardcoded hex or rgb colour values except the `--color-error` fallback.
- `positionPopover` uses `estimatedHeight = 280`.
- All existing `positionPopover` tests in `hover-popover.test.ts` still pass.

---

## TDD Notes

No new tests are required for this step in isolation — CSS strings are not unit
tested, and the `estimatedHeight` change is a numeric constant adjustment. The
existing `positionPopover` tests verify the flip-above logic behaviour and
remain valid at 280. Step 04 adds regression assertions that confirm the CSS
string contains the expected class names.

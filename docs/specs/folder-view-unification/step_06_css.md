---
title: "Step 06 — CSS for fv-card-meta and Card Checkbox"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 06 — CSS for `.fv-card-meta` and Card Checkbox

**Goal**: Add two new CSS rule groups to `folder-view-css.ts`:
1. `.fv-card-meta` — the metadata line below the card name (C-9).
2. `.fv-card-checkbox-wrap` and hover-opacity rules for card checkboxes (C-10).

Also add `.fv-card-master-checkbox-wrap` and `.fv-card-master-label` for the
per-section master checkbox row (introduced in Step 04).

No other files change in this step.

---

## Files Changed

| File | Change |
|---|---|
| `src/plugins/file-browser/folder-view/folder-view-css.ts` | Append new CSS rules to `FOLDER_VIEW_CSS` |

---

## 1. Rules to Add

Append the following block to the `FOLDER_VIEW_CSS` template string in
`folder-view-css.ts`, immediately before the closing backtick of the template
literal:

```css
/* ── Card metadata line (.fv-card-meta) ─────────────────────────────── */

/*
 * .fv-card-meta: single-line condensed field-values row below the card name.
 * Appears in fields: mode; replaces .folder-view-card-date when fields: is
 * declared. Smaller font and muted color match .folder-view-card-date style.
 * overflow:hidden + text-overflow:ellipsis truncates long combined values.
 */
.fv-card-meta {
  font-size: 10px;
  color: var(--text-secondary, rgba(128,128,128,.55));
  padding: 0 8px 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Card checkbox (.fv-card-checkbox-wrap) ──────────────────────────── */

/*
 * .fv-card-checkbox-wrap: repurposed <td> (from buildCheckboxTd) used as
 * an absolutely-positioned overlay at the top-left corner of each card.
 * The card itself must have position:relative (set inline by buildCard).
 *
 * Hover-only visibility: opacity 0 by default; transitions to 1 when the
 * card or its parent section is hovered. The transition duration matches
 * the card background transition (0.1s ease) for visual consistency.
 *
 * z-index: 1 lifts the checkbox above the preview background image.
 */
.fv-card-checkbox-wrap {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.1s ease;
  /* Override <td> default styles that would affect positioning */
  padding: 0;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Small semi-transparent backing for contrast against image previews */
  background: var(--bg-overlay, rgba(0,0,0,0.18));
  border-radius: 3px;
  width: 20px;
  height: 20px;
}

/* Reveal checkbox on card hover */
.folder-view-card:hover .fv-card-checkbox-wrap {
  opacity: 1;
}

/* Reveal all section checkboxes on section hover (EC-18) */
.folder-view-section:hover .fv-card-checkbox-wrap {
  opacity: 1;
}

/* Keep checkbox visible when already checked (selected state) */
.folder-view-card.fv-row--selected .fv-card-checkbox-wrap {
  opacity: 1;
}

/* Checkbox input sizing inside the wrap */
.fv-card-checkbox-wrap input[type="checkbox"] {
  cursor: pointer;
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--accent, #4a9eff);
  vertical-align: middle;
}

/* ── Card selected state ──────────────────────────────────────────────── */

/*
 * .fv-row--selected on a card: matches the table layout's row selection tint.
 * Uses the same CSS variable as .fv-row.fv-row--selected in folder-table-css.ts.
 */
.folder-view-card.fv-row--selected {
  background: var(--bulk-select-bg,
    color-mix(in srgb, var(--accent, #4a9eff) 12%, transparent));
  border-color: var(--accent, #4a9eff);
}
.folder-view-card.fv-row--selected:hover {
  background: var(--bulk-select-hover-bg,
    color-mix(in srgb, var(--accent, #4a9eff) 20%, transparent));
}

/* ── Master checkbox row for card sections ───────────────────────────── */

/*
 * .fv-card-master-checkbox-wrap: row above the card grid in each section.
 * Aligns master checkbox + "Select all" label horizontally.
 * Hidden by default; only rendered when a BulkContext is provided.
 */
.fv-card-master-checkbox-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 2px 0;
}

.fv-card-master-label {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-secondary, rgba(128,128,128,.55));
  user-select: none;
}

.fv-card-master-label input[type="checkbox"] {
  cursor: pointer;
  width: 13px;
  height: 13px;
  accent-color: var(--accent, #4a9eff);
  vertical-align: middle;
}

.fv-card-master-label-text {
  font-size: 11px;
  color: var(--text-secondary, rgba(128,128,128,.55));
}
```

---

## 2. Design Notes

### `.fv-card-meta` styling rationale (C-9)

The `font-size: 10px`, `color: var(--text-secondary)`, and `padding: 0 8px 5px`
are identical to the existing `.folder-view-card-date` rule. This ensures the
metadata line, when it replaces `.folder-view-card-date`, produces no visible
change in card height or layout for the case where only `modified` is shown in
fields: mode.

### `.fv-card-checkbox-wrap` positioning (C-10)

- `position: absolute` + `top: 6px; left: 6px` places the checkbox in the
  upper-left corner, overlapping the preview rectangle.
- The `6px` offset prevents it from clipping the card border-radius.
- `z-index: 1` lifts it above background-image divs (`.folder-view-preview-bg-img`
  has no explicit z-index, so it stays at 0).
- The small `rgba(0,0,0,0.18)` backing ensures the checkbox is legible over
  light-colored or transparent image previews without a harsh opaque box.

### Hover trigger chains (EC-18)

Three CSS selectors reveal the checkbox:
1. `.folder-view-card:hover .fv-card-checkbox-wrap` — card-level hover.
2. `.folder-view-section:hover .fv-card-checkbox-wrap` — section-level hover
   (hovering anywhere in the section, including between cards, reveals all).
3. `.folder-view-card.fv-row--selected .fv-card-checkbox-wrap` — checked cards
   always show their checkbox so the user can uncheck them without having to
   hover precisely.

### `fv-row--selected` on cards vs rows

The class `fv-row--selected` is applied by `buildCheckboxTd` via
`tr.classList.toggle("fv-row--selected", input.checked)`. In `buildCard`, the
card `div` is passed as the `tr` argument (safely, because only `classList.toggle`
is called). So the class lands on `.folder-view-card`. The CSS rule
`.folder-view-card.fv-row--selected` in `folder-view-css.ts` handles the
visual tint. This does not conflict with `.fv-row.fv-row--selected` in
`folder-table-css.ts` (different element selector).

---

## Tests to Write (TDD — write before implementing)

These are CSS class assertion tests, not visual regression tests. The test
environment uses JSDOM which does not execute CSS, so we assert DOM class
presence and computed-style fallbacks only.

File: `tests/folder-view/renderer.test.ts` (extend existing)

### Test: `fv-card-meta class is applied to metadata line element`

```
Given: config.fields = ["modified"], file card with modified > 0
When:  renderFolderCards is called
Then:  the metadata element has className === "fv-card-meta"
       (not "folder-view-card-date")
```

### Test: `fv-card-checkbox-wrap class is applied to checkbox container`

```
Given: a BulkContext
When:  renderFolderCards is called with one file card
Then:  the checkbox container has className === "fv-card-checkbox-wrap"
```

### Test: `folder-view-card has position: relative set inline`

```
Given: a BulkContext
When:  renderFolderCards is called
Then:  card element has el.style.position === "relative"
```

### Test: C-8 — `FOLDER_VIEW_STARTER` does not contain "folder-table only"

```
Given: the exported FOLDER_VIEW_STARTER constant from file-browser.plugin.ts
Then:  FOLDER_VIEW_STARTER.includes("folder-table only") === false
       FOLDER_VIEW_STARTER.includes("fields:") === true
       FOLDER_VIEW_STARTER.includes("extra-fields:") === true
```

---

## Acceptance Criteria

- [ ] `.fv-card-meta` CSS rule added to `FOLDER_VIEW_CSS` with correct font-size, color, padding
- [ ] `.fv-card-checkbox-wrap` CSS rule: `position: absolute`, `top: 6px`, `left: 6px`, `z-index: 1`
- [ ] `opacity: 0` by default; `opacity: 1` on card hover, section hover, and selected state
- [ ] `transition: opacity 0.1s ease` present
- [ ] `.folder-view-card.fv-row--selected` tint rule present (uses same `--bulk-select-bg` variable as table)
- [ ] `.fv-card-master-checkbox-wrap` and `.fv-card-master-label` rules present
- [ ] All tests in test group above pass
- [ ] All existing tests pass (`npm run test:run`)

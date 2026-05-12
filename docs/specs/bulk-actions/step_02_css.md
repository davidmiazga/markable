---
title: "Step 02 — Bulk Action CSS"
last-updated: "2026-05-11"
review-cadence-days: 7
status: active
---

# Step 02 — Bulk Action CSS

## Goal

Append all new CSS rules for the checkbox column, selected-row tint, and bulk
toolbar to `folder-table-css.ts`. No new CSS file is introduced.

All rules use CSS custom properties. No hard-coded color values (FR-9, NFR-5).

---

## Files to Modify

### `src/plugins/file-browser/folder-view/folder-table-css.ts`

The file currently exports `FOLDER_TABLE_CSS` as a template-literal string.
Append the following block to the string **before the closing backtick**.

```css
/* ── Checkbox column ───────────────────────────────────────────────── */

/* Fixed narrow width; no cursor pointer (clicking the cell stops propagation) */
.fv-th-checkbox, .fv-td-checkbox {
  width: 32px;
  padding: 4px 6px 4px 8px;
  cursor: default;
  vertical-align: middle;
}

/* Checkbox inputs inside fv-td-checkbox and fv-th-checkbox */
.fv-td-checkbox input[type="checkbox"],
.fv-th-checkbox input[type="checkbox"] {
  cursor: pointer;
  width: 14px;
  height: 14px;
  accent-color: var(--accent, #4a9eff);
  vertical-align: middle;
}

/* Header checkbox cell: non-sortable, same default cursor as count/tags */
.fv-th-checkbox { cursor: default; }

/* ── Selected row tint ─────────────────────────────────────────────── */

.fv-row.fv-row--selected {
  background: var(--bulk-select-bg, color-mix(in srgb, var(--accent, #4a9eff) 12%, transparent));
}
.fv-row.fv-row--selected:hover {
  background: var(--bulk-select-hover-bg, color-mix(in srgb, var(--accent, #4a9eff) 20%, transparent));
}

/* ── Bulk-action toolbar ───────────────────────────────────────────── */

.fv-bulk-toolbar {
  display: none;                   /* hidden by default; shown via JS */
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-toolbar, var(--bg-secondary, rgba(128,128,128,.08)));
  border-bottom: 1px solid var(--border-color, rgba(128,128,128,.2));
  position: sticky;
  top: 0;
  z-index: 10;
  font-size: 13px;
  flex-wrap: wrap;
}

/* When visible, display as flex */
.fv-bulk-toolbar.fv-bulk-toolbar--visible {
  display: flex;
}

.fv-bulk-toolbar__count {
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

/* Toolbar action buttons */
.fv-bulk-toolbar__btn {
  padding: 3px 10px;
  border: 1px solid var(--border-color, rgba(128,128,128,.3));
  border-radius: 4px;
  background: var(--bg-input, var(--bg-secondary));
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.fv-bulk-toolbar__btn:hover {
  background: var(--bg-hover, rgba(128,128,128,.14));
}
.fv-bulk-toolbar__btn:disabled {
  opacity: .45;
  cursor: default;
}

/* Delete button gets a subtle destructive tint when armed */
.fv-bulk-toolbar__btn--danger {
  color: var(--color-error, #e05252);
  border-color: var(--color-error, #e05252);
}
.fv-bulk-toolbar__btn--danger:hover {
  background: color-mix(in srgb, var(--color-error, #e05252) 12%, transparent);
}

/* ── Sub-UI panel (move input / delete confirm / YAML form) ─────── */

.fv-bulk-subui {
  display: none;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.fv-bulk-subui--visible {
  display: flex;
}

.fv-bulk-subui__label {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.fv-bulk-subui__input {
  padding: 3px 6px;
  border: 1px solid var(--border-color, rgba(128,128,128,.3));
  border-radius: 4px;
  background: var(--bg-input, var(--bg-primary));
  color: var(--text-primary);
  font-size: 12px;
  min-width: 220px;
}

.fv-bulk-subui__select {
  padding: 3px 6px;
  border: 1px solid var(--border-color, rgba(128,128,128,.3));
  border-radius: 4px;
  background: var(--bg-input, var(--bg-primary));
  color: var(--text-primary);
  font-size: 12px;
}

/* ── Result summary line ─────────────────────────────────────────── */

.fv-bulk-result {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: pre-wrap;       /* preserves newlines in multi-line summaries */
}
.fv-bulk-result--error {
  color: var(--color-error, #e05252);
}
```

---

## Acceptance Criteria

1. `folder-table-css.ts` compiles without TypeScript errors.
2. The `FOLDER_TABLE_CSS` export string contains the new rules for:
   - `.fv-th-checkbox` / `.fv-td-checkbox`
   - `.fv-row.fv-row--selected`
   - `.fv-bulk-toolbar` and `.fv-bulk-toolbar--visible`
   - `.fv-bulk-toolbar__btn` and `.fv-bulk-toolbar__btn--danger`
   - `.fv-bulk-subui` and `.fv-bulk-subui--visible`
   - `.fv-bulk-result`
3. No hard-coded color hex values exist in the new rules (all colors via
   `var(--...)` with optional fallbacks).
4. `npm run test:run` passes (CSS changes do not affect TypeScript tests).

---

## No Tests in This Step

CSS correctness is verified visually during step_07. Unit tests that check
for class names are written in steps 04 and 05.

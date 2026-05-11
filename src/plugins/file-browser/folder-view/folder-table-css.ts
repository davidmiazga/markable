/**
 * folder-table-css.ts — CSS for the `folder-table` layout.
 *
 * Exported as FOLDER_TABLE_CSS and appended to FILE_BROWSER_CSS in
 * file-browser.plugin.ts alongside FOLDER_VIEW_CSS.
 *
 * All color values use CSS custom properties — no hard-coded colors (FR-25).
 * Reuses `.folder-view-host`, `.folder-view-section`, `.folder-view-section-title`,
 * `.folder-view-tag-chip`, and `.folder-view-empty` from folder-view-css.ts.
 *
 * @module folder-view/folder-table-css
 */

export const FOLDER_TABLE_CSS = `

/* ── Table layout ─────────────────────────────────────────────────────── */

.fv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
}

/* ── Column widths ────────────────────────────────────────────────────── */

.fv-th-icon, .fv-td-icon { width: 28px; padding: 5px 4px 5px 0; }
.fv-th-ext,  .fv-td-ext  { width: 58px; }
.fv-th-modified, .fv-td-modified { width: 110px; }
.fv-th-count, .fv-td-count { width: 54px; }
.fv-th-tags, .fv-td-tags  { width: 160px; }

/* ── Header cells ─────────────────────────────────────────────────────── */

.fv-th {
  text-align: left;
  padding: 5px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color, rgba(128,128,128,.2));
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.fv-th-icon, .fv-th-tags, .fv-th-count { cursor: default; }
.fv-th.fv-sorted-asc::after  { content: " ↑"; opacity: .7; }
.fv-th.fv-sorted-desc::after { content: " ↓"; opacity: .7; }

/* ── Data rows ────────────────────────────────────────────────────────── */

.fv-row {
  cursor: pointer;
  border-bottom: 1px solid var(--border-color-subtle, rgba(128,128,128,.08));
}
.fv-row:last-child { border-bottom: none; }
.fv-row:hover { background: var(--bg-secondary, rgba(128,128,128,.06)); }
.fv-row:focus { outline: 2px solid var(--accent, #4a9eff); outline-offset: -2px; }

/* ── Data cells ───────────────────────────────────────────────────────── */

.fv-td {
  padding: 6px 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
  color: var(--text-primary);
}
.fv-td-icon { color: var(--text-secondary); line-height: 0; }
.fv-td-icon svg { width: 16px; height: 16px; vertical-align: middle; fill: currentColor; }
.fv-td-name { font-size: 13px; }
.fv-td-ext  { color: var(--text-secondary); font-size: 11px; }
.fv-td-modified { color: var(--text-secondary); font-size: 12px; }
.fv-td-count { color: var(--text-secondary); font-size: 12px; text-align: right; }
.fv-td-tags { padding-top: 4px; padding-bottom: 4px; }
.fv-td-extra { color: var(--text-primary); font-size: 12px; }

/* ── Lazy-load sentinel row ───────────────────────────────────────────── */

.fv-sentinel-row { height: 1px; visibility: hidden; }

`;

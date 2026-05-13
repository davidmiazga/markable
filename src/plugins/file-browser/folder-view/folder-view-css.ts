/**
 * folder-view.css.ts — CSS for the Folder View feature.
 *
 * Exports FOLDER_VIEW_CSS, a string constant that is appended to FILE_BROWSER_CSS
 * in file-browser.plugin.ts at module-load time (AD-6).
 *
 * Design rules (FR-25, AD-6):
 * - All color values use CSS custom properties (var(--*)) — no hard-coded colors.
 * - Card grid uses `display: grid` with `--fv-columns` CSS variable for column count.
 * - The `--fv-columns` variable is set inline on the grid container by renderer.ts.
 * - No new <style> tag is created; this string is concatenated into the single
 *   FILE_BROWSER_CSS tag that is already injected by injectFileBrowserCSS().
 *
 * @module folder-view/folder-view.css
 */

export const FOLDER_VIEW_CSS = `

/* ── Folder View host container ───────────────────────────────────────── */

/*
 * .folder-view-host: full-width, full-height scrollable wrapper.
 * Uses padding for comfortable reading margins.
 */
.folder-view-host {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 20px 24px 32px;
  font-family: var(--ui-font);
}

/* Lazy-load sentinel: invisible 1px element at grid end; triggers next batch. */
.fv-load-sentinel { height: 1px; width: 100%; grid-column: 1 / -1; }

/* content-area-override: false — constrain to editor content-area width and center. */
.folder-view-host--constrained {
  max-width: var(--settings-content-max-width, 900px);
  margin-left: auto;
  margin-right: auto;
}

/* ── Description block (FR-24) ────────────────────────────────────────── */

/*
 * .folder-view-description: renders the _folder.md markdown body above
 * the card grid. Uses the same text styling as the rest of the UI.
 */
.folder-view-description {
  margin-bottom: 20px;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.6;
}
.folder-view-description p { margin: 0 0 8px; }
.folder-view-description h1,
.folder-view-description h2,
.folder-view-description h3 {
  margin: 0 0 10px;
  color: var(--text-primary);
}

/* ── Section wrapper ──────────────────────────────────────────────────── */

/* .folder-view-section: groups a section heading + grid (Folders / Files). */
.folder-view-section { margin-bottom: 24px; }

/* .folder-view-section-title: muted uppercase label for each section. */
.folder-view-section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary, rgba(128,128,128,.55));
  margin: 0 0 10px;
}

/* ── Card grid ────────────────────────────────────────────────────────── */

/*
 * .folder-view-grid: default is CSS grid with auto-fill — consistent,
 * predictable column counts that snap as the container resizes.
 * .fv-flex-mode switches to flex-wrap for continuous fluid resizing.
 */
.folder-view-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--fv-card-width, 160px), 1fr));
  gap: 10px;
}

.folder-view-grid.fv-flex-mode {
  display: flex;
  flex-wrap: wrap;
}

/* ── Card base styles ─────────────────────────────────────────────────── */

/*
 * .folder-view-card: base card element.
 * No padding at the card level — the preview rectangle fills the top
 * edge-to-edge; the name label has its own padding below.
 */
.fv-flex-mode .folder-view-card {
  flex: 1 1 var(--fv-card-width, 160px);
  max-width: calc(var(--fv-card-width, 160px) * 2);
  min-width: 0;
}

.folder-view-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  border: 1px solid var(--border-color, rgba(128,128,128,.2));
  border-radius: 6px;
  background: var(--bg-secondary, rgba(128,128,128,.04));
  cursor: pointer;
  user-select: none;
  transition: background 0.1s ease, box-shadow 0.1s ease;
  overflow: hidden;
}
.folder-view-card:hover {
  background: var(--hover-bg, rgba(128,128,128,.08));
}
.folder-view-card:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--accent-color);
}

/* ── Card preview rectangle ───────────────────────────────────────────── */

/*
 * .folder-view-card-preview: content-preview area at the top of each card.
 * Shape and sizing are set by inline styles from renderer.ts (aspectRatio,
 * minHeight, maxHeight). The CSS fallback min-height applies only when
 * inline styles are absent (e.g. in tests without full config).
 * position: relative anchors .folder-view-preview-bg-img (absolute inset).
 */
.folder-view-card-preview {
  width: 100%;
  min-height: 40px;
  overflow: hidden;
  background: var(--bg-tertiary, rgba(128,128,128,.07));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
}

/* Background-image div for fixed-ratio image previews. Fills the container
 * absolutely; background-size is set inline by renderer.ts (config.fit). */
.folder-view-preview-bg-img {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
  background-position: center;
}

/* Natural-proportion <img> for aspect-ratio: original. Fills width, height
 * follows the image's intrinsic ratio. Container clips via overflow: hidden. */
.folder-view-preview-img-natural {
  width: 100%;
  height: auto;
  display: block;
}

/* Icon: centred and muted for non-image, non-text files. */
.folder-view-preview-icon {
  width: 36px;
  height: 36px;
  opacity: 0.45;
  display: flex;
  align-items: center;
  justify-content: center;
}
.folder-view-preview-icon svg {
  display: block;
  fill: currentColor;
  width: 100%;
  height: 100%;
}

/* Text excerpt: small, muted, clamped. */
.folder-view-preview-text {
  padding: 8px 10px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-secondary, rgba(128,128,128,.55));
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  width: 100%;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Card name ────────────────────────────────────────────────────────── */

.folder-view-card-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.3;
  padding: 6px 8px 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-view-card-date {
  font-size: 10px;
  color: var(--text-secondary, rgba(128,128,128,.55));
  padding: 0 8px 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Empty / loading / fallback states ─────────────────────────────────── */

/*
 * .folder-view-empty: shown when the folder has no children other than
 * _folder.md itself (FR-26, EC-06).
 */
.folder-view-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, rgba(128,128,128,.55));
}

/*
 * .folder-view-loading: shown while _folder.md is being read from disk.
 * Typically visible for <100ms and rarely noticed by the user.
 */
.folder-view-loading {
  padding: 20px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary, rgba(128,128,128,.55));
}

/*
 * .folder-view-fallback: container for the FR-12/FR-13 graceful fallback.
 * Shown when the layout field is absent or unrecognized.
 */
.folder-view-fallback {
  padding: 20px 24px;
  font-family: var(--ui-font);
  font-size: 13px;
  color: var(--text-primary);
}

/*
 * .folder-view-fallback-notice: faint italic notice text.
 * Subtle styling signals this is an informational message, not content.
 */
.folder-view-fallback-notice {
  font-size: 12px;
  font-style: italic;
  color: var(--text-secondary, rgba(128,128,128,.55));
  margin: 0 0 16px;
}

/* ── Tag chips (FVB-01) ───────────────────────────────────────────────── */

.folder-view-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 2px 8px 6px;
}

.folder-view-tag-chip {
  font-size: 9px;
  font-weight: 500;
  line-height: 1.4;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--bg-tertiary, rgba(128,128,128,.12));
  color: var(--text-secondary, rgba(128,128,128,.65));
  white-space: nowrap;
  overflow: hidden;
  max-width: 72px;
  text-overflow: ellipsis;
}

/* ── Folder View enhanced directory in the file tree (FR-07) ──────────── */

/*
 * .tree-node-has-folder-view: applied to directory <li> nodes that contain
 * _folder.md. Accent-colors the folder icon and label; adds a preview badge
 * on the right (same pattern as the vault unmount button).
 * The class is also used for querySelectorAll lookups in tests.
 */
.tree-node-has-folder-view .tree-node-icon,
.tree-node-has-folder-view .tree-node-label {
  color: var(--accent-color);
}

/* _folder.md file entries share the accent color of their parent directory. */
.tree-node-is-folder-md .tree-node-icon,
.tree-node-is-folder-md .tree-node-label {
  color: var(--accent-color);
}

.tree-node-fv-badge {
  margin-left: auto;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.75;
  color: var(--accent-color);
}
.tree-node-fv-badge svg {
  display: block;
  fill: currentColor;
  width: 100%;
  height: 100%;
}

/* ── Card metadata line (.fv-card-meta) ─────────────────────────────── */

/*
 * .fv-card-meta: single-line condensed field-values row below the card name.
 * Appears in fields: mode and in legacy mode when showModified/showTags is true.
 * It replaces .folder-view-card-date when fields: is declared (EC-16).
 * Smaller font and muted color match .folder-view-card-date style to keep the
 * visual change zero for existing users.
 * overflow:hidden + text-overflow:ellipsis truncates long combined values (C-9).
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
 * .fv-card-checkbox-wrap: repurposed <td> from buildCheckboxTd used as an
 * absolutely-positioned overlay in the top-left corner of each card.
 * The card itself has position:relative set inline by buildCard so this
 * overlay stays within the card boundaries.
 *
 * z-index:1 lifts the checkbox above .folder-view-preview-bg-img (no explicit
 * z-index, so stays at stacking context 0).
 *
 * Hover-only visibility: opacity 0 by default; transitions to 1 when the card
 * or its parent section is hovered. The 0.1s duration matches the card
 * background transition for visual consistency (C-10).
 *
 * A small semi-transparent backing (rgba(0,0,0,0.18)) improves legibility over
 * light-colored or transparent image previews without a harsh opaque box.
 */
.fv-card-checkbox-wrap {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.1s ease;
  /* Reset <td> default styles that would affect positioning */
  padding: 0;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Semi-transparent backing for contrast against image previews */
  background: var(--bg-overlay, rgba(0,0,0,0.18));
  border-radius: 3px;
  width: 20px;
  height: 20px;
}

/* Reveal checkbox when the card itself is hovered (EC-18) */
.folder-view-card:hover .fv-card-checkbox-wrap {
  opacity: 1;
}

/* Reveal all section checkboxes when hovering anywhere in the section (EC-18) */
.folder-view-section:hover .fv-card-checkbox-wrap {
  opacity: 1;
}

/* Keep checkbox visible when the card is selected so the user can uncheck
 * without having to hover exactly over the card first (EC-18). */
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
 * .fv-row--selected on a card: applied by buildCheckboxTd's change handler
 * (tr.classList.toggle("fv-row--selected", input.checked), where tr is the
 * card div cast to HTMLTableRowElement). Uses the same CSS variable as
 * .fv-row.fv-row--selected in folder-table-css.ts for visual consistency.
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
 * Only rendered when a BulkContext is provided (Step 04).
 * Aligns master checkbox + "Select all" label horizontally.
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

/* ── Preview pane split layout ───────────────────────────────────────── */

/* Host becomes a flex column when preview pane is active. */
.folder-view-host.fv-host--with-preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
  padding: 0;
}

/* Scrollable content area below the pane (grid / table + toolbar + description). */
.folder-view-main {
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 0;
  padding: 20px 24px 32px;
  box-sizing: border-box;
}

/* ── Preview pane element ─────────────────────────────────────────────── */

.fvp-pane {
  flex: 0 0 var(--fvp-height, 60%);
  overflow-y: auto;
  min-height: 60px;
  display: flex;
  flex-direction: column;
}

/* Draggable resize handle — 4px hit area between pane and content */
/* Resize handle: visually 1px, but padding extends the grab target to 7px. */
.fvp-resize-handle {
  flex: 0 0 1px;
  cursor: ns-resize;
  position: relative;
  z-index: 10;
  padding: 3px 0;
  box-sizing: content-box;
  background: transparent;
}
.fvp-resize-handle::after {
  content: '';
  display: block;
  height: 1px;
  background: var(--border-color, rgba(128,128,128,.2));
  opacity: .3;
  transition: background 0.15s, opacity 0.15s;
}
.fvp-resize-handle:hover::after,
.fvp-resize-handle--dragging::after {
  background: var(--accent-color, #4a9eff);
  opacity: 1;
}

.fvp-header {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, rgba(128,128,128,.55));
  border-bottom: 1px solid var(--border-color-subtle, rgba(128,128,128,.1));
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fvp-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* Rendered markdown content */
.fvp-md-content {
  font-size: 14px;
  line-height: 1.6;
  max-width: 680px;
  margin: 0 auto;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* Image preview */
.fvp-image-content {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}
.fvp-image-content img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

/* Empty / placeholder / no-preview text */
.fvp-empty {
  color: var(--text-secondary, rgba(128,128,128,.55));
  font-size: 13px;
  text-align: center;
  padding-top: 32px;
}

/* Icon for non-image / non-text previews */
.fvp-other-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 0 8px;
  opacity: 0.35;
  width: 48px;
  height: 48px;
  margin: 0 auto;
}
.fvp-other-icon svg {
  width: 100%;
  height: 100%;
  fill: currentColor;
  display: block;
}

/* ── Preview-selection highlight ─────────────────────────────────────── */

/* Applied to the card element or table row when selected for preview. */
.folder-view-card.fv-card--selected {
  outline: 2px solid var(--accent-color, #4a9eff);
  outline-offset: -2px;
  background: color-mix(in srgb, var(--accent, #4a9eff) 8%, var(--bg-secondary, transparent));
}

.fv-row.fv-card--selected {
  background: color-mix(in srgb, var(--accent, #4a9eff) 8%, transparent);
  outline: none;
}
`;

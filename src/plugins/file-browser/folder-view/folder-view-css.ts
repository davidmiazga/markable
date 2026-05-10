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
 * .folder-view-grid: CSS grid container.
 * Column count is controlled by the --fv-columns custom property set inline
 * on the element by renderer.ts (FR-25, EC-11).
 */
.folder-view-grid {
  display: grid;
  grid-template-columns: repeat(var(--fv-columns, 3), 1fr);
  gap: 10px;
}

/* ── Card base styles ─────────────────────────────────────────────────── */

/*
 * .folder-view-card: base card element.
 * No padding at the card level — the preview rectangle fills the top
 * edge-to-edge; the name label has its own padding below.
 */
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
 * Images fill the rectangle; text files show an excerpt; other files show
 * a centred icon.
 */
.folder-view-card-preview {
  width: 100%;
  height: 90px;
  overflow: hidden;
  background: var(--bg-tertiary, rgba(128,128,128,.07));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* Image: cover-fill the rectangle. */
.folder-view-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
  padding: 6px 8px;
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
`;

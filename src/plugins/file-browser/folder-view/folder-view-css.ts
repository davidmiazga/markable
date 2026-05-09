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
 * Cards are keyboard-reachable (tabindex=0, role=button) for NFR-07.
 */
.folder-view-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 10px 10px;
  border: 1px solid var(--border-color, rgba(128,128,128,.2));
  border-radius: 6px;
  background: var(--bg-secondary, rgba(128,128,128,.04));
  cursor: pointer;
  user-select: none;
  transition: background 0.1s ease, box-shadow 0.1s ease;
  overflow: hidden;
  min-height: 72px;
  justify-content: flex-start;
  text-align: center;
}
.folder-view-card:hover {
  background: var(--hover-bg, rgba(128,128,128,.08));
}
.folder-view-card:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--accent-color);
}

/* .folder-view-card-dir: directory (subfolder) card variant */
.folder-view-card-dir { /* no extra overrides needed in v1 */ }

/* .folder-view-card-file: file card variant */
.folder-view-card-file { /* no extra overrides needed in v1 */ }

/* ── Card icon ────────────────────────────────────────────────────────── */

/*
 * .folder-view-card-icon: icon area at the top of each card.
 * SVG icons fill currentColor so they respect the theme.
 */
.folder-view-card-icon {
  width: 28px;
  height: 28px;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0.8;
}
.folder-view-card-icon svg {
  display: block;
  fill: currentColor;
  width: 100%;
  height: 100%;
}

/* ── Card name ────────────────────────────────────────────────────────── */

/*
 * .folder-view-card-name: the card's primary label text.
 * Truncates with ellipsis when the name is too long for the card.
 */
.folder-view-card-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.3;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

/* ── Card meta (extension badge + date) ────────────────────────────────── */

/* .folder-view-card-meta: secondary info row below the card name. */
.folder-view-card-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  flex-wrap: wrap;
  justify-content: center;
}

/*
 * .folder-view-card-ext: file extension badge (e.g. ".pdf").
 * Styled as a small chip for scanability.
 */
.folder-view-card-ext {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-secondary, rgba(128,128,128,.55));
  background: var(--bg-secondary, rgba(128,128,128,.06));
  border: 1px solid var(--border-color, rgba(128,128,128,.15));
  border-radius: 3px;
  padding: 1px 4px;
}

/* .folder-view-card-date: modified date text. */
.folder-view-card-date {
  font-size: 10px;
  color: var(--text-secondary, rgba(128,128,128,.55));
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
 * _folder.md. Provides a subtle visual affordance (underline on the label).
 * The class is also used for querySelectorAll lookups in tests.
 */
.tree-node-has-folder-view .tree-node-label {
  text-decoration: underline;
  text-decoration-color: var(--accent-color, rgba(92,107,192,.4));
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
`;

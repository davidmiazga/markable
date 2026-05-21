/**
 * bookshelf-css.ts — CSS for the Bookshelf display (Phase 2: `covers` option).
 *
 * Exported as BOOKSHELF_CSS and concatenated into FILE_BROWSER_CSS in
 * file-browser.plugin.ts alongside FOLDER_VIEW_CSS + FOLDER_TABLE_CSS.
 *
 * All colors use CSS custom properties so the bookshelf inherits the active
 * theme. Cover images carry NO color rules — they render at their natural
 * palette regardless of theme.
 *
 * Class namespace:
 *   .fv-bookshelf                       — root container
 *   .fv-bookshelf--{covers|library|compact} — option modifier
 *   .fv-shelf                            — one horizontal shelf
 *   .fv-shelf-heading                    — group label above a shelf
 *   .fv-shelf-row                        — flex row of books
 *   .fv-shelf-rail                       — thin baseline under the row
 *   .fv-book                             — one book item (cover or spine)
 *   .fv-book-cover                       — <img> when YAML cover is present
 *   .fv-book-spine                       — fallback rectangle with title text
 *   .fv-book-title                       — title text on a spine
 *   .fv-book-author                      — secondary author text on a spine
 *   .fv-book-skeleton                    — placeholder shown during YAML enrichment
 *   .fv-bookshelf-loading                — shelf in skeleton state
 */

export const BOOKSHELF_CSS = `

/* ── Bookshelf root ──────────────────────────────────────────────────── */

.fv-bookshelf {
  display: flex;
  flex-direction: column;
  gap: 28px;
  --fv-book-h: 180px;
  --fv-spine-w: 48px;
}

/* ── Shelf primitives (shared across all options) ────────────────────── */

.fv-shelf {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fv-shelf-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e0e0e0);
  letter-spacing: .01em;
  margin-bottom: 2px;
}

.fv-shelf-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
}

.fv-shelf-rail {
  height: 2px;
  background: var(--border-color, rgba(255,255,255,.18));
  margin: 0;
  border-radius: 1px;
  flex-shrink: 0;
}

/* ── Book item ───────────────────────────────────────────────────────── */

.fv-book {
  flex-shrink: 0;
  cursor: pointer;
  outline: none;
  border-radius: 2px;
  transition: transform .12s ease, box-shadow .12s ease;
}
.fv-book:hover { transform: translateY(-1px); }
.fv-book:focus-visible {
  outline: 2px solid var(--accent-color, #4a9eff);
  outline-offset: 2px;
}

.fv-book-cover {
  display: block;
  height: var(--fv-book-h);
  width: auto;
  max-width: 200px;
  object-fit: contain;
  border-radius: 2px;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
}

.fv-book-spine {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: space-between;
  height: var(--fv-book-h);
  width: var(--fv-spine-w);
  padding: 8px 6px;
  background: var(--bg-secondary, #2a2a3a);
  border: 1px solid var(--border-color, rgba(255,255,255,.12));
  border-radius: 2px;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
  box-sizing: border-box;
}

.fv-book-title {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary, #e0e0e0);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: calc(var(--fv-book-h) - 32px);
  align-self: center;
}

.fv-book-author {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 9px;
  color: var(--text-secondary, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: calc(var(--fv-book-h) - 32px);
  align-self: center;
  margin-top: 4px;
}

/* ── Loading skeleton ────────────────────────────────────────────────── */

.fv-bookshelf-loading .fv-book-skeleton {
  height: var(--fv-book-h);
  width: 60px;
  background: linear-gradient(
    90deg,
    var(--bg-secondary, #2a2a3a) 0%,
    rgba(255,255,255,.04) 50%,
    var(--bg-secondary, #2a2a3a) 100%
  );
  background-size: 200% 100%;
  animation: fv-shimmer 1.4s linear infinite;
  border-radius: 2px;
  opacity: .55;
  cursor: default;
}
.fv-bookshelf-loading .fv-book-skeleton:hover { transform: none; }

@keyframes fv-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

`;

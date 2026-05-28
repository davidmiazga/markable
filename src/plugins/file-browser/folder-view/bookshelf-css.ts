/**
 * bookshelf-css.ts — CSS for the Bookshelf display.
 *
 * Exported as BOOKSHELF_CSS and concatenated into FILE_BROWSER_CSS in
 * file-browser.plugin.ts alongside FOLDER_VIEW_CSS + FOLDER_TABLE_CSS.
 *
 * Three modes share most rules; mode-specific overrides live in their own
 * sections below:
 *
 *   .fv-bookshelf--compact — spines only, count-aware 80vh shelves (default).
 *   .fv-bookshelf--library — cover-or-spine per book, count-aware 80vh
 *                            shelves, per-shelf all-covers grid detection.
 *   .fv-bookshelf--covers  — every item is a cover-box; auto-height shelves,
 *                            natural-aspect covers and 2:3 placeholders.
 *
 * Class namespace:
 *   .fv-bookshelf                     — root container
 *   .fv-bookshelf--{compact|library|covers} — mode modifier
 *   .fv-shelf                         — one horizontal shelf
 *   .fv-shelf--all-covers             — library-only per-shelf flag (grid)
 *   .fv-shelf-heading                 — group label above a shelf
 *   .fv-shelf-row                     — flex/grid row of books
 *   .fv-shelf-rail                    — colored shelf rail
 *   .fv-book                          — book wrapper (carries fv-book-color-N
 *                                       and fv-book-pair-N for two-zone spines)
 *   .fv-book-cover                    — <img> when YAML cover is present
 *   .fv-book-pattern                  — top zone of a two-zone spine
 *                                       (solid color in Phase 1; SVG pattern in Phase 2)
 *   .fv-book-label-zone               — bottom zone of a two-zone spine
 *   .fv-book-eyebrow / .fv-book-title /
 *     .fv-book-footer                 — three vertical text runs in label zone
 *   .fv-book-title-len-long           — wrapper class for long titles (wider spine)
 *   .fv-book-placeholder              — cover-box placeholder (no YAML cover)
 *   .fv-book-placeholder-title /
 *     .fv-book-placeholder-author     — horizontal text on a placeholder
 *   .fv-book-skeleton                 — placeholder shown during YAML enrichment
 *   .fv-bookshelf-loading             — shelf in skeleton state
 */

export const BOOKSHELF_CSS = `

/* ── Bookshelf root ──────────────────────────────────────────────────── */

/* The host is the painted-backdrop layer for the rail's mix-blend-mode.
   - overflow: visible so the rail's transform can extend in all directions.
   - isolation: isolate creates a stacking context that contains the rail's
     z-index:-1 cleanly.
   - background: var(--bg-primary) gives that context a painted layer the
     rail can blend against. Visually identical to the editor bg, but
     mathematically the blend now has a concrete target everywhere the
     rail's transform might reach (much wider/taller than .fv-shelf).
   Scoped via :has() so non-bookshelf folder views are unaffected. */
.folder-view-host:has(.fv-bookshelf) {
  overflow: visible;
  isolation: isolate;
  background: var(--bg-primary, #1a1a2e);
}

.fv-bookshelf {
  display: flex;
  flex-direction: column;
  height: 80vh;
  --fv-spine-w: 48px;
}

/* Count-aware shelf sizing (applies to library + compact; covers overrides).
   - 1 shelf  → 80% of container, no gap.
   - 2 shelves → 48% each, 4% gap.
   - 3 shelves → ~31% each, 3% gap.
   - 4+ shelves → same ~31% each, container scrolls for the rest. */
.fv-bookshelf[data-shelf-count="1"]                       { gap: 0;  }
.fv-bookshelf[data-shelf-count="1"] .fv-shelf             { flex: 0 0 80%; }

.fv-bookshelf[data-shelf-count="2"]                       { gap: 4%; }
.fv-bookshelf[data-shelf-count="2"] .fv-shelf             { flex: 0 0 48%; }

.fv-bookshelf[data-shelf-count="3"]                       { gap: 3%; }
.fv-bookshelf[data-shelf-count="3"] .fv-shelf             { flex: 0 0 calc((100% - 6%) / 3); }

.fv-bookshelf[data-shelf-count="4"]                       { gap: 3%; overflow-y: auto; }
.fv-bookshelf[data-shelf-count="4"] .fv-shelf             { flex: 0 0 calc((100% - 6%) / 3); }

/* (Old .fv-shelf--all-covers and .fv-bookshelf--all-covers grid rules
   removed — Library now uses the sibling z-index pattern with mixed
   cover/spine rows. See the .fv-bookshelf--library section below.) */

/* ── Shelf primitives (shared across all modes) ──────────────────────── */

/* .fv-shelf no longer needs isolation/background/overflow — the painted
   backdrop lives on .folder-view-host (wider/taller than any shelf, so
   the rail's transform always lands on it and the blend is uniform).
   What .fv-shelf DOES need:
     - position: relative — anchors the absolutely-positioned rail.
     - padding-bottom — reserves a strip below the books for the rail to
       sit IN (rather than punching up behind the books). Books are inside
       the row which sits above the padding, so books end at
       (shelf_height - padding-bottom), and the rail at bottom: 0 occupies
       the padding strip. */
.fv-shelf {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  box-sizing: border-box;
  padding-bottom: 50px;
}

.fv-shelf-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e0e0e0);
  letter-spacing: .01em;
  margin-bottom: 2px;
  flex: 0 0 auto;
}

.fv-shelf-row {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  gap: 2px;
  align-items: flex-end;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
}

/* Rail is absolutely positioned at the shelf bottom (inside the padding-
   bottom strip we reserved on .fv-shelf above). z-index:-1 puts it behind
   the books and behind the host's painted backdrop; mix-blend-mode: color
   tints whatever's painted at that layer (= host bg). The transform's
   scale grows it past the shelf bounds — fine now because the painted
   backdrop on .folder-view-host extends well past, so the blend stays
   uniform across all the rail's visible pixels. */
.fv-shelf-rail {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 50px;
  background: var(--bright-1, aqua);
  margin: 0;
  border-radius: 5px;
  transform: scale(1.1, 1.5);
  z-index: -1;
  /* Theme-aware: --fv-rail-blend is 'multiply' in light mode (darkens the
     rail against the light bg) and 'color' in dark mode (preserves the hue
     against dark bg). See src/styles.css :root + [data-theme=dark]. */
  mix-blend-mode: var(--fv-rail-blend, color);
  pointer-events: none;
}

/* Rotate shelf rails through the 8-color bright palette. */
.fv-shelf:nth-of-type(8n+1) .fv-shelf-rail { background: var(--bright-1, orange); }
.fv-shelf:nth-of-type(8n+2) .fv-shelf-rail { background: var(--bright-2, hotpink); }
.fv-shelf:nth-of-type(8n+3) .fv-shelf-rail { background: var(--bright-3, gold); }
.fv-shelf:nth-of-type(8n+4) .fv-shelf-rail { background: var(--bright-4, lime); }
.fv-shelf:nth-of-type(8n+5) .fv-shelf-rail { background: var(--bright-5, cyan); }
.fv-shelf:nth-of-type(8n+6) .fv-shelf-rail { background: var(--bright-6, crimson); }
.fv-shelf:nth-of-type(8n+7) .fv-shelf-rail { background: var(--bright-7, royalblue); }
.fv-shelf:nth-of-type(8n)   .fv-shelf-rail { background: var(--bright-8, #f4ead0); }

/* ── Book item wrapper ───────────────────────────────────────────────── */

.fv-book {
  flex-shrink: 0;
  cursor: pointer;
  outline: none;
  border-radius: 2px;
  height: 100%;
  display: flex;
  align-items: flex-end;
  transition: transform .12s ease, box-shadow .12s ease;
}
.fv-book:hover { transform: translateY(-1px); }
.fv-book:focus-visible {
  outline: 2px solid var(--accent-color, #4a9eff);
  outline-offset: 2px;
}

/* ── Cover image ─────────────────────────────────────────────────────── */

.fv-book-cover {
  display: block;
  height: 100%;
  width: auto;
  object-fit: contain;
  border-radius: 2px;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
}

/* '.fv-book-spine', generic '.fv-book-author', and generic '.fv-book-title'
   rules were retired with the two-zone redesign. The active title/eyebrow/
   footer styling lives under the ':is(.fv-bookshelf--compact,
   .fv-bookshelf--library) ...' rules near the bottom of this file. */

/* ── Placeholder cover-box (covers mode, no YAML cover) ──────────────── */

/* Plain 2:3 colored rectangle. No text content — the title/author surface
   via the wrapper's title= tooltip + aria-label. The bright color comes
   from the .fv-book.fv-book-color-N parent via the descendant selector
   below. */
.fv-book-placeholder {
  display: block;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
}

/* ── Per-book bright-palette colors ────────────────────────────────────
   The color slot lives on the .fv-book wrapper. Vars cascade down: spines
   and placeholders read them via the descendant rule below; compact's
   .fv-book reads them on itself (the book IS the colored block in compact —
   no inner spine element). Hash-derived slot 1..8 from colorSlotFor(). */
.fv-book.fv-book-color-1 { --fv-book-bg: var(--bright-1, orange);     --fv-book-fg: var(--bright-1-fg, #fff);    --fv-book-fg-secondary: var(--bright-1-fg, #fff);    }
.fv-book.fv-book-color-2 { --fv-book-bg: var(--bright-2, hotpink);    --fv-book-fg: var(--bright-2-fg, #fff);    --fv-book-fg-secondary: var(--bright-2-fg, #fff);    }
.fv-book.fv-book-color-3 { --fv-book-bg: var(--bright-3, gold);       --fv-book-fg: var(--bright-3-fg, #1a1a1a); --fv-book-fg-secondary: var(--bright-3-fg, #1a1a1a); }
.fv-book.fv-book-color-4 { --fv-book-bg: var(--bright-4, lime);       --fv-book-fg: var(--bright-4-fg, #1a1a1a); --fv-book-fg-secondary: var(--bright-4-fg, #1a1a1a); }
.fv-book.fv-book-color-5 { --fv-book-bg: var(--bright-5, cyan);       --fv-book-fg: var(--bright-5-fg, #1a1a1a); --fv-book-fg-secondary: var(--bright-5-fg, #1a1a1a); }
.fv-book.fv-book-color-6 { --fv-book-bg: var(--bright-6, crimson);    --fv-book-fg: var(--bright-6-fg, #fff);    --fv-book-fg-secondary: var(--bright-6-fg, #fff);    }
.fv-book.fv-book-color-7 { --fv-book-bg: var(--bright-7, royalblue);  --fv-book-fg: var(--bright-7-fg, #fff);    --fv-book-fg-secondary: var(--bright-7-fg, #fff);    }
.fv-book.fv-book-color-8 { --fv-book-bg: var(--bright-8, #f4ead0);    --fv-book-fg: var(--bright-8-fg, #1a1a1a); --fv-book-fg-secondary: var(--bright-8-fg, #1a1a1a); }

/* Library + Covers: spines/placeholders pick up the inherited --fv-book-bg. */
.fv-book .fv-book-spine,
.fv-book .fv-book-placeholder {
  background: var(--fv-book-bg);
  border-color: transparent;
}

/* ── Loading skeleton ────────────────────────────────────────────────── */

.fv-bookshelf-loading .fv-book-skeleton {
  height: 100%;
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

/* ── Compact mode ─────────────────────────────────────────────────────────
   Sibling z-index pattern from blendMode-test1.0.html. The rail (z-index: 1)
   and the books row (z-index: 10) are siblings inside .fv-shelf; the rail's
   mix-blend-mode: color blends against the painted backdrop on the host.
   No negative z-index, no transform on the rail, no isolation gymnastics
   needed beyond what the host already provides for library/covers. */

/* .fv-shelf in compact doesn't need the padding-bottom strip — the rail is
   a positive-z-index sibling that books layer on top of, not a below-books
   element that needs reserved space. */
.fv-bookshelf--compact .fv-shelf {
  padding-bottom: 0;
}

/* Row sits ABOVE the rail. Inset slightly from the shelf bounds (per test)
   so the rail is visible past the books on left/right and at the bottom. */
.fv-bookshelf--compact .fv-shelf-row {
  z-index: 10;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: flex-start;
  gap: 2px;
  padding: 0 25px 5% 25px;
  overflow-x: auto;
}

/* Rail uses positive z-index (1) and no transform — the test pattern. The
   rail visually fills the bottom region of the shelf; books at z-index 10
   paint on top where they overlap. mix-blend-mode: color tints whatever's
   painted up the ancestor chain (host bg in this app). */
.fv-bookshelf--compact .fv-shelf-rail {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 200px;
  background: var(--bright-1, orange);
  border-radius: 12px;
  z-index: 1;
  transform: none;
  /* Theme-aware: --fv-rail-blend is 'multiply' in light mode (darkens the
     rail against the light bg) and 'color' in dark mode (preserves the hue
     against dark bg). See src/styles.css :root + [data-theme=dark]. */
  mix-blend-mode: var(--fv-rail-blend, color);
  pointer-events: none;
}

/* Per-shelf rail color rotation is already defined globally via
   .fv-shelf:nth-of-type(8n+N) — those rules apply unchanged in compact. */

/* ── Spine layout for Compact + Library no-cover fallback ────────────────
   Two render paths share these wrappers:
     (a) Short titles use the CLASSIC single-color spine — small author at
         top, bold rotated title in the middle, .fv-book-rule + optional
         date at the bottom. Width cycles via .fv-book-rule :nth-child.
     (b) Long titles (.fv-book-title-len-long) use the TWO-ZONE enriched
         spine — pattern zone (top) + label zone (bottom) with eyebrow /
         title / footer.
   Both share the same .fv-book.fv-book-pair-N class on the wrapper, which
   defines --fv-book-bg-top / --fv-book-bg-bottom / --fv-book-fg. The
   classic spine reads --fv-book-bg-bottom as its single background. */

/* Wrapper — shared shell for both layouts. */
:is(.fv-bookshelf--compact, .fv-bookshelf--library) .fv-book {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  height: 100%;
  width: auto;
  writing-mode: vertical-rl;
  cursor: pointer;
  outline: none;
  color: var(--fv-book-fg);
}
:is(.fv-bookshelf--compact, .fv-bookshelf--library) .fv-book:hover {
  transform: translateY(-1px);
}
:is(.fv-bookshelf--compact, .fv-bookshelf--library) .fv-book:focus-visible {
  outline: 2px solid var(--accent-color, #4a9eff);
  outline-offset: 2px;
}

/* ── (a) CLASSIC spine — short titles (default) ──────────────────────────
   Single-color block. The .fv-book-rule's :nth-child(5n) width cycle gives
   the shelf organic visual variety. Author and date children always render
   (empty when YAML keys absent) so flex space-between keeps the title
   centered consistently. */
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long) {
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  text-align: center;
  font-size: 12px;
  background: var(--fv-book-bg-bottom);
  border-radius: 1px;
}

/* Classic-spine typography. Title is the main element; author + date are
   subordinate visual anchors. */
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long) .fv-book-author,
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long) .fv-book-title,
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long) .fv-book-date {
  line-height: .7;
}
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long) .fv-book-title {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 14px;
  font-weight: bold;
  color: var(--fv-book-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: calc(100% - 16px);
  align-self: center;
}
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long) .fv-book-author {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 12px;
  color: var(--fv-book-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: calc(100% - 16px);
  align-self: center;
}
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long) .fv-book-date {
  display: grid;
  grid-template-columns: .1fr 1fr;
  justify-content: center;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-style: italic;
  color: var(--fv-book-fg);
  opacity: .85;
}

/* Double-rule decoration above the date. Width cycles via .fv-book
   :nth-child(5n+N) to give the shelf visual variety in spine widths —
   the rule is wider on some books, narrower on others. */
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long) .fv-book-rule {
  display: block;
  width: 20px;
  padding: 2px 0;
  margin: 4px 0;
  border: solid 2px var(--fv-book-fg);
  border-left: none;
  border-right: none;
}
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long):nth-child(5n+1) .fv-book-rule { width: 15px; }
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long):nth-child(5n+2) .fv-book-rule { width: 25px; }
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long):nth-child(5n+3) .fv-book-rule { width: 44px; }
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long):nth-child(5n+4) .fv-book-rule { width: 58px; }
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book:not(.fv-book-title-len-long):nth-child(5n)   .fv-book-rule { width: 61px; }

/* ── (b) TWO-ZONE enriched spine — long titles only ──────────────────────
   When the renderer tags .fv-book with .fv-book-title-len-long (>=4 words
   OR >=25 chars in the title), the layout switches to the two-zone form:
   pattern zone (top, hosts SVG patterns) + label zone (bottom, with
   eyebrow / title / footer).

   Each book carries an inline --fv-book-min-width (75-105px, hash-derived
   in longTitleWidthFor) so the shelf reads as a deliberate variety of wide
   spines rather than one fixed enriched width. The fallback (88px) is what
   wins for any code path that fails to set the inline var. All values are
   wider than the widest classic spine (61px from
   .fv-book-rule:nth-child(5n)). */
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book.fv-book-title-len-long {
  align-items: stretch;
  padding: 0;
  border-radius: 2px;
  overflow: hidden;       /* clip zone backgrounds to the rounded corners */
  min-width: var(--fv-book-min-width, 88px);
}

/* Label zone is the single container for long-title spines — it carries
   the pair's bottom color and holds the pattern (top 38%) + text area
   (bottom 62%). flex-direction: row looks horizontal at a glance, but
   in vertical-rl writing mode the row axis runs top-to-bottom on
   screen, so the two children stack vertically as desired. No padding —
   the children own their internal padding. */
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book.fv-book-title-len-long .fv-book-label-zone {
  flex: 1 1 auto;
  background: var(--fv-book-bg-bottom);
  display: flex;
  flex-direction: row;
  align-items: stretch;
  padding: 0;
  min-width: 14px;
}

/* Pattern cap: top 38% of the label zone. The SVG is applied as a
   mask-image (not background-image) — its currentColor-filled shapes
   become an alpha silhouette, and the element's background-color
   (set to the pair's top color) provides the visible shape color.
   The pair's top + bottom are curated to contrast nicely. mask-size
   cover stretches a single mask instance to fill the cap. The
   --fv-pattern-url variable is set inline per book by the renderer. */
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book.fv-book-title-len-long .fv-book-pattern {
  flex: 0 0 38%;
  min-width: 16px;
  background-color: var(--fv-book-bg-top);
  mask-image: var(--fv-pattern-url);
  mask-size: cover;
  mask-position: center;
  mask-repeat: no-repeat;
  -webkit-mask-image: var(--fv-pattern-url);
  -webkit-mask-size: cover;
  -webkit-mask-position: center;
  -webkit-mask-repeat: no-repeat;
  overflow: hidden;
}

/* Text area: bottom 62% of the label zone. Holds the three text runs
   and centers the title vertically in its space. flex-direction: row
   means main axis runs top-to-bottom (in vertical-rl), so the items
   stack on screen and justify-content centers the title between any
   optional eyebrow and footer. */
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book.fv-book-title-len-long .fv-book-text-area {
  flex: 0 0 62%;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 6px;
  min-width: 14px;
}

/* Eyebrow / title / footer typography for the two-zone variant. */
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book.fv-book-title-len-long .fv-book-eyebrow {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  opacity: .85;
  color: var(--fv-book-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: calc(40% - 4px);
  align-self: center;
  line-height: 1;
}
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book.fv-book-title-len-long .fv-book-title {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 14px;
  font-weight: 800;
  color: var(--fv-book-fg);
  /* Multi-column wrap fills the label zone of the wider 88px spine. The
     book has min-width: 88px → label zone gets ~60px → title max-width 48px
     plus 6px*2 horizontal padding fits without clipping. */
  white-space: normal;
  line-height: 1.05;
  max-width: 48px;
  max-height: calc(100% - 16px);
  align-self: center;
}
:is(.fv-bookshelf--compact, .fv-bookshelf--library)
  .fv-book.fv-book-title-len-long .fv-book-footer {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 7px;
  font-style: italic;
  opacity: .75;
  color: var(--fv-book-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: calc(40% - 4px);
  align-self: center;
  line-height: 1;
}

/* ── Pair classes: 8 curated top/bottom color combinations ──────────────
   Each class wires the two zone backgrounds and the foreground color used
   by all three text runs. Tokens defined in src/styles.css :root + dark.
   Classic spines read --fv-book-bg-bottom as their single background;
   two-zone spines use both. */
.fv-book.fv-book-pair-1 { --fv-book-bg-top: var(--pair-1-top); --fv-book-bg-bottom: var(--pair-1-bottom); --fv-book-fg: var(--pair-1-fg); }
.fv-book.fv-book-pair-2 { --fv-book-bg-top: var(--pair-2-top); --fv-book-bg-bottom: var(--pair-2-bottom); --fv-book-fg: var(--pair-2-fg); }
.fv-book.fv-book-pair-3 { --fv-book-bg-top: var(--pair-3-top); --fv-book-bg-bottom: var(--pair-3-bottom); --fv-book-fg: var(--pair-3-fg); }
.fv-book.fv-book-pair-4 { --fv-book-bg-top: var(--pair-4-top); --fv-book-bg-bottom: var(--pair-4-bottom); --fv-book-fg: var(--pair-4-fg); }
.fv-book.fv-book-pair-5 { --fv-book-bg-top: var(--pair-5-top); --fv-book-bg-bottom: var(--pair-5-bottom); --fv-book-fg: var(--pair-5-fg); }
.fv-book.fv-book-pair-6 { --fv-book-bg-top: var(--pair-6-top); --fv-book-bg-bottom: var(--pair-6-bottom); --fv-book-fg: var(--pair-6-fg); }
.fv-book.fv-book-pair-7 { --fv-book-bg-top: var(--pair-7-top); --fv-book-bg-bottom: var(--pair-7-bottom); --fv-book-fg: var(--pair-7-fg); }
.fv-book.fv-book-pair-8 { --fv-book-bg-top: var(--pair-8-top); --fv-book-bg-bottom: var(--pair-8-bottom); --fv-book-fg: var(--pair-8-fg); }

/* ── Covers mode ──────────────────────────────────────────────────────────
   Same sibling-z-index pattern as Compact, but the books are smaller fixed-
   height rectangles (real cover proportions) so 3–4 fit per shelf row,
   matching inspo-BookshelfView-4. Covers are img elements at natural aspect;
   missing covers fall back to a plain 2:3 colored placeholder. */

/* Bookshelf in covers mode is content-sized (one row of small books per
   shelf doesn't need 80vh). max-height + overflow-y bound the total. */
.fv-bookshelf.fv-bookshelf--covers {
  height: auto;
  max-height: 80vh;
  overflow-y: auto;
  gap: 24px;
}
.fv-bookshelf--covers .fv-shelf {
  padding-bottom: 0;
  flex: 0 0 auto;
}

/* Row of covers — sibling layering like Compact: row at z-index: 10 above
   the rail at z-index: 1. Padding matches the test/Compact treatment so
   the rail's bottom and side lip stays visible past the books.
   flex: 0 0 auto override is critical: the base rule has flex: 1 1 0 to
   fill flex-allocated space, but in covers mode the shelf is content-sized
   (flex: 0 0 auto) so the row's "grow into available space" tries to grow
   into 0 → row collapses → books clipped by overflow. Must override. */
.fv-bookshelf--covers .fv-shelf-row {
  flex: 0 0 auto;
  z-index: 10;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: flex-start;
  gap: 16px;
  padding: 0 25px 5% 25px;
  /* No flex-wrap — books shrink to fit via flex: 1 1 0 + max-width on the
     books themselves. Chunking into 4 per shelf (renderer side) means each
     row holds a known maximum count and clamps to a sensible book size. */
  overflow-x: visible;
}

.fv-bookshelf--covers .fv-shelf-rail {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 80px;
  background: var(--bright-1, orange);
  border-radius: 8px;
  z-index: 1;
  transform: none;
  /* Theme-aware: --fv-rail-blend is 'multiply' in light mode (darkens the
     rail against the light bg) and 'color' in dark mode (preserves the hue
     against dark bg). See src/styles.css :root + [data-theme=dark]. */
  mix-blend-mode: var(--fv-rail-blend, color);
  pointer-events: none;
}

/* Books scale to share the row width equally via flex: 1 1 0.
   - aspect-ratio: 2 / 3 makes the height follow the flex-distributed width
     (height = width × 1.5) so all books on a shelf bottom-align at the same
     baseline regardless of how many books or how wide the shelf is.
   - min-width keeps small viewports from squashing books to unreadable.
   - max-width caps single-book or sparse shelves so one book doesn't blow
     up to fill the whole row.
   Together: 4 books on a typical 700–900px shelf land at ~150–215px wide
   (225–322px tall via aspect-ratio), no wrap, no scroll. */
.fv-bookshelf--covers .fv-book {
  flex: 1 1 0;
  min-width: 100px;
  max-width: 220px;
  box-sizing: border-box;
  aspect-ratio: 2 / 3;
  height: auto;
  border-radius: 1px;
  cursor: pointer;
  outline: none;
}
.fv-bookshelf--covers .fv-book:hover { transform: translateY(-1px); }
.fv-bookshelf--covers .fv-book:focus-visible {
  outline: 2px solid var(--accent-color, #4a9eff);
  outline-offset: 2px;
}

/* Cover img fills the 2:3 wrapper. object-fit: contain preserves the
   cover's natural aspect — non-2:3 covers letterbox within the box rather
   than crop. */
.fv-bookshelf--covers .fv-book-cover {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 2px;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
}

/* Placeholder fills the wrapper (which already enforces 2:3 aspect).
   Centered title via flex centering. Cover images themselves never get a
   title overlay — the user-supplied art already contains it. */
.fv-bookshelf--covers .fv-book-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 16px 14px;
  box-sizing: border-box;
  background: var(--fv-book-bg);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
  text-align: center;
}

.fv-bookshelf--covers .fv-book-placeholder-title {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--fv-book-fg);
  word-break: break-word;
  hyphens: auto;
  /* Cap at ~5 lines so very long titles don't overflow the 2:3 box. */
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── Library mode ─────────────────────────────────────────────────────────
   Combo of Compact (rich-spine for items without cover) and Covers (cover
   image for items with cover) on the SAME shelf. Same sibling-z-index rail
   pattern (rail z:1, row z:10). Covers and spines coexist by sharing a
   --library-book-h CSS variable as their height; widths are content-driven
   so covers come out wider than spines, all bottom-aligned on the rail.
   Renderer width-chunks each group; new shelf when items would overflow. */

/* Bookshelf in library mode is content-sized — shelves stack to whatever
   height each row of mixed books needs. */
.fv-bookshelf.fv-bookshelf--library {
  height: auto;
  max-height: 80vh;
  overflow-y: auto;
  gap: 24px;
  /* Shared book height used by both covers and rich-spines on a library
     shelf. clamp() keeps it sensible across viewport sizes. */
  --library-book-h: clamp(220px, 30vh, 300px);
}
.fv-bookshelf--library .fv-shelf {
  padding-bottom: 0;
  flex: 0 0 auto;
}

/* Row layout: sibling layering, books bottom-align on the rail.
   flex: 0 0 auto override MUST stay — the base flex: 1 1 0 would collapse
   this row to 0 height inside a content-sized shelf (the row-collapse bug
   we hit twice during Covers). */
.fv-bookshelf--library .fv-shelf-row {
  flex: 0 0 auto;  /* override base flex: 1 1 0 — must keep */
  z-index: 10;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: flex-start;
  gap: 16px;
  padding: 0 25px 5% 25px;
  overflow-x: visible;
}

/* Rail: positive z-index sibling beneath books. No transform, no negative
   z-index — mix-blend-mode reaches the host's painted backdrop directly. */
.fv-bookshelf--library .fv-shelf-rail {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 80px;
  background: var(--bright-1, orange);
  border-radius: 8px;
  z-index: 1;
  transform: none;
  /* Theme-aware: --fv-rail-blend is 'multiply' in light mode (darkens the
     rail against the light bg) and 'color' in dark mode (preserves the hue
     against dark bg). See src/styles.css :root + [data-theme=dark]. */
  mix-blend-mode: var(--fv-rail-blend, color);
  pointer-events: none;
}

/* All library books share the same height. Width is content-driven:
   cover img books come out ~187px wide (2:3 at 280 tall); rich-spine books
   come out ~45px wide (rule width). */
.fv-bookshelf--library .fv-book {
  flex: 0 0 auto;
  box-sizing: border-box;
  height: var(--library-book-h);
  width: auto;
  border-radius: 1px;
  cursor: pointer;
  outline: none;
}
.fv-bookshelf--library .fv-book:hover { transform: translateY(-1px); }
.fv-bookshelf--library .fv-book:focus-visible {
  outline: 2px solid var(--accent-color, #4a9eff);
  outline-offset: 2px;
}

/* Cover image: fills the wrapper height; width follows natural aspect
   ratio. object-fit: contain prevents non-2:3 covers from cropping. */
.fv-bookshelf--library .fv-book-cover {
  display: block;
  height: 100%;
  width: auto;
  object-fit: contain;
  border-radius: 2px;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
}

/* Library rich-spine books inherit the Compact spine styling. Apply the
   layout/typography by extending Compact's selectors below this section
   via union :is() — see the .fv-book-author/.fv-book-title/.fv-book-date
   shared rules in Compact's section above. We do need the .fv-book wrapper
   itself to be a flex container with vertical-rl + padding when it's a
   rich-spine book (i.e., when it contains .fv-book-title rather than an
   img.fv-book-cover). :has() lets us discriminate without a renderer-side
   class. */
.fv-bookshelf--library .fv-book:has(.fv-book-title) {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  width: auto;
  background: var(--fv-book-bg);
  writing-mode: vertical-rl;
  text-align: center;
  padding: 6px 0;
  font-size: 12px;
  color: var(--fv-book-fg);
}

/* ── Book Stack mode ─────────────────────────────────────────────────────
   Vertical scrolling list of horizontal book bars — the vertical-flip
   sibling of Compact. Short bars cycle through 5 heights via :nth-child
   (mirrors Compact's .fv-book-rule width cycle); long bars (≥4 words OR
   ≥25 chars in the title) get a hash-derived height and the two-zone
   pattern layout (pattern strip on the LEFT 38%, text area on the right
   62%). Both variants override writing-mode: vertical-rl to read text
   horizontally. */

.fv-bookshelf--book-stack {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: auto;
  max-height: 80vh;
  overflow-y: auto;
}

.fv-bookshelf--book-stack .fv-stack-heading {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .01em;
  color: var(--text-primary);
  padding: 12px 8px 6px;
}

.fv-bookshelf--book-stack .fv-stack-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Base bar shell — applies to BOTH short and long variants. */
.fv-bookshelf--book-stack .fv-book {
  writing-mode: horizontal-tb;
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  background: var(--fv-book-bg-bottom);
  color: var(--fv-book-fg);
  border-radius: 2px;
  cursor: pointer;
  outline: none;
  transition: filter .12s ease;
  box-sizing: border-box;
  overflow: hidden;
  gap: 12px;
}
.fv-bookshelf--book-stack .fv-book:hover {
  filter: brightness(1.06);
  transform: none;
}
.fv-bookshelf--book-stack .fv-book:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}

/* SHORT bars: padding on the bar itself; height cycles via :nth-child. */
.fv-bookshelf--book-stack .fv-book:not(.fv-book-title-len-long) {
  padding: 10px 16px;
  min-height: 44px;
}
.fv-bookshelf--book-stack .fv-stack-list > .fv-book:not(.fv-book-title-len-long):nth-child(5n+1) { min-height: 36px; }
.fv-bookshelf--book-stack .fv-stack-list > .fv-book:not(.fv-book-title-len-long):nth-child(5n+2) { min-height: 44px; }
.fv-bookshelf--book-stack .fv-stack-list > .fv-book:not(.fv-book-title-len-long):nth-child(5n+3) { min-height: 52px; }
.fv-bookshelf--book-stack .fv-stack-list > .fv-book:not(.fv-book-title-len-long):nth-child(5n+4) { min-height: 60px; }
.fv-bookshelf--book-stack .fv-stack-list > .fv-book:not(.fv-book-title-len-long):nth-child(5n)   { min-height: 68px; }

/* LONG bars: hash-derived min-height + two-zone layout. No padding on
   the .fv-book itself — the inner zones own their own padding so the
   pattern strip butts cleanly to the left edge. */
.fv-bookshelf--book-stack .fv-book.fv-book-title-len-long {
  min-height: var(--fv-book-min-height, 96px);
  padding: 0;
  gap: 0;
}

/* Label zone is the single container for the long bar. flex-direction:
   row-reverse puts the pattern visually on the RIGHT while keeping the
   pattern as the first DOM child (which Compact relies on for its own
   layout — same populateTwoZoneContent builder used).

   align-self: stretch overrides the parent .fv-book's align-items: center
   so the label-zone (and the pattern strip inside it) fills the bar's
   FULL height rather than collapsing to content height with empty bands
   above and below. */
.fv-bookshelf--book-stack .fv-book.fv-book-title-len-long .fv-book-label-zone {
  display: flex;
  flex-direction: row-reverse;
  width: 100%;
  height: auto;
  background: var(--fv-book-bg-bottom);
  align-items: stretch;
  align-self: stretch;
  flex: 1 1 auto;
}

/* Pattern: right ~38% strip. Fills 100% of ITS container via mask-size:
   cover (same mechanism Covers uses for cover images filling their cells).
   Same mask-image trick as Compact — currentColor SVG silhouette over
   background-color = pair top. */
.fv-bookshelf--book-stack .fv-book.fv-book-title-len-long .fv-book-pattern {
  flex: 0 0 38%;
  min-width: 16px;
  background-color: var(--fv-book-bg-top);
  mask-image: var(--fv-pattern-url);
  mask-size: cover;
  mask-position: center;
  mask-repeat: no-repeat;
  -webkit-mask-image: var(--fv-pattern-url);
  -webkit-mask-size: cover;
  -webkit-mask-position: center;
  -webkit-mask-repeat: no-repeat;
  overflow: hidden;
}

/* Text area: left ~62% zone. Column layout so the title centers vertically
   regardless of whether the optional eyebrow + footer are present. */
.fv-bookshelf--book-stack .fv-book.fv-book-title-len-long .fv-book-text-area {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 10px 16px;
  gap: 4px;
  overflow: hidden;
  writing-mode: horizontal-tb;
  min-width: 0;
}

/* Text element styling — same selectors target both short (direct child
   of .fv-book) and long (child of .fv-book-text-area) variants. */
.fv-bookshelf--book-stack .fv-book-eyebrow {
  writing-mode: horizontal-tb;
  transform: none;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  opacity: .80;
  flex: 0 0 auto;
  min-width: 70px;
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fv-book-fg);
  align-self: center;
  max-height: none;
}

.fv-bookshelf--book-stack .fv-book-title {
  writing-mode: horizontal-tb;
  transform: none;
  flex: 1 1 auto;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--fv-book-fg);
  overflow: hidden;
  align-self: center;
  max-width: none;
  max-height: none;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Long-bar title overrides for the column-layout text-area: full width,
   left-aligned, 2-line clamp, stretches to fill the zone. */
.fv-bookshelf--book-stack .fv-book.fv-book-title-len-long .fv-book-title {
  align-self: stretch;
  width: 100%;
  text-align: left;
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  flex: 0 0 auto;
}

/* Long-bar eyebrow/footer overrides for the column-layout text-area:
   no min-width (they shouldn't pin the column wider), left-aligned. */
.fv-bookshelf--book-stack .fv-book.fv-book-title-len-long .fv-book-eyebrow,
.fv-bookshelf--book-stack .fv-book.fv-book-title-len-long .fv-book-footer {
  align-self: stretch;
  min-width: 0;
  max-width: 100%;
  text-align: left;
}

.fv-bookshelf--book-stack .fv-book-footer {
  writing-mode: horizontal-tb;
  transform: none;
  flex: 0 0 auto;
  font-size: 10px;
  font-style: normal;
  opacity: .75;
  white-space: nowrap;
  text-align: right;
  color: var(--fv-book-fg);
  align-self: center;
  max-height: none;
}

`;

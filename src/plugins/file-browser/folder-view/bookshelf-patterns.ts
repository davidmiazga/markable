/**
 * bookshelf-patterns.ts — SVG patterns for the .fv-book-pattern top zone
 * (long-title two-zone spines).
 *
 * The seven SVG files in `./pattern-assets/` are the **single source of
 * truth** for the build. They live inside `src/` because they're runtime
 * assets — the patterns module URL-encodes each one into a `mask-image`
 * data URI at module load time. `docs/bookshelf-patterns/` mirrors these
 * files for visual browsing only; it can be deleted without breaking the
 * build, and `npm run sync:patterns` refreshes the mirror from canonical.
 * Each file is 180×180 px and was drawn by hand to match the seven course
 * spines in `BookshelfViewStack-Vert-8.jpg`.
 *
 * Runtime processing per slot:
 *   1. Pull the inner body (between `<svg>` and `</svg>`).
 *   2. Wrap the shapes in a single `<g fill="#000" fill-opacity="0.22">`
 *      so they render as a subtle dark overlay regardless of whether the
 *      individual shapes specify `fill`. This is what gives every pattern
 *      the same "translucent black on the pair's top color" look.
 *   3. Re-wrap in a fresh `<svg>` element with the original viewBox.
 *   4. URL-encode the whole SVG (including paren escaping — `(` and `)`
 *      otherwise break happy-dom's CSS parser inside `url("...")` per the
 *      gotcha documented below).
 *   5. Cache as `url("data:image/svg+xml;utf8,...")`.
 *
 * Caveat — data-URI SVGs are sandboxed from the host CSS, so `currentColor`
 * and CSS variables can't reach inside them. Phase 1 uses a fixed
 * translucent black (`fill-opacity="0.22"`) that reads as a subtle
 * darkening over every pair-top color. A future iteration could swap to
 * `mask-image` for per-pair color coordination — same DOM shape, different
 * CSS layer.
 *
 * Tile size in production: see `background-size` on `.fv-book-pattern`
 * (long-title variant) in `bookshelf-css.ts`. Adjusting that one value
 * scales every pattern uniformly.
 *
 * ── Pattern roster (source: BookshelfViewStack-Vert-8.jpg) ────────────
 *
 *   slot 1  Course 1  plus grid (connected nodes)
 *   slot 2  Course 2  interlocking arcs
 *   slot 3  Course 3  chevron stripes
 *   slot 4  Course 4  snowflakes
 *   slot 5  Course 5  nested octagons
 *   slot 6  Course 6  pillars
 *   slot 7  Course 7  blob ovals
 *
 * `patternSlotFor(card)` in `bookshelf-renderer.ts` picks a slot per book.
 */

import slot1Raw from "./pattern-assets/slot-1-plus-grid.svg?raw";
import slot2Raw from "./pattern-assets/slot-2-arcs.svg?raw";
import slot3Raw from "./pattern-assets/slot-3-chevrons.svg?raw";
import slot4Raw from "./pattern-assets/slot-4-snowflakes.svg?raw";
import slot5Raw from "./pattern-assets/slot-5-octagons.svg?raw";
import slot6Raw from "./pattern-assets/slot-6-pillars.svg?raw";
import slot7Raw from "./pattern-assets/slot-7-ovals.svg?raw";

/**
 * Build a `url("data:image/svg+xml,...")` value from a raw SVG file.
 *
 * The source SVG's inner body is extracted (anything between `<svg ...>`
 * and `</svg>`) and re-wrapped in a fresh `<svg>` with the same viewBox.
 * Wrapping `<g fill="currentColor">` makes every shape opaque-fill — used
 * as a `mask-image` in CSS, this gives a clean alpha silhouette regardless
 * of whether the source SVG shapes specified their own fill. The visible
 * COLOR of the shapes comes from the host element's `background-color`
 * (set per book in `bookshelf-css.ts`), not from this fill.
 *
 * Parens are explicitly percent-encoded because `encodeURIComponent`
 * leaves them as-is (they're "unreserved" per RFC 3986) but CSS parsers
 * — happy-dom in particular — reject `url("...(...)...")` even when the
 * parens are inside the quoted string. Without this, SVGs that use
 * `transform="rotate(...)"` or any other CSS-function-shaped attribute
 * silently fail to set as background-image.
 */
function buildPatternUri(svgText: string): string {
  const viewBoxMatch = svgText.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : "0 0 180 180";

  const bodyMatch = svgText.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if (!bodyMatch) return "";
  // Strip Illustrator-style generator comments — they're noise in the
  // bundle and slow the URL encoder.
  const body = bodyMatch[1].replace(/<!--[\s\S]*?-->/g, "").trim();

  const wrapped =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '">' +
    '<g fill="currentColor">' + body + '</g>' +
    '</svg>';

  const encoded = encodeURIComponent(wrapped)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");

  return `url("data:image/svg+xml;utf8,${encoded}")`;
}

const PATTERNS = [
  buildPatternUri(slot1Raw),
  buildPatternUri(slot2Raw),
  buildPatternUri(slot3Raw),
  buildPatternUri(slot4Raw),
  buildPatternUri(slot5Raw),
  buildPatternUri(slot6Raw),
  buildPatternUri(slot7Raw),
];

/**
 * Return a CSS `url(...)` value usable directly as a `background-image`
 * value. `slot` is 1-indexed (1..7); out-of-range values fall back to
 * slot 1 (plus grid). The renderer's `patternSlotFor(card)` decides
 * which slot a given book uses.
 */
export function bookshelfPatternUrl(slot?: number): string {
  const idx = slot && slot >= 1 && slot <= PATTERNS.length ? slot - 1 : 0;
  return PATTERNS[idx];
}

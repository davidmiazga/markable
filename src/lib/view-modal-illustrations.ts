/**
 * view-modal-illustrations.ts — six static SVG illustrations, one per
 * layout tab of the Unified View Modal.
 *
 * Each illustration is a schematic line drawing that uses `currentColor`
 * for strokes and fills so theme tokens re-skin them automatically
 * (NFR-5 / EC-15). Bundled inline so tab switching is synchronous and
 * never reads from disk (NFR-6 / EC-18).
 *
 * Dimensions: 400×280 to match the existing template-picker SVGs the
 * Lead Developer deletes in step_08 — visual continuity for users
 * crossing over during the rollout.
 *
 * @module view-modal-illustrations
 */

/**
 * Cards layout — three card outlines in a horizontal row. Each card
 * carries a placeholder preview region (filled at 40% opacity) and a
 * title line below.
 */
const CARDS_SVG = `<svg viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg" aria-label="Cards layout">
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="40"  y="80" width="100" height="120" rx="6" />
    <rect x="150" y="80" width="100" height="120" rx="6" />
    <rect x="260" y="80" width="100" height="120" rx="6" />
  </g>
  <g fill="currentColor" opacity="0.35">
    <rect x="50"  y="90" width="80" height="60" rx="3" />
    <rect x="160" y="90" width="80" height="60" rx="3" />
    <rect x="270" y="90" width="80" height="60" rx="3" />
  </g>
  <g stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="50"  y1="165" x2="120" y2="165" />
    <line x1="160" y1="165" x2="230" y2="165" />
    <line x1="270" y1="165" x2="340" y2="165" />
    <line x1="50"  y1="180" x2="100" y2="180" opacity="0.5" />
    <line x1="160" y1="180" x2="210" y2="180" opacity="0.5" />
    <line x1="270" y1="180" x2="320" y2="180" opacity="0.5" />
  </g>
</svg>`;

/**
 * Table layout — three columns, header row separator, four data rows.
 */
const TABLE_SVG = `<svg viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg" aria-label="Table layout">
  <g stroke="currentColor" fill="none">
    <rect x="30" y="50" width="340" height="180" rx="4" stroke-width="1.5" />
    <line x1="30"  y1="85"  x2="370" y2="85"  stroke-width="1.5" />
    <line x1="150" y1="50"  x2="150" y2="230" stroke-width="1" />
    <line x1="270" y1="50"  x2="270" y2="230" stroke-width="1" />
    <line x1="30"  y1="120" x2="370" y2="120" stroke-width="1" opacity="0.5" />
    <line x1="30"  y1="155" x2="370" y2="155" stroke-width="1" opacity="0.5" />
    <line x1="30"  y1="190" x2="370" y2="190" stroke-width="1" opacity="0.5" />
  </g>
  <g fill="currentColor" opacity="0.45">
    <rect x="45"  y="63" width="80"  height="10" rx="2" />
    <rect x="165" y="63" width="80"  height="10" rx="2" />
    <rect x="285" y="63" width="60"  height="10" rx="2" />
  </g>
</svg>`;

/**
 * Collection (Home-canvas) layout — grid of stack tiles, each with an
 * icon-area-and-title schematic. Mirrors Collections home rendering.
 */
const COLLECTION_SVG = `<svg viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg" aria-label="Collection layout">
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="40"  y="40"  width="100" height="100" rx="8" />
    <rect x="150" y="40"  width="100" height="100" rx="8" />
    <rect x="260" y="40"  width="100" height="100" rx="8" />
    <rect x="40"  y="150" width="100" height="100" rx="8" />
    <rect x="150" y="150" width="100" height="100" rx="8" />
    <rect x="260" y="150" width="100" height="100" rx="8" />
  </g>
  <g fill="currentColor" opacity="0.45">
    <circle cx="90"  cy="80"  r="14" />
    <circle cx="200" cy="80"  r="14" />
    <circle cx="310" cy="80"  r="14" />
    <circle cx="90"  cy="190" r="14" />
    <circle cx="200" cy="190" r="14" />
    <circle cx="310" cy="190" r="14" />
  </g>
  <g stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="60"  y1="115" x2="120" y2="115" />
    <line x1="170" y1="115" x2="230" y2="115" />
    <line x1="280" y1="115" x2="340" y2="115" />
    <line x1="60"  y1="225" x2="120" y2="225" />
    <line x1="170" y1="225" x2="230" y2="225" />
    <line x1="280" y1="225" x2="340" y2="225" />
  </g>
</svg>`;

/**
 * Timeline layout — vertical spine with circular date markers and
 * adjacent entry blocks alternating across the spine.
 */
const TIMELINE_SVG = `<svg viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg" aria-label="Timeline layout">
  <g stroke="currentColor" stroke-width="1.5">
    <line x1="200" y1="30" x2="200" y2="250" />
  </g>
  <g fill="currentColor">
    <circle cx="200" cy="60"  r="6" />
    <circle cx="200" cy="120" r="6" />
    <circle cx="200" cy="180" r="6" />
    <circle cx="200" cy="240" r="6" />
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="60"  y="45"  width="120" height="30" rx="4" />
    <rect x="220" y="105" width="120" height="30" rx="4" />
    <rect x="60"  y="165" width="120" height="30" rx="4" />
    <rect x="220" y="225" width="120" height="30" rx="4" />
  </g>
  <g fill="currentColor" opacity="0.45">
    <rect x="70"  y="54"  width="80" height="6" rx="1" />
    <rect x="230" y="114" width="80" height="6" rx="1" />
    <rect x="70"  y="174" width="80" height="6" rx="1" />
    <rect x="230" y="234" width="80" height="6" rx="1" />
  </g>
</svg>`;

/**
 * Kanban layout — three columns with stacked card outlines per column.
 */
const KANBAN_SVG = `<svg viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg" aria-label="Kanban layout">
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="30"  y="30" width="110" height="220" rx="6" />
    <rect x="145" y="30" width="110" height="220" rx="6" />
    <rect x="260" y="30" width="110" height="220" rx="6" />
  </g>
  <g fill="currentColor" opacity="0.45">
    <rect x="40"  y="40"  width="90" height="20" rx="3" />
    <rect x="155" y="40"  width="90" height="20" rx="3" />
    <rect x="270" y="40"  width="90" height="20" rx="3" />
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="40"  y="75"  width="90" height="40" rx="4" />
    <rect x="40"  y="125" width="90" height="40" rx="4" />
    <rect x="40"  y="175" width="90" height="40" rx="4" />
    <rect x="155" y="75"  width="90" height="40" rx="4" />
    <rect x="155" y="125" width="90" height="40" rx="4" />
    <rect x="270" y="75"  width="90" height="40" rx="4" />
    <rect x="270" y="125" width="90" height="40" rx="4" />
    <rect x="270" y="175" width="90" height="40" rx="4" />
    <rect x="270" y="225" width="90" height="20" rx="4" />
  </g>
</svg>`;

/**
 * Bookshelf layout — horizontal row of book spines of varying heights
 * sitting on a baseline (the "shelf").
 */
const BOOKSHELF_SVG = `<svg viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg" aria-label="Bookshelf layout">
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="50"  y="80"  width="30" height="160" rx="2" />
    <rect x="85"  y="60"  width="30" height="180" rx="2" />
    <rect x="120" y="90"  width="30" height="150" rx="2" />
    <rect x="155" y="50"  width="30" height="190" rx="2" />
    <rect x="190" y="100" width="30" height="140" rx="2" />
    <rect x="225" y="70"  width="30" height="170" rx="2" />
    <rect x="260" y="65"  width="30" height="175" rx="2" />
    <rect x="295" y="95"  width="30" height="145" rx="2" />
    <rect x="330" y="80"  width="30" height="160" rx="2" />
  </g>
  <g fill="currentColor" opacity="0.45">
    <rect x="55"  y="120" width="20" height="40" rx="1" />
    <rect x="90"  y="105" width="20" height="40" rx="1" />
    <rect x="125" y="130" width="20" height="40" rx="1" />
    <rect x="160" y="95"  width="20" height="40" rx="1" />
    <rect x="195" y="140" width="20" height="40" rx="1" />
    <rect x="230" y="115" width="20" height="40" rx="1" />
    <rect x="265" y="110" width="20" height="40" rx="1" />
    <rect x="300" y="135" width="20" height="40" rx="1" />
    <rect x="335" y="120" width="20" height="40" rx="1" />
  </g>
  <g stroke="currentColor" stroke-width="2">
    <line x1="40" y1="250" x2="370" y2="250" />
  </g>
</svg>`;

/**
 * The keys map 1:1 to the codefence `display:` values emitted by
 * `buildSelectFenceFromState`. The Architect locked `collection-home`
 * (with the hyphen) as the canonical slug for the Collection tab —
 * matches the existing `DISPLAY_REGISTRY` entry.
 */
export type ViewModalLayoutKey =
  | "cards"
  | "table"
  | "collection-home"
  | "timeline"
  | "kanban"
  | "bookshelf";

/**
 * Inline SVG strings keyed by layout slug. Switching tabs sets the
 * preview area's innerHTML to the corresponding string — no async I/O.
 */
export const VIEW_MODAL_ILLUSTRATIONS: Readonly<Record<ViewModalLayoutKey, string>> = {
  cards: CARDS_SVG,
  table: TABLE_SVG,
  "collection-home": COLLECTION_SVG,
  timeline: TIMELINE_SVG,
  kanban: KANBAN_SVG,
  bookshelf: BOOKSHELF_SVG,
};

/**
 * Ordered list of layout slugs as they appear in the tab strip.
 * FR-10: fixed order, no user-reorder.
 */
export const VIEW_MODAL_TAB_ORDER: ReadonlyArray<{
  slug: ViewModalLayoutKey;
  label: string;
}> = [
  { slug: "cards", label: "Cards" },
  { slug: "table", label: "Table" },
  { slug: "collection-home", label: "Collection" },
  { slug: "timeline", label: "Timeline" },
  { slug: "kanban", label: "Kanban" },
  { slug: "bookshelf", label: "Bookshelf" },
];

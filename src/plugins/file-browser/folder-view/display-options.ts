/**
 * display-options.ts — Single source of truth for Select-codefence displays.
 *
 * Each top-level display (cards, table, timeline, kanban, …) declares zero or
 * more "options" — visual sub-variants. The picker UI in select-builder.ts and
 * assign-modal.ts derives its pills from this registry; the renderer dispatch
 * in select-widget.ts validates `display:` and `option:` through
 * `resolveDisplayAndOption()`.
 *
 * Backwards compat: `display: list` is aliased to `display: table, option:
 * simple-list` so existing fences keep working after List was demoted from a
 * top-level display to a Table variant.
 */

export interface DisplayOptionSpec {
  /** YAML value written to `option:` for this variant. */
  slug: string;
  /** Picker label. */
  label: string;
  /** Optional one-line description shown in the picker. */
  description?: string;
}

export interface DisplaySpec {
  /** YAML value written to `display:`. */
  slug: string;
  /** Picker label. */
  label: string;
  /** Option chosen when `option:` is absent or invalid. */
  defaultOption: string;
  /** All valid options for this display. Single-element arrays mean "no real choice". */
  options: DisplayOptionSpec[];
}

/**
 * Registry of every top-level display and its options. Order here is the
 * order shown in the picker UI.
 */
export const DISPLAY_REGISTRY: DisplaySpec[] = [
  {
    slug: "cards",
    label: "Cards",
    defaultOption: "grid",
    options: [{ slug: "grid", label: "Grid" }],
  },
  {
    slug: "table",
    label: "Table",
    defaultOption: "table-grid",
    options: [
      { slug: "table-grid", label: "Table grid" },
      { slug: "simple-list", label: "Simple list", description: "Single-column row layout" },
    ],
  },
  {
    slug: "timeline",
    label: "Timeline",
    defaultOption: "vertical",
    options: [{ slug: "vertical", label: "Vertical" }],
  },
  {
    slug: "kanban",
    label: "Kanban",
    defaultOption: "columns",
    options: [{ slug: "columns", label: "Columns" }],
  },
  {
    slug: "bookshelf",
    label: "Bookshelf",
    defaultOption: "compact",
    options: [
      { slug: "covers",     label: "Covers",     description: "Wide cover-box grid — every item in a 300–450px cell at its cover's natural aspect; placeholder for missing covers" },
      { slug: "library",    label: "Library",    description: "Mixed shelves — cover when available, randomized spine otherwise; big 80vh shelves" },
      { slug: "compact",    label: "Compact",    description: "Spines only — every item rendered as a spine even if it has a cover; same shelf heights as Library" },
      { slug: "book-stack", label: "Book Stack", description: "Vertical scrolling list of horizontal book bars — no shelves, no rails; title reads horizontally" },
    ],
  },
];

/** Look up a display spec by slug. Returns null when unknown. */
export function getDisplaySpec(slug: string): DisplaySpec | null {
  return DISPLAY_REGISTRY.find((d) => d.slug === slug) ?? null;
}

/**
 * Normalize a `display:` / `option:` pair from raw YAML into a valid display
 * + option pair. Handles three cases:
 *
 *  1. `display: list` aliases to `display: table, option: simple-list`.
 *  2. Unknown `display:` falls back to cards/grid.
 *  3. Missing or invalid `option:` for a known display falls back to that
 *     display's `defaultOption`.
 *
 * Never throws.
 */
export function resolveDisplayAndOption(
  rawDisplay: string,
  rawOption: string | null,
): { display: string; option: string } {
  if (rawDisplay === "list") {
    return { display: "table", option: "simple-list" };
  }
  const spec = getDisplaySpec(rawDisplay);
  if (!spec) {
    return { display: "cards", option: "grid" };
  }
  const valid = new Set(spec.options.map((o) => o.slug));
  const option = rawOption && valid.has(rawOption) ? rawOption : spec.defaultOption;
  return { display: spec.slug, option };
}

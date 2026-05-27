# Bookshelf pattern previews

Standalone SVG previews for the 7 background-image patterns used in the
**Bookshelf → Compact** (and Library no-cover) two-zone spine layout.

Each `slot-N-*.svg` shows the corresponding pattern tiled across a 180×180
preview area at the same 18×18px tile size used in production. Open one
in your browser (or Finder Quick Look on macOS) to evaluate the motif and
verify seamless tiling.

## Files

Each pattern is named after the matching `Course N` spine in
`BookshelfViewStack-Vert-8.jpg`.

| File | Pattern | Reference |
|------|---------|-----------|
| `slot-1-plus-grid.svg`   | full-width plus arms forming a continuous grid with intersection dots | Course 1 — Thinking in Systems |
| `slot-2-arcs.svg`        | interlocking quarter-discs flowing diagonally | Course 2 — Introduction to a Complexity Language |
| `slot-3-chevrons.svg`    | thick stepped parallelogram bands | Course 3 — Mastering Complexity |
| `slot-4-snowflakes.svg`  | 8-armed star + center dot | Course 4 — Systems Thinking Practicum |
| `slot-5-octagons.svg`    | two concentric octagon outlines | Course 5 — Design Beyond Thinking Foundation |
| `slot-6-pillars.svg`     | I-beam columns with chunky caps | Course 6 — Towards for Resonance |
| `slot-7-ovals.svg`       | tall vertical ellipses | Course 7 — Designing for Resonance |

## Source of truth — these SVG files

**The seven `slot-N-*.svg` files in this folder are the single source of
truth for runtime patterns.** `src/plugins/file-browser/folder-view/bookshelf-patterns.ts`
imports them via Vite's `?raw` so any edit here automatically flows into
the live app on the next dev rebuild — no copy-paste step.

Runtime pipeline per slot:

1. The `.svg` file is loaded as raw text.
2. Its inner body is extracted and wrapped in
   `<g fill="#000" fill-opacity="0.22">` — gives every shape the subtle
   "darken the pair's top color" overlay. Individual shapes don't need
   to specify their own fill.
3. The wrapped SVG is URL-encoded into a `data:image/svg+xml,...` URI.
4. The renderer assigns the URI inline as `background-image` on the
   book's `.fv-book-pattern` element.

The renderer picks a slot per book via `patternSlotFor(card)` in
`bookshelf-renderer.ts`, hashes the card path → 1..7. The CSS for tile
size lives in `bookshelf-css.ts`
(`background-size: 60px 60px; background-repeat: repeat;`).

## Editing the patterns

Open any `slot-N-*.svg` in Illustrator (or any SVG editor), edit, save.
Run `npm run tauri dev` if the dev server isn't already running, and the
new pattern appears in the rendered bookshelf. The TS file imports these
directly — no regen step.

## Background color

All previews use `#f4ead0` (a warm cream from the bright-8 palette swatch)
as the underlying color. In production each book picks one of 8 pair-top
colors via the `.fv-book-pair-N` class — so the actual look varies by
book. Use this preview to evaluate **shape and tiling**; ignore the
specific background hue.

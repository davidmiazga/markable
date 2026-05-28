# Bookshelf pattern previews — mirror copy

> **This folder is a MIRROR for visual browsing only — not a build dependency.**
>
> **Canonical source:** `src/plugins/file-browser/folder-view/pattern-assets/`
>
> The `bookshelf-patterns.ts` module imports the SVGs from `src/` via Vite's
> `?raw`. This `docs/` folder is a parallel copy you can open in Finder Quick
> Look or a browser without digging into `src/`. **Deleting `docs/` does
> NOT break the app.**

## Workflow

1. Edit the canonical SVG in `src/plugins/file-browser/folder-view/pattern-assets/slot-N-*.svg` — that's what the build actually consumes.
2. (Optional) Run `npm run sync:patterns` to refresh this mirror folder from the canonical files.
3. Open the freshly-synced `.svg` here in your favorite SVG viewer to verify it renders the way you expect.

If you edit a file in `docs/` instead, **the build won't see it** — the runtime data URI is still generated from the `src/` copy. To prevent drift, treat this folder as read-only and use `sync:patterns` to refresh.

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

## Runtime pipeline

1. The `.svg` file (canonical in `src/`) is loaded as raw text via `import "./pattern-assets/slot-N-*.svg?raw"`.
2. Its inner body is extracted and wrapped in `<g fill="currentColor">` so every shape becomes a clean alpha silhouette.
3. The wrapped SVG is URL-encoded into a `data:image/svg+xml,...` URI.
4. The renderer assigns the URI inline as `--fv-pattern-url` on the book's `.fv-book-pattern` element, which CSS uses as a `mask-image`.

`patternSlotFor(card)` in `bookshelf-renderer.ts` hashes each card path into a slot 1–7. The CSS for tile sizing lives in `bookshelf-css.ts`.

## Background color in these previews

The preview SVGs use `#f4ead0` (a warm cream) as the background so the shapes are visible. In production each book picks one of 8 pair-top colors via the `.fv-book-pair-N` class — the actual look varies by book. Use these previews to evaluate **shape and tiling**; ignore the cream backdrop.

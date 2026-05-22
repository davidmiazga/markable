# Plan: Display Options + Bookshelf Display

> **First action after you exit plan mode:** copy this file to `docs/planning-views-01.md` in the repo so the user can follow along inline.

---

## 2026-05-22 addendum — Compact-mode redesign from blendMode-test1.0.html

**Working preference (note for future iterations):** the user solves the simplest mode first, then propagates the working pattern outward. Compact (no images, simplest book content) lands first; once it's solid we apply the structural pattern to Library and Covers in follow-up iterations.

### Context

After a long iteration cycle on the rail's `mix-blend-mode`, the user built a standalone test (`/Users/daveslaptop/work-LocalArea/-testing-tutorials/blendMode/blendMode-test1.0.html`) that demonstrates a clean working pattern: **sibling z-index layering** rather than the `isolation: isolate + background + z-index: -1 + overflow: hidden` chain we've been patching. The test also redesigns the book element: rich author/title/date text with a decorative double-rule (`.dblRule`), rendered vertically via `writing-mode: vertical-rl`. This addendum translates that test into our Bookshelf renderer, scoped to the **Compact** sub-option only.

### Class mapping (test → ours)

| Test class | Our class | Role |
|---|---|---|
| `.contentArea` | `.fv-shelf` | Per-shelf container, `position: relative`, NO isolation |
| `.bookArea` | `.fv-shelf-row` | Row of books, `z-index: 10`, flex |
| `.shelf` | `.fv-shelf-rail` | Colored rail, `position: absolute; bottom: 0; z-index: 1; mix-blend-mode: color` |
| `.book` | `.fv-book` | Single book element — combined wrapper + spine, `writing-mode: vertical-rl`, colored bg from our palette |
| `.author` / `.title` / `.date` / `.dblRule` | `.fv-book-author` / `.fv-book-title` / `.fv-book-date` / `.fv-book-rule` | Vertical text children inside `.fv-book` |

### Key insight

The current rail approach relies on `z-index: -1` (negative), which forces every parent up the chain to have a defined painted backdrop or the blend collapses. The test uses **positive z-index** for both the rail and the books (rail = 1, books = 10), so the rail blends with whatever's painted up the ancestor chain (body/html with `--bg-primary`) and books simply paint over the rail via normal stacking order. No isolation, no `overflow: hidden`, no `padding-bottom` reservation strip.

### Renderer changes — `src/plugins/file-browser/folder-view/bookshelf-renderer.ts`

- `buildCompactItem(card)` produces a single `.fv-book` element directly — no longer wraps a separate `.fv-book-spine`. Inside: optional `.fv-book-author`, always `.fv-book-title`, optional `.fv-book-date` containing a decorative `<div class="fv-book-rule">`.
- All three text fields are sourced from optional YAML in `card.meta`: `author`, `title`, `date`. When YAML keys are absent: title falls back to `card.name` (filename stem); author and date rows are omitted entirely.
- `enrichBookshelfMeta` reads `title` and `date` keys in addition to the existing `cover`, `author`, and `group-by` keys.
- The color slot (`fv-book-color-N` from `colorSlotFor(card)`) stays on `.fv-book` exactly as today.
- The width/weight/size slots on the old `.fv-book-spine` are removed for Compact — variable widths come from a CSS-only `:nth-child` rotation on `.fv-book-rule` (per the test's `.dblRule` pattern, user-confirmed).

### CSS changes — `src/plugins/file-browser/folder-view/bookshelf-css.ts` (Compact scope)

Strip from `.fv-bookshelf--compact .fv-shelf`:
- `isolation: isolate`
- `background: var(--bg-primary)`
- `overflow: hidden`
- `padding-bottom: 50px`

The base `.fv-shelf` rule keeps just `position: relative; display: flex; flex-direction: column`. The painted backdrop falls through to `html { background-color: var(--bg-primary) }` (already present in `src/styles.css:106`) — that's what the rail's `mix-blend-mode: color` will compute against.

Rewrite `.fv-bookshelf--compact .fv-shelf-rail`:
```
position: absolute;
bottom: 0;
left: 0;
right: 0;
height: <to-tune>; /* test uses 200px; we'll start there */
background: var(--bright-1, …); /* per-shelf rotation via :nth-of-type already exists */
border-radius: 12px;
mix-blend-mode: color;
z-index: 1;  /* positive, sibling of the row */
/* NO translate, NO scale, NO negative z-index */
```

Rewrite `.fv-bookshelf--compact .fv-shelf-row`:
```
z-index: 10;  /* on top of the rail */
display: flex;
flex-direction: row;
align-items: flex-end;
justify-content: flex-start;
gap: 2px;
padding: 0 25px 5% 25px;  /* per test — books inset from shelf edges */
```

New `.fv-bookshelf--compact .fv-book`:
```
position: relative;
display: flex;
flex-direction: row;
justify-content: space-between;
align-items: center;
height: 70vh;  /* tall; matches test */
width: auto;  /* sized by content + padding */
writing-mode: vertical-rl;
text-align: center;
padding: 6px 0;
border-radius: 4px;
font-size: 12px;
/* background from .fv-book.fv-book-color-N rule already exists */
```

Text children: `.fv-book-author`, `.fv-book-title`, `.fv-book-date` use the test's typography. `.fv-book-rule` is a 20px-wide rotated double-line decoration, with `:nth-child(Nn+M)` cycling four width variants (matching the test's `--randomWidth-01..05`).

The Compact-only width slot CSS on `.fv-book-spine` is removed (or scoped to library only since library still uses the old spine fallback).

### Renderer — keep these unchanged for Compact

- The `SUB_RENDERERS` dispatch in `bookshelf-renderer.ts:395`.
- `colorSlotFor(card)` and the bright palette (`--bright-1…8`) in `src/styles.css:78-91` + dark-theme variants.
- Per-shelf rail color rotation via `:nth-of-type(8n+N)`.
- Count-aware shelf heights via `data-shelf-count`.
- Async YAML enrichment via `enrichBookshelfMeta` (just extend its wantedKeys set).
- `renderCompact` filtering to `kind === "file"` and the empty-state handling.

### Critical files

| File | Change scope |
|---|---|
| `src/plugins/file-browser/folder-view/bookshelf-renderer.ts` | `buildSpine` retained for library; new `buildCompactBook` for compact. `enrichBookshelfMeta` reads `title` + `date` keys too. |
| `src/plugins/file-browser/folder-view/bookshelf-css.ts` | Remove isolation/bg/overflow/padding on shelf for compact; rewrite rail with positive z-index; rewrite row with `z-index: 10`; add `.fv-book-author`, `.fv-book-title`, `.fv-book-date`, `.fv-book-rule` styles. |
| `tests/folder-view/bookshelf-renderer.test.ts` | Update compact-mode assertions: `.fv-book-spine` is gone in compact; check for `.fv-book-title` text content + optional `.fv-book-author` / `.fv-book-date` rows. Add coverage for the title fallback to `card.name` when no `meta.title`. |

### Out of scope (this iteration)

- Library and Covers modes — they keep their current implementations. Once Compact looks right visually, we revisit Library next (probably applies the sibling-rail pattern + uses the new book structure as the spine fallback when no cover) and Covers last.
- The `--shelf-color` / `--book-color` CSS variables from the test — we already have the 8-color bright palette; reuse it.

### Verification

- `npx tsc --noEmit` clean.
- `npm run build:plugins` clean (template-literal CSS string compiles).
- `npm run test:run` passes; new compact-mode assertions cover the title/author/date/rule rendering paths.
- Visual: paste a `\`\`\`select` fence with `display: bookshelf` + `option: compact` into a `.md` file in a vault. With and without YAML `author:` / `title:` / `date:` on individual files, verify:
  - Rail is dark blended (not bright source color).
  - Books sit on top of the rail with the rail visible past their edges (sides + bottom).
  - Per-book color comes from the bright palette via the hash slot.
  - `.fv-book-rule` widths rotate by position via `:nth-child`.

---

The `\`\`\`select` codefence currently exposes five top-level displays (`cards`, `table`, `list`, `timeline`, `kanban`). Two issues prompted this change:

1. **Displays need sub-modes.** Some displays — Bookshelf especially — have several legitimate visual variants that don't deserve their own top-level slot. The picker should surface them as nested "options" of a single parent display.
2. **List is really a Table variant.** Today's "List" display is a single-column row layout with no semantic distinction from Table — moving it under Table cleans up the picker and makes room for a new top-level entry.

The new top-level slot is **Bookshelf**, aimed directly at book readers. It shows real book covers when the file's YAML carries a `cover:` key, and gracefully falls back to a stylized spine showing title/author when no cover is set. Three options control how the shelves look: `covers` (default — minimal rectangles per inspo-4), `library` (curated pastel spines per inspo-7), and `compact` (dense rack per inspo-1).

This plan is **phased**. Phase 1 lands the option-system plumbing plus the List→Table migration as a standalone change. Phases 2–4 stack the Bookshelf renderer and its three options on top.

User-locked decisions:
- Shipping cadence: **phased** (Phase 1 mergeable independently).
- `group-by:` in v1: **any YAML key** (requires async enrichment via `read_file` per visible card, mirroring `tab.ts`).
- Slug naming: `covers` / `library` / `compact` for Bookshelf, `simple-list` for the new Table option.

---

## Phase 1 — Option-system plumbing + List → Table/Simple-list

User-visible: "List" disappears from the picker; Table's options sub-row gains "Simple list".

### 1.1 New file — `src/plugins/file-browser/folder-view/display-options.ts`

Single source of truth for which top-level displays exist, what options each declares, and the default option per display. Also exports the `display: list` → `display: table, option: simple-list` alias resolver.

```ts
export interface DisplayOptionSpec { slug: string; label: string; description?: string; }
export interface DisplaySpec {
  slug: string;
  label: string;
  defaultOption: string;
  options: DisplayOptionSpec[];
}

export const DISPLAY_REGISTRY: DisplaySpec[] = [
  { slug: "cards",     label: "Cards",     defaultOption: "grid",
    options: [{ slug: "grid", label: "Grid" }] },
  { slug: "table",     label: "Table",     defaultOption: "table-grid",
    options: [
      { slug: "table-grid",  label: "Table grid" },
      { slug: "simple-list", label: "Simple list", description: "Single-column row layout" },
    ] },
  { slug: "timeline",  label: "Timeline",  defaultOption: "vertical",
    options: [{ slug: "vertical", label: "Vertical" }] },
  { slug: "kanban",    label: "Kanban",    defaultOption: "columns",
    options: [{ slug: "columns", label: "Columns" }] },
  // bookshelf registered in Phase 2
];

export function resolveDisplayAndOption(
  rawDisplay: string,
  rawOption: string | null,
): { display: string; option: string } {
  if (rawDisplay === "list") return { display: "table", option: "simple-list" };
  const spec = DISPLAY_REGISTRY.find(d => d.slug === rawDisplay);
  if (!spec) return { display: "cards", option: "grid" };
  const valid = new Set(spec.options.map(o => o.slug));
  const option = rawOption && valid.has(rawOption) ? rawOption : spec.defaultOption;
  return { display: spec.slug, option };
}
```

Invalid `display:` falls back to cards/grid; invalid `option:` falls back to the display's default. Never throws.

### 1.2 Type changes — `src/plugins/file-browser/folder-view/types.ts`

Add to `FolderViewConfig`:
```ts
displayOption?: string;  // chosen option slug; absent = display's default
groupBy?: string;        // YAML key used to group items into shelves (Bookshelf only, Phase 2)
```

Both optional so existing fixtures and call sites compile untouched.

### 1.3 `src/editor/select-widget.ts`

- Drop `import { renderFolderList } ...`.
- Replace the hardcoded `VALID_DISPLAYS` + alias logic with `resolveDisplayAndOption()`.
- Update `RENDERERS` map: keys become `cards`, `table`, `timeline`, `kanban` (Phase 1) — Bookshelf added in Phase 2.
- In `parseSelectBody`, write `config.displayOption = resolved.option` and (Phase 2) `config.groupBy`.
- Same update in `parseSelectBodyForBuilder` so the assign-modal/builder reads the option back.

### 1.4 List migration — `src/plugins/file-browser/folder-view/list-renderer.ts`

- **Rename** `renderFolderList` → `renderFolderListInternal` (no longer a public top-level renderer; reachable only through Table).
- Keep `buildListRow` exported — timeline-renderer and kanban-renderer already reuse it (`list-renderer.ts:46`).

### 1.5 `src/plugins/file-browser/folder-view/table-renderer.ts`

Top of `renderFolderTable`:
```ts
if (config.displayOption === "simple-list") {
  return renderFolderListInternal(config, cards, container, folderPath, context);
}
// existing table-grid path unchanged
```

### 1.6 `src/plugins/file-browser/folder-view/tab.ts`

This is a **separate** codepath used by the standalone Folder-View tab (driven by `_folder.md` / `layout: view-list` YAML, not by `\`\`\`select` fences). Update its `LAYOUT_RENDERERS` map to point `view-list` at `renderFolderListInternal`. The tab-codepath schema is untouched in this plan; it doesn't carry `display:` / `option:` keys.

### 1.7 `src/lib/select-builder.ts`

- Replace hardcoded `DisplayKind` / `ALL_DISPLAYS` / `DISPLAY_LABELS` with derivations from `DISPLAY_REGISTRY`.
- `DisplayKind` type: `"cards" | "table" | "timeline" | "kanban"` (bookshelf added Phase 2).
- Extend `SelectBuilderInitial` and the form-state shape with `displayOption?: string` and (Phase 2) `groupBy?: string`.
- `mountSelectForm` (~line 352, `renderDisplayOptions`): when `DISPLAY_REGISTRY.find(state.display).options.length > 1`, render a "Layout option" pill row. Switching the top-level display resets `state.displayOption` to that display's `defaultOption`.
- "Show file extensions" check guard: `display === "cards" || (display === "table" && displayOption === "simple-list")`.

### 1.8 `buildSelectFenceFromState` (and `buildSelectFence` in assign-modal.ts)

Emit `option:` only when the chosen option ≠ the display's default. Existing fences round-trip byte-stably.

```ts
const spec = DISPLAY_REGISTRY.find(d => d.slug === state.display)!;
if (state.displayOption && state.displayOption !== spec.defaultOption) {
  lines.push(`option: ${state.displayOption}`);
}
```

### 1.9 `src/lib/assign-modal.ts`

- Remove `view-list` from `VIEW_TYPES` and `VIEW_PREVIEW_SVGS`.
- Add a "Layout option" pill row to `renderOptionsArea` for any view whose underlying display has `options.length > 1`. Reuses `am-sort-pill` styling (`assign-modal.ts:~776`).
- Thread `option` through `applyViewAssignment` and `buildSelectFence`.
- `readSelectFenceOptions` extracts `option:` from the fence body.

### 1.10 Tests for Phase 1

- **New: `tests/folder-view/display-options.test.ts`** — `resolveDisplayAndOption` covers: cards/null → cards/grid; list/null → table/simple-list; table/simple-list passthrough; table/bogus → table/table-grid; nonsense → cards/grid.
- **New: `tests/editor/select-widget-parse.test.ts`** — `parseSelectBody`: `display: list` ⇒ `layout: view-table`, `displayOption: simple-list`. Asserts the alias.
- **New: `tests/lib/select-builder.test.ts`** — `buildSelectFenceFromState`: emits `option:` only when non-default; round-trip preserves `displayOption`.
- Existing `tests/folder-view/renderer.test.ts` / `table-renderer.test.ts` stay green — fixtures don't set `displayOption`.

---

## Phase 2 — Bookshelf scaffold + `covers` option

### 2.1 Registry entry — extend `display-options.ts`

```ts
{ slug: "bookshelf", label: "Bookshelf", defaultOption: "covers",
  options: [
    { slug: "covers",  label: "Covers",  description: "Horizontal shelves of cover-or-spine items" },
    { slug: "library", label: "Library", description: "Curated pastel spines with index" },
    { slug: "compact", label: "Compact", description: "Dense rack of spines" },
  ] },
```

Phase 2 only ships the `covers` sub-renderer; `library` and `compact` are inert pills until Phase 3 wires them up (a no-op sub-renderer would fall back to covers).

### 2.2 New file — `src/plugins/file-browser/folder-view/bookshelf-renderer.ts`

Single file containing the public `renderFolderBookshelf` + an internal sub-renderer dispatch + shared helpers (`buildBookItem`, `buildSpine`, `groupCards`).

```ts
export function renderFolderBookshelf(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
  context?: BulkContext,
): void {
  // 1. host setup (preview-pane wiring copied from list-renderer)
  // 2. applyExcludeFilter + sortCards
  // 3. enrichBookshelfMeta(cards) — async, see §2.4
  // 4. groupCards(cards, config.groupBy) → Map<groupKey, FolderCard[]>
  // 5. dispatch to SUB_RENDERERS[config.displayOption ?? "covers"]
}
```

Internal helpers:
- `groupCards(cards, groupBy)` — returns `[{ key, items }]`. Empty `groupBy` ⇒ one synthetic group (`key: null`, no heading). Empty/missing values bucket as "Uncategorized".
- `buildBookItem(card, folderPath)` — `<img class="fv-book-cover">` when `card.meta.cover` is non-empty, else `buildSpine(card)`. `<img onerror>` falls through to spine so a broken `cover:` path doesn't show a broken-image icon.
- `buildSpine(card)` — `<div class="fv-book-spine">` with `<div class="fv-book-title">` (and `<div class="fv-book-author">` if `card.meta.author`). Title rendered with `writing-mode: vertical-rl; transform: rotate(180deg)`.

### 2.3 New file — `src/plugins/file-browser/folder-view/bookshelf-css.ts`

Exports `BOOKSHELF_CSS` (TS-string CSS, ~150 lines). Wire into the existing concat at `src/plugins/file-browser/file-browser.plugin.ts:~718` (the line that already joins `FOLDER_VIEW_CSS + FOLDER_TABLE_CSS`).

Class namespace: `.fv-bookshelf` + per-option modifier `.fv-bookshelf--covers / --library / --compact`. Inner pieces: `.fv-shelf`, `.fv-shelf-rail`, `.fv-shelf-row`, `.fv-shelf-heading`, `.fv-book`, `.fv-book-cover`, `.fv-book-spine`, `.fv-book-title`, `.fv-book-author`, `.fv-shelf-index`.

`.covers` styling (Phase 2):
- `.fv-shelf-row { display: flex; gap: 12px; align-items: flex-end; overflow-x: auto; }` — `align-items: flex-end` keeps mixed-height items (covers and taller spines) on the same baseline.
- `.fv-book-cover { height: var(--fv-book-h, 180px); width: auto; object-fit: contain; box-shadow: ...; border-radius: 2px; }`
- `.fv-book-spine { height: var(--fv-book-h, 180px); width: 48px; background: var(--bg-secondary); border-radius: 2px; display: flex; align-items: flex-end; }`
- `.fv-book-title { writing-mode: vertical-rl; transform: rotate(180deg); padding: 8px 6px; font-size: 11px; color: var(--text-primary); }`
- `.fv-shelf-rail { height: 2px; background: var(--border-color); margin-top: 4px; }`

`.fv-book-cover` carries **zero** color rules so covers render at their natural palette.

### 2.4 Async enrichment for cover / author / group-by

Because the user opted for "any YAML key" for `group-by:`, we cannot pre-cache values in the vault index. Mirror `tab.ts`:

- `renderFolderBookshelf` shows a placeholder shelf (`.fv-bookshelf-loading` skeleton: gray rectangles in shelf shape) immediately.
- Behind the scenes, fire `Promise.all` of `read_file` for every visible `.md` card. For each, parse YAML frontmatter and populate `card.meta = { cover, author, [groupBy]: value }`.
- When the promise resolves, replace the placeholder with the real bookshelf.
- Reuse `parseYamlLines()` from `src/plugins/file-browser/folder-view/parser.ts` to keep YAML parsing consistent.

Optimization note: only files matched by `applyExcludeFilter` are read; non-md files are skipped (they don't carry YAML).

### 2.5 Export `resolveAssetSrc` from `src/lib/layout-manager.ts`

The helper at `layout-manager.ts:385` is currently module-private. Export it (`export function resolveAssetSrc(...)`) — pure utility, zero blast radius.

### 2.6 `src/editor/select-widget.ts`

Register `bookshelf: renderFolderBookshelf` in `RENDERERS`.

### 2.7 `src/lib/assign-modal.ts`

Add:
```ts
{ slug: "view-bookshelf", name: "Bookshelf",
  description: "Cover and spine shelves of book-like items." }
```
plus a `VIEW_PREVIEW_SVGS["view-bookshelf"]` SVG (~30 lines, matches the existing inline-SVG style — three rows of small rectangles with one spine and a horizontal rail). The "Layout option" pill row already added in Phase 1 surfaces covers/library/compact for this entry.

Add a Group by text input visible only when `slug === "view-bookshelf"`.

### 2.8 Phase 2 tests

- **New: `tests/folder-view/bookshelf-renderer.test.ts`** — renders one shelf per `groupBy` value; renders single shelf without heading when `groupBy` absent; card with `meta.cover` produces `.fv-book-cover` `<img>` with `convertFileSrc`-resolved src; card without cover produces `.fv-book-spine` with title; spine includes author when set; empty card list → `.folder-view-empty`; `displayOption` undefined falls back to covers; mixed cover-and-spine items in one row both render.
- Extend `tests/editor/select-widget-parse.test.ts`: `display: bookshelf` + `option: library` ⇒ `displayOption: library`; missing option ⇒ `covers`; bogus option ⇒ `covers`; `group-by: section` ⇒ `config.groupBy === "section"`.

---

## Phase 3 — `library` and `compact` options

### 3.1 `renderBookshelfLibrary` (inspo-7)

- Spines are primary even when `cover:` is set (still render covers if present, but at `--fv-book-h: 260px`).
- Tilt: alternate `transform: rotate(-2deg) / 0 / 1.5deg` via `:nth-child` CSS rules.
- Pastel tint: `background: color-mix(in srgb, var(--accent-color) 30%, var(--bg-primary))`. Themes without `color-mix` fall back to `var(--bg-secondary)`.
- `.fv-shelf-index` shows `"<i> / <total>"` in the bottom-right of each shelf.
- Numbered spines (1, 2, 3 …) along the bottom of each book.

### 3.2 `renderBookshelfCompact` (inspo-1)

- `--fv-book-h: 110px`, `.fv-shelf-row { gap: 2px; flex-wrap: wrap; }` — dense rack that wraps under one heading.
- Spines forced (cover thumbnails ignored at this size for consistency).
- Title font 9px; author hidden.
- Hover lift: `:hover { transform: translateY(-2px); }`.

### 3.3 Phase 3 tests

Extend `bookshelf-renderer.test.ts`: all three options render with their corresponding `.fv-bookshelf--{covers|library|compact}` modifier class on the root.

---

## Phase 4 — UI picker polish

1. Assign-modal: confirm the `view-bookshelf` sub-option pills work end-to-end (covers / library / compact).
2. Select-builder option-pill row gets visual polish — small icons next to each pill, hover preview tooltip.
3. Group-by text input gets autocomplete from frontmatter keys actually present in the active folder (asynchronously sampled).
4. Documentation update in `markable-FeaturesList-v1.0.md` (mention Bookshelf, the option system, and the List→Table migration).

---

## Critical files

| File | Phase | Why |
|---|---|---|
| `src/plugins/file-browser/folder-view/display-options.ts` (new) | 1 | Registry + alias resolver. Single source of truth. |
| `src/plugins/file-browser/folder-view/types.ts` | 1 | `displayOption?`, `groupBy?` added to `FolderViewConfig`. |
| `src/editor/select-widget.ts` | 1, 2 | Parse-time entry; renderer dispatch. |
| `src/lib/select-builder.ts` | 1 | Pill picker UI; fence builder. |
| `src/plugins/file-browser/folder-view/list-renderer.ts` | 1 | Rename `renderFolderList` → `renderFolderListInternal`. |
| `src/plugins/file-browser/folder-view/table-renderer.ts` | 1 | Dispatch on `displayOption === "simple-list"`. |
| `src/plugins/file-browser/folder-view/tab.ts` | 1 | Update `LAYOUT_RENDERERS` mapping for renamed list symbol. |
| `src/lib/assign-modal.ts` | 1, 2 | `VIEW_TYPES`, `VIEW_PREVIEW_SVGS`, `buildSelectFence`, `applyViewAssignment`, option pill row, group-by input. |
| `src/plugins/file-browser/folder-view/bookshelf-renderer.ts` (new) | 2, 3 | Dispatcher for covers/library/compact + spine/cover/group-by helpers. |
| `src/plugins/file-browser/folder-view/bookshelf-css.ts` (new) | 2, 3 | All bookshelf CSS (TS-string). Wired into `file-browser.plugin.ts` concat. |
| `src/lib/layout-manager.ts` | 2 | Export `resolveAssetSrc`. |

---

## Reused utilities

- `resolveAssetSrc` — `src/lib/layout-manager.ts:385` — convert YAML cover path to `asset://` URL. Already battle-tested by notion-page layout.
- `parseYamlLines` — `src/plugins/file-browser/folder-view/parser.ts:93` — line-by-line YAML for enrichment.
- `applyExcludeFilter` — `src/plugins/file-browser/folder-view/shared.ts` — file exclusion already used by every renderer.
- `sortCards`, `getFileIconForCard`, `formatModified` — `src/plugins/file-browser/folder-view/renderer.ts` — share with bookshelf for consistency.
- `buildPreviewPane`, `attachPaneResizeHandle` — `preview-pane.ts` — wire Bookshelf into the same right-pane preview pattern as Cards/List.
- `buildListRow` — `list-renderer.ts:46` — already shared with timeline/kanban; keep exported.

---

## Risks & edge cases

| Risk / case | Mitigation |
|---|---|
| Bookshelf folder with zero covers | All items render as spines. Acceptable (looks like a library of un-cover-arted books). |
| Mixed covers + spines in one row | Embraced (inspo-4 shows this). `align-items: flex-end` keeps the bottom edge aligned. |
| Library/compact with many items | CSS `overflow-x: auto` on `.fv-shelf-row`. No virtualization in v1. TODO comment in renderer for ≥500-item case. |
| Themes without `color-mix` (library option) | Falls back to `var(--bg-secondary)`. |
| `display: list` round-trip | Fence rewrites to `display: table\noption: simple-list` on save. **Intentional** canonicalization. Documented in the migration test. |
| Async enrichment first paint | Placeholder skeleton shows immediately; real shelves replace it when YAML parses complete. Acceptable UX given Bookshelf is decorative-first. |
| Broken cover path | `<img onerror>` swaps in a spine. No broken-image icons. |
| `view-bookshelf` in `_folder.md` | Out of scope for this plan. `tab.ts` LAYOUT_RENDERERS not extended. Follow-up if user wants Folder-View tabs to support Bookshelf too. |
| Hot-reload of `bookshelf-css.ts` | Vite picks up TS-string changes via HMR (verified by existing `FOLDER_TABLE_CSS` pattern). No build config touches. |

---

## Verification

### Phase 1
- `npx tsc --noEmit` clean.
- `npm run test:run` — new tests pass, existing renderer tests stay green.
- Manual: open a `.md` with a `\`\`\`select` fence; switch to Table in the builder; toggle "Layout option → Simple list"; confirm fence emits `option: simple-list` and renders as the old list. Confirm an existing fence with `display: list` still renders correctly.

### Phase 2
- New `bookshelf-renderer.test.ts` cases pass.
- Manual: create `\`\`\`select\\nfolder: ./library\\ndisplay: bookshelf\\ngroup-by: status\\n\`\`\``; populate two .md files with `cover:` and `author:` frontmatter; confirm shelves render with covers, group by status, and a third file with no cover shows as a spine.
- Verify async loading skeleton shows momentarily on cold open.

### Phase 3
- Pill row switches between covers/library/compact and re-renders without remounting the widget.
- Library option shows tilted spines with index counters.
- Compact option shows dense wrapped rack with hover-lift.

### Phase 4
- Manual visual review of select-builder and assign-modal against inspo images.
- Documentation update lands in `markable-FeaturesList-v1.0.md`.

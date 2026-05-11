---
title: "Folder View — User Guide & Developer Reference"
last-updated: "2026-05-10"
review-cadence-days: 30
status: active
---

# Folder View — User Guide & Developer Reference

---

## What is a Folder View?

Any directory in your vault can have a **Folder View** — a visual card grid that opens as a tab when you click the folder name in the file browser. The card grid shows the folder's immediate children (subfolders and files) as clickable cards with preview thumbnails.

The view is configured by a single file: `_folder.md`, placed inside the directory. The YAML front-matter of that file drives the layout. The markdown body (below the closing `---`) renders as a description above the card grid.

---

## Creating a Folder View

1. Right-click any folder in the file browser.
2. Select **Create Folder View…**
3. A `_folder.md` file is written into the folder with all settings at their defaults.
4. The folder view tab opens automatically.

Folders with an active folder view show their icon and label in the accent color, plus a small preview badge on the right of the row.

---

## Editing the Configuration

Open `_folder.md` in the editor (click the `_folder.md` entry in the tree, or press Cmd-E while the folder view tab is active). Edit the YAML values, save — the tab re-renders immediately.

**Resetting to defaults:** Right-click the folder → **Reset Folder View…** — overwrites `_folder.md` with the full default template after confirmation.

---

## Complete YAML Reference

`_folder.md` uses a nested YAML structure. All layout settings live under the `layout:` key:

```yaml
---
layout:
  type: folder-cards
  mode: grid            # grid = consistent columns, flex = fluid smooth resize
  card-width: 160       # min px per card
  aspect-ratio: 1/1     # e.g. 16/9, 4/3, 1.5, original
  fit: cover            # cover, contain, 80% auto, auto 60%, 70% 50%
  min-height: 40
  max-height: 200
  sort: name-asc        # name-asc, name-desc, modified-asc, modified-desc
---

Optional description text here — rendered as markdown above the card grid.
```

### `layout:` block fields

| Field | Default | Valid values | Description |
|---|---|---|---|
| `type` | — | `folder-cards` | Required. Selects the layout renderer. |
| `mode` | `grid` | `grid`, `flex` | `grid` = CSS auto-fill columns (consistent, snappy). `flex` = fluid wrap (smooth resize). |
| `card-width` | `160` | integer px, clamped [40–600] | Minimum card width. More columns are added as the tab widens. |
| `aspect-ratio` | `1/1` | `W/H`, `W:H`, plain number, `original` | Shape of the preview rectangle. `original` = natural image proportions (no fixed ratio). |
| `fit` | `cover` | any CSS `background-size` value | How images fill the preview rectangle. `cover`, `contain`, `80% auto`, `70% 50%`, etc. Ignored when `aspect-ratio: original`. |
| `min-height` | `40` | integer px, clamped [20–400] | Minimum height of the preview rectangle in px. Swapped with `max-height` if inverted. |
| `max-height` | `200` | integer px, clamped [20–400] | Maximum height of the preview rectangle in px. |
| `sort` | `name-asc` | `name-asc`, `name-desc`, `modified-asc`, `modified-desc` | Sort order applied independently to the Folders and Files sections. |
| `card-preview` | `full` | `full`, `none` | `none` hides the preview rectangle entirely — compact name+date grid. |
| `show-extensions` | `true` | `true`, `false` | `false` strips file extensions from card labels (e.g. `.png`, `.pdf`). `.md` is already stripped. |
| `show-folders` | `true` | `true`, `false` | `false` hides the Folders section entirely. |
| `show-files` | `true` | `true`, `false` | `false` hides the Files section entirely. |
| `folders-title` | `Folders` | any string | Rename the Folders section heading. |
| `files-title` | _(empty)_ | any string | Add or rename the Files section heading. Empty = no heading (default). |
| `show-tags` | `false` | `true`, `false` | `true` shows up to 3 YAML tag chips below the card name (`.md` files only). |
| `show-count` | `false` | `true`, `false` | `true` shows item count in brackets on subfolder card labels. |

### Top-level fields

These sit outside the `layout:` block (flat, top-level keys):

| Field | Default | Description |
|---|---|---|
| `title` | folder name | Overrides the tab display title. |
| `show-modified` | `true` | `false` hides the modified-date line on file cards. |
| `exclude` | _(empty list)_ | YAML sequence of filenames to suppress from the grid. Filenames include extension (e.g. `draft.md`, `archive.pdf`). |

**Example with `exclude:`:**
```yaml
---
exclude:
  - draft.md
  - _archive.md
layout:
  type: folder-cards
---
```

### Aspect-ratio values

| Value | Meaning |
|---|---|
| `1/1` | Square cards |
| `16/9` or `16:9` | Widescreen |
| `4/3` or `4:3` | Classic photo |
| `1.5` | Plain decimal (width ÷ height) |
| `original` | Height follows the image's natural proportions |

### Card preview behaviour

| File type | Preview content |
|---|---|
| Image (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.avif`, `.bmp`, `.ico`) | Background-image fill (or natural `<img>` when `aspect-ratio: original`) |
| Text / Markdown (`.md`, `.txt`, `.markdown`) | First ~300 characters of body text, YAML stripped, 5-line clamp |
| Directory | Centred folder icon |
| All other files | Centred file-type icon |

---

## Developer Procedure: Adding a New YAML Field

Follow these steps every time a new `_folder.md` front-matter field is added. Steps must be completed in order.

**Files involved:**

```
src/plugins/file-browser/folder-view/
  types.ts       ← type contracts
  parser.ts      ← YAML → FolderViewConfig
  renderer.ts    ← FolderViewConfig → DOM

src/plugins/file-browser/
  file-browser.plugin.ts   ← FOLDER_VIEW_STARTER template + context menu

tests/folder-view/
  parser.test.ts
  renderer.test.ts
```

**Checklist:**

1. **`types.ts` — `FolderMdFrontMatter`**
   Add the raw YAML field (optional, string or string|number). Use the exact YAML key name as the TypeScript key (quoted if hyphenated).

2. **`types.ts` — `FolderViewConfig`**
   Add the validated/defaulted field in its final form (e.g. `number`, `boolean`, `string` union). Add a JSDoc comment with the default and valid range.

3. **`parser.ts` — `safeDefaults`**
   Add the field with its safe default value. This object is returned on any parse error.

4. **`parser.ts` — `parseFolderMd()`**
   Add parsing + validation logic. Rules:
   - If the field lives inside the `layout:` block, `normalizeFm()` already flattens it to `fm["your-key"]` automatically. No changes to `normalizeFm` needed unless the nested key name differs from the flat key name — in that case add an alias mapping in `normalizeFm`.
   - Clamp numeric values. Validate string enums against a `Set`. Use a helper function for complex validation (see `parseAspectRatio`, `parseFit`).
   - Never throw; always fall back to the safe default.

5. **`renderer.ts`**
   Consume `config.yourField` where appropriate (in `buildCardPreview`, `buildCard`, `buildSection`, or `renderFolderCards`).

6. **`file-browser.plugin.ts` — `FOLDER_VIEW_STARTER`**
   Add the field with its default value and an inline comment showing valid options. Place it inside the `layout:` block array (between `"  type: folder-cards"` and `"---"`).

7. **`tests/folder-view/parser.test.ts`**
   Add at minimum three tests:
   - Valid value → parsed correctly
   - Invalid / out-of-range value → falls back to default
   - Absent → default applied

8. **`tests/folder-view/renderer.test.ts`** *(if the field affects DOM output)*
   Add tests asserting the expected DOM change (class, inline style, text content, element presence).

9. **Verify:**
   ```bash
   npm run test:run -- tests/folder-view/   # must be all green
   npm run build:plugins && npm run sync:plugins
   ```

10. **STARTER sync check:**
    The `FOLDER_VIEW_STARTER` in `file-browser.plugin.ts` and the hardcoded STARTER string in `tests/folder-view/context-menu.test.ts` (`FR-36` test) must match. The test uses `_testing.FOLDER_VIEW_STARTER` directly — no manual sync needed as long as step 6 was done correctly.

---

## Architecture Notes

- **Parser is flat after normalisation.** The nested `layout:` YAML block is flattened to top-level keys by `normalizeFm()` in `parser.ts` before any field is read. The flat format (e.g. `layout: folder-cards` at the top level) is supported for backwards compatibility.
- **`_folder.md` is excluded from the card grid.** `collectChildren()` in `tab.ts` filters it out (FR-23).
- **Live reload.** Saving `_folder.md` triggers the vault FS watcher → `_indexUpdatedCb` → immediate re-render if the tab is active; stale-flag deferred re-render if inactive.
- **Single registered layout.** `LAYOUT_RENDERERS` in `tab.ts` maps `"folder-cards"` → `renderFolderCards`. New layouts are added by registering a new key in that Record.

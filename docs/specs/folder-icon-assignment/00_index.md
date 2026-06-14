---
title: "Folder Icon Assignment — Master Blueprint"
last-updated: "2026-06-05"
review-cadence-days: 14
status: active
---

## Re-review Patch (Lead Developer — 2026-06-05, second pass)

Code Reviewer flagged three issues after the first-pass implementation; all
three have been addressed surgically (no new features, no refactors):

1. **CRITICAL** — `stripScripts()` in `src/plugins/file-browser/folder-view/shared.ts`
   missed whitespace-separated and unquoted event handler attributes. Regexes
   now match any whitespace OR `/` before `on*=` and handle quoted +
   unquoted attribute values.
2. **Related** — `javascript:` URL-scheme regex in
   `src/plugins/file-browser/folder-icon-custom-cache.ts:114` now matches
   `=`/`>` as leading delimiters too, so unquoted `href=javascript:...`
   is sanitised.
3. **MEDIUM** — `src/plugins/file-browser/folder-icon-picker.ts:338` now
   passes `TextEncoder.encode(content).length` (UTF-8 byte count) to
   `validateSvgFile`, matching the validator's documented byte-length
   contract. Prevents multibyte-UTF-8 SVGs from bypassing the 32 KB cap.

Seven new tests pin these post-fix behaviours (see Edge cases section below).

## Implementation Status (Lead Developer — 2026-06-05)

All step files implemented under strict TDD. Window-size invariant verified
green after every Rust + settings edit.

- [x] step_01_catalog.md — 16 tests passing
- [x] step_02_css.md — 3 tests passing
- [x] step_03_yaml_store.md — 16 tests passing
- [x] step_04_rust_icon_map.md — 8 cargo tests + 2 frontend tests passing
- [x] step_05_tree_wiring.md — 23 frontend tests passing (render + index-flow + custom-render)
- [x] step_06b_svg_validator.md — 8 tests passing
- [x] step_06c_custom_settings.md — 8 tests passing
- [x] step_06_picker.md — 12 tests passing
- [x] step_07_context_menu.md — 3 tests passing

Totals: **98 folder-icon tests + 4481 full frontend + 212 cargo — all green**
(post re-review patch; +7 tests vs. first-pass count).

## Review Request

- **Files changed**:
  - `src/plugins/file-browser/folder-icons.ts` (new — catalog + resolver)
  - `src/plugins/file-browser/folder-icon-store.ts` (new — YAML store + buildFolderIconMap)
  - `src/plugins/file-browser/folder-icon-custom-cache.ts` (new — sanitised SVG cache)
  - `src/plugins/file-browser/folder-icon-custom-settings.ts` (new — cross-vault list helper)
  - `src/plugins/file-browser/folder-icon-picker.ts` (new — modal picker)
  - `src/plugins/file-browser/svg-validator.ts` (new — add-time validator)
  - `src/plugins/file-browser/file-tree.ts` (edit — folderIconMap parameter + TreeNode.iconCustomPath + getFolderIconClass re-export)
  - `src/plugins/file-browser/file-browser.plugin.ts` (edit — refreshFolderIconMap, injectCustomFolderIcons, appendIconAndLabel variant branch, "Set folder icon…" menu entry)
  - `src/plugins/file-browser/file-browser.css` (edit — 24 folder-icon-* selectors + folder-icon-custom + picker chrome)
  - `src/lib/bridge.ts` (edit — readFolderIconMap + statFile wrappers)
  - `src/lib/settings.ts` (edit — CustomIconEntry interface + customFolderIcons field + default. NO window changes.)
  - `src-tauri/src/commands/folder_icon.rs` (new — read_folder_icon_map + stat_file)
  - `src-tauri/src/commands/mod.rs` (edit — pub mod folder_icon)
  - `src-tauri/src/lib.rs` (edit — invoke_handler list + re-export. NO window-launch changes.)
  - `tests/folder-icons/catalog.test.ts` (new)
  - `tests/folder-icons/css.test.ts` (new)
  - `tests/folder-icons/store.test.ts` (new)
  - `tests/folder-icons/bridge-icon-map.test.ts` (new)
  - `tests/folder-icons/render.test.ts` (new)
  - `tests/folder-icons/index-flow.test.ts` (new)
  - `tests/folder-icons/custom-render.test.ts` (new)
  - `tests/folder-icons/svg-validator.test.ts` (new)
  - `tests/folder-icons/custom-settings.test.ts` (new)
  - `tests/folder-icons/picker.test.ts` (new)
  - `tests/folder-icons/context-menu.test.ts` (new)
  - `docs/specs/folder-icon-assignment/00_index.md` (this file — status + handoff)
- **Steps completed**: step_01 → step_02 → step_03 → step_04 → step_05 → step_06b → step_06c → step_06 → step_07.
- **Known limitations / deviations**:
  - DW-12 (no `--danger-color` token): picker chrome uses `var(--error-color)` instead. The CSS-no-hex test was specifically targeted at the catalog `.folder-icon-*` rules; the picker chrome rules pass because they bind to existing canonical tokens.
  - Picker's Custom-section ordering is owned by `getCustomIcons()` (sorted by `addedAt` desc — unit-tested in custom-settings.test.ts). Picker iterates in returned order; the picker test mocks `getCustomIcons` and trusts the mock order rather than re-sorting in the picker.
  - SVG glyph data sourced inline from Material Symbols Outlined (Apache 2.0) — same family already shipped under `icons/material/`. No new asset directory introduced.
  - Per the Architect's §1.8 single-field disambiguation: `_folder.md icon:` accepts both catalog iconIds and absolute SVG paths; the resolver does the disambiguation, and the store layer is opaque to the kind.
- **Edge cases covered by tests**:
  - EC-1 (unassigned folder → generic glyph): render.test.ts, store.test.ts
  - EC-2 (`_folder.md` without icon: → generic): store.test.ts
  - EC-3 (unrecognised iconId → fallback): catalog.test.ts, render.test.ts
  - EC-4 (image-path-shaped bare filename → fallback): catalog.test.ts, render.test.ts
  - EC-5 (empty string → fallback): catalog.test.ts, store.test.ts, render.test.ts
  - EC-6 (apply on folder without `_folder.md` creates one): store.test.ts
  - EC-7 (remove cleanly deletes icon: line): store.test.ts
  - EC-8 (remove preserves unrelated frontmatter): store.test.ts
  - EC-9 (picker highlights current selection — catalog AND custom): picker.test.ts
  - EC-10 (concurrent Apply → button disabled while in flight): picker.test.ts, store.test.ts
  - EC-11 (malformed YAML → overwritten with fresh block): store.test.ts
  - EC-12 / EC-13 (rename/move → icon travels): index-flow.test.ts
  - EC-14 (delete → map drops entry): index-flow.test.ts
  - EC-15 (window invariant): tests/settings/window-defaults.test.ts (existing; verified green throughout)
  - EC-16 (custom SVG missing → fallback + one-time toast registry): custom-render.test.ts
  - EC-17 (custom SVG with `<script>` / `onclick` / `javascript:` / `<foreignObject>` → sanitised): custom-render.test.ts
    - Re-review patch: stripScripts now also strips event handlers separated
      by newline, tab, unquoted values, and mixed whitespace + quoting forms
      (4 new tests). `javascript:` regex covers unquoted `href=javascript:...`
      (1 new test).
  - EC-18 (Add custom SVG rejects parse error / non-SVG): svg-validator.test.ts, picker.test.ts
  - EC-19 (Add custom SVG rejects > 32 KB): svg-validator.test.ts, picker.test.ts
    - Re-review patch: validator test now covers multibyte UTF-8 content where
      JS string length < cap but UTF-8 byte length > cap. Picker test pins
      `TextEncoder` byte-length is passed to `validateSvgFile` (2 new tests).
  - EC-20 (100-entry cap → refuse-add): custom-settings.test.ts, picker.test.ts
  - EC-21 (Remove from Custom does NOT touch `_folder.md`): custom-settings.test.ts
  - EC-22 (paths with spaces / unicode / `:` round-trip): store.test.ts, cargo folder_icon::tests
  - EC-23 (catalog iconId vs path disambiguation precedence): catalog.test.ts, render.test.ts

# Folder Icon Assignment — Master Blueprint

> **Requirements source:** `docs/requirements/active_task.md`
> **Downstream consumer:** `docs/requirements/collections_mvp_parked.md` (amendment #3)
> **Output of:** Software Architect (no implementation in this folder)
>
> **Amendment 2026-06-05 (custom SVG references).** Following the
> Requirements Analyst's amendment that added FR-12…FR-18 and EC-16…
> EC-23, this blueprint is amended to:
> 1. Lock the frontmatter disambiguation strategy (see §1.8 below).
> 2. Add two new step files (`step_06b_svg_validator.md`,
>    `step_06c_custom_settings.md`) before the picker step.
> 3. Revise `step_03`, `step_05`, and `step_06` for the new value
>    shape, render path, and picker layout.
> 4. Extend the test inventory from 15 → 23 entries.
> Existing decisions (inline-SVG catalog, CSS-class derivation, single
> `read_folder_icon_map` Rust command, atomic frontmatter writes, window
> invariant) are preserved verbatim.

This blueprint is the contract between the Architect and the Lead
Developer. Each numbered step file in this directory is a self-contained
TDD unit (Red → Green → Refactor). The Developer follows them in order.
Earlier steps do not forward-reference later steps.

---

## 1. Stack Decision

The stack is **locked by the existing project**: Tauri v2 (Rust backend)
+ TypeScript + CodeMirror 6 + Vite + Vitest. No new technology is
introduced by this feature.

### What this feature reuses (no alternatives evaluated)

| Concern | Reused mechanism | Why |
|---|---|---|
| Atomic file writes | `atomic_write()` in `src-tauri/src/commands/file_ops.rs` exposed via the existing `write_file` Tauri command and `writeFile()` bridge wrapper | Already implements temp-file-swap with `sync_all` + `rename` (CLAUDE.md NFR). No new Rust command is required. |
| YAML frontmatter parse / mutate | `parseYamlFrontmatter`, `applyYamlKey`, `removeYamlKey`, `reconstructFile` in `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` | Battle-tested by folder-view; preserves unrelated keys byte-for-byte (EC-8). |
| Folder metadata read | `parseFolderMd()` in `src/plugins/file-browser/folder-view/parser.ts` (line 599 already extracts `icon`) | C-3 in requirements forbids forking the parser. |
| Folder-set scan over the vault index | `buildFolderViewSet()` in `folder-view/detection.ts` | Exact pattern we mirror for the iconId scan (NFR-2: no per-render file I/O). |
| Modal UI shell | `settings-overlay / settings-panel / settings-footer / sf-modal-*` classes used by `smart-folders/editor-ui.ts` and `lib/modal-keyboard.ts` | Memory `feedback_look_first` and `feedback_global_form_controls` mandate reuse of existing modal chrome. |
| Context menu | `showContextMenu()` + `buildDirContextMenuItems()` in `file-browser.plugin.ts` (lines 2854 / 3004) | Already drives every right-click action in the tree. Adding one item is a single-line insert. |
| Icon class → render | `appendIconAndLabel()` in `file-browser.plugin.ts` (line 1310–1331) | The renderer already maps `node.iconClass` through `_iconSet.folder()`. We replace the input to that mapping. |
| Bridge layer | `src/lib/bridge.ts` typed `FileResult<T>` wrappers (`readFile`, `writeFile`) | No new Tauri command. C-4 is satisfied by reusing these. |

### Decisions resolved by the Architect (not in requirements)

The requirements doc left seven design decisions to the Architect.
Resolved as follows:

1. **Icon catalog format** — Inline SVG path strings as TypeScript
   constants in a single `folder-icons.ts` module. No external `.svg`
   asset files, no sprite sheet. Rationale: the catalog is ~24 small
   glyphs; the inline-string pattern matches `panel-icons.ts` / the
   existing `ICON_*` SVG constants in `file-browser.plugin.ts`. Plugin
   IIFE builds cannot import `.svg` files cleanly.
2. **iconId → CSS class resolution** — `getFolderIconClass(iconId)`
   mirrors `getVaultIconClass()` exactly: a static `ICON_MAP` record,
   `ICON_MAP[iconId] ?? "folder-icon"` fallback (FR-5, EC-3, EC-5).
   Default-fallback string is **literally** `"folder-icon"` so today's
   CSS rule continues to match (NFR-1).
3. **iconId vs cover-path disambiguation (EC-4)** — `getFolderIconClass`
   returns the generic `"folder-icon"` when the `icon` field's value is
   not a known catalog id. Image paths (`cover.png`, `./art.jpg`, an
   absolute path) and emoji land in the fallback branch, so the tree
   never tries to render them. The existing parser still extracts the
   raw value; downstream cover-image consumers (folder-view bookshelf
   covers) keep working unchanged.
4. **`icon:` removal semantics** — On "Remove icon", the YAML key is
   **deleted** via `removeYamlKey()` rather than set to `""`. Deletion
   yields the cleanest diff and avoids EC-5's ambiguous empty-string
   state in saved files (EC-7).
5. **No new Rust command** — The atomic write goes through the existing
   `writeFile()` bridge wrapper. The TS side does: read file → parse
   frontmatter → mutate → reconstruct → write. This is consistent with
   how layout assignment already mutates `_folder.md` (no precedent for
   a granular `set_folder_icon` Rust command). C-4 is satisfied because
   no new Tauri call is added.
6. **Folder-icon map surfacing** — Implemented as a pure-TS post-pass
   that reads only the file we are about to render. We do NOT extend
   the Rust `build_vault_index` payload. Rationale: (a) NFR-2 forbids
   render-path file I/O, but a **build-time** pre-pass over `_folder.md`
   entries already present in the index is permitted; (b) the file
   browser already runs `buildFolderViewSet()` once per `renderPanel`
   over the same entries; we add an `buildFolderIconMap()` sibling that
   reuses the same scan boundary. Concretely: a Rust helper
   `read_folder_icon_map(folder_md_paths: Vec<String>)` reads the
   first ~512 bytes of each file once per render and returns the parsed
   `icon` field. This keeps the cost O(K) where K is the number of
   `_folder.md` files (typically ≤ tens), runs off the render hot path
   via `await` before `renderTreeContent()` returns, and avoids
   round-tripping each file through the JS bridge individually.
7. **Cache invalidation after Apply** — The picker's Apply handler
   calls `vault-manager.reloadVaultIndex()` (the established pattern
   used by `deleteFile`, `renameDirectory`, etc.). The vault-changed
   listener already re-runs `renderPanel`, which re-runs the icon map
   scan and re-renders the tree with the new `iconClass`. Expansion
   state and scroll position are preserved by the existing render
   pipeline (NFR-3).
8. **Frontmatter disambiguation for custom SVG paths (FR-12)** —
   **Single `icon:` field, value-shape disambiguation.** The
   renderer interprets `<value>` with this strict precedence:
   1. **Catalog hit** — if `<value>` is a known catalog iconId
      (lookup in the `ICON_MAP` introduced in step_01), render
      `folder-icon-<id>` and stop. No file resolution attempted.
   2. **Custom-SVG path** — else, if `<value>` contains `/` or
      `\` **or** ends with the `.svg` suffix (case-insensitive),
      treat it as an absolute file-system path and route through
      the custom-SVG render path (step_05 §C2: read → sanitize →
      cache-by-path+mtime → inject inline).
   3. **Fallback** — otherwise, render the generic `folder-icon`
      class. A debug-level console log records the unrecognised
      value; no toast, no error (EC-3 contract preserved).

   **Rationale.** The two-namespace concern raised by FR-12 is
   neutered by the catalog's own naming convention: every catalog
   iconId is a short kebab-case slug (`book`, `lightbulb`,
   `folder-open`) — never contains a path separator, never ends
   in `.svg`. Collision between a curated iconId and a user
   filename is therefore impossible. Adding a sibling `iconPath:`
   field would force a frontmatter schema migration (writer
   choice: which field to emit?) and complicate every reader for
   zero ergonomic benefit. The single-field approach also lets
   Collections (the downstream consumer) keep using
   `parseFolderMd().icon` as a black-box string and let
   `getFolderIconClass` / the renderer interpret it.

   **`getFolderIconClass` becomes a discriminating resolver.**
   Step_01 already returns `"folder-icon-<id>" | "folder-icon"`.
   In the amendment, it gains a third return shape — `"folder-icon-custom"`
   sentinel — that the renderer interprets as "treat as path,
   inject inline SVG out-of-band". The map-builder
   (`buildFolderIconMap`, step_05) stores the raw string value so
   the tree-builder can pass it both to the resolver (for class
   choice) and the custom-SVG cache (for path resolution). See
   §3 "Resolver contract" for the precise function signatures.

---

## 2. System Decomposition

```
┌────────────────────────────────────────────────────────────────────┐
│  RIGHT-CLICK A FOLDER                                              │
│    └─> "Set folder icon…"   (file-browser.plugin.ts ctx menu)      │
│           └─> openFolderIconPicker(folderPath)                     │
│                  └─> folder-icon-picker.ts (modal)                 │
│                         ├─ Grid renders catalog from FOLDER_ICONS  │
│                         │    (folder-icons.ts)                     │
│                         ├─ Apply  →  setFolderIcon(path, iconId)   │
│                         └─ Remove →  setFolderIcon(path, undefined)│
│                                                                    │
│  setFolderIcon  (folder-icon-store.ts)                             │
│    1. readFile(_folder.md)         (existing bridge.ts)            │
│    2. parseYamlFrontmatter()       (yaml-frontmatter.ts)           │
│    3. applyYamlKey / removeYamlKey (yaml-frontmatter.ts)           │
│    4. reconstructFile()                                            │
│    5. writeFile(_folder.md, ...)   (atomic temp-file-swap)         │
│    6. vault-manager.reloadVaultIndex()                             │
│                                                                    │
│  RENDER PATH (renderTreeContent)                                   │
│    1. buildFolderViewSet(vaultIndex)        existing               │
│    2. NEW: await buildFolderIconMap(folderViewSet)                 │
│            ├─ Rust: read_folder_icon_map(paths)  (new command)     │
│            └─ Returns Map<dirPath, iconId | undefined>             │
│    3. buildTreeFromIndex(... folderIconMap)                        │
│            ├─ For each directory node, set                         │
│            │   iconClass = getFolderIconClass(folderIconMap.get(p))│
│    4. buildTreeUl renders nodes                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Components introduced

| New file | Responsibility |
|---|---|
| `src/plugins/file-browser/folder-icons.ts` | Catalog (iconId → CSS class + label + inline SVG). Single source of truth. Exports `FOLDER_ICONS: readonly FolderIconDef[]`, `getFolderIconClass(iconValue?: string): string`, and `interpretIconValue(iconValue?: string): IconValueKind`. |
| `src/plugins/file-browser/folder-icon-store.ts` | Read/write the `icon` field in `_folder.md` atomically. Exports `readFolderIcon(folderPath)`, `setFolderIcon(folderPath, iconValue)`, and `buildFolderIconMap(folderMdPaths)`. `iconValue` may be a catalog iconId **or** an absolute SVG path (FR-12). |
| `src/plugins/file-browser/folder-icon-picker.ts` | Modal UI. Curated grid + Custom section + "Add custom SVG…". Exports `openFolderIconPicker(folderPath, opts)`. |
| `src/plugins/file-browser/svg-validator.ts` *(new — step_06b)* | Pure-TS validator. Exports `validateSvgFile(svgText, byteLength): ValidationResult`. DOMParser-based; size cap 32 KB; root must be `<svg>`. Does **not** mutate or sanitise — sanitization happens at render time (FR-15/FR-16 split). |
| `src/plugins/file-browser/folder-icon-custom-cache.ts` *(new — step_05 §C2)* | In-memory cache for custom SVG render bodies. Key = `path + mtimeMs`; value = sanitized HTML string. Reuses `stripScripts()` plus SVG-specific extras (see step_05 §C2 sanitisation note). |
| `src-tauri/src/commands/folder_icon.rs` | One new Rust command: `read_folder_icon_map(paths: Vec<String>) -> Vec<(String, Option<String>)>`. Reads first ≤4096 bytes of each `_folder.md`, scans for `icon:` line. No writes. Returns the raw value string verbatim — TS interprets catalog-vs-path. |
| `tests/folder-icons/catalog.test.ts` | Asserts catalog shape, CSS rules per id, `interpretIconValue()` precedence (EC-3, EC-4, EC-5, EC-23). |
| `tests/folder-icons/store.test.ts` | EC-2, EC-3, EC-5, EC-6, EC-7, EC-8, EC-10, EC-11, EC-22 (unicode/whitespace paths round-trip). |
| `tests/folder-icons/render.test.ts` | EC-1, EC-3, EC-4, EC-5, EC-23 — `getFolderIconClass()` + integration with `buildTreeFromIndex`. |
| `tests/folder-icons/custom-render.test.ts` *(new — step_05 §C2)* | EC-16 (missing path → fallback + one-time toast), EC-17 (XSS sanitisation), custom-cache hit/miss behaviour. |
| `tests/folder-icons/svg-validator.test.ts` *(new — step_06b)* | EC-18 (invalid SVG rejected), EC-19 (>32 KB rejected), happy path acceptance. |
| `tests/folder-icons/custom-settings.test.ts` *(new — step_06c)* | EC-20 (100-entry cap, refuse-add), EC-21 (Remove from Custom does not break existing folder assignments). |
| `tests/folder-icons/picker.test.ts` | EC-9 — picker highlights current selection. Also covers Custom-section rendering and "Add custom SVG…" flow end-to-end (mocked file dialog + validator). |
| `tests/folder-icons/index-flow.test.ts` | EC-12, EC-13, EC-14 — rename / move / delete propagation. |

### Existing files modified

| File | Nature of change |
|---|---|
| `src/plugins/file-browser/file-tree.ts` | Add `getFolderIconClass` re-export so importers can stay path-symmetric with `getVaultIconClass`. Add optional `folderIconMap?: Map<string, string>` parameter to `buildTreeFromIndex` and thread it into both directory creation sites (replaces the two hardcoded `"folder-icon"` literals at lines 313 + 344). The map stores the **raw** icon value (catalog iconId OR absolute path); the resolver disambiguates per §1.8. |
| `src/plugins/file-browser/file-browser.plugin.ts` | (a) In `renderTreeContent`, after `buildFolderViewSet`, `await buildFolderIconMap(folderViewSet)` and pass into `buildTreeFromIndex`. (b) After the tree DOM mounts, walk nodes whose iconValue is a custom path and inject the inline SVG body from `folder-icon-custom-cache.ts` (out-of-band — render hot path never reads files, NFR-2). (c) In `buildDirContextMenuItems`, insert a new menu entry **"Set folder icon…"** above the separator that precedes "Reveal in Finder". |
| `src/plugins/file-browser/folder-view/parser.ts` | **No code change.** The existing `icon` extraction at line 599 is reused as-is. The parser returns the raw value verbatim; downstream consumers (tree renderer, cover-image consumer) interpret it per their own contract. |
| `src/plugins/file-browser/folder-view/shared.ts` | **Confirmed: no edit needed.** Inspection of `stripScripts()` (line 81) shows it already removes both `<script>` blocks AND inline `on*="…"` / `on*='…'` attributes (regex on lines 83–85). FR-15's call for an extension is satisfied by the existing implementation. **However**: the custom-SVG render path adds two SVG-specific sanitisation passes in `folder-icon-custom-cache.ts` that `stripScripts()` does not cover (see step_05 §C2): `javascript:` URL schemes in `href` / `xlink:href`, and `<foreignObject>` removal. These extras live in the cache module, not in `shared.ts`. |
| `src/lib/settings.ts` | Add `customFolderIcons?: Array<{ path: string; label: string; addedAt: number }>` to `MarkableSettings` (default `[]`). **DO NOT touch** `window.sizeW` (`"50%"`) or `window.sizeH` (`"80%"`) — NFR-5 / EC-15 invariant. |
| `src/lib/dialogs.ts` | **No new dialog wrapper introduced.** Reuse the existing `openAssetDialog()` (line 86) which already filters to images **and SVG** (`add_filter("Images & SVG", &[…, "svg"])`). The TS-side validator (step_06b) then enforces SVG-only after the user picks a file. Rationale: extending `openFileDialog()` to take an extensions argument is more invasive than reusing a wrapper that already accepts SVG; the post-pick validator rejects any non-SVG file cleanly with the EC-18 toast. **No Rust dialog command change required.** |
| `src/lib/bridge.ts` | Add one typed wrapper: `readFolderIconMap(paths: string[]): Promise<FileResult<Array<[string, string \| null]>>>` calling `read_folder_icon_map`. Also add `statFile(path: string): Promise<FileResult<{ mtimeMs: number; size: number }>>` if a `stat_file` Rust command is required for the path-keyed custom-SVG cache (FR-17). If existing `readFile` already returns mtime as part of its result, reuse instead — Architect verifies during step_05 implementation. |
| `src-tauri/src/lib.rs` | Register `read_folder_icon_map` (and `stat_file` if added) in the invoke handler. **Window-size code is NOT touched** (NFR-5, EC-15). |
| `src-tauri/src/commands/mod.rs` | `pub mod folder_icon;` plus a re-export of `read_folder_icon_map`. |
| `src-tauri/src/commands/dialogs.rs` | **No change.** `open_asset_dialog` already accepts SVG (line 189). See `src/lib/dialogs.ts` row above. |
| `src/styles.css` (or a co-located `folder-icons.css` imported from `file-browser.css`) | Add `~24 .folder-icon-<id>` CSS rules using theme tokens. Co-located with the existing `.folder-icon` rule. Also add `.folder-icon-custom` (parent class for custom SVG slots) and any picker-specific selectors. |

### Files explicitly NOT touched

- `src/lib/settings.ts` (window-size invariant, NFR-5/EC-15)
- `src-tauri/src/lib.rs` window-launch hook (NFR-5/EC-15)
- `vault-manager.ts` (icon map is computed in the render path, not via
  the vault index payload — keeps the index pure-data)
- `parser.ts` (C-3)

---

## 3. Data Model

### Frontmatter contract

```yaml
---
layout: bookshelf       # unrelated key — must be preserved verbatim (EC-8)
sort: name-asc          # unrelated key — must be preserved verbatim
icon: book              # CATALOG iconId form
---
```

```yaml
---
icon: /Users/dave/Pictures/glyphs/notion-page.svg   # CUSTOM PATH form
---
```

`icon: <value>` is interpreted by the **renderer** with this precedence
(see §1.8 for rationale):

1. **Catalog hit** — `<value>` matches a known catalog iconId →
   render `folder-icon-<id>` class. No file resolution attempted.
2. **Custom-SVG path** — `<value>` contains `/` or `\` OR ends in
   `.svg` (case-insensitive) → routed through the custom-SVG render
   path: read file → validate at add-time / verify-on-render →
   sanitize → inject inline SVG. Cached by `(path, mtimeMs)` (FR-17).
3. **Fallback** — render generic `folder-icon` class (EC-3, EC-4).

Cover-image consumers (folder-view bookshelf) continue to read the raw
value via `parseFolderMd()` and apply their own semantics unchanged.

### Resolver contract

```typescript
// folder-icons.ts (amended in step_01)

export type IconValueKind =
  | { kind: "catalog"; id: string; cssClass: string }   // catalog hit
  | { kind: "custom";  path: string; cssClass: "folder-icon-custom" }  // path
  | { kind: "fallback"; cssClass: "folder-icon" };       // EC-3 / EC-5 / etc.

/**
 * Discriminate the raw `icon:` string per §1.8 precedence.
 * Pure function; no I/O. The caller (tree builder / picker) decides
 * what to render based on the kind.
 */
export function interpretIconValue(value?: string): IconValueKind;

/**
 * Legacy convenience — returns the CSS class only. Equivalent to
 * `interpretIconValue(v).cssClass`. Kept so existing call sites
 * (file-tree.ts:313, :344) need no refactor in step_05.
 */
export function getFolderIconClass(value?: string): string;
```

### Catalog shape

```typescript
export interface FolderIconDef {
  /** Stable iconId persisted in _folder.md. Lowercase kebab-case. */
  readonly id: string;
  /** User-facing label shown as a tooltip in the picker grid. */
  readonly label: string;
  /** Inline SVG path/markup. No <svg> wrapper — caller wraps for size. */
  readonly svg: string;
}

export const FOLDER_ICONS: readonly FolderIconDef[] = [
  { id: "folder",      label: "Folder",     svg: "..." },
  { id: "folder-open", label: "Folder (open)", svg: "..." },
  { id: "book",        label: "Book",       svg: "..." },
  { id: "bookshelf",   label: "Bookshelf",  svg: "..." },
  { id: "notebook",    label: "Notebook",   svg: "..." },
  { id: "lightbulb",   label: "Idea",       svg: "..." },
  { id: "target",      label: "Goal",       svg: "..." },
  { id: "calendar",    label: "Calendar",   svg: "..." },
  { id: "inbox",       label: "Inbox",      svg: "..." },
  { id: "archive",     label: "Archive",    svg: "..." },
  { id: "code",        label: "Code",       svg: "..." },
  { id: "terminal",    label: "Terminal",   svg: "..." },
  { id: "database",    label: "Database",   svg: "..." },
  { id: "image",       label: "Image",      svg: "..." },
  { id: "film",        label: "Film",       svg: "..." },
  { id: "music",       label: "Music",      svg: "..." },
  { id: "pencil",      label: "Pencil",     svg: "..." },
  { id: "tag",         label: "Tag",        svg: "..." },
  { id: "flag",        label: "Flag",       svg: "..." },
  { id: "star",        label: "Star",       svg: "..." },
  { id: "heart",       label: "Heart",      svg: "..." },
  { id: "clipboard",   label: "Clipboard",  svg: "..." },
  { id: "briefcase",   label: "Briefcase",  svg: "..." },
  { id: "house",       label: "Home",       svg: "..." },
];
```

24 entries. The CSS class for iconId `book` is `folder-icon-book`. The
generic fallback class name `folder-icon` is reserved for the unassigned
case and is **not** an entry in the catalog (it remains as today's
default in CSS).

### Rust DTO (new)

```rust
// src-tauri/src/commands/folder_icon.rs
#[tauri::command]
pub async fn read_folder_icon_map(
    paths: Vec<String>,  // absolute paths to _folder.md files
) -> Result<Vec<(String, Option<String>)>, String>
// Returns: (path, Some(icon_value) | None) for each input path.
// Reads ≤512 bytes per file (frontmatter only). On read error or
// missing/malformed frontmatter, returns None for that entry rather
// than failing the whole batch.
```

### TS bridge wrapper (new)

```typescript
// src/lib/bridge.ts
export async function readFolderIconMap(
  paths: string[]
): Promise<FileResult<Array<[string, string | null]>>>
```

---

## 4. Implementation Roadmap

Order is strict — each step compiles and tests green independently.

1. **`step_01_catalog.md`** — Build `folder-icons.ts` catalog + the pure
   `interpretIconValue()` discriminator and `getFolderIconClass()`
   convenience resolver. No DOM. No I/O. Pure TDD: write
   `tests/folder-icons/catalog.test.ts` first. Catalog test now also
   covers EC-23 (catalog vs path disambiguation).
2. **`step_02_css.md`** — Add the 24 `.folder-icon-<id>` CSS rules to
   `src/styles.css` (or a co-located `folder-icons.css` imported by
   `file-browser.css`). Theme tokens only. Also add the
   `.folder-icon-custom` parent class used by the inline-injection
   pass in step_05.
3. **`step_03_yaml_store.md`** — Build `folder-icon-store.ts` with
   `readFolderIcon()` and `setFolderIcon()`. Uses existing
   `yaml-frontmatter.ts` + bridge `readFile` / `writeFile`. **iconValue
   is now `string | undefined` with no shape restriction** — the store
   does not validate catalog membership (that's the resolver's job).
   Custom-path values (absolute paths with spaces, unicode, etc.) are
   stored verbatim. Covers EC-6, EC-7, EC-8, EC-10, EC-11, EC-22.
4. **`step_04_rust_icon_map.md`** — Add the `read_folder_icon_map` Rust
   command + `readFolderIconMap` bridge wrapper. Returns raw value
   strings. Cargo tests cover missing files, malformed frontmatter,
   mixed valid/invalid batches, and **path-shaped values** (round-trip
   `/Users/dave/My Icons/café.svg` through the reader, EC-22).
5. **`step_05_tree_wiring.md`** — Wire `buildFolderIconMap()` (TS
   wrapper over the bridge call) into `renderTreeContent`. Extend
   `buildTreeFromIndex` with an optional `folderIconMap` parameter,
   replace the two hardcoded `"folder-icon"` literals. **Adds the
   custom-SVG post-mount injection pass** (folder-icon-custom-cache.ts)
   — for any node whose iconValue resolves to a custom path, read +
   sanitise + cache by (path, mtimeMs) and replace the `.folder-icon-custom`
   slot's contents with inline SVG. Covers EC-1, EC-2, EC-3, EC-4,
   EC-5, EC-16, EC-17, EC-23.
6. **`step_06b_svg_validator.md`** *(NEW — amendment)* — Build
   `svg-validator.ts`. Pure TS, no I/O, no DOM mutation. DOMParser-
   based: size ≤ 32 KB, root must be `<svg>`, no `parsererror`. Returns
   a typed `ValidationResult`. Covers EC-18, EC-19.
7. **`step_06c_custom_settings.md`** *(NEW — amendment)* — Add
   `customFolderIcons` to `MarkableSettings`. Implement add/remove
   helpers (`addCustomIcon`, `removeCustomIcon`, `getCustomIcons`) in a
   small `folder-icon-custom-settings.ts` module that piggybacks on
   the existing `updateSettings()` pathway (no new Rust command).
   Refuse-add at 100-entry cap (FR-18, EC-20). Covers EC-20, EC-21.
8. **`step_06_picker.md`** — Build `folder-icon-picker.ts` modal using
   the `settings-overlay` / `settings-panel` shell. **Amended layout**:
   curated grid → divider → "Custom" section listing each entry in
   `settings.customFolderIcons` (per-entry "× Remove from Custom"
   affordance) → "Add custom SVG…" button at the bottom. Add button
   calls `openAssetDialog()` → reads file via `readFile()` → calls
   `validateSvgFile()` → on pass, calls `addCustomIcon()` and selects
   the new path. Apply commits via `setFolderIcon(folderPath, value)`.
   Reuses `attachModalKeyboard()`. Covers EC-9 plus the picker side of
   EC-18, EC-19, EC-20.
9. **`step_07_context_menu.md`** — Insert "Set folder icon…" entry
   into `buildDirContextMenuItems`. **No change from original spec** —
   the picker is what changed, the entry point is unchanged. End-to-
   end wire-up. Covers EC-12, EC-13, EC-14 via the existing
   `reloadVaultIndex` pathway, plus EC-15 (window-size regression
   test still passes).

> Steps 1–4 are independent and could in principle run in parallel.
> Steps 6b and 6c are also independent of each other (one is a
> pure-TS validator, the other is settings I/O) and could be done in
> parallel — but the picker (step_06) depends on both. The Developer
> follows them serially anyway to keep PR review tractable.

### Step-dependency graph

```
step_01 (catalog + resolver)
   │
   ├── step_02 (CSS)
   │
   ├── step_03 (YAML store) ──┐
   │                          │
   └── step_04 (Rust map) ────┼── step_05 (tree wiring + custom-cache)
                              │       │
                              │       ├── step_06b (svg-validator)  ┐
                              │       │                              │
                              │       └── step_06c (custom-settings)┤
                              │                                      │
                              └────────────────────────── step_06 (picker)
                                                              │
                                                              └── step_07 (ctx menu)
```

---

## 5. Test Inventory — EC → test file

| EC | Description | Test file(s) | Step |
|---|---|---|---|
| EC-1 | Unassigned folder → generic `folder-icon` | `tests/folder-icons/render.test.ts` | 5 |
| EC-2 | `_folder.md` exists but no `icon:` field | `tests/folder-icons/store.test.ts`, `render.test.ts` | 3, 5 |
| EC-3 | Unrecognized iconId → fallback to `folder-icon` | `tests/folder-icons/catalog.test.ts`, `render.test.ts` | 1, 5 |
| EC-4 | `icon: cover.png` (image path) → fallback in tree | `tests/folder-icons/render.test.ts` | 5 |
| EC-5 | `icon: ""` (empty string) → fallback | `tests/folder-icons/catalog.test.ts`, `store.test.ts` | 1, 3 |
| EC-6 | Apply on folder without `_folder.md` creates one with only `icon:` | `tests/folder-icons/store.test.ts` | 3 |
| EC-7 | Remove icon: cleanly deletes the `icon:` line | `tests/folder-icons/store.test.ts` | 3 |
| EC-8 | Remove icon preserves unrelated frontmatter | `tests/folder-icons/store.test.ts` | 3 |
| EC-9 | Picker highlights current selection | `tests/folder-icons/picker.test.ts` | 6 |
| EC-10 | Concurrent Apply: button disabled, atomic write | `tests/folder-icons/picker.test.ts`, `store.test.ts` | 3, 6 |
| EC-11 | Malformed YAML → store overwrites with fresh frontmatter | `tests/folder-icons/store.test.ts` | 3 |
| EC-12 | Folder renamed externally → icon travels | `tests/folder-icons/index-flow.test.ts` | 5, 7 |
| EC-13 | Folder moved externally → icon travels | `tests/folder-icons/index-flow.test.ts` | 5, 7 |
| EC-14 | Folder deleted externally → icon map drops entry | `tests/folder-icons/index-flow.test.ts` | 5 |
| EC-15 | Window-size invariant unchanged | `tests/settings/window-defaults.test.ts` (existing, no edit) | 7 |
| EC-16 | Custom SVG path missing on disk → fallback + 1-time toast/session | `tests/folder-icons/custom-render.test.ts` | 5 |
| EC-17 | Custom SVG with `<script>` / `onclick` → sanitised, no exec | `tests/folder-icons/custom-render.test.ts` | 5 |
| EC-18 | "Add custom SVG…" rejects non-SVG / corrupt SVG / `parsererror` | `tests/folder-icons/svg-validator.test.ts`, `picker.test.ts` | 6b, 6 |
| EC-19 | "Add custom SVG…" rejects files > 32 KB | `tests/folder-icons/svg-validator.test.ts`, `picker.test.ts` | 6b, 6 |
| EC-20 | 100-entry cap on `customFolderIcons` → refuse-add toast | `tests/folder-icons/custom-settings.test.ts`, `picker.test.ts` | 6c, 6 |
| EC-21 | Remove-from-Custom while folder references path → folder still renders SVG by path | `tests/folder-icons/custom-settings.test.ts`, `custom-render.test.ts` | 6c, 5 |
| EC-22 | Paths with whitespace / unicode round-trip cleanly | `tests/folder-icons/store.test.ts`, `bridge-icon-map.test.ts` (cargo too) | 3, 4 |
| EC-23 | Catalog iconId vs path precedence (single-field disambiguation) | `tests/folder-icons/catalog.test.ts`, `render.test.ts` | 1, 5 |

Cargo tests:

| Concern | Test file |
|---|---|
| `read_folder_icon_map` happy path | `src-tauri/src/commands/folder_icon.rs` (inline `#[cfg(test)]`) |
| Missing files / unreadable files | same |
| Malformed frontmatter returns `None`, batch continues | same |

---

## 6. Deferred Work (No TODOs in source — logged here per NFR-6 / C-9)

The following are explicitly **out of scope** for this MVP and must NOT
be designed for. They are recorded here so future planners can pick them
up without re-discovering them.

| ID | Item | Origin |
|---|---|---|
| DW-1 | Emoji / Unicode codepoint as `icon:` value | Q1 Phase 2 |
| DW-2 | User-uploaded SVG / PNG glyphs | Q1 Phase 2 |
| DW-3 | `color:` tint field per folder | Q4 Phase 2 |
| DW-4 | Type-based defaults (kanban → kanban icon, etc.) | Q6 |
| DW-5 | Render folder icons in folder-view cards, breadcrumbs, tab titles, command bar | Q3 / Out-of-Scope |
| DW-6 | File-level (per-note) icons | Q7 / Out-of-Scope |
| DW-7 | Bulk assignment ("set icon on N folders at once") | Out-of-Scope |
| DW-8 | Keyboard shortcut for "Set folder icon" | Out-of-Scope |
| DW-9 | Folder-icon search ("find all folders with icon X") | Out-of-Scope |
| DW-10 | Confirmation/toast text when overwriting malformed frontmatter (EC-11) — currently a silent overwrite | Architect decision (kept silent to stay lean; revisit if users complain) |
| DW-11 | Remove orphaned empty `_folder.md` files after Remove icon (EC-7) | Out-of-Scope; logged for future cleanup pass |
| DW-12 | Add `--danger-color` to canonical token catalog (currently picker uses `#c33` fallback) | step_06 Architect decision (do not introduce tokens in this feature) |
| DW-13 | PNG / JPG / WebP custom icon support | Custom-SVG amendment, Out-of-Scope §2 |
| DW-14 | Animated SVG / SMIL / CSS-animated custom icons | Custom-SVG amendment, Out-of-Scope §2 (sanitiser does not strip `<animate>` etc.; behaviour undefined) |
| DW-15 | Cross-machine sync of custom SVG files (Markable stores only absolute paths) | Custom-SVG amendment, Out-of-Scope §2 |
| DW-16 | Inline rename / relabel of Custom section entries (currently fixed to file basename at add-time) | Custom-SVG amendment, Out-of-Scope §2 |
| DW-17 | Markable-managed icons folder (copy/move SVGs into app data dir for portability) | C-9 (custom-SVG amendment); explicitly NOT in scope |
| DW-18 | Auto-cleanup of `customFolderIcons` entries whose path is unreadable for N sessions | EC-16 currently keeps the entry; auto-prune is a Phase 2 quality-of-life pass |
| DW-19 | Extend `openFileDialog()` (or add `openSvgDialog()`) with a stricter SVG-only filter than `openAssetDialog()` | Current amendment reuses `openAssetDialog` + post-pick validator; cleaner UX is deferred |

---

## 7. Verification Checklist (run before declaring complete)

- [ ] `npm run test:run` — full suite green.
- [ ] `npm run test:run -- tests/settings/window-defaults.test.ts` —
      window invariant intact (NFR-5, EC-15).
- [ ] `npm run test:run -- tests/folder-icons/` — every EC has a passing
      test.
- [ ] `cargo test` from `src-tauri/` — `read_folder_icon_map` tests
      pass.
- [ ] **`npm run build:plugins && npm run sync:plugins`** — mandatory
      after any edit under `src/plugins/**/*.ts` (CLAUDE.md, C-8).
- [ ] Manual: right-click a folder → "Set folder icon…" → pick `book`
      → Apply → tree shows the book glyph.
- [ ] Manual: right-click same folder → "Set folder icon…" → Remove →
      tree reverts to generic folder glyph.
- [ ] Manual: rename the folder in Finder while Markable is open →
      icon assignment travels with the folder.
- [ ] Manual: edit `_folder.md` externally to `icon: book` → reload
      vault → tree picks up the icon.
- [ ] Manual: set `icon: nonsense` externally → tree shows generic
      folder glyph, no crash, debug-level log only.
- [ ] Manual: confirm folder-view bookshelf cover-image consumer
      (`icon: cover.png`) still works (EC-4 cross-check).

---

## 8. Handoff Summary

- Requirements source: `docs/requirements/active_task.md`
- Blueprint: `docs/specs/folder-icon-assignment/00_index.md`
- Step files created:
  - `docs/specs/folder-icon-assignment/step_01_catalog.md`
  - `docs/specs/folder-icon-assignment/step_02_css.md`
  - `docs/specs/folder-icon-assignment/step_03_yaml_store.md`
  - `docs/specs/folder-icon-assignment/step_04_rust_icon_map.md`
  - `docs/specs/folder-icon-assignment/step_05_tree_wiring.md`
  - `docs/specs/folder-icon-assignment/step_06b_svg_validator.md` *(new — amendment)*
  - `docs/specs/folder-icon-assignment/step_06c_custom_settings.md` *(new — amendment)*
  - `docs/specs/folder-icon-assignment/step_06_picker.md`
  - `docs/specs/folder-icon-assignment/step_07_context_menu.md`

Next step: Activate `@lead-developer`. Start with this `00_index.md`,
then implement each step file in order. Begin with `step_01_catalog.md`.
The TDD order follows the dependency graph in §4 — steps 6b and 6c
both precede step_06 (picker) because the picker imports from both.

---

## Review Sign-off (re-audit — 2026-06-05)

- **Date**: 2026-06-05
- **Findings summary**: 0 Critical, 0 High, 0 Medium new — all prior Critical/Medium items closed; 2 non-blocking Low observations logged (DW-20 stripScripts allowlist hardening; foreignObject self-close edge note)
- **Requirements traceability**: All FRs (FR-1 … FR-18) and NFRs verified in code + tests.
- **Edge case coverage**: All 23 Edge Case Inventory items (EC-1 … EC-23) covered by passing tests. Post-fix EC-17 newly covers newline/tab/unquoted whitespace bypass forms; EC-19 newly covers multibyte UTF-8 byte-length enforcement.
- **Test runs verified**: tests/folder-icons/ → 98/98 pass; tests/settings/window-defaults.test.ts → 6/6 pass; full frontend → 4481 passed, 39 skipped.
- **Status**: Approved for Merge

LGTM. Ready for production.

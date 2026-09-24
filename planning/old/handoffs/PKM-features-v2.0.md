# PKM Features — Build Plan v2.0

> This is the implementation plan for FC3, built from `PKM-features.md` (original vision doc).  
> Status: **Draft — not yet started**  
> Last updated: 2026-05-05 (B2/B3/B4 resolved)

---

## What is FC3?

- FC1 = Core infrastructure (Tauri, CM6, file I/O) ✅
- FC2 = Editor features (82 items in PROGRESS.md) ✅
- FC3 = PKM features: the tools that make Markable uniquely powerful for personal knowledge management

These features build directly on what FC2 produced: vault index, tag browser, knowledge graph D3 engine, file browser patterns, and the plugin system.

---

## One-Time Infrastructure First

Two plugin-system extensions needed before FC3 features begin.

### Infra A — Custom Render Tab in Plugin API

Several FC3 features (Shelves Grid, Notecards full-screen, Image Vaults, Boards) work best as plugins but need to render in the main content area. The plugin API today only supports sidebar panels.

**Add `openCustomRenderTab` to the plugin API.**

- Add `kind: "custom"` to `TabKind` union in `src/tabs/tab-types.ts`
- `TabEntry` gains `renderFn?: (container: HTMLElement) => void`
- `TabManager._applyActiveTab()` hides the shared EditorView and calls `renderFn(container)` for custom tabs — same hide/show pattern as `#media-viewer`; `#custom-tab-host` is a permanent DOM fixture like `#media-viewer`
- Custom tabs are **never serialised** to session (excluded from `saveSession`/`init` restore)
- `markable-plugin-api.ts` exposes `openCustomRenderTab(title, renderFn, opts?)`
- Every `switch (tab.kind)` across the codebase must handle `"custom"` (exhaustive check)

This unlocks Notecards full-screen, Shelves Grid, Image Vaults, and Boards as pure plugins — no main-bundle changes per feature after this.

### Infra B — Plugin Dependency System

Smart Folders and Stacks are their own plugins (separate IIFE bundles) rather than code piled into the file browser monolith. They declare a parent dependency so the plugin panel can enforce ordering.

**Add `dependsOn?: string[]` to `UnifiedPlugin` interface.**

- `UnifiedPlugin.dependsOn?: string[]` — list of plugin IDs required to be enabled
- `PluginManager.enable(id)` checks that all `dependsOn` plugins are enabled first; if not, it refuses and shows an error
- `PluginManager.disable(id)` auto-disables any plugins whose `dependsOn` includes this id before disabling it
- Plugin panel renders dependent plugins **indented under their parent** with a "Requires: File Browser" tooltip; they are greyed out and un-togglable while the parent is disabled

Example:
```typescript
// smart-folders.plugin.ts
readonly id = "smart-folders";
readonly dependsOn = ["file-browser"];
```

This keeps the file browser plugin clean and lets users enable only what they want.

---

## Feature Build Order

### Tier 1 — High value, no infrastructure prerequisite

#### 1. Smart Folders (Shelf Collections)
**Original vision:** "Auto-populate a location based on YAML/metadata filters set up by the user."

**Implementation plan:**
- New "Smart Folders" section in the file browser sidebar (above pinned section)
- `SmartFolderDef = { id, name, icon?, filters: { tags?, yamlField?, yamlValue? }[] }` stored in `FileBrowserSettings.smartFolders[vaultId]`
- Filter logic: AND across all filter conditions; runs against `VaultIndexEntry.tags` + YAML fields on each vault index update
- Results render as flat file list; click opens file normally
- "New Smart Folder" button opens inline form (name + filter builder rows)
- Right-click a smart folder → Rename / Delete / Edit Filters

**Reuses:** `VaultIndexEntry.tags`, pinned section DOM/CSS pattern, tag browser vocabulary  
**Files touched:** `src/plugins/file-browser/file-browser.plugin.ts`, `file-browser.css`  
**Complexity:** Medium

---

#### 2. Knowledge Graph Enhancements
**Original vision:** "Push beyond Obsidian's graph view — Venn diagrams, level string graphs, bar charts." (Obsidian uses D3, not Three.js — we already have D3.)

**Three concrete additions:**
1. **Tag colouring** — nodes coloured by primary tag; legend rendered in graph header. `GraphNode` gains `tags: string[]` from `VaultIndexEntry.tags` via `graph-builder.ts`
2. **Filter panel** — collapsible panel inside graph sidebar: filter by tag (show only nodes with tag X), hide ghost/broken nodes, min-connections slider
3. **Timeline layout mode** — Y-axis = `VaultIndexEntry.modified` date, D3 `forceY` biases nodes toward their time slot; toggle between force-directed (default) and timeline mode

**Reuses:** All existing D3 force simulation code, `graph-builder.ts`, layout persistence  
**Files touched:** `src/plugins/knowledge-graph/graph-builder.ts` (add `tags` to `GraphNode`), `knowledge-graph.plugin.ts`  
**Complexity:** Medium

---

#### 3. Stacks
**Original vision:** "Quick place to store items into a named group for sorting out later. Stack view shows some contents before opening."

**Implementation plan:**
- New "Stacks" section in file browser (below pinned, above vault tree)
- `StackDef = { id, name, paths: string[] }` in `FileBrowserSettings.stacks[vaultId]`
- Each stack: collapsible row — click name expands to show file cards (title + tag chips)
- Add to stack: right-click any file → "Add to Stack" submenu, OR drag file onto stack header
- Right-click stack name → Rename / Delete Stack

**Reuses:** Pinned section rendering pattern, pointer-drag events from drag-to-move  
**Files touched:** `src/plugins/file-browser/file-browser.plugin.ts`, `file-browser.css`  
**Complexity:** Medium-low

---

### Tier 2 — New visual plugins (requires custom render tab from infrastructure step)

#### 4. Notecards
**Original vision:** "Small md files that can be pointers to other files. Visual style for quick yaml input, footnotes, shorter content."

**Implementation plan:**
- New plugin `src/plugins/notecards/` — standalone, no `dependsOn`
- Sidebar panel with: search/filter bar, tag filter chips, card grid
- Each card is **metadata-only** (no body text preview — lightweight, no file reads on render): title, tags, modified date, and any single-value YAML fields present (e.g. `category`, `status`) sourced from `window.__MARKABLE_META__` universal field scanner results
- Click card → `openFileInTab`
- "Focused folder" mode: pin the panel to a specific folder subtree
- Quick tag edit: hover a tag chip → popover with checkbox list from vault vocabulary, writes back via `write_file`
- Full-screen button → `openCustomRenderTab` for an expanded grid view

**Reuses:** `VaultIndexEntry`, `window.__MARKABLE_META__` for YAML field values, tag vocabulary, `openFileInTab`  
**Files:** New `src/plugins/notecards/notecards.plugin.ts`  
**Complexity:** Medium

---

#### 5. Shelves (Grid)
**Original vision:** "Visual like a bookshelf. Grid, list, book stack, carousel, card view, filmstrip view."

**Implementation plan:**
- New plugin `src/plugins/shelves/`
- File browser gets new context menu item on directories: "Open as Shelf"
- Calls `api.openCustomRenderTab` with a render function that draws a CSS grid of file cards
- View mode toggle in the tab header: **Grid** (icon + name) / **List** (compact rows) / **Bookshelf** (tall thin "book spine" cards with rotated title — pure CSS)
- Toolbar: sort by name / modified / size; filter by file type
- Click card → `openFileInTab` or `openMediaInTab` by extension

**Reuses:** `VaultIndexEntry` for card data, file browser context menu hook  
**Files:** New `src/plugins/shelves/shelves.plugin.ts`, minor file-browser context menu addition  
**Complexity:** Medium

---

### Tier 3 — High effort, high payoff (post Tier 1–2)

#### 6. Image Vaults
**Original vision:** "Thumbnails and galleries for visual people. Like Adobe Bridge — metadata/yaml readily available. Video supported. Filtering and sorting."

**Implementation plan:**
- New Rust command: `generate_thumbnail(path, max_w, max_h) → Vec<u8>` using the `image` crate
- Thumbnail cache: `~/Library/Application Support/com.markable.app/thumbnails/{hash}.jpg`
- New plugin renders a thumbnail gallery in a custom render tab
- Metadata panel: click a thumbnail → side panel shows YAML front matter and tags (editable)
- Right-click thumbnail → "Open full size", "Edit metadata", "Copy path"

**Files:** New `src-tauri/src/commands/thumbnails.rs`, new `src/plugins/image-vault/`  
**Complexity:** High (Rust image processing + cache + gallery UI)

---

#### 7. Boards (Canvas)
**Original vision:** "A canvas where multiple notes can be put onto a surface and connections or graphics can be added."

**Recommended approach:** Embed `@excalidraw/excalidraw` (React component) as the render function in a custom render tab. Excalidraw is MIT-licensed, actively maintained, and handles drawing + connections natively.

**Alternative (lighter):** Custom canvas with absolutely-positioned note cards + SVG connection lines. No external dependency; less powerful.

**Files:** New `src/plugins/boards/`, vendored Excalidraw bundle or npm dependency  
**Complexity:** Very high (Excalidraw integration) / Medium (simple custom canvas)

---

## Deferred (FC4 or later)

| Feature | Status | Reason |
|---------|--------|--------|
| **AI features** | Deferred | Build PKM data model first; targeted tools (YAML suggest, note summarize) come before the "bring your own Claude Code" terminal |
| **Dashboards** | Deferred | Depends on AI integration |
| **Cabinets** | Revisit scope | Likely just a special folder icon + label — may not need new tech |
| **MSWord export** | Research only | `docx-rs` crate could do basic export; not scheduled |
| **Slide deck (Marp)** | Research only | Marp.js can convert `.md` to slides — thin "Present" button is viable later |
| **Spreadsheets** | Research only | CSV table view possible; full Excel parity out of reach |

---

## Summary table

| # | Feature | Tier | Infra needed? | Complexity | Start state |
|---|---------|------|---------------|------------|-------------|
| – | Custom render tab API | Infra | — | Low | Not started |
| 1 | Smart Folders | T1 | No | Medium | Not started |
| 2 | Knowledge Graph enhancements | T1 | No | Medium | Not started |
| 3 | Stacks | T1 | No | Med-low | Not started |
| 4 | Notecards | T2 | Yes | Medium | Not started |
| 5 | Shelves (Grid) | T2 | Yes | Medium | Not started |
| 6 | Image Vaults | T3 | Yes | High | Not started |
| 7 | Boards | T3 | Yes | Very high | Not started |

---

## Agent pipeline (same for every feature)

1. **requirements-analyst** → `docs/requirements/active_task.md`
2. **software-architect** → `docs/specs/[feature]/00_index.md` + step files
3. **lead-developer** → TDD, implements step files in strict order
4. **code-reviewer** → all Critical/High issues resolved before merge

---

---

## Pre-Implementation Flags (Requirements Analyst Review)

These issues were identified before any feature begins. Each one needs an explicit decision before the Requirements Analyst writes `active_task.md` for that feature.

### 🔴 Blockers — must resolve before implementation

**B1 — Custom render tab is more than "~100 lines"**  
The infrastructure step needs to explicitly specify: (1) what happens to the shared EditorView when a custom tab is active (it must be hidden, same as the media viewer pattern), (2) the container lifecycle — when is `renderFn` called, when is the container destroyed, (3) session restore must explicitly skip custom tabs (they can't be serialised). Every Tier 2+ feature depends on this being right.

**B2 — Smart Folders YAML field filtering** ✅ *Resolved: tags-only for v1.*  
Smart Folders v1 filters against `VaultIndexEntry.tags` only. No Rust index schema change needed.

**B3 — Notecards content preview** ✅ *Resolved: metadata-only cards, no body text.*  
Cards show title + tags + modified date + common YAML field values (category, status, etc.) sourced from `window.__MARKABLE_META__`. Zero file reads on render. `VaultIndexEntry` schema unchanged.

**B4 — File browser plugin decomposition** ✅ *Resolved: plugin dependency system.*  
Smart Folders and Stacks are separate plugins declaring `dependsOn: ["file-browser"]`. Plugin panel greys them out while file browser is disabled. File browser monolith stays clean. See Infra B above.

### 🟡 Gaps — address in Requirements for the relevant feature

**G1 — Smart Folder filter builder UI not designed**  
The plan says "right-click → Edit Filters" opens a form, but the form itself isn't specified: how many filter rows, tag selection UX (chip selector vs. text input), AND/OR logic model. Requirements must nail this down.

**G2 — Stacks ordering not specified**  
`StackDef` has no `order` field. If stacks are displayed as a list, the user needs to reorder them. In-scope or explicitly deferred?

**G3 — Performance warning at vault cap not mentioned**  
Vision doc says warn users when vault approaches 400–500 items. `VaultIndex.capped` already exists. Smart Folders and Stacks both depend on vault index data. This warning belongs in the first FC3 feature's scope, not deferred indefinitely.

**G4 — Notecards backlink count dropped from plan**  
Vision says Notecards have "backlinked pointers." `VaultIndexEntry.outboundLinks` can be inverted for backlink count at render time (already done by the backlinks plugin). Include or explicitly defer.

**G5 — Shelves view modes: carousel/filmstrip/card view not scoped**  
Vision lists 6 modes; plan scopes 3 (Grid, List, Bookshelf). The other 3 should be explicitly deferred with a note, not silently omitted.

**G6 — Image Vaults thumbnail cache key not specified**  
`path + mtime` is the standard approach (avoids stale thumbnails after image edits). Must be stated in Requirements — don't let the Architect guess.

**G7 — "Power of 3" starter templates not addressed**  
Vision describes specific vault structures (Resource Library, Personal Continuous Learning, Projects with AB-client naming). No in-app guidance means users get no scaffolding. At minimum, a note in the documentation system; potentially a "New vault from template" feature. Scope this or defer it explicitly.

**G8 — Boards should be specified as "post AI-tools" not standalone**  
Without Notecards and AI features, boards have no structured input to work with. The timeline dependency should be stated.

### 🟢 Low-risk notes

- **Knowledge Graph timeline mode** is medium-high, not medium. Budget accordingly.
- **Cabinets** need a relationship-to-folders decision before other organisational features lock in a hierarchy.
- **Excalidraw for Boards** brings React as a dependency (no React elsewhere in app today) and Tauri CSP risks. Simple custom canvas is lower risk for v1.

---

## Recommended first feature

**Smart Folders** — highest value:effort ratio for FC3 start.
- No infrastructure prerequisite
- Uses existing vault index + tag data pipeline (already battle-tested)
- Directly supports the "Power of 3 / Resource Library" PKM philosophy
- Pattern (pinned section in file browser) is established and tested

To begin: run **requirements-analyst** for Smart Folders.

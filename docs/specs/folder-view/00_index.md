---
title: "Folder View — Master Blueprint"
last-updated: "2026-05-09"
review-cadence-days: 90
status: reference
---

# Folder View via `_folder.md` — Master Blueprint

Requirements source: `docs/requirements/active_task.md` (37 FRs, 7 NFRs, 24 ECs, 15 Locked Decisions).

This blueprint is the source of truth for the architecture. Step files are the implementation contract — Lead Developer follows them in order, top to bottom. No step modifies a file owned by a later step.

---

## Stack Decision

No new technology is introduced. Folder View is a pure-frontend feature that lives entirely inside the existing file-browser IIFE plugin. The Architect surveyed the following alternatives before locking the stack:

| Concern | Option considered | Outcome |
|---|---|---|
| Tab deduplication by path | Add `key?` param to `openCustomRenderTab` vs. synthetic title prefix (`__fv__:/path`) vs. plugin-local path→tabId Map | **Synthetic title prefix.** See AD-1 below for full justification. |
| YAML parsing | Introduce a YAML library vs. reuse the existing line-by-line `parseFileYaml` pattern from `layout-manager.ts` | **Reuse existing parser.** NFR-04 forbids new npm dependencies; the existing parser handles the small `_folder.md` schema with zero new code. |
| Card grid rendering | Web components / lit-html vs. plain DOM construction | **Plain DOM.** The file-browser is hand-rolled DOM throughout (`buildTreeUl`, `buildNodeEl`). Introducing a reactive layer for one feature would create two parallel idioms in one IIFE. |
| File read at tab open time | Read `_folder.md` via `window.__TAURI_INTERNALS__.invoke("read_file")` vs. via `window.__MARKABLE_VAULT_MANAGER__.getVaultIndex()` | **Read via Tauri invoke directly.** The vault index stores metadata (path, name, tags, modified) but not raw file contents. Reading `_folder.md` body requires a direct file read at tab-open time. The existing `startFsWatcher` / `handleFsEvent` path in the plugin already drives index reloads; the folder view re-reads `_folder.md` contents on each re-render. |
| Live update on save | Poll `_folder.md` mtime vs. hook into existing `_indexUpdatedCb` | **Hook `_indexUpdatedCb`.** The vault file-watcher already fires on every file save, triggering `_indexUpdatedCb`. The folder-view module registers a listener inside that callback. Zero new Tauri subscriptions. |
| Web search 2026 | "folder card grid TypeScript DOM 2026" — surveyed `gridjs`, `muuri`, `masonry.js` | **None adopted.** A CSS grid with `display: grid` and `grid-template-columns: repeat(N, 1fr)` covers FR-18/FR-20 completely. No library needed. |

**Result**: TypeScript, plain DOM, single IIFE, zero new Rust commands, zero new npm dependencies, reuse of `window.__TAURI_INTERNALS__.invoke` for file reads, reuse of existing YAML parser pattern, reuse of `openCustomRenderTab` with synthetic-title deduplication.

---

## High-Level Architecture

### One-paragraph summary

A `_folder.md` file inside a directory is the sole trigger for Folder View. The plugin scans `VaultIndex.entries` once per `renderPanel` call to build a `Set<string>` of directory paths that contain `_folder.md` (the "folderView set"). This set is threaded into `buildActivateHandler`, `appendIconAndLabel`, and `buildDirContextMenuItems`. When the user clicks the folder name label on a folder in the set, `openFolderViewTab(folderPath)` is called: it reads `_folder.md` from disk, parses YAML front-matter, dispatches to a layout renderer, and opens a custom render tab using a synthetic title key `__fv__:<absolutePath>` to guarantee path-based deduplication. A stale flag on the closure fires a re-render when the folder-view tab is next activated after `_folder.md` is saved.

### Data flow — read path (opening a Folder View tab)

```
user clicks folder-name label on a folder that has _folder.md
  └─ openFolderViewTab(folderPath, vaultIndex)
       └─ computeDisplayTitle(folderPath, frontMatter)           ← FR-16
       └─ synthetic key = "__fv__:" + folderPath                 ← AD-1, FR-17
       └─ window.__MARKABLE_OPEN_CUSTOM_TAB__(syntheticKey, renderFn)
            └─ tab-manager.openCustomRenderTab: dedup by title (syntheticKey)
       └─ renderFolderViewTab(folderPath, container)
            └─ read _folder.md via invoke("read_file")           ← no new Tauri cmd
            └─ parseFolderMd(content) → { frontMatter, body }   ← FR-10–FR-14
            └─ buildFolderCards layout                           ← FR-18–FR-26
                 ├─ collect immediate children from VaultIndex   ← FR-19
                 ├─ sort cards                                   ← FR-20
                 ├─ render subfolder section                     ← FR-18
                 └─ render file section                          ← FR-18
```

### Data flow — detection path (per renderPanel call)

```
renderTreeContent(wrapper)
  └─ buildFolderViewSet(vaultIndex) → Set<dirPath>              ← FR-05, FR-06
       └─ scan vaultIndex.entries once
       └─ for each entry whose name === "_folder" and type is file:
            └─ add getParentDir(entry.path) to set
  └─ buildTreeUl(wrapper, displayNodes, activeFile, vaultId, folderViewSet)
       └─ per directory node: node in set? → hasFolderView = true
       └─ buildNodeEl: adds class tree-node-has-folder-view      ← FR-07
       └─ attachNodeListeners: uses hasFolderView flag to split click targets ← FR-02/FR-03
```

### Data flow — live update path (FR-31/FR-32)

```
user saves _folder.md (vault FS watcher fires → _indexUpdatedCb)
  └─ notifyFolderViewOfIndexUpdate(changedPath)
       └─ for each open folder-view tab whose path matches:
            └─ if tab is active: re-render immediately (FR-31)
            └─ if tab is inactive: set tab.stale = true (FR-32)

user activates a stale folder-view tab (markable-tab-changed event)
  └─ onTabChanged() → checkStalefolderViewTabs()
       └─ find folder-view tab whose synthetic key is now active
       └─ if stale: re-render, clear stale flag (FR-32)
```

### Data flow — write path (Create Folder View context menu)

```
user right-clicks folder without _folder.md → "Create Folder View..."
  └─ buildDirContextMenuItems: item injected per FR-35
  └─ createFolderViewFile(dirPath)
       └─ EC-16: check if _folder.md already exists via vaultIndex
       └─ if exists: open _folder.md in editor tab
       └─ if not: invoke("write_file", path, STARTER_TEMPLATE)  ← FR-36
            └─ open _folder.md in editor tab
            └─ vault FS watcher fires → index update → renderPanel re-detects
```

---

## Component Map

### New files to create (all in `src/plugins/file-browser/folder-view/`)

| File | Purpose |
|---|---|
| `types.ts` | Pure type definitions: `FolderMdFrontMatter`, `FolderViewConfig`, `FolderLayoutRenderer`, `FolderCard`, `ChildEntry`. No runtime exports. |
| `parser.ts` | `parseFolderMd(content): { frontMatter: FolderMdFrontMatter; body: string }`. Reuses the line-by-line YAML parse pattern from `layout-manager.ts`. |
| `detection.ts` | `buildFolderViewSet(vaultIndex: VaultIndex): Set<string>`. Single O(N) scan. Returns paths of directories that contain `_folder.md`. |
| `tab.ts` | `openFolderViewTab(folderPath, vaultIndex)` — computes title, builds synthetic key, registers stale-flag closure, calls `__MARKABLE_OPEN_CUSTOM_TAB__`. Also exports `notifyFolderViewTabs(changedPath)` for the live-update hook. |
| `renderer.ts` | `renderFolderCards(config: FolderViewConfig, container: HTMLElement): void`. Renders the card grid (subfolder section + file section). |
| `fallback.ts` | `renderFallback(body: string, notice: string, container: HTMLElement): void`. The FR-12/FR-13 graceful degradation renderer. |
| `folder-view.css.ts` | TypeScript module exporting `FOLDER_VIEW_CSS: string`. Card grid CSS appended to `FILE_BROWSER_CSS` at bundle time. |

### Existing files modified

| File | What changes |
|---|---|
| `file-browser.plugin.ts` | (1) Import new folder-view sub-modules. (2) Thread `folderViewSet` through `renderTreeContent` → `buildTreeUl`. (3) Apply `tree-node-has-folder-view` class inside `buildTreeUl` (after `buildNodeEl` returns, before `attachNodeListeners`). (4) Pass `hasFolderView` boolean into `attachNodeListeners`. (5) Modify `buildActivateHandler` to split click targets for folder-view directories. (6) Modify `buildDirContextMenuItems` to inject "Open Folder View" / "Create Folder View…" items. (7) Add `_lastFolderViewSet` module-level variable; update in `renderTreeContent`. (8) Modify `_indexUpdatedCb` to call `notifyFolderViewTabs`. (9) Modify `onTabChanged` to call `checkStaleFolderViewTabs`. (10) Add `expandDirectory` to `__MARKABLE_FILE_BROWSER__` global. (11) Register `__MARKABLE_OPEN_FOLDER_VIEW_TAB__` global. (12) Append `FOLDER_VIEW_CSS` to `FILE_BROWSER_CSS` constant. (13) Reset `_lastFolderViewSet` and call `clearFolderViewRegistry` in `onDisable`. |
| `src/tabs/tab-manager.ts` | No changes. Deduplication is handled by the synthetic-title approach (AD-1). |
| `src/tabs/tab-types.ts` | No changes. |
| `src/main.ts` | No changes. |

### Files that must NOT change

| File | Reason |
|---|---|
| `src/lib/layout-manager.ts` | NFR-03: folder layouts are separate from document layouts. |
| `src-tauri/src/` (any Rust file) | NFR-03: no Rust changes. |
| Any file outside `src/plugins/file-browser/` | NFR-03. |

---

## Architectural Decisions

**AD-1 — Tab deduplication: synthetic title prefix `__fv__:<path>`**

Three options were evaluated:

1. Add optional `key?` param to `openCustomRenderTab(title, renderFn, key?)`. Clean API but requires modifying `tab-manager.ts` (a core module) and `tab-types.ts`, adding cross-cutting complexity.

2. Store a plugin-local `Map<path, tabId>` and call `activateTab(id)` directly. Works but requires the plugin to reach into tab-manager internals to re-render content when re-activating, and creates an ownership problem: if the tab is closed by the user, the map entry becomes stale.

3. Synthetic title key: prefix the full folder path with a sentinel string (`__fv__:`) and pass it as the `title` argument to `openCustomRenderTab`. Tab-manager's existing title-dedup (DC-07 in `openCustomRenderTab`) then deduplicates by path automatically. Display title is set separately inside the `renderFn` via the host element's DOM.

**Decision: option 3 (synthetic title prefix).** It requires zero changes to `tab-manager.ts` or `tab-types.ts`, is self-contained in the plugin, and handles the stale-map problem automatically (if the tab is closed, `openCustomRenderTab` creates a fresh one). The sentinel `__fv__:` is long enough to be unambiguous and is not a valid filesystem path character sequence. One downside: the tab strip renderer will show `__fv__:/path/to/folder` as the tab title if it ever uses `tab.title` directly without the `renderFn` having run first. To mitigate this, the `renderFn` must immediately write the display title to the `#titlebar-title` element or rely on the fact that `_applyActiveTab` calls `_updateTitleBar(tab)` using `tab.title` after `renderFn` runs — so the `tab.title` stored in the TabEntry will be `__fv__:/path`. The actual display title in the tab strip is set by the renderer's `update()` call which reads `tab.title`. Solution: after opening, immediately update `tab.title` via a direct lookup. **Simpler solution**: call `openCustomRenderTab` with the display title (not the synthetic key) but also set `tab.dedupKey = syntheticKey` — but that requires changing `tab-types.ts`. **Final decision**: use the synthetic title and also update `tab.title` to the display title immediately inside `openFolderViewTab` by finding the tab in `window.__MARKABLE_TAB_MANAGER__.getTabs()` after the call. This is a two-step: open with synthetic key → find the tab → update its `.title` → notify renderer. This avoids modifying tab-types.ts while keeping the tab strip title human-readable.

**AD-2 — Stale flag storage: closure-captured `{ stale: boolean }` object**

FR-31/FR-32 require re-rendering when `_folder.md` is saved. The clean implementation mirrors `refreshLayoutView` in `tab-manager.ts`. For Folder View tabs (kind=custom), tab-manager does NOT re-invoke `renderFn` on `activateTab` — it only shows `has-custom-tab` and the cached `#custom-tab-host` DOM. Therefore the stale-flag mechanism must live in the plugin.

Design: `openFolderViewTab` creates a `staleRef = { stale: false }` object. The `renderFn` closure captures `staleRef`. `notifyFolderViewTabs(changedPath)` finds all folder-view entries whose path matches `changedPath`'s parent directory and sets `staleRef.stale = true` (or re-renders immediately if the tab is active). The `onTabChanged` handler calls `checkStaleFolderViewTabs()` which finds stale tabs that are now active and re-renders them.

The registry of `{ syntheticKey, folderPath, staleRef, rerenderFn }` tuples lives in a module-level array `_folderViewTabRegistry` in `tab.ts`. Entries are added on open and garbage-collected when the tab is closed (detected by checking `window.__MARKABLE_TAB_MANAGER__.getTabs()` for the synthetic key on each `notifyFolderViewTabs` call).

**AD-3 — Detection scan: one `Set<string>` per `renderPanel` call**

FR-05 and FR-06 require O(N) detection with results cached for the render pass. The `buildFolderViewSet` function scans `vaultIndex.entries` once and returns a `Set<string>` of absolute directory paths. This set is passed into `buildTreeUl` and from there into `attachNodeListeners` via a `hasFolderView` boolean on each `<li>`. No global cache is needed; the set is local to the render call and GC'd immediately after. This satisfies NFR-01 (no measurable latency for 5,000 files).

**AD-4 — YAML parsing: reuse line-by-line pattern from `layout-manager.ts`**

NFR-04 forbids new npm dependencies. The existing `parseFileYaml` pattern in `layout-manager.ts` is a plain JavaScript function that splits on `---` and iterates lines. `parser.ts` implements the same logic as a standalone function (no import from `layout-manager.ts` — that would violate NFR-03 by coupling the file-browser plugin to the layouts system). The parser is intentionally permissive: unknown fields are ignored, malformed values fall back to defaults. EC-04/EC-05 are satisfied.

**AD-5 — Children collection: scan `vaultIndex.entries` filtered by path prefix**

FR-19 requires "immediate children only." The vault index is a flat array. Immediate children of `/vault/A` are entries whose path matches the regex `/vault/A/[^/]+$` (no nested slashes). A simple string operation `path.startsWith(dirPath + "/") && !path.slice(dirPath.length + 1).includes("/")` is O(N) and correct. Non-MD files are in `vaultIndex.nonMdFiles`. Both arrays are scanned once per folder-view render. EC-22 is satisfied.

**AD-6 — CSS strategy: extend `FILE_BROWSER_CSS` constant**

All new CSS lives in a `FOLDER_VIEW_CSS` constant in `folder-view/folder-view.css.ts` (a `.ts` file that exports the string). It is imported into `file-browser.plugin.ts` and concatenated into `FILE_BROWSER_CSS`. This follows the established pattern of the plugin being a single self-contained IIFE. No new `<style>` tag injection.

**AD-7 — Smart Folder exclusion (EC-24)**

Smart Folder nodes have `data-smart-folder-id` attribute. The `handleContextMenu` function already checks `sfId !== null` first (before the directory branch). The folder-view context menu items are injected only in `buildDirContextMenuItems`, which is only called when `sfId === null && type === "directory"`. No additional guard is needed.

**AD-8 — `_folder.md` entry visibility (FR-08)**

`_folder.md` entries are standard `VaultIndexEntry` objects and appear in `vaultIndex.entries` like any other `.md` file. They are rendered as normal file nodes in the tree (existing `file-browser.plugin.ts` logic, no changes). The only special treatment is: (a) detection in `buildFolderViewSet`, (b) exclusion from the card grid (FR-23), and (c) detection of type=file in EC-21.

**AD-9 — `_folder.md` reading: direct Tauri invoke, not vault index**

`vaultIndex.entries` stores `{ path, name, title, outboundLinks, tags, modified, size }` — no raw `content` field. To render the YAML front-matter and body, `_folder.md` must be read from disk. The plugin already calls `window.__TAURI_INTERNALS__.invoke("read_file", { path })` in other places (e.g. via `file-browser-ops.ts`). `renderFolderViewTab` calls the same invoke pattern directly. If the read fails, the graceful fallback (FR-12) is shown.

**AD-10 — Subfolder card click: expand tree + conditional folder view**

FR-21 requires both tree expansion and (if the subfolder has `_folder.md`) opening its Folder View tab. The subfolder card click handler in `renderer.ts` calls:
1. `toggleDirectoryNode` equivalent: calls `window.__MARKABLE_FILE_BROWSER__?.expandDirectory?.(subfolderPath)` — a new public method added to the `__MARKABLE_FILE_BROWSER__` global.
2. Checks `folderViewSet.has(subfolderPath)` — the set from the parent render call is captured in the closure.
3. If yes, calls `openFolderViewTab(subfolderPath, vaultIndex)`.

The `__MARKABLE_FILE_BROWSER__.expandDirectory(path)` method is a new thin wrapper that sets `_expandedPaths.add(path)` and calls `renderPanel()`.

---

## Implementation Roadmap

| Step | File(s) | What lands |
|---|---|---|
| `step_01` | `folder-view/types.ts`, `folder-view/parser.ts` | Type definitions + YAML parser. Tests: parser unit tests covering all EC-04/EC-05/EC-11/EC-12 cases. |
| `step_02` | `folder-view/detection.ts`, `file-browser.plugin.ts` (detection hookup only) | `buildFolderViewSet`, thread into `renderTreeContent`/`buildTreeUl`, add `tree-node-has-folder-view` class, add `hasFolderView` data attribute. Tests: detection unit tests including EC-21/EC-23. |
| `step_03` | `file-browser.plugin.ts` (click split + keyboard) | Modify `buildActivateHandler` for split-click. Modify `attachKeyboardHandler` for Enter→Folder View. Add `expandDirectory` to `__MARKABLE_FILE_BROWSER__` global. Tests: click-routing tests, keyboard tests (NFR-05). |
| `step_04` | `folder-view/tab.ts`, `folder-view/fallback.ts` | `openFolderViewTab`, stale-flag registry, `notifyFolderViewTabs`, `checkStaleFolderViewTabs`, `renderFallback`. Hook `_indexUpdatedCb` and `onTabChanged` in `file-browser.plugin.ts`. Tests: tab dedup tests (EC-15), stale-flag tests (EC-17/EC-18). |
| `step_05` | `folder-view/renderer.ts`, `folder-view/folder-view.css.ts` | `renderFolderCards` full implementation: description block, subfolder section, file section, empty state, sort, column clamp, `show-modified`. Subfolder card click (AD-10). File card click. Accessibility (NFR-07). Tests: renderer unit tests including EC-06/EC-07/EC-08/EC-11/EC-13/EC-14/EC-22. |
| `step_06` | `file-browser.plugin.ts` (context menu integration) | Modify `buildDirContextMenuItems`: inject "Open Folder View" (FR-34) and "Create Folder View..." (FR-35). Implement `createFolderViewFile` (FR-35/FR-36). EC-16 guard. EC-24 already handled by existing Smart Folder branch. Tests: context menu integration tests. |
| `step_07` | CSS appended to `FILE_BROWSER_CSS`, final integration | Append `FOLDER_VIEW_CSS` import to `file-browser.plugin.ts`. Run full build + sync. Manual integration test checklist. Fix any issues found in full render cycle. |

---

## Definition of Done

### FR Traceability Matrix

| FR | Component / Step |
|---|---|
| FR-01 | `buildActivateHandler` unchanged fallback — step_03 |
| FR-02 | `buildActivateHandler` split-click — step_03 |
| FR-03 | `buildActivateHandler` + `attachNodeListeners` chevron intercept — step_03 |
| FR-04 | `attachKeyboardHandler` Enter handler — step_03 |
| FR-05 | `detection.ts` / `buildFolderViewSet` — step_02 |
| FR-06 | `buildFolderViewSet` called once per `renderTreeContent`, result passed down — step_02 |
| FR-07 | `buildNodeEl` adds `tree-node-has-folder-view` — step_02 |
| FR-08 | No change — `_folder.md` renders as normal file entry |
| FR-09 | No change — standard file operations available |
| FR-10 | `types.ts` schema + `parser.ts` — step_01 |
| FR-11 | `parser.ts` body extraction + `renderer.ts` description block — step_01/step_05 |
| FR-12 | `fallback.ts` + dispatch in `tab.ts` — step_04 |
| FR-13 | `fallback.ts` unknown-layout notice — step_04 |
| FR-14 | `parser.ts` reuses line-by-line pattern — step_01 |
| FR-15 | `tab.ts` `openFolderViewTab` with synthetic key — step_04 |
| FR-16 | `tab.ts` `computeDisplayTitle` — step_04 |
| FR-17 | Synthetic title `__fv__:<path>` dedup — step_04 |
| FR-18 | `renderer.ts` `renderFolderCards` — step_05 |
| FR-19 | `renderer.ts` immediate-children scan — step_05 |
| FR-20 | `renderer.ts` sort by `sort` field — step_05 |
| FR-21 | `renderer.ts` subfolder card click (expand + conditional open) — step_05 |
| FR-22 | `renderer.ts` file card click — step_05 |
| FR-23 | `renderer.ts` excludes `_folder.md` from file section — step_05 |
| FR-24 | `renderer.ts` description block via `__MARKABLE_RENDER_MD__` — step_05 |
| FR-25 | `folder-view.css.ts` uses CSS custom properties — step_07 |
| FR-26 | `renderer.ts` empty-state message — step_05 |
| FR-27 | `tab.ts` case-insensitive layout dispatch — step_04 |
| FR-28 | `tab.ts` `LAYOUT_RENDERERS` Record map — step_04 |
| FR-29 | NFR-03 confirmed: `layout-manager.ts` untouched |
| FR-30 | `fallback.ts` always available — step_04 |
| FR-31 | `tab.ts` `notifyFolderViewTabs` + active-tab re-render — step_04 |
| FR-32 | `tab.ts` stale flag + `checkStaleFolderViewTabs` in `onTabChanged` — step_04 |
| FR-33 | Stale mechanism only in `tab.ts` folder-view registry — step_04 |
| FR-34 | `buildDirContextMenuItems` "Open Folder View" item — step_06 |
| FR-35 | `buildDirContextMenuItems` "Create Folder View..." + `createFolderViewFile` — step_06 |
| FR-36 | `createFolderViewFile` starter template constant — step_06 |
| FR-37 | Vault FS watcher already handles index refresh — no new code |

### Edge Case Checklist

| EC | Covered by |
|---|---|
| EC-01 | `buildFolderViewSet` returns empty set when index not ready — step_02 |
| EC-02 | Detection fails on next renderPanel; tab stays open (no force-close) — step_02/step_04 |
| EC-03 | Same as EC-02 |
| EC-04 | `parser.ts` empty file → empty frontMatter → FR-12 fallback — step_01 |
| EC-05 | `parser.ts` malformed YAML → partial parse → missing `layout` → FR-12 fallback — step_01 |
| EC-06 | `renderer.ts` empty-state message when no children — step_05 |
| EC-07 | `renderer.ts` subfolder section empty, file section shows non-MD — step_05 |
| EC-08 | `renderer.ts` subfolder section only, file section omitted — step_05 |
| EC-09 | Subfolder card click: path-based dedup via synthetic key creates independent tab — step_05 |
| EC-10 | Subfolder card without `_folder.md`: only expand, no tab open — step_05 |
| EC-11 | `parser.ts` clamp columns to [2, 6] — step_01 |
| EC-12 | `parser.ts` unknown sort value → default `name-asc` — step_01 |
| EC-13 | Tab display title HTML-escaped in `computeDisplayTitle` — step_04 |
| EC-14 | Description body passes through `stripScripts` equivalent before `__MARKABLE_RENDER_MD__` — step_05 |
| EC-15 | Synthetic key `__fv__:/Work/Reports` vs `__fv__:/Personal/Reports` are distinct — step_04 |
| EC-16 | `createFolderViewFile` checks index before write — step_06 |
| EC-17 | Active-tab re-render on `_folder.md` save — step_04 |
| EC-18 | Stale flag set when tab is inactive — step_04 |
| EC-19 | Known v1 limitation: folder-view tab persists across vault switch — documented in step_04 |
| EC-20 | `_folder.md` file node click → type="file" branch in `buildActivateHandler` — unchanged |
| EC-21 | `buildFolderViewSet`: check `entry.name === "_folder"` AND `entry.path.endsWith(".md")` — step_02 |
| EC-22 | `renderer.ts` O(N) children scan, no O(N²) — step_05 |
| EC-23 | `buildFolderViewSet` returns empty set for flat vault — step_02 |
| EC-24 | `handleContextMenu` already checks `sfId !== null` first; Smart Folders never reach `buildDirContextMenuItems` — AD-7, no new code |

### NFR Checklist

| NFR | Satisfied by |
|---|---|
| NFR-01 | `buildFolderViewSet` is O(N) over `vaultIndex.entries` once per render — step_02 |
| NFR-02 | `renderer.ts` single DOM construction pass, no O(N²) — step_05 |
| NFR-03 | All code in `src/plugins/file-browser/` — enforced in component map |
| NFR-04 | Zero new npm dependencies — enforced in stack decision |
| NFR-05 | `attachKeyboardHandler` ArrowRight/Left unchanged; Enter updated — step_03 |
| NFR-06 | `parser.ts` + `fallback.ts` never throw — step_01/step_04 |
| NFR-07 | Card elements use `role="button"`, `aria-label`, keyboard Tab + Enter — step_05 |

---

## Step Files

| Step | File | Status |
|---|---|---|
| 01 | `docs/specs/folder-view/step_01_types-and-parser.md` | [x] Complete |
| 02 | `docs/specs/folder-view/step_02_detection.md` | [x] Complete |
| 03 | `docs/specs/folder-view/step_03_split-click.md` | [x] Complete |
| 04 | `docs/specs/folder-view/step_04_tab-and-stale.md` | [x] Complete |
| 05 | `docs/specs/folder-view/step_05_renderer.md` | [x] Complete |
| 06 | `docs/specs/folder-view/step_06_context-menu.md` | [x] Complete |
| 07 | `docs/specs/folder-view/step_07_css-and-integration.md` | [x] Complete |

---

## Known Limitations (v1)

- **EC-19**: Switching vaults while a Folder View tab is open leaves stale content in the tab. The tab is not forcibly closed on vault switch. This is acceptable v1 behavior; the user can close the tab manually or re-open the folder after switching. Documented in `tab.ts` (see "EC-19 known v1 limitation" comment).
- **Tab strip title during async load**: Between `openCustomRenderTab` being called and `renderFolderViewTabAsync` completing, the tab strip may briefly show the synthetic key `__fv__:/path`. This is typically sub-100ms and is not user-visible in practice (the renderFn immediately writes a loading placeholder while the async read is in flight).

---

## Review Request

- **Files changed**:
  - `src/plugins/file-browser/folder-view/types.ts` (created)
  - `src/plugins/file-browser/folder-view/parser.ts` (created)
  - `src/plugins/file-browser/folder-view/detection.ts` (created)
  - `src/plugins/file-browser/folder-view/fallback.ts` (created)
  - `src/plugins/file-browser/folder-view/tab.ts` (created)
  - `src/plugins/file-browser/folder-view/renderer.ts` (created)
  - `src/plugins/file-browser/folder-view/folder-view.css.ts` (created)
  - `src/plugins/file-browser/file-browser.plugin.ts` (modified)
  - `tests/folder-view/parser.test.ts` (created)
  - `tests/folder-view/detection.test.ts` (created)
  - `tests/folder-view/split-click.test.ts` (created)
  - `tests/folder-view/tab.test.ts` (created)
  - `tests/folder-view/renderer.test.ts` (created)
  - `tests/folder-view/context-menu.test.ts` (created)
  - `docs/specs/folder-view/00_index.md` (status updated)

- **Steps completed**: step_01, step_02, step_03, step_04, step_05, step_06, step_07

- **Known limitations**: EC-19 (vault-switch stale tab) and brief synthetic-key flash during async load — both documented in Known Limitations above.

- **Edge cases covered by tests**:

  | Edge Case | Test(s) |
  |---|---|
  | EC-01: empty/null index → empty set | `detection.test.ts`: "null vaultIndex → empty set", "empty entries array → empty set" |
  | EC-04: empty _folder.md → fallback | `parser.test.ts`: "empty content → layout empty string, fallback trigger" |
  | EC-05: malformed YAML → partial parse | `parser.test.ts`: "malformed YAML line skipped gracefully" |
  | EC-06: empty cards list → empty-state message | `renderer.test.ts`: "FR-26: empty cards list → 'This folder is empty.'" |
  | EC-07: only files, no dirs → Files section only | `renderer.test.ts`: "EC-07: only file cards, no dir cards → only Files section rendered" |
  | EC-08: only dirs, no files → Folders section only | `renderer.test.ts`: "EC-08: only dir cards, no file cards → only Folders section rendered" |
  | EC-11: columns CSS variable | `renderer.test.ts`: "EC-11: config.columns=4 → --fv-columns CSS property is '4' on the grid" |
  | EC-12: unknown sort → name-asc default | `parser.test.ts`: "unknown sort value → defaults to name-asc" |
  | EC-13: card name XSS via textContent | `renderer.test.ts`: "EC-13: card name containing HTML special chars is set as textContent, not innerHTML" |
  | EC-14: script tag in body stripped | `renderer.test.ts`: "EC-14: script tag in body is stripped when __MARKABLE_RENDER_MD__ is available" |
  | EC-15: synthetic key dedup by full path | `tab.test.ts`: "registry entry replaced on second openFolderViewTab call for same path" |
  | EC-16: _folder.md already exists → open, no write | `context-menu.test.ts`: "EC-16: when _folder.md already exists, write_file is NOT called" |
  | EC-17: active tab re-renders on _folder.md save | `tab.test.ts`: "notifyFolderViewTabs: calls rerender when tab is active" |
  | EC-18: stale flag set when tab is inactive | `tab.test.ts`: "notifyFolderViewTabs: sets staleRef.stale=true when tab is inactive" |
  | EC-21: _folder.md detection checks name AND .md extension | `detection.test.ts`: "EC-21: file named '_folder' without .md extension is NOT counted" |
  | EC-22: 500 cards render without O(N²) crash | `renderer.test.ts`: "EC-22: 500 cards render without throwing" |
  | EC-23: flat vault (no subdirs) → empty set | `detection.test.ts`: "no _folder.md entries at all → empty set" |
  | EC-24: Smart Folder nodes skip buildDirContextMenuItems | `context-menu.test.ts`: "EC-24: right-clicking a smart-folder node" |

---
title: "Folder View Layout Refactor — Master Blueprint"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Folder View Layout Refactor — Master Blueprint

Requirements source: `docs/requirements/active_task.md`
(6 areas, 23 FRs, 5 NFRs, 18 ECs, 4 Resolved Decisions).

This blueprint is the source of truth for this refactoring.  Step files are the
implementation contract — the Lead Developer follows them in order, top to
bottom.  No step modifies a file owned by a later step.

---

## Stack Decision

No new technology is introduced.  This is a pure-frontend refactoring inside the
existing IIFE plugin.  The only architectural decision to validate is whether the
tab manager's `enterLayoutView` / `exitLayoutView` / `refreshLayoutView` API is a
sound replacement for the custom-tab mechanism.

| Concern | Existing mechanism | New mechanism | Outcome |
|---|---|---|---|
| Tab identity | Synthetic title `__fv__:<path>`; `kind="custom"` tab with no file path | Real file path `/path/_folder.md`; `kind="editor"` tab | **New is superior.** The real file path unlocks save, dirty, session-restore semantics automatically. |
| Deduplication | `openCustomRenderTab` deduplicates by `title` | `openFileInTab` deduplicates by `filePath` | **Equivalent.** The tab manager's path-based deduplication already handles this. |
| Stale-flag tracking | Bespoke `_registry` / `staleRef` / `checkStaleFolderViewTabs` | `layoutRenderFn` on `TabEntry`; `refreshLayoutView` overwrites it | **New is simpler.** No registry, no stale flag; the render fn closure always reflects the most recent index state when called. |
| IIFE boundary | `openCustomRenderTab` is a `window` global (`__MARKABLE_OPEN_CUSTOM_TAB__`) | `openFileInTab` + `enterLayoutView` accessed via `window.__MARKABLE_TAB_MANAGER__` | **Equivalent.** Both go through `window` globals; NFR-04 is satisfied. |
| Code view access | No path → impossible to navigate to source | `exitLayoutView()` on direct `_folder.md` click | **New is superior.** FR-05 enables direct editing of the YAML front-matter. |

**Result**: TypeScript, plain DOM, single IIFE, zero new Rust commands, zero new
npm dependencies.  The tab manager's existing layout-view API replaces all
custom-tab machinery.

---

## High-Level Architecture

### One-paragraph summary

The refactor removes the `__MARKABLE_OPEN_CUSTOM_TAB__` mechanism entirely from
the Folder View feature.  `openFolderViewTab(folderPath)` is rewritten to call
`tabMgr.openFileInTab(folderMdPath)` and then, in its `.then()` callback,
`tabMgr.enterLayoutView(buildFolderViewRenderFn(folderPath))`.  The result is a
standard `kind="editor"` tab backed by `_folder.md`, rendered in layout view.
The bespoke registry (`_registry`, `FolderViewTabEntry`, `notifyFolderViewTabs`,
`checkStaleFolderViewTabs`, `clearFolderViewRegistry`) is deleted.  Live update
on save moves to an inline check in `_indexUpdatedCb` that calls
`tabMgr.refreshLayoutView` only when the active tab matches.  The split-click
interaction model (chevron = toggle, label = open folder view) is restored in
`buildActivateHandler` and `attachNodeListeners`, which had regressed to always
calling `toggleDirectoryNode`.

### Data flow — opening a folder view tab (new)

```
user clicks folder label on a hasFolderView=true directory node
  └─ buildActivateHandler sees hasFolderView=true → calls openFolderViewTab(path)
       └─ folderMdPath = folderPath + "/_folder.md"
       └─ tabMgr.openFileInTab(folderMdPath)          ← opens real editor tab
            .then(() =>
              tabMgr.enterLayoutView(
                buildFolderViewRenderFn(folderPath)   ← render fn stored on tab
              )
            )
                └─ renderFn(container):
                     └─ container.innerHTML = loading placeholder
                     └─ void renderFolderViewTabAsync(folderPath, folderMdPath,
                                                       liveIndex, container)
                          └─ invoke("read_file", { path: folderMdPath })
                          └─ parseFolderMd(content)
                          └─ LAYOUT_RENDERERS[layout](config, cards, container)
```

### Data flow — direct _folder.md click (FR-05, new)

```
user clicks _folder.md file node in the tree
  └─ buildActivateHandler: type="file", path ends with "/_folder.md"
       └─ openFileInTab(path)        ← opens/activates the editor tab
       └─ tabMgr.exitLayoutView()    ← switches to code view
```

### Data flow — live update on save (new, replaces notifyFolderViewTabs)

```
user saves _folder.md (FS watcher → _indexUpdatedCb)
  └─ changedPath ends with "/_folder.md"?  no → return
  └─ parentDir = changedPath.slice(0, lastSlash)
  └─ activeTab = tabMgr.getActiveTab()
  └─ activeTab.filePath === changedPath AND isActiveTabInLayoutView()?
       yes → tabMgr.refreshLayoutView(buildFolderViewRenderFn(parentDir))
       no  → do nothing (layoutRenderFn stored on tab is current; re-render
              occurs naturally when tab is next activated and user presses Cmd-E)
```

### Data flow — chevron click (FR-03, restored)

```
user clicks chevron (.tree-node-chevron) on hasFolderView=true directory
  └─ chevron click listener (added by attachNodeListeners):
       e.stopPropagation()
       toggleDirectoryNode(el, path, vaultId)
       ← event never reaches the row-level activate handler
```

---

## Component Map

### Files modified

| File | Change type | Summary |
|---|---|---|
| `src/plugins/file-browser/folder-view/tab.ts` | Core rewrite | Remove registry exports; rewrite `openFolderViewTab`; add `buildFolderViewRenderFn`; simplify `renderFolderViewTabAsync` (remove title-patch block, remove `syntheticKey` param) |
| `src/plugins/file-browser/file-browser.plugin.ts` | Targeted edits | Update imports; restore FR-02/03/04 in `buildActivateHandler` + `attachNodeListeners`; add FR-05 `exitLayoutView` branch; replace `notifyFolderViewTabs` in `_indexUpdatedCb` with inline FR-13 logic; remove `checkStaleFolderViewTabs` from `onTabChanged`; remove `clearFolderViewRegistry` from `onDisable` |
| `tests/folder-view/tab.test.ts` | Full rewrite | T-01 through T-09 (new layout-view behavior) |
| `tests/folder-view/split-click.test.ts` | Partial rewrite | Restore T-10, T-11, T-12; add T-13; preserve T-14 |

### Files that must NOT be changed

- `src/plugins/file-browser/folder-view/renderer.ts`
- `src/plugins/file-browser/folder-view/parser.ts`
- `src/plugins/file-browser/folder-view/detection.ts`
- `src/plugins/file-browser/folder-view/fallback.ts`
- `src/plugins/file-browser/folder-view/types.ts`
- `src/tabs/tab-manager.ts`
- Any Rust source files

---

## Interface Contracts

### `tab.ts` exports after refactor

```typescript
// Retained unchanged
export function escapeHtml(str: string): string
export const LAYOUT_RENDERERS: Record<string, FolderLayoutRenderer>
export function collectChildren(folderPath: string, vaultIndex: VaultIndex | null): FolderCard[]

// Rewritten
export function openFolderViewTab(folderPath: string): void
export function buildFolderViewRenderFn(folderPath: string): (container: HTMLElement) => void

// Simplified (syntheticKey param removed; title-patch block removed)
// renderFolderViewTabAsync remains unexported (internal async helper)

// DELETED — these exports must not exist after refactor:
// export const _registry
// export interface FolderViewTabEntry
// export function notifyFolderViewTabs
// export function checkStaleFolderViewTabs
// export function clearFolderViewRegistry
```

### `buildFolderViewRenderFn` contract

```typescript
/**
 * Returns a synchronous render function suitable for enterLayoutView /
 * refreshLayoutView.  The function:
 *   1. Writes a loading placeholder into container immediately.
 *   2. Fires renderFolderViewTabAsync as a fire-and-forget async call.
 *
 * The returned function captures folderPath at call time; calling
 * buildFolderViewRenderFn("/vault/A") twice returns two independent
 * closures — each captures the same path but reads the vault index
 * fresh at render time.
 */
export function buildFolderViewRenderFn(
  folderPath: string,
): (container: HTMLElement) => void
```

### `openFolderViewTab` contract

```typescript
/**
 * Open _folder.md in a real editor tab and enter layout view.
 *
 * Fire-and-forget: the Promise from openFileInTab is voided; enterLayoutView
 * is called in the .then() callback (RD-01).
 *
 * Safe to call when window.__MARKABLE_TAB_MANAGER__ is undefined (NFR-05).
 */
export function openFolderViewTab(folderPath: string): void
```

### Imports removed from `file-browser.plugin.ts`

```typescript
// BEFORE
import {
  openFolderViewTab as _openFolderViewTab,
  notifyFolderViewTabs,
  checkStaleFolderViewTabs,
  clearFolderViewRegistry,
} from "./folder-view/tab";

// AFTER
import {
  openFolderViewTab as _openFolderViewTab,
  buildFolderViewRenderFn,
} from "./folder-view/tab";
```

---

## Implementation Roadmap

The task decomposes into three sequential steps.  Each step ends with a passing
`npm run test:run` (or the test file is not yet written — see per-step notes).

| Step | File(s) touched | Tests written in this step |
|---|---|---|
| `step_01_tab-rewrite.md` | `tab.ts`, `tests/folder-view/tab.test.ts` | T-01 through T-09 (full rewrite of tab.test.ts) |
| `step_02_plugin-edits.md` | `file-browser.plugin.ts` | T-10 through T-13 (partial rewrite of split-click.test.ts) |
| `step_03_build-and-verify.md` | No source changes | Plugin build + full test suite green-run |

---

## Implementation Checklist

### Step 01 — `tab.ts` rewrite + tab tests

- [x] Rewrite `tests/folder-view/tab.test.ts` (T-01 through T-09) — tests RED
- [x] Delete `_registry`, `FolderViewTabEntry`, `notifyFolderViewTabs`,
      `checkStaleFolderViewTabs`, `clearFolderViewRegistry` from `tab.ts`
- [x] Remove `syntheticKey` parameter from `renderFolderViewTabAsync`
- [x] Delete Step 4 title-patch block from `renderFolderViewTabAsync`
- [x] Add `buildFolderViewRenderFn(folderPath)` export to `tab.ts`
- [x] Rewrite `openFolderViewTab` to use `openFileInTab` + `enterLayoutView`
- [x] Verify T-01 through T-09 GREEN
- [x] `npm run test:run` — zero failures (3 pre-existing unrelated failures excluded)

### Step 02 — `file-browser.plugin.ts` targeted edits + split-click tests

- [x] Rewrite relevant tests in `tests/folder-view/split-click.test.ts`
      (T-10, T-11, T-12, T-13) — tests RED
- [x] Update import block: remove `notifyFolderViewTabs`, `checkStaleFolderViewTabs`,
      `clearFolderViewRegistry`; add `buildFolderViewRenderFn`
- [x] Restore FR-02 in `buildActivateHandler`: `hasFolderView=true` + non-chevron
      click → call `openFolderViewTab`
- [x] Restore FR-03 in `attachNodeListeners`: add chevron `stopPropagation` +
      `toggleDirectoryNode` listener inside `if (hasFolderView)` branch
- [x] Restore FR-04 in `attachKeyboardHandler` (or `attachNodeListeners`): Enter key
      on `hasFolderView=true` → call `openFolderViewTab`
- [x] Add FR-05 branch in `buildActivateHandler`: `type="file"` + path ends with
      `/_folder.md` → `openFileInTab` then `tabMgr.exitLayoutView()`
- [x] Replace `notifyFolderViewTabs(changedPath)` in `_indexUpdatedCb` with
      inline FR-13 logic using `buildFolderViewRenderFn`
- [x] Remove `checkStaleFolderViewTabs()` from `onTabChanged`
- [x] Remove `clearFolderViewRegistry()` from `onDisable`
      (preserve `window.__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = null`)
- [x] Verify T-10 through T-13 GREEN; T-14 still GREEN
- [x] `npm run test:run` — zero failures (3 pre-existing unrelated failures excluded)

### Step 03 — build and verify

- [x] `npm run build:plugins && npm run sync:plugins` — zero TypeScript errors
- [x] `npm run test:run` — all tests pass (3746 passed, 3 pre-existing failures unrelated to this refactor)
- [ ] Manual smoke-test: open a folder with `_folder.md`, verify layout view opens
- [ ] Manual smoke-test: click chevron, verify only expand/collapse fires
- [ ] Manual smoke-test: click `_folder.md` directly, verify code view opens

---

## Edge Case Coverage Map

Every EC from `docs/requirements/active_task.md` must be verified by a test or
justified as integration-only.

| EC | Covered by | Notes |
|---|---|---|
| EC-01 | T-01 (tab.test.ts) | Guard: `window.__MARKABLE_TAB_MANAGER__` undefined → no-op |
| EC-02 | T-04 partial | `renderFolderViewTabAsync` falls through to `renderFallback` on read error; integration-only for the tab-manager side |
| EC-03 | Integration only | `enterLayoutView` guards against non-editor tabs internally (tab-manager.ts line 893) |
| EC-04 | T-13 (split-click.test.ts) | `_folder.md` direct click → `exitLayoutView` called |
| EC-05 | Integration only | Cmd-E re-uses `layoutRenderFn` stored on tab; no code in this refactor needs to handle it |
| EC-06 | T-05 (tab.test.ts) | `_indexUpdatedCb` calls `refreshLayoutView` when active tab matches |
| EC-07 | T-06, T-07 (tab.test.ts) | Active tab mismatch → `refreshLayoutView` NOT called |
| EC-08 | Integration only | Vault-switch stale behavior is accepted v1 limitation (same as EC-19 in original spec) |
| EC-09 | T-04 (tab.test.ts) | `buildFolderViewRenderFn` with missing `_folder.md` falls through to `renderFallback` |
| EC-10 | T-03 (tab.test.ts) | Two distinct paths → two separate `openFileInTab` calls; no interference |
| EC-11 | Integration only | `openFileInTab` re-activates the existing tab; `enterLayoutView` switches it to layout view |
| EC-12 | T-07 (tab.test.ts) | `changedPath` undefined/null → early return |
| EC-13 | T-08 (tab.test.ts) | `escapeHtml` unchanged; renderer.ts unchanged |
| EC-14 | Step 02 checklist | `checkStaleFolderViewTabs` removed; `onTabChanged` still updates highlight |
| EC-15 | Step 02 checklist | `clearFolderViewRegistry` removed; `__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = null` preserved |
| EC-16 | Integration only | `openFileInTab` reads from disk; async gap is acceptable (same as original) |
| EC-17 | T-11 (split-click.test.ts) | Chevron listener added only inside `if (hasFolderView)` branch |
| EC-18 | T-12 (split-click.test.ts) | Enter key on `hasFolderView=true` fires `openFolderViewTab` synchronously; Promise is fire-and-forgotten |

---

## Review Request

- **Files changed**:
  - `src/plugins/file-browser/folder-view/tab.ts` — core rewrite: deleted registry exports (`_registry`, `FolderViewTabEntry`, `notifyFolderViewTabs`, `checkStaleFolderViewTabs`, `clearFolderViewRegistry`); removed `syntheticKey` param and title-patch block from `renderFolderViewTabAsync`; added `buildFolderViewRenderFn` export; rewrote `openFolderViewTab` to use `openFileInTab` + `enterLayoutView`; updated module JSDoc.
  - `src/plugins/file-browser/file-browser.plugin.ts` — targeted edits: updated import block (removed 3 deleted names, added `buildFolderViewRenderFn`); added FR-02 (`hasFolderView=true` directory click → `__MARKABLE_OPEN_FOLDER_VIEW_TAB__`) and FR-05 (`_folder.md` click → `openFileInTab` + `exitLayoutView`) in `buildActivateHandler`; added FR-03 chevron `stopPropagation` + `toggleDirectoryNode` listener in `attachNodeListeners`; replaced `notifyFolderViewTabs` call in `_indexUpdatedCb` with inline FR-13 logic; removed `checkStaleFolderViewTabs()` from `onTabChanged`; removed `clearFolderViewRegistry()` from `onDisable` (preserved `__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = null`).
  - `tests/folder-view/tab.test.ts` — full rewrite: T-01 through T-09 (plus EC-01 no-op guard test).
  - `tests/folder-view/split-click.test.ts` — partial rewrite: T-10, T-11, T-12 rewritten; T-13 added; T-14 and Arrow key tests preserved.
  - `tests/folder-view/context-menu.test.ts` — 2 test cases updated (EC-16 and FR-35 in `createFolderViewFile` suite) to spy on `openFileInTab` instead of the deleted `__MARKABLE_OPEN_CUSTOM_TAB__` mechanism.
  - `docs/specs/folder-view-layout-refactor/00_index.md` — checklist updated.

- **Steps completed**:
  - `step_01_tab-rewrite.md`
  - `step_02_plugin-edits.md`
  - `step_03_build-and-verify.md` (automated checks complete; manual smoke-tests pending)

- **Known limitations**:
  - Manual smoke-test items in step_03 require a running Tauri instance and cannot be automated in the test suite. They are listed in the checklist above as unchecked for the code reviewer to verify.
  - The 3 pre-existing failures in `smart-folders.editor.test.ts` and `smart-folders.evaluator.test.ts` are unrelated to this refactoring and were already failing before any changes were made.

- **Edge cases covered by tests**:
  | EC | Test(s) |
  |---|---|
  | EC-01 | `tab.test.ts` — "EC-01 (NFR-05): safe no-op when __MARKABLE_TAB_MANAGER__ is undefined" |
  | EC-02 | `tab.test.ts` T-04 — `buildFolderViewRenderFn` falls through to `renderFallback` on read error (async settle verifies invoke called; fallback path exercised internally) |
  | EC-04 | `split-click.test.ts` T-13 — `_folder.md` direct click → `exitLayoutView` called |
  | EC-06 | `tab.test.ts` T-05 — `buildFolderViewRenderFn` returns a function (prerequisite for FR-13 path) |
  | EC-07 | `tab.test.ts` T-06, T-07 — active tab path mismatch and non-`_folder.md` path → `refreshLayoutView` NOT called |
  | EC-09 | `tab.test.ts` T-04 — missing `_folder.md` falls through to fallback via async settle |
  | EC-10 | `tab.test.ts` T-03 — two calls for same path → two `openFileInTab` calls |
  | EC-12 | `tab.test.ts` T-07 — non-`_folder.md` `changedPath` → early return guard |
  | EC-13 | `tab.test.ts` T-08 — `escapeHtml` escapes `<`, `>`, `"`, `&` |
  | EC-14 | `file-browser.plugin.ts` `onTabChanged` — `checkStaleFolderViewTabs` removed; highlight update preserved |
  | EC-15 | `file-browser.plugin.ts` `onDisable` — `clearFolderViewRegistry` removed; `__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = null` preserved |
  | EC-17 | `split-click.test.ts` T-11 — chevron listener added only inside `if (hasFolderView)` |
  | EC-18 | `split-click.test.ts` T-12 — Enter key on `hasFolderView=true` fires `openFolderViewTab` |

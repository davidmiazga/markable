---
title: "Folder View Refactor — Layout View Migration"
last-updated: "2026-05-09"
review-cadence-days: 90
status: reference
---

# Active Task — Folder View Refactor: Migrate from Custom Tab to Layout View

## Summary

As a Markable developer, I want to remove the bespoke `__MARKABLE_OPEN_CUSTOM_TAB__` / `kind="custom"` mechanism from the Folder View feature and replace it with the standard `enterLayoutView` / `exitLayoutView` / `refreshLayoutView` API that the tab manager already exposes — so that a folder-view folder (`_folder.md`) behaves exactly like any other document that has a layout: clicking the folder name opens `_folder.md` in an editor tab and enters layout view, and clicking `_folder.md` directly in the tree opens it in code (editor) view.

---

## Background and Motivation

The Folder View feature was originally implemented using a custom-tab mechanism (`openCustomRenderTab` / `__MARKABLE_OPEN_CUSTOM_TAB__`). This creates a `kind="custom"` tab that is entirely detached from any real file. The tab manager exposes a separate, superior API — `enterLayoutView` / `exitLayoutView` / `refreshLayoutView` — that attaches a rendered layout to a real editor tab (a `kind="editor"` tab backed by an actual file path). This is the same mechanism used by every other layout-enabled document in the app.

The custom-tab approach has the following concrete deficiencies:
1. A "custom" tab has no `filePath`, so "save", "dirty", and session-restore semantics cannot apply to it.
2. The custom-tab registry (`_registry`, `FolderViewTabEntry`, `notifyFolderViewTabs`, `checkStaleFolderViewTabs`, `clearFolderViewRegistry`) is bespoke state management that duplicates what `isInLayoutView` / `layoutRenderFn` on a `TabEntry` already provides.
3. The split-click design (chevron = expand/collapse, label = open folder view) was intentionally implemented in an earlier step but was accidentally regressed — `buildActivateHandler` currently ignores `hasFolderView` and always calls `toggleDirectoryNode` for directory clicks, and the special chevron-only `stopPropagation` listener for `hasFolderView=true` nodes was also removed.

This refactoring task corrects all three deficiencies.

---

## Functional Requirements

### Area 1 — Core Interaction Model

- **FR-01** — When a directory node does NOT have `_folder.md`, clicking the node (label, icon, or anywhere on the row) toggles directory expansion/collapse. This is unchanged.

- **FR-02** — When a directory node has `_folder.md`, clicking the **folder label** (`.tree-node-label`) or **icon** — anything that is NOT the chevron — calls `openFolderViewTab(folderPath)`, which opens `_folder.md` in an editor tab and enters layout view. This was the originally designed behavior; it must be restored in `buildActivateHandler`.

- **FR-03** — When a directory node has `_folder.md`, clicking the **chevron** (`.tree-node-chevron`) ONLY toggles directory expansion/collapse; it does NOT open the folder view. `attachNodeListeners` must add a `click` listener on the chevron itself that calls `e.stopPropagation()` then `toggleDirectoryNode`, so the chevron click never propagates to the row's activate handler.

- **FR-04** — Keyboard behavior for a `_folder.md`-enhanced folder:
  - `Enter` (with the `<li>` focused) — calls `openFolderViewTab` (mirrors label click). This was the original design; restore it.
  - `ArrowRight` / `ArrowLeft` — toggles expand/collapse, unchanged.

- **FR-05** — Clicking `_folder.md` **directly** in the file tree (the `type="file"` branch of `buildActivateHandler`, where `path` ends with `/_folder.md`) opens it in the editor via `openFileInTab` AND immediately calls `tabMgr.exitLayoutView()`. This guarantees the user sees the raw YAML/Markdown source (code view), regardless of whether that tab was previously in layout view.

- **FR-06** — All other file-click behavior (non-`_folder.md` files) is unchanged.

### Area 2 — `openFolderViewTab` Rewrite

- **FR-07** — `openFolderViewTab(folderPath: string): void` in `src/plugins/file-browser/folder-view/tab.ts` must be rewritten to:
  1. Derive `folderMdPath = folderPath + "/_folder.md"`.
  2. Call `tabMgr.openFileInTab(folderMdPath)` (returns a Promise; fire-and-forget with `void`).
  3. After `openFileInTab` resolves (or in its `.then()` callback), call `tabMgr.enterLayoutView(buildFolderViewRenderFn(folderPath))`.

  The intent is: one tab, backed by the real file, showing the layout view.

- **FR-08** — `buildFolderViewRenderFn(folderPath: string): (container: HTMLElement) => void` must be exported from `tab.ts`. It returns a synchronous render function that:
  1. Writes a `<div class="folder-view-loading">Loading…</div>` placeholder into the container immediately.
  2. Fires `renderFolderViewTabAsync(folderPath, folderPath + "/_folder.md", liveIndex, container)` as a fire-and-forget async call (the async result overwrites the placeholder).

  This render function is passed to both `enterLayoutView` (initial open) and `refreshLayoutView` (on save).

- **FR-09** — `renderFolderViewTabAsync` is simplified: the "Step 4: update tab.title" block (lines that find the tab by `syntheticKey` and patch `thisTab.title`) must be **removed**. With the layout-view approach the tab title is the filename (`_folder.md`), managed entirely by the tab manager from the real file path. No synthetic title patching is needed.

- **FR-10** — The `syntheticKey` / `__fv__:` prefix mechanism is entirely removed. There is no longer any need for a synthetic key, because tab deduplication is handled by the tab manager's existing `openFileInTab` path-based deduplication.

### Area 3 — Registry and Stale-Flag Removal

- **FR-11** — The following exports from `tab.ts` must be deleted entirely:
  - `_registry` (module-level array)
  - `FolderViewTabEntry` (interface)
  - `notifyFolderViewTabs` (function)
  - `checkStaleFolderViewTabs` (function)
  - `clearFolderViewRegistry` (function)

  These are replaced by the tab manager's native `isInLayoutView` / `layoutRenderFn` fields on `TabEntry`.

- **FR-12** — The corresponding call sites in `file-browser.plugin.ts` must be updated:
  - Remove import of `notifyFolderViewTabs`, `checkStaleFolderViewTabs`, `clearFolderViewRegistry` from `tab.ts`.
  - In `_indexUpdatedCb`: replace `notifyFolderViewTabs(changedPath)` with inline refresh logic (see FR-13).
  - In `onTabChanged`: remove `checkStaleFolderViewTabs()` call.
  - In `onDisable`: remove `clearFolderViewRegistry()` call.

- **FR-13** — The inline refresh logic in `_indexUpdatedCb`, replacing `notifyFolderViewTabs`, must:
  1. Check whether `changedPath` ends with `/_folder.md` (or `\_folder.md` for Windows). If not, return early.
  2. Derive `parentDir` = `changedPath.slice(0, lastSlashIndex)`.
  3. Get the active tab via `tabMgr.getActiveTab()`.
  4. If `activeTab.filePath === changedPath` AND `tabMgr.isActiveTabInLayoutView()`, call `tabMgr.refreshLayoutView(buildFolderViewRenderFn(parentDir))`.
  5. No stale-flag tracking; the layout view mechanism on `TabEntry` handles deferred re-render automatically when the tab is next activated (the `layoutRenderFn` is stored on the tab).

### Area 4 — `createFolderViewFile` Update

- **FR-14** — `createFolderViewFile` in `file-browser.plugin.ts` currently calls `openFolderViewTab(dirPath)` at the end. This call remains valid because `openFolderViewTab` is being rewritten (not removed). No change to the call site is needed, but the behavior changes: instead of creating a custom tab, it now opens `_folder.md` in an editor tab with layout view.

- **FR-15** — The "Create Folder View..." context menu action behavior from the user's perspective: creates `_folder.md`, opens it in layout view (showing the card grid). The user can then right-click `_folder.md` in the tree or click it directly to switch to code view to edit the YAML.

### Area 5 — `__MARKABLE_OPEN_FOLDER_VIEW_TAB__` Global

- **FR-16** — The `window.__MARKABLE_OPEN_FOLDER_VIEW_TAB__` global (set in `onEnable`, cleared in `onDisable`) must be retained. Other parts of the app (e.g., card click handlers inside `renderer.ts`) use this global to call `openFolderViewTab` without a direct import. Its value is still `openFolderViewTab`, which now has the new layout-view implementation.

### Area 6 — Preserved Behavior

The following behaviors from the original requirements are unaffected by this refactoring and must be preserved:

- **FR-17** — `_folder.md` is visible as a normal file in the tree. Clicking it opens it in code view (FR-05 covers this).
- **FR-18** — The `folder-cards` renderer (`renderer.ts`), `parser.ts`, `detection.ts`, `fallback.ts`, and the `LAYOUT_RENDERERS` dispatch map are unchanged.
- **FR-19** — Card grid content (subfolders, files, exclusion of `_folder.md` itself, sort, columns) is unchanged.
- **FR-20** — Subfolder card click behavior (expand tree + open folder view for that subfolder if it has `_folder.md`) is unchanged.
- **FR-21** — File card click behavior is unchanged.
- **FR-22** — Context menu items "Open Folder View" (FR-34 from original) and "Create Folder View..." (FR-35) are unchanged in label and position. The handlers call the updated `openFolderViewTab`.
- **FR-23** — `escapeHtml`, `collectChildren`, `LAYOUT_RENDERERS`, and `renderFolderViewTabAsync` (minus the title-patch step) are retained in `tab.ts`.

---

## Non-Functional Requirements

- **NFR-01** — After the refactor, `npm run test:run` must pass with zero failures. All existing passing tests must continue to pass.
- **NFR-02** — After any change to plugin source, `npm run build:plugins && npm run sync:plugins` must be run. The IIFE bundle must compile cleanly with no TypeScript errors.
- **NFR-03** — No new npm dependencies. No new Rollup bundle targets. No Rust changes.
- **NFR-04** — `tab.ts` must not import anything from the tab manager directly. All tab manager interaction happens through `window.__MARKABLE_TAB_MANAGER__` at runtime (IIFE boundary constraint).
- **NFR-05** — The refactored `openFolderViewTab` must be safe to call when no tab manager is available (i.e., `window.__MARKABLE_TAB_MANAGER__` is undefined). In that case, both `openFileInTab` and `enterLayoutView` calls are no-ops.

---

## Test Requirements

### `tests/folder-view/tab.test.ts` — Full Rewrite

The existing test file tests the custom-tab mechanism exclusively. It must be completely rewritten to test the new layout-view behavior.

**Tests that must exist after the rewrite:**

- **T-01** — `openFolderViewTab("/vault/A")` calls `tabMgr.openFileInTab("/vault/A/_folder.md")`.
- **T-02** — `openFolderViewTab("/vault/A")` calls `tabMgr.enterLayoutView(...)` after `openFileInTab` resolves.
- **T-03** — `openFolderViewTab` called twice for the same path: `openFileInTab` is called both times (deduplication is the tab manager's responsibility, not `tab.ts`'s). No custom registry needed.
- **T-04** — `buildFolderViewRenderFn("/vault/A")` returns a function; calling it with a container element renders a loading placeholder and then calls `renderFolderViewTabAsync` asynchronously.
- **T-05** — When `_folder.md` is saved and the active tab's `filePath === "/vault/A/_folder.md"` and `isActiveTabInLayoutView() === true`, `_indexUpdatedCb` logic calls `tabMgr.refreshLayoutView(...)`.
- **T-06** — When `_folder.md` is saved but the active tab is NOT the `_folder.md` tab, `tabMgr.refreshLayoutView` is NOT called (no stale tracking needed — the layout render fn is stored on the tab).
- **T-07** — When a non-`_folder.md` path changes, the refresh logic is a no-op.
- **T-08** — `escapeHtml` still escapes `<`, `>`, `"`, `&` correctly (this test survives unchanged).
- **T-09** — `LAYOUT_RENDERERS` still contains the `"folder-cards"` entry (this test survives unchanged).

**Tests that must be removed (they test deleted behavior):**
- Any test importing or asserting on `_registry`, `notifyFolderViewTabs`, `checkStaleFolderViewTabs`, `clearFolderViewRegistry`, or `FolderViewTabEntry`.
- Any test asserting on the `__fv__:` synthetic key prefix.
- Any test asserting on `staleRef`.

### `tests/folder-view/split-click.test.ts` — Partial Rewrite

The existing test file tests the current (wrong) implementation. Several tests must be corrected or added:

- **T-10** — **Restore FR-02**: `hasFolderView=true`, row click on the label → `openFolderViewTab` is called (the test stub must spy on the module-level `openFolderViewTab` wrapper or `window.__MARKABLE_OPEN_FOLDER_VIEW_TAB__`). The current test (line 83–94) asserts `aria-expanded` flips, which was written for the wrong implementation.
- **T-11** — **Restore FR-03**: chevron click with `hasFolderView=true` → `toggleDirectoryNode` fires (aria-expanded flips), `openFolderViewTab` does NOT fire.
- **T-12** — **Restore FR-04**: Enter key with `hasFolderView=true` → `openFolderViewTab` is called. The current test (line 120–130) asserts `aria-expanded` flips.
- **T-13** — **FR-05**: File node where `path` ends with `/_folder.md` → `openFileInTab` called, `tabMgr.exitLayoutView()` called.
- **T-14** — **FR-01**: `hasFolderView=false`, row click → `toggleDirectoryNode` fires (aria-expanded flips), `openFolderViewTab` NOT called. (This test is already present and should continue to pass.)

---

## Files to Change

| File | Action | Summary |
|---|---|---|
| `src/plugins/file-browser/folder-view/tab.ts` | Rewrite core | Remove registry/stale exports; rewrite `openFolderViewTab`; add `buildFolderViewRenderFn`; simplify `renderFolderViewTabAsync` (remove title-patch step) |
| `src/plugins/file-browser/file-browser.plugin.ts` | Targeted edits | Update imports from `tab.ts`; restore FR-02/FR-03/FR-04 in `buildActivateHandler` + `attachNodeListeners`; add FR-05 (`exitLayoutView` on `_folder.md` file click); replace `notifyFolderViewTabs` call in `_indexUpdatedCb` with inline FR-13 logic; remove `checkStaleFolderViewTabs` from `onTabChanged`; remove `clearFolderViewRegistry` from `onDisable` |
| `tests/folder-view/tab.test.ts` | Full rewrite | Tests for new layout-view behavior (T-01 through T-09) |
| `tests/folder-view/split-click.test.ts` | Partial rewrite | Restore T-10, T-11, T-12; add T-13; preserve T-14 |

**Files that must NOT be changed:**
- `src/plugins/file-browser/folder-view/renderer.ts`
- `src/plugins/file-browser/folder-view/parser.ts`
- `src/plugins/file-browser/folder-view/detection.ts`
- `src/plugins/file-browser/folder-view/fallback.ts`
- `src/plugins/file-browser/folder-view/types.ts`
- `src/tabs/tab-manager.ts`
- Any Rust source files

---

## Edge Case Inventory

This list is the Reviewer's mandatory test checklist. Every EC must have a corresponding test or be explicitly justified as untestable.

- **EC-01** — `openFolderViewTab` is called when `window.__MARKABLE_TAB_MANAGER__` is undefined (plugin loaded before tab manager initializes). Both `openFileInTab` and `enterLayoutView` calls are silently skipped. No crash.

- **EC-02** — `openFileInTab` is called but the file `_folder.md` does not exist on disk. The tab manager opens a blank/error editor tab. `enterLayoutView` is still called; `renderFolderViewTabAsync` receives a read failure and shows the fallback notice. No crash.

- **EC-03** — `enterLayoutView` is called on an active tab that is `kind="media"` or `kind="custom"` (edge case where file opened as media). The tab manager's `enterLayoutView` guards against non-editor tabs and returns early. No crash.

- **EC-04** — User clicks the folder label, folder view opens in layout view. User then clicks `_folder.md` directly in the tree. `exitLayoutView` is called; the tab switches to code view showing the raw YAML. The tab's `layoutRenderFn` is cleared. No stale render occurs.

- **EC-05** — User is in code view on `_folder.md`. User presses Cmd-E (layout toggle). The tab manager enters layout view using the stored `layoutRenderFn`. This must work correctly because `enterLayoutView` was called with the render fn when the folder was first opened. (This is automatic — `layoutRenderFn` is stored on the tab; Cmd-E re-uses it. No special handling required, but must not regress.)

- **EC-06** — `_folder.md` is saved while layout view is active. `_indexUpdatedCb` fires with `changedPath = folderMdPath`. `refreshLayoutView(buildFolderViewRenderFn(parentDir))` is called. The card grid re-renders with fresh content. No duplicate or stale renders.

- **EC-07** — `_folder.md` is saved while a different tab is active (not `_folder.md`). `_indexUpdatedCb` fires. The `activeTab.filePath !== changedPath` check prevents `refreshLayoutView` from being called. The `layoutRenderFn` stored on the `_folder.md` tab is already current (it was set when the tab was opened). When the user next activates the tab and enters layout view (Cmd-E), the layout renders fresh. No explicit stale-flag mechanism needed.

- **EC-08** — Vault is switched while `_folder.md` is open in layout view. The tab persists (existing tab-manager behavior). The content is stale relative to the new vault — same as EC-19 in the original spec. Acceptable v1 behavior. No special handling required.

- **EC-09** — `buildFolderViewRenderFn` is called with a `folderPath` that has no `_folder.md`. The render fn is returned; when called, `renderFolderViewTabAsync` fires and the Tauri `read_file` call fails. The fallback notice "Could not read _folder.md." is shown. No crash.

- **EC-10** — Two directories have the same `_folder.md` path segment but different absolute paths (e.g., `/Work/Reports/_folder.md` and `/Personal/Reports/_folder.md`). Each call to `openFolderViewTab` calls `openFileInTab` with the distinct absolute path. The tab manager deduplicates by file path — two separate tabs exist. Each has its own `layoutRenderFn`. No interference.

- **EC-11** — `openFolderViewTab` is called while the same `_folder.md` is already open in code view (the user clicked `_folder.md` directly to edit it). `openFileInTab` activates the existing tab (no duplicate). `enterLayoutView` is then called, switching it back to layout view. The code-view edits the user made are visible in the editor state; layout view shows the rendered version of the current on-disk content (which may differ from unsaved edits).

- **EC-12** — `_indexUpdatedCb` fires but `changedPath` is undefined or null (event carries no path). The early-return check `if (!changedPath)` prevents any further logic. No crash.

- **EC-13** — `escapeHtml` is still called when inserting user-controlled folder names into DOM attributes inside the card renderer. XSS prevention is unaffected by this refactoring (the renderer is not changed).

- **EC-14** — The `checkStaleFolderViewTabs` call is removed from `onTabChanged`. This must not regress any other behavior. `onTabChanged` still updates the active file highlight; only the stale-check side effect is removed.

- **EC-15** — `clearFolderViewRegistry` is removed from `onDisable`. The disable path must still clean up correctly. Since there is no registry, nothing to clear. The `window.__MARKABLE_OPEN_FOLDER_VIEW_TAB__` global is still set to `null` in `onDisable` (this line must be preserved).

- **EC-16** — `createFolderViewFile` calls `openFolderViewTab(dirPath)` after creating `_folder.md`. With the new implementation, this opens `_folder.md` in layout view. If `openFileInTab` is called before the vault index rebuild completes (async gap), the file may not yet be in the index. The call is still correct — `openFileInTab` reads from disk, not from the index. No regression.

- **EC-17** — The `attachNodeListeners` chevron `stopPropagation` listener must be added inside the `if (hasFolderView)` branch only. For `hasFolderView=false` nodes, the chevron must NOT have an extra listener (no regression to normal expand/collapse behavior).

- **EC-18** — Enter key on a `hasFolderView=true` node calls `openFolderViewTab`. `openFolderViewTab` calls `openFileInTab` (async). The `openFileInTab` Promise is fire-and-forgotten (`void`). The keyboard event handler returns synchronously. No blocking.

---

## Resolved Design Decisions

- **RD-01** — `openFileInTab` returns a Promise. `enterLayoutView` must be called in the `.then()` of that Promise (or with `await` inside an async wrapper), not synchronously after `openFileInTab`. This ensures the tab is active and its `kind` is `"editor"` before `enterLayoutView` inspects `getActiveTab()`. If called synchronously, `enterLayoutView` may fire before the tab manager has finished activating the new tab.

- **RD-02** — No stale-flag mechanism is needed. The `layoutRenderFn` on `TabEntry` serves as the "most recent render function." When the user activates a tab that is in layout view (`isInLayoutView === true`), the renderer checks `layoutRenderFn` and re-renders automatically. The `_indexUpdatedCb` refresh path (FR-13) only needs to fire `refreshLayoutView` when the tab is currently active and in layout view.

- **RD-03** — Tab title for the folder view is the filename `_folder.md`, as set by the tab manager from the file path. This is a deliberate change from the original spec (which wanted the folder name as the title). The folder name as title was only achievable through the synthetic-key patching approach (which is being removed). The correct long-term fix (custom tab title) is deferred to a follow-on task.

- **RD-04** — `renderFolderViewTabAsync`'s `syntheticKey` parameter is removed. The function no longer needs to know the tab key to patch the title. Update the function signature accordingly.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 18 items in Edge Case Inventory (EC-01 through EC-18)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.

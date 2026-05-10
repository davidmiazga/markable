---
title: "Step 03 — Build and verify"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Step 03 — Build and verify

**Prerequisite**: Steps 01 and 02 complete; `npm run test:run` is GREEN.

**Files touched in this step**: none (read-only verification step).

---

## 1. Plugin build

Run the plugin compiler and sync step:

```bash
npm run build:plugins && npm run sync:plugins
```

Expected outcomes:
- Zero TypeScript errors in the Rollup output for `file-browser.plugin.ts`.
- Zero TypeScript errors in the Rollup output for `folder-view/tab.ts`.
- The IIFE bundle is written to `src-tauri/plugins/core/file-browser.plugin.js`.
- `npm run sync:plugins` copies it to the app data directory without errors.

If TypeScript errors appear, fix them before continuing.  Common errors to
expect and their resolutions:

| Error | Cause | Fix |
|---|---|---|
| `notifyFolderViewTabs is not exported` | Step 01 import-block fix not applied | Remove the three deleted names from the import block in `file-browser.plugin.ts` |
| `checkStaleFolderViewTabs is not defined` | Temporary comment not cleaned up | Remove the `// TODO step 02:` comment and the commented-out call |
| `clearFolderViewRegistry is not defined` | Same as above | Same fix |
| `Property 'syntheticKey' does not exist` | Old call to `renderFolderViewTabAsync` still passing 5 args | Update the call to 4 args |
| `_hasFolderView` unused | `buildActivateHandler` param still has underscore prefix | Rename `_hasFolderView` to `hasFolderView` in the function body |

---

## 2. Full test suite

```bash
npm run test:run
```

Expected: zero failures.  All tests from the entire test suite must pass,
not just the folder-view tests.

If any non-folder-view test fails, diagnose whether the failure is a pre-existing
flake or a regression introduced by this refactoring.  If it is a regression,
fix it.

---

## 3. Manual smoke-test checklist

With `npm run tauri dev` running:

- [ ] Open a vault that contains a folder with `_folder.md`.
- [ ] Click the folder label (not the chevron) → layout view opens showing the
      card grid.  The tab title is `_folder.md`.
- [ ] Click the chevron on the same folder → the directory expands/collapses
      without opening a new tab or switching to the folder view.
- [ ] Click `_folder.md` in the tree directly → the tab switches to code view
      showing the raw YAML front-matter.  The `has-layout-view` CSS class is
      removed from `document.body`.
- [ ] Save `_folder.md` while the layout view tab is active → the card grid
      re-renders with the updated content.
- [ ] Save `_folder.md` while a different tab is active → no visible effect;
      switching back to `_folder.md` and pressing Cmd-E shows fresh content.
- [ ] Press Enter on a `hasFolderView=true` directory node → layout view opens
      (same as label click).
- [ ] Disable and re-enable the file-browser plugin via settings →
      `window.__MARKABLE_OPEN_FOLDER_VIEW_TAB__` is `null` after disable,
      `openFolderViewTab` after re-enable.

---

## 4. Definition of done

The refactoring is complete when:

1. `npm run build:plugins && npm run sync:plugins` exits with code 0.
2. `npm run test:run` exits with code 0 and shows zero failures.
3. All smoke-test checklist items above are checked off.
4. The following exports no longer exist in `tab.ts`:
   - `_registry`
   - `FolderViewTabEntry`
   - `notifyFolderViewTabs`
   - `checkStaleFolderViewTabs`
   - `clearFolderViewRegistry`
5. The following call sites no longer exist in `file-browser.plugin.ts`:
   - `notifyFolderViewTabs(changedPath)`
   - `checkStaleFolderViewTabs()`
   - `clearFolderViewRegistry()`
6. `docs/specs/folder-view-layout-refactor/00_index.md` checklist is fully
   checked off.

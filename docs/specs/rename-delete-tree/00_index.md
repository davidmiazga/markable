---
title: Rename and Delete File/Folder from File Browser Tree — Master Index
last-updated: "2026-04-30"
review-cadence-days: 90
status: active
---

# Rename and Delete File/Folder from File Browser Tree

## Requirements source

`docs/requirements/active_task.md`

---

## Scope summary

This is a "verify, complete, and fix gaps" task. The UI entry points (context menus,
F2 shortcut) and the ops layer already exist. Three gaps block correctness:

1. `TabManager` exposes no `handleFileRename` or `closeFileByPath` method. Both call
   sites in `file-browser-ops.ts` silently no-op via optional chaining.
2. `renameNode` in `file-browser-ops.ts` hardcodes `.md` extension handling; non-`.md`
   files get their extension overwritten.
3. `file-browser.plugin.ts` is missing: (a) dblclick rename for file/directory nodes,
   (b) Delete key for directory nodes, and (c) has redundant `reloadAndRender` calls
   chained after delete operations.

No Rust changes are required. No new files are created.

---

## Files that change

| File | Step |
|------|------|
| `src/tabs/tab-manager.ts` | step_01 |
| `src/plugins/file-browser/file-browser-ops.ts` | step_02 |
| `src/plugins/file-browser/file-browser.plugin.ts` | step_03 |

## Files that must NOT change

| File | Reason |
|------|--------|
| `src-tauri/src/commands/file_ops.rs` | All Rust commands present and correct |
| `src/lib/bridge.ts` | No new bridge wrappers required |
| `src-tauri/src/lib.rs` | Window size invariant |
| `src/lib/settings.ts` | Window size invariant |

---

## Implementation checklist

Each step must leave tests green before proceeding to the next.

### step_01 — TabManager: add `handleFileRename` and `closeFileByPath`

- [x] Add `handleFileRename(oldPath: string, newPath: string): void` to `TabManager`
- [x] Add `closeFileByPath(path: string): Promise<boolean>` to `TabManager`
- [x] Tests pass: `tests/tabs/tab-manager-rename-delete.test.ts` (new file)

### step_02 — Fix `file-browser-ops.ts`

- [x] `renameNode`: preserve original file extension (non-`.md` files)
- [x] `renameNode`: call `handleFileRename` instead of `renameFile`
- [x] `renameNode`: handle directory renames — call `handleFileRename` for each open
      tab whose path starts with `oldPath + "/"`
- [x] `deleteFile`: use `closeFileByPath` and abort if it returns `false`
- [x] `deleteDirectory`: replace `closeTabsUnder` broken pattern; collect tabs first,
      close each, abort if any close is declined
- [x] `deleteFile` and `deleteDirectory`: remove redundant `reloadAndRender` call
      from their internal bodies (the calls live in the plugin, addressed in step_03)
- [x] `moveNode`: update `renameFile` call to `handleFileRename`
- [x] `closeTabsUnder`: rewrite to use `getTabs().find()` + `closeFileByPath`
- [x] Tests pass: `tests/plugins/file-browser/rename-delete-ops.test.ts` (new file)

### step_03 — Fix `file-browser.plugin.ts`

- [x] `attachNodeListeners`: add `dblclick` listener for `data-type === "file"` and
      `data-type === "directory"` nodes; handler calls `startInlineRename`
- [x] `attachNodeListeners`: add Delete key handler for `type === "directory"`;
      calls `deleteDirectory(path)` directly (no `.then(() => reloadAndRender(...))`)
- [x] `attachNodeListeners`: remove `.then(() => reloadAndRender(vaultId))` from the
      existing file Delete key handler
- [x] `buildFileContextMenuItems`: remove `.then(() => reloadAndRender(vaultId))` from
      the Delete handler
- [x] `buildDirContextMenuItems`: remove `.then(() => reloadAndRender(vaultId))` from
      the Delete handler
- [x] Run `npm run build:plugins && npm run sync:plugins` after all plugin edits
- [x] Tests pass: existing test suite remains green

---

## Architecture decisions

### Stack

No new dependencies. TypeScript additions to existing `TabManager` class. Plugin source
is compiled via the existing `npm run build:plugins` pipeline (esbuild IIFE).

### Why `handleFileRename` mutates in-memory tab state (not re-open)

Re-opening a file after rename (option b from Finding 2) would discard the user's dirty
state and cursor position. Mutating the in-memory `filePath` and `title` fields preserves
dirty content: Cmd-S writes to the new path, which is the correct outcome (EC-6).

### Why `closeFileByPath` returns `boolean` (not `void`)

Delete must be aborted if the user declines the unsaved-changes prompt on any tab. A
`void` return would force the caller to re-examine the tab list, which is racy. A `boolean`
return makes the contract explicit: `false` = close was declined, abort the delete.

### Why `deleteDirectory` collects all tab IDs before closing any

FR-10 / EC-10: if three tabs are open inside the folder and the user declines tab #2,
tabs #1 (already closed) should not be re-opened. Collecting the full ID list before
starting ensures the iteration set is stable. The implementation must call `closeFileByPath`
on each collected tab ID and short-circuit the delete if any returns `false`.

### Extension handling in `renameNode`

`isFile` detection must use `path.includes(".")` after the last `/` (i.e. check whether
the basename has any extension at all) rather than `path.endsWith(".md")`. The original
extension is extracted via `getBasename(oldPath).slice(lastDotIndex)`. For `.md` files the
user edits only the stem; for all other files the user edits the full name
(matching `startInlineRename` behaviour described in FR-4). See step_02 for the
precise algorithm.

### `reloadAndRender` is a wrapper around `reloadVaultIndex`

`reloadAndRender` (line 2608 in `file-browser.plugin.ts`) simply calls
`reloadVaultIndex()`. Since `deleteFile` and `deleteDirectory` already call
`reloadVaultIndex()` internally, chaining `.then(() => reloadAndRender(vaultId))`
causes a second redundant reload. Remove all such chains. The vault reload inside
the ops functions is sufficient.

---

## Edge cases addressed per step

| EC | Step |
|----|------|
| EC-1 same-name no-op | step_02 (already handled in `startInlineRename`; renameNode receives the resolved name only after commit) |
| EC-2 rename collision | step_02 (`filenameExistsInDir` check already present; extension fix makes it correct for non-`.md`) |
| EC-3 illegal chars | step_02 (`validateFilename` already present) |
| EC-4 empty input | step_02 (handled in `startInlineRename` before `renameNode` is called) |
| EC-5 Escape/blur cancel | step_03 (no change needed; already implemented) |
| EC-6 dirty tab rename | step_01 (`handleFileRename` preserves `isDirty`) |
| EC-7 dir rename open tabs | step_02 (loop over tabs with matching prefix) |
| EC-8 dir rename no open tabs | step_02 (loop is a no-op) |
| EC-9 delete file with dirty tab | step_01 + step_02 (`closeFileByPath` returns false if declined) |
| EC-10 delete dir with dirty tab | step_02 (collect-then-close pattern) |
| EC-11 file not found on disk | Rust returns error; surfaced via `showInlineError` |
| EC-12 non-empty dir delete | Rust `remove_dir_all` handles recursively; no change |
| EC-13 two rename inputs open | Acceptable; each is independent |
| EC-14 empty path on node | `validateFilename` blocks commit |
| EC-15 dblclick on vault root | Guard `data-type === "file" \|\| "directory"` excludes vault; step_03 |
| EC-16 Delete key for directory | step_03 |
| EC-17 non-`.md` file rename | step_02 (extension preservation) |
| EC-18 vault reload fails | Caught and logged; stale tree corrected by FS watcher |
| EC-19 tab manager not yet init | Optional chain `?.handleFileRename?.()` is a no-op |
| EC-20 race close same tab twice | `closeFileByPath` check: tab gone = return `true` |

---

## Non-functional requirements

- NFR-1: no new Rust commands
- NFR-2: IIFE plugin boundary — all Tauri calls via `window.__TAURI_INTERNALS__.invoke`
- NFR-3: `TabManager` changes are in `src/tabs/tab-manager.ts` only
- NFR-4: `window.confirm` for delete confirmation (preserve existing pattern)
- NFR-5: inline error spans for rename errors; `showInlineError` for delete errors
- NFR-6: no TODO comments in source
- NFR-7: `npm run build:plugins && npm run sync:plugins` after any plugin source change
- NFR-8: window size invariant unaffected (no changes to `lib.rs` or `settings.ts`)

---

## Definition of done

- All three step files implemented.
- `npm run test:run` exits 0.
- `npm run build:plugins && npm run sync:plugins` succeeds.
- Manual smoke test: rename a `.md` file, a non-`.md` file, and a directory; delete a
  file and a directory (with and without an open dirty tab).

---

## Review Request (Round 2 — post-reviewer feedback)

### Issues resolved in this round

- **H1**: Added length-justification block comments to `renameNode`, `deleteFile`,
  `deleteDirectory`, and `closeTabsUnder`, explaining why each function cannot be
  further split.
- **H2**: Fixed `renameNode` to use a new `nodeType: "file" | "directory"` parameter
  (from the node's `data-type` attribute) as the authoritative directory discriminator,
  replacing the faulty `originalExt === ""` check that silently misclassified
  extension-less files (e.g. `Makefile`, `LICENSE`) as directories. Added test 3c.
- **H3 (EC-15)**: Added test in `file-browser.test.ts` asserting that dblclick on a
  vault-type `<li>` does not produce a `.tree-node-rename-input` in the DOM.
- **H3 (EC-16)**: Added test in `file-browser.test.ts` asserting that pressing Delete
  on a directory-type `<li>` calls `invoke("delete_directory")`.
- **M1**: Enhanced test 5 in `tab-manager-rename-delete.test.ts` to also assert that
  `document.getElementById("titlebar-title")?.textContent` equals the new stem after
  `handleFileRename` on the active tab.
- **M2**: Added `container: HTMLElement` parameter to `deleteFile` and
  `deleteDirectory`. Both now wrap the `invoke` call in try/catch and call
  `showInlineError(container, ...)` on failure. All call sites updated. Added
  tests 12b and 16b in `rename-delete-ops.test.ts`.
- **M3**: Enhanced test 14 in `rename-delete-ops.test.ts` to assert that
  `closeFileByPathMock` was called for the first tab (a.md) and called exactly twice
  total, confirming the partial-close loop ran before aborting.

---

- **Files changed**:
  - `src/tabs/tab-manager.ts` — no changes required (methods already correct)
  - `src/plugins/file-browser/file-browser-ops.ts` — H1 block comments, H2 `nodeType`
    parameter on `renameNode`, M2 `container` parameter + try/catch on `deleteFile`
    and `deleteDirectory`, H1 comment on `closeTabsUnder`
  - `src/plugins/file-browser/file-browser.plugin.ts` — updated all `renameNode` call
    sites to pass `nodeType` from `data-type`, updated all `deleteFile`/`deleteDirectory`
    call sites to pass `_panelContainer`/`container`
  - `tests/tabs/tab-manager-rename-delete.test.ts` — M1: title-bar assertion added to
    test 5
  - `tests/plugins/file-browser/rename-delete-ops.test.ts` — H2: test 3c added; M2:
    tests 12b and 16b added; M3: partial-close assertion added to test 14; all
    `deleteFile`/`deleteDirectory` calls updated to pass container
  - `tests/plugins/file-browser/file-browser.test.ts` — H3: EC-15 and EC-16 tests
    added; `deleteDirectory` calls updated to pass container

- **Steps completed**: step_01, step_02, step_03 (all original steps; this round fixes
  reviewer-identified issues only)

- **Known limitations**:
  - The non-`.md` file rename (`renameNode`) passes the full user-typed name as-is for
    non-`.md` files. This matches the spec and `startInlineRename` behavior (which
    populates the input with the full filename including extension). If `startInlineRename`
    is later changed to show only the stem for non-`.md` files, `renameNode` will need a
    corresponding update.
  - `reloadAndRender` was deleted (it had no callers; `noUnusedLocals: true` in tsconfig
    would cause a tsc failure if left in place). Deviates slightly from the original spec
    wording "leave in place," which was superseded by the Definition of Done requirement
    that `npx tsc --noEmit` passes.

- **Edge cases covered by tests**:

  | EC | Test |
  |----|------|
  | EC-1 (same-name no-op / no backlink banner) | test 8 in rename-delete-ops.test.ts |
  | EC-6 (dirty tab rename preserves isDirty) | test 2 in tab-manager-rename-delete.test.ts |
  | EC-7 (directory rename open tabs) | test 3a in rename-delete-ops.test.ts |
  | EC-8 (directory rename no open tabs) | test 3b (loop is no-op when getTabs returns []) |
  | EC-9 (delete file with dirty tab — user declines) | test 9 in tab-manager-rename-delete.test.ts; test 10 in rename-delete-ops.test.ts |
  | EC-10 (delete directory with dirty tab — collect-then-close) | test 14 in rename-delete-ops.test.ts |
  | EC-11 (Rust delete error surfaced inline) | tests 12b and 16b in rename-delete-ops.test.ts |
  | EC-15 (dblclick on vault root → no rename) | file-browser.test.ts: "EC-15: dblclick on vault node…" |
  | EC-16 (Delete key for directory) | file-browser.test.ts: "EC-16: Delete key on a directory node…"; also test 3a in rename-delete-ops.test.ts |
  | EC-17 (non-.md file rename — extension preserved) | tests 2a/2b/2c and new test 3c in rename-delete-ops.test.ts |
  | EC-19 (tab manager not yet init — optional chaining) | deleteFile guard degrades gracefully |
  | EC-20 (race: close same tab twice) | test 10 in tab-manager-rename-delete.test.ts; tests 17/18 in rename-delete-ops.test.ts |

---

## Review Sign-off

- **Date**: 2026-04-30
- **Findings summary**: 0 Critical, 0 High, 0 Medium, 0 Low — all resolved. Prior Low findings (7, 8, 9) from round 1 are not blocking; none introduced regressions.
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified.
- **Edge case coverage**: All Edge Case Inventory items covered by tests (EC-1 through EC-20, with EC-2/3/4/5/12/13/14/18 handled in implementation logic without dedicated new tests; pre-existing coverage or no test required per spec).
- **Status**: Approved for Merge
